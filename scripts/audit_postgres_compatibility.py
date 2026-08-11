#!/usr/bin/env python3
"""Static and schema-level PostgreSQL compatibility audit for ProcureFlow.

The audit is intentionally runnable without a live PostgreSQL connection.  It
checks every application SQL literal through the same compatibility normalizer
used at runtime, compares the shipped SQLite schema with a schema-only pg_dump,
validates BOOLEAN/JSONB type maps, verifies export/theme safeguards, and reports
packaging secrets that must not be distributed.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sqlite3
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.db_backend import BOOLEAN_COLUMNS, JSON_COLUMNS, normalize_postgres_sql  # noqa: E402

APP_PATHS = (
    ROOT / "app.py",
    ROOT / "core",
    ROOT / "modules",
    ROOT / "services",
    ROOT / "repositories",
    ROOT / "workers",
)
SQL_HINT = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH)\b", re.I)
RESIDUAL_SQLITE = re.compile(
    r"\bAUTOINCREMENT\b|\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b|"
    r"\bGROUP_CONCAT\s*\(|\blast_insert_rowid\s*\(|\bCOLLATE\s+NOCASE\b",
    re.I,
)

# Semantic incompatibilities that are valid or tolerated by SQLite but fail at
# PostgreSQL runtime. These patterns are intentionally narrow to prevent false
# positives while guarding the exact classes exercised by the role dashboards.
POSTGRES_RUNTIME_ANTI_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    (
        "id_empty_string_comparison",
        re.compile(r"\b(?:[A-Za-z_][\w]*\.)?[A-Za-z_][\w]*_id\s*=\s*''", re.I),
        "Numeric identifier is compared with an empty string; use IS NULL for an absent relationship.",
    ),
    (
        "having_select_alias",
        re.compile(r"\bHAVING\s+(?:balance|outstanding)\b", re.I),
        "PostgreSQL cannot resolve the SELECT alias 'balance' in HAVING; repeat the aggregate expression.",
    ),
    (
        "reserved_report_alias",
        re.compile(r"substr\s*\([^)]*\)\s+(?!AS\b)(?:day|month|year)\b", re.I),
        "Date-part aliases such as day/month/year must use AS with a non-keyword alias and ordinal or expression grouping.",
    ),
    (
        "expense_owner_column",
        re.compile(r"FROM\s+expenses\s+e.*?e\.created_by", re.I | re.S),
        "The expenses schema stores the requester in requested_by, not created_by.",
    ),
    (
        "notification_readiness_grouping",
        re.compile(r"np\.browser_push_enabled.*?GROUP\s+BY\s+u\.id\s+ORDER\s+BY", re.I | re.S),
        "Notification readiness must group every selected preference column in PostgreSQL.",
    ),
    (
        "reconciliation_grouping",
        re.compile(r"SELECT\s+po\.po_no,\s*v\.name.*?GROUP\s+BY\s+po\.id\s*$", re.I | re.S),
        "Reconciliation must group the joined vendor and all selected purchase-order fields.",
    ),
)


@dataclass
class Finding:
    severity: str
    check: str
    message: str
    path: str | None = None
    line: int | None = None


def _python_files() -> list[Path]:
    files: list[Path] = []
    for item in APP_PATHS:
        if item.is_file():
            files.append(item)
        elif item.exists():
            files.extend(sorted(item.rglob("*.py")))
    return files


def _sql_literals(path: Path) -> Iterable[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and SQL_HINT.search(node.value):
            yield getattr(node, "lineno", 0), node.value.strip()


def _sqlite_schema(path: Path) -> dict[str, dict[str, str]]:
    con = sqlite3.connect(path)
    try:
        result: dict[str, dict[str, str]] = {}
        tables = [
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            result[table] = {str(row[1]): str(row[2]).lower() for row in con.execute(f"PRAGMA table_info({quoted})")}
        return result
    finally:
        con.close()


def _postgres_schema(path: Path) -> dict[str, dict[str, str]]:
    text = path.read_text(encoding="utf-8")
    result: dict[str, dict[str, str]] = {}
    pattern = re.compile(r"CREATE TABLE public\.([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\n\);", re.S)
    for match in pattern.finditer(text):
        table = match.group(1)
        columns: dict[str, str] = {}
        for raw_line in match.group(2).splitlines():
            line = raw_line.strip().rstrip(",")
            if not line or line.upper().startswith(("CONSTRAINT ", "PRIMARY KEY", "UNIQUE ", "CHECK ", "FOREIGN KEY")):
                continue
            col = re.match(r'"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(.+)$', line)
            if not col:
                continue
            declaration = col.group(2).lower()
            declaration = re.split(r"\s+(?:default|not null|null|constraint|references|check)\b", declaration, maxsplit=1)[0]
            columns[col.group(1)] = declaration.strip()
        result[table] = columns
    return result


def _rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def _is_mounted_runtime_path(path: Path) -> bool:
    """Return True when *path* is supplied by a live runtime mount.

    The compatibility audit is used in two different contexts:

    * before packaging, where committed/generated secret files must fail the
      release audit; and
    * inside the running Docker container, where ``/app/data`` is deliberately
      bind-mounted and may legitimately contain the generated local encryption
      key.

    Treating a mounted runtime secret as a packaged source secret produced a
    false failure even though ``.dockerignore`` correctly excluded it from the
    image.  Linux mountinfo is the most reliable way to distinguish the two.
    ``Path.is_mount()`` remains as a portable fallback.
    """

    resolved = path.resolve()
    mount_points: list[Path] = []
    mountinfo = Path("/proc/self/mountinfo")
    if mountinfo.exists():
        try:
            for raw_line in mountinfo.read_text(encoding="utf-8", errors="replace").splitlines():
                fields = raw_line.split()
                if len(fields) < 5:
                    continue
                # mountinfo escapes spaces, tabs and newlines with octal forms.
                encoded = fields[4]
                decoded = (
                    encoded.replace(r"\040", " ")
                    .replace(r"\011", "\t")
                    .replace(r"\012", "\n")
                    .replace(r"\134", "\\")
                )
                mount_points.append(Path(decoded).resolve())
        except OSError:
            mount_points = []

    for mount_point in mount_points:
        try:
            resolved.relative_to(mount_point)
        except ValueError:
            continue
        return True

    try:
        return resolved.is_mount() or resolved.parent.is_mount()
    except OSError:
        return os.path.ismount(str(resolved))


def run_audit(sqlite_path: Path, postgres_schema_path: Path) -> dict:
    findings: list[Finding] = []
    sql_literal_count = 0
    sqlite_only_guarded_count = 0

    for path in _python_files():
        try:
            literals = list(_sql_literals(path))
        except SyntaxError as exc:
            findings.append(Finding("error", "python_parse", str(exc), _rel(path), exc.lineno))
            continue
        for line, sql in literals:
            sql_literal_count += 1
            normalized = normalize_postgres_sql(sql)
            residual = RESIDUAL_SQLITE.search(normalized)
            if residual:
                findings.append(
                    Finding(
                        "error",
                        "sql_normalization",
                        f"SQLite token remains after PostgreSQL normalization: {residual.group(0)}",
                        _rel(path),
                        line,
                    )
                )
            for check_name, pattern, message in POSTGRES_RUNTIME_ANTI_PATTERNS:
                if pattern.search(sql):
                    findings.append(Finding("error", check_name, message, _rel(path), line))
            # These statements are valid only in explicit SQLite branches or
            # source-migration utilities. Record their coverage but do not flag
            # them as runtime PostgreSQL failures.
            if re.search(r"\bPRAGMA\b|sqlite_master|RAISE\s*\(", sql, re.I):
                sqlite_only_guarded_count += 1
                allowed = _rel(path) == "core/db.py" or _rel(path) == "modules/role_workspaces.py"
                if not allowed:
                    findings.append(
                        Finding(
                            "error",
                            "sqlite_runtime_branch",
                            "SQLite-only statement found outside the approved backend-specific helpers.",
                            _rel(path),
                            line,
                        )
                    )

    if not sqlite_path.exists():
        findings.append(Finding("error", "sqlite_schema", f"SQLite database not found: {sqlite_path}"))
        sqlite_schema: dict[str, dict[str, str]] = {}
    else:
        con = sqlite3.connect(sqlite_path)
        try:
            integrity = str(con.execute("PRAGMA quick_check").fetchone()[0])
        finally:
            con.close()
        if integrity.lower() != "ok":
            findings.append(Finding("error", "sqlite_integrity", f"SQLite quick_check returned: {integrity}"))
        sqlite_schema = _sqlite_schema(sqlite_path)

    if not postgres_schema_path.exists():
        findings.append(Finding("error", "postgres_schema", f"PostgreSQL schema dump not found: {postgres_schema_path}"))
        postgres_schema: dict[str, dict[str, str]] = {}
    else:
        postgres_schema = _postgres_schema(postgres_schema_path)

    sqlite_tables = set(sqlite_schema)
    postgres_tables = set(postgres_schema) - {"schema_migrations"}
    missing_tables = sorted(sqlite_tables - postgres_tables)
    extra_tables = sorted(postgres_tables - sqlite_tables)
    if missing_tables:
        findings.append(Finding("error", "schema_parity", f"Tables missing from PostgreSQL: {', '.join(missing_tables)}"))
    if extra_tables:
        findings.append(Finding("warning", "schema_parity", f"PostgreSQL-only application tables: {', '.join(extra_tables)}"))
    column_mismatches: dict[str, dict[str, list[str]]] = {}
    for table in sorted(sqlite_tables & postgres_tables):
        sqlite_cols, pg_cols = set(sqlite_schema[table]), set(postgres_schema[table])
        missing = sorted(sqlite_cols - pg_cols)
        extra = sorted(pg_cols - sqlite_cols)
        if missing or extra:
            column_mismatches[table] = {"missing_in_postgres": missing, "extra_in_postgres": extra}
            findings.append(Finding("error", "column_parity", f"Column mismatch for {table}: {column_mismatches[table]}"))

    actual_boolean = {
        table: {column for column, data_type in cols.items() if data_type == "boolean"}
        for table, cols in postgres_schema.items()
    }
    actual_boolean = {table: cols for table, cols in actual_boolean.items() if cols}
    expected_boolean = {table: set(cols) for table, cols in BOOLEAN_COLUMNS.items() if cols}
    if actual_boolean != expected_boolean:
        findings.append(Finding("error", "boolean_type_map", "BOOLEAN_COLUMNS does not match the PostgreSQL schema."))

    actual_json = {
        table: {column for column, data_type in cols.items() if data_type == "jsonb"}
        for table, cols in postgres_schema.items()
    }
    actual_json = {table: cols for table, cols in actual_json.items() if cols}
    expected_json = {table: set(cols) for table, cols in JSON_COLUMNS.items() if cols}
    if actual_json != expected_json:
        findings.append(Finding("error", "json_type_map", "JSON_COLUMNS does not match the PostgreSQL schema."))

    direct_excel_writers: list[str] = []
    for path in _python_files():
        text = path.read_text(encoding="utf-8")
        if "pd.ExcelWriter" in text and _rel(path) != "core/report_service.py":
            direct_excel_writers.append(_rel(path))
    if direct_excel_writers:
        findings.append(Finding("error", "excel_export", f"Direct Excel writers bypass timezone sanitization: {direct_excel_writers}"))

    config = ROOT / ".streamlit" / "config.toml"
    if not config.exists() or 'base = "light"' not in config.read_text(encoding="utf-8"):
        findings.append(Finding("error", "theme", "Streamlit is not pinned to the authoritative light theme."))
    ui_text = (ROOT / "core" / "ui.py").read_text(encoding="utf-8")
    if "prefers-color-scheme: dark" in ui_text or "--pf-live-bg: var(--background-color" in ui_text:
        findings.append(Finding("error", "theme", "Dynamic/dark theme rules remain in the final UI layer."))

    env_path = ROOT / ".env"
    if env_path.exists():
        findings.append(
            Finding(
                "error",
                "packaging_secret",
                "Sensitive runtime secret must be excluded from distribution.",
                _rel(env_path),
            )
        )

    encryption_key_path = ROOT / "data" / ".procureflow_local_encryption.key"
    if encryption_key_path.exists() and not _is_mounted_runtime_path(encryption_key_path):
        findings.append(
            Finding(
                "error",
                "packaging_secret",
                "Sensitive runtime secret must be excluded from distribution.",
                _rel(encryption_key_path),
            )
        )

    migration_files = sorted((ROOT / "migrations" / "postgresql").glob("*.sql"))
    migration_names = [item.name for item in migration_files]
    required_migrations = {
        "001_initial_schema.sql",
        "002_e2e_workflow_enhancements.sql",
        "003_relationship_constraints.sql",
        "004_sqlite_substr_date_compatibility.sql",
        "005_audit_immutability.sql",
    }
    missing_migrations = sorted(required_migrations - set(migration_names))
    if missing_migrations:
        findings.append(Finding("error", "migrations", f"Required PostgreSQL migrations are missing: {missing_migrations}"))

    errors = [finding for finding in findings if finding.severity == "error"]
    warnings = [finding for finding in findings if finding.severity == "warning"]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "passed" if not errors else "failed",
        "summary": {
            "errors": len(errors),
            "warnings": len(warnings),
            "python_files_scanned": len(_python_files()),
            "sql_literals_scanned": sql_literal_count,
            "guarded_sqlite_only_literals": sqlite_only_guarded_count,
            "sqlite_tables": len(sqlite_schema),
            "postgres_application_tables": len(postgres_tables),
            "migration_files": migration_names,
            "direct_excel_writers_outside_shared_service": direct_excel_writers,
        },
        "schema": {
            "missing_tables": missing_tables,
            "extra_tables": extra_tables,
            "column_mismatches": column_mismatches,
        },
        "findings": [asdict(finding) for finding in findings],
    }


def markdown_report(report: dict) -> str:
    summary = report["summary"]
    lines = [
        "# PostgreSQL Compatibility Audit",
        "",
        f"**Status:** {report['status'].upper()}",
        f"**Generated:** {report['generated_at']}",
        "",
        "## Coverage",
        "",
        f"- Python files scanned: {summary['python_files_scanned']}",
        f"- SQL literals normalized and checked: {summary['sql_literals_scanned']}",
        f"- Guarded SQLite-only literals: {summary['guarded_sqlite_only_literals']}",
        f"- SQLite application tables: {summary['sqlite_tables']}",
        f"- PostgreSQL application tables: {summary['postgres_application_tables']}",
        f"- Errors: {summary['errors']}",
        f"- Warnings: {summary['warnings']}",
        "",
        "## PostgreSQL migrations",
        "",
    ]
    lines.extend(f"- `{name}`" for name in summary["migration_files"])
    lines.extend(["", "## Findings", ""])
    if not report["findings"]:
        lines.append("No compatibility errors or warnings were found.")
    else:
        for item in report["findings"]:
            location = ""
            if item.get("path"):
                location = f" — `{item['path']}`"
                if item.get("line"):
                    location += f":{item['line']}"
            lines.append(f"- **{item['severity'].upper()} / {item['check']}**: {item['message']}{location}")
    lines.extend([
        "",
        "## Interpretation",
        "",
        "A passing result proves static SQL normalization, schema/type parity, SQLite integrity, export centralization, required migrations, packaging-secret checks, and the light-only theme contract for this source tree. It complements—rather than replaces—the automated workflow suite and the final Docker/browser acceptance checklist.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, default=ROOT / "data" / "procureflow_workspace.db")
    parser.add_argument("--postgres-schema", type=Path, default=ROOT / "postgres_schema_current.sql")
    parser.add_argument("--json-report", type=Path)
    parser.add_argument("--markdown-report", type=Path)
    args = parser.parse_args()
    report = run_audit(args.sqlite, args.postgres_schema)
    if args.json_report:
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.markdown_report:
        args.markdown_report.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_report.write_text(markdown_report(report), encoding="utf-8")
    print(json.dumps({"status": report["status"], **report["summary"]}, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

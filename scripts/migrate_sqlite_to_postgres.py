#!/usr/bin/env python3
"""Repeatable, restart-safe SQLite to PostgreSQL migration for ProcureFlow."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.postgres_schema import apply_postgres_migrations
from core.db_backend import get_postgres_connection
from scripts.backup_sqlite_for_migration import create_backup


def quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def source_tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def source_conflict_columns(con: sqlite3.Connection, table: str) -> list[str]:
    columns = list(con.execute(f"PRAGMA table_info({quote_ident(table)})"))
    pk = [r["name"] for r in sorted(columns, key=lambda r: r["pk"]) if r["pk"]]
    if pk:
        return pk
    for idx in con.execute(f"PRAGMA index_list({quote_ident(table)})"):
        if not idx["unique"]:
            continue
        names = [r["name"] for r in con.execute(f"PRAGMA index_info({quote_ident(idx['name'])})") if r["name"]]
        if names:
            return names
    return []


def destination_columns(conn, table: str) -> dict[str, str]:
    rows = conn.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=?
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return {str(r["column_name"]): str(r["data_type"]) for r in rows}


def normalize_value(value: Any, pg_type: str) -> Any:
    if value is None:
        return None
    if pg_type == "boolean":
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)
    if pg_type == "jsonb":
        # Return a plain Python JSON-compatible value. The PostgreSQL backend
        # performs the single required Jsonb adaptation. Returning Jsonb here
        # as well caused Jsonb(Jsonb(...)) double-wrapping and rejected every
        # populated JSONB row during SQLite-to-PostgreSQL migration.
        try:
            return json.loads(value) if isinstance(value, str) else value
        except Exception:
            # Preserve malformed legacy text as a valid JSON string rather than
            # dropping the record. The migration report still retains source
            # keys for any unrelated database error.
            return str(value)
    if pg_type in {"timestamp with time zone", "date"} and value == "":
        return None
    if pg_type in {"numeric", "double precision", "real"} and isinstance(value, float):
        return Decimal(str(value)) if pg_type == "numeric" else value
    return value


def build_upsert_sql(table: str, columns: list[str], conflict: list[str]) -> str:
    quoted_cols = ", ".join(quote_ident(c) for c in columns)
    placeholders = ", ".join(["?"] * len(columns))
    base = f"INSERT INTO {quote_ident(table)} ({quoted_cols}) VALUES ({placeholders})"
    valid_conflict = [c for c in conflict if c in columns]
    if valid_conflict:
        updates = [c for c in columns if c not in valid_conflict]
        if updates:
            set_sql = ", ".join(f"{quote_ident(c)}=EXCLUDED.{quote_ident(c)}" for c in updates)
            return base + " ON CONFLICT (" + ", ".join(quote_ident(c) for c in valid_conflict) + f") DO UPDATE SET {set_sql}"
        return base + " ON CONFLICT (" + ", ".join(quote_ident(c) for c in valid_conflict) + ") DO NOTHING"
    return base + " ON CONFLICT DO NOTHING"


def set_identity_sequence(conn, table: str) -> None:
    cols = destination_columns(conn, table)
    if "id" not in cols:
        return
    sequence = conn.execute("SELECT pg_get_serial_sequence(?, 'id')", (table,)).fetchone()
    if not sequence or not sequence[0]:
        return
    seq_name = str(sequence[0])
    row = conn.execute(f"SELECT COALESCE(MAX(id),0) AS max_id FROM {quote_ident(table)}").fetchone()
    max_id = int(row["max_id"] or 0)
    conn.execute("SELECT setval(?::regclass, ?, ?)", (seq_name, max(max_id, 1), bool(max_id)))



def reset_deferred_relationship_migration(conn) -> list[dict[str, str]]:
    """Remove deferred NOT VALID FKs left by an earlier partial run.

    Migration 003 is intentionally applied only after every source row has
    loaded. Older builds applied it even when rows failed. PostgreSQL enforces
    NOT VALID constraints for new rows, so a restart could then be blocked.
    Dropping only unvalidated foreign keys and removing 003 from migration
    history makes the data load safely restartable; migration 003 is recreated
    after a completely successful load.
    """
    rows = conn.execute(
        """
        SELECT conrelid::regclass::text AS table_name, conname
        FROM pg_constraint
        WHERE contype='f'
          AND NOT convalidated
          AND connamespace=current_schema()::regnamespace
        ORDER BY 1,2
        """
    ).fetchall()
    removed: list[dict[str, str]] = []
    for row in rows:
        table_name = str(row["table_name"])
        constraint_name = str(row["conname"])
        conn.execute(
            f"ALTER TABLE {quote_ident(table_name)} DROP CONSTRAINT IF EXISTS {quote_ident(constraint_name)}"
        )
        removed.append({"table": table_name, "constraint": constraint_name})
    conn.execute(
        "DELETE FROM schema_migrations WHERE version=?",
        ("003_relationship_constraints.sql",),
    )
    conn.commit()
    return removed

def migrate(sqlite_path: Path, report_path: Path, *, backup: bool = True, continue_on_error: bool = True) -> dict[str, Any]:
    if not sqlite_path.exists():
        raise FileNotFoundError(sqlite_path)
    backup_path = None
    if backup:
        backup_path = create_backup(sqlite_path, sqlite_path.parent / "backups" / "cloudsql_migration", sqlite_path.parent)

    # Create baseline and feature columns, but add FKs only after data loading.
    apply_postgres_migrations(through="002_e2e_workflow_enhancements.sql")
    source = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    destination = get_postgres_connection()
    removed_constraints = reset_deferred_relationship_migration(destination)
    started = datetime.now(timezone.utc)
    report: dict[str, Any] = {
        "started_at": started.isoformat(timespec="seconds"),
        "source": str(sqlite_path),
        "backup": str(backup_path) if backup_path else None,
        "tables": {},
        "failed_records": [],
        "removed_deferred_constraints": removed_constraints,
    }
    try:
        for table in source_tables(source):
            dest_types = destination_columns(destination, table)
            if not dest_types:
                report["tables"][table] = {"source": 0, "migrated": 0, "failed": 0, "status": "destination_table_missing"}
                continue
            src_columns = [str(r["name"]) for r in source.execute(f"PRAGMA table_info({quote_ident(table)})")]
            columns = [c for c in src_columns if c in dest_types]
            conflict = source_conflict_columns(source, table)
            statement = build_upsert_sql(table, columns, conflict)
            rows = source.execute(f"SELECT {', '.join(quote_ident(c) for c in columns)} FROM {quote_ident(table)}").fetchall()
            migrated = failed = 0
            destination.execute("BEGIN")
            for index, row in enumerate(rows, start=1):
                savepoint = f"pf_row_{index}"
                destination.execute(f"SAVEPOINT {savepoint}")
                try:
                    values = tuple(normalize_value(row[c], dest_types[c]) for c in columns)
                    destination.execute(statement, values)
                    destination.execute(f"RELEASE SAVEPOINT {savepoint}")
                    migrated += 1
                except Exception as exc:
                    destination.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                    destination.execute(f"RELEASE SAVEPOINT {savepoint}")
                    failed += 1
                    key = {c: row[c] for c in conflict if c in row.keys()}
                    report["failed_records"].append(
                        {"table": table, "source_key": key, "error_type": type(exc).__name__, "error": str(exc)[:1000]}
                    )
                    if not continue_on_error:
                        raise
            set_identity_sequence(destination, table)
            destination.commit()
            report["tables"][table] = {
                "source": len(rows),
                "migrated": migrated,
                "failed": failed,
                "status": "ok" if failed == 0 else "partial",
                "conflict_key": conflict,
            }

        report["status"] = "success" if not report["failed_records"] else "partial"
        # Relationship constraints are deliberately applied only after every
        # source row has loaded. They remain NOT VALID until the verification
        # command confirms counts and relationships, then validates them.
        if report["status"] == "success":
            apply_postgres_migrations()
    finally:
        source.close()
        destination.close()
    report["completed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report["duration_seconds"] = (datetime.now(timezone.utc) - started).total_seconds()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", default="data/procureflow_workspace.db")
    parser.add_argument("--report", default="data/backups/cloudsql_migration/migration_report.json")
    parser.add_argument("--skip-backup", action="store_true")
    parser.add_argument("--fail-fast", action="store_true")
    args = parser.parse_args()
    result = migrate(
        Path(args.sqlite).expanduser().resolve(),
        Path(args.report).expanduser().resolve(),
        backup=not args.skip_backup,
        continue_on_error=not args.fail_fast,
    )
    print(json.dumps({"status": result["status"], "report": str(Path(args.report).resolve()), "failed": len(result["failed_records"])}, indent=2))
    raise SystemExit(0 if result["status"] == "success" else 2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Copy ProcureFlow document references to persistent storage and rewrite PostgreSQL paths.

Run this from a host/job where both the legacy document tree and the target
Cloud Storage mount are available. The operation is restart-safe: destination
filenames include a content hash, existing identical files are reused, and
PostgreSQL updates are keyed by the migrated source row ID.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.db_backend import get_postgres_connection

PATH_COLUMNS: tuple[tuple[str, str], ...] = (
    ("advance_expenses", "receipt_path"),
    ("attachments", "file_path"),
    ("collaboration_messages", "attachment_path"),
    ("document_extraction_logs", "original_path"),
    ("expenses", "receipt_path"),
    ("gateway_passes", "generated_file_path"),
    ("imported_legacy_documents", "original_path"),
    ("imported_legacy_documents", "file_path"),
    ("invoices", "file_path"),
    ("logistics_documents", "file_path"),
    ("payment_payee_details", "source_attachment_path"),
    ("payments", "proof_path"),
    ("receipt_document_versions", "file_path"),
    ("receipt_records", "file_path"),
    ("receiving_slips", "attachment_path"),
    ("receiving_slips", "proof_of_delivery_path"),
    ("vendor_documents", "file_path"),
    ("vendor_quotes", "attachment_path"),
    ("vendor_quotes", "quote_document_path"),
)


def quote_ident(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return cleaned or "document"


def _candidate_relative_path(raw_value: str) -> Path | None:
    normalized = raw_value.replace("\\", "/")
    lower = normalized.lower()
    marker = "/data/"
    if marker in lower:
        return Path(normalized[lower.index(marker) + len(marker):])
    if lower.startswith("data/"):
        return Path(normalized[5:])
    # A relative path can be kept directly. Windows drive paths are not
    # considered relative when the migration runs on Linux.
    if not Path(normalized).is_absolute() and not PureWindowsPath(raw_value).drive:
        return Path(normalized)
    return None


def resolve_source_file(raw_value: Any, source_root: Path, project_root: Path = PROJECT_ROOT) -> Path | None:
    text = str(raw_value or "").strip()
    if not text:
        return None
    direct = Path(text).expanduser()
    candidates: list[Path] = []
    if direct.is_absolute():
        candidates.append(direct)
    relative = _candidate_relative_path(text)
    if relative is not None:
        candidates.extend([source_root / relative, project_root / relative, project_root / "data" / relative])
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    # Legacy Windows absolute paths often survive in SQLite. Match by basename
    # only when the result inside the protected source root is unambiguous.
    basename = PureWindowsPath(text).name or Path(text).name
    if basename:
        matches = [p for p in source_root.rglob(basename) if p.is_file()]
        if len(matches) == 1:
            return matches[0].resolve()
    return None


def destination_for(source: Path, source_root: Path, target_root: Path, table: str, column: str) -> Path:
    digest = sha256_file(source)
    try:
        relative = source.relative_to(source_root.resolve())
        if ".." not in relative.parts:
            return target_root / relative
    except ValueError:
        pass
    return target_root / "migrated" / table / column / f"{digest[:16]}_{_safe_name(source.name)}"


def migrate_documents(sqlite_path: Path, source_root: Path, target_root: Path, report_path: Path, *, update_postgres: bool = True) -> dict[str, Any]:
    source = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    pg = get_postgres_connection() if update_postgres else None
    report: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sqlite": str(sqlite_path),
        "source_root": str(source_root),
        "target_root": str(target_root),
        "copied": [],
        "reused": [],
        "missing": [],
        "failed": [],
        "postgres_updated": 0,
    }
    target_root.mkdir(parents=True, exist_ok=True)
    try:
        source_tables = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, column in PATH_COLUMNS:
            if table not in source_tables:
                continue
            columns = {r[1] for r in source.execute(f"PRAGMA table_info({quote_ident(table)})")}
            if "id" not in columns or column not in columns:
                continue
            rows = source.execute(
                f"SELECT id, {quote_ident(column)} AS path_value FROM {quote_ident(table)} "
                f"WHERE {quote_ident(column)} IS NOT NULL AND TRIM({quote_ident(column)})<>''"
            ).fetchall()
            for row in rows:
                record = {"table": table, "column": column, "id": int(row["id"]), "source_value": str(row["path_value"])}
                try:
                    source_file = resolve_source_file(row["path_value"], source_root)
                    if source_file is None:
                        report["missing"].append(record)
                        continue
                    destination = destination_for(source_file, source_root, target_root, table, column)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    source_hash = sha256_file(source_file)
                    if destination.is_file() and sha256_file(destination) == source_hash:
                        action = "reused"
                    else:
                        shutil.copy2(source_file, destination)
                        if sha256_file(destination) != source_hash:
                            raise RuntimeError("Copied document checksum does not match the source.")
                        action = "copied"
                    try:
                        os.chmod(destination, 0o600)
                    except OSError:
                        pass
                    result = {**record, "source_file": str(source_file), "destination": str(destination), "sha256": source_hash}
                    report[action].append(result)
                    if pg is not None:
                        pg.execute(
                            f"UPDATE {quote_ident(table)} SET {quote_ident(column)}=? WHERE id=?",
                            (str(destination), int(row["id"])),
                        )
                        report["postgres_updated"] += 1
                except Exception as exc:
                    report["failed"].append({**record, "error_type": type(exc).__name__, "error": str(exc)[:1000]})
        if pg is not None:
            pg.commit()
    except Exception:
        if pg is not None:
            pg.rollback()
        raise
    finally:
        source.close()
        if pg is not None:
            pg.close()
    report["completed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report["status"] = "success" if not report["missing"] and not report["failed"] else "partial"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", default="data/procureflow_workspace.db")
    parser.add_argument("--source-root", default="data")
    parser.add_argument("--target-root", required=True, help="Mounted persistent document root, e.g. /mnt/procureflow")
    parser.add_argument("--report", default="data/backups/cloudsql_migration/document_migration_report.json")
    parser.add_argument("--copy-only", action="store_true", help="Copy and checksum files without rewriting PostgreSQL paths")
    args = parser.parse_args()
    result = migrate_documents(
        Path(args.sqlite).expanduser().resolve(),
        Path(args.source_root).expanduser().resolve(),
        Path(args.target_root).expanduser().resolve(),
        Path(args.report).expanduser().resolve(),
        update_postgres=not args.copy_only,
    )
    print(json.dumps({
        "status": result["status"],
        "copied": len(result["copied"]),
        "reused": len(result["reused"]),
        "missing": len(result["missing"]),
        "failed": len(result["failed"]),
        "postgres_updated": result["postgres_updated"],
    }, indent=2))
    raise SystemExit(0 if result["status"] == "success" else 2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Create a consistent SQLite + document-manifest backup before cutover."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_backup(sqlite_path: Path, output_dir: Path, data_dir: Path | None = None) -> Path:
    if not sqlite_path.exists():
        raise FileNotFoundError(sqlite_path)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = output_dir / f"pre_cloudsql_{stamp}"
    target.mkdir(parents=True, exist_ok=False)
    backup_db = target / sqlite_path.name

    source = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    destination = sqlite3.connect(backup_db)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()

    con = sqlite3.connect(backup_db)
    try:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Backup integrity check failed: {integrity}")
        tables = {
            row[0]: con.execute(f'SELECT COUNT(*) FROM "{row[0]}"').fetchone()[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        }
    finally:
        con.close()

    document_root = (data_dir or sqlite_path.parent).resolve()
    documents = []
    for path in sorted(document_root.rglob("*")):
        if not path.is_file() or path.resolve() in {sqlite_path.resolve(), backup_db.resolve()}:
            continue
        if target in path.parents:
            continue
        try:
            documents.append(
                {
                    "relative_path": str(path.relative_to(document_root)),
                    "size_bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
        except (OSError, ValueError):
            continue

    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_sqlite": str(sqlite_path.resolve()),
        "backup_sqlite": str(backup_db.resolve()),
        "database_sha256": sha256_file(backup_db),
        "integrity_check": integrity,
        "table_counts": tables,
        "document_root": str(document_root),
        "document_manifest_count": len(documents),
    }
    (target / "backup_manifest.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (target / "document_manifest.json").write_text(json.dumps(documents, indent=2), encoding="utf-8")
    (target / "RESTORE.txt").write_text(
        "Stop ProcureFlow, copy the backed-up database over the active SQLite file, "
        "set PROCUREFLOW_DATABASE_BACKEND=sqlite, then restart the application.\n",
        encoding="utf-8",
    )
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", default="data/procureflow_workspace.db")
    parser.add_argument("--output-dir", default="data/backups/cloudsql_migration")
    parser.add_argument("--data-dir", default="")
    args = parser.parse_args()
    target = create_backup(
        Path(args.sqlite).expanduser().resolve(),
        Path(args.output_dir).expanduser().resolve(),
        Path(args.data_dir).expanduser().resolve() if args.data_dir else None,
    )
    print(target)


if __name__ == "__main__":
    main()

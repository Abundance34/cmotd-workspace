#!/usr/bin/env python3
"""Create a consistent, self-contained ProcureFlow SQLite backup.

Run this script from the ProcureFlow project root (or place it there). It uses
SQLite's online backup API, so it can safely make a consistent copy even if the
application is open. The backup also preserves the local encryption key and
stored attachments/imports.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"
SOURCE_DB = DATA_DIR / "procureflow_workspace.db"
BACKUPS_DIR = DATA_DIR / "backups"

EXCLUDED_TOP_LEVEL = {
    "backups",
    "procureflow_workspace.db",
    "procureflow_workspace.db-wal",
    "procureflow_workspace.db-shm",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_supporting_data(destination_data_dir: Path) -> list[str]:
    """Copy everything in data/ except the live database files and old backups."""
    copied: list[str] = []
    for source in DATA_DIR.iterdir():
        if source.name in EXCLUDED_TOP_LEVEL:
            continue
        target = destination_data_dir / source.name
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
            copied.append(f"data/{source.name}/")
        else:
            shutil.copy2(source, target)
            copied.append(f"data/{source.name}")
    return copied


def create_database_backup(destination_db: Path) -> tuple[str, int]:
    """Use SQLite's backup API and return integrity result and table count."""
    source_conn = sqlite3.connect(SOURCE_DB, timeout=30)
    destination_conn = sqlite3.connect(destination_db)
    try:
        source_conn.backup(destination_conn, pages=200, sleep=0.05)
        integrity_result = destination_conn.execute("PRAGMA integrity_check").fetchone()[0]
        table_count = destination_conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
    finally:
        destination_conn.close()
        source_conn.close()
    return integrity_result, table_count


def main() -> int:
    if not SOURCE_DB.exists():
        print(f"ERROR: SQLite database was not found: {SOURCE_DB}")
        print("Place this script in the ProcureFlow project root, beside app.py and the data folder.")
        return 1

    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_root = BACKUPS_DIR / f"sqlite_backup_{stamp}"
    destination_data = backup_root / "data"
    destination_data.mkdir(parents=True, exist_ok=False)

    print("Creating consistent SQLite database backup...")
    try:
        integrity_result, table_count = create_database_backup(
            destination_data / "procureflow_workspace.db"
        )
        if integrity_result.lower() != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity_result}")

        copied_items = copy_supporting_data(destination_data)
        db_backup = destination_data / "procureflow_workspace.db"
        manifest = {
            "created_at": datetime.now().astimezone().isoformat(),
            "source_database": str(SOURCE_DB),
            "database_integrity_check": integrity_result,
            "database_table_count": table_count,
            "database_size_bytes": db_backup.stat().st_size,
            "database_sha256": sha256_file(db_backup),
            "copied_supporting_items": copied_items,
            "restore_note": "Stop ProcureFlow before replacing its data folder with this backup's data folder.",
        }
        (backup_root / "backup_manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        (backup_root / "RESTORE_INSTRUCTIONS.txt").write_text(
            "1. Stop ProcureFlow.\n"
            "2. Rename the current project data folder to data_before_restore.\n"
            "3. Copy this backup's data folder into the ProcureFlow project root.\n"
            "4. Start ProcureFlow again.\n"
            "\nDo not restore only the .db file: retain the local encryption key and attachments.\n",
            encoding="utf-8",
        )
    except Exception as exc:
        shutil.rmtree(backup_root, ignore_errors=True)
        print(f"ERROR: Backup was not completed. {exc}")
        return 1

    print("SUCCESS: SQLite backup created and verified.")
    print(f"Backup location: {backup_root}")
    print(f"Database tables copied: {table_count}")
    print(f"Integrity check: {integrity_result}")
    print("Keep the entire backup folder together.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

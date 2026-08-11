#!/usr/bin/env python3
"""Restore the pre-cutover SQLite database or remove an unused PG target."""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def restore_sqlite(backup_db: Path, target_db: Path) -> None:
    if not backup_db.exists():
        raise FileNotFoundError(backup_db)
    target_db.parent.mkdir(parents=True, exist_ok=True)
    if target_db.exists():
        shutil.copy2(target_db, target_db.with_suffix(target_db.suffix + ".pre_rollback"))
    shutil.copy2(backup_db, target_db)
    print(f"Restored {target_db}")
    print("Set PROCUREFLOW_DATABASE_BACKEND=sqlite and remove PROCUREFLOW_DATABASE_URL before restarting ProcureFlow.")


def drop_postgres_schema(confirm: str) -> None:
    if confirm != "DROP-PROCUREFLOW-PUBLIC-SCHEMA":
        raise SystemExit("Refusing destructive rollback. Pass --confirm DROP-PROCUREFLOW-PUBLIC-SCHEMA.")
    from core.db_backend import get_postgres_connection
    conn = get_postgres_connection()
    try:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
        conn.commit()
        print("PostgreSQL public schema dropped and recreated.")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--restore-sqlite", help="Path to backed-up procureflow_workspace.db")
    parser.add_argument("--target-sqlite", default="data/procureflow_workspace.db")
    parser.add_argument("--drop-postgres", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()
    if args.restore_sqlite:
        restore_sqlite(Path(args.restore_sqlite).resolve(), Path(args.target_sqlite).resolve())
    elif args.drop_postgres:
        drop_postgres_schema(args.confirm)
    else:
        parser.error("Choose --restore-sqlite or --drop-postgres.")


if __name__ == "__main__":
    main()

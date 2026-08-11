#!/usr/bin/env python3
"""Compare SQLite source data and PostgreSQL destination after migration."""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.db_backend import get_postgres_connection


def q(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


RELATIONSHIPS = [
    ("purchase_request_items", "request_id", "purchase_requests", "id"),
    ("sourcing_tasks", "request_id", "purchase_requests", "id"),
    ("vendor_quotes", "sourcing_task_id", "sourcing_tasks", "id"),
    ("purchase_orders", "request_id", "purchase_requests", "id"),
    ("payments", "request_id", "purchase_requests", "id"),
    ("payment_payee_details", "purchase_request_id", "purchase_requests", "id"),
    ("receipt_records", "payment_id", "payments", "id"),
    ("approval_history", "approved_by_user_id", "users", "id"),
    ("notifications", "user_id", "users", "id"),
]


def verify(sqlite_path: Path, *, validate_constraints: bool = False) -> dict[str, Any]:
    source = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    pg = get_postgres_connection()
    report: dict[str, Any] = {
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": str(sqlite_path),
        "tables": {},
        "relationships": [],
        "password_hashes": {},
        "document_references": {},
        "errors": [],
    }
    try:
        source_tables = [r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        dest_tables = {r[0] for r in pg.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()").fetchall()}
        for table in source_tables:
            src_count = source.execute(f"SELECT COUNT(*) FROM {q(table)}").fetchone()[0]
            if table not in dest_tables:
                report["tables"][table] = {"source": src_count, "destination": None, "match": False}
                report["errors"].append(f"Missing destination table: {table}")
                continue
            dst_count = pg.execute(f"SELECT COUNT(*) FROM {q(table)}").fetchone()[0]
            match = int(src_count) == int(dst_count)
            report["tables"][table] = {"source": int(src_count), "destination": int(dst_count), "match": match}
            if not match:
                report["errors"].append(f"Count mismatch for {table}: SQLite={src_count}, PostgreSQL={dst_count}")

        # Password hashes must remain byte-for-byte identical so migrated users
        # can authenticate without forced resets.
        src_users = {r["username"]: r["password_hash"] for r in source.execute("SELECT username,password_hash FROM users")}
        dst_users = {r["username"]: r["password_hash"] for r in pg.execute("SELECT username,password_hash FROM users").fetchall()}
        mismatches = sorted(name for name, value in src_users.items() if dst_users.get(name) != value)
        report["password_hashes"] = {"source_users": len(src_users), "destination_users": len(dst_users), "mismatches": mismatches, "match": not mismatches}
        if mismatches:
            report["errors"].append("Password hash mismatch for: " + ", ".join(mismatches))

        for child, child_col, parent, parent_col in RELATIONSHIPS:
            if child not in dest_tables or parent not in dest_tables:
                continue
            exists = pg.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? AND column_name=?",
                (child, child_col),
            ).fetchone()
            if not exists:
                continue
            orphan = pg.execute(
                f"SELECT COUNT(*) FROM {q(child)} c LEFT JOIN {q(parent)} p ON p.{q(parent_col)}=c.{q(child_col)} "
                f"WHERE c.{q(child_col)} IS NOT NULL AND p.{q(parent_col)} IS NULL"
            ).fetchone()[0]
            report["relationships"].append({"child": f"{child}.{child_col}", "parent": f"{parent}.{parent_col}", "orphans": int(orphan)})
            if orphan:
                report["errors"].append(f"{orphan} orphan rows: {child}.{child_col} -> {parent}.{parent_col}")

        from scripts.migrate_document_storage import PATH_COLUMNS
        path_columns = PATH_COLUMNS
        for table, column in path_columns:
            if table not in dest_tables:
                continue
            rows = pg.execute(f"SELECT {q(column)} FROM {q(table)} WHERE {q(column)} IS NOT NULL AND {q(column)}<>''").fetchall()
            missing = [str(r[0]) for r in rows if not Path(str(r[0])).exists()]
            report["document_references"][f"{table}.{column}"] = {"total": len(rows), "missing_on_current_host": len(missing), "examples": missing[:10]}

        if validate_constraints and not report["errors"]:
            constraints = pg.execute(
                "SELECT conrelid::regclass::text AS table_name, conname FROM pg_constraint WHERE contype='f' AND NOT convalidated ORDER BY 1,2"
            ).fetchall()
            for constraint in constraints:
                pg.execute(f"ALTER TABLE {constraint['table_name']} VALIDATE CONSTRAINT {q(str(constraint['conname']))}")
            pg.commit()
        else:
            pg.commit()
    finally:
        source.close()
        pg.close()
    report["status"] = "passed" if not report["errors"] else "failed"
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", default="data/procureflow_workspace.db")
    parser.add_argument("--report", default="data/backups/cloudsql_migration/verification_report.json")
    parser.add_argument("--validate-constraints", action="store_true")
    args = parser.parse_args()
    result = verify(Path(args.sqlite).expanduser().resolve(), validate_constraints=args.validate_constraints)
    output = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"status": result["status"], "errors": len(result["errors"]), "report": str(output)}, indent=2))
    raise SystemExit(0 if result["status"] == "passed" else 2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Read-only verification of a live ProcureFlow PostgreSQL runtime.

Run inside the application container after deployment:

    docker compose exec procureflow python scripts/verify_postgres_runtime.py \
      --report data/backups/postgres_runtime_verification.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.db import get_conn  # noqa: E402
from core.db_backend import BOOLEAN_COLUMNS, JSON_COLUMNS, database_backend, postgres_health_check  # noqa: E402


REQUIRED_MIGRATIONS = {
    "001_initial_schema.sql",
    "002_e2e_workflow_enhancements.sql",
    "003_relationship_constraints.sql",
    "004_sqlite_substr_date_compatibility.sql",
    "005_audit_immutability.sql",
}


def _rows(cursor) -> list[dict]:
    return [dict(row) for row in cursor.fetchall()]


def verify() -> dict:
    checks: list[dict] = []

    def record(name: str, ok: bool, detail: object) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    backend = database_backend()
    record("backend", backend == "postgresql", backend)
    health = postgres_health_check()
    record("connection_pool", health.ok, health.message)

    if backend != "postgresql" or not health.ok:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "status": "failed",
            "checks": checks,
        }

    conn = get_conn()
    try:
        migrations = {
            str(row["version"])
            for row in _rows(conn.execute("SELECT version FROM schema_migrations ORDER BY version"))
        }
        record("required_migrations", REQUIRED_MIGRATIONS.issubset(migrations), sorted(migrations))

        app_tables = {
            str(row["table_name"])
            for row in _rows(
                conn.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema=current_schema() AND table_type='BASE TABLE' "
                    "AND table_name <> 'schema_migrations'"
                )
            )
        }
        record("application_table_count", len(app_tables) == 68, len(app_tables))

        month = conn.execute("SELECT substr(CURRENT_DATE, 1, 7) AS month").fetchone()
        month_value = str(month["month"]) if month else ""
        record("sqlite_date_substr_compatibility", len(month_value) == 7 and month_value[4] == "-", month_value)

        bool_rows = _rows(
            conn.execute(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema=current_schema() AND data_type='boolean'"
            )
        )
        actual_bool = {(str(row["table_name"]), str(row["column_name"])) for row in bool_rows}
        expected_bool = {(table, col) for table, cols in BOOLEAN_COLUMNS.items() for col in cols}
        record("boolean_type_map", actual_bool == expected_bool, {
            "actual": len(actual_bool), "expected": len(expected_bool),
            "missing": sorted(expected_bool - actual_bool), "extra": sorted(actual_bool - expected_bool),
        })

        json_rows = _rows(
            conn.execute(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema=current_schema() AND data_type='jsonb'"
            )
        )
        actual_json = {(str(row["table_name"]), str(row["column_name"])) for row in json_rows}
        expected_json = {(table, col) for table, cols in JSON_COLUMNS.items() for col in cols}
        record("jsonb_type_map", actual_json == expected_json, {
            "actual": len(actual_json), "expected": len(expected_json),
            "missing": sorted(expected_json - actual_json), "extra": sorted(actual_json - expected_json),
        })

        trigger_rows = _rows(
            conn.execute(
                "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "
                "WHERE c.relname='audit_events' AND NOT t.tgisinternal"
            )
        )
        triggers = {str(row["tgname"]) for row in trigger_rows}
        required_triggers = {"trg_audit_events_no_update", "trg_audit_events_no_delete"}
        record("audit_immutability_triggers", required_triggers.issubset(triggers), sorted(triggers))

        role_rows = _rows(conn.execute("SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY role"))
        roles = {str(row["role"]): int(row["count"]) for row in role_rows}
        required_roles = {"Admin", "Procurement Manager", "Facility Manager", "Finance", "Approver", "Auditor"}
        record("required_roles", required_roles.issubset(roles), roles)

        representative_counts = {}
        for table in (
            "users", "purchase_requests", "vendor_quotes", "approval_history", "notifications",
            "payments", "receipt_records", "audit_events", "payment_payee_detail_versions",
        ):
            if table in app_tables:
                row = conn.execute(f'SELECT COUNT(*) AS count FROM "{table}"').fetchone()
                representative_counts[table] = int(row["count"]) if row else 0
        record("representative_tables_readable", len(representative_counts) == 9, representative_counts)
        conn.commit()
    except Exception as exc:
        conn.rollback()
        record("runtime_query_exception", False, f"{type(exc).__name__}: {exc}")
    finally:
        conn.close()

    status = "passed" if all(item["ok"] for item in checks) else "failed"
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": status,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = verify()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

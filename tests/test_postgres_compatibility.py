from pathlib import Path

from core.db_backend import _coerce_boolean_params, normalize_postgres_sql, qmark_to_pyformat
from scripts.migrate_sqlite_to_postgres import build_upsert_sql


def test_qmark_translation_preserves_quoted_question_marks():
    sql = "SELECT '?' literal, value FROM records WHERE id=? AND note='why?'"
    translated = qmark_to_pyformat(sql)
    assert translated == "SELECT '?' literal, value FROM records WHERE id=%s AND note='why?'"


def test_sqlite_compatibility_rewrites_for_postgres():
    sql = normalize_postgres_sql("INSERT OR IGNORE INTO users (username,is_active) VALUES (?,1)")
    assert "ON CONFLICT DO NOTHING" in sql
    assert "%s" in sql
    assert "is_active" in sql
    assert "TRUE" in sql


def test_literal_boolean_insert_is_typed_for_postgres():
    sql = normalize_postgres_sql(
        """
        INSERT OR IGNORE INTO notification_preferences
        (user_id, in_app_enabled, browser_push_enabled, email_enabled,
         important_only, approval_notifications, gateway_pass_notifications,
         finance_notifications, delegation_notifications,
         browser_permission_status, created_at, updated_at)
        VALUES (?, 1, 0, 0, 1, 1, 1, 1, 1, 'not_requested', ?, ?)
        """
    )
    assert "VALUES (%s, TRUE, FALSE, FALSE, TRUE, TRUE, TRUE, TRUE, TRUE" in " ".join(sql.split())


def test_update_boolean_set_and_filter_are_rewritten_separately():
    sql = normalize_postgres_sql(
        "UPDATE notifications SET is_read=1, popup_shown=0 WHERE is_read=0 AND id=?"
    )
    assert "SET is_read=TRUE, popup_shown=FALSE" in sql
    assert "WHERE is_read IS FALSE AND id=%s" in sql
    assert "SET is_read IS TRUE" not in sql


def test_temporal_wrappers_are_postgres_compatible():
    sql = normalize_postgres_sql(
        "SELECT * FROM audit_events WHERE datetime(occurred_at) >= datetime(?) "
        "AND date(event_date)=date(?)"
    )
    assert "CAST(occurred_at AS TIMESTAMPTZ)" in sql
    assert "CAST(%s AS TIMESTAMPTZ)" in sql
    assert "CAST(event_date AS DATE)" in sql
    assert "CAST(%s AS DATE)" in sql


def test_boolean_coalesce_is_postgres_typed():
    sql = normalize_postgres_sql(
        "SELECT COALESCE(account_locked,0) account_locked FROM users "
        "WHERE COALESCE(is_active,1)=1 AND COALESCE(account_locked,0)=0"
    )
    assert "COALESCE(account_locked, FALSE) account_locked" in sql
    assert "COALESCE(is_active, TRUE) IS TRUE" in sql
    assert "COALESCE(account_locked, FALSE) IS FALSE" in sql


def test_migration_upsert_is_restart_safe():
    sql = build_upsert_sql("users", ["id", "username", "password_hash"], ["id"])
    assert 'ON CONFLICT ("id") DO UPDATE' in sql
    assert '"username"=EXCLUDED."username"' in sql


def test_postgres_migrations_include_feature_constraints():
    root = Path(__file__).resolve().parents[1]
    feature = (root / "migrations/postgresql/002_e2e_workflow_enhancements.sql").read_text(encoding="utf-8")
    assert "Internet Bank Transfer" in feature
    assert "Physical Bank Transfer" in feature
    assert "approval_rescissions" in feature
    assert "vendor_quote_items" in feature
    assert "Proof of Payment" in feature and "Vendor Receipt" in feature
    assert "receipt_records(ocr_status, status, discrepancy_status" in feature
    assert "receipt_records(ocr_status, verification_status" not in feature


def test_postgres_parameter_coercion_handles_boolean_and_jsonb_columns():
    values = _coerce_boolean_params(
        "INSERT INTO receipt_records (ocr_json,duplicate_warning) VALUES (?,?)",
        ('{"fields":{"total_amount":120000}}', 1),
    )
    # In test environments without psycopg the JSON value is a dict; with
    # psycopg installed it is wrapped by Jsonb and remains adapter-safe.
    assert values[1] is True
    assert values[0] is not None


def test_postgres_indexes_reference_declared_columns():
    """Catch schema migration failures caused by indexes on absent columns."""
    import re

    root = Path(__file__).resolve().parents[1]
    migration_files = [
        root / "migrations/postgresql/001_initial_schema.sql",
        root / "migrations/postgresql/002_e2e_workflow_enhancements.sql",
    ]
    declared: dict[str, set[str]] = {}

    for migration_file in migration_files:
        sql = migration_file.read_text(encoding="utf-8")
        for match in re.finditer(
            r'CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?([A-Za-z_][\\w]*)"?\s*\((.*?)\);',
            sql,
            re.IGNORECASE | re.DOTALL,
        ):
            table_name, body = match.groups()
            table_columns = declared.setdefault(table_name, set())
            for line in body.splitlines():
                cleaned = line.strip().rstrip(",")
                if not cleaned or re.match(
                    r"(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\\b",
                    cleaned,
                    re.IGNORECASE,
                ):
                    continue
                column_match = re.match(r'"?([A-Za-z_][\\w]*)"?\s+', cleaned)
                if column_match:
                    table_columns.add(column_match.group(1))

        for match in re.finditer(
            r'ALTER\s+TABLE\s+"?([A-Za-z_][\\w]*)"?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?([A-Za-z_][\\w]*)"?',
            sql,
            re.IGNORECASE,
        ):
            declared.setdefault(match.group(1), set()).add(match.group(2))

    invalid: list[str] = []
    for migration_file in migration_files:
        sql = migration_file.read_text(encoding="utf-8")
        for match in re.finditer(
            r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+\\w+\s+ON\s+"?([A-Za-z_][\\w]*)"?\s*\((.*?)\)',
            sql,
            re.IGNORECASE | re.DOTALL,
        ):
            table_name, expression = match.groups()
            for part in expression.split(","):
                candidate = part.strip().split()[0].strip('"')
                if re.fullmatch(r"[A-Za-z_]\\w*", candidate) and candidate not in declared.get(table_name, set()):
                    invalid.append(f"{migration_file.name}: {table_name}.{candidate}")

    assert invalid == []

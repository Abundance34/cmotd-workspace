from __future__ import annotations

from pathlib import Path

from core.db_backend import PostgresCursor, _escape_pyformat_percent_literals

ROOT = Path(__file__).resolve().parents[1]
ROLE_WORKSPACES = (ROOT / "modules" / "role_workspaces.py").read_text(encoding="utf-8")
AUDITOR = (ROOT / "modules" / "auditor_hardening.py").read_text(encoding="utf-8")
WORKSPACE = (ROOT / "modules" / "workspace.py").read_text(encoding="utf-8")


class _FakeRawCursor:
    description = None
    rowcount = 0

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def execute(self, *args):
        self.calls.append(args)
        return self

    def executemany(self, *args):
        self.calls.append(args)
        return self

    def close(self) -> None:
        pass


class _FakeRawConnection:
    def __init__(self) -> None:
        self.cursor_instance = _FakeRawCursor()

    def cursor(self):
        return self.cursor_instance


class _FakeConnection:
    def __init__(self) -> None:
        self._raw = _FakeRawConnection()


def test_empty_parameter_query_does_not_activate_psycopg_placeholder_parser():
    connection = _FakeConnection()
    cursor = PostgresCursor(connection)
    cursor.execute("SELECT * FROM audit_events WHERE action LIKE '%DOWNLOAD%'")
    assert connection._raw.cursor_instance.calls == [
        ("SELECT * FROM audit_events WHERE action LIKE '%DOWNLOAD%'",)
    ]


def test_parameterized_like_query_escapes_literal_percent_signs_only():
    connection = _FakeConnection()
    cursor = PostgresCursor(connection)
    cursor.execute(
        "SELECT * FROM audit_events WHERE action LIKE '%DOWNLOAD%' AND occurred_at >= ?",
        ("2026-07-28",),
    )
    sql, params = connection._raw.cursor_instance.calls[0]
    assert "LIKE '%%DOWNLOAD%%'" in sql
    assert sql.endswith("occurred_at >= %s")
    assert params == ("2026-07-28",)
    assert _escape_pyformat_percent_literals("SELECT %s, '%LOGIN%', 10 % 3") == (
        "SELECT %s, '%%LOGIN%%', 10 %% 3"
    )




def test_executemany_escapes_literal_percent_patterns():
    connection = _FakeConnection()
    cursor = PostgresCursor(connection)
    cursor.executemany(
        "UPDATE audit_events SET outcome=? WHERE action LIKE '%LOGIN%' AND id=?",
        [("Success", 1), ("Success", 2)],
    )
    sql, batches = connection._raw.cursor_instance.calls[0]
    assert "LIKE '%%LOGIN%%'" in sql
    assert batches == [("Success", 1), ("Success", 2)]


def test_notification_readiness_groups_all_selected_nonaggregate_columns():
    assert (
        "GROUP BY u.id, u.username, u.full_name, u.role, "
        "np.browser_push_enabled, np.browser_permission_status"
    ) in ROLE_WORKSPACES
    assert "GROUP BY u.id ORDER BY u.role, u.username" not in ROLE_WORKSPACES


def test_report_queries_use_explicit_aliases_and_ordinal_grouping():
    assert 'substr(created_at,1,7) AS "Month"' in ROLE_WORKSPACES
    assert 'substr(created_at,1,4) AS "Year"' in ROLE_WORKSPACES
    assert "GROUP BY Month" not in ROLE_WORKSPACES
    assert "GROUP BY Year" not in ROLE_WORKSPACES


def test_bigint_receipt_relationship_is_never_compared_to_empty_text():
    assert "receipt_id=''" not in ROLE_WORKSPACES
    assert "receipt_id = ''" not in ROLE_WORKSPACES
    assert "status='Paid' AND receipt_id IS NULL" in ROLE_WORKSPACES
    assert "p.status='Paid' AND p.receipt_id IS NULL" in ROLE_WORKSPACES


def test_cash_advance_balance_filter_repeats_the_aggregate_expression():
    assert "HAVING balance>0" not in ROLE_WORKSPACES
    assert "HAVING balance > 0" not in ROLE_WORKSPACES
    assert "HAVING balance > 0" not in WORKSPACE
    assert "HAVING outstanding > 0" not in WORKSPACE
    assert "HAVING ca.amount_collected-COALESCE(SUM(ae.amount),0)>0" in ROLE_WORKSPACES


def test_reconciliation_groups_joined_vendor_and_purchase_order_fields():
    expected = (
        "GROUP BY po.id, po.po_no, v.name, po.total_amount, "
        "po.payment_status, po.receiving_status"
    )
    assert expected in ROLE_WORKSPACES
    assert "GROUP BY po.id\")" not in ROLE_WORKSPACES


def test_expense_audit_uses_existing_requested_by_relationship():
    assert "u.id=e.requested_by" in AUDITOR
    assert "u.id=e.created_by" not in AUDITOR


def test_private_handoff_report_groups_joined_user_names():
    assert (
        "GROUP BY ct.id, ct.entity_type, ct.entity_id, fm.full_name, pm.full_name"
    ) in ROLE_WORKSPACES

def test_auditor_security_trend_avoids_reserved_day_alias():
    assert "substr(occurred_at,1,10) day" not in AUDITOR
    assert "AS event_day" in AUDITOR
    assert "GROUP BY 1 ORDER BY 1 DESC LIMIT 30" in AUDITOR
    assert 'rename(columns={"event_day": "day"})' in AUDITOR

def test_workspace_monthly_trend_avoids_reserved_month_alias():
    assert "substr(expense_date,1,7) month" not in WORKSPACE
    assert "AS trend_month" in WORKSPACE
    assert 'rename(columns={"trend_month": "month"})' in WORKSPACE


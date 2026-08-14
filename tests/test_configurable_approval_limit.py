"""Regression contract for Admin-configurable approval limit."""

from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (
        ROOT
        / relative
    ).read_text(
        encoding="utf-8",
        errors="ignore",
    )


def test_default_approval_limit_is_two_million():
    from services.approval_policy_service import (
        DEFAULT_PROCUREMENT_MANAGER_APPROVAL_LIMIT,
    )

    assert (
        DEFAULT_PROCUREMENT_MANAGER_APPROVAL_LIMIT
        == Decimal("2000000.00")
    )


def test_approval_limit_has_no_application_maximum():
    from services.approval_policy_service import (
        parse_approval_limit,
    )

    enormous = Decimal(
        "999999999999999999999999999999999999999999999999"
    )

    assert parse_approval_limit(enormous) == enormous


def test_approval_limit_must_be_positive():
    from services.approval_policy_service import (
        parse_approval_limit,
    )

    with pytest.raises(ValueError):
        parse_approval_limit("0")

    with pytest.raises(ValueError):
        parse_approval_limit("-1")


def test_admin_ui_does_not_define_a_max_value():
    source = _read(
        "modules/role_workspaces.py"
    )

    assert (
        "def approval_limit_configuration_panel"
        in source
    )

    panel = source[
        source.index(
            "def approval_limit_configuration_panel"
        ):
    ]

    assert "No maximum ceiling is imposed" in panel
    assert "max_value=" not in panel


def test_postgres_policy_numeric_has_no_precision_cap():
    migration = _read(
        "migrations/postgresql/"
        "007_configurable_approval_limit.sql"
    )

    assert "amount NUMERIC NOT NULL" in migration

    assert "NUMERIC(" not in migration



def test_runtime_workflow_uses_dynamic_threshold():
    workflow = _read(
        "core/workflow.py"
    )

    assert (
        "def procurement_manager_approval_threshold()"
        in workflow
    )

    assert (
        "def procurement_manager_approval_threshold_sql()"
        in workflow
    )

    assert (
        "get_procurement_manager_approval_limit"
        in workflow
    )

    assert (
        "get_procurement_manager_approval_limit_sql"
        in workflow
    )

    workspace = _read(
        "modules/role_workspaces.py"
    )

    # SQL queries must use the database-safe adapter.
    assert (
        "procurement_manager_approval_threshold_sql()"
        in workspace
    )

    # In-memory/DataFrame decisions must use the authoritative
    # Decimal-based workflow policy.
    assert (
        "lambda value: not is_low_value_approval(value)"
        in workspace
    )

    # The workspace should no longer mix ordinary Python
    # threshold calls into SQL parameter positions.
    assert (
        "procurement_manager_approval_threshold()"
        not in workspace
    )



def test_old_fixed_threshold_text_removed_from_live_workspace():
    source = _read(
        "modules/role_workspaces.py"
    )

    assert "?100,000" not in source


def test_self_approval_protection_remains_present():
    source = _read(
        "modules/role_workspaces.py"
    )

    assert "_pm_originated_request" in source

    assert (
        "independent Approver / MD approval"
        in source
        or "independent Approver / MD"
        in source
    )



def test_policy_changes_are_audited():
    import ast

    source = _read(
        "services/approval_policy_service.py"
    )

    assert "APPROVAL_LIMIT_CHANGED" in source

    tree = ast.parse(source)

    matches = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name
        == "set_procurement_manager_approval_limit"
    ]

    assert len(matches) == 1

    node = matches[0]

    body = "\n".join(
        source.splitlines()[
            node.lineno - 1:
            node.end_lineno
        ]
    )

    # Both audit representations are required.
    assert "INSERT INTO audit_logs" in body
    assert "_append_audit_event_to_conn(" in body

    # They are deliberately NOT written through log_audit(),
    # because log_audit() uses separately committed run_query()
    # calls and would break atomicity.
    assert "log_audit(" not in body

    assert "conn.commit()" in body
    assert "conn.rollback()" in body

    audit_log_position = body.index(
        "INSERT INTO audit_logs"
    )

    immutable_position = body.index(
        "_append_audit_event_to_conn("
    )

    commit_position = body.index(
        "conn.commit()"
    )

    assert audit_log_position < commit_position
    assert immutable_position < commit_position


def test_approval_limit_accepts_naira_formatted_amount():
    from services.approval_policy_service import (
        parse_approval_limit,
    )

    value = "\u20a625,000,000"

    assert (
        parse_approval_limit(value)
        == Decimal("25000000")
    )


def test_approval_limit_accepts_large_naira_formatted_amount():
    from services.approval_policy_service import (
        parse_approval_limit,
    )

    value = "\u20a61,000,000,000,000"

    assert (
        parse_approval_limit(value)
        == Decimal("1000000000000")
    )


def test_approval_limit_rejects_non_finite_values():
    from services.approval_policy_service import (
        parse_approval_limit,
    )

    for value in (
        "NaN",
        "Infinity",
        "-Infinity",
    ):
        with pytest.raises(ValueError):
            parse_approval_limit(value)


def test_sql_threshold_adapter_never_uses_float():
    import ast

    source = _read(
        "services/approval_policy_service.py"
    )

    tree = ast.parse(source)

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name
        == "get_procurement_manager_approval_limit_sql"
    ]

    assert len(functions) == 1

    node = functions[0]

    float_calls = [
        child
        for child in ast.walk(node)
        if isinstance(child, ast.Call)
        and isinstance(child.func, ast.Name)
        and child.func.id == "float"
    ]

    assert float_calls == []

    body = "\n".join(
        source.splitlines()[
            node.lineno - 1:
            node.end_lineno
        ]
    )

    assert 'format(amount, "f")' in body
    assert "if is_postgres()" in body



def test_sql_threshold_adapter_preserves_huge_sqlite_value(
    monkeypatch,
):
    import services.approval_policy_service as policy

    huge = Decimal("9" * 400)

    monkeypatch.setattr(
        policy,
        "get_procurement_manager_approval_limit",
        lambda: huge,
    )

    monkeypatch.setattr(
        policy,
        "is_postgres",
        lambda: False,
    )

    result = (
        policy.get_procurement_manager_approval_limit_sql()
    )

    assert isinstance(result, str)
    assert result == format(huge, "f")
    assert "inf" not in result.lower()


def test_sql_threshold_adapter_preserves_decimal_for_postgres(
    monkeypatch,
):
    import services.approval_policy_service as policy

    huge = Decimal("9" * 400)

    monkeypatch.setattr(
        policy,
        "get_procurement_manager_approval_limit",
        lambda: huge,
    )

    monkeypatch.setattr(
        policy,
        "is_postgres",
        lambda: True,
    )

    result = (
        policy.get_procurement_manager_approval_limit_sql()
    )

    assert isinstance(result, Decimal)
    assert result == huge


def test_workflow_has_separate_python_and_sql_thresholds():
    source = _read(
        "core/workflow.py"
    )

    assert (
        "def procurement_manager_approval_threshold()"
        in source
    )

    assert (
        "def procurement_manager_approval_threshold_sql()"
        in source
    )

    assert (
        "get_procurement_manager_approval_limit,"
        in source
    )

    assert (
        "get_procurement_manager_approval_limit_sql,"
        in source
    )


def test_workspace_sql_uses_sql_threshold_adapter():
    source = _read(
        "modules/role_workspaces.py"
    )

    assert (
        "procurement_manager_approval_threshold_sql()"
        in source
    )

    assert (
        "procurement_manager_approval_threshold()"
        not in source
    )

    assert (
        "lambda value: not is_low_value_approval(value)"
        in source
    )

def test_approval_limit_change_is_atomic():
    import ast

    source = _read(
        "services/approval_policy_service.py"
    )

    tree = ast.parse(source)

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name
        == "set_procurement_manager_approval_limit"
    ]

    assert len(functions) == 1

    node = functions[0]
    lines = source.splitlines()

    body = "\n".join(
        lines[node.lineno - 1:node.end_lineno]
    )

    assert "conn = get_conn()" in body
    assert 'conn.execute("BEGIN IMMEDIATE")' in body

    assert (
        "UPDATE approval_policy_settings"
        in body
    )

    assert (
        "INSERT INTO approval_policy_history"
        in body
    )

    assert (
        "INSERT INTO audit_logs"
        in body
    )

    assert (
        "_append_audit_event_to_conn("
        in body
    )

    assert "conn.commit()" in body
    assert "conn.rollback()" in body

    # The authoritative policy mutation must not be split
    # across auto-committing run_query()/log_audit() calls.
    assert "run_query(" not in body
    assert "log_audit(" not in body


def test_postgres_approval_limit_change_locks_policy_row():
    import ast

    source = _read(
        "services/approval_policy_service.py"
    )

    tree = ast.parse(source)

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name
        == "set_procurement_manager_approval_limit"
    ]

    node = functions[0]
    lines = source.splitlines()

    body = "\n".join(
        lines[node.lineno - 1:node.end_lineno]
    )

    assert "FOR UPDATE" in body
    assert "if is_postgres():" in body


def test_postgres_policy_write_keeps_decimal_precision():
    import ast

    source = _read(
        "services/approval_policy_service.py"
    )

    tree = ast.parse(source)

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name
        == "set_procurement_manager_approval_limit"
    ]

    node = functions[0]
    lines = source.splitlines()

    body = "\n".join(
        lines[node.lineno - 1:node.end_lineno]
    )

    assert "new_db_amount = new_amount" in body
    assert "old_db_amount = old_amount" in body

    assert "float(new_amount)" not in body
    assert "float(old_amount)" not in body


def test_required_policy_audit_evidence_is_same_transaction():
    import ast

    source = _read(
        "services/approval_policy_service.py"
    )

    tree = ast.parse(source)

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name
        == "set_procurement_manager_approval_limit"
    ]

    node = functions[0]
    lines = source.splitlines()

    body = "\n".join(
        lines[node.lineno - 1:node.end_lineno]
    )

    history_position = body.index(
        "INSERT INTO approval_policy_history"
    )

    legacy_audit_position = body.index(
        "INSERT INTO audit_logs"
    )

    immutable_audit_position = body.index(
        "_append_audit_event_to_conn("
    )

    commit_position = body.index(
        "conn.commit()"
    )

    assert history_position < commit_position
    assert legacy_audit_position < commit_position
    assert immutable_audit_position < commit_position

from core.db import df_query, init_db, table_columns
from core.permissions import can_approve, can_approve_low_value, safe_role_permissions
from core.workflow import (
    procurement_manager_approval_threshold,
    STATUS_SUBMITTED_APPROVAL,
    is_low_value_approval,
    request_routing_for_status,
    required_approval_role_for_amount,
)


def test_threshold_boundary_routes_to_procurement_manager(monkeypatch):
    import core.workflow as workflow

    configured_limit = 2_500_000.0

    monkeypatch.setattr(
        workflow,
        "procurement_manager_approval_threshold",
        lambda: configured_limit,
    )

    assert workflow.is_low_value_approval(
        configured_limit - 0.01
    )

    assert workflow.is_low_value_approval(
        configured_limit
    )

    assert not workflow.is_low_value_approval(
        configured_limit + 0.01
    )

    assert (
        workflow.required_approval_role_for_amount(
            configured_limit
        )
        == "procurement_manager"
    )

    assert (
        workflow.required_approval_role_for_amount(
            configured_limit + 0.01
        )
        == "approver"
    )


def test_submitted_request_routing_uses_amount_threshold(monkeypatch):
    import core.workflow as workflow

    configured_limit = 2_500_000.0

    monkeypatch.setattr(
        workflow,
        "procurement_manager_approval_threshold",
        lambda: configured_limit,
    )

    assert (
        workflow.request_routing_for_status(
            workflow.STATUS_SUBMITTED_APPROVAL,
            configured_limit,
        ).next_role
        == "procurement_manager"
    )

    assert (
        workflow.request_routing_for_status(
            workflow.STATUS_SUBMITTED_APPROVAL,
            configured_limit + 0.01,
        ).next_role
        == "approver"
    )


def test_procurement_manager_has_scoped_low_value_authority_only():
    assert can_approve_low_value("Procurement Manager")
    assert "approve_low_value" in safe_role_permissions("Procurement Manager")
    assert not can_approve("Procurement Manager")
    assert "approve_request" not in safe_role_permissions("Procurement Manager")


def test_threshold_schema_and_logistics_demo_account_exist():
    init_db()
    assert "approval_mode" in table_columns("purchase_requests")
    assert "approval_mode" in table_columns("purchase_orders")
    assert "approval_mode" in table_columns("payments")
    logistics = df_query("SELECT username, role FROM users WHERE username='logistics'")
    assert not logistics.empty
    assert logistics.iloc[0]["role"] == "Logistics Officer"

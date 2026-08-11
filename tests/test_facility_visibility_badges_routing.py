from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLE_SOURCE = (ROOT / "modules" / "role_workspaces.py").read_text(encoding="utf-8")
UI_SOURCE = (ROOT / "core" / "ui.py").read_text(encoding="utf-8")


def _last_function_source(path: Path, function_name: str) -> str:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    matches = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name
    ]
    assert matches, f"Missing {function_name}"
    return ast.get_source_segment(source, matches[-1]) or ""


def test_pm_routing_validates_link_target_and_falls_back():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "get_pm_for_facility_manager")
    assert "JOIN users u ON u.id=fml.procurement_manager_user_id" in source
    assert "lower(trim(u.role))='procurement manager'" in source
    assert "COALESCE(CAST(fml.is_active AS BIGINT), 1) <> 0" in source
    assert "COALESCE(u.is_active, TRUE) IS TRUE" in source
    assert "lower(trim(role))='procurement manager'" in source
    assert "COALESCE(is_active, TRUE) IS TRUE" in source
    assert "A malformed/stale link must not suppress the role fallback" in source

    resolver = _last_function_source(ROOT / "modules" / "role_workspaces.py", "_resolve_active_procurement_manager")
    assert "WHERE id=?" in resolver
    assert "get_pm_for_facility_manager(facility_manager_user_id)" in resolver


def test_facility_send_uses_validated_manager_and_one_central_request_notification():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "facility_draft_register")
    assert "_resolve_active_procurement_manager" in source
    assert "ensure_thread" in source
    assert 'update_request_status(pr_id, "Sent for Procurement Review"' in source
    assert "The centralized request transition already creates the single" in source
    assert "Utility / Facility draft submitted" not in source
    assert 'action_label="Utility Head / Facility Head Inbox"' not in source


def test_new_facility_draft_restores_my_draft_navigation_badge():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "create_fm_draft_form")
    assert "Draft request created" in source
    assert 'action_label="My Draft Requests"' in source
    assert '["in_app"]' in source


def test_payee_owner_visibility_is_scoped_and_uses_readable_cards():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "_render_payee_bank_details")
    assert 'role == "Facility Manager"' in source
    assert "requested_by" in source
    assert "facility_manager_user_id" in source
    assert "owner_can_review" in source
    assert "pf-detail-field" in source
    assert "disabled=True" not in source
    assert "get_masked_payee_for_request" in source


def test_vendor_quotes_are_padded_as_separate_cards():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "_vendor_quote_management_panel")
    assert "with st.container(border=True):" in source
    assert "Each quotation is its own padded card" in source


def test_light_ui_has_visible_input_borders_focus_and_expander_padding():
    assert '[data-testid="stExpanderDetails"]' in UI_SOURCE
    assert "padding: .9rem 1rem 1.05rem" in UI_SOURCE
    assert "border: 1px solid #b8c6d8" in UI_SOURCE
    assert "0 0 0 3px rgba(23,105,232,.16)" in UI_SOURCE
    assert "-webkit-text-fill-color: #3f4d63" in UI_SOURCE
    assert ".pf-detail-field-value" in UI_SOURCE


def test_pm_link_query_remains_numeric_after_postgres_normalization():
    from core.db_backend import normalize_postgres_sql

    sql = """
        SELECT u.id
        FROM facility_manager_links fml
        JOIN users u ON u.id=fml.procurement_manager_user_id
        WHERE fml.facility_manager_user_id=?
          AND COALESCE(CAST(fml.is_active AS BIGINT), 1) <> 0
          AND lower(trim(u.role))='procurement manager'
          AND COALESCE(u.is_active, TRUE) IS TRUE
        ORDER BY fml.id DESC
        LIMIT 1
    """
    normalized = normalize_postgres_sql(sql)
    assert "COALESCE(CAST(fml.is_active AS BIGINT), 1) <> 0" in normalized
    assert "COALESCE(fml.is_active, TRUE)" not in normalized
    assert "COALESCE(u.is_active, TRUE) IS TRUE" in normalized


def test_pm_routing_falls_back_when_link_lookup_raises():
    import pandas as pd

    calls = []

    def fake_df_query(sql, params=()):
        calls.append((sql, tuple(params)))
        if "FROM facility_manager_links" in sql:
            raise RuntimeError("simulated stale link")
        if "FROM users" in sql:
            return pd.DataFrame([{"id": 2}])
        return pd.DataFrame()

    namespace = {
        "_table_exists_local": lambda table: table == "facility_manager_links",
        "df_query": fake_df_query,
    }
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "get_pm_for_facility_manager")
    exec(source, namespace)
    assert namespace["get_pm_for_facility_manager"](6) == 2
    assert len(calls) == 2

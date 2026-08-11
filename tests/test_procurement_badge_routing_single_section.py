from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app.py"
ROLE_PATH = ROOT / "modules" / "role_workspaces.py"


def _last_function_source(path: Path, function_name: str) -> str:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    matches = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    ]
    assert matches, f"Missing {function_name}"
    return ast.get_source_segment(source, matches[-1]) or ""


def test_facility_submission_does_not_create_second_inbox_badge_notification():
    source = _last_function_source(ROLE_PATH, "facility_draft_register")
    assert "Utility / Facility draft submitted" not in source
    assert 'action_label="Utility Head / Facility Head Inbox"' not in source
    assert 'update_request_status(pr_id, "Sent for Procurement Review"' in source


def test_generic_procurement_request_notification_routes_to_purchase_requests():
    source = _last_function_source(APP_PATH, "_infer_sidebar_section_from_notification")
    # Purchase request routing remains the single destination for the central
    # workflow notification generated when Facility submits a draft.
    assert 'if "purchase request" in text:' in source
    assert 'return first_existing("Purchase Requests")' in source


def test_procurement_index_one_badge_cannot_spill_into_indexes_ten_to_seventeen():
    source = _last_function_source(APP_PATH, "render_sidebar_navigation")
    assert "div[class~='st-key-{button_key}'] button" in source
    assert "div[class*='st-key-{button_key}'] button" not in source

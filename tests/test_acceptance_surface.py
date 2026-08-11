from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _last_function_source(path: Path, function_name: str) -> str:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    matches = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name]
    assert matches, f"Missing {function_name}"
    return ast.get_source_segment(source, matches[-1]) or ""


def test_purchase_request_sections_are_separate_blocks():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "requests_page")
    for label in ("Create Request", "View Requests", "Guided Next Actions", "Request Register", "Imported Draft Review"):
        assert label in source
    assert "_section_block_navigation" in source


def test_final_payee_interface_is_structured_not_raw_json():
    source = _last_function_source(ROOT / "modules" / "role_workspaces.py", "_render_payee_bank_details")
    assert "Payee & Bank Details" in source
    assert "Account number" in source
    assert "st.json(" not in source
    assert "get_full_payee_details" in source


def test_final_receipt_and_completion_surfaces_match_acceptance_rules():
    receipts = _last_function_source(ROOT / "modules" / "role_workspaces.py", "receipts_page")
    assert '["Proof of Payment", "Vendor Receipt"]' in receipts
    assert "file_uploader" in receipts
    assert "Manual receipt-only entries are disabled" in receipts
    assert "Replace / re-upload this document" in receipts
    assert "Document and OCR version history" in receipts
    completion = _last_function_source(ROOT / "modules" / "role_workspaces.py", "post_payment_closure_page")
    assert 'st.button("Mark Completed"' in completion
    for duplicate_button in ('st.button("Archive"', 'st.button("Close Record"', 'st.button("Mark Closed"'):
        assert duplicate_button not in completion


def test_exact_transfer_types_and_payment_pdf_are_exposed():
    workflow = (ROOT / "services" / "payment_workflow_service.py").read_text(encoding="utf-8")
    instruction = (ROOT / "services" / "payment_instruction_service.py").read_text(encoding="utf-8")
    assert "Internet Bank Transfer" in workflow
    assert "Physical Bank Transfer" in workflow
    assert "Approved Payment Instruction" in instruction
    assert "reportlab" in instruction


def test_theme_tokens_cover_light_dark_and_controls():
    source = (ROOT / "core" / "ui.py").read_text(encoding="utf-8")
    for token in ("--pf-bg", "--pf-surface", "--pf-text", "--pf-border", "--pf-brand"):
        assert token in source
    for selector in ("data-testid=\"stSidebar\"", "stDataFrame", "stFileUploader", "stTextInput", "data-baseweb=\"select\""):
        assert selector in source
    assert "color-scheme: light !important" in source
    assert "prefers-color-scheme: dark" not in source


def test_cloudsql_migration_and_cutover_delivery_files_exist():
    required = [
        "migrations/postgresql/001_initial_schema.sql",
        "migrations/postgresql/002_e2e_workflow_enhancements.sql",
        "migrations/postgresql/003_relationship_constraints.sql",
        "scripts/migrate_sqlite_to_postgres.py",
        "scripts/verify_database_migration.py",
        "scripts/backup_sqlite_for_migration.py",
        "scripts/migrate_document_storage.py",
        "scripts/rollback_database_cutover.py",
        "scripts/database_healthcheck.py",
        "docs/CLOUD_SQL_MIGRATION.md",
        "docs/CUTOVER_CHECKLIST.md",
        "docs/DATABASE_ROLLBACK.md",
        "deploy/deploy_cloud_run.sh",
    ]
    assert all((ROOT / name).is_file() for name in required)

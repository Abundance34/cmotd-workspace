from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

APP = ROOT / "app.py"

WORKSPACE = (
    ROOT
    / "modules"
    / "role_workspaces.py"
)

AUDITOR = (
    ROOT
    / "modules"
    / "auditor_control_centre.py"
)


def test_auditor_control_centre_sources_parse():

    for path in (
        APP,
        WORKSPACE,
        AUDITOR,
    ):

        ast.parse(
            path.read_text(
                encoding="utf-8"
            ),
            filename=str(
                path
            ),
        )


def test_auditor_sidebar_has_new_control_centre_pages():

    source = APP.read_text(
        encoding="utf-8"
    )

    for label in (
        "Role Activity Mirrors",
        "Transaction 360",
        "User 360",
        "Exception Centre",
    ):

        assert label in source


def test_existing_auditor_workspace_is_preserved():

    source = WORKSPACE.read_text(
        encoding="utf-8"
    )

    assert (
        "def _legacy_audit_workspace("
        in source
    )

    assert (
        "PROCUREFLOW AUDITOR CONTROL CENTRE V1"
        in source
    )


def test_control_centre_contains_no_operational_write_calls():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    forbidden_calls = (
        "run_query(",
        "run_insert(",
        "transition_request_status(",
        "transition_payment_status(",
        "transition_po_status(",
        "delete_procurement_draft(",
    )

    for token in forbidden_calls:

        assert token not in source


def test_control_centre_has_all_role_mirrors():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    for role in (
        "Admin",
        "Facility Manager",
        "Procurement Manager",
        "Approver",
        "Finance",
        "Logistics Officer",
        "Auditor",
    ):

        assert (
            f'"{role}"'
            in source
        )

def test_control_centre_imports_only_read_api_from_core_db():

    tree = ast.parse(
        AUDITOR.read_text(
            encoding="utf-8"
        )
    )

    imported = set()

    for node in ast.walk(tree):

        if (
            isinstance(
                node,
                ast.ImportFrom,
            )
            and node.module == "core.db"
        ):

            imported.update(
                alias.name
                for alias in node.names
            )

    assert imported == {
        "df_query",
    }


def test_auditor_rejects_non_whitelisted_tables():

    import modules.auditor_control_centre as auditor

    try:

        auditor._load_table(
            "users; DELETE FROM users"
        )

    except ValueError:
        pass

    else:

        raise AssertionError(
            "Auditor accepted a non-whitelisted table."
        )


def test_auditor_masks_sensitive_columns_and_embedded_values():

    import pandas as pd
    import modules.auditor_control_centre as auditor

    original = pd.DataFrame(
        [
            {
                "username":
                    "audit-user",

                "password_hash":
                    "do-not-show-this",

                "details":
                    (
                        'token="abc123" '
                        'account_number=1234567890 '
                        'status=reviewed'
                    ),

                "note":
                    "Normal audit note",
            }
        ]
    )

    masked = auditor._mask_sensitive(
        original
    )

    assert (
        masked.loc[
            0,
            "password_hash",
        ]
        == "[MASKED]"
    )

    details = str(
        masked.loc[
            0,
            "details",
        ]
    )

    assert "abc123" not in details
    assert "1234567890" not in details
    assert "[MASKED]" in details

    assert (
        masked.loc[
            0,
            "note",
        ]
        == "Normal audit note"
    )


def test_auditor_runtime_reads_do_not_mutate_database(
    monkeypatch,
):

    import sqlite3

    import pandas as pd
    import modules.auditor_control_centre as auditor

    conn = sqlite3.connect(
        ":memory:"
    )

    try:

        conn.execute(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT,
                role TEXT
            )
            """
        )

        conn.execute(
            """
            INSERT INTO users (
                username,
                role
            )
            VALUES (
                'auditor-fixture',
                'Auditor'
            )
            """
        )

        conn.commit()

        before_changes = conn.total_changes

        executed_sql = []

        def fake_df_query(
            sql,
            *args,
            **kwargs,
        ):

            executed_sql.append(
                str(sql)
            )

            return pd.read_sql_query(
                sql,
                conn,
            )

        monkeypatch.setattr(
            auditor,
            "df_query",
            fake_df_query,
        )

        result = auditor._load_table(
            "users",
            10,
        )

        after_changes = conn.total_changes

        assert len(result) == 1

        assert (
            before_changes
            == after_changes
        )

        assert executed_sql

        assert all(
            sql.lstrip()
            .upper()
            .startswith("SELECT ")
            for sql in executed_sql
        )

    finally:

        conn.close()

def test_auditor_v2_routes_all_sidebar_sections():

    workspace = WORKSPACE.read_text(
        encoding="utf-8"
    )

    assert (
        "PROCUREFLOW_AUDITOR_ROUTING_V2"
        in workspace
    )

    for label in (
        "Audit Dashboard",
        "Role Activity Mirrors",
        "Transaction 360",
        "User 360",
        "Exception Centre",
        "Approval Trails",
        "Procurement Records",
        "Delegated Approval Review",
        "Gateway Pass Audit",
        "Vendor History",
        "Budget Audit",
        "Facility / Utility Handoff Trail",
        "Expense Review",
        "Compliance Reports",
        "Income",
        "Settings",
    ):

        assert (
            f'"{label}"'
            in workspace
        )


def test_auditor_v2_has_missing_sidebar_schema_routes():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    for label in (
        "All Activity & Evidence Ledger",
        "Sourcing & Vendor Quote Audit",
        "Purchase Order & Logistics Evidence",
        "Receiving Slips, Proof of Delivery & Returns",
        "Finance, Invoice & Payment Audit",
        "Payment Payee / Bank Detail Access Audit",
        "Document Archive & Download Audit",
        "Notification Delivery Audit",
        "User & Security Audit",
    ):

        assert (
            f'"{label}"'
            in source
        )


def test_auditor_v2_event_window_starts_august_2026():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    assert (
        'AUDITOR_EVENT_WINDOW_START = '
        '"2026-08-01T00:00:00Z"'
        in source
    )

    assert (
        "_auditor_filter_event_window"
        in source
    )


def test_auditor_v2_approval_trails_are_request_linked():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    assert (
        "render_enhanced_approval_trails"
        in source
    )

    for label in (
        "Request No",
        "Request ID",
        "Department / Project",
        "Category",
        "Request Amount",
        "Current Request Status",
        "Requester",
    ):

        assert (
            f'"{label}"'
            in source
        )


def test_auditor_v2_schema_exports_have_excel_csv_pdf():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    for token in (
        "Excel (.xlsx)",
        "CSV (.csv)",
        "PDF (.pdf)",
        "_auditor_excel_bytes",
        "_auditor_pdf_bytes",
        "_auditor_schema_download",
    ):

        assert token in source

def test_auditor_v3_excel_handles_timezone_aware_values():

    import pandas as pd

    from modules import (
        auditor_control_centre as auditor,
    )

    frame = pd.DataFrame(
        {
            "created_at": [
                pd.Timestamp(
                    "2026-08-19T12:08:39Z"
                )
            ],
            "status": [
                "Approved"
            ],
        }
    )

    payload = auditor._auditor_excel_bytes(
        frame
    )

    assert isinstance(
        payload,
        bytes,
    )

    assert payload.startswith(
        b"PK"
    )


def test_auditor_v3_export_failure_is_contained():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    assert (
        "PROCUREFLOW_AUDITOR_EXPORT_BANK_REVEAL_V3"
        in source
    )

    assert (
        "_auditor_excel_safe_dataframe"
        in source
    )

    assert (
        "Could not prepare the {choice} export."
        in source
    )


def test_auditor_v3_bank_reveal_is_controlled_and_audited():

    source = AUDITOR.read_text(
        encoding="utf-8"
    )

    for token in (
        "audit_payee_reveal as _auditor_audit_payee_reveal",
        "decrypt_text as _auditor_decrypt_text",
        "Reveal Bank Details for 5 Minutes",
        "Reason for revealing bank details",
        "AUDITOR_BANK_REVEAL_SECONDS = 300",
        '"Account Name"',
        '"Bank Name"',
        '"Account Number"',
        "mask=False",
    ):

        assert token in source

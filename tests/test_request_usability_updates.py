from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

ROLE = (
    ROOT
    / "modules"
    / "role_workspaces.py"
).read_text(encoding="utf-8")

LEGACY = (
    ROOT
    / "core"
    / "legacy_import.py"
).read_text(encoding="utf-8")

OCR = (
    ROOT
    / "core"
    / "ocr.py"
).read_text(encoding="utf-8")


def test_request_categories_are_split():
    first_category_line = next(
        line
        for line in ROLE.splitlines()
        if line.startswith(
            "EXPENSE_CATEGORIES ="
        )
    )

    assert '"Diesel"' in first_category_line
    assert '"Fuel"' in first_category_line
    assert '"Diesel/Fuel"' not in first_category_line


def test_line_item_controls_are_below_rows():
    start = ROLE.index(
        "def _request_line_items("
    )

    end = ROLE.index(
        "\ndef _suggested_vendor_detail_inputs",
        start,
    )

    body = ROLE[start:end]

    loop_index = body.index(
        "for idx, row_id in enumerate(rows, 1):"
    )

    add_index = body.index(
        '"? Add line item"'
    )

    remove_index = body.index(
        '"? Remove line item"'
    )

    assert add_index > loop_index
    assert remove_index > loop_index


def test_procurement_has_delete_draft_tab():
    from pathlib import Path

    service = Path(
        "services/draft_request_service.py"
    ).read_text(
        encoding="utf-8"
    )

    assert (
        '("Delete Drafts", "?")'
        in ROLE
    )

    assert (
        "def _delete_duplicate_drafts_page"
        in ROLE
    )

    # The logical-delete mutation now belongs to the dedicated
    # atomic service rather than the Streamlit UI module.
    assert (
        "delete_procurement_draft("
        in ROLE
    )

    assert (
        "status='Deleted Draft'"
        in service
    )

    assert (
        "DRAFT_DELETED"
        in service
    )


def test_draft_delete_is_draft_only_and_audited():
    from pathlib import Path

    ui = Path(
        "modules/role_workspaces.py"
    ).read_text(
        encoding="utf-8"
    )

    service = Path(
        "services/draft_request_service.py"
    ).read_text(
        encoding="utf-8"
    )

    assert (
        "delete_procurement_draft("
        in ui
    )

    assert (
        "status='Draft'"
        in service
    )

    assert (
        "requested_by"
        in service
    )

    assert (
        "status='Deleted Draft'"
        in service
    )

    assert (
        "INSERT INTO workflow_events"
        in service
    )

    assert (
        "DRAFT_DELETED"
        in service
    )

    assert (
        "_append_audit_event_to_conn("
        in service
    )



def test_approved_download_surfaces_exist():
    assert (
        "def _approved_request_downloads_page"
        in ROLE
    )

    assert (
        "Download Selected Request PDF"
        in ROLE
    )

    assert (
        "Download Selected Request Excel"
        in ROLE
    )

    assert (
        "Download All Approved Requests Excel"
        in ROLE
    )

    assert (
        '_approved_request_downloads_page("facility")'
        in ROLE
    )


def test_import_center_accepts_required_formats():
    for extension in (
        '"zip"',
        '"docx"',
        '"pdf"',
        '"jpg"',
        '"jpeg"',
        '"png"',
        '"webp"',
        '"xlsx"',
        '"xls"',
    ):
        assert extension in ROLE


def test_direct_import_support_is_present():
    assert (
        "SUPPORTED_IMPORT_EXTENSIONS"
        in LEGACY
    )

    assert (
        "def import_uploaded_document"
        in LEGACY
    )

    assert (
        "def parse_import_file_bytes"
        in LEGACY
    )

    for extension in (
        '".docx"',
        '".pdf"',
        '".jpg"',
        '".jpeg"',
        '".png"',
        '".webp"',
        '".xlsx"',
        '".xls"',
    ):
        assert extension in LEGACY


def test_zip_import_no_longer_docx_only():
    assert (
        'if not filename.lower().endswith(".docx")'
        not in LEGACY
    )

    assert (
        "suffix not in SUPPORTED_IMPORT_EXTENSIONS"
        in LEGACY
    )


def test_new_import_classification_splits_fuel():
    assert (
        '"Diesel": ["diesel", "ago"]'
        in LEGACY
    )

    assert (
        '"Fuel": ["fuel", "petrol", "gasoline"]'
        in LEGACY
    )

    assert (
        '"Diesel": ["diesel", "ago"]'
        in OCR
    )

    assert (
        '"Fuel": ["fuel", "petrol", "gasoline"]'
        in OCR
    )


def test_historical_combined_category_is_not_globally_destroyed():
    # Historical Diesel/Fuel values may legitimately remain
    # elsewhere in the repository/database. The patch only
    # changes new-selection and new-classification surfaces.
    assert "Diesel/Fuel" not in next(
        line
        for line in ROLE.splitlines()
        if line.startswith(
            "EXPENSE_CATEGORIES ="
        )
    )


def test_deleted_drafts_are_hidden_from_normal_register():
    assert (
        "pr.status <> 'Deleted Draft'"
        in ROLE
    )


def test_fresh_install_diesel_and_fuel_seeds_are_split():
    db_source = (
        ROOT
        / "core"
        / "db.py"
    ).read_text(
        encoding="utf-8"
    )

    assert (
        '("ABC Diesel Supply", "Diesel",'
        in db_source
    )

    assert (
        '("Diesel", 250000, "Approver", 0, 1, 1, now_iso())'
        in db_source
    )

    assert (
        '("Fuel", 250000, "Approver", 0, 1, 1, now_iso())'
        in db_source
    )

    assert (
        '"ABC Diesel Supply", "Diesel/Fuel"'
        not in db_source
    )

    assert (
        '("Diesel/Fuel", 250000'
        not in db_source
    )


def test_deleted_draft_is_excluded_from_operational_metrics():
    assert (
        "status NOT IN ('Draft','FM Draft','Deleted Draft')"
        in ROLE
    )

    assert (
        "status NOT IN ('Rejected','Archived','Deleted Draft')"
        in ROLE
    )

    assert (
        "pr.status NOT IN ('Paid','Completed','Closed','Rejected','Deleted Draft')"
        in ROLE
    )


def test_draft_delete_has_one_canonical_user_audit_path():
    from pathlib import Path

    service = Path(
        "services/draft_request_service.py"
    ).read_text(
        encoding="utf-8"
    )

    assert (
        service.count(
            'action="DRAFT_DELETED"'
        )
        == 1
    )

    assert (
        "log_audit("
        not in service
    )

    assert (
        "add_workflow_event("
        not in service
    )

    assert (
        "_append_audit_event_to_conn("
        in service
    )


def test_amount_parser_preserves_full_monetary_values():
    from core.legacy_import import parse_amount

    cases = {
        "125": 125.0,
        "1250": 1250.0,
        "12500": 12500.0,
        "125000": 125000.0,
        "1,250": 1250.0,
        "12,500": 12500.0,
        "125,000": 125000.0,
        "2,000,000": 2000000.0,
        "1250.50": 1250.50,
        "125000.50": 125000.50,
        "NGN 75,000": 75000.0,
    }

    for raw, expected in cases.items():
        actual = parse_amount(raw)

        assert abs(
            actual - expected
        ) < 0.001, (
            raw,
            expected,
            actual,
        )


def test_extract_total_supports_common_procurement_labels():
    from core.legacy_import import extract_total

    cases = {
        "Total NGN 125,000": 125000.0,
        "Total NGN 75,000": 75000.0,
        "Total NGN 75000": 75000.0,
        "TOTAL: \u20A650,000.00": 50000.0,
        "Grand Total 25000": 25000.0,
        "Amount Payable: NGN 2,000,000": 2000000.0,
        "Total Amount: 125000.50": 125000.50,
        "Total Requisitioned Amount NGN 900,000": 900000.0,
        "Total Expenditure: 450000": 450000.0,
        "Total Allocated NGN 1,500,000": 1500000.0,
    }

    for text, expected in cases.items():
        actual = extract_total(
            text,
            [],
        )

        assert abs(
            actual - expected
        ) < 0.001, (
            text,
            expected,
            actual,
        )


def test_line_item_parser_preserves_full_prices_and_totals():
    from core.legacy_import import (
        extract_total,
        parse_line_items,
    )

    tables = [
        [
            [
                "Item",
                "Qty",
                "Unit Price",
                "Total",
            ],
            [
                "Diesel",
                "100",
                "1250",
                "125000",
            ],
        ],
    ]

    items = parse_line_items(
        tables,
        "Diesel",
    )

    assert len(items) == 1

    item = items[0]

    assert item["quantity"] == 100.0
    assert item["unit_price"] == 1250.0
    assert item["total_price"] == 125000.0

    assert extract_total(
        "",
        items,
    ) == 125000.0


def test_draft_delete_transaction_is_atomic_by_construction():
    from pathlib import Path

    service = Path(
        "services/draft_request_service.py"
    ).read_text(
        encoding="utf-8"
    )

    begin = service.index(
        'conn.execute(\n            "BEGIN IMMEDIATE"'
    )

    update = service.index(
        "UPDATE purchase_requests",
        begin,
    )

    workflow = service.index(
        "INSERT INTO workflow_events",
        update,
    )

    legacy_audit = service.index(
        "INSERT INTO audit_logs",
        workflow,
    )

    immutable = service.index(
        "_append_audit_event_to_conn(",
        legacy_audit,
    )

    commit = service.index(
        "conn.commit()",
        immutable,
    )

    assert (
        begin
        < update
        < workflow
        < legacy_audit
        < immutable
        < commit
    )

    assert (
        "conn.rollback()"
        in service
    )

    assert (
        "FOR UPDATE"
        in service
    )


def test_draft_delete_rolls_back_if_immutable_audit_fails():
    import sqlite3
    import tempfile
    from pathlib import Path

    import core.db as db
    import services.draft_request_service as service

    old_db_path = db.DB_PATH
    old_init = db._DB_INIT_DONE
    old_append = (
        service._append_audit_event_to_conn
    )

    try:
        with tempfile.TemporaryDirectory() as tmp:
            database = (
                Path(tmp)
                / "draft-delete-rollback.db"
            )

            raw = sqlite3.connect(
                database
            )

            raw.executescript(
                """
                CREATE TABLE purchase_requests (
                    id INTEGER PRIMARY KEY,
                    request_no TEXT,
                    status TEXT,
                    requested_by INTEGER,
                    estimated_amount REAL,
                    department_project TEXT,
                    category TEXT,
                    next_role TEXT,
                    updated_at TEXT
                );

                CREATE TABLE workflow_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT,
                    entity_id INTEGER,
                    event TEXT,
                    status TEXT,
                    note TEXT,
                    user_id INTEGER,
                    created_at TEXT
                );

                CREATE TABLE audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT,
                    entity_type TEXT,
                    entity_id TEXT,
                    user_id INTEGER,
                    details TEXT,
                    created_at TEXT
                );

                INSERT INTO purchase_requests (
                    id,
                    request_no,
                    status,
                    requested_by,
                    estimated_amount,
                    department_project,
                    category,
                    next_role,
                    updated_at
                )
                VALUES (
                    1,
                    'PR-ROLLBACK-001',
                    'Draft',
                    7,
                    125000,
                    'Operations',
                    'Diesel',
                    'Procurement Manager',
                    '2026-08-17T12:00:00'
                );
                """
            )

            raw.commit()
            raw.close()

            db.DB_PATH = database
            db._DB_INIT_DONE = True

            def fail_audit(
                *args,
                **kwargs,
            ):
                raise RuntimeError(
                    "forced immutable audit failure"
                )

            service._append_audit_event_to_conn = (
                fail_audit
            )

            failed = False

            try:
                service.delete_procurement_draft(
                    1,
                    actor_user_id=7,
                    actor_role="Procurement Manager",
                    reason="Duplicate request",
                )

            except RuntimeError as exc:
                assert (
                    "forced immutable audit failure"
                    in str(exc)
                )

                failed = True

            assert failed

            verify = sqlite3.connect(
                database
            )

            status = verify.execute(
                """
                SELECT status
                FROM purchase_requests
                WHERE id=1
                """
            ).fetchone()[0]

            workflow_count = verify.execute(
                """
                SELECT COUNT(*)
                FROM workflow_events
                """
            ).fetchone()[0]

            audit_count = verify.execute(
                """
                SELECT COUNT(*)
                FROM audit_logs
                """
            ).fetchone()[0]

            verify.close()

            assert status == "Draft"
            assert workflow_count == 0
            assert audit_count == 0

    finally:
        service._append_audit_event_to_conn = (
            old_append
        )

        db.DB_PATH = old_db_path
        db._DB_INIT_DONE = old_init


def test_import_security_routes_through_existing_service():
    from pathlib import Path

    importer = Path(
        "core/legacy_import.py"
    ).read_text(
        encoding="utf-8"
    )

    security = Path(
        "services/document_service.py"
    ).read_text(
        encoding="utf-8"
    )

    assert (
        "validate_upload_bytes("
        in importer
    )

    assert (
        "validate_zip_archive_bytes("
        in importer
    )

    assert (
        "scan_saved_upload("
        in importer
    )

    for extension in (
        ".webp",
        ".bmp",
        ".gif",
        ".tif",
        ".tiff",
        ".xls",
    ):
        assert extension in security


def test_document_security_accepts_new_import_signatures():
    from services.document_service import (
        validate_upload_bytes,
    )

    samples = {
        "sample.webp":
            b"RIFF"
            + b"\x10\x00\x00\x00"
            + b"WEBP"
            + b"VP8 ",

        "sample.bmp":
            b"BM"
            + b"\x00" * 20,

        "sample.gif":
            b"GIF89a"
            + b"\x00" * 20,

        "sample.tif":
            b"II*\x00"
            + b"\x00" * 20,

        "sample.tiff":
            b"MM\x00*"
            + b"\x00" * 20,

        "sample.xls":
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
            + b"\x00" * 32,
    }

    for name, payload in samples.items():
        clean_name, suffix = (
            validate_upload_bytes(
                name,
                payload,
            )
        )

        assert clean_name == name
        assert suffix == (
            Path(name).suffix.lower()
        )


def test_document_security_rejects_limits_and_unsafe_zip():
    from io import BytesIO
    import zipfile

    import services.document_service as security

    old_limit = (
        security.MAX_UPLOAD_MB
    )

    try:
        security.MAX_UPLOAD_MB = 1

        oversized = (
            b"\x89PNG\r\n\x1a\n"
            + b"0"
            * (
                1024
                * 1024
                + 1
            )
        )

        blocked = False

        try:
            security.validate_upload_bytes(
                "too-large.png",
                oversized,
            )

        except security.DocumentSecurityError:
            blocked = True

        assert blocked

    finally:
        security.MAX_UPLOAD_MB = (
            old_limit
        )

    output = BytesIO()

    with zipfile.ZipFile(
        output,
        "w",
    ) as archive:
        archive.writestr(
            "../unsafe.pdf",
            b"%PDF-1.4\n",
        )

    blocked = False

    try:
        security.validate_upload_bytes(
            "unsafe.zip",
            output.getvalue(),
        )

    except security.DocumentSecurityError:
        blocked = True

    assert blocked

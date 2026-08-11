from __future__ import annotations

from io import BytesIO
from pathlib import Path
import shutil

import pytest
from reportlab.pdfgen import canvas

import core.db as db
from services.approval_rescission_service import ApprovalRescissionError, rescind_request_approval
from services.completion_service import CompletionError, mark_request_completed
from services.payee_service import get_full_payee_details, save_payee_details, verify_payee_details
from services.payment_instruction_service import generate_payment_instruction_pdf, resolve_payment_instruction
from services.payment_workflow_service import PaymentWorkflowError, record_request_payment
from services.receipt_document_service import ReceiptDocumentError, correct_receipt_metadata, process_receipt_ocr, replace_receipt_document, upload_receipt_document
from services.vendor_quote_service import save_vendor_quote, select_vendor_quote


class Upload:
    def __init__(self, name: str, data: bytes, mime: str = "application/pdf"):
        self.name = name
        self._data = data
        self.type = mime

    def getvalue(self) -> bytes:
        return self._data


def _pdf(title: str, amount: float = 120000.0, reference: str = "TXN-E2E-001") -> bytes:
    buffer = BytesIO()
    doc = canvas.Canvas(buffer)
    doc.drawString(72, 760, title)
    doc.drawString(72, 735, "Vendor: Test Vendor Limited")
    doc.drawString(72, 710, f"Amount Paid: NGN {amount:,.2f}")
    doc.drawString(72, 685, f"Transaction Reference: {reference}")
    doc.drawString(72, 660, "Payment Date: 2026-07-24")
    doc.save()
    return buffer.getvalue()


@pytest.fixture()
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, seeded_database_template: Path):
    database = tmp_path / "procureflow.db"
    uploads = tmp_path / "uploads"
    backups = tmp_path / "backups"
    shutil.copy2(seeded_database_template, database)
    monkeypatch.setattr(db, "DB_PATH", database)
    monkeypatch.setattr(db, "ATTACHMENT_DIR", uploads)
    monkeypatch.setattr(db, "BACKUP_DIR", backups)
    monkeypatch.setattr(db, "_DB_INIT_DONE", True)
    import services.document_service as documents
    monkeypatch.setattr(documents, "ATTACHMENT_DIR", uploads)
    yield database


def _ids() -> dict[str, int]:
    return {str(r["role"]): int(r["id"]) for r in db.run_query("SELECT id, role FROM users", fetch=True)}


def _request_with_three_quotes() -> dict[str, int]:
    ids = _ids()
    request_id = db.run_insert(
        """INSERT INTO purchase_requests
           (request_no, requested_by, facility_manager_user_id, assigned_procurement_manager_id,
            department_project, request_date, required_date, category, justification, priority,
            estimated_amount, status, source_type, created_at, updated_at)
           VALUES ('E2E-PR-001', ?, ?, ?, 'Operations', '2026-07-24', '2026-07-30',
                   'ICT/Software', 'Representative E2E request', 'High', 120000, 'Draft',
                   'Utility Head / Facility Head', ?, ?)""",
        (ids["Facility Manager"], ids["Facility Manager"], ids["Procurement Manager"], db.now_iso(), db.now_iso()),
    )
    item_id = db.run_insert(
        "INSERT INTO purchase_request_items (request_id,item_name,description,quantity,unit_price,total,category,created_at) VALUES (?, 'Laptop', 'Laptop', 2, 60000, 120000, 'ICT/Software', ?)",
        (request_id, db.now_iso()),
    )
    save_payee_details(
        request_id,
        {
            "recipient_known": True,
            "payee_type": "Vendor",
            "payee_name": "Test Vendor Limited",
            "account_name": "Test Vendor Limited",
            "bank_name": "Test Bank",
            "account_number": "0123456789",
            "currency": "NGN",
            "payment_reference": "E2E",
            "confirmation": True,
        },
        ids["Facility Manager"],
        "Facility Manager",
    )
    quote_ids = []
    for index, price in enumerate((120000.0, 125000.0, 131000.0), start=1):
        quote_ids.append(
            save_vendor_quote(
                request_id,
                {
                    "name": f"Test Vendor {index}", "category": "ICT/Software",
                    "phone": f"0800000000{index}", "email": f"vendor{index}@example.invalid",
                    "address": "Test City", "rating": 4, "quoted_price": price,
                    "currency": "NGN", "quote_date": "2026-07-24", "notes": "Laptop supply",
                },
                ids["Procurement Manager"], "Procurement Manager",
                line_items=[{"request_item_id": item_id, "item_description": "Laptop", "quantity": 2, "unit_price": price / 2, "line_total": price}],
            )
        )
    return {"request_id": request_id, "item_id": item_id, "quote_1": quote_ids[0], "quote_2": quote_ids[1], "quote_3": quote_ids[2], **ids}


def _approve_request(context: dict[str, int]) -> int:
    request_id = context["request_id"]
    approver = context["Approver"]
    db.run_query(
        "UPDATE purchase_requests SET status='Approved', payment_status='Approved for Payment', approved_at=?, approved_by_user_id=?, approved_by_role='Approver', next_role='finance' WHERE id=?",
        (db.now_iso(), approver, request_id),
    )
    return db.run_insert(
        """INSERT INTO approval_history
           (entity_type,entity_id,action,status_before,status_after,reason,user_id,approved_by_user_id,approved_by_role,approval_mode,created_at)
           VALUES ('Purchase Request',?,'Approved','Pending Approval','Approved','E2E approval',?,?,'Approver','Normal',?)""",
        (request_id, approver, approver, db.now_iso()),
    )


def test_multiple_vendor_prices_remain_vendor_specific(isolated_db):
    context = _request_with_three_quotes()
    quotes = db.df_query(
        "SELECT id, vendor_name, quotation_total FROM vendor_quotes WHERE request_id=? ORDER BY id",
        (context["request_id"],),
    )
    assert quotes["quotation_total"].tolist() == [120000.0, 125000.0, 131000.0]
    selected = select_vendor_quote(context["request_id"], context["quote_2"], context["Procurement Manager"], "Procurement Manager")
    request = db.run_query("SELECT selected_vendor_quote_id, selected_vendor_id FROM purchase_requests WHERE id=?", (context["request_id"],), fetch=True)[0]
    assert int(request["selected_vendor_quote_id"]) == context["quote_2"]
    assert int(request["selected_vendor_id"]) == selected["vendor_id"]
    lines = db.df_query("SELECT vendor_quote_id, line_total FROM vendor_quote_items ORDER BY vendor_quote_id")
    assert lines["line_total"].tolist() == [120000.0, 125000.0, 131000.0]



def test_replaced_payee_details_reach_finance_and_keep_version_history(isolated_db):
    context = _request_with_three_quotes()
    replacement = save_payee_details(
        context["request_id"],
        {
            "recipient_known": True,
            "payee_type": "Vendor",
            "payee_name": "Test Vendor Limited",
            "account_name": "Test Vendor Payments",
            "bank_name": "Replacement Bank",
            "account_number": "9876543210",
            "currency": "NGN",
            "payment_reference": "E2E replacement",
            "confirmation": True,
        },
        context["Procurement Manager"],
        "Procurement Manager",
        reason="Vendor issued corrected bank confirmation",
    )
    select_vendor_quote(context["request_id"], context["quote_1"], context["Procurement Manager"], "Procurement Manager")
    _approve_request(context)
    verify_payee_details(context["request_id"], context["Finance"], "Finance")
    instruction = resolve_payment_instruction(actor_user_id=context["Finance"], actor_role="Finance", request_id=context["request_id"])
    assert instruction["account_number"] == "9876543210"
    assert instruction["bank_name"] == "Replacement Bank"
    versions = db.df_query(
        "SELECT action, reason FROM payment_payee_detail_versions WHERE payee_detail_id=? ORDER BY version_no",
        (replacement.payee_detail_id,),
    )
    assert len(versions) >= 3
    assert "Vendor issued corrected bank confirmation" in versions["reason"].fillna("").tolist()
    row = dict(db.run_query("SELECT replaced_at,replacement_reason FROM payment_payee_details WHERE id=?", (replacement.payee_detail_id,), fetch=True)[0])
    assert row["replaced_at"]
    assert row["replacement_reason"] == "Vendor issued corrected bank confirmation"

def test_rescind_before_payment_and_block_after_payment(isolated_db):
    context = _request_with_three_quotes()
    select_vendor_quote(context["request_id"], context["quote_1"], context["Procurement Manager"], "Procurement Manager")
    _approve_request(context)
    result = rescind_request_approval(context["request_id"], context["Approver"], "Approver", "Quote requires reconfirmation")
    assert result["status"] == "Pending Approval"
    approval_count = db.df_query("SELECT COUNT(*) c FROM approval_history WHERE entity_id=?", (context["request_id"],)).iloc[0]["c"]
    assert approval_count == 2
    _approve_request(context)
    verify_payee_details(context["request_id"], context["Finance"], "Finance")
    payment_id = record_request_payment(
        context["request_id"], context["Finance"], "Finance",
        transfer_type="Internet Bank Transfer", payment_reference="TXN-E2E-001", payment_date="2026-07-24",
    )
    assert payment_id > 0
    with pytest.raises(ApprovalRescissionError):
        rescind_request_approval(context["request_id"], context["Approver"], "Approver", "Attempt after payment")
    with pytest.raises(PaymentWorkflowError):
        record_request_payment(
            context["request_id"], context["Finance"], "Finance",
            transfer_type="Bank Transfer", payment_reference="INVALID", payment_date="2026-07-24",
        )


def test_payee_flows_to_finance_pdf_without_reentry(isolated_db):
    context = _request_with_three_quotes()
    select_vendor_quote(context["request_id"], context["quote_1"], context["Procurement Manager"], "Procurement Manager")
    _approve_request(context)
    verify_payee_details(context["request_id"], context["Finance"], "Finance")
    record_request_payment(
        context["request_id"], context["Finance"], "Finance",
        transfer_type="Physical Bank Transfer", payment_reference="TXN-E2E-001", payment_date="2026-07-24",
    )
    instruction = resolve_payment_instruction(actor_user_id=context["Finance"], actor_role="Finance", request_id=context["request_id"])
    assert instruction["account_number"] == "0123456789"
    assert instruction["bank_name"] == "Test Bank"
    assert instruction["transfer_type"] == "Physical Bank Transfer"
    assert instruction["currency"] == "NGN"
    assert generate_payment_instruction_pdf(instruction, "Finance Officer").startswith(b"%PDF")
    with pytest.raises(PermissionError):
        resolve_payment_instruction(actor_user_id=context["Auditor"], actor_role="Auditor", request_id=context["request_id"])


def test_receipts_require_files_process_once_and_complete_atomically(isolated_db):
    context = _request_with_three_quotes()
    select_vendor_quote(context["request_id"], context["quote_1"], context["Procurement Manager"], "Procurement Manager")
    _approve_request(context)
    verify_payee_details(context["request_id"], context["Finance"], "Finance")
    payment_id = record_request_payment(
        context["request_id"], context["Finance"], "Finance",
        transfer_type="Internet Bank Transfer", payment_reference="TXN-E2E-001", payment_date="2026-07-24",
    )
    with pytest.raises(ReceiptDocumentError):
        upload_receipt_document(None, "Proof of Payment", context["Finance"], "Finance", request_id=context["request_id"], payment_id=payment_id)
    with pytest.raises(ReceiptDocumentError):
        upload_receipt_document(
            Upload("wrong_request.pdf", _pdf("Wrong request")), "Proof of Payment",
            context["Finance"], "Finance", request_id=context["request_id"] + 999, payment_id=payment_id,
        )
    with pytest.raises(CompletionError):
        mark_request_completed(context["request_id"], context["Procurement Manager"], "Procurement Manager")
    receipt_ids = []
    for category in ("Proof of Payment", "Vendor Receipt"):
        receipt_ids.append(
            upload_receipt_document(
                Upload(category.replace(" ", "_") + ".pdf", _pdf(category)), category,
                context["Finance"], "Finance", request_id=context["request_id"], payment_id=payment_id,
            )
        )
    payment_links = dict(db.run_query(
        "SELECT proof_path, proof_of_payment_receipt_id, vendor_receipt_id, receipt_id FROM payments WHERE id=?",
        (payment_id,), fetch=True,
    )[0])
    assert int(payment_links["proof_of_payment_receipt_id"]) == receipt_ids[0]
    assert int(payment_links["vendor_receipt_id"]) == receipt_ids[1]
    assert int(payment_links["receipt_id"]) == receipt_ids[1]
    assert "Proof_of_Payment" in str(payment_links["proof_path"])
    attempts_before = int(db.df_query("SELECT COUNT(*) c FROM document_ocr_attempts WHERE entity_id=?", (receipt_ids[0],)).iloc[0]["c"])
    process_receipt_ocr(receipt_ids[0], actor_user_id=context["Finance"], actor_role="Finance")
    attempts_after = int(db.df_query("SELECT COUNT(*) c FROM document_ocr_attempts WHERE entity_id=?", (receipt_ids[0],)).iloc[0]["c"])
    assert attempts_after == attempts_before
    correct_receipt_metadata(
        receipt_ids[0], {"extracted_amount": 120000.0, "extracted_transaction_reference": "TXN-E2E-001"},
        context["Finance"], "Finance", "Verified against bank proof",
    )
    replacement_version = replace_receipt_document(
        receipt_ids[1], Upload("Vendor_Receipt_Corrected.pdf", _pdf("Corrected Vendor Receipt")),
        context["Finance"], "Finance", "Vendor supplied a corrected receipt", process_ocr=True,
    )
    assert replacement_version == 2
    versions = db.df_query(
        "SELECT version_no, action, ocr_status, original_ocr_json FROM receipt_document_versions WHERE receipt_id=? ORDER BY version_no",
        (receipt_ids[1],),
    )
    assert list(versions["version_no"]) == [1, 2]
    assert versions.iloc[0]["original_ocr_json"]
    assert versions.iloc[1]["action"] == "Replaced"
    replacement_audit = db.df_query(
        "SELECT id FROM audit_events WHERE action='RECEIPT_DOCUMENT_REPLACED' AND entity_id=?",
        (str(receipt_ids[1]),),
    )
    assert not replacement_audit.empty
    result = mark_request_completed(context["request_id"], context["Procurement Manager"], "Procurement Manager")
    assert result["status"] == "Completed"
    request = db.run_query("SELECT status, completed_at, archived_at, next_role FROM purchase_requests WHERE id=?", (context["request_id"],), fetch=True)[0]
    assert request["status"] == "Completed"
    assert request["completed_at"] and request["archived_at"]
    assert request["next_role"] is None


def test_notification_chain_is_deduplicated(isolated_db):
    context = _request_with_three_quotes()
    select_vendor_quote(context["request_id"], context["quote_1"], context["Procurement Manager"], "Procurement Manager")
    _approve_request(context)
    verify_payee_details(context["request_id"], context["Finance"], "Finance")
    kwargs = dict(transfer_type="Internet Bank Transfer", payment_reference="TXN-E2E-001", payment_date="2026-07-24")
    first = record_request_payment(context["request_id"], context["Finance"], "Finance", **kwargs)
    second = record_request_payment(context["request_id"], context["Finance"], "Finance", **kwargs)
    assert first == second
    duplicates = db.df_query(
        "SELECT user_id, COUNT(*) c FROM notifications WHERE dedupe_key LIKE ? GROUP BY user_id HAVING COUNT(*)>1",
        (f"payment-recorded:{context['request_id']}:TXN-E2E-001:%",),
    )
    assert duplicates.empty
    delivered = db.df_query(
        """SELECT DISTINCT u.role, n.message FROM notifications n
           JOIN users u ON u.id=n.user_id
           WHERE n.dedupe_key LIKE ?""",
        (f"payment-recorded:{context['request_id']}:TXN-E2E-001:%",),
    )
    assert {"Facility Manager", "Procurement Manager", "Approver", "Finance", "Admin"}.issubset(set(delivered["role"]))
    assert not delivered["message"].fillna("").str.contains("0123456789", regex=False).any()

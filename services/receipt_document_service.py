"""File-backed Proof of Payment and Vendor Receipt workflow with persisted OCR."""
from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any

from core.db import _append_audit_event_to_conn, get_conn, insert_and_get_id, json_dump, make_ref, now_iso, run_query
from core.ocr import extract_text, parse_ocr_text
from services.document_service import DocumentSecurityError, secure_save_upload

DOCUMENT_CATEGORIES = ("Proof of Payment", "Vendor Receipt")
OCR_STATUSES = ("Pending", "Processing", "Extracted", "Review Required", "Verified", "Failed")


class ReceiptDocumentError(RuntimeError):
    pass


def _confidence(parsed: dict[str, Any]) -> float:
    values = [float(v or 0) for v in (parsed.get("confidence") or {}).values()]
    return round(sum(values) / len(values), 4) if values else 0.0


def _field(parsed: dict[str, Any], name: str, default: Any = None) -> Any:
    return (parsed.get("fields") or {}).get(name, default)


def _compare_discrepancies(request_id: int | None, payment_id: int | None, parsed: dict[str, Any]) -> tuple[str, list[str]]:
    issues: list[str] = []
    request = None
    if request_id:
        rows = run_query(
            """SELECT pr.request_no, pr.estimated_amount, pr.selected_vendor_id, v.name vendor_name,
                      vq.quotation_total, p.amount payment_amount, p.payment_reference, p.payment_date
               FROM purchase_requests pr
               LEFT JOIN vendors v ON v.id=pr.selected_vendor_id
               LEFT JOIN vendor_quotes vq ON vq.id=pr.selected_vendor_quote_id
               LEFT JOIN payments p ON p.id=? OR (p.request_id=pr.id AND ? IS NULL)
               WHERE pr.id=? ORDER BY p.id DESC LIMIT 1""",
            (payment_id, payment_id, int(request_id)), fetch=True,
        )
        request = dict(rows[0]) if rows else None
    if request:
        extracted_amount = float(_field(parsed, "total_amount", 0) or 0)
        expected = float(request.get("payment_amount") or request.get("quotation_total") or request.get("estimated_amount") or 0)
        if extracted_amount and expected and abs(extracted_amount - expected) > max(1.0, expected * 0.01):
            issues.append(f"Extracted amount differs from the approved/payment amount ({expected:,.2f}).")
        vendor_guess = str(_field(parsed, "matched_vendor_name") or _field(parsed, "vendor_guess") or "").lower()
        expected_vendor = str(request.get("vendor_name") or "").lower()
        if vendor_guess and expected_vendor and vendor_guess not in expected_vendor and expected_vendor not in vendor_guess:
            issues.append("Extracted vendor/payee differs from the selected vendor.")
        extracted_ref = str(_field(parsed, "receipt_no") or (parsed.get("bank_details") or {}).get("transfer_reference") or "")
        expected_ref = str(request.get("payment_reference") or "")
        if extracted_ref and expected_ref and extracted_ref.lower() != expected_ref.lower():
            issues.append("Extracted transaction reference differs from the payment reference.")
    confidence = _confidence(parsed)
    if confidence < 0.60:
        issues.append("One or more OCR fields have low confidence and require human review.")
    return ("Discrepancy" if issues else "No Discrepancy", issues)


def upload_receipt_document(
    uploaded_file: Any,
    document_category: str,
    actor_user_id: int,
    actor_role: str,
    *,
    request_id: int | None = None,
    payment_id: int | None = None,
    process_ocr: bool = True,
) -> int:
    if actor_role not in {"Finance", "Procurement Manager", "Admin"}:
        raise PermissionError(
            "Only Finance, Procurement Manager, and Admin may upload payment documents."
        )
    if document_category not in DOCUMENT_CATEGORIES:
        raise ReceiptDocumentError("Choose Proof of Payment or Vendor Receipt.")
    if uploaded_file is None:
        raise ReceiptDocumentError("An uploaded document is required.")
    if not payment_id:
        raise ReceiptDocumentError("A paid payment record is required before uploading payment documents.")
    suffix = Path(getattr(uploaded_file, "name", "")).suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise ReceiptDocumentError("Only PDF, PNG, JPG, and JPEG documents are accepted.")
    path, checksum = secure_save_upload(uploaded_file, "receipts")
    if not path or not checksum:
        raise ReceiptDocumentError("The document could not be saved.")
    duplicate = run_query(
        "SELECT id FROM receipt_records WHERE file_checksum=? AND document_category=? AND COALESCE(request_id,-1)=COALESCE(?, -1) LIMIT 1",
        (checksum, document_category, request_id), fetch=True,
    )
    if duplicate:
        raise ReceiptDocumentError("This document has already been uploaded for the request.")
    file_bytes = uploaded_file.getvalue()
    mime_type = getattr(uploaded_file, "type", None) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    rows = run_query(
        "SELECT request_id, payment_method, transfer_type, payment_date, amount, vendor_id, payment_reference, status FROM payments WHERE id=?",
        (int(payment_id),), fetch=True,
    )
    if not rows:
        raise ReceiptDocumentError("The linked payment record was not found.")
    payment_context = dict(rows[0])
    if str(payment_context.get("status") or "") != "Paid":
        raise ReceiptDocumentError("Payment documents may be uploaded only after Finance records payment.")
    linked_request_id = int(payment_context.get("request_id") or 0)
    if not linked_request_id:
        raise ReceiptDocumentError("The payment is not linked to a procurement request.")
    if request_id is not None and int(request_id) != linked_request_id:
        raise ReceiptDocumentError("The payment does not belong to the selected procurement request.")
    request_id = linked_request_id
    payment_method = str(payment_context.get("payment_method") or "Bank Transfer")
    payment_date = str(payment_context.get("payment_date") or now_iso()[:10])
    amount = float(payment_context.get("amount") or 0)
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        receipt_id = insert_and_get_id(
            conn,
            """INSERT INTO receipt_records (
                 receipt_no, receipt_type, document_category, request_id, payment_id, linked_payment_id,
                 payment_method, payment_date, amount, vendor_id, transfer_reference,
                 status, ocr_status, original_file_name, file_path, file_hash, file_checksum, file_size_bytes,
                 mime_type, uploaded_by, created_at, updated_at, processing_started_at, duplicate_warning
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded', 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)""",
            (make_ref("RCT"), document_category, document_category, request_id, payment_id, payment_id,
             payment_method, payment_date, amount, payment_context.get("vendor_id"), payment_context.get("payment_reference"),
             Path(getattr(uploaded_file, "name", "document")).name, path, checksum, checksum, len(file_bytes), mime_type,
             int(actor_user_id), now_iso(), now_iso()),
        )
        conn.execute(
            """INSERT INTO receipt_document_versions (receipt_id, version_no, action, file_path, file_checksum,
               original_file_name, uploaded_by_user_id, file_size_bytes, mime_type, reason, created_at)
               VALUES (?, 1, 'Uploaded', ?, ?, ?, ?, ?, ?, 'Initial upload', ?)""",
            (receipt_id, path, checksum, Path(getattr(uploaded_file, "name", "document")).name, int(actor_user_id), len(file_bytes), mime_type, now_iso()),
        )
        _append_audit_event_to_conn(
            conn, action="RECEIPT_DOCUMENT_UPLOADED", entity_type="Receipt", entity_id=receipt_id,
            parent_entity_type="Purchase Request", parent_entity_id=request_id, user_id=actor_user_id, role=actor_role,
            details={"document_category": document_category, "mime_type": mime_type, "file_size_bytes": len(file_bytes), "checksum": checksum},
            source="receipt_document_service",
        )
        if payment_id:
            if document_category == "Proof of Payment":
                conn.execute(
                    "UPDATE payments SET proof_path=?, proof_of_payment_receipt_id=?, updated_at=? WHERE id=?",
                    (path, receipt_id, now_iso(), int(payment_id)),
                )
            else:
                # Keep receipt_id as the legacy vendor-receipt alias while
                # exposing an explicit category relationship for new code.
                conn.execute(
                    "UPDATE payments SET vendor_receipt_id=?, receipt_id=?, updated_at=? WHERE id=?",
                    (receipt_id, receipt_id, now_iso(), int(payment_id)),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    if process_ocr:
        process_receipt_ocr(receipt_id, uploaded_file=uploaded_file, actor_user_id=actor_user_id, actor_role=actor_role)
    return receipt_id


def replace_receipt_document(
    receipt_id: int,
    uploaded_file: Any,
    actor_user_id: int,
    actor_role: str,
    reason: str,
    *,
    process_ocr: bool = True,
) -> int:
    """Replace a receipt file without destroying the prior file/OCR version."""
    if actor_role not in {"Finance", "Admin"}:
        raise PermissionError("Only Finance and Admin may replace payment documents.")
    reason = str(reason or "").strip()
    if not reason:
        raise ReceiptDocumentError("A replacement reason is required.")
    if uploaded_file is None:
        raise ReceiptDocumentError("A replacement document is required.")
    suffix = Path(getattr(uploaded_file, "name", "")).suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise ReceiptDocumentError("Only PDF, PNG, JPG, and JPEG documents are accepted.")

    current_rows = run_query("SELECT * FROM receipt_records WHERE id=?", (int(receipt_id),), fetch=True)
    if not current_rows:
        raise ReceiptDocumentError("Receipt document not found.")
    current = dict(current_rows[0])
    path, checksum = secure_save_upload(uploaded_file, "receipts")
    if not path or not checksum:
        raise ReceiptDocumentError("The replacement document could not be saved.")
    if checksum == str(current.get("file_checksum") or current.get("file_hash") or ""):
        raise ReceiptDocumentError("The replacement document is identical to the current file.")
    duplicate = run_query(
        "SELECT id FROM receipt_records WHERE id<>? AND file_checksum=? AND document_category=? AND COALESCE(request_id,-1)=COALESCE(?, -1) LIMIT 1",
        (int(receipt_id), checksum, current.get("document_category"), current.get("request_id")), fetch=True,
    )
    if duplicate:
        raise ReceiptDocumentError("This document is already attached to the request.")

    file_bytes = uploaded_file.getvalue()
    mime_type = getattr(uploaded_file, "type", None) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        latest = conn.execute(
            "SELECT id, version_no FROM receipt_document_versions WHERE receipt_id=? ORDER BY version_no DESC LIMIT 1",
            (int(receipt_id),),
        ).fetchone()
        if latest:
            conn.execute(
                """UPDATE receipt_document_versions SET ocr_status=?, original_ocr_json=?, corrected_ocr_json=? WHERE id=?""",
                (current.get("ocr_status"), current.get("original_ocr_json") or current.get("ocr_json"), current.get("corrected_ocr_json"), int(latest["id"])),
            )
            version_no = int(latest["version_no"]) + 1
        else:
            version_no = 1
        conn.execute(
            """INSERT INTO receipt_document_versions (receipt_id, version_no, action, file_path, file_checksum,
               original_file_name, uploaded_by_user_id, file_size_bytes, mime_type, reason, ocr_status, created_at)
               VALUES (?, ?, 'Replaced', ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)""",
            (int(receipt_id), version_no, path, checksum, Path(getattr(uploaded_file, "name", "document")).name,
             int(actor_user_id), len(file_bytes), mime_type, reason, now_iso()),
        )
        conn.execute(
            """UPDATE receipt_records SET original_file_name=?, file_path=?, file_hash=?, file_checksum=?,
               file_size_bytes=?, mime_type=?, status='Uploaded', ocr_status='Pending', ocr_confidence=NULL,
               ocr_text=NULL, ocr_json=NULL, original_ocr_json=NULL, corrected_ocr_json=NULL, discrepancy_status='Not Checked',
               discrepancy_details=NULL, processing_started_at=NULL, processing_completed_at=NULL, retry_count=0,
               corrected_by_user_id=NULL, corrected_at=NULL, updated_at=? WHERE id=?""",
            (Path(getattr(uploaded_file, "name", "document")).name, path, checksum, checksum, len(file_bytes), mime_type, now_iso(), int(receipt_id)),
        )
        if current.get("payment_id") and current.get("document_category") == "Proof of Payment":
            conn.execute(
                "UPDATE payments SET proof_path=?, proof_of_payment_receipt_id=?, updated_at=? WHERE id=?",
                (path, int(receipt_id), now_iso(), int(current["payment_id"])),
            )
        elif current.get("payment_id") and current.get("document_category") == "Vendor Receipt":
            conn.execute(
                "UPDATE payments SET vendor_receipt_id=?, receipt_id=?, updated_at=? WHERE id=?",
                (int(receipt_id), int(receipt_id), now_iso(), int(current["payment_id"])),
            )
        _append_audit_event_to_conn(
            conn, action="RECEIPT_DOCUMENT_REPLACED", entity_type="Receipt", entity_id=int(receipt_id),
            parent_entity_type="Purchase Request", parent_entity_id=current.get("request_id"),
            user_id=actor_user_id, role=actor_role,
            before_values={"file_checksum": current.get("file_checksum"), "file_path": current.get("file_path"), "ocr_status": current.get("ocr_status")},
            after_values={"file_checksum": checksum, "file_path": path, "ocr_status": "Pending", "version_no": version_no},
            source="receipt_document_service", reason_or_comment=reason,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    if process_ocr:
        process_receipt_ocr(int(receipt_id), uploaded_file=uploaded_file, actor_user_id=actor_user_id, actor_role=actor_role, force=True)
    return version_no


def process_receipt_ocr(receipt_id: int, *, uploaded_file: Any | None = None, actor_user_id: int | None = None, actor_role: str = "System", force: bool = False) -> dict[str, Any]:
    rows = run_query("SELECT * FROM receipt_records WHERE id=?", (int(receipt_id),), fetch=True)
    if not rows:
        raise ReceiptDocumentError("Receipt document not found.")
    record = dict(rows[0])
    current_status = str(record.get("ocr_status") or "Pending")
    if not force and current_status in {"Extracted", "Review Required", "Verified"} and record.get("ocr_json"):
        try:
            return json.loads(record["ocr_json"])
        except Exception:
            return {"fields": {}, "warnings": ["Stored OCR result could not be decoded."]}
    if uploaded_file is None:
        path = Path(str(record.get("file_path") or ""))
        if not path.is_file():
            raise ReceiptDocumentError("The original receipt file is unavailable.")
        class _StoredUpload:
            name = path.name
            type = record.get("mime_type")
            def getvalue(self):
                return path.read_bytes()
        uploaded_file = _StoredUpload()
    run_query("UPDATE receipt_records SET ocr_status='Processing', processing_started_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), int(receipt_id)))
    text, meta, error = extract_text(uploaded_file)
    if error and not text:
        run_query(
            "UPDATE receipt_records SET ocr_status='Failed', retry_count=COALESCE(retry_count,0)+1, processing_completed_at=?, updated_at=?, discrepancy_details=? WHERE id=?",
            (now_iso(), now_iso(), error, int(receipt_id)),
        )
        run_query(
            "INSERT INTO document_ocr_attempts (document_type, entity_id, file_hash, engine, success, extracted_chars, error_message, created_at) VALUES ('Receipt', ?, ?, ?, 0, 0, ?, ?)",
            (int(receipt_id), record.get("file_checksum") or record.get("file_hash"), meta.get("engine") or meta.get("ocr_engine"), error, now_iso()),
        )
        run_query(
            "UPDATE receipt_document_versions SET ocr_status='Failed' WHERE id=(SELECT id FROM receipt_document_versions WHERE receipt_id=? ORDER BY version_no DESC LIMIT 1)",
            (int(receipt_id),),
        )
        return {"fields": {}, "warnings": [error], "status": "Failed"}
    vendors = None
    try:
        import pandas as pd
        rows_v = run_query("SELECT id, name FROM vendors WHERE status='Active' ORDER BY name", fetch=True)
        vendors = pd.DataFrame([dict(r) for r in rows_v])
    except Exception:
        vendors = None
    parsed = parse_ocr_text(text, vendors)
    parsed["file_metadata"] = meta
    conf = _confidence(parsed)
    discrepancy_status, issues = _compare_discrepancies(record.get("request_id"), record.get("payment_id") or record.get("linked_payment_id"), parsed)
    parsed.setdefault("warnings", []).extend(issues)
    status = "Review Required" if issues or conf < 0.60 else "Extracted"
    fields = parsed.get("fields") or {}
    bank = parsed.get("bank_details") or {}
    receipt_details = parsed.get("receipt_details") or {}
    vendor_name = fields.get("matched_vendor_name") or fields.get("vendor_guess")
    transaction_ref = bank.get("transfer_reference") or fields.get("receipt_no") or receipt_details.get("rrn")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """UPDATE receipt_records SET ocr_status=?, ocr_text=?, ocr_json=?, original_ocr_json=COALESCE(original_ocr_json, ?),
               ocr_confidence=?, detected_document_type=?, extracted_vendor_payee=?, extracted_amount=?, extracted_currency=?,
               extracted_transaction_reference=?, extracted_document_number=?, ocr_detected_date=?, extracted_tax_amount=?,
               extracted_total_amount=?, extracted_description=?, extracted_bank_name=?, extracted_account_name=?,
               discrepancy_status=?, discrepancy_details=?, processing_completed_at=?, updated_at=? WHERE id=?""",
            (status, text, json_dump(parsed), json_dump(parsed), conf, fields.get("document_type"), vendor_name,
             fields.get("total_amount"), fields.get("currency") or "NGN", transaction_ref,
             fields.get("receipt_no") or fields.get("invoice_no"), fields.get("date"), fields.get("tax_amount"),
             fields.get("total_amount"), fields.get("description"), bank.get("bank_name"), bank.get("account_name"),
             discrepancy_status, "\n".join(issues), now_iso(), now_iso(), int(receipt_id)),
        )
        conn.execute(
            """UPDATE receipt_records SET extracted_payment_time=?, extracted_payer=?, extracted_payee=? WHERE id=?""",
            (fields.get("payment_time"), fields.get("payer"), fields.get("payee"), int(receipt_id)),
        )
        latest_version = conn.execute(
            "SELECT id FROM receipt_document_versions WHERE receipt_id=? ORDER BY version_no DESC LIMIT 1",
            (int(receipt_id),),
        ).fetchone()
        if latest_version:
            conn.execute(
                "UPDATE receipt_document_versions SET ocr_status=?, original_ocr_json=? WHERE id=?",
                (status, json_dump(parsed), int(latest_version["id"])),
            )
        conn.execute(
            "INSERT INTO document_ocr_attempts (document_type, entity_id, file_hash, engine, success, extracted_chars, error_message, created_at) VALUES ('Receipt', ?, ?, ?, 1, ?, NULL, ?)",
            (int(receipt_id), record.get("file_checksum") or record.get("file_hash"), meta.get("engine") or meta.get("ocr_engine"), len(text), now_iso()),
        )
        _append_audit_event_to_conn(
            conn, action="RECEIPT_OCR_PROCESSED", entity_type="Receipt", entity_id=int(receipt_id),
            parent_entity_type="Purchase Request", parent_entity_id=record.get("request_id"), user_id=actor_user_id,
            role=actor_role, details={"ocr_status": status, "confidence": conf, "discrepancy_count": len(issues)},
            source="receipt_document_service",
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    parsed["status"] = status
    return parsed


def correct_receipt_metadata(receipt_id: int, corrections: dict[str, Any], actor_user_id: int, actor_role: str, reason: str) -> None:
    if actor_role not in {"Finance", "Admin"}:
        raise PermissionError("Only Finance and Admin may correct OCR metadata.")
    if not str(reason or "").strip():
        raise ReceiptDocumentError("A correction reason is required.")
    allowed = {
        "extracted_vendor_payee", "extracted_amount", "extracted_currency", "extracted_transaction_reference",
        "extracted_document_number", "ocr_detected_date", "extracted_tax_amount", "extracted_total_amount",
        "extracted_description", "extracted_bank_name", "extracted_account_name", "extracted_payer", "extracted_payee",
        "extracted_payment_time",
    }
    clean = {key: value for key, value in corrections.items() if key in allowed}
    if not clean:
        raise ReceiptDocumentError("No supported metadata corrections were supplied.")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        before = conn.execute("SELECT * FROM receipt_records WHERE id=?", (int(receipt_id),)).fetchone()
        if not before:
            raise ReceiptDocumentError("Receipt document not found.")
        assignments = ", ".join(f"{key}=?" for key in clean)
        conn.execute(
            f"UPDATE receipt_records SET {assignments}, corrected_ocr_json=?, corrected_by_user_id=?, corrected_at=?, ocr_status='Verified', updated_at=? WHERE id=?",
            tuple(clean.values()) + (json_dump(clean), int(actor_user_id), now_iso(), now_iso(), int(receipt_id)),
        )
        latest_version = conn.execute(
            "SELECT id FROM receipt_document_versions WHERE receipt_id=? ORDER BY version_no DESC LIMIT 1",
            (int(receipt_id),),
        ).fetchone()
        if latest_version:
            conn.execute(
                "UPDATE receipt_document_versions SET ocr_status='Verified', corrected_ocr_json=? WHERE id=?",
                (json_dump(clean), int(latest_version["id"])),
            )
        _append_audit_event_to_conn(
            conn, action="RECEIPT_OCR_CORRECTED", entity_type="Receipt", entity_id=int(receipt_id),
            user_id=actor_user_id, role=actor_role,
            before_values={key: dict(before).get(key) for key in clean}, after_values=clean,
            source="receipt_document_service", reason_or_comment=reason,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

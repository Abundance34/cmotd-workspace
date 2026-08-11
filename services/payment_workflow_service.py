"""End-to-end Finance payment recording with linked vendor/payee and deduplicated notifications."""
from __future__ import annotations

from typing import Any

from core.db import _append_audit_event_to_conn, create_notification, get_conn, insert_and_get_id, make_ref, now_iso
from services.payment_instruction_service import TRANSFER_TYPES
from services.workflow_participant_service import request_participant_user_ids


class PaymentWorkflowError(RuntimeError):
    pass


def record_request_payment(
    request_id: int,
    actor_user_id: int,
    actor_role: str,
    *,
    transfer_type: str,
    payment_reference: str,
    payment_date: str,
    finance_note: str = "",
    payment_id: int | None = None,
) -> int:
    if actor_role not in {"Finance", "Admin"}:
        raise PermissionError("Only Finance and Admin may record payment.")
    if transfer_type not in TRANSFER_TYPES:
        raise PaymentWorkflowError("Transfer type must be Internet Bank Transfer or Physical Bank Transfer.")
    payment_reference = str(payment_reference or "").strip()
    if not payment_reference:
        raise PaymentWorkflowError("A payment reference is required for reconciliation.")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM purchase_requests WHERE id=?", (int(request_id),)).fetchone()
        if not row:
            raise PaymentWorkflowError("Purchase request not found.")
        pr = dict(row)
        if str(pr.get("status") or "") not in {"Approved", "Awaiting Payment", "Approved for Payment", "Payment Approved"}:
            if str(pr.get("payment_status") or "") == "Paid" or pr.get("paid_at"):
                existing = conn.execute("SELECT id FROM payments WHERE request_id=? AND status='Paid' ORDER BY id DESC LIMIT 1", (int(request_id),)).fetchone()
                if existing:
                    conn.commit()
                    return int(existing["id"])
            raise PaymentWorkflowError("Only an approved request can be paid.")
        if pr.get("approval_rescinded_at") and str(pr.get("status")) != "Approved":
            raise PaymentWorkflowError("Finance cannot pay a request while its approval is rescinded.")
        payee_id = pr.get("selected_payee_detail_id")
        if not payee_id:
            payee_row = conn.execute(
                "SELECT id, vendor_id, currency, verification_status, payment_readiness_status FROM payment_payee_details WHERE purchase_request_id=? AND COALESCE(is_current,1)=1 ORDER BY id DESC LIMIT 1",
                (int(request_id),),
            ).fetchone()
        else:
            payee_row = conn.execute("SELECT id, vendor_id, currency, verification_status, payment_readiness_status FROM payment_payee_details WHERE id=?", (int(payee_id),)).fetchone()
        if not payee_row:
            raise PaymentWorkflowError("No approved payee is linked to this request.")
        payee = dict(payee_row)
        if str(payee.get("verification_status") or "") != "Finance Verified":
            raise PaymentWorkflowError("Payee details must be Finance verified before payment.")
        if pr.get("selected_vendor_id") and payee.get("vendor_id") and int(pr["selected_vendor_id"]) != int(payee["vendor_id"]):
            raise PaymentWorkflowError("The selected vendor differs from the linked payee.")
        quote = conn.execute("SELECT quotation_total, quoted_amount, currency FROM vendor_quotes WHERE id=?", (pr.get("selected_vendor_quote_id"),)).fetchone() if pr.get("selected_vendor_quote_id") else None
        amount = float((dict(quote).get("quotation_total") or dict(quote).get("quoted_amount")) if quote else (pr.get("estimated_amount") or 0))
        currency = str(payee.get("currency") or (dict(quote).get("currency") if quote else None) or "NGN")
        approval = conn.execute(
            "SELECT id, approved_by_user_id, approved_by_role FROM approval_history WHERE entity_type='Purchase Request' AND entity_id=? AND status_after='Approved' ORDER BY id DESC LIMIT 1",
            (int(request_id),),
        ).fetchone()
        approval_id = int(approval["id"]) if approval else None
        ts = now_iso()
        dedupe_key = f"payment-recorded:{request_id}:{payment_reference}"
        existing_ref = conn.execute("SELECT id, status FROM payments WHERE notification_dedupe_key=? OR (request_id=? AND payment_reference=?) ORDER BY id DESC LIMIT 1", (dedupe_key, int(request_id), payment_reference)).fetchone()
        if existing_ref and str(existing_ref["status"]) == "Paid":
            conn.commit()
            return int(existing_ref["id"])
        if payment_id:
            payment = conn.execute("SELECT * FROM payments WHERE id=? AND request_id=?", (int(payment_id), int(request_id))).fetchone()
        else:
            payment = conn.execute("SELECT * FROM payments WHERE request_id=? AND status IN ('Approved','Approved for Payment','Pending Payment') ORDER BY id DESC LIMIT 1", (int(request_id),)).fetchone()
        if payment:
            payment_id = int(payment["id"])
            conn.execute(
                """UPDATE payments SET vendor_id=?, payee_detail_id=?, approval_history_id=?, amount=?, currency=?, payment_method='Bank Transfer',
                   transfer_type=?, payment_reference=?, payment_date=?, status='Paid', verification_status='Verified',
                   paid_by=?, finance_note=?, notification_dedupe_key=?, next_role='procurement_manager', updated_at=? WHERE id=?""",
                (pr.get("selected_vendor_id"), int(payee["id"]), approval_id, amount, currency, transfer_type, payment_reference,
                 payment_date, int(actor_user_id), finance_note, dedupe_key, ts, payment_id),
            )
        else:
            payment_id = insert_and_get_id(
                conn,
                """INSERT INTO payments (payment_no, request_id, po_id, vendor_id, payee_detail_id, approval_history_id,
                   amount, currency, payment_method, transfer_type, payment_reference, payment_date, status, verification_status,
                   finance_note, paid_by, created_by, notification_dedupe_key, next_role, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Bank Transfer', ?, ?, ?, 'Paid', 'Verified', ?, ?, ?, ?, 'procurement_manager', ?, ?)""",
                (make_ref("PAY"), int(request_id), pr.get("linked_po_id"), pr.get("selected_vendor_id"), int(payee["id"]),
                 approval_id, amount, currency, transfer_type, payment_reference, payment_date, finance_note, int(actor_user_id),
                 int(actor_user_id), dedupe_key, ts, ts),
            )
        conn.execute(
            """UPDATE purchase_requests SET status='Paid', payment_status='Paid', paid_at=COALESCE(paid_at, ?),
               next_role='procurement_manager', selected_payee_detail_id=?, updated_at=? WHERE id=?""",
            (ts, int(payee["id"]), ts, int(request_id)),
        )
        if pr.get("linked_po_id"):
            conn.execute("UPDATE purchase_orders SET payment_status='Paid', status=CASE WHEN status='Closed' THEN status ELSE 'Paid' END, updated_at=? WHERE id=?", (ts, int(pr["linked_po_id"])))
        conn.execute(
            "INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at) VALUES ('Purchase Request', ?, 'Payment Recorded', 'Paid', ?, ?, ?)",
            (int(request_id), f"Payment reference {payment_reference}; transfer type {transfer_type}.", int(actor_user_id), ts),
        )
        conn.execute(
            """INSERT INTO activity_logs (user_id, role, action, entity_type, entity_id, public_summary, private_details, visibility_scope, related_user_id, created_at)
               VALUES (?, ?, 'Payment Recorded', 'Purchase Request', ?, ?, ?, 'workflow', ?, ?)""",
            (int(actor_user_id), actor_role, int(request_id), f"{pr.get('request_no')} was paid.",
             f"Amount {amount:.2f}; reference {payment_reference}; transfer type {transfer_type}", pr.get("requested_by"), ts),
        )
        _append_audit_event_to_conn(
            conn, action="PAYMENT_RECORDED", entity_type="Payment", entity_id=payment_id,
            parent_entity_type="Purchase Request", parent_entity_id=int(request_id), user_id=actor_user_id, role=actor_role,
            before_values={"request_status": pr.get("status"), "payment_status": pr.get("payment_status")},
            after_values={"request_status": "Paid", "payment_status": "Paid", "amount": amount,
                          "payment_reference": payment_reference, "transfer_type": transfer_type},
            details={"payee_detail_id": int(payee["id"]), "selected_vendor_id": pr.get("selected_vendor_id")},
            severity="High", source="payment_workflow_service",
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    vendor = "Approved payee"
    if pr.get("selected_vendor_id"):
        c = get_conn()
        try:
            v = c.execute("SELECT name FROM vendors WHERE id=?", (int(pr["selected_vendor_id"]),)).fetchone()
            if v:
                vendor = str(v["name"])
        finally:
            c.close()
    message = (
        f"{pr.get('request_no')} was paid to {vendor}. Amount: {amount:,.2f}. Currency: {currency}. "
        f"Payment date: {payment_date}. Reference: {payment_reference}. Transfer type: {transfer_type}. "
        f"Finance officer recorded the payment. Current status: Paid."
    )
    for uid in request_participant_user_ids(request_id):
        create_notification(
            uid, None, "Procurement Payment Recorded", message,
            "Purchase Request", int(request_id), "High", ["in_app", "browser_push", "email"],
            action_label="View Request", dedupe_key=f"{dedupe_key}:{uid}",
        )
    return int(payment_id)

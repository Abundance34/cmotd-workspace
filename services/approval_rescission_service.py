"""Immutable, permission-protected approval rescission workflow."""
from __future__ import annotations

from typing import Any

from core.db import _append_audit_event_to_conn, create_notification, get_conn, insert_and_get_id, now_iso
from services.workflow_participant_service import request_participant_user_ids


class ApprovalRescissionError(RuntimeError):
    pass


def rescind_request_approval(request_id: int, actor_user_id: int, actor_role: str, reason: str) -> dict[str, Any]:
    reason = str(reason or "").strip()
    if not reason:
        raise ApprovalRescissionError("A rescind reason is required.")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        request = conn.execute("SELECT * FROM purchase_requests WHERE id=?", (int(request_id),)).fetchone()
        if not request:
            raise ApprovalRescissionError("Purchase request not found.")
        pr = dict(request)
        approval = conn.execute(
            """SELECT * FROM approval_history WHERE entity_type='Purchase Request' AND entity_id=?
               AND status_after='Approved' ORDER BY created_at DESC, id DESC LIMIT 1""",
            (int(request_id),),
        ).fetchone()
        if not approval:
            raise ApprovalRescissionError("No granted approval is available to rescind.")
        ah = dict(approval)
        original_user_id = ah.get("approved_by_user_id") or ah.get("user_id") or pr.get("approved_by_user_id")
        if actor_role != "Admin" and not (actor_role == "Approver" and int(original_user_id or 0) == int(actor_user_id)):
            raise PermissionError("Only the original approver or an authorized Admin may rescind this approval.")
        payment = conn.execute(
            "SELECT id, status, payment_date FROM payments WHERE request_id=? AND (status='Paid' OR payment_date IS NOT NULL) ORDER BY id DESC LIMIT 1",
            (int(request_id),),
        ).fetchone()
        if payment or str(pr.get("payment_status") or "") == "Paid" or pr.get("paid_at"):
            raise ApprovalRescissionError("Approval cannot be rescinded after payment has been recorded.")
        existing = conn.execute(
            "SELECT id FROM approval_rescissions WHERE entity_type='Purchase Request' AND entity_id=? AND approval_history_id=? LIMIT 1",
            (int(request_id), int(ah["id"])),
        ).fetchone()
        if existing:
            raise ApprovalRescissionError("This approval has already been rescinded.")
        previous_status = str(pr.get("status") or "Approved")
        new_status = "Pending Approval"
        ts = now_iso()
        rescission_id = insert_and_get_id(
            conn,
            """INSERT INTO approval_rescissions (entity_type, entity_id, approval_history_id, rescinded_by_user_id,
               rescinded_by_role, original_approver_user_id, original_approver_role, original_approval_at, reason,
               previous_status, new_status, created_at) VALUES ('Purchase Request', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (int(request_id), int(ah["id"]), int(actor_user_id), actor_role, original_user_id,
             ah.get("approved_by_role") or pr.get("approved_by_role"), ah.get("created_at") or pr.get("approved_at"),
             reason, previous_status, new_status, ts),
        )
        conn.execute(
            """UPDATE purchase_requests SET status=?, next_role='approver', payment_status=NULL,
               approval_rescinded_at=?, approval_rescinded_reason=?, updated_at=? WHERE id=?""",
            (new_status, ts, reason, ts, int(request_id)),
        )
        conn.execute(
            """UPDATE payments SET status='Returned', next_role='approver', finance_note=COALESCE(finance_note,'') || ?, updated_at=?
               WHERE request_id=? AND status NOT IN ('Paid','Completed')""",
            ("\nApproval rescinded: " + reason, ts, int(request_id)),
        )
        conn.execute(
            """INSERT INTO approval_history (entity_type, entity_id, action, status_before, status_after, reason,
               user_id, approved_by_user_id, approved_by_role, approval_mode, note, created_at)
               VALUES ('Purchase Request', ?, 'Approval Rescinded', ?, ?, ?, ?, ?, ?, 'Approval Rescission', ?, ?)""",
            (int(request_id), previous_status, new_status, reason, int(actor_user_id), int(actor_user_id), actor_role, reason, ts),
        )
        conn.execute(
            "INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at) VALUES ('Purchase Request', ?, 'Approval Rescinded', ?, ?, ?, ?)",
            (int(request_id), new_status, reason, int(actor_user_id), ts),
        )
        conn.execute(
            """INSERT INTO activity_logs (user_id, role, action, entity_type, entity_id, public_summary, private_details, visibility_scope, related_user_id, created_at)
               VALUES (?, ?, 'Approval Rescinded', 'Purchase Request', ?, ?, ?, 'workflow', ?, ?)""",
            (int(actor_user_id), actor_role, int(request_id), f"{pr.get('request_no')} approval was rescinded.", reason, pr.get("requested_by"), ts),
        )
        _append_audit_event_to_conn(
            conn, action="APPROVAL_RESCINDED", entity_type="Purchase Request", entity_id=int(request_id),
            user_id=int(actor_user_id), role=actor_role,
            before_values={"status": previous_status, "payment_status": pr.get("payment_status"), "approval_history_id": ah["id"]},
            after_values={"status": new_status, "rescind_reason": reason, "rescission_id": rescission_id},
            severity="High", source="approval_rescission_service", reason_or_comment=reason,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for uid in request_participant_user_ids(request_id):
        create_notification(
            uid, None, "Approval Rescinded",
            f"{pr.get('request_no')} approval was rescinded and returned for review. Reason: {reason}",
            "Purchase Request", int(request_id), "High", ["in_app", "browser_push", "email"],
            action_label="View Request", dedupe_key=f"approval-rescinded:{request_id}:{rescission_id}:{uid}",
        )
    return {"rescission_id": rescission_id, "status": new_status, "reason": reason}

"""Single-action, atomic post-payment completion and archive command."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from core.db import _append_audit_event_to_conn, create_notification, get_conn, now_iso
from services.receipt_document_service import DOCUMENT_CATEGORIES
from services.workflow_participant_service import request_participant_user_ids


class CompletionError(RuntimeError):
    pass


def required_document_categories() -> tuple[str, ...]:
    configured = os.environ.get("PROCUREFLOW_REQUIRED_RECEIPT_CATEGORIES", "").strip()
    if not configured:
        # Proof of Payment is mandatory for completion.
        # A Vendor Receipt is useful supporting evidence but remains optional.
        return ("Proof of Payment",)
    values = tuple(part.strip() for part in configured.split(",") if part.strip())
    invalid = [part for part in values if part not in DOCUMENT_CATEGORIES]
    if invalid:
        raise CompletionError("Invalid required receipt category configuration: " + ", ".join(invalid))
    return values


def mark_request_completed(request_id: int, actor_user_id: int, actor_role: str) -> dict[str, Any]:
    if actor_role not in {"Procurement Manager", "Admin"}:
        raise PermissionError("Only Procurement Manager or Admin may complete a paid procurement.")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM purchase_requests WHERE id=?", (int(request_id),)).fetchone()
        if not row:
            raise CompletionError("Purchase request not found.")
        pr = dict(row)
        if pr.get("completed_at") and pr.get("archived_at"):
            conn.commit()
            return {"status": "Completed", "already_completed": True, "request_no": pr.get("request_no")}
        payment = conn.execute("SELECT id, status, payment_date FROM payments WHERE request_id=? AND status='Paid' ORDER BY id DESC LIMIT 1", (int(request_id),)).fetchone()
        if not payment and str(pr.get("payment_status") or "") != "Paid":
            raise CompletionError("Payment must be recorded before completion.")
        receipt_rows = conn.execute(
            """SELECT document_category, file_path FROM receipt_records
               WHERE request_id=? AND status<>'Superseded'
                 AND (payment_id=? OR linked_payment_id=? OR (payment_id IS NULL AND linked_payment_id IS NULL))""",
            (int(request_id), int(payment["id"]) if payment else None, int(payment["id"]) if payment else None),
        ).fetchall()
        required_categories = required_document_categories()
        required_category_set = set(required_categories)
        categories = {
            str(r["document_category"])
            for r in receipt_rows
            if r["document_category"] and r["file_path"]
        }
        missing = [
            category
            for category in required_categories
            if category not in categories
        ]
        if missing:
            raise CompletionError(
                "Upload the required documents before completion: "
                + ", ".join(missing)
                + "."
            )
        missing_files = [
            str(r["file_path"])
            for r in receipt_rows
            if r["document_category"] in required_category_set
            and r["file_path"]
            and not Path(str(r["file_path"])).is_file()
        ]
        if missing_files:
            raise CompletionError("One or more required payment documents are unavailable from secure storage.")
        ts = now_iso()
        conn.execute(
            """UPDATE purchase_requests SET status='Completed', payment_status='Paid', completed_at=?, completed_by_user_id=?,
               archived_at=?, archived_by_user_id=?, next_role=NULL, updated_at=? WHERE id=?""",
            (ts, int(actor_user_id), ts, int(actor_user_id), ts, int(request_id)),
        )
        conn.execute(
            "INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at) VALUES ('Purchase Request', ?, 'Marked Completed and Archived', 'Completed', 'The active workflow was closed and the record archived.', ?, ?)",
            (int(request_id), int(actor_user_id), ts),
        )
        conn.execute(
            """INSERT INTO activity_logs (user_id, role, action, entity_type, entity_id, public_summary, private_details, visibility_scope, related_user_id, created_at)
               VALUES (?, ?, 'Marked Completed and Archived', 'Purchase Request', ?, ?, 'Atomic completion and archive', 'workflow', ?, ?)""",
            (int(actor_user_id), actor_role, int(request_id), f"{pr.get('request_no')} was completed and archived.", pr.get("requested_by"), ts),
        )
        _append_audit_event_to_conn(
            conn, action="REQUEST_COMPLETED_AND_ARCHIVED", entity_type="Purchase Request", entity_id=int(request_id),
            user_id=actor_user_id, role=actor_role,
            before_values={"status": pr.get("status"), "completed_at": pr.get("completed_at"), "archived_at": pr.get("archived_at")},
            after_values={"status": "Completed", "completed_at": ts, "archived_at": ts, "active_workflow": "Closed"},
            details={"payment_id": int(payment["id"]) if payment else None, "document_categories": sorted(categories)},
            severity="High", source="completion_service",
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for uid in request_participant_user_ids(request_id):
        create_notification(
            uid, None, "Procurement Completed",
            f"{pr.get('request_no')} has been marked completed and archived. It remains available in the Request Register and history.",
            "Purchase Request", int(request_id), "Important", ["in_app", "browser_push", "email"],
            action_label="View History", dedupe_key=f"request-completed:{request_id}:{uid}",
        )
    return {"status": "Completed", "archived_at": ts, "request_no": pr.get("request_no"), "already_completed": False}

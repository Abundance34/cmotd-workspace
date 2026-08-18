"""Atomic Procurement Manager draft deletion.

Draft removal is a logical delete. The request status change,
workflow evidence, legacy audit entry and immutable audit event
commit in one database transaction on both SQLite and PostgreSQL.
"""

from __future__ import annotations

from typing import Any

from core.db import (
    _append_audit_event_to_conn,
    get_conn,
    json_dump,
    now_iso,
    run_query,
    table_columns,
)
from core.db_backend import is_postgres


class DraftDeleteError(ValueError):
    """Raised when a procurement draft cannot safely be deleted."""


def _notify_auditor_after_delete(
    *,
    request_id: int,
    request_no: str,
    actor_role: str,
) -> None:
    """Best-effort Auditor notification after the atomic commit.

    Audit evidence itself is already committed at this point.
    Notification failure must not invalidate the completed,
    fully-audited transaction.
    """
    try:
        columns = table_columns(
            "notifications"
        )

        if not columns:
            return

        title = (
            "Audit activity: "
            "DRAFT_DELETED"
        )

        message = (
            f"{actor_role} performed "
            f"DRAFT_DELETED on Purchase Request "
            f"{request_no}"
        )

        ts = now_iso()

        entity_id = int(
            request_id
        )

        if {
            "popup_shown",
            "importance",
            "delivery_channel",
            "push_sent",
            "email_sent",
            "action_label",
            "section_target",
        }.issubset(
            columns
        ):
            run_query(
                """
                INSERT INTO notifications (
                    user_id,
                    role,
                    title,
                    message,
                    entity_type,
                    entity_id,
                    is_read,
                    popup_shown,
                    importance,
                    delivery_channel,
                    push_sent,
                    email_sent,
                    action_label,
                    section_target,
                    created_at
                )
                VALUES (
                    NULL,
                    'Auditor',
                    ?,
                    ?,
                    'Purchase Request',
                    ?,
                    0,
                    0,
                    'Normal',
                    'in_app',
                    0,
                    0,
                    'Open Audit Dashboard',
                    'Audit Dashboard',
                    ?
                )
                """,
                (
                    title,
                    message,
                    entity_id,
                    ts,
                ),
            )

        elif (
            "section_target"
            in columns
        ):
            run_query(
                """
                INSERT INTO notifications (
                    user_id,
                    role,
                    title,
                    message,
                    entity_type,
                    entity_id,
                    is_read,
                    section_target,
                    created_at
                )
                VALUES (
                    NULL,
                    'Auditor',
                    ?,
                    ?,
                    'Purchase Request',
                    ?,
                    0,
                    'Audit Dashboard',
                    ?
                )
                """,
                (
                    title,
                    message,
                    entity_id,
                    ts,
                ),
            )

        else:
            run_query(
                """
                INSERT INTO notifications (
                    user_id,
                    role,
                    title,
                    message,
                    entity_type,
                    entity_id,
                    is_read,
                    created_at
                )
                VALUES (
                    NULL,
                    'Auditor',
                    ?,
                    ?,
                    'Purchase Request',
                    ?,
                    0,
                    ?
                )
                """,
                (
                    title,
                    message,
                    entity_id,
                    ts,
                ),
            )

    except Exception:
        pass


def delete_procurement_draft(
    request_id: int,
    *,
    actor_user_id: int,
    actor_role: str,
    reason: str,
) -> dict[str, Any]:
    """Atomically logically delete one Procurement Manager draft."""

    if str(
        actor_role
        or ""
    ) != "Procurement Manager":
        raise PermissionError(
            "Only the Procurement Manager can delete "
            "Procurement draft requests."
        )

    clean_reason = str(
        reason
        or ""
    ).strip()

    if not clean_reason:
        raise DraftDeleteError(
            "A deletion reason is required."
        )

    request_id = int(
        request_id
    )

    actor_user_id = int(
        actor_user_id
    )

    # Read schema metadata before opening the write transaction.
    # This mirrors the released approval-policy transaction pattern.
    audit_columns = table_columns(
        "audit_logs"
    )

    conn = get_conn()

    try:
        conn.execute(
            "BEGIN IMMEDIATE"
        )

        select_sql = """
            SELECT
                id,
                request_no,
                status,
                requested_by,
                estimated_amount,
                department_project,
                category
            FROM purchase_requests
            WHERE id=?
        """

        if is_postgres():
            select_sql += (
                " FOR UPDATE"
            )

        row = conn.execute(
            select_sql,
            (
                request_id,
            ),
        ).fetchone()

        if row is None:
            raise DraftDeleteError(
                "The selected draft no longer exists."
            )

        status = str(
            row["status"]
            or ""
        )

        owner_id = int(
            row["requested_by"]
            or 0
        )

        request_no = str(
            row["request_no"]
            or request_id
        )

        if status != "Draft":
            raise DraftDeleteError(
                "This request is no longer a Draft "
                "and cannot be deleted."
            )

        if owner_id != actor_user_id:
            raise DraftDeleteError(
                "You can only delete Procurement drafts "
                "created by your account."
            )

        ts = now_iso()

        conn.execute(
            """
            UPDATE purchase_requests
            SET
                status='Deleted Draft',
                next_role=NULL,
                updated_at=?
            WHERE id=?
              AND status='Draft'
              AND requested_by=?
            """,
            (
                ts,
                request_id,
                actor_user_id,
            ),
        )

        # Workflow evidence is part of the SAME transaction.
        conn.execute(
            """
            INSERT INTO workflow_events (
                entity_type,
                entity_id,
                event,
                status,
                note,
                user_id,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "Purchase Request",
                request_id,
                "Draft Deleted",
                "Deleted Draft",
                clean_reason,
                actor_user_id,
                ts,
            ),
        )

        before_values = {
            "status": "Draft",
            "amount": float(
                row[
                    "estimated_amount"
                ]
                or 0
            ),
            "department": str(
                row[
                    "department_project"
                ]
                or ""
            ),
            "category": str(
                row[
                    "category"
                ]
                or ""
            ),
        }

        after_values = {
            "status": "Deleted Draft",
        }

        details = {
            "request_no": request_no,
            "reason": clean_reason,
            "duplicate_or_unwanted_draft": True,
        }

        details_json = json_dump(
            details
        )

        # Legacy audit_logs entry is committed with the request.
        if {
            "role",
            "before_values",
            "after_values",
            "event_date",
            "event_time",
        }.issubset(
            audit_columns
        ):
            conn.execute(
                """
                INSERT INTO audit_logs (
                    action,
                    entity_type,
                    entity_id,
                    user_id,
                    role,
                    details,
                    before_values,
                    after_values,
                    created_at,
                    event_date,
                    event_time
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "DRAFT_DELETED",
                    "Purchase Request",
                    str(
                        request_id
                    ),
                    actor_user_id,
                    actor_role,
                    details_json,
                    json_dump(
                        before_values
                    ),
                    json_dump(
                        after_values
                    ),
                    ts,
                    ts[:10],
                    ts[11:19],
                ),
            )

        elif {
            "role",
            "before_values",
            "after_values",
        }.issubset(
            audit_columns
        ):
            conn.execute(
                """
                INSERT INTO audit_logs (
                    action,
                    entity_type,
                    entity_id,
                    user_id,
                    role,
                    details,
                    before_values,
                    after_values,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "DRAFT_DELETED",
                    "Purchase Request",
                    str(
                        request_id
                    ),
                    actor_user_id,
                    actor_role,
                    details_json,
                    json_dump(
                        before_values
                    ),
                    json_dump(
                        after_values
                    ),
                    ts,
                ),
            )

        else:
            conn.execute(
                """
                INSERT INTO audit_logs (
                    action,
                    entity_type,
                    entity_id,
                    user_id,
                    details,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "DRAFT_DELETED",
                    "Purchase Request",
                    str(
                        request_id
                    ),
                    actor_user_id,
                    details_json,
                    ts,
                ),
            )

        # Immutable hash-chained evidence is also part of the SAME
        # transaction. Failure here rolls back everything above.
        _append_audit_event_to_conn(
            conn,
            action="DRAFT_DELETED",
            entity_type="Purchase Request",
            entity_id=request_id,
            entity_reference=request_no,
            details=details,
            user_id=actor_user_id,
            role=actor_role,
            before_values=before_values,
            after_values=after_values,
            outcome="Success",
            severity="High",
            source="draft_request_service",
            reason_or_comment=clean_reason,
        )

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()

    # Notification is intentionally best-effort and occurs only
    # after the audited transaction has committed successfully.
    _notify_auditor_after_delete(
        request_id=request_id,
        request_no=request_no,
        actor_role=actor_role,
    )

    return {
        "request_id": request_id,
        "request_no": request_no,
        "status": "Deleted Draft",
    }

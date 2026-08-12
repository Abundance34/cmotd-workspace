"""Audited Admin intervention and exception-control services.

Release A deliberately separates ordinary role workflow from exceptional
Admin powers. Every state-changing intervention requires an Admin actor,
a reason, an intervention record, an activity entry, and the existing
tamper-evident ProcureFlow audit ledger.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from core.db import (
    create_activity_log,
    create_notification,
    log_audit,
    make_ref,
    now_iso,
    run_insert,
    run_query,
    table_columns,
    table_exists,
    transition_request_status,
)
from core.db_backend import (
    is_postgres,
    postgres_health_check,
)
from core.workflow import (
    normalize_status,
    request_routing_for_status,
)


_SCHEMA_READY = False


def _require_admin(actor: dict[str, Any]) -> dict[str, Any]:
    if not actor:
        raise PermissionError(
            "An authenticated Admin is required."
        )

    if str(actor.get("role") or "") != "Admin":
        raise PermissionError(
            "Only Admin can perform this intervention."
        )

    if not actor.get("id"):
        raise PermissionError(
            "Admin user ID is missing."
        )

    return actor


def _require_reason(reason: str | None) -> str:
    clean = " ".join(
        str(reason or "").strip().split()
    )

    if len(clean) < 5:
        raise ValueError(
            "A meaningful reason is required "
            "for every Admin intervention."
        )

    return clean


def _json(value: Any) -> str:
    return json.dumps(
        value if value is not None else {},
        ensure_ascii=False,
        default=str,
        sort_keys=True,
    )


def _parse_datetime(value: Any):
    if value is None or value == "":
        return None

    if isinstance(value, datetime):
        result = value
    else:
        text = str(value).strip()

        if text.endswith("Z"):
            text = text[:-1] + "+00:00"

        try:
            result = datetime.fromisoformat(text)
        except Exception:
            return None

    if result.tzinfo is None:
        result = result.replace(
            tzinfo=timezone.utc
        )

    return result.astimezone(timezone.utc)


def ensure_admin_control_schema() -> None:
    """SQLite/demo fallback.

    PostgreSQL production receives the canonical objects from migration 006.
    These guards keep local SQLite development compatible without modifying
    any existing procurement table.
    """
    global _SCHEMA_READY

    if _SCHEMA_READY:
        return

    if is_postgres():
        # PostgreSQL schema is controlled exclusively by numbered migrations.
        # Release A objects must come from:
        # migrations/postgresql/006_admin_control_foundation.sql
        missing = [
            table_name
            for table_name in (
                "admin_interventions",
                "system_exceptions",
            )
            if not table_exists(table_name)
        ]

        if missing:
            raise RuntimeError(
                "Release A PostgreSQL schema is not ready. "
                "Apply migration "
                "006_admin_control_foundation.sql before "
                "using the Admin Control Centre. "
                "Missing table(s): "
                + ", ".join(missing)
            )

        _SCHEMA_READY = True
        return

    run_query(
        """
        CREATE TABLE IF NOT EXISTS admin_interventions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            intervention_no TEXT UNIQUE NOT NULL,
            intervention_type TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            target_user_id INTEGER,
            severity TEXT NOT NULL DEFAULT 'High',
            reason TEXT NOT NULL,
            before_state_json TEXT,
            after_state_json TEXT,
            actor_user_id INTEGER NOT NULL,
            actor_role TEXT NOT NULL DEFAULT 'Admin',
            correlation_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )

    run_query(
        """
        CREATE TABLE IF NOT EXISTS system_exceptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT UNIQUE NOT NULL,
            category TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'Warning',
            entity_type TEXT,
            entity_id INTEGER,
            reference TEXT,
            summary TEXT NOT NULL,
            details_json TEXT,
            status TEXT NOT NULL DEFAULT 'Open',
            first_detected_at TEXT NOT NULL,
            last_detected_at TEXT NOT NULL,
            investigated_by INTEGER,
            investigated_at TEXT,
            investigation_note TEXT,
            resolved_by INTEGER,
            resolved_at TEXT,
            resolution_note TEXT
        )
        """
    )

    run_query(
        """
        CREATE INDEX IF NOT EXISTS
        idx_admin_interventions_entity
        ON admin_interventions(
            entity_type,
            entity_id,
            created_at
        )
        """
    )

    run_query(
        """
        CREATE INDEX IF NOT EXISTS
        idx_system_exceptions_status
        ON system_exceptions(
            status,
            severity,
            last_detected_at
        )
        """
    )

    if not is_postgres():
        # SQLite equivalent of the PostgreSQL append-only trigger.
        run_query(
            """
            CREATE TRIGGER IF NOT EXISTS
            trg_admin_interventions_no_update
            BEFORE UPDATE ON admin_interventions
            BEGIN
                SELECT RAISE(
                    ABORT,
                    'admin_interventions is append-only'
                );
            END
            """
        )

        run_query(
            """
            CREATE TRIGGER IF NOT EXISTS
            trg_admin_interventions_no_delete
            BEFORE DELETE ON admin_interventions
            BEGIN
                SELECT RAISE(
                    ABORT,
                    'admin_interventions is append-only'
                );
            END
            """
        )

    _SCHEMA_READY = True


def record_admin_intervention(
    *,
    intervention_type: str,
    entity_type: str,
    entity_id: int | None,
    actor: dict[str, Any],
    reason: str,
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
    target_user_id: int | None = None,
    severity: str = "High",
) -> int:
    """Create append-only Admin evidence and immutable audit history."""
    ensure_admin_control_schema()

    actor = _require_admin(actor)
    reason = _require_reason(reason)

    intervention_no = make_ref("ADM-INT")
    correlation_id = make_ref("ADM-CORR")

    before_state = dict(
        before_state or {}
    )
    after_state = dict(
        after_state or {}
    )

    intervention_id = run_insert(
        """
        INSERT INTO admin_interventions (
            intervention_no,
            intervention_type,
            entity_type,
            entity_id,
            target_user_id,
            severity,
            reason,
            before_state_json,
            after_state_json,
            actor_user_id,
            actor_role,
            correlation_id,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            intervention_no,
            intervention_type,
            entity_type,
            entity_id,
            target_user_id,
            severity,
            reason,
            _json(before_state),
            _json(after_state),
            int(actor["id"]),
            "Admin",
            correlation_id,
            now_iso(),
        ),
    )

    # log_audit() also feeds ProcureFlow's immutable hash-chained audit_events
    # ledger, while retaining the established legacy audit view.
    log_audit(
        f"ADMIN_INTERVENTION_{intervention_type.upper().replace(' ', '_')}",
        entity_type,
        entity_id,
        {
            "intervention_no": intervention_no,
            "correlation_id": correlation_id,
            "reason": reason,
            "target_user_id": target_user_id,
            "severity": severity,
        },
        int(actor["id"]),
        "Admin",
        before_values=before_state,
        after_values=after_state,
    )

    create_activity_log(
        int(actor["id"]),
        "Admin",
        "ADMIN_INTERVENTION",
        entity_type,
        entity_id,
        (
            f"{intervention_type} recorded "
            f"as {intervention_no}"
        ),
        {
            "reason": reason,
            "correlation_id": correlation_id,
        },
        "admin",
        target_user_id,
    )

    return intervention_id


def _issue(
    *,
    key: str,
    category: str,
    severity: str,
    summary: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    reference: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "category": category,
        "severity": severity,
        "summary": summary,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "reference": reference,
        "details": details or {},
    }


def collect_system_exceptions(
    stale_hours: int = 72,
) -> list[dict[str, Any]]:
    """Build the current Admin exception queue without changing workflow."""
    ensure_admin_control_schema()

    issues: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(
        hours=max(1, int(stale_hours))
    )

    # -----------------------------------------------------
    # Purchase-request workflow and routing health.
    # -----------------------------------------------------
    if table_exists("purchase_requests"):
        columns = table_columns(
            "purchase_requests"
        )

        wanted = [
            "id",
            "request_no",
            "status",
            "next_role",
            "assigned_procurement_manager_id",
            "estimated_amount",
            "requested_by",
            "payment_status",
            "created_at",
            "updated_at",
        ]

        selected = [
            name
            for name in wanted
            if name in columns
        ]

        rows = run_query(
            (
                "SELECT "
                + ", ".join(selected)
                + " FROM purchase_requests "
                  "ORDER BY id DESC LIMIT 750"
            ),
            fetch=True,
        )

        terminal = {
            "Draft",
            "Rejected",
            "Cancelled",
            "Archived",
        }

        for raw in rows or []:
            row = dict(raw)

            request_id = int(row["id"])
            request_no = str(
                row.get("request_no")
                or f"Request #{request_id}"
            )

            status = normalize_status(
                str(row.get("status") or "")
            )

            routing = request_routing_for_status(
                status,
                row.get("estimated_amount"),
            )

            stored_next_role = str(
                row.get("next_role") or ""
            ).strip()

            expected_next_role = str(
                routing.next_role or ""
            ).strip()

            # Incorrect or missing command-chain routing.
            if (
                "next_role" in columns
                and expected_next_role
                and stored_next_role
                != expected_next_role
            ):
                issues.append(
                    _issue(
                        key=(
                            f"routing:request:"
                            f"{request_id}"
                        ),
                        category="Routing",
                        severity="High",
                        entity_type="Purchase Request",
                        entity_id=request_id,
                        reference=request_no,
                        summary=(
                            f"{request_no} is routed to "
                            f"'{stored_next_role or 'nobody'}' "
                            f"instead of "
                            f"'{expected_next_role}'."
                        ),
                        details={
                            "status": status,
                            "stored_next_role":
                                stored_next_role,
                            "expected_next_role":
                                expected_next_role,
                        },
                    )
                )

            # Procurement work with no named Procurement Manager.
            if (
                "assigned_procurement_manager_id"
                in columns
                and expected_next_role
                == "procurement_manager"
                and not row.get(
                    "assigned_procurement_manager_id"
                )
                and status not in terminal
            ):
                issues.append(
                    _issue(
                        key=(
                            f"unassigned:request:"
                            f"{request_id}"
                        ),
                        category="Assignment",
                        severity="Warning",
                        entity_type="Purchase Request",
                        entity_id=request_id,
                        reference=request_no,
                        summary=(
                            f"{request_no} is waiting for "
                            "Procurement Manager work but "
                            "has no named assignee."
                        ),
                        details={
                            "status": status,
                            "next_role":
                                expected_next_role,
                        },
                    )
                )

            # Work waiting beyond the Admin control threshold.
            touched = _parse_datetime(
                row.get("updated_at")
                or row.get("created_at")
            )

            if (
                touched is not None
                and touched < stale_before
                and expected_next_role
                and status not in terminal
            ):
                age_hours = int(
                    (
                        now - touched
                    ).total_seconds()
                    // 3600
                )

                issues.append(
                    _issue(
                        key=(
                            f"stalled:request:"
                            f"{request_id}"
                        ),
                        category="Workflow",
                        severity=(
                            "High"
                            if age_hours >= 168
                            else "Warning"
                        ),
                        entity_type="Purchase Request",
                        entity_id=request_id,
                        reference=request_no,
                        summary=(
                            f"{request_no} has waited "
                            f"about {age_hours} hours "
                            "without workflow movement."
                        ),
                        details={
                            "status": status,
                            "next_role":
                                expected_next_role,
                            "last_updated":
                                str(touched),
                            "age_hours":
                                age_hours,
                        },
                    )
                )

    # -----------------------------------------------------
    # Notification / email delivery failures.
    # -----------------------------------------------------
    if table_exists("notification_outbox"):
        outbox_rows = run_query(
            """
            SELECT
                id,
                notification_id,
                channel,
                target_user_id,
                target_role,
                status,
                error_message,
                created_at
            FROM notification_outbox
            WHERE
                lower(COALESCE(status, ''))
                    LIKE '%fail%'
                OR status IN (
                    'Fallback',
                    'Needs Email Address',
                    'Queued - SMTP Missing'
                )
            ORDER BY id DESC
            LIMIT 100
            """,
            fetch=True,
        )

        for raw in outbox_rows or []:
            row = dict(raw)
            outbox_id = int(row["id"])
            channel = str(
                row.get("channel") or "notification"
            )
            status = str(
                row.get("status") or "Failed"
            )

            issues.append(
                _issue(
                    key=(
                        f"notification:"
                        f"{outbox_id}"
                    ),
                    category="Notification",
                    severity=(
                        "High"
                        if "fail" in status.lower()
                        else "Warning"
                    ),
                    entity_type="Notification Outbox",
                    entity_id=outbox_id,
                    reference=str(
                        row.get("notification_id")
                        or outbox_id
                    ),
                    summary=(
                        f"{channel.title()} delivery "
                        f"is '{status}'."
                    ),
                    details={
                        "target_user_id":
                            row.get(
                                "target_user_id"
                            ),
                        "target_role":
                            row.get(
                                "target_role"
                            ),
                        "error":
                            row.get(
                                "error_message"
                            ),
                        "created_at":
                            row.get(
                                "created_at"
                            ),
                    },
                )
            )

    # -----------------------------------------------------
    # Paid records missing payment evidence.
    # -----------------------------------------------------
    if table_exists("payments"):
        payment_columns = table_columns(
            "payments"
        )

        evidence_columns = [
            name
            for name in (
                "proof_of_payment_receipt_id",
                "receipt_id",
                "proof_path",
            )
            if name in payment_columns
        ]

        wanted = [
            name
            for name in (
                "id",
                "payment_no",
                "request_id",
                "po_id",
                "status",
                "payment_date",
                "created_at",
                *evidence_columns,
            )
            if name in payment_columns
        ]

        if evidence_columns:
            payment_rows = run_query(
                (
                    "SELECT "
                    + ", ".join(wanted)
                    + " FROM payments "
                      "WHERE status='Paid' "
                      "ORDER BY id DESC LIMIT 250"
                ),
                fetch=True,
            )

            for raw in payment_rows or []:
                row = dict(raw)

                has_evidence = any(
                    row.get(column)
                    not in (None, "", 0)
                    for column
                    in evidence_columns
                )

                if has_evidence:
                    continue

                payment_id = int(row["id"])
                payment_no = str(
                    row.get("payment_no")
                    or f"Payment #{payment_id}"
                )

                issues.append(
                    _issue(
                        key=(
                            f"payment-evidence:"
                            f"{payment_id}"
                        ),
                        category="Payment Evidence",
                        severity="High",
                        entity_type="Payment",
                        entity_id=payment_id,
                        reference=payment_no,
                        summary=(
                            f"{payment_no} is marked Paid "
                            "but no payment evidence is linked."
                        ),
                        details={
                            "request_id":
                                row.get("request_id"),
                            "po_id":
                                row.get("po_id"),
                            "payment_date":
                                row.get(
                                    "payment_date"
                                ),
                        },
                    )
                )

    # -----------------------------------------------------
    # PostgreSQL health.
    # -----------------------------------------------------
    if is_postgres():
        health = postgres_health_check()

        if not health.ok:
            issues.insert(
                0,
                _issue(
                    key="database:postgresql:health",
                    category="Database",
                    severity="Critical",
                    entity_type="Database",
                    entity_id=None,
                    reference="PostgreSQL",
                    summary=(
                        "PostgreSQL health check failed."
                    ),
                    details={
                        "message": health.message,
                    },
                ),
            )

    severity_order = {
        "Critical": 0,
        "High": 1,
        "Warning": 2,
        "Info": 3,
    }

    return sorted(
        issues,
        key=lambda item: (
            severity_order.get(
                item.get("severity"),
                9,
            ),
            item.get("category") or "",
            item.get("reference") or "",
        ),
    )


def _save_exception_state(
    issue: dict[str, Any],
    *,
    status: str,
    actor: dict[str, Any],
    note: str,
) -> None:
    ensure_admin_control_schema()
    actor = _require_admin(actor)
    note = _require_reason(note)

    ts = now_iso()

    run_query(
        """
        INSERT OR IGNORE INTO system_exceptions (
            issue_key,
            category,
            severity,
            entity_type,
            entity_id,
            reference,
            summary,
            details_json,
            status,
            first_detected_at,
            last_detected_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
        """,
        (
            issue["key"],
            issue["category"],
            issue["severity"],
            issue.get("entity_type"),
            issue.get("entity_id"),
            issue.get("reference"),
            issue["summary"],
            _json(issue.get("details")),
            ts,
            ts,
        ),
    )

    if status == "Investigating":
        run_query(
            """
            UPDATE system_exceptions
            SET
                status='Investigating',
                last_detected_at=?,
                investigated_by=?,
                investigated_at=?,
                investigation_note=?
            WHERE issue_key=?
            """,
            (
                ts,
                int(actor["id"]),
                ts,
                note,
                issue["key"],
            ),
        )
    else:
        run_query(
            """
            UPDATE system_exceptions
            SET
                status='Resolved',
                last_detected_at=?,
                resolved_by=?,
                resolved_at=?,
                resolution_note=?
            WHERE issue_key=?
            """,
            (
                ts,
                int(actor["id"]),
                ts,
                note,
                issue["key"],
            ),
        )


def investigate_system_exception(
    issue: dict[str, Any],
    actor: dict[str, Any],
    reason: str,
) -> int:
    reason = _require_reason(reason)

    _save_exception_state(
        issue,
        status="Investigating",
        actor=actor,
        note=reason,
    )

    return record_admin_intervention(
        intervention_type="Investigate System Exception",
        entity_type=(
            issue.get("entity_type")
            or "System Exception"
        ),
        entity_id=issue.get("entity_id"),
        actor=actor,
        reason=reason,
        before_state={
            "issue_key": issue["key"],
            "status": "Open",
        },
        after_state={
            "issue_key": issue["key"],
            "status": "Investigating",
        },
        severity=issue.get(
            "severity",
            "High",
        ),
    )


def resolve_system_exception(
    issue: dict[str, Any],
    actor: dict[str, Any],
    reason: str,
) -> int:
    reason = _require_reason(reason)

    _save_exception_state(
        issue,
        status="Resolved",
        actor=actor,
        note=reason,
    )

    return record_admin_intervention(
        intervention_type="Resolve System Exception",
        entity_type=(
            issue.get("entity_type")
            or "System Exception"
        ),
        entity_id=issue.get("entity_id"),
        actor=actor,
        reason=reason,
        before_state={
            "issue_key": issue["key"],
            "status": "Investigating/Open",
        },
        after_state={
            "issue_key": issue["key"],
            "status": "Resolved",
        },
        severity=issue.get(
            "severity",
            "High",
        ),
    )


def _request(request_id: int) -> dict[str, Any]:
    rows = run_query(
        """
        SELECT *
        FROM purchase_requests
        WHERE id=?
        LIMIT 1
        """,
        (int(request_id),),
        fetch=True,
    )

    if not rows:
        raise ValueError(
            "Purchase request was not found."
        )

    return dict(rows[0])


def correct_request_routing(
    request_id: int,
    actor: dict[str, Any],
    reason: str,
) -> int:
    actor = _require_admin(actor)
    reason = _require_reason(reason)

    before = _request(request_id)

    routing = request_routing_for_status(
        before.get("status"),
        before.get("estimated_amount"),
    )

    expected = routing.next_role
    current = before.get("next_role")

    if str(current or "") == str(expected or ""):
        raise ValueError(
            "This request already has the correct routing."
        )

    if expected:
        run_query(
            """
            UPDATE purchase_requests
            SET next_role=?, updated_at=?
            WHERE id=?
            """,
            (
                expected,
                now_iso(),
                int(request_id),
            ),
        )
    else:
        run_query(
            """
            UPDATE purchase_requests
            SET next_role=NULL, updated_at=?
            WHERE id=?
            """,
            (
                now_iso(),
                int(request_id),
            ),
        )

    after = _request(request_id)

    return record_admin_intervention(
        intervention_type="Correct Request Routing",
        entity_type="Purchase Request",
        entity_id=int(request_id),
        actor=actor,
        reason=reason,
        before_state={
            "status": before.get("status"),
            "next_role": current,
        },
        after_state={
            "status": after.get("status"),
            "next_role": after.get("next_role"),
        },
    )


def reassign_procurement_manager(
    request_id: int,
    target_user_id: int,
    actor: dict[str, Any],
    reason: str,
) -> int:
    actor = _require_admin(actor)
    reason = _require_reason(reason)

    before = _request(request_id)

    routing = request_routing_for_status(
        before.get("status"),
        before.get("estimated_amount"),
    )

    if routing.next_role != "procurement_manager":
        raise ValueError(
            "This request is not currently owned by "
            "the Procurement Manager stage."
        )

    target_rows = run_query(
        """
        SELECT
            id,
            username,
            full_name,
            role,
            is_active
        FROM users
        WHERE id=?
        LIMIT 1
        """,
        (int(target_user_id),),
        fetch=True,
    )

    if not target_rows:
        raise ValueError(
            "Selected user was not found."
        )

    target = dict(target_rows[0])

    if (
        str(target.get("role") or "")
        != "Procurement Manager"
        or not bool(target.get("is_active"))
    ):
        raise ValueError(
            "The assignee must be an active "
            "Procurement Manager."
        )

    if (
        int(
            before.get(
                "assigned_procurement_manager_id"
            )
            or 0
        )
        == int(target_user_id)
    ):
        raise ValueError(
            "This request is already assigned "
            "to that Procurement Manager."
        )

    run_query(
        """
        UPDATE purchase_requests
        SET
            assigned_procurement_manager_id=?,
            next_role='procurement_manager',
            updated_at=?
        WHERE id=?
        """,
        (
            int(target_user_id),
            now_iso(),
            int(request_id),
        ),
    )

    after = _request(request_id)

    create_notification(
        user_id=int(target_user_id),
        title="Admin reassigned procurement work",
        message=(
            f"{after.get('request_no')} was assigned "
            "to you by Admin. "
            f"Reason: {reason}"
        ),
        entity_type="Purchase Request",
        entity_id=int(request_id),
        importance="High",
        channels=["in_app", "browser_push"],
        action_label="Open Purchase Requests",
    )

    return record_admin_intervention(
        intervention_type="Reassign Procurement Manager",
        entity_type="Purchase Request",
        entity_id=int(request_id),
        target_user_id=int(target_user_id),
        actor=actor,
        reason=reason,
        before_state={
            "assigned_procurement_manager_id":
                before.get(
                    "assigned_procurement_manager_id"
                ),
            "next_role":
                before.get("next_role"),
        },
        after_state={
            "assigned_procurement_manager_id":
                after.get(
                    "assigned_procurement_manager_id"
                ),
            "next_role":
                after.get("next_role"),
        },
    )


def admin_request_intervention(
    request_id: int,
    operation: str,
    actor: dict[str, Any],
    reason: str,
) -> int:
    """Apply a constrained exceptional request intervention.

    Admin does not gain ordinary Procurement or Finance ownership here.
    The operations below are explicitly exceptional and fully audited.
    """
    actor = _require_admin(actor)
    reason = _require_reason(reason)

    before = _request(request_id)
    current = normalize_status(
        before.get("status")
    )

    actor_id = int(actor["id"])

    if (
        before.get("requested_by")
        and int(before["requested_by"])
        == actor_id
        and operation in {
            "Emergency Approve Request",
            "Emergency Reject Request",
        }
    ):
        raise PermissionError(
            "Admin cannot use an emergency approval "
            "decision on their own request."
        )

    paid_states = {
        "Awaiting Payment",
        "Paid",
        "Receipt Uploaded",
        "Payment Submitted for Verification",
        "Completed",
        "Closed",
        "Archived",
    }

    target_status = None
    event = None
    approval_mode = "Admin Emergency Intervention"

    if operation == "Return for Correction":
        if current in paid_states:
            raise ValueError(
                "A paid/closure-stage request cannot be "
                "returned through this correction action."
            )

        target_status = "Returned for Correction"
        event = "Admin Override - Returned for Correction"

    elif operation == "Return to Procurement Review":
        if current in paid_states:
            raise ValueError(
                "A paid/closure-stage request cannot be "
                "returned to Procurement Review."
            )

        target_status = "Sent for Procurement Review"
        event = "Admin Override - Returned to Procurement Review"

    elif operation == "Release Stuck Approval":
        if current != "Submitted for Approval":
            raise ValueError(
                "Release Stuck Approval is only available "
                "for a request already awaiting approval."
            )

        target_status = "Submitted for Approval"
        event = "Admin Intervention - Approval Routing Released"

    elif operation == "Reopen Completed / Closed / Archived":
        if current not in {
            "Completed",
            "Closed",
            "Archived",
        }:
            raise ValueError(
                "Only Completed, Closed, or Archived "
                "requests can be reopened here."
            )

        target_status = "Receipt Uploaded"
        event = "Admin Intervention - Procurement Reopened"

    elif operation == "Cancel Duplicate Request":
        if current in paid_states or current == "Approved":
            raise ValueError(
                "Approved, paid, or closed records cannot "
                "be cancelled as duplicates from this control."
            )

        payment_columns = (
            table_columns("payments")
            if table_exists("payments")
            else set()
        )

        if "request_id" in payment_columns:
            payments = run_query(
                """
                SELECT id
                FROM payments
                WHERE request_id=?
                  AND status IN (
                      'Approved',
                      'Paid'
                  )
                LIMIT 1
                """,
                (int(request_id),),
                fetch=True,
            )

            if payments:
                raise ValueError(
                    "A payment record already exists for "
                    "this request. Duplicate cancellation "
                    "has been blocked."
                )

        target_status = "Cancelled"
        event = "Admin Intervention - Duplicate Request Cancelled"

    elif operation == "Emergency Approve Request":
        if current != "Submitted for Approval":
            raise ValueError(
                "Emergency approval is only available "
                "while a request is awaiting approval."
            )

        target_status = "Approved"
        event = "Approved by Admin Emergency Override"

    elif operation == "Emergency Reject Request":
        if current != "Submitted for Approval":
            raise ValueError(
                "Emergency rejection is only available "
                "while a request is awaiting approval."
            )

        target_status = "Rejected"
        event = "Rejected by Admin Emergency Override"

    else:
        raise ValueError(
            "Unsupported Admin request intervention."
        )

    transition_request_status(
        int(request_id),
        target_status,
        event,
        reason,
        actor_user_id=actor_id,
        actor_role="Admin",
        approval_mode=approval_mode,
        delegation_reason=reason,
        original_approver_role=(
            "Approver"
            if operation.startswith("Emergency ")
            else None
        ),
    )

    after = _request(request_id)

    intervention_id = record_admin_intervention(
        intervention_type=operation,
        entity_type="Purchase Request",
        entity_id=int(request_id),
        actor=actor,
        reason=reason,
        before_state={
            "status": before.get("status"),
            "next_role": before.get("next_role"),
            "payment_status":
                before.get("payment_status"),
        },
        after_state={
            "status": after.get("status"),
            "next_role": after.get("next_role"),
            "payment_status":
                after.get("payment_status"),
        },
        severity="High",
    )

    create_notification(
        user_id=before.get("requested_by"),
        title="Admin workflow intervention",
        message=(
            f"{before.get('request_no')} was changed "
            f"using '{operation}'. "
            f"Reason: {reason}"
        ),
        entity_type="Purchase Request",
        entity_id=int(request_id),
        importance="High",
        channels=["in_app"],
        action_label="Open Purchase Requests",
    )

    return intervention_id


def admin_user_security_action(
    target_user_id: int,
    action: str,
    actor: dict[str, Any],
    reason: str,
) -> int:
    """Perform an audited Admin account/session intervention."""
    actor = _require_admin(actor)
    reason = _require_reason(reason)

    target_user_id = int(target_user_id)
    actor_id = int(actor["id"])

    rows = run_query(
        """
        SELECT
            id,
            username,
            full_name,
            role,
            is_active,
            must_change_password,
            COALESCE(account_locked, 0)
                AS account_locked,
            COALESCE(failed_login_count, 0)
                AS failed_login_count
        FROM users
        WHERE id=?
        LIMIT 1
        """,
        (target_user_id,),
        fetch=True,
    )

    if not rows:
        raise ValueError(
            "Selected user was not found."
        )

    before = dict(rows[0])

    self_dangerous = {
        "Lock Account",
        "Suspend Access",
        "Terminate Active Sessions",
    }

    if (
        target_user_id == actor_id
        and action in self_dangerous
    ):
        raise PermissionError(
            "Admin cannot lock, suspend, or terminate "
            "their own current account from this page."
        )

    ts = now_iso()

    if action == "Lock Account":
        run_query(
            """
            UPDATE users
            SET
                account_locked=1,
                updated_at=?
            WHERE id=?
            """,
            (ts, target_user_id),
        )

        run_query(
            """
            UPDATE user_sessions
            SET
                status='Terminated by Admin',
                logout_at=?,
                last_seen_at=?,
                updated_at=?
            WHERE user_id=?
              AND status='Active'
            """,
            (
                ts,
                ts,
                ts,
                target_user_id,
            ),
        )

    elif action == "Unlock Account":
        run_query(
            """
            UPDATE users
            SET
                account_locked=0,
                failed_login_count=0,
                updated_at=?
            WHERE id=?
            """,
            (ts, target_user_id),
        )

    elif action == "Suspend Access":
        run_query(
            """
            UPDATE users
            SET
                is_active=0,
                updated_at=?
            WHERE id=?
            """,
            (ts, target_user_id),
        )

        run_query(
            """
            UPDATE user_sessions
            SET
                status='Terminated by Admin',
                logout_at=?,
                last_seen_at=?,
                updated_at=?
            WHERE user_id=?
              AND status='Active'
            """,
            (
                ts,
                ts,
                ts,
                target_user_id,
            ),
        )

    elif action == "Restore Access":
        run_query(
            """
            UPDATE users
            SET
                is_active=1,
                updated_at=?
            WHERE id=?
            """,
            (ts, target_user_id),
        )

    elif action == "Force Password Change":
        run_query(
            """
            UPDATE users
            SET
                must_change_password=1,
                updated_at=?
            WHERE id=?
            """,
            (ts, target_user_id),
        )

        if target_user_id != actor_id:
            run_query(
                """
                UPDATE user_sessions
                SET
                    status='Password Reset Required',
                    logout_at=?,
                    last_seen_at=?,
                    updated_at=?
                WHERE user_id=?
                  AND status='Active'
                """,
                (
                    ts,
                    ts,
                    ts,
                    target_user_id,
                ),
            )

    elif action == "Terminate Active Sessions":
        run_query(
            """
            UPDATE user_sessions
            SET
                status='Terminated by Admin',
                logout_at=?,
                last_seen_at=?,
                updated_at=?
            WHERE user_id=?
              AND status='Active'
            """,
            (
                ts,
                ts,
                ts,
                target_user_id,
            ),
        )

    else:
        raise ValueError(
            "Unsupported security action."
        )

    after_rows = run_query(
        """
        SELECT
            id,
            username,
            full_name,
            role,
            is_active,
            must_change_password,
            COALESCE(account_locked, 0)
                AS account_locked,
            COALESCE(failed_login_count, 0)
                AS failed_login_count
        FROM users
        WHERE id=?
        LIMIT 1
        """,
        (target_user_id,),
        fetch=True,
    )

    after = (
        dict(after_rows[0])
        if after_rows
        else {}
    )

    intervention_id = record_admin_intervention(
        intervention_type=action,
        entity_type="User",
        entity_id=target_user_id,
        target_user_id=target_user_id,
        actor=actor,
        reason=reason,
        before_state=before,
        after_state=after,
        severity="High",
    )

    try:
        create_notification(
            user_id=target_user_id,
            title="Account security action",
            message=(
                f"Admin performed '{action}' "
                f"on your account. Reason: {reason}"
            ),
            entity_type="User",
            entity_id=target_user_id,
            importance="High",
            channels=["in_app"],
            action_label="Open Settings",
        )
    except Exception:
        # Account suspension must not fail merely because
        # its notification could not be generated.
        pass

    return intervention_id

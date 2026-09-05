import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const SUBMITTABLE = new Set(["FM Draft", "Draft", "Returned for Correction", "Returned to Facility Manager"]);

type RequestRecord = {
  id: number;
  request_no: string;
  requested_by: number;
  facility_manager_user_id: number | null;
  assigned_procurement_manager_id: number | null;
  status: string | null;
  next_role: string | null;
  estimated_amount: string | number | null;
  department_project: string | null;
};

async function activeProcurementManager(tx: any, candidateId?: number | null) {
  if (candidateId) {
    const candidate = await tx<{ id: number }[]>`
      SELECT id
      FROM users
      WHERE id = ${candidateId}
        AND lower(trim(role)) = 'procurement manager'
        AND COALESCE(is_active, TRUE) = TRUE
        AND COALESCE(account_locked, FALSE) = FALSE
      LIMIT 1
    `;
    if (candidate[0]) return Number(candidate[0].id);
  }

  const fallback = await tx<{ id: number }[]>`
    SELECT id
    FROM users
    WHERE lower(trim(role)) = 'procurement manager'
      AND COALESCE(is_active, TRUE) = TRUE
      AND COALESCE(account_locked, FALSE) = FALSE
    ORDER BY id
    LIMIT 1
  `;
  return fallback[0] ? Number(fallback[0].id) : null;
}

export async function submitFacilityRequest(user: CurrentUser, requestId: number) {
  if (user.role !== "Facility Manager" && user.role !== "Admin") {
    throw new Error("Only Utility Head / Facility Head or Admin can submit this request.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<RequestRecord[]>`
      SELECT id, request_no, requested_by, facility_manager_user_id,
             assigned_procurement_manager_id, status, next_role,
             estimated_amount, department_project
      FROM purchase_requests
      WHERE id = ${requestId}
      FOR UPDATE
    `;
    const request = rows[0];
    if (!request) throw new Error("Request not found.");

    const ownsRequest = Number(request.requested_by) === user.id || Number(request.facility_manager_user_id || 0) === user.id;
    if (user.role !== "Admin" && !ownsRequest) {
      throw new Error("You cannot submit another user's request.");
    }
    if (!SUBMITTABLE.has(String(request.status || ""))) {
      throw new Error(`This request cannot be submitted from status '${request.status || "Unknown"}'.`);
    }

    const pmId = await activeProcurementManager(tx, request.assigned_procurement_manager_id);
    if (!pmId) throw new Error("No active Procurement Manager is available for automatic routing.");

    const now = new Date().toISOString();
    const oldStatus = String(request.status || "");
    const event = "Sent for Procurement Review";
    const note = "Submitted to Procurement Manager by Utility / Facility Head";

    await tx`
      UPDATE purchase_requests
      SET status = 'Sent for Procurement Review',
          next_role = 'procurement_manager',
          assigned_procurement_manager_id = ${pmId},
          submitted_at = COALESCE(submitted_at, ${now}),
          updated_at = ${now}
      WHERE id = ${requestId}
    `;

    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${requestId}, ${event}, 'Sent for Procurement Review', ${note}, ${user.id}, ${now})
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id, role, action, entity_type, entity_id,
        public_summary, private_details, visibility_scope, related_user_id, created_at
      ) VALUES (
        ${user.id}, ${user.role}, ${event}, 'Purchase Request', ${requestId},
        ${`${request.request_no} moved from ${oldStatus} to Sent for Procurement Review`},
        ${note}, 'workflow', ${pmId}, ${now}
      )
    `;

    await tx`
      INSERT INTO approval_history (
        entity_type, entity_id, action, status_before, status_after,
        reason, user_id, approved_by_user_id, approved_by_role,
        approval_mode, note, created_at
      ) VALUES (
        'Purchase Request', ${requestId}, ${event}, ${oldStatus}, 'Sent for Procurement Review',
        ${note}, ${user.id}, ${user.id}, ${user.role},
        'Normal Approval Mode', ${note}, ${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action, entity_type, entity_id, user_id, role, details,
        before_values, after_values, created_at, event_date, event_time,
        amount, department, notes
      ) VALUES (
        ${event}, 'Purchase Request', ${String(requestId)}, ${user.id}, ${user.role}, ${note},
        ${tx.json({ status: oldStatus, next_role: request.next_role })},
        ${tx.json({ status: "Sent for Procurement Review", next_role: "procurement_manager" })},
        ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
        ${Number(request.estimated_amount || 0)}, ${request.department_project}, ${note}
      )
    `;

    await appendAuditEvent(tx, {
      action: event,
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: request.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: oldStatus, next_role: request.next_role },
      afterValues: { status: "Sent for Procurement Review", next_role: "procurement_manager" },
      metadata: { amount: Number(request.estimated_amount || 0), department: request.department_project },
      reasonOrComment: note,
    });

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Procurement Manager', 'Request pending procurement review',
        ${`${request.request_no} was submitted by ${user.fullName} and requires procurement review.`},
        'Purchase Request', ${requestId}, FALSE, FALSE, 'High', 'in_app', FALSE, FALSE,
        'Open Procurement Review', 'Procurement Review', ${now}
      )
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        ${user.id}, NULL, 'Request submitted to Procurement Manager',
        ${`${request.request_no} was sent to the Procurement Manager for review.`},
        'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Request', 'My Activity History', ${now}
      )
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', 'Audit activity: Sent for Procurement Review',
        ${`${user.role} performed Sent for Procurement Review on Purchase Request ${requestId}`},
        'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO collaboration_threads (
        entity_type, entity_id, facility_manager_user_id,
        procurement_manager_user_id, created_at, updated_at
      )
      SELECT 'Purchase Request', ${requestId}, ${Number(request.facility_manager_user_id || user.id)}, ${pmId}, ${now}, ${now}
      WHERE NOT EXISTS (
        SELECT 1 FROM collaboration_threads
        WHERE entity_type = 'Purchase Request'
          AND entity_id = ${requestId}
          AND facility_manager_user_id = ${Number(request.facility_manager_user_id || user.id)}
          AND procurement_manager_user_id = ${pmId}
      )
    `;

    return { requestId, requestNo: request.request_no, status: "Sent for Procurement Review", procurementManagerId: pmId };
  });
}

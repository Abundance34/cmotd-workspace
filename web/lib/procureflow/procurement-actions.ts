import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const REVIEWABLE = new Set([
  "Sent for Procurement Review",
  "Submitted to Procurement Manager",
  "Submitted",
  "Procurement Review",
  "Reviewed by Procurement",
]);

export type ProcurementReviewAction = "review" | "return" | "submit_approval";

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

function actionPolicy(action: ProcurementReviewAction, note: string) {
  if (action === "review") {
    return {
      status: "Reviewed by Procurement",
      nextRole: "procurement_manager",
      event: "Reviewed by Procurement",
      defaultNote: "Reviewed by Procurement Manager",
    };
  }
  if (action === "return") {
    if (!note.trim()) throw new Error("A correction reason is required before returning a request.");
    return {
      status: "Returned for Correction",
      nextRole: "facility_manager",
      event: "Returned for Correction",
      defaultNote: note.trim(),
    };
  }
  return {
    status: "Submitted for Approval",
    nextRole: "approver",
    event: "Submitted for Approval",
    defaultNote: "Submitted by Procurement Manager for final approval",
  };
}

export async function transitionProcurementRequest(
  user: CurrentUser,
  requestId: number,
  action: ProcurementReviewAction,
  note = "",
) {
  if (user.role !== "Procurement Manager" && user.role !== "Admin") {
    throw new Error("Only Procurement Manager or Admin can perform this review action.");
  }
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid request is required.");
  if (!["review", "return", "submit_approval"].includes(action)) throw new Error("Unsupported procurement action.");

  const policy = actionPolicy(action, note);
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

    const oldStatus = String(request.status || "");
    if (!REVIEWABLE.has(oldStatus)) {
      throw new Error(`This request cannot be reviewed from status '${oldStatus || "Unknown"}'.`);
    }
    if (
      user.role !== "Admin" &&
      request.assigned_procurement_manager_id &&
      Number(request.assigned_procurement_manager_id) !== user.id
    ) {
      throw new Error("This request is assigned to another Procurement Manager.");
    }

    const now = new Date().toISOString();
    const finalNote = note.trim() || policy.defaultNote;
    const pmId = request.assigned_procurement_manager_id || user.id;

    await tx`
      UPDATE purchase_requests
      SET status = ${policy.status},
          next_role = ${policy.nextRole},
          assigned_procurement_manager_id = ${pmId},
          updated_at = ${now}
      WHERE id = ${requestId}
    `;

    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${requestId}, ${policy.event}, ${policy.status}, ${finalNote}, ${user.id}, ${now})
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id, role, action, entity_type, entity_id,
        public_summary, private_details, visibility_scope, related_user_id, created_at
      ) VALUES (
        ${user.id}, ${user.role}, ${policy.event}, 'Purchase Request', ${requestId},
        ${`${request.request_no} moved from ${oldStatus} to ${policy.status}`},
        ${finalNote}, 'workflow', ${request.facility_manager_user_id}, ${now}
      )
    `;

    await tx`
      INSERT INTO approval_history (
        entity_type, entity_id, action, status_before, status_after,
        reason, user_id, approved_by_user_id, approved_by_role,
        approval_mode, note, created_at
      ) VALUES (
        'Purchase Request', ${requestId}, ${policy.event}, ${oldStatus}, ${policy.status},
        ${finalNote}, ${user.id}, ${user.id}, ${user.role},
        'Procurement Review', ${finalNote}, ${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action, entity_type, entity_id, user_id, role, details,
        before_values, after_values, created_at, event_date, event_time,
        amount, department, notes
      ) VALUES (
        ${policy.event}, 'Purchase Request', ${String(requestId)}, ${user.id}, ${user.role}, ${finalNote},
        ${tx.json({ status: oldStatus, next_role: request.next_role })},
        ${tx.json({ status: policy.status, next_role: policy.nextRole })},
        ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
        ${Number(request.estimated_amount || 0)}, ${request.department_project}, ${finalNote}
      )
    `;

    await appendAuditEvent(tx, {
      action: policy.event,
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: request.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: oldStatus, next_role: request.next_role },
      afterValues: { status: policy.status, next_role: policy.nextRole },
      metadata: { amount: Number(request.estimated_amount || 0), department: request.department_project },
      reasonOrComment: finalNote,
      source: "nextjs",
    });

    if (request.facility_manager_user_id) {
      const title = action === "return"
        ? "Request returned for correction"
        : action === "submit_approval"
          ? "Request submitted for final approval"
          : "Request reviewed by Procurement";
      const message = action === "return"
        ? `${request.request_no} was returned by Procurement for correction. Reason: ${finalNote}`
        : action === "submit_approval"
          ? `${request.request_no} was submitted by Procurement to Approver / MD.`
          : `${request.request_no} was reviewed by the Procurement Manager.`;
      const sectionTarget = action === "return" ? "Returned Requests" : "My Activity History";

      await tx`
        INSERT INTO notifications (
          user_id, role, title, message, entity_type, entity_id,
          is_read, popup_shown, importance, delivery_channel,
          push_sent, email_sent, action_label, section_target, created_at
        ) VALUES (
          ${request.facility_manager_user_id}, NULL, ${title}, ${message},
          'Purchase Request', ${requestId}, FALSE, FALSE,
          ${action === "return" ? "High" : "Normal"}, 'in_app', FALSE, FALSE,
          ${action === "return" ? "Open Returned Requests" : "Open Request"}, ${sectionTarget}, ${now}
        )
      `;
    }

    if (action === "submit_approval") {
      await tx`
        INSERT INTO notifications (
          user_id, role, title, message, entity_type, entity_id,
          is_read, popup_shown, importance, delivery_channel,
          push_sent, email_sent, action_label, section_target, created_at
        ) VALUES (
          NULL, 'Approver', 'Request submitted for approval',
          ${`${request.request_no} requires final approval.`},
          'Purchase Request', ${requestId}, FALSE, FALSE, 'High', 'in_app', FALSE, FALSE,
          'Open Pending Approvals', 'Pending Approvals', ${now}
        )
      `;
      await tx`
        INSERT INTO notifications (
          user_id, role, title, message, entity_type, entity_id,
          is_read, popup_shown, importance, delivery_channel,
          push_sent, email_sent, action_label, section_target, created_at
        ) VALUES (
          NULL, 'Admin', 'Request submitted for approval',
          ${`${request.request_no} requires approval / oversight.`},
          'Purchase Request', ${requestId}, FALSE, FALSE, 'Important', 'in_app', FALSE, FALSE,
          'Open Request', 'All Procurement Records', ${now}
        )
      `;
    }

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', ${`Audit activity: ${policy.event}`},
        ${`${user.role} performed ${policy.event} on ${request.request_no}.`},
        'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
    `;

    return { requestId, requestNo: request.request_no, status: policy.status, nextRole: policy.nextRole };
  });
}

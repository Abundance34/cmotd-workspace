import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const SOURCING_ELIGIBLE = new Set([
  "Sent for Procurement Review",
  "Submitted to Procurement Manager",
  "Submitted",
  "Procurement Review",
  "Reviewed by Procurement",
  "Requires Sourcing",
  "Vendor Quote Collection",
]);

type RequestRecord = {
  id: number;
  request_no: string;
  facility_manager_user_id: number | null;
  assigned_procurement_manager_id: number | null;
  status: string | null;
  next_role: string | null;
  justification: string | null;
  estimated_amount: string | number | null;
  department_project: string | null;
  linked_sourcing_task_id: number | null;
};

function sourcingNumber(now = new Date()) {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `SRC-${date}-${time}-${pad(now.getUTCMilliseconds(), 3)}`;
}

export async function startProcurementSourcing(user: CurrentUser, requestId: number, note = "") {
  if (user.role !== "Procurement Manager" && user.role !== "Admin") {
    throw new Error("Only Procurement Manager or Admin can start sourcing.");
  }
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid request is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<RequestRecord[]>`
      SELECT id, request_no, facility_manager_user_id, assigned_procurement_manager_id,
             status, next_role, justification, estimated_amount, department_project,
             linked_sourcing_task_id
      FROM purchase_requests
      WHERE id = ${requestId}
      FOR UPDATE
    `;
    const request = rows[0];
    if (!request) throw new Error("Request not found.");

    const oldStatus = String(request.status || "");
    if (!SOURCING_ELIGIBLE.has(oldStatus)) {
      throw new Error(`Sourcing cannot be started from status '${oldStatus || "Unknown"}'.`);
    }
    if (
      user.role !== "Admin" &&
      request.assigned_procurement_manager_id &&
      Number(request.assigned_procurement_manager_id) !== user.id
    ) {
      throw new Error("This request is assigned to another Procurement Manager.");
    }

    const now = new Date().toISOString();
    const finalNote = note.trim() || "Procurement Manager opened vendor quote collection for this request.";
    const pmId = Number(request.assigned_procurement_manager_id || user.id);

    const existing = await tx<{ id: number; sourcing_no: string; status: string | null }[]>`
      SELECT id, sourcing_no, status
      FROM sourcing_tasks
      WHERE request_id = ${requestId}
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `;

    let sourcingTaskId: number;
    let sourcingNo: string;
    let created = false;

    if (existing[0]) {
      sourcingTaskId = Number(existing[0].id);
      sourcingNo = existing[0].sourcing_no;
      await tx`
        UPDATE sourcing_tasks
        SET assigned_to = ${pmId},
            updated_at = ${now}
        WHERE id = ${sourcingTaskId}
      `;
    } else {
      sourcingNo = sourcingNumber();
      const collision = await tx<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM sourcing_tasks WHERE sourcing_no = ${sourcingNo}) AS exists
      `;
      if (collision[0]?.exists) sourcingNo = `${sourcingNo}-${String(user.id).padStart(2, "0")}`;

      const inserted = await tx<{ id: number }[]>`
        INSERT INTO sourcing_tasks (
          sourcing_no, request_id, required_item_service, assigned_to,
          status, approval_status, created_at, updated_at
        ) VALUES (
          ${sourcingNo}, ${requestId}, ${request.justification || request.department_project || request.request_no},
          ${pmId}, 'Open', 'Pending', ${now}, ${now}
        )
        RETURNING id
      `;
      sourcingTaskId = Number(inserted[0].id);
      created = true;

      await tx`
        INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
        VALUES ('Sourcing Task', ${sourcingTaskId}, 'Created', 'Open', ${sourcingNo}, ${user.id}, ${now})
      `;

      await appendAuditEvent(tx, {
        action: "SOURCING_TASK_CREATED",
        entityType: "Sourcing Task",
        entityId: sourcingTaskId,
        entityReference: sourcingNo,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        afterValues: {
          request_id: requestId,
          status: "Open",
          approval_status: "Pending",
          assigned_to: pmId,
        },
        metadata: { request_no: request.request_no },
        reasonOrComment: finalNote,
        source: "nextjs",
      });
    }

    const newStatus = oldStatus === "Vendor Recommendation" ? oldStatus : "Vendor Quote Collection";

    await tx`
      UPDATE purchase_requests
      SET linked_sourcing_task_id = ${sourcingTaskId},
          assigned_procurement_manager_id = ${pmId},
          next_role = 'procurement_manager',
          status = ${newStatus},
          updated_at = ${now}
      WHERE id = ${requestId}
    `;

    if (oldStatus !== "Vendor Quote Collection") {
      await tx`
        INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
        VALUES ('Purchase Request', ${requestId}, 'Sourcing Required', ${newStatus}, ${finalNote}, ${user.id}, ${now})
      `;

      await tx`
        INSERT INTO activity_logs (
          user_id, role, action, entity_type, entity_id,
          public_summary, private_details, visibility_scope, related_user_id, created_at
        ) VALUES (
          ${user.id}, ${user.role}, 'Sourcing Required', 'Purchase Request', ${requestId},
          ${`${request.request_no} moved from ${oldStatus} to ${newStatus}`},
          ${finalNote}, 'workflow', ${request.facility_manager_user_id}, ${now}
        )
      `;

      await tx`
        INSERT INTO approval_history (
          entity_type, entity_id, action, status_before, status_after,
          reason, user_id, approved_by_user_id, approved_by_role,
          approval_mode, note, created_at
        ) VALUES (
          'Purchase Request', ${requestId}, 'Sourcing Required', ${oldStatus}, ${newStatus},
          ${finalNote}, ${user.id}, ${user.id}, ${user.role},
          'Procurement Sourcing', ${finalNote}, ${now}
        )
      `;

      await tx`
        INSERT INTO audit_logs (
          action, entity_type, entity_id, user_id, role, details,
          before_values, after_values, created_at, event_date, event_time,
          amount, department, notes
        ) VALUES (
          'Sourcing Required', 'Purchase Request', ${String(requestId)}, ${user.id}, ${user.role}, ${finalNote},
          ${tx.json({ status: oldStatus, next_role: request.next_role, linked_sourcing_task_id: request.linked_sourcing_task_id })},
          ${tx.json({ status: newStatus, next_role: "procurement_manager", linked_sourcing_task_id: sourcingTaskId })},
          ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
          ${Number(request.estimated_amount || 0)}, ${request.department_project}, ${finalNote}
        )
      `;

      await appendAuditEvent(tx, {
        action: "Sourcing Required",
        entityType: "Purchase Request",
        entityId: requestId,
        entityReference: request.request_no,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        beforeValues: {
          status: oldStatus,
          next_role: request.next_role,
          linked_sourcing_task_id: request.linked_sourcing_task_id,
        },
        afterValues: {
          status: newStatus,
          next_role: "procurement_manager",
          linked_sourcing_task_id: sourcingTaskId,
        },
        metadata: {
          sourcing_task_id: sourcingTaskId,
          sourcing_no: sourcingNo,
          amount: Number(request.estimated_amount || 0),
          department: request.department_project,
        },
        reasonOrComment: finalNote,
        source: "nextjs",
      });
    }

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        ${pmId}, NULL, 'Sourcing task ready',
        ${`${request.request_no} is ready for vendor quote collection.`},
        'Sourcing Task', ${sourcingTaskId}, FALSE, FALSE, 'Important', 'in_app', FALSE, FALSE,
        'Open Sourcing', 'Sourcing', ${now}
      )
    `;

    if (request.facility_manager_user_id) {
      await tx`
        INSERT INTO notifications (
          user_id, role, title, message, entity_type, entity_id,
          is_read, popup_shown, importance, delivery_channel,
          push_sent, email_sent, action_label, section_target, created_at
        ) VALUES (
          ${request.facility_manager_user_id}, NULL, 'Procurement sourcing started',
          ${`${request.request_no} has moved into vendor quote collection.`},
          'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
          'Open Request', 'My Activity History', ${now}
        )
      `;
    }

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', 'Audit activity: Sourcing Required',
        ${`${user.role} opened sourcing ${sourcingNo} for ${request.request_no}.`},
        'Sourcing Task', ${sourcingTaskId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
    `;

    return {
      requestId,
      requestNo: request.request_no,
      status: newStatus,
      sourcingTaskId,
      sourcingNo,
      created,
    };
  });
}

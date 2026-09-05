import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

export type ApproverRequestDecision = "approve" | "reject" | "return";

type RequestRecord = {
  id: number;
  request_no: string;
  status: string | null;
  next_role: string | null;
  requested_by: number;
  requester_role: string | null;
  facility_manager_user_id: number | null;
  assigned_procurement_manager_id: number | null;
  linked_sourcing_task_id: number | null;
  estimated_amount: string | number | null;
  department_project: string | null;
  payment_status: string | null;
};

function assertApprover(user: CurrentUser) {
  if (user.role !== "Approver" && user.role !== "Admin") {
    throw new Error("Only Approver / MD or Admin can make this decision.");
  }
}

export async function decidePurchaseRequest(
  user: CurrentUser,
  requestId: number,
  decision: ApproverRequestDecision,
  note = "",
) {
  assertApprover(user);
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid purchase request is required.");
  if (!["approve", "reject", "return"].includes(decision)) throw new Error("Unsupported approval decision.");
  if ((decision === "reject" || decision === "return") && !note.trim()) {
    throw new Error(decision === "reject" ? "A rejection reason is required." : "A return reason is required.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<RequestRecord[]>`
      SELECT pr.id, pr.request_no, pr.status, pr.next_role, pr.requested_by,
             requester.role AS requester_role, pr.facility_manager_user_id,
             pr.assigned_procurement_manager_id, pr.linked_sourcing_task_id,
             pr.estimated_amount, pr.department_project, pr.payment_status
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id=pr.requested_by
      WHERE pr.id=${requestId}
      FOR UPDATE OF pr
    `;
    const request = rows[0];
    if (!request) throw new Error("Purchase request not found.");

    const oldStatus = String(request.status || "");
    if (!["Submitted for Approval", "Pending Approver/MD Approval", "Pending Approval"].includes(oldStatus)) {
      throw new Error(`This request cannot be decided from status '${oldStatus || "Unknown"}'.`);
    }

    const policyRows = await tx<{ amount: string | number }[]>`
      SELECT amount FROM approval_policy_settings
      WHERE policy_key='procurement_manager_approval_limit'
      LIMIT 1
    `;
    if (!policyRows[0]) throw new Error("Procurement Manager approval policy is not configured.");
    const approvalLimit = Number(policyRows[0].amount || 0);
    const amount = Number(request.estimated_amount || 0);
    const pmOriginated = request.requester_role === "Procurement Manager";
    if (amount <= approvalLimit && !pmOriginated && user.role !== "Admin") {
      throw new Error("This is a low-value Facility / Utility request and belongs to Procurement Manager approval, not Approver / MD.");
    }

    const now = new Date().toISOString();
    const hasRecommendation = request.linked_sourcing_task_id != null;
    const approvalMode = pmOriginated && amount <= approvalLimit
      ? "Segregation of Duties — PM-Originated Request"
      : "Normal Approval Mode";

    const newStatus = decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Returned for Correction";
    const event = decision === "approve"
      ? (hasRecommendation ? "Approved Vendor Recommendation" : "Approved")
      : decision === "reject" ? "Rejected" : (hasRecommendation ? "Vendor Recommendation Returned" : "Returned for Correction");
    const finalNote = note.trim() || (decision === "approve"
      ? (hasRecommendation ? "Vendor recommendation approved by Approver / MD" : "Approved")
      : decision === "reject" ? "Rejected" : "Returned for correction");
    const nextRole = decision === "approve" ? "finance" : decision === "return" ? "procurement_manager" : null;
    const paymentStatus = decision === "approve" ? "Approved for Payment" : request.payment_status;

    await tx`
      UPDATE purchase_requests
      SET status=${newStatus},
          next_role=${nextRole},
          payment_status=${paymentStatus},
          approved_at=${decision === "approve" ? now : null},
          approved_by_user_id=${decision === "approve" ? user.id : null},
          approved_by_role=${decision === "approve" ? user.role : null},
          updated_at=${now}
      WHERE id=${requestId}
    `;

    if (request.linked_sourcing_task_id) {
      await tx`
        UPDATE sourcing_tasks
        SET approval_status=${decision === "approve" ? "Approved" : decision === "return" ? "Returned" : "Rejected"},
            updated_at=${now}
        WHERE id=${request.linked_sourcing_task_id}
      `;
    }

    await tx`
      INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
      VALUES ('Purchase Request',${requestId},${event},${newStatus},${finalNote},${user.id},${now})
    `;

    await tx`
      INSERT INTO approval_history (
        entity_type,entity_id,action,status_before,status_after,reason,user_id,
        approved_by_user_id,approved_by_role,approval_mode,note,created_at
      ) VALUES (
        'Purchase Request',${requestId},${event},${oldStatus},${newStatus},${finalNote},${user.id},
        ${user.id},${user.role},${approvalMode},${finalNote},${now}
      )
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,
        visibility_scope,related_user_id,created_at
      ) VALUES (
        ${user.id},${user.role},${event},'Purchase Request',${requestId},
        ${`${request.request_no} moved from ${oldStatus} to ${newStatus}`},${finalNote},
        'workflow',${request.facility_manager_user_id},${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,amount,department,notes
      ) VALUES (
        ${event},'Purchase Request',${String(requestId)},${user.id},${user.role},${finalNote},
        ${tx.json({status:oldStatus,next_role:request.next_role,payment_status:request.payment_status})},
        ${tx.json({status:newStatus,next_role:nextRole,payment_status:paymentStatus,approval_mode:approvalMode})},
        ${now},${now.slice(0,10)},${now.slice(11,19)},${amount},${request.department_project},${finalNote}
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
      beforeValues: { status: oldStatus, next_role: request.next_role, payment_status: request.payment_status },
      afterValues: { status: newStatus, next_role: nextRole, payment_status: paymentStatus, approval_mode: approvalMode },
      metadata: {
        amount,
        department: request.department_project,
        requester_role: request.requester_role,
        sourcing_task_id: request.linked_sourcing_task_id,
        approval_limit: approvalLimit,
      },
      reasonOrComment: finalNote,
      source: "nextjs",
    });

    if (request.assigned_procurement_manager_id) {
      await tx`
        INSERT INTO notifications (
          user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
          importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
        ) VALUES (
          ${request.assigned_procurement_manager_id},NULL,
          ${decision === "approve" ? "Request approved by Approver / MD" : decision === "reject" ? "Request rejected by Approver / MD" : "Request returned by Approver / MD"},
          ${`${request.request_no} was ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "returned for correction"}. ${finalNote}`},
          'Purchase Request',${requestId},FALSE,FALSE,
          ${decision === "approve" ? "Important" : "High"},'in_app',FALSE,FALSE,
          'Open Purchase Request','Purchase Requests',${now}
        )
      `;
    }

    if (request.facility_manager_user_id) {
      await tx`
        INSERT INTO notifications (
          user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
          importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
        ) VALUES (
          ${request.facility_manager_user_id},NULL,
          ${decision === "approve" ? "Request approved" : decision === "reject" ? "Request rejected" : "Request returned for correction"},
          ${`${request.request_no} was ${decision === "approve" ? "approved by Approver / MD" : decision === "reject" ? "rejected" : "returned for correction"}. ${finalNote}`},
          'Purchase Request',${requestId},FALSE,FALSE,
          ${decision === "approve" ? "Important" : "High"},'in_app',FALSE,FALSE,
          'Open Request',${decision === "return" ? "Returned Requests" : "My Activity History"},${now}
        )
      `;
    }

    if (decision === "approve") {
      await tx`
        INSERT INTO notifications (
          user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
          importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
        ) VALUES (
          NULL,'Finance','Request approved for payment',${`${request.request_no} was approved by Approver / MD and is ready for Finance processing.`},
          'Purchase Request',${requestId},FALSE,FALSE,'High','in_app',FALSE,FALSE,
          'Open Approved for Payment','Approved for Payment',${now}
        )
      `;
    }

    await tx`
      INSERT INTO notifications (
        user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
        importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
      ) VALUES (
        NULL,'Admin',${`Request ${newStatus}`},${`${request.request_no} was ${newStatus.toLowerCase()} by ${user.role}.`},
        'Purchase Request',${requestId},FALSE,FALSE,'Important','in_app',FALSE,FALSE,
        'Open Procurement Records','All Procurement Records',${now}
      )
    `;
    await tx`
      INSERT INTO notifications (
        user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
        importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
      ) VALUES (
        NULL,'Auditor',${`Audit activity: ${event}`},${`${user.role} performed ${event} on ${request.request_no}.`},
        'Purchase Request',${requestId},FALSE,FALSE,'Normal','in_app',FALSE,FALSE,
        'Open Approval Trails','Approval Trails',${now}
      )
    `;

    return {
      requestId,
      requestNo: request.request_no,
      status: newStatus,
      nextRole,
      paymentStatus,
      approvalMode,
      sourcingTaskId: request.linked_sourcing_task_id == null ? null : Number(request.linked_sourcing_task_id),
    };
  });
}

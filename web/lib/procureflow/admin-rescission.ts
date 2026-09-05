import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

function requireAdmin(user: CurrentUser) {
  if (user.role !== "Admin") throw new Error("Only Admin can rescind an approval from this control.");
}

function requireReason(value: string) {
  const reason = String(value || "").trim().replace(/\s+/g, " ");
  if (reason.length < 5) throw new Error("A meaningful rescind reason is required.");
  return reason;
}

function ref(prefix: string) {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function recordAdminIntervention(
  tx: any,
  user: CurrentUser,
  requestId: number,
  requestNo: string,
  reason: string,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const interventionNo = ref("ADM-INT");
  const correlationId = ref("ADM-CORR");
  const rows = await tx<{ id: number }[]>`
    INSERT INTO admin_interventions (
      intervention_no,intervention_type,entity_type,entity_id,severity,reason,
      before_state_json,after_state_json,actor_user_id,actor_role,correlation_id,created_at
    ) VALUES (
      ${interventionNo},'Rescind Granted Approval','Purchase Request',${requestId},'High',${reason},
      ${JSON.stringify(beforeState)},${JSON.stringify(afterState)},${user.id},'Admin',${correlationId},${now}
    ) RETURNING id
  `;
  await tx`
    INSERT INTO activity_logs (
      user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,created_at
    ) VALUES (
      ${user.id},'Admin','ADMIN_INTERVENTION','Purchase Request',${requestId},
      ${`Rescind Granted Approval recorded as ${interventionNo}`},${reason},'admin',${now}
    )
  `;
  await tx`
    INSERT INTO audit_logs (
      action,entity_type,entity_id,user_id,role,details,before_values,after_values,
      created_at,event_date,event_time,notes
    ) VALUES (
      'ADMIN_INTERVENTION_RESCIND_GRANTED_APPROVAL','Purchase Request',${String(requestId)},${user.id},'Admin',${reason},
      ${tx.json(beforeState)},${tx.json(afterState)},${now},${now.slice(0,10)},${now.slice(11,19)},${reason}
    )
  `;
  await appendAuditEvent(tx, {
    action: "ADMIN_INTERVENTION_RESCIND_GRANTED_APPROVAL",
    entityType: "Purchase Request",
    entityId: requestId,
    entityReference: requestNo,
    actorUserId: user.id,
    actorUsername: user.username,
    actorRole: "Admin",
    beforeValues: beforeState,
    afterValues: afterState,
    metadata: { intervention_no: interventionNo, correlation_id: correlationId },
    reasonOrComment: reason,
    severity: "High",
    source: "nextjs-admin",
  });
  return { interventionId: Number(rows[0].id), interventionNo, correlationId };
}

export async function rescindRequestApproval(
  user: CurrentUser,
  requestId: number,
  reasonInput: string,
) {
  requireAdmin(user);
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid purchase request is required.");
  const reason = requireReason(reasonInput);
  const sql = db();

  return sql.begin(async (tx) => {
    const requests = await tx<any[]>`
      SELECT id,request_no,status,next_role,payment_status,paid_at,requested_by,
             facility_manager_user_id,assigned_procurement_manager_id,approved_at,
             approved_by_user_id,approved_by_role
      FROM purchase_requests
      WHERE id=${requestId}
      FOR UPDATE
    `;
    const request = requests[0];
    if (!request) throw new Error("Purchase request not found.");

    const approvals = await tx<any[]>`
      SELECT id,approved_by_user_id,user_id,approved_by_role,created_at
      FROM approval_history
      WHERE entity_type='Purchase Request' AND entity_id=${requestId} AND status_after='Approved'
      ORDER BY created_at DESC,id DESC
      LIMIT 1
    `;
    const approval = approvals[0];
    if (!approval) throw new Error("No granted approval is available to rescind.");

    const paymentRows = await tx<any[]>`
      SELECT id,status,payment_date
      FROM payments
      WHERE request_id=${requestId} AND (status='Paid' OR payment_date IS NOT NULL)
      ORDER BY id DESC
      LIMIT 1
    `;
    if (paymentRows[0] || String(request.payment_status || "") === "Paid" || request.paid_at) {
      throw new Error("Approval cannot be rescinded after payment has been recorded.");
    }

    const existing = await tx<any[]>`
      SELECT id FROM approval_rescissions
      WHERE entity_type='Purchase Request' AND entity_id=${requestId} AND approval_history_id=${approval.id}
      LIMIT 1
    `;
    if (existing[0]) throw new Error("This approval has already been rescinded.");

    const previousStatus = String(request.status || "Approved");
    const newStatus = "Pending Approval";
    const now = new Date().toISOString();
    const originalApproverUserId = approval.approved_by_user_id || approval.user_id || request.approved_by_user_id || null;
    const originalApproverRole = approval.approved_by_role || request.approved_by_role || null;
    const originalApprovalAt = approval.created_at || request.approved_at || null;

    const rescissionRows = await tx<{ id:number }[]>`
      INSERT INTO approval_rescissions (
        entity_type,entity_id,approval_history_id,rescinded_by_user_id,rescinded_by_role,
        original_approver_user_id,original_approver_role,original_approval_at,reason,
        previous_status,new_status,created_at
      ) VALUES (
        'Purchase Request',${requestId},${approval.id},${user.id},'Admin',
        ${originalApproverUserId},${originalApproverRole},${originalApprovalAt},${reason},
        ${previousStatus},${newStatus},${now}
      ) RETURNING id
    `;
    const rescissionId = Number(rescissionRows[0].id);

    await tx`
      UPDATE purchase_requests
      SET status=${newStatus},next_role='approver',payment_status=NULL,
          approval_rescinded_at=${now},approval_rescinded_reason=${reason},updated_at=${now}
      WHERE id=${requestId}
    `;
    await tx`
      UPDATE payments
      SET status='Returned',next_role='approver',
          finance_note=COALESCE(finance_note,'') || ${`\nApproval rescinded: ${reason}`},updated_at=${now}
      WHERE request_id=${requestId} AND status NOT IN ('Paid','Completed')
    `;
    await tx`
      INSERT INTO approval_history (
        entity_type,entity_id,action,status_before,status_after,reason,user_id,
        approved_by_user_id,approved_by_role,approval_mode,note,created_at
      ) VALUES (
        'Purchase Request',${requestId},'Approval Rescinded',${previousStatus},${newStatus},${reason},${user.id},
        ${user.id},'Admin','Approval Rescission',${reason},${now}
      )
    `;
    await tx`
      INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
      VALUES ('Purchase Request',${requestId},'Approval Rescinded',${newStatus},${reason},${user.id},${now})
    `;
    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at
      ) VALUES (
        ${user.id},'Admin','Approval Rescinded','Purchase Request',${requestId},
        ${`${request.request_no} approval was rescinded.`},${reason},'workflow',${request.requested_by},${now}
      )
    `;
    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,notes
      ) VALUES (
        'APPROVAL_RESCINDED','Purchase Request',${String(requestId)},${user.id},'Admin',${reason},
        ${tx.json({status:previousStatus,payment_status:request.payment_status,approval_history_id:Number(approval.id)})},
        ${tx.json({status:newStatus,rescind_reason:reason,rescission_id:rescissionId})},
        ${now},${now.slice(0,10)},${now.slice(11,19)},${reason}
      )
    `;
    await appendAuditEvent(tx, {
      action: "APPROVAL_RESCINDED",
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: request.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: "Admin",
      beforeValues: { status: previousStatus, payment_status: request.payment_status, approval_history_id: Number(approval.id) },
      afterValues: { status: newStatus, rescind_reason: reason, rescission_id: rescissionId },
      reasonOrComment: reason,
      severity: "High",
      source: "nextjs-admin-rescission",
    });

    const intervention = await recordAdminIntervention(
      tx,
      user,
      requestId,
      request.request_no,
      reason,
      { status: previousStatus, next_role: request.next_role, payment_status: request.payment_status, approval_history_id: Number(approval.id) },
      { status: newStatus, next_role: "approver", payment_status: null, rescission_id: rescissionId },
    );

    const participantIds = Array.from(new Set([
      request.requested_by,
      request.facility_manager_user_id,
      request.assigned_procurement_manager_id,
      originalApproverUserId,
    ].filter((value): value is number => Number.isInteger(Number(value)) && Number(value) > 0).map(Number)));

    for (const participantId of participantIds) {
      await tx`
        INSERT INTO notifications (
          user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
          delivery_channel,push_sent,email_sent,action_label,section_target,created_at
        ) VALUES (
          ${participantId},NULL,'Approval Rescinded',
          ${`${request.request_no} approval was rescinded and returned for review. Reason: ${reason}`},
          'Purchase Request',${requestId},FALSE,FALSE,'High','in_app',FALSE,FALSE,
          'View Request','My Activity History',${now}
        )
      `;
    }
    await tx`
      INSERT INTO notifications (
        user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
        delivery_channel,push_sent,email_sent,action_label,section_target,created_at
      ) VALUES (
        NULL,'Approver','Approval rescinded — review required',
        ${`${request.request_no} was returned to approval after an Admin rescission.`},
        'Purchase Request',${requestId},FALSE,FALSE,'High','in_app',FALSE,FALSE,
        'Open Pending Approvals','Pending Approvals',${now}
      )
    `;
    await tx`
      INSERT INTO notifications (
        user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
        delivery_channel,push_sent,email_sent,action_label,section_target,created_at
      ) VALUES (
        NULL,'Auditor','Audit activity: Approval Rescinded',
        ${`Admin rescinded approval on ${request.request_no}.`},
        'Purchase Request',${requestId},FALSE,FALSE,'High','in_app',FALSE,FALSE,
        'Open Approval Trails','Approval Trails',${now}
      )
    `;

    return {
      ...intervention,
      requestId,
      requestNo: request.request_no,
      rescissionId,
      status: newStatus,
      nextRole: "approver",
      reason,
    };
  });
}

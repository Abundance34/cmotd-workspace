import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const APPROVAL_LIMIT_POLICY_KEY = "procurement_manager_approval_limit";

export type AdminUserSecurityAction =
  | "Lock Account"
  | "Unlock Account"
  | "Suspend Access"
  | "Restore Access"
  | "Force Password Change"
  | "Terminate Active Sessions";

export type AdminRequestInterventionAction =
  | "Correct Request Routing"
  | "Reassign Procurement Manager"
  | "Return for Correction"
  | "Return to Procurement Review"
  | "Release Stuck Approval"
  | "Reopen Completed / Closed / Archived"
  | "Cancel Duplicate Request"
  | "Emergency Approve Request"
  | "Emergency Reject Request";

function assertAdmin(user: CurrentUser) {
  if (user.role !== "Admin") throw new Error("Only Admin can perform this intervention.");
}

function meaningfulReason(value: string) {
  const reason = String(value || "").trim().replace(/\s+/g, " ");
  if (reason.length < 5) throw new Error("A meaningful reason is required for every Admin intervention.");
  return reason;
}

function interventionRef(prefix: string) {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeApprovalAmount(value: string | number) {
  const clean = String(value ?? "").trim().replace(/[₦,\s]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(clean) || !/[1-9]/.test(clean)) {
    throw new Error("Approval limit must be a valid positive monetary amount.");
  }
  return clean;
}

function canonicalDecimal(value: string | number) {
  const raw = String(value ?? "").trim();
  const [wholeRaw, fractionRaw = ""] = raw.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function canonicalStatus(value: string | null | undefined) {
  const status = String(value || "");
  const aliases: Record<string, string> = {
    "FM Draft": "Draft",
    Submitted: "Sent for Procurement Review",
    "Submitted to Procurement Manager": "Sent for Procurement Review",
    "Procurement Review": "Sent for Procurement Review",
    "PM Reviewing": "Reviewed by Procurement",
    "Accepted by Procurement Manager": "Reviewed by Procurement",
    Returned: "Returned for Correction",
    "Returned to Facility Manager": "Returned for Correction",
    "Pending Approver/MD Approval": "Submitted for Approval",
    "Pending Approval": "Submitted for Approval",
    "Approved for Payment": "Awaiting Payment",
    "Finance Review": "Awaiting Payment",
    "Payment Approved": "Awaiting Payment",
    Generated: "Completed",
    Downloaded: "Completed",
  };
  return aliases[status] || status;
}

function routeForStatus(statusInput: string | null | undefined, amount: number, approvalLimit: number) {
  const status = canonicalStatus(statusInput);
  if (status === "Returned for Correction") return "facility_manager";
  if (["Sent for Procurement Review", "Reviewed by Procurement", "Requires Sourcing", "Vendor Quote Collection", "Vendor Recommendation"].includes(status)) {
    return "procurement_manager";
  }
  if (status === "Submitted for Approval") return amount <= approvalLimit ? "procurement_manager" : "approver";
  if (["Approved", "Awaiting Payment"].includes(status)) return "finance";
  if (["Paid", "Receipt Uploaded", "Payment Submitted for Verification", "Completed"].includes(status)) return "procurement_manager";
  if (["Closed", "Archived"].includes(status)) return "auditor";
  return null;
}

async function recordIntervention(
  tx: any,
  input: {
    user: CurrentUser;
    interventionType: string;
    entityType: string;
    entityId?: number | null;
    targetUserId?: number | null;
    reason: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    severity?: string;
  },
) {
  const now = new Date().toISOString();
  const interventionNo = interventionRef("ADM-INT");
  const correlationId = interventionRef("ADM-CORR");
  const severity = input.severity || "High";
  const beforeState = input.beforeState || {};
  const afterState = input.afterState || {};

  const rows = await tx<{ id: number }[]>`
    INSERT INTO admin_interventions (
      intervention_no,intervention_type,entity_type,entity_id,target_user_id,severity,reason,
      before_state_json,after_state_json,actor_user_id,actor_role,correlation_id,created_at
    ) VALUES (
      ${interventionNo},${input.interventionType},${input.entityType},${input.entityId ?? null},${input.targetUserId ?? null},
      ${severity},${input.reason},${JSON.stringify(beforeState)},${JSON.stringify(afterState)},${input.user.id},'Admin',${correlationId},${now}
    ) RETURNING id
  `;

  await tx`
    INSERT INTO activity_logs (
      user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at
    ) VALUES (
      ${input.user.id},'Admin','ADMIN_INTERVENTION',${input.entityType},${input.entityId ?? null},
      ${`${input.interventionType} recorded as ${interventionNo}`},${input.reason},'admin',${input.targetUserId ?? null},${now}
    )
  `;

  await tx`
    INSERT INTO audit_logs (
      action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes
    ) VALUES (
      ${`ADMIN_INTERVENTION_${input.interventionType.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`},
      ${input.entityType},${input.entityId == null ? null : String(input.entityId)},${input.user.id},'Admin',
      ${input.reason},${tx.json(beforeState)},${tx.json(afterState)},${now},${now.slice(0,10)},${now.slice(11,19)},${input.reason}
    )
  `;

  await appendAuditEvent(tx, {
    action: `ADMIN_INTERVENTION_${input.interventionType.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityReference: interventionNo,
    actorUserId: input.user.id,
    actorUsername: input.user.username,
    actorRole: "Admin",
    beforeValues: beforeState,
    afterValues: afterState,
    metadata: { intervention_no: interventionNo, correlation_id: correlationId, target_user_id: input.targetUserId ?? null },
    reasonOrComment: input.reason,
    severity,
    source: "nextjs-admin",
  });

  return { interventionId: Number(rows[0].id), interventionNo, correlationId };
}

async function notifyUser(tx: any, userId: number, title: string, message: string, entityType: string, entityId: number, actionLabel: string) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
      delivery_channel,push_sent,email_sent,action_label,created_at
    ) VALUES (
      ${userId},NULL,${title},${message},${entityType},${entityId},FALSE,FALSE,'High','in_app',FALSE,FALSE,${actionLabel},${now}
    )
  `;
}

async function notifyRole(tx: any, role: string, title: string, message: string, entityType: string, entityId: number, actionLabel: string, sectionTarget: string) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
      delivery_channel,push_sent,email_sent,action_label,section_target,created_at
    ) VALUES (
      NULL,${role},${title},${message},${entityType},${entityId},FALSE,FALSE,'High','in_app',FALSE,FALSE,
      ${actionLabel},${sectionTarget},${now}
    )
  `;
}

export async function adminUserSecurityAction(
  user: CurrentUser,
  targetUserId: number,
  action: AdminUserSecurityAction,
  reasonInput: string,
) {
  assertAdmin(user);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error("A valid target user is required.");
  const reason = meaningfulReason(reasonInput);
  const allowed: AdminUserSecurityAction[] = [
    "Lock Account","Unlock Account","Suspend Access","Restore Access","Force Password Change","Terminate Active Sessions",
  ];
  if (!allowed.includes(action)) throw new Error("Unsupported Admin security action.");
  if (targetUserId === user.id && ["Lock Account","Suspend Access","Terminate Active Sessions"].includes(action)) {
    throw new Error("Admin cannot lock, suspend, or terminate their own current account from this page.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<{
      id:number;username:string;full_name:string;role:string;is_active:boolean;must_change_password:boolean;
      account_locked:boolean;failed_login_count:number;
    }[]>`
      SELECT id,username,full_name,role,is_active,must_change_password,
             COALESCE(account_locked,FALSE) account_locked,COALESCE(failed_login_count,0)::int failed_login_count
      FROM users WHERE id=${targetUserId} FOR UPDATE
    `;
    const target = rows[0];
    if (!target) throw new Error("Selected user was not found.");
    const before = { username:target.username,full_name:target.full_name,role:target.role,is_active:target.is_active,must_change_password:target.must_change_password,account_locked:target.account_locked,failed_login_count:target.failed_login_count };
    const now = new Date().toISOString();

    if (action === "Lock Account") {
      await tx`UPDATE users SET account_locked=TRUE,updated_at=${now} WHERE id=${targetUserId}`;
      await tx`UPDATE user_sessions SET status='Terminated by Admin',logout_at=${now},last_seen_at=${now},updated_at=${now} WHERE user_id=${targetUserId} AND status='Active'`;
    } else if (action === "Unlock Account") {
      await tx`UPDATE users SET account_locked=FALSE,failed_login_count=0,updated_at=${now} WHERE id=${targetUserId}`;
    } else if (action === "Suspend Access") {
      await tx`UPDATE users SET is_active=FALSE,updated_at=${now} WHERE id=${targetUserId}`;
      await tx`UPDATE user_sessions SET status='Terminated by Admin',logout_at=${now},last_seen_at=${now},updated_at=${now} WHERE user_id=${targetUserId} AND status='Active'`;
    } else if (action === "Restore Access") {
      await tx`UPDATE users SET is_active=TRUE,updated_at=${now} WHERE id=${targetUserId}`;
    } else if (action === "Force Password Change") {
      await tx`UPDATE users SET must_change_password=TRUE,updated_at=${now} WHERE id=${targetUserId}`;
      if (targetUserId !== user.id) {
        await tx`UPDATE user_sessions SET status='Password Reset Required',logout_at=${now},last_seen_at=${now},updated_at=${now} WHERE user_id=${targetUserId} AND status='Active'`;
      }
    } else if (action === "Terminate Active Sessions") {
      await tx`UPDATE user_sessions SET status='Terminated by Admin',logout_at=${now},last_seen_at=${now},updated_at=${now} WHERE user_id=${targetUserId} AND status='Active'`;
    }

    const afterRows = await tx<any[]>`
      SELECT username,full_name,role,is_active,must_change_password,
             COALESCE(account_locked,FALSE) account_locked,COALESCE(failed_login_count,0)::int failed_login_count
      FROM users WHERE id=${targetUserId}
    `;
    const after = afterRows[0] || {};
    const intervention = await recordIntervention(tx, { user, interventionType:action, entityType:"User", entityId:targetUserId, targetUserId, reason, beforeState:before, afterState:after, severity:"High" });
    await notifyUser(tx, targetUserId, "Account security action", `Admin performed '${action}' on your account. Reason: ${reason}`, "User", targetUserId, "Open Settings");
    return { ...intervention, targetUserId, action };
  });
}

export async function setProcurementManagerApprovalLimit(
  user: CurrentUser,
  amountInput: string | number,
  reasonInput: string,
) {
  assertAdmin(user);
  const reason = meaningfulReason(reasonInput);
  const newAmount = normalizeApprovalAmount(amountInput);
  const sql = db();

  return sql.begin(async (tx) => {
    const currentRows = await tx<{ amount:string|number }[]>`
      SELECT amount FROM approval_policy_settings WHERE policy_key=${APPROVAL_LIMIT_POLICY_KEY} FOR UPDATE
    `;
    if (!currentRows[0]) throw new Error("Procurement Manager approval limit configuration is missing.");
    const oldAmount = String(currentRows[0].amount);
    if (canonicalDecimal(oldAmount) === canonicalDecimal(newAmount)) {
      throw new Error("The new approval limit is the same as the current value.");
    }
    const now = new Date().toISOString();
    await tx`
      UPDATE approval_policy_settings
      SET amount=CAST(${newAmount} AS NUMERIC),updated_by=${user.id},update_reason=${reason},updated_at=${now}
      WHERE policy_key=${APPROVAL_LIMIT_POLICY_KEY}
    `;
    await tx`
      INSERT INTO approval_policy_history (policy_key,old_amount,new_amount,changed_by,change_reason,changed_at)
      VALUES (${APPROVAL_LIMIT_POLICY_KEY},CAST(${oldAmount} AS NUMERIC),CAST(${newAmount} AS NUMERIC),${user.id},${reason},${now})
    `;
    const intervention = await recordIntervention(tx, {
      user,
      interventionType:"Change Procurement Manager Approval Limit",
      entityType:"Approval Policy",
      reason,
      beforeState:{ policy_key:APPROVAL_LIMIT_POLICY_KEY, amount:oldAmount },
      afterState:{ policy_key:APPROVAL_LIMIT_POLICY_KEY, amount:newAmount },
      severity:"High",
    });
    return { ...intervention, policyKey:APPROVAL_LIMIT_POLICY_KEY, oldAmount, newAmount };
  });
}

type AdminRequestRecord = {
  id: number;
  request_no: string;
  requested_by: number | null;
  facility_manager_user_id: number | null;
  assigned_procurement_manager_id: number | null;
  linked_sourcing_task_id: number | null;
  status: string | null;
  next_role: string | null;
  payment_status: string | null;
  estimated_amount: string | number | null;
  department_project: string | null;
  approved_at: string | null;
  approved_by_user_id: number | null;
  approved_by_role: string | null;
};

export async function adminRequestIntervention(
  user: CurrentUser,
  requestId: number,
  action: AdminRequestInterventionAction,
  reasonInput: string,
  targetProcurementManagerId?: number | null,
) {
  assertAdmin(user);
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid purchase request is required.");
  const reason = meaningfulReason(reasonInput);
  const allowed: AdminRequestInterventionAction[] = [
    "Correct Request Routing",
    "Reassign Procurement Manager",
    "Return for Correction",
    "Return to Procurement Review",
    "Release Stuck Approval",
    "Reopen Completed / Closed / Archived",
    "Cancel Duplicate Request",
    "Emergency Approve Request",
    "Emergency Reject Request",
  ];
  if (!allowed.includes(action)) throw new Error("Unsupported Admin request intervention.");

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<AdminRequestRecord[]>`
      SELECT id,request_no,requested_by,facility_manager_user_id,assigned_procurement_manager_id,
             linked_sourcing_task_id,status,next_role,payment_status,estimated_amount,department_project,
             approved_at,approved_by_user_id,approved_by_role
      FROM purchase_requests
      WHERE id=${requestId}
      FOR UPDATE
    `;
    const request = rows[0];
    if (!request) throw new Error("Purchase request was not found.");

    const policyRows = await tx<{ amount: string | number }[]>`
      SELECT amount FROM approval_policy_settings
      WHERE policy_key=${APPROVAL_LIMIT_POLICY_KEY}
      LIMIT 1
    `;
    if (!policyRows[0]) throw new Error("Procurement Manager approval policy is not configured.");
    const approvalLimit = Number(policyRows[0].amount || 0);
    const amount = Number(request.estimated_amount || 0);
    const current = canonicalStatus(request.status);
    const currentRoute = request.next_role;
    const now = new Date().toISOString();

    if (action === "Correct Request Routing") {
      const expected = routeForStatus(current, amount, approvalLimit);
      if (String(currentRoute || "") === String(expected || "")) {
        throw new Error("This request already has the correct routing.");
      }
      await tx`UPDATE purchase_requests SET next_role=${expected},updated_at=${now} WHERE id=${requestId}`;
      const intervention = await recordIntervention(tx, {
        user,
        interventionType: action,
        entityType: "Purchase Request",
        entityId: requestId,
        reason,
        beforeState: { status: request.status, next_role: currentRoute },
        afterState: { status: request.status, next_role: expected },
      });
      return { ...intervention, requestId, requestNo: request.request_no, status: request.status, nextRole: expected };
    }

    if (action === "Reassign Procurement Manager") {
      const expected = routeForStatus(current, amount, approvalLimit);
      if (expected !== "procurement_manager") {
        throw new Error("This request is not currently owned by the Procurement Manager stage.");
      }
      const targetId = Number(targetProcurementManagerId || 0);
      if (!Number.isInteger(targetId) || targetId <= 0) throw new Error("Choose an active Procurement Manager.");
      const targetRows = await tx<{ id:number;username:string;full_name:string;role:string;is_active:boolean }[]>`
        SELECT id,username,full_name,role,is_active FROM users WHERE id=${targetId} FOR UPDATE
      `;
      const target = targetRows[0];
      if (!target || target.role !== "Procurement Manager" || !target.is_active) {
        throw new Error("The assignee must be an active Procurement Manager.");
      }
      if (Number(request.assigned_procurement_manager_id || 0) === targetId) {
        throw new Error("This request is already assigned to that Procurement Manager.");
      }
      await tx`
        UPDATE purchase_requests
        SET assigned_procurement_manager_id=${targetId},next_role='procurement_manager',updated_at=${now}
        WHERE id=${requestId}
      `;
      await notifyUser(tx, targetId, "Admin reassigned procurement work", `${request.request_no} was assigned to you by Admin. Reason: ${reason}`, "Purchase Request", requestId, "Open Purchase Requests");
      const intervention = await recordIntervention(tx, {
        user,
        interventionType: action,
        entityType: "Purchase Request",
        entityId: requestId,
        targetUserId: targetId,
        reason,
        beforeState: { assigned_procurement_manager_id: request.assigned_procurement_manager_id, next_role: request.next_role },
        afterState: { assigned_procurement_manager_id: targetId, next_role: "procurement_manager" },
      });
      return { ...intervention, requestId, requestNo: request.request_no, targetUserId: targetId, targetName: target.full_name };
    }

    const paidStates = new Set(["Awaiting Payment","Paid","Receipt Uploaded","Payment Submitted for Verification","Completed","Closed","Archived"]);
    if (request.requested_by === user.id && ["Emergency Approve Request","Emergency Reject Request"].includes(action)) {
      throw new Error("Admin cannot use an emergency approval decision on their own request.");
    }

    let targetStatus: string;
    let nextRole: string | null;
    let paymentStatus = request.payment_status;
    let event: string;
    let approvalMode = "Admin Emergency Intervention";

    if (action === "Return for Correction") {
      if (paidStates.has(current)) throw new Error("A paid or closure-stage request cannot be returned through this correction action.");
      targetStatus = "Returned for Correction";
      nextRole = "facility_manager";
      event = "Admin Override - Returned for Correction";
    } else if (action === "Return to Procurement Review") {
      if (paidStates.has(current)) throw new Error("A paid or closure-stage request cannot be returned to Procurement Review.");
      targetStatus = "Sent for Procurement Review";
      nextRole = "procurement_manager";
      event = "Admin Override - Returned to Procurement Review";
    } else if (action === "Release Stuck Approval") {
      if (current !== "Submitted for Approval") throw new Error("Release Stuck Approval is only available for a request already awaiting approval.");
      targetStatus = "Submitted for Approval";
      nextRole = routeForStatus(targetStatus, amount, approvalLimit);
      event = "Admin Intervention - Approval Routing Released";
    } else if (action === "Reopen Completed / Closed / Archived") {
      if (!["Completed","Closed","Archived"].includes(current)) throw new Error("Only Completed, Closed, or Archived requests can be reopened here.");
      targetStatus = "Receipt Uploaded";
      nextRole = "procurement_manager";
      paymentStatus = "Paid";
      event = "Admin Intervention - Procurement Reopened";
    } else if (action === "Cancel Duplicate Request") {
      if (paidStates.has(current) || current === "Approved") {
        throw new Error("Approved, paid, or closed records cannot be cancelled as duplicates from this control.");
      }
      const paymentRows = await tx<{ id:number }[]>`
        SELECT id FROM payments
        WHERE request_id=${requestId} AND status IN ('Approved','Paid')
        LIMIT 1
      `;
      if (paymentRows[0]) throw new Error("A payment record already exists for this request. Duplicate cancellation has been blocked.");
      targetStatus = "Cancelled";
      nextRole = null;
      event = "Admin Intervention - Duplicate Request Cancelled";
    } else if (action === "Emergency Approve Request") {
      if (current !== "Submitted for Approval") throw new Error("Emergency approval is only available while a request is awaiting approval.");
      targetStatus = "Approved";
      nextRole = "finance";
      paymentStatus = "Approved for Payment";
      event = "Approved by Admin Emergency Override";
    } else if (action === "Emergency Reject Request") {
      if (current !== "Submitted for Approval") throw new Error("Emergency rejection is only available while a request is awaiting approval.");
      targetStatus = "Rejected";
      nextRole = null;
      event = "Rejected by Admin Emergency Override";
    } else {
      throw new Error("Unsupported Admin request intervention.");
    }

    const isEmergencyApproval = action === "Emergency Approve Request";
    const isEmergencyDecision = action === "Emergency Approve Request" || action === "Emergency Reject Request";

    await tx`
      UPDATE purchase_requests
      SET status=${targetStatus},next_role=${nextRole},payment_status=${paymentStatus},
          approved_at=${isEmergencyApproval ? now : isEmergencyDecision ? null : request.approved_at},
          approved_by_user_id=${isEmergencyApproval ? user.id : isEmergencyDecision ? null : request.approved_by_user_id},
          approved_by_role=${isEmergencyApproval ? 'Admin' : isEmergencyDecision ? null : request.approved_by_role},
          updated_at=${now}
      WHERE id=${requestId}
    `;

    if (isEmergencyDecision && request.linked_sourcing_task_id) {
      await tx`
        UPDATE sourcing_tasks
        SET approval_status=${isEmergencyApproval ? "Approved" : "Rejected"},updated_at=${now}
        WHERE id=${request.linked_sourcing_task_id}
      `;
    }

    await tx`
      INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
      VALUES ('Purchase Request',${requestId},${event},${targetStatus},${reason},${user.id},${now})
    `;
    await tx`
      INSERT INTO approval_history (
        entity_type,entity_id,action,status_before,status_after,reason,user_id,
        approved_by_user_id,approved_by_role,approval_mode,delegation_reason,original_approver_role,note,created_at
      ) VALUES (
        'Purchase Request',${requestId},${event},${request.status},${targetStatus},${reason},${user.id},
        ${user.id},'Admin',${approvalMode},${reason},${isEmergencyDecision ? "Approver" : null},${reason},${now}
      )
    `;
    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at
      ) VALUES (
        ${user.id},'Admin',${event},'Purchase Request',${requestId},
        ${`${request.request_no} moved from ${request.status || "Unknown"} to ${targetStatus}`},${reason},'workflow',${request.facility_manager_user_id},${now}
      )
    `;
    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,amount,department,notes
      ) VALUES (
        ${event},'Purchase Request',${String(requestId)},${user.id},'Admin',${reason},
        ${tx.json({status:request.status,next_role:request.next_role,payment_status:request.payment_status})},
        ${tx.json({status:targetStatus,next_role:nextRole,payment_status:paymentStatus,approval_mode:approvalMode})},
        ${now},${now.slice(0,10)},${now.slice(11,19)},${amount},${request.department_project},${reason}
      )
    `;
    await appendAuditEvent(tx, {
      action: event,
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: request.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: "Admin",
      beforeValues: { status: request.status, next_role: request.next_role, payment_status: request.payment_status },
      afterValues: { status: targetStatus, next_role: nextRole, payment_status: paymentStatus, approval_mode: approvalMode },
      metadata: { amount, department: request.department_project, approval_limit: approvalLimit, intervention_action: action },
      reasonOrComment: reason,
      severity: "High",
      source: "nextjs-admin",
    });

    const intervention = await recordIntervention(tx, {
      user,
      interventionType: action,
      entityType: "Purchase Request",
      entityId: requestId,
      reason,
      beforeState: { status: request.status, next_role: request.next_role, payment_status: request.payment_status },
      afterState: { status: targetStatus, next_role: nextRole, payment_status: paymentStatus },
      severity: "High",
    });

    if (request.requested_by) {
      await notifyUser(tx, request.requested_by, "Admin workflow intervention", `${request.request_no} was changed using '${action}'. Reason: ${reason}`, "Purchase Request", requestId, "Open Request");
    }
    if (request.assigned_procurement_manager_id && request.assigned_procurement_manager_id !== request.requested_by) {
      await notifyUser(tx, request.assigned_procurement_manager_id, "Admin workflow intervention", `${request.request_no} was changed using '${action}'. Reason: ${reason}`, "Purchase Request", requestId, "Open Purchase Request");
    }
    if (isEmergencyApproval) {
      await notifyRole(tx, "Finance", "Request approved by Admin emergency override", `${request.request_no} is approved for Finance processing.`, "Purchase Request", requestId, "Open Approved for Payment", "Approved for Payment");
    }
    await notifyRole(tx, "Auditor", `Audit activity: ${event}`, `Admin performed ${event} on ${request.request_no}.`, "Purchase Request", requestId, "Open Approval Trails", "Approval Trails");

    return {
      ...intervention,
      requestId,
      requestNo: request.request_no,
      status: targetStatus,
      nextRole,
      paymentStatus,
      approvalMode,
    };
  });
}

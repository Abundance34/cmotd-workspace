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
    if (Number(oldAmount) === Number(newAmount) && oldAmount.replace(/0+$/,'').replace(/\.$/,'') === newAmount.replace(/0+$/,'').replace(/\.$/,'')) {
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

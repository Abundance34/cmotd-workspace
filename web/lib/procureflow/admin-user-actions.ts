import { randomUUID } from "node:crypto";
import { hash as hashArgon2 } from "@node-rs/argon2";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { ROLES, type ProcureFlowRole } from "./roles";
import { appendAuditEvent } from "./audit";

export type AdminPermissionChange = "Grant" | "Revoke";

function assertAdmin(user: CurrentUser) {
  if (user.role !== "Admin") throw new Error("Only Admin can manage ProcureFlow users and permissions.");
}

function meaningfulReason(value: string) {
  const reason = String(value || "").trim().replace(/\s+/g, " ");
  if (reason.length < 5) throw new Error("A meaningful reason is required for this Admin action.");
  return reason;
}

function cleanUsername(value: string) {
  const username = String(value || "").trim();
  if (username.length < 2 || username.length > 80) throw new Error("Username must be between 2 and 80 characters.");
  if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new Error("Username may contain only letters, numbers, dots, underscores and hyphens.");
  return username;
}

function cleanFullName(value: string) {
  const fullName = String(value || "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 160) throw new Error("Full name must be between 2 and 160 characters.");
  return fullName;
}

function cleanEmail(value: string | null | undefined) {
  const email = String(value || "").trim();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address or leave the email field blank.");
  return email;
}

function cleanRole(value: string): ProcureFlowRole {
  const role = String(value || "") as ProcureFlowRole;
  if (!(ROLES as readonly string[]).includes(role)) throw new Error("Choose a valid ProcureFlow role.");
  return role;
}

function validateTemporaryPassword(value: string) {
  const password = String(value || "");
  if (password.length < 6) throw new Error("Temporary password must be at least 6 characters.");
  if (password.length > 256) throw new Error("Temporary password is too long.");
  return password;
}

function ref(prefix: string) {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0,17)}-${randomUUID().slice(0,8).toUpperCase()}`;
}

async function recordAdminControl(
  tx: any,
  input: {
    user: CurrentUser;
    action: string;
    entityType: string;
    entityId?: number | null;
    targetUserId?: number | null;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    severity?: string;
  },
) {
  const now = new Date().toISOString();
  const interventionNo = ref("ADM-INT");
  const correlationId = ref("ADM-CORR");
  const before = input.before || {};
  const after = input.after || {};
  const severity = input.severity || "High";

  const interventionRows = await tx<{id:number}[]>`
    INSERT INTO admin_interventions (
      intervention_no,intervention_type,entity_type,entity_id,target_user_id,severity,reason,
      before_state_json,after_state_json,actor_user_id,actor_role,correlation_id,created_at
    ) VALUES (
      ${interventionNo},${input.action},${input.entityType},${input.entityId ?? null},${input.targetUserId ?? null},
      ${severity},${input.reason},${JSON.stringify(before)},${JSON.stringify(after)},${input.user.id},'Admin',${correlationId},${now}
    ) RETURNING id
  `;

  await tx`
    INSERT INTO activity_logs (
      user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at
    ) VALUES (
      ${input.user.id},'Admin',${input.action},${input.entityType},${input.entityId ?? null},
      ${`${input.action} recorded as ${interventionNo}`},${input.reason},'admin',${input.targetUserId ?? null},${now}
    )
  `;

  await tx`
    INSERT INTO audit_logs (
      action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes
    ) VALUES (
      ${input.action.toUpperCase().replace(/[^A-Z0-9]+/g,"_")},${input.entityType},
      ${input.entityId == null ? null : String(input.entityId)},${input.user.id},'Admin',${input.reason},
      ${tx.json(before)},${tx.json(after)},${now},${now.slice(0,10)},${now.slice(11,19)},${input.reason}
    )
  `;

  await appendAuditEvent(tx, {
    action: input.action.toUpperCase().replace(/[^A-Z0-9]+/g,"_"),
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityReference: interventionNo,
    actorUserId: input.user.id,
    actorUsername: input.user.username,
    actorRole: "Admin",
    beforeValues: before,
    afterValues: after,
    metadata: { intervention_no: interventionNo, correlation_id: correlationId, target_user_id: input.targetUserId ?? null },
    reasonOrComment: input.reason,
    severity,
    source: "nextjs-admin",
  });

  return { interventionId:Number(interventionRows[0].id), interventionNo, correlationId };
}

async function notifyUser(tx: any, userId: number, title: string, message: string) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
      delivery_channel,push_sent,email_sent,action_label,section_target,created_at
    ) VALUES (
      ${userId},NULL,${title},${message},'User',${userId},FALSE,FALSE,'Important',
      'in_app',FALSE,FALSE,'Open Settings','Settings',${now}
    )
  `;
}

export async function createAdminManagedUser(
  user: CurrentUser,
  input: { username:string; fullName:string; email?:string|null; role:string; temporaryPassword:string; forcePasswordChange?:boolean; reason:string },
) {
  assertAdmin(user);
  const username = cleanUsername(input.username);
  const fullName = cleanFullName(input.fullName);
  const email = cleanEmail(input.email);
  const role = cleanRole(input.role);
  const password = validateTemporaryPassword(input.temporaryPassword);
  const reason = meaningfulReason(input.reason);
  const passwordHash = await hashArgon2(password);
  const sql = db();

  return sql.begin(async (tx) => {
    const duplicate = await tx<{id:number}[]>`SELECT id FROM users WHERE lower(username)=lower(${username}) LIMIT 1`;
    if (duplicate[0]) throw new Error("That username is already in use.");
    const roleRows = await tx<{name:string}[]>`SELECT name FROM roles WHERE name=${role} LIMIT 1`;
    if (!roleRows[0]) throw new Error("The selected role is not configured in the production role catalogue.");
    const now = new Date().toISOString();
    const rows = await tx<{id:number}[]>`
      INSERT INTO users (
        id,username,full_name,role,password_hash,must_change_password,is_active,created_at,email,
        account_locked,failed_login_count,updated_at
      ) VALUES (
        nextval('users_id_seq'),${username},${fullName},${role},${passwordHash},${input.forcePasswordChange !== false},TRUE,${now},${email},
        FALSE,0,${now}
      ) RETURNING id
    `;
    const newUserId = Number(rows[0].id);
    const after = { username,full_name:fullName,email,role,is_active:true,account_locked:false,must_change_password:input.forcePasswordChange !== false };
    const intervention = await recordAdminControl(tx, {
      user,action:"USER_CREATED",entityType:"User",entityId:newUserId,targetUserId:newUserId,reason,before:{},after,severity:"High",
    });
    await notifyUser(tx,newUserId,"Account created","Your ProcureFlow account has been created. Use the temporary password supplied through your approved internal channel and change it when prompted.");
    return { ...intervention, userId:newUserId, username, role };
  });
}

export async function updateAdminManagedUser(
  user: CurrentUser,
  input: { targetUserId:number; username:string; fullName:string; email?:string|null; role:string; reason:string },
) {
  assertAdmin(user);
  const targetUserId = Number(input.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error("Choose a valid user.");
  const username = cleanUsername(input.username);
  const fullName = cleanFullName(input.fullName);
  const email = cleanEmail(input.email);
  const role = cleanRole(input.role);
  const reason = meaningfulReason(input.reason);
  const sql = db();

  return sql.begin(async (tx) => {
    const rows = await tx<any[]>`
      SELECT id,username,full_name,email,role,is_active,account_locked,must_change_password
      FROM users WHERE id=${targetUserId} FOR UPDATE
    `;
    const target = rows[0];
    if (!target) throw new Error("Selected user was not found.");
    if (targetUserId === user.id && target.role !== role) throw new Error("Admin cannot change their own role from User Management.");
    const duplicate = await tx<{id:number}[]>`
      SELECT id FROM users WHERE lower(username)=lower(${username}) AND id<>${targetUserId} LIMIT 1
    `;
    if (duplicate[0]) throw new Error("That username is already in use.");
    const roleRows = await tx<{name:string}[]>`SELECT name FROM roles WHERE name=${role} LIMIT 1`;
    if (!roleRows[0]) throw new Error("The selected role is not configured in the production role catalogue.");

    const before = { username:target.username,full_name:target.full_name,email:target.email,role:target.role,is_active:Boolean(target.is_active),account_locked:Boolean(target.account_locked),must_change_password:Boolean(target.must_change_password) };
    const after = { ...before,username,full_name:fullName,email,role };
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error("No user profile or role changes were detected.");
    const now = new Date().toISOString();
    await tx`
      UPDATE users SET username=${username},full_name=${fullName},email=${email},role=${role},updated_at=${now}
      WHERE id=${targetUserId}
    `;
    if (target.role !== role) {
      await tx`
        UPDATE user_sessions SET status='Role Changed by Admin',logout_at=${now},last_seen_at=${now},updated_at=${now}
        WHERE user_id=${targetUserId} AND status='Active'
      `;
    }
    const intervention = await recordAdminControl(tx, {
      user,action:"USER_UPDATED",entityType:"User",entityId:targetUserId,targetUserId,reason,before,after,severity:target.role !== role ? "High" : "Important",
    });
    if (target.role !== role) await notifyUser(tx,targetUserId,"Role changed",`Your ProcureFlow role is now ${role}. You must sign in again for the new authorization to take effect.`);
    else await notifyUser(tx,targetUserId,"Account profile updated","An administrator updated your ProcureFlow account profile.");
    return { ...intervention, userId:targetUserId, username, role, roleChanged:target.role !== role };
  });
}

export async function resetAdminManagedUserPassword(
  user: CurrentUser,
  input: { targetUserId:number; temporaryPassword:string; reason:string },
) {
  assertAdmin(user);
  const targetUserId = Number(input.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error("Choose a valid user.");
  if (targetUserId === user.id) throw new Error("Use your own Settings page to change the current Admin password.");
  const password = validateTemporaryPassword(input.temporaryPassword);
  const reason = meaningfulReason(input.reason);
  const passwordHash = await hashArgon2(password);
  const sql = db();

  return sql.begin(async (tx) => {
    const rows = await tx<any[]>`SELECT id,username,full_name,role,must_change_password FROM users WHERE id=${targetUserId} FOR UPDATE`;
    const target = rows[0];
    if (!target) throw new Error("Selected user was not found.");
    const now = new Date().toISOString();
    await tx`
      UPDATE users SET password_hash=${passwordHash},must_change_password=TRUE,failed_login_count=0,updated_at=${now}
      WHERE id=${targetUserId}
    `;
    await tx`
      UPDATE user_sessions SET status='Password Reset Required',logout_at=${now},last_seen_at=${now},updated_at=${now}
      WHERE user_id=${targetUserId} AND status='Active'
    `;
    const intervention = await recordAdminControl(tx, {
      user,action:"ADMIN_PASSWORD_RESET",entityType:"User",entityId:targetUserId,targetUserId,reason,
      before:{ username:target.username,role:target.role,must_change_password:Boolean(target.must_change_password) },
      after:{ username:target.username,role:target.role,must_change_password:true,active_sessions_terminated:true },severity:"High",
    });
    await notifyUser(tx,targetUserId,"Password reset by Admin","Your ProcureFlow password was reset by an administrator. Sign in with the temporary password supplied through the approved internal channel, then change it immediately.");
    return { ...intervention, userId:targetUserId, username:target.username };
  });
}

const EXECUTIVE_APPROVAL_PERMISSIONS = new Set(["approve_request","approve_payment","approve_gateway_pass","approve_po"]);
const ADMIN_ONLY_PERMISSIONS = new Set(["admin","manage_roles","create_user","view_notifications_monitor","view_all_activity_logs"]);
const ADMIN_ESSENTIAL_PERMISSIONS = new Set(["admin","manage_roles","create_user"]);

export async function updateAdminRolePermission(
  user: CurrentUser,
  input: { role:string; permission:string; change:AdminPermissionChange; reason:string },
) {
  assertAdmin(user);
  const role = cleanRole(input.role);
  const permission = String(input.permission || "").trim();
  const change = input.change;
  const reason = meaningfulReason(input.reason);
  if (!permission) throw new Error("Choose a permission.");
  if (change !== "Grant" && change !== "Revoke") throw new Error("Choose Grant or Revoke.");
  if (EXECUTIVE_APPROVAL_PERMISSIONS.has(permission) && !["Admin","Approver"].includes(role)) {
    throw new Error("Executive approval permissions can only be assigned to Admin or Approver / MD.");
  }
  if (permission === "approve_low_value" && !["Admin","Procurement Manager"].includes(role)) {
    throw new Error("Low-value approval authority can only be assigned to Admin or Procurement Manager.");
  }
  if (ADMIN_ONLY_PERMISSIONS.has(permission) && role !== "Admin") {
    throw new Error("That permission is reserved for the Admin role.");
  }
  if (change === "Revoke" && role === "Admin" && ADMIN_ESSENTIAL_PERMISSIONS.has(permission)) {
    throw new Error("Core Admin control permissions cannot be revoked from the Admin role.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const roleRows = await tx<{name:string}[]>`SELECT name FROM roles WHERE name=${role} LIMIT 1`;
    const permissionRows = await tx<{name:string}[]>`SELECT name FROM permissions WHERE name=${permission} LIMIT 1`;
    if (!roleRows[0]) throw new Error("The selected role does not exist.");
    if (!permissionRows[0]) throw new Error("The selected permission does not exist.");
    const existing = await tx<{permission_name:string}[]>`
      SELECT permission_name FROM role_permissions WHERE role_name=${role} AND permission_name=${permission} LIMIT 1
    `;
    const assigned = Boolean(existing[0]);
    if (change === "Grant" && assigned) throw new Error("That permission is already assigned to this role.");
    if (change === "Revoke" && !assigned) throw new Error("That permission is not currently assigned to this role.");
    const now = new Date().toISOString();
    if (change === "Grant") {
      await tx`INSERT INTO role_permissions (role_name,permission_name,created_at) VALUES (${role},${permission},${now})`;
    } else {
      await tx`DELETE FROM role_permissions WHERE role_name=${role} AND permission_name=${permission}`;
    }
    const before = { role,permission,assigned };
    const after = { role,permission,assigned:change === "Grant" };
    const intervention = await recordAdminControl(tx, {
      user,action:"ROLE_PERMISSION_UPDATED",entityType:"Permission",reason,before,after,severity:"High",
    });
    return { ...intervention, role, permission, change };
  });
}

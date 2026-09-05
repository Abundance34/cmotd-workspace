import { hash as hashArgon2 } from "@node-rs/argon2";
import { db } from "@/lib/db";
import { verifyPassword, type CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

export const PASSWORD_HISTORY_COUNT = Math.max(1, Number(process.env.PROCUREFLOW_PASSWORD_HISTORY_COUNT || "5"));
export const PASSWORD_MIN_LENGTH = process.env.PROCUREFLOW_PRODUCTION === "1" || process.env.NODE_ENV === "production" ? 12 : 8;

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type SessionRotationInput = {
  currentSessionHash: string;
  newSessionHash: string;
};

function validatePasswordInput(input: PasswordChangeInput) {
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  const confirmPassword = String(input.confirmPassword || "");
  if (!currentPassword) throw new Error("Enter your current password.");
  if (newPassword.length < PASSWORD_MIN_LENGTH) throw new Error(`Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`);
  if (newPassword.length > 256) throw new Error("The new password is too long.");
  if (newPassword !== confirmPassword) throw new Error("Passwords do not match.");
  return { currentPassword, newPassword };
}

function sessionExpiry(rememberMe: boolean) {
  const standardMinutes = Math.max(1, Number(process.env.PROCUREFLOW_SESSION_TIMEOUT_MINUTES || "43200"));
  const rememberDays = Math.max(1, Number(process.env.PROCUREFLOW_REMEMBER_ME_SESSION_DAYS || "90"));
  return new Date(Date.now() + (rememberMe ? rememberDays * 86_400_000 : standardMinutes * 60_000));
}

export function passwordPolicy() {
  return {
    minimumLength: PASSWORD_MIN_LENGTH,
    historyCount: PASSWORD_HISTORY_COUNT,
    algorithm: "Argon2id",
    rotatesSession: true,
  };
}

export async function changeOwnPassword(
  user: CurrentUser,
  passwords: PasswordChangeInput,
  rotation: SessionRotationInput,
) {
  const { currentPassword, newPassword } = validatePasswordInput(passwords);
  if (!rotation.currentSessionHash || !rotation.newSessionHash) throw new Error("Your authenticated session could not be rotated safely.");

  const sql = db();
  return sql.begin(async (tx) => {
    const accountRows = await tx<{
      id:number;username:string;full_name:string;role:string;password_hash:string;is_active:boolean;
      must_change_password:boolean|null;account_locked:boolean|null;failed_login_count:number|null;
    }[]>`
      SELECT id,username,full_name,role,password_hash,is_active,must_change_password,
             COALESCE(account_locked,FALSE) account_locked,COALESCE(failed_login_count,0)::int failed_login_count
      FROM users
      WHERE id=${user.id}
      FOR UPDATE
    `;
    const account = accountRows[0];
    if (!account || !account.is_active) throw new Error("The user account is unavailable.");

    const currentValid = await verifyPassword(currentPassword, account.password_hash);
    if (!currentValid) throw new Error("Current password is incorrect.");

    const historyRows = await tx<{password_hash:string}[]>`
      SELECT password_hash
      FROM password_history
      WHERE user_id=${user.id}
      ORDER BY created_at DESC,id DESC
      LIMIT ${PASSWORD_HISTORY_COUNT}
    `;
    const candidateHashes = [account.password_hash, ...historyRows.map((row) => row.password_hash)].filter(Boolean);
    for (const storedHash of candidateHashes) {
      if (await verifyPassword(newPassword, storedHash)) {
        throw new Error("Choose a password that has not been used recently.");
      }
    }

    const sessionRows = await tx<{
      id:number;remember_me:number|string|null;user_agent:string|null;ip_address:string|null;
    }[]>`
      SELECT id,remember_me,user_agent,ip_address
      FROM user_sessions
      WHERE session_token=${rotation.currentSessionHash}
        AND user_id=${user.id}
        AND status='Active'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `;
    const currentSession = sessionRows[0];
    if (!currentSession) throw new Error("Your current session is no longer active. Sign in again before changing your password.");

    const now = new Date().toISOString();
    const rememberMe = Number(currentSession.remember_me || 0) !== 0;
    const expiresAt = sessionExpiry(rememberMe);
    const newHash = await hashArgon2(newPassword);

    await tx`
      INSERT INTO password_history (user_id,password_hash,created_at)
      VALUES (${user.id},${account.password_hash},${now})
    `;
    await tx`
      DELETE FROM password_history
      WHERE user_id=${user.id}
        AND id NOT IN (
          SELECT id FROM password_history
          WHERE user_id=${user.id}
          ORDER BY created_at DESC,id DESC
          LIMIT ${PASSWORD_HISTORY_COUNT}
        )
    `;

    await tx`
      UPDATE users
      SET password_hash=${newHash},must_change_password=FALSE,failed_login_count=0,account_locked=FALSE,updated_at=${now}
      WHERE id=${user.id}
    `;

    await tx`
      UPDATE user_sessions
      SET status='Password Changed',logout_at=${now},last_seen_at=${now},updated_at=${now}
      WHERE user_id=${user.id} AND status='Active'
    `;

    await tx`
      INSERT INTO user_sessions (
        session_token,user_id,login_at,last_seen_at,status,user_agent,ip_address,
        remember_me,expires_at,created_at,updated_at
      ) VALUES (
        ${rotation.newSessionHash},${user.id},${now},${now},'Active',${currentSession.user_agent},${currentSession.ip_address},
        ${rememberMe ? 1 : 0},${expiresAt},${now},${now}
      )
    `;

    const before = {
      must_change_password: Boolean(account.must_change_password),
      account_locked: Boolean(account.account_locked),
      failed_login_count: Number(account.failed_login_count || 0),
    };
    const after = {
      must_change_password: false,
      account_locked: false,
      failed_login_count: 0,
      obsolete_sessions_revoked: true,
      session_rotated: true,
    };

    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at
      ) VALUES (
        ${user.id},${user.role},'PASSWORD_CHANGE','User',${user.id},
        'Password changed and secure session rotated',
        'Previous active sessions were revoked after the credential change.','self',${user.id},${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,notes
      ) VALUES (
        'PASSWORD_CHANGE','User',${String(user.id)},${user.id},${user.role},
        'Password changed, obsolete sessions revoked, and authenticated session rotated',
        ${tx.json(before)},${tx.json(after)},${now},${now.slice(0,10)},${now.slice(11,19)},
        'Password values and hashes are intentionally excluded from audit evidence.'
      )
    `;

    await appendAuditEvent(tx, {
      action: "PASSWORD_CHANGE",
      entityType: "User",
      entityId: user.id,
      entityReference: user.username,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: before,
      afterValues: after,
      metadata: {
        password_history_count: PASSWORD_HISTORY_COUNT,
        password_algorithm: "Argon2id",
        password_material_logged: false,
      },
      reasonOrComment: "User changed their own password and rotated the authenticated session.",
      severity: "High",
      source: "nextjs-settings",
    });

    return {
      ok: true,
      expiresAt: expiresAt.toISOString(),
      rememberMe,
      mustChangePassword: false,
      sessionRotated: true,
    };
  });
}

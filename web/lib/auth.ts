import { createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { verify as verifyArgon2 } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { db, databaseConfigured } from "./db";
import type { ProcureFlowRole } from "./procureflow/roles";
import { isProcureFlowRole } from "./procureflow/roles";

export const SESSION_COOKIE = "pf_session_token";

export type CurrentUser = {
  id: number;
  username: string;
  fullName: string;
  role: ProcureFlowRole;
  mustChangePassword: boolean;
};

function decode(value: string) {
  return Buffer.from(value, "base64");
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!storedHash) return false;
  if (storedHash.startsWith("$argon2")) {
    try {
      return await verifyArgon2(storedHash, password);
    } catch {
      return false;
    }
  }

  if (storedHash.startsWith("pbkdf2_sha256$")) {
    try {
      const [, iterationsText, saltText, digestText] = storedHash.split("$", 4);
      const expected = decode(digestText);
      const actual = pbkdf2Sync(password, decode(saltText), Number(iterationsText), expected.length, "sha256");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  const sha = createHash("sha256").update(password, "utf8").digest("hex");
  if (storedHash.length === 64) return storedHash === sha;
  if (storedHash.startsWith("sha256$")) return storedHash.slice(7) === sha;
  return false;
}

export function sessionTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!databaseConfigured()) return null;
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const sql = db();
  const tokenHash = sessionTokenHash(token);
  const rows = await sql<{
    id: number;
    username: string;
    full_name: string;
    role: string;
    must_change_password: boolean | null;
  }[]>`
    SELECT u.id, u.username, u.full_name, u.role, COALESCE(u.must_change_password,FALSE) must_change_password
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_token = ${tokenHash}
      AND s.status = 'Active'
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
      AND u.is_active = TRUE
      AND COALESCE(u.account_locked, FALSE) = FALSE
    ORDER BY s.id DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row || !isProcureFlowRole(row.role)) return null;
  await sql`UPDATE user_sessions SET last_seen_at = NOW(), updated_at = NOW() WHERE session_token = ${tokenHash}`;
  return {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

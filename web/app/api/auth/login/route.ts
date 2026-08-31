import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/lib/db";
import { SESSION_COOKIE, sessionTokenHash, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "The migrated PostgreSQL database is not connected yet." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const rememberMe = Boolean(body.rememberMe);
  if (!username || !password) return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });

  const sql = db();
  const rows = await sql<{
    id: number; username: string; full_name: string; role: string; password_hash: string;
    account_locked: boolean | null; failed_login_count: number | null;
  }[]>`
    SELECT id, username, full_name, role, password_hash, account_locked, failed_login_count
    FROM users WHERE username = ${username} AND is_active = TRUE LIMIT 1
  `;
  const user = rows[0];
  if (!user || user.account_locked) return NextResponse.json({ error: "Invalid credentials or account unavailable." }, { status: 401 });

  const valid = await verifyPassword(password, user.password_hash);
  const lockoutAt = Number(process.env.PROCUREFLOW_LOGIN_LOCKOUT_ATTEMPTS ?? "5");
  if (!valid) {
    const attempts = Number(user.failed_login_count ?? 0) + 1;
    await sql`UPDATE users SET failed_login_count = ${attempts}, account_locked = ${attempts >= lockoutAt}, updated_at = NOW() WHERE id = ${user.id}`;
    return NextResponse.json({ error: "Invalid credentials or account unavailable." }, { status: 401 });
  }

  await sql`UPDATE users SET failed_login_count = 0, last_login_at = NOW(), updated_at = NOW() WHERE id = ${user.id}`;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sessionTokenHash(token);
  const standardMinutes = Number(process.env.PROCUREFLOW_SESSION_TIMEOUT_MINUTES ?? "43200");
  const rememberDays = Number(process.env.PROCUREFLOW_REMEMBER_ME_SESSION_DAYS ?? "90");
  const expiresAt = new Date(Date.now() + (rememberMe ? rememberDays * 86400000 : standardMinutes * 60000));

  await sql`
    INSERT INTO user_sessions (session_token, user_id, login_at, last_seen_at, status, remember_me, expires_at, created_at, updated_at)
    VALUES (${tokenHash}, ${user.id}, NOW(), NOW(), 'Active', ${rememberMe ? 1 : 0}, ${expiresAt}, NOW(), NOW())
  `;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return response;
}

import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/lib/db";
import { SESSION_COOKIE, sessionTokenHash } from "@/lib/auth";

export async function POST(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)pf_session_token=([^;]+)/)?.[1];
  if (token && databaseConfigured()) {
    const sql = db();
    const tokenHash = sessionTokenHash(decodeURIComponent(token));
    await sql`UPDATE user_sessions SET status = 'Logged Out', logout_at = NOW(), updated_at = NOW() WHERE session_token = ${tokenHash}`;
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, expires: new Date(0), path: "/" });
  return response;
}

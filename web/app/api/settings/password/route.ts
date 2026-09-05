import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser, SESSION_COOKIE, sessionTokenHash } from "@/lib/auth";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import { changeOwnPassword, passwordPolicy, type PasswordChangeInput } from "@/lib/procureflow/account-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json({
    ok: true,
    policy: passwordPolicy(),
    account: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
    },
  });
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "Password changes are temporarily locked until the active v2 audit signing key verifies." },
        { status: 503 },
      );
    }

    const store = await cookies();
    const currentToken = store.get(SESSION_COOKIE)?.value;
    if (!currentToken) return NextResponse.json({ error: "Your authenticated session could not be verified." }, { status: 401 });

    const body = await request.json().catch(() => null) as PasswordChangeInput | null;
    if (!body) return NextResponse.json({ error: "Password change details are required." }, { status: 400 });

    const newToken = randomBytes(32).toString("base64url");
    const result = await changeOwnPassword(
      user,
      body,
      {
        currentSessionHash: sessionTokenHash(currentToken),
        newSessionHash: sessionTokenHash(newToken),
      },
    );

    const response = NextResponse.json({ ok: true, result, policy: passwordPolicy() });
    response.cookies.set(SESSION_COOKIE, newToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(result.expiresAt),
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to change password.";
    const status = /session is no longer active|authenticated session/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifyFinancePayee } from "@/lib/procureflow/finance-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import { verifyPayeeEncryptionKeyV2 } from "@/lib/procureflow/payee-crypto";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Finance" && user.role !== "Admin") {
      return NextResponse.json({ error: "Finance access is required." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json({ error: "ProcureFlow writes are locked because the active v2 audit signing key is not verified." }, { status: 503 });
    }
    if (!verifyPayeeEncryptionKeyV2()) {
      return NextResponse.json({ error: "Finance payee verification is locked because the active v2 payee encryption key is not verified." }, { status: 503 });
    }

    const body = await request.json().catch(() => null) as { requestId?: number; reason?: string } | null;
    const requestId = Number(body?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid purchase request is required." }, { status: 400 });
    }

    const result = await verifyFinancePayee(user, requestId, String(body?.reason || ""));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify payee details.";
    const status = /Only Finance|Finance access|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

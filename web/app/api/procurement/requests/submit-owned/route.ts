import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { submitProcurementOwnedDraft } from "@/lib/procureflow/request-draft-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only Procurement Manager or Admin can submit this request to Approver / MD." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json({ error: "ProcureFlow writes are locked until the active v2 audit signing key is verified." }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const requestId = Number(body?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
    }

    const result = await submitProcurementOwnedDraft(user, requestId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit Procurement request.";
    const status = /Only Procurement Manager|another user's|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

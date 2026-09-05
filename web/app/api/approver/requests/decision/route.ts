import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decidePurchaseRequest, type ApproverRequestDecision } from "@/lib/procureflow/approver-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Approver" && user.role !== "Admin") {
      return NextResponse.json({ error: "Approver / MD access is required." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "ProcureFlow writes are locked because the active v2 audit signing key is not verified." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as {
      requestId?: number;
      decision?: ApproverRequestDecision;
      note?: string;
    } | null;
    const requestId = Number(body?.requestId);
    const decision = String(body?.decision || "") as ApproverRequestDecision;
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid purchase request is required." }, { status: 400 });
    }
    if (!["approve", "reject", "return"].includes(decision)) {
      return NextResponse.json({ error: "Choose a valid approval decision." }, { status: 400 });
    }

    const result = await decidePurchaseRequest(user, requestId, decision, String(body?.note || ""));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to apply approval decision.";
    const status = /Only Approver|access is required|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  decidePurchaseOrder,
  type ApproverOperationalDecision,
} from "@/lib/procureflow/approver-operational-actions";
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
      poId?: number;
      decision?: ApproverOperationalDecision;
      note?: string;
    } | null;
    const poId = Number(body?.poId);
    const decision = String(body?.decision || "") as ApproverOperationalDecision;
    if (!Number.isInteger(poId) || poId <= 0) {
      return NextResponse.json({ error: "A valid purchase order is required." }, { status: 400 });
    }
    if (!["approve", "reject"].includes(decision)) {
      return NextResponse.json({ error: "Choose a valid purchase-order decision." }, { status: 400 });
    }

    const result = await decidePurchaseOrder(user, poId, decision, String(body?.note || ""));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to apply purchase-order decision.";
    const status = /Only Approver|access is required|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

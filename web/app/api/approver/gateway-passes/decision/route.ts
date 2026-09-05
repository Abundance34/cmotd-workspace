import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  decideGatewayPass,
  type ApproverGatewayDecision,
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
      gatewayPassId?: number;
      decision?: ApproverGatewayDecision;
      note?: string;
    } | null;
    const gatewayPassId = Number(body?.gatewayPassId);
    const decision = String(body?.decision || "") as ApproverGatewayDecision;
    if (!Number.isInteger(gatewayPassId) || gatewayPassId <= 0) {
      return NextResponse.json({ error: "A valid gateway pass is required." }, { status: 400 });
    }
    if (!["approve", "reject", "return"].includes(decision)) {
      return NextResponse.json({ error: "Choose a valid gateway-pass decision." }, { status: 400 });
    }

    const result = await decideGatewayPass(user, gatewayPassId, decision, String(body?.note || ""));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to apply gateway-pass decision.";
    const status = /Only Approver|access is required|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

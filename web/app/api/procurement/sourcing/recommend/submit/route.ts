import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { submitVendorRecommendationForApproval } from "@/lib/procureflow/vendor-recommendation-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Procurement Manager access is required." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "ProcureFlow writes are locked because the active v2 audit signing key is not verified." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as { sourcingTaskId?: number; note?: string } | null;
    const sourcingTaskId = Number(body?.sourcingTaskId);
    if (!Number.isInteger(sourcingTaskId) || sourcingTaskId <= 0) {
      return NextResponse.json({ error: "A valid sourcing task is required." }, { status: 400 });
    }

    const result = await submitVendorRecommendationForApproval(user, sourcingTaskId, String(body?.note || ""));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit vendor recommendation.";
    const status = /Only Procurement|another Procurement Manager|access is required|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

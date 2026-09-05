import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import {
  adminRequestIntervention,
  adminUserSecurityAction,
  setProcurementManagerApprovalLimit,
  type AdminRequestInterventionAction,
  type AdminUserSecurityAction,
} from "@/lib/procureflow/admin-actions";

type Body = {
  action?: string;
  targetUserId?: number;
  securityAction?: AdminUserSecurityAction;
  reason?: string;
  amount?: string | number;
  requestId?: number;
  interventionAction?: AdminRequestInterventionAction;
  targetProcurementManagerId?: number;
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Admin") return NextResponse.json({ error: "Admin access is required." }, { status: 403 });

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "ProcureFlow Admin writes are locked because the active v2 audit signing key is not verified." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as Body | null;
    const action = String(body?.action || "");
    let result: unknown;

    if (action === "user-security") {
      result = await adminUserSecurityAction(
        user,
        Number(body?.targetUserId),
        String(body?.securityAction || "") as AdminUserSecurityAction,
        String(body?.reason || ""),
      );
    } else if (action === "set-approval-limit") {
      result = await setProcurementManagerApprovalLimit(
        user,
        body?.amount ?? "",
        String(body?.reason || ""),
      );
    } else if (action === "request-intervention") {
      result = await adminRequestIntervention(
        user,
        Number(body?.requestId),
        String(body?.interventionAction || "") as AdminRequestInterventionAction,
        String(body?.reason || ""),
        body?.targetProcurementManagerId == null ? null : Number(body.targetProcurementManagerId),
      );
    } else {
      return NextResponse.json({ error: "Choose a valid Admin control action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete Admin action.";
    const status = /Only Admin|Admin access|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

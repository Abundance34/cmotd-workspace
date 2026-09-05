import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import {
  planLogisticsHandover,
  raiseLogisticsException,
  recordReceivingSlip,
  resolveLogisticsException,
  updateGatewayCoordination,
  updateLogisticsTracking,
} from "@/lib/procureflow/logistics-actions";

type ActionBody = {
  action?: string;
  poId?: number;
  exceptionId?: number;
  gatewayPassId?: number;
  input?: any;
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Logistics Officer" && user.role !== "Admin") {
      return NextResponse.json({ error: "Logistics Officer access is required." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "ProcureFlow writes are locked because the active v2 audit signing key is not verified." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as ActionBody | null;
    const action = String(body?.action || "");
    let result: unknown;

    if (action === "plan-handover") {
      result = await planLogisticsHandover(user, Number(body?.poId), body?.input || {});
    } else if (action === "update-tracking") {
      result = await updateLogisticsTracking(user, Number(body?.poId), body?.input || {});
    } else if (action === "record-receiving") {
      result = await recordReceivingSlip(user, Number(body?.poId), body?.input || {});
    } else if (action === "raise-exception") {
      result = await raiseLogisticsException(user, Number(body?.poId), body?.input || {});
    } else if (action === "resolve-exception") {
      result = await resolveLogisticsException(user, Number(body?.exceptionId), String(body?.input?.resolution || ""));
    } else if (action === "gateway-coordination") {
      result = await updateGatewayCoordination(user, Number(body?.gatewayPassId), body?.input || {});
    } else {
      return NextResponse.json({ error: "Choose a valid Logistics action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete Logistics action.";
    const status = /access|required|Only Logistics/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

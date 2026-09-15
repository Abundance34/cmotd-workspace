import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  recordFinancePayment,
  verifyFinancePayee,
  type FinanceTransferType,
} from "@/lib/procureflow/finance-actions";
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
      return NextResponse.json({ error: "Payment recording is locked because the active v2 payee encryption key is not verified." }, { status: 503 });
    }

    const body = await request.json().catch(() => null) as {
      requestId?: number;
      transferType?: FinanceTransferType;
      paymentReference?: string;
      paymentDate?: string;
      financeNote?: string;
      quickPay?: boolean;
    } | null;
    const requestId = Number(body?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid purchase request is required." }, { status: 400 });
    }
    const quickPay = Boolean(body?.quickPay);
    if (!quickPay && !["Internet Bank Transfer", "Physical Bank Transfer"].includes(String(body?.transferType || ""))) {
      return NextResponse.json({ error: "Choose a valid transfer type." }, { status: 400 });
    }

    if (quickPay) {
      await verifyFinancePayee(user, requestId, "Verified automatically when Finance marked the approved request as Paid.");
    }

    const result = await recordFinancePayment(user, requestId, {
      transferType: quickPay ? undefined : String(body?.transferType) as FinanceTransferType,
      paymentReference: quickPay ? undefined : String(body?.paymentReference || ""),
      paymentDate: quickPay ? undefined : String(body?.paymentDate || ""),
      financeNote: quickPay
        ? "Marked Paid directly from Finance Approved for Payment. Receipt/proof is pending under Receipts."
        : String(body?.financeNote || ""),
      quickPay,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record payment.";
    const status = /Only Finance|Finance access|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createProcurementDraft, type DraftRequestInput } from "@/lib/procureflow/request-draft-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import { verifyPayeeEncryptionKeyV2 } from "@/lib/procureflow/payee-crypto";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only Procurement Manager or Admin can create this request type." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    const payeeReady = verifyPayeeEncryptionKeyV2();
    if (!auditReady || !payeeReady) {
      return NextResponse.json(
        { error: "ProcureFlow write security is not ready. The active v2 audit and payee keys must both verify before a draft can be created." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as DraftRequestInput | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "A valid draft payload is required." }, { status: 400 });
    }

    const result = await createProcurementDraft(user, body);
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create Procurement request draft.";
    const status = /Only Procurement Manager|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

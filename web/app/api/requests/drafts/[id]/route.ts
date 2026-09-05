import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { updateOwnedDraft, type DraftRequestInput } from "@/lib/procureflow/request-draft-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import { verifyPayeeEncryptionKeyV2 } from "@/lib/procureflow/payee-crypto";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!["Facility Manager", "Procurement Manager", "Admin"].includes(user.role)) {
      return NextResponse.json({ error: "This role cannot edit request drafts." }, { status: 403 });
    }

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    const payeeReady = verifyPayeeEncryptionKeyV2();
    if (!auditReady || !payeeReady) {
      return NextResponse.json({ error: "ProcureFlow write security is not ready for audited draft changes." }, { status: 503 });
    }

    const { id } = await context.params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid request id is required." }, { status: 400 });
    }
    const body = await request.json().catch(() => null) as DraftRequestInput | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "A valid draft update is required." }, { status: 400 });
    }

    const result = await updateOwnedDraft(user, requestId, body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update request draft.";
    const status = /only drafts that you created|cannot edit request drafts|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

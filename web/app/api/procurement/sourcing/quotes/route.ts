import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addVendorQuote, type AddVendorQuoteInput } from "@/lib/procureflow/vendor-quote-actions";
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

    const body = await request.json().catch(() => null) as AddVendorQuoteInput | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "A valid vendor quote payload is required." }, { status: 400 });
    }

    const result = await addVendorQuote(user, body);
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add vendor quote.";
    const status = /Only Procurement|another Procurement Manager|access is required|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

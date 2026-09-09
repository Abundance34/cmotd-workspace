import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { decryptPayeeValueV2, verifyPayeeEncryptionKeyV2 } from "@/lib/procureflow/payee-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_ROLES = new Set(["Facility Manager", "ICT"]);
const FINANCE_READY_STATUSES = new Set(["Approved", "PO Created", "Awaiting Payment", "Approved for Payment", "Paid", "Completed", "Closed"]);

function decrypt(value: unknown) {
  const token = String(value || "").trim();
  return token ? decryptPayeeValueV2(token) : null;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!["Facility Manager", "ICT", "Procurement Manager", "Finance", "Admin"].includes(user.role)) {
      return NextResponse.json({ error: "This role is not permitted to reveal full payment recipient details." }, { status: 403 });
    }
    if (!verifyPayeeEncryptionKeyV2()) {
      return NextResponse.json({ error: "Secure payment-detail access is temporarily unavailable because the active encryption key could not be verified." }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const requestId = Number(body?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
    }

    const sql = db();
    const details = await sql.begin(async (tx) => {
      const requestRows = await tx<any[]>`
        SELECT id, request_no, requested_by, facility_manager_user_id,
               assigned_procurement_manager_id, status, payment_status, next_role
        FROM purchase_requests
        WHERE id=${requestId}
        LIMIT 1
      `;
      const record = requestRows[0];
      if (!record) throw new Error("Request not found.");

      const owner = Number(record.requested_by || 0) === user.id || Number(record.facility_manager_user_id || 0) === user.id;
      const assignedProcurement = Number(record.assigned_procurement_manager_id || 0) === user.id;
      const financeReady = FINANCE_READY_STATUSES.has(String(record.status || ""))
        || ["Approved for Payment", "Paid"].includes(String(record.payment_status || ""));

      const allowed = user.role === "Admin"
        || (OWNER_ROLES.has(user.role) && owner)
        || (user.role === "Procurement Manager" && assignedProcurement)
        || (user.role === "Finance" && financeReady);
      if (!allowed) throw new Error("You are not authorized to reveal the full account details for this request.");

      const payeeRows = await tx<any[]>`
        SELECT id, payee_type,
               payee_name_encrypted, account_name_encrypted, bank_name_encrypted,
               account_number_encrypted, currency, payment_reference_encrypted,
               contact_email_encrypted, contact_phone_encrypted,
               recipient_known, verification_status, payment_readiness_status
        FROM payment_payee_details
        WHERE purchase_request_id=${requestId}
          AND COALESCE(is_current, TRUE)=TRUE
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `;
      const payee = payeeRows[0];
      if (!payee) throw new Error("No payment recipient details are stored for this request.");
      if (!payee.recipient_known) throw new Error("Full account details are not available because the payment recipient has not yet been confirmed.");

      const result = {
        payeeType: payee.payee_type || null,
        payeeName: decrypt(payee.payee_name_encrypted),
        accountName: decrypt(payee.account_name_encrypted),
        bankName: decrypt(payee.bank_name_encrypted),
        accountNumber: decrypt(payee.account_number_encrypted),
        currency: payee.currency || null,
        paymentReference: decrypt(payee.payment_reference_encrypted),
        contactEmail: decrypt(payee.contact_email_encrypted),
        contactPhone: decrypt(payee.contact_phone_encrypted),
      };

      await appendAuditEvent(tx, {
        action: "PAYEE_DETAILS_VIEWED",
        entityType: "Payment Payee Details",
        entityId: Number(payee.id),
        entityReference: record.request_no,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        afterValues: {
          purchase_request_id: requestId,
          access_role: user.role,
          fields_revealed: ["payee_name", "account_name", "bank_name", "account_number", "currency", "payment_reference", "contact_email", "contact_phone"],
        },
        metadata: {
          request_id: requestId,
          request_status: record.status,
          payment_status: record.payment_status,
          payment_readiness_status: payee.payment_readiness_status,
          verification_status: payee.verification_status,
          plaintext_values_logged: false,
        },
        reasonOrComment: "Full payment recipient details were revealed through the controlled in-app view. Plaintext values were not written to the audit event.",
        severity: "Normal",
        source: "nextjs",
      });

      return result;
    });

    return NextResponse.json(
      { ok: true, details },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Unable to reveal payment recipient details.";
    const cryptoFailure = /Fernet|signature mismatch|Invalid token|decrypt/i.test(raw);
    const message = cryptoFailure
      ? "Stored payment recipient details could not be opened with the active encryption key."
      : raw;
    const status = /not authorized|not permitted|Authentication/i.test(message)
      ? 403
      : /not found|No payment recipient/i.test(message)
        ? 404
        : /not available because/i.test(message)
          ? 409
          : cryptoFailure
            ? 503
            : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}

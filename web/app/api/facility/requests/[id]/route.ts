import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Facility Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only Utility Head / Facility Head or Admin can open this draft detail." }, { status: 403 });
    }

    const { id } = await context.params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid request id is required." }, { status: 400 });
    }

    const sql = db();
    const rows = await sql<any[]>`
      SELECT pr.id, pr.request_no, pr.requested_by, pr.facility_manager_user_id,
             pr.assigned_procurement_manager_id, pr.department_project, pr.request_date,
             pr.required_date, pr.category, pr.justification, pr.priority,
             pr.estimated_amount, pr.vendor_preference, pr.status, pr.source_type,
             pr.payment_status, pr.next_role, pr.attachments_json, pr.created_at,
             pr.updated_at, pr.submitted_at,
             requester.full_name AS requester_name,
             pm.full_name AS procurement_manager_name
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id = pr.requested_by
      LEFT JOIN users pm ON pm.id = pr.assigned_procurement_manager_id
      WHERE pr.id = ${requestId}
      LIMIT 1
    `;
    const record = rows[0];
    if (!record) return NextResponse.json({ error: "Request not found." }, { status: 404 });

    const owns = Number(record.requested_by) === user.id || Number(record.facility_manager_user_id || 0) === user.id;
    if (user.role !== "Admin" && !owns) {
      return NextResponse.json({ error: "You cannot open another user's Facility request." }, { status: 403 });
    }

    const [items, workflow, payeeRows] = await Promise.all([
      sql<any[]>`
        SELECT id, item_name, description, quantity, unit_price, total, category,
               suggested_vendor, created_at
        FROM purchase_request_items
        WHERE request_id = ${requestId}
        ORDER BY id
      `,
      sql<any[]>`
        SELECT id, event, status, note, user_id, created_at
        FROM workflow_events
        WHERE entity_type = 'Purchase Request' AND entity_id = ${requestId}
        ORDER BY created_at, id
      `,
      sql<any[]>`
        SELECT id, payee_type, payee_name_masked, account_name_masked,
               bank_name_masked, account_number_last4, currency, recipient_known,
               payment_readiness_status, verification_status, confirmed_at,
               verified_at, updated_at
        FROM payment_payee_details
        WHERE purchase_request_id = ${requestId} AND COALESCE(is_current, TRUE) = TRUE
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
    ]);

    const payee = payeeRows[0] || null;
    return NextResponse.json({
      ok: true,
      request: {
        ...record,
        id: Number(record.id),
        estimated_amount: Number(record.estimated_amount || 0),
      },
      items: items.map((item) => ({
        ...item,
        id: Number(item.id),
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total: Number(item.total || 0),
      })),
      workflow: workflow.map((event) => ({ ...event, id: Number(event.id) })),
      payee: payee ? { ...payee, id: Number(payee.id), account_number_masked: payee.account_number_last4 ? `******${payee.account_number_last4}` : "Pending" } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load request detail." },
      { status: 500 },
    );
  }
}

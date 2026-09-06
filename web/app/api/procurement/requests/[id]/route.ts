import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only Procurement Manager or Admin can open procurement request detail." }, { status: 403 });
    }

    const { id } = await context.params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid request id is required." }, { status: 400 });
    }

    const sql = db();
    const rows = await sql<any[]>`
      SELECT pr.*,
             requester.full_name AS requester_name,
             requester.role AS requester_role,
             fm.full_name AS facility_manager_name,
             pm.full_name AS procurement_manager_name
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id = pr.requested_by
      LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id
      LEFT JOIN users pm ON pm.id = pr.assigned_procurement_manager_id
      WHERE pr.id = ${requestId}
      LIMIT 1
    `;
    const record = rows[0];
    if (!record) return NextResponse.json({ error: "Request not found." }, { status: 404 });

    if (user.role === "Procurement Manager") {
      const assignedId = Number(record.assigned_procurement_manager_id || 0);
      const isAccessible = assignedId === 0 || assignedId === user.id || String(record.next_role || "") === "procurement_manager";
      if (!isAccessible) {
        return NextResponse.json({ error: "This request is assigned to another Procurement Manager." }, { status: 403 });
      }
    }

    const [items, workflow, approvals, payeeRows, sourcingRows, quoteRows, poRows, paymentRows] = await Promise.all([
      sql<any[]>`
        SELECT id, item_name, description, quantity, unit_price, total, category, suggested_vendor, created_at
        FROM purchase_request_items
        WHERE request_id = ${requestId}
        ORDER BY id
      `,
      sql<any[]>`
        SELECT we.id, we.event, we.status, we.note, we.user_id, u.full_name user_name, u.role user_role, we.created_at
        FROM workflow_events we
        LEFT JOIN users u ON u.id = we.user_id
        WHERE we.entity_type = 'Purchase Request' AND we.entity_id = ${requestId}
        ORDER BY we.created_at, we.id
      `,
      sql<any[]>`
        SELECT ah.id, ah.action, ah.status_before, ah.status_after, ah.reason, ah.note,
               ah.approved_by_role, ah.approval_mode, ah.created_at,
               u.full_name approved_by_name
        FROM approval_history ah
        LEFT JOIN users u ON u.id = COALESCE(ah.approved_by_user_id, ah.user_id)
        WHERE ah.entity_type = 'Purchase Request' AND ah.entity_id = ${requestId}
        ORDER BY ah.created_at, ah.id
      `,
      sql<any[]>`
        SELECT id, payee_type, payee_name_masked, account_name_masked, bank_name_masked,
               account_number_last4, currency, recipient_known, payment_readiness_status,
               verification_status, confirmed_at, verified_at, updated_at
        FROM payment_payee_details
        WHERE purchase_request_id = ${requestId}
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      sql<any[]>`
        SELECT st.*, v.name recommended_vendor_name
        FROM sourcing_tasks st
        LEFT JOIN vendors v ON v.id = st.recommended_vendor_id
        WHERE st.request_id = ${requestId}
        ORDER BY COALESCE(st.updated_at, st.created_at) DESC, st.id DESC
      `,
      sql<any[]>`
        SELECT vq.*, v.name registry_vendor_name
        FROM vendor_quotes vq
        JOIN sourcing_tasks st ON st.id = vq.sourcing_task_id
        LEFT JOIN vendors v ON v.id = vq.vendor_id
        WHERE st.request_id = ${requestId}
        ORDER BY vq.created_at DESC, vq.id DESC
      `,
      sql<any[]>`
        SELECT po.*, v.name vendor_name
        FROM purchase_orders po
        LEFT JOIN vendors v ON v.id = po.vendor_id
        WHERE po.request_id = ${requestId}
        ORDER BY COALESCE(po.updated_at, po.created_at) DESC, po.id DESC
      `,
      sql<any[]>`
        SELECT p.id, p.payment_no, p.amount, p.currency, p.status, p.verification_status,
               p.payment_date, p.payment_reference, p.transfer_type, p.created_at
        FROM payments p
        WHERE p.request_id = ${requestId}
        ORDER BY COALESCE(p.updated_at, p.created_at) DESC, p.id DESC
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
      approvals: approvals.map((approval) => ({ ...approval, id: Number(approval.id) })),
      payee: payee ? {
        ...payee,
        id: Number(payee.id),
        account_number_masked: payee.account_number_last4 ? `******${payee.account_number_last4}` : "Pending",
      } : null,
      sourcing: sourcingRows.map((row) => ({ ...row, id: Number(row.id) })),
      quotes: quoteRows.map((row) => ({
        ...row,
        id: Number(row.id),
        quoted_amount: Number(row.quotation_total ?? row.quoted_amount ?? 0),
      })),
      purchaseOrders: poRows.map((row) => ({ ...row, id: Number(row.id), total_amount: Number(row.total_amount || 0) })),
      payments: paymentRows.map((row) => ({ ...row, id: Number(row.id), amount: Number(row.amount || 0) })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load procurement request detail." },
      { status: 500 },
    );
  }
}

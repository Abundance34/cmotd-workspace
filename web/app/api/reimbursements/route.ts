import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";

const MAX_PROOF_BYTES = 3_000_000;
const ALLOWED_ROLES = new Set(["Facility Manager", "Procurement Manager"]);
const REIMBURSABLE_STATUSES = new Set([
  "Accepted by Procurement Manager",
  "Approved",
  "Vendor Recommendation Approved",
  "PO Created",
  "Sent to Vendor",
  "Awaiting Payment",
  "Approved for Payment",
  "Payment Approved",
  "Paid",
  "Completed",
  "Closed",
]);

function clean(value: unknown, max = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function reimbursementNo() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `RMB-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function parseProof(input: any) {
  const base64 = String(input?.base64 || "").replace(/\s+/g, "");
  if (!base64) throw new Error("Attach the receipt or other proof of the personal expenditure.");
  const fileName = clean(input?.fileName, 180) || "reimbursement-proof";
  const mimeType = clean(input?.mimeType, 120) || "application/octet-stream";
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("The supporting proof is empty.");
  if (bytes.length > MAX_PROOF_BYTES) throw new Error("The supporting proof is too large. Keep the file below 3 MB.");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return { fileName, mimeType, checksum, locator: `data:${mimeType};base64,${bytes.toString("base64")}` };
}

function canUseRequest(user: { id: number; role: string }, request: any) {
  if (user.role === "Facility Manager") {
    return Number(request.requested_by || 0) === user.id || Number(request.facility_manager_user_id || 0) === user.id;
  }
  return Number(request.requested_by || 0) === user.id || Number(request.assigned_procurement_manager_id || 0) === user.id;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role)) return NextResponse.json({ error: "Reimbursement requests are available to Facility and Procurement users." }, { status: 403 });

    const sql = db();
    const candidates = user.role === "Facility Manager"
      ? await sql<any[]>`
          SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.linked_po_id
          FROM purchase_requests pr
          WHERE (pr.requested_by=${user.id} OR pr.facility_manager_user_id=${user.id})
            AND pr.archived_at IS NULL
            AND pr.linked_expense_id IS NULL
            AND pr.status IN ('Accepted by Procurement Manager','Approved','Vendor Recommendation Approved','PO Created','Sent to Vendor','Awaiting Payment','Approved for Payment','Payment Approved','Paid','Completed','Closed')
          ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC
          LIMIT 300
        `
      : await sql<any[]>`
          SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.linked_po_id
          FROM purchase_requests pr
          WHERE (pr.requested_by=${user.id} OR pr.assigned_procurement_manager_id=${user.id})
            AND pr.archived_at IS NULL
            AND pr.linked_expense_id IS NULL
            AND pr.status IN ('Accepted by Procurement Manager','Approved','Vendor Recommendation Approved','PO Created','Sent to Vendor','Awaiting Payment','Approved for Payment','Payment Approved','Paid','Completed','Closed')
          ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC
          LIMIT 500
        `;

    const reimbursements = await sql<any[]>`
      SELECT e.id,e.expense_no,e.expense_date,e.amount,e.status,e.description,e.receipt_no,e.created_at,
             pr.id request_id,pr.request_no,pr.department_project,pr.category,
             CASE WHEN e.receipt_path LIKE 'data:%' THEN TRUE ELSE FALSE END AS has_proof
      FROM expenses e
      JOIN purchase_requests pr ON pr.linked_expense_id=e.id
      WHERE e.requested_by=${user.id} AND e.document_kind='Reimbursement'
      ORDER BY e.created_at DESC,e.id DESC
      LIMIT 300
    `;

    return NextResponse.json({
      candidates: candidates.map((row) => ({ ...row, id: Number(row.id), estimated_amount: Number(row.estimated_amount || 0), linked_po_id: row.linked_po_id == null ? null : Number(row.linked_po_id) })),
      reimbursements: reimbursements.map((row) => ({ ...row, id: Number(row.id), request_id: Number(row.request_id), amount: Number(row.amount || 0), has_proof: Boolean(row.has_proof) })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load reimbursement records." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role)) return NextResponse.json({ error: "This role cannot submit a reimbursement request." }, { status: 403 });

    const body = await request.json().catch(() => null) as any;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "A reimbursement request is required." }, { status: 400 });
    const requestId = Number(body.requestId || 0);
    const amount = Number(body.amount || 0);
    const spendDate = clean(body.spendDate, 20) || new Date().toISOString().slice(0, 10);
    const reason = clean(body.reason, 2000);
    const receiptNo = clean(body.receiptNo, 120) || null;
    const note = clean(body.note, 1500) || null;
    if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("Choose a valid purchase request.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid reimbursement amount greater than zero.");
    if (reason.length < 4) throw new Error("Explain what your personal funds were used for.");
    const proof = parseProof(body.file);

    const sql = db();
    const result = await sql.begin(async (tx) => {
      const rows = await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`;
      const record = rows[0];
      if (!record) throw new Error("Purchase request not found.");
      if (!canUseRequest(user, record)) throw new Error("You can request reimbursement only for a purchase request assigned or owned by your account.");
      if (record.archived_at || String(record.status || "") === "Deleted Draft") throw new Error("A deleted or archived request cannot be used for reimbursement.");
      if (!REIMBURSABLE_STATUSES.has(String(record.status || ""))) throw new Error(`Reimbursement is not available while this request is in '${record.status || "Unknown"}'. The request must be approved or further along in the workflow.`);
      if (record.linked_expense_id) {
        const existing = await tx<any[]>`SELECT id,expense_no,document_kind,status FROM expenses WHERE id=${Number(record.linked_expense_id)} LIMIT 1`;
        if (existing[0]?.document_kind === "Reimbursement") throw new Error(`A reimbursement request (${existing[0].expense_no}) already exists for ${record.request_no}.`);
        throw new Error("This purchase request already has a linked expense record and cannot accept another reimbursement claim.");
      }

      const no = reimbursementNo();
      const inserted = await tx<any[]>`
        INSERT INTO expenses (
          expense_no,expense_date,category,description,vendor_id,amount,payment_method,project_department,
          status,receipt_path,receipt_hash,receipt_no,invoice_no,tax_amount,linked_po_id,invoice_match_status,
          duplicate_warning,requested_by,approved_by,approved_at,rejection_reason,notes,created_at,document_kind
        ) VALUES (
          ${no},${spendDate},${clean(record.category,120)||'Other'},${reason},NULL,${amount},'Personal Funds',${clean(record.department_project,180)||null},
          'Pending Finance Review',${proof.locator},${proof.checksum},${receiptNo},NULL,0,${record.linked_po_id?Number(record.linked_po_id):null},'Not Applicable',
          FALSE,${user.id},NULL,NULL,NULL,${note || `Personal-funds reimbursement for ${record.request_no}`},NOW(),'Reimbursement'
        ) RETURNING id
      `;
      const reimbursementId = Number(inserted[0].id);
      await tx`UPDATE purchase_requests SET linked_expense_id=${reimbursementId},updated_at=NOW() WHERE id=${requestId}`;
      await tx`
        INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
        VALUES ('Purchase Request',${requestId},'Reimbursement Requested',${String(record.status || "")},${`${no}: ${user.fullName} requested reimbursement of NGN ${amount.toFixed(2)} for personal funds used on this request.`},${user.id},NOW())
      `;
      await tx`
        INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
        VALUES (${user.id},${user.role},'REIMBURSEMENT_REQUESTED','Expense',${reimbursementId},${`${no} submitted for ${record.request_no}`},${reason},'workflow',${user.id},NOW())
      `;
      await appendAuditEvent(tx, {
        action: "REIMBURSEMENT_REQUESTED",
        entityType: "Expense",
        entityId: reimbursementId,
        entityReference: no,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        afterValues: { request_id: requestId, request_no: record.request_no, amount, status: "Pending Finance Review", proof_checksum: proof.checksum, spend_date: spendDate },
        metadata: { document_kind: "Reimbursement", linked_purchase_request_id: requestId, proof_file_name: proof.fileName },
        reasonOrComment: reason,
      });
      await tx`
        INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
        VALUES (NULL,'Finance','New reimbursement request',${`${user.fullName} requested reimbursement of NGN ${amount.toLocaleString("en-NG")} for ${record.request_no}.`},'Expense',${reimbursementId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Review Expense','Expenses',NOW())
      `;
      await tx`
        INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
        VALUES (NULL,'Auditor','Reimbursement request recorded',${`${no} was submitted against ${record.request_no}.`},'Expense',${reimbursementId},FALSE,FALSE,'Normal','in_app',FALSE,FALSE,'Review Evidence','Expense Review',NOW())
      `;
      return { reimbursementId, reimbursementNo: no, status: "Pending Finance Review", requestNo: record.request_no };
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit reimbursement request.";
    const status = /only for a purchase request assigned|role cannot|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";

const MAX_PROOF_BYTES = 2_500_000;
const MAX_BATCH_ITEMS = 25;
const ALLOWED_ROLES = new Set([
  "Admin",
  "Procurement Manager",
  "Facility Manager",
  "ICT",
  "Logistics Officer",
  "Finance",
  "Approver",
  "Auditor",
]);
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

type PortableProof = {
  fileName: string;
  mimeType: string;
  checksum: string;
  locator: string;
  size: number;
};

type ParsedInputItem = {
  requestId: number;
  spendDate: string;
  amount: number;
  reason: string;
  receiptNo: string | null;
  note: string | null;
  proof: PortableProof;
};

function clean(value: unknown, max = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function reimbursementNo() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `RMB-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function parseProof(input: any): PortableProof {
  const base64 = String(input?.base64 || "").replace(/\s+/g, "");
  if (!base64) throw new Error("Attach the receipt or other proof for every reimbursement item.");
  const fileName = clean(input?.fileName, 180) || "reimbursement-proof";
  const mimeType = clean(input?.mimeType, 120) || "application/octet-stream";
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error(`The supporting proof '${fileName}' is empty.`);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return { fileName, mimeType, checksum, locator: `data:${mimeType};base64,${bytes.toString("base64")}`, size: bytes.length };
}

function canUseRequest(user: { id: number; role: string }, request: any) {
  if (user.role === "Facility Manager" || user.role === "ICT") {
    return Number(request.requested_by || 0) === user.id || Number(request.facility_manager_user_id || 0) === user.id;
  }
  if (user.role === "Procurement Manager") {
    return Number(request.requested_by || 0) === user.id || Number(request.assigned_procurement_manager_id || 0) === user.id;
  }
  return true;
}

function destinationForRole(role: string) {
  return role === "Procurement Manager" ? "Finance" : "Procurement Manager";
}

function parseManifest(locator: unknown) {
  const text = String(locator || "");
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.kind !== "reimbursement-batch-v2" || !Array.isArray(parsed.items)) return null;
    return parsed as { kind: string; batchNote?: string | null; items: any[] };
  } catch {
    return null;
  }
}

function groupExpenseRows(rows: any[]) {
  const grouped = new Map<number, any>();
  for (const row of rows) {
    const id = Number(row.id);
    let group = grouped.get(id);
    if (!group) {
      group = {
        id,
        expense_no: row.expense_no,
        expense_date: row.expense_date,
        amount: Number(row.amount || 0),
        status: row.status,
        description: row.description,
        receipt_no: row.receipt_no,
        created_at: row.created_at,
        requested_by: Number(row.requested_by || 0),
        claimant_name: row.claimant_name || null,
        claimant_role: row.claimant_role || null,
        receipt_path: row.receipt_path,
        linkedRows: [],
      };
      grouped.set(id, group);
    }
    if (row.request_id) {
      group.linkedRows.push({
        request_id: Number(row.request_id),
        request_no: row.request_no,
        department_project: row.department_project,
        category: row.request_category,
        assigned_procurement_manager_id: row.assigned_procurement_manager_id == null ? null : Number(row.assigned_procurement_manager_id),
      });
    }
  }

  return Array.from(grouped.values()).map((group) => {
    const manifest = parseManifest(group.receipt_path);
    const fallback = group.linkedRows[0] || {};
    const items = manifest
      ? manifest.items.map((item: any, index: number) => ({
          request_id: Number(item.requestId || 0),
          request_no: item.requestNo || "—",
          department_project: item.departmentProject || null,
          category: item.category || null,
          spend_date: item.spendDate || group.expense_date,
          amount: Number(item.amount || 0),
          reason: item.reason || "Personal-funds reimbursement",
          receipt_no: item.receiptNo || null,
          note: item.note || null,
          proof_index: index,
          has_proof: String(item.locator || "").startsWith("data:"),
          file_name: item.fileName || null,
        }))
      : [{
          request_id: Number(fallback.request_id || 0),
          request_no: fallback.request_no || "—",
          department_project: fallback.department_project || null,
          category: fallback.category || null,
          spend_date: group.expense_date,
          amount: group.amount,
          reason: group.description,
          receipt_no: group.receipt_no || null,
          note: null,
          proof_index: 0,
          has_proof: String(group.receipt_path || "").startsWith("data:"),
          file_name: null,
        }];
    const { receipt_path, linkedRows, ...safe } = group;
    return { ...safe, items };
  });
}

async function candidateRequests(sql: ReturnType<typeof db>, user: { id: number; role: string }) {
  const statusSql = sql(REIMBURSABLE_STATUSES.size ? Array.from(REIMBURSABLE_STATUSES) : ["Approved"]);
  if (user.role === "Facility Manager" || user.role === "ICT") {
    return sql<any[]>`
      SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.linked_po_id
      FROM purchase_requests pr
      WHERE (pr.requested_by=${user.id} OR pr.facility_manager_user_id=${user.id})
        AND pr.archived_at IS NULL
        AND pr.linked_expense_id IS NULL
        AND pr.status IN ${statusSql}
      ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC
      LIMIT 300
    `;
  }
  if (user.role === "Procurement Manager") {
    return sql<any[]>`
      SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.linked_po_id
      FROM purchase_requests pr
      WHERE (pr.requested_by=${user.id} OR pr.assigned_procurement_manager_id=${user.id})
        AND pr.archived_at IS NULL
        AND pr.linked_expense_id IS NULL
        AND pr.status IN ${statusSql}
      ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC
      LIMIT 500
    `;
  }
  return sql<any[]>`
    SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.linked_po_id
    FROM purchase_requests pr
    WHERE pr.archived_at IS NULL
      AND pr.linked_expense_id IS NULL
      AND pr.status IN ${statusSql}
    ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC
    LIMIT 500
  `;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role)) return NextResponse.json({ error: "Reimbursement requests are not available to this role." }, { status: 403 });

    const sql = db();
    const [candidates, ownRows, reviewRows] = await Promise.all([
      candidateRequests(sql, user),
      sql<any[]>`
        SELECT e.id,e.expense_no,e.expense_date,e.amount,e.status,e.description,e.receipt_no,e.receipt_path,e.created_at,e.requested_by,
               pr.id request_id,pr.request_no,pr.department_project,pr.category request_category,pr.assigned_procurement_manager_id
        FROM expenses e
        LEFT JOIN purchase_requests pr ON pr.linked_expense_id=e.id
        WHERE e.requested_by=${user.id} AND e.document_kind='Reimbursement'
        ORDER BY e.created_at DESC,e.id DESC,pr.id
        LIMIT 1200
      `,
      user.role === "Procurement Manager"
        ? sql<any[]>`
            SELECT e.id,e.expense_no,e.expense_date,e.amount,e.status,e.description,e.receipt_no,e.receipt_path,e.created_at,e.requested_by,
                   pr.id request_id,pr.request_no,pr.department_project,pr.category request_category,pr.assigned_procurement_manager_id,
                   claimant.full_name claimant_name,claimant.role claimant_role
            FROM expenses e
            JOIN users claimant ON claimant.id=e.requested_by
            LEFT JOIN purchase_requests pr ON pr.linked_expense_id=e.id
            WHERE e.document_kind='Reimbursement' AND e.status='Pending Procurement Review'
              AND EXISTS (
                SELECT 1 FROM purchase_requests px
                WHERE px.linked_expense_id=e.id
                  AND (px.assigned_procurement_manager_id=${user.id} OR px.assigned_procurement_manager_id IS NULL)
              )
            ORDER BY e.created_at ASC,e.id ASC,pr.id
            LIMIT 1500
          `
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      currentRole: user.role,
      routeDestination: destinationForRole(user.role),
      candidates: candidates.map((row: any) => ({ ...row, id: Number(row.id), estimated_amount: Number(row.estimated_amount || 0), linked_po_id: row.linked_po_id == null ? null : Number(row.linked_po_id) })),
      reimbursements: groupExpenseRows(ownRows),
      reviewQueue: groupExpenseRows(reviewRows),
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
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (!rawItems.length) throw new Error("Add at least one reimbursement item.");
    if (rawItems.length > MAX_BATCH_ITEMS) throw new Error(`A reimbursement batch can contain at most ${MAX_BATCH_ITEMS} items.`);

    const items: ParsedInputItem[] = rawItems.map((raw: any, index: number) => {
      const requestId = Number(raw?.requestId || 0);
      const amount = Number(raw?.amount || 0);
      const spendDate = clean(raw?.spendDate, 20) || new Date().toISOString().slice(0, 10);
      const reason = clean(raw?.reason, 2000);
      const receiptNo = clean(raw?.receiptNo, 120) || null;
      const note = clean(raw?.note, 1500) || null;
      if (!Number.isInteger(requestId) || requestId <= 0) throw new Error(`Item ${index + 1}: choose a valid purchase request.`);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Item ${index + 1}: enter a valid amount greater than zero.`);
      if (reason.length < 4) throw new Error(`Item ${index + 1}: explain what your personal funds were used for.`);
      return { requestId, amount, spendDate, reason, receiptNo, note, proof: parseProof(raw?.file) };
    });
    const proofBytes = items.reduce((sum, item) => sum + item.proof.size, 0);
    if (proofBytes > MAX_PROOF_BYTES) throw new Error("The combined supporting proofs are too large. Keep the reimbursement batch below 2.5 MB of files.");

    const batchNote = clean(body.batchNote, 2000) || null;
    const initialStatus = user.role === "Procurement Manager" ? "Pending Finance Review" : "Pending Procurement Review";
    const destination = destinationForRole(user.role);
    const sql = db();

    const result = await sql.begin(async (tx) => {
      const uniqueIds = Array.from(new Set(items.map((item) => item.requestId)));
      const records = new Map<number, any>();
      for (const requestId of uniqueIds) {
        const rows = await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`;
        const record = rows[0];
        if (!record) throw new Error(`Purchase request #${requestId} was not found.`);
        if (!canUseRequest(user, record)) throw new Error(`You cannot request reimbursement against ${record.request_no} from this account.`);
        if (record.archived_at || String(record.status || "") === "Deleted Draft") throw new Error(`${record.request_no} is deleted or archived and cannot be used for reimbursement.`);
        if (!REIMBURSABLE_STATUSES.has(String(record.status || ""))) throw new Error(`${record.request_no} is in '${record.status || "Unknown"}'. It must be approved or further along before reimbursement.`);
        if (record.linked_expense_id) throw new Error(`${record.request_no} already has a linked reimbursement/expense record.`);
        records.set(requestId, record);
      }

      const assignedPmIds = Array.from(new Set(Array.from(records.values()).map((record) => Number(record.assigned_procurement_manager_id || 0)).filter(Boolean)));
      if (user.role !== "Procurement Manager" && assignedPmIds.length > 1) {
        throw new Error("The selected requests belong to different Procurement Managers. Submit separate reimbursement batches for each Procurement Manager.");
      }
      const targetPmId = assignedPmIds[0] || null;
      const totalAmount = Math.round((items.reduce((sum, item) => sum + item.amount, 0) + Number.EPSILON) * 100) / 100;
      const earliestSpendDate = items.map((item) => item.spendDate).sort()[0];
      const categories = Array.from(new Set(items.map((item) => clean(records.get(item.requestId)?.category, 120) || "Other")));
      const departments = Array.from(new Set(items.map((item) => clean(records.get(item.requestId)?.department_project, 180)).filter(Boolean)));
      const poIds = Array.from(new Set(items.map((item) => Number(records.get(item.requestId)?.linked_po_id || 0)).filter(Boolean)));
      const no = reimbursementNo();

      const manifestItems = items.map((item) => {
        const record = records.get(item.requestId);
        return {
          requestId: item.requestId,
          requestNo: record.request_no,
          departmentProject: record.department_project || null,
          category: record.category || null,
          spendDate: item.spendDate,
          amount: item.amount,
          reason: item.reason,
          receiptNo: item.receiptNo,
          note: item.note,
          fileName: item.proof.fileName,
          mimeType: item.proof.mimeType,
          checksum: item.proof.checksum,
          locator: item.proof.locator,
        };
      });
      const manifest = JSON.stringify({ kind: "reimbursement-batch-v2", batchNote, items: manifestItems });
      const manifestHash = createHash("sha256").update(JSON.stringify(manifestItems.map(({ locator, ...item }) => item))).digest("hex");
      const description = items.length === 1 ? items[0].reason : `Personal-funds reimbursement batch — ${items.length} items`;
      const parentReceiptNo = items.length === 1 ? items[0].receiptNo : null;

      const inserted = await tx<any[]>`
        INSERT INTO expenses (
          expense_no,expense_date,category,description,vendor_id,amount,payment_method,project_department,
          status,receipt_path,receipt_hash,receipt_no,invoice_no,tax_amount,linked_po_id,invoice_match_status,
          duplicate_warning,requested_by,approved_by,approved_at,rejection_reason,notes,created_at,document_kind
        ) VALUES (
          ${no},${earliestSpendDate},${categories.length === 1 ? categories[0] : "Multiple"},${description},NULL,${totalAmount},'Personal Funds',${departments.length === 1 ? departments[0] : "Multiple Requests"},
          ${initialStatus},${manifest},${manifestHash},${parentReceiptNo},NULL,0,${poIds.length === 1 ? poIds[0] : null},'Not Applicable',
          FALSE,${user.id},NULL,NULL,NULL,${batchNote || `${items.length} personal-funds reimbursement item(s)`},NOW(),'Reimbursement'
        ) RETURNING id
      `;
      const reimbursementId = Number(inserted[0].id);

      for (const requestId of uniqueIds) {
        const record = records.get(requestId);
        const requestTotal = items.filter((item) => item.requestId === requestId).reduce((sum, item) => sum + item.amount, 0);
        await tx`UPDATE purchase_requests SET linked_expense_id=${reimbursementId},updated_at=NOW() WHERE id=${requestId}`;
        await tx`
          INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
          VALUES ('Purchase Request',${requestId},'Reimbursement Batch Requested',${String(record.status || "")},${`${no}: ${user.fullName} included NGN ${requestTotal.toFixed(2)} of personal expenditure for this request. Batch routed to ${destination}.`},${user.id},NOW())
        `;
      }

      await tx`
        INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
        VALUES (${user.id},${user.role},'REIMBURSEMENT_BATCH_REQUESTED','Expense',${reimbursementId},${`${no} submitted — ${items.length} item(s), NGN ${totalAmount.toFixed(2)}`},${batchNote || "Personal-funds reimbursement batch"},'workflow',${user.id},NOW())
      `;
      await appendAuditEvent(tx, {
        action: "REIMBURSEMENT_BATCH_REQUESTED",
        entityType: "Expense",
        entityId: reimbursementId,
        entityReference: no,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        afterValues: { total_amount: totalAmount, item_count: items.length, status: initialStatus, request_ids: uniqueIds },
        metadata: { document_kind: "Reimbursement", route_destination: destination, proof_manifest_hash: manifestHash, items: manifestItems.map(({ locator, ...item }) => item) },
        reasonOrComment: batchNote || description,
      });

      const notificationMessage = `${user.fullName} (${user.role}) submitted ${items.length} reimbursement item(s) totalling NGN ${totalAmount.toLocaleString("en-NG")} under ${no}.`;
      if (user.role === "Procurement Manager") {
        await tx`
          INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
          VALUES (NULL,'Finance','New reimbursement batch',${notificationMessage},'Expense',${reimbursementId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Review Reimbursement','Reimbursement Request',NOW())
        `;
      } else if (targetPmId) {
        await tx`
          INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
          VALUES (${targetPmId},NULL,'Reimbursement batch requires Procurement review',${notificationMessage},'Expense',${reimbursementId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Review Reimbursement','Reimbursement Request',NOW())
        `;
      } else {
        await tx`
          INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
          VALUES (NULL,'Procurement Manager','Reimbursement batch requires Procurement review',${notificationMessage},'Expense',${reimbursementId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Review Reimbursement','Reimbursement Request',NOW())
        `;
      }
      await tx`
        INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
        VALUES (NULL,'Auditor','Reimbursement batch recorded',${`${no}: ${items.length} item(s), NGN ${totalAmount.toLocaleString("en-NG")}, routed to ${destination}.`},'Expense',${reimbursementId},FALSE,FALSE,'Normal','in_app',FALSE,FALSE,'Review Evidence','Expense Review',NOW())
      `;

      return { reimbursementId, reimbursementNo: no, status: initialStatus, destination, totalAmount, itemCount: items.length, requestIds: uniqueIds };
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit reimbursement request.";
    const status = /cannot request reimbursement against|role cannot|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager") return NextResponse.json({ error: "Only Procurement Manager can review reimbursement requests before Finance." }, { status: 403 });

    const body = await request.json().catch(() => null) as any;
    const reimbursementId = Number(body?.reimbursementId || 0);
    const decision = clean(body?.decision, 20).toLowerCase();
    const note = clean(body?.note, 1500);
    if (!Number.isInteger(reimbursementId) || reimbursementId <= 0) throw new Error("Choose a valid reimbursement request.");
    if (!["forward", "reject"].includes(decision)) throw new Error("Choose a valid reimbursement review decision.");
    if (decision === "reject" && note.length < 4) throw new Error("Enter a reason before rejecting a reimbursement request.");

    const sql = db();
    const result = await sql.begin(async (tx) => {
      const expenseRows = await tx<any[]>`
        SELECT e.*,claimant.full_name claimant_name,claimant.username claimant_username,claimant.role claimant_role
        FROM expenses e JOIN users claimant ON claimant.id=e.requested_by
        WHERE e.id=${reimbursementId}
        FOR UPDATE OF e
      `;
      const row = expenseRows[0];
      if (!row || row.document_kind !== "Reimbursement") throw new Error("Reimbursement request not found.");
      if (String(row.status || "") !== "Pending Procurement Review") throw new Error(`This reimbursement is already in '${row.status || "Unknown"}' and cannot be reviewed from the Procurement queue.`);

      const linkedRequests = await tx<any[]>`
        SELECT id,request_no,assigned_procurement_manager_id
        FROM purchase_requests WHERE linked_expense_id=${reimbursementId}
        ORDER BY id
      `;
      if (!linkedRequests.length) throw new Error("This reimbursement batch is not linked to a purchase request.");
      const assignedIds = Array.from(new Set(linkedRequests.map((requestRow) => Number(requestRow.assigned_procurement_manager_id || 0)).filter(Boolean)));
      if (assignedIds.length && !assignedIds.includes(user.id)) throw new Error("This reimbursement belongs to another assigned Procurement Manager.");

      const newStatus = decision === "forward" ? "Pending Finance Review" : "Reimbursement Rejected";
      const reviewNote = note || "Procurement reviewed the reimbursement batch and forwarded it to Finance.";
      await tx`
        UPDATE expenses
        SET status=${newStatus},rejection_reason=${decision === "reject" ? reviewNote : null},
            notes=CASE WHEN COALESCE(notes,'')='' THEN ${reviewNote} ELSE notes || E'\nProcurement review: ' || ${reviewNote} END
        WHERE id=${reimbursementId}
      `;
      for (const requestRow of linkedRequests) {
        await tx`
          INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
          VALUES ('Purchase Request',${Number(requestRow.id)},${decision === "forward" ? "Reimbursement Batch Forwarded to Finance" : "Reimbursement Batch Rejected"},${newStatus},${reviewNote},${user.id},NOW())
        `;
      }
      await tx`
        INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
        VALUES (${user.id},${user.role},${decision === "forward" ? "REIMBURSEMENT_BATCH_FORWARDED" : "REIMBURSEMENT_BATCH_REJECTED"},'Expense',${reimbursementId},${`${row.expense_no} — ${newStatus}`},${reviewNote},'workflow',${Number(row.requested_by)},NOW())
      `;
      await appendAuditEvent(tx, {
        action: decision === "forward" ? "REIMBURSEMENT_BATCH_FORWARDED_TO_FINANCE" : "REIMBURSEMENT_BATCH_REJECTED",
        entityType: "Expense",
        entityId: reimbursementId,
        entityReference: row.expense_no,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        beforeValues: { status: row.status },
        afterValues: { status: newStatus },
        metadata: { linked_purchase_request_ids: linkedRequests.map((requestRow) => Number(requestRow.id)), claimant_role: row.claimant_role },
        reasonOrComment: reviewNote,
      });

      const manifest = parseManifest(row.receipt_path);
      const itemCount = manifest?.items?.length || linkedRequests.length || 1;
      const requestNos = linkedRequests.map((requestRow) => requestRow.request_no).join(", ");
      await tx`
        INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
        VALUES (${Number(row.requested_by)},NULL,${decision === "forward" ? "Reimbursement batch forwarded to Finance" : "Reimbursement batch rejected"},${`${row.expense_no} (${itemCount} item(s), NGN ${Number(row.amount || 0).toLocaleString("en-NG")}) is now ${newStatus}. ${reviewNote}`},'Expense',${reimbursementId},FALSE,FALSE,${decision === "forward" ? "Normal" : "High"},'in_app',FALSE,FALSE,'View Reimbursement','Reimbursement Request',NOW())
      `;
      if (decision === "forward") {
        await tx`
          INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
          VALUES (NULL,'Finance','Reimbursement batch forwarded by Procurement',${`${row.expense_no} from ${row.claimant_name} (${row.claimant_role}) contains ${itemCount} item(s) totalling NGN ${Number(row.amount || 0).toLocaleString("en-NG")} for ${requestNos}.`},'Expense',${reimbursementId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Review Reimbursement','Reimbursement Request',NOW())
        `;
      }
      await tx`
        INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
        VALUES (NULL,'Auditor','Reimbursement batch review recorded',${`${row.expense_no} changed from Pending Procurement Review to ${newStatus}.`},'Expense',${reimbursementId},FALSE,FALSE,'Normal','in_app',FALSE,FALSE,'Review Evidence','Expense Review',NOW())
      `;
      return { reimbursementId, reimbursementNo: row.expense_no, status: newStatus, requestNos, itemCount };
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review reimbursement request.";
    const status = /another assigned Procurement Manager|Only Procurement Manager|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

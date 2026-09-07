import fs from "node:fs";
import path from "node:path";

const root = "/app";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}
function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}
function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Reimbursement/draft-delete patch could not find ${label}.`);
  return source.replace(search, replacement);
}
function ensureImport(source, marker, importLine, label) {
  if (source.includes(importLine)) return source;
  return replaceRequired(source, marker, `${marker}\n${importLine}`, label);
}

// 1) Wire the Reimbursement workspace into Facility and Procurement navigation content.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);
  source = ensureImport(
    source,
    'import { GlobalTools } from "@/components/global-tools";',
    'import { ReimbursementWorkspace } from "@/components/reimbursement-workspace";',
    "Reimbursement workspace import",
  );
  if (!source.includes('if(section==="Reimbursement")return <ReimbursementWorkspace/>;')) {
    source = replaceRequired(
      source,
      '  if(section==="Create Request Draft")return <FacilityDraftForm/>;',
      '  if(section==="Create Request Draft")return <FacilityDraftForm/>;\n  if(section==="Reimbursement")return <ReimbursementWorkspace/>;',
      "Facility reimbursement route",
    );
    const procurementMarker = 'function ProcurementSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){';
    source = replaceRequired(
      source,
      procurementMarker,
      `${procurementMarker}\n  if(section==="Reimbursement")return <ReimbursementWorkspace/>;`,
      "Procurement reimbursement route",
    );
  }
  source = source.replace(
    'value.includes("expense")||value.includes("cash advance")||value.includes("reconciliation")',
    'value.includes("expense")||value.includes("cash advance")||value.includes("reconciliation")||value.includes("reimburse")',
  );
  write(relativePath, source);
}

// 2) Facility drafts can be deleted only before submission. The backend performs a soft archive so audit evidence remains.
{
  const relativePath = "components/facility-request-register.tsx";
  let source = read(relativePath);
  if (!source.includes("Trash2")) {
    source = replaceRequired(
      source,
      'import { Building2, CalendarDays, ChevronRight, CircleDot, MessageSquare, Pencil, Send, X } from "lucide-react";',
      'import { Building2, CalendarDays, ChevronRight, CircleDot, MessageSquare, Pencil, Send, Trash2, X } from "lucide-react";',
      "Facility Trash2 import",
    );
  }
  if (!source.includes("const DELETABLE = new Set")) {
    source = replaceRequired(
      source,
      'const EDITABLE = new Set(["FM Draft", "Draft", "Returned for Correction", "Returned to Facility Manager", "Returned"]);',
      'const EDITABLE = new Set(["FM Draft", "Draft", "Returned for Correction", "Returned to Facility Manager", "Returned"]);\nconst DELETABLE = new Set(["FM Draft", "Draft"]);',
      "Facility deletable statuses",
    );
  }
  if (!source.includes("const [deleting, setDeleting]")) {
    source = replaceRequired(
      source,
      '  const [submitting, setSubmitting] = useState(false);',
      '  const [submitting, setSubmitting] = useState(false);\n  const [deleting, setDeleting] = useState(false);',
      "Facility delete state",
    );
  }
  if (!source.includes("async function deleteDraft()")) {
    const marker = '  async function sendContextMessage() {';
    const fn = `  async function deleteDraft() {
    if (!selectedId || !detail?.request || !DELETABLE.has(String(detail.request.status || ""))) return;
    const confirmed = await requestConfirmation({
      eyebrow: "DELETE DRAFT",
      title: "Delete this unsubmitted request draft?",
      description: \`\${detail.request.request_no} will disappear from your active request lists.\`,
      reference: detail.request.request_no,
      detail: "Only an unsubmitted draft can be deleted. ProcureFlow keeps a protected audit record of the deletion instead of erasing procurement evidence.",
      confirmLabel: "Delete Draft",
      tone: "danger",
    });
    if (!confirmed) return;
    setDeleting(true); setMessage(null);
    try {
      const response = await fetch(\`/api/requests/drafts/\${selectedId}\`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to delete this draft.");
      setDetail((current: any) => current ? { ...current, request: { ...current.request, status: "Deleted Draft" } } : current);
      setMessage({ type: "success", text: \`\${payload?.result?.requestNo || detail.request.request_no} was deleted from the active draft workspace.\` });
      setEditing(false); router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to delete this draft." }); }
    finally { setDeleting(false); }
  }

`;
    source = replaceRequired(source, marker, `${fn}${marker}`, "Facility context-message function marker");
  }
  if (!source.includes("draft-delete-button")) {
    const editButton = '{EDITABLE.has(String(detail.request.status || "")) ? <button type="button" className="facility-edit-primary" onClick={() => setEditing(true)}><Pencil size={16}/>Edit Draft</button> : null}';
    const replacement = `${editButton}{DELETABLE.has(String(detail.request.status || "")) ? <button type="button" className="draft-delete-button" disabled={deleting} onClick={() => void deleteDraft()}><Trash2 size={16}/>{deleting ? "Deleting…" : "Delete Draft"}</button> : null}`;
    source = replaceRequired(source, editButton, replacement, "Facility edit-draft action");
  }
  write(relativePath, source);
}

// 3) Procurement-originated drafts get the same delete option before independent submission.
{
  const relativePath = "components/procurement-request-register.tsx";
  let source = read(relativePath);
  if (!source.includes("Trash2")) {
    source = replaceRequired(
      source,
      'import { CalendarDays, ChevronRight, CircleDollarSign, PackageSearch, Pencil, Send, UserRound, X } from "lucide-react";',
      'import { CalendarDays, ChevronRight, CircleDollarSign, PackageSearch, Pencil, Send, Trash2, UserRound, X } from "lucide-react";',
      "Procurement Trash2 import",
    );
  }
  if (!source.includes("const PM_DELETABLE")) {
    source = replaceRequired(
      source,
      'const PM_EDITABLE = new Set(["PM Draft", "Draft", "Returned for Correction", "Returned to Procurement Manager", "Returned"]);',
      'const PM_EDITABLE = new Set(["PM Draft", "Draft", "Returned for Correction", "Returned to Procurement Manager", "Returned"]);\nconst PM_DELETABLE = new Set(["PM Draft", "Draft"]);',
      "Procurement deletable statuses",
    );
  }
  if (!source.includes("const [deleting, setDeleting]")) {
    source = replaceRequired(
      source,
      '  const [submitting, setSubmitting] = useState(false);',
      '  const [submitting, setSubmitting] = useState(false);\n  const [deleting, setDeleting] = useState(false);',
      "Procurement delete state",
    );
  }
  if (!source.includes("async function deleteOwnedDraft()")) {
    const marker = '  if (!rows.length) return <div className="empty-state">No purchase requests are available.</div>;';
    const fn = `  async function deleteOwnedDraft() {
    if (!selectedId || !detail?.request || !PM_DELETABLE.has(String(detail.request.status || ""))) return;
    const confirmed = await requestConfirmation({
      eyebrow: "DELETE DRAFT",
      title: "Delete this Procurement request draft?",
      description: \`\${detail.request.request_no} has not been submitted to Approver / MD and will be removed from active request lists.\`,
      reference: detail.request.request_no,
      detail: "The operational draft is removed, while the deletion itself remains in the protected audit trail.",
      confirmLabel: "Delete Draft",
      tone: "danger",
    });
    if (!confirmed) return;
    setDeleting(true); setMessage(null);
    try {
      const response = await fetch(\`/api/requests/drafts/\${selectedId}\`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to delete this Procurement draft.");
      setDetail((current: any) => current ? { ...current, request: { ...current.request, status: "Deleted Draft" } } : current);
      setMessage({ type: "success", text: \`\${payload?.result?.requestNo || detail.request.request_no} was deleted from the active draft workspace.\` });
      setEditing(false); router.refresh(); onChanged?.();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to delete this Procurement draft." }); }
    finally { setDeleting(false); }
  }

`;
    source = replaceRequired(source, marker, `${fn}${marker}`, "Procurement register empty-state marker");
  }
  if (!source.includes("draft-delete-button")) {
    const actionCluster = '<div><button type="button" className="facility-edit-primary" onClick={() => setEditing(true)}><Pencil size={16}/>Edit Draft</button><button type="button" className="facility-submit-primary" disabled={submitting} onClick={() => void submitOwned()}><Send size={16}/>{submitting ? "Submitting…" : "Submit to Approver / MD"}</button></div>';
    const replacement = '<div><button type="button" className="facility-edit-primary" onClick={() => setEditing(true)}><Pencil size={16}/>Edit Draft</button>{PM_DELETABLE.has(String(detail.request.status || "")) ? <button type="button" className="draft-delete-button" disabled={deleting} onClick={() => void deleteOwnedDraft()}><Trash2 size={16}/>{deleting ? "Deleting…" : "Delete Draft"}</button> : null}<button type="button" className="facility-submit-primary" disabled={submitting || deleting} onClick={() => void submitOwned()}><Send size={16}/>{submitting ? "Submitting…" : "Submit to Approver / MD"}</button></div>';
    source = replaceRequired(source, actionCluster, replacement, "Procurement owned-draft actions");
  }
  write(relativePath, source);
}

// 4) Hide soft-deleted drafts from operational Facility/Procurement request lists while retaining them for Admin/Auditor evidence.
{
  const relativePath = "lib/procureflow/parity-data.ts";
  let source = read(relativePath);
  source = source.replace(
    `WHERE pr.facility_manager_user_id=\${user.id} OR pr.requested_by=\${user.id} ORDER BY`,
    `WHERE (pr.facility_manager_user_id=\${user.id} OR pr.requested_by=\${user.id}) AND pr.archived_at IS NULL AND COALESCE(pr.status,'') <> 'Deleted Draft' ORDER BY`,
  );
  source = source.replace(
    `WHERE pr.assigned_procurement_manager_id=\${user.id} OR pr.next_role='procurement_manager' OR pr.requested_by=\${user.id} ORDER BY`,
    `WHERE (pr.assigned_procurement_manager_id=\${user.id} OR pr.next_role='procurement_manager' OR pr.requested_by=\${user.id}) AND pr.archived_at IS NULL AND COALESCE(pr.status,'') <> 'Deleted Draft' ORDER BY`,
  );
  if (!source.includes("reimbursement_request_no")) {
    source = replaceRequired(
      source,
      'SELECT e.*, v.name vendor_name, po.po_no, u.full_name requester_name, a.full_name approved_by_name\n    FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN purchase_orders po ON po.id=e.linked_po_id\n    LEFT JOIN users u ON u.id=e.requested_by LEFT JOIN users a ON a.id=e.approved_by',
      'SELECT e.*, v.name vendor_name, po.po_no, u.full_name requester_name, a.full_name approved_by_name, pr.request_no reimbursement_request_no\n    FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN purchase_orders po ON po.id=e.linked_po_id\n    LEFT JOIN users u ON u.id=e.requested_by LEFT JOIN users a ON a.id=e.approved_by LEFT JOIN purchase_requests pr ON pr.linked_expense_id=e.id',
      "Expense reimbursement linkage",
    );
  }
  write(relativePath, source);
}
{
  const relativePath = "lib/procureflow/facility-data.ts";
  let source = read(relativePath);
  source = source.replace(
    '    WHERE requested_by = ${userId}\n       OR facility_manager_user_id = ${userId}\n    ORDER BY COALESCE(updated_at, created_at) DESC\n    LIMIT 30',
    '    WHERE (requested_by = ${userId} OR facility_manager_user_id = ${userId})\n      AND archived_at IS NULL AND COALESCE(status, \'\') <> \'Deleted Draft\'\n    ORDER BY COALESCE(updated_at, created_at) DESC\n    LIMIT 30',
  );
  write(relativePath, source);
}
{
  const relativePath = "lib/procureflow/procurement-data.ts";
  let source = read(relativePath);
  source = source.replace(
    '      WHERE pr.assigned_procurement_manager_id = ${userId}\n         OR pr.assigned_procurement_manager_id IS NULL\n      ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC\n      LIMIT 150',
    '      WHERE pr.archived_at IS NULL AND COALESCE(pr.status, \'\') <> \'Deleted Draft\'\n        AND (pr.assigned_procurement_manager_id = ${userId} OR pr.assigned_procurement_manager_id IS NULL)\n      ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC\n      LIMIT 150',
  );
  write(relativePath, source);
}

// 5) Finance can immediately identify reimbursement claims inside the existing Expense workspace and open the supporting proof.
{
  const relativePath = "components/parity-workspace.tsx";
  let source = read(relativePath);
  if (!source.includes("reimbursement_request_no||")) {
    const oldHead = '<thead><tr><th>Expense</th><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>';
    const newHead = '<thead><tr><th>Expense</th><th>Type</th><th>Claimant</th><th>Request</th><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Status</th><th>Proof</th></tr></thead>';
    source = replaceRequired(source, oldHead, newHead, "Finance expense table header");
    const oldRow = '<tr key={e.id}><td><strong>{e.expense_no}</strong></td><td>{dateText(e.expense_date)}</td><td>{e.category}</td><td>{e.description}</td><td>{e.vendor_name||"—"}</td><td>{money(e.amount)}</td><td>{e.payment_method||"—"}</td><td><Status>{e.status}</Status></td></tr>';
    const newRow = '<tr key={e.id}><td><strong>{e.expense_no}</strong></td><td>{e.document_kind||"Expense"}</td><td>{e.requester_name||"—"}</td><td>{e.reimbursement_request_no||e.po_no||"—"}</td><td>{dateText(e.expense_date)}</td><td>{e.category}</td><td>{e.description}</td><td>{money(e.amount)}</td><td>{e.payment_method||"—"}</td><td><Status>{e.status}</Status></td><td>{e.document_kind==="Reimbursement"&&String(e.receipt_path||"").startsWith("data:")?<a className="table-action-link" href={`/api/reimbursements/proof?id=${e.id}`}>Download</a>:"—"}</td></tr>';
    source = replaceRequired(source, oldRow, newRow, "Finance expense table row");
  }
  write(relativePath, source);
}

// 6) Presentation for delete action and reimbursement request summary.
{
  const relativePath = "app/local-preview-parity.css";
  let source = read(relativePath);
  if (!source.includes("REIMBURSEMENT + DRAFT DELETE")) {
    source += `

/* REIMBURSEMENT + DRAFT DELETE */
.draft-delete-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:0 13px;border:1px solid color-mix(in srgb,#dc2626 38%,var(--border,#d9e1ec));border-radius:8px;background:color-mix(in srgb,#dc2626 8%,transparent);color:#dc2626;font-weight:750;cursor:pointer}
.draft-delete-button:hover:not(:disabled){background:color-mix(in srgb,#dc2626 14%,transparent)}.draft-delete-button:disabled{opacity:.55;cursor:not-allowed}
.reimbursement-form-card{display:grid;gap:16px}.reimbursement-info{margin:0}.reimbursement-request-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:13px;border:1px solid var(--border,#d9e1ec);border-radius:11px;background:color-mix(in srgb,var(--surface,#fff) 92%,#4f6df5 8%)}
.reimbursement-request-summary>div{display:grid;gap:4px;min-width:0}.reimbursement-request-summary span{font-size:.76rem;opacity:.68}.reimbursement-request-summary strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reimbursement-submit{justify-self:start;min-width:190px}
@media(max-width:1000px){.reimbursement-request-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.reimbursement-request-summary{grid-template-columns:1fr}.reimbursement-submit{width:100%}}
`;
  }
  write(relativePath, source);
}

console.log("Reimbursement and draft deletion applied: Facility/Procurement can submit personal-funds claims, unsubmitted drafts can be safely removed, and Finance sees reimbursement evidence in Expenses.");

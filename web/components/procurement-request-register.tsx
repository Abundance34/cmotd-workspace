"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, CircleDollarSign, PackageSearch, Pencil, Send, UserRound, X } from "lucide-react";
import type { ProcurementRequestRow } from "@/lib/procureflow/procurement-data";
import { RequestExportButtons } from "@/components/request-export-buttons";
import { RequestDraftEditor } from "@/components/request-draft-editor";
import { requestConfirmation } from "@/components/in-app-confirmation";

const PM_EDITABLE = new Set(["PM Draft", "Draft", "Returned for Correction", "Returned to Procurement Manager", "Returned"]);

function money(value: unknown) { return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function dateText(value: unknown) { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }); }
function dateTime(value: unknown) { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-NG"); }

export function ProcurementRequestRegister({ rows, onChanged }: { rows: ProcurementRequestRow[]; onChanged?: () => void }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function loadDetail(id: number) {
    const response = await fetch(`/api/procurement/requests/${id}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Unable to open this purchase request.");
    setDetail(payload);
    return payload;
  }

  async function openRequest(row: ProcurementRequestRow) {
    setSelectedId(row.id); setDetail(null); setMessage(null); setLoading(true); setEditing(false);
    try { await loadDetail(row.id); }
    catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to open this purchase request." }); }
    finally { setLoading(false); }
  }

  async function submitOwned() {
    if (!selectedId || !detail?.request) return;
    const confirmed = await requestConfirmation({
      eyebrow: "INDEPENDENT APPROVAL",
      title: "Submit your Procurement request to Approver / MD?",
      description: `${detail.request.request_no} was created by Procurement. It will bypass Procurement self-approval and go directly to Approver / MD regardless of its value.`,
      reference: detail.request.request_no,
      detail: "This segregation-of-duties rule prevents a Procurement Manager from approving a request they created.",
      confirmLabel: "Submit to Approver / MD",
      tone: "primary",
    });
    if (!confirmed) return;
    setSubmitting(true); setMessage(null);
    try {
      const response = await fetch("/api/procurement/requests/submit-owned", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: selectedId }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit this Procurement request.");
      setMessage({ type: "success", text: `${payload?.result?.requestNo || detail.request.request_no} was submitted directly to Approver / MD.` });
      await loadDetail(selectedId); setEditing(false); router.refresh(); onChanged?.();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit this Procurement request." }); }
    finally { setSubmitting(false); }
  }

  if (!rows.length) return <div className="empty-state">No purchase requests are available.</div>;

  const isProcurementOwnedDraft = Boolean(detail?.request?.requester_role === "Procurement Manager" && PM_EDITABLE.has(String(detail?.request?.status || "")));

  return <div className="procurement-request-register facility-register-layout">
    <div className="request-register-toolbar"><div><strong>Procurement request register</strong><span>Download every request visible to your Procurement account.</span></div><RequestExportButtons /></div>
    <div className="table-wrap procurement-request-table facility-register-table"><table className="data-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Payment</th><th>Updated</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={`clickable-request-row ${selectedId === row.id ? "selected" : ""}`} onClick={() => void openRequest(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openRequest(row); }} tabIndex={0}>
      <td><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></td><td>{row.departmentProject || "—"}</td><td>{row.category || "—"}</td><td>{money(row.estimatedAmount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.paymentStatus || "—"}</td><td>{dateText(row.updatedAt)}</td><td><button type="button" className="request-open-button" onClick={(event) => { event.stopPropagation(); void openRequest(row); }}>Open <ChevronRight size={15}/></button></td>
    </tr>)}</tbody></table></div>

    {selectedId ? <section className="facility-request-detail procurement-request-detail">
      <div className="facility-detail-head"><div><span>PURCHASE REQUEST</span><h3>{detail?.request?.request_no || (loading ? "Loading request…" : "Request")}</h3><p>Complete procurement view, exports, draft ownership controls and workflow evidence.</p></div><button type="button" className="facility-detail-close" aria-label="Close request detail" onClick={() => { setSelectedId(null); setDetail(null); setMessage(null); setEditing(false); }}><X size={18}/></button></div>
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
      {loading ? <div className="empty-state compact">Loading complete purchase request…</div> : detail?.request ? editing ? <RequestDraftEditor detail={detail} onCancel={() => setEditing(false)} onSaved={async () => { await loadDetail(selectedId); router.refresh(); onChanged?.(); }} /> : <>
        <div className="request-detail-toolbar"><div><strong>Download this request</strong><span>CSV, Excel, PDF and JSON exports include masked account details only.</span></div><RequestExportButtons requestId={selectedId} compact /></div>
        {isProcurementOwnedDraft ? <div className="pm-owned-control"><div><strong>This is your Procurement-originated draft</strong><span>You may edit it. When submitted, it goes directly to Approver / MD; the low-value Procurement approval route cannot be used for self-approval.</span></div><div><button type="button" className="facility-edit-primary" onClick={() => setEditing(true)}><Pencil size={16}/>Edit Draft</button><button type="button" className="facility-submit-primary" disabled={submitting} onClick={() => void submitOwned()}><Send size={16}/>{submitting ? "Submitting…" : "Submit to Approver / MD"}</button></div></div> : null}
        <div className="facility-detail-summary"><article><UserRound size={17}/><span>Requester</span><strong>{detail.request.requester_name || detail.request.facility_manager_name || "—"}</strong></article><article><CalendarDays size={17}/><span>Required date</span><strong>{dateText(detail.request.required_date)}</strong></article><article><CircleDollarSign size={17}/><span>Estimated amount</span><strong>{money(detail.request.estimated_amount)}</strong></article><article><PackageSearch size={17}/><span>Status</span><strong>{detail.request.status || "—"}</strong></article></div>
        <div className="facility-detail-grid"><article><span>Requester role</span><strong>{detail.request.requester_role || "—"}</strong></article><article><span>Department / Project</span><strong>{detail.request.department_project || "—"}</strong></article><article><span>Category</span><strong>{detail.request.category || "—"}</strong></article><article><span>Priority</span><strong>{detail.request.priority || "Normal"}</strong></article><article><span>Payment status</span><strong>{detail.request.payment_status || "Not Ready"}</strong></article><article><span>Facility Head</span><strong>{detail.request.facility_manager_name || (detail.request.requester_role === "Procurement Manager" ? "Not applicable" : "—")}</strong></article><article><span>Procurement Manager</span><strong>{detail.request.procurement_manager_name || "—"}</strong></article><article><span>Next role</span><strong>{detail.request.next_role || "—"}</strong></article></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Business justification</strong></div><p>{detail.request.justification || "No justification recorded."}</p></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Line items</strong><span>{detail.items?.length || 0} item(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Item / Service</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Category</th><th>Suggested vendor</th></tr></thead><tbody>{(detail.items || []).map((item: any) => <tr key={item.id}><td><strong>{item.item_name}</strong><small>{item.description && item.description !== item.item_name ? item.description : ""}</small></td><td>{item.quantity}</td><td>{money(item.unit_price)}</td><td>{money(item.total)}</td><td>{item.category || "—"}</td><td>{item.suggested_vendor || "—"}</td></tr>)}</tbody></table></div></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Payment recipient readiness</strong><span>{isProcurementOwnedDraft ? "Editable while this remains your draft" : "Masked operational view"}</span></div><div className="facility-payee-summary"><span>Recipient known<b>{detail.payee?.recipient_known ? "Yes" : "No"}</b></span><span>Payee<b>{detail.payee?.payee_name_masked || "Pending"}</b></span><span>Bank<b>{detail.payee?.bank_name_masked || "Pending"}</b></span><span>Account<b>{detail.payee?.account_number_masked || "Pending"}</b></span><span>Verification<b>{detail.payee?.verification_status || "Pending"}</b></span></div></div>
        {detail.sourcing?.length ? <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Sourcing</strong><span>{detail.sourcing.length} task(s) · {detail.quotes?.length || 0} quote(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Sourcing no.</th><th>Status</th><th>Required item/service</th><th>Recommended vendor</th><th>Updated</th></tr></thead><tbody>{detail.sourcing.map((task: any) => <tr key={task.id}><td><strong>{task.sourcing_no}</strong></td><td>{task.status || "—"}</td><td>{task.required_item_service || "—"}</td><td>{task.recommended_vendor_name || "—"}</td><td>{dateText(task.updated_at || task.created_at)}</td></tr>)}</tbody></table></div></div> : null}
        {detail.purchaseOrders?.length ? <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Purchase orders</strong><span>{detail.purchaseOrders.length} PO(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>PO</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead><tbody>{detail.purchaseOrders.map((po: any) => <tr key={po.id}><td><strong>{po.po_no || `PO #${po.id}`}</strong></td><td>{po.vendor_name || "—"}</td><td>{money(po.total_amount)}</td><td>{po.status || "—"}</td><td>{dateText(po.updated_at || po.created_at)}</td></tr>)}</tbody></table></div></div> : null}
        {detail.payments?.length ? <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Payments</strong><span>{detail.payments.length} payment record(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Payment</th><th>Amount</th><th>Status</th><th>Verification</th><th>Reference</th><th>Date</th></tr></thead><tbody>{detail.payments.map((payment: any) => <tr key={payment.id}><td><strong>{payment.payment_no || `Payment #${payment.id}`}</strong></td><td>{money(payment.amount)}</td><td>{payment.status || "—"}</td><td>{payment.verification_status || "—"}</td><td>{payment.payment_reference || "—"}</td><td>{dateText(payment.payment_date || payment.created_at)}</td></tr>)}</tbody></table></div></div> : null}
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Workflow history</strong><span>{detail.workflow?.length || 0} event(s)</span></div><div className="facility-timeline">{(detail.workflow || []).map((event: any) => <div key={event.id}><span/><div><strong>{event.event}</strong><small>{event.user_name || event.user_role || "System"} · {event.status || ""} · {dateTime(event.created_at)}</small><p>{event.note || ""}</p></div></div>)}</div></div>
        {detail.approvals?.length ? <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Approval trail</strong><span>{detail.approvals.length} action(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Time</th><th>Action</th><th>Before</th><th>After</th><th>By</th><th>Note</th></tr></thead><tbody>{detail.approvals.map((approval: any) => <tr key={approval.id}><td>{dateTime(approval.created_at)}</td><td><strong>{approval.action}</strong></td><td>{approval.status_before || "—"}</td><td>{approval.status_after || "—"}</td><td>{approval.approved_by_name || approval.approved_by_role || "—"}</td><td>{approval.note || approval.reason || "—"}</td></tr>)}</tbody></table></div></div> : null}
      </> : null}
    </section> : null}
  </div>;
}

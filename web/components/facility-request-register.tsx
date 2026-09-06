"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, ChevronRight, CircleDot, Pencil, Send, X } from "lucide-react";
import { RequestExportButtons } from "@/components/request-export-buttons";
import { RequestDraftEditor } from "@/components/request-draft-editor";
import { requestConfirmation } from "@/components/in-app-confirmation";

const SUBMITTABLE = new Set(["FM Draft", "Draft", "Returned for Correction", "Returned to Facility Manager", "Returned"]);
const EDITABLE = new Set(["FM Draft", "Draft", "Returned for Correction", "Returned to Facility Manager", "Returned"]);

type Props = { rows: any[]; notifications?: any[]; emptyText?: string };

function money(value: unknown) { return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function dateText(value: unknown) { if (!value) return "—"; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }); }
function dateTime(value: unknown) { if (!value) return "—"; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-NG"); }

export function FacilityRequestRegister({ rows, notifications = [], emptyText = "No Facility drafts are available." }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const unreadFor = (id: number) => notifications.find((n) => !n.is_read && Number(n.entity_id || 0) === id && String(n.entity_type || "") === "Purchase Request");

  async function markNotificationRead(notificationId?: number) {
    if (!notificationId) return;
    await fetch("/api/parity/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notification-read", payload: { notificationId } }) }).catch(() => undefined);
  }

  async function loadDetail(id: number) {
    const response = await fetch(`/api/facility/requests/${id}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Unable to open this request.");
    setDetail(payload);
    return payload;
  }

  async function openRequest(row: any) {
    const id = Number(row.id); if (!id) return;
    setSelectedId(id); setDetail(null); setLoading(true); setEditing(false); setMessage(null);
    const unread = unreadFor(id);
    try {
      await loadDetail(id);
      if (unread?.id) { await markNotificationRead(Number(unread.id)); router.refresh(); }
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to open this request." }); }
    finally { setLoading(false); }
  }

  async function submitToProcurement() {
    if (!selectedId || !detail?.request) return;
    const confirmed = await requestConfirmation({ eyebrow: "SUBMIT REQUEST", title: "Send this request to Procurement Manager?", description: `${detail.request.request_no} will leave your editable draft queue and enter Procurement review.`, reference: detail.request.request_no, confirmLabel: "Send to Procurement Manager", tone: "primary" });
    if (!confirmed) return;
    setSubmitting(true); setMessage(null);
    try {
      const response = await fetch("/api/facility/requests/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: selectedId }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit request.");
      setMessage({ type: "success", text: `${payload?.result?.requestNo || "Request"} was sent to the Procurement Manager for review.` });
      await loadDetail(selectedId); setEditing(false); router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit request." }); }
    finally { setSubmitting(false); }
  }

  if (!rows?.length) return <div className="empty-state">{emptyText}</div>;

  return <div className="facility-register-layout">
    <div className="request-register-toolbar"><div><strong>Request register</strong><span>Download every request visible to your Facility account.</span></div><RequestExportButtons /></div>
    <div className="table-wrap facility-register-table"><table className="data-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>{rows.map((row: any) => {
      const unread = unreadFor(Number(row.id));
      return <tr key={row.id} className={`clickable-request-row ${selectedId === Number(row.id) ? "selected" : ""}`} onClick={() => void openRequest(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openRequest(row); }} tabIndex={0}>
        <td><div className="request-register-title">{unread ? <span className="request-unread-dot" title="New activity"><CircleDot size={15}/></span> : null}<div><strong>{row.requestNo || row.request_no}</strong><small>{dateText(row.requestDate || row.request_date)}</small></div></div></td><td>{row.departmentProject || row.department_project || "—"}</td><td>{row.category || "—"}</td><td>{money(row.estimatedAmount ?? row.estimated_amount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{dateText(row.updatedAt || row.updated_at)}</td><td><button type="button" className="request-open-button" onClick={(event) => { event.stopPropagation(); void openRequest(row); }}>Open <ChevronRight size={15}/></button></td>
      </tr>;
    })}</tbody></table></div>

    {selectedId ? <section className="facility-request-detail">
      <div className="facility-detail-head"><div><span>REQUEST DETAIL</span><h3>{detail?.request?.request_no || (loading ? "Loading request…" : "Request")}</h3><p>Open, export and—while it remains your draft—edit the complete request and its payment recipient details.</p></div><button type="button" className="facility-detail-close" aria-label="Close request detail" onClick={() => { setSelectedId(null); setDetail(null); setMessage(null); setEditing(false); }}><X size={18}/></button></div>
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
      {loading ? <div className="empty-state compact">Loading complete request detail…</div> : detail?.request ? editing ? <RequestDraftEditor detail={detail} onCancel={() => setEditing(false)} onSaved={async () => { await loadDetail(selectedId); router.refresh(); }} /> : <>
        <div className="request-detail-toolbar"><div><strong>Download this request</strong><span>Exports contain masked—not plaintext—account details.</span></div><RequestExportButtons requestId={selectedId} compact /></div>
        <div className="facility-detail-summary"><article><Building2 size={17}/><span>Department</span><strong>{detail.request.department_project || "—"}</strong></article><article><CalendarDays size={17}/><span>Required date</span><strong>{dateText(detail.request.required_date)}</strong></article><article><span className="summary-currency">₦</span><span>Estimated amount</span><strong>{money(detail.request.estimated_amount)}</strong></article><article><span className="summary-status-dot"/><span>Status</span><strong>{detail.request.status || "—"}</strong></article></div>
        <div className="facility-detail-grid"><article><span>Priority</span><strong>{detail.request.priority || "—"}</strong></article><article><span>Category</span><strong>{detail.request.category || "—"}</strong></article><article><span>Procurement Manager</span><strong>{detail.request.procurement_manager_name || "Automatic routing pending"}</strong></article><article><span>Payment readiness</span><strong>{detail.payee?.payment_readiness_status || detail.request.payment_status || "Pending Payee Details"}</strong></article></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Business justification</strong></div><p>{detail.request.justification || "No justification recorded."}</p></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Line items</strong><span>{detail.items?.length || 0} item(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Item / Service</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Category</th><th>Suggested vendor</th></tr></thead><tbody>{(detail.items || []).map((item: any) => <tr key={item.id}><td><strong>{item.item_name}</strong><small>{item.description && item.description !== item.item_name ? item.description : ""}</small></td><td>{item.quantity}</td><td>{money(item.unit_price)}</td><td>{money(item.total)}</td><td>{item.category || "—"}</td><td>{item.suggested_vendor || "—"}</td></tr>)}</tbody></table></div></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Payment recipient readiness</strong></div><div className="facility-payee-summary"><span>Recipient known: <b>{detail.payee?.recipient_known ? "Yes" : "No"}</b></span><span>Payee: <b>{detail.payee?.payee_name_masked || "Pending"}</b></span><span>Bank: <b>{detail.payee?.bank_name_masked || "Pending"}</b></span><span>Account: <b>{detail.payee?.account_number_masked || "Pending"}</b></span><span>Verification: <b>{detail.payee?.verification_status || "Pending"}</b></span></div></div>
        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Workflow history</strong><span>{detail.workflow?.length || 0} event(s)</span></div><div className="facility-timeline">{(detail.workflow || []).map((event: any) => <div key={event.id}><span/><div><strong>{event.event}</strong><small>{event.status || ""} · {dateTime(event.created_at)}</small><p>{event.note || ""}</p></div></div>)}</div></div>
        <div className="facility-detail-actions"><div><strong>Draft controls</strong><span>{EDITABLE.has(String(detail.request.status || "")) ? "You can edit this draft, including replacing its encrypted payment/account details, before submission." : `This request is already in ${detail.request.status || "the workflow"} and is read-only.`}</span></div><div className="request-action-cluster">{EDITABLE.has(String(detail.request.status || "")) ? <button type="button" className="facility-edit-primary" onClick={() => setEditing(true)}><Pencil size={16}/>Edit Draft</button> : null}{SUBMITTABLE.has(String(detail.request.status || "")) ? <button type="button" className="facility-submit-primary" disabled={submitting} onClick={() => void submitToProcurement()}><Send size={16}/>{submitting ? "Sending…" : "Send to Procurement Manager"}</button> : <span className="status-pill">{detail.request.status}</span>}</div></div>
      </> : null}
    </section> : null}
  </div>;
}

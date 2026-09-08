"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CornerUpLeft, Filter, PackageSearch, SearchCheck, Send, ShieldCheck, UserRound } from "lucide-react";
import type { ProcurementRequestRow } from "@/lib/procureflow/procurement-data";
import { requestConfirmation } from "@/components/in-app-confirmation";

type ActionName = "review" | "sourcing" | "return" | "submit_approval" | "approve_low_value";
type SourceFilter = "All" | "Facility" | "ICT";

function money(value: unknown) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-NG");
}
function sourceFor(row: ProcurementRequestRow | null | undefined) {
  if (!row) return "Facility" as const;
  const anyRow = row as any;
  const value = `${anyRow.requesterRole || ""} ${anyRow.sourceType || ""} ${anyRow.requesterName || ""}`.toLowerCase();
  return value.includes("ict") ? "ICT" as const : "Facility" as const;
}
function requesterFor(row: ProcurementRequestRow | null | undefined) {
  if (!row) return "—";
  const anyRow = row as any;
  return anyRow.requesterName || row.facilityManager || "—";
}

export function ProcurementInboxV3({ rows, approvalLimit = 0 }: { rows: ProcurementRequestRow[]; approvalLimit?: number }) {
  const router = useRouter();
  const [filter, setFilter] = useState<SourceFilter>("All");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const counts = useMemo(() => ({
    All: rows.length,
    Facility: rows.filter((row) => sourceFor(row) === "Facility").length,
    ICT: rows.filter((row) => sourceFor(row) === "ICT").length,
  }), [rows]);
  const filteredRows = useMemo(() => filter === "All" ? rows : rows.filter((row) => sourceFor(row) === filter), [rows, filter]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const lowValue = Boolean(selected && approvalLimit > 0 && selected.estimatedAmount <= approvalLimit);

  useEffect(() => {
    if (selectedId && filteredRows.some((row) => row.id === selectedId)) return;
    setSelectedId(filteredRows[0]?.id ?? null);
  }, [filter, filteredRows, selectedId]);

  useEffect(() => {
    let active = true;
    if (!selectedId) { setDetail(null); return; }
    setLoadingDetail(true); setDetail(null); setMessage(null); setNote("");
    fetch(`/api/procurement/requests/${selectedId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Unable to open this inbox request.");
        if (active) setDetail(payload);
      })
      .catch((error) => { if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to open this inbox request." }); })
      .finally(() => { if (active) setLoadingDetail(false); });
    return () => { active = false; };
  }, [selectedId]);

  async function requestAction(action: ActionName) {
    if (!selected) return;
    if (action === "submit_approval" && lowValue) {
      setMessage({ type: "error", text: `${selected.requestNo} is within the ${money(approvalLimit)} Procurement Manager approval limit. Use Approve Low-Value Request instead.` });
      return;
    }
    if (action === "return" && note.trim().length < 4) {
      setMessage({ type: "error", text: "Enter the correction reason before returning this request." });
      return;
    }
    const origin = sourceFor(selected);
    const confirmation = action === "approve_low_value"
      ? { title: "Approve this low-value request?", detail: `${selected.requestNo} is ${money(selected.estimatedAmount)}, within the configured ${money(approvalLimit)} Procurement Manager authority. Approval will route it directly to Finance.`, label: "Approve & Route to Finance", tone: "success" as const }
      : action === "submit_approval"
        ? { title: "Submit request to Approver / MD?", detail: `${selected.requestNo} exceeds the Procurement Manager low-value limit and will move to Approver / MD.`, label: "Submit to Approver / MD", tone: "primary" as const }
        : action === "sourcing"
          ? { title: "Start vendor quote collection?", detail: `${selected.requestNo} will move into Vendor Quote Collection and a sourcing task will be created.`, label: "Start Sourcing", tone: "primary" as const }
          : action === "return"
            ? { title: `Return request to ${origin}?`, detail: `${selected.requestNo} will be returned with the correction reason entered below.`, label: "Return Request", tone: "danger" as const }
            : { title: lowValue ? "Mark this low-value request as reviewed?" : "Mark request as reviewed?", detail: lowValue ? `${selected.requestNo} will be recorded as reviewed. You may also approve it directly while it remains within your low-value authority.` : `${selected.requestNo} will be recorded as reviewed by Procurement.`, label: "Mark Reviewed", tone: "primary" as const };

    const confirmed = await requestConfirmation({
      eyebrow: `${origin.toUpperCase()} INBOX`,
      title: confirmation.title,
      description: confirmation.detail,
      reference: selected.requestNo,
      detail: note.trim() ? `Procurement note: ${note.trim()}` : "The action will be recorded in the ProcureFlow workflow and audit trail.",
      confirmLabel: confirmation.label,
      tone: confirmation.tone,
    });
    if (!confirmed) return;
    await runAction(action);
  }

  async function runAction(action: ActionName) {
    if (!selected) return;
    setBusyAction(action); setMessage(null);
    try {
      const isLowValueApproval = action === "approve_low_value";
      const endpoint = isLowValueApproval ? "/api/parity/action" : action === "sourcing" ? "/api/procurement/requests/sourcing" : "/api/procurement/requests/review";
      const body = isLowValueApproval
        ? { action: "low-value-decision", payload: { requestId: selected.id, decision: "approve", note } }
        : action === "sourcing"
          ? { requestId: selected.id, note }
          : { requestId: selected.id, action, note };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to update request.");
      const text = isLowValueApproval
        ? `${selected.requestNo} was approved by Procurement Manager and routed to Finance.`
        : action === "sourcing"
          ? `${selected.requestNo} is now in Vendor Quote Collection.`
          : action === "review" && lowValue
            ? `${selected.requestNo} is recorded as reviewed. It remains eligible for Procurement Manager low-value approval.`
            : `${selected.requestNo} moved to ${payload?.result?.status || "the next workflow stage"}.`;
      setMessage({ type: "success", text }); setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to update request." });
    } finally { setBusyAction(null); }
  }

  if (!rows.length) return <div className="empty-state">There are no Facility or ICT requests waiting for Procurement review.</div>;

  const origin = sourceFor(selected);
  const req = detail?.request;
  return <div className="procurement-unified-inbox">
    <section className="procurement-request-picker procurement-inbox-picker">
      <div className="inbox-filter-head"><div><Filter size={17}/><div><strong>Inbox filter</strong><span>Facility and ICT requests share one Procurement inbox.</span></div></div><div className="inbox-filter-buttons">{(["All", "Facility", "ICT"] as SourceFilter[]).map((name) => <button key={name} type="button" className={filter === name ? "active" : ""} onClick={() => setFilter(name)}>{name}<b>{counts[name]}</b></button>)}</div></div>
      <label><span>Open inbox request</span><select value={selectedId || ""} onChange={(event) => setSelectedId(Number(event.target.value) || null)}><option value="">Select a request…</option>{filteredRows.map((row) => <option key={row.id} value={row.id}>{sourceFor(row)} — {row.requestNo} — {row.departmentProject || "No department"} — {money(row.estimatedAmount)}</option>)}</select></label>
      {selected ? <div className="procurement-picker-summary"><div><span>Source</span><strong>{origin}</strong></div><div><span>Requester</span><strong>{requesterFor(selected)}</strong></div><div><span>Request</span><strong>{selected.requestNo}</strong></div><div><span>Amount</span><strong>{money(selected.estimatedAmount)}</strong></div><div><span>Status</span><strong>{selected.status || "Pending"}</strong></div></div> : null}
    </section>

    {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    {loadingDetail ? <div className="empty-state compact">Loading complete request details…</div> : null}

    {selected && req && !loadingDetail ? <section className="procurement-review-card procurement-inbox-detail">
      <div className="review-card-heading"><div><span>{origin.toUpperCase()} REQUEST</span><h3>{req.request_no}</h3><p>{req.requester_name || requesterFor(selected)} · {req.department_project || "No department/project"}</p></div><span className="status-pill">{req.status || "Pending"}</span></div>
      <div className="facility-detail-summary"><article><UserRound size={17}/><span>Requester</span><strong>{req.requester_name || "—"}</strong></article><article><PackageSearch size={17}/><span>Source</span><strong>{origin}</strong></article><article><span>Estimated amount</span><strong>{money(req.estimated_amount)}</strong></article><article><span>Required date</span><strong>{dateText(req.required_date)}</strong></article></div>
      <div className="facility-detail-grid"><article><span>Requester role</span><strong>{req.requester_role || origin}</strong></article><article><span>Department / Project</span><strong>{req.department_project || "—"}</strong></article><article><span>Category</span><strong>{req.category || "—"}</strong></article><article><span>Priority</span><strong>{req.priority || "Normal"}</strong></article><article><span>Payment status</span><strong>{req.payment_status || "Not Ready"}</strong></article><article><span>Procurement Manager</span><strong>{req.procurement_manager_name || "—"}</strong></article><article><span>Request date</span><strong>{dateText(req.request_date)}</strong></article><article><span>Next role</span><strong>{req.next_role || "—"}</strong></article></div>
      <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Business justification</strong></div><p>{req.justification || "No justification recorded."}</p></div>
      <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Line items</strong><span>{detail.items?.length || 0} item(s)</span></div><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Item / Service</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Category</th><th>Suggested vendor</th></tr></thead><tbody>{(detail.items || []).map((item: any) => <tr key={item.id}><td><strong>{item.item_name}</strong><small>{item.description && item.description !== item.item_name ? item.description : ""}</small></td><td>{item.quantity}</td><td>{money(item.unit_price)}</td><td>{money(item.total)}</td><td>{item.category || "—"}</td><td>{item.suggested_vendor || "—"}</td></tr>)}</tbody></table></div></div>
      <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Payment recipient readiness</strong><span>Masked operational view</span></div><div className="facility-payee-summary"><span>Recipient known<b>{detail.payee?.recipient_known ? "Yes" : "No"}</b></span><span>Payee<b>{detail.payee?.payee_name_masked || "Pending"}</b></span><span>Bank<b>{detail.payee?.bank_name_masked || "Pending"}</b></span><span>Account<b>{detail.payee?.account_number_masked || "Pending"}</b></span><span>Verification<b>{detail.payee?.verification_status || "Pending"}</b></span></div></div>
      <div className={lowValue ? "approval-policy-note" : "approval-policy-note high-route"}><ShieldCheck size={17}/><div><strong>{lowValue ? "Procurement Manager low-value authority" : "Approver / MD authority required"}</strong><span>{lowValue ? `${money(selected.estimatedAmount)} is within the configured ${money(approvalLimit)} limit. You may approve it here immediately or mark it reviewed first.` : `${money(selected.estimatedAmount)} exceeds the configured ${money(approvalLimit)} limit and may be submitted to Approver / MD after Procurement review.`}</span></div></div>
      <label className="review-note"><span>Procurement review comment / correction reason</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={`Add context for this ${origin} request. A reason is mandatory when returning for correction.`}/></label>
      <div className="procurement-review-actions">
        {lowValue ? <button type="button" className="review-action reviewed" disabled={Boolean(busyAction)} onClick={() => void requestAction("approve_low_value")}><CheckCircle2 size={16}/>{busyAction === "approve_low_value" ? "Approving…" : "Approve Low-Value Request"}</button> : null}
        <button type="button" className="review-action reviewed" disabled={Boolean(busyAction)} onClick={() => void requestAction("review")}><CheckCircle2 size={16}/>{busyAction === "review" ? "Updating…" : "Mark Reviewed"}</button>
        <button type="button" className="review-action sourcing" disabled={Boolean(busyAction)} onClick={() => void requestAction("sourcing")}><SearchCheck size={16}/>{busyAction === "sourcing" ? "Opening…" : "Requires Sourcing"}</button>
        <button type="button" className="review-action return" disabled={Boolean(busyAction)} onClick={() => void requestAction("return")}><CornerUpLeft size={16}/>{busyAction === "return" ? "Returning…" : `Return to ${origin}`}</button>
        {!lowValue ? <button type="button" className="review-action approval" disabled={Boolean(busyAction)} onClick={() => void requestAction("submit_approval")}><Send size={16}/>{busyAction === "submit_approval" ? "Submitting…" : "Submit to Approver / MD"}</button> : null}
      </div>
      <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Workflow history</strong><span>{detail.workflow?.length || 0} event(s)</span></div><div className="facility-timeline">{(detail.workflow || []).map((event: any) => <div key={event.id}><span/><div><strong>{event.event}</strong><small>{event.user_name || event.user_role || "System"} · {event.status || ""} · {dateTime(event.created_at)}</small><p>{event.note || ""}</p></div></div>)}</div></div>
    </section> : null}
  </div>;
}

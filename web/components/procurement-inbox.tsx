"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CornerUpLeft, SearchCheck, Send, ShieldCheck } from "lucide-react";
import type { ProcurementRequestRow } from "@/lib/procureflow/procurement-data";

type ActionName = "review" | "sourcing" | "return" | "submit_approval";

function money(value: number) { return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value || 0); }
function dateText(value: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date); }

function confirmationFor(action: ActionName, requestNo: string, lowValue: boolean, approvalLimit: number) {
  if (action === "submit_approval") return { eyebrow: "FINAL APPROVAL", title: "Submit request to Approver / MD?", description: `${requestNo} exceeds the Procurement Manager low-value limit of ${money(approvalLimit)} and will move to Approver / MD for final approval.`, confirmLabel: "Submit to Approver / MD" };
  if (action === "sourcing") return { eyebrow: "VENDOR SOURCING", title: "Start vendor quote collection?", description: `${requestNo} will move into Vendor Quote Collection and a sourcing task will be created.`, confirmLabel: "Start Sourcing" };
  if (action === "return") return { eyebrow: "RETURN FOR CORRECTION", title: "Return request to Facility Head?", description: `${requestNo} will be returned to the Utility / Facility Head with the correction reason entered below.`, confirmLabel: "Return Request" };
  return lowValue
    ? { eyebrow: "LOW-VALUE REVIEW", title: "Mark this request as reviewed?", description: `${requestNo} is within the ${money(approvalLimit)} Procurement Manager limit. After review it will appear under Low-Value Approvals for your decision.`, confirmLabel: "Mark Reviewed" }
    : { eyebrow: "PROCUREMENT REVIEW", title: "Mark request as reviewed?", description: `${requestNo} will be recorded as reviewed by Procurement.`, confirmLabel: "Mark Reviewed" };
}

export function ProcurementInbox({ rows, approvalLimit = 0 }: { rows: ProcurementRequestRow[]; approvalLimit?: number }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);
  const lowValue = Boolean(selected && approvalLimit > 0 && selected.estimatedAmount <= approvalLimit);

  function requestAction(action: ActionName) {
    if (!selected) return;
    if (action === "submit_approval" && lowValue) {
      setMessage({ type: "error", text: `${selected.requestNo} is within the ${money(approvalLimit)} Procurement Manager approval limit. Mark it Reviewed, then decide it under Low-Value Approvals instead of sending it to Approver / MD.` });
      return;
    }
    if (action === "return" && !note.trim()) { setMessage({ type: "error", text: "Enter a correction reason before returning the request." }); return; }
    setMessage(null); setPendingAction(action);
  }

  async function runAction(action: ActionName) {
    if (!selected) return;
    setPendingAction(null); setBusyAction(action); setMessage(null);
    try {
      const endpoint = action === "sourcing" ? "/api/procurement/requests/sourcing" : "/api/procurement/requests/review";
      const body = action === "sourcing" ? { requestId: selected.id, note } : { requestId: selected.id, action, note };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to update request.");
      if (action === "sourcing") setMessage({ type: "success", text: `${selected.requestNo} is now in Vendor Quote Collection. Sourcing task ${payload?.result?.sourcingNo || "created"} is available under Sourcing.` });
      else if (action === "review" && lowValue) setMessage({ type: "success", text: `${selected.requestNo} is reviewed and is now ready under Low-Value Approvals for the Procurement Manager decision.` });
      else setMessage({ type: "success", text: `${selected.requestNo} moved to ${payload?.result?.status || "the next workflow stage"}.` });
      setNote(""); router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to update request." }); }
    finally { setBusyAction(null); }
  }

  if (!rows.length) return <div className="empty-state">There are no Facility requests waiting for procurement review.</div>;
  const confirmation = pendingAction && selected ? confirmationFor(pendingAction, selected.requestNo, lowValue, approvalLimit) : null;

  return <>
    <div className="procurement-inbox-grid">
      <div className="table-wrap"><table className="data-table procurement-select-table"><thead><tr><th>Request</th><th>Facility Head</th><th>Department / Project</th><th>Amount</th><th>Status</th><th>Open</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={selected?.id === row.id ? "selected-row" : ""}><td><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></td><td>{row.facilityManager || "—"}</td><td>{row.departmentProject || "—"}</td><td className="amount-cell">{money(row.estimatedAmount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td><button type="button" className="row-action-button" onClick={() => { setSelectedId(row.id); setMessage(null); setNote(""); setPendingAction(null); }}>Review</button></td></tr>)}</tbody></table></div>
      {selected ? <section className="procurement-review-card">
        <div className="review-card-heading"><div><span>Procurement review</span><h3>{selected.requestNo}</h3><p>{selected.facilityManager || "Utility / Facility Head"} · {selected.departmentProject || "No department/project"}</p></div><span className="status-pill">{selected.status || "Pending"}</span></div>
        <div className="review-facts"><div><span>Category</span><strong>{selected.category || "—"}</strong></div><div><span>Priority</span><strong>{selected.priority || "Normal"}</strong></div><div><span>Estimated value</span><strong>{money(selected.estimatedAmount)}</strong></div><div><span>Required date</span><strong>{dateText(selected.requiredDate)}</strong></div></div>
        <div className={lowValue ? "approval-policy-note" : "approval-policy-note high-route"}><ShieldCheck size={17}/><div><strong>{lowValue ? "Procurement Manager low-value authority" : "Approver / MD authority required"}</strong><span>{lowValue ? `${money(selected.estimatedAmount)} is within the configured ${money(approvalLimit)} limit. Mark Reviewed, then use Low-Value Approvals.` : `${money(selected.estimatedAmount)} exceeds the configured ${money(approvalLimit)} limit and may be submitted to Approver / MD after Procurement review.`}</span></div></div>
        <div className="review-justification"><span>Business justification</span><p>{selected.justification || "No justification recorded."}</p></div>
        <label className="review-note"><span>Procurement review comment / correction reason</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a review note. A reason is mandatory when returning for correction." /></label>
        {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
        <div className="procurement-review-actions"><button type="button" className="review-action reviewed" disabled={Boolean(busyAction)} onClick={() => requestAction("review")}><CheckCircle2 size={16}/>{busyAction === "review" ? "Updating…" : lowValue ? "Mark Reviewed for Low-Value Approval" : "Mark Reviewed"}</button><button type="button" className="review-action sourcing" disabled={Boolean(busyAction)} onClick={() => requestAction("sourcing")}><SearchCheck size={16}/>{busyAction === "sourcing" ? "Opening…" : "Requires Sourcing"}</button><button type="button" className="review-action return" disabled={Boolean(busyAction)} onClick={() => requestAction("return")}><CornerUpLeft size={16}/>{busyAction === "return" ? "Returning…" : "Return for Correction"}</button>{!lowValue ? <button type="button" className="review-action approval" disabled={Boolean(busyAction)} onClick={() => requestAction("submit_approval")}><Send size={16}/>{busyAction === "submit_approval" ? "Submitting…" : "Submit to Approver / MD"}</button> : null}</div>
        <div className="review-security-note"><ShieldCheck size={15}/><span>Every transition writes workflow, activity, approval-history and v2 audit evidence in one transaction.</span></div>
      </section> : null}
    </div>
    {confirmation && selected && pendingAction ? <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingAction(null); }} style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(15, 23, 42, 0.52)", backdropFilter: "blur(3px)" }}><section role="dialog" aria-modal="true" aria-labelledby="procurement-confirm-title" style={{ width: "min(520px, 100%)", border: "1px solid var(--pf-border)", borderRadius: 14, background: "var(--pf-surface)", color: "var(--pf-text)", boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)", overflow: "hidden" }}><div style={{ padding: "22px 24px 18px" }}><div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}><div aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 10, display: "grid", placeItems: "center", flex: "0 0 auto", background: "var(--pf-primary-soft)", color: "var(--pf-primary)" }}><Send size={20}/></div><div style={{ minWidth: 0 }}><span style={{ display: "block", marginBottom: 5, fontSize: 10.5, fontWeight: 850, letterSpacing: ".1em", color: "var(--pf-primary)" }}>{confirmation.eyebrow}</span><h3 id="procurement-confirm-title" style={{ margin: 0, fontSize: 20, lineHeight: 1.25 }}>{confirmation.title}</h3><p style={{ margin: "8px 0 0", color: "var(--pf-muted)", fontSize: 13.5, lineHeight: 1.55 }}>{confirmation.description}</p></div></div><div style={{ marginTop: 18, padding: "12px 14px", border: "1px solid var(--pf-border)", borderRadius: 9, background: "var(--pf-surface-2)" }}><span style={{ display: "block", fontSize: 11, color: "var(--pf-muted)" }}>Request</span><strong style={{ display: "block", marginTop: 2, fontSize: 14.5 }}>{selected.requestNo}</strong>{note.trim() ? <p style={{ margin: "7px 0 0", fontSize: 12.5, color: "var(--pf-muted)" }}>Note: {note.trim()}</p> : null}</div></div><div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid var(--pf-border)", background: "var(--pf-surface-2)" }}><button type="button" onClick={() => setPendingAction(null)} style={{ minHeight: 39, padding: "9px 15px", border: "1px solid var(--pf-border-strong)", borderRadius: 7, background: "var(--pf-surface)", color: "var(--pf-text)", fontWeight: 750, cursor: "pointer" }}>Cancel</button><button type="button" onClick={() => void runAction(pendingAction)} style={{ minHeight: 39, padding: "9px 16px", border: 0, borderRadius: 7, background: "var(--pf-primary)", color: "#fff", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}><Send size={15}/>{confirmation.confirmLabel}</button></div></section></div> : null}
  </>;
}

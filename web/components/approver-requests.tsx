"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CornerUpLeft, ShieldCheck, Star, XCircle } from "lucide-react";
import type { ApproverRequestRow } from "@/lib/procureflow/approver-data";

type Decision = "approve" | "reject" | "return";

function money(value: number, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-NG")}`;
  }
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function ApproverRequests({
  rows,
  approvalLimit,
  mode = "pending",
}: {
  rows: ApproverRequestRow[];
  approvalLimit: number;
  mode?: "pending" | "quotes";
}) {
  const router = useRouter();
  const visibleRows = useMemo(
    () => mode === "quotes" ? rows.filter((row) => row.sourcingTaskId != null && row.quotes.length > 0) : rows,
    [rows, mode],
  );
  const [selectedId, setSelectedId] = useState<number | null>(visibleRows[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selected = useMemo(
    () => visibleRows.find((row) => row.id === selectedId) || visibleRows[0] || null,
    [visibleRows, selectedId],
  );
  const recommendedQuote = selected?.quotes.find((quote) => quote.recommended) || null;

  async function decide(decision: Decision) {
    if (!selected) return;
    if ((decision === "reject" || decision === "return") && !note.trim()) {
      setMessage({ type: "error", text: decision === "reject" ? "Enter a rejection reason before rejecting this request." : "Enter a return reason before sending this request back." });
      return;
    }
    const label = decision === "approve" ? "approve" : decision === "reject" ? "reject" : "return for correction";
    if (!window.confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} ${selected.requestNo}?`)) return;

    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch("/api/approver/requests/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: selected.id, decision, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to apply approval decision.");
      setMessage({ type: "success", text: `${selected.requestNo} moved to ${payload?.result?.status || "the next workflow stage"}.` });
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to apply approval decision." });
    } finally {
      setBusy(null);
    }
  }

  if (!visibleRows.length) {
    return (
      <div className="empty-state">
        {mode === "quotes"
          ? "No vendor recommendation is currently awaiting Approver / MD review."
          : "No high-value or Procurement Manager-originated request is currently awaiting your approval."}
      </div>
    );
  }

  return (
    <div className="approver-request-workspace">
      <div className="approver-request-list">
        {visibleRows.map((row) => (
          <button
            type="button"
            key={row.id}
            className={selected?.id === row.id ? "approver-request-card active" : "approver-request-card"}
            onClick={() => { setSelectedId(row.id); setNote(""); setMessage(null); }}
          >
            <div><strong>{row.requestNo}</strong><span>{row.requesterName || "Requester"} · {row.requesterRole || "Unknown role"}</span></div>
            <div><b>{money(row.estimatedAmount)}</b><small>{row.status || "Pending"}</small></div>
          </button>
        ))}
      </div>

      {selected ? (
        <section className="approver-decision-card">
          <div className="review-card-heading">
            <div><span>{mode === "quotes" ? "Quote comparison decision" : "Executive approval"}</span><h3>{selected.requestNo}</h3><p>{selected.departmentProject || "No department/project"} · {selected.category || "No category"}</p></div>
            <span className="status-pill">{selected.status || "Pending Approval"}</span>
          </div>

          <div className="review-facts approver-facts">
            <div><span>Requested by</span><strong>{selected.requesterName || "—"}</strong></div>
            <div><span>Requester role</span><strong>{selected.requesterRole || "—"}</strong></div>
            <div><span>Facility / Utility Head</span><strong>{selected.facilityManagerName || "—"}</strong></div>
            <div><span>Procurement Manager</span><strong>{selected.procurementManagerName || "—"}</strong></div>
            <div><span>Priority</span><strong>{selected.priority || "Normal"}</strong></div>
            <div><span>Request value</span><strong>{money(selected.estimatedAmount)}</strong></div>
            <div><span>PM approval limit</span><strong>{money(approvalLimit)}</strong></div>
            <div><span>Last updated</span><strong>{dateText(selected.updatedAt)}</strong></div>
          </div>

          <div className="approval-policy-note">
            <ShieldCheck size={17} />
            <div><strong>{selected.requesterRole === "Procurement Manager" && selected.estimatedAmount <= approvalLimit ? "Independent approval required by segregation of duties" : "Approver / MD authority required"}</strong><span>{selected.requesterRole === "Procurement Manager" && selected.estimatedAmount <= approvalLimit ? "Procurement Manager-created requests cannot be self-approved even when their value is within the configured low-value limit." : `This request exceeds the Procurement Manager approval limit of ${money(approvalLimit)}.`}</span></div>
          </div>

          {selected.sourcingTaskId ? (
            <div className="approver-quote-section">
              <div className="sourcing-section-heading"><div><h3>Vendor quote comparison</h3><p>{selected.sourcingNo || "Sourcing task"} · {selected.recommendationReason || "Procurement recommendation"}</p></div><span className="status-pill">{selected.sourcingApprovalStatus || "Submitted"}</span></div>
              {selected.quotes.length ? (
                <div className="quote-card-grid">
                  {selected.quotes.map((quote) => (
                    <article key={quote.id} className={quote.recommended ? "quote-card recommended-quote" : "quote-card"}>
                      <div className="quote-card-head"><div><strong>{quote.vendorName}</strong><span>{quote.recommended ? "Procurement recommendation" : "Vendor quote"}</span></div><span className="quote-rating"><Star size={12} fill="currentColor" /> {quote.rating}/5</span></div>
                      <div className="quote-price">{money(quote.amount, quote.currency)}</div>
                      <div className="quote-score-row"><span>Weighted score</span><strong>{quote.score}</strong>{quote.recommended ? <em>Recommended</em> : null}</div>
                      <dl><div><dt>Delivery</dt><dd>{quote.deliveryDays} day{quote.deliveryDays === 1 ? "" : "s"}</dd></div><div><dt>Decision context</dt><dd>{quote.recommended ? "Recommended" : "Alternative"}</dd></div></dl>
                    </article>
                  ))}
                </div>
              ) : <div className="empty-state">No vendor quotes are attached to this approval.</div>}
              {recommendedQuote ? <div className="approver-recommendation-summary"><strong>Procurement recommends {recommendedQuote.vendorName}</strong><span>{money(recommendedQuote.amount, recommendedQuote.currency)} · score {recommendedQuote.score} · {recommendedQuote.deliveryDays} delivery day{recommendedQuote.deliveryDays === 1 ? "" : "s"}</span></div> : null}
            </div>
          ) : null}

          <label className="review-note approver-note"><span>Approval note / rejection or return reason</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval. Required for rejection or return." /></label>
          {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}

          <div className="approver-actions">
            <button type="button" className="approver-action approve" disabled={Boolean(busy)} onClick={() => decide("approve")}><CheckCircle2 size={16} />{busy === "approve" ? "Approving…" : selected.sourcingTaskId ? "Approve Recommended Vendor" : "Approve Request"}</button>
            <button type="button" className="approver-action return" disabled={Boolean(busy)} onClick={() => decide("return")}><CornerUpLeft size={16} />{busy === "return" ? "Returning…" : selected.sourcingTaskId ? "Return for More Information" : "Return for Correction"}</button>
            <button type="button" className="approver-action reject" disabled={Boolean(busy)} onClick={() => decide("reject")}><XCircle size={16} />{busy === "reject" ? "Rejecting…" : "Reject Request"}</button>
          </div>
          <div className="review-security-note"><ShieldCheck size={15} /><span>Approver decisions update the request, sourcing recommendation, approval history, notifications, workflow evidence and v2 audit chain in one transaction.</span></div>
        </section>
      ) : null}
    </div>
  );
}

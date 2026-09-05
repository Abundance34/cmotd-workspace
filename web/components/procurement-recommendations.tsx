"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, Send, ShieldCheck, Star } from "lucide-react";
import type { ProcurementSourcingTaskRow } from "@/lib/procureflow/procurement-data";

function money(value: number, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-NG")}`;
  }
}

export function ProcurementRecommendations({
  tasks,
  approvalLimit,
}: {
  tasks: ProcurementSourcingTaskRow[];
  approvalLimit: number;
}) {
  const router = useRouter();
  const recommendationTasks = useMemo(
    () => tasks.filter((task) => task.requestStatus === "Vendor Recommendation"),
    [tasks],
  );
  const [selectedId, setSelectedId] = useState<number | null>(recommendationTasks[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selected = useMemo(
    () => recommendationTasks.find((task) => task.id === selectedId) || recommendationTasks[0] || null,
    [recommendationTasks, selectedId],
  );
  const recommendedQuote = selected?.quotes.find((quote) => quote.isRecommended) || null;
  const independentApprovalRequired = Boolean(
    selected && (selected.estimatedAmount > approvalLimit || selected.requesterRole === "Procurement Manager"),
  );

  async function submitForApproval() {
    if (!selected || !recommendedQuote) return;
    if (!window.confirm(`Submit ${selected.requestNo} and the ${recommendedQuote.vendorName} recommendation to Approver / MD?`)) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/procurement/sourcing/recommend/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcingTaskId: selected.id, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit recommendation for approval.");
      setMessage({ type: "success", text: `${selected.requestNo} was submitted to Approver / MD for final approval.` });
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit recommendation for approval." });
    } finally {
      setBusy(false);
    }
  }

  if (!recommendationTasks.length) {
    return <div className="empty-state">No vendor recommendations are currently waiting for Procurement action.</div>;
  }

  return (
    <div className="recommendation-workspace">
      <div className="recommendation-list">
        {recommendationTasks.map((task) => {
          const quote = task.quotes.find((item) => item.isRecommended);
          return (
            <button
              type="button"
              key={task.id}
              className={selected?.id === task.id ? "recommendation-list-card active" : "recommendation-list-card"}
              onClick={() => { setSelectedId(task.id); setMessage(null); setNote(""); }}
            >
              <div><strong>{task.requestNo}</strong><span>{task.sourcingNo}</span></div>
              <div><b>{quote?.vendorName || task.recommendedVendor || "Recommendation"}</b><small>{quote ? `Score ${quote.score}` : task.reasonForRecommendation || "Prepared"}</small></div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <section className="recommendation-detail-card">
          <div className="review-card-heading">
            <div><span>Vendor recommendation</span><h3>{selected.requestNo}</h3><p>{selected.sourcingNo} · {selected.departmentProject || "No department/project"}</p></div>
            <span className="status-pill">{selected.approvalStatus || "Recommended"}</span>
          </div>

          {recommendedQuote ? (
            <>
              <div className="recommended-vendor-hero">
                <div className="recommended-vendor-icon"><Award size={24} /></div>
                <div><span>Recommended vendor</span><strong>{recommendedQuote.vendorName}</strong><small>{selected.reasonForRecommendation || `Weighted score ${recommendedQuote.score}`}</small></div>
                <div className="recommended-price"><span>Quoted amount</span><strong>{money(recommendedQuote.quotedAmount, recommendedQuote.currency)}</strong></div>
              </div>

              <div className="review-facts recommendation-facts">
                <div><span>Weighted score</span><strong>{recommendedQuote.score}</strong></div>
                <div><span>Vendor rating</span><strong><Star size={12} fill="currentColor" /> {recommendedQuote.vendorRating}/5</strong></div>
                <div><span>Delivery</span><strong>{recommendedQuote.deliveryDays} day{recommendedQuote.deliveryDays === 1 ? "" : "s"}</strong></div>
                <div><span>Request estimate</span><strong>{money(selected.estimatedAmount)}</strong></div>
                <div><span>Payment terms</span><strong>{recommendedQuote.paymentTerms || "—"}</strong></div>
                <div><span>Warranty</span><strong>{recommendedQuote.warranty || "—"}</strong></div>
              </div>

              <div className={independentApprovalRequired ? "approval-route-card independent" : "approval-route-card low-value"}>
                <ShieldCheck size={18} />
                <div>
                  <strong>{independentApprovalRequired ? "Independent Approver / MD decision required" : "Within Procurement Manager approval limit"}</strong>
                  <span>
                    {independentApprovalRequired
                      ? selected.requesterRole === "Procurement Manager"
                        ? "This request originated from Procurement, so independent approval is required regardless of value."
                        : `The request value exceeds the configured Procurement Manager approval limit of ${money(approvalLimit)}.`
                      : `The request value is within the configured limit of ${money(approvalLimit)}. It belongs in the Low-Value Approvals workspace.`}
                  </span>
                </div>
              </div>

              {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}

              {independentApprovalRequired ? (
                <>
                  <label className="review-note recommendation-note"><span>Submission note</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for Approver / MD" /></label>
                  <div className="recommendation-submit-row">
                    <div><ShieldCheck size={15} /><span>The submission, notification and audit evidence are committed in one transaction.</span></div>
                    <button type="button" className="primary-form-button" disabled={busy} onClick={submitForApproval}><Send size={16} />{busy ? "Submitting…" : "Submit Recommendation to Approver / MD"}</button>
                  </div>
                </>
              ) : (
                <div className="low-value-next-step">Use <strong>Low-Value Approvals</strong> to complete the Procurement Manager decision. That action remains separated from recommendation preparation.</div>
              )}
            </>
          ) : (
            <div className="empty-state">This sourcing task is marked as a recommendation, but no recommended quote is recorded. Reopen Sourcing and recalculate the recommendation.</div>
          )}
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CornerUpLeft, SearchCheck, Send, ShieldCheck } from "lucide-react";
import type { ProcurementRequestRow } from "@/lib/procureflow/procurement-data";

type ActionName = "review" | "sourcing" | "return" | "submit_approval";

function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value || 0);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function ProcurementInbox({ rows }: { rows: ProcurementRequestRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || rows[0] || null,
    [rows, selectedId],
  );

  async function runAction(action: ActionName) {
    if (!selected) return;
    if (action === "return" && !note.trim()) {
      setMessage({ type: "error", text: "Enter a correction reason before returning the request." });
      return;
    }

    const confirmation = action === "submit_approval"
      ? `Submit ${selected.requestNo} to Approver / MD for final approval?`
      : action === "sourcing"
        ? `Open vendor quote collection for ${selected.requestNo}?`
        : action === "return"
          ? `Return ${selected.requestNo} to the Utility / Facility Head for correction?`
          : `Mark ${selected.requestNo} as reviewed by Procurement?`;
    if (!window.confirm(confirmation)) return;

    setBusyAction(action);
    setMessage(null);
    try {
      const endpoint = action === "sourcing"
        ? "/api/procurement/requests/sourcing"
        : "/api/procurement/requests/review";
      const body = action === "sourcing"
        ? { requestId: selected.id, note }
        : { requestId: selected.id, action, note };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to update request.");

      if (action === "sourcing") {
        setMessage({
          type: "success",
          text: `${selected.requestNo} is now in Vendor Quote Collection. Sourcing task ${payload?.result?.sourcingNo || "created"} is available under Sourcing.`,
        });
      } else {
        setMessage({ type: "success", text: `${selected.requestNo} moved to ${payload?.result?.status || "the next workflow stage"}.` });
      }
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to update request." });
    } finally {
      setBusyAction(null);
    }
  }

  if (!rows.length) return <div className="empty-state">There are no Facility requests waiting for procurement review.</div>;

  return (
    <div className="procurement-inbox-grid">
      <div className="table-wrap">
        <table className="data-table procurement-select-table">
          <thead><tr><th>Request</th><th>Facility Head</th><th>Department / Project</th><th>Amount</th><th>Status</th><th>Open</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selected?.id === row.id ? "selected-row" : ""}>
                <td><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></td>
                <td>{row.facilityManager || "—"}</td>
                <td>{row.departmentProject || "—"}</td>
                <td className="amount-cell">{money(row.estimatedAmount)}</td>
                <td><span className="status-chip">{row.status || "—"}</span></td>
                <td><button type="button" className="row-action-button" onClick={() => { setSelectedId(row.id); setMessage(null); setNote(""); }}>Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <section className="procurement-review-card">
          <div className="review-card-heading">
            <div><span>Procurement review</span><h3>{selected.requestNo}</h3><p>{selected.facilityManager || "Utility / Facility Head"} · {selected.departmentProject || "No department/project"}</p></div>
            <span className="status-pill">{selected.status || "Pending"}</span>
          </div>
          <div className="review-facts">
            <div><span>Category</span><strong>{selected.category || "—"}</strong></div>
            <div><span>Priority</span><strong>{selected.priority || "Normal"}</strong></div>
            <div><span>Estimated value</span><strong>{money(selected.estimatedAmount)}</strong></div>
            <div><span>Required date</span><strong>{dateText(selected.requiredDate)}</strong></div>
          </div>
          <div className="review-justification"><span>Business justification</span><p>{selected.justification || "No justification recorded."}</p></div>
          <label className="review-note"><span>Procurement review comment / correction reason</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a review note. A reason is mandatory when returning for correction." /></label>
          {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
          <div className="procurement-review-actions">
            <button type="button" className="review-action reviewed" disabled={Boolean(busyAction)} onClick={() => runAction("review")}><CheckCircle2 size={16} />{busyAction === "review" ? "Updating…" : "Mark Reviewed"}</button>
            <button type="button" className="review-action sourcing" disabled={Boolean(busyAction)} onClick={() => runAction("sourcing")}><SearchCheck size={16} />{busyAction === "sourcing" ? "Opening…" : "Requires Sourcing"}</button>
            <button type="button" className="review-action return" disabled={Boolean(busyAction)} onClick={() => runAction("return")}><CornerUpLeft size={16} />{busyAction === "return" ? "Returning…" : "Return for Correction"}</button>
            <button type="button" className="review-action approval" disabled={Boolean(busyAction)} onClick={() => runAction("submit_approval")}><Send size={16} />{busyAction === "submit_approval" ? "Submitting…" : "Submit to Approver / MD"}</button>
          </div>
          <div className="review-security-note"><ShieldCheck size={15} /><span>Every transition writes workflow, activity, approval-history and v2 audit evidence in one transaction.</span></div>
        </section>
      ) : null}
    </div>
  );
}

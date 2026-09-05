"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, PackageSearch, ShieldCheck, Star } from "lucide-react";
import type { ProcurementSourcingTaskRow, ProcurementVendorOption } from "@/lib/procureflow/procurement-data";

function money(value: number, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value || 0);
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

export function ProcurementSourcing({
  tasks,
  vendors,
}: {
  tasks: ProcurementSourcingTaskRow[];
  vendors: ProcurementVendorOption[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(tasks[0]?.id ?? null);
  const [vendorId, setVendorId] = useState("");
  const [manualVendor, setManualVendor] = useState("");
  const [quotedAmount, setQuotedAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [deliveryDays, setDeliveryDays] = useState("7");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [warranty, setWarranty] = useState("");
  const [vendorRating, setVendorRating] = useState("3");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selected = useMemo(
    () => tasks.find((task) => task.id === selectedId) || tasks[0] || null,
    [tasks, selectedId],
  );

  function resetQuoteForm() {
    setVendorId("");
    setManualVendor("");
    setQuotedAmount("");
    setCurrency("NGN");
    setDeliveryDays("7");
    setPaymentTerms("");
    setWarranty("");
    setVendorRating("3");
    setNotes("");
  }

  async function submitQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (!vendorId && !manualVendor.trim()) {
      setMessage({ type: "error", text: "Select a registered vendor or enter a manual vendor name." });
      return;
    }
    if (!(Number(quotedAmount) > 0)) {
      setMessage({ type: "error", text: "Quoted amount must be greater than zero." });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/procurement/sourcing/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcingTaskId: selected.id,
          vendorId: vendorId ? Number(vendorId) : null,
          manualVendor,
          quotedAmount: Number(quotedAmount),
          currency,
          deliveryDays: Number(deliveryDays || 0),
          paymentTerms,
          warranty,
          vendorRating: Number(vendorRating || 3),
          notes,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to save vendor quote.");

      setMessage({
        type: "success",
        text: `${payload?.result?.vendorName || "Vendor"} quote of ${money(Number(payload?.result?.quotedAmount || 0), payload?.result?.currency || currency)} was added to ${selected.sourcingNo}.`,
      });
      resetQuoteForm();
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to save vendor quote." });
    } finally {
      setBusy(false);
    }
  }

  if (!tasks.length) {
    return (
      <div className="empty-state sourcing-empty">
        No active sourcing task is available. Open a request in the Utility Head / Facility Head Inbox and choose <strong>Requires Sourcing</strong> to create one.
      </div>
    );
  }

  return (
    <div className="sourcing-workspace">
      <div className="sourcing-task-strip">
        {tasks.map((task) => (
          <button
            type="button"
            key={task.id}
            className={selected?.id === task.id ? "sourcing-task-card active" : "sourcing-task-card"}
            onClick={() => { setSelectedId(task.id); setMessage(null); }}
          >
            <div><strong>{task.sourcingNo}</strong><span>{task.requestNo}</span></div>
            <small>{task.quoteCount} quote{task.quoteCount === 1 ? "" : "s"} · {task.taskStatus || "Open"}</small>
          </button>
        ))}
      </div>

      {selected ? (
        <>
          <section className="sourcing-summary-card">
            <div className="review-card-heading">
              <div>
                <span>Active sourcing task</span>
                <h3>{selected.sourcingNo}</h3>
                <p>{selected.requestNo} · {selected.departmentProject || "No department/project"}</p>
              </div>
              <span className="status-pill">{selected.requestStatus || "Vendor Quote Collection"}</span>
            </div>
            <div className="review-facts sourcing-facts">
              <div><span>Facility Head</span><strong>{selected.facilityManager || "—"}</strong></div>
              <div><span>Category</span><strong>{selected.category || "—"}</strong></div>
              <div><span>Request estimate</span><strong>{money(selected.estimatedAmount)}</strong></div>
              <div><span>Quotes received</span><strong>{selected.quoteCount}</strong></div>
              <div><span>Lowest quote</span><strong>{selected.lowestQuote == null ? "—" : money(selected.lowestQuote)}</strong></div>
              <div><span>Highest quote</span><strong>{selected.highestQuote == null ? "—" : money(selected.highestQuote)}</strong></div>
              <div><span>Task status</span><strong>{selected.taskStatus || "Open"}</strong></div>
              <div><span>Updated</span><strong>{dateText(selected.updatedAt)}</strong></div>
            </div>
          </section>

          <section className="sourcing-quotes-panel">
            <div className="sourcing-section-heading">
              <div><h3>Vendor quotes</h3><p>Each vendor price remains attached to that vendor for clear side-by-side comparison.</p></div>
              <span className="status-pill">{selected.quotes.length} captured</span>
            </div>
            {selected.quotes.length ? (
              <div className="quote-card-grid">
                {selected.quotes.map((quote) => (
                  <article className="quote-card" key={quote.id}>
                    <div className="quote-card-head">
                      <div><strong>{quote.vendorName}</strong><span>{quote.vendorId ? "Registered vendor" : "Manual vendor"}</span></div>
                      <span className="quote-rating"><Star size={12} fill="currentColor" /> {quote.vendorRating}/5</span>
                    </div>
                    <div className="quote-price">{money(quote.quotedAmount, quote.currency)}</div>
                    <dl>
                      <div><dt>Delivery</dt><dd>{quote.deliveryDays} day{quote.deliveryDays === 1 ? "" : "s"}</dd></div>
                      <div><dt>Payment terms</dt><dd>{quote.paymentTerms || "—"}</dd></div>
                      <div><dt>Warranty</dt><dd>{quote.warranty || "—"}</dd></div>
                      <div><dt>Quote date</dt><dd>{dateText(quote.quoteDate)}</dd></div>
                    </dl>
                    {quote.notes ? <p className="quote-notes">{quote.notes}</p> : null}
                  </article>
                ))}
              </div>
            ) : <div className="empty-state">No vendor quotes have been captured for this sourcing task.</div>}
          </section>

          <section className="quote-entry-panel">
            <div className="sourcing-section-heading">
              <div><h3>Add Vendor Quote</h3><p>Capture a registered supplier or a manual vendor quote. Quote-document upload will be enabled with the GCP-free document storage layer.</p></div>
              <CirclePlus size={18} />
            </div>
            {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
            <form className="quote-entry-form" onSubmit={submitQuote}>
              <div className="form-grid form-grid-3">
                <label><span>Registered vendor</span><select value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Choose vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.category ? ` — ${vendor.category}` : ""}</option>)}</select></label>
                <label><span>Or manual vendor</span><input value={manualVendor} onChange={(e) => setManualVendor(e.target.value)} placeholder="New / unregistered vendor" maxLength={250} /></label>
                <label><span>Quoted amount *</span><input type="number" min="0.01" step="0.01" value={quotedAmount} onChange={(e) => setQuotedAmount(e.target.value)} /></label>
                <label><span>Currency *</span><select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>NGN</option><option>USD</option><option>GBP</option><option>EUR</option></select></label>
                <label><span>Delivery days</span><input type="number" min="0" step="1" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} /></label>
                <label><span>Vendor rating</span><select value={vendorRating} onChange={(e) => setVendorRating(e.target.value)}>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label>
                <label><span>Payment terms</span><input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 50% advance, balance on delivery" /></label>
                <label><span>Warranty / guarantee</span><input value={warranty} onChange={(e) => setWarranty(e.target.value)} /></label>
                <label><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              </div>
              <div className="quote-submit-row">
                <div className="security-write-note"><ShieldCheck size={16} /><span>Quote creation is written to workflow history and the v2 audit chain.</span></div>
                <button type="submit" className="primary-form-button" disabled={busy}><PackageSearch size={16} />{busy ? "Saving quote…" : "Save Vendor Quote"}</button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  FileCheck2,
  Landmark,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import type {
  FinanceBudgetRow,
  FinancePaymentRow,
  FinanceReadyRow,
  FinanceReceiptRow,
} from "@/lib/procureflow/finance-data";

type Message = { type: "success" | "error"; text: string } | null;

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

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function FinanceApprovedForPayment({ rows }: { rows: FinanceReadyRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [verifyReason, setVerifyReason] = useState("Verified during authorized Finance payment processing.");
  const [transferType, setTransferType] = useState<"Internet Bank Transfer" | "Physical Bank Transfer">("Internet Bank Transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [financeNote, setFinanceNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"verify" | "pay" | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);

  async function verifyPayee() {
    if (!selected) return;
    setBusy("verify");
    setMessage(null);
    try {
      const response = await fetch("/api/finance/payee/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: selected.id, reason: verifyReason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to verify payee details.");
      setMessage({ type: "success", text: `${selected.requestNo} payee details are Finance verified and payment-ready.` });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to verify payee details." });
    } finally {
      setBusy(null);
    }
  }

  async function recordPayment() {
    if (!selected) return;
    if (!confirmed) {
      setMessage({ type: "error", text: "Confirm the approved payee, amount and transfer type before recording payment." });
      return;
    }
    if (!paymentReference.trim()) {
      setMessage({ type: "error", text: "Enter the payment / reconciliation reference." });
      return;
    }
    if (!window.confirm(`Record payment for ${selected.requestNo}? This will move the request to Paid.`)) return;
    setBusy("pay");
    setMessage(null);
    try {
      const response = await fetch("/api/finance/payments/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: selected.id,
          transferType,
          paymentReference,
          paymentDate,
          financeNote,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to record payment.");
      setMessage({ type: "success", text: `${selected.requestNo} was recorded as Paid. Payment ${payload?.result?.paymentNo || "record"} is now in the Finance ledger.` });
      setPaymentReference("");
      setFinanceNote("");
      setConfirmed(false);
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to record payment." });
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <div className="empty-state">No approved procurement is currently waiting for Finance payment.</div>;

  return (
    <div className="finance-payment-workspace">
      <div className="finance-ready-list">
        {rows.map((row) => (
          <button type="button" key={row.id} className={selected?.id === row.id ? "finance-ready-card active" : "finance-ready-card"} onClick={() => { setSelectedId(row.id); setMessage(null); setConfirmed(false); }}>
            <span className="finance-ready-icon"><Banknote size={16} /></span>
            <div><strong>{row.requestNo}</strong><span>{row.departmentProject || "—"} · {row.category || "—"}</span></div>
            <div><b>{money(row.amount, row.currency)}</b><small>{row.paymentReadinessStatus || row.paymentStatus || "Awaiting Finance"}</small></div>
          </button>
        ))}
      </div>

      {selected ? (
        <section className="finance-payment-card">
          <div className="review-card-heading">
            <div><span>Approved for payment</span><h3>{selected.requestNo}</h3><p>{selected.departmentProject || "—"} · {selected.category || "—"}</p></div>
            <span className="status-pill">{selected.paymentStatus || selected.status || "Approved"}</span>
          </div>

          <div className="review-facts finance-facts">
            <div><span>Approved amount</span><strong>{money(selected.amount, selected.currency)}</strong></div>
            <div><span>Approved by</span><strong>{selected.approvedBy || "—"}</strong></div>
            <div><span>Approval date</span><strong>{dateText(selected.approvalDate)}</strong></div>
            <div><span>Approved vendor</span><strong>{selected.vendorName || "Not linked"}</strong></div>
            <div><span>Request status</span><strong>{selected.status || "—"}</strong></div>
            <div><span>Payment status</span><strong>{selected.paymentStatus || "—"}</strong></div>
          </div>

          <div className="finance-payee-panel">
            <div className="finance-panel-title"><Landmark size={17} /><div><strong>Payee & bank details</strong><span>Masked by default. Finance verifies the encrypted source record before payment.</span></div></div>
            {selected.payeeId ? (
              <div className="review-facts finance-payee-facts">
                <div><span>Payee type</span><strong>{selected.payeeType || "—"}</strong></div>
                <div><span>Payee / vendor</span><strong>{selected.payeeNameMasked || "—"}</strong></div>
                <div><span>Account name</span><strong>{selected.accountNameMasked || "—"}</strong></div>
                <div><span>Bank</span><strong>{selected.bankNameMasked || "—"}</strong></div>
                <div><span>Account number</span><strong>{selected.accountNumberLast4 ? `******${selected.accountNumberLast4}` : "—"}</strong></div>
                <div><span>Verification</span><strong>{selected.verificationStatus || "Pending"}</strong></div>
              </div>
            ) : <div className="finance-blocker"><AlertTriangle size={17} /><div><strong>No payee record is linked</strong><span>Payment remains blocked until authorized payee details are supplied.</span></div></div>}

            {selected.payeeMigrationState === "legacy-reentry-required" ? (
              <div className="finance-legacy-warning"><LockKeyhole size={17} /><div><strong>Legacy encrypted payee — secure re-entry required</strong><span>The historical encrypted values were preserved during the GCP exit, but the retired key is unavailable. Finance can see only the masked snapshot and cannot verify or pay this record until the payee is re-entered under the active v2 encryption key. The legacy ciphertext remains untouched for audit evidence.</span></div></div>
            ) : null}
            {selected.payeeMigrationState === "v2-ready" ? (
              <div className="finance-v2-ready"><ShieldCheck size={17} /><div><strong>Active v2 encryption verified</strong><span>The backend can securely validate this payee record without exposing unmasked account details in the page source.</span></div></div>
            ) : null}
          </div>

          {selected.payeeMigrationState === "v2-ready" && selected.verificationStatus !== "Finance Verified" ? (
            <div className="finance-verify-box">
              <label><span>Finance verification reason</span><input value={verifyReason} onChange={(event) => setVerifyReason(event.target.value)} /></label>
              <button type="button" className="finance-primary-button" disabled={Boolean(busy)} onClick={verifyPayee}><BadgeCheck size={16} />{busy === "verify" ? "Verifying…" : "Verify linked payee details"}</button>
            </div>
          ) : null}

          {selected.verificationStatus === "Finance Verified" && selected.payeeMigrationState === "v2-ready" ? (
            <div className="finance-record-box">
              <div className="finance-panel-title"><FileCheck2 size={17} /><div><strong>Record payment</strong><span>Payment execution remains a Finance-only action after workflow approval and payee verification.</span></div></div>
              <div className="finance-form-grid">
                <label><span>Transfer type</span><select value={transferType} onChange={(event) => setTransferType(event.target.value as typeof transferType)}><option>Internet Bank Transfer</option><option>Physical Bank Transfer</option></select></label>
                <label><span>Payment date</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
                <label className="wide"><span>Payment / reconciliation reference</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Required" /></label>
                <label className="wide"><span>Finance note</span><textarea rows={3} value={financeNote} onChange={(event) => setFinanceNote(event.target.value)} /></label>
              </div>
              <label className="finance-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm the approved payee details, amount and transfer type.</span></label>
              <button type="button" className="finance-primary-button pay" disabled={Boolean(busy) || !confirmed} onClick={recordPayment}><Banknote size={16} />{busy === "pay" ? "Recording…" : "Record Payment"}</button>
            </div>
          ) : null}

          {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
          <div className="review-security-note"><ShieldCheck size={15} /><span>Receipt evidence is recorded separately under Finance → Receipts after payment, preserving the original ProcureFlow separation of payment and evidence.</span></div>
        </section>
      ) : null}
    </div>
  );
}

export function FinancePayments({ rows }: { rows: FinancePaymentRow[] }) {
  if (!rows.length) return <div className="empty-state">No Finance payment records are available.</div>;
  return (
    <div className="table-wrap"><table className="data-table finance-table"><thead><tr><th>Payment</th><th>Request / PO</th><th>Vendor</th><th>Amount</th><th>Method</th><th>Transfer type</th><th>Reference</th><th>Payment date</th><th>Status</th><th>Receipt</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><strong>{row.paymentNo}</strong><small>{dateText(row.createdAt)}</small></td><td><strong>{row.requestNo || "—"}</strong><small>{row.poNo || ""}</small></td><td>{row.vendorName || "—"}</td><td className="amount-cell">{money(row.amount, row.currency)}</td><td>{row.paymentMethod || "—"}</td><td>{row.transferType || "—"}</td><td>{row.paymentReference || "—"}</td><td>{dateText(row.paymentDate)}</td><td><span className="status-chip">{row.status || "—"}</span><small>{row.verificationStatus || ""}</small></td><td>{row.receiptId ? `#${row.receiptId}` : "Pending"}</td></tr>)}
    </tbody></table></div>
  );
}

export function FinanceReceipts({ rows }: { rows: FinanceReceiptRow[] }) {
  if (!rows.length) return <div className="empty-state">No receipt records are available.</div>;
  return (
    <div className="finance-receipt-archive">
      <div className="finance-archive-note"><ReceiptText size={17} /><div><strong>Migrated receipt evidence archive</strong><span>Existing receipt metadata is live from Neon. Raw account-number fields are deliberately excluded from this interface.</span></div></div>
      <div className="table-wrap"><table className="data-table finance-table"><thead><tr><th>Receipt</th><th>Payment / Request</th><th>Type</th><th>Method</th><th>Payee</th><th>Amount</th><th>Date</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}><td><strong>{row.receiptNo}</strong><small>{dateText(row.createdAt)}</small></td><td><strong>{row.linkedPaymentNo || "—"}</strong><small>{row.requestNo || ""}</small></td><td>{row.receiptType || "—"}</td><td>{row.paymentMethod || "—"}</td><td>{row.vendorName || row.payeeName || "—"}</td><td className="amount-cell">{money(row.amount, row.currency)}</td><td>{dateText(row.paymentDate)}</td><td><span className="status-chip">{row.status || "—"}</span>{row.duplicateWarning ? <small className="finance-warning-text">Duplicate warning</small> : null}</td><td>{row.originalFileName || row.ocrStatus || row.discrepancyStatus || "Recorded"}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

export function FinanceBudgets({ rows }: { rows: FinanceBudgetRow[] }) {
  if (!rows.length) return <div className="empty-state">No budget records are available.</div>;
  return (
    <div className="table-wrap"><table className="data-table finance-table"><thead><tr><th>Month</th><th>Department / Project</th><th>Category</th><th>Budget Limit</th><th>Override</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><strong>{row.budgetMonth}</strong></td><td>{row.departmentProject || "—"}</td><td>{row.category || "—"}</td><td className="amount-cell">{money(row.limitAmount)}</td><td>{row.overrideRequired ? "Required" : "No"}</td></tr>)}
    </tbody></table></div>
  );
}

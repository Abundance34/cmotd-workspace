"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PayeeDetailsReveal } from "@/components/payee-details-reveal";
import { requestConfirmation } from "@/components/in-app-confirmation";
import {
  AlertTriangle,
  Banknote,
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
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);

  async function payRequest(row: FinanceReadyRow) {
    const approved = await requestConfirmation({
      eyebrow: "FINANCE PAYMENT",
      title: "Mark this approved request as paid?",
      description: "Finance will mark the request Paid immediately. The payment record is created automatically, and you will be taken to Receipts to enter or attach the receipt/proof of payment.",
      reference: row.requestNo,
      detail: `${money(row.amount, row.currency)} · ${row.vendorName || row.payeeType || "Approved payee"}`,
      confirmLabel: "Pay & Mark Paid",
      cancelLabel: "Cancel",
      tone: "success",
    });
    if (!approved) return;

    setBusyId(row.id);
    setSelectedId(row.id);
    setMessage(null);
    try {
      const response = await fetch("/api/finance/payments/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: row.id, quickPay: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to mark request as paid.");

      const paymentId = Number(payload?.result?.paymentId || 0);
      try {
        sessionStorage.setItem("procureflow:receipt-request-id", String(row.id));
        if (paymentId > 0) sessionStorage.setItem("procureflow:receipt-payment-id", String(paymentId));
      } catch {}

      setMessage({ type: "success", text: `${row.requestNo} is now Paid. Opening Receipts for this payment…` });
      router.refresh();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("procureflow:navigate", { detail: { section: "Receipts" } }));
      }, 50);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to mark request as paid." });
    } finally {
      setBusyId(null);
    }
  }

  if (!rows.length) return <div className="empty-state">No approved procurement is currently waiting for Finance payment.</div>;

  return (
    <div className="finance-payment-workspace">
      <div className="finance-ready-list">
        {rows.map((row) => (
          <div key={row.id} className="finance-ready-row">
            <button
              type="button"
              className={selected?.id === row.id ? "finance-ready-card active" : "finance-ready-card"}
              onClick={() => { setSelectedId(row.id); setMessage(null); }}
            >
              <span className="finance-ready-icon"><Banknote size={16} /></span>
              <div><strong>{row.requestNo}</strong><span>{row.departmentProject || "—"} · {row.category || "—"}</span></div>
              <div><b>{money(row.amount, row.currency)}</b><small>{row.paymentStatus || row.status || "Approved"}</small></div>
            </button>
            <button
              type="button"
              className="finance-pay-row-button"
              disabled={busyId === row.id}
              onClick={() => void payRequest(row)}
            >
              <Banknote size={15} /> {busyId === row.id ? "Paying…" : "Pay"}
            </button>
          </div>
        ))}
      </div>

      {selected ? (
        <section className="finance-payment-card" id="finance-payment-action">
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

          <div className="finance-business-justification">
            <span>Business justification</span>
            <p>{selected.businessJustification || "No business justification was recorded for this purchase request."}</p>
          </div>

          <div className="finance-payee-panel">
            <div className="finance-panel-title"><Landmark size={17} /><div><strong>Payee & bank details</strong><span>Finance receives the authorized full account details needed before marking the request Paid. Every access is audit-recorded.</span></div></div>
            {selected.payeeId ? (
              <>
                <div className="review-facts finance-payee-facts">
                  <div><span>Payee type</span><strong>{selected.payeeType || "—"}</strong></div>
                  <div><span>Verification</span><strong>{selected.verificationStatus || "Pending — verified automatically on Pay"}</strong></div>
                  <div><span>Payment readiness</span><strong>{selected.paymentReadinessStatus || "Approved"}</strong></div>
                </div>
                <PayeeDetailsReveal
                  requestId={selected.id}
                  available={Boolean(selected.payeeId)}
                  autoReveal
                  allowHide={false}
                  heading="Full payee and bank details"
                />
              </>
            ) : <div className="finance-blocker"><AlertTriangle size={17} /><div><strong>No payee record is linked</strong><span>Payment remains blocked until payee details are supplied.</span></div></div>}

            {selected.payeeMigrationState === "legacy-reentry-required" ? (
              <div className="finance-legacy-warning"><LockKeyhole size={17} /><div><strong>Encrypted payee record needs its previous key</strong><span>Restore the previous/legacy payee key or securely re-enter the account details before payment.</span></div></div>
            ) : null}
            {selected.payeeMigrationState === "v2-ready" ? (
              <div className="finance-v2-ready"><ShieldCheck size={17} /><div><strong>Encrypted payee record is readable</strong><span>Click Pay to verify the linked payee automatically, mark the request Paid, and continue directly to Receipts.</span></div></div>
            ) : null}
          </div>

          <div className="finance-record-box finance-quick-pay-box">
            <div className="finance-panel-title"><Banknote size={17} /><div><strong>Pay approved request</strong><span>No separate verification step is required. Pay verifies the readable payee record, changes the request from Approved to Paid, creates the payment ledger record, and opens Receipts for evidence capture.</span></div></div>
            <button
              type="button"
              className="finance-primary-button pay"
              disabled={Boolean(busyId) || !selected.payeeId}
              onClick={() => void payRequest(selected)}
            >
              <Banknote size={16} /> {busyId === selected.id ? "Paying…" : "Pay & Mark Paid"}
            </button>
          </div>

          {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
          <div className="review-security-note"><ShieldCheck size={15} /><span>After payment, ProcureFlow opens Finance → Receipts with this paid request selected so you can manually enter a receipt, attach a receipt/proof, and optionally add supporting documents.</span></div>
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

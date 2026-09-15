"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

type RevealedPayeeDetails = {
  payeeType: string | null;
  payeeName: string | null;
  accountName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  currency: string | null;
  paymentReference: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

export function PayeeDetailsReveal({
  requestId,
  available = true,
  autoReveal = false,
  allowHide = true,
  heading = "Full account details",
  description = "Hidden by default. Every reveal is recorded in the audit trail.",
}: {
  requestId: number | null | undefined;
  available?: boolean;
  autoReveal?: boolean;
  allowHide?: boolean;
  heading?: string;
  description?: string;
}) {
  const [details, setDetails] = useState<RevealedPayeeDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reveal() {
    if (!requestId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/payee-details/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ requestId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to reveal payment recipient details.");
      setDetails(payload?.details || null);
    } catch (error) {
      setDetails(null);
      setError(error instanceof Error ? error.message : "Unable to reveal payment recipient details.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setDetails(null);
    setError("");
    if (autoReveal && available && requestId) void reveal();
    // requestId is the intended reveal boundary. Avoid re-revealing solely because busy state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, autoReveal, available]);

  function hide() {
    setDetails(null);
    setError("");
  }

  if (!available) {
    return <div className="payee-reveal-disabled">Full account details will be available after payment recipient details are supplied.</div>;
  }

  return (
    <div className="payee-reveal-shell">
      <div className="payee-reveal-head">
        <div>
          <strong>{heading}</strong>
          <span><ShieldCheck size={13} /> {autoReveal ? "Authorized full-detail view. Every access is recorded in the audit trail." : description}</span>
        </div>
        {details && allowHide ? (
          <button type="button" className="payee-reveal-button secondary" onClick={hide}><EyeOff size={15} /> Hide account details</button>
        ) : !details && !autoReveal ? (
          <button type="button" className="payee-reveal-button" disabled={busy || !requestId} onClick={() => void reveal()}><Eye size={15} /> {busy ? "Opening…" : "View account details"}</button>
        ) : null}
      </div>
      {busy && autoReveal ? <div className="payee-reveal-disabled">Opening authorized payee and bank details…</div> : null}
      {error ? <div className="action-message error payee-reveal-error">{error}</div> : null}
      {details ? (
        <div className="payee-reveal-grid">
          <article><span>Payee type</span><strong>{details.payeeType || "—"}</strong></article>
          <article><span>Payee name</span><strong>{details.payeeName || "—"}</strong></article>
          <article><span>Account name</span><strong>{details.accountName || "—"}</strong></article>
          <article><span>Bank</span><strong>{details.bankName || "—"}</strong></article>
          <article><span>Account number</span><strong className="payee-account-number">{details.accountNumber || "—"}</strong></article>
          <article><span>Currency</span><strong>{details.currency || "—"}</strong></article>
          <article><span>Payment reference</span><strong>{details.paymentReference || "—"}</strong></article>
          <article><span>Contact email</span><strong>{details.contactEmail || "—"}</strong></article>
          <article><span>Contact phone</span><strong>{details.contactPhone || "—"}</strong></article>
        </div>
      ) : null}
    </div>
  );
}

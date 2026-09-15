"use client";

import { useMemo, useState } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { PayeeDetailsReveal } from "@/components/payee-details-reveal";

function money(value: unknown) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0));
}

export function AuditorPayeeDetails({ requests = [] }: { requests?: any[] }) {
  const rows = useMemo(() => requests.filter((row: any) => Boolean(row?.hasPayee)), [requests]);
  const [requestId, setRequestId] = useState<number | null>(rows[0]?.id ?? null);
  const selected = rows.find((row: any) => Number(row.id) === Number(requestId)) || null;

  if (!rows.length) {
    return <div className="empty-state">No purchase request with stored payment recipient details is available.</div>;
  }

  return (
    <div className="auditor-review-stack">
      <div className="auditor-info-card">
        <Landmark size={18} />
        <div>
          <strong>Payment recipient & bank detail review</strong>
          <span>Auditor access shows the authorized full payee record. Every access is written to the immutable payee-detail audit trail.</span>
        </div>
      </div>

      <div className="auditor-picker-row">
        <label className="auditor-label">
          <span>Open payee record</span>
          <select value={requestId || ""} onChange={(event) => setRequestId(Number(event.target.value) || null)}>
            <option value="">Select request…</option>
            {rows.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.requestNo} — {row.requestedBy || row.requesterRole || "Requester"} — {money(row.amount)} — {row.status || "—"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected ? (
        <>
          <div className="auditor-summary-grid">
            <article><span>Request</span><strong>{selected.requestNo}</strong></article>
            <article><span>Requester</span><strong>{selected.requestedBy || "—"}</strong><small>{selected.requesterRole || ""}</small></article>
            <article><span>Department / Project</span><strong>{selected.departmentProject || "—"}</strong></article>
            <article><span>Amount</span><strong>{money(selected.amount)}</strong></article>
            <article><span>Request status</span><strong>{selected.status || "—"}</strong></article>
            <article><span>Payment status</span><strong>{selected.paymentStatus || "—"}</strong></article>
          </div>
          <PayeeDetailsReveal
            requestId={selected.id}
            available
            autoReveal
            allowHide={false}
            heading="Full payee and bank details"
          />
          <div className="auditor-info-card">
            <ShieldCheck size={18} />
            <div>
              <strong>Audit-controlled access</strong>
              <span>Plaintext bank values are returned only to the authorized page and are never written into the audit event itself.</span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

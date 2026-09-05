"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CornerUpLeft,
  Landmark,
  PackageCheck,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import type {
  ApproverGatewayPassRow,
  ApproverPaymentRow,
  ApproverPORow,
} from "@/lib/procureflow/approver-data";

type BinaryDecision = "approve" | "reject";
type GatewayDecision = BinaryDecision | "return";
type Message = { type: "success" | "error"; text: string } | null;

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
  return new Intl.DateTimeFormat("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function DecisionMessage({ message }: { message: Message }) {
  return message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null;
}

function PolicyNote({ approvalLimit, label }: { approvalLimit: number; label: string }) {
  return (
    <div className="approval-policy-note">
      <ShieldCheck size={17} />
      <div>
        <strong>Approver / MD authority required</strong>
        <span>{label} exceeds the configured Procurement Manager approval limit of {money(approvalLimit)}.</span>
      </div>
    </div>
  );
}

export function ApproverPOApprovals({ rows, approvalLimit }: { rows: ApproverPORow[]; approvalLimit: number }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<BinaryDecision | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);

  async function decide(decision: BinaryDecision) {
    if (!selected) return;
    if (decision === "reject" && !note.trim()) {
      setMessage({ type: "error", text: "Enter a reason before rejecting this purchase order." });
      return;
    }
    if (!window.confirm(`${decision === "approve" ? "Approve" : "Reject"} ${selected.poNo}?`)) return;
    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch("/api/approver/purchase-orders/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: selected.id, decision, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to apply purchase-order decision.");
      setMessage({ type: "success", text: `${selected.poNo} moved to ${payload?.result?.status || "the next workflow stage"}.` });
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to apply purchase-order decision." });
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <div className="empty-state">No high-value purchase order is currently awaiting Approver / MD approval.</div>;

  return (
    <div className="approver-operational-workspace">
      <div className="operational-card-list">
        {rows.map((row) => (
          <button type="button" key={row.id} className={selected?.id === row.id ? "operational-list-card active" : "operational-list-card"} onClick={() => { setSelectedId(row.id); setNote(""); setMessage(null); }}>
            <span className="operational-list-icon"><PackageCheck size={16} /></span>
            <div><strong>{row.poNo}</strong><span>{row.vendorName || "Vendor not specified"} · {row.requestNo || "No linked request"}</span></div>
            <div><b>{money(row.totalAmount)}</b><small>{row.status || "Pending Approval"}</small></div>
          </button>
        ))}
      </div>

      {selected ? (
        <section className="operational-decision-card">
          <div className="review-card-heading">
            <div><span>Purchase order approval</span><h3>{selected.poNo}</h3><p>{selected.vendorName || "Vendor not specified"} · linked request {selected.requestNo || "—"}</p></div>
            <span className="status-pill">{selected.status || "Pending Approval"}</span>
          </div>

          <div className="review-facts approver-facts">
            <div><span>PO value</span><strong>{money(selected.totalAmount)}</strong></div>
            <div><span>PO date</span><strong>{dateText(selected.poDate)}</strong></div>
            <div><span>Expected delivery</span><strong>{dateText(selected.expectedDeliveryDate)}</strong></div>
            <div><span>Created by</span><strong>{selected.createdByName || "—"}</strong><small>{selected.createdByRole || "—"}</small></div>
            <div><span>Payment status</span><strong>{selected.paymentStatus || "—"}</strong></div>
            <div><span>Receiving status</span><strong>{selected.receivingStatus || "—"}</strong></div>
            <div><span>Current route</span><strong>{selected.nextRole || "Approver / MD"}</strong></div>
            <div><span>Last updated</span><strong>{dateText(selected.updatedAt)}</strong></div>
          </div>

          <PolicyNote approvalLimit={approvalLimit} label="This purchase order" />

          <div className="operational-detail-section">
            <div className="operational-section-title"><PackageCheck size={16} /><div><strong>Purchase order line items</strong><span>{selected.items.length} item{selected.items.length === 1 ? "" : "s"}</span></div></div>
            {selected.items.length ? (
              <div className="table-wrap"><table className="data-table compact-approval-table"><thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id}><td><strong>{item.itemName}</strong><small>{item.description || "—"}</small></td><td>{item.category || "—"}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td className="amount-cell">{money(item.total)}</td></tr>)}</tbody></table></div>
            ) : <div className="empty-state compact-empty">No purchase-order line items are attached.</div>}
          </div>

          <label className="review-note approver-note"><span>Approval note / rejection reason</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval. Required for rejection." /></label>
          <DecisionMessage message={message} />
          <div className="approver-actions">
            <button type="button" className="approver-action approve" disabled={Boolean(busy)} onClick={() => decide("approve")}><CheckCircle2 size={16} />{busy === "approve" ? "Approving…" : "Approve PO"}</button>
            <button type="button" className="approver-action reject" disabled={Boolean(busy)} onClick={() => decide("reject")}><XCircle size={16} />{busy === "reject" ? "Rejecting…" : "Reject PO"}</button>
          </div>
          <div className="review-security-note"><ShieldCheck size={15} /><span>Approval returns the PO to Procurement Manager for commercial release. It is not sent directly to Logistics.</span></div>
        </section>
      ) : null}
    </div>
  );
}

export function ApproverPaymentApprovals({ rows, approvalLimit }: { rows: ApproverPaymentRow[]; approvalLimit: number }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<BinaryDecision | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);

  async function decide(decision: BinaryDecision) {
    if (!selected) return;
    if (decision === "reject" && !note.trim()) {
      setMessage({ type: "error", text: "Enter a reason before rejecting this payment request." });
      return;
    }
    if (!window.confirm(`${decision === "approve" ? "Approve" : "Reject"} ${selected.paymentNo}?`)) return;
    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch("/api/approver/payments/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: selected.id, decision, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to apply payment decision.");
      setMessage({ type: "success", text: `${selected.paymentNo} moved to ${payload?.result?.status || "the next workflow stage"}.` });
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to apply payment decision." });
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <div className="empty-state">No high-value payment request is currently awaiting Approver / MD approval.</div>;

  return (
    <div className="approver-operational-workspace">
      <div className="operational-card-list">
        {rows.map((row) => (
          <button type="button" key={row.id} className={selected?.id === row.id ? "operational-list-card active" : "operational-list-card"} onClick={() => { setSelectedId(row.id); setNote(""); setMessage(null); }}>
            <span className="operational-list-icon"><Landmark size={16} /></span>
            <div><strong>{row.paymentNo}</strong><span>{row.requestNo || row.poNo || "No linked reference"} · {row.vendorName || "Payee/vendor not specified"}</span></div>
            <div><b>{money(row.amount, row.currency)}</b><small>{row.status || "Pending Approval"}</small></div>
          </button>
        ))}
      </div>

      {selected ? (
        <section className="operational-decision-card">
          <div className="review-card-heading">
            <div><span>Payment approval</span><h3>{selected.paymentNo}</h3><p>{selected.requestNo ? `Request ${selected.requestNo}` : selected.poNo ? `PO ${selected.poNo}` : "No linked request or PO"}</p></div>
            <span className="status-pill">{selected.status || "Pending Approval"}</span>
          </div>

          <div className="review-facts approver-facts">
            <div><span>Payment amount</span><strong>{money(selected.amount, selected.currency)}</strong></div>
            <div><span>Vendor / payee</span><strong>{selected.vendorName || "—"}</strong></div>
            <div><span>Payment method</span><strong>{selected.paymentMethod || "—"}</strong></div>
            <div><span>Transfer type</span><strong>{selected.transferType || "—"}</strong></div>
            <div><span>Reference</span><strong>{selected.paymentReference || "—"}</strong></div>
            <div><span>Verification</span><strong>{selected.verificationStatus || "Pending"}</strong></div>
            <div><span>Created by</span><strong>{selected.createdByName || "—"}</strong><small>{selected.createdByRole || "—"}</small></div>
            <div><span>Created</span><strong>{dateText(selected.createdAt)}</strong></div>
          </div>

          <PolicyNote approvalLimit={approvalLimit} label="This payment request" />
          <div className="finance-separation-note"><Landmark size={17} /><div><strong>Approval is not payment execution</strong><span>Approver / MD authorizes the payment request. Finance remains the only role that executes the approved payment and records payment evidence.</span></div></div>

          <label className="review-note approver-note"><span>Approval note / rejection reason</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval. Required for rejection." /></label>
          <DecisionMessage message={message} />
          <div className="approver-actions">
            <button type="button" className="approver-action approve" disabled={Boolean(busy)} onClick={() => decide("approve")}><CheckCircle2 size={16} />{busy === "approve" ? "Approving…" : "Approve Payment"}</button>
            <button type="button" className="approver-action reject" disabled={Boolean(busy)} onClick={() => decide("reject")}><XCircle size={16} />{busy === "reject" ? "Rejecting…" : "Reject Payment"}</button>
          </div>
          <div className="review-security-note"><ShieldCheck size={15} /><span>Approved payments route to Finance; no payment date or proof-of-payment record is created by this approval action.</span></div>
        </section>
      ) : null}
    </div>
  );
}

export function ApproverGatewayApprovals({ rows }: { rows: ApproverGatewayPassRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<GatewayDecision | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);

  async function decide(decision: GatewayDecision) {
    if (!selected) return;
    if ((decision === "reject" || decision === "return") && !note.trim()) {
      setMessage({ type: "error", text: decision === "reject" ? "Enter a reason before rejecting this gateway pass." : "Enter a reason before returning this gateway pass." });
      return;
    }
    const verb = decision === "approve" ? "Approve" : decision === "reject" ? "Reject" : "Return";
    if (!window.confirm(`${verb} ${selected.passNumber}?`)) return;
    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch("/api/approver/gateway-passes/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayPassId: selected.id, decision, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to apply gateway-pass decision.");
      setMessage({ type: "success", text: `${selected.passNumber} moved to ${payload?.result?.status || "the next workflow stage"}.` });
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to apply gateway-pass decision." });
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return <div className="empty-state">No gateway pass is currently awaiting final Approver / MD authorization.</div>;

  return (
    <div className="approver-operational-workspace">
      <div className="operational-card-list">
        {rows.map((row) => (
          <button type="button" key={row.id} className={selected?.id === row.id ? "operational-list-card active" : "operational-list-card"} onClick={() => { setSelectedId(row.id); setNote(""); setMessage(null); }}>
            <span className="operational-list-icon"><Truck size={16} /></span>
            <div><strong>{row.passNumber}</strong><span>{row.facilityManagerName || "Utility / Facility Head"} · {row.movementType}</span></div>
            <div><b>{row.destination || "Destination not set"}</b><small>{row.status || "Pending Approval"}</small></div>
          </button>
        ))}
      </div>

      {selected ? (
        <section className="operational-decision-card">
          <div className="review-card-heading">
            <div><span>Final gateway-pass authorization</span><h3>{selected.passNumber}</h3><p>{selected.department || "No department"} · {selected.movementType}</p></div>
            <span className="status-pill">{selected.status || "Pending Approval"}</span>
          </div>

          <div className="review-facts approver-facts">
            <div><span>Utility / Facility Head</span><strong>{selected.facilityManagerName || "—"}</strong></div>
            <div><span>Origin</span><strong>{selected.originLocation || "—"}</strong></div>
            <div><span>Destination</span><strong>{selected.destination || "—"}</strong></div>
            <div><span>Movement date</span><strong>{dateText(selected.expectedMovementDate)}</strong></div>
            <div><span>Expected return</span><strong>{dateText(selected.expectedReturnDate)}</strong></div>
            <div><span>Vehicle</span><strong>{selected.vehicleNumber || "—"}</strong></div>
            <div><span>Driver</span><strong>{selected.driverName || "—"}</strong><small>{selected.driverPhone || ""}</small></div>
            <div><span>Receiver</span><strong>{selected.receiverName || "—"}</strong><small>{selected.receiverOrganization || ""}</small></div>
          </div>

          <div className="gateway-purpose-card"><Truck size={17} /><div><strong>Purpose of movement</strong><span>{selected.purpose}</span></div></div>
          <div className="procurement-review-note"><ShieldCheck size={17} /><div><strong>Procurement Manager review</strong><span>{selected.procurementReviewNote || "No procurement review note was recorded."}</span><small>{selected.reviewedAt ? `Reviewed ${dateText(selected.reviewedAt)}` : "Submitted for final approval"}</small></div></div>

          <div className="operational-detail-section">
            <div className="operational-section-title"><Truck size={16} /><div><strong>Items authorized for movement</strong><span>{selected.items.length} item{selected.items.length === 1 ? "" : "s"}</span></div></div>
            {selected.items.length ? (
              <div className="table-wrap"><table className="data-table compact-approval-table"><thead><tr><th>Item</th><th>Qty</th><th>Condition</th><th>Asset / Serial</th><th>Fragility</th><th>Est. value</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id}><td><strong>{item.description}</strong><small>{item.category || item.colour || "—"}</small></td><td>{item.quantity} {item.unitOfMeasure}</td><td>{item.qualityCondition}</td><td>{item.assetTag || item.serialNumber || "—"}</td><td>{item.fragilityStatus}</td><td className="amount-cell">{money(item.estimatedValue)}</td></tr>)}</tbody></table></div>
            ) : <div className="empty-state compact-empty">No gateway-pass items are attached.</div>}
          </div>

          <label className="review-note approver-note"><span>Approval note / rejection or return reason</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval. Required for rejection or return." /></label>
          <DecisionMessage message={message} />
          <div className="approver-actions">
            <button type="button" className="approver-action approve" disabled={Boolean(busy)} onClick={() => decide("approve")}><CheckCircle2 size={16} />{busy === "approve" ? "Approving…" : "Approve & Return for Generation"}</button>
            <button type="button" className="approver-action return" disabled={Boolean(busy)} onClick={() => decide("return")}><CornerUpLeft size={16} />{busy === "return" ? "Returning…" : "Return for Correction"}</button>
            <button type="button" className="approver-action reject" disabled={Boolean(busy)} onClick={() => decide("reject")}><XCircle size={16} />{busy === "reject" ? "Rejecting…" : "Reject Gateway Pass"}</button>
          </div>
          <div className="review-security-note"><ShieldCheck size={15} /><span>Final approval routes the gateway pass back to the Utility / Facility Head for preview, generation and download, matching the production command chain.</span></div>
        </section>
      ) : null}
    </div>
  );
}

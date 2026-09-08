"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Plus, ReceiptText, Send, Trash2, WalletCards, XCircle } from "lucide-react";
import { requestConfirmation } from "@/components/in-app-confirmation";

type CandidateRequest = {
  id: number;
  request_no: string;
  department_project: string | null;
  category: string | null;
  estimated_amount: number;
  status: string | null;
  linked_po_id: number | null;
};

type BatchItem = {
  requestId: number;
  requestNo: string;
  departmentProject: string | null;
  category: string | null;
  spendDate: string;
  amount: number;
  reason: string;
  receiptNo: string;
  note: string;
  paymentMethod: string;
  proofs: File[];
};

type ProofRow = { proof_index: number; has_proof: boolean; file_name: string | null };
type BatchItemRow = {
  request_id: number;
  request_no: string;
  department_project: string | null;
  category: string | null;
  spend_date: string;
  amount: number;
  reason: string;
  receipt_no: string | null;
  note: string | null;
  payment_method: string;
  proofs: ProofRow[];
};

type BatchRow = {
  id: number;
  expense_no: string;
  expense_date: string;
  amount: number;
  status: string;
  description: string;
  created_at: string;
  claimant_name?: string;
  claimant_role?: string;
  items: BatchItemRow[];
};

type Payload = {
  currentRole: string;
  routeDestination: string;
  candidates: CandidateRequest[];
  reimbursements: BatchRow[];
  reviewQueue: BatchRow[];
};

const CASH_LIMIT = 5000;
const MAX_PROOFS_PER_ITEM = 8;
const MAX_BATCH_PROOF_BYTES = 2_500_000;
const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Card/POS", "Other"];

function money(value: unknown) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
async function portableFile(file: File) {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read a supporting receipt/proof file."));
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type || "application/octet-stream", base64 };
}

export function ReimbursementWorkspaceV3() {
  const [data, setData] = useState<Payload>({ currentRole: "", routeDestination: "Procurement Manager", candidates: [], reimbursements: [], reviewQueue: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [requestId, setRequestId] = useState("");
  const [spendDate, setSpendDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [itemNote, setItemNote] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [proofs, setProofs] = useState<File[]>([]);
  const [items, setItems] = useState<BatchItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/reimbursements", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to load reimbursement records.");
      setData({ currentRole: payload.currentRole || "", routeDestination: payload.routeDestination || "Procurement Manager", candidates: payload.candidates || [], reimbursements: payload.reimbursements || [], reviewQueue: payload.reviewQueue || [] });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to load reimbursement records." });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => data.candidates.find((row) => row.id === Number(requestId)) || null, [data.candidates, requestId]);
  const destination = data.routeDestination || (data.currentRole === "Procurement Manager" ? "Finance" : "Procurement Manager");
  const total = useMemo(() => items.reduce((sum, item) => sum + item.amount, 0), [items]);
  const cashTotal = useMemo(() => items.filter((item) => item.paymentMethod === "Cash").reduce((sum, item) => sum + item.amount, 0), [items]);
  const selectedProofBytes = useMemo(() => proofs.reduce((sum, file) => sum + file.size, 0), [proofs]);
  const storedProofBytes = useMemo(() => items.reduce((sum, item) => sum + item.proofs.reduce((inner, file) => inner + file.size, 0), 0), [items]);

  function addItem() {
    const numericAmount = Number(amount || 0);
    if (!selected) { setMessage({ type: "error", text: "Choose the purchase request this reimbursement item belongs to." }); return; }
    if (!(numericAmount > 0)) { setMessage({ type: "error", text: "Enter the amount you personally spent for this item." }); return; }
    if (reason.trim().length < 4) { setMessage({ type: "error", text: "Explain what your personal funds were used for." }); return; }
    if (!proofs.length) { setMessage({ type: "error", text: "Attach at least one receipt or proof of payment for this reimbursement item." }); return; }
    if (proofs.length > MAX_PROOFS_PER_ITEM) { setMessage({ type: "error", text: `Attach no more than ${MAX_PROOFS_PER_ITEM} receipts/proofs to one reimbursement item.` }); return; }
    if (storedProofBytes + selectedProofBytes > MAX_BATCH_PROOF_BYTES) { setMessage({ type: "error", text: "The combined receipt/proof files for one reimbursement batch must stay below 2.5 MB." }); return; }
    if (paymentMethod === "Cash" && numericAmount > CASH_LIMIT) { setMessage({ type: "error", text: `A cash reimbursement cannot exceed ${money(CASH_LIMIT)}.` }); return; }
    if (paymentMethod === "Cash" && cashTotal + numericAmount > CASH_LIMIT) { setMessage({ type: "error", text: `The total cash portion of one reimbursement batch cannot exceed ${money(CASH_LIMIT)}.` }); return; }

    setItems((current) => [...current, {
      requestId: selected.id,
      requestNo: selected.request_no,
      departmentProject: selected.department_project,
      category: selected.category,
      spendDate,
      amount: numericAmount,
      reason: reason.trim(),
      receiptNo: receiptNo.trim(),
      note: itemNote.trim(),
      paymentMethod,
      proofs,
    }]);
    setAmount(""); setReason(""); setReceiptNo(""); setItemNote(""); setProofs([]); setMessage(null);
  }

  async function submitBatch() {
    if (!items.length) { setMessage({ type: "error", text: "Add at least one reimbursement item before submitting." }); return; }
    if (cashTotal > CASH_LIMIT) { setMessage({ type: "error", text: `The total cash portion of this batch exceeds the ${money(CASH_LIMIT)} cash reimbursement limit.` }); return; }
    const confirmed = await requestConfirmation({
      eyebrow: "REIMBURSEMENT BATCH",
      title: `Submit ${items.length} reimbursement item${items.length === 1 ? "" : "s"} as one request?`,
      description: `You are declaring personal expenditure totalling ${money(total)}${cashTotal ? `, including ${money(cashTotal)} cash` : ""}.`,
      reference: `${items.length} item${items.length === 1 ? "" : "s"} · ${money(total)}`,
      detail: data.currentRole === "Procurement Manager" ? "This Procurement reimbursement batch will go directly to Finance." : "This reimbursement batch will go to Procurement Manager first. If accepted, the entire batch is forwarded to Finance as one total.",
      confirmLabel: `Submit to ${destination}`,
      tone: "primary",
    });
    if (!confirmed) return;

    setBusy(true); setMessage(null);
    try {
      const portableItems = await Promise.all(items.map(async (item) => ({
        requestId: item.requestId,
        spendDate: item.spendDate,
        amount: item.amount,
        reason: item.reason,
        receiptNo: item.receiptNo,
        note: item.note,
        paymentMethod: item.paymentMethod,
        files: await Promise.all(item.proofs.map(portableFile)),
      })));
      const response = await fetch("/api/reimbursements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: portableItems, batchNote: batchNote.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit reimbursement batch.");
      setMessage({ type: "success", text: `${payload?.result?.reimbursementNo || "Reimbursement batch"} for ${money(payload?.result?.totalAmount || total)} was submitted to ${payload?.result?.destination || destination}.` });
      setItems([]); setBatchNote(""); setRequestId(""); setAmount(""); setReason(""); setReceiptNo(""); setItemNote(""); setProofs([]); setPaymentMethod("Bank Transfer");
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit reimbursement batch." });
    } finally { setBusy(false); }
  }

  async function review(batch: BatchRow, decision: "forward" | "reject") {
    const reviewNote = (reviewNotes[batch.id] || "").trim();
    if (decision === "reject" && reviewNote.length < 4) { setMessage({ type: "error", text: `Enter a rejection reason for ${batch.expense_no}.` }); return; }
    const confirmed = await requestConfirmation({
      eyebrow: "PROCUREMENT REIMBURSEMENT REVIEW",
      title: decision === "forward" ? "Forward this reimbursement batch to Finance?" : "Reject this reimbursement batch?",
      description: `${batch.expense_no} contains ${batch.items.length} item${batch.items.length === 1 ? "" : "s"} totalling ${money(batch.amount)}.`,
      reference: batch.expense_no,
      detail: decision === "forward" ? "All items and all attached receipts/proofs in this batch will move to Finance together." : "The entire batch will be rejected and the claimant will be notified.",
      confirmLabel: decision === "forward" ? "Forward Batch to Finance" : "Reject Batch",
      tone: decision === "forward" ? "primary" : "danger",
    });
    if (!confirmed) return;
    setReviewBusy(`${decision}-${batch.id}`); setMessage(null);
    try {
      const response = await fetch("/api/reimbursements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reimbursementId: batch.id, decision, note: reviewNote }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to review reimbursement batch.");
      setMessage({ type: "success", text: `${payload?.result?.reimbursementNo || batch.expense_no} is now ${payload?.result?.status || "updated"}.` });
      setReviewNotes((current) => ({ ...current, [batch.id]: "" }));
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to review reimbursement batch." });
    } finally { setReviewBusy(null); }
  }

  function BatchItems({ batch }: { batch: BatchRow }) {
    return <div className="reimbursement-batch-items"><div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Request</th><th>Spent</th><th>Method</th><th>Description</th><th>Amount</th><th>Receipt(s) / proof</th></tr></thead><tbody>{batch.items.map((item, index) => <tr key={`${batch.id}-${index}`}><td><strong>{item.request_no}</strong><small>{item.department_project || item.category || ""}</small></td><td>{dateText(item.spend_date)}</td><td>{item.payment_method || "—"}</td><td>{item.reason}<small>{item.receipt_no || item.note || ""}</small></td><td>{money(item.amount)}</td><td>{item.proofs?.length ? <div className="table-actions">{item.proofs.map((proof) => proof.has_proof ? <a key={proof.proof_index} className="table-action-link" href={`/api/reimbursements/proof?id=${batch.id}&item=${index}&proof=${proof.proof_index}`}><Download size={13}/>{proof.file_name || `Proof ${proof.proof_index + 1}`}</a> : null)}</div> : "—"}</td></tr>)}</tbody></table></div></div>;
  }

  return <div className="parity-stack reimbursement-workspace reimbursement-batch-workspace">
    <section className="parity-form-card reimbursement-form-card">
      <div className="parity-card-title"><WalletCards size={19}/><div><strong>Request Reimbursement</strong><span>Add one or more personal-funds expenses, attach one or more receipts/proofs to each item, then submit everything as one reimbursement total.</span></div></div>
      <div className="parity-info reimbursement-info"><ReceiptText size={17}/><div><strong>Routing: {destination}</strong><span>{data.currentRole === "Procurement Manager" ? "Procurement reimbursement batches go directly to Finance." : "Every other role submits to Procurement Manager first; accepted batches move to Finance."}</span></div></div>

      <div className="parity-form-grid reimbursement-item-builder">
        <label className="wide"><span>Related purchase request</span><select value={requestId} onChange={(event) => setRequestId(event.target.value)}><option value="">Select a request…</option>{data.candidates.map((row) => <option key={row.id} value={row.id}>{row.request_no} — {row.status || "Current"} — {money(row.estimated_amount)}</option>)}</select><small>The same request may be used for more than one reimbursement item in the same batch.</small></label>
        <label><span>Date personal funds were spent</span><input type="date" value={spendDate} onChange={(event) => setSpendDate(event.target.value)}/></label>
        <label><span>Amount</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00"/></label>
        <label><span>Payment method</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select><small>{paymentMethod === "Cash" ? `Cash reimbursement is capped at ${money(CASH_LIMIT)} per batch.` : "Choose how the personal expense was paid."}</small></label>
        <label><span>Receipt / reference number</span><input value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} placeholder="Optional reference"/></label>
        <label className="wide"><span>What did you pay for?</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe this particular personal-funds expense."/></label>
        <label className="wide"><span>Receipts / proof of payment</span><input type="file" multiple accept="image/*,.pdf" onChange={(event) => setProofs(Array.from(event.target.files || []))}/><small>Select up to {MAX_PROOFS_PER_ITEM} files at once. Combined files for the full batch must stay below 2.5 MB.</small>{proofs.length ? <small><strong>{proofs.length} file(s) selected:</strong> {proofs.map((file) => file.name).join(", ")}</small> : null}</label>
        <label className="wide"><span>Item note</span><textarea rows={2} value={itemNote} onChange={(event) => setItemNote(event.target.value)} placeholder="Optional context for this reimbursement item."/></label>
      </div>
      {selected ? <div className="reimbursement-request-summary"><div><span>Request</span><strong>{selected.request_no}</strong></div><div><span>Department / Project</span><strong>{selected.department_project || "—"}</strong></div><div><span>Category</span><strong>{selected.category || "—"}</strong></div><div><span>Current status</span><strong>{selected.status || "—"}</strong></div><div><span>Original request amount</span><strong>{money(selected.estimated_amount)}</strong></div></div> : null}
      <button type="button" className="reimbursement-add-item" disabled={loading || !data.candidates.length} onClick={addItem}><Plus size={15}/>Add Reimbursement Item</button>

      <div className="reimbursement-batch-cart">
        <div className="parity-section-head"><div><h3>Reimbursement items</h3><p>These items will be submitted together under one reimbursement reference.</p></div><span>{items.length} item(s)</span></div>
        {items.length ? <div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>Request</th><th>Spent</th><th>Method</th><th>Description</th><th>Proofs</th><th>Amount</th><th></th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.requestId}-${index}`}><td><strong>{item.requestNo}</strong><small>{item.departmentProject || item.category || ""}</small></td><td>{dateText(item.spendDate)}</td><td>{item.paymentMethod}</td><td>{item.reason}<small>{item.receiptNo || item.note || ""}</small></td><td>{item.proofs.length} file(s)<small>{item.proofs.map((file) => file.name).join(", ")}</small></td><td>{money(item.amount)}</td><td><button type="button" className="draft-delete-button compact" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={13}/>Remove</button></td></tr>)}</tbody></table></div> : <div className="empty-state compact">No reimbursement items have been added yet.</div>}
        <div className="reimbursement-batch-total"><span>Cash portion {money(cashTotal)} / {money(CASH_LIMIT)} max</span><span>Batch total</span><strong>{money(total)}</strong></div>
        <label className="reimbursement-batch-note"><span>Batch note</span><textarea rows={2} value={batchNote} onChange={(event) => setBatchNote(event.target.value)} placeholder={`Optional note covering the complete reimbursement request to ${destination}.`}/></label>
        <button type="button" className="parity-primary reimbursement-submit" disabled={busy || loading || !items.length} onClick={() => void submitBatch()}><Send size={15}/>{busy ? "Submitting…" : `Submit ${items.length || ""} Item${items.length === 1 ? "" : "s"} to ${destination}`}</button>
      </div>
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    </section>

    {data.currentRole === "Procurement Manager" ? <section>
      <div className="parity-section-head"><div><h3>Reimbursement Review Queue</h3><p>Claims from other roles stop here for Procurement review before Finance. Every receipt/proof attached to each item is available for review.</p></div><span>{data.reviewQueue.length} waiting</span></div>
      {loading ? <div className="empty-state compact">Loading reimbursement review queue…</div> : data.reviewQueue.length ? <div className="reimbursement-batch-list">{data.reviewQueue.map((batch) => <article key={batch.id} className="reimbursement-batch-card"><div className="reimbursement-batch-head"><div><strong>{batch.expense_no}</strong><span>{batch.claimant_name || "Claimant"} · {batch.claimant_role || ""}</span><small>{dateText(batch.created_at)} · {batch.items.length} item(s)</small></div><div><b>{money(batch.amount)}</b><span>{batch.status}</span></div></div><BatchItems batch={batch}/><div className="reimbursement-review-controls"><input value={reviewNotes[batch.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [batch.id]: event.target.value }))} placeholder="Procurement review note"/><button type="button" className="parity-primary" disabled={reviewBusy !== null} onClick={() => void review(batch, "forward")}><CheckCircle2 size={13}/>Forward to Finance</button><button type="button" className="parity-danger" disabled={reviewBusy !== null} onClick={() => void review(batch, "reject")}><XCircle size={13}/>Reject Batch</button></div></article>)}</div> : <div className="empty-state">No reimbursement requests are waiting for Procurement review.</div>}
    </section> : null}

    <section>
      <div className="parity-section-head"><div><h3>My Reimbursement Requests</h3><p>Track each batch and download the receipts/proofs you submitted.</p></div><span>{data.reimbursements.length} record(s)</span></div>
      {loading ? <div className="empty-state compact">Loading reimbursement records…</div> : data.reimbursements.length ? <div className="reimbursement-batch-list">{data.reimbursements.map((batch) => <article key={batch.id} className="reimbursement-batch-card"><div className="reimbursement-batch-head"><div><strong>{batch.expense_no}</strong><span>{dateText(batch.created_at)} · {batch.items.length} item(s)</span></div><div><b>{money(batch.amount)}</b><span>{batch.status}</span></div></div><BatchItems batch={batch}/></article>)}</div> : <div className="empty-state">You have not submitted a reimbursement request yet.</div>}
    </section>
  </div>;
}

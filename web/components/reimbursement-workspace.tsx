"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, ReceiptText, Send, WalletCards, XCircle } from "lucide-react";
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

type ReimbursementRow = {
  id: number;
  expense_no: string;
  expense_date: string;
  amount: number;
  status: string;
  description: string;
  receipt_no: string | null;
  created_at: string;
  request_id: number;
  request_no: string;
  department_project: string | null;
  category: string | null;
  has_proof: boolean;
};

type ReviewRow = ReimbursementRow & {
  claimant_name: string;
  claimant_role: string;
  assigned_procurement_manager_id: number | null;
};

type Payload = {
  currentRole: string;
  routeDestination: string;
  candidates: CandidateRequest[];
  reimbursements: ReimbursementRow[];
  reviewQueue: ReviewRow[];
};

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
    reader.onerror = () => reject(new Error("Unable to read the supporting proof."));
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type || "application/octet-stream", base64 };
}

export function ReimbursementWorkspace() {
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
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/reimbursements", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to load reimbursement records.");
      setData({
        currentRole: payload.currentRole || "",
        routeDestination: payload.routeDestination || "Procurement Manager",
        candidates: payload.candidates || [],
        reimbursements: payload.reimbursements || [],
        reviewQueue: payload.reviewQueue || [],
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to load reimbursement records." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => data.candidates.find((row) => row.id === Number(requestId)) || null, [data.candidates, requestId]);
  const destination = data.routeDestination || (data.currentRole === "Procurement Manager" ? "Finance" : "Procurement Manager");

  async function submit() {
    const numericAmount = Number(amount || 0);
    if (!selected) { setMessage({ type: "error", text: "Choose the purchase request this reimbursement belongs to." }); return; }
    if (!(numericAmount > 0)) { setMessage({ type: "error", text: "Enter the amount you personally spent." }); return; }
    if (reason.trim().length < 4) { setMessage({ type: "error", text: "Explain what your personal funds were used for." }); return; }
    if (!proof) { setMessage({ type: "error", text: "Attach the receipt or other proof of the personal expenditure." }); return; }

    const confirmed = await requestConfirmation({
      eyebrow: "REIMBURSEMENT REQUEST",
      title: "Submit this personal-funds reimbursement?",
      description: `You are declaring that you personally spent ${money(numericAmount)} to support ${selected.request_no}.`,
      reference: selected.request_no,
      detail: data.currentRole === "Procurement Manager"
        ? "Because this claim is being raised by Procurement, it will go directly to Finance for review."
        : "This claim will go to Procurement Manager first. After Procurement review, an accepted claim is forwarded to Finance.",
      confirmLabel: `Submit to ${destination}`,
      tone: "primary",
    });
    if (!confirmed) return;

    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/reimbursements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: selected.id,
          spendDate,
          amount: numericAmount,
          reason: reason.trim(),
          receiptNo: receiptNo.trim(),
          note: note.trim(),
          file: await portableFile(proof),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit reimbursement request.");
      setMessage({ type: "success", text: `${payload?.result?.reimbursementNo || "Reimbursement"} was submitted to ${payload?.result?.destination || destination}.` });
      setRequestId(""); setAmount(""); setReason(""); setReceiptNo(""); setNote(""); setProof(null);
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit reimbursement request." });
    } finally {
      setBusy(false);
    }
  }

  async function review(row: ReviewRow, decision: "forward" | "reject") {
    const reviewNote = (reviewNotes[row.id] || "").trim();
    if (decision === "reject" && reviewNote.length < 4) {
      setMessage({ type: "error", text: `Enter a rejection reason for ${row.expense_no}.` });
      return;
    }
    const confirmed = await requestConfirmation({
      eyebrow: "PROCUREMENT REIMBURSEMENT REVIEW",
      title: decision === "forward" ? "Forward this reimbursement to Finance?" : "Reject this reimbursement request?",
      description: `${row.expense_no} was submitted by ${row.claimant_name} (${row.claimant_role}) for ${row.request_no}.`,
      reference: row.expense_no,
      detail: decision === "forward"
        ? "The reimbursement evidence will move to Finance for the next review stage."
        : "The claimant will be notified that Procurement rejected this reimbursement request.",
      confirmLabel: decision === "forward" ? "Forward to Finance" : "Reject Reimbursement",
      tone: decision === "forward" ? "primary" : "danger",
    });
    if (!confirmed) return;

    setReviewBusy(`${decision}-${row.id}`); setMessage(null);
    try {
      const response = await fetch("/api/reimbursements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reimbursementId: row.id, decision, note: reviewNote }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to review reimbursement request.");
      setMessage({ type: "success", text: `${payload?.result?.reimbursementNo || row.expense_no} is now ${payload?.result?.status || "updated"}.` });
      setReviewNotes((current) => ({ ...current, [row.id]: "" }));
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to review reimbursement request." });
    } finally {
      setReviewBusy(null);
    }
  }

  return <div className="parity-stack reimbursement-workspace">
    <section className="parity-form-card reimbursement-form-card">
      <div className="parity-card-title"><WalletCards size={19}/><div><strong>Request Reimbursement</strong><span>Use this when you personally paid for goods, services or an urgent requirement connected to an existing ProcureFlow request.</span></div></div>
      <div className="parity-info reimbursement-info"><ReceiptText size={17}/><div><strong>Routing: {destination}</strong><span>{data.currentRole === "Procurement Manager" ? "Procurement Manager reimbursement requests go directly to Finance." : "All non-Procurement reimbursement requests go to Procurement Manager first, then accepted claims move to Finance."}</span></div></div>
      <div className="parity-form-grid">
        <label className="wide"><span>Related purchase request</span><select value={requestId} onChange={(event) => setRequestId(event.target.value)}><option value="">Select a request…</option>{data.candidates.map((row) => <option key={row.id} value={row.id}>{row.request_no} — {row.status || "Current"} — {money(row.estimated_amount)}</option>)}</select><small>Only approved or later-stage requests available for reimbursement are listed.</small></label>
        <label><span>Date personal funds were spent</span><input type="date" value={spendDate} onChange={(event) => setSpendDate(event.target.value)}/></label>
        <label><span>Amount to reimburse</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00"/></label>
        <label className="wide"><span>What did you pay for?</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the item, service, emergency purchase or other cost you personally covered for this request."/></label>
        <label><span>Receipt / reference number</span><input value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} placeholder="Optional reference"/></label>
        <label><span>Receipt or proof</span><input type="file" accept="image/*,.pdf" onChange={(event) => setProof(event.target.files?.[0] || null)}/><small>PDF or image, maximum 3 MB.</small></label>
        <label className="wide"><span>Additional note</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={`Optional context for ${destination}.`}/></label>
      </div>
      {selected ? <div className="reimbursement-request-summary"><div><span>Request</span><strong>{selected.request_no}</strong></div><div><span>Department / Project</span><strong>{selected.department_project || "—"}</strong></div><div><span>Category</span><strong>{selected.category || "—"}</strong></div><div><span>Current status</span><strong>{selected.status || "—"}</strong></div><div><span>Original request amount</span><strong>{money(selected.estimated_amount)}</strong></div></div> : null}
      <button type="button" className="parity-primary reimbursement-submit" disabled={busy || loading || !data.candidates.length} onClick={() => void submit()}><Send size={15}/>{busy ? "Submitting…" : `Submit to ${destination}`}</button>
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    </section>

    {data.currentRole === "Procurement Manager" ? <section>
      <div className="parity-section-head"><div><h3>Reimbursement Review Queue</h3><p>Claims from every other role stop here for Procurement review before Finance.</p></div><span>{data.reviewQueue.length} waiting</span></div>
      {loading ? <div className="empty-state compact">Loading reimbursement review queue…</div> : data.reviewQueue.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Reimbursement</th><th>Claimant</th><th>Request</th><th>Spent</th><th>Amount</th><th>Reason</th><th>Proof</th><th>Review note</th><th>Action</th></tr></thead><tbody>{data.reviewQueue.map((row) => <tr key={row.id}><td><strong>{row.expense_no}</strong><small>{row.receipt_no || "No receipt reference"}</small></td><td><strong>{row.claimant_name}</strong><small>{row.claimant_role}</small></td><td><strong>{row.request_no}</strong><small>{row.department_project || row.category || ""}</small></td><td>{dateText(row.expense_date)}</td><td>{money(row.amount)}</td><td>{row.description}</td><td>{row.has_proof ? <a className="table-action-link" href={`/api/reimbursements/proof?id=${row.id}`}><Download size={13}/>Download</a> : "—"}</td><td><input value={reviewNotes[row.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Review note"/></td><td><div className="table-actions"><button type="button" className="parity-primary" disabled={reviewBusy !== null} onClick={() => void review(row, "forward")}><CheckCircle2 size={13}/>Forward to Finance</button><button type="button" className="parity-danger" disabled={reviewBusy !== null} onClick={() => void review(row, "reject")}><XCircle size={13}/>Reject</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state">No reimbursement requests are waiting for Procurement review.</div>}
    </section> : null}

    <section>
      <div className="parity-section-head"><div><h3>My Reimbursement Requests</h3><p>Track your personal-funds claims through Procurement and Finance review.</p></div><span>{data.reimbursements.length} record(s)</span></div>
      {loading ? <div className="empty-state compact">Loading reimbursement records…</div> : data.reimbursements.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Reimbursement</th><th>Request</th><th>Spent</th><th>Amount</th><th>Reason</th><th>Status</th><th>Proof</th><th>Submitted</th></tr></thead><tbody>{data.reimbursements.map((row) => <tr key={row.id}><td><strong>{row.expense_no}</strong><small>{row.receipt_no || "No receipt reference"}</small></td><td><strong>{row.request_no}</strong><small>{row.department_project || row.category || ""}</small></td><td>{dateText(row.expense_date)}</td><td>{money(row.amount)}</td><td>{row.description}</td><td><span className="status-chip">{row.status || "Pending Review"}</span></td><td>{row.has_proof ? <a className="table-action-link" href={`/api/reimbursements/proof?id=${row.id}`}><Download size={13}/>Download</a> : "—"}</td><td>{dateText(row.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state">You have not submitted a reimbursement request yet.</div>}
    </section>
  </div>;
}

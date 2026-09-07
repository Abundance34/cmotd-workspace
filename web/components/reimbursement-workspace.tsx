"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ReceiptText, Send, WalletCards } from "lucide-react";
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

type Payload = {
  candidates: CandidateRequest[];
  reimbursements: ReimbursementRow[];
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
  const [data, setData] = useState<Payload>({ candidates: [], reimbursements: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
      setData({ candidates: payload.candidates || [], reimbursements: payload.reimbursements || [] });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to load reimbursement records." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => data.candidates.find((row) => row.id === Number(requestId)) || null, [data.candidates, requestId]);

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
      detail: "Finance will receive the claim, the supporting proof and the linked purchase request for review. The reimbursement does not alter the original procurement amount or approval history.",
      confirmLabel: "Submit Reimbursement",
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
      setMessage({ type: "success", text: `${payload?.result?.reimbursementNo || "Reimbursement"} was submitted to Finance for review.` });
      setRequestId(""); setAmount(""); setReason(""); setReceiptNo(""); setNote(""); setProof(null);
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit reimbursement request." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="parity-stack reimbursement-workspace">
    <section className="parity-form-card reimbursement-form-card">
      <div className="parity-card-title"><WalletCards size={19}/><div><strong>Request Reimbursement</strong><span>Use this only when you personally paid for goods, services or an urgent requirement connected to an existing ProcureFlow request.</span></div></div>
      <div className="parity-info reimbursement-info"><ReceiptText size={17}/><div><strong>Supporting proof is required</strong><span>The claim stays linked to the original request and is sent to Finance as a separate reimbursement record. It does not replace the original request, vendor payment or audit trail.</span></div></div>
      <div className="parity-form-grid">
        <label className="wide"><span>Related purchase request</span><select value={requestId} onChange={(event) => setRequestId(event.target.value)}><option value="">Select a request…</option>{data.candidates.map((row) => <option key={row.id} value={row.id}>{row.request_no} — {row.status || "Current"} — {money(row.estimated_amount)}</option>)}</select><small>Only eligible requests visible to your account are listed.</small></label>
        <label><span>Date personal funds were spent</span><input type="date" value={spendDate} onChange={(event) => setSpendDate(event.target.value)}/></label>
        <label><span>Amount to reimburse</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00"/></label>
        <label className="wide"><span>What did you pay for?</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the item, service, emergency purchase or other cost you personally covered for this request."/></label>
        <label><span>Receipt / reference number</span><input value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} placeholder="Optional reference"/></label>
        <label><span>Receipt or proof</span><input type="file" accept="image/*,.pdf" onChange={(event) => setProof(event.target.files?.[0] || null)}/><small>PDF or image, maximum 3 MB.</small></label>
        <label className="wide"><span>Additional note</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context for Finance."/></label>
      </div>
      {selected ? <div className="reimbursement-request-summary"><div><span>Request</span><strong>{selected.request_no}</strong></div><div><span>Department / Project</span><strong>{selected.department_project || "—"}</strong></div><div><span>Category</span><strong>{selected.category || "—"}</strong></div><div><span>Current status</span><strong>{selected.status || "—"}</strong></div><div><span>Original request amount</span><strong>{money(selected.estimated_amount)}</strong></div></div> : null}
      <button type="button" className="parity-primary reimbursement-submit" disabled={busy || loading || !data.candidates.length} onClick={() => void submit()}><Send size={15}/>{busy ? "Submitting…" : "Submit Reimbursement"}</button>
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    </section>

    <section>
      <div className="parity-section-head"><div><h3>My Reimbursement Requests</h3><p>Track every personal-funds claim you submitted and the Finance review status.</p></div><span>{data.reimbursements.length} record(s)</span></div>
      {loading ? <div className="empty-state compact">Loading reimbursement records…</div> : data.reimbursements.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Reimbursement</th><th>Request</th><th>Spent</th><th>Amount</th><th>Reason</th><th>Status</th><th>Proof</th><th>Submitted</th></tr></thead><tbody>{data.reimbursements.map((row) => <tr key={row.id}><td><strong>{row.expense_no}</strong><small>{row.receipt_no || "No receipt reference"}</small></td><td><strong>{row.request_no}</strong><small>{row.department_project || row.category || ""}</small></td><td>{dateText(row.expense_date)}</td><td>{money(row.amount)}</td><td>{row.description}</td><td><span className="status-chip">{row.status || "Pending Finance Review"}</span></td><td>{row.has_proof ? <a className="table-action-link" href={`/api/reimbursements/proof?id=${row.id}`}><Download size={13}/>Download</a> : "—"}</td><td>{dateText(row.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state">You have not submitted a reimbursement request yet.</div>}
    </section>
  </div>;
}

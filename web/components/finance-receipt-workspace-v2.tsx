"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Paperclip, ReceiptText, Upload } from "lucide-react";

function money(value: unknown, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-NG")}`;
  }
}
function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
async function filePayload(file: File) {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type || "application/octet-stream", base64 };
}

const initial = {
  receiptNo: "",
  documentType: "Payment Receipt",
  paymentMethod: "Bank Transfer",
  paymentDate: new Date().toISOString().slice(0, 10),
  amount: "",
  currency: "NGN",
  requestId: "",
  paymentId: "",
  poId: "",
  vendorId: "",
  payerName: "",
  payeeName: "",
  purpose: "",
  departmentProject: "",
  transferReference: "",
  note: "",
};

export function FinanceReceiptWorkspaceV2({ data, receiptRows = [] }: { data: any; receiptRows?: any[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "attachment">("manual");
  const [form, setForm] = useState(initial);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const payments = data?.reconciliation || [];
  const paidPayments = useMemo(
    () => payments.filter((row: any) => String(row.payment_status || row.status || "").toLowerCase() === "paid"),
    [payments],
  );
  const requests = data?.requests || [];
  const purchaseOrders = data?.purchaseOrders || [];
  const vendors = data?.vendors || [];
  const receiptSupport = useMemo(
    () => (data?.documents || []).filter((doc: any) => String(doc.document_type || "") === "Receipt Supporting Document"),
    [data?.documents],
  );
  const selectedPaidPayment = useMemo(
    () => paidPayments.find((row: any) => String(row.id) === form.paymentId) || null,
    [paidPayments, form.paymentId],
  );
  const selectedRequest = useMemo(
    () => requests.find((row: any) => String(row.id) === String(form.requestId || selectedPaidPayment?.request_id || "")) || null,
    [requests, form.requestId, selectedPaidPayment],
  );

  function setField(key: keyof typeof initial, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    let preferredPaymentId = "";
    let preferredRequestId = "";
    try {
      preferredPaymentId = sessionStorage.getItem("procureflow:receipt-payment-id") || "";
      preferredRequestId = sessionStorage.getItem("procureflow:receipt-request-id") || "";
    } catch {}

    const preferred = paidPayments.find((row: any) =>
      (preferredPaymentId && String(row.id) === preferredPaymentId)
      || (preferredRequestId && String(row.request_id || "") === preferredRequestId),
    );
    if (preferred) {
      choosePayment(String(preferred.id));
      try {
        sessionStorage.removeItem("procureflow:receipt-payment-id");
        sessionStorage.removeItem("procureflow:receipt-request-id");
      } catch {}
    }
  }, [paidPayments]);

  function choosePayment(value: string) {
    const payment = payments.find((row: any) => String(row.id) === value);
    if (!payment) {
      setField("paymentId", value);
      return;
    }
    const linkedRequest = requests.find((row: any) => String(row.id) === String(payment.request_id || ""));
    setForm((current) => ({
      ...current,
      paymentId: String(payment.id),
      requestId: payment.request_id ? String(payment.request_id) : current.requestId,
      poId: payment.po_id ? String(payment.po_id) : current.poId,
      vendorId: payment.vendor_id ? String(payment.vendor_id) : current.vendorId,
      amount: String(Number(payment.amount || 0) || ""),
      currency: payment.currency || current.currency,
      paymentDate: payment.payment_date ? String(payment.payment_date).slice(0, 10) : current.paymentDate,
      transferReference: payment.payment_reference || current.transferReference,
      paymentMethod: payment.transfer_type || payment.payment_method || current.paymentMethod,
      payeeName: payment.recipient_name || payment.vendor_name || current.payeeName,
      purpose: linkedRequest?.justification || current.purpose,
      departmentProject: linkedRequest?.department_project || current.departmentProject,
    }));
  }

  async function submit() {
    if (!form.paymentId) {
      setMessage({ type: "error", text: "Choose the paid request this receipt belongs to." });
      return;
    }
    if (mode === "attachment" && !receiptFile) {
      setMessage({ type: "error", text: "Choose the receipt file you want to attach." });
      return;
    }
    if (mode === "manual" && Number(form.amount || 0) <= 0) {
      setMessage({ type: "error", text: "Enter the receipt amount for manual receipt entry." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const [file, support] = await Promise.all([
        receiptFile ? filePayload(receiptFile) : Promise.resolve(null),
        Promise.all(supportingFiles.map(filePayload)),
      ]);
      const response = await fetch("/api/finance/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...form, file, supportingFiles: support }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to record receipt.");
      setMessage({ type: "success", text: `${payload.result?.receiptNo || "Receipt"} recorded successfully${support.length ? ` with ${support.length} supporting document(s)` : ""}.` });
      setForm(initial);
      setReceiptFile(null);
      setSupportingFiles([]);
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to record receipt." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="parity-stack finance-receipt-v2">
      <div className="panel">
        <div className="panel-heading">
          <div><h2>Record receipt / proof of payment</h2><p>Select a paid request first. Manual entry can be saved without a file. Upload Receipt Only can be saved without completing the manual receipt fields.</p></div>
          <span className="status-pill">Finance evidence</span>
        </div>

        <div className="receipt-mode-toggle" role="group" aria-label="Receipt entry method">
          <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}><ReceiptText size={16}/> Manual Receipt — no file required</button>
          <button type="button" className={mode === "attachment" ? "active" : ""} onClick={() => setMode("attachment")}><Upload size={16}/> Upload Receipt Only</button>
        </div>

        <div className="review-form receipt-link-grid">
          <label className="paid-request-picker"><span>Paid request</span><select value={form.paymentId} onChange={(event) => choosePayment(event.target.value)}><option value="">Select paid request…</option>{paidPayments.map((row: any) => <option key={row.id} value={row.id}>{row.request_no || row.payment_no} — {money(row.amount, row.currency || "NGN")} — {row.payment_no}</option>)}</select><small>{paidPayments.length} paid request(s) available for receipt entry.</small></label>
          <label><span>Purchase request</span><select value={form.requestId} onChange={(event) => setField("requestId", event.target.value)}><option value="">Select request…</option>{requests.map((row: any) => <option key={row.id} value={row.id}>{row.request_no} — {row.department_project || "No department"}</option>)}</select></label>
          <label><span>Link PO (optional)</span><select value={form.poId} onChange={(event) => setField("poId", event.target.value)}><option value="">No PO selected</option>{purchaseOrders.map((row: any) => <option key={row.id} value={row.id}>{row.po_no} — {row.vendor_name || "Vendor pending"}</option>)}</select></label>
          <label><span>Vendor (optional)</span><select value={form.vendorId} onChange={(event) => setField("vendorId", event.target.value)}><option value="">No vendor selected</option>{vendors.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        </div>

        {selectedPaidPayment ? (
          <div className="receipt-paid-context">
            <div><span>Paid request</span><strong>{selectedPaidPayment.request_no || selectedPaidPayment.payment_no}</strong></div>
            <div><span>Amount paid</span><strong>{money(selectedPaidPayment.amount, selectedPaidPayment.currency || "NGN")}</strong></div>
            <div className="wide"><span>Business justification</span><p>{selectedRequest?.justification || "No business justification was recorded for this request."}</p></div>
          </div>
        ) : null}

        {mode === "manual" ? (
          <div className="review-form receipt-manual-grid">
            <label><span>Receipt number</span><input value={form.receiptNo} onChange={(event) => setField("receiptNo", event.target.value)} placeholder="Leave blank to auto-generate"/></label>
            <label><span>Receipt type</span><select value={form.documentType} onChange={(event) => setField("documentType", event.target.value)}><option>Payment Receipt</option><option>Proof of Payment</option><option>Vendor Receipt</option><option>Cash Receipt</option><option>POS Receipt</option><option>Other</option></select></label>
            <label><span>Payment method</span><select value={form.paymentMethod} onChange={(event) => setField("paymentMethod", event.target.value)}><option>Bank Transfer</option><option>Internet Bank Transfer</option><option>Physical Bank Transfer</option><option>Cash</option><option>Card/POS</option><option>Cheque</option><option>Other</option></select></label>
            <label><span>Payment date</span><input type="date" value={form.paymentDate} onChange={(event) => setField("paymentDate", event.target.value)}/></label>
            <label><span>Amount</span><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setField("amount", event.target.value)} placeholder="0.00"/></label>
            <label><span>Currency</span><input value={form.currency} onChange={(event) => setField("currency", event.target.value.toUpperCase())}/></label>
            <label><span>Payer name</span><input value={form.payerName} onChange={(event) => setField("payerName", event.target.value)}/></label>
            <label><span>Payee name</span><input value={form.payeeName} onChange={(event) => setField("payeeName", event.target.value)}/></label>
            <label><span>Transfer / transaction reference</span><input value={form.transferReference} onChange={(event) => setField("transferReference", event.target.value)}/></label>
            <label><span>Department / Project</span><input value={form.departmentProject} onChange={(event) => setField("departmentProject", event.target.value)}/></label>
            <label className="wide"><span>Purpose</span><input value={form.purpose} onChange={(event) => setField("purpose", event.target.value)}/></label>
            <label className="wide"><span>Finance note</span><textarea rows={3} value={form.note} onChange={(event) => setField("note", event.target.value)}/></label>
          </div>
        ) : (
          <div className="receipt-attachment-note"><FilePlus2 size={18}/><div><strong>Upload receipt only</strong><span>No manual receipt fields are required. Choose the paid request above and attach the receipt/proof file; ProcureFlow uses the linked payment amount, date, reference and request context automatically.</span></div></div>
        )}

        <div className="receipt-file-grid">
          <label className="receipt-file-box"><span>{mode === "attachment" ? "Receipt / proof file (required)" : "Receipt / proof file (optional)"}</span><input type="file" accept="image/*,.pdf" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}/><small>{receiptFile ? receiptFile.name : "PDF or image, up to 3 MB"}</small></label>
          <label className="receipt-file-box"><span><Paperclip size={14}/> Supporting documents (optional)</span><input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => setSupportingFiles(Array.from(event.target.files || []).slice(0, 8))}/><small>{supportingFiles.length ? `${supportingFiles.length} file(s) selected` : "Up to 8 files, each below 3 MB"}</small></label>
        </div>

        {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
        <button type="button" className="primary-action" disabled={busy} onClick={() => void submit()}>{busy ? "Saving receipt…" : "Save Receipt"}</button>
      </div>

      <div className="panel">
        <div className="panel-heading"><div><h2>Receipt register</h2><p>Manual and uploaded receipt records are kept in one Finance evidence register.</p></div><span className="status-pill">{receiptRows.length} records</span></div>
        {receiptRows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Type</th><th>Payment method</th><th>Request</th><th>Payment</th><th>Payee / Vendor</th><th>Amount</th><th>Status</th><th>Primary file</th><th>Date</th></tr></thead><tbody>{receiptRows.map((row: any) => <tr key={row.id}><td><strong>{row.receiptNo || row.receipt_no}</strong></td><td>{row.receiptType || row.receipt_type || "—"}</td><td>{row.paymentMethod || row.payment_method || "—"}</td><td>{row.requestNo || row.request_no || "—"}</td><td>{row.linkedPaymentNo || row.linked_payment_no || "—"}</td><td>{row.payeeName || row.payee_name || row.vendorName || row.vendor_name || "—"}</td><td>{money(row.amount, row.currency || "NGN")}</td><td>{row.status || "—"}</td><td>{row.originalFileName || row.original_file_name || "Manual entry"}</td><td>{dateText(row.createdAt || row.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state">No receipt has been recorded yet.</div>}
      </div>

      {receiptSupport.length ? <div className="panel"><div className="panel-heading"><div><h2>Receipt supporting documents</h2><p>Optional evidence attached alongside receipt records.</p></div><span className="status-pill">{receiptSupport.length} files</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Document</th><th>Department / Project</th><th>Linked request</th><th>Status</th><th>Date</th></tr></thead><tbody>{receiptSupport.map((doc: any) => <tr key={`${doc.source_type}-${doc.id}`}><td><strong>{doc.title || doc.file_name}</strong><small>{doc.file_name}</small></td><td>{doc.department_project || "—"}</td><td>{doc.entity_id ? `#${doc.entity_id}` : "—"}</td><td>{doc.status || "Imported"}</td><td>{dateText(doc.created_at)}</td></tr>)}</tbody></table></div></div> : null}
    </div>
  );
}

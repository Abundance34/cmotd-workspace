"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, FileText, Paperclip, ShieldCheck, Trash2, Upload, X } from "lucide-react";

const CATEGORIES = [
  "Diesel/Fuel", "Water", "Office Supplies", "Repairs/Maintenance", "Vehicle Maintenance",
  "Generator Maintenance", "Plumbing", "Welding/Fabrication", "Grass Cutting", "Transport/Logistics",
  "Staff Welfare", "ICT/Software", "Utilities", "Construction Materials", "Professional Services",
  "Operational Purchases", "Other",
];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const PAYEE_TYPES = ["Vendor", "Individual", "Organisation", "Government Agency", "Other"];
const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "Other"];
const MAX_FILE_BYTES = 3_000_000;
const MAX_FILES = 8;

type DraftLine = {
  key: number;
  itemName: string;
  description: string;
  quantity: string;
  unitPrice: string;
  category: string;
  suggestedVendor: string;
};

type CreatedDraft = {
  requestId: number;
  requestNo: string;
  payee?: { duplicateWarning?: boolean };
};

function nextRequiredDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function newLine(key: number, category = CATEGORIES[0]): DraftLine {
  return { key, itemName: "", description: "", quantity: "1", unitPrice: "0", category, suggestedVendor: "" };
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value || 0);
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
}

export function FacilityDraftForm() {
  const router = useRouter();
  const [departmentProject, setDepartmentProject] = useState("");
  const [requiredDate, setRequiredDate] = useState(nextRequiredDate);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState("Normal");
  const [vendorPreference, setVendorPreference] = useState("");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newLine(1)]);
  const [lineKey, setLineKey] = useState(2);

  const [recipientKnown, setRecipientKnown] = useState(false);
  const [payeeType, setPayeeType] = useState("Vendor");
  const [payeeName, setPayeeName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [paymentReference, setPaymentReference] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [delayedReason, setDelayedReason] = useState("");

  const [attachments, setAttachments] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const estimatedAmount = useMemo(
    () => lines.reduce((sum, line) => {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return sum;
      return sum + Math.max(0, quantity) * Math.max(0, unitPrice);
    }, 0),
    [lines],
  );
  const attachmentBytes = useMemo(() => attachments.reduce((sum, file) => sum + file.size, 0), [attachments]);

  function updateLine(key: number, field: keyof Omit<DraftLine, "key">, value: string) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  }
  function addLine() {
    setLines((current) => [...current, newLine(lineKey, category)]);
    setLineKey((current) => current + 1);
  }
  function removeLine(key: number) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.key !== key));
  }
  function addAttachments(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const oversized = incoming.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setMessage({ type: "error", text: `${oversized.name} exceeds the 3 MB per-file upload limit.` });
      setFileInputKey((value) => value + 1);
      return;
    }
    setAttachments((current) => {
      const unique = [...current];
      for (const file of incoming) {
        if (unique.length >= MAX_FILES) break;
        const duplicate = unique.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
        if (!duplicate) unique.push(file);
      }
      return unique;
    });
    setFileInputKey((value) => value + 1);
  }
  function resetForm() {
    setDepartmentProject(""); setRequiredDate(nextRequiredDate()); setCategory(CATEGORIES[0]); setPriority("Normal");
    setVendorPreference(""); setJustification(""); setLines([newLine(1)]); setLineKey(2);
    setRecipientKnown(false); setPayeeType("Vendor"); setPayeeName(""); setAccountName(""); setBankName("");
    setAccountNumber(""); setCurrency("NGN"); setPaymentReference(""); setContactEmail(""); setContactPhone("");
    setConfirmation(false); setDelayedReason(""); setAttachments([]); setFileInputKey((value) => value + 1);
  }

  async function uploadAttachment(draft: CreatedDraft, file: File) {
    const base64 = await fileToBase64(file);
    const response = await fetch("/api/facility/requests/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: draft.requestId,
        documentType: "Supporting Document",
        title: file.name,
        note: "Supporting document attached during Utility / Facility draft creation.",
        file: { fileName: file.name, mimeType: file.type || "application/octet-stream", base64 },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Unable to upload ${file.name}.`);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const usefulLines = lines.filter((line) => line.itemName.trim());
    if (!departmentProject.trim()) return setMessage({ type: "error", text: "Department / Project is required." });
    if (!justification.trim()) return setMessage({ type: "error", text: "Business justification is required." });
    if (!usefulLines.length) return setMessage({ type: "error", text: "Add at least one line item." });
    if (!recipientKnown && !delayedReason.trim()) return setMessage({ type: "error", text: "Give a reason for delayed payee details." });
    if (attachments.length > MAX_FILES) return setMessage({ type: "error", text: `Attach no more than ${MAX_FILES} files to one draft.` });
    const oversized = attachments.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) return setMessage({ type: "error", text: `${oversized.name} exceeds the 3 MB per-file upload limit.` });

    setBusy(true);
    setProgress("Creating draft…");
    try {
      const response = await fetch("/api/facility/requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentProject, requiredDate, category, priority, vendorPreference, justification,
          items: usefulLines.map((line) => ({
            itemName: line.itemName, description: line.description || line.itemName,
            quantity: Number(line.quantity), unitPrice: Number(line.unitPrice),
            category: line.category || category, suggestedVendor: line.suggestedVendor || vendorPreference,
          })),
          payee: { recipientKnown, payeeType, payeeName, accountName, bankName, accountNumber, currency,
            paymentReference, contactEmail, contactPhone, confirmation, delayedReason },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to create draft request.");
      const draft = payload?.result as CreatedDraft;
      if (!draft?.requestId || !draft?.requestNo) throw new Error("The draft was created but its reference could not be confirmed.");

      const failed: string[] = [];
      for (let index = 0; index < attachments.length; index += 1) {
        const file = attachments[index];
        setProgress(`Uploading supporting document ${index + 1} of ${attachments.length}: ${file.name}`);
        try { await uploadAttachment(draft, file); }
        catch { failed.push(file.name); }
      }

      const duplicateWarning = Boolean(draft.payee?.duplicateWarning);
      const attachmentText = attachments.length
        ? failed.length
          ? ` ${attachments.length - failed.length} of ${attachments.length} supporting documents were attached. Re-upload the failed file${failed.length === 1 ? "" : "s"} from Import Documents: ${failed.join(", ")}.`
          : ` ${attachments.length} supporting document${attachments.length === 1 ? "" : "s"} attached successfully.`
        : " Supporting documents were optional and none were attached.";
      const payeeText = duplicateWarning ? " Finance should verify the payee carefully because its account fingerprint matches historical data." : "";
      setMessage({ type: failed.length ? "error" : "success", text: `${draft.requestNo} was created successfully.${attachmentText}${payeeText}` });
      resetForm();
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to create draft request." });
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <article className="panel facility-draft-panel">
      <div className="panel-heading"><div><h2>Create Utility / Facility Draft</h2><p>Create a draft, capture line items, payment-recipient readiness and supporting evidence, then review it before sending it to Procurement.</p></div><span className="status-pill">Neon write workflow</span></div>
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
      {progress ? <div className="action-message success">{progress}</div> : null}

      <form className="facility-draft-form" onSubmit={submit}>
        <section className="form-section">
          <div className="form-section-title"><span>1</span><div><strong>Request information</strong><small>Core information used by the procurement workflow.</small></div></div>
          <div className="form-grid form-grid-3">
            <label><span>Department / Project *</span><input value={departmentProject} onChange={(e) => setDepartmentProject(e.target.value)} placeholder="e.g. Operations / Jetty Maintenance" maxLength={250} /></label>
            <label><span>Required date *</span><input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></label>
            <label><span>Category *</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Priority *</span><select value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="form-span-2"><span>Vendor preference</span><input value={vendorPreference} onChange={(e) => setVendorPreference(e.target.value)} placeholder="Optional preferred vendor or supplier" maxLength={500} /></label>
          </div>
          <label className="form-block"><span>Business justification *</span><textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Explain why this procurement is required." rows={4} maxLength={4000} /></label>
        </section>

        <section className="form-section">
          <div className="form-section-heading"><div className="form-section-title"><span>2</span><div><strong>Line items</strong><small>Quantity × unit price determines the estimated request value.</small></div></div><button type="button" className="secondary-form-button" onClick={addLine}><CirclePlus size={15} /> Add line item</button></div>
          <div className="draft-lines">{lines.map((line, index) => (
            <div className="draft-line" key={line.key}>
              <div className="draft-line-heading"><strong>Item {index + 1}</strong><button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => removeLine(line.key)} disabled={lines.length === 1}><Trash2 size={15} /></button></div>
              <div className="form-grid form-grid-line">
                <label className="line-item-name"><span>Item / Service *</span><input value={line.itemName} onChange={(e) => updateLine(line.key, "itemName", e.target.value)} placeholder="Item or service description" /></label>
                <label><span>Quantity *</span><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(line.key, "quantity", e.target.value)} /></label>
                <label><span>Unit price (NGN) *</span><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(line.key, "unitPrice", e.target.value)} /></label>
                <label><span>Line total</span><input value={money(Number(line.quantity || 0) * Number(line.unitPrice || 0))} readOnly /></label>
                <label><span>Category</span><select value={line.category} onChange={(e) => updateLine(line.key, "category", e.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span>Suggested vendor</span><input value={line.suggestedVendor} onChange={(e) => updateLine(line.key, "suggestedVendor", e.target.value)} placeholder="Optional" /></label>
                <label className="form-span-2"><span>Additional description</span><input value={line.description} onChange={(e) => updateLine(line.key, "description", e.target.value)} placeholder="Optional specification, model, size or scope" /></label>
              </div>
            </div>
          ))}</div>
          <div className="draft-total"><span>Estimated draft value</span><strong>{money(estimatedAmount)}</strong></div>
        </section>

        <section className="form-section">
          <div className="form-section-title"><span>3</span><div><strong>Payment recipient readiness</strong><small>Full bank details are encrypted before storage. Audit records receive masked values only.</small></div></div>
          <div className="recipient-choice">
            <label className={!recipientKnown ? "selected" : ""}><input type="radio" checked={!recipientKnown} onChange={() => setRecipientKnown(false)} /><span><strong>Not known yet</strong><small>Confirm after sourcing or vendor selection.</small></span></label>
            <label className={recipientKnown ? "selected" : ""}><input type="radio" checked={recipientKnown} onChange={() => setRecipientKnown(true)} /><span><strong>Recipient known</strong><small>Capture authorized payment details now.</small></span></label>
          </div>
          {recipientKnown ? (
            <div className="form-grid form-grid-3 payee-fields">
              <label><span>Payee type *</span><select value={payeeType} onChange={(e) => setPayeeType(e.target.value)}>{PAYEE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>Payee full / legal name *</span><input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} /></label>
              <label><span>Account name *</span><input value={accountName} onChange={(e) => setAccountName(e.target.value)} /></label>
              <label><span>Bank name *</span><input value={bankName} onChange={(e) => setBankName(e.target.value)} /></label>
              <label><span>Account number *</span><input inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\s+/g, ""))} maxLength={18} /></label>
              <label><span>Currency *</span><select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>Payment reference / purpose</span><input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} /></label>
              <label><span>Payee email</span><input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></label>
              <label><span>Payee phone</span><input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></label>
              <label className="confirmation-check form-span-3"><input type="checkbox" checked={confirmation} onChange={(e) => setConfirmation(e.target.checked)} /><span>I confirm that these payment details were obtained from an authorized source.</span></label>
            </div>
          ) : <label className="form-block payee-delayed"><span>Reason for delayed payee details *</span><textarea value={delayedReason} onChange={(e) => setDelayedReason(e.target.value)} rows={3} placeholder="Example: Vendor will be selected after Procurement completes sourcing." /></label>}
        </section>

        <section className="form-section" style={{ border: "1px solid #cfe0f5", background: "#f8fbff" }}>
          <div className="form-section-title"><span>4</span><div><strong>Supporting documents</strong><small>Optional evidence is stored in the GCP-free Neon document register and linked to this draft.</small></div></div>
          <label className="form-block" style={{ marginTop: 14 }}>
            <span>Attach supporting files</span>
            <input key={fileInputKey} type="file" multiple disabled={busy || attachments.length >= MAX_FILES} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp" onChange={(e) => addAttachments(e.target.files)} />
            <small>Up to {MAX_FILES} files · maximum 3 MB each. PDF, Office documents, spreadsheets, text and common image formats are accepted.</small>
          </label>
          {attachments.length ? (
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {attachments.map((file, index) => <div key={`${file.name}-${file.lastModified}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", border: "1px solid #dbe5f1", borderRadius: 10, background: "white" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}><Paperclip size={15} /><div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</strong><small>{file.type || "File"} · {fileSize(file.size)}</small></div></div>
                <button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 6 }}><X size={16} /></button>
              </div>)}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}><span>{attachments.length} selected</span><span>{fileSize(attachmentBytes)} total</span></div>
            </div>
          ) : <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "#64748b", fontSize: 12 }}><Upload size={15} /><span>Supporting documents are optional.</span></div>}
        </section>

        <div className="draft-submit-row">
          <div className="security-write-note"><ShieldCheck size={17} /><span>Protected by the active v2 audit and payee encryption keys. Uploaded files receive SHA-256 checksums.</span></div>
          <button className="primary-form-button" type="submit" disabled={busy}><FileText size={15} />{busy ? "Creating…" : "Create Utility / Facility Draft"}</button>
        </div>
      </form>
    </article>
  );
}

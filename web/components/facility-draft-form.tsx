"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, FileText, ShieldCheck, Trash2 } from "lucide-react";

const CATEGORIES = [
  "Diesel/Fuel",
  "Water",
  "Office Supplies",
  "Repairs/Maintenance",
  "Vehicle Maintenance",
  "Generator Maintenance",
  "Plumbing",
  "Welding/Fabrication",
  "Grass Cutting",
  "Transport/Logistics",
  "Staff Welfare",
  "ICT/Software",
  "Utilities",
  "Construction Materials",
  "Professional Services",
  "Operational Purchases",
  "Other",
];

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const PAYEE_TYPES = ["Vendor", "Individual", "Organisation", "Government Agency", "Other"];
const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "Other"];

type DraftLine = {
  key: number;
  itemName: string;
  description: string;
  quantity: string;
  unitPrice: string;
  category: string;
  suggestedVendor: string;
};

function nextRequiredDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function newLine(key: number, category = CATEGORIES[0]): DraftLine {
  return {
    key,
    itemName: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
    category,
    suggestedVendor: "",
  };
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
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

  const [busy, setBusy] = useState(false);
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

  function resetForm() {
    setDepartmentProject("");
    setRequiredDate(nextRequiredDate());
    setCategory(CATEGORIES[0]);
    setPriority("Normal");
    setVendorPreference("");
    setJustification("");
    setLines([newLine(1)]);
    setLineKey(2);
    setRecipientKnown(false);
    setPayeeType("Vendor");
    setPayeeName("");
    setAccountName("");
    setBankName("");
    setAccountNumber("");
    setCurrency("NGN");
    setPaymentReference("");
    setContactEmail("");
    setContactPhone("");
    setConfirmation(false);
    setDelayedReason("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const usefulLines = lines.filter((line) => line.itemName.trim());
    if (!departmentProject.trim()) {
      setMessage({ type: "error", text: "Department / Project is required." });
      return;
    }
    if (!justification.trim()) {
      setMessage({ type: "error", text: "Business justification is required." });
      return;
    }
    if (!usefulLines.length) {
      setMessage({ type: "error", text: "Add at least one line item." });
      return;
    }
    if (!recipientKnown && !delayedReason.trim()) {
      setMessage({ type: "error", text: "Give a reason for delayed payee details." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/facility/requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentProject,
          requiredDate,
          category,
          priority,
          vendorPreference,
          justification,
          items: usefulLines.map((line) => ({
            itemName: line.itemName,
            description: line.description || line.itemName,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            category: line.category || category,
            suggestedVendor: line.suggestedVendor || vendorPreference,
          })),
          payee: {
            recipientKnown,
            payeeType,
            payeeName,
            accountName,
            bankName,
            accountNumber,
            currency,
            paymentReference,
            contactEmail,
            contactPhone,
            confirmation,
            delayedReason,
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to create draft request.");

      const requestNo = String(payload?.result?.requestNo || "Draft");
      const duplicateWarning = Boolean(payload?.result?.payee?.duplicateWarning);
      setMessage({
        type: "success",
        text: duplicateWarning
          ? `${requestNo} was created successfully. The payee account matched another historical fingerprint, so Finance should verify it carefully.`
          : `${requestNo} was created successfully and is now available under My Draft Requests.`,
      });
      resetForm();
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to create draft request." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel facility-draft-panel">
      <div className="panel-heading">
        <div>
          <h2>Create Utility / Facility Draft</h2>
          <p>Create a draft, capture line items and payment-recipient readiness, then review it before sending it to Procurement.</p>
        </div>
        <span className="status-pill">Neon write workflow</span>
      </div>

      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}

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
          <div className="form-section-heading">
            <div className="form-section-title"><span>2</span><div><strong>Line items</strong><small>Quantity × unit price determines the estimated request value.</small></div></div>
            <button type="button" className="secondary-form-button" onClick={addLine}><CirclePlus size={15} /> Add line item</button>
          </div>

          <div className="draft-lines">
            {lines.map((line, index) => (
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
            ))}
          </div>

          <div className="draft-total"><span>Estimated draft value</span><strong>{money(estimatedAmount)}</strong></div>
        </section>

        <section className="form-section">
          <div className="form-section-title"><span>3</span><div><strong>Payment recipient readiness</strong><small>Full bank details are encrypted before storage. Audit records receive masked values only.</small></div></div>
          <div className="recipient-choice">
            <label className={!recipientKnown ? "selected" : ""}><input type="radio" checked={!recipientKnown} onChange={() => setRecipientKnown(false)} /> <span><strong>Not known yet</strong><small>Confirm after sourcing or vendor selection.</small></span></label>
            <label className={recipientKnown ? "selected" : ""}><input type="radio" checked={recipientKnown} onChange={() => setRecipientKnown(true)} /> <span><strong>Recipient known</strong><small>Capture authorized payment details now.</small></span></label>
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
          ) : (
            <label className="form-block payee-delayed"><span>Reason for delayed payee details *</span><textarea value={delayedReason} onChange={(e) => setDelayedReason(e.target.value)} rows={3} placeholder="Example: Vendor will be selected after Procurement completes sourcing." /></label>
          )}
        </section>

        <section className="form-section storage-note">
          <FileText size={18} />
          <div><strong>Supporting documents</strong><span>Document upload storage is being ported separately so no new GCP dependency is introduced. You can create the draft now and attachments will be enabled once the GCP-free storage layer is connected.</span></div>
        </section>

        <div className="draft-submit-row">
          <div className="security-write-note"><ShieldCheck size={17} /><span>Protected by the active v2 audit and payee encryption keys.</span></div>
          <button className="primary-form-button" type="submit" disabled={busy}>{busy ? "Creating draft…" : "Create Utility / Facility Draft"}</button>
        </div>
      </form>
    </article>
  );
}

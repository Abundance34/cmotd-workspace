"use client";

import { useEffect, useMemo, useState } from "react";
import { CirclePlus, Landmark, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { requestConfirmation } from "@/components/in-app-confirmation";

const CATEGORIES = ["General", "ICT/Software", "Equipment", "Maintenance", "Services", "Consumables", "Logistics", "Training"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

type Item = { itemName: string; description: string; itemCategory: string; suggestedVendor: string; quantity: string; unitPrice: string };
const blankItem = (): Item => ({ itemName: "", description: "", itemCategory: "", suggestedVendor: "", quantity: "1", unitPrice: "" });

function dateInput(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}
function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value || 0);
}

export function RequestDraftEditor({ detail, onSaved, onCancel }: { detail: any; onSaved: () => void | Promise<void>; onCancel: () => void }) {
  const request = detail?.request || {};
  const [departments, setDepartments] = useState<string[]>([]);
  const [departmentProject, setDepartmentProject] = useState(String(request.department_project || ""));
  const [requiredDate, setRequiredDate] = useState(dateInput(request.required_date));
  const [category, setCategory] = useState(String(request.category || "General"));
  const [priority, setPriority] = useState(String(request.priority || "Normal"));
  const [vendorPreference, setVendorPreference] = useState(String(request.vendor_preference || ""));
  const [justification, setJustification] = useState(String(request.justification || ""));
  const [items, setItems] = useState<Item[]>(() => (detail?.items || []).map((item: any) => ({
    itemName: String(item.item_name || ""), description: String(item.description || ""), itemCategory: String(item.category || ""), suggestedVendor: String(item.suggested_vendor || ""), quantity: String(item.quantity ?? 1), unitPrice: String(item.unit_price ?? ""),
  })) || [blankItem()]);
  const [replacePayee, setReplacePayee] = useState(false);
  const [recipientKnown, setRecipientKnown] = useState(Boolean(detail?.payee?.recipient_known));
  const [payeeType, setPayeeType] = useState(String(detail?.payee?.payee_type || "Vendor / Supplier"));
  const [payeeName, setPayeeName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState(String(detail?.payee?.currency || "NGN"));
  const [paymentReference, setPaymentReference] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [delayedReason, setDelayedReason] = useState("Payment recipient details will be supplied before payment processing.");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/facility/reference-data", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (active && Array.isArray(payload?.departments)) setDepartments(payload.departments.map(String)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const estimatedAmount = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0), [items]);
  function patchItem(index: number, patch: Partial<Item>) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }

  async function save() {
    const confirmed = await requestConfirmation({
      eyebrow: "EDIT REQUEST DRAFT",
      title: "Save these draft changes?",
      description: replacePayee
        ? `${request.request_no} will be updated and the current payment/account details will be replaced by a new encrypted version.`
        : `${request.request_no} will be updated while the current payment/account details remain unchanged.`,
      reference: request.request_no,
      detail: replacePayee ? "Previous account details remain preserved in immutable payee-version history; only the new masked record becomes current." : undefined,
      confirmLabel: "Save Draft Changes",
      tone: "primary",
    });
    if (!confirmed) return;

    setBusy(true); setMessage(null);
    try {
      const payee = replacePayee ? { recipientKnown, payeeType, payeeName, accountName, bankName, accountNumber, currency, paymentReference, contactEmail, contactPhone, confirmation, delayedReason } : undefined;
      const response = await fetch(`/api/requests/drafts/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentProject, requiredDate, category, priority, vendorPreference, justification,
          items: items.map((item) => ({ ...item, quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0) })),
          ...(payee ? { payee } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to update this request draft.");
      setMessage({ type: "success", text: `${payload?.result?.requestNo || request.request_no} was updated successfully.${replacePayee ? " The new payment details are now the encrypted current version." : ""}` });
      await onSaved();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to update this request draft." });
    } finally { setBusy(false); }
  }

  return <section className="draft-editor">
    <div className="draft-editor-head"><div><span>EDIT DRAFT</span><h3>{request.request_no}</h3><p>Only draft or returned requests created by your account can be edited.</p></div><button type="button" onClick={onCancel} aria-label="Close draft editor"><X size={18}/></button></div>
    <div className="authoring-grid">
      <label><span>Department / Project *</span>{departments.length ? <select value={departmentProject} onChange={(event) => setDepartmentProject(event.target.value)}>{departments.map((item) => <option key={item}>{item}</option>)}</select> : <input value={departmentProject} onChange={(event) => setDepartmentProject(event.target.value)} />}</label>
      <label><span>Required date *</span><input type="date" value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} /></label>
      <label><span>Category *</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{Array.from(new Set([...CATEGORIES, category])).map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Priority *</span><select value={priority} onChange={(event) => setPriority(event.target.value)}>{Array.from(new Set([...PRIORITIES, priority])).map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="wide"><span>Preferred vendor / sourcing context</span><input value={vendorPreference} onChange={(event) => setVendorPreference(event.target.value)} /></label>
      <label className="wide"><span>Business justification *</span><textarea rows={4} value={justification} onChange={(event) => setJustification(event.target.value)} /></label>
    </div>

    <div className="draft-editor-section"><div className="draft-editor-section-title"><div><strong>Line items</strong><span>The request estimate recalculates from these lines.</span></div><b>{money(estimatedAmount)}</b></div>
      {items.map((item, index) => <article className="authoring-line" key={index}><div className="authoring-line-head"><strong>Item {index + 1}</strong>{items.length > 1 ? <button type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14}/>Remove</button> : null}</div><div className="authoring-grid">
        <label><span>Item / service *</span><input value={item.itemName} onChange={(event) => patchItem(index, { itemName: event.target.value })} /></label>
        <label><span>Item category</span><input value={item.itemCategory} onChange={(event) => patchItem(index, { itemCategory: event.target.value })} /></label>
        <label><span>Quantity *</span><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => patchItem(index, { quantity: event.target.value })} /></label>
        <label><span>Unit price *</span><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => patchItem(index, { unitPrice: event.target.value })} /></label>
        <label className="wide"><span>Description</span><textarea rows={2} value={item.description} onChange={(event) => patchItem(index, { description: event.target.value })} /></label>
        <label className="wide"><span>Suggested vendor</span><input value={item.suggestedVendor} onChange={(event) => patchItem(index, { suggestedVendor: event.target.value })} /></label>
      </div></article>)}
      <button type="button" className="authoring-secondary" onClick={() => setItems((current) => [...current, blankItem()])}><CirclePlus size={15}/>Add another item</button>
    </div>

    <div className="draft-editor-section"><div className="draft-editor-section-title"><div><strong>Payment recipient / account details</strong><span>Current values stay masked. Choose replacement only when account details genuinely need to change.</span></div><Landmark size={18}/></div>
      <div className="current-payee-strip"><span>Current payee <b>{detail?.payee?.payee_name_masked || "Pending"}</b></span><span>Bank <b>{detail?.payee?.bank_name_masked || "Pending"}</b></span><span>Account <b>{detail?.payee?.account_number_masked || "Pending"}</b></span><span>Verification <b>{detail?.payee?.verification_status || "Pending"}</b></span></div>
      <label className="authoring-check"><input type="checkbox" checked={replacePayee} onChange={(event) => { setReplacePayee(event.target.checked); setConfirmation(false); }} /><span>Replace the current payment/account details with a new encrypted version.</span></label>
      {replacePayee ? <><label className="authoring-check"><input type="checkbox" checked={recipientKnown} onChange={(event) => { setRecipientKnown(event.target.checked); setConfirmation(false); }} /><span>The replacement recipient/account details are known now.</span></label>{recipientKnown ? <div className="authoring-grid">
        <label><span>Payee type</span><select value={payeeType} onChange={(event) => setPayeeType(event.target.value)}><option>Vendor / Supplier</option><option>Individual</option><option>Organization</option></select></label>
        <label><span>Payee legal name *</span><input value={payeeName} onChange={(event) => setPayeeName(event.target.value)} /></label>
        <label><span>Account name *</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} /></label>
        <label><span>Bank name *</span><input value={bankName} onChange={(event) => setBankName(event.target.value)} /></label>
        <label><span>Account number *</span><input inputMode="numeric" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
        <label><span>Currency</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>USD</option><option>GBP</option><option>EUR</option></select></label>
        <label><span>Payment reference</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
        <label><span>Contact email</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label>
        <label><span>Contact phone</span><input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
        <label className="authoring-check wide"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /><span>I confirm these replacement account details came from an authorized source.</span></label>
      </div> : <label className="authoring-grid single"><span>Reason replacement details are delayed *</span><textarea rows={3} value={delayedReason} onChange={(event) => setDelayedReason(event.target.value)} /></label>}</> : null}
    </div>

    {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    <div className="draft-editor-actions"><div><ShieldCheck size={15}/><span>Changes are auditable. Replacing account details preserves the previous masked/version history rather than overwriting evidence.</span></div><button type="button" className="authoring-secondary" onClick={onCancel}>Cancel</button><button type="button" className="authoring-primary" disabled={busy} onClick={() => void save()}><Save size={16}/>{busy ? "Saving…" : "Save Changes"}</button></div>
  </section>;
}

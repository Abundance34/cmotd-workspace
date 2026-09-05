"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Landmark, PackagePlus, Save, ShieldCheck, Trash2 } from "lucide-react";

const CATEGORIES = ["General", "ICT/Software", "Equipment", "Maintenance", "Services", "Consumables", "Logistics", "Training"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

type LineItem = { itemName: string; description: string; itemCategory: string; suggestedVendor: string; quantity: string; unitPrice: string };
const blankItem = (): LineItem => ({ itemName: "", description: "", itemCategory: "", suggestedVendor: "", quantity: "1", unitPrice: "" });

function nextRequiredDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value || 0);
}

export function ProcurementDraftForm() {
  const router = useRouter();
  const [departments, setDepartments] = useState<string[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentProject, setDepartmentProject] = useState("");
  const [requiredDate, setRequiredDate] = useState(nextRequiredDate());
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState("Normal");
  const [vendorPreference, setVendorPreference] = useState("");
  const [justification, setJustification] = useState("");
  const [items, setItems] = useState<LineItem[]>([blankItem()]);
  const [recipientKnown, setRecipientKnown] = useState(false);
  const [payeeType, setPayeeType] = useState("Vendor / Supplier");
  const [payeeName, setPayeeName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState("NGN");
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
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Unable to load departments.");
        return Array.isArray(payload?.departments) ? payload.departments.map(String).filter(Boolean) : [];
      })
      .then((options) => {
        if (!active) return;
        setDepartments(options);
        setDepartmentProject(options.includes("General") ? "General" : options[0] || "");
      })
      .catch((error) => { if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to load departments." }); })
      .finally(() => { if (active) setDepartmentsLoading(false); });
    return () => { active = false; };
  }, []);

  const estimatedAmount = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0), [items]);

  function patchItem(index: number, patch: Partial<LineItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function reset() {
    setDepartmentProject(departments.includes("General") ? "General" : departments[0] || "");
    setRequiredDate(nextRequiredDate()); setCategory(CATEGORIES[0]); setPriority("Normal"); setVendorPreference(""); setJustification(""); setItems([blankItem()]);
    setRecipientKnown(false); setPayeeType("Vendor / Supplier"); setPayeeName(""); setAccountName(""); setBankName(""); setAccountNumber(""); setCurrency("NGN"); setPaymentReference(""); setContactEmail(""); setContactPhone(""); setConfirmation(false); setDelayedReason("Payment recipient details will be supplied before payment processing.");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/procurement/requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentProject, requiredDate, category, priority, vendorPreference, justification,
          items: items.map((item) => ({ ...item, quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0) })),
          payee: { recipientKnown, payeeType, payeeName, accountName, bankName, accountNumber, currency, paymentReference, contactEmail, contactPhone, confirmation, delayedReason },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to save Procurement request draft.");
      setMessage({ type: "success", text: `${payload?.result?.requestNo || "Procurement request"} was saved as your draft. It will route directly to Approver / MD when you submit it.` });
      reset();
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to save Procurement request draft." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="procurement-authoring-form" onSubmit={submit}>
      <div className="authoring-route-note"><ShieldCheck size={18}/><div><strong>Procurement-originated request</strong><span>You may create and edit this draft, but you cannot approve your own request. Submission routes directly to Approver / MD regardless of value.</span></div></div>

      <section className="authoring-card">
        <div className="authoring-title"><PackagePlus size={18}/><div><strong>Request information</strong><span>Create a Procurement Manager request using the same controlled request data model as Facility.</span></div></div>
        <div className="authoring-grid">
          <label><span>Department / Project *</span><select value={departmentProject} onChange={(event) => setDepartmentProject(event.target.value)} disabled={departmentsLoading}><option value="" disabled>{departmentsLoading ? "Loading departments…" : "Select department / project"}</option>{departments.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Required date *</span><input type="date" value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} /></label>
          <label><span>Category *</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Priority *</span><select value={priority} onChange={(event) => setPriority(event.target.value)}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="wide"><span>Preferred vendor / sourcing context</span><input value={vendorPreference} onChange={(event) => setVendorPreference(event.target.value)} placeholder="Optional — sourcing and quote controls remain separate" /></label>
          <label className="wide"><span>Business justification *</span><textarea rows={4} value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Explain the business need, purpose and expected outcome." /></label>
        </div>
      </section>

      <section className="authoring-card">
        <div className="authoring-title"><CirclePlus size={18}/><div><strong>Line items</strong><span>Each item retains its own quantity, price, category and suggested vendor.</span></div><b>{money(estimatedAmount)}</b></div>
        <div className="authoring-lines">
          {items.map((item, index) => <article key={index} className="authoring-line">
            <div className="authoring-line-head"><strong>Item {index + 1}</strong>{items.length > 1 ? <button type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14}/>Remove</button> : null}</div>
            <div className="authoring-grid">
              <label><span>Item / service *</span><input value={item.itemName} onChange={(event) => patchItem(index, { itemName: event.target.value })} /></label>
              <label><span>Item category</span><input value={item.itemCategory} onChange={(event) => patchItem(index, { itemCategory: event.target.value })} placeholder={category} /></label>
              <label><span>Quantity *</span><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => patchItem(index, { quantity: event.target.value })} /></label>
              <label><span>Unit price (NGN) *</span><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => patchItem(index, { unitPrice: event.target.value })} /></label>
              <label className="wide"><span>Description</span><textarea rows={2} value={item.description} onChange={(event) => patchItem(index, { description: event.target.value })} /></label>
              <label className="wide"><span>Suggested vendor</span><input value={item.suggestedVendor} onChange={(event) => patchItem(index, { suggestedVendor: event.target.value })} /></label>
            </div>
          </article>)}
        </div>
        <button type="button" className="authoring-secondary" onClick={() => setItems((current) => [...current, blankItem()])}><CirclePlus size={15}/>Add another item</button>
      </section>

      <section className="authoring-card">
        <div className="authoring-title"><Landmark size={18}/><div><strong>Payment recipient / account details</strong><span>Encrypted at rest. Only masked values are shown after saving; Finance performs final verification.</span></div></div>
        <label className="authoring-check"><input type="checkbox" checked={recipientKnown} onChange={(event) => { setRecipientKnown(event.target.checked); setConfirmation(false); }} /><span>Payment recipient and account details are known now.</span></label>
        {recipientKnown ? <div className="authoring-grid">
          <label><span>Payee type</span><select value={payeeType} onChange={(event) => setPayeeType(event.target.value)}><option>Vendor / Supplier</option><option>Individual</option><option>Organization</option></select></label>
          <label><span>Payee legal name *</span><input value={payeeName} onChange={(event) => setPayeeName(event.target.value)} /></label>
          <label><span>Account name *</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} /></label>
          <label><span>Bank name *</span><input value={bankName} onChange={(event) => setBankName(event.target.value)} /></label>
          <label><span>Account number *</span><input inputMode="numeric" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
          <label><span>Currency</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>USD</option><option>GBP</option><option>EUR</option></select></label>
          <label><span>Payment reference</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
          <label><span>Contact email</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label>
          <label><span>Contact phone</span><input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
          <label className="authoring-check wide"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /><span>I confirm these account details came from an authorized source.</span></label>
        </div> : <label className="authoring-grid single"><span>Reason details are delayed *</span><textarea rows={3} value={delayedReason} onChange={(event) => setDelayedReason(event.target.value)} /></label>}
      </section>

      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
      <div className="authoring-submit"><div><ShieldCheck size={16}/><span>Saving creates signed workflow and audit evidence. It does not approve or submit the request.</span></div><button type="submit" disabled={busy || departmentsLoading}><Save size={16}/>{busy ? "Saving Draft…" : "Save Procurement Draft"}</button></div>
    </form>
  );
}

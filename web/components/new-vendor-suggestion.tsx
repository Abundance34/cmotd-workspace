"use client";

import { useState } from "react";
import { Building2, CheckCircle2, Plus, X } from "lucide-react";

type Props = {
  category?: string;
  onVendorAdded?: (name: string) => void;
};

export function NewVendorSuggestion({ category = "Other", onVendorAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [vendorCategory, setVendorCategory] = useState(category || "Other");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function save() {
    if (name.trim().length < 2) {
      setMessage({ type: "error", text: "Enter the vendor or supplier name." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/vendors/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: vendorCategory || category || "Other", email, phone, address }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to add vendor suggestion.");
      const vendorName = String(payload?.result?.name || name.trim());
      onVendorAdded?.(vendorName);
      setMessage({
        type: "success",
        text: payload?.result?.created
          ? `${vendorName} was added as Pending Vetting and selected as the preferred vendor.`
          : `${vendorName} already exists in the vendor register and has been selected.`,
      });
      setName(""); setEmail(""); setPhone(""); setAddress("");
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to add vendor suggestion." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="new-vendor-card">
      <div className="new-vendor-heading">
        <div className="new-vendor-icon"><Building2 size={18}/></div>
        <div><strong>New vendor / supplier</strong><span>Add a vendor that is not yet in ProcureFlow. New entries remain Pending Vetting until Procurement reviews them.</span></div>
        <button type="button" onClick={() => { setOpen((value) => !value); setMessage(null); }} aria-expanded={open}>
          {open ? <><X size={15}/>Close</> : <><Plus size={15}/>Add new vendor</>}
        </button>
      </div>
      {open ? <div className="new-vendor-form">
        <label><span>Vendor / supplier name *</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Registered or trading name"/></label>
        <label><span>Category</span><input value={vendorCategory} onChange={(event) => setVendorCategory(event.target.value)} placeholder={category || "Other"}/></label>
        <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional"/></label>
        <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Optional"/></label>
        <label className="wide"><span>Address</span><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Optional business address"/></label>
        <div className="new-vendor-actions"><small>Bank details are deliberately not collected here. Payment details remain in the protected payee workflow.</small><button type="button" disabled={busy} onClick={() => void save()}><CheckCircle2 size={15}/>{busy ? "Adding…" : "Add vendor"}</button></div>
      </div> : null}
      {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    </section>
  );
}

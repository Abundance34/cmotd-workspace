"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Building2, CheckCircle2, CirclePlus, Pencil, Search, ShieldCheck, Tags, Trash2, UserPlus, XCircle } from "lucide-react";
import type { ProcureFlowRole } from "@/lib/procureflow/roles";
import type { ParityData } from "@/lib/procureflow/parity-data";

function money(value: unknown, currency = "NGN") {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  catch { return currency + " " + Number(value || 0).toLocaleString("en-NG"); }
}
function dateText(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
function Status({ children }: { children: any }) { return <span className="status-chip">{children || "—"}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function Message({ value }: { value: { type: "success" | "error"; text: string } | null }) {
  return value ? <div className={"action-message " + value.type}>{value.text}</div> : null;
}
async function post(action: string, payload: any = {}) {
  const response = await fetch("/api/parity/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to complete vendor action.");
  return body.result;
}
function linksFor(data: ParityData, vendorId: number) {
  return data.vendorCategoryLinks.filter((row: any) => Number(row.vendor_id) === vendorId);
}
function primaryFor(data: ParityData, vendorId: number) {
  const rows = linksFor(data, vendorId);
  return rows.find((row: any) => row.is_primary) || rows[0] || null;
}

function VendorProfile({ vendor, data, role, onEdit, onDelete }: { vendor: any; data: ParityData; role: ProcureFlowRole; onEdit?: () => void; onDelete?: () => void }) {
  const links = linksFor(data, Number(vendor.id));
  const quotes = data.vendorQuotes.filter((row: any) => Number(row.vendor_id) === Number(vendor.id));
  const pos = data.purchaseOrders.filter((row: any) => Number(row.vendor_id) === Number(vendor.id));
  const payments = data.vendorPayments.filter((row: any) => Number(row.vendor_id) === Number(vendor.id));
  const receiving = data.vendorReceiving.filter((row: any) => Number(row.vendor_id) === Number(vendor.id));
  const docs = data.documents.filter((row: any) => row.source_type === "Vendor Document" && Number(row.entity_id) === Number(vendor.id));
  const canManage = ["Procurement Manager", "Admin"].includes(role);
  const router = useRouter();
  const activeOperations = data.vendorOperationalCategories.filter((x: any) => x.status === "Active");
  const activeServices = data.vendorServiceCategories.filter((x: any) => x.status === "Active");
  const [operationId, setOperationId] = useState(String(activeOperations[0]?.id || ""));
  const [serviceId, setServiceId] = useState(String(activeServices[0]?.id || ""));
  const [classBusy, setClassBusy] = useState(false);
  const [classMsg, setClassMsg] = useState<{type:"success"|"error";text:string}|null>(null);
  async function addClassification() {
    if (!operationId || !serviceId) return setClassMsg({ type: "error", text: "Choose both a company operation and service category." });
    setClassBusy(true); setClassMsg(null);
    try { await post("vendor-category-link", { vendorId: vendor.id, operationalCategoryId: Number(operationId), serviceCategoryId: Number(serviceId), isPrimary: links.length === 0 }); setClassMsg({ type: "success", text: "Vendor classification added." }); router.refresh(); }
    catch (e) { setClassMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to add classification." }); }
    finally { setClassBusy(false); }
  }
  async function removeClassification(linkId: number) {
    setClassBusy(true); setClassMsg(null);
    try { await post("vendor-category-unlink", { linkId }); setClassMsg({ type: "success", text: "Vendor classification removed." }); router.refresh(); }
    catch (e) { setClassMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to remove classification." }); }
    finally { setClassBusy(false); }
  }
  const operations = Array.from(new Set(links.map((x: any) => x.operational_category_name))).join(", ") || "Unclassified";
  const services = Array.from(new Set(links.map((x: any) => x.service_category_name))).join(", ") || vendor.category || "Unclassified";

  return <div className="parity-stack">
    <section className="parity-form-card">
      <div className="parity-section-head">
        <div><span>Vendor profile</span><h2>{vendor.name}</h2><p>{vendor.contact_person || "No contact person"} · {vendor.phone || "No phone"} · {vendor.email || "No email"}</p></div>
        <div className="parity-row"><Status>{vendor.status}</Status>{canManage && onEdit ? <button onClick={onEdit}><Pencil size={14}/>Edit</button> : null}{canManage && onDelete ? <button className="parity-danger" onClick={onDelete}><Trash2 size={14}/>Delete / Archive</button> : null}</div>
      </div>
      <div className="review-facts recommendation-facts">
        <div><span>Company operations</span><strong>{operations}</strong></div>
        <div><span>Service categories</span><strong>{services}</strong></div>
        <div><span>Directory rating</span><strong>{Number(vendor.rating || 0).toFixed(1)} / 5</strong></div>
        <div><span>Quotes submitted</span><strong>{Number(vendor.quote_count || 0)}</strong></div>
        <div><span>Jobs / POs awarded</span><strong>{Number(vendor.awarded_orders || 0)}</strong></div>
        <div><span>Completed orders</span><strong>{Number(vendor.completed_orders || 0)}</strong></div>
        <div><span>Total paid spend</span><strong>{role === "Facility Manager" ? "Procurement controlled" : money(vendor.total_spend || 0)}</strong></div>
        <div><span>Average delivery</span><strong>{Number(vendor.average_delivery_time || 0) > 0 ? Number(vendor.average_delivery_time).toFixed(1) + " days" : "No completed delivery data"}</strong></div>
      </div>
      <div className="table-wrap"><table className="data-table"><tbody>
        <tr><th>Address</th><td>{vendor.address || "—"}</td><th>Tax ID</th><td>{role === "Facility Manager" ? "Procurement controlled" : vendor.tax_id || "—"}</td></tr>
        <tr><th>Source</th><td>{vendor.source || "Procurement Direct"}</td><th>Last purchase</th><td>{dateText(vendor.last_purchase_date)}</td></tr>
        <tr><th>Notes</th><td colSpan={3}>{vendor.notes || "—"}</td></tr>
      </tbody></table></div>
    </section>

    <section>
      <div className="parity-section-head"><div><h3>Company operation & service classifications</h3><p>A supplier may support more than one company activity and service combination.</p></div><span>{links.length} classification(s)</span></div>
      {links.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Company operation</th><th>Service category</th><th>Primary</th><th>Added</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{links.map((link: any) => <tr key={link.id}><td>{link.operational_category_name}</td><td>{link.service_category_name}</td><td>{link.is_primary ? "Yes" : "No"}</td><td>{dateText(link.created_at)}</td>{canManage ? <td><button className="parity-danger" disabled={classBusy} onClick={() => void removeClassification(Number(link.id))}>Remove</button></td> : null}</tr>)}</tbody></table></div> : <Empty text="No classification assigned yet."/>}
      {canManage ? <div className="parity-form-card"><div className="parity-section-head"><div><h3>Add another classification</h3><p>Use this when the same vendor serves another CMOTD operation or supplies another type of service.</p></div></div><div className="parity-form-grid"><label><span>Company operation</span><select value={operationId} onChange={(e) => setOperationId(e.target.value)}>{activeOperations.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span>Service category</span><select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{activeServices.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div><button className="parity-primary" disabled={classBusy} onClick={() => void addClassification()}>{classBusy ? "Saving…" : "Add Classification"}</button><Message value={classMsg}/></div> : null}
    </section>

    {role === "Facility Manager" ? <section className="parity-info"><ShieldCheck size={17}/><div><strong>Read-only Facility view</strong><span>Facility can identify approved suppliers and suggest new vendors. Procurement retains sourcing, quote comparison, award, vendor master and payment authority.</span></div></section> : <>
      <section><div className="parity-section-head"><div><h3>Quotation history</h3><p>All sourcing quotations linked to this vendor.</p></div><span>{quotes.length} quote(s)</span></div>{quotes.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Request</th><th>Sourcing</th><th>Amount</th><th>Delivery</th><th>Score</th><th>Outcome</th></tr></thead><tbody>{quotes.map((q: any) => <tr key={q.id}><td>{dateText(q.quote_date || q.created_at)}</td><td>{q.request_no || "—"}</td><td>{q.sourcing_no || "—"}</td><td>{money(q.quoted_amount, q.currency || "NGN")}</td><td>{Number(q.delivery_time_days || 0)} days</td><td>{Number(q.score || 0)}</td><td>{q.is_selected ? "Selected" : q.is_recommended ? "Recommended" : "Quoted"}</td></tr>)}</tbody></table></div> : <Empty text="No quotations linked yet."/>}</section>
      <section><div className="parity-section-head"><div><h3>Purchase order & delivery history</h3><p>Jobs awarded and delivery progress.</p></div><span>{pos.length} PO(s)</span></div>{pos.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>PO</th><th>Request</th><th>Date</th><th>Total</th><th>Status</th><th>Receiving</th><th>Actual delivery</th></tr></thead><tbody>{pos.map((po: any) => <tr key={po.id}><td>{po.po_no}</td><td>{po.request_no || "—"}</td><td>{dateText(po.po_date)}</td><td>{money(po.total_amount)}</td><td><Status>{po.status}</Status></td><td>{po.receiving_status || "—"}</td><td>{dateText(po.actual_delivery_date)}</td></tr>)}</tbody></table></div> : <Empty text="No purchase orders linked yet."/>}</section>
      <section><div className="parity-section-head"><div><h3>Payment summary</h3><p>Commercial payment history without exposing bank credentials.</p></div><span>{payments.length} payment(s)</span></div>{payments.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Payment</th><th>Request / PO</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>{payments.map((p: any) => <tr key={p.id}><td>{dateText(p.payment_date)}</td><td>{p.payment_no || "#" + p.id}</td><td>{p.request_no || "—"} {p.po_no ? "/ " + p.po_no : ""}</td><td>{money(p.amount, p.currency || "NGN")}</td><td>{p.status || "—"}</td><td>{p.payment_reference || "—"}</td></tr>)}</tbody></table></div> : <Empty text="No payments linked yet."/>}</section>
      <section><div className="parity-section-head"><div><h3>Receiving & documents</h3><p>Delivery evidence and supplier documents.</p></div><span>{receiving.length + docs.length} record(s)</span></div>{receiving.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Slip</th><th>PO</th><th>Request</th><th>Date</th><th>Status</th><th>Discrepancy</th></tr></thead><tbody>{receiving.map((r: any) => <tr key={r.id}><td>{r.slip_no}</td><td>{r.po_no || "—"}</td><td>{r.request_no || "—"}</td><td>{dateText(r.date_received)}</td><td>{r.status || "—"}</td><td>{r.discrepancy_notes || "—"}</td></tr>)}</tbody></table></div> : null}{docs.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Document</th><th>Type</th><th>Date</th><th>Action</th></tr></thead><tbody>{docs.map((d: any) => <tr key={d.id}><td>{d.title || d.file_name || "Vendor document"}</td><td>{d.document_type || "—"}</td><td>{dateText(d.created_at)}</td><td><a className="table-action-link" href={"/api/parity/document?source=" + encodeURIComponent("Vendor Document") + "&id=" + d.id}>Open</a></td></tr>)}</tbody></table></div> : null}{!receiving.length && !docs.length ? <Empty text="No receiving or vendor documents linked yet."/> : null}</section>
    </>}
  </div>;
}

function Directory({ data, role }: { data: ParityData; role: ProcureFlowRole }) {
  const router = useRouter();
  const canManage = ["Procurement Manager", "Admin"].includes(role);
  const operations = data.vendorOperationalCategories.filter((x: any) => x.status === "Active");
  const services = data.vendorServiceCategories.filter((x: any) => x.status === "Active");
  const [tab, setTab] = useState<"directory" | "add" | "categories" | "nominations" | "archived">("directory");
  const [search, setSearch] = useState("");
  const [operationFilter, setOperationFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(data.vendors.find((v: any) => v.status === "Active")?.id ?? null);
  const selected = data.vendors.find((v: any) => Number(v.id) === Number(selectedId)) || null;
  const [editingId, setEditingId] = useState<number | null>(null);
  const blank = { name: "", contactPerson: "", phone: "", email: "", address: "", taxId: "", rating: 3, status: "Active", operationalCategoryId: operations[0]?.id || "", serviceCategoryId: services[0]?.id || "", note: "" };
  const [form, setForm] = useState<any>(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [categoryForm, setCategoryForm] = useState<any>({ kind: "operation", name: "", description: "" });
  const [nominationNotes, setNominationNotes] = useState<Record<number, string>>({});

  const rows = useMemo(() => data.vendors.filter((v: any) => {
    const archived = String(v.status) === "Archived";
    if (tab === "archived" ? !archived : archived) return false;
    if (!canManage && String(v.status) !== "Active") return false;
    const q = search.trim().toLowerCase();
    if (q && !String([v.name, v.contact_person, v.category, v.phone, v.email].filter(Boolean).join(" ")).toLowerCase().includes(q)) return false;
    const links = linksFor(data, Number(v.id));
    if (operationFilter && !links.some((x: any) => String(x.operational_category_id) === operationFilter)) return false;
    if (serviceFilter && !links.some((x: any) => String(x.service_category_id) === serviceFilter)) return false;
    return true;
  }), [data, tab, search, operationFilter, serviceFilter, canManage]);

  function reset() { setEditingId(null); setForm({ ...blank, operationalCategoryId: operations[0]?.id || "", serviceCategoryId: services[0]?.id || "" }); }
  function edit(v: any) {
    const p = primaryFor(data, Number(v.id));
    setEditingId(Number(v.id));
    setForm({ name: v.name || "", contactPerson: v.contact_person || "", phone: v.phone || "", email: v.email || "", address: v.address || "", taxId: v.tax_id || "", rating: Number(v.rating || 3), status: v.status === "Archived" ? "Active" : v.status || "Active", operationalCategoryId: p?.operational_category_id || operations[0]?.id || "", serviceCategoryId: p?.service_category_id || services[0]?.id || "", note: v.notes || "" });
    setTab("add");
  }
  async function saveVendor() {
    setBusy("save"); setMsg(null);
    try {
      const result = await post("vendor-save", { vendorId: editingId, ...form, operationalCategoryId: Number(form.operationalCategoryId), serviceCategoryId: Number(form.serviceCategoryId) });
      setMsg({ type: "success", text: editingId ? "Vendor profile updated." : "Vendor added to the controlled directory." });
      setSelectedId(result.vendorId); reset(); setTab("directory"); router.refresh();
    } catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to save vendor." }); }
    finally { setBusy(null); }
  }
  async function saveCategory() {
    setBusy("category"); setMsg(null);
    try { await post("vendor-category-save", categoryForm); setMsg({ type: "success", text: "Category saved." }); setCategoryForm((x: any) => ({ ...x, name: "", description: "" })); router.refresh(); }
    catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to save category." }); }
    finally { setBusy(null); }
  }
  async function removeVendor() {
    if (!deleteTarget) return;
    setBusy("delete"); setMsg(null);
    try {
      const result = await post("vendor-delete", { vendorId: deleteTarget.id, confirmation: deleteConfirm });
      setMsg({ type: "success", text: result.deleted ? "Unused vendor permanently deleted." : "Vendor has transaction history, so it was archived instead of deleting audit evidence." });
      setDeleteTarget(null); setDeleteConfirm(""); setSelectedId(null); router.refresh();
    } catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to delete vendor." }); }
    finally { setBusy(null); }
  }
  async function decide(id: number, decision: "approve" | "more_info" | "reject") {
    const note = (nominationNotes[id] || "").trim();
    if (decision !== "approve" && note.length < 4) { setMsg({ type: "error", text: "Enter a clear reason first." }); return; }
    setBusy(decision + "-" + id); setMsg(null);
    try { await post("vendor-nomination-decision", { nominationId: id, decision, note }); setMsg({ type: "success", text: decision === "approve" ? "Vendor approved into the directory." : "Vendor nomination decision recorded." }); router.refresh(); }
    catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to decide nomination." }); }
    finally { setBusy(null); }
  }

  const pendingNominations = data.vendorNominations.filter((n: any) => ["Pending Procurement Review", "More Information Required"].includes(String(n.status)));
  return <div className="parity-stack">
    {canManage ? <div className="parity-row">
      <button className={tab === "directory" ? "parity-primary" : ""} onClick={() => setTab("directory")}><Building2 size={14}/>All Vendors</button>
      <button className={tab === "add" ? "parity-primary" : ""} onClick={() => { reset(); setTab("add"); }}><UserPlus size={14}/>Add Vendor</button>
      <button className={tab === "categories" ? "parity-primary" : ""} onClick={() => setTab("categories")}><Tags size={14}/>Categories</button>
      <button className={tab === "nominations" ? "parity-primary" : ""} onClick={() => setTab("nominations")}><ShieldCheck size={14}/>Vendor Nominations {pendingNominations.length ? "(" + pendingNominations.length + ")" : ""}</button>
      <button className={tab === "archived" ? "parity-primary" : ""} onClick={() => setTab("archived")}><Archive size={14}/>Archived Vendors</button>
    </div> : null}
    <Message value={msg}/>

    {(tab === "directory" || tab === "archived" || !canManage) ? <>
      <section className="parity-form-card">
        <div className="parity-section-head"><div><h3>{tab === "archived" ? "Archived Vendors" : "Vendor Directory"}</h3><p>{canManage ? "Procurement-controlled supplier master. Open any vendor to see its complete history." : "Approved suppliers for Facility reference. Procurement retains vendor and sourcing authority."}</p></div><span>{rows.length} vendor(s)</span></div>
        <div className="parity-form-grid">
          <label className="wide"><span>Search vendors</span><div className="parity-row"><Search size={15}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, contact, service, phone or email"/></div></label>
          <label><span>Company operation</span><select value={operationFilter} onChange={(e) => setOperationFilter(e.target.value)}><option value="">All operations</option>{operations.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label><span>Service category</span><select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}><option value="">All services</option>{services.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>
      </section>
      {rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Vendor</th><th>Operations</th><th>Service</th><th>Status</th><th>Rating</th><th>Quotes</th><th>Jobs</th><th>Action</th></tr></thead><tbody>{rows.map((v: any) => {
        const links = linksFor(data, Number(v.id));
        return <tr key={v.id}><td><strong>{v.name}</strong><small>{v.contact_person || v.phone || v.email || ""}</small></td><td>{Array.from(new Set(links.map((x: any) => x.operational_category_name))).join(", ") || "—"}</td><td>{Array.from(new Set(links.map((x: any) => x.service_category_name))).join(", ") || v.category || "—"}</td><td><Status>{v.status}</Status></td><td>{Number(v.rating || 0).toFixed(1)}/5</td><td>{Number(v.quote_count || 0)}</td><td>{Number(v.awarded_orders || 0)}</td><td><button onClick={() => setSelectedId(Number(v.id))}>Open Profile</button></td></tr>;
      })}</tbody></table></div> : <Empty text="No vendors match the current filters."/>}
      {selected && rows.some((v: any) => Number(v.id) === Number(selected.id)) ? <VendorProfile vendor={selected} data={data} role={role} onEdit={canManage ? () => edit(selected) : undefined} onDelete={canManage ? () => { setDeleteTarget(selected); setDeleteConfirm(""); } : undefined}/> : null}
    </> : null}

    {canManage && tab === "add" ? <section className="parity-form-card">
      <div className="parity-card-title"><UserPlus size={18}/><div><strong>{editingId ? "Edit Vendor" : "Add Vendor"}</strong><span>Every vendor must be assigned to a company operation and a service category.</span></div></div>
      <div className="parity-form-grid">
        <label><span>Vendor / business name *</span><input value={form.name} onChange={(e) => setForm((x: any) => ({ ...x, name: e.target.value }))}/></label>
        <label><span>Contact person</span><input value={form.contactPerson} onChange={(e) => setForm((x: any) => ({ ...x, contactPerson: e.target.value }))}/></label>
        <label><span>Phone</span><input value={form.phone} onChange={(e) => setForm((x: any) => ({ ...x, phone: e.target.value }))}/></label>
        <label><span>Email</span><input value={form.email} onChange={(e) => setForm((x: any) => ({ ...x, email: e.target.value }))}/></label>
        <label className="wide"><span>Address</span><input value={form.address} onChange={(e) => setForm((x: any) => ({ ...x, address: e.target.value }))}/></label>
        <label><span>Tax ID</span><input value={form.taxId} onChange={(e) => setForm((x: any) => ({ ...x, taxId: e.target.value }))}/></label>
        <label><span>Company operation *</span><select value={form.operationalCategoryId} onChange={(e) => setForm((x: any) => ({ ...x, operationalCategoryId: e.target.value }))}><option value="">Choose operation</option>{operations.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span>Service category *</span><select value={form.serviceCategoryId} onChange={(e) => setForm((x: any) => ({ ...x, serviceCategoryId: e.target.value }))}><option value="">Choose service</option>{services.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span>Directory rating</span><select value={form.rating} onChange={(e) => setForm((x: any) => ({ ...x, rating: Number(e.target.value) }))}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></label>
        <label><span>Status</span><select value={form.status} onChange={(e) => setForm((x: any) => ({ ...x, status: e.target.value }))}><option>Active</option><option>Under Review</option><option>Suspended</option><option>Inactive</option></select></label>
        <label className="wide"><span>Procurement note</span><textarea rows={3} value={form.note} onChange={(e) => setForm((x: any) => ({ ...x, note: e.target.value }))}/></label>
      </div>
      <div className="parity-row"><button onClick={() => { reset(); setTab("directory"); }}>Cancel</button><button className="parity-primary" disabled={busy === "save"} onClick={() => void saveVendor()}><CheckCircle2 size={14}/>{busy === "save" ? "Saving…" : editingId ? "Save Vendor Changes" : "Add Vendor"}</button></div>
    </section> : null}

    {canManage && tab === "categories" ? <div className="parity-stack">
      <section className="parity-form-card"><div className="parity-card-title"><Tags size={18}/><div><strong>Vendor classification</strong><span>Company operations explain where CMOTD uses a vendor; service categories explain what the vendor supplies.</span></div></div><div className="parity-form-grid"><label><span>Category type</span><select value={categoryForm.kind} onChange={(e) => setCategoryForm((x: any) => ({ ...x, kind: e.target.value }))}><option value="operation">Company operation</option><option value="service">Vendor service</option></select></label><label><span>Name</span><input value={categoryForm.name} onChange={(e) => setCategoryForm((x: any) => ({ ...x, name: e.target.value }))}/></label><label className="wide"><span>Description</span><input value={categoryForm.description} onChange={(e) => setCategoryForm((x: any) => ({ ...x, description: e.target.value }))}/></label></div><button className="parity-primary" disabled={busy === "category"} onClick={() => void saveCategory()}><CirclePlus size={14}/>{busy === "category" ? "Saving…" : "Add Category"}</button></section>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Company operation</th><th>Description</th><th>Status</th></tr></thead><tbody>{data.vendorOperationalCategories.map((x: any) => <tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.description || "—"}</td><td><Status>{x.status}</Status></td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Service category</th><th>Description</th><th>Status</th></tr></thead><tbody>{data.vendorServiceCategories.map((x: any) => <tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.description || "—"}</td><td><Status>{x.status}</Status></td></tr>)}</tbody></table></div>
    </div> : null}

    {canManage && tab === "nominations" ? <section>
      <div className="parity-section-head"><div><h3>Facility Vendor Nominations</h3><p>Facility may suggest suppliers, but Procurement alone decides whether they become approved vendors.</p></div><span>{data.vendorNominations.length} record(s)</span></div>
      {data.vendorNominations.length ? <div className="parity-stack">{data.vendorNominations.map((n: any) => <article className="parity-review-card" key={n.id}>
        <div><span>{n.operational_category_name} · {n.service_category_name}</span><h3>{n.vendor_name}</h3><p>Suggested by {n.submitted_by_name || "Facility"} · {n.contact_person || "No contact"} · {n.phone || "No phone"}</p><Status>{n.status}</Status></div>
        <div className="table-wrap"><table className="data-table"><tbody><tr><th>Reason</th><td>{n.reason}</td><th>Previous experience</th><td>{n.prior_experience || "—"}</td></tr><tr><th>Address</th><td>{n.address || "—"}</td><th>Email</th><td>{n.email || "—"}</td></tr>{n.procurement_note ? <tr><th>Procurement note</th><td colSpan={3}>{n.procurement_note}</td></tr> : null}</tbody></table></div>
        {["Pending Procurement Review", "More Information Required"].includes(String(n.status)) ? <><textarea rows={3} value={nominationNotes[n.id] || ""} onChange={(e) => setNominationNotes((x) => ({ ...x, [n.id]: e.target.value }))} placeholder="Procurement review note / reason"/><div className="parity-row"><button disabled={busy !== null} onClick={() => void decide(n.id, "more_info")}>Request More Information</button><button className="parity-danger" disabled={busy !== null} onClick={() => void decide(n.id, "reject")}><XCircle size={14}/>Reject Nomination</button><button className="parity-primary" disabled={busy !== null} onClick={() => void decide(n.id, "approve")}><CheckCircle2 size={14}/>Approve into Vendor Directory</button></div></> : null}
      </article>)}</div> : <Empty text="No Facility vendor nominations have been submitted."/>}
    </section> : null}

    {deleteTarget ? <section className="parity-form-card"><div className="parity-card-title"><Trash2 size={18}/><div><strong>Delete / Archive {deleteTarget.name}</strong><span>Unused vendors are permanently deleted. Vendors with transaction history are archived so audit evidence is preserved.</span></div></div><label><span>Type the vendor name to confirm</span><input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={deleteTarget.name}/></label><div className="parity-row"><button onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); }}>Cancel</button><button className="parity-danger" disabled={busy === "delete" || deleteConfirm.toLowerCase() !== String(deleteTarget.name).toLowerCase()} onClick={() => void removeVendor()}><Trash2 size={14}/>{busy === "delete" ? "Processing…" : "Delete Vendor"}</button></div></section> : null}
  </div>;
}

function SuggestVendor({ data }: { data: ParityData }) {
  const router = useRouter();
  const operations = data.vendorOperationalCategories.filter((x: any) => x.status === "Active");
  const services = data.vendorServiceCategories.filter((x: any) => x.status === "Active");
  const [form, setForm] = useState<any>({ vendorName: "", contactPerson: "", phone: "", email: "", address: "", operationalCategoryId: operations[0]?.id || "", serviceCategoryId: services[0]?.id || "", reason: "", priorExperience: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<any>(null);
  async function submit() {
    setBusy(true); setMsg(null);
    try { await post("vendor-nomination-create", { ...form, operationalCategoryId: Number(form.operationalCategoryId), serviceCategoryId: Number(form.serviceCategoryId) }); setMsg({ type: "success", text: "Vendor suggestion sent to Procurement. It is not approved until Procurement accepts it." }); setForm((x: any) => ({ ...x, vendorName: "", contactPerson: "", phone: "", email: "", address: "", reason: "", priorExperience: "" })); router.refresh(); }
    catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to suggest vendor." }); }
    finally { setBusy(false); }
  }
  return <div className="parity-stack"><section className="parity-info"><ShieldCheck size={17}/><div><strong>Facility can suggest; Procurement controls approval</strong><span>Your nomination cannot be used in sourcing until Procurement approves it into the Vendor Directory.</span></div></section><section className="parity-form-card"><div className="parity-card-title"><UserPlus size={18}/><div><strong>Suggest / Nominate Vendor</strong><span>Describe the supplier, company operation, service provided and previous experience.</span></div></div><div className="parity-form-grid">
    <label><span>Vendor / business name *</span><input value={form.vendorName} onChange={(e) => setForm((x: any) => ({ ...x, vendorName: e.target.value }))}/></label>
    <label><span>Contact person</span><input value={form.contactPerson} onChange={(e) => setForm((x: any) => ({ ...x, contactPerson: e.target.value }))}/></label>
    <label><span>Phone</span><input value={form.phone} onChange={(e) => setForm((x: any) => ({ ...x, phone: e.target.value }))}/></label>
    <label><span>Email</span><input value={form.email} onChange={(e) => setForm((x: any) => ({ ...x, email: e.target.value }))}/></label>
    <label className="wide"><span>Address</span><input value={form.address} onChange={(e) => setForm((x: any) => ({ ...x, address: e.target.value }))}/></label>
    <label><span>Company operation *</span><select value={form.operationalCategoryId} onChange={(e) => setForm((x: any) => ({ ...x, operationalCategoryId: e.target.value }))}>{operations.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label><span>Service category *</span><select value={form.serviceCategoryId} onChange={(e) => setForm((x: any) => ({ ...x, serviceCategoryId: e.target.value }))}>{services.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="wide"><span>Why are you recommending this vendor? *</span><textarea rows={3} value={form.reason} onChange={(e) => setForm((x: any) => ({ ...x, reason: e.target.value }))}/></label>
    <label className="wide"><span>Previous experience / what they have done for the company</span><textarea rows={3} value={form.priorExperience} onChange={(e) => setForm((x: any) => ({ ...x, priorExperience: e.target.value }))}/></label>
  </div><button className="parity-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit Vendor Suggestion"}</button><Message value={msg}/></section></div>;
}

function MyVendorSuggestions({ data }: { data: ParityData }) {
  const router = useRouter();
  const [extra, setExtra] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<any>(null);
  async function resubmit(id: number) {
    const additionalInfo = (extra[id] || "").trim();
    if (additionalInfo.length < 4) { setMsg({ type: "error", text: "Add the information Procurement requested before resubmitting." }); return; }
    setBusy(id); setMsg(null);
    try { await post("vendor-nomination-resubmit", { nominationId: id, additionalInfo }); setMsg({ type: "success", text: "Additional information sent back to Procurement." }); router.refresh(); }
    catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to resubmit vendor suggestion." }); }
    finally { setBusy(null); }
  }
  return <div className="parity-stack"><Message value={msg}/><section><div className="parity-section-head"><div><h3>My Vendor Suggestions</h3><p>Track Procurement decisions on suppliers you have nominated.</p></div><span>{data.vendorNominations.length} suggestion(s)</span></div>{data.vendorNominations.length ? <div className="parity-stack">{data.vendorNominations.map((n: any) => <article className="parity-review-card" key={n.id}><div><span>{n.operational_category_name} · {n.service_category_name}</span><h3>{n.vendor_name}</h3><p>Submitted {dateText(n.created_at)}</p><Status>{n.status}</Status></div><div className="table-wrap"><table className="data-table"><tbody><tr><th>Your reason</th><td>{n.reason}</td><th>Previous experience</th><td>{n.prior_experience || "—"}</td></tr><tr><th>Procurement note</th><td colSpan={3}>{n.procurement_note || "No Procurement note yet."}</td></tr>{n.approved_vendor_name ? <tr><th>Approved vendor</th><td colSpan={3}>{n.approved_vendor_name}</td></tr> : null}</tbody></table></div>{n.status === "More Information Required" ? <><textarea rows={3} value={extra[n.id] || ""} onChange={(e) => setExtra((x) => ({ ...x, [n.id]: e.target.value }))} placeholder="Provide the additional information Procurement requested"/><button className="parity-primary" disabled={busy === n.id} onClick={() => void resubmit(n.id)}>Resubmit to Procurement</button></> : null}</article>)}</div> : <Empty text="You have not suggested any vendors yet."/>}</section></div>;
}

export function VendorGovernanceWorkspace({ section, role, data }: { section: string; role: ProcureFlowRole; data: ParityData }) {
  if (section === "Vendor Directory") return <Directory data={data} role={role}/>;
  if (section === "Suggest Vendor") return <SuggestVendor data={data}/>;
  if (section === "My Vendor Suggestions") return <MyVendorSuggestions data={data}/>;
  return <Empty text="Vendor workspace is unavailable."/>;
}

"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  FileText,
  LogOut,
  PackageCheck,
  Route,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS } from "@/lib/procureflow/roles";
import type {
  LogisticsDashboardData,
  LogisticsExceptionRow,
  LogisticsGatewayRow,
  LogisticsPORow,
} from "@/lib/procureflow/logistics-data";
import type { LogisticsPOItemRow } from "@/lib/procureflow/logistics-items";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import { SettingsWorkspace } from "@/components/settings-workspace";

type ShellUser = { id: number; fullName: string; username: string; role: "Logistics Officer" };
type Message = { type: "success" | "error"; text: string } | null;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "LO";
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value || 0);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function dateInputValue(value: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

async function logisticsPost(body: Record<string, unknown>) {
  const response = await fetch("/api/logistics/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Unable to complete Logistics action.");
  return payload;
}

function POList({ rows, selectedId, onSelect }: { rows: LogisticsPORow[]; selectedId: number | null; onSelect: (id: number) => void }) {
  if (!rows.length) return <div className="empty-state">No purchase orders are available in this queue.</div>;
  return <div className="logistics-po-list">{rows.map((row) => (
    <button type="button" key={row.id} className={selectedId === row.id ? "logistics-po-card active" : "logistics-po-card"} onClick={() => onSelect(row.id)}>
      <span className="logistics-po-icon"><Truck size={17} /></span>
      <div><strong>{row.poNo}</strong><span>{row.requestNo || "No request link"} · {row.vendorName || "Vendor not linked"}</span></div>
      <div><b>{money(row.totalAmount)}</b><small>{row.logisticsStatus || row.status || "—"}</small></div>
    </button>
  ))}</div>;
}

function HandoverEditor({ row }: { row: LogisticsPORow }) {
  const router = useRouter();
  const [vendorDeliveryContact, setVendorDeliveryContact] = useState(row.vendorDeliveryContact || "");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(dateInputValue(row.expectedDeliveryDate));
  const [deliveryAddress, setDeliveryAddress] = useState(row.deliveryAddress || "");
  const [driverName, setDriverName] = useState(row.driverName || "");
  const [driverPhone, setDriverPhone] = useState(row.driverPhone || "");
  const [vehicleNumber, setVehicleNumber] = useState(row.vehicleNumber || "");
  const [waybillNumber, setWaybillNumber] = useState(row.waybillNumber || "");
  const [deliveryInstructions, setDeliveryInstructions] = useState(row.deliveryInstructions || "");
  const [initialStatus, setInitialStatus] = useState<"Scheduled" | "Sent to Vendor">("Scheduled");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function submit() {
    if (!window.confirm(`Save the Logistics delivery handover for ${row.poNo}?`)) return;
    setBusy(true); setMessage(null);
    try {
      await logisticsPost({ action: "plan-handover", poId: row.id, input: { vendorDeliveryContact, expectedDeliveryDate, deliveryAddress, driverName, driverPhone, vehicleNumber, waybillNumber, deliveryInstructions, initialStatus } });
      setMessage({ type: "success", text: `${row.poNo} delivery handover was saved and routed into Logistics tracking.` });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to save handover." });
    } finally { setBusy(false); }
  }

  return <section className="logistics-editor">
    <div className="review-card-heading"><div><span>Commercial handover from Procurement</span><h3>{row.poNo}</h3><p>{row.vendorName || "Vendor not linked"} · Expected {dateText(row.expectedDeliveryDate)}</p></div><span className="status-pill">{row.logisticsStatus || row.status}</span></div>
    <div className="review-facts logistics-facts"><div><span>Request</span><strong>{row.requestNo || "—"}</strong></div><div><span>PO amount</span><strong>{money(row.totalAmount)}</strong></div><div><span>Released</span><strong>{dateText(row.releasedToLogisticsAt)}</strong></div><div><span>Receiving</span><strong>{row.receivingStatus || "Pending Receipt"}</strong></div></div>
    <div className="logistics-form-grid">
      <label><span>Vendor delivery contact</span><input value={vendorDeliveryContact} onChange={(e) => setVendorDeliveryContact(e.target.value)} /></label>
      <label><span>Expected delivery date</span><input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} /></label>
      <label className="wide"><span>Delivery address</span><input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} /></label>
      <label><span>Driver name</span><input value={driverName} onChange={(e) => setDriverName(e.target.value)} /></label>
      <label><span>Driver phone</span><input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} /></label>
      <label><span>Vehicle number</span><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></label>
      <label><span>Waybill / dispatch number</span><input value={waybillNumber} onChange={(e) => setWaybillNumber(e.target.value)} /></label>
      <label><span>Initial delivery status</span><select value={initialStatus} onChange={(e) => setInitialStatus(e.target.value as typeof initialStatus)}><option>Scheduled</option><option>Sent to Vendor</option></select></label>
      <label className="wide"><span>Delivery instructions</span><textarea rows={3} value={deliveryInstructions} onChange={(e) => setDeliveryInstructions(e.target.value)} /></label>
    </div>
    <button type="button" className="logistics-primary" disabled={busy} onClick={submit}><ClipboardCheck size={16} />{busy ? "Saving…" : "Save Delivery Handover"}</button>
    {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
  </section>;
}

function TrackingEditor({ row }: { row: LogisticsPORow }) {
  const router = useRouter();
  const statuses = ["Scheduled", "Sent to Vendor", "Dispatched", "In Transit", "Delayed", "Arrived"] as const;
  const current = statuses.includes(row.status as any) ? row.status as typeof statuses[number] : "Scheduled";
  const [status, setStatus] = useState<typeof statuses[number]>(current);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(dateInputValue(row.expectedDeliveryDate));
  const [actualDeliveryDate, setActualDeliveryDate] = useState(dateInputValue(row.actualDeliveryDate));
  const [waybillNumber, setWaybillNumber] = useState(row.waybillNumber || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function submit() {
    setBusy(true); setMessage(null);
    try {
      await logisticsPost({ action: "update-tracking", poId: row.id, input: { status, expectedDeliveryDate, actualDeliveryDate: status === "Arrived" ? actualDeliveryDate : null, waybillNumber, note } });
      setMessage({ type: "success", text: `${row.poNo} delivery status is now ${status}.` });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to update delivery tracking." });
    } finally { setBusy(false); }
  }

  return <section className="logistics-editor">
    <div className="review-card-heading"><div><span>Delivery execution</span><h3>{row.poNo}</h3><p>{row.vendorName || "—"} · {row.requestNo || "—"}</p></div><span className="status-pill">{row.status || "—"}</span></div>
    <div className="logistics-form-grid">
      <label><span>Delivery status</span><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Expected delivery date</span><input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} /></label>
      {status === "Arrived" ? <label><span>Actual delivery date</span><input type="date" value={actualDeliveryDate} onChange={(e) => setActualDeliveryDate(e.target.value)} /></label> : null}
      <label><span>Waybill / dispatch number</span><input value={waybillNumber} onChange={(e) => setWaybillNumber(e.target.value)} /></label>
      <label className="wide"><span>Tracking update / reason for delay</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </div>
    <button type="button" className="logistics-primary" disabled={busy} onClick={submit}><Route size={16} />{busy ? "Updating…" : "Update Delivery Tracking"}</button>
    {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
  </section>;
}

function ReceivingWorkspace({ rows, items, register }: { rows: LogisticsPORow[]; items: LogisticsPOItemRow[]; register: LogisticsDashboardData["receivingSlips"] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const selected = rows.find((row) => row.id === selectedId) || rows[0] || null;
  const selectedItems = items.filter((item) => item.poId === selected?.id);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [conditions, setConditions] = useState<Record<number, string>>({});
  const [dateReceived, setDateReceived] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryNoteNo, setDeliveryNoteNo] = useState("");
  const [discrepancyNotes, setDiscrepancyNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function submit() {
    if (!selected) return;
    const lineItems = selectedItems.map((item) => ({ poItemId: item.id, quantityReceived: Number(quantities[item.id] || 0), itemCondition: conditions[item.id] || "Good", discrepancyNotes: "" })).filter((item) => item.quantityReceived > 0);
    if (!lineItems.length) { setMessage({ type: "error", text: "Enter at least one received quantity." }); return; }
    setBusy(true); setMessage(null);
    try {
      const payload = await logisticsPost({ action: "record-receiving", poId: selected.id, input: { dateReceived, deliveryNoteNo, discrepancyNotes, items: lineItems } });
      setMessage({ type: "success", text: `${payload?.result?.slipNo || "Receiving slip"} recorded for ${selected.poNo}.` });
      setQuantities({}); setConditions({}); setDeliveryNoteNo(""); setDiscrepancyNotes("");
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to record receiving slip." });
    } finally { setBusy(false); }
  }

  return <div className="logistics-receiving-layout">
    <div>
      <h3 className="logistics-subhead">Record Receiving Slip</h3>
      {rows.length ? <POList rows={rows} selectedId={selected?.id ?? null} onSelect={(id) => { setSelectedId(id); setMessage(null); }} /> : <div className="empty-state">No arrived or partially received purchase orders are waiting for a receiving slip.</div>}
      {selected ? <section className="logistics-editor receiving-editor">
        <div className="review-card-heading"><div><span>Delivered goods</span><h3>{selected.poNo}</h3><p>{selected.vendorName || "—"}</p></div><span className="status-pill">{selected.receivingStatus || "Pending Receipt"}</span></div>
        {selectedItems.length ? <div className="table-wrap"><table className="data-table logistics-item-table"><thead><tr><th>Item</th><th>Ordered</th><th>Previously received</th><th>Remaining</th><th>Receive now</th><th>Condition</th></tr></thead><tbody>{selectedItems.map((item) => <tr key={item.id}><td><strong>{item.itemName}</strong><small>{item.category || ""}</small></td><td>{item.quantityOrdered}</td><td>{item.quantityReceived}</td><td>{item.quantityRemaining}</td><td><input type="number" min="0" max={item.quantityRemaining} step="0.01" value={quantities[item.id] || ""} onChange={(e) => setQuantities((current) => ({ ...current, [item.id]: e.target.value }))} /></td><td><select value={conditions[item.id] || "Good"} onChange={(e) => setConditions((current) => ({ ...current, [item.id]: e.target.value }))}><option>Good</option><option>Damaged</option><option>Incorrect</option><option>Rejected</option></select></td></tr>)}</tbody></table></div> : <div className="logistics-warning"><AlertTriangle size={17} /><div><strong>No PO item lines are available</strong><span>Procurement must attach commercial PO item lines before Logistics can record quantities received.</span></div></div>}
        <div className="logistics-form-grid"><label><span>Date received</span><input type="date" value={dateReceived} onChange={(e) => setDateReceived(e.target.value)} /></label><label><span>Delivery note number</span><input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} /></label><label className="wide"><span>Discrepancy notes</span><textarea rows={3} value={discrepancyNotes} onChange={(e) => setDiscrepancyNotes(e.target.value)} /></label></div>
        <button type="button" className="logistics-primary" disabled={busy || !selectedItems.length} onClick={submit}><PackageCheck size={16} />{busy ? "Recording…" : "Record Receiving Slip"}</button>
        {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
      </section> : null}
    </div>
    <div><h3 className="logistics-subhead">Receiving Register</h3>{register.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Slip</th><th>PO / Request</th><th>Vendor</th><th>Date</th><th>Delivery note</th><th>Status</th></tr></thead><tbody>{register.map((row) => <tr key={row.id}><td><strong>{row.slipNo}</strong></td><td><strong>{row.poNo || "—"}</strong><small>{row.requestNo || ""}</small></td><td>{row.vendorName || "—"}</td><td>{dateText(row.dateReceived)}</td><td>{row.deliveryNoteNo || "—"}</td><td><span className="status-chip">{row.status || "Recorded"}</span></td></tr>)}</tbody></table></div> : <div className="empty-state">No receiving slips have been recorded yet.</div>}</div>
  </div>;
}

function ExceptionWorkspace({ rows, exceptions }: { rows: LogisticsPORow[]; exceptions: LogisticsExceptionRow[] }) {
  const router = useRouter();
  const [selectedPoId, setSelectedPoId] = useState<number | null>(rows[0]?.id ?? null);
  const [exceptionType, setExceptionType] = useState("Late delivery");
  const [description, setDescription] = useState("");
  const [paymentImpact, setPaymentImpact] = useState(false);
  const [resolutionById, setResolutionById] = useState<Record<number, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  async function raise() {
    if (!selectedPoId) return;
    setBusyKey("raise"); setMessage(null);
    try {
      const payload = await logisticsPost({ action: "raise-exception", poId: selectedPoId, input: { exceptionType, description, paymentImpact } });
      setMessage({ type: "success", text: `${payload?.result?.exceptionNo || "Exception"} was raised and routed to the relevant teams.` });
      setDescription(""); setPaymentImpact(false); router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to raise exception." }); }
    finally { setBusyKey(null); }
  }

  async function resolve(row: LogisticsExceptionRow) {
    const resolution = String(resolutionById[row.id] || "").trim();
    if (!resolution) { setMessage({ type: "error", text: "Enter a resolution note before resolving an exception." }); return; }
    setBusyKey(`resolve-${row.id}`); setMessage(null);
    try {
      await logisticsPost({ action: "resolve-exception", exceptionId: row.id, input: { resolution } });
      setMessage({ type: "success", text: `${row.exceptionNo} was marked resolved.` });
      router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to resolve exception." }); }
    finally { setBusyKey(null); }
  }

  const active = exceptions.filter((row) => ["Open", "In Progress"].includes(String(row.status || "")));
  const resolved = exceptions.filter((row) => String(row.status || "") === "Resolved");
  return <div className="logistics-exception-layout">
    <section className="logistics-editor"><div className="finance-panel-title"><AlertTriangle size={17} /><div><strong>Raise delivery exception</strong><span>Procurement and the Utility / Facility team are notified automatically. Finance is notified only where payment may be affected.</span></div></div>
      {rows.length ? <div className="logistics-form-grid"><label className="wide"><span>Purchase order</span><select value={selectedPoId || ""} onChange={(e) => setSelectedPoId(Number(e.target.value))}>{rows.map((row) => <option key={row.id} value={row.id}>{row.poNo} — {row.vendorName || "Vendor"}</option>)}</select></label><label><span>Exception type</span><select value={exceptionType} onChange={(e) => setExceptionType(e.target.value)}>{["Late delivery","Partial delivery","Damaged goods","Incorrect goods","Missing items","Rejected delivery","Vendor return","Replacement required","Other"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={paymentImpact} onChange={(e) => setPaymentImpact(e.target.checked)} /><span>May affect invoice / payment</span></label><label className="wide"><span>Description</span><textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></label></div> : <div className="empty-state">No active purchase orders are available for exception reporting.</div>}
      <button type="button" className="logistics-danger" disabled={!selectedPoId || busyKey === "raise"} onClick={raise}><AlertTriangle size={16} />{busyKey === "raise" ? "Raising…" : "Raise Exception"}</button>
    </section>
    {message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}
    <section><h3 className="logistics-subhead">Open Exceptions</h3>{active.length ? <div className="logistics-exception-list">{active.map((row) => <article key={row.id} className="logistics-exception-card"><div><strong>{row.exceptionNo}</strong><span>{row.poNo || `PO #${row.poId}`} · {row.exceptionType}</span><p>{row.description}</p>{row.paymentImpact ? <small className="exception-impact">Payment impact flagged</small> : null}</div><div className="exception-resolution"><textarea rows={2} placeholder="Resolution note" value={resolutionById[row.id] || ""} onChange={(e) => setResolutionById((current) => ({ ...current, [row.id]: e.target.value }))} /><button type="button" onClick={() => resolve(row)} disabled={busyKey === `resolve-${row.id}`}><CheckCircle2 size={15} />{busyKey === `resolve-${row.id}` ? "Resolving…" : "Resolve"}</button></div></article>)}</div> : <div className="empty-state">No open delivery exceptions.</div>}</section>
    {resolved.length ? <section><h3 className="logistics-subhead">Resolved Exceptions</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Exception</th><th>PO</th><th>Type</th><th>Resolution</th><th>Updated</th></tr></thead><tbody>{resolved.map((row) => <tr key={row.id}><td><strong>{row.exceptionNo}</strong></td><td>{row.poNo || `#${row.poId}`}</td><td>{row.exceptionType}</td><td>{row.resolutionNote || "—"}</td><td>{dateText(row.updatedAt)}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function GatewayWorkspace({ rows }: { rows: LogisticsGatewayRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const selected = rows.find((row) => row.id === selectedId) || rows[0] || null;
  const [movementDate, setMovementDate] = useState(dateInputValue(selected?.expectedMovementDate || null));
  const [driverName, setDriverName] = useState(selected?.driverName || "");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState(selected?.vehicleNumber || "");
  const [deliveryReference, setDeliveryReference] = useState("");
  const [waybillNumber, setWaybillNumber] = useState("");
  const [status, setStatus] = useState<"Scheduled" | "Entered" | "Exited" | "Completed">("Scheduled");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  function choose(id: number) {
    const row = rows.find((item) => item.id === id);
    setSelectedId(id); setMovementDate(dateInputValue(row?.expectedMovementDate || null)); setDriverName(row?.driverName || ""); setVehicleNumber(row?.vehicleNumber || ""); setMessage(null);
  }

  async function submit() {
    if (!selected) return;
    setBusy(true); setMessage(null);
    try {
      await logisticsPost({ action: "gateway-coordination", gatewayPassId: selected.id, input: { movementDate, driverName, driverPhone, vehicleNumber, deliveryReference, waybillNumber, status, note } });
      setMessage({ type: "success", text: `${selected.passNumber} movement coordination is now ${status}.` }); router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to update gateway movement." }); }
    finally { setBusy(false); }
  }

  if (!rows.length) return <div className="empty-state">No approved or generated gateway passes are waiting for Logistics coordination.</div>;
  return <div className="logistics-gateway-layout"><div className="logistics-gateway-list">{rows.map((row) => <button key={row.id} type="button" className={selected?.id === row.id ? "logistics-po-card active" : "logistics-po-card"} onClick={() => choose(row.id)}><span className="logistics-po-icon"><Route size={17} /></span><div><strong>{row.passNumber}</strong><span>{row.movementType} · {row.destination || "—"}</span></div><div><b>{dateText(row.expectedMovementDate)}</b><small>{row.logisticsStatus || row.status}</small></div></button>)}</div>{selected ? <section className="logistics-editor"><div className="review-card-heading"><div><span>Approved movement</span><h3>{selected.passNumber}</h3><p>{selected.purpose}</p></div><span className="status-pill">{selected.status}</span></div><div className="logistics-form-grid"><label><span>Movement date</span><input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} /></label><label><span>Movement status</span><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option>Scheduled</option><option>Entered</option><option>Exited</option><option>Completed</option></select></label><label><span>Driver name</span><input value={driverName} onChange={(e) => setDriverName(e.target.value)} /></label><label><span>Driver phone</span><input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} /></label><label><span>Vehicle number</span><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></label><label><span>Delivery / movement reference</span><input value={deliveryReference} onChange={(e) => setDeliveryReference(e.target.value)} /></label><label><span>Waybill / delivery document</span><input value={waybillNumber} onChange={(e) => setWaybillNumber(e.target.value)} /></label><label className="wide"><span>Coordination note</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label></div><button type="button" className="logistics-primary" disabled={busy} onClick={submit}><Route size={16} />{busy ? "Saving…" : "Save Movement Coordination"}</button>{message ? <div className={`action-message ${message.type}`}>{message.text}</div> : null}</section> : null}</div>;
}

function DocumentsWorkspace({ data }: { data: LogisticsDashboardData }) {
  const rows = data.tracking;
  return <div className="logistics-documents"><div className="logistics-document-note"><FileText size={17} /><div><strong>Logistics document register</strong><span>Waybill, delivery and receiving references remain attached to their operational records. Binary proof-of-delivery upload will be connected when the Vercel-compatible document-storage layer is ported.</span></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>PO</th><th>Request</th><th>Vendor</th><th>Waybill</th><th>Delivery status</th><th>Receiving</th><th>Updated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.poNo}</strong></td><td>{row.requestNo || "—"}</td><td>{row.vendorName || "—"}</td><td>{row.waybillNumber || "—"}</td><td><span className="status-chip">{row.logisticsStatus || row.status || "—"}</span></td><td>{row.receivingStatus || "Pending Receipt"}</td><td>{dateText(row.updatedAt)}</td></tr>)}</tbody></table></div></div>;
}

export function LogisticsShell({ user, data, items, securityStatus }: { user: ShellUser; data: LogisticsDashboardData; items: LogisticsPOItemRow[]; securityStatus: SecurityMigrationStatus }) {
  const router = useRouter();
  const nav = ROLE_SECTIONS["Logistics Officer"];
  const [section, setSection] = useState(nav.sections[0]);
  const [handoverId, setHandoverId] = useState<number | null>(data.handover[0]?.id ?? null);
  const [trackingId, setTrackingId] = useState<number | null>(data.tracking[0]?.id ?? null);
  const handover = useMemo(() => data.handover.find((row) => row.id === handoverId) || data.handover[0] || null, [data.handover, handoverId]);
  const tracking = useMemo(() => data.tracking.find((row) => row.id === trackingId) || data.tracking[0] || null, [data.tracking, trackingId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/"); router.refresh();
  }

  const cards = [["Awaiting Handover", String(data.metrics.awaitingHandover), "Released by Procurement"], ["Active Deliveries", String(data.metrics.activeDeliveries), "Scheduled / in transit"], ["Receiving Pending", String(data.metrics.receivingPending), "Arrival evidence"], ["Exceptions", String(data.metrics.exceptions), "Open delivery issues"]];
  const allExceptionPOs = data.tracking.length ? data.tracking : data.handover;

  let content: React.ReactNode = null;
  if (section === "PO Delivery Handover") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>PO Delivery Handover</h2><p>Approved purchase orders released by Procurement appear here. Logistics records the delivery plan without changing vendor selection or commercial approval.</p></div><span className="status-pill">{data.handover.length} awaiting handover</span></div><POList rows={data.handover} selectedId={handover?.id ?? null} onSelect={setHandoverId} />{handover ? <HandoverEditor key={handover.id} row={handover} /> : null}</article>;
  else if (section === "Delivery Tracking") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Delivery Tracking</h2><p>Track dispatch, transit, delays and arrival after the commercial PO is handed over to Logistics.</p></div><span className="status-pill">{data.tracking.length} active records</span></div><POList rows={data.tracking} selectedId={tracking?.id ?? null} onSelect={setTrackingId} />{tracking ? <TrackingEditor key={tracking.id} row={tracking} /> : null}</article>;
  else if (section === "Receiving Slips") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Receiving Slips</h2><p>Record delivered quantities and condition. Full receipt routes the PO onward to Finance while preserving Logistics evidence.</p></div><span className="status-pill">{data.receivingSlips.length} recorded</span></div><ReceivingWorkspace rows={data.receivingPending} items={items} register={data.receivingSlips} /></article>;
  else if (section === "Delivery Exceptions & Returns") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Delivery Exceptions & Returns</h2><p>Raise and resolve delivery problems with automatic Procurement, Facility, Finance and Auditor routing.</p></div><span className="status-pill">{data.metrics.exceptions} open</span></div><ExceptionWorkspace rows={allExceptionPOs} exceptions={data.exceptions} /></article>;
  else if (section === "Gateway Pass Coordination") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Gateway Pass Coordination</h2><p>Coordinate approved movements only. Logistics cannot submit, review, approve, reject or generate a gateway pass.</p></div><span className="status-pill">{data.gatewayPasses.length} active</span></div><GatewayWorkspace rows={data.gatewayPasses} /></article>;
  else if (section === "Logistics Documents") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Logistics Documents</h2><p>Operational delivery references and receiving evidence linked to the Logistics workflow.</p></div><span className="status-pill">Neon register</span></div><DocumentsWorkspace data={data} /></article>;
  else if (section === "My Activity History") content = <article className="panel section-panel"><div className="section-icon"><ShieldCheck size={22} /></div><div><h2>My Activity History</h2><p>Every Logistics write now records workflow events, activity history, legacy audit logs and the v2 tamper-evident audit ledger. The dedicated searchable activity table is the next read-only view to connect.</p><div className="section-tags"><span>Audit evidence active</span><span>Role: Logistics Officer</span></div></div></article>;
  else if (section === "Settings") content = <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Settings</h2><p>Secure account settings and password rotation for the Logistics Officer account.</p></div><span className="status-pill"><ShieldCheck size={13}/> Account security</span></div><SettingsWorkspace username={user.username} fullName={user.fullName} role="Logistics Officer"/></article>;

  return <main className="app-frame"><aside className="sidebar"><div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div><div className="sidebar-context"><span>{nav.title}</span><strong>{ROLE_LABELS["Logistics Officer"]}</strong></div><nav className="sidebar-nav">{nav.sections.map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}><Circle size={8} fill="currentColor" /><span>{item}</span></button>)}</nav><div className="sidebar-footer"><button onClick={logout}><LogOut size={16} /><span>Sign out</span></button></div></aside><section className="workspace"><header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14} /> {section}</div><p>{ROLE_LANDING["Logistics Officer"]}</p></div><div className="topbar-actions"><div className="user-chip"><span className="avatar">{initials(user.fullName)}</span><div><strong>{user.fullName}</strong><small>{ROLE_LABELS["Logistics Officer"]}</small></div></div></div></header><div className="content-wrap"><div className="page-heading"><div><span className="eyebrow">Logistics Officer</span><h1>{section}</h1><p>{section === "Logistics Dashboard" ? "Coordinate PO delivery, receiving, exceptions and approved movements after Procurement commercial release." : `ProcureFlow ${section} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark" /></div>{section === "Logistics Dashboard" ? <><div className="metric-grid">{cards.map(([title,value,caption]) => <article className="metric-card" key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div><div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>Logistics command chain</h2><p>Commercial approval stays with Procurement / Approver. Logistics owns delivery execution and receiving after release.</p></div><span className="status-pill">Live Neon workflow</span></div><div className="chain"><span>Approved PO</span><ChevronRight /><span>Procurement Release</span><ChevronRight /><span>Logistics Handover</span><ChevronRight /><span>Delivery</span><ChevronRight /><span>Receiving</span><ChevronRight /><span>Finance</span></div><div className="live-summary"><strong>Current Logistics state</strong><span>{data.handover.length} handover · {data.tracking.length} tracked · {data.receivingSlips.length} receiving slips · {data.gatewayPasses.length} gateway movements</span></div></article><article className="panel"><div className="panel-heading"><div><h2>Migration status</h2><p>Logistics role</p></div></div><ul className="status-list"><li><span>Neon read layer</span><b>Live</b></li><li><span>PO delivery handover</span><b>Live</b></li><li><span>Delivery tracking</span><b>Live</b></li><li><span>Receiving slips</span><b>Live</b></li><li><span>Delivery exceptions</span><b>Live</b></li><li><span>Gateway coordination</span><b>Live</b></li><li><span>v2 audit write guard</span><b>{securityStatus.writesEnabled ? "Verified" : "Locked"}</b></li></ul></article></div></> : content}</div></section></main>;
}

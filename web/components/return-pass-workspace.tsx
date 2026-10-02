"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Pencil, RotateCcw, Send, ShieldCheck, Truck, XCircle } from "lucide-react";
import type { ProcureFlowRole } from "@/lib/procureflow/roles";
import type { ParityData } from "@/lib/procureflow/parity-data";

function dateText(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function qty(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.max(0, Math.round(n))) : String(value ?? "0");
}
function Status({ children }: { children: any }) { return <span className="status-chip">{children || "—"}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function Message({ value }: { value: { type: "success" | "error"; text: string } | null }) {
  return value ? <div className={"action-message " + value.type}>{value.text}</div> : null;
}
async function post(action: string, payload: any = {}) {
  const response = await fetch("/api/parity/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to complete Return Pass action.");
  return body.result;
}
function approvedReturnStatus(status: unknown) {
  return ["Returned", "Partial Return", "Returned With Exception"].includes(String(status || ""));
}
function outstandingFor(data: ParityData, gatewayId: number) {
  return data.gatewayItems.filter((item: any) => Number(item.gateway_pass_id) === gatewayId).reduce((sum: number, item: any) => sum + Math.max(0, Math.round(Number(item.quantity || 0)) - Math.round(Number(item.returned_quantity || 0))), 0);
}

function ReturnPassDetails({ row, data }: { row: any; data: ParityData }) {
  const items = data.returnPassItems.filter((item: any) => Number(item.return_pass_id) === Number(row.id));
  return <div className="parity-stack">
    <div className="table-wrap"><table className="data-table"><tbody>
      <tr><th>Return Pass</th><td><strong>{row.return_pass_number}</strong></td><th>Status</th><td><Status>{row.status}</Status></td></tr>
      <tr><th>Original Gateway Pass</th><td>{row.gateway_pass_number}</td><th>Gateway Return Status</th><td>{row.gateway_return_status || "Not Started"}</td></tr>
      <tr><th>Facility / Department</th><td>{row.department || "—"}</td><th>Actual Return Date</th><td>{dateText(row.actual_return_date)}</td></tr>
      <tr><th>Return Origin</th><td>{row.return_origin || "—"}</td><th>Receiving Location</th><td>{row.receiving_location || "—"}</td></tr>
      <tr><th>Vehicle</th><td>{row.vehicle_number || "—"}</td><th>Driver</th><td>{row.driver_name || "—"}{row.driver_phone ? " · " + row.driver_phone : ""}</td></tr>
      <tr><th>Purpose</th><td colSpan={3}>{row.purpose || "—"}</td></tr>
      <tr><th>Approved By</th><td>{row.approved_by_name || row.approved_by_role || "—"}</td><th>Approval Date</th><td>{dateTime(row.approved_at)}</td></tr>
      {row.approval_note ? <tr><th>Verification Note</th><td colSpan={3}>{row.approval_note}</td></tr> : null}
      {row.rejection_reason ? <tr><th>Rejection Reason</th><td colSpan={3}>{row.rejection_reason}</td></tr> : null}
    </tbody></table></div>
    <div>
      <div className="parity-section-head"><div><h3>Return Reconciliation</h3><p>Outbound, previously returned, returning now and outstanding quantities are linked back to the original Gateway Pass.</p></div><span>{items.length} line(s)</span></div>
      {items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Item / Asset</th><th>Outbound</th><th>Previously Returned</th><th>Returning Now</th><th>Outstanding After</th><th>Return Condition</th><th>Exception / Remarks</th></tr></thead><tbody>{items.map((item: any) => {
        const after = Math.max(0, Math.round(Number(item.quantity_outbound || 0)) - Math.round(Number(item.quantity_previously_returned || 0)) - Math.round(Number(item.quantity_returned || 0)));
        return <tr key={item.id}><td><strong>{item.item_description}</strong><small>{[item.serial_number, item.asset_tag].filter(Boolean).join(" / ")}</small></td><td>{qty(item.quantity_outbound)}</td><td>{qty(item.quantity_previously_returned)}</td><td><strong>{qty(item.quantity_returned)}</strong></td><td>{after}</td><td>{item.condition_on_return || "—"}</td><td>{[item.discrepancy_type, item.discrepancy_notes, item.remarks].filter(Boolean).join(" · ") || "—"}</td></tr>;
      })}</tbody></table></div> : <Empty text="No Return Pass item lines are recorded."/>}
    </div>
  </div>;
}

function FacilityReturnPass({ data }: { data: ParityData }) {
  const router = useRouter();
  const eligible = data.gateways.filter((g: any) => ["Approved", "Generated", "Downloaded", "Closed"].includes(String(g.status || "")) && String(g.return_status || "") !== "Fully Returned" && outstandingFor(data, Number(g.id)) > 0);
  const [gatewayId, setGatewayId] = useState<number | null>(eligible[0]?.id ?? null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState("");
  const [returnOrigin, setReturnOrigin] = useState("");
  const [receivingLocation, setReceivingLocation] = useState("");
  const [actualReturnDate, setActualReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [lines, setLines] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<any>(null);

  const selectedGateway = data.gateways.find((g: any) => Number(g.id) === Number(gatewayId)) || null;
  const sourceItems = selectedGateway ? data.gatewayItems.filter((item: any) => Number(item.gateway_pass_id) === Number(selectedGateway.id)) : [];

  function loadGateway(id: number) {
    const gp = data.gateways.find((g: any) => Number(g.id) === id);
    if (!gp) return;
    setEditingId(null); setGatewayId(id); setPurpose("Return against " + gp.pass_number);
    setReturnOrigin(String(gp.destination || "")); setReceivingLocation(String(gp.origin_location || ""));
    setActualReturnDate(new Date().toISOString().slice(0, 10)); setVehicleNumber(""); setDriverName(""); setDriverPhone("");
    setLines(data.gatewayItems.filter((item: any) => Number(item.gateway_pass_id) === id).map((item: any) => {
      const outbound = Math.round(Number(item.quantity || 0));
      const previous = Math.round(Number(item.returned_quantity || 0));
      const outstanding = Math.max(0, outbound - previous);
      return { gatewayPassItemId: Number(item.id), itemDescription: item.item_description, unit: item.unit_of_measure, outbound, previous, outstanding, quantityReturned: outstanding, conditionOnReturn: "Good", discrepancyType: "", discrepancyNotes: "", remarks: "" };
    }));
  }
  function editReturn(row: any) {
    setEditingId(Number(row.id)); setGatewayId(Number(row.gateway_pass_id)); setPurpose(row.purpose || "");
    setReturnOrigin(row.return_origin || ""); setReceivingLocation(row.receiving_location || ""); setActualReturnDate(String(row.actual_return_date || new Date().toISOString().slice(0, 10)).slice(0, 10));
    setVehicleNumber(row.vehicle_number || ""); setDriverName(row.driver_name || ""); setDriverPhone(row.driver_phone || "");
    const returnItems = data.returnPassItems.filter((item: any) => Number(item.return_pass_id) === Number(row.id));
    setLines(returnItems.map((item: any) => {
      const outbound = Math.round(Number(item.quantity_outbound || 0));
      const previous = Math.round(Number(item.quantity_previously_returned || 0));
      return { gatewayPassItemId: Number(item.gateway_pass_item_id), itemDescription: item.item_description, unit: item.unit_of_measure, outbound, previous, outstanding: Math.max(0, outbound - previous), quantityReturned: Math.round(Number(item.quantity_returned || 0)), conditionOnReturn: item.condition_on_return || "Good", discrepancyType: item.discrepancy_type || "", discrepancyNotes: item.discrepancy_notes || "", remarks: item.remarks || "" };
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function patchLine(index: number, patch: any) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); }
  async function save() {
    if (!gatewayId) return setMsg({ type: "error", text: "Choose an approved Gateway Pass first." });
    setBusy("save"); setMsg(null);
    try {
      const payload = { gatewayPassId: gatewayId, returnPassId: editingId, purpose, returnOrigin, receivingLocation, actualReturnDate, vehicleNumber, driverName, driverPhone, items: lines };
      const result = await post(editingId ? "return-pass-update" : "return-pass-create", payload);
      setMsg({ type: "success", text: editingId ? "Return Pass changes saved. Submit it when ready." : result.returnPassNumber + " created as a draft." });
      setEditingId(null); setLines([]); router.refresh();
    } catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to save Return Pass." }); }
    finally { setBusy(null); }
  }
  async function submit(id: number) {
    setBusy("submit-" + id); setMsg(null);
    try { await post("return-pass-submit", { returnPassId: id }); setMsg({ type: "success", text: "Return Pass submitted to Logistics Manager for physical verification." }); router.refresh(); }
    catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to submit Return Pass." }); }
    finally { setBusy(null); }
  }

  const drafts = data.returnPasses.filter((r: any) => ["Draft", "Returned for Correction"].includes(String(r.status)));
  return <div className="parity-stack">
    <section className="parity-info"><RotateCcw size={17}/><div><strong>Return Pass = physical return and reconciliation</strong><span>Select the original approved Gateway Pass. ProcureFlow carries forward the outbound quantities and prevents more items being returned than originally left the facility.</span></div></section>
    <Message value={msg}/>
    <section className="parity-form-card">
      <div className="parity-card-title"><Truck size={18}/><div><strong>{editingId ? "Edit Return Pass" : "Create Return Pass"}</strong><span>Partial returns are allowed. A later Return Pass can reconcile the remaining outstanding items.</span></div></div>
      {!editingId ? <label><span>Original approved Gateway Pass</span><select value={gatewayId ?? ""} onChange={(e) => { const id = Number(e.target.value); setGatewayId(id); loadGateway(id); }}><option value="">Choose Gateway Pass</option>{eligible.map((g: any) => <option key={g.id} value={g.id}>{g.pass_number} · {g.department || "No department"} · {outstandingFor(data, Number(g.id))} item(s) outstanding</option>)}</select></label> : null}
      {selectedGateway ? <div className="review-facts recommendation-facts"><div><span>Gateway Pass</span><strong>{selectedGateway.pass_number}</strong></div><div><span>Original destination</span><strong>{selectedGateway.destination || "—"}</strong></div><div><span>Expected return</span><strong>{dateText(selectedGateway.expected_return_date)}</strong></div><div><span>Current return status</span><strong>{selectedGateway.return_status || "Not Started"}</strong></div></div> : null}
      <div className="parity-form-grid"><label className="wide"><span>Return purpose</span><textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)}/></label><label><span>Actual return date</span><input type="date" value={actualReturnDate} onChange={(e) => setActualReturnDate(e.target.value)}/></label><label><span>Return origin</span><input value={returnOrigin} onChange={(e) => setReturnOrigin(e.target.value)}/></label><label><span>Receiving location</span><input value={receivingLocation} onChange={(e) => setReceivingLocation(e.target.value)}/></label><label><span>Vehicle</span><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)}/></label><label><span>Driver</span><input value={driverName} onChange={(e) => setDriverName(e.target.value)}/></label><label><span>Driver phone</span><input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)}/></label></div>
      {lines.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Item / Asset</th><th>Outbound</th><th>Previously Returned</th><th>Outstanding</th><th>Returning Now</th><th>Condition on Return</th><th>Exception</th></tr></thead><tbody>{lines.map((line, i) => <tr key={line.gatewayPassItemId}><td><strong>{line.itemDescription}</strong><small>{line.unit}</small></td><td>{line.outbound}</td><td>{line.previous}</td><td>{line.outstanding}</td><td><input style={{ width: 76 }} type="number" min="0" max={line.outstanding} step="1" value={line.quantityReturned} onChange={(e) => patchLine(i, { quantityReturned: Math.max(0, Math.min(line.outstanding, Math.round(Number(e.target.value) || 0))) })}/></td><td><select value={line.conditionOnReturn} onChange={(e) => patchLine(i, { conditionOnReturn: e.target.value })}><option>Good</option><option>Fair</option><option>Damaged</option><option>Missing Parts</option><option>Not Working</option></select></td><td><select value={line.discrepancyType} onChange={(e) => patchLine(i, { discrepancyType: e.target.value })}><option value="">None</option><option>Damage</option><option>Shortage</option><option>Serial Mismatch</option><option>Other</option></select><textarea rows={2} value={line.discrepancyNotes} onChange={(e) => patchLine(i, { discrepancyNotes: e.target.value })} placeholder="Exception details"/></td></tr>)}</tbody></table></div> : <Empty text={selectedGateway ? "Select the Gateway Pass again to load its outstanding items." : "Choose an approved Gateway Pass to start reconciliation."}/>}
      <div className="parity-row">{editingId ? <button onClick={() => { setEditingId(null); setLines([]); }}>Cancel Edit</button> : null}<button className="parity-primary" disabled={busy === "save" || !lines.length} onClick={() => void save()}><CheckCircle2 size={14}/>{busy === "save" ? "Saving…" : editingId ? "Save Changes" : "Create Return Pass Draft"}</button></div>
    </section>

    {drafts.length ? <section><div className="parity-section-head"><div><h3>Drafts / Corrections</h3><p>Edit before submission, or correct a Return Pass sent back by Logistics Manager.</p></div><span>{drafts.length}</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Return Pass</th><th>Gateway Pass</th><th>Status</th><th>Return Date</th><th>Action</th></tr></thead><tbody>{drafts.map((r: any) => <tr key={r.id}><td><strong>{r.return_pass_number}</strong>{r.approval_note ? <small>Correction: {r.approval_note}</small> : null}</td><td>{r.gateway_pass_number}</td><td><Status>{r.status}</Status></td><td>{dateText(r.actual_return_date)}</td><td><div className="table-actions"><button onClick={() => editReturn(r)}><Pencil size={13}/>Edit</button><button disabled={busy === "submit-" + r.id} onClick={() => void submit(r.id)}><Send size={13}/>{busy === "submit-" + r.id ? "Submitting…" : "Submit"}</button></div></td></tr>)}</tbody></table></div></section> : null}

    <section><div className="parity-section-head"><div><h3>Return Pass Register</h3><p>Approved and partial returns remain linked to their original Gateway Pass.</p></div><span>{data.returnPasses.length} record(s)</span></div>{data.returnPasses.length ? <div className="parity-stack">{data.returnPasses.map((r: any) => <article className="parity-review-card" key={r.id}><ReturnPassDetails row={r} data={data}/>{approvedReturnStatus(r.status) ? <div className="parity-row"><a className="parity-primary link" href={"/api/return-pass/" + r.id + "/pdf"} target="_blank" rel="noreferrer"><FileText size={14}/>Open / Print Return Pass</a><a href={"/api/return-pass/" + r.id + "/pdf?download=1"}>Download PDF</a></div> : null}</article>)}</div> : <Empty text="No Return Passes have been created yet."/>}</section>
  </div>;
}

function LogisticsReview({ data }: { data: ParityData }) {
  const router = useRouter();
  const queue = data.returnPassReviewQueue;
  const [selectedId, setSelectedId] = useState<number | null>(queue[0]?.id ?? null);
  const selected = queue.find((r: any) => Number(r.id) === Number(selectedId)) || queue[0] || null;
  const [note, setNote] = useState("");
  const [checkpoint, setCheckpoint] = useState("Main Gate");
  const [securityOfficer, setSecurityOfficer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<any>(null);
  async function decide(decision: "approve" | "return" | "reject") {
    if (!selected) return;
    if (decision !== "approve" && note.trim().length < 4) return setMsg({ type: "error", text: "Enter a clear reason before returning or rejecting the Return Pass." });
    setBusy(decision); setMsg(null);
    try {
      const result = await post("return-pass-review", { returnPassId: selected.id, decision, note, securityCheckpoint: checkpoint, securityOfficerName: securityOfficer, gateVerificationTime: new Date().toISOString() });
      setMsg({ type: "success", text: decision === "approve" ? "Return verified. Gateway reconciliation is now " + result.gatewayReturnStatus + "." : "Return Pass decision recorded." });
      setNote(""); router.refresh();
    } catch (e) { setMsg({ type: "error", text: e instanceof Error ? e.message : "Unable to review Return Pass." }); }
    finally { setBusy(null); }
  }
  return <div className="parity-stack">
    <section className="parity-info"><ShieldCheck size={17}/><div><strong>Logistics Manager return verification</strong><span>Check the physical quantities, condition and gate/security details. Approve completes this Return Pass; Return for Correction sends it back to Facility; Reject closes this Return Pass without counting its quantities.</span></div></section>
    <Message value={msg}/>
    {queue.length ? <><section className="parity-form-card"><label><span>Submitted Return Pass</span><select value={selected?.id ?? ""} onChange={(e) => setSelectedId(Number(e.target.value))}>{queue.map((r: any) => <option key={r.id} value={r.id}>{r.return_pass_number} · {r.gateway_pass_number} · {r.department || "Facility"}</option>)}</select></label></section>{selected ? <article className="parity-review-card"><ReturnPassDetails row={selected} data={data}/><div className="parity-form-grid"><label><span>Security checkpoint</span><input value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)}/></label><label><span>Security officer</span><input value={securityOfficer} onChange={(e) => setSecurityOfficer(e.target.value)} placeholder="Name / identifier"/></label><label className="wide"><span>Verification note / reason</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Verification note or mandatory correction/rejection reason"/></label></div><div className="parity-row"><button disabled={busy !== null} onClick={() => void decide("return")}>Return for Correction</button><button className="parity-danger" disabled={busy !== null} onClick={() => void decide("reject")}><XCircle size={14}/>Reject Return Pass</button><button className="parity-primary" disabled={busy !== null} onClick={() => void decide("approve")}><CheckCircle2 size={14}/>{busy === "approve" ? "Verifying…" : "Verify Return"}</button></div></article> : null}</> : <Empty text="No Return Pass is waiting for Logistics Manager verification."/>}
  </div>;
}

function ReadOnlyRegister({ data, role }: { data: ParityData; role: ProcureFlowRole }) {
  const rows = useMemo(() => data.returnPasses, [data.returnPasses]);
  return <div className="parity-stack"><section className="parity-info"><ShieldCheck size={17}/><div><strong>Return Pass oversight</strong><span>{role === "Procurement Manager" ? "Procurement can monitor return completion and exceptions without taking over Logistics Manager's physical verification authority." : "Read-only management view of completed and in-progress asset returns."}</span></div></section>{rows.length ? rows.map((r: any) => <article className="parity-review-card" key={r.id}><ReturnPassDetails row={r} data={data}/>{approvedReturnStatus(r.status) ? <div className="parity-row"><a className="parity-primary link" href={"/api/return-pass/" + r.id + "/pdf"} target="_blank" rel="noreferrer"><FileText size={14}/>Open Return Pass</a></div> : null}</article>) : <Empty text="No Return Pass records are available yet."/>}</div>;
}

export function ReturnPassWorkspace({ section, role, data }: { section: string; role: ProcureFlowRole; data: ParityData }) {
  if (section === "Return Pass") return <FacilityReturnPass data={data}/>;
  if (section === "Return Pass Review") return <LogisticsReview data={data}/>;
  if (section === "Return Pass Register") return <ReadOnlyRegister data={data} role={role}/>;
  return <Empty text="Return Pass workspace is unavailable."/>;
}

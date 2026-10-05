"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronRight, Circle, Clock3, FileSearch, Search, UsersRound } from "lucide-react";
import type { AdminDashboardData } from "@/lib/procureflow/admin-data";

function money(value: unknown) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(value || 0));
}
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
function ago(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const minutes = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}
function roleLabel(role: unknown) {
  return String(role || "System") === "Logistics Officer" ? "Logistics Manager" : String(role || "System");
}
function Status({ value }: { value: unknown }) { return <span className="status-chip">{String(value || "—")}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }

const ADMIN_GROUPS = [
  { name: "Overview", sections: ["Admin Dashboard"] },
  { name: "Operations", sections: ["Reimbursement Request", "All Procurement Records", "Gateway Pass Management", "Budget Tracker", "Income"] },
  { name: "People & Workflow", sections: ["Action & Exception Centre", "Workflow Intervention Centre", "User Management", "Availability & Delegation Requests"] },
  { name: "Governance", sections: ["Roles & Permissions", "Security & Access Management", "Approval Configuration"] },
  { name: "Evidence & System", sections: ["Import Center", "Notifications Monitor", "Activity & History Logs", "Audit Logs", "Database Viewer", "Backup / Export", "Settings"] },
];

export function AdminGroupedNavigation({ section, onSelect }: { section: string; onSelect: (section: string) => void }) {
  const initial = Object.fromEntries(ADMIN_GROUPS.map((g) => [g.name, true]));
  const [open, setOpen] = useState<Record<string, boolean>>(initial);
  return <nav className="admin-v2-nav">
    {ADMIN_GROUPS.map((group) => <div className="admin-v2-nav-group" key={group.name}>
      <button type="button" className="admin-v2-nav-heading" onClick={() => setOpen((current) => ({ ...current, [group.name]: !current[group.name] }))}>
        <span>{group.name}</span>{open[group.name] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
      </button>
      {open[group.name] ? <div className="admin-v2-nav-items">{group.sections.map((item) => <button type="button" key={item} className={section === item ? "active" : ""} onClick={() => onSelect(item)}><Circle size={7} fill="currentColor"/><span>{item}</span></button>)}</div> : null}
    </div>)}
  </nav>;
}

function StatusBars({ data, onOpenRecords }: { data: AdminDashboardData; onOpenRecords: (status?: string) => void }) {
  const rows = data.requestStatusCounts.slice(0, 10);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return <div className="admin-v2-bars">
    {rows.map((row) => <button type="button" key={row.status} onClick={() => onOpenRecords(row.status)}>
      <div><strong>{row.status}</strong><span>{row.count} request{row.count === 1 ? "" : "s"} · {money(row.amount)}</span></div>
      <div className="admin-v2-bar-track"><span style={{ width: Math.max(4, (row.count / max) * 100) + "%" }}/></div>
    </button>)}
  </div>;
}

function MonthlyChart({ data }: { data: AdminDashboardData }) {
  const max = Math.max(1, ...data.monthlyProcurement.flatMap((row) => [row.requested, row.approved, row.paid]));
  return <div className="admin-v2-monthly-chart">
    <div className="admin-v2-chart-legend"><span><i/>Requested</span><span><i/>Approved</span><span><i/>Paid</span></div>
    <div className="admin-v2-months">{data.monthlyProcurement.map((row) => <div className="admin-v2-month" key={row.month}>
      <div className="admin-v2-columns" title={row.month + " · Requested " + money(row.requested) + " · Approved " + money(row.approved) + " · Paid " + money(row.paid)}>
        <span className="requested" style={{ height: Math.max(3, row.requested / max * 100) + "%" }}/>
        <span className="approved" style={{ height: Math.max(3, row.approved / max * 100) + "%" }}/>
        <span className="paid" style={{ height: Math.max(3, row.paid / max * 100) + "%" }}/>
      </div>
      <strong>{row.month.replace(" 20", " '")}</strong>
    </div>)}</div>
  </div>;
}

function RoleActivityChart({ data }: { data: AdminDashboardData }) {
  const rows = data.roleActivity24h;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return rows.length ? <div className="admin-v2-role-activity">{rows.map((row) => <div key={row.role}>
    <div className="admin-v2-role-line"><strong>{roleLabel(row.role)}</strong><span>{row.count} action{row.count === 1 ? "" : "s"} · latest {ago(row.lastActivityAt)}</span></div>
    <div className="admin-v2-bar-track"><span style={{ width: Math.max(4, row.count / max * 100) + "%" }}/></div>
  </div>)}</div> : <Empty text="No role activity has been recorded in the last 24 hours."/>;
}

export function AdminOperationsDashboardV2({ data, onNavigate, onOpenRecords }: { data: AdminDashboardData; onNavigate: (section: string) => void; onOpenRecords: (status?: string) => void }) {
  const activeSessions = useMemo(() => data.evidence.sessions.filter((s) => String(s.status || "") === "Active" && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now())), [data.evidence.sessions]);
  const recentActivity = data.evidence.activities.slice(0, 10);
  const cards = [
    ["Active Users Now", activeSessions.length, "Live authenticated sessions"],
    ["Requests in Progress", data.metrics.openRequests, "Open procurement pipeline"],
    ["Awaiting Approval", data.metrics.pendingApprovals, "Approver / MD queue"],
    ["Open Purchase Orders", data.metrics.openPOs, "PO / Logistics pipeline"],
    ["Unread Alerts", data.metrics.unreadNotifications, "Organisation-wide notification attention"],
    ["Exceptions", data.exceptions.reduce((sum, row) => sum + (row.severity === "Normal" ? 0 : row.count), 0), "Items requiring Admin attention"],
  ] as const;

  return <div className="admin-v2-dashboard">
    <div className="admin-v2-live-strip"><div><Activity size={16}/><strong>Live operational overview</strong><span>Dashboard refreshes from Neon every 30 seconds while this page is open.</span></div><b>{dateTime(new Date().toISOString())}</b></div>
    <div className="admin-v2-metric-grid">{cards.map(([title, value, caption]) => <article key={title}><span>{title}</span><strong>{Number(value).toLocaleString("en-NG")}</strong><small>{caption}</small></article>)}</div>

    <div className="admin-v2-dashboard-grid">
      <section className="admin-v2-card admin-v2-wide"><header><div><h3>Procurement status</h3><p>Click a status to open that exact group in All Procurement Records.</p></div><button onClick={() => onOpenRecords()}>Open all records</button></header><StatusBars data={data} onOpenRecords={onOpenRecords}/></section>
      <section className="admin-v2-card"><header><div><h3>Active users</h3><p>Authenticated users currently represented by active sessions.</p></div><UsersRound size={18}/></header>{activeSessions.length ? <div className="admin-v2-active-users">{activeSessions.slice(0, 8).map((session) => <div key={session.id}><span className="admin-v2-presence-dot"/><div><strong>{session.userName || session.username || "User"}</strong><small>{roleLabel(session.role)} · last seen {ago(session.lastSeenAt || session.loginAt)}</small></div></div>)}</div> : <Empty text="No active sessions are currently recorded."/>}</section>

      <section className="admin-v2-card admin-v2-wide"><header><div><h3>Procurement value — last 6 months</h3><p>Requested, approved and paid values from production records.</p></div></header><MonthlyChart data={data}/></section>
      <section className="admin-v2-card"><header><div><h3>Role activity — last 24 hours</h3><p>Actions recorded by each role.</p></div></header><RoleActivityChart data={data}/></section>

      <section className="admin-v2-card admin-v2-wide"><header><div><h3>Bottleneck monitor</h3><p>Operational items that may require Admin attention.</p></div><Clock3 size={18}/></header><div className="admin-v2-bottlenecks">{data.bottlenecks.map((row) => <button type="button" key={row.key} className={row.count ? "attention" : ""} onClick={() => row.section === "All Procurement Records" ? onOpenRecords(row.statusFilter || undefined) : onNavigate(row.section)}><span>{row.title}</span><strong>{row.count}</strong><small>{row.detail}</small></button>)}</div></section>
      <section className="admin-v2-card"><header><div><h3>Live user activity</h3><p>Most recent recorded actions across ProcureFlow.</p></div></header>{recentActivity.length ? <div className="admin-v2-feed">{recentActivity.map((row) => <div key={row.id}><span>{roleLabel(row.role)}</span><strong>{row.action}</strong><p>{row.summary || row.entityType || "ProcureFlow activity"}</p><small>{ago(row.createdAt)}</small></div>)}</div> : <Empty text="No recent activity is recorded."/>}</section>
    </div>
  </div>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="admin-v2-detail-section"><h4>{title}</h4>{children}</section>;
}

export function AdminProcurementRecordsV2({ data, initialStatus }: { data: AdminDashboardData; initialStatus?: string }) {
  const statuses = data.requestStatusCounts.map((row) => row.status);
  const [status, setStatus] = useState(initialStatus || "All");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => { setStatus(initialStatus || "All"); }, [initialStatus]);

  const rows = useMemo(() => data.requestDetails.filter((row) => {
    if (status !== "All" && String(row.status || "Unspecified") !== status) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [row.requestNo, row.departmentProject, row.category, row.requestedBy, row.status, row.paymentStatus, row.nextRole, row.selectedVendor].filter(Boolean).join(" ").toLowerCase().includes(needle);
  }), [data.requestDetails, q, status]);

  const selected = data.requestDetails.find((row) => row.id === selectedId) || null;
  const items = selected ? data.requestItems.filter((row) => row.requestId === selected.id) : [];
  const quotes = selected ? data.evidence.quotes.filter((row) => row.requestNo === selected.requestNo) : [];
  const pos = selected ? data.evidence.purchaseOrders.filter((row) => row.requestNo === selected.requestNo) : [];
  const payments = selected ? data.evidence.payments.filter((row) => row.requestNo === selected.requestNo) : [];
  const receipts = selected ? data.evidence.receipts.filter((row) => row.requestNo === selected.requestNo) : [];
  const receiving = selected ? data.evidence.receiving.filter((row) => row.requestNo === selected.requestNo) : [];
  const workflow = selected ? data.evidence.workflow.filter((row) => row.entityId === selected.id && /purchase request|request/i.test(String(row.entityType || ""))) : [];
  const approvals = selected ? data.evidence.approvals.filter((row) => row.entityId === selected.id && /purchase request|request/i.test(String(row.entityType || ""))) : [];

  return <div className="admin-v2-records">
    <section className="admin-v2-record-controls">
      <div className="admin-v2-record-search"><Search size={15}/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search request number, department, category, requester, vendor…"/></div>
      <label><span>Status</span><select value={status} onChange={(e) => { setStatus(e.target.value); setSelectedId(null); }}><option value="All">All procurement records</option>{statuses.map((s) => <option value={s} key={s}>{s} ({data.requestStatusCounts.find((row) => row.status === s)?.count || 0})</option>)}</select></label>
    </section>

    <div className="admin-v2-status-chips"><button className={status === "All" ? "active" : ""} onClick={() => setStatus("All")}>All <b>{data.requestDetails.length}</b></button>{data.requestStatusCounts.slice(0, 8).map((row) => <button className={status === row.status ? "active" : ""} key={row.status} onClick={() => { setStatus(row.status); setSelectedId(null); }}>{row.status} <b>{row.count}</b></button>)}</div>

    <div className="admin-v2-record-summary"><strong>{rows.length} record{rows.length === 1 ? "" : "s"}</strong><span>{status === "All" ? "All statuses" : status} · click any request number to open the full transaction view</span></div>
    {rows.length ? <div className="table-wrap"><table className="data-table admin-v2-request-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Payment</th><th>Next role</th><th>Updated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={selectedId === row.id ? "selected" : ""} onClick={() => setSelectedId(row.id)}><td><button type="button" className="admin-v2-request-link"><FileSearch size={13}/><span><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></span></button></td><td>{row.departmentProject || "—"}<small>{row.requestedBy || "—"} · {roleLabel(row.requesterRole)}</small></td><td>{row.category || "—"}</td><td>{money(row.estimatedAmount)}</td><td><Status value={row.status}/></td><td>{row.paymentStatus || "—"}</td><td>{roleLabel(row.nextRole)}</td><td>{dateText(row.updatedAt)}</td></tr>)}</tbody></table></div> : <Empty text="No procurement records match this status/search filter."/>}

    {selected ? <article className="admin-v2-request-360">
      <header><div><span>Purchase Request 360°</span><h3>{selected.requestNo}</h3><p>Read-only Admin view of the complete procurement transaction and its linked evidence.</p></div><div><Status value={selected.status}/><button type="button" onClick={() => setSelectedId(null)}>Close details</button></div></header>

      <div className="admin-v2-facts">
        <div><span>Requester</span><strong>{selected.requestedBy || "—"}</strong><small>{roleLabel(selected.requesterRole)}</small></div>
        <div><span>Department / Project</span><strong>{selected.departmentProject || "—"}</strong></div>
        <div><span>Category</span><strong>{selected.category || "—"}</strong></div>
        <div><span>Priority</span><strong>{selected.priority || "Normal"}</strong></div>
        <div><span>Estimated Amount</span><strong>{money(selected.estimatedAmount)}</strong></div>
        <div><span>Payment Status</span><strong>{selected.paymentStatus || "—"}</strong></div>
        <div><span>Current Owner</span><strong>{roleLabel(selected.nextRole)}</strong></div>
        <div><span>Selected Vendor</span><strong>{selected.selectedVendor || "Not selected"}</strong></div>
      </div>

      <DetailSection title="Request information"><div className="admin-v2-detail-grid">
        <div><span>Business justification</span><p>{selected.justification || "No justification recorded."}</p></div>
        <div><span>Notes</span><p>{selected.notes || "No additional notes."}</p></div>
        <div><span>Vendor preference</span><p>{selected.vendorPreference || "No preference recorded."}</p></div>
        <div><span>Source / dates</span><p>{selected.sourceType || "Manual"} · Requested {dateText(selected.requestDate)} · Required {dateText(selected.requiredDate)}</p></div>
        <div><span>Facility / Procurement</span><p>Facility: {selected.facilityManager || "—"} · Procurement: {selected.procurementManager || "—"}</p></div>
        <div><span>Approval</span><p>{selected.approvedAt ? "Approved " + dateTime(selected.approvedAt) + " by " + (selected.approvedBy || roleLabel(selected.approvedByRole)) : "Not approved yet"}{selected.approvalRescindedAt ? " · Rescinded " + dateTime(selected.approvalRescindedAt) + ": " + (selected.approvalRescindedReason || "No reason") : ""}</p></div>
      </div></DetailSection>

      <DetailSection title={"Requested items (" + items.length + ")"}>{items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Suggested vendor</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.itemName}</strong><small>{item.category || ""}</small></td><td>{item.description || "—"}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(item.total)}</td><td>{item.suggestedVendor || "—"}</td></tr>)}</tbody></table></div> : <Empty text="No item lines are linked to this request."/>}</DetailSection>

      <DetailSection title={"Sourcing & vendor quotations (" + quotes.length + ")"}>{quotes.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Vendor</th><th>Quote</th><th>Delivery</th><th>Terms</th><th>Score</th><th>Outcome</th></tr></thead><tbody>{quotes.map((row) => <tr key={row.id}><td>{row.vendorName || "—"}</td><td>{money(row.quotedAmount)}</td><td>{row.deliveryDays == null ? "—" : row.deliveryDays + " days"}</td><td>{row.paymentTerms || "—"}</td><td>{row.score ?? "—"}</td><td>{row.selected ? "Selected" : row.recommended ? "Recommended" : "Quoted"}</td></tr>)}</tbody></table></div> : <Empty text="No vendor quotations are linked to this request."/>}</DetailSection>

      <DetailSection title="Approval & workflow trail"><div className="admin-v2-timeline">{[...workflow.map((row) => ({ key: "w-" + row.id, at: row.createdAt, title: row.event, meta: row.status, note: row.note, by: row.userName })), ...approvals.map((row) => ({ key: "a-" + row.id, at: row.createdAt, title: row.action, meta: [row.before, row.after].filter(Boolean).join(" → "), note: row.note, by: row.approvedBy || roleLabel(row.approvedByRole) }))].sort((a, b) => new Date(String(b.at || 0)).getTime() - new Date(String(a.at || 0)).getTime()).map((row) => <div key={row.key}><span>{dateTime(row.at)}</span><strong>{row.title}</strong><small>{row.meta || "—"}{row.by ? " · " + row.by : ""}</small>{row.note ? <p>{row.note}</p> : null}</div>)}{!workflow.length && !approvals.length ? <Empty text="No workflow or approval history is linked to this request."/> : null}</div></DetailSection>

      <DetailSection title={"Purchase orders & receiving (" + pos.length + " PO)"}>{pos.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>PO</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Logistics</th><th>Receiving</th></tr></thead><tbody>{pos.map((row) => <tr key={row.id}><td><strong>{row.poNo}</strong></td><td>{row.vendorName || "—"}</td><td>{money(row.amount)}</td><td>{row.status || "—"}</td><td>{row.logisticsStatus || "—"}</td><td>{row.receivingStatus || "—"}</td></tr>)}</tbody></table></div> : <Empty text="No purchase order is linked to this request."/>}{receiving.length ? <div className="admin-v2-mini-list">{receiving.map((row) => <div key={row.id}><strong>{row.slipNo}</strong><span>{dateText(row.dateReceived)} · {row.status || "—"} · {row.discrepancyNotes || "No discrepancy"}</span></div>)}</div> : null}</DetailSection>

      <DetailSection title={"Finance, payments & receipts (" + payments.length + " payment)"}>{payments.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Payment</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Verification</th><th>Reference</th><th>Date</th></tr></thead><tbody>{payments.map((row) => <tr key={row.id}><td><strong>{row.paymentNo}</strong></td><td>{row.vendorName || "—"}</td><td>{money(row.amount)}</td><td>{row.status || "—"}</td><td>{row.verificationStatus || "—"}</td><td>{row.paymentReference || "—"}</td><td>{dateText(row.paymentDate || row.createdAt)}</td></tr>)}</tbody></table></div> : <Empty text="No payment is linked to this request."/>}{receipts.length ? <div className="admin-v2-mini-list">{receipts.map((row) => <div key={row.id}><strong>{row.receiptNo}</strong><span>{row.receiptType || "Receipt"} · {money(row.amount)} · {row.status || "—"} · {dateText(row.createdAt)}</span></div>)}</div> : null}</DetailSection>
    </article> : null}
  </div>;
}

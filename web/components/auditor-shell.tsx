"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Circle, FileSearch, LogOut, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS } from "@/lib/procureflow/roles";
import type { AuditorDashboardData } from "@/lib/procureflow/auditor-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";

type ShellUser = { id: number; fullName: string; username: string; role: "Auditor" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AU";
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function money(value: number, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-NG")}`;
  }
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function SectionStack({ children }: { children: ReactNode }) {
  return <div className="auditor-stack">{children}</div>;
}

function AuditEvents({ rows }: { rows: AuditorDashboardData["auditEvents"] }) {
  if (!rows.length) return <Empty text="No immutable audit events are available." />;
  return (
    <div className="table-wrap"><table className="data-table auditor-table"><thead><tr>
      <th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Severity</th><th>Source</th><th>Key</th>
    </tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td>{dateText(row.occurredAt)}</td>
      <td><strong>{row.action}</strong><small>{row.reason || row.correlationId || ""}</small></td>
      <td>{row.actorUsername || "System"}<small>{row.actorRole || ""}</small></td>
      <td>{row.entityType || "—"}<small>{row.entityReference || row.entityId || ""}</small></td>
      <td><span className="status-chip">{row.outcome || "—"}</span></td>
      <td><span className={`auditor-severity ${(row.severity || "normal").toLowerCase()}`}>{row.severity || "Normal"}</span></td>
      <td>{row.source || "—"}</td><td>{row.signatureKeyVersion || "—"}</td>
    </tr>)}</tbody></table></div>
  );
}

function Activities({ rows }: { rows: AuditorDashboardData["activities"] }) {
  if (!rows.length) return <Empty text="No activity records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Role</th><th>Action</th><th>Entity</th><th>Summary</th><th>Visibility</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateText(row.createdAt)}</td><td>{row.role || "—"}</td><td><strong>{row.action}</strong></td><td>{row.entityType || "—"} {row.entityId ? `#${row.entityId}` : ""}</td><td>{row.summary || "—"}</td><td>{row.visibility || "—"}</td></tr>)}</tbody></table></div>;
}

function Workflow({ rows }: { rows: AuditorDashboardData["workflow"] }) {
  if (!rows.length) return <Empty text="No workflow events are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Entity</th><th>Event</th><th>Status</th><th>User</th><th>Note</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateText(row.createdAt)}</td><td>{row.entityType} #{row.entityId}</td><td><strong>{row.event}</strong></td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.userName || "—"}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div>;
}

function Approvals({ rows }: { rows: AuditorDashboardData["approvals"] }) {
  if (!rows.length) return <Empty text="No approval trail records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Entity</th><th>Action</th><th>Before</th><th>After</th><th>Approved by</th><th>Mode</th><th>Note</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateText(row.createdAt)}</td><td>{row.entityType} #{row.entityId}</td><td><strong>{row.action}</strong></td><td>{row.before || "—"}</td><td><span className="status-chip">{row.after || "—"}</span></td><td>{row.approvedBy || row.approvedByRole || "—"}</td><td>{row.approvalMode || "—"}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div>;
}

function Requests({ rows }: { rows: AuditorDashboardData["requests"] }) {
  if (!rows.length) return <Empty text="No procurement requests are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Payment</th><th>Next role</th><th>Participants</th><th>Updated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.requestNo}</strong></td><td>{row.departmentProject || "—"}</td><td>{row.category || "—"}</td><td className="amount-cell">{money(row.amount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.paymentStatus || "—"}</td><td>{row.nextRole || "—"}</td><td>{row.facilityManager || row.requestedBy || "—"}<small>{row.procurementManager ? `PM: ${row.procurementManager}` : ""}</small></td><td>{dateText(row.updatedAt)}</td></tr>)}</tbody></table></div>;
}

function Quotes({ rows }: { rows: AuditorDashboardData["quotes"] }) {
  if (!rows.length) return <Empty text="No vendor quote records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Request</th><th>Vendor</th><th>Quote</th><th>Delivery</th><th>Terms</th><th>Score</th><th>Recommendation</th><th>Created</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.requestNo || "—"}</td><td><strong>{row.vendorName || "—"}</strong></td><td className="amount-cell">{money(row.quotedAmount, row.currency || "NGN")}</td><td>{row.deliveryDays == null ? "—" : `${row.deliveryDays} days`}</td><td>{row.paymentTerms || "—"}</td><td>{row.score == null ? "—" : row.score}</td><td>{row.selected ? "Selected" : row.recommended ? "Recommended" : "—"}</td><td>{dateText(row.createdAt)}</td></tr>)}</tbody></table></div>;
}

function PurchaseOrders({ rows }: { rows: AuditorDashboardData["purchaseOrders"] }) {
  if (!rows.length) return <Empty text="No purchase order evidence is available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>PO</th><th>Request</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Logistics</th><th>Receiving</th><th>Payment</th><th>Approved by</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.poNo}</strong></td><td>{row.requestNo || "—"}</td><td>{row.vendorName || "—"}</td><td className="amount-cell">{money(row.amount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.logisticsStatus || "—"}</td><td>{row.receivingStatus || "—"}</td><td>{row.paymentStatus || "—"}</td><td>{row.approvedByRole || "—"}</td></tr>)}</tbody></table></div>;
}

function Receiving({ rows }: { rows: AuditorDashboardData["receiving"] }) {
  if (!rows.length) return <Empty text="No receiving slips are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Slip</th><th>PO / Request</th><th>Vendor</th><th>Received by</th><th>Date</th><th>Delivery note</th><th>Status</th><th>Discrepancy</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.slipNo}</strong></td><td>{row.poNo || "—"}<small>{row.requestNo || ""}</small></td><td>{row.vendorName || "—"}</td><td>{row.receivedBy || "—"}</td><td>{dateText(row.dateReceived)}</td><td>{row.deliveryNoteNo || "—"}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.discrepancyNotes || "—"}</td></tr>)}</tbody></table></div>;
}

function Exceptions({ rows }: { rows: AuditorDashboardData["exceptions"] }) {
  if (!rows.length) return <Empty text="No logistics exceptions have been recorded." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Exception</th><th>PO / Request</th><th>Type</th><th>Description</th><th>Payment impact</th><th>Status</th><th>Resolution</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.exceptionNo}</strong></td><td>{row.poNo || "—"}<small>{row.requestNo || ""}</small></td><td>{row.exceptionType}</td><td>{row.description}</td><td>{row.paymentImpact ? "Yes" : "No"}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.resolutionNote || "—"}</td></tr>)}</tbody></table></div>;
}

function Payments({ rows }: { rows: AuditorDashboardData["payments"] }) {
  if (!rows.length) return <Empty text="No payment records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Payment</th><th>Request / PO</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Verification</th><th>Transfer</th><th>Reference</th><th>Date</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.paymentNo}</strong></td><td>{row.requestNo || "—"}<small>{row.poNo || ""}</small></td><td>{row.vendorName || "—"}</td><td className="amount-cell">{money(row.amount, row.currency || "NGN")}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.verificationStatus || "—"}</td><td>{row.transferType || "—"}</td><td>{row.paymentReference || "—"}</td><td>{dateText(row.paymentDate || row.createdAt)}</td></tr>)}</tbody></table></div>;
}

function Notifications({ rows }: { rows: AuditorDashboardData["notifications"] }) {
  if (!rows.length) return <Empty text="No notification delivery records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Recipient</th><th>Title</th><th>Entity</th><th>Importance</th><th>Read</th><th>Channel</th><th>Push</th><th>Email</th><th>Section</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateText(row.createdAt)}</td><td>{row.userName || row.role || "—"}</td><td><strong>{row.title}</strong></td><td>{row.entityType || "—"} {row.entityId ? `#${row.entityId}` : ""}</td><td>{row.importance || "—"}</td><td>{row.read ? "Read" : "Unread"}</td><td>{row.deliveryChannel || "—"}</td><td>{row.pushSent ? "Sent" : "—"}</td><td>{row.emailSent ? "Sent" : "—"}</td><td>{row.sectionTarget || "—"}</td></tr>)}</tbody></table></div>;
}

function Users({ data }: { data: AuditorDashboardData }) {
  return <SectionStack>
    <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>User</th><th>Role</th><th>Email</th><th>Active</th><th>Locked</th><th>Failed logins</th><th>Password change</th><th>Last login</th></tr></thead><tbody>{data.users.map((row) => <tr key={row.id}><td><strong>{row.fullName}</strong><small>{row.username}</small></td><td>{row.role}</td><td>{row.email || "—"}</td><td>{row.active ? "Yes" : "No"}</td><td>{row.locked ? "Locked" : "No"}</td><td>{row.failedLoginCount}</td><td>{row.mustChangePassword ? "Required" : "No"}</td><td>{dateText(row.lastLoginAt)}</td></tr>)}</tbody></table></div>
    <h3 className="auditor-subhead">Session evidence</h3>
    <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>User</th><th>Role</th><th>Login</th><th>Last seen</th><th>Status</th><th>IP</th><th>Expires</th></tr></thead><tbody>{data.sessions.map((row) => <tr key={row.id}><td>{row.userName || row.username || "—"}</td><td>{row.role || "—"}</td><td>{dateText(row.loginAt)}</td><td>{dateText(row.lastSeenAt)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.ipAddress || "—"}</td><td>{dateText(row.expiresAt)}</td></tr>)}</tbody></table></div>
  </SectionStack>;
}

function Vendors({ rows }: { rows: AuditorDashboardData["vendors"] }) {
  if (!rows.length) return <Empty text="No vendor history is available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Vendor</th><th>Category</th><th>Status</th><th>Rating</th><th>Completed</th><th>Total spend</th><th>Avg delivery</th><th>Rejections</th><th>Last purchase</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.category || "—"}</td><td>{row.status || "—"}</td><td>{row.rating ?? "—"}</td><td>{row.completedOrders}</td><td>{money(row.totalSpend)}</td><td>{row.averageDeliveryTime == null ? "—" : `${row.averageDeliveryTime} days`}</td><td>{row.rejectionCount}</td><td>{dateText(row.lastPurchaseDate)}</td></tr>)}</tbody></table></div>;
}

function Budgets({ rows }: { rows: AuditorDashboardData["budgets"] }) {
  if (!rows.length) return <Empty text="No budget records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Month</th><th>Department / Project</th><th>Category</th><th>Limit</th><th>Override</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.month}</strong></td><td>{row.departmentProject || "—"}</td><td>{row.category || "—"}</td><td>{money(row.limitAmount)}</td><td>{row.overrideRequired ? "Required" : "No"}</td></tr>)}</tbody></table></div>;
}

function PayeeAudit({ rows }: { rows: AuditorDashboardData["payeeAudit"] }) {
  if (!rows.length) return <Empty text="No payee-access audit events are available." />;
  return <SectionStack>
    <div className="auditor-sensitive-note"><ShieldCheck size={17} /><div><strong>Masked audit only</strong><span>This view deliberately exposes audit actions and reasons, not encrypted or unmasked bank-account values.</span></div></div>
    <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Severity</th><th>Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateText(row.occurredAt)}</td><td><strong>{row.action}</strong></td><td>{row.actorUsername || "System"}<small>{row.actorRole || ""}</small></td><td>{row.entityReference || row.entityId || "—"}</td><td>{row.outcome || "—"}</td><td>{row.severity || "—"}</td><td>{row.reason || "—"}</td></tr>)}</tbody></table></div>
  </SectionStack>;
}

function Gateways({ rows }: { rows: AuditorDashboardData["gateways"] }) {
  if (!rows.length) return <Empty text="No gateway pass records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Pass</th><th>Facility Head</th><th>Department</th><th>Movement</th><th>Destination</th><th>Status</th><th>Logistics</th><th>Approved by</th><th>Updated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.passNumber}</strong></td><td>{row.facilityManager || "—"}</td><td>{row.department || "—"}</td><td>{row.movementType}</td><td>{row.destination || "—"}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.logisticsStatus || "—"}</td><td>{row.approvedByRole || "—"}</td><td>{dateText(row.updatedAt || row.createdAt)}</td></tr>)}</tbody></table></div>;
}

function Receipts({ rows }: { rows: AuditorDashboardData["receipts"] }) {
  if (!rows.length) return <Empty text="No receipt/document evidence is available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Receipt</th><th>Request / Payment / PO</th><th>Vendor</th><th>Type</th><th>Amount</th><th>Status</th><th>Document</th><th>OCR</th><th>Discrepancy</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.receiptNo}</strong><small>{dateText(row.createdAt)}</small></td><td>{row.requestNo || "—"}<small>{[row.paymentNo, row.poNo].filter(Boolean).join(" · ")}</small></td><td>{row.vendorName || "—"}</td><td>{row.receiptType || row.paymentMethod || "—"}</td><td>{money(row.amount, row.currency || "NGN")}</td><td>{row.status || "—"}</td><td>{row.originalFileName || "Recorded metadata"}<small>{row.fileChecksum ? `Checksum: ${row.fileChecksum.slice(0, 12)}…` : ""}</small></td><td>{row.ocrStatus || "—"}</td><td>{row.discrepancyStatus || "—"}</td></tr>)}</tbody></table></div>;
}

export function AuditorShell({ user, data, securityStatus }: { user: ShellUser; data: AuditorDashboardData; securityStatus: SecurityMigrationStatus }) {
  const router = useRouter();
  const nav = ROLE_SECTIONS.Auditor;
  const [section, setSection] = useState(nav.sections[0]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const cards = [
    ["Audit Events", String(data.metrics.auditEvents), "Immutable evidence"],
    ["High Severity", String(data.metrics.highSeverity), "Review priority"],
    ["Exceptions / Warnings", String(data.metrics.exceptionOutcomes), "Denied, failed or warning"],
    ["Active Sessions", String(data.metrics.activeSessions), "Security evidence"],
  ];
  const exceptionEvents = data.auditEvents.filter((row) => ["Denied", "Failure", "Warning"].includes(String(row.outcome || "")) || String(row.severity || "") === "High");
  const delegated = data.approvals.filter((row) => row.approvalMode && row.approvalMode !== "Normal Approval Mode");

  let content: ReactNode = null;
  if (section === "Role Activity Mirrors") content = <Activities rows={data.activities} />;
  else if (section === "Transaction 360") content = <SectionStack><Requests rows={data.requests} /><h3 className="auditor-subhead">Workflow chain</h3><Workflow rows={data.workflow} /></SectionStack>;
  else if (section === "User 360") content = <Users data={data} />;
  else if (section === "Exception Centre") content = <SectionStack><AuditEvents rows={exceptionEvents} /><h3 className="auditor-subhead">Logistics exceptions</h3><Exceptions rows={data.exceptions} /></SectionStack>;
  else if (section === "All Activity & Evidence Ledger") content = <AuditEvents rows={data.auditEvents} />;
  else if (section === "Procurement Records") content = <Requests rows={data.requests} />;
  else if (section === "Sourcing & Vendor Quote Audit") content = <Quotes rows={data.quotes} />;
  else if (section === "Purchase Order & Logistics Evidence") content = <SectionStack><PurchaseOrders rows={data.purchaseOrders} /><h3 className="auditor-subhead">Delivery exceptions</h3><Exceptions rows={data.exceptions} /></SectionStack>;
  else if (section === "Receiving Slips, Proof of Delivery & Returns") content = <Receiving rows={data.receiving} />;
  else if (section === "Finance, Invoice & Payment Audit") content = <SectionStack><Payments rows={data.payments} /><h3 className="auditor-subhead">Receipt evidence</h3><Receipts rows={data.receipts} /></SectionStack>;
  else if (section === "Approval Trails") content = <Approvals rows={data.approvals} />;
  else if (section === "Delegated Approval Review") content = <Approvals rows={delegated} />;
  else if (section === "Payment Payee / Bank Detail Access Audit") content = <PayeeAudit rows={data.payeeAudit} />;
  else if (section === "Gateway Pass Audit") content = <Gateways rows={data.gateways} />;
  else if (section === "Document Archive & Download Audit") content = <Receipts rows={data.receipts} />;
  else if (section === "Notification Delivery Audit") content = <Notifications rows={data.notifications} />;
  else if (section === "User & Security Audit") content = <Users data={data} />;
  else if (section === "Vendor History") content = <Vendors rows={data.vendors} />;
  else if (section === "Budget Audit") content = <Budgets rows={data.budgets} />;
  else if (section === "Facility / Utility Handoff Trail") content = <Requests rows={data.requests} />;
  else if (section === "Expense Review") content = <Empty text="The migrated production database contains no legacy expense rows. Finance payment and receipt evidence is available in Finance, Invoice & Payment Audit." />;
  else if (section === "Compliance Reports") content = <div className="auditor-compliance-grid">
    <article><span>Immutable audit events</span><strong>{data.metrics.auditEvents}</strong><small>{securityStatus.legacyAuditEventCount} preserved legacy events</small></article>
    <article><span>High severity</span><strong>{data.metrics.highSeverity}</strong><small>Evidence requiring priority review</small></article>
    <article><span>Warnings / denials</span><strong>{data.metrics.exceptionOutcomes}</strong><small>Outcome exceptions</small></article>
    <article><span>Unread notifications</span><strong>{data.metrics.unreadNotifications}</strong><small>Delivery/attention evidence</small></article>
    <article><span>Active v2 chain</span><strong>{securityStatus.activeAuditChainStarted ? "Started" : "Not started"}</strong><small>{securityStatus.activeAuditKeyVerified ? "Key verified" : "Write guard locked"}</small></article>
    <article><span>Open logistics exceptions</span><strong>{data.metrics.openLogisticsExceptions}</strong><small>Current operational exceptions</small></article>
  </div>;
  else if (section === "Income") content = <Empty text="Income remains in the migration queue. No Auditor-side income write action is being introduced." />;
  else if (section === "Settings") content = <Empty text="Shared account settings remain in the migration queue." />;

  return <main className="app-frame">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div>
      <div className="sidebar-context"><span>{nav.title}</span><strong>{ROLE_LABELS.Auditor}</strong></div>
      <nav className="sidebar-nav">{nav.sections.map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}><Circle size={8} fill="currentColor" /><span>{item}</span></button>)}</nav>
      <div className="sidebar-footer"><button onClick={logout}><LogOut size={16} /><span>Sign out</span></button></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14} /> {section}</div><p>{ROLE_LANDING.Auditor}</p></div><div className="topbar-actions"><div className="user-chip"><span className="avatar">{initials(user.fullName)}</span><div><strong>{user.fullName}</strong><small>{ROLE_LABELS.Auditor}</small></div></div></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><span className="eyebrow">Auditor</span><h1>{section}</h1><p>{section === "Audit Dashboard" ? "Independent read-only evidence view across procurement, approvals, Finance, Logistics, notifications and security." : `ProcureFlow ${section} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark" /></div>
        {section === "Audit Dashboard" ? <>
          <div className="metric-grid">{cards.map(([title, value, caption]) => <article className="metric-card" key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div>
          <div className="dashboard-grid">
            <article className="panel panel-large"><div className="panel-heading"><div><h2>Recent immutable evidence</h2><p>Latest entries from the tamper-evident audit ledger.</p></div><span className="status-pill">Read only</span></div><AuditEvents rows={data.auditEvents.slice(0, 25)} /></article>
            <article className="panel"><div className="panel-heading"><div><h2>Evidence health</h2><p>GCP exit continuity</p></div></div><ul className="status-list"><li><span>Legacy audit preserved</span><b>{securityStatus.legacyAuditPreserved ? "Yes" : "No"}</b></li><li><span>Legacy audit events</span><b>{securityStatus.legacyAuditEventCount}</b></li><li><span>Legacy signatures</span><b>{securityStatus.legacyAuditVerifiable ? "Verifiable" : "Key unavailable"}</b></li><li><span>Active v2 signing key</span><b>{securityStatus.activeAuditKeyVerified ? "Verified" : "Locked"}</b></li><li><span>Active v2 chain</span><b>{securityStatus.activeAuditChainStarted ? "Started" : "Awaiting first write"}</b></li><li><span>Legacy payee rows</span><b>{securityStatus.legacyPayeeEncryptedRows}</b></li></ul><div className="auditor-alert"><AlertTriangle size={16} /><span>Legacy evidence remains immutable. Historical records are not re-signed or silently decrypted after the GCP exit.</span></div></article>
          </div>
        </> : <article className="panel live-section-panel"><div className="panel-heading"><div><h2>{section}</h2><p>Read-only evidence from the migrated Neon production dataset.</p></div><span className="status-pill"><FileSearch size={13} /> Auditor view</span></div>{content}</article>}
      </div>
    </section>
  </main>;
}

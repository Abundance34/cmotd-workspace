"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Circle, FileSearch, LogOut, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS } from "@/lib/procureflow/roles";
import type { AuditorDashboardData } from "@/lib/procureflow/auditor-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";

type ShellUser = { id: number; fullName: string; username: string; role: "Auditor" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join("") || "AU";
}
function dateText(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("en-NG",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}
function money(value: number, currency="NGN") {
  try { return new Intl.NumberFormat("en-NG",{style:"currency",currency,maximumFractionDigits:2}).format(value||0); }
  catch { return `${currency} ${Number(value||0).toLocaleString("en-NG")}`; }
}
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }

function AuditEvents({ rows }: { rows: AuditorDashboardData["auditEvents"] }) {
  if (!rows.length) return <Empty text="No immutable audit events are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Severity</th><th>Source</th><th>Key</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{dateText(r.occurredAt)}</td><td><strong>{r.action}</strong><small>{r.reason||r.correlationId||""}</small></td><td>{r.actorUsername||"System"}<small>{r.actorRole||""}</small></td><td>{r.entityType||"—"}<small>{r.entityReference||r.entityId||""}</small></td><td><span className="status-chip">{r.outcome||"—"}</span></td><td><span className={`auditor-severity ${(r.severity||"normal").toLowerCase()}`}>{r.severity||"Normal"}</span></td><td>{r.source||"—"}</td><td>{r.signatureKeyVersion||"—"}</td></tr>)}</tbody></table></div>;
}
function Activities({ rows }: { rows: AuditorDashboardData["activities"] }) {
  if (!rows.length) return <Empty text="No activity records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Role</th><th>Action</th><th>Entity</th><th>Summary</th><th>Visibility</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.role||"—"}</td><td><strong>{r.action}</strong></td><td>{r.entityType||"—"} {r.entityId?`#${r.entityId}`:""}</td><td>{r.summary||"—"}</td><td>{r.visibility||"—"}</td></tr>)}</tbody></table></div>;
}
function Workflow({ rows }: { rows: AuditorDashboardData["workflow"] }) {
  if (!rows.length) return <Empty text="No workflow events are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Entity</th><th>Event</th><th>Status</th><th>User</th><th>Note</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.entityType} #{r.entityId}</td><td><strong>{r.event}</strong></td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.userName||"—"}</td><td>{r.note||"—"}</td></tr>)}</tbody></table></div>;
}
function Approvals({ rows }: { rows: AuditorDashboardData["approvals"] }) {
  if (!rows.length) return <Empty text="No approval trail records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Entity</th><th>Action</th><th>Before</th><th>After</th><th>Approved by</th><th>Mode</th><th>Note</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.entityType} #{r.entityId}</td><td><strong>{r.action}</strong></td><td>{r.before||"—"}</td><td><span className="status-chip">{r.after||"—"}</span></td><td>{r.approvedBy||r.approvedByRole||"—"}</td><td>{r.approvalMode||"—"}</td><td>{r.note||"—"}</td></tr>)}</tbody></table></div>;
}
function Requests({ rows }: { rows: AuditorDashboardData["requests"] }) {
  if (!rows.length) return <Empty text="No procurement requests are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Payment</th><th>Next role</th><th>Participants</th><th>Updated</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.requestNo}</strong></td><td>{r.departmentProject||"—"}</td><td>{r.category||"—"}</td><td className="amount-cell">{money(r.amount)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.paymentStatus||"—"}</td><td>{r.nextRole||"—"}</td><td>{r.facilityManager||r.requestedBy||"—"}<small>{r.procurementManager?`PM: ${r.procurementManager}`:""}</small></td><td>{dateText(r.updatedAt)}</td></tr>)}</tbody></table></div>;
}
function Quotes({ rows }: { rows: AuditorDashboardData["quotes"] }) {
  if (!rows.length) return <Empty text="No vendor quote records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Request</th><th>Vendor</th><th>Quote</th><th>Delivery</th><th>Terms</th><th>Score</th><th>Recommendation</th><th>Created</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{r.requestNo||"—"}</td><td><strong>{r.vendorName||"—"}</strong></td><td className="amount-cell">{money(r.quotedAmount,r.currency||"NGN")}</td><td>{r.deliveryDays==null?"—":`${r.deliveryDays} days`}</td><td>{r.paymentTerms||"—"}</td><td>{r.score==null?"—":r.score}</td><td>{r.selected?"Selected":r.recommended?"Recommended":"—"}</td><td>{dateText(r.createdAt)}</td></tr>)}</tbody></table></div>;
}
function POs({ rows }: { rows: AuditorDashboardData["purchaseOrders"] }) {
  if (!rows.length) return <Empty text="No purchase order evidence is available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>PO</th><th>Request</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Logistics</th><th>Receiving</th><th>Payment</th><th>Approved by</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.poNo}</strong></td><td>{r.requestNo||"—"}</td><td>{r.vendorName||"—"}</td><td className="amount-cell">{money(r.amount)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.logisticsStatus||"—"}</td><td>{r.receivingStatus||"—"}</td><td>{r.paymentStatus||"—"}</td><td>{r.approvedByRole||"—"}</td></tr>)}</tbody></table></div>;
}
function Receiving({ rows }: { rows: AuditorDashboardData["receiving"] }) {
  if (!rows.length) return <Empty text="No receiving slips are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Slip</th><th>PO / Request</th><th>Vendor</th><th>Received by</th><th>Date</th><th>Delivery note</th><th>Status</th><th>Discrepancy</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.slipNo}</strong></td><td>{r.poNo||"—"}<small>{r.requestNo||""}</small></td><td>{r.vendorName||"—"}</td><td>{r.receivedBy||"—"}</td><td>{dateText(r.dateReceived)}</td><td>{r.deliveryNoteNo||"—"}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.discrepancyNotes||"—"}</td></tr>)}</tbody></table></div>;
}
function Exceptions({ rows }: { rows: AuditorDashboardData["exceptions"] }) {
  if (!rows.length) return <Empty text="No logistics exceptions have been recorded." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Exception</th><th>PO / Request</th><th>Type</th><th>Description</th><th>Payment impact</th><th>Status</th><th>Resolution</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.exceptionNo}</strong></td><td>{r.poNo||"—"}<small>{r.requestNo||""}</small></td><td>{r.exceptionType}</td><td>{r.description}</td><td>{r.paymentImpact?"Yes":"No"}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.resolutionNote||"—"}</td></tr>)}</tbody></table></div>;
}
function Payments({ rows }: { rows: AuditorDashboardData["payments"] }) {
  if (!rows.length) return <Empty text="No payment records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Payment</th><th>Request / PO</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Verification</th><th>Transfer</th><th>Reference</th><th>Date</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.paymentNo}</strong></td><td>{r.requestNo||"—"}<small>{r.poNo||""}</small></td><td>{r.vendorName||"—"}</td><td className="amount-cell">{money(r.amount,r.currency||"NGN")}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.verificationStatus||"—"}</td><td>{r.transferType||"—"}</td><td>{r.paymentReference||"—"}</td><td>{dateText(r.paymentDate||r.createdAt)}</td></tr>)}</tbody></table></div>;
}
function Notifications({ rows }: { rows: AuditorDashboardData["notifications"] }) {
  if (!rows.length) return <Empty text="No notification delivery records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Recipient</th><th>Title</th><th>Entity</th><th>Importance</th><th>Read</th><th>Channel</th><th>Push</th><th>Email</th><th>Section</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.userName||r.role||"—"}</td><td><strong>{r.title}</strong></td><td>{r.entityType||"—"} {r.entityId?`#${r.entityId}`:""}</td><td>{r.importance||"—"}</td><td>{r.read?"Read":"Unread"}</td><td>{r.deliveryChannel||"—"}</td><td>{r.pushSent?"Sent":"—"}</td><td>{r.emailSent?"Sent":"—"}</td><td>{r.sectionTarget||"—"}</td></tr>)}</tbody></table></div>;
}
function Users({ data }: { data: AuditorDashboardData }) {
  return <div className="auditor-stack"><div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>User</th><th>Role</th><th>Email</th><th>Active</th><th>Locked</th><th>Failed logins</th><th>Password change</th><th>Last login</th></tr></thead><tbody>{data.users.map((r)=><tr key={r.id}><td><strong>{r.fullName}</strong><small>{r.username}</small></td><td>{r.role}</td><td>{r.email||"—"}</td><td>{r.active?"Yes":"No"}</td><td>{r.locked?"Locked":"No"}</td><td>{r.failedLoginCount}</td><td>{r.mustChangePassword?"Required":"No"}</td><td>{dateText(r.lastLoginAt)}</td></tr>)}</tbody></table></div><h3 className="auditor-subhead">Session evidence</h3><div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>User</th><th>Role</th><th>Login</th><th>Last seen</th><th>Status</th><th>IP</th><th>Expires</th></tr></thead><tbody>{data.sessions.map((r)=><tr key={r.id}><td>{r.userName||r.username||"—"}</td><td>{r.role||"—"}</td><td>{dateText(r.loginAt)}</td><td>{dateText(r.lastSeenAt)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.ipAddress||"—"}</td><td>{dateText(r.expiresAt)}</td></tr>)}</tbody></table></div></div>;
}
function Vendors({ rows }: { rows: AuditorDashboardData["vendors"] }) {
  if (!rows.length) return <Empty text="No vendor history is available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Vendor</th><th>Category</th><th>Status</th><th>Rating</th><th>Completed</th><th>Total spend</th><th>Avg delivery</th><th>Rejections</th><th>Last purchase</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.category||"—"}</td><td>{r.status||"—"}</td><td>{r.rating??"—"}</td><td>{r.completedOrders}</td><td>{money(r.totalSpend)}</td><td>{r.averageDeliveryTime==null?"—":`${r.averageDeliveryTime} days`}</td><td>{r.rejectionCount}</td><td>{dateText(r.lastPurchaseDate)}</td></tr>)}</tbody></table></div>;
}
function Budgets({ rows }: { rows: AuditorDashboardData["budgets"] }) {
  if (!rows.length) return <Empty text="No budget records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Month</th><th>Department / Project</th><th>Category</th><th>Limit</th><th>Override</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.month}</strong></td><td>{r.departmentProject||"—"}</td><td>{r.category||"—"}</td><td>{money(r.limitAmount)}</td><td>{r.overrideRequired?"Required":"No"}</td></tr>)}</tbody></table></div>;
}
function PayeeAudit({ rows }: { rows: AuditorDashboardData["payeeAudit"] }) {
  if (!rows.length) return <Empty text="No payee-access audit events are available." />;
  return <div className="auditor-sensitive-note"><ShieldCheck size={17}/><div><strong>Masked audit only</strong><span>This view deliberately exposes audit actions and reasons, not encrypted or unmasked bank-account values.</span></div></div> && <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Severity</th><th>Reason</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td>{dateText(r.occurredAt)}</td><td><strong>{r.action}</strong></td><td>{r.actorUsername||"System"}<small>{r.actorRole||""}</small></td><td>{r.entityReference||r.entityId||"—"}</td><td>{r.outcome||"—"}</td><td>{r.severity||"—"}</td><td>{r.reason||"—"}</td></tr>)}</tbody></table></div>;
}
function Gateways({ rows }: { rows: AuditorDashboardData["gateways"] }) {
  if (!rows.length) return <Empty text="No gateway pass records are available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Pass</th><th>Facility Head</th><th>Department</th><th>Movement</th><th>Destination</th><th>Status</th><th>Logistics</th><th>Approved by</th><th>Updated</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.passNumber}</strong></td><td>{r.facilityManager||"—"}</td><td>{r.department||"—"}</td><td>{r.movementType}</td><td>{r.destination||"—"}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.logisticsStatus||"—"}</td><td>{r.approvedByRole||"—"}</td><td>{dateText(r.updatedAt||r.createdAt)}</td></tr>)}</tbody></table></div>;
}
function Receipts({ rows }: { rows: AuditorDashboardData["receipts"] }) {
  if (!rows.length) return <Empty text="No receipt/document evidence is available." />;
  return <div className="table-wrap"><table className="data-table auditor-table"><thead><tr><th>Receipt</th><th>Request / Payment / PO</th><th>Vendor</th><th>Type</th><th>Amount</th><th>Status</th><th>Document</th><th>OCR</th><th>Discrepancy</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><strong>{r.receiptNo}</strong><small>{dateText(r.createdAt)}</small></td><td>{r.requestNo||"—"}<small>{[r.paymentNo,r.poNo].filter(Boolean).join(" · ")}</small></td><td>{r.vendorName||"—"}</td><td>{r.receiptType||r.paymentMethod||"—"}</td><td>{money(r.amount,r.currency||"NGN")}</td><td>{r.status||"—"}</td><td>{r.originalFileName||"Recorded metadata"}<small>{r.fileChecksum?`Checksum: ${r.fileChecksum.slice(0,12)}…`:""}</small></td><td>{r.ocrStatus||"—"}</td><td>{r.discrepancyStatus||"—"}</td></tr>)}</tbody></table></div>;
}

export function AuditorShell({ user, data, securityStatus }: { user: ShellUser; data: AuditorDashboardData; securityStatus: SecurityMigrationStatus }) {
  const router = useRouter();
  const nav = ROLE_SECTIONS.Auditor;
  const [section,setSection] = useState(nav.sections[0]);
  async function logout(){ await fetch("/api/auth/logout",{method:"POST"}); router.push("/"); router.refresh(); }
  const cards=[["Audit Events",String(data.metrics.auditEvents),"Immutable evidence"],["High Severity",String(data.metrics.highSeverity),"Review priority"],["Exceptions / Warnings",String(data.metrics.exceptionOutcomes),"Denied, failed or warning"],["Active Sessions",String(data.metrics.activeSessions),"Security evidence"]];
  const exceptionEvents=data.auditEvents.filter((r)=>["Denied","Failure","Warning"].includes(String(r.outcome||""))||String(r.severity||"")==="High");
  const delegated=data.approvals.filter((r)=>r.approvalMode && r.approvalMode!=="Normal Approval Mode");
  let content:React.ReactNode=null;
  if(section==="Role Activity Mirrors") content=<Activities rows={data.activities}/>;
  else if(section==="Transaction 360") content=<div className="auditor-stack"><Requests rows={data.requests}/><h3 className="auditor-subhead">Workflow chain</h3><Workflow rows={data.workflow}/></div>;
  else if(section==="User 360") content=<Users data={data}/>;
  else if(section==="Exception Centre") content=<div className="auditor-stack"><AuditEvents rows={exceptionEvents}/><h3 className="auditor-subhead">Logistics exceptions</h3><Exceptions rows={data.exceptions}/></div>;
  else if(section==="All Activity & Evidence Ledger") content=<AuditEvents rows={data.auditEvents}/>;
  else if(section==="Procurement Records") content=<Requests rows={data.requests}/>;
  else if(section==="Sourcing & Vendor Quote Audit") content=<Quotes rows={data.quotes}/>;
  else if(section==="Purchase Order & Logistics Evidence") content=<div className="auditor-stack"><POs rows={data.purchaseOrders}/><h3 className="auditor-subhead">Delivery exceptions</h3><Exceptions rows={data.exceptions}/></div>;
  else if(section==="Receiving Slips, Proof of Delivery & Returns") content=<Receiving rows={data.receiving}/>;
  else if(section==="Finance, Invoice & Payment Audit") content=<div className="auditor-stack"><Payments rows={data.payments}/><h3 className="auditor-subhead">Receipt evidence</h3><Receipts rows={data.receipts}/></div>;
  else if(section==="Approval Trails") content=<Approvals rows={data.approvals}/>;
  else if(section==="Delegated Approval Review") content=<Approvals rows={delegated}/>;
  else if(section==="Payment Payee / Bank Detail Access Audit") content=<PayeeAudit rows={data.payeeAudit}/>;
  else if(section==="Gateway Pass Audit") content=<Gateways rows={data.gateways}/>;
  else if(section==="Document Archive & Download Audit") content=<Receipts rows={data.receipts}/>;
  else if(section==="Notification Delivery Audit") content=<Notifications rows={data.notifications}/>;
  else if(section==="User & Security Audit") content=<Users data={data}/>;
  else if(section==="Vendor History") content=<Vendors rows={data.vendors}/>;
  else if(section==="Budget Audit") content=<Budgets rows={data.budgets}/>;
  else if(section==="Facility / Utility Handoff Trail") content=<Requests rows={data.requests}/>;
  else if(section==="Expense Review") content=<Empty text="The migrated production database contains no legacy expense rows. Finance payment and receipt evidence is available in Finance, Invoice & Payment Audit."/>;
  else if(section==="Compliance Reports") content=<div className="auditor-compliance-grid"><article><span>Immutable audit events</span><strong>{data.metrics.auditEvents}</strong><small>{securityStatus.legacyAuditEventCount} preserved legacy events</small></article><article><span>High severity</span><strong>{data.metrics.highSeverity}</strong><small>Evidence requiring priority review</small></article><article><span>Warnings / denials</span><strong>{data.metrics.exceptionOutcomes}</strong><small>Outcome exceptions</small></article><article><span>Unread notifications</span><strong>{data.metrics.unreadNotifications}</strong><small>Delivery/attention evidence</small></article><article><span>Active v2 chain</span><strong>{securityStatus.activeAuditChainStarted?"Started":"Not started"}</strong><small>{securityStatus.activeAuditKeyVerified?"Key verified":"Write guard locked"}</small></article><article><span>Open logistics exceptions</span><strong>{data.metrics.openLogisticsExceptions}</strong><small>Current operational exceptions</small></article></div>;
  else if(section==="Income") content=<Empty text="Income remains in the migration queue. No Auditor-side income write action is being introduced."/>;
  else if(section==="Settings") content=<Empty text="Shared account settings remain in the migration queue."/>;

  return <main className="app-frame"><aside className="sidebar"><div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div><div className="sidebar-context"><span>{nav.title}</span><strong>{ROLE_LABELS.Auditor}</strong></div><nav className="sidebar-nav">{nav.sections.map((item)=><button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}><Circle size={8} fill="currentColor"/><span>{item}</span></button>)}</nav><div className="sidebar-footer"><button onClick={logout}><LogOut size={16}/><span>Sign out</span></button></div></aside><section className="workspace"><header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14}/> {section}</div><p>{ROLE_LANDING.Auditor}</p></div><div className="topbar-actions"><div className="user-chip"><span className="avatar">{initials(user.fullName)}</span><div><strong>{user.fullName}</strong><small>{ROLE_LABELS.Auditor}</small></div></div></div></header><div className="content-wrap"><div className="page-heading"><div><span className="eyebrow">Auditor</span><h1>{section}</h1><p>{section==="Audit Dashboard"?"Independent read-only evidence view across procurement, approvals, Finance, Logistics, notifications and security.":`ProcureFlow ${section} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark"/></div>{section==="Audit Dashboard"?<><div className="metric-grid">{cards.map(([title,value,caption])=><article className="metric-card" key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div><div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>Recent immutable evidence</h2><p>Latest entries from the tamper-evident audit ledger.</p></div><span className="status-pill">Read only</span></div><AuditEvents rows={data.auditEvents.slice(0,25)}/></article><article className="panel"><div className="panel-heading"><div><h2>Evidence health</h2><p>GCP exit continuity</p></div></div><ul className="status-list"><li><span>Legacy audit preserved</span><b>{securityStatus.legacyAuditPreserved?"Yes":"No"}</b></li><li><span>Legacy audit events</span><b>{securityStatus.legacyAuditEventCount}</b></li><li><span>Legacy signatures</span><b>{securityStatus.legacyAuditVerifiable?"Verifiable":"Key unavailable"}</b></li><li><span>Active v2 signing key</span><b>{securityStatus.activeAuditKeyVerified?"Verified":"Locked"}</b></li><li><span>Active v2 chain</span><b>{securityStatus.activeAuditChainStarted?"Started":"Awaiting first write"}</b></li><li><span>Legacy payee rows</span><b>{securityStatus.legacyPayeeEncryptedRows}</b></li></ul><div className="auditor-alert"><AlertTriangle size={16}/><span>Legacy evidence remains immutable. Historical records are not re-signed or silently decrypted after the GCP exit.</span></div></article></div></>:<article className="panel live-section-panel"><div className="panel-heading"><div><h2>{section}</h2><p>Read-only evidence from the migrated Neon production dataset.</p></div><span className="status-pill"><FileSearch size={13}/> Auditor view</span></div>{content}</article>}</div></section></main>;
}

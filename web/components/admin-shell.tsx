"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Circle, Database, LogOut, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS } from "@/lib/procureflow/roles";
import type { AdminDashboardData } from "@/lib/procureflow/admin-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import {
  AdminApprovalConfigurationControls,
  AdminUserManagementControls,
  AdminWorkflowInterventionControls,
} from "@/components/admin-controls";
import { AdminDirectoryControls, AdminRolePermissionControls } from "@/components/admin-directory-controls";

type ShellUser = { id: number; fullName: string; username: string; role: "Admin" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map((p)=>p[0]?.toUpperCase()).join("") || "AD";
}
function dateText(value: string | null) {
  if (!value) return "—";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("en-NG",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}
function money(value:number){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(value||0)}
function bytes(value:number){if(value<1024)return `${value} B`;if(value<1024**2)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024**2).toFixed(1)} MB`}
function roleText(value:string|null|undefined){return value?((ROLE_LABELS as Record<string,string>)[value]||value):"—"}
function Empty({text}:{text:string}){return <div className="empty-state">{text}</div>}
function Stack({children}:{children:ReactNode}){return <div className="admin-stack">{children}</div>}

function UsersTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.users;
  if(!rows.length)return <Empty text="No user accounts are available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>User</th><th>Role</th><th>Email</th><th>Active</th><th>Locked</th><th>Failed logins</th><th>Password change</th><th>Last login</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.fullName}</strong><small>{r.username}</small></td><td>{roleText(r.role)}</td><td>{r.email||"—"}</td><td>{r.active?"Active":"Inactive"}</td><td>{r.locked?"Locked":"No"}</td><td>{r.failedLoginCount}</td><td>{r.mustChangePassword?"Required":"No"}</td><td>{dateText(r.lastLoginAt)}</td></tr>)}</tbody></table></div>;
}
function SessionsTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.sessions;
  if(!rows.length)return <Empty text="No session evidence is available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>User</th><th>Role</th><th>Login</th><th>Last seen</th><th>Status</th><th>IP</th><th>Expires</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.userName||r.username||"—"}</td><td>{roleText(r.role)}</td><td>{dateText(r.loginAt)}</td><td>{dateText(r.lastSeenAt)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.ipAddress||"—"}</td><td>{dateText(r.expiresAt)}</td></tr>)}</tbody></table></div>;
}
function RequestsTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.requests;
  if(!rows.length)return <Empty text="No procurement records are available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Payment</th><th>Next role</th><th>Facility / PM</th><th>Updated</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.requestNo}</strong></td><td>{r.departmentProject||"—"}</td><td>{r.category||"—"}</td><td className="amount-cell">{money(r.amount)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.paymentStatus||"—"}</td><td>{r.nextRole||"—"}</td><td>{r.facilityManager||r.requestedBy||"—"}<small>{r.procurementManager?`PM: ${r.procurementManager}`:""}</small></td><td>{dateText(r.updatedAt)}</td></tr>)}</tbody></table></div>;
}
function PurchaseOrdersTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.purchaseOrders;
  if(!rows.length)return <Empty text="No purchase orders are available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>PO</th><th>Request</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Logistics</th><th>Receiving</th><th>Payment</th><th>Next role</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.poNo}</strong></td><td>{r.requestNo||"—"}</td><td>{r.vendorName||"—"}</td><td>{money(r.amount)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.logisticsStatus||"—"}</td><td>{r.receivingStatus||"—"}</td><td>{r.paymentStatus||"—"}</td><td>{r.nextRole||"—"}</td></tr>)}</tbody></table></div>;
}
function PaymentsTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.payments;
  if(!rows.length)return <Empty text="No payment records are available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Payment</th><th>Request / PO</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Verification</th><th>Transfer</th><th>Reference</th><th>Date</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.paymentNo}</strong></td><td>{r.requestNo||"—"}<small>{r.poNo||""}</small></td><td>{r.vendorName||"—"}</td><td>{money(r.amount)}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.verificationStatus||"—"}</td><td>{r.transferType||"—"}</td><td>{r.paymentReference||"—"}</td><td>{dateText(r.paymentDate||r.createdAt)}</td></tr>)}</tbody></table></div>;
}
function NotificationsTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.notifications;
  if(!rows.length)return <Empty text="No notifications are available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Time</th><th>Recipient</th><th>Title</th><th>Entity</th><th>Importance</th><th>Read</th><th>Channel</th><th>Push</th><th>Email</th><th>Section</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.userName||roleText(r.role)}</td><td><strong>{r.title}</strong></td><td>{r.entityType||"—"} {r.entityId?`#${r.entityId}`:""}</td><td>{r.importance||"—"}</td><td>{r.read?"Read":"Unread"}</td><td>{r.deliveryChannel||"—"}</td><td>{r.pushSent?"Sent":"—"}</td><td>{r.emailSent?"Sent":"—"}</td><td>{r.sectionTarget||"—"}</td></tr>)}</tbody></table></div>;
}
function AuditTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.auditEvents;
  if(!rows.length)return <Empty text="No audit evidence is available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Severity</th><th>Source</th><th>Key</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{dateText(r.occurredAt)}</td><td><strong>{r.action}</strong><small>{r.reason||""}</small></td><td>{r.actorUsername||"System"}<small>{roleText(r.actorRole)}</small></td><td>{r.entityType||"—"}<small>{r.entityReference||r.entityId||""}</small></td><td>{r.outcome||"—"}</td><td>{r.severity||"—"}</td><td>{r.source||"—"}</td><td>{r.signatureKeyVersion||"—"}</td></tr>)}</tbody></table></div>;
}
function RolesPermissions({data}:{data:AdminDashboardData}){
  return <Stack><div className="admin-role-grid">{data.roles.map(r=><article key={r.id}><div><strong>{roleText(r.name)}</strong><span>{r.description||"ProcureFlow role"}</span></div><b>{r.permissions.length} permissions</b><div className="admin-permission-chips">{r.permissions.map(p=><span key={p}>{p}</span>)}</div></article>)}</div><h3 className="admin-subhead">Permission catalogue ({data.permissions.length})</h3><div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Permission</th><th>Description</th></tr></thead><tbody>{data.permissions.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.description||"—"}</td></tr>)}</tbody></table></div></Stack>;
}
function AvailabilityDelegation({data}:{data:AdminDashboardData}){
  return <Stack><h3 className="admin-subhead">Availability requests</h3>{data.availability.length?<div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Dates</th><th>Urgency</th><th>Review</th><th>Delegate</th><th>Reason</th></tr></thead><tbody>{data.availability.map(r=><tr key={r.id}><td>{r.userName||"—"}</td><td>{roleText(r.role)}</td><td>{r.status||"—"}</td><td>{dateText(r.awayStartDate)} → {dateText(r.awayEndDate)}</td><td>{r.urgency||"—"}</td><td>{r.reviewStatus||"—"}</td><td>{r.delegateName||roleText(r.delegateRole)}</td><td>{r.reason||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No availability requests are pending."/>}<h3 className="admin-subhead">Delegations</h3>{data.delegations.length?<div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Primary</th><th>Delegate</th><th>Enabled</th><th>Dates</th><th>Reason</th><th>Activated by</th></tr></thead><tbody>{data.delegations.map(r=><tr key={r.id}><td>{r.primaryUser||roleText(r.primaryRole)}<small>{roleText(r.primaryRole)}</small></td><td>{r.delegateUser||roleText(r.delegateRole)}<small>{roleText(r.delegateRole)}</small></td><td>{r.enabled?"Yes":"No"}</td><td>{dateText(r.startDate)} → {dateText(r.endDate)}</td><td>{r.reason||"—"}</td><td>{r.activatedBy||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No approval delegations are stored."/>}</Stack>;
}
function GatewayTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.gateways;
  if(!rows.length)return <Empty text="No gateway passes are currently stored in the migrated database."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Pass</th><th>Facility Head</th><th>Department</th><th>Movement</th><th>Destination</th><th>Status</th><th>Logistics</th><th>Approved by</th><th>Updated</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.passNumber}</strong></td><td>{r.facilityManager||"—"}</td><td>{r.department||"—"}</td><td>{r.movementType}</td><td>{r.destination||"—"}</td><td><span className="status-chip">{r.status||"—"}</span></td><td>{r.logisticsStatus||"—"}</td><td>{roleText(r.approvedByRole)}</td><td>{dateText(r.updatedAt||r.createdAt)}</td></tr>)}</tbody></table></div>;
}
function TableStats({data}:{data:AdminDashboardData}){
  return <Stack><div className="admin-readonly-banner"><Database size={16}/><div><strong>Safe database viewer</strong><span>Only table names, estimated row counts and relation sizes are exposed here. Sensitive row contents, password hashes, tokens and encrypted payee values are not shown.</span></div></div><div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Table</th><th>Estimated rows</th><th>Total size</th></tr></thead><tbody>{data.tableStats.map(r=><tr key={r.tableName}><td><strong>{r.tableName}</strong></td><td>{r.estimatedRows.toLocaleString("en-NG")}</td><td>{bytes(r.totalSizeBytes)}</td></tr>)}</tbody></table></div></Stack>;
}
function ExceptionCentre({data}:{data:AdminDashboardData}){
  return <div className="admin-exception-grid">{data.exceptions.map(e=><article key={e.key} className={`admin-exception-card ${e.severity.toLowerCase()}`}><div><AlertTriangle size={16}/><span>{e.severity}</span></div><strong>{e.title}</strong><b>{e.count.toLocaleString("en-NG")}</b><p>{e.detail}</p></article>)}</div>;
}
function BudgetTable({data}:{data:AdminDashboardData}){
  const rows=data.evidence.budgets;if(!rows.length)return <Empty text="No budget records are available."/>;
  return <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Month</th><th>Department / Project</th><th>Category</th><th>Limit</th><th>Override</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.month}</strong></td><td>{r.departmentProject||"—"}</td><td>{r.category||"—"}</td><td>{money(r.limitAmount)}</td><td>{r.overrideRequired?"Required":"No"}</td></tr>)}</tbody></table></div>;
}

export function AdminShell({user,data,securityStatus}:{user:ShellUser;data:AdminDashboardData;securityStatus:SecurityMigrationStatus}){
  const router=useRouter();const nav=ROLE_SECTIONS.Admin;const [section,setSection]=useState(nav.sections[0]);
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.push("/");router.refresh()}
  const cards=[["Total Users",String(data.metrics.totalUsers),`${data.metrics.activeUsers} active`],["Pending Approvals",String(data.metrics.pendingApprovals),"Approver / MD queue"],["Open Requests",String(data.metrics.openRequests),"Active pipeline"],["Audit Events",String(data.metrics.auditEvents),"Immutable evidence"]];
  let content:ReactNode=null;
  if(section==="Action & Exception Centre")content=<ExceptionCentre data={data}/>;
  else if(section==="Workflow Intervention Centre")content=<Stack><AdminWorkflowInterventionControls data={data} securityStatus={securityStatus}/><h3 className="admin-subhead">Live procurement command chain</h3><RequestsTable data={data}/></Stack>;
  else if(section==="User Management")content=<Stack><AdminDirectoryControls data={data} securityStatus={securityStatus} currentUserId={user.id}/><h3 className="admin-subhead">Account security controls</h3><AdminUserManagementControls data={data} securityStatus={securityStatus}/><h3 className="admin-subhead">User register</h3><UsersTable data={data}/></Stack>;
  else if(section==="Roles & Permissions")content=<Stack><AdminRolePermissionControls data={data} securityStatus={securityStatus}/><RolesPermissions data={data}/></Stack>;
  else if(section==="Security & Access Management")content=<Stack><AdminUserManagementControls data={data} securityStatus={securityStatus}/><h3 className="admin-subhead">Active and historical sessions</h3><SessionsTable data={data}/></Stack>;
  else if(section==="Budget Tracker")content=<BudgetTable data={data}/>;
  else if(section==="Income")content=<Empty text="Income remains in the migration queue. No Admin-side income mutation has been introduced."/>;
  else if(section==="Approval Configuration")content=<AdminApprovalConfigurationControls data={data} securityStatus={securityStatus}/>;
  else if(section==="Import Center")content=<Empty text="The migrated production database contains no imported legacy document rows. A Vercel-compatible upload/import storage path remains to be ported before imports are re-enabled."/>;
  else if(section==="All Procurement Records")content=<Stack><RequestsTable data={data}/><h3 className="admin-subhead">Purchase orders</h3><PurchaseOrdersTable data={data}/><h3 className="admin-subhead">Payments</h3><PaymentsTable data={data}/></Stack>;
  else if(section==="Notifications Monitor")content=<NotificationsTable data={data}/>;
  else if(section==="Availability & Delegation Requests")content=<AvailabilityDelegation data={data}/>;
  else if(section==="Gateway Pass Management")content=<GatewayTable data={data}/>;
  else if(section==="Activity & History Logs")content=<div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Time</th><th>Role</th><th>Action</th><th>Entity</th><th>Summary</th><th>Visibility</th></tr></thead><tbody>{data.evidence.activities.map(r=><tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{roleText(r.role)}</td><td><strong>{r.action}</strong></td><td>{r.entityType||"—"} {r.entityId?`#${r.entityId}`:""}</td><td>{r.summary||"—"}</td><td>{r.visibility||"—"}</td></tr>)}</tbody></table></div>;
  else if(section==="Audit Logs")content=<AuditTable data={data}/>;
  else if(section==="Database Viewer")content=<TableStats data={data}/>;
  else if(section==="Backup / Export")content=<Stack><div className="admin-backup-grid"><article><span>Neon schema tables</span><strong>{data.tableStats.length}</strong><small>Public application relations visible to Admin metadata view</small></article><article><span>Immutable audit events</span><strong>{data.metrics.auditEvents}</strong><small>Historical evidence preserved in Neon</small></article><article><span>Legacy audit continuity</span><strong>{securityStatus.legacyAuditPreserved?"Preserved":"Missing"}</strong><small>{securityStatus.legacyAuditEventCount} legacy events</small></article><article><span>v2 write chain</span><strong>{securityStatus.activeAuditKeyVerified?"Ready":"Locked"}</strong><small>{securityStatus.activeAuditChainStarted?"Chain started":"Awaiting first v2 write"}</small></article></div><div className="admin-readonly-banner"><ShieldCheck size={16}/><div><strong>Export mutation not enabled</strong><span>The verified Cloud SQL migration dump remains the external recovery baseline while the application moves to Neon. A server-side Vercel/Neon export workflow will be added separately; this page does not expose database credentials or downloadable raw secrets.</span></div></div></Stack>;
  else if(section==="Settings")content=<Empty text="Shared Admin settings are represented in navigation and remain in the migration queue."/>;

  return <main className="app-frame"><aside className="sidebar"><div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div><div className="sidebar-context"><span>{nav.title}</span><strong>{ROLE_LABELS.Admin}</strong></div><nav className="sidebar-nav">{nav.sections.map(item=><button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}><Circle size={8} fill="currentColor"/><span>{item}</span></button>)}</nav><div className="sidebar-footer"><button onClick={logout}><LogOut size={16}/><span>Sign out</span></button></div></aside><section className="workspace"><header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14}/> {section}</div><p>{ROLE_LANDING.Admin}</p></div><div className="topbar-actions"><div className="user-chip"><span className="avatar">{initials(user.fullName)}</span><div><strong>{user.fullName}</strong><small>{ROLE_LABELS.Admin}</small></div></div></div></header><div className="content-wrap"><div className="page-heading"><div><span className="eyebrow">Administrator</span><h1>{section}</h1><p>{section==="Admin Dashboard"?"Highest-authority operational oversight across users, procurement, approvals, Finance, Logistics, security and evidence.":`ProcureFlow ${section} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark"/></div>{section==="Admin Dashboard"?<><div className="metric-grid">{cards.map(([title,value,caption])=><article className="metric-card" key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div><div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>Control-centre exceptions</h2><p>Current attention signals from the migrated Neon production dataset.</p></div><span className="status-pill">Live oversight</span></div><ExceptionCentre data={data}/></article><article className="panel"><div className="panel-heading"><div><h2>Migration security</h2><p>GCP exit controls</p></div></div><ul className="status-list"><li><span>Database</span><b>Neon live</b></li><li><span>Legacy audit preserved</span><b>{securityStatus.legacyAuditPreserved?"Yes":"No"}</b></li><li><span>Legacy audit events</span><b>{securityStatus.legacyAuditEventCount}</b></li><li><span>Active v2 audit key</span><b>{securityStatus.activeAuditKeyVerified?"Verified":"Locked"}</b></li><li><span>Legacy encrypted payees</span><b>{securityStatus.legacyPayeeEncryptedRows}</b></li><li><span>Admin mutation routes</span><b>{securityStatus.activeAuditKeyVerified?"Guarded live":"Audit locked"}</b></li></ul></article></div></>:<article className="panel live-section-panel"><div className="panel-heading"><div><h2>{section}</h2><p>Live Neon-backed Admin oversight. Authority-changing controls require an authenticated Admin, a meaningful reason, explicit confirmation and a verified signed audit chain.</p></div><span className="status-pill"><ShieldCheck size={13}/> Admin control</span></div>{content}</article>}</div></section></main>;
}

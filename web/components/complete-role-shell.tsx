"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Circle, Database, FileSearch, LogOut, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS, type ProcureFlowRole } from "@/lib/procureflow/roles";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import type { ParityData } from "@/lib/procureflow/parity-data";
import { FacilityDraftForm } from "@/components/facility-draft-form";
import { ProcurementInbox } from "@/components/procurement-inbox";
import { ProcurementSourcing } from "@/components/procurement-sourcing";
import { ProcurementRecommendations } from "@/components/procurement-recommendations";
import { ApproverRequests } from "@/components/approver-requests";
import { ApproverGatewayApprovals, ApproverPaymentApprovals, ApproverPOApprovals } from "@/components/approver-operational-approvals";
import { FinanceApprovedForPayment, FinanceBudgets, FinancePayments, FinanceReceipts } from "@/components/finance-workspace";
import { IncomeWorkspace } from "@/components/income-workspace";
import { SettingsWorkspace } from "@/components/settings-workspace";
import { AdminApprovalConfigurationControls, AdminUserManagementControls, AdminWorkflowInterventionControls } from "@/components/admin-controls";
import { AdminDirectoryControls, AdminRolePermissionControls } from "@/components/admin-directory-controls";
import { AdminAvailabilityControls } from "@/components/admin-availability-controls";
import { ParityWorkspace } from "@/components/parity-workspace";
import { CompleteLogisticsWorkspace } from "@/components/complete-logistics-workspace";
import { GlobalTools } from "@/components/global-tools";

export type CompleteShellUser = { id: number; fullName: string; username: string; role: ProcureFlowRole };

type Props = {
  user: CompleteShellUser;
  facilityData?: any;
  procurementData?: any;
  approverData?: any;
  financeData?: any;
  logisticsData?: any;
  logisticsItems?: any[];
  adminData?: any;
  auditorData?: any;
  parityData: ParityData;
  securityStatus: SecurityMigrationStatus;
};

function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]?.toUpperCase()).join("")||"PF"}
function money(value:unknown){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(Number(value||0))}
function dateText(value:unknown){if(!value)return "—";const d=new Date(String(value));return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString("en-NG",{day:"2-digit",month:"short",year:"numeric"})}
function dateTime(value:unknown){if(!value)return "—";const d=new Date(String(value));return Number.isNaN(d.getTime())?String(value):d.toLocaleString("en-NG")}
function Empty({text}:{text:string}){return <div className="empty-state">{text}</div>}
function Stack({children}:{children:ReactNode}){return <div className="parity-stack">{children}</div>}
function Status({value}:{value:any}){return <span className="status-chip">{value||"—"}</span>}

function GenericRequestTable({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Amount</th><th>Status</th><th>Payment</th><th>Next role</th><th>Updated</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td><strong>{r.requestNo||r.request_no}</strong><small>{dateText(r.requestDate||r.request_date)}</small></td><td>{r.departmentProject||r.department_project||"—"}</td><td>{r.category||"—"}</td><td>{money(r.estimatedAmount??r.estimated_amount)}</td><td><Status value={r.status}/></td><td>{r.paymentStatus||r.payment_status||"—"}</td><td>{r.nextRole||r.next_role||"—"}</td><td>{dateText(r.updatedAt||r.updated_at)}</td></tr>)}</tbody></table></div>:<Empty text="No procurement records are available in this section."/>}
function GenericActivity({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Role</th><th>Action</th><th>Entity</th><th>Summary</th><th>Visibility</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{dateTime(r.createdAt||r.created_at)}</td><td>{r.role||"—"}</td><td><strong>{r.action}</strong></td><td>{r.entityType||r.entity_type||"—"} {(r.entityId||r.entity_id)?`#${r.entityId||r.entity_id}`:""}</td><td>{r.summary||r.public_summary||"—"}</td><td>{r.visibility||r.visibility_scope||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No activity evidence is available."/>}
function AuditEvents({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Outcome</th><th>Severity</th><th>Source</th><th>Key</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{dateTime(r.occurredAt||r.occurred_at)}</td><td><strong>{r.action}</strong><small>{r.reason||r.reason_or_comment||""}</small></td><td>{r.actorUsername||r.actor_username||"System"}<small>{r.actorRole||r.actor_role||""}</small></td><td>{r.entityType||r.entity_type||"—"}<small>{r.entityReference||r.entity_reference||r.entityId||r.entity_id||""}</small></td><td>{r.outcome||"—"}</td><td>{r.severity||"—"}</td><td>{r.source||"—"}</td><td>{r.signatureKeyVersion||r.signature_key_version||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No audit events are available."/>}
function ApprovalTable({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Entity</th><th>Action</th><th>Before</th><th>After</th><th>Approved by</th><th>Mode</th><th>Note</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{dateTime(r.createdAt||r.created_at)}</td><td>{r.entityType||r.entity_type} #{r.entityId||r.entity_id}</td><td><strong>{r.action}</strong></td><td>{r.before||r.status_before||"—"}</td><td><Status value={r.after||r.status_after}/></td><td>{r.approvedBy||r.approved_by||r.approvedByRole||r.approved_by_role||"—"}</td><td>{r.approvalMode||r.approval_mode||"—"}</td><td>{r.note||r.reason||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No approval history is available."/>}

function FacilitySection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){
  const router=useRouter();const [busy,setBusy]=useState<number|null>(null);const [msg,setMsg]=useState<any>(null);
  async function submit(id:number){setBusy(id);setMsg(null);try{const r=await fetch("/api/facility/requests/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:id})});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p?.error||"Unable to submit request.");setMsg({type:"success",text:"Request submitted to Procurement Manager."});router.refresh();}catch(e){setMsg({type:"error",text:e instanceof Error?e.message:"Unable to submit request."});}finally{setBusy(null)}}
  if(section==="Create Request Draft")return <FacilityDraftForm/>;
  if(["Import Documents","Gateway Pass","Shared Thread with Procurement Manager","My Activity History"].includes(section))return <ParityWorkspace section={section} role="Facility Manager" data={parityData}/>;
  if(section==="My Draft Requests")return <GenericRequestTable rows={data?.drafts||[]}/>;
  if(section==="Returned Requests")return <GenericRequestTable rows={data?.returned||[]}/>;
  if(section==="Approved / Accepted Requests")return <GenericRequestTable rows={data?.approved||[]}/>;
  if(section==="Submit to Procurement Manager"){const rows=[...(data?.drafts||[]),...(data?.returned||[])];return <Stack>{msg?<div className={`action-message ${msg.type}`}>{msg.text}</div>:null}{rows.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td><strong>{r.requestNo}</strong></td><td>{r.departmentProject||"—"}</td><td>{money(r.estimatedAmount)}</td><td><Status value={r.status}/></td><td><button className="row-action-button" disabled={busy===r.id} onClick={()=>void submit(r.id)}>{busy===r.id?"Submitting…":"Submit"}</button></td></tr>)}</tbody></table></div>:<Empty text="No drafts are waiting for submission."/>}</Stack>}
  return null;
}

function ProcurementSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){
  if(section==="Utility Head / Facility Head Inbox")return <ProcurementInbox rows={data?.inbox||[]}/>;
  if(section==="Purchase Requests")return <GenericRequestTable rows={data?.requests||[]}/>;
  if(section==="Sourcing"||section==="Vendor Quotes")return <ProcurementSourcing tasks={data?.sourcingTasks||[]} vendors={data?.vendors||[]}/>;
  if(section==="Vendor Recommendation")return <ProcurementRecommendations tasks={data?.sourcingTasks||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;
  if(["Low-Value Approvals","Import Center","Commercial PO Management","Vendors","Gateway Pass Review","Post-Payment Closure","Availability / Away Notice","Procurement Documents","Procurement Reports","My Activity History"].includes(section))return <ParityWorkspace section={section} role="Procurement Manager" data={parityData}/>;
  return null;
}

function ApproverSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){
  if(section==="Pending Approvals")return <ApproverRequests rows={data?.pendingRequests||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;
  if(section==="Quote Comparison")return <ApproverRequests rows={data?.quoteComparisons||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit} mode="quotes"/>;
  if(section==="PO Approval")return <ApproverPOApprovals rows={data?.pendingPOs||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;
  if(section==="Payment Approval")return <ApproverPaymentApprovals rows={data?.pendingPayments||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;
  if(section==="Gateway Pass Approval")return <ApproverGatewayApprovals rows={data?.pendingGatewayPasses||[]}/>;
  if(section==="Availability / Away Notice")return <ParityWorkspace section={section} role="Approver" data={parityData}/>;
  if(section==="My Approval History")return <ApprovalTable rows={data?.history||[]}/>;
  return null;
}

function FinanceSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){
  if(section==="Approved for Payment")return <FinanceApprovedForPayment rows={data?.readyForPayment||[]}/>;
  if(section==="Payments")return <FinancePayments rows={data?.payments||[]}/>;
  if(section==="Receipts")return <Stack><ParityWorkspace section="Receipts" role="Finance" data={parityData}/><h3>Receipt metadata register</h3><FinanceReceipts rows={data?.receipts||[]}/></Stack>;
  if(section==="Budgets")return <FinanceBudgets rows={data?.budgets||[]}/>;
  if(["Invoices","Expenses","Cash Advances","Vendor Payment Records","Reconciliation","Financial Reports"].includes(section))return <ParityWorkspace section={section} role="Finance" data={parityData}/>;
  return null;
}

function AdminEvidenceSection({section,data,parityData,securityStatus,user}:{section:string;data:any;parityData:ParityData;securityStatus:SecurityMigrationStatus;user:CompleteShellUser}){
  if(section==="Action & Exception Centre")return <div className="admin-exception-grid">{(data?.exceptions||[]).map((e:any)=><article key={e.key} className={`admin-exception-card ${String(e.severity||"Normal").toLowerCase()}`}><div><AlertTriangle size={16}/><span>{e.severity}</span></div><strong>{e.title}</strong><b>{Number(e.count||0).toLocaleString("en-NG")}</b><p>{e.detail}</p></article>)}</div>;
  if(section==="Workflow Intervention Centre")return <Stack><AdminWorkflowInterventionControls data={data} securityStatus={securityStatus}/><GenericRequestTable rows={data?.evidence?.requests||[]}/></Stack>;
  if(section==="User Management")return <Stack><AdminDirectoryControls data={data} securityStatus={securityStatus} currentUserId={user.id}/><AdminUserManagementControls data={data} securityStatus={securityStatus}/><div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Email</th><th>Active</th><th>Locked</th><th>Password change</th><th>Last login</th></tr></thead><tbody>{(data?.evidence?.users||[]).map((r:any)=><tr key={r.id}><td><strong>{r.fullName}</strong><small>{r.username}</small></td><td>{r.role}</td><td>{r.email||"—"}</td><td>{r.active?"Yes":"No"}</td><td>{r.locked?"Locked":"No"}</td><td>{r.mustChangePassword?"Required":"No"}</td><td>{dateTime(r.lastLoginAt)}</td></tr>)}</tbody></table></div></Stack>;
  if(section==="Roles & Permissions")return <Stack><AdminRolePermissionControls data={data} securityStatus={securityStatus}/><div className="admin-role-grid">{(data?.roles||[]).map((r:any)=><article key={r.id}><strong>{r.name}</strong><span>{r.description||"ProcureFlow role"}</span><b>{r.permissions?.length||0} permissions</b><div className="admin-permission-chips">{(r.permissions||[]).map((p:string)=><span key={p}>{p}</span>)}</div></article>)}</div></Stack>;
  if(section==="Security & Access Management")return <Stack><AdminUserManagementControls data={data} securityStatus={securityStatus}/><div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Login</th><th>Last seen</th><th>Status</th><th>Expires</th></tr></thead><tbody>{(data?.evidence?.sessions||[]).map((r:any)=><tr key={r.id}><td>{r.userName||r.username||"—"}</td><td>{r.role||"—"}</td><td>{dateTime(r.loginAt)}</td><td>{dateTime(r.lastSeenAt)}</td><td><Status value={r.status}/></td><td>{dateTime(r.expiresAt)}</td></tr>)}</tbody></table></div></Stack>;
  if(section==="Budget Tracker")return <div className="table-wrap"><table className="data-table"><thead><tr><th>Month</th><th>Department / Project</th><th>Category</th><th>Limit</th><th>Override</th></tr></thead><tbody>{(data?.evidence?.budgets||[]).map((r:any)=><tr key={r.id}><td>{r.month}</td><td>{r.departmentProject||"—"}</td><td>{r.category||"—"}</td><td>{money(r.limitAmount)}</td><td>{r.overrideRequired?"Required":"No"}</td></tr>)}</tbody></table></div>;
  if(section==="Approval Configuration")return <AdminApprovalConfigurationControls data={data} securityStatus={securityStatus}/>;
  if(section==="All Procurement Records")return <Stack><GenericRequestTable rows={data?.evidence?.requests||[]}/><ParityWorkspace section="Commercial PO Management" role="Admin" data={parityData}/></Stack>;
  if(section==="Notifications Monitor")return <NotificationTable rows={data?.evidence?.notifications||[]}/>;
  if(section==="Availability & Delegation Requests")return <Stack><AdminAvailabilityControls data={data} securityStatus={securityStatus}/><div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Dates</th><th>Status</th><th>Review</th><th>Delegate</th><th>Reason</th></tr></thead><tbody>{(data?.availability||[]).map((r:any)=><tr key={r.id}><td>{r.userName||"—"}</td><td>{r.role||"—"}</td><td>{dateText(r.awayStartDate)} → {dateText(r.awayEndDate)}</td><td>{r.status||"—"}</td><td><Status value={r.reviewStatus}/></td><td>{r.delegateName||r.delegateRole||"—"}</td><td>{r.reason||"—"}</td></tr>)}</tbody></table></div></Stack>;
  if(section==="Gateway Pass Management")return <ParityWorkspace section="Gateway Pass" role="Admin" data={parityData}/>;
  if(section==="Activity & History Logs")return <ParityWorkspace section={section} role="Admin" data={parityData}/>;
  if(section==="Audit Logs")return <AuditEvents rows={data?.evidence?.auditEvents||[]}/>;
  if(section==="Database Viewer")return <Stack><div className="parity-info"><Database size={17}/><div><strong>Safe metadata-only database viewer</strong><span>Password hashes, session tokens and encrypted payee ciphertext are not exposed.</span></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Table</th><th>Estimated rows</th><th>Total bytes</th></tr></thead><tbody>{(data?.tableStats||[]).map((r:any)=><tr key={r.tableName}><td><strong>{r.tableName}</strong></td><td>{Number(r.estimatedRows||0).toLocaleString("en-NG")}</td><td>{Number(r.totalSizeBytes||0).toLocaleString("en-NG")}</td></tr>)}</tbody></table></div></Stack>;
  if(["Import Center","Backup / Export"].includes(section))return <ParityWorkspace section={section} role="Admin" data={parityData}/>;
  return null;
}

function NotificationTable({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Recipient</th><th>Title</th><th>Entity</th><th>Importance</th><th>Read</th><th>Channel</th><th>Section</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{dateTime(r.createdAt||r.created_at)}</td><td>{r.userName||r.user_name||r.role||"—"}</td><td><strong>{r.title}</strong></td><td>{r.entityType||r.entity_type||"—"} {(r.entityId||r.entity_id)?`#${r.entityId||r.entity_id}`:""}</td><td>{r.importance||"—"}</td><td>{r.read??r.is_read?"Read":"Unread"}</td><td>{r.deliveryChannel||r.delivery_channel||"—"}</td><td>{r.sectionTarget||r.section_target||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No notification evidence is available."/>}

function AuditorSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){
  if(["Expense Review","Document Archive & Download Audit","Compliance Reports"].includes(section))return <ParityWorkspace section={section} role="Auditor" data={parityData}/>;
  if(section==="Role Activity Mirrors"||section==="All Activity & Evidence Ledger")return section==="All Activity & Evidence Ledger"?<AuditEvents rows={data?.auditEvents||[]}/>:<GenericActivity rows={data?.activities||[]}/>;
  if(section==="Transaction 360")return <Stack><GenericRequestTable rows={data?.requests||[]}/><h3>Workflow chain</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Entity</th><th>Event</th><th>Status</th><th>User</th><th>Note</th></tr></thead><tbody>{(data?.workflow||[]).map((r:any)=><tr key={r.id}><td>{dateTime(r.createdAt)}</td><td>{r.entityType} #{r.entityId}</td><td>{r.event}</td><td><Status value={r.status}/></td><td>{r.userName||"—"}</td><td>{r.note||"—"}</td></tr>)}</tbody></table></div></Stack>;
  if(section==="User 360"||section==="User & Security Audit")return <Stack><div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Active</th><th>Locked</th><th>Failed logins</th><th>Password change</th><th>Last login</th></tr></thead><tbody>{(data?.users||[]).map((r:any)=><tr key={r.id}><td><strong>{r.fullName}</strong><small>{r.username}</small></td><td>{r.role}</td><td>{r.active?"Yes":"No"}</td><td>{r.locked?"Locked":"No"}</td><td>{r.failedLoginCount}</td><td>{r.mustChangePassword?"Required":"No"}</td><td>{dateTime(r.lastLoginAt)}</td></tr>)}</tbody></table></div></Stack>;
  if(section==="Exception Centre")return <Stack><AuditEvents rows={(data?.auditEvents||[]).filter((r:any)=>r.severity==="High"||["Denied","Failure","Warning"].includes(String(r.outcome||"")))}/><h3>Logistics exceptions</h3><ExceptionTable rows={data?.exceptions||[]}/></Stack>;
  if(section==="Procurement Records"||section==="Facility / Utility Handoff Trail")return <GenericRequestTable rows={data?.requests||[]}/>;
  if(section==="Sourcing & Vendor Quote Audit")return <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Vendor</th><th>Quote</th><th>Delivery</th><th>Terms</th><th>Score</th><th>Recommendation</th></tr></thead><tbody>{(data?.quotes||[]).map((r:any)=><tr key={r.id}><td>{r.requestNo||"—"}</td><td>{r.vendorName||"—"}</td><td>{money(r.quotedAmount)}</td><td>{r.deliveryDays==null?"—":`${r.deliveryDays} days`}</td><td>{r.paymentTerms||"—"}</td><td>{r.score??"—"}</td><td>{r.selected?"Selected":r.recommended?"Recommended":"—"}</td></tr>)}</tbody></table></div>;
  if(section==="Purchase Order & Logistics Evidence")return <Stack><POTable rows={data?.purchaseOrders||[]}/><ExceptionTable rows={data?.exceptions||[]}/></Stack>;
  if(section==="Receiving Slips, Proof of Delivery & Returns")return <div className="table-wrap"><table className="data-table"><thead><tr><th>Slip</th><th>PO</th><th>Request</th><th>Vendor</th><th>Date</th><th>Status</th><th>Discrepancy</th></tr></thead><tbody>{(data?.receiving||[]).map((r:any)=><tr key={r.id}><td>{r.slipNo}</td><td>{r.poNo||"—"}</td><td>{r.requestNo||"—"}</td><td>{r.vendorName||"—"}</td><td>{dateText(r.dateReceived)}</td><td>{r.status||"—"}</td><td>{r.discrepancyNotes||"—"}</td></tr>)}</tbody></table></div>;
  if(section==="Finance, Invoice & Payment Audit")return <ParityWorkspace section="Vendor Payment Records" role="Auditor" data={parityData}/>;
  if(section==="Approval Trails")return <ApprovalTable rows={data?.approvals||[]}/>;
  if(section==="Delegated Approval Review")return <ApprovalTable rows={(data?.approvals||[]).filter((r:any)=>r.approvalMode&&r.approvalMode!=="Normal Approval Mode")}/>;
  if(section==="Payment Payee / Bank Detail Access Audit")return <AuditEvents rows={(data?.payeeAudit||[]).map((r:any)=>({...r,occurredAt:r.occurredAt,actorUsername:r.actorUsername,actorRole:r.actorRole,entityReference:r.entityReference,entityId:r.entityId,source:"audit",signatureKeyVersion:"—"}))}/>;
  if(section==="Gateway Pass Audit")return <ParityWorkspace section={section} role="Auditor" data={parityData}/>;
  if(section==="Notification Delivery Audit")return <NotificationTable rows={data?.notifications||[]}/>;
  if(section==="Vendor History")return <ParityWorkspace section={section} role="Auditor" data={parityData}/>;
  if(section==="Budget Audit")return <div className="table-wrap"><table className="data-table"><thead><tr><th>Month</th><th>Department</th><th>Category</th><th>Limit</th><th>Override</th></tr></thead><tbody>{(data?.budgets||[]).map((r:any)=><tr key={r.id}><td>{r.month}</td><td>{r.departmentProject||"—"}</td><td>{r.category||"—"}</td><td>{money(r.limitAmount)}</td><td>{r.overrideRequired?"Required":"No"}</td></tr>)}</tbody></table></div>;
  return <ParityWorkspace section={section} role="Auditor" data={parityData}/>;
}
function POTable({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>PO</th><th>Request</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Logistics</th><th>Receiving</th><th>Payment</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td><strong>{r.poNo||r.po_no}</strong></td><td>{r.requestNo||r.request_no||"—"}</td><td>{r.vendorName||r.vendor_name||"—"}</td><td>{money(r.amount??r.total_amount)}</td><td><Status value={r.status}/></td><td>{r.logisticsStatus||r.logistics_status||"—"}</td><td>{r.receivingStatus||r.receiving_status||"—"}</td><td>{r.paymentStatus||r.payment_status||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No purchase-order evidence is available."/>}
function ExceptionTable({rows}:{rows:any[]}){return rows?.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Exception</th><th>PO</th><th>Type</th><th>Description</th><th>Payment impact</th><th>Status</th><th>Resolution</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{r.exceptionNo||r.exception_no}</td><td>{r.poNo||r.po_no||"—"}</td><td>{r.exceptionType||r.exception_type}</td><td>{r.description}</td><td>{r.paymentImpact||r.payment_impact?"Yes":"No"}</td><td><Status value={r.status}/></td><td>{r.resolutionNote||r.resolution_note||"—"}</td></tr>)}</tbody></table></div>:<Empty text="No logistics exceptions are recorded."/>}

function Dashboard({role,facilityData,procurementData,approverData,financeData,logisticsData,adminData,auditorData,parityData,securityStatus}:{role:ProcureFlowRole;facilityData:any;procurementData:any;approverData:any;financeData:any;logisticsData:any;adminData:any;auditorData:any;parityData:ParityData;securityStatus:SecurityMigrationStatus}){
  let cards:[string,string,string][]=[];let summary="";
  if(role==="Facility Manager"){cards=[["Drafts",String(facilityData?.drafts?.length||0),"Requests in preparation"],["Returned",String(facilityData?.returned?.length||0),"Require correction"],["Approved / Processed",String(facilityData?.approved?.length||0),"Workflow history"],["Gateway Passes",String(parityData.gateways.length),"Movement records"]];summary=`${facilityData?.drafts?.length||0} drafts · ${facilityData?.returned?.length||0} returned · ${parityData.threads.length} shared threads`;}
  else if(role==="Procurement Manager"){cards=[["Awaiting Review",String(procurementData?.inbox?.length||0),"Facility handoffs"],["Low-Value",String(parityData.lowValueQueue.length),"PM approval queue"],["Sourcing",String(procurementData?.sourcingTasks?.length||0),"Active sourcing"],["Closure",String(parityData.closureQueue.length),"Paid awaiting closure"]];summary=`${parityData.purchaseOrders.length} purchase orders · ${parityData.vendors.length} vendors · ${parityData.gatewayReviewQueue.length} gateway reviews`;}
  else if(role==="Approver"){cards=[["Requests",String(approverData?.pendingRequests?.length||0),"Pending approval"],["POs",String(approverData?.pendingPOs?.length||0),"Pending PO approval"],["Payments",String(approverData?.pendingPayments?.length||0),"Payment authorization"],["Gateway Passes",String(approverData?.pendingGatewayPasses?.length||0),"Final movement approval"]];summary=`${approverData?.history?.length||0} approval-history records · limit ${money(parityData.policyLimit)}`;}
  else if(role==="Finance"){cards=[["Awaiting Payment",String(financeData?.readyForPayment?.length||0),"Approved requests"],["Payments",String(financeData?.payments?.length||0),"Payment ledger"],["Invoices",String(parityData.invoices.length),"Invoice register"],["Receipts",String(parityData.receipts.length),"Evidence archive"]];summary=`${parityData.expenses.length} direct expenses · ${parityData.cashAdvances.length} cash advances · ${parityData.reconciliation.length} reconciliation rows`;}
  else if(role==="Logistics Officer"){cards=[["Awaiting Handover",String(logisticsData?.metrics?.awaitingHandover||0),"Released by Procurement"],["Active Deliveries",String(logisticsData?.metrics?.activeDeliveries||0),"Delivery execution"],["Receiving",String(logisticsData?.metrics?.receivingPending||0),"Pending receiving"],["Exceptions",String(logisticsData?.metrics?.exceptions||0),"Open issues"]];summary=`${logisticsData?.receivingSlips?.length||0} receiving slips · ${logisticsData?.gatewayPasses?.length||0} gateway movements`;}
  else if(role==="Admin"){cards=[["Users",String(adminData?.metrics?.totalUsers||0),`${adminData?.metrics?.activeUsers||0} active`],["Pending Approvals",String(adminData?.metrics?.pendingApprovals||0),"Executive queue"],["Open Requests",String(adminData?.metrics?.openRequests||0),"Procurement pipeline"],["Audit Events",String(adminData?.metrics?.auditEvents||0),"Immutable evidence"]];summary=`${adminData?.metrics?.openPOs||0} open POs · ${adminData?.metrics?.lockedUsers||0} locked users · ${parityData.documents.length} documents`;}
  else {cards=[["Audit Events",String(auditorData?.metrics?.auditEvents||0),"Immutable evidence"],["High Severity",String(auditorData?.metrics?.highSeverity||0),"Priority evidence"],["Exceptions",String(auditorData?.metrics?.exceptionOutcomes||0),"Warnings / denials"],["Active Sessions",String(auditorData?.metrics?.activeSessions||0),"Security evidence"]];summary=`${parityData.expenses.length} expenses · ${parityData.documents.length} document records · ${parityData.reconciliation.length} payment reconciliation rows`;}
  return <><div className="metric-grid">{cards.map(([t,v,c])=><article className="metric-card" key={t}><span>{t}</span><strong>{v}</strong><small>{c}</small></article>)}</div><div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>ProcureFlow command chain</h2><p>Complete Vercel + Neon operational workflow.</p></div><span className="status-pill">Feature-parity build</span></div><div className="chain"><span>Utility / Facility</span><ChevronRight/><span>Procurement</span><ChevronRight/><span>Approval</span><ChevronRight/><span>PO / Logistics</span><ChevronRight/><span>Finance</span><ChevronRight/><span>Closure / Audit</span></div><div className="live-summary"><strong>Current workspace</strong><span>{summary}</span></div></article><article className="panel"><div className="panel-heading"><div><h2>Security & migration</h2><p>GCP-free runtime</p></div></div><ul className="status-list"><li><span>Database</span><b>Neon</b></li><li><span>Application runtime</span><b>Next.js / Vercel</b></li><li><span>v2 audit signing</span><b>{securityStatus.activeAuditKeyVerified?"Verified":"Locked"}</b></li><li><span>v2 payee encryption</span><b>{securityStatus.activePayeeKeyVerified?"Verified":"Locked"}</b></li><li><span>Legacy audit</span><b>{securityStatus.legacyAuditPreserved?"Preserved":"Missing"}</b></li><li><span>Document store</span><b>Neon portable</b></li></ul></article></div></>;
}

export function CompleteRoleShell(props:Props){
  const {user,facilityData,procurementData,approverData,financeData,logisticsData,logisticsItems=[],adminData,auditorData,parityData,securityStatus}=props;const router=useRouter();const nav=ROLE_SECTIONS[user.role];const [section,setSection]=useState(nav.sections[0]);
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.push("/");router.refresh()}
  function navigate(target:string){setSection(nav.sections.includes(target)?target:nav.sections[0])}
  let content:ReactNode=null;
  const isDashboard=section.toLowerCase().includes("dashboard");
  if(!isDashboard){
    if(section==="Income"&&["Admin","Finance","Procurement Manager","Facility Manager","Approver","Auditor"].includes(user.role))content=<IncomeWorkspace role={user.role as any}/>;
    else if(section==="Settings")content=<SettingsWorkspace username={user.username} fullName={user.fullName} role={user.role}/>;
    else if(user.role==="Facility Manager")content=<FacilitySection section={section} data={facilityData} parityData={parityData}/>;
    else if(user.role==="Procurement Manager")content=<ProcurementSection section={section} data={procurementData} parityData={parityData}/>;
    else if(user.role==="Approver")content=<ApproverSection section={section} data={approverData} parityData={parityData}/>;
    else if(user.role==="Finance")content=<FinanceSection section={section} data={financeData} parityData={parityData}/>;
    else if(user.role==="Logistics Officer")content=<CompleteLogisticsWorkspace section={section} data={logisticsData} items={logisticsItems} parityData={parityData}/>;
    else if(user.role==="Admin")content=<AdminEvidenceSection section={section} data={adminData} parityData={parityData} securityStatus={securityStatus} user={user}/>;
    else if(user.role==="Auditor")content=<AuditorSection section={section} data={auditorData} parityData={parityData}/>;
    if(!content)content=<ParityWorkspace section={section} role={user.role} data={parityData}/>;
  }
  return <main className="app-frame"><aside className="sidebar"><div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div><div className="sidebar-context"><span>{nav.title}</span><strong>{ROLE_LABELS[user.role]}</strong></div><nav className="sidebar-nav">{nav.sections.map(item=><button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}><Circle size={8} fill="currentColor"/><span>{item}</span></button>)}</nav><div className="sidebar-footer"><button onClick={logout}><LogOut size={16}/><span>Sign out</span></button></div></aside><section className="workspace"><header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14}/> {section}</div><p>{ROLE_LANDING[user.role]}</p></div><div className="topbar-actions"><GlobalTools notifications={parityData.notifications} onNavigate={navigate}/><div className="user-chip"><span className="avatar">{initials(user.fullName)}</span><div><strong>{user.fullName}</strong><small>{ROLE_LABELS[user.role]}</small></div></div></div></header><div className="content-wrap"><div className="page-heading"><div><span className="eyebrow">{ROLE_LABELS[user.role]}</span><h1>{section}</h1><p>{isDashboard?"Your operational view of work requiring attention, controls, evidence and completed activity.":`ProcureFlow ${section} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark"/></div>{isDashboard?<Dashboard role={user.role} facilityData={facilityData} procurementData={procurementData} approverData={approverData} financeData={financeData} logisticsData={logisticsData} adminData={adminData} auditorData={auditorData} parityData={parityData} securityStatus={securityStatus}/>:<article className="panel live-section-panel"><div className="panel-heading"><div><h2>{section}</h2><p>Neon-backed production feature with role boundaries, auditable writes and GCP-free runtime dependencies.</p></div><span className="status-pill"><ShieldCheck size={13}/> Connected</span></div>{content}</article>}</div></section></main>;
}

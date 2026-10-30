"use client";
import Image from "next/image";
import {useMemo,useState} from "react";
import {Circle,ChevronRight,Eye,LockKeyhole,ArrowLeft,ShieldCheck} from "lucide-react";
import {ROLE_SECTIONS,ROLE_LABELS,ROLE_LANDING,type ProcureFlowRole} from "@/lib/procureflow/roles";
import {Dashboard} from "@/components/complete-role-shell";
import type {ParityData} from "@/lib/procureflow/parity-data";
import type {SecurityMigrationStatus} from "@/lib/procureflow/security-check";

type Target={id:number;fullName:string;username:string;role:ProcureFlowRole};
type Props={target:Target;facilityData?:any;procurementData?:any;approverData?:any;financeData?:any;logisticsData?:any;auditorData?:any;parityData:ParityData;securityStatus:SecurityMigrationStatus};
const date=(v:unknown)=>{if(!v)return "—";const d=new Date(String(v));return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-NG",{day:"2-digit",month:"short",year:"numeric"});};
const naira=(v:unknown)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(v||0));
const displayed=(v:unknown)=>String(v??"—");
function rowsForSection(section:string,props:Props):any[]{
 const {target,facilityData,procurementData,approverData,financeData,logisticsData,parityData}=props;
 const s=section.toLowerCase();
 if(s.includes("activity")||s.includes("history"))return parityData.activities||[];
 if(s.includes("gateway"))return parityData.gateways||[];
 if(s.includes("return pass"))return parityData.returnPasses||[];
 if(s.includes("vendor"))return parityData.vendors||[];
 if(s.includes("invoice"))return parityData.invoices||[];
 if(s.includes("receipt"))return financeData?.receipts||parityData.receipts||[];
 if(s.includes("payment"))return financeData?.payments||parityData.reconciliation||[];
 if(s.includes("cash advances"))return parityData.cashAdvances||[];
 if(s.includes("reconciliation"))return parityData.reconciliation||[];
 if(s.includes("sourcing")||s.includes("quotations"))return procurementData?.sourcingTasks||[];
 if(s.includes("purchase order")||s.includes("commercial po")||s.includes("po delivery"))return parityData.purchaseOrders||[];
 if(s.includes("delivery")||s.includes("receiving"))return logisticsData?.receivingSlips||[];
 if(s.includes("approved")&&target.role==="Approver")return approverData?.history||[];
 if(s.includes("draft"))return target.role==="Procurement Manager"?procurementData?.drafts||[]:facilityData?.drafts||[];
 if(s.includes("returned requests"))return facilityData?.returned||[];
 if(s.includes("approved / accepted"))return facilityData?.approved||[];
 if(s.includes("pending approvals")||s.includes("quote comparison"))return approverData?.pendingRequests||[];
 if(s.includes("my approval history"))return approverData?.history||[];
 if(s.includes("low-value"))return parityData.lowValueQueue||[];
 if(s.includes("closure"))return parityData.closureQueue||[];
 if(s.includes("utility head")||s.includes("facility head inbox"))return procurementData?.inbox||[];
 if(s.includes("budget")||s.includes("income")||s.includes("settings")||s.includes("create")||s.includes("submit")||s.includes("suggest")||s.includes("availability"))return [];
 if(s.includes("request"))return target.role==="Facility Manager"||target.role==="ICT"?parityData.requests:procurementData?.requests||parityData.requests;
 return [];
}
function ReadOnlyRows({section,rows}:{section:string;rows:any[]}){
 if(!rows.length)return <div className="empty-state">No matching read-only records are available in this section. Interactive forms are intentionally not opened during inspection.</div>;
 return <div className="table-wrap"><table className="data-table"><thead><tr><th>Reference / Record</th><th>Context</th><th>Amount</th><th>Status / Action</th><th>Date</th></tr></thead><tbody>{rows.slice(0,120).map((r:any,i:number)=><tr key={r.id||i}><td><strong>{displayed(r.requestNo||r.request_no||r.po_no||r.payment_no||r.receipt_no||r.pass_number||r.name||r.action||r.id)}</strong></td><td>{displayed(r.departmentProject||r.department_project||r.category||r.purpose||r.entity_type||r.public_summary||r.vendor_name)}</td><td>{r.estimatedAmount!=null||r.estimated_amount!=null||r.amount!=null||r.total_amount!=null?naira(r.estimatedAmount??r.estimated_amount??r.amount??r.total_amount):"—"}</td><td><span className="status-chip">{displayed(r.status||r.payment_status||r.action||r.receiving_status)}</span></td><td>{date(r.updatedAt||r.updated_at||r.created_at||r.request_date||r.payment_date)}</td></tr>)}</tbody></table></div>;
}
export function AdminWorkspaceMirrorView(props:Props){
 const {target,parityData,securityStatus}=props;
 const nav=ROLE_SECTIONS[target.role]?.sections||[];
 const [section,setSection]=useState(nav[0]||"Dashboard");
 const isDashboard=section.toLowerCase().includes("dashboard");
 const rows=useMemo(()=>rowsForSection(section,props),[section,props]);
 const initials=target.fullName.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join("");
 return <main className="app-frame admin-workspace-mirror-shell">
  <aside className="sidebar"><div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div>
   <div className="sidebar-context"><span>{ROLE_SECTIONS[target.role]?.title||"Employee Navigation"}</span><strong>{ROLE_LABELS[target.role]||target.role}</strong></div>
   <nav className="sidebar-nav">{nav.map(s=><button type="button" key={s} className={s===section?"active":""} onClick={()=>setSection(s)}><Circle size={8} fill="currentColor"/><span>{s}</span></button>)}</nav>
   <div className="sidebar-footer"><a href="/app" className="admin-mirror-return"><ArrowLeft size={16}/>Exit inspection</a></div>
  </aside>
  <section className="workspace">
   <header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14}/> {section}</div><p>{ROLE_LANDING[target.role]}</p></div><div className="topbar-actions"><span className="admin-mirror-readonly"><LockKeyhole size={14}/> Read-only observation</span><div className="user-chip"><span className="avatar">{initials}</span><div><strong>{target.fullName}</strong><small>{ROLE_LABELS[target.role]||target.role}</small></div></div></div></header>
   <div className="content-wrap">
    <div className="admin-mirror-banner"><Eye size={20}/><div><strong>Admin Workspace Inspector · {target.fullName}</strong><span>Viewing the selected employee's dashboard data. You remain signed in as Admin. No requests, payments or settings can be changed here.</span></div><a href="/app"><ArrowLeft size={15}/>Return to Admin</a></div>
    <div className="page-heading"><div><span className="eyebrow">{ROLE_LABELS[target.role]||target.role}</span><h1>{section}</h1><p>{isDashboard?"Live operational dashboard using the same metrics and layout as the employee workspace.":"Read-only operational records — workflow controls and forms are disabled."}</p></div><Image src="/branding/cmotd_company_wordmark.png" width={245} height={60} alt="CMOTD" className="header-wordmark"/></div>
    {isDashboard?<Dashboard role={target.role} facilityData={props.facilityData} procurementData={props.procurementData} approverData={props.approverData} financeData={props.financeData} logisticsData={props.logisticsData} adminData={undefined} auditorData={props.auditorData} parityData={parityData} securityStatus={securityStatus}/>:<article className="panel live-section-panel"><div className="panel-heading"><div><h2>{section}</h2><p>Read-only section summary from the employee's operational data.</p></div><span className="status-pill"><ShieldCheck size={14}/> Inspection mode</span></div><ReadOnlyRows section={section} rows={rows}/></article>}
   </div>
  </section>
 </main>;
}

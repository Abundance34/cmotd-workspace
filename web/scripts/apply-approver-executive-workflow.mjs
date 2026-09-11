import fs from "node:fs";
import path from "node:path";
const root="/app",MARKER="APPROVER_EXECUTIVE_WORKFLOW_V1";
const read=p=>fs.readFileSync(path.join(root,p),"utf8").replace(/\r\n?/g,"\n");
const write=(p,v)=>fs.writeFileSync(path.join(root,p),v,"utf8");
const need=(s,m,l)=>{if(!s.includes(m))throw new Error(`Approver executive patch could not find ${l}.`);};

{
 const p="app/app/page.tsx";let s=read(p);
 s=s.replace('import { getApproverDashboardData } from "@/lib/procureflow/approver-data";','import { getExecutiveApproverDashboardData } from "@/lib/procureflow/approver-executive-data";');
 s=s.replace('user.role === "Approver" ? getApproverDashboardData(user.id) : Promise.resolve(undefined)','user.role === "Approver" ? getExecutiveApproverDashboardData(user.id) : Promise.resolve(undefined)');
 need(s,"getExecutiveApproverDashboardData","executive Approver data loader");write(p,s);
}
{
 const p="lib/procureflow/roles.ts";let s=read(p);
 s=s.replace(/  Approver: \{\n    title: "Executive Navigation",\n    sections: \[[\s\S]*?\n    \],\n  \},/,
`  Approver: {
    title: "Executive Navigation",
    sections: [
      "Approval Dashboard", "Reimbursement Request", "Pending Approvals", "Approved Requests", "Quote Comparison", "PO Approval",
      "Pending Payments", "Gateway Pass Approval", "Availability / Away Notice", "My Approval History", "Income", "Settings",
    ],
  },`);
 need(s,'"Approved Requests"',"Approved Requests navigation");need(s,'"Pending Payments"',"Pending Payments navigation");write(p,s);
}
{
 const p="components/complete-role-shell.tsx";let s=read(p);
 const imp='import { ApproverPendingRequests, ApproverApprovedRequests, ApproverPendingPayments, ApproverApprovalHistory } from "@/components/approver-executive-workspace";';
 if(!s.includes(imp)){const a='import { ApproverRequests } from "@/components/approver-requests";';need(s,a,"Approver request import");s=s.replace(a,`${a}\n${imp}`);}
 const block=`function ApproverSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){
  if(section==="Pending Approvals")return <ApproverPendingRequests rows={data?.pendingApprovals||[]}/>;
  if(section==="Approved Requests")return <ApproverApprovedRequests rows={data?.approvedRequests||[]}/>;
  if(section==="Quote Comparison")return <ApproverRequests rows={data?.quoteComparisons||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit} mode="quotes"/>;
  if(section==="PO Approval")return <ApproverPOApprovals rows={data?.pendingPOs||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;
  if(section==="Pending Payments")return <ApproverPendingPayments rows={data?.pendingPaymentRequests||[]}/>;
  if(section==="Gateway Pass Approval")return <ApproverGatewayApprovals rows={data?.pendingGatewayPasses||[]}/>;
  if(section==="Availability / Away Notice")return <ParityWorkspace section={section} role="Approver" data={parityData}/>;
  if(section==="My Approval History")return <ApproverApprovalHistory rows={data?.requestApprovalHistory||[]}/>;
  return null;
}

`;
 const re=/function ApproverSection\([\s\S]*?\n}\n\n(?=function FinanceSection)/;if(!re.test(s))throw new Error("Approver executive patch could not find ApproverSection.");s=s.replace(re,block);
 s=s.replace(/else if\(role==="Approver"\)\{cards=\[[\s\S]*?\];summary=`[^`]*`;\}/,
 'else if(role==="Approver"){cards=[["Pending Approvals",String(approverData?.pendingApprovals?.length||0),"Requests awaiting decision"],["Approved Requests",String(approverData?.approvedRequests?.length||0),"Approved request register"],["Pending Payments",String(approverData?.pendingPaymentRequests?.length||0),"Awaiting Finance payment"],["Gateway Passes",String(approverData?.pendingGatewayPasses?.length||0),"Final movement approval"]];summary=`${approverData?.requestApprovalHistory?.length||0} approval-history records · ${approverData?.pendingPOs?.length||0} pending POs`;}');
 need(s,"ApproverPendingRequests","pending request workspace");need(s,"ApproverApprovedRequests","approved request workspace");need(s,"ApproverPendingPayments","pending payment workspace");write(p,s);
}
{
 const p="lib/procureflow/approver-actions.ts";let s=read(p);
 s=s.replace(
`    if (!["Submitted for Approval", "Pending Approver/MD Approval", "Pending Approval"].includes(oldStatus)) {
      throw new Error(\`This request cannot be decided from status '\${oldStatus || "Unknown"}'.\`);
    }`,
`    const routedToApprover = request.next_role === "approver" || ["Submitted for Approval", "Pending Approver/MD Approval", "Pending Approval"].includes(oldStatus);
    if (!routedToApprover) {
      throw new Error(\`This request cannot be decided from status '\${oldStatus || "Unknown"}'.\`);
    }`);
 s=s.replace(
`    if (amount <= approvalLimit && !pmOriginated && user.role !== "Admin") {
      throw new Error("This is a low-value Facility / Utility request and belongs to Procurement Manager approval, not Approver / MD.");
    }

`,"");
 s=s.replace(
`    const approvalMode = pmOriginated && amount <= approvalLimit
      ? "Segregation of Duties — PM-Originated Request"
      : "Normal Approval Mode";`,
`    const approvalMode = pmOriginated
      ? "Segregation of Duties — PM-Originated Request"
      : amount <= approvalLimit
        ? "Approver / MD Direct Approval — Low Value"
        : "Approver / MD Approval";`);
 need(s,"const routedToApprover","Approver queue authority");need(s,"Approver / MD Direct Approval — Low Value","unified low/high approval");write(p,s);
}
{
 const p="app/api/payee-details/reveal/route.ts";let s=read(p);
 s=s.replace('["Facility Manager", "ICT", "Procurement Manager", "Finance", "Admin"]','["Facility Manager", "ICT", "Procurement Manager", "Approver", "Finance", "Admin"]');
 if(!s.includes("const approverVisible"))s=s.replace(
`      const financeReady = FINANCE_READY_STATUSES.has(String(record.status || ""))
        || ["Approved for Payment", "Paid"].includes(String(record.payment_status || ""));`,
`      const financeReady = FINANCE_READY_STATUSES.has(String(record.status || ""))
        || ["Approved for Payment", "Paid"].includes(String(record.payment_status || ""));
      const approverVisible = record.next_role === "approver"
        || ["Submitted for Approval", "Pending Approver/MD Approval", "Pending Approval"].includes(String(record.status || ""))
        || financeReady;`);
 s=s.replace(
`        || (user.role === "Procurement Manager" && assignedProcurement)
        || (user.role === "Finance" && financeReady);`,
`        || (user.role === "Procurement Manager" && assignedProcurement)
        || (user.role === "Approver" && approverVisible)
        || (user.role === "Finance" && financeReady);`);
 need(s,'user.role === "Approver" && approverVisible',"audited Approver payee reveal");write(p,s);
}
{
 const p="components/standard-notifications.tsx";let s=read(p);
 s=s.replace(/  Approver: \[[\s\S]*?\n  \],\n  Finance:/,
`  Approver: [
    "Approval Dashboard", "Reimbursement Request", "Pending Approvals", "Approved Requests", "Quote Comparison", "PO Approval",
    "Pending Payments", "Gateway Pass Approval", "Availability / Away Notice", "My Approval History", "Income", "Settings",
  ],
  Finance:`);
 s=s.replace(/  if \(role === "Approver"\) \{[\s\S]*?\n  \}\n\n  if \(role === "Finance"\)/,
`  if (role === "Approver") {
    if (/gateway/.test(text)) return "Gateway Pass Approval";
    if (/purchase order|\\bpo\\b/.test(text)) return "PO Approval";
    if (/quote/.test(text)) return "Quote Comparison";
    if (/approved for payment|awaiting payment|payment reminder|pending payment/.test(text) && !/payment recorded|\\bpaid\\b|completed/.test(text)) return "Pending Payments";
    if (/approved|completed|payment recorded|\\bpaid\\b|low[- ]?value approval audit/.test(text) && !/requires approval|pending approval|submitted for approval|awaiting approval/.test(text)) return "Approved Requests";
    if (/history|rejected|returned/.test(text)) return "My Approval History";
    if (/income|budget/.test(text)) return "Income";
    return "Pending Approvals";
  }

  if (role === "Finance")`);
 s=s.replace(
`  return notifications.map((notification) => {
    const originalTarget = String(notification?.section_target || "").trim();
    const sectionTarget = valid.has(originalTarget) ? originalTarget : inferTarget(role, notification);
    return { ...notification, original_section_target: originalTarget || null, section_target: sectionTarget };
  });`,
`  return notifications.map((notification) => {
    const originalTarget = String(notification?.section_target || "").trim();
    const text = haystack(notification);
    let sectionTarget: string;
    if (role === "Approver") {
      const request = String(notification?.entity_type || "") === "Purchase Request";
      const pending = /requires approval|pending approval|submitted for approval|awaiting approval/.test(text);
      if (request && /approved for payment|awaiting payment|payment reminder|pending payment/.test(text) && !/payment recorded|\\bpaid\\b|completed/.test(text)) sectionTarget = "Pending Payments";
      else if (request && /approved|completed|payment recorded|\\bpaid\\b|low[- ]?value approval audit/.test(text) && !pending) sectionTarget = "Approved Requests";
      else if (request && pending) sectionTarget = "Pending Approvals";
      else if (originalTarget === "Payment Approval") sectionTarget = "Pending Payments";
      else sectionTarget = valid.has(originalTarget) ? originalTarget : inferTarget(role, notification);
    } else sectionTarget = valid.has(originalTarget) ? originalTarget : inferTarget(role, notification);
    return { ...notification, original_section_target: originalTarget || null, section_target: sectionTarget };
  });`);
 const old=`  async function dismiss(notificationId: number) {
    await markRead(notificationId).catch(() => undefined);
    router.refresh();
  }

  return <div className="standard-section-notices" aria-label={\`Unread \${section} notifications\`}>
    {relevant.map((notification) => <article key={notification.id}>
      <div><span>NEW</span><strong>{notification.title || "New activity"}</strong><p>{notification.message || "New workflow activity is available."}</p></div>
      <button type="button" onClick={() => void dismiss(Number(notification.id))}><Check size={14}/> Mark read</button>
    </article>)}
  </div>;`;
 const neu=`  async function dismiss(notificationId: number) {
    await markRead(notificationId).catch(() => undefined);
    router.refresh();
  }
  async function open(notification: any) {
    await markRead(Number(notification.id)).catch(() => undefined);
    const requestId = Number(notification.entity_id || 0);
    const eventName = section === "Approved Requests" ? "procureflow:open-approved-request" : section === "Pending Payments" ? "procureflow:open-pending-payment" : "procureflow:open-approver-request";
    if (requestId > 0) window.dispatchEvent(new CustomEvent(eventName, { detail: { requestId } }));
  }

  return <div className="standard-section-notices" aria-label={\`Unread \${section} notifications\`}>
    {relevant.map((notification) => {
      const executiveOpen = role === "Approver" && ["Pending Approvals","Approved Requests","Pending Payments"].includes(section) && String(notification.entity_type || "") === "Purchase Request";
      return <article key={notification.id}>
        <div><span>NEW</span><strong>{notification.title || "New activity"}</strong><p>{notification.message || "New workflow activity is available."}</p></div>
        {executiveOpen ? <button type="button" onClick={() => void open(notification)}>Open <ChevronRight size={14}/></button> : <button type="button" onClick={() => void dismiss(Number(notification.id))}><Check size={14}/> Mark read</button>}
      </article>;
    })}
  </div>;`;
 need(s,old,"section notice actions");s=s.replace(old,neu);need(s,'"Approved Requests"',"Approved Requests notification target");need(s,"procureflow:open-approver-request","Open request notification");write(p,s);
}
{
 const p="app/local-preview-parity.css";let s=read(p);
 if(!s.includes(MARKER))s+=`

/* ${MARKER} */
.approver-executive-workspace{display:grid;gap:16px}.approver-executive-picker,.approver-executive-decision,.pending-payment-status-card,.approval-history-summary,.approver-approved-banner,.approver-request-hero,.approver-detail-section{padding:14px;border:1px solid var(--pf-border);border-radius:10px;background:var(--pf-surface);color:var(--pf-text)}
.approver-executive-picker label{display:grid;gap:6px}.approver-executive-picker label>span{font-size:12.5px;font-weight:800}.approver-executive-picker select{width:100%;min-height:44px;padding:9px 11px;border:1px solid var(--pf-border-strong);border-radius:8px;background:var(--pf-surface-2);color:var(--pf-text);font:inherit}.approver-executive-picker small{display:block;margin-top:6px;color:var(--pf-muted)}
.approver-full-request-detail{display:grid;gap:14px}.approver-request-hero{display:flex;justify-content:space-between;gap:16px}.approver-request-hero>div>span{font-size:10.5px;font-weight:850;letter-spacing:.1em;color:var(--pf-primary)}.approver-request-hero h3{margin:4px 0 2px;font-size:21px}.approver-request-hero p{margin:0;color:var(--pf-muted)}
.approver-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.approver-detail-grid article,.approver-payee-grid span,.pending-payment-facts span,.approval-history-grid span{padding:10px;border:1px solid var(--pf-border);border-radius:8px;background:var(--pf-surface-2)}.approver-detail-grid span,.approver-payee-grid span,.pending-payment-facts span,.approval-history-grid span{color:var(--pf-muted);font-size:11.5px}.approver-detail-grid strong,.approver-payee-grid b,.pending-payment-facts b,.approval-history-grid b{display:block;margin-top:3px;color:var(--pf-text);font-size:13px}.approver-detail-grid small{display:block;color:var(--pf-muted)}
.approver-detail-section-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:9px}.approver-detail-section-head span{color:var(--pf-muted);font-size:11.5px}.approver-long-text{margin:0;white-space:pre-wrap}.approver-payee-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.approver-sourcing-summary,.approver-linked-record{padding:10px;border:1px solid var(--pf-border);border-radius:8px;background:var(--pf-surface-2);margin-top:8px}.approver-sourcing-summary span,.approver-sourcing-summary p,.approver-linked-record span,.approver-linked-record small{display:block;color:var(--pf-muted);font-size:12px}.approver-linked-items{margin-top:8px}
.approver-timeline{display:grid}.approver-timeline>div{display:grid;grid-template-columns:14px 1fr;gap:9px;padding-bottom:10px}.approver-timeline>div>span{width:9px;height:9px;margin-top:5px;border-radius:50%;background:var(--pf-primary)}.approver-timeline strong,.approver-timeline small,.approver-timeline p,.approver-timeline em{display:block}.approver-timeline small,.approver-timeline p,.approver-timeline em{color:var(--pf-muted);font-size:12px}.approver-timeline p,.approver-timeline em{margin:2px 0 0}.approver-timeline em{font-style:normal}
.approver-executive-decision>div:first-child,.pending-payment-heading,.approval-history-summary>div:first-child,.approver-approved-banner{display:flex;gap:10px;align-items:flex-start}.approver-executive-decision label,.payment-reminder-note{display:grid;gap:6px;margin-top:12px}.approver-executive-decision textarea,.payment-reminder-note textarea{width:100%;padding:10px;border:1px solid var(--pf-border-strong);border-radius:8px;background:var(--pf-surface-2);color:var(--pf-text);font:inherit}.pending-payment-facts,.approval-history-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.payment-delay-reason{display:flex;gap:10px;margin-top:12px;padding:11px;border:1px solid rgba(241,180,76,.35);border-radius:8px;background:rgba(241,180,76,.08)}.payment-delay-reason span,.payment-delay-reason small{display:block;color:var(--pf-muted);font-size:12px}.payment-reminder-button{margin-top:12px;display:inline-flex;align-items:center;gap:7px;border:0;border-radius:8px;background:var(--pf-primary);color:#fff;padding:10px 14px;font-weight:800;cursor:pointer}
html[data-theme="dark"] .approver-executive-picker select option{background:#273047;color:#f5f7fb}@media(max-width:1100px){.approver-detail-grid,.approver-payee-grid,.pending-payment-facts,.approval-history-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.approver-detail-grid,.approver-payee-grid,.pending-payment-facts,.approval-history-grid{grid-template-columns:1fr}.approver-request-hero{flex-direction:column}}
`;
 need(s,MARKER,"executive CSS marker");write(p,s);
}
console.log("Approver executive workflow applied: pending requests open to full detail and unified approval, approved requests have a dedicated register, payment approval is replaced by Finance-reminder monitoring, and approval history is a full-detail dropdown.");

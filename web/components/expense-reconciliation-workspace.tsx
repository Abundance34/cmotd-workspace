"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronDown, CircleDollarSign, FileCheck2, FilePlus2, FileText, RefreshCw, ShieldCheck, Upload, Wallet, XCircle } from "lucide-react";

type Role = string;
type Row=any;
type Line={id:number;item_name:string;item_description?:string|null;budget_quantity:number;budget_unit_price:number;budget_total:number;actual_quantity:number;actual_unit_price:number;actual_total:number;note:string|null};
type Data={records:Row[];items:Line[];refunds:Row[];evidence:Row[];events:Row[];candidates:Row[];role:Role};
const EMPLOYEE=new Set(["Facility Manager","ICT","Logistics Officer","Procurement Manager"]);
const EDITABLE=new Set(["Draft","Returned for Correction"]);
const MONEY=(n:any)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(Number(n||0));
const DATE=(v:any)=>v?new Date(String(v)).toLocaleDateString("en-NG",{day:"2-digit",month:"short",year:"numeric"}):"—";
const STATUS=(s:any)=>String(s||"Draft");
function formatRole(s:any){return String(s||"—")==="Logistics Officer"?"Logistics Manager":String(s||"—");}
async function toFile(input:File|null){
 if(!input)throw new Error("Choose a PDF, PNG, JPG, or WebP evidence file.");
 if(input.size>2500000)throw new Error("Choose a file smaller than 2.5 MB.");
 if(!["application/pdf","image/png","image/jpeg","image/webp"].includes(input.type))throw new Error("Only PDFs or images are supported.");
 const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||"").split(",").pop()||"");reader.onerror=()=>reject(new Error("Could not read the file."));reader.readAsDataURL(input);});
 return {fileName:input.name,mimeType:input.type,base64};
}
async function send(action:string,payload:any){
 const response=await fetch("/api/expense-reconciliation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,payload})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Unable to complete the requested action.");
 return data.result;
}
function Empty({children}:{children:React.ReactNode}){return <p className="expense-empty">{children}</p>;}
function Chip({status}:{status:any}){return <span className={"expense-chip "+(STATUS(status)==="Completed"||STATUS(status)==="Savings Recorded"?"success":STATUS(status)==="Rejected"?"danger":"")}>{STATUS(status)}</span>;}
function Stat({label,value,sub}:{label:string;value:string;sub?:string}){return <div className="expense-stat"><span>{label}</span><strong>{value}</strong>{sub?<small>{sub}</small>:null}</div>;}

export function ExpenseReconciliationWorkspace({role}:{role:Role}){
 const router=useRouter();
 const [data,setData]=useState<Data|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [busy,setBusy]=useState("");
 const [tab,setTab]=useState(role==="Finance"?"Finance":role==="Admin"||role==="Auditor"?"All":role==="Approver"?"Review":"Mine");
 const [selectedId,setSelectedId]=useState<number|null>(null);
 const [newRequestId,setNewRequestId]=useState("");
 const [draftLines,setDraftLines]=useState<Line[]>([]);
 const [explanation,setExplanation]=useState("");
 const [receiptFile,setReceiptFile]=useState<File|null>(null);
 const [note,setNote]=useState("");
 const [fundingType,setFundingType]=useState("Budget Only");
 const [releasedAmount,setReleasedAmount]=useState("");
 const [fundingReference,setFundingReference]=useState("");
 const [refundAmount,setRefundAmount]=useState("");
 const [refundReference,setRefundReference]=useState("");
 const [refundDate,setRefundDate]=useState(new Date().toISOString().slice(0,10));
 const [refundFile,setRefundFile]=useState<File|null>(null);
 const [filter,setFilter]=useState("");
 const employee=EMPLOYEE.has(role);
 const refresh=useCallback(async()=>{try{const response=await fetch("/api/expense-reconciliation",{cache:"no-store"});const json=await response.json().catch(()=>({}));if(!response.ok)throw new Error(json.error||"Unable to load reconciliations.");setData(json);setError("");}catch(e){setError(e instanceof Error?e.message:"Unable to load expense reconciliations.");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const rows=data?.records||[];
 const selected=rows.find(r=>Number(r.id)===Number(selectedId))||null;
 const lines=useMemo(()=>data?.items.filter(x=>x&&Number((x as any).reconciliation_id)===Number(selectedId))||[],[data,selectedId]);
 const refunds=useMemo(()=>data?.refunds.filter(x=>Number(x.reconciliation_id)===Number(selectedId))||[],[data,selectedId]);
 const evidence=useMemo(()=>data?.evidence.filter(x=>Number(x.reconciliation_id)===Number(selectedId))||[],[data,selectedId]);
 const events=useMemo(()=>data?.events.filter(x=>Number(x.reconciliation_id)===Number(selectedId))||[],[data,selectedId]);
 useEffect(()=>{
  setDraftLines(lines.map(line=>({...line,actual_quantity:Number(line.actual_quantity||0),actual_unit_price:Number(line.actual_unit_price||0)})));
  setExplanation(selected?.explanation||"");
  setNote("");
  setFundingType("Budget Only");
  setReleasedAmount("");
  setFundingReference("");
  setRefundAmount("");
  setRefundReference("");
 },[selectedId,data?.items,selected?.explanation]);
 const totals=useMemo(()=>{const total=draftLines.reduce((sum,line)=>sum+Number(line.actual_quantity||0)*Number(line.actual_unit_price||0),0);return Number(total.toFixed(2));},[draftLines]);
 const verifiedRefund=refunds.filter(r=>r.status==="Verified").reduce((s,r)=>s+Number(r.amount),0);
 const pendingRefund=refunds.filter(r=>r.status==="Submitted").reduce((s,r)=>s+Number(r.amount),0);
 const refundDue=Math.max(0,Number(selected?.released_amount||0)-Number(selected?.actual_total||0)-verifiedRefund);
 const usableRefund=Math.max(0,refundDue-pendingRefund);
 const eligible=(data?.candidates||[]);
 const queue=rows.filter(r=>r.status==="Submitted"&&r.reviewer_role===role&&r.creator_id!==Number((data as any)?.currentUserId));
 const financeQueue=rows.filter(r=>r.status==="Funding Verification Pending"||r.status==="Refund Submitted"||r.status==="Partially Refunded"||r.status==="Refund Pending");
 const filtered=rows.filter(r=>{
   if(tab==="Review"&&!(r.status==="Submitted"&&r.reviewer_role===role))return false;
   if(tab==="Finance"&&!financeQueue.some(f=>f.id===r.id))return false;
   if(filter&&!String([r.reconciliation_no,r.request_no,r.creator_name,r.status,r.department_project,r.request_category].join(" ")).toLowerCase().includes(filter.toLowerCase()))return false;
   return true;
 });
 const [currentUserId,setCurrentUserId]=useState<number|null>(null);
 useEffect(()=>{if(data&&(data as any).userId)setCurrentUserId(Number((data as any).userId));},[data]);
 const visible=filtered.filter(r=>tab!=="Mine"||!employee||currentUserId===null||r.creator_id===currentUserId);
 async function execute(label:string,action:string,payload:any,after?:(result:any)=>void){
  setBusy(label);setError("");setSuccess("");
  try{const result=await send(action,payload);setSuccess(label+" saved successfully.");if(after)after(result);await refresh();router.refresh();}
  catch(e){setError(e instanceof Error?e.message:"Unable to save.");}
  finally{setBusy("");}
 }
 if(loading)return <div className="expense-panel">Loading Expense Reconciliation…</div>;
 if(!data)return <div className="expense-panel"><div className="action-message error">{error||"Unable to load."}</div><button onClick={()=>void refresh()}>Retry</button></div>;
 const canEdit=selected&&selected.creator_id===currentUserId&&EDITABLE.has(selected.status);
 const canReview=selected&&selected.status==="Submitted"&&selected.reviewer_role===role&&selected.creator_id!==currentUserId;
 const canFinance=selected&&role==="Finance";
 const canRefund=selected&&selected.creator_id===currentUserId&&["Refund Pending","Partially Refunded"].includes(selected.status)&&usableRefund>0;
 const receiptCount=evidence.filter(x=>x.kind==="Expense Receipt").length;

 return <div className="expense-workspace">
  <header className="expense-header"><div className="expense-headline"><Wallet size={23}/><div><h2>Expense Reconciliation & Refunds</h2><p>Account for actual purchases, verify every amount spent, and track unused funds until Finance confirms their return.</p></div></div><button className="expense-refresh" onClick={()=>void refresh()}><RefreshCw size={15}/> Refresh</button></header>
  {error?<div className="action-message error" role="alert">{error}</div>:null}
  {success?<div className="action-message success" role="status">{success}</div>:null}
  <section className="expense-overview">
    <Stat label="Reports" value={String(rows.length)} sub="Recorded reconciliation files"/>
    <Stat label="Awaiting expense review" value={String(rows.filter(r=>r.status==="Submitted").length)}/>
    <Stat label="Pending refunds" value={MONEY(rows.reduce((s,r)=>s+Math.max(0,Number(r.released_amount||0)-Number(r.actual_total||0)-(data.refunds.filter(x=>x.reconciliation_id===r.id&&x.status==="Verified").reduce((p,x)=>p+Number(x.amount),0))),0))}/>
    <Stat label="Savings recorded" value={MONEY(rows.filter(r=>r.funding_type==="Budget Only"&&r.status==="Savings Recorded").reduce((s,r)=>s+Math.max(0,Number(r.original_approved_amount)-Number(r.actual_total)),0))}/>
  </section>
  {employee&&eligible.length?<section className="expense-panel expense-create"><div><h3>Start from an approved Purchase Request</h3><p>The original approved budget and item prices are preserved. You only enter the actual quantities and prices.</p></div><select aria-label="Select purchase request" value={newRequestId} onChange={e=>setNewRequestId(e.target.value)}><option value="">Select your approved request…</option>{eligible.map(r=><option key={r.id} value={r.id}>{r.request_no} — {r.category||r.department_project} — {MONEY(r.estimated_amount)}</option>)}</select><button className="expense-primary" disabled={!newRequestId||!!busy} onClick={()=>void execute("Draft","create",{requestId:Number(newRequestId)},r=>{setSelectedId(r.id);setNewRequestId("");setTab("Mine");})}><FilePlus2 size={16}/> Create Draft</button></section>:null}
  <nav className="expense-tabs">{employee?<button className={tab==="Mine"?"active":""} onClick={()=>setTab("Mine")}>My Reports</button>:null}{(role==="Procurement Manager"||role==="Approver")?<button className={tab==="Review"?"active":""} onClick={()=>setTab("Review")}>Awaiting Review</button>:null}{role==="Finance"?<button className={tab==="Finance"?"active":""} onClick={()=>setTab("Finance")}>Finance Verification</button>:null}{["Finance","Admin","Auditor","Approver","Procurement Manager"].includes(role)?<button className={tab==="All"?"active":""} onClick={()=>setTab("All")}>Register / History</button>:null}</nav>
  <div className="expense-columns">
   <aside className="expense-list"><label className="expense-list-search"><span>Find a reconciliation</span><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search request, department, status…"/></label><div className="expense-result-count">{visible.length} reconciliation{visible.length===1?"":"s"}</div>{visible.length?visible.map(r=><button key={r.id} className={"expense-record "+(selectedId===r.id?"selected":"")} onClick={()=>setSelectedId(r.id)}><span><strong>{r.reconciliation_no}</strong><ChevronDown size={15}/></span><b>{r.request_no}</b><small>{r.creator_name||"Employee"} · {DATE(r.created_at)}</small><span className="expense-record-foot"><Chip status={r.status}/><strong>{MONEY(r.actual_total)}</strong></span></button>):<Empty>No reconciliation reports match this view.</Empty>}</aside>
   <main className="expense-detail">
   {!selected?<div className="expense-panel expense-intro"><CircleDollarSign size={36}/><h3>Select a reconciliation to open it</h3><p>Choose a draft, an approved request to reconcile, or a report awaiting your review. Actual expenditure and refund confirmation are kept as separate controls.</p></div>:<>
    <div className="expense-panel">
      <div className="expense-detail-heading"><div><span>Expense report · {selected.reconciliation_no}</span><h3>{selected.request_no}</h3><p>{selected.department_project||"General"} · {selected.request_category||"Uncategorised"} · by {selected.creator_name}</p></div><Chip status={selected.status}/></div>
      <div className="expense-finance-grid"><Stat label="Original approved amount" value={MONEY(selected.original_approved_amount)}/><Stat label="Actual expenditure" value={MONEY(canEdit?totals:selected.actual_total)}/><Stat label="Budget difference" value={MONEY(Number(selected.original_approved_amount)-(canEdit?totals:Number(selected.actual_total)))}/><Stat label="Finance-confirmed advance" value={selected.funding_type==="Employee Advance"?MONEY(selected.released_amount):"Not confirmed"}/></div>
      {selected.funding_type==="Budget Only"?<div className="expense-notice"><CheckCircle2 size={16}/> Budget savings recorded; no employee cash refund is due.</div>:selected.funding_type==="Employee Advance"?<div className="expense-notice"><Wallet size={16}/> Refund outstanding after Finance verification: <strong>{MONEY(refundDue)}</strong>. Pending transfer evidence: {MONEY(pendingRefund)}.</div>:<div className="expense-notice"><AlertTriangle size={16}/> An approved request is not proof of money released to an employee. Finance must confirm funding before any refund can be considered received.</div>}
      <h4>Original items vs actual purchases</h4>
      <div className="table-wrap"><table className="data-table expense-items"><thead><tr><th>Item / Description</th><th>Budget Qty</th><th>Budget / Unit</th><th>Budget Total</th><th>Actual Qty</th><th>Actual / Unit (₦)</th><th>Actual Total</th></tr></thead><tbody>{(canEdit?draftLines:lines).map((line,index)=><tr key={line.id}><td><strong>{line.item_name}</strong><small>{line.item_description||line.note||""}</small></td><td>{line.budget_quantity}</td><td>{MONEY(line.budget_unit_price)}</td><td>{MONEY(line.budget_total)}</td><td>{canEdit?<input type="number" min="0" step="0.0001" value={line.actual_quantity} onChange={e=>setDraftLines(prev=>prev.map((x,i)=>i===index?{...x,actual_quantity:Number(e.target.value)}:x))}/>:line.actual_quantity}</td><td>{canEdit?<input type="number" min="0" step="0.01" value={line.actual_unit_price} onChange={e=>setDraftLines(prev=>prev.map((x,i)=>i===index?{...x,actual_unit_price:Number(e.target.value)}:x))}/>:MONEY(line.actual_unit_price)}</td><td><strong>{MONEY(canEdit?Number(line.actual_quantity)*Number(line.actual_unit_price):line.actual_total)}</strong></td></tr>)}</tbody></table></div>
      {canEdit?<div className="expense-edit"><label>Explanation / differences / unused or missing items<textarea rows={3} value={explanation} onChange={e=>setExplanation(e.target.value)} placeholder="Why did actual prices or quantities differ from the original request?"/></label><div className="expense-actions"><button className="expense-primary" disabled={!!busy||draftLines.length===0} onClick={()=>void execute("Expense draft","save",{reconciliationId:selected.id,items:draftLines.map(x=>({id:x.id,actualQuantity:x.actual_quantity,actualUnitPrice:x.actual_unit_price,note:x.note})),explanation})}><FileCheck2 size={15}/> Save Draft</button><button disabled={!!busy} onClick={()=>void execute("Expense report","submit",{reconciliationId:selected.id})}><ArrowRightLeft size={15}/> Submit to {selected.reviewer_role}</button></div><p className="expense-hint">Save your amounts and attach receipts before submitting. Submitting locks the amounts for independent verification.</p></div>:<div className="expense-explanation"><strong>Employee explanation</strong><p>{selected.explanation||"No explanation recorded."}</p></div>}
    </div>
    <section className="expense-panel"><h4><FileText size={17}/> Purchase receipts & evidence</h4>{evidence.length?<div className="expense-evidence">{evidence.map(file=><a key={file.id} href={"/api/expense-reconciliation/evidence/"+file.id} target="_blank" rel="noreferrer"><FileText size={15}/><span><strong>{file.file_name}</strong><small>{file.kind} · {Math.round(Number(file.byte_length)/1024)} KB · {DATE(file.created_at)}</small></span></a>)}</div>:<Empty>No evidence uploaded yet.</Empty>}{canEdit?<div className="expense-upload"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>setReceiptFile(e.target.files?.[0]||null)}/><button disabled={!receiptFile||!!busy} onClick={async()=>{try{const file=await toFile(receiptFile);await execute("Receipt","upload",{reconciliationId:selected.id,file},()=>setReceiptFile(null));}catch(e){setError(e instanceof Error?e.message:"Invalid evidence file.");}}}><Upload size={15}/> Upload Purchase Receipt</button></div>:null}</section>
    {canReview?<section className="expense-panel expense-review"><h4><ShieldCheck size={17}/> Independent Procurement / Approver Review</h4><p>Check original approved prices, actual quantities, receipts and explanations before taking a decision.</p><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Approval note or clear reason for correction/rejection"/><div className="expense-actions"><button disabled={!!busy} className="expense-primary" onClick={()=>void execute("Review","review",{reconciliationId:selected.id,decision:"approve",note})}><CheckCircle2 size={15}/> Verify Expenses</button><button disabled={!!busy} onClick={()=>void execute("Correction","review",{reconciliationId:selected.id,decision:"return",note})}>Return for Correction</button><button disabled={!!busy} className="expense-danger" onClick={()=>void execute("Rejection","review",{reconciliationId:selected.id,decision:"reject",note})}><XCircle size={15}/> Reject</button></div></section>:null}
    {canFinance&&selected.status==="Funding Verification Pending"?<section className="expense-panel"><h4><ShieldCheck size={17}/> Finance Funding Confirmation</h4><p>Check bank/payment evidence outside this form. Only mark Employee Advance when Finance can verify money was actually released to this employee. Direct vendor payments are not an employee advance.</p><div className="expense-two"><label>Funding classification<select value={fundingType} onChange={e=>setFundingType(e.target.value)}><option>Budget Only</option><option>Employee Advance</option></select></label>{fundingType==="Employee Advance"?<label>Amount actually released to employee (₦)<input type="number" min="0" step="0.01" value={releasedAmount} onChange={e=>setReleasedAmount(e.target.value)}/></label>:null}</div>{fundingType==="Employee Advance"?<label>Confirmed disbursement reference<input value={fundingReference} onChange={e=>setFundingReference(e.target.value)} placeholder="Bank transfer / payment reference"/></label>:null}<label>Finance verification note<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2}/></label><div className="expense-actions"><button className="expense-primary" disabled={!!busy} onClick={()=>void execute("Funding verification","funding",{reconciliationId:selected.id,fundingType,releasedAmount:Number(releasedAmount),reference:fundingReference,note})}><CheckCircle2 size={15}/> Confirm Finance Classification</button></div></section>:null}
    {canRefund?<section className="expense-panel"><h4><ArrowRightLeft size={17}/> Return Unused Funds</h4><p>Company refunds must be transferred to the company's officially verified bank account. Enter the reference and attach transfer proof. Finance will confirm receipt independently.</p><div className="expense-two"><label>Amount being returned (₦)<input type="number" min="0.01" max={usableRefund} step="0.01" value={refundAmount} onChange={e=>setRefundAmount(e.target.value)} placeholder={String(usableRefund.toFixed(2))}/></label><label>Date of transfer<input type="date" value={refundDate} onChange={e=>setRefundDate(e.target.value)}/></label></div><label>Transfer reference<input value={refundReference} onChange={e=>setRefundReference(e.target.value)} placeholder="Bank transaction reference"/></label><label>Proof of transfer (PDF/JPG/PNG/WebP)<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>setRefundFile(e.target.files?.[0]||null)}/></label><button className="expense-primary" disabled={!!busy||!refundFile||!refundAmount||!refundReference} onClick={async()=>{try{const file=await toFile(refundFile);await execute("Refund proof","refund",{reconciliationId:selected.id,amount:Number(refundAmount),reference:refundReference,date:refundDate,file},()=>setRefundFile(null));}catch(e){setError(e instanceof Error?e.message:"Refund evidence invalid.");}}}><Upload size={15}/> Submit Refund for Finance Verification</button></section>:null}
    {refunds.length?<section className="expense-panel"><h4>Refund tracking</h4><div className="table-wrap"><table className="data-table"><thead><tr><th>Amount</th><th>Reference</th><th>Transfer date</th><th>Status</th><th>Finance confirmation</th></tr></thead><tbody>{refunds.map(refund=><tr key={refund.id}><td>{MONEY(refund.amount)}</td><td>{refund.transfer_reference}</td><td>{DATE(refund.transfer_date)}</td><td><Chip status={refund.status}/></td><td>{refund.review_note||"—"}{canFinance&&refund.status==="Submitted"?<div className="expense-refund-review"><button className="expense-primary" disabled={!!busy} onClick={()=>void execute("Bank receipt","verify-refund",{reconciliationId:selected.id,refundId:refund.id,decision:"verify",note})}>Confirm Received</button><button className="expense-danger" disabled={!!busy} onClick={()=>void execute("Refund rejection","verify-refund",{reconciliationId:selected.id,refundId:refund.id,decision:"reject",note})}>Reject Proof</button></div>:null}</td></tr>)}</tbody></table></div>{canFinance&&refunds.some(r=>r.status==="Submitted")?<label>Verification note / rejection reason<textarea rows={2} value={note} onChange={e=>setNote(e.target.value)}/></label>:null}</section>:null}
    <section className="expense-panel"><h4>Review & audit timeline</h4>{events.length?<div className="expense-timeline">{events.map(event=><div key={event.id}><span>{DATE(event.created_at)}</span><div><strong>{event.action}</strong><p>{event.note||event.after_status||""}</p><small>{event.actor_name||formatRole(event.actor_role)}</small></div></div>)}</div>:<Empty>No events recorded.</Empty>}</section>
   </>}
   </main>
  </div>
 </div>;
}

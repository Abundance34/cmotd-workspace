import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime="nodejs";
const authors=["Facility Manager","Procurement Manager","Logistics Officer","Admin","ICT"];
const reviewers=["Procurement Manager","Approver","Admin"];
const finance=["Finance","Admin"];
const money=(n:unknown)=>{const x=Number(n);if(!Number.isFinite(x)||x<0||Math.round(x*100)/100!==x)throw new Error("Enter a valid amount in naira and kobo.");return x;};
const id=(n:unknown)=>{const x=Number(n);if(!Number.isSafeInteger(x)||x<=0)throw new Error("Invalid record.");return x;};
const str=(x:unknown,len=1500)=>String(x??"").trim().slice(0,len);
function accessible(user:CurrentUser,row:any){return finance.includes(user.role)||user.role==="Auditor"||reviewers.includes(user.role)||Number(row.submitted_by)===user.id;}
async function event(tx:any,user:CurrentUser,reconciliationId:number,name:string,note=""){
 await tx`INSERT INTO expense_reconciliation_events(reconciliation_id,actor_id,event,note) VALUES(${reconciliationId},${user.id},${name},${note})`;
 await tx`INSERT INTO activity_logs(user_id,role,action,entity_type,entity_id,public_summary,visibility_scope,created_at) VALUES(${user.id},${user.role},${name},'Expense Reconciliation',${reconciliationId},${note},'workflow',NOW())`;
}
async function notify(tx:any,role:string,title:string,recId:number){
 await tx`INSERT INTO notifications(user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,action_label,section_target,created_at)
 VALUES(NULL,${role},${title},${title},'Expense Reconciliation',${recId},FALSE,FALSE,'Normal','in_app','Open','Expense Reconciliation & Refunds',NOW())`;
}
export async function GET(){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Sign in required."},{status:401});
 if(![...authors,"Finance","Approver","Auditor"].includes(user.role))return NextResponse.json({error:"Access denied."},{status:403});
 try{
 const sql=db();const all=finance.includes(user.role)||["Auditor","Approver","Procurement Manager"].includes(user.role);
 const requests=authors.includes(user.role)?await sql<any[]>`
 SELECT pr.id,pr.request_no,pr.category,pr.department_project,pr.estimated_amount,pr.status,pr.payment_status,pr.requested_by,
 (SELECT COUNT(*) FROM expense_reconciliations er WHERE er.request_id=pr.id AND er.status NOT IN ('Rejected')) existing_count
 FROM purchase_requests pr WHERE (${all} OR pr.requested_by=${user.id} OR pr.facility_manager_user_id=${user.id})
 AND pr.status IN ('Approved','Approved for Payment','Paid','Completed','Closed','PO Created')
 ORDER BY pr.id DESC LIMIT 300`:[];
 const records=await sql<any[]>`
 SELECT e.*,pr.request_no,pr.category,pr.department_project,pr.estimated_amount,u.full_name submitter_name,
 (SELECT COALESCE(SUM(amount),0) FROM expense_reconciliation_refunds f WHERE f.reconciliation_id=e.id AND f.status='Verified') verified_refunds
 FROM expense_reconciliations e JOIN purchase_requests pr ON pr.id=e.request_id JOIN users u ON u.id=e.submitted_by
 WHERE ${all} OR e.submitted_by=${user.id} ORDER BY e.updated_at DESC LIMIT 300`;
 const ids=records.map(r=>Number(r.id));
 const items=ids.length?await sql<any[]>`SELECT * FROM expense_reconciliation_items WHERE reconciliation_id IN ${sql(ids)} ORDER BY id`:[];
 const refunds=ids.length?await sql<any[]>`SELECT id,reconciliation_id,submitted_by,amount,transfer_reference,transfer_date,evidence_name,status,verified_by,verified_at,finance_note,created_at FROM expense_reconciliation_refunds WHERE reconciliation_id IN ${sql(ids)} ORDER BY id`:[];
 const requestIds=requests.map(r=>Number(r.id));
 const requestItems=requestIds.length?await sql<any[]>`SELECT id,request_id,item_name,quantity,unit_price,total,description FROM purchase_request_items WHERE request_id IN ${sql(requestIds)} ORDER BY id`:[];
 return NextResponse.json({userId:user.id,requests,requestItems,records,items,refunds});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unable to load reconciliations."},{status:500});}
}
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Sign in required."},{status:401});
 try{
 const input=await request.json();const action=str(input.action,40);const payload=input.payload||{};const sql=db();
 const result=await sql.begin(async tx=>{
  if(action==="save"){
   if(!authors.includes(user.role))throw new Error("You cannot create a reconciliation.");
   const requestId=id(payload.requestId);
   const pr=(await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`)[0];
   if(!pr)throw new Error("Purchase request not found.");
   if(user.role!=="Admin"&&Number(pr.requested_by)!==user.id&&Number(pr.facility_manager_user_id)!==user.id)throw new Error("You may reconcile only an authorized request.");
   if(!["Approved","Approved for Payment","Paid","Completed","Closed","PO Created"].includes(String(pr.status)))throw new Error("The purchase request is not approved.");
   const recId=payload.reconciliationId? id(payload.reconciliationId):null;
   let old:any=null;
   if(recId){old=(await tx<any[]>`SELECT * FROM expense_reconciliations WHERE id=${recId} FOR UPDATE`)[0];if(!old||Number(old.submitted_by)!==user.id||Number(old.request_id)!==requestId||!["Draft","Returned for Correction"].includes(old.status))throw new Error("This reconciliation is not editable.");}
   else {const exists=await tx<any[]>`SELECT id FROM expense_reconciliations WHERE request_id=${requestId} AND status<>'Rejected' LIMIT 1`;if(exists.length)throw new Error("An active reconciliation already exists for this request.");}
   const funding=str(payload.fundingType,30);
   if(!["Employee Advance","Budget Only"].includes(funding))throw new Error("Choose how the request was funded.");
   const budget=money(pr.estimated_amount);
   const released=funding==="Employee Advance"?money(payload.amountReleased):0;
   if(released>budget)throw new Error("Released funds cannot exceed the approved budget.");
   if(funding==="Employee Advance"&&released<=0)throw new Error("Enter the amount actually released to the employee.");
   const requestedItems=await tx<any[]>`SELECT * FROM purchase_request_items WHERE request_id=${requestId} ORDER BY id`;
   if(!requestedItems.length)throw new Error("The original purchase request has no item lines.");
   const submitted=Array.isArray(payload.items)?payload.items:[];
   const itemMap=new Map<number,any>(submitted.map((v:any)=>[Number(v.itemId),v]));
   let spent=0;const lines:any[]=[];
   for(const row of requestedItems){
    const v=itemMap.get(Number(row.id));if(!v)throw new Error("Every original item must be accounted for.");
    const q=Number(v.actualQty);if(!Number.isFinite(q)||q<0||q>1_000_000)throw new Error("Invalid actual quantity.");
    const price=money(v.actualPrice);
    const line=Math.round(q*price*100)/100;spent+=line;
    lines.push({row,q,price,line,note:str(v.note,500)});
   }
   spent=Math.round(spent*100)/100;
   const explanation=str(payload.explanation);
   if(spent>budget&&explanation.length<10)throw new Error("Explain why actual expenditure exceeded the approved budget.");
   if(funding==="Employee Advance"&&spent>released)throw new Error("Actual expenditure exceeds the amount released. Report extra spending separately for approval.");
   const unspent=funding==="Employee Advance"?Math.max(0,Math.round((released-spent)*100)/100):Math.max(0,Math.round((budget-spent)*100)/100);
   const number=old?.reference||"ER-"+new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14)+"-"+randomUUID().slice(0,6).toUpperCase();
   let target=recId;
   if(recId){await tx`UPDATE expense_reconciliations SET funding_type=${funding},amount_released=${released},budget_snapshot=${budget},actual_spent=${spent},unspent_amount=${unspent},explanation=${explanation},status='Draft',updated_at=NOW() WHERE id=${recId}`;await tx`DELETE FROM expense_reconciliation_items WHERE reconciliation_id=${recId}`;}
   else {const ins=await tx<any[]>`INSERT INTO expense_reconciliations(reference,request_id,submitted_by,funding_type,amount_released,budget_snapshot,actual_spent,unspent_amount,explanation) VALUES(${number},${requestId},${user.id},${funding},${released},${budget},${spent},${unspent},${explanation}) RETURNING id`;target=Number(ins[0].id);}
   for(const v of lines)await tx`INSERT INTO expense_reconciliation_items(reconciliation_id,request_item_id,item_name_snapshot,approved_qty,approved_unit_price,actual_qty,actual_unit_price,line_total,note) VALUES(${target},${v.row.id},${v.row.item_name},${v.row.quantity},${v.row.unit_price},${v.q},${v.price},${v.line},${v.note})`;
   await event(tx,user,target!,"Draft Saved",number);return {id:target};
  }
  const recId=id(payload.id);const rec=(await tx<any[]>`SELECT * FROM expense_reconciliations WHERE id=${recId} FOR UPDATE`)[0];if(!rec||!accessible(user,rec))throw new Error("Reconciliation unavailable.");
  if(action==="submit"){
    if(rec.submitted_by!=user.id||rec.status!=="Draft")throw new Error("Only your draft can be submitted.");
    await tx`UPDATE expense_reconciliations SET status='Submitted',submitted_at=NOW(),updated_at=NOW() WHERE id=${recId}`;
    await event(tx,user,recId,"Submitted","Awaiting independent review");
    await notify(tx,rec.submitted_by===user.id&&user.role==="Procurement Manager"?"Approver":"Procurement Manager","Reconciliation awaiting review",recId);
    return {id:recId};
  }
  if(action==="review"){
    if(!reviewers.includes(user.role)||rec.status!=="Submitted")throw new Error("This reconciliation is not awaiting your review.");
    if(Number(rec.submitted_by)===user.id)throw new Error("You cannot approve your own reconciliation.");
    if(user.role==="Procurement Manager"){const submitter=await tx<any[]>`SELECT role FROM users WHERE id=${rec.submitted_by}`;if(submitter[0]?.role==="Procurement Manager")throw new Error("Procurement-originated reconciliations require the Approver.");}
    const decision=str(payload.decision,30);if(!["Approved","Rejected","Returned for Correction"].includes(decision))throw new Error("Invalid decision.");
    const note=str(payload.note);if(decision!=="Approved"&&note.length<4)throw new Error("Provide a reason for the decision.");
    const next=decision==="Approved"?(rec.funding_type==="Budget Only"||Number(rec.unspent_amount)===0?"Completed":"Approved"):decision;
    await tx`UPDATE expense_reconciliations SET status=${next},reviewer_id=${user.id},review_note=${note},reviewed_at=NOW(),updated_at=NOW() WHERE id=${recId}`;
    await event(tx,user,recId,decision,note);
    if(next==="Approved")await notify(tx,"Finance","Expense reconciliation approved; refund pending",recId);
    return {id:recId};
  }
  if(action==="refund"){
    if(Number(rec.submitted_by)!==user.id||!["Approved","Refund Submitted","Partially Refunded"].includes(rec.status)||rec.funding_type!=="Employee Advance")throw new Error("Refund submission is not allowed.");
    const current=await tx<any[]>`SELECT COALESCE(SUM(amount),0) total FROM expense_reconciliation_refunds WHERE reconciliation_id=${recId} AND status IN ('Verified','Pending Verification')`;
    const amount=money(payload.amount);if(amount<=0||amount>Math.round((Number(rec.unspent_amount)-Number(current[0].total))*100)/100)throw new Error("Refund exceeds the outstanding unverified balance.");
    const ref=str(payload.reference,120);if(ref.length<4)throw new Error("Enter a transfer reference.");
    const name=str(payload.fileName,180),mime=str(payload.mimeType,100),base64=str(payload.base64,4_100_000).replace(/^data:[^,]+,/,"");
    if(!base64||!name||!["application/pdf","image/png","image/jpeg"].includes(mime))throw new Error("Attach PDF/JPG/PNG bank transfer evidence.");
    if(Buffer.from(base64,"base64").length>2_000_000)throw new Error("Transfer evidence must be under 2 MB.");
    const day=str(payload.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error("Select the transfer date.");
    await tx`INSERT INTO expense_reconciliation_refunds(reconciliation_id,submitted_by,amount,transfer_reference,transfer_date,evidence_name,evidence_mime,evidence_base64) VALUES(${recId},${user.id},${amount},${ref},${day},${name},${mime},${base64})`;
    await tx`UPDATE expense_reconciliations SET status='Refund Submitted',updated_at=NOW() WHERE id=${recId}`;
    await event(tx,user,recId,"Refund Submitted",ref);await notify(tx,"Finance","Unspent funds refund awaiting bank verification",recId);
    return {id:recId};
  }
  if(action==="verify"){
    if(!finance.includes(user.role))throw new Error("Only Finance may verify a refund.");
    const refundId=id(payload.refundId);
    const refund=(await tx<any[]>`SELECT * FROM expense_reconciliation_refunds WHERE id=${refundId} AND reconciliation_id=${recId} FOR UPDATE`)[0];
    if(!refund||refund.status!=="Pending Verification")throw new Error("Refund has already been decided.");
    const decision=str(payload.decision,20);if(!["Verified","Rejected"].includes(decision))throw new Error("Invalid verification.");
    const note=str(payload.note,700);if(decision==="Rejected"&&note.length<4)throw new Error("Enter a rejection reason.");
    await tx`UPDATE expense_reconciliation_refunds SET status=${decision},verified_by=${user.id},verified_at=NOW(),finance_note=${note} WHERE id=${refundId}`;
    const totals=await tx<any[]>`SELECT COALESCE(SUM(amount) FILTER(WHERE status='Verified'),0) verified,COUNT(*) FILTER(WHERE status='Pending Verification') pending FROM expense_reconciliation_refunds WHERE reconciliation_id=${recId}`;
    const verified=Number(totals[0].verified),pending=Number(totals[0].pending);
    const next=verified>=Number(rec.unspent_amount)?"Completed":pending?"Refund Submitted":verified>0?"Partially Refunded":"Approved";
    await tx`UPDATE expense_reconciliations SET status=${next},updated_at=NOW() WHERE id=${recId}`;
    await event(tx,user,recId,"Refund "+decision,note);
    return {id:recId,status:next};
  }
  throw new Error("Unsupported reconciliation action.");
 });
 return NextResponse.json({result});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Action failed."},{status:400});}
}

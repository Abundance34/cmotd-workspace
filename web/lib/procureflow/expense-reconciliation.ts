import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const EMPLOYEE_ROLES = ["Facility Manager","ICT","Logistics Officer","Procurement Manager"];
const OBSERVER_ROLES = ["Finance","Approver","Admin","Auditor"];
const EDITABLE = ["Draft","Returned for Correction"];
const CLOSED = ["Savings Recorded","Completed","Rejected"];
const APPROVED_REQUEST = ["Approved","Approved for Payment","Awaiting Payment","PO Created","Paid","Completed","Closed","Payment Approved","Sent to Vendor","Vendor Recommendation Approved"];
const FILE_TYPES = new Set(["application/pdf","image/png","image/jpeg","image/webp"]);
const MAX_FILE = 2_500_000;

function clean(v:unknown,max=1500){return String(v??"").trim().replace(/\s+/g," ").slice(0,max);}
function id(v:unknown){const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw new Error("Choose a valid reconciliation or request.");return n;}
function amount(v:unknown,label="amount"){const n=Number(v);if(!Number.isFinite(n)||n<0||Math.round(n*100)!==n*100&&Math.abs(n*100-Math.round(n*100))>0.00001)throw new Error("Enter a valid non-negative "+label+" (up to 2 decimal places).");return Math.round(n*100)/100;}
function quantity(v:unknown){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1000000||Math.abs(n*10000-Math.round(n*10000))>0.0001)throw new Error("Enter a valid actual quantity.");return n;}
function reason(v:unknown){const s=clean(v,1200);if(s.length<8)throw new Error("Please enter a clear reason of at least 8 characters.");return s;}
function canCreate(user:CurrentUser){return EMPLOYEE_ROLES.includes(user.role);}
function reviewerRole(user:CurrentUser){return user.role==="Procurement Manager"?"Approver":"Procurement Manager";}
function allowed(user:CurrentUser,r:any){return OBSERVER_ROLES.includes(user.role)
  ? (user.role==="Procurement Manager" ? Number(r.assigned_procurement_manager_id)===user.id : true)
  : Number(r.creator_id)===user.id || (user.role==="Procurement Manager" && Number(r.assigned_procurement_manager_id)===user.id);}
function accessible(user:CurrentUser,r:any){
  if(user.role==="Finance"||user.role==="Admin"||user.role==="Auditor"||user.role==="Approver")return true;
  if(user.role==="Procurement Manager")return Number(r.creator_id)===user.id||Number(r.assigned_procurement_manager_id)===user.id;
  return Number(r.creator_id)===user.id;
}
async function event(tx:any,user:CurrentUser,r:any,action:string,afterStatus:string,note=""){
 await tx`INSERT INTO expense_reconciliation_events(reconciliation_id,actor_id,action,before_status,after_status,note) VALUES (${r.id},${user.id},${action},${r.status},${afterStatus},${note||null})`;
 await tx`INSERT INTO workflow_events(entity_type,entity_id,event,status,note,user_id,created_at) VALUES ('Expense Reconciliation',${r.id},${action},${afterStatus},${note||null},${user.id},NOW())`;
 await tx`INSERT INTO activity_logs(user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},${action},'Expense Reconciliation',${r.id},${action+" — "+r.reconciliation_no},${note||null},'workflow',${r.creator_id},NOW())`;
 await appendAuditEvent(tx,{action,entityType:"Expense Reconciliation",entityId:Number(r.id),entityReference:r.reconciliation_no,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:{status:r.status},afterValues:{status:afterStatus},reasonOrComment:note||action,source:"nextjs"});
}
async function notify(tx:any,who:"creator"|"procurement"|"approver"|"finance",r:any,title:string,message:string){
 const target=who==="creator"?Number(r.creator_id):null;
 const role=who==="procurement"?"Procurement Manager":who==="approver"?"Approver":who==="finance"?"Finance":null;
 await tx`INSERT INTO notifications(user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at)
 VALUES (${target},${role},${title},${message},'Expense Reconciliation',${r.id},FALSE,FALSE,'Normal','in_app',FALSE,FALSE,'Open','Expense Reconciliation',NOW())`;
}
function uploadFile(input:any){
 if(!input||typeof input!=="object")throw new Error("Choose a supporting PDF or image.");
 const mimeType=clean(input.mimeType,120);
 if(!FILE_TYPES.has(mimeType))throw new Error("Only PDF, JPG, PNG and WebP evidence files are supported.");
 const fileName=clean(input.fileName,170)||"evidence";
 const base64=String(input.base64||"").replace(/^data:[^;]+;base64,/,"").replace(/\s/g,"");
 if(!base64||base64.length>MAX_FILE*1.4+128||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new Error("Invalid or oversized evidence file.");
 const bytes=Buffer.from(base64,"base64");
 if(bytes.length<8||bytes.length>MAX_FILE)throw new Error("Each evidence file must be under 2.5 MB.");
 const pdf=bytes.subarray(0,5).toString()==="%PDF-";
 const png=bytes.subarray(0,8).toString("hex")==="89504e470d0a1a0a";
 const jpg=bytes[0]===255&&bytes[1]===216;
 const webp=bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP";
 if(!(mimeType==="application/pdf"&&pdf||mimeType==="image/png"&&png||mimeType==="image/jpeg"&&jpg||mimeType==="image/webp"&&webp))throw new Error("The selected file does not match its declared format.");
 return {fileName,mimeType,base64,bytes:bytes.length,checksum:createHash("sha256").update(bytes).digest("hex")};
}
async function getRow(tx:any,idValue:number){const rows=await tx<any[]>`SELECT er.*,pr.request_no,pr.assigned_procurement_manager_id FROM expense_reconciliations er JOIN purchase_requests pr ON pr.id=er.request_id WHERE er.id=${idValue} FOR UPDATE OF er`;if(!rows[0])throw new Error("Reconciliation not found.");return rows[0];}
async function setStatus(tx:any,r:any,status:string,extra?:string){await tx`UPDATE expense_reconciliations SET status=${status},updated_at=NOW() WHERE id=${r.id}`;}
async function totals(tx:any,r:any){
 const rows=await tx<any[]>`SELECT COALESCE(SUM(actual_total),0) total FROM expense_reconciliation_items WHERE reconciliation_id=${r.id}`;
 return amount(rows[0]?.total||0);
}
async function paid(tx:any,r:any){
 const rows=await tx<any[]>`SELECT COALESCE(SUM(amount) FILTER(WHERE status='Verified'),0) verified,COALESCE(SUM(amount) FILTER(WHERE status='Submitted'),0) pending FROM expense_reconciliation_refunds WHERE reconciliation_id=${r.id}`;
 return {verified:amount(rows[0]?.verified||0),pending:amount(rows[0]?.pending||0)};
}

export async function getExpenseReconciliationData(user:CurrentUser){
 if(![...EMPLOYEE_ROLES,...OBSERVER_ROLES].includes(user.role))throw new Error("Access denied.");
 const sql=db();
 const rows=await sql<any[]>`
 SELECT er.*,pr.request_no,pr.category request_category,pr.department_project,pr.justification,pr.assigned_procurement_manager_id,
        cu.full_name creator_name,rv.full_name reviewer_name
 FROM expense_reconciliations er JOIN purchase_requests pr ON pr.id=er.request_id
 LEFT JOIN users cu ON cu.id=er.creator_id LEFT JOIN users rv ON rv.id=er.reviewer_id
 WHERE ${user.role==="Admin"||user.role==="Auditor"||user.role==="Finance"||user.role==="Approver"}
 OR er.creator_id=${user.id}
 OR (${user.role==="Procurement Manager"} AND pr.assigned_procurement_manager_id=${user.id})
 ORDER BY er.updated_at DESC,er.id DESC LIMIT 300`;
 const ids=rows.map(r=>Number(r.id));
 const items=ids.length?await sql<any[]>`SELECT id,reconciliation_id,request_item_id,item_name,item_description,budget_quantity,budget_unit_price,budget_total,actual_quantity,actual_unit_price,actual_total,note FROM expense_reconciliation_items WHERE reconciliation_id IN ${sql(ids)} ORDER BY id`:[];
 const refunds=ids.length?await sql<any[]>`SELECT id,reconciliation_id,amount,transfer_reference,transfer_date,note,status,submitted_by,reviewed_by,review_note,submitted_at,reviewed_at FROM expense_reconciliation_refunds WHERE reconciliation_id IN ${sql(ids)} ORDER BY id DESC`:[];
 const evidence=ids.length?await sql<any[]>`SELECT id,reconciliation_id,refund_id,kind,file_name,mime_type,byte_length,uploaded_by,created_at FROM expense_reconciliation_evidence WHERE reconciliation_id IN ${sql(ids)} ORDER BY created_at DESC`:[];
 const events=ids.length?await sql<any[]>`SELECT ev.*,u.full_name actor_name,u.role actor_role FROM expense_reconciliation_events ev LEFT JOIN users u ON u.id=ev.actor_id WHERE ev.reconciliation_id IN ${sql(ids)} ORDER BY ev.created_at DESC,ev.id DESC`:[];
 const candidates=canCreate(user)?await sql<any[]>`
 SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.justification,pr.estimated_amount,pr.status
 FROM purchase_requests pr
 WHERE pr.requested_by=${user.id}
 AND (pr.approved_at IS NOT NULL OR pr.status IN ${sql(APPROVED_REQUEST)})
 AND COALESCE(pr.status,'') NOT IN ('Draft','Rejected','Cancelled','Deleted Draft','Returned for Correction')
 AND NOT EXISTS(SELECT 1 FROM expense_reconciliations er WHERE er.request_id=pr.id)
 AND EXISTS(SELECT 1 FROM purchase_request_items pi WHERE pi.request_id=pr.id)
 ORDER BY COALESCE(pr.approved_at,pr.updated_at,pr.created_at) DESC LIMIT 200`:[];
 return {records:rows.map(r=>({...r,id:Number(r.id),request_id:Number(r.request_id),creator_id:Number(r.creator_id),original_approved_amount:Number(r.original_approved_amount),actual_total:Number(r.actual_total),released_amount:Number(r.released_amount)})),
   items:items.map(r=>({...r,id:Number(r.id),reconciliation_id:Number(r.reconciliation_id),request_item_id:Number(r.request_item_id),budget_quantity:Number(r.budget_quantity),budget_unit_price:Number(r.budget_unit_price),budget_total:Number(r.budget_total),actual_quantity:Number(r.actual_quantity),actual_unit_price:Number(r.actual_unit_price),actual_total:Number(r.actual_total)})),
   refunds:refunds.map(r=>({...r,id:Number(r.id),reconciliation_id:Number(r.reconciliation_id),amount:Number(r.amount)})),
   evidence:evidence.map(r=>({...r,id:Number(r.id),reconciliation_id:Number(r.reconciliation_id)})),
   events:events.map(r=>({...r,id:Number(r.id),reconciliation_id:Number(r.reconciliation_id)})),
   candidates:candidates.map(r=>({...r,id:Number(r.id),estimated_amount:Number(r.estimated_amount)})),
   role:user.role};
}

export async function getExpenseEvidence(user:CurrentUser,evidenceId:number){
 const sql=db();
 const rows=await sql<any[]>`SELECT ev.*,er.creator_id,pr.assigned_procurement_manager_id FROM expense_reconciliation_evidence ev JOIN expense_reconciliations er ON er.id=ev.reconciliation_id JOIN purchase_requests pr ON pr.id=er.request_id WHERE ev.id=${evidenceId}`;
 const item=rows[0];if(!item||!accessible(user,item))throw new Error("Evidence not found or access denied.");
 return item;
}

export async function runExpenseReconciliationAction(user:CurrentUser,action:string,payload:any){
 if(![...EMPLOYEE_ROLES,...OBSERVER_ROLES].includes(user.role))throw new Error("This role is not authorized.");
 const sql=db();
 const recordId=action==="create"?0:id(payload.reconciliationId);
 return sql.begin(async tx=>{
  if(action==="create"){
   if(!canCreate(user))throw new Error("Only a request originator can create a reconciliation.");
   const requestId=id(payload.requestId);
   const prs=await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`;
   const pr=prs[0];if(!pr||Number(pr.requested_by)!==user.id)throw new Error("Choose a purchase request that you created.");
   if(!(pr.approved_at||APPROVED_REQUEST.includes(String(pr.status||"")))||["Rejected","Cancelled","Deleted Draft","Draft"].includes(String(pr.status||"")))throw new Error("Only approved purchase requests can be reconciled.");
   const existing=await tx<any[]>`SELECT id FROM expense_reconciliations WHERE request_id=${requestId}`;
   if(existing.length)throw new Error("This request already has an expense reconciliation. Open the existing draft or record.");
   const src=await tx<any[]>`SELECT * FROM purchase_request_items WHERE request_id=${requestId} ORDER BY id`;
   if(!src.length)throw new Error("This request has no item lines to reconcile.");
   const no="ER-"+new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14)+"-"+randomUUID().slice(0,6).toUpperCase();
   const reviewer=reviewerRole(user);
   const rows=await tx<any[]>`INSERT INTO expense_reconciliations(reconciliation_no,request_id,creator_id,reviewer_role,original_approved_amount,original_status,explanation,status) VALUES (${no},${requestId},${user.id},${reviewer},${amount(pr.estimated_amount)},${pr.status||""},'','Draft') RETURNING *`;
   const r=rows[0];
   for(const item of src){await tx`INSERT INTO expense_reconciliation_items(reconciliation_id,request_item_id,item_name,item_description,budget_quantity,budget_unit_price,budget_total) VALUES (${r.id},${item.id},${item.item_name},${item.description},${item.quantity||0},${item.unit_price||0},${item.total||0})`;}
   await event(tx,user,r,"Reconciliation Draft Created","Draft",`Linked to ${pr.request_no}`);
   return {id:Number(r.id)};
  }
  const r=await getRow(tx,recordId);
  if(!accessible(user,r))throw new Error("Access denied to this reconciliation.");
  if(action==="save"){
   if(Number(r.creator_id)!==user.id||!EDITABLE.includes(r.status))throw new Error("Only your draft or returned reconciliation can be edited.");
   const rows=await tx<any[]>`SELECT * FROM expense_reconciliation_items WHERE reconciliation_id=${r.id} ORDER BY id`;
   const input=Array.isArray(payload.items)?payload.items:[];
   if(input.length!==rows.length)throw new Error("All original request items must be included.");
   const requested=new Map<number,any>(input.map((x:any)=>[Number(x.id),x]));
   let total=0;
   for(const item of rows){
    const changed=requested.get(Number(item.id));if(!changed)throw new Error("An original request item is missing.");
    const qty=quantity(changed.actualQuantity);
    const price=amount(changed.actualUnitPrice,"unit price");
    const line=amount(qty*price,"line total");
    total+=line;
    await tx`UPDATE expense_reconciliation_items SET actual_quantity=${qty},actual_unit_price=${price},actual_total=${line},note=${clean(changed.note,500)||null} WHERE id=${item.id}`;
   }
   total=amount(total,"total");
   await tx`UPDATE expense_reconciliations SET actual_total=${total},explanation=${clean(payload.explanation,1500)},updated_at=NOW() WHERE id=${r.id}`;
   await event(tx,user,r,"Draft Updated",r.status,"Actual expenses updated.");
   return {id:Number(r.id),total};
  }
  if(action==="upload"){
   if(Number(r.creator_id)!==user.id||!EDITABLE.includes(r.status))throw new Error("Receipts can be uploaded while the reconciliation is being drafted or corrected.");
   const f=uploadFile(payload.file);
   await tx`INSERT INTO expense_reconciliation_evidence(reconciliation_id,kind,file_name,mime_type,byte_length,file_checksum,content,uploaded_by) VALUES (${r.id},'Expense Receipt',${f.fileName},${f.mimeType},${f.bytes},${f.checksum},decode(${f.base64},'base64'),${user.id})`;
   await event(tx,user,r,"Expense Receipt Uploaded",r.status,f.fileName);
   return {id:Number(r.id)};
  }
  if(action==="submit"){
   if(Number(r.creator_id)!==user.id||!EDITABLE.includes(r.status))throw new Error("Only your draft or returned reconciliation can be submitted.");
   const actual=await totals(tx,r);
   if(actual>Number(r.original_approved_amount)+0.001)throw new Error("Actual spending is above the approved request amount. Contact Procurement for exceptional approval first.");
   const receipts=await tx<any[]>`SELECT COUNT(*)::int count FROM expense_reconciliation_evidence WHERE reconciliation_id=${r.id} AND kind='Expense Receipt'`;
   if(actual>0&&Number(receipts[0].count)===0)throw new Error("Upload at least one actual purchase receipt before submitting.");
   const next="Submitted";
   await tx`UPDATE expense_reconciliations SET status=${next},actual_total=${actual},submitted_at=NOW(),updated_at=NOW() WHERE id=${r.id}`;
   await event(tx,user,r,"Submitted for Independent Review",next,"Expense report submitted.");
   await notify(tx,r.reviewer_role==="Approver"?"approver":"procurement",r,"Expense reconciliation to review",r.reconciliation_no+" is awaiting review.");
   return {id:Number(r.id),status:next};
  }
  if(action==="review"){
   if(!["Submitted"].includes(r.status))throw new Error("This report is no longer awaiting review.");
   if(r.reviewer_role!==user.role||Number(r.creator_id)===user.id)throw new Error("This reconciliation requires an independent "+r.reviewer_role+" reviewer.");
   if(user.role==="Procurement Manager"&&Number(r.assigned_procurement_manager_id)!==user.id)throw new Error("This reconciliation is assigned to a different Procurement Manager.");
   const decision=clean(payload.decision,20);
   if(!["approve","return","reject"].includes(decision))throw new Error("Choose Approve, Return for Correction or Reject.");
   const note=decision==="approve"?clean(payload.note,1200):reason(payload.note);
   let next=decision==="approve"?"Funding Verification Pending":decision==="return"?"Returned for Correction":"Rejected";
   if(decision==="approve"){
    const receipt=await tx<any[]>`SELECT COUNT(*)::int n FROM expense_reconciliation_evidence WHERE reconciliation_id=${r.id} AND kind='Expense Receipt'`;
    if(Number(r.actual_total)>0&&Number(receipt[0].n)===0)throw new Error("Purchase receipts are required for expenditure approval.");
   }
   await tx`UPDATE expense_reconciliations SET status=${next},reviewer_id=${user.id},reviewed_at=NOW(),procurement_note=${note||null},rejection_reason=${decision==="reject"?note:null},updated_at=NOW() WHERE id=${r.id}`;
   await event(tx,user,r,decision==="approve"?"Expenses Verified":decision==="return"?"Returned for Correction":"Reconciliation Rejected",next,note);
   await notify(tx,decision==="approve"?"finance":"creator",r,decision==="approve"?"Expense report awaiting Finance verification":decision==="return"?"Expense reconciliation requires correction":"Expense reconciliation rejected",r.reconciliation_no+" — "+(note||next));
   return {id:Number(r.id),status:next};
  }
  if(action==="funding"){
   if(user.role!=="Finance"||r.status!=="Funding Verification Pending")throw new Error("Finance must verify funding after Procurement approval.");
   const type=clean(payload.fundingType,30);
   if(!["Budget Only","Employee Advance"].includes(type))throw new Error("Select Budget Only or Employee Advance.");
   const reference=clean(payload.reference,160);
   const note=clean(payload.note,600);
   const released=type==="Employee Advance"?amount(payload.releasedAmount,"confirmed employee advance"):0;
   if(type==="Employee Advance"&&(released<=0||reference.length<5))throw new Error("Finance must confirm the advance amount and enter the disbursement reference.");
   if(type==="Employee Advance"&&released<Number(r.actual_total))throw new Error("Confirmed advance is less than reported expenses. Resolve the shortfall before confirming.");
   const due=amount(released-Number(r.actual_total));
   const next=type==="Budget Only"?"Savings Recorded":due>0?"Refund Pending":"Completed";
   await tx`UPDATE expense_reconciliations SET funding_type=${type},funding_reference=${reference||null},funding_note=${note||null},released_amount=${released},funding_verified_at=NOW(),finance_verified_by=${user.id},status=${next},completed_at=${CLOSED.includes(next)?new Date().toISOString():null},updated_at=NOW() WHERE id=${r.id}`;
   await event(tx,user,r,"Funding Verified",next,`${type}: ${released.toFixed(2)} confirmed; ${due.toFixed(2)} refund due. ${note}`);
   await notify(tx,"creator",r,next==="Refund Pending"?"Unused funds to return":"Expense reconciliation finalized",r.reconciliation_no+" — "+next+(due>0?` — NGN ${due.toFixed(2)} outstanding`:""));
   return {id:Number(r.id),status:next};
  }
  if(action==="refund"){
   if(Number(r.creator_id)!==user.id||!["Refund Pending","Partially Refunded"].includes(r.status)||r.funding_type!=="Employee Advance")throw new Error("A Finance-confirmed employee advance with an outstanding balance is required.");
   const funds=await paid(tx,r);
   const due=amount(Number(r.released_amount)-Number(r.actual_total)-funds.verified-funds.pending);
   const value=amount(payload.amount,"refund amount");
   if(value<=0||value>due+0.001)throw new Error("Refund amount must be greater than zero and must not exceed the unreported balance.");
   const reference=clean(payload.reference,160);
   if(reference.length<5)throw new Error("Enter the bank transfer reference.");
   const date=clean(payload.date,12);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))throw new Error("Choose a valid refund date.");
   const f=uploadFile(payload.file);
   const rows=await tx<any[]>`INSERT INTO expense_reconciliation_refunds(reconciliation_id,amount,transfer_reference,transfer_date,note,submitted_by) VALUES (${r.id},${value},${reference},${date},${clean(payload.note,600)||null},${user.id}) RETURNING id`;
   await tx`INSERT INTO expense_reconciliation_evidence(reconciliation_id,refund_id,kind,file_name,mime_type,byte_length,file_checksum,content,uploaded_by) VALUES (${r.id},${rows[0].id},'Refund Proof',${f.fileName},${f.mimeType},${f.bytes},${f.checksum},decode(${f.base64},'base64'),${user.id})`;
   await tx`UPDATE expense_reconciliations SET status='Refund Submitted',updated_at=NOW() WHERE id=${r.id}`;
   await event(tx,user,r,"Refund Evidence Submitted","Refund Submitted",`NGN ${value.toFixed(2)}; ref ${reference}`);
   await notify(tx,"finance",r,"Refund requires bank confirmation",r.reconciliation_no+" — verify incoming funds in the company's bank account.");
   return {id:Number(r.id),refundId:Number(rows[0].id)};
  }
  if(action==="verify-refund"){
   if(user.role!=="Finance"||!["Refund Submitted","Partially Refunded","Refund Pending"].includes(r.status))throw new Error("Only Finance can verify a pending refund.");
   const refundId=id(payload.refundId);
   const rows=await tx<any[]>`SELECT * FROM expense_reconciliation_refunds WHERE id=${refundId} AND reconciliation_id=${r.id} FOR UPDATE`;
   const refund=rows[0];if(!refund||refund.status!=="Submitted")throw new Error("This refund is no longer awaiting verification.");
   const decision=clean(payload.decision,20);
   if(!["verify","reject"].includes(decision))throw new Error("Select Verify or Reject.");
   const note=decision==="reject"?reason(payload.note):clean(payload.note,800);
   await tx`UPDATE expense_reconciliation_refunds SET status=${decision==="verify"?"Verified":"Rejected"},reviewed_by=${user.id},review_note=${note||null},reviewed_at=NOW() WHERE id=${refundId}`;
   const sums=await paid(tx,r);
   const remaining=amount(Math.max(0,Number(r.released_amount)-Number(r.actual_total)-sums.verified));
   const next=remaining<=0&&sums.pending<=0?"Completed":sums.pending>0?"Refund Submitted":sums.verified>0?"Partially Refunded":"Refund Pending";
   await tx`UPDATE expense_reconciliations SET status=${next},completed_at=${next==="Completed"?new Date().toISOString():null},updated_at=NOW() WHERE id=${r.id}`;
   await event(tx,user,r,decision==="verify"?"Refund Verified by Finance":"Refund Evidence Rejected",next,`Transfer ${refund.transfer_reference}: ${decision}. ${note}`);
   await notify(tx,"creator",r,decision==="verify"?"Refund confirmed by Finance":"Refund evidence rejected",r.reconciliation_no+" — "+(note||next));
   return {id:Number(r.id),status:next,remaining};
  }
  throw new Error("Unsupported expense reconciliation action.");
 });
}

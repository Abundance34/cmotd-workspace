import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const MAX_EMBEDDED_FILE_BYTES = 3_000_000;

function assertRole(user: CurrentUser, allowed: string[]) {
  if (!allowed.includes(user.role)) throw new Error(`This action is not available to ${user.role}.`);
}
function clean(value: unknown, max = 4000) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max); }
function positiveId(value: unknown, label = "record") { const n=Number(value); if(!Number.isInteger(n)||n<=0) throw new Error(`Choose a valid ${label}.`); return n; }
function money(value: unknown, label = "amount") { const n=Number(value); if(!Number.isFinite(n)||n<0) throw new Error(`Enter a valid ${label}.`); return n; }
function wholeNumber(value: unknown, label = "quantity") { const n=Number(value); if(!Number.isInteger(n)||n<=0) throw new Error(`Enter a whole number greater than zero for ${label}.`); return n; }
function reason(value: unknown) { const v=clean(value,2000); if(v.length<4) throw new Error("Enter a meaningful reason or note."); return v; }
function ref(prefix:string){return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,17)}-${randomUUID().slice(0,8).toUpperCase()}`;}
function maskAccount(value:string){const d=value.replace(/\D/g,""); return d ? `••••${d.slice(-4)}` : "";}

function filePayload(input:any) {
  if (!input?.base64) return null;
  const fileName = clean(input.fileName, 180) || "document";
  const mimeType = clean(input.mimeType, 120) || "application/octet-stream";
  const normalized = String(input.base64).replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) throw new Error("The uploaded file is empty.");
  if (bytes.length > MAX_EMBEDDED_FILE_BYTES) throw new Error("This file is too large for the current secure Neon document store. Keep individual files below 3 MB.");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return { fileName, mimeType, bytes: bytes.length, checksum, locator: `data:${mimeType};base64,${bytes.toString("base64")}` };
}

async function evidence(tx:any, user:CurrentUser, input:{action:string;entityType:string;entityId?:number|null;entityReference?:string|null;before?:Record<string,unknown>;after?:Record<string,unknown>;note?:string;relatedUserId?:number|null;severity?:string}){
  const now=new Date().toISOString(); const note=clean(input.note,2000); const before=input.before||{}; const after=input.after||{};
  await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},${input.action},${input.entityType},${input.entityId??null},${`${input.action}${input.entityReference?` — ${input.entityReference}`:""}`},${note||null},'workflow',${input.relatedUserId??null},${now})`;
  await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES (${input.action.toUpperCase().replace(/[^A-Z0-9]+/g,"_")},${input.entityType},${input.entityId==null?null:String(input.entityId)},${user.id},${user.role},${note||input.action},${tx.json(before)},${tx.json(after)},${now},${now.slice(0,10)},${now.slice(11,19)},${note||null})`;
  await appendAuditEvent(tx,{action:input.action,entityType:input.entityType,entityId:input.entityId??null,entityReference:input.entityReference??null,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:before,afterValues:after,metadata:{source:"full-parity-port"},reasonOrComment:note||input.action,severity:input.severity||"Normal",source:"nextjs"});
}

async function workflow(tx:any,user:CurrentUser,entityType:string,entityId:number,event:string,status:string|null,note:string){await tx`INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at) VALUES (${entityType},${entityId},${event},${status},${note||null},${user.id},NOW())`;}
async function notifyRole(tx:any,role:string,title:string,message:string,entityType:string,entityId:number|null,section:string,importance="Normal"){await tx`INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at) VALUES (NULL,${role},${title},${message},${entityType},${entityId},FALSE,FALSE,${importance},'in_app',FALSE,FALSE,'Open',${section},NOW())`;}
async function notifyUser(tx:any,userId:number,title:string,message:string,entityType:string,entityId:number|null,section:string,importance="Normal"){await tx`INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at) VALUES (${userId},NULL,${title},${message},${entityType},${entityId},FALSE,FALSE,${importance},'in_app',FALSE,FALSE,'Open',${section},NOW())`;}

export async function runParityAction(user:CurrentUser, action:string, payload:any){
  const sql=db();
  if(action==="low-value-decision"){
    assertRole(user,["Procurement Manager","Admin"]); const id=positiveId(payload.requestId,"request"); const decision=clean(payload.decision,30); if(!["approve","reject","return"].includes(decision)) throw new Error("Choose a valid decision."); const note=decision==="approve"?clean(payload.note,1200):reason(payload.note);
    return sql.begin(async tx=>{const rows=await tx<any[]>`SELECT pr.*,u.role requester_role FROM purchase_requests pr JOIN users u ON u.id=pr.requested_by WHERE pr.id=${id} FOR UPDATE`;const row=rows[0];if(!row)throw new Error("Request not found.");const currentStatus=String(row.status||"");const decisionStatuses=["Submitted for Approval","Pending Approval","Reviewed by Procurement","Sent for Procurement Review"];if(!decisionStatuses.includes(currentStatus)){if(["Approved","Accepted by Procurement Manager","Vendor Recommendation Approved","Payment Approved","PO Created","Sent to Vendor","Paid","Completed","Closed"].includes(currentStatus))throw new Error("This purchase request has already passed the approval stage and cannot be approved again.");throw new Error(`This purchase request is not awaiting a Procurement Manager decision from status '${currentStatus||"Unknown"}'.`);}const limitRows=await tx<any[]>`SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1`;const limit=Number(limitRows[0]?.amount||100000);if(Number(row.estimated_amount||0)>limit)throw new Error("This request exceeds the Procurement Manager approval limit.");if(row.requester_role==='Procurement Manager')throw new Error("Segregation of duties requires Approver / MD to decide Procurement Manager-originated requests.");
      const old=String(row.status||""); const status=decision==="approve"?"Approved":decision==="reject"?"Rejected":"Returned for Correction"; const next=decision==="approve"?"finance":decision==="return"?"facility_manager":null; const paymentStatus=decision==="approve"?"Approved for Payment":row.payment_status; const actionLabel=decision==="approve"?"Approved":decision==="reject"?"Rejected":"Returned for Correction";
      await tx`UPDATE purchase_requests SET status=${status},next_role=${next},payment_status=${paymentStatus},approved_at=${decision==="approve"?new Date().toISOString():row.approved_at},approved_by_user_id=${decision==="approve"?user.id:row.approved_by_user_id},approved_by_role=${decision==="approve"?user.role:row.approved_by_role},approval_mode=${decision==="approve"?'Procurement Manager Low-Value Approval':row.approval_mode},updated_at=NOW() WHERE id=${id}`;
      await tx`INSERT INTO approval_history (entity_type,entity_id,action,status_before,status_after,reason,user_id,approved_by_user_id,approved_by_role,approval_mode,note,created_at) VALUES ('Purchase Request',${id},${actionLabel},${old},${status},${note||decision},${user.id},${user.id},${user.role},'Procurement Manager Low-Value Approval',${note||decision},NOW())`;
      await workflow(tx,user,"Purchase Request",id,`Low-Value ${actionLabel}`,status,note||decision); await evidence(tx,user,{action:`Low-Value ${actionLabel}`,entityType:"Purchase Request",entityId:id,entityReference:row.request_no,before:{status:old,next_role:row.next_role},after:{status,next_role:next,payment_status:paymentStatus},note:note||decision,relatedUserId:row.facility_manager_user_id});
      if(row.facility_manager_user_id)await notifyUser(tx,Number(row.facility_manager_user_id),`Request ${status}`,decision==="reject"?`${row.request_no} was rejected by Procurement Manager. Reason: ${note}`:`${row.request_no} is now ${status}.`,"Purchase Request",id,decision==="approve"?"Approved / Accepted Requests":decision==="return"?"Returned Requests":"My Draft Requests",decision==="approve"?"Normal":"High"); if(decision==="approve")await notifyRole(tx,"Finance","Request approved for payment",`${row.request_no} is approved and ready for Finance.`,"Purchase Request",id,"Approved for Payment","High"); return {id,status};});
  }

  if(action==="create-po"){
    assertRole(user,["Procurement Manager","Admin"]); const requestId=positiveId(payload.requestId,"request");
    return sql.begin(async tx=>{const rows=await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`;const r=rows[0];if(!r)throw new Error("Request not found.");if(r.linked_po_id)throw new Error("This request already has a linked purchase order.");if(!["Approved","Vendor Recommendation Approved","Accepted by Procurement Manager","Payment Approved"].includes(String(r.status||"")))throw new Error(`A commercial PO cannot be created from status '${r.status||"Unknown"}'.`);const vendorId=Number(payload.vendorId||r.selected_vendor_id||0);if(!vendorId)throw new Error("Select the approved vendor before creating the PO.");const v=await tx<any[]>`SELECT id,name FROM vendors WHERE id=${vendorId} LIMIT 1`;if(!v[0])throw new Error("Vendor not found.");const poNo=ref("PO");const total=money(payload.totalAmount??r.estimated_amount,"PO total");const expected=clean(payload.expectedDeliveryDate,20)||null;const policy=await tx<any[]>`SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1`;const limit=Number(policy[0]?.amount||100000);const auto=total<=limit;const status=auto?"Approved":"Pending Approval";const next=auto?"procurement_manager":"approver";const po=await tx<any[]>`INSERT INTO purchase_orders (po_no,request_id,vendor_id,po_date,expected_delivery_date,status,total_amount,approved_by,payment_status,receiving_status,created_by,created_at,updated_at,approved_by_role,approval_mode,next_role) VALUES (${poNo},${requestId},${vendorId},CURRENT_DATE,${expected},${status},${total},${auto?user.id:null},'Pending','Pending Receipt',${user.id},NOW(),NOW(),${auto?user.role:null},${auto?'Procurement Manager Low-Value PO Approval':null},${next}) RETURNING id`;const poId=Number(po[0].id);
      const items=await tx<any[]>`SELECT * FROM purchase_request_items WHERE request_id=${requestId} ORDER BY id`;for(const item of items){await tx`INSERT INTO purchase_order_items (po_id,item_name,description,quantity,unit_price,total,category,created_at) VALUES (${poId},${item.item_name},${item.description},${item.quantity},${item.unit_price},${item.total},${item.category},NOW())`;}
      await tx`UPDATE purchase_requests SET linked_po_id=${poId},status='PO Created',next_role=${next},updated_at=NOW() WHERE id=${requestId}`;await workflow(tx,user,"Purchase Order",poId,"PO Created",status,`Created from ${r.request_no} for ${v[0].name}`);await evidence(tx,user,{action:"Purchase Order Created",entityType:"Purchase Order",entityId:poId,entityReference:poNo,after:{request_id:requestId,vendor_id:vendorId,total_amount:total,status,next_role:next},note:clean(payload.note,1500)||`Commercial PO created for ${r.request_no}`}); if(!auto)await notifyRole(tx,"Approver","Purchase order requires approval",`${poNo} for ${r.request_no} requires approval.`,"Purchase Order",poId,"PO Approval","High");return {poId,poNo,status};});
  }

  if(action==="release-po"){
    assertRole(user,["Procurement Manager","Admin"]);const poId=positiveId(payload.poId,"purchase order");const note=clean(payload.note,1500)||"Commercial PO released to vendor and Logistics";
    return sql.begin(async tx=>{const rows=await tx<any[]>`SELECT po.*,pr.request_no FROM purchase_orders po LEFT JOIN purchase_requests pr ON pr.id=po.request_id WHERE po.id=${poId} FOR UPDATE`;const po=rows[0];if(!po)throw new Error("Purchase order not found.");if(String(po.status)!=='Approved')throw new Error("Only an approved purchase order can be released.");await tx`UPDATE purchase_orders SET status='Sent to Vendor',sent_to_vendor_date=CURRENT_DATE,released_to_logistics_at=NOW(),released_to_logistics_by=${user.id},logistics_status='Awaiting Handover',next_role='logistics_officer',updated_at=NOW() WHERE id=${poId}`;if(po.request_id)await tx`UPDATE purchase_requests SET status='Sent to Vendor',next_role='logistics_officer',updated_at=NOW() WHERE id=${po.request_id}`;await workflow(tx,user,"Purchase Order",poId,"Released to Vendor / Logistics","Sent to Vendor",note);await evidence(tx,user,{action:"Purchase Order Released",entityType:"Purchase Order",entityId:poId,entityReference:po.po_no,before:{status:po.status},after:{status:"Sent to Vendor",logistics_status:"Awaiting Handover"},note});await notifyRole(tx,"Logistics Officer","PO released to Logistics",`${po.po_no} is ready for delivery handover.`,"Purchase Order",poId,"PO Delivery Handover","High");return {poId,status:"Sent to Vendor"};});
  }

  if(action==="vendor-save"){
    assertRole(user,["Procurement Manager","Admin"]);
    const id=Number(payload.vendorId||0);
    const name=clean(payload.name,180);
    if(name.length<2)throw new Error("Vendor name is required.");
    const contactPerson=clean(payload.contactPerson,180)||null;
    const phone=clean(payload.phone,120)||null;
    const email=clean(payload.email,180)||null;
    const address=clean(payload.address,500)||null;
    const taxId=clean(payload.taxId,120)||null;
    const rating=Math.max(0,Math.min(5,Number(payload.rating||0)));
    const status=clean(payload.status,60)||"Active";
    const note=clean(payload.note,1500)||"Vendor master record updated";
    const operationId=Number(payload.operationalCategoryId||0);
    const serviceId=Number(payload.serviceCategoryId||0);
    if(!id && (!operationId||!serviceId))throw new Error("Choose both a company operation and a service category for the new vendor.");
    return sql.begin(async tx=>{
      const duplicate=await tx<any[]>`SELECT id,name,status FROM vendors WHERE LOWER(TRIM(name))=LOWER(TRIM(${name})) AND (${id||0}=0 OR id<>${id||0}) LIMIT 1`;
      if(duplicate[0])throw new Error(`${duplicate[0].name} already exists in the Vendor Directory.`);
      let serviceName=clean(payload.category,160)||null;
      if(serviceId){
        const service=(await tx<any[]>`SELECT id,name,status FROM vendor_service_categories WHERE id=${serviceId} LIMIT 1`)[0];
        if(!service||service.status!=="Active")throw new Error("Choose an active service category.");
        serviceName=service.name;
      }
      if(operationId){
        const operation=(await tx<any[]>`SELECT id,name,status FROM vendor_operational_categories WHERE id=${operationId} LIMIT 1`)[0];
        if(!operation||operation.status!=="Active")throw new Error("Choose an active company operation.");
      }
      let vendorId=id;
      if(id){
        const old=(await tx<any[]>`SELECT * FROM vendors WHERE id=${id} FOR UPDATE`)[0];
        if(!old)throw new Error("Vendor not found.");
        await tx`UPDATE vendors SET name=${name},contact_person=${contactPerson},category=${serviceName},phone=${phone},email=${email},address=${address},tax_id=${taxId},rating=${rating},status=${status},notes=${note},archived_at=${status==="Archived"?new Date().toISOString():null},archived_by_user_id=${status==="Archived"?user.id:null},updated_at=NOW() WHERE id=${id}`;
        await evidence(tx,user,{action:"Vendor Updated",entityType:"Vendor",entityId:id,entityReference:name,before:{name:old.name,status:old.status,category:old.category,phone:old.phone,email:old.email},after:{name,status,category:serviceName,contact_person:contactPerson,phone,email,address,tax_id:taxId,rating},note});
      }else{
        const row=await tx<any[]>`INSERT INTO vendors (name,contact_person,category,phone,email,address,tax_id,rating,completed_orders,total_spend,rejection_count,status,source,notes,created_by_user_id,created_at,updated_at) VALUES (${name},${contactPerson},${serviceName},${phone},${email},${address},${taxId},${rating},0,0,0,${status},'Procurement Direct',${note},${user.id},NOW(),NOW()) RETURNING id`;
        vendorId=Number(row[0].id);
        await evidence(tx,user,{action:"Vendor Created",entityType:"Vendor",entityId:vendorId,entityReference:name,after:{name,status,category:serviceName,contact_person:contactPerson,phone,email,address,tax_id:taxId,rating,source:"Procurement Direct"},note});
      }
      if(operationId&&serviceId){
        await tx`UPDATE vendor_category_links SET is_primary=FALSE WHERE vendor_id=${vendorId}`;
        await tx`INSERT INTO vendor_category_links (vendor_id,operational_category_id,service_category_id,is_primary,created_by_user_id,created_at) VALUES (${vendorId},${operationId},${serviceId},TRUE,${user.id},NOW()) ON CONFLICT (vendor_id,operational_category_id,service_category_id) DO UPDATE SET is_primary=TRUE`;
      }
      return {vendorId};
    });
  }

  if(action==="vendor-category-save"){
    assertRole(user,["Procurement Manager","Admin"]);
    const kind=clean(payload.kind,30);
    if(!["operation","service"].includes(kind))throw new Error("Choose a valid category type.");
    const name=clean(payload.name,160);
    if(name.length<2)throw new Error("Category name is required.");
    const description=clean(payload.description,500)||null;
    return sql.begin(async tx=>{
      if(kind==="operation"){
        const row=await tx<any[]>`INSERT INTO vendor_operational_categories (name,description,status,created_by_user_id,created_at,updated_at) VALUES (${name},${description},'Active',${user.id},NOW(),NOW()) ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description,status='Active',updated_at=NOW() RETURNING id`;
        const id=Number(row[0].id);await evidence(tx,user,{action:"Vendor Operation Category Saved",entityType:"Vendor Operation Category",entityId:id,entityReference:name,after:{name,description,status:"Active"},note:"Company operation category available for vendor classification."});return {id,kind};
      }
      const row=await tx<any[]>`INSERT INTO vendor_service_categories (name,description,status,created_by_user_id,created_at,updated_at) VALUES (${name},${description},'Active',${user.id},NOW(),NOW()) ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description,status='Active',updated_at=NOW() RETURNING id`;
      const id=Number(row[0].id);await evidence(tx,user,{action:"Vendor Service Category Saved",entityType:"Vendor Service Category",entityId:id,entityReference:name,after:{name,description,status:"Active"},note:"Service category available for vendor classification."});return {id,kind};
    });
  }

  if(action==="vendor-category-link"){
    assertRole(user,["Procurement Manager","Admin"]);
    const vendorId=positiveId(payload.vendorId,"vendor");
    const operationId=positiveId(payload.operationalCategoryId,"company operation");
    const serviceId=positiveId(payload.serviceCategoryId,"service category");
    const primary=payload.isPrimary!==false;
    return sql.begin(async tx=>{
      const vendor=(await tx<any[]>`SELECT id,name,status FROM vendors WHERE id=${vendorId} FOR UPDATE`)[0];if(!vendor)throw new Error("Vendor not found.");
      const operation=(await tx<any[]>`SELECT id,name FROM vendor_operational_categories WHERE id=${operationId} AND status='Active' LIMIT 1`)[0];if(!operation)throw new Error("Company operation is unavailable.");
      const service=(await tx<any[]>`SELECT id,name FROM vendor_service_categories WHERE id=${serviceId} AND status='Active' LIMIT 1`)[0];if(!service)throw new Error("Service category is unavailable.");
      if(primary)await tx`UPDATE vendor_category_links SET is_primary=FALSE WHERE vendor_id=${vendorId}`;
      const row=await tx<any[]>`INSERT INTO vendor_category_links (vendor_id,operational_category_id,service_category_id,is_primary,created_by_user_id,created_at) VALUES (${vendorId},${operationId},${serviceId},${primary},${user.id},NOW()) ON CONFLICT (vendor_id,operational_category_id,service_category_id) DO UPDATE SET is_primary=${primary} RETURNING id`;
      if(primary)await tx`UPDATE vendors SET category=${service.name},updated_at=NOW() WHERE id=${vendorId}`;
      await evidence(tx,user,{action:"Vendor Classification Added",entityType:"Vendor",entityId:vendorId,entityReference:vendor.name,after:{operation:operation.name,service:service.name,is_primary:primary},note:"Vendor linked to company operation and service category."});
      return {id:Number(row[0].id),vendorId};
    });
  }

  if(action==="vendor-category-unlink"){
    assertRole(user,["Procurement Manager","Admin"]);
    const linkId=positiveId(payload.linkId,"vendor classification");
    return sql.begin(async tx=>{
      const link=(await tx<any[]>`SELECT l.*,v.name vendor_name,oc.name operation_name,sc.name service_name FROM vendor_category_links l JOIN vendors v ON v.id=l.vendor_id JOIN vendor_operational_categories oc ON oc.id=l.operational_category_id JOIN vendor_service_categories sc ON sc.id=l.service_category_id WHERE l.id=${linkId} FOR UPDATE OF l`)[0];
      if(!link)throw new Error("Vendor classification not found.");
      await tx`DELETE FROM vendor_category_links WHERE id=${linkId}`;
      if(link.is_primary){
        const replacement=(await tx<any[]>`SELECT l.id,l.service_category_id,sc.name service_name FROM vendor_category_links l JOIN vendor_service_categories sc ON sc.id=l.service_category_id WHERE l.vendor_id=${link.vendor_id} ORDER BY l.created_at,l.id LIMIT 1`)[0];
        if(replacement){await tx`UPDATE vendor_category_links SET is_primary=TRUE WHERE id=${replacement.id}`;await tx`UPDATE vendors SET category=${replacement.service_name},updated_at=NOW() WHERE id=${link.vendor_id}`;}
      }
      await evidence(tx,user,{action:"Vendor Classification Removed",entityType:"Vendor",entityId:Number(link.vendor_id),entityReference:link.vendor_name,before:{operation:link.operation_name,service:link.service_name,is_primary:link.is_primary},after:{removed:true},note:"Vendor classification removed."});
      return {linkId,vendorId:Number(link.vendor_id)};
    });
  }

  if(action==="vendor-delete"){
    assertRole(user,["Procurement Manager","Admin"]);
    const vendorId=positiveId(payload.vendorId,"vendor");
    const confirmation=clean(payload.confirmation,180);
    return sql.begin(async tx=>{
      const vendor=(await tx<any[]>`SELECT * FROM vendors WHERE id=${vendorId} FOR UPDATE`)[0];
      if(!vendor)throw new Error("Vendor not found.");
      if(confirmation && confirmation.toLowerCase()!==String(vendor.name||"").toLowerCase())throw new Error("Vendor confirmation does not match the selected vendor.");
      const refs=(await tx<any[]>`
        SELECT
          (SELECT COUNT(*) FROM vendor_quotes WHERE vendor_id=${vendorId}) quote_refs,
          (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id=${vendorId}) po_refs,
          (SELECT COUNT(*) FROM purchase_requests WHERE selected_vendor_id=${vendorId}) request_refs,
          (SELECT COUNT(*) FROM sourcing_tasks WHERE recommended_vendor_id=${vendorId}) sourcing_refs,
          (SELECT COUNT(*) FROM payments WHERE vendor_id=${vendorId}) payment_refs,
          (SELECT COUNT(*) FROM receipt_records WHERE vendor_id=${vendorId}) receipt_refs,
          (SELECT COUNT(*) FROM invoices WHERE vendor_id=${vendorId}) invoice_refs,
          (SELECT COUNT(*) FROM expenses WHERE vendor_id=${vendorId}) expense_refs,
          (SELECT COUNT(*) FROM receiving_slips WHERE vendor_id=${vendorId}) receiving_refs,
          (SELECT COUNT(*) FROM vendor_documents WHERE vendor_id=${vendorId}) document_refs,
          (SELECT COUNT(*) FROM payment_payee_details WHERE vendor_id=${vendorId}) payee_refs`)[0];
      const counts=Object.fromEntries(Object.entries(refs||{}).map(([k,v])=>[k,Number(v||0)]));
      const total=Object.values(counts).reduce((sum:any,n:any)=>Number(sum)+Number(n),0);
      if(total>0){
        await tx`UPDATE vendors SET status='Archived',archived_at=NOW(),archived_by_user_id=${user.id},updated_at=NOW() WHERE id=${vendorId}`;
        await evidence(tx,user,{action:"Vendor Archived",entityType:"Vendor",entityId:vendorId,entityReference:vendor.name,before:{status:vendor.status},after:{status:"Archived",reference_counts:counts},note:"Vendor has transaction history, so ProcureFlow archived it instead of deleting audit evidence.",severity:"Important"});
        return {vendorId,deleted:false,archived:true,referenceCounts:counts};
      }
      await evidence(tx,user,{action:"Vendor Deleted",entityType:"Vendor",entityId:vendorId,entityReference:vendor.name,before:{name:vendor.name,status:vendor.status,source:vendor.source},after:{deleted:true},note:"Unused vendor permanently deleted from the Vendor Directory.",severity:"Important"});
      await tx`DELETE FROM vendor_category_links WHERE vendor_id=${vendorId}`;
      await tx`DELETE FROM vendors WHERE id=${vendorId}`;
      return {vendorId,deleted:true,archived:false,referenceCounts:counts};
    });
  }

  if(action==="vendor-nomination-create"){
    assertRole(user,["Facility Manager","Admin"]);
    const vendorName=clean(payload.vendorName,180);if(vendorName.length<2)throw new Error("Vendor name is required.");
    const operationId=positiveId(payload.operationalCategoryId,"company operation");
    const serviceId=positiveId(payload.serviceCategoryId,"service category");
    const nominationReason=reason(payload.reason);
    const priorExperience=clean(payload.priorExperience,1500)||null;
    return sql.begin(async tx=>{
      const operation=(await tx<any[]>`SELECT id,name FROM vendor_operational_categories WHERE id=${operationId} AND status='Active' LIMIT 1`)[0];if(!operation)throw new Error("Choose an active company operation.");
      const service=(await tx<any[]>`SELECT id,name FROM vendor_service_categories WHERE id=${serviceId} AND status='Active' LIMIT 1`)[0];if(!service)throw new Error("Choose an active service category.");
      const existing=(await tx<any[]>`SELECT id,name,status FROM vendors WHERE LOWER(TRIM(name))=LOWER(TRIM(${vendorName})) AND status<>'Archived' LIMIT 1`)[0];
      if(existing)throw new Error(`${existing.name} is already in the approved Vendor Directory. Select the existing vendor instead of nominating a duplicate.`);
      const row=await tx<any[]>`INSERT INTO vendor_nominations (submitted_by_user_id,vendor_name,contact_person,phone,email,address,operational_category_id,service_category_id,reason,prior_experience,status,created_at,updated_at) VALUES (${user.id},${vendorName},${clean(payload.contactPerson,180)||null},${clean(payload.phone,120)||null},${clean(payload.email,180)||null},${clean(payload.address,500)||null},${operationId},${serviceId},${nominationReason},${priorExperience},'Pending Procurement Review',NOW(),NOW()) RETURNING id`;
      const id=Number(row[0].id);
      await workflow(tx,user,"Vendor Nomination",id,"Vendor Suggested","Pending Procurement Review",nominationReason);
      await evidence(tx,user,{action:"Vendor Suggested",entityType:"Vendor Nomination",entityId:id,entityReference:vendorName,after:{status:"Pending Procurement Review",operation:operation.name,service:service.name},note:nominationReason});
      await notifyRole(tx,"Procurement Manager","New vendor nomination from Facility",`${vendorName} was suggested for ${operation.name} / ${service.name}. Procurement review is required.`,"Vendor Nomination",id,"Vendor Directory","High");
      return {nominationId:id,status:"Pending Procurement Review"};
    });
  }

  if(action==="vendor-nomination-resubmit"){
    assertRole(user,["Facility Manager","Admin"]);
    const id=positiveId(payload.nominationId,"vendor nomination");
    const additionalInfo=reason(payload.additionalInfo);
    return sql.begin(async tx=>{
      const n=(await tx<any[]>`SELECT * FROM vendor_nominations WHERE id=${id} FOR UPDATE`)[0];
      if(!n)throw new Error("Vendor nomination not found.");
      if(user.role!=="Admin"&&Number(n.submitted_by_user_id)!==user.id)throw new Error("You can update only your own vendor nominations.");
      if(String(n.status)!=="More Information Required")throw new Error("This nomination is not waiting for additional information.");
      const experience=[clean(n.prior_experience,1500),additionalInfo].filter(Boolean).join(" | ").slice(0,2000);
      await tx`UPDATE vendor_nominations SET prior_experience=${experience},status='Pending Procurement Review',updated_at=NOW() WHERE id=${id}`;
      await workflow(tx,user,"Vendor Nomination",id,"Additional Information Submitted","Pending Procurement Review",additionalInfo);
      await evidence(tx,user,{action:"Vendor Nomination Resubmitted",entityType:"Vendor Nomination",entityId:id,entityReference:n.vendor_name,before:{status:n.status},after:{status:"Pending Procurement Review"},note:additionalInfo});
      await notifyRole(tx,"Procurement Manager","Vendor nomination resubmitted",`${n.vendor_name} has additional information and is ready for Procurement review.`,"Vendor Nomination",id,"Vendor Directory","High");
      return {nominationId:id,status:"Pending Procurement Review"};
    });
  }

  if(action==="vendor-nomination-decision"){
    assertRole(user,["Procurement Manager","Admin"]);
    const id=positiveId(payload.nominationId,"vendor nomination");
    const decision=clean(payload.decision,30);
    if(!["approve","more_info","reject"].includes(decision))throw new Error("Choose a valid vendor nomination decision.");
    const note=decision==="approve"?(clean(payload.note,1500)||"Approved into Vendor Directory"):reason(payload.note);
    return sql.begin(async tx=>{
      const n=(await tx<any[]>`SELECT n.*,oc.name operation_name,sc.name service_name FROM vendor_nominations n JOIN vendor_operational_categories oc ON oc.id=n.operational_category_id JOIN vendor_service_categories sc ON sc.id=n.service_category_id WHERE n.id=${id} FOR UPDATE OF n`)[0];
      if(!n)throw new Error("Vendor nomination not found.");
      if(!["Pending Procurement Review","More Information Required"].includes(String(n.status||"")))throw new Error("This vendor nomination has already been decided.");
      const now=new Date().toISOString();
      if(decision==="more_info"){
        await tx`UPDATE vendor_nominations SET status='More Information Required',procurement_note=${note},reviewed_by_user_id=${user.id},reviewed_at=${now},updated_at=${now} WHERE id=${id}`;
        await workflow(tx,user,"Vendor Nomination",id,"More Information Required","More Information Required",note);
        await evidence(tx,user,{action:"Vendor Nomination More Information Required",entityType:"Vendor Nomination",entityId:id,entityReference:n.vendor_name,before:{status:n.status},after:{status:"More Information Required"},note});
        await notifyUser(tx,Number(n.submitted_by_user_id),"More information required for vendor suggestion",`Procurement needs more information about ${n.vendor_name}: ${note}`,"Vendor Nomination",id,"My Vendor Suggestions","High");
        return {nominationId:id,status:"More Information Required"};
      }
      if(decision==="reject"){
        await tx`UPDATE vendor_nominations SET status='Rejected',procurement_note=${note},reviewed_by_user_id=${user.id},reviewed_at=${now},updated_at=${now} WHERE id=${id}`;
        await workflow(tx,user,"Vendor Nomination",id,"Vendor Nomination Rejected","Rejected",note);
        await evidence(tx,user,{action:"Vendor Nomination Rejected",entityType:"Vendor Nomination",entityId:id,entityReference:n.vendor_name,before:{status:n.status},after:{status:"Rejected"},note,severity:"Important"});
        await notifyUser(tx,Number(n.submitted_by_user_id),"Vendor suggestion rejected",`${n.vendor_name} was not approved into the Vendor Directory. Reason: ${note}`,"Vendor Nomination",id,"My Vendor Suggestions","High");
        return {nominationId:id,status:"Rejected"};
      }
      let vendor=(await tx<any[]>`SELECT * FROM vendors WHERE LOWER(TRIM(name))=LOWER(TRIM(${n.vendor_name})) LIMIT 1 FOR UPDATE`)[0];
      let vendorId:number;
      if(vendor){
        vendorId=Number(vendor.id);
        await tx`UPDATE vendors SET contact_person=COALESCE(contact_person,${n.contact_person}),phone=COALESCE(phone,${n.phone}),email=COALESCE(email,${n.email}),address=COALESCE(address,${n.address}),category=${n.service_name},status='Active',source=CASE WHEN source='Legacy Placeholder' THEN 'Facility Nomination' ELSE COALESCE(source,'Facility Nomination') END,archived_at=NULL,archived_by_user_id=NULL,updated_at=${now} WHERE id=${vendorId}`;
      }else{
        const row=await tx<any[]>`INSERT INTO vendors (name,contact_person,category,phone,email,address,rating,completed_orders,total_spend,rejection_count,status,source,notes,created_by_user_id,created_at,updated_at) VALUES (${n.vendor_name},${n.contact_person},${n.service_name},${n.phone},${n.email},${n.address},3,0,0,0,'Active','Facility Nomination',${note},${user.id},${now},${now}) RETURNING id`;
        vendorId=Number(row[0].id);
      }
      const hasPrimary=(await tx<any[]>`SELECT id FROM vendor_category_links WHERE vendor_id=${vendorId} AND is_primary=TRUE LIMIT 1`)[0];
      await tx`INSERT INTO vendor_category_links (vendor_id,operational_category_id,service_category_id,is_primary,created_by_user_id,created_at) VALUES (${vendorId},${n.operational_category_id},${n.service_category_id},${!hasPrimary},${user.id},${now}) ON CONFLICT (vendor_id,operational_category_id,service_category_id) DO NOTHING`;
      await tx`UPDATE vendor_nominations SET status='Approved',procurement_note=${note},reviewed_by_user_id=${user.id},reviewed_at=${now},approved_vendor_id=${vendorId},updated_at=${now} WHERE id=${id}`;
      await workflow(tx,user,"Vendor Nomination",id,"Vendor Approved into Directory","Approved",note);
      await evidence(tx,user,{action:"Vendor Nomination Approved",entityType:"Vendor Nomination",entityId:id,entityReference:n.vendor_name,before:{status:n.status},after:{status:"Approved",vendor_id:vendorId,operation:n.operation_name,service:n.service_name},note});
      await evidence(tx,user,{action:"Vendor Activated from Facility Nomination",entityType:"Vendor",entityId:vendorId,entityReference:n.vendor_name,after:{status:"Active",source:"Facility Nomination",operation:n.operation_name,service:n.service_name},note,relatedUserId:Number(n.submitted_by_user_id)});
      await notifyUser(tx,Number(n.submitted_by_user_id),"Vendor suggestion approved",`${n.vendor_name} is now an approved vendor in the Vendor Directory.`,"Vendor Nomination",id,"My Vendor Suggestions","Normal");
      return {nominationId:id,status:"Approved",vendorId};
    });
  }

  if(action==="gateway-create"){
    assertRole(user,["Facility Manager","Admin"]);const department=clean(payload.department,180);const movementType=clean(payload.movementType,120);const purpose=reason(payload.purpose);const items=Array.isArray(payload.items)?payload.items:[];if(!department||!movementType)throw new Error("Department and movement type are required.");if(!items.length)throw new Error("Add at least one item to the gateway pass.");const pass=ref("GP");
    return sql.begin(async tx=>{const row=await tx<any[]>`INSERT INTO gateway_passes (pass_number,facility_manager_user_id,department,movement_type,purpose,origin_location,destination,expected_movement_date,expected_return_date,vehicle_number,driver_name,driver_phone,receiver_name,receiver_organization,status,next_role,created_at,updated_at) VALUES (${pass},${user.id},${department},${movementType},${purpose},${clean(payload.originLocation,250)||null},${clean(payload.destination,250)||null},${clean(payload.expectedMovementDate,20)||null},${clean(payload.expectedReturnDate,20)||null},${clean(payload.vehicleNumber,80)||null},${clean(payload.driverName,160)||null},${clean(payload.driverPhone,80)||null},${clean(payload.receiverName,160)||null},${clean(payload.receiverOrganization,180)||null},'Draft','facility_manager',NOW(),NOW()) RETURNING id`;const id=Number(row[0].id);for(const item of items.slice(0,100)){const desc=clean(item.description,500);if(!desc)continue;await tx`INSERT INTO gateway_pass_items (gateway_pass_id,item_description,item_category,quantity,unit_of_measure,quality_condition,estimated_value,serial_number,asset_tag,fragility_status,handling_instruction,remarks,created_at,colour) VALUES (${id},${desc},${clean(item.category,120)||null},${wholeNumber(item.quantity??1,"quantity")},${clean(item.unit,60)||'Unit'},${clean(item.condition,80)||'Good'},${money(item.estimatedValue||0,"estimated value")},${clean(item.serialNumber,120)||null},${clean(item.assetTag,120)||null},${clean(item.fragility,80)||'Normal'},${clean(item.handlingInstruction,400)||null},${clean(item.remarks,400)||null},NOW(),${clean(item.colour,80)||null})`;}
      await workflow(tx,user,"Gateway Pass",id,"Gateway Pass Draft Created","Draft",purpose);await evidence(tx,user,{action:"Gateway Pass Created",entityType:"Gateway Pass",entityId:id,entityReference:pass,after:{department,movement_type:movementType,status:"Draft",item_count:items.length},note:purpose});return {gatewayPassId:id,passNumber:pass};});
  }

  if(action==="gateway-update"){
    assertRole(user,["Facility Manager","Admin"]);const id=positiveId(payload.gatewayPassId,"gateway pass");const department=clean(payload.department,180);const movementType=clean(payload.movementType,120);const purpose=reason(payload.purpose);const items=Array.isArray(payload.items)?payload.items:[];if(!department||!movementType)throw new Error("Department and movement type are required.");if(!items.length)throw new Error("Add at least one item to the gateway pass.");
    return sql.begin(async tx=>{
      const gp=(await tx<any[]>`SELECT * FROM gateway_passes WHERE id=${id} FOR UPDATE`)[0];
      if(!gp)throw new Error("Gateway pass not found.");
      if(user.role!=="Admin"&&Number(gp.facility_manager_user_id)!==user.id)throw new Error("You can edit only your own gateway passes.");
      const currentStatus=String(gp.status||"");
      if(!["Draft","Returned for Correction"].includes(currentStatus))throw new Error("Only a draft or a gateway pass returned for correction can be edited.");
      const validItems=items.slice(0,100).filter((item:any)=>clean(item?.description,500));
      if(!validItems.length)throw new Error("Add at least one item with a description to the gateway pass.");
      const now=new Date().toISOString();
      await tx`
        UPDATE gateway_passes
        SET department=${department},movement_type=${movementType},purpose=${purpose},
            origin_location=${clean(payload.originLocation,250)||null},destination=${clean(payload.destination,250)||null},
            expected_movement_date=${clean(payload.expectedMovementDate,20)||null},expected_return_date=${clean(payload.expectedReturnDate,20)||null},
            vehicle_number=${clean(payload.vehicleNumber,80)||null},driver_name=${clean(payload.driverName,160)||null},
            driver_phone=${clean(payload.driverPhone,80)||null},receiver_name=${clean(payload.receiverName,160)||null},
            receiver_organization=${clean(payload.receiverOrganization,180)||null},updated_at=${now}
        WHERE id=${id}
      `;
      await tx`DELETE FROM gateway_pass_items WHERE gateway_pass_id=${id}`;
      for(const item of validItems){
        const desc=clean(item.description,500);
        await tx`INSERT INTO gateway_pass_items (gateway_pass_id,item_description,item_category,quantity,unit_of_measure,quality_condition,estimated_value,serial_number,asset_tag,fragility_status,handling_instruction,remarks,created_at,colour) VALUES (${id},${desc},${clean(item.category,120)||null},${wholeNumber(item.quantity??1,"quantity")},${clean(item.unit,60)||'Unit'},${clean(item.condition,80)||'Good'},${money(item.estimatedValue||0,"estimated value")},${clean(item.serialNumber,120)||null},${clean(item.assetTag,120)||null},${clean(item.fragility,80)||'Normal'},${clean(item.handlingInstruction,400)||null},${clean(item.remarks,400)||null},${now},${clean(item.colour,80)||null})`;
      }
      const event=currentStatus==="Returned for Correction"?"Gateway Pass Corrections Saved":"Gateway Pass Draft Updated";
      await workflow(tx,user,"Gateway Pass",id,event,currentStatus,currentStatus==="Returned for Correction"?"Returned gateway pass corrected and ready for resubmission":"Gateway pass draft updated before submission");
      await evidence(tx,user,{action:event,entityType:"Gateway Pass",entityId:id,entityReference:gp.pass_number,before:{status:currentStatus,department:gp.department,movement_type:gp.movement_type,item_count:null},after:{status:currentStatus,department,movement_type:movementType,item_count:validItems.length},note:currentStatus==="Returned for Correction"?"Facility Manager saved corrections before resubmission":"Facility Manager updated gateway pass draft"});
      return {id,status:currentStatus,passNumber:gp.pass_number,itemCount:validItems.length};
    });
  }

  if(action==="gateway-submit"){
    assertRole(user,["Facility Manager","Admin"]);const id=positiveId(payload.gatewayPassId,"gateway pass");
    return sql.begin(async tx=>{
      const gp=(await tx<any[]>`SELECT * FROM gateway_passes WHERE id=${id} FOR UPDATE`)[0];
      if(!gp)throw new Error("Gateway pass not found.");
      if(user.role!=="Admin"&&Number(gp.facility_manager_user_id)!==user.id)throw new Error("You can submit only your own gateway passes.");
      if(!["Draft","Returned for Correction"].includes(String(gp.status||"")))throw new Error("This gateway pass is not ready for submission.");
      const note=clean(payload.note,1000)||"Submitted for Procurement or Logistics approval";
      await tx`UPDATE gateway_passes SET status='Submitted',submitted_at=NOW(),next_role='gateway_approval',reviewed_by_user_id=NULL,reviewed_at=NULL,procurement_review_note=NULL,updated_at=NOW() WHERE id=${id}`;
      await workflow(tx,user,"Gateway Pass",id,"Submitted","Submitted",note);
      await evidence(tx,user,{action:"Gateway Pass Submitted",entityType:"Gateway Pass",entityId:id,entityReference:gp.pass_number,before:{status:gp.status,next_role:gp.next_role},after:{status:"Submitted",next_role:"gateway_approval"},note});
      await notifyRole(tx,"Procurement Manager","Gateway pass awaiting approval",`${gp.pass_number} is ready for review and approval.`,"Gateway Pass",id,"Gateway Pass Review","High");
      await notifyRole(tx,"Logistics Officer","Gateway pass awaiting approval",`${gp.pass_number} is ready for review and approval.`,"Gateway Pass",id,"Gateway Pass Review & Approval","High");
      return {id,status:"Submitted",nextRole:"gateway_approval"};
    });
  }

  if(action==="gateway-review"){
    assertRole(user,["Procurement Manager","Logistics Officer","Admin"]);const id=positiveId(payload.gatewayPassId,"gateway pass");const rawDecision=clean(payload.decision,30);const decision=rawDecision==="forward"?"approve":rawDecision;if(!["approve","return","reject"].includes(decision))throw new Error("Choose a valid gateway pass decision.");const note=reason(payload.note);
    return sql.begin(async tx=>{
      const gp=(await tx<any[]>`SELECT * FROM gateway_passes WHERE id=${id} FOR UPDATE`)[0];
      if(!gp)throw new Error("Gateway pass not found.");
      if(!["Submitted","Pending Procurement Manager / Approver Review"].includes(String(gp.status||"")))throw new Error("This gateway pass has already been decided or is not awaiting approval.");
      const now=new Date().toISOString();
      const approvalRole=user.role==="Logistics Officer"?"Logistics Manager":user.role;
      const status=decision==="approve"?"Approved":decision==="return"?"Returned for Correction":"Rejected";
      const next="facility_manager";
      await tx`
        UPDATE gateway_passes
        SET status=${status},next_role=${next},reviewed_by_user_id=${user.id},reviewed_at=${now},procurement_review_note=${note},
            approved_at=${decision==="approve"?now:gp.approved_at},
            approved_by_user_id=${decision==="approve"?user.id:gp.approved_by_user_id},
            approved_by_role=${decision==="approve"?approvalRole:gp.approved_by_role},
            approval_note=${decision==="approve"?note:gp.approval_note},
            rejected_at=${decision==="reject"?now:gp.rejected_at},
            rejected_by_user_id=${decision==="reject"?user.id:gp.rejected_by_user_id},
            rejection_reason=${decision==="reject"?note:gp.rejection_reason},
            updated_at=${now}
        WHERE id=${id}
      `;
      await tx`INSERT INTO gateway_pass_approvals (gateway_pass_id,approver_user_id,approver_role,decision,note,created_at) VALUES (${id},${user.id},${approvalRole},${decision},${note},${now})`;
      await workflow(tx,user,"Gateway Pass",id,`Gateway Pass ${decision}`,status,note);
      await evidence(tx,user,{action:`Gateway Pass ${decision}`,entityType:"Gateway Pass",entityId:id,entityReference:gp.pass_number,before:{status:gp.status,next_role:gp.next_role},after:{status,next_role:next,approved_by_role:decision==="approve"?approvalRole:null,approved_at:decision==="approve"?now:null},note});
      if(gp.facility_manager_user_id)await notifyUser(tx,Number(gp.facility_manager_user_id),`Gateway pass ${status}`,decision==="approve"?`${gp.pass_number} was approved by ${approvalRole}. You can now open, print, or download the approved PDF.`:`${gp.pass_number}: ${note}`,"Gateway Pass",id,"Gateway Pass",decision==="approve"?"High":"High");
      if(decision==="approve"){
        await notifyRole(tx,"Approver","Gateway pass approved",`${gp.pass_number} was approved by ${approvalRole} and is available in Approved Gateway Passes.`,"Gateway Pass",id,"Approved Gateway Passes","Normal");
        await notifyRole(tx,"Auditor","Gateway pass approved",`${gp.pass_number} was approved by ${approvalRole}.`,"Gateway Pass",id,"Gateway Pass Audit","Normal");
      }
      return {id,status,approvedByRole:decision==="approve"?approvalRole:null,approvedAt:decision==="approve"?now:null};
    });
  }

  if(action==="gateway-generate"){
    assertRole(user,["Facility Manager","Admin"]);const id=positiveId(payload.gatewayPassId,"gateway pass");return sql.begin(async tx=>{const gp=(await tx<any[]>`SELECT * FROM gateway_passes WHERE id=${id} FOR UPDATE`)[0];if(!gp)throw new Error("Gateway pass not found.");if(user.role!=="Admin"&&Number(gp.facility_manager_user_id)!==user.id)throw new Error("You can generate only your own approved gateway passes.");if(!["Approved","Generated","Downloaded"].includes(String(gp.status||"")))throw new Error("Only an approved gateway pass can be generated.");const path=`/api/gateway-pass/${id}/pdf`;await tx`UPDATE gateway_passes SET status='Generated',generated_at=COALESCE(generated_at,NOW()),generated_file_path=${path},next_role='facility_manager',updated_at=NOW() WHERE id=${id}`;await workflow(tx,user,"Gateway Pass",id,"Generated","Generated","Gateway pass PDF generated");await evidence(tx,user,{action:"Gateway Pass Generated",entityType:"Gateway Pass",entityId:id,entityReference:gp.pass_number,before:{status:gp.status},after:{status:"Generated",generated_file_path:path},note:"Approved gateway pass generated for controlled download"});return {id,status:"Generated",downloadUrl:path};});
  }


  if(action==="return-pass-create"){
    assertRole(user,["Facility Manager","Admin"]);
    const gatewayPassId=positiveId(payload.gatewayPassId,"gateway pass");
    const items=Array.isArray(payload.items)?payload.items:[];
    const pass=ref("RP");
    return sql.begin(async tx=>{
      const gp=(await tx<any[]>`SELECT * FROM gateway_passes WHERE id=${gatewayPassId} FOR UPDATE`)[0];
      if(!gp)throw new Error("Gateway pass not found.");
      if(user.role!=="Admin"&&Number(gp.facility_manager_user_id)!==user.id)throw new Error("You can create a return pass only for your own gateway pass.");
      if(!["Approved","Generated","Downloaded","Closed"].includes(String(gp.status||"")))throw new Error("Only an approved gateway pass can start a return.");
      if(String(gp.return_status||"")==="Fully Returned")throw new Error("All items on this gateway pass have already been fully returned.");
      const sourceItems=await tx<any[]>`
        SELECT gi.*,
          COALESCE((SELECT SUM(rpi.quantity_returned) FROM return_pass_items rpi JOIN return_passes rp ON rp.id=rpi.return_pass_id
                    WHERE rpi.gateway_pass_item_id=gi.id AND rp.status IN ('Returned','Partial Return','Returned With Exception')),0) previous_returned
        FROM gateway_pass_items gi WHERE gi.gateway_pass_id=${gatewayPassId} ORDER BY gi.id FOR UPDATE OF gi`;
      if(!sourceItems.length)throw new Error("The gateway pass has no item lines to return.");
      const requested=new Map<number,any>(); for(const input of items)requested.set(Number(input.gatewayPassItemId),input);
      let hasReturn=false;
      const prepared=sourceItems.map((item:any)=>{
        const input=requested.get(Number(item.id))||{};
        const outbound=wholeNumber(item.quantity,"outbound quantity");
        const previous=Math.max(0,Math.round(Number(item.previous_returned||0)));
        const outstanding=Math.max(0,outbound-previous);
        const quantity=Number(input.quantityReturned??0);
        if(!Number.isInteger(quantity)||quantity<0)throw new Error(`Return quantity for ${item.item_description} must be a whole number.`);
        if(quantity>outstanding)throw new Error(`Return quantity for ${item.item_description} cannot exceed the ${outstanding} item(s) outstanding.`);
        if(quantity>0)hasReturn=true;
        return {item,outbound,previous,quantity,condition:clean(input.conditionOnReturn,80)||"Good",discrepancyType:clean(input.discrepancyType,120)||null,discrepancyNotes:clean(input.discrepancyNotes,600)||null,remarks:clean(input.remarks,600)||null};
      });
      if(!hasReturn)throw new Error("Enter at least one item quantity being returned.");
      const row=await tx<any[]>`
        INSERT INTO return_passes (return_pass_number,gateway_pass_id,facility_manager_user_id,department,purpose,return_origin,receiving_location,actual_return_date,vehicle_number,driver_name,driver_phone,status,next_role,created_at,updated_at)
        VALUES (${pass},${gatewayPassId},${gp.facility_manager_user_id},${gp.department},${clean(payload.purpose,800)||`Return against ${gp.pass_number}`},${clean(payload.returnOrigin,250)||gp.destination||null},${clean(payload.receivingLocation,250)||gp.origin_location||null},${clean(payload.actualReturnDate,20)||null},${clean(payload.vehicleNumber,80)||null},${clean(payload.driverName,160)||null},${clean(payload.driverPhone,80)||null},'Draft','facility_manager',NOW(),NOW()) RETURNING id`;
      const id=Number(row[0].id);
      for(const p of prepared){
        await tx`INSERT INTO return_pass_items (return_pass_id,gateway_pass_item_id,quantity_outbound,quantity_previously_returned,quantity_returned,condition_on_return,discrepancy_type,discrepancy_notes,remarks,created_at,updated_at)
          VALUES (${id},${p.item.id},${p.outbound},${p.previous},${p.quantity},${p.condition},${p.discrepancyType},${p.discrepancyNotes},${p.remarks},NOW(),NOW())`;
      }
      await tx`UPDATE gateway_passes SET return_status=CASE WHEN COALESCE(return_status,'Not Started')='Not Started' THEN 'Return Drafted' ELSE return_status END,updated_at=NOW() WHERE id=${gatewayPassId}`;
      await tx`INSERT INTO return_pass_events (return_pass_id,event,status,note,user_id,created_at) VALUES (${id},'Return Pass Draft Created','Draft',${`Linked to ${gp.pass_number}`},${user.id},NOW())`;
      await workflow(tx,user,"Return Pass",id,"Return Pass Draft Created","Draft",`Linked to ${gp.pass_number}`);
      await evidence(tx,user,{action:"Return Pass Created",entityType:"Return Pass",entityId:id,entityReference:pass,after:{gateway_pass:gp.pass_number,status:"Draft"},note:`Return reconciliation started for ${gp.pass_number}`});
      return {returnPassId:id,returnPassNumber:pass};
    });
  }

  if(action==="return-pass-update"){
    assertRole(user,["Facility Manager","Admin"]);
    const id=positiveId(payload.returnPassId,"return pass");
    const items=Array.isArray(payload.items)?payload.items:[];
    return sql.begin(async tx=>{
      const rp=(await tx<any[]>`SELECT * FROM return_passes WHERE id=${id} FOR UPDATE`)[0];
      if(!rp)throw new Error("Return pass not found.");
      if(user.role!=="Admin"&&Number(rp.facility_manager_user_id)!==user.id)throw new Error("You can edit only your own return pass.");
      if(!["Draft","Returned for Correction"].includes(String(rp.status||"")))throw new Error("Only a draft or returned-for-correction return pass can be edited.");
      const sourceItems=await tx<any[]>`
        SELECT gi.*,
          COALESCE((SELECT SUM(rpi.quantity_returned) FROM return_pass_items rpi JOIN return_passes other ON other.id=rpi.return_pass_id
                    WHERE rpi.gateway_pass_item_id=gi.id AND other.id<>${id} AND other.status IN ('Returned','Partial Return','Returned With Exception')),0) previous_returned
        FROM gateway_pass_items gi WHERE gi.gateway_pass_id=${rp.gateway_pass_id} ORDER BY gi.id`;
      const requested=new Map<number,any>(); for(const input of items)requested.set(Number(input.gatewayPassItemId),input);
      let hasReturn=false;
      const prepared=sourceItems.map((item:any)=>{
        const input=requested.get(Number(item.id))||{};
        const outbound=wholeNumber(item.quantity,"outbound quantity");
        const previous=Math.max(0,Math.round(Number(item.previous_returned||0)));
        const outstanding=Math.max(0,outbound-previous);
        const quantity=Number(input.quantityReturned??0);
        if(!Number.isInteger(quantity)||quantity<0)throw new Error(`Return quantity for ${item.item_description} must be a whole number.`);
        if(quantity>outstanding)throw new Error(`Return quantity for ${item.item_description} cannot exceed ${outstanding} outstanding.`);
        if(quantity>0)hasReturn=true;
        return {item,outbound,previous,quantity,condition:clean(input.conditionOnReturn,80)||"Good",discrepancyType:clean(input.discrepancyType,120)||null,discrepancyNotes:clean(input.discrepancyNotes,600)||null,remarks:clean(input.remarks,600)||null};
      });
      if(!hasReturn)throw new Error("Enter at least one item quantity being returned.");
      await tx`UPDATE return_passes SET purpose=${clean(payload.purpose,800)||rp.purpose},return_origin=${clean(payload.returnOrigin,250)||null},receiving_location=${clean(payload.receivingLocation,250)||null},actual_return_date=${clean(payload.actualReturnDate,20)||null},vehicle_number=${clean(payload.vehicleNumber,80)||null},driver_name=${clean(payload.driverName,160)||null},driver_phone=${clean(payload.driverPhone,80)||null},updated_at=NOW() WHERE id=${id}`;
      await tx`DELETE FROM return_pass_items WHERE return_pass_id=${id}`;
      for(const p of prepared)await tx`INSERT INTO return_pass_items (return_pass_id,gateway_pass_item_id,quantity_outbound,quantity_previously_returned,quantity_returned,condition_on_return,discrepancy_type,discrepancy_notes,remarks,created_at,updated_at) VALUES (${id},${p.item.id},${p.outbound},${p.previous},${p.quantity},${p.condition},${p.discrepancyType},${p.discrepancyNotes},${p.remarks},NOW(),NOW())`;
      await tx`INSERT INTO return_pass_events (return_pass_id,event,status,note,user_id,created_at) VALUES (${id},'Return Pass Updated',${rp.status},'Facility saved return reconciliation changes',${user.id},NOW())`;
      await evidence(tx,user,{action:"Return Pass Updated",entityType:"Return Pass",entityId:id,entityReference:rp.return_pass_number,before:{status:rp.status},after:{status:rp.status},note:"Return quantities and conditions updated."});
      return {returnPassId:id,status:rp.status};
    });
  }

  if(action==="return-pass-submit"){
    assertRole(user,["Facility Manager","Admin"]);
    const id=positiveId(payload.returnPassId,"return pass");
    return sql.begin(async tx=>{
      const rp=(await tx<any[]>`SELECT * FROM return_passes WHERE id=${id} FOR UPDATE`)[0];
      if(!rp)throw new Error("Return pass not found.");
      if(user.role!=="Admin"&&Number(rp.facility_manager_user_id)!==user.id)throw new Error("You can submit only your own return pass.");
      if(!["Draft","Returned for Correction"].includes(String(rp.status||"")))throw new Error("This return pass is not ready for submission.");
      const rows=await tx<any[]>`SELECT * FROM return_pass_items WHERE return_pass_id=${id}`;
      if(!rows.some((row:any)=>Number(row.quantity_returned||0)>0))throw new Error("At least one returned quantity is required.");
      await tx`UPDATE return_passes SET status='Submitted',next_role='logistics_manager',submitted_at=NOW(),reviewed_at=NULL,reviewed_by_user_id=NULL,approval_note=NULL,rejection_reason=NULL,updated_at=NOW() WHERE id=${id}`;
      await tx`INSERT INTO return_pass_events (return_pass_id,event,status,note,user_id,created_at) VALUES (${id},'Submitted to Logistics Manager','Submitted','Awaiting physical return verification',${user.id},NOW())`;
      await workflow(tx,user,"Return Pass",id,"Submitted to Logistics Manager","Submitted","Return quantities and conditions ready for verification.");
      await evidence(tx,user,{action:"Return Pass Submitted",entityType:"Return Pass",entityId:id,entityReference:rp.return_pass_number,before:{status:rp.status},after:{status:"Submitted",next_role:"logistics_manager"},note:"Return pass submitted for Logistics Manager verification."});
      await notifyRole(tx,"Logistics Officer","Return pass awaiting verification",`${rp.return_pass_number} is ready for quantity, condition and gate verification.`,"Return Pass",id,"Return Pass Review","High");
      return {returnPassId:id,status:"Submitted"};
    });
  }

  if(action==="return-pass-review"){
    assertRole(user,["Logistics Officer","Admin"]);
    const id=positiveId(payload.returnPassId,"return pass");
    const decision=clean(payload.decision,30);
    if(!["approve","return","reject"].includes(decision))throw new Error("Choose a valid return pass decision.");
    const note=decision==="approve"?(clean(payload.note,1200)||"Return physically verified by Logistics Manager"):reason(payload.note);
    return sql.begin(async tx=>{
      const rp=(await tx<any[]>`SELECT rp.*,gp.pass_number gateway_pass_number FROM return_passes rp JOIN gateway_passes gp ON gp.id=rp.gateway_pass_id WHERE rp.id=${id} FOR UPDATE OF rp`)[0];
      if(!rp)throw new Error("Return pass not found.");
      if(String(rp.status||"")!=="Submitted")throw new Error("This return pass is no longer awaiting Logistics Manager verification.");
      const now=new Date().toISOString();
      if(decision==="return"){
        await tx`UPDATE return_passes SET status='Returned for Correction',next_role='facility_manager',reviewed_at=${now},reviewed_by_user_id=${user.id},approval_note=${note},updated_at=${now} WHERE id=${id}`;
        await tx`INSERT INTO return_pass_events (return_pass_id,event,status,note,user_id,created_at) VALUES (${id},'Returned for Correction','Returned for Correction',${note},${user.id},NOW())`;
        await workflow(tx,user,"Return Pass",id,"Returned for Correction","Returned for Correction",note);
        await evidence(tx,user,{action:"Return Pass Returned for Correction",entityType:"Return Pass",entityId:id,entityReference:rp.return_pass_number,before:{status:"Submitted"},after:{status:"Returned for Correction",next_role:"facility_manager"},note});
        await notifyUser(tx,Number(rp.facility_manager_user_id),"Return pass needs correction",`${rp.return_pass_number} was returned by Logistics Manager: ${note}`,"Return Pass",id,"Return Pass","High");
        return {returnPassId:id,status:"Returned for Correction"};
      }
      if(decision==="reject"){
        await tx`UPDATE return_passes SET status='Rejected',next_role=NULL,reviewed_at=${now},reviewed_by_user_id=${user.id},rejected_at=${now},rejected_by_user_id=${user.id},rejection_reason=${note},updated_at=${now} WHERE id=${id}`;
        await tx`INSERT INTO return_pass_events (return_pass_id,event,status,note,user_id,created_at) VALUES (${id},'Return Pass Rejected','Rejected',${note},${user.id},NOW())`;
        await workflow(tx,user,"Return Pass",id,"Return Pass Rejected","Rejected",note);
        await evidence(tx,user,{action:"Return Pass Rejected",entityType:"Return Pass",entityId:id,entityReference:rp.return_pass_number,before:{status:"Submitted"},after:{status:"Rejected"},note,severity:"Important"});
        await notifyUser(tx,Number(rp.facility_manager_user_id),"Return pass rejected",`${rp.return_pass_number} was rejected by Logistics Manager. Reason: ${note}`,"Return Pass",id,"Return Pass","High");
        return {returnPassId:id,status:"Rejected"};
      }

      const lines=await tx<any[]>`
        SELECT rpi.*,gi.item_description,gi.quantity outbound_qty,
          COALESCE((SELECT SUM(prev.quantity_returned) FROM return_pass_items prev JOIN return_passes prp ON prp.id=prev.return_pass_id
                    WHERE prev.gateway_pass_item_id=rpi.gateway_pass_item_id AND prp.id<>${id} AND prp.status IN ('Returned','Partial Return','Returned With Exception')),0) previous_approved
        FROM return_pass_items rpi JOIN gateway_pass_items gi ON gi.id=rpi.gateway_pass_item_id
        WHERE rpi.return_pass_id=${id} ORDER BY rpi.id FOR UPDATE OF rpi`;
      if(!lines.length)throw new Error("Return pass has no item reconciliation lines.");
      let allComplete=true;let hasException=false;
      for(const line of lines){
        const outbound=wholeNumber(line.outbound_qty,"outbound quantity");
        const previous=Math.max(0,Math.round(Number(line.previous_approved||0)));
        const current=Number(line.quantity_returned||0);
        if(!Number.isInteger(current)||current<0)throw new Error(`Return quantity for ${line.item_description} must be a whole number.`);
        if(current+previous>outbound)throw new Error(`Verified quantity for ${line.item_description} exceeds the original outbound quantity.`);
        if(current+previous<outbound)allComplete=false;
        if(current>0&&(String(line.condition_on_return||"Good")!=="Good"||clean(line.discrepancy_type,120)||clean(line.discrepancy_notes,600)))hasException=true;
        await tx`UPDATE return_pass_items SET quantity_previously_returned=${previous},updated_at=NOW() WHERE id=${line.id}`;
      }
      const finalStatus=allComplete?(hasException?"Returned With Exception":"Returned"):"Partial Return";
      const gatewayReturnStatus=allComplete?(hasException?"Returned With Exception":"Fully Returned"):"Partially Returned";
      await tx`UPDATE return_passes SET status=${finalStatus},next_role=NULL,reviewed_at=${now},reviewed_by_user_id=${user.id},approved_at=${now},approved_by_user_id=${user.id},approved_by_role='Logistics Manager',approval_note=${note},security_checkpoint=${clean(payload.securityCheckpoint,160)||rp.security_checkpoint},security_officer_name=${clean(payload.securityOfficerName,160)||rp.security_officer_name},gate_verification_time=${clean(payload.gateVerificationTime,40)||now},updated_at=${now} WHERE id=${id}`;
      await tx`UPDATE gateway_passes SET return_status=${gatewayReturnStatus},last_return_at=${now},return_completed_at=${allComplete?now:null},actual_return_date=${allComplete?(rp.actual_return_date||now.slice(0,10)):null},updated_at=NOW() WHERE id=${rp.gateway_pass_id}`;
      await tx`INSERT INTO return_pass_events (return_pass_id,event,status,note,user_id,created_at) VALUES (${id},'Return Verified',${finalStatus},${note},${user.id},NOW())`;
      await workflow(tx,user,"Return Pass",id,"Return Verified",finalStatus,note);
      await evidence(tx,user,{action:"Return Pass Verified",entityType:"Return Pass",entityId:id,entityReference:rp.return_pass_number,before:{status:"Submitted"},after:{status:finalStatus,gateway_return_status:gatewayReturnStatus,approved_by_role:"Logistics Manager"},note,severity:hasException?"Important":"Normal"});
      await notifyUser(tx,Number(rp.facility_manager_user_id),"Return pass verified",`${rp.return_pass_number} is ${finalStatus}. Linked ${rp.gateway_pass_number} is now ${gatewayReturnStatus}.`,"Return Pass",id,"Return Pass","Normal");
      await notifyRole(tx,"Procurement Manager","Return reconciliation updated",`${rp.return_pass_number} was verified by Logistics Manager; ${rp.gateway_pass_number} is ${gatewayReturnStatus}.`,"Return Pass",id,"Return Pass Register","Normal");
      return {returnPassId:id,status:finalStatus,gatewayReturnStatus};
    });
  }

  if(action==="thread-message"){
    assertRole(user,["Facility Manager","Procurement Manager","Admin"]);const threadId=positiveId(payload.threadId,"thread");const message=reason(payload.message);return sql.begin(async tx=>{const thread=(await tx<any[]>`SELECT * FROM collaboration_threads WHERE id=${threadId} FOR UPDATE`)[0];if(!thread)throw new Error("Shared thread not found.");if(user.role==="Facility Manager"&&Number(thread.facility_manager_user_id)!==user.id)throw new Error("This thread is not assigned to you.");if(user.role==="Procurement Manager"&&Number(thread.procurement_manager_user_id)!==user.id)throw new Error("This thread is not assigned to you.");const row=await tx<any[]>`INSERT INTO collaboration_messages (thread_id,sender_user_id,message_text,is_private,created_at) VALUES (${threadId},${user.id},${message},1,NOW()) RETURNING id`;await tx`UPDATE collaboration_threads SET updated_at=NOW() WHERE id=${threadId}`;const target=user.role==="Facility Manager"?Number(thread.procurement_manager_user_id):Number(thread.facility_manager_user_id);if(target)await notifyUser(tx,target,"New procurement thread message",message.slice(0,180),"Collaboration Thread",threadId,user.role==="Facility Manager"?"Utility Head / Facility Head Inbox":"Shared Thread with Procurement Manager");await evidence(tx,user,{action:"Shared Thread Message",entityType:"Collaboration Thread",entityId:threadId,after:{message_id:Number(row[0].id),message_length:message.length},note:"Private collaboration message recorded"});return {messageId:Number(row[0].id)};});
  }

  if(action==="availability-create"){
    assertRole(user,["Procurement Manager","Approver","Admin"]);const start=clean(payload.startDate,20);const end=clean(payload.endDate,20);if(!start||!end||end<start)throw new Error("Enter a valid away-date range.");const why=reason(payload.reason);const delegateId=payload.delegateUserId?positiveId(payload.delegateUserId,"delegate"):null;return sql.begin(async tx=>{const row=await tx<any[]>`INSERT INTO user_availability (user_id,role,status,away_start_date,away_end_date,reason,handover_note,recommended_delegate_role,recommended_delegate_user_id,urgency,admin_review_status,created_at,updated_at) VALUES (${user.id},${user.role},'Away Notice',${start},${end},${why},${clean(payload.handoverNote,1500)||null},${clean(payload.delegateRole,80)||null},${delegateId},${clean(payload.urgency,40)||'Normal'},'Pending',NOW(),NOW()) RETURNING id`;const id=Number(row[0].id);await evidence(tx,user,{action:"Availability Notice Submitted",entityType:"User Availability",entityId:id,entityReference:user.username,after:{away_start_date:start,away_end_date:end,delegate_user_id:delegateId,urgency:clean(payload.urgency,40)||'Normal'},note:why});await notifyRole(tx,"Admin","Availability / delegation request",`${user.fullName} submitted an away notice for ${start} to ${end}.`,"User Availability",id,"Availability & Delegation Requests","High");return {id};});
  }

  if(action==="close-request"){
    assertRole(user,["Procurement Manager","Admin"]);const id=positiveId(payload.requestId,"request");const note=reason(payload.note);return sql.begin(async tx=>{const r=(await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${id} FOR UPDATE`)[0];if(!r)throw new Error("Request not found.");if(user.role!=="Admin"&&r.assigned_procurement_manager_id&&Number(r.assigned_procurement_manager_id)!==user.id)throw new Error("This request is assigned to another Procurement Manager.");const paid=String(r.payment_status||"")==="Paid"||String(r.status||"")==="Paid"||Boolean(r.paid_at);if(!paid)throw new Error("Only a paid procurement can be closed.");await tx`UPDATE purchase_requests SET status='Closed',next_role=NULL,completed_at=COALESCE(completed_at,NOW()),completed_by_user_id=${user.id},updated_at=NOW() WHERE id=${id}`;if(r.linked_po_id)await tx`UPDATE purchase_orders SET status=CASE WHEN receiving_status='Fully Received' THEN 'Closed' ELSE status END,next_role=NULL,updated_at=NOW() WHERE id=${r.linked_po_id}`;await workflow(tx,user,"Purchase Request",id,"Post-Payment Closure","Closed",note);await evidence(tx,user,{action:"Post-Payment Closure",entityType:"Purchase Request",entityId:id,entityReference:r.request_no,before:{status:r.status,next_role:r.next_role},after:{status:"Closed",next_role:null},note});if(r.facility_manager_user_id)await notifyUser(tx,Number(r.facility_manager_user_id),"Procurement closed",`${r.request_no} has been completed and closed.`,"Purchase Request",id,"Approved / Accepted Requests");return {id,status:"Closed"};});
  }

  if(action==="invoice-create"){
    assertRole(user,["Finance","Admin"]);const invoiceNo=clean(payload.invoiceNo,120)||ref("INV");const poId=payload.poId?positiveId(payload.poId,"PO"):null;const requestId=payload.requestId?positiveId(payload.requestId,"request"):null;const vendorId=payload.vendorId?positiveId(payload.vendorId,"vendor"):null;const amount=money(payload.amount,"invoice amount");const tax=money(payload.taxAmount||0,"tax amount");const total=money(payload.totalAmount??amount+tax,"invoice total");const file=filePayload(payload.file);return sql.begin(async tx=>{const dup=await tx<any[]>`SELECT id FROM invoices WHERE lower(invoice_no)=lower(${invoiceNo}) LIMIT 1`;if(dup[0])throw new Error("An invoice with this number already exists.");const row=await tx<any[]>`INSERT INTO invoices (invoice_no,po_id,vendor_id,invoice_date,amount,tax_amount,total_amount,file_path,file_hash,match_status,status,uploaded_by,created_at,invoice_type,document_stage,supplier_invoice_no,due_date,payment_terms,billing_address,shipping_address,subtotal,discount_amount,balance_due,linked_request_id,approval_status,interface_mode) VALUES (${invoiceNo},${poId},${vendorId},${clean(payload.invoiceDate,20)||new Date().toISOString().slice(0,10)},${amount},${tax},${total},${file?.locator||null},${file?.checksum||null},${clean(payload.matchStatus,80)||'Pending Match'},${clean(payload.status,80)||'Finance Review'},${user.id},NOW(),${clean(payload.invoiceType,80)||'Supplier Invoice'},'Finance',${clean(payload.supplierInvoiceNo,120)||invoiceNo},${clean(payload.dueDate,20)||null},${clean(payload.paymentTerms,200)||null},${clean(payload.billingAddress,400)||null},${clean(payload.shippingAddress,400)||null},${money(payload.subtotal??amount,"subtotal")},${money(payload.discountAmount||0,"discount")},${money(payload.balanceDue??total,"balance due")},${requestId},'Pending', 'Next.js') RETURNING id`;const id=Number(row[0].id);await evidence(tx,user,{action:"Invoice Recorded",entityType:"Invoice",entityId:id,entityReference:invoiceNo,after:{po_id:poId,request_id:requestId,vendor_id:vendorId,total_amount:total,file_checksum:file?.checksum||null},note:clean(payload.note,1500)||"Invoice recorded by Finance"});return {invoiceId:id,invoiceNo};});
  }

  if(action==="expense-create"){
    assertRole(user,["Finance","Admin"]);const no=ref("EXP");const amount=money(payload.amount,"expense amount");const file=filePayload(payload.file);return sql.begin(async tx=>{const row=await tx<any[]>`INSERT INTO expenses (expense_no,expense_date,category,description,vendor_id,amount,payment_method,project_department,status,receipt_path,receipt_hash,receipt_no,invoice_no,tax_amount,linked_po_id,invoice_match_status,duplicate_warning,requested_by,approved_by,approved_at,notes,created_at,document_kind) VALUES (${no},${clean(payload.expenseDate,20)||new Date().toISOString().slice(0,10)},${clean(payload.category,120)||'Other'},${reason(payload.description)},${payload.vendorId?positiveId(payload.vendorId,"vendor"):null},${amount},${clean(payload.paymentMethod,80)||'Bank Transfer'},${clean(payload.departmentProject,180)||null},${clean(payload.status,80)||'Recorded'},${file?.locator||null},${file?.checksum||null},${clean(payload.receiptNo,120)||null},${clean(payload.invoiceNo,120)||null},${money(payload.taxAmount||0,"tax amount")},${payload.poId?positiveId(payload.poId,"PO"):null},${clean(payload.invoiceMatchStatus,80)||'Not Matched'},FALSE,${user.id},${clean(payload.status,80)==='Approved'?user.id:null},${clean(payload.status,80)==='Approved'?new Date().toISOString():null},${clean(payload.note,1500)||null},NOW(),${clean(payload.documentKind,80)||'Expense'}) RETURNING id`;const id=Number(row[0].id);await evidence(tx,user,{action:"Expense Recorded",entityType:"Expense",entityId:id,entityReference:no,after:{amount,category:clean(payload.category,120)||'Other',file_checksum:file?.checksum||null},note:clean(payload.note,1500)||"Finance expense recorded"});return {expenseId:id,expenseNo:no};});
  }

  if(action==="cash-advance-create"){
    assertRole(user,["Finance","Admin"]);const no=ref("ADV");const amount=money(payload.amount,"advance amount");return sql.begin(async tx=>{const row=await tx<any[]>`INSERT INTO cash_advances (advance_no,date_collected,employee_name,amount_collected,purpose,status,created_by,due_date,created_at) VALUES (${no},${clean(payload.dateCollected,20)||new Date().toISOString().slice(0,10)},${reason(payload.employeeName)},${amount},${reason(payload.purpose)},'Open',${user.id},${clean(payload.dueDate,20)||null},NOW()) RETURNING id`;const id=Number(row[0].id);await evidence(tx,user,{action:"Cash Advance Created",entityType:"Cash Advance",entityId:id,entityReference:no,after:{employee_name:clean(payload.employeeName,180),amount_collected:amount,due_date:clean(payload.dueDate,20)||null},note:clean(payload.note,1200)||"Cash advance issued"});return {advanceId:id,advanceNo:no};});
  }

  if(action==="cash-advance-expense"){
    assertRole(user,["Finance","Admin"]);const advanceId=positiveId(payload.advanceId,"cash advance");const amount=money(payload.amount,"expense amount");const file=filePayload(payload.file);return sql.begin(async tx=>{const adv=(await tx<any[]>`SELECT * FROM cash_advances WHERE id=${advanceId} FOR UPDATE`)[0];if(!adv)throw new Error("Cash advance not found.");if(String(adv.status||"")==='Closed')throw new Error("This cash advance is closed.");const row=await tx<any[]>`INSERT INTO advance_expenses (advance_id,spent_date,description,category,amount,receipt_path,receipt_hash,created_at) VALUES (${advanceId},${clean(payload.spentDate,20)||new Date().toISOString().slice(0,10)},${reason(payload.description)},${clean(payload.category,120)||'Other'},${amount},${file?.locator||null},${file?.checksum||null},NOW()) RETURNING id`;await evidence(tx,user,{action:"Cash Advance Expense Added",entityType:"Cash Advance",entityId:advanceId,entityReference:adv.advance_no,after:{advance_expense_id:Number(row[0].id),amount,file_checksum:file?.checksum||null},note:clean(payload.note,1200)||"Advance expenditure recorded"});return {id:Number(row[0].id)};});
  }

  if(action==="cash-advance-close"){
    assertRole(user,["Finance","Admin"]);const advanceId=positiveId(payload.advanceId,"cash advance");const note=reason(payload.note);return sql.begin(async tx=>{const adv=(await tx<any[]>`SELECT ca.*,COALESCE((SELECT SUM(amount) FROM advance_expenses WHERE advance_id=ca.id),0) spent FROM cash_advances ca WHERE ca.id=${advanceId} FOR UPDATE`)[0];if(!adv)throw new Error("Cash advance not found.");await tx`UPDATE cash_advances SET status='Closed',approved_by=${user.id},approved_at=NOW() WHERE id=${advanceId}`;await evidence(tx,user,{action:"Cash Advance Closed",entityType:"Cash Advance",entityId:advanceId,entityReference:adv.advance_no,before:{status:adv.status},after:{status:"Closed",spent_amount:Number(adv.spent||0),balance:Number(adv.amount_collected||0)-Number(adv.spent||0)},note});return {advanceId,status:"Closed"};});
  }

  if(action==="document-upload"){
    const file=filePayload(payload.file);if(!file)throw new Error("Choose a file to upload.");const docType=clean(payload.documentType,120)||"Supporting Document";const title=clean(payload.title,180)||file.fileName;const note=clean(payload.note,1200)||null;const context=clean(payload.context,60)||"procurement";const entityId=payload.entityId?positiveId(payload.entityId,"linked record"):null;
    if(context==="logistics")assertRole(user,["Logistics Officer","Procurement Manager","Admin"]);else if(context==="vendor")assertRole(user,["Procurement Manager","Admin"]);else if(context==="receipt")assertRole(user,["Finance","Admin"]);else assertRole(user,["Facility Manager","Procurement Manager","Finance","Admin"]);
    return sql.begin(async tx=>{let id=0;let source="Imported Document";
      if(context==="logistics"){const row=await tx<any[]>`INSERT INTO logistics_documents (related_entity_type,related_entity_id,po_id,gateway_pass_id,document_type,file_name,file_path,notes,uploaded_by,created_at) VALUES (${clean(payload.relatedEntityType,80)||'Purchase Order'},${entityId},${payload.poId?positiveId(payload.poId,"PO"):null},${payload.gatewayPassId?positiveId(payload.gatewayPassId,"gateway pass"):null},${docType},${file.fileName},${file.locator},${note},${user.id},NOW()) RETURNING id`;id=Number(row[0].id);source="Logistics Document";}
      else if(context==="vendor"){const vendorId=positiveId(payload.vendorId||entityId,"vendor");const row=await tx<any[]>`INSERT INTO vendor_documents (vendor_id,title,document_type,file_path,file_hash,notes,uploaded_by,created_at) VALUES (${vendorId},${title},${docType},${file.locator},${file.checksum},${note},${user.id},NOW()) RETURNING id`;id=Number(row[0].id);source="Vendor Document";}
      else if(context==="receipt"){const no=clean(payload.receiptNo,120)||ref("REC");const row=await tx<any[]>`INSERT INTO receipt_records (receipt_no,receipt_type,payment_method,payment_date,vendor_id,payee_name,amount,currency,purpose,department_project,linked_invoice_id,linked_payment_id,linked_po_id,status,file_path,file_hash,notes,uploaded_by,created_at,updated_at,document_category,request_id,payment_id,original_file_name,mime_type,file_size_bytes,file_checksum,ocr_status,discrepancy_status,interface_mode) VALUES (${no},${docType},${clean(payload.paymentMethod,80)||null},${clean(payload.paymentDate,20)||new Date().toISOString().slice(0,10)},${payload.vendorId?positiveId(payload.vendorId,"vendor"):null},${clean(payload.payeeName,180)||null},${money(payload.amount||0,"receipt amount")},${clean(payload.currency,12)||'NGN'},${clean(payload.purpose,400)||null},${clean(payload.departmentProject,180)||null},${payload.invoiceId?positiveId(payload.invoiceId,"invoice"):null},${payload.paymentId?positiveId(payload.paymentId,"payment"):null},${payload.poId?positiveId(payload.poId,"PO"):null},'Recorded',${file.locator},${file.checksum},${note},${user.id},NOW(),NOW(),${docType},${payload.requestId?positiveId(payload.requestId,"request"):null},${payload.paymentId?positiveId(payload.paymentId,"payment"):null},${file.fileName},${file.mimeType},${file.bytes},${file.checksum},'Not Processed','None','Next.js') RETURNING id`;id=Number(row[0].id);source="Receipt";}
      else {const row=await tx<any[]>`INSERT INTO imported_legacy_documents (source_zip_name,original_path,file_name,file_path,file_hash,document_type,department_project,title,likely_date,likely_vendor,total_amount,import_status,confidence,linked_request_id,duplicate_warning,imported_by,created_at,updated_at,assigned_procurement_manager_id,facility_manager_user_id) VALUES ('Next.js Upload',${file.fileName},${file.fileName},${file.locator},${file.checksum},${docType},${clean(payload.departmentProject,180)||null},${title},${clean(payload.likelyDate,20)||null},${clean(payload.likelyVendor,180)||null},${money(payload.totalAmount||0,"document total")},'Imported',1,FALSE,${entityId},FALSE,${user.id},NOW(),NOW(),${user.role==='Procurement Manager'?user.id:null},${user.role==='Facility Manager'?user.id:null}) RETURNING id`;id=Number(row[0].id);}
      await evidence(tx,user,{action:"Document Uploaded",entityType:source,entityId:id,entityReference:title,after:{document_type:docType,file_name:file.fileName,file_size_bytes:file.bytes,file_checksum:file.checksum,linked_entity_id:entityId},note:note||"Document stored in the GCP-free Neon document register"});return {documentId:id,sourceType:source};});
  }

  if(action==="notification-read"){
    const id=payload.notificationId?positiveId(payload.notificationId,"notification"):null; if(id)await sql`UPDATE notifications SET is_read=TRUE,popup_shown=TRUE WHERE id=${id} AND (user_id=${user.id} OR (user_id IS NULL AND role=${user.role}))`;else await sql`UPDATE notifications SET is_read=TRUE,popup_shown=TRUE WHERE user_id=${user.id} OR (user_id IS NULL AND role=${user.role})`;return {ok:true};
  }

  throw new Error("Unsupported ProcureFlow parity action.");
}

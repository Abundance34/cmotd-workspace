import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { runParityAction } from "@/lib/procureflow/parity-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 3_000_000;

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

async function genericImportUpload(user:any,payload:any){
  if(!["Facility Manager","Procurement Manager","Finance","Admin"].includes(user.role)) throw new Error("You do not have permission to import procurement documents.");
  const input=payload?.file||{};
  const normalized=String(input.base64||"").replace(/^data:[^;]+;base64,/,"").replace(/\s+/g,"");
  const bytes=Buffer.from(normalized,"base64");
  if(!bytes.length) throw new Error("Choose a file to upload.");
  if(bytes.length>MAX_FILE_BYTES) throw new Error("Keep individual imported files below 3 MB.");
  const mimeType=clean(input.mimeType,120)||"application/octet-stream";
  const fileName=clean(input.fileName,180)||"document";
  const checksum=createHash("sha256").update(bytes).digest("hex");
  const locator=`data:${mimeType};base64,${bytes.toString("base64")}`;
  const documentType=clean(payload.documentType,120)||"Supporting Document";
  const title=clean(payload.title,180)||fileName;
  const requestedDepartment=clean(payload.departmentProject,180)||null;
  const entityId=payload.entityId?Number(payload.entityId):null;
  if(entityId!==null && (!Number.isInteger(entityId)||entityId<=0)) throw new Error("Choose a valid linked procurement request.");
  const total=Number(payload.totalAmount||0);
  const note=clean(payload.note,1500)||"Procurement document uploaded.";
  const sql=db();

  return sql.begin(async tx=>{
    let linkedRequest:any=null;
    if(entityId){
      const requestRows=await tx<any[]>`
        SELECT id,request_no,requested_by,facility_manager_user_id,assigned_procurement_manager_id,next_role,
               department_project,status,payment_status,attachments_json
        FROM purchase_requests WHERE id=${entityId} FOR UPDATE
      `;
      linkedRequest=requestRows[0];
      if(!linkedRequest) throw new Error("The linked procurement request does not exist.");
      if(user.role==="Facility Manager" && Number(linkedRequest.requested_by)!==user.id && Number(linkedRequest.facility_manager_user_id)!==user.id){
        throw new Error("You can link documents only to your own Utility / Facility requests.");
      }
      if(user.role==="Procurement Manager" && Number(linkedRequest.requested_by)!==user.id && Number(linkedRequest.assigned_procurement_manager_id)!==user.id && String(linkedRequest.next_role||"")!=="procurement_manager"){
        throw new Error("You can link documents only to requests assigned to your Procurement workspace.");
      }
      if(user.role==="Finance"){
        const financeVisible=String(linkedRequest.next_role||"")==="finance" || ["Approved","Awaiting Payment","Approved for Payment","Paid","Completed","Closed"].includes(String(linkedRequest.status||"")) || ["Approved for Payment","Paid"].includes(String(linkedRequest.payment_status||""));
        if(!financeVisible) throw new Error("Finance can link documents only to approved or Finance-routed procurement requests.");
      }
      const duplicate=await tx<any[]>`SELECT id FROM imported_legacy_documents WHERE linked_request_id=${entityId} AND file_hash=${checksum} ORDER BY id DESC LIMIT 1`;
      if(duplicate[0]) throw new Error(`${fileName} is already attached to ${linkedRequest.request_no}.`);
    }

    const department=requestedDepartment||linkedRequest?.department_project||null;
    const rows=await tx<any[]>`
      INSERT INTO imported_legacy_documents (
        source_zip_name,original_path,file_name,file_path,file_hash,document_type,department_project,title,
        likely_date,likely_vendor,total_amount,import_status,confidence,linked_request_id,duplicate_warning,
        imported_by,created_at,updated_at,assigned_procurement_manager_id,facility_manager_user_id
      ) VALUES (
        'Next.js Upload',${fileName},${fileName},${locator},${checksum},${documentType},${department},${title},
        ${payload.likelyDate||null},${payload.likelyVendor||null},${Number.isFinite(total)?total:0},'Imported',1,
        ${entityId},FALSE,${user.id},NOW(),NOW(),
        ${linkedRequest?.assigned_procurement_manager_id ?? (user.role==='Procurement Manager'?user.id:null)},
        ${linkedRequest?.facility_manager_user_id ?? (user.role==='Facility Manager'?user.id:null)}
      ) RETURNING id,created_at`;
    const id=Number(rows[0].id);
    const downloadUrl=`/api/parity/document?source=${encodeURIComponent("Imported Document")}&id=${id}`;

    if(linkedRequest){
      const existing=Array.isArray(linkedRequest.attachments_json)?linkedRequest.attachments_json:[];
      const attachment={documentId:id,sourceType:"Imported Document",fileName,mimeType,fileSizeBytes:bytes.length,checksum,documentType,title,downloadUrl,uploadedAt:new Date().toISOString()};
      await tx`UPDATE purchase_requests SET attachments_json=${tx.json([...existing,attachment])},updated_at=NOW() WHERE id=${entityId}`;
    }

    await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},'Document Uploaded','Imported Document',${id},${`Imported ${title}`},${note},'workflow',${linkedRequest?.assigned_procurement_manager_id||null},NOW())`;
    await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES ('DOCUMENT_UPLOADED','Imported Document',${String(id)},${user.id},${user.role},${note},${tx.json({})},${tx.json({document_type:documentType,file_name:fileName,file_size_bytes:bytes.length,file_checksum:checksum,linked_request_id:entityId,linked_request_no:linkedRequest?.request_no||null})},NOW(),CURRENT_DATE,TO_CHAR(NOW(),'HH24:MI:SS'),${note})`;
    await appendAuditEvent(tx,{action:"Document Uploaded",entityType:"Imported Document",entityId:id,entityReference:title,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:{},afterValues:{document_type:documentType,file_name:fileName,file_size_bytes:bytes.length,file_checksum:checksum,linked_request_id:entityId,linked_request_no:linkedRequest?.request_no||null},reasonOrComment:note,source:"nextjs"});
    return {documentId:id,sourceType:"Imported Document",linkedRequestId:entityId,linkedRequestNo:linkedRequest?.request_no||null,fileName,mimeType,fileSizeBytes:bytes.length,checksum,downloadUrl};
  });
}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Authentication required."},{status:401});
  const body=await request.json().catch(()=>({}));
  const action=String(body.action||"");
  try{
    if(action!=="notification-read"){
      const verified=await verifyActiveAuditSigningKey().catch(()=>false);
      if(!verified) return NextResponse.json({error:"ProcureFlow writes are locked until the v2 audit signing key verifies."},{status:503});
    }
    const result=action==="document-upload" && !["logistics","vendor","receipt"].includes(String(body.payload?.context||"procurement"))
      ? await genericImportUpload(user,body.payload||{})
      : await runParityAction(user,action,body.payload||{});
    return NextResponse.json({ok:true,result});
  }catch(error){
    const message=error instanceof Error?error.message:"Unable to complete ProcureFlow action.";
    const status=/only to your own|assigned to your Procurement|Finance can link|permission/i.test(message)?403:400;
    return NextResponse.json({error:message},{status});
  }
}

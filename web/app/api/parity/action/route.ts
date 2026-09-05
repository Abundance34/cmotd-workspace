import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { runParityAction } from "@/lib/procureflow/parity-actions";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";

async function genericImportUpload(user:any,payload:any){
  if(!["Facility Manager","Procurement Manager","Finance","Admin"].includes(user.role)) throw new Error("You do not have permission to import procurement documents.");
  const input=payload?.file||{}; const normalized=String(input.base64||"").replace(/^data:[^;]+;base64,/,"").replace(/\s+/g,""); const bytes=Buffer.from(normalized,"base64");
  if(!bytes.length)throw new Error("Choose a file to upload."); if(bytes.length>3_000_000)throw new Error("Keep individual imported files below 3 MB.");
  const mimeType=String(input.mimeType||"application/octet-stream").slice(0,120); const fileName=String(input.fileName||"document").trim().slice(0,180); const checksum=createHash("sha256").update(bytes).digest("hex"); const locator=`data:${mimeType};base64,${bytes.toString("base64")}`;
  const documentType=String(payload.documentType||"Supporting Document").trim().slice(0,120); const title=String(payload.title||fileName).trim().slice(0,180); const department=String(payload.departmentProject||"").trim().slice(0,180)||null; const entityId=payload.entityId?Number(payload.entityId):null; const total=Number(payload.totalAmount||0); const sql=db();
  return sql.begin(async tx=>{const rows=await tx<any[]>`
    INSERT INTO imported_legacy_documents (
      source_zip_name,original_path,file_name,file_path,file_hash,document_type,department_project,title,
      likely_date,likely_vendor,total_amount,import_status,confidence,linked_request_id,duplicate_warning,
      imported_by,created_at,updated_at,assigned_procurement_manager_id,facility_manager_user_id
    ) VALUES (
      'Next.js Upload',${fileName},${fileName},${locator},${checksum},${documentType},${department},${title},
      ${payload.likelyDate||null},${payload.likelyVendor||null},${Number.isFinite(total)?total:0},'Imported',1,
      ${entityId},FALSE,${user.id},NOW(),NOW(),${user.role==='Procurement Manager'?user.id:null},${user.role==='Facility Manager'?user.id:null}
    ) RETURNING id`;
    const id=Number(rows[0].id); await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},'Document Uploaded','Imported Document',${id},${`Imported ${title}`},${payload.note||null},'workflow',NULL,NOW())`;
    await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES ('DOCUMENT_UPLOADED','Imported Document',${String(id)},${user.id},${user.role},${payload.note||'Document imported'},${tx.json({})},${tx.json({document_type:documentType,file_name:fileName,file_size_bytes:bytes.length,file_checksum:checksum,linked_request_id:entityId})},NOW(),CURRENT_DATE,TO_CHAR(NOW(),'HH24:MI:SS'),${payload.note||null})`;
    await appendAuditEvent(tx,{action:"Document Uploaded",entityType:"Imported Document",entityId:id,entityReference:title,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:{},afterValues:{document_type:documentType,file_name:fileName,file_size_bytes:bytes.length,file_checksum:checksum,linked_request_id:entityId},reasonOrComment:String(payload.note||"Document stored in the GCP-free Neon document register"),source:"nextjs"}); return {documentId:id,sourceType:"Imported Document"};});
}

export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const body=await request.json().catch(()=>({})); const action=String(body.action||"");
  try{
    if(action!=="notification-read"){
      const verified=await verifyActiveAuditSigningKey().catch(()=>false); if(!verified)return NextResponse.json({error:"ProcureFlow writes are locked until the v2 audit signing key verifies."},{status:503});
    }
    const result=action==="document-upload" && !["logistics","vendor","receipt"].includes(String(body.payload?.context||"procurement"))
      ? await genericImportUpload(user,body.payload||{})
      : await runParityAction(user,action,body.payload||{});
    return NextResponse.json({ok:true,result});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to complete ProcureFlow action."},{status:400});}
}

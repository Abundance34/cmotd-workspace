import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 3_000_000;
function clean(value:unknown,max=500){return String(value??"").trim().replace(/\s+/g," ").slice(0,max);}

export async function POST(request:Request){
  try{
    const user=await getCurrentUser();
    if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
    if(user.role!=="Logistics Officer"&&user.role!=="Admin")return NextResponse.json({error:"Logistics Officer access is required."},{status:403});
    const auditReady=await verifyActiveAuditSigningKey().catch(()=>false);
    if(!auditReady)return NextResponse.json({error:"ProcureFlow writes are locked until the active v2 audit signing key verifies."},{status:503});
    const body=await request.json().catch(()=>null) as any;
    const slipId=Number(body?.slipId);if(!Number.isInteger(slipId)||slipId<=0)return NextResponse.json({error:"A valid receiving slip is required."},{status:400});
    const input=body?.file||{};const normalized=String(input.base64||"").replace(/^data:[^;]+;base64,/,"").replace(/\s+/g,"");const bytes=Buffer.from(normalized,"base64");
    if(!bytes.length)return NextResponse.json({error:"Choose a proof-of-delivery file."},{status:400});
    if(bytes.length>MAX_FILE_BYTES)return NextResponse.json({error:"Keep the proof-of-delivery file below 3 MB."},{status:400});
    const fileName=clean(input.fileName,180)||`proof-${slipId}`;const mimeType=clean(input.mimeType,120)||"application/octet-stream";const checksum=createHash("sha256").update(bytes).digest("hex");const locator=`data:${mimeType};base64,${bytes.toString("base64")}`;const note=clean(body?.note,1200)||"Proof of delivery attached to Logistics receiving slip.";const sql=db();
    const result=await sql.begin(async tx=>{
      const rows=await tx<any[]>`SELECT rs.id,rs.slip_no,rs.po_id,rs.proof_of_delivery_path,po.po_no,po.request_id,pr.request_no,pr.facility_manager_user_id FROM receiving_slips rs JOIN purchase_orders po ON po.id=rs.po_id LEFT JOIN purchase_requests pr ON pr.id=po.request_id WHERE rs.id=${slipId} FOR UPDATE OF rs,po`;
      const row=rows[0];if(!row)throw new Error("Receiving slip not found.");
      await tx`UPDATE receiving_slips SET proof_of_delivery_path=${locator},attachment_path=${locator},updated_at=NOW() WHERE id=${slipId}`;
      const documentRows=await tx<any[]>`INSERT INTO logistics_documents (related_entity_type,related_entity_id,po_id,gateway_pass_id,document_type,file_name,file_path,notes,uploaded_by,created_at) VALUES ('Receiving Slip',${slipId},${row.po_id},NULL,'Proof of Delivery',${fileName},${locator},${note},${user.id},NOW()) RETURNING id`;
      const documentId=Number(documentRows[0].id);
      await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},'Proof of Delivery Attached','Receiving Slip',${slipId},${`Proof of delivery attached — ${row.slip_no}`},${note},'workflow',${row.facility_manager_user_id||null},NOW())`;
      await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES ('PROOF_OF_DELIVERY_ATTACHED','Receiving Slip',${String(slipId)},${user.id},${user.role},${note},${tx.json({proof_of_delivery:Boolean(row.proof_of_delivery_path)})},${tx.json({proof_of_delivery:true,file_name:fileName,mime_type:mimeType,file_size_bytes:bytes.length,file_checksum:checksum,logistics_document_id:documentId})},NOW(),CURRENT_DATE,TO_CHAR(NOW(),'HH24:MI:SS'),${note})`;
      await appendAuditEvent(tx,{action:"Proof of Delivery Attached",entityType:"Receiving Slip",entityId:slipId,entityReference:row.slip_no,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:{proof_of_delivery:Boolean(row.proof_of_delivery_path)},afterValues:{proof_of_delivery:true,file_name:fileName,mime_type:mimeType,file_size_bytes:bytes.length,file_checksum:checksum,logistics_document_id:documentId},metadata:{po_id:Number(row.po_id),po_no:row.po_no,request_id:row.request_id?Number(row.request_id):null,request_no:row.request_no},reasonOrComment:note,source:"nextjs"});
      return {slipId,slipNo:row.slip_no,documentId,fileName,checksum};
    });
    return NextResponse.json({ok:true,result});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to attach proof of delivery."},{status:400});}
}

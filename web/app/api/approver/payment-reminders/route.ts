import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request){
  try{
    const user=await getCurrentUser();
    if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
    if(user.role!=="Approver"&&user.role!=="Admin")return NextResponse.json({error:"Approver / MD access is required."},{status:403});
    if(!await verifyActiveAuditSigningKey().catch(()=>false))return NextResponse.json({error:"ProcureFlow writes are locked because the active v2 audit signing key is not verified."},{status:503});
    const body=await request.json().catch(()=>({})),requestId=Number(body?.requestId),note=String(body?.note||"").trim().slice(0,1500);
    if(!Number.isInteger(requestId)||requestId<=0)return NextResponse.json({error:"A valid requestId is required."},{status:400});
    const sql=db();
    const result=await sql.begin(async tx=>{
      const row=(await tx<any[]>`SELECT id,request_no,status,payment_status,next_role,estimated_amount,department_project FROM purchase_requests WHERE id=${requestId} FOR UPDATE`)[0];
      if(!row)throw new Error("Request not found.");
      if(["Paid","Completed","Closed"].includes(String(row.status||""))||String(row.payment_status||"")==="Paid")throw new Error("This request has already been paid.");
      const ready=row.next_role==="finance"||String(row.payment_status||"")==="Approved for Payment"||["Approved","Awaiting Payment","Approved for Payment","Payment Approved","PO Created"].includes(String(row.status||""));
      if(!ready)throw new Error("Only an approved request waiting for Finance can receive a payment reminder.");
      const now=new Date().toISOString(),message=note||`Approver / MD reminder: ${row.request_no} is approved and still awaiting Finance payment.`;
      await tx`INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at) VALUES (NULL,'Finance','Payment reminder from Approver / MD',${message},'Purchase Request',${requestId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Open Approved for Payment','Approved for Payment',${now})`;
      await tx`INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at) VALUES ('Purchase Request',${requestId},'Payment Reminder Sent',${row.status||null},${message},${user.id},${now})`;
      await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},'PAYMENT_REMINDER_SENT','Purchase Request',${requestId},${`${row.request_no} payment reminder sent to Finance`},${message},'workflow',NULL,${now})`;
      await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,amount,department,notes) VALUES ('PAYMENT_REMINDER_SENT','Purchase Request',${String(requestId)},${user.id},${user.role},${message},${tx.json({status:row.status,payment_status:row.payment_status,next_role:row.next_role})},${tx.json({reminder_sent_to:"Finance",reminder_at:now})},${now},${now.slice(0,10)},${now.slice(11,19)},${Number(row.estimated_amount||0)},${row.department_project},${message})`;
      await appendAuditEvent(tx,{action:"PAYMENT_REMINDER_SENT",entityType:"Purchase Request",entityId:requestId,entityReference:row.request_no,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:{status:row.status,payment_status:row.payment_status,next_role:row.next_role},afterValues:{reminder_sent_to:"Finance",reminder_at:now},metadata:{amount:Number(row.estimated_amount||0),department:row.department_project},reasonOrComment:message,severity:"Normal",source:"nextjs"});
      return {requestId,requestNo:row.request_no,sentAt:now};
    });
    return NextResponse.json({ok:true,result});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to send Finance reminder."},{status:400});}
}

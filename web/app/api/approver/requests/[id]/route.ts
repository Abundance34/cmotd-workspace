import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  try{
    const user=await getCurrentUser();
    if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
    if(user.role!=="Approver"&&user.role!=="Admin")return NextResponse.json({error:"Approver / MD access is required."},{status:403});
    const {id}=await context.params,requestId=Number(id);
    if(!Number.isInteger(requestId)||requestId<=0)return NextResponse.json({error:"A valid request id is required."},{status:400});
    const sql=db();
    const requestRows=await sql<any[]>`
      SELECT pr.*,requester.full_name requester_name,requester.role requester_role,
             fm.full_name facility_manager_name,pm.full_name procurement_manager_name,au.full_name approved_by_name
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id=pr.requested_by
      LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
      LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id
      LEFT JOIN users au ON au.id=pr.approved_by_user_id
      WHERE pr.id=${requestId} LIMIT 1`;
    const record=requestRows[0];
    if(!record)return NextResponse.json({error:"Request not found."},{status:404});
    const [items,workflow,approvals,payees,sourcing,quotes,pos,poItems,payments,receipts,documents]=await Promise.all([
      sql<any[]>`SELECT id,item_name,description,quantity,unit_price,total,category,suggested_vendor,created_at FROM purchase_request_items WHERE request_id=${requestId} ORDER BY id`,
      sql<any[]>`SELECT we.id,we.event,we.status,we.note,we.user_id,u.full_name user_name,u.role user_role,we.created_at FROM workflow_events we LEFT JOIN users u ON u.id=we.user_id WHERE we.entity_type='Purchase Request' AND we.entity_id=${requestId} ORDER BY we.created_at,we.id`,
      sql<any[]>`SELECT ah.id,ah.action,ah.status_before,ah.status_after,ah.reason,ah.note,ah.approved_by_role,ah.approval_mode,ah.created_at,u.full_name approved_by_name FROM approval_history ah LEFT JOIN users u ON u.id=COALESCE(ah.approved_by_user_id,ah.user_id) WHERE ah.entity_type='Purchase Request' AND ah.entity_id=${requestId} ORDER BY ah.created_at,ah.id`,
      sql<any[]>`SELECT id,payee_type,payee_name_masked,account_name_masked,bank_name_masked,account_number_last4,currency,recipient_known,payment_readiness_status,verification_status,confirmed_at,verified_at,updated_at FROM payment_payee_details WHERE purchase_request_id=${requestId} AND COALESCE(is_current,TRUE)=TRUE ORDER BY updated_at DESC,id DESC LIMIT 1`,
      sql<any[]>`SELECT st.*,v.name recommended_vendor_name FROM sourcing_tasks st LEFT JOIN vendors v ON v.id=st.recommended_vendor_id WHERE st.request_id=${requestId} ORDER BY COALESCE(st.updated_at,st.created_at) DESC,st.id DESC`,
      sql<any[]>`SELECT vq.*,v.name registry_vendor_name FROM vendor_quotes vq JOIN sourcing_tasks st ON st.id=vq.sourcing_task_id LEFT JOIN vendors v ON v.id=vq.vendor_id WHERE st.request_id=${requestId} ORDER BY vq.created_at DESC,vq.id DESC`,
      sql<any[]>`SELECT po.*,v.name vendor_name,creator.full_name created_by_name,approver.full_name approved_by_name FROM purchase_orders po LEFT JOIN vendors v ON v.id=po.vendor_id LEFT JOIN users creator ON creator.id=po.created_by LEFT JOIN users approver ON approver.id=po.approved_by WHERE po.request_id=${requestId} ORDER BY COALESCE(po.updated_at,po.created_at) DESC,po.id DESC`,
      sql<any[]>`SELECT poi.id,poi.po_id,poi.item_name,poi.description,poi.category,poi.quantity,poi.unit_price,poi.total,poi.created_at FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE po.request_id=${requestId} ORDER BY poi.po_id,poi.id`,
      sql<any[]>`SELECT p.*,paid.full_name paid_by_name,creator.full_name created_by_name FROM payments p LEFT JOIN users paid ON paid.id=p.paid_by LEFT JOIN users creator ON creator.id=p.created_by WHERE p.request_id=${requestId} ORDER BY COALESCE(p.updated_at,p.created_at) DESC,p.id DESC`,
      sql<any[]>`SELECT rr.id,rr.receipt_no,rr.receipt_type,rr.payment_method,rr.payment_date,rr.amount,rr.currency,rr.status,rr.original_file_name,rr.transfer_reference,rr.discrepancy_status,rr.ocr_status,rr.created_at FROM receipt_records rr WHERE rr.request_id=${requestId} ORDER BY rr.created_at DESC,rr.id DESC`,
      sql<any[]>`SELECT id,file_name,document_type,title,department_project,import_status status,created_at FROM imported_legacy_documents WHERE linked_request_id=${requestId} ORDER BY created_at DESC,id DESC`
    ]);
    const threadRows=await sql<any[]>`
      SELECT ct.id,ct.entity_type,ct.entity_id,ct.facility_manager_user_id,ct.procurement_manager_user_id,ct.visibility_scope,ct.created_at,ct.updated_at
      FROM collaboration_threads ct WHERE ct.entity_type='Purchase Request' AND ct.entity_id=${requestId}
      ORDER BY COALESCE(ct.updated_at,ct.created_at) DESC,ct.id DESC LIMIT 1`;
    const thread=threadRows[0]||null;
    const messages=thread?await sql<any[]>`
      SELECT cm.id,cm.thread_id,cm.sender_user_id,cm.message_text,cm.created_at,u.full_name sender_name,u.role sender_role
      FROM collaboration_messages cm LEFT JOIN users u ON u.id=cm.sender_user_id WHERE cm.thread_id=${Number(thread.id)}
      ORDER BY cm.created_at,cm.id LIMIT 500`:[];

    const poMap=new Map<number,any[]>();
    for(const x of poItems){const k=Number(x.po_id),list=poMap.get(k)||[];list.push({...x,id:Number(x.id),quantity:Number(x.quantity||0),unit_price:Number(x.unit_price||0),total:Number(x.total||0)});poMap.set(k,list);}
    const payee=payees[0]||null;
    return NextResponse.json({
      ok:true,request:{...record,id:Number(record.id),estimated_amount:Number(record.estimated_amount||0)},
      items:items.map(x=>({...x,id:Number(x.id),quantity:Number(x.quantity||0),unit_price:Number(x.unit_price||0),total:Number(x.total||0)})),
      workflow:workflow.map(x=>({...x,id:Number(x.id)})),approvals:approvals.map(x=>({...x,id:Number(x.id)})),
      payee:payee?{...payee,id:Number(payee.id),account_number_masked:payee.account_number_last4?`******${payee.account_number_last4}`:"Pending"}:null,
      sourcing:sourcing.map(x=>({...x,id:Number(x.id)})),
      quotes:quotes.map(x=>({...x,id:Number(x.id),quoted_amount:Number(x.quotation_total??x.quoted_amount??0)})),
      purchaseOrders:pos.map(x=>({...x,id:Number(x.id),total_amount:Number(x.total_amount||0),items:poMap.get(Number(x.id))||[]})),
      payments:payments.map(x=>({...x,id:Number(x.id),amount:Number(x.amount||0)})),
      receipts:receipts.map(x=>({...x,id:Number(x.id),amount:Number(x.amount||0)})),
      documents:documents.map(x=>({...x,id:Number(x.id)})),
      threadMessages:messages.map(x=>({...x,id:Number(x.id),thread_id:Number(x.thread_id)}))
    },{headers:{"Cache-Control":"private, no-store, max-age=0"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to load request detail."},{status:500,headers:{"Cache-Control":"private, no-store, max-age=0"}});
  }
}

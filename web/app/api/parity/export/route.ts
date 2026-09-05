import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvText, simplePdf } from "@/lib/procureflow/simple-pdf";

export const runtime = "nodejs";

function safeName(value:string){return value.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"")||"procureflow-export";}
function pdfLines(rows:Record<string,unknown>[], limit=250){return rows.slice(0,limit).flatMap((row,index)=>[`${index+1}. ${Object.entries(row).map(([k,v])=>`${k}: ${v??""}`).join(" | ")}`]);}

async function rowsFor(kind:string,id:number|null,user:any){
  const sql=db();
  if(kind==="payments"||kind==="payment"){
    if(!["Finance","Admin","Auditor","Procurement Manager","Approver"].includes(user.role))throw new Error("Payment exports are not available to this role.");
    if(id){return sql<any[]>`
      SELECT p.payment_no,pr.request_no,po.po_no,v.name vendor,p.amount,p.currency,p.status,p.verification_status,p.payment_method,p.transfer_type,p.payment_reference,p.payment_date,p.finance_note,
             ppd.payee_type,ppd.payee_name_masked,ppd.account_name_masked,ppd.bank_name_masked,ppd.account_number_last4,ppd.payment_readiness_status,ppd.verification_status payee_verification
      FROM payments p LEFT JOIN purchase_requests pr ON pr.id=p.request_id LEFT JOIN purchase_orders po ON po.id=p.po_id LEFT JOIN vendors v ON v.id=p.vendor_id
      LEFT JOIN payment_payee_details ppd ON ppd.id=p.payee_detail_id WHERE p.id=${id} LIMIT 1`;}
    return sql<any[]>`SELECT p.payment_no,pr.request_no,po.po_no,v.name vendor,p.amount,p.currency,p.status,p.verification_status,p.payment_method,p.transfer_type,p.payment_reference,p.payment_date FROM payments p LEFT JOIN purchase_requests pr ON pr.id=p.request_id LEFT JOIN purchase_orders po ON po.id=p.po_id LEFT JOIN vendors v ON v.id=p.vendor_id ORDER BY COALESCE(p.updated_at,p.created_at) DESC LIMIT 1000`;
  }
  if(kind==="invoices"){
    if(!["Finance","Admin","Auditor","Procurement Manager","Approver"].includes(user.role))throw new Error("Invoice exports are not available to this role.");
    return sql<any[]>`SELECT i.invoice_no,i.supplier_invoice_no,po.po_no,pr.request_no,v.name vendor,i.invoice_date,i.due_date,i.amount,i.tax_amount,i.total_amount,i.balance_due,i.status,i.match_status,i.approval_status FROM invoices i LEFT JOIN purchase_orders po ON po.id=i.po_id LEFT JOIN purchase_requests pr ON pr.id=COALESCE(i.linked_request_id,po.request_id) LEFT JOIN vendors v ON v.id=i.vendor_id ORDER BY i.created_at DESC LIMIT 1000`;
  }
  if(kind==="expenses"){
    if(!["Finance","Admin","Auditor"].includes(user.role))throw new Error("Expense exports are not available to this role.");
    return sql<any[]>`SELECT e.expense_no,e.expense_date,e.category,e.description,v.name vendor,e.amount,e.tax_amount,e.payment_method,e.project_department,e.status,e.receipt_no,e.invoice_no,po.po_no,e.invoice_match_status FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN purchase_orders po ON po.id=e.linked_po_id ORDER BY e.created_at DESC LIMIT 1000`;
  }
  if(kind==="purchase-orders"||kind==="pos"){
    if(!["Procurement Manager","Finance","Approver","Admin","Auditor","Logistics Officer"].includes(user.role))throw new Error("PO exports are not available to this role.");
    return sql<any[]>`SELECT po.po_no,pr.request_no,v.name vendor,po.po_date,po.expected_delivery_date,po.total_amount,po.status,po.payment_status,po.receiving_status,po.logistics_status,po.sent_to_vendor_date FROM purchase_orders po LEFT JOIN purchase_requests pr ON pr.id=po.request_id LEFT JOIN vendors v ON v.id=po.vendor_id ORDER BY COALESCE(po.updated_at,po.created_at) DESC LIMIT 1000`;
  }
  if(kind==="vendors"){
    if(!["Procurement Manager","Finance","Approver","Admin","Auditor"].includes(user.role))throw new Error("Vendor exports are not available to this role.");
    return sql<any[]>`SELECT name,category,phone,email,address,tax_id,rating,completed_orders,total_spend,average_delivery_time,rejection_count,last_purchase_date,status FROM vendors ORDER BY name LIMIT 1000`;
  }
  if(kind==="gateway-passes"){
    if(!["Facility Manager","Procurement Manager","Approver","Admin","Auditor","Logistics Officer"].includes(user.role))throw new Error("Gateway exports are not available to this role.");
    return user.role==="Facility Manager"
      ? sql<any[]>`SELECT pass_number,department,movement_type,purpose,origin_location,destination,expected_movement_date,expected_return_date,status,logistics_status,approved_by_role,created_at FROM gateway_passes WHERE facility_manager_user_id=${user.id} ORDER BY created_at DESC LIMIT 1000`
      : sql<any[]>`SELECT pass_number,department,movement_type,purpose,origin_location,destination,expected_movement_date,expected_return_date,status,logistics_status,approved_by_role,created_at FROM gateway_passes ORDER BY created_at DESC LIMIT 1000`;
  }
  if(kind==="activity"){
    return user.role==="Admin"||user.role==="Auditor"
      ? sql<any[]>`SELECT created_at,role,action,entity_type,entity_id,public_summary,visibility_scope FROM activity_logs ORDER BY created_at DESC LIMIT 2000`
      : sql<any[]>`SELECT created_at,role,action,entity_type,entity_id,public_summary,visibility_scope FROM activity_logs WHERE user_id=${user.id} OR related_user_id=${user.id} OR role=${user.role} ORDER BY created_at DESC LIMIT 1000`;
  }
  if(kind==="reconciliation"){
    if(!["Finance","Admin","Auditor","Procurement Manager"].includes(user.role))throw new Error("Reconciliation exports are not available to this role.");
    return sql<any[]>`SELECT p.payment_no,pr.request_no,po.po_no,i.invoice_no,v.name vendor,p.amount,p.currency,p.status payment_status,p.verification_status,p.payment_reference,p.payment_date,rr.receipt_no,rr.status receipt_status,CASE WHEN i.id IS NULL THEN 'No invoice' WHEN ABS(COALESCE(i.total_amount,0)-p.amount)<0.01 THEN 'Amount matched' ELSE 'Amount mismatch' END reconciliation FROM payments p LEFT JOIN purchase_requests pr ON pr.id=p.request_id LEFT JOIN purchase_orders po ON po.id=p.po_id LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN receipt_records rr ON rr.id=COALESCE(p.proof_of_payment_receipt_id,p.vendor_receipt_id,p.receipt_id) LEFT JOIN vendors v ON v.id=p.vendor_id ORDER BY COALESCE(p.updated_at,p.created_at) DESC LIMIT 1000`;
  }
  if(kind==="cash-advances"){
    if(!["Finance","Admin","Auditor"].includes(user.role))throw new Error("Cash advance exports are not available to this role.");
    return sql<any[]>`SELECT ca.advance_no,ca.date_collected,ca.employee_name,ca.amount_collected,ca.purpose,ca.status,ca.due_date,COALESCE((SELECT SUM(amount) FROM advance_expenses ae WHERE ae.advance_id=ca.id),0) amount_spent,ca.amount_collected-COALESCE((SELECT SUM(amount) FROM advance_expenses ae WHERE ae.advance_id=ca.id),0) balance FROM cash_advances ca ORDER BY ca.created_at DESC LIMIT 1000`;
  }
  if(kind==="backup"){
    if(user.role!=="Admin")throw new Error("Only Admin can generate a recovery export.");
    const [requests,pos,vendors,payments,receipts,invoices,expenses,gateways,activities,audit]=await Promise.all([
      sql<any[]>`SELECT * FROM purchase_requests ORDER BY id`,sql<any[]>`SELECT * FROM purchase_orders ORDER BY id`,sql<any[]>`SELECT id,name,category,phone,email,address,tax_id,rating,completed_orders,total_spend,average_delivery_time,rejection_count,last_purchase_date,status,created_at,updated_at FROM vendors ORDER BY id`,sql<any[]>`SELECT id,payment_no,invoice_id,po_id,vendor_id,amount,payment_method,payment_date,status,notes,created_by,created_at,updated_at,finance_note,approved_by_role,approval_mode,receipt_id,request_id,next_role,transfer_type,currency,payment_reference,verification_status FROM payments ORDER BY id`,sql<any[]>`SELECT id,receipt_no,receipt_type,payment_method,payment_date,vendor_id,payer_name,payee_name,amount,tax_amount,currency,purpose,department_project,linked_invoice_id,linked_payment_id,linked_po_id,status,file_hash,duplicate_warning,notes,uploaded_by,created_at,updated_at,document_category,request_id,payment_id,original_file_name,mime_type,file_size_bytes,file_checksum,ocr_status,discrepancy_status FROM receipt_records ORDER BY id`,sql<any[]>`SELECT id,invoice_no,receipt_no,po_id,vendor_id,invoice_date,amount,tax_amount,total_amount,file_hash,match_status,mismatch_reasons,status,uploaded_by,created_at,invoice_type,document_stage,supplier_invoice_no,due_date,payment_terms,subtotal,discount_amount,balance_due,linked_request_id,approval_status FROM invoices ORDER BY id`,sql<any[]>`SELECT id,expense_no,expense_date,category,description,vendor_id,amount,payment_method,project_department,status,receipt_hash,receipt_no,invoice_no,tax_amount,linked_po_id,invoice_match_status,duplicate_warning,requested_by,approved_by,approved_at,rejection_reason,notes,created_at,document_kind,receipt_id FROM expenses ORDER BY id`,sql<any[]>`SELECT * FROM gateway_passes ORDER BY id`,sql<any[]>`SELECT * FROM activity_logs ORDER BY id`,sql<any[]>`SELECT id,occurred_at,action,entity_type,entity_id,entity_reference,actor_user_id,actor_username,actor_role,outcome,severity,source,signature_key_version,previous_event_hash,record_hash,record_signature,reason_or_comment FROM audit_events ORDER BY id`]);
    return [{export_type:"ProcureFlow recovery package",generated_at:new Date().toISOString(),requests,pos,vendors,payments,receipts,invoices,expenses,gateways,activities,audit}];
  }
  throw new Error("Unsupported export type.");
}

export async function GET(request:Request){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const url=new URL(request.url);const kind=url.searchParams.get("kind")||"activity";const format=(url.searchParams.get("format")||"csv").toLowerCase();const idText=url.searchParams.get("id");const id=idText?Number(idText):null;
  try{const rows=await rowsFor(kind,Number.isFinite(id as any)?id:null,user);const filename=safeName(`${kind}-${new Date().toISOString().slice(0,10)}`);
    if(format==="json"||kind==="backup")return new NextResponse(JSON.stringify(kind==="backup"?rows[0]:rows,null,2),{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="${filename}.json"`}});
    if(format==="pdf"){const title=kind==="payment"&&rows[0]?`ProcureFlow Payment Instruction — ${rows[0].payment_no}`:`ProcureFlow ${kind.replace(/-/g," ")} Report`;const pdf=simplePdf(title,pdfLines(rows),"CMOTD ProcureFlow");return new NextResponse(pdf,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${filename}.pdf"`}});}
    return new NextResponse(csvText(rows),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${filename}.csv"`}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to generate export."},{status:400});}
}

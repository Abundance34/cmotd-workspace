import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvText, simplePdf } from "@/lib/procureflow/simple-pdf";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function safeName(value:string){return value.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"")||"procureflow-audit-transactions";}
function clean(value:any){if(value instanceof Date)return value.toISOString();return value;}
function normalize(rows:any[]){return rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,clean(v)])));}

async function loadPackage(requestId:number|null){
  const sql=db(),all=requestId==null;
  const requests=await sql<any[]>`
    SELECT pr.id,pr.request_no,requester.full_name requester,requester.role requester_role,
           fm.full_name facility_manager,pm.full_name procurement_manager,pr.department_project,pr.category,pr.priority,
           pr.justification,pr.vendor_preference,pr.estimated_amount,pr.status,pr.payment_status,pr.next_role,pr.source_type,
           pr.request_date,pr.required_date,pr.submitted_at,pr.approved_at,pr.paid_at,pr.completed_at,pr.created_at,pr.updated_at
    FROM purchase_requests pr
    LEFT JOIN users requester ON requester.id=pr.requested_by
    LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
    LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id
    WHERE (${all} OR pr.id=${requestId})
    ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC,pr.id DESC LIMIT 1200`;
  if(requestId&&!requests.length)throw new Error("Transaction not found.");
  const ids=requests.map(r=>Number(r.id));
  if(!ids.length)return {requests:[],items:[],workflow:[],approvals:[],quotes:[],purchaseOrders:[],poItems:[],payments:[],receipts:[],messages:[],documents:[]};
  const [items,workflow,approvals,quotes,pos,poItems,payments,receipts,messages,documents]=await Promise.all([
    sql<any[]>`SELECT pri.request_id,pr.request_no,pri.id,pri.item_name,pri.description,pri.quantity,pri.unit_price,pri.total,pri.category,pri.suggested_vendor,pri.created_at FROM purchase_request_items pri JOIN purchase_requests pr ON pr.id=pri.request_id WHERE pri.request_id IN ${sql(ids)} ORDER BY pri.request_id,pri.id`,
    sql<any[]>`SELECT we.entity_id request_id,pr.request_no,we.id,we.created_at,we.event,we.status,we.note,u.full_name user_name,u.role user_role FROM workflow_events we JOIN purchase_requests pr ON pr.id=we.entity_id LEFT JOIN users u ON u.id=we.user_id WHERE we.entity_type='Purchase Request' AND we.entity_id IN ${sql(ids)} ORDER BY we.entity_id,we.created_at,we.id`,
    sql<any[]>`SELECT ah.entity_id request_id,pr.request_no,ah.id,ah.created_at,ah.action,ah.status_before,ah.status_after,COALESCE(u.full_name,ah.approved_by_role) approved_by,ah.approved_by_role,ah.approval_mode,COALESCE(ah.note,ah.reason) note FROM approval_history ah JOIN purchase_requests pr ON pr.id=ah.entity_id LEFT JOIN users u ON u.id=COALESCE(ah.approved_by_user_id,ah.user_id) WHERE ah.entity_type='Purchase Request' AND ah.entity_id IN ${sql(ids)} ORDER BY ah.entity_id,ah.created_at,ah.id`,
    sql<any[]>`SELECT st.request_id,pr.request_no,vq.id,COALESCE(vq.vendor_name,v.name) vendor_name,COALESCE(vq.quotation_total,vq.quoted_amount,0) quoted_amount,vq.currency,vq.delivery_time_days,vq.payment_terms,vq.score,vq.is_recommended,vq.is_selected,vq.created_at FROM vendor_quotes vq JOIN sourcing_tasks st ON st.id=vq.sourcing_task_id JOIN purchase_requests pr ON pr.id=st.request_id LEFT JOIN vendors v ON v.id=vq.vendor_id WHERE st.request_id IN ${sql(ids)} ORDER BY st.request_id,vq.created_at,vq.id`,
    sql<any[]>`SELECT po.request_id,pr.request_no,po.id,po.po_no,v.name vendor_name,po.total_amount,po.status,po.payment_status,po.receiving_status,po.logistics_status,po.approved_by_role,po.next_role,po.created_at,po.updated_at FROM purchase_orders po JOIN purchase_requests pr ON pr.id=po.request_id LEFT JOIN vendors v ON v.id=po.vendor_id WHERE po.request_id IN ${sql(ids)} ORDER BY po.request_id,po.id`,
    sql<any[]>`SELECT po.request_id,pr.request_no,poi.po_id,po.po_no,poi.id,poi.item_name,poi.description,poi.category,poi.quantity,poi.unit_price,poi.total,poi.created_at FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.po_id JOIN purchase_requests pr ON pr.id=po.request_id WHERE po.request_id IN ${sql(ids)} ORDER BY po.request_id,poi.po_id,poi.id`,
    sql<any[]>`SELECT p.request_id,pr.request_no,p.id,p.payment_no,p.amount,p.currency,p.payment_method,p.transfer_type,p.payment_reference,p.payment_date,p.status,p.verification_status,p.finance_note,p.approved_by_role,p.created_at,p.updated_at FROM payments p JOIN purchase_requests pr ON pr.id=p.request_id WHERE p.request_id IN ${sql(ids)} ORDER BY p.request_id,p.created_at,p.id`,
    sql<any[]>`SELECT rr.request_id,pr.request_no,rr.id,rr.receipt_no,rr.receipt_type,rr.payment_method,rr.payment_date,rr.amount,rr.currency,rr.status,rr.original_file_name,rr.file_checksum,rr.ocr_status,rr.discrepancy_status,rr.created_at FROM receipt_records rr JOIN purchase_requests pr ON pr.id=rr.request_id WHERE rr.request_id IN ${sql(ids)} ORDER BY rr.request_id,rr.created_at,rr.id`,
    sql<any[]>`SELECT ct.entity_id request_id,pr.request_no,cm.id,cm.created_at,u.full_name sender_name,u.role sender_role,cm.message_text FROM collaboration_threads ct JOIN purchase_requests pr ON pr.id=ct.entity_id JOIN collaboration_messages cm ON cm.thread_id=ct.id LEFT JOIN users u ON u.id=cm.sender_user_id WHERE ct.entity_type='Purchase Request' AND ct.entity_id IN ${sql(ids)} ORDER BY ct.entity_id,cm.created_at,cm.id`,
    sql<any[]>`SELECT ild.linked_request_id request_id,pr.request_no,ild.id,ild.file_name,ild.document_type,ild.title,ild.import_status status,ild.file_hash,ild.created_at FROM imported_legacy_documents ild JOIN purchase_requests pr ON pr.id=ild.linked_request_id WHERE ild.linked_request_id IN ${sql(ids)} ORDER BY ild.linked_request_id,ild.created_at,ild.id`
  ]);
  return {requests:normalize(requests),items:normalize(items),workflow:normalize(workflow),approvals:normalize(approvals),quotes:normalize(quotes),purchaseOrders:normalize(pos),poItems:normalize(poItems),payments:normalize(payments),receipts:normalize(receipts),messages:normalize(messages),documents:normalize(documents)};
}

function flattened(pkg:any){
  const children=["items","workflow","approvals","quotes","purchaseOrders","poItems","payments","receipts","messages","documents"];
  return pkg.requests.map((r:any)=>{
    const id=Number(r.id),out:any={...r};
    for(const key of children)out[key]=JSON.stringify((pkg[key]||[]).filter((x:any)=>Number(x.request_id)===id));
    return out;
  });
}

function pdfLines(pkg:any){
  const lines:string[]=[];
  for(const r of pkg.requests){
    const id=Number(r.id);
    lines.push(`${r.request_no} | ${r.department_project||"—"} | ${r.category||"—"} | NGN ${Number(r.estimated_amount||0).toLocaleString("en-NG")} | ${r.status||"—"}`);
    lines.push(`Requester: ${r.requester||"—"} (${r.requester_role||"—"}) | Procurement: ${r.procurement_manager||"—"} | Payment: ${r.payment_status||"—"}`);
    lines.push(`Justification: ${r.justification||"—"}`);
    const groups:[string,string][]=[["Items","items"],["Workflow","workflow"],["Approvals","approvals"],["Quotes","quotes"],["Purchase Orders","purchaseOrders"],["Payments","payments"],["Receipts","receipts"],["Messages","messages"],["Documents","documents"]];
    for(const [label,key] of groups){
      const rows=(pkg[key]||[]).filter((x:any)=>Number(x.request_id)===id);
      lines.push(`${label}: ${rows.length}`);
      for(const x of rows.slice(0,80))lines.push("  - "+Object.entries(x).filter(([k])=>!["request_id","request_no","id"].includes(k)).map(([k,v])=>`${k}: ${v??""}`).join(" | "));
    }
    lines.push(" ");
  }
  return lines.slice(0,5000);
}

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  if(user.role!=="Auditor"&&user.role!=="Admin")return NextResponse.json({error:"Auditor access is required."},{status:403});
  const url=new URL(request.url),format=(url.searchParams.get("format")||"xlsx").toLowerCase(),idText=url.searchParams.get("id");
  const id=idText?Number(idText):null;
  if(idText&&(!Number.isInteger(id)||Number(id)<=0))return NextResponse.json({error:"A valid transaction id is required."},{status:400});
  if(!["xlsx","excel","pdf","csv","json"].includes(format))return NextResponse.json({error:"Choose Excel, PDF, CSV or JSON."},{status:400});
  try{
    const pkg=await loadPackage(id),ref=id&&pkg.requests[0]?.request_no?pkg.requests[0].request_no:"all-transactions";
    const filename=safeName(`procureflow-audit-${ref}-${new Date().toISOString().slice(0,10)}`);
    if(format==="json")return new NextResponse(JSON.stringify(pkg,null,2),{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="${filename}.json"`}});
    if(format==="xlsx"||format==="excel"){
      const wb=XLSX.utils.book_new(),sheets:[string,any[]][]=[
        ["Requests",pkg.requests],["Line Items",pkg.items],["Workflow",pkg.workflow],["Approvals",pkg.approvals],["Vendor Quotes",pkg.quotes],
        ["Purchase Orders",pkg.purchaseOrders],["PO Items",pkg.poItems],["Payments",pkg.payments],["Receipts",pkg.receipts],["Messages",pkg.messages],["Documents",pkg.documents]
      ];
      for(const [name,rows] of sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.length?rows:[{message:"No records"}]),name.slice(0,31));
      const output=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
      return new NextResponse(new Uint8Array(output),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${filename}.xlsx"`}});
    }
    if(format==="pdf"){
      const pdf=simplePdf(id?`ProcureFlow Transaction 360 — ${ref}`:"ProcureFlow Transaction 360 — Complete Register",pdfLines(pkg),"CMOTD ProcureFlow Audit");
      return new NextResponse(pdf,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${filename}.pdf"`}});
    }
    return new NextResponse(csvText(flattened(pkg)),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${filename}.csv"`}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to generate audit transaction export."},{status:400});}
}

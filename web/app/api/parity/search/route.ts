import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request:Request){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const q=(new URL(request.url).searchParams.get("q")||"").trim(); if(q.length<2)return NextResponse.json({results:[]});
  const like=`%${q.slice(0,120)}%`; const sql=db(); const results:any[]=[];
  if(user.role==="Facility Manager"){
    const req=await sql<any[]>`SELECT id,request_no,department_project,status FROM purchase_requests WHERE (facility_manager_user_id=${user.id} OR requested_by=${user.id}) AND (request_no ILIKE ${like} OR department_project ILIKE ${like} OR category ILIKE ${like} OR justification ILIKE ${like}) ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 12`;
    results.push(...req.map(r=>({type:"Purchase Request",id:Number(r.id),title:r.request_no,subtitle:`${r.department_project||""} · ${r.status||""}`,section:"My Activity History"})));
    const gp=await sql<any[]>`SELECT id,pass_number,purpose,status FROM gateway_passes WHERE facility_manager_user_id=${user.id} AND (pass_number ILIKE ${like} OR purpose ILIKE ${like} OR destination ILIKE ${like}) ORDER BY created_at DESC LIMIT 8`;
    results.push(...gp.map(r=>({type:"Gateway Pass",id:Number(r.id),title:r.pass_number,subtitle:`${r.purpose||""} · ${r.status||""}`,section:"Gateway Pass"})));
  } else {
    const req=await sql<any[]>`SELECT id,request_no,department_project,status FROM purchase_requests WHERE request_no ILIKE ${like} OR department_project ILIKE ${like} OR category ILIKE ${like} OR justification ILIKE ${like} ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 12`;
    results.push(...req.map(r=>({type:"Purchase Request",id:Number(r.id),title:r.request_no,subtitle:`${r.department_project||""} · ${r.status||""}`,section:user.role==="Procurement Manager"?"Purchase Requests":"All Procurement Records"})));
    if(["Procurement Manager","Finance","Approver","Admin","Auditor","Logistics Officer"].includes(user.role)){
      const po=await sql<any[]>`SELECT po.id,po.po_no,po.status,v.name vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id=po.vendor_id WHERE po.po_no ILIKE ${like} OR v.name ILIKE ${like} ORDER BY COALESCE(po.updated_at,po.created_at) DESC LIMIT 10`;
      results.push(...po.map(r=>({type:"Purchase Order",id:Number(r.id),title:r.po_no,subtitle:`${r.vendor_name||""} · ${r.status||""}`,section:user.role==="Logistics Officer"?"PO Delivery Handover":user.role==="Approver"?"PO Approval":"Commercial PO Management"})));
    }
    if(["Procurement Manager","Finance","Approver","Admin","Auditor"].includes(user.role)){
      const vendors=await sql<any[]>`SELECT id,name,category,status FROM vendors WHERE name ILIKE ${like} OR category ILIKE ${like} OR email ILIKE ${like} ORDER BY name LIMIT 10`;
      results.push(...vendors.map(r=>({type:"Vendor",id:Number(r.id),title:r.name,subtitle:`${r.category||""} · ${r.status||""}`,section:"Vendors"})));
    }
    if(["Finance","Admin","Auditor","Procurement Manager","Approver"].includes(user.role)){
      const payments=await sql<any[]>`SELECT id,payment_no,status,payment_reference FROM payments WHERE payment_no ILIKE ${like} OR payment_reference ILIKE ${like} ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 8`;
      results.push(...payments.map(r=>({type:"Payment",id:Number(r.id),title:r.payment_no,subtitle:`${r.payment_reference||""} · ${r.status||""}`,section:"Payments"})));
      const invoices=await sql<any[]>`SELECT id,invoice_no,status,supplier_invoice_no FROM invoices WHERE invoice_no ILIKE ${like} OR supplier_invoice_no ILIKE ${like} ORDER BY created_at DESC LIMIT 8`;
      results.push(...invoices.map(r=>({type:"Invoice",id:Number(r.id),title:r.invoice_no,subtitle:`${r.supplier_invoice_no||""} · ${r.status||""}`,section:"Invoices"})));
    }
    if(["Procurement Manager","Approver","Admin","Auditor","Logistics Officer"].includes(user.role)){
      const gps=await sql<any[]>`SELECT id,pass_number,purpose,status FROM gateway_passes WHERE pass_number ILIKE ${like} OR purpose ILIKE ${like} OR destination ILIKE ${like} ORDER BY created_at DESC LIMIT 8`;
      results.push(...gps.map(r=>({type:"Gateway Pass",id:Number(r.id),title:r.pass_number,subtitle:`${r.purpose||""} · ${r.status||""}`,section:user.role==="Approver"?"Gateway Pass Approval":user.role==="Logistics Officer"?"Gateway Pass Coordination":"Gateway Pass Review"})));
    }
  }
  return NextResponse.json({results:results.slice(0,40)});
}

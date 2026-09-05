import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";

function numberValue(value: unknown) { return Number(value || 0); }
function textValue(value: unknown) { return value == null ? null : String(value); }
function iso(value: unknown) { return value == null ? null : String(value); }

export type ParityData = {
  policyLimit: number;
  lowValueQueue: any[];
  closureQueue: any[];
  purchaseOrders: any[];
  vendors: any[];
  gateways: any[];
  gatewayItems: any[];
  gatewayReviewQueue: any[];
  threads: any[];
  messages: any[];
  invoices: any[];
  expenses: any[];
  cashAdvances: any[];
  advanceExpenses: any[];
  documents: any[];
  activities: any[];
  notifications: any[];
  availability: any[];
  reconciliation: any[];
  requests: any[];
  receipts: any[];
};

export async function getParityData(user: CurrentUser): Promise<ParityData> {
  const sql = db();
  const policyRows = await sql<{amount:string|number}[]>`SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1`;
  const policyLimit = numberValue(policyRows[0]?.amount || 100000);

  const requests = user.role === "Facility Manager"
    ? await sql<any[]>`SELECT pr.*, u.full_name requester_name, pm.full_name procurement_manager_name FROM purchase_requests pr LEFT JOIN users u ON u.id=pr.requested_by LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id WHERE pr.facility_manager_user_id=${user.id} OR pr.requested_by=${user.id} ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC LIMIT 300`
    : user.role === "Procurement Manager"
      ? await sql<any[]>`SELECT pr.*, u.full_name requester_name, fm.full_name facility_manager_name FROM purchase_requests pr LEFT JOIN users u ON u.id=pr.requested_by LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id WHERE pr.assigned_procurement_manager_id=${user.id} OR pr.next_role='procurement_manager' OR pr.requested_by=${user.id} ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC LIMIT 500`
      : await sql<any[]>`SELECT pr.*, u.full_name requester_name, fm.full_name facility_manager_name, pm.full_name procurement_manager_name FROM purchase_requests pr LEFT JOIN users u ON u.id=pr.requested_by LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC LIMIT 500`;

  const lowValueQueue = user.role === "Procurement Manager" || user.role === "Admin"
    ? await sql<any[]>`
      SELECT pr.*, u.full_name requester_name, u.role requester_role
      FROM purchase_requests pr JOIN users u ON u.id=pr.requested_by
      WHERE COALESCE(pr.estimated_amount,0) <= ${policyLimit}
        AND u.role <> 'Procurement Manager'
        AND pr.status IN ('Submitted for Approval','Pending Approval','Reviewed by Procurement','Accepted by Procurement Manager')
        AND (${user.role === "Admin"} OR pr.assigned_procurement_manager_id=${user.id} OR pr.next_role='procurement_manager')
      ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC LIMIT 200`
    : [];

  const closureQueue = user.role === "Procurement Manager" || user.role === "Admin"
    ? await sql<any[]>`
      SELECT pr.*, p.payment_no, p.payment_date, p.payment_reference, p.amount paid_amount
      FROM purchase_requests pr LEFT JOIN LATERAL (
        SELECT * FROM payments x WHERE x.request_id=pr.id AND x.status='Paid' ORDER BY x.id DESC LIMIT 1
      ) p ON TRUE
      WHERE (pr.status='Paid' OR pr.payment_status='Paid' OR p.id IS NOT NULL)
        AND pr.completed_at IS NULL AND COALESCE(pr.status,'') NOT IN ('Closed','Completed','Archived')
        AND (${user.role === "Admin"} OR pr.assigned_procurement_manager_id=${user.id} OR pr.next_role='procurement_manager')
      ORDER BY COALESCE(pr.paid_at,pr.updated_at,pr.created_at) DESC LIMIT 200`
    : [];

  const poRows = await sql<any[]>`
    SELECT po.*, pr.request_no, pr.department_project, v.name vendor_name, v.category vendor_category,
           cb.full_name created_by_name, ab.full_name approved_by_name
    FROM purchase_orders po
    LEFT JOIN purchase_requests pr ON pr.id=po.request_id
    LEFT JOIN vendors v ON v.id=po.vendor_id
    LEFT JOIN users cb ON cb.id=po.created_by LEFT JOIN users ab ON ab.id=po.approved_by
    ORDER BY COALESCE(po.updated_at,po.created_at) DESC LIMIT 400`;

  const vendors = await sql<any[]>`SELECT id,name,category,phone,email,address,tax_id,rating,completed_orders,total_spend,average_delivery_time,rejection_count,last_purchase_date,status,created_at,updated_at FROM vendors ORDER BY COALESCE(updated_at,created_at) DESC,name LIMIT 500`;

  const gateways = user.role === "Facility Manager"
    ? await sql<any[]>`SELECT gp.*, fm.full_name facility_manager_name FROM gateway_passes gp LEFT JOIN users fm ON fm.id=gp.facility_manager_user_id WHERE gp.facility_manager_user_id=${user.id} ORDER BY COALESCE(gp.updated_at,gp.created_at) DESC LIMIT 300`
    : await sql<any[]>`SELECT gp.*, fm.full_name facility_manager_name, rv.full_name reviewed_by_name, av.full_name approved_by_name FROM gateway_passes gp LEFT JOIN users fm ON fm.id=gp.facility_manager_user_id LEFT JOIN users rv ON rv.id=gp.reviewed_by_user_id LEFT JOIN users av ON av.id=gp.approved_by_user_id ORDER BY COALESCE(gp.updated_at,gp.created_at) DESC LIMIT 400`;
  const gatewayIds = gateways.map((row:any)=>Number(row.id)).filter(Boolean);
  const gatewayItems = gatewayIds.length
    ? await sql<any[]>`SELECT * FROM gateway_pass_items WHERE gateway_pass_id IN ${sql(gatewayIds)} ORDER BY gateway_pass_id,id`
    : [];
  const gatewayReviewQueue = (user.role === "Procurement Manager" || user.role === "Admin")
    ? gateways.filter((row:any) => ["Submitted","Pending Procurement Manager / Approver Review"].includes(String(row.status||"")) && [null,"procurement_manager","Procurement Manager"].includes(row.next_role))
    : [];

  const threads = user.role === "Facility Manager"
    ? await sql<any[]>`SELECT ct.*, fm.full_name facility_manager_name, pm.full_name procurement_manager_name FROM collaboration_threads ct LEFT JOIN users fm ON fm.id=ct.facility_manager_user_id LEFT JOIN users pm ON pm.id=ct.procurement_manager_user_id WHERE ct.facility_manager_user_id=${user.id} ORDER BY COALESCE(ct.updated_at,ct.created_at) DESC LIMIT 150`
    : user.role === "Procurement Manager"
      ? await sql<any[]>`SELECT ct.*, fm.full_name facility_manager_name, pm.full_name procurement_manager_name FROM collaboration_threads ct LEFT JOIN users fm ON fm.id=ct.facility_manager_user_id LEFT JOIN users pm ON pm.id=ct.procurement_manager_user_id WHERE ct.procurement_manager_user_id=${user.id} ORDER BY COALESCE(ct.updated_at,ct.created_at) DESC LIMIT 150`
      : user.role === "Admin" || user.role === "Auditor"
        ? await sql<any[]>`SELECT ct.*, fm.full_name facility_manager_name, pm.full_name procurement_manager_name FROM collaboration_threads ct LEFT JOIN users fm ON fm.id=ct.facility_manager_user_id LEFT JOIN users pm ON pm.id=ct.procurement_manager_user_id ORDER BY COALESCE(ct.updated_at,ct.created_at) DESC LIMIT 200`
        : [];
  const threadIds = threads.map((row:any)=>Number(row.id)).filter(Boolean);
  const messages = threadIds.length
    ? await sql<any[]>`SELECT cm.*, u.full_name sender_name,u.role sender_role FROM collaboration_messages cm LEFT JOIN users u ON u.id=cm.sender_user_id WHERE cm.thread_id IN ${sql(threadIds)} ORDER BY cm.created_at ASC,cm.id ASC LIMIT 1000`
    : [];

  const financeReadable = ["Finance","Admin","Auditor","Procurement Manager","Approver"].includes(user.role);
  const invoices = financeReadable ? await sql<any[]>`
    SELECT i.*, po.po_no, pr.request_no, v.name vendor_name, u.full_name uploaded_by_name
    FROM invoices i LEFT JOIN purchase_orders po ON po.id=i.po_id LEFT JOIN purchase_requests pr ON pr.id=COALESCE(i.linked_request_id,po.request_id)
    LEFT JOIN vendors v ON v.id=i.vendor_id LEFT JOIN users u ON u.id=i.uploaded_by
    ORDER BY i.created_at DESC LIMIT 400` : [];
  const expenses = ["Finance","Admin","Auditor"].includes(user.role) ? await sql<any[]>`
    SELECT e.*, v.name vendor_name, po.po_no, u.full_name requester_name, a.full_name approved_by_name
    FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN purchase_orders po ON po.id=e.linked_po_id
    LEFT JOIN users u ON u.id=e.requested_by LEFT JOIN users a ON a.id=e.approved_by
    ORDER BY e.created_at DESC LIMIT 400` : [];
  const cashAdvances = ["Finance","Admin","Auditor"].includes(user.role) ? await sql<any[]>`
    SELECT ca.*, u.full_name created_by_name, a.full_name approved_by_name,
      COALESCE((SELECT SUM(ae.amount) FROM advance_expenses ae WHERE ae.advance_id=ca.id),0) spent_amount
    FROM cash_advances ca LEFT JOIN users u ON u.id=ca.created_by LEFT JOIN users a ON a.id=ca.approved_by
    ORDER BY ca.created_at DESC LIMIT 300` : [];
  const advanceExpenses = ["Finance","Admin","Auditor"].includes(user.role) ? await sql<any[]>`SELECT * FROM advance_expenses ORDER BY created_at DESC LIMIT 500` : [];

  const importedDocs = ["Facility Manager","Procurement Manager","Admin","Auditor"].includes(user.role)
    ? await sql<any[]>`SELECT id,'Imported Document' source_type,file_name,document_type,title,file_path,file_hash,department_project,linked_request_id entity_id,created_at,import_status status,original_path notes FROM imported_legacy_documents ORDER BY created_at DESC LIMIT 300` : [];
  const logisticsDocs = ["Logistics Officer","Procurement Manager","Admin","Auditor"].includes(user.role)
    ? await sql<any[]>`SELECT id,'Logistics Document' source_type,file_name,document_type,document_type title,file_path,NULL::text file_hash,NULL::text department_project,COALESCE(po_id,gateway_pass_id,related_entity_id) entity_id,created_at,NULL::text status,notes FROM logistics_documents ORDER BY created_at DESC LIMIT 300` : [];
  const vendorDocs = ["Procurement Manager","Admin","Auditor"].includes(user.role)
    ? await sql<any[]>`SELECT vd.id,'Vendor Document' source_type,split_part(vd.file_path,'/',-1) file_name,vd.document_type,vd.title,vd.file_path,vd.file_hash,NULL::text department_project,vd.vendor_id entity_id,vd.created_at,NULL::text status,vd.notes FROM vendor_documents vd ORDER BY vd.created_at DESC LIMIT 300` : [];
  const receiptDocs = ["Finance","Procurement Manager","Admin","Auditor"].includes(user.role)
    ? await sql<any[]>`SELECT rr.id,'Receipt' source_type,COALESCE(rr.original_file_name,rr.receipt_no) file_name,COALESCE(rr.document_category,rr.receipt_type) document_type,rr.receipt_no title,rr.file_path,COALESCE(rr.file_checksum,rr.file_hash) file_hash,rr.department_project,COALESCE(rr.request_id,rr.payment_id,rr.linked_po_id) entity_id,rr.created_at,rr.status,rr.notes FROM receipt_records rr ORDER BY rr.created_at DESC LIMIT 300` : [];
  const invoiceDocs = financeReadable
    ? invoices.filter((r:any)=>r.file_path).map((r:any)=>({id:r.id,source_type:"Invoice",file_name:r.supplier_invoice_no||r.invoice_no,document_type:r.invoice_type||"Invoice",title:r.invoice_no,file_path:r.file_path,file_hash:r.file_hash,department_project:null,entity_id:r.id,created_at:r.created_at,status:r.status,notes:r.mismatch_reasons})) : [];
  const documents = [...importedDocs,...logisticsDocs,...vendorDocs,...receiptDocs,...invoiceDocs]
    .sort((a:any,b:any)=>String(b.created_at||"").localeCompare(String(a.created_at||""))).slice(0,800);

  const activities = user.role === "Admin" || user.role === "Auditor"
    ? await sql<any[]>`SELECT al.*, u.full_name user_name FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id ORDER BY al.created_at DESC LIMIT 600`
    : await sql<any[]>`SELECT al.*, u.full_name user_name FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id WHERE al.user_id=${user.id} OR al.related_user_id=${user.id} OR al.role=${user.role} OR al.visibility_scope IN ('workflow','role') ORDER BY al.created_at DESC LIMIT 400`;

  const notifications = await sql<any[]>`
    SELECT * FROM notifications
    WHERE user_id=${user.id} OR (user_id IS NULL AND role=${user.role})
    ORDER BY created_at DESC,id DESC LIMIT 250`;

  const availability = user.role === "Admin"
    ? await sql<any[]>`SELECT ua.*,u.full_name user_name,du.full_name delegate_name FROM user_availability ua LEFT JOIN users u ON u.id=ua.user_id LEFT JOIN users du ON du.id=ua.recommended_delegate_user_id ORDER BY ua.created_at DESC LIMIT 300`
    : await sql<any[]>`SELECT ua.*,u.full_name user_name,du.full_name delegate_name FROM user_availability ua LEFT JOIN users u ON u.id=ua.user_id LEFT JOIN users du ON du.id=ua.recommended_delegate_user_id WHERE ua.user_id=${user.id} ORDER BY ua.created_at DESC LIMIT 100`;

  const reconciliation = ["Finance","Admin","Auditor","Procurement Manager"].includes(user.role) ? await sql<any[]>`
    SELECT p.id,p.payment_no,p.request_id,p.po_id,p.invoice_id,p.amount,p.currency,p.status payment_status,p.verification_status,p.payment_date,p.payment_reference,p.transfer_type,
           pr.request_no,pr.status request_status,po.po_no,po.status po_status,i.invoice_no,i.total_amount invoice_total,rr.receipt_no,rr.status receipt_status,v.name vendor_name
    FROM payments p LEFT JOIN purchase_requests pr ON pr.id=p.request_id LEFT JOIN purchase_orders po ON po.id=p.po_id
    LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN receipt_records rr ON rr.id=COALESCE(p.proof_of_payment_receipt_id,p.vendor_receipt_id,p.receipt_id)
    LEFT JOIN vendors v ON v.id=p.vendor_id ORDER BY COALESCE(p.updated_at,p.created_at) DESC LIMIT 500` : [];

  const receipts = ["Finance","Admin","Auditor","Procurement Manager"].includes(user.role) ? await sql<any[]>`
    SELECT rr.id,rr.receipt_no,rr.receipt_type,rr.payment_method,rr.payment_date,rr.vendor_id,rr.payee_name,rr.amount,rr.currency,rr.purpose,rr.department_project,
           rr.linked_invoice_id,rr.linked_payment_id,rr.linked_po_id,rr.status,rr.original_file_name,rr.mime_type,rr.file_size_bytes,rr.file_checksum,rr.ocr_status,rr.discrepancy_status,rr.created_at,v.name vendor_name
    FROM receipt_records rr LEFT JOIN vendors v ON v.id=rr.vendor_id ORDER BY rr.created_at DESC LIMIT 400` : [];

  const mapRequest = (row:any) => ({...row,id:Number(row.id),estimated_amount:numberValue(row.estimated_amount)});
  return {
    policyLimit,
    lowValueQueue: lowValueQueue.map(mapRequest),
    closureQueue: closureQueue.map(mapRequest),
    purchaseOrders: poRows.map((r:any)=>({...r,id:Number(r.id),total_amount:numberValue(r.total_amount)})),
    vendors: vendors.map((r:any)=>({...r,id:Number(r.id),rating:numberValue(r.rating),completed_orders:numberValue(r.completed_orders),total_spend:numberValue(r.total_spend)})),
    gateways: gateways.map((r:any)=>({...r,id:Number(r.id)})), gatewayItems: gatewayItems.map((r:any)=>({...r,id:Number(r.id),gateway_pass_id:Number(r.gateway_pass_id),quantity:numberValue(r.quantity),estimated_value:numberValue(r.estimated_value)})),
    gatewayReviewQueue: gatewayReviewQueue.map((r:any)=>({...r,id:Number(r.id)})),
    threads: threads.map((r:any)=>({...r,id:Number(r.id)})), messages: messages.map((r:any)=>({...r,id:Number(r.id),thread_id:Number(r.thread_id)})),
    invoices: invoices.map((r:any)=>({...r,id:Number(r.id),amount:numberValue(r.amount),tax_amount:numberValue(r.tax_amount),total_amount:numberValue(r.total_amount),balance_due:numberValue(r.balance_due)})),
    expenses: expenses.map((r:any)=>({...r,id:Number(r.id),amount:numberValue(r.amount),tax_amount:numberValue(r.tax_amount)})),
    cashAdvances: cashAdvances.map((r:any)=>({...r,id:Number(r.id),amount_collected:numberValue(r.amount_collected),spent_amount:numberValue(r.spent_amount)})), advanceExpenses: advanceExpenses.map((r:any)=>({...r,id:Number(r.id),amount:numberValue(r.amount)})),
    documents: documents.map((r:any)=>({...r,id:Number(r.id),entity_id:r.entity_id==null?null:Number(r.entity_id)})),
    activities: activities.map((r:any)=>({...r,id:Number(r.id),entity_id:r.entity_id==null?null:Number(r.entity_id)})), notifications: notifications.map((r:any)=>({...r,id:Number(r.id)})), availability: availability.map((r:any)=>({...r,id:Number(r.id)})),
    reconciliation: reconciliation.map((r:any)=>({...r,id:Number(r.id),amount:numberValue(r.amount),invoice_total:numberValue(r.invoice_total)})), requests: requests.map(mapRequest), receipts: receipts.map((r:any)=>({...r,id:Number(r.id),amount:numberValue(r.amount)})),
  };
}

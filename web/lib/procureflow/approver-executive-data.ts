import { db } from "@/lib/db";
import { getApproverDashboardData, type ApproverDashboardData } from "./approver-data";

export type ExecutiveRequest = {
  id:number; requestNo:string; departmentProject:string|null; category:string|null; priority:string|null;
  estimatedAmount:number; status:string|null; paymentStatus:string|null; nextRole:string|null;
  requesterName:string|null; requesterRole:string|null; facilityManagerName:string|null; procurementManagerName:string|null;
  requestDate:string|null; requiredDate:string|null; updatedAt:string|null;
  approvedByName?:string|null; approvedByRole?:string|null; approvedAt?:string|null; approvalMode?:string|null;
};
export type ExecutivePendingPayment = {
  id:number; requestNo:string; departmentProject:string|null; category:string|null; amount:number;
  status:string|null; paymentStatus:string|null; approvedByName:string|null; approvedByRole:string|null; approvedAt:string|null;
  payeeVerificationStatus:string|null; paymentReadinessStatus:string|null; latestPaymentStatus:string|null;
  financeNote:string|null; lastFinanceActivity:string|null; lastFinanceActivityAt:string|null; lastReminderAt:string|null; waitingReason:string;
};
export type ExecutiveHistory = {
  id:number; entityType:string; entityId:number; action:string; statusBefore:string|null; statusAfter:string|null;
  approvalMode:string|null; note:string|null; createdAt:string; requestNo:string|null; amount:number|null;
  approvedByName:string|null; approvedByRole:string|null; requesterName:string|null; requesterRole:string|null;
};
export type ExecutiveApproverDashboardData = ApproverDashboardData & {
  pendingApprovals:ExecutiveRequest[]; approvedRequests:ExecutiveRequest[];
  pendingPaymentRequests:ExecutivePendingPayment[]; requestApprovalHistory:ExecutiveHistory[];
};

const iso=(v:unknown)=>!v?null:v instanceof Date?v.toISOString():String(v);
function requestRow(r:any):ExecutiveRequest{return {
  id:Number(r.id),requestNo:r.request_no,departmentProject:r.department_project,category:r.category,priority:r.priority,
  estimatedAmount:Number(r.estimated_amount||0),status:r.status,paymentStatus:r.payment_status,nextRole:r.next_role,
  requesterName:r.requester_name,requesterRole:r.requester_role,facilityManagerName:r.facility_manager_name,
  procurementManagerName:r.procurement_manager_name,requestDate:iso(r.request_date),requiredDate:iso(r.required_date),updatedAt:iso(r.updated_at),
  approvedByName:r.approved_by_name||null,approvedByRole:r.approved_by_role||null,approvedAt:iso(r.approved_at),approvalMode:r.approval_mode||null
};}
function waitingReason(r:any){
  const payment=String(r.latest_payment_status||""),note=String(r.finance_note||"").trim(),activity=String(r.last_finance_activity||"").trim();
  if(payment&&!["Paid","Completed","Closed"].includes(payment))return note||`Finance payment record is currently '${payment}'.`;
  if(String(r.payee_verification_status||"")!=="Finance Verified")return "Awaiting Finance verification of the payment recipient details.";
  if(String(r.payment_readiness_status||"")!=="Payment Ready")return "Payment recipient details are not yet marked Payment Ready.";
  return note||activity||"Approved and waiting for Finance to record the payment.";
}

export async function getExecutiveApproverDashboardData(userId:number):Promise<ExecutiveApproverDashboardData>{
  const base=await getApproverDashboardData(userId),sql=db();
  const [pending,approved,payments,history]=await Promise.all([
    sql<any[]>`
      SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.priority,pr.estimated_amount,pr.status,pr.payment_status,pr.next_role,
             pr.request_date,pr.required_date,pr.updated_at,requester.full_name requester_name,requester.role requester_role,
             fm.full_name facility_manager_name,pm.full_name procurement_manager_name
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id=pr.requested_by
      LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
      LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id
      WHERE (pr.next_role='approver' OR pr.status IN ('Submitted for Approval','Pending Approver/MD Approval','Pending Approval'))
        AND COALESCE(pr.status,'') NOT IN ('Approved','Paid','Completed','Closed','Rejected','Returned for Correction')
      ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC,pr.id DESC LIMIT 250`,
    sql<any[]>`
      SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.priority,pr.estimated_amount,pr.status,pr.payment_status,pr.next_role,
             pr.request_date,pr.required_date,pr.updated_at,requester.full_name requester_name,requester.role requester_role,
             fm.full_name facility_manager_name,pm.full_name procurement_manager_name,
             COALESCE(au.full_name,la.approved_by_role,pr.approved_by_role) approved_by_name,
             COALESCE(la.approved_by_role,pr.approved_by_role) approved_by_role,
             COALESCE(la.created_at,pr.approved_at) approved_at,COALESCE(la.approval_mode,pr.approval_mode) approval_mode
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id=pr.requested_by
      LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
      LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id
      LEFT JOIN LATERAL (
        SELECT ah.id,ah.approved_by_user_id,ah.approved_by_role,ah.approval_mode,ah.created_at
        FROM approval_history ah WHERE ah.entity_type='Purchase Request' AND ah.entity_id=pr.id
          AND (ah.status_after='Approved' OR ah.action ILIKE '%approve%')
        ORDER BY ah.created_at DESC,ah.id DESC LIMIT 1
      ) la ON TRUE
      LEFT JOIN users au ON au.id=COALESCE(la.approved_by_user_id,pr.approved_by_user_id)
      WHERE la.id IS NOT NULL AND pr.approval_rescinded_at IS NULL
        AND COALESCE(pr.status,'') NOT IN ('Rejected','Returned for Correction')
      ORDER BY COALESCE(la.created_at,pr.approved_at,pr.updated_at,pr.created_at) DESC,pr.id DESC LIMIT 400`,
    sql<any[]>`
      SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.payment_status,
             COALESCE(au.full_name,la.approved_by_role,pr.approved_by_role) approved_by_name,
             COALESCE(la.approved_by_role,pr.approved_by_role) approved_by_role,COALESCE(la.created_at,pr.approved_at) approved_at,
             ppd.verification_status payee_verification_status,ppd.payment_readiness_status,
             lp.status latest_payment_status,lp.finance_note,fa.public_summary last_finance_activity,fa.created_at last_finance_activity_at,
             reminder.created_at last_reminder_at
      FROM purchase_requests pr
      LEFT JOIN LATERAL (
        SELECT ah.approved_by_user_id,ah.approved_by_role,ah.created_at FROM approval_history ah
        WHERE ah.entity_type='Purchase Request' AND ah.entity_id=pr.id AND (ah.status_after='Approved' OR ah.action ILIKE '%approve%')
        ORDER BY ah.created_at DESC,ah.id DESC LIMIT 1
      ) la ON TRUE
      LEFT JOIN users au ON au.id=COALESCE(la.approved_by_user_id,pr.approved_by_user_id)
      LEFT JOIN LATERAL (
        SELECT x.verification_status,x.payment_readiness_status FROM payment_payee_details x
        WHERE x.id=pr.selected_payee_detail_id OR (pr.selected_payee_detail_id IS NULL AND x.purchase_request_id=pr.id AND COALESCE(x.is_current,TRUE)=TRUE)
        ORDER BY CASE WHEN x.id=pr.selected_payee_detail_id THEN 0 ELSE 1 END,x.id DESC LIMIT 1
      ) ppd ON TRUE
      LEFT JOIN LATERAL (SELECT p.status,p.finance_note FROM payments p WHERE p.request_id=pr.id ORDER BY COALESCE(p.updated_at,p.created_at) DESC,p.id DESC LIMIT 1) lp ON TRUE
      LEFT JOIN LATERAL (SELECT al.public_summary,al.created_at FROM activity_logs al WHERE al.entity_type='Purchase Request' AND al.entity_id=pr.id AND al.role='Finance' ORDER BY al.created_at DESC,al.id DESC LIMIT 1) fa ON TRUE
      LEFT JOIN LATERAL (SELECT al.created_at FROM activity_logs al WHERE al.entity_type='Purchase Request' AND al.entity_id=pr.id AND al.action='PAYMENT_REMINDER_SENT' ORDER BY al.created_at DESC,al.id DESC LIMIT 1) reminder ON TRUE
      WHERE (pr.next_role='finance' OR pr.payment_status='Approved for Payment' OR pr.status IN ('Approved','Awaiting Payment','Approved for Payment','Payment Approved','PO Created'))
        AND COALESCE(pr.status,'') NOT IN ('Paid','Completed','Closed','Rejected') AND COALESCE(pr.payment_status,'')<>'Paid'
      ORDER BY COALESCE(pr.approved_at,pr.updated_at,pr.created_at) ASC,pr.id ASC LIMIT 300`,
    sql<any[]>`
      SELECT ah.id,ah.entity_type,ah.entity_id,ah.action,ah.status_before,ah.status_after,ah.approval_mode,
             COALESCE(ah.note,ah.reason) note,ah.created_at,pr.request_no,pr.estimated_amount,
             approver.full_name approved_by_name,COALESCE(ah.approved_by_role,approver.role) approved_by_role,
             requester.full_name requester_name,requester.role requester_role
      FROM approval_history ah
      LEFT JOIN purchase_requests pr ON ah.entity_type='Purchase Request' AND pr.id=ah.entity_id
      LEFT JOIN users approver ON approver.id=COALESCE(ah.approved_by_user_id,ah.user_id)
      LEFT JOIN users requester ON requester.id=pr.requested_by
      WHERE ah.approved_by_user_id=${userId} OR ah.user_id=${userId}
      ORDER BY ah.created_at DESC,ah.id DESC LIMIT 400`
  ]);
  const pendingApprovals=pending.map(requestRow),approvedRequests=approved.map(requestRow);
  const pendingPaymentRequests:ExecutivePendingPayment[]=payments.map((r:any)=>({
    id:Number(r.id),requestNo:r.request_no,departmentProject:r.department_project,category:r.category,amount:Number(r.estimated_amount||0),
    status:r.status,paymentStatus:r.payment_status,approvedByName:r.approved_by_name||null,approvedByRole:r.approved_by_role||null,approvedAt:iso(r.approved_at),
    payeeVerificationStatus:r.payee_verification_status||null,paymentReadinessStatus:r.payment_readiness_status||null,latestPaymentStatus:r.latest_payment_status||null,
    financeNote:r.finance_note||null,lastFinanceActivity:r.last_finance_activity||null,lastFinanceActivityAt:iso(r.last_finance_activity_at),lastReminderAt:iso(r.last_reminder_at),waitingReason:waitingReason(r)
  }));
  const requestApprovalHistory:ExecutiveHistory[]=history.map((r:any)=>({
    id:Number(r.id),entityType:r.entity_type,entityId:Number(r.entity_id),action:r.action,statusBefore:r.status_before,statusAfter:r.status_after,
    approvalMode:r.approval_mode,note:r.note,createdAt:iso(r.created_at)||"",requestNo:r.request_no||null,
    amount:r.estimated_amount==null?null:Number(r.estimated_amount),approvedByName:r.approved_by_name||null,approvedByRole:r.approved_by_role||null,
    requesterName:r.requester_name||null,requesterRole:r.requester_role||null
  }));
  return {...base,metrics:{...base.metrics,pendingRequests:pendingApprovals.length,pendingPayments:pendingPaymentRequests.length},
    pendingApprovals,approvedRequests,pendingPaymentRequests,requestApprovalHistory};
}

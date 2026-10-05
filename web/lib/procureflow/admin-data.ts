import { db } from "@/lib/db";
import { getAuditorDashboardData, type AuditorDashboardData } from "./auditor-data";

export type AdminRoleRow = { id: number; name: string; description: string | null; permissions: string[] };
export type AdminPermissionRow = { id: number; name: string; description: string | null };
export type AdminApprovalPolicyRow = { policyKey: string; amount: number; updatedBy: string | null; updateReason: string | null; updatedAt: string | null };
export type AdminAvailabilityRow = { id: number; userName: string | null; role: string | null; status: string | null; awayStartDate: string | null; awayEndDate: string | null; reason: string | null; urgency: string | null; reviewStatus: string | null; delegateName: string | null; delegateRole: string | null; adminNote: string | null; createdAt: string | null };
export type AdminDelegationRow = { id: number; primaryRole: string; primaryUser: string | null; delegateRole: string; delegateUser: string | null; enabled: boolean; startDate: string | null; endDate: string | null; reason: string | null; activatedBy: string | null; activationNote: string | null; createdAt: string | null };
export type AdminTableStatRow = { tableName: string; estimatedRows: number; totalSizeBytes: number };
export type AdminExceptionRow = { key: string; title: string; detail: string; severity: "Critical" | "High" | "Important" | "Normal"; count: number };
export type AdminRequestDetailRow = {
  id: number; requestNo: string; requestedBy: string | null; requesterRole: string | null; departmentProject: string | null;
  requestDate: string | null; requiredDate: string | null; category: string | null; justification: string | null; priority: string | null;
  estimatedAmount: number; vendorPreference: string | null; status: string | null; sourceType: string | null; notes: string | null;
  paymentStatus: string | null; nextRole: string | null; facilityManager: string | null; procurementManager: string | null;
  approvalDueAt: string | null; submittedAt: string | null; approvedAt: string | null; approvedBy: string | null; approvedByRole: string | null;
  paidAt: string | null; receiptUploadedAt: string | null; completedAt: string | null; selectedVendor: string | null;
  linkedPoId: number | null; linkedReceivingSlipId: number | null; approvalRescindedAt: string | null; approvalRescindedReason: string | null;
  createdAt: string | null; updatedAt: string | null;
};
export type AdminRequestItemRow = { id: number; requestId: number; itemName: string; description: string | null; quantity: number; unitPrice: number; total: number; category: string | null; suggestedVendor: string | null };
export type AdminRequestStatusRow = { status: string; count: number; amount: number };
export type AdminMonthlyProcurementRow = { month: string; requested: number; approved: number; paid: number };
export type AdminRoleActivityRow = { role: string; count: number; lastActivityAt: string | null };
export type AdminBottleneckRow = { key: string; title: string; detail: string; count: number; statusFilter: string | null; section: string };

export type AdminDashboardData = {
  evidence: AuditorDashboardData;
  roles: AdminRoleRow[];
  permissions: AdminPermissionRow[];
  approvalPolicies: AdminApprovalPolicyRow[];
  availability: AdminAvailabilityRow[];
  delegations: AdminDelegationRow[];
  tableStats: AdminTableStatRow[];
  exceptions: AdminExceptionRow[];
  requestDetails: AdminRequestDetailRow[];
  requestItems: AdminRequestItemRow[];
  requestStatusCounts: AdminRequestStatusRow[];
  monthlyProcurement: AdminMonthlyProcurementRow[];
  roleActivity24h: AdminRoleActivityRow[];
  bottlenecks: AdminBottleneckRow[];
  metrics: {
    totalUsers: number;
    activeUsers: number;
    lockedUsers: number;
    pendingApprovals: number;
    openRequests: number;
    openPOs: number;
    auditEvents: number;
    unreadNotifications: number;
    legacyPayees: number;
    financeVerificationPending: number;
  };
};

function textDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const sql = db();
  const [
    evidence,
    metricRows,
    roleRows,
    permissionRows,
    policyRows,
    availabilityRows,
    delegationRows,
    tableRows,
    requestDetailRows,
    requestItemRows,
    requestStatusRows,
    monthlyRows,
    roleActivityRows,
    bottleneckRows,
  ] = await Promise.all([
    getAuditorDashboardData(),
    sql<any[]>`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM users WHERE is_active=TRUE) AS active_users,
        (SELECT COUNT(*)::int FROM users WHERE COALESCE(account_locked,FALSE)=TRUE) AS locked_users,
        (SELECT COUNT(*)::int FROM purchase_requests WHERE next_role='approver' OR status IN ('Submitted for Approval','Pending Approval','Pending Approver/MD Approval')) AS pending_approvals,
        (SELECT COUNT(*)::int FROM purchase_requests WHERE COALESCE(status,'') NOT IN ('Closed','Rejected','Paid','Completed','Archived')) AS open_requests,
        (SELECT COUNT(*)::int FROM purchase_orders WHERE COALESCE(status,'') NOT IN ('Closed','Cancelled','Paid','Fully Received')) AS open_pos,
        (SELECT COUNT(*)::int FROM audit_events) AS audit_events,
        (SELECT COUNT(*)::int FROM notifications WHERE COALESCE(is_read,FALSE)=FALSE) AS unread_notifications,
        (SELECT COUNT(*)::int FROM payment_payee_details WHERE COALESCE(payee_name_encrypted,account_name_encrypted,bank_name_encrypted,account_number_encrypted) IS NOT NULL) AS legacy_payees,
        (SELECT COUNT(*)::int FROM payment_payee_details WHERE COALESCE(is_current,TRUE)=TRUE AND COALESCE(verification_status,'') <> 'Finance Verified') AS finance_verification_pending
    `,
    sql<any[]>`
      SELECT r.id,r.name,r.description,
             COALESCE(array_agg(rp.permission_name ORDER BY rp.permission_name) FILTER (WHERE rp.permission_name IS NOT NULL),'{}') AS permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_name=r.name
      GROUP BY r.id,r.name,r.description
      ORDER BY r.name
    `,
    sql<any[]>`SELECT id,name,description FROM permissions ORDER BY name`,
    sql<any[]>`
      SELECT aps.policy_key,aps.amount,u.full_name AS updated_by,aps.update_reason,aps.updated_at
      FROM approval_policy_settings aps
      LEFT JOIN users u ON u.id=aps.updated_by
      ORDER BY aps.policy_key
    `,
    sql<any[]>`
      SELECT ua.id,u.full_name AS user_name,ua.role,ua.status,ua.away_start_date,ua.away_end_date,ua.reason,ua.urgency,
             ua.admin_review_status,du.full_name AS delegate_name,ua.recommended_delegate_role,ua.admin_note,ua.created_at
      FROM user_availability ua
      LEFT JOIN users u ON u.id=ua.user_id
      LEFT JOIN users du ON du.id=ua.recommended_delegate_user_id
      ORDER BY COALESCE(ua.updated_at,ua.created_at) DESC
      LIMIT 300
    `,
    sql<any[]>`
      SELECT ad.id,ad.primary_role,pu.full_name AS primary_user,ad.delegate_role,du.full_name AS delegate_user,
             ad.enabled,ad.start_date,ad.end_date,COALESCE(ad.reason,ad.source_reason) AS reason,
             au.full_name AS activated_by,ad.activation_note,ad.created_at
      FROM approval_delegations ad
      LEFT JOIN users pu ON pu.id=ad.primary_user_id
      LEFT JOIN users du ON du.id=ad.delegate_user_id
      LEFT JOIN users au ON au.id=ad.activated_by_admin_id
      ORDER BY COALESCE(ad.updated_at,ad.created_at) DESC
      LIMIT 300
    `,
    sql<any[]>`
      SELECT relname AS table_name,COALESCE(n_live_tup,0)::bigint AS estimated_rows,
             pg_total_relation_size(relid)::bigint AS total_size_bytes
      FROM pg_stat_user_tables
      WHERE schemaname='public'
      ORDER BY pg_total_relation_size(relid) DESC,relname
    `,
    sql<any[]>`
      SELECT pr.id,pr.request_no,ru.full_name requested_by,ru.role requester_role,pr.department_project,pr.request_date,pr.required_date,
             pr.category,pr.justification,pr.priority,pr.estimated_amount,pr.vendor_preference,pr.status,pr.source_type,pr.notes,
             pr.payment_status,pr.next_role,fm.full_name facility_manager,pm.full_name procurement_manager,pr.approval_due_at,pr.submitted_at,
             pr.approved_at,au.full_name approved_by,pr.approved_by_role,pr.paid_at,pr.receipt_uploaded_at,pr.completed_at,
             sv.name selected_vendor,pr.linked_po_id,pr.linked_receiving_slip_id,pr.approval_rescinded_at,pr.approval_rescinded_reason,
             pr.created_at,pr.updated_at
      FROM purchase_requests pr
      LEFT JOIN users ru ON ru.id=pr.requested_by
      LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
      LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id
      LEFT JOIN users au ON au.id=pr.approved_by_user_id
      LEFT JOIN vendors sv ON sv.id=pr.selected_vendor_id
      ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC,pr.id DESC
      LIMIT 750
    `,
    sql<any[]>`
      SELECT id,request_id,item_name,description,quantity,unit_price,total,category,suggested_vendor
      FROM purchase_request_items ORDER BY request_id,id
    `,
    sql<any[]>`
      SELECT COALESCE(NULLIF(status,''),'Unspecified') status,COUNT(*)::int count,COALESCE(SUM(estimated_amount),0) amount
      FROM purchase_requests GROUP BY COALESCE(NULLIF(status,''),'Unspecified') ORDER BY count DESC,status
    `,
    sql<any[]>`
      WITH months AS (
        SELECT generate_series(date_trunc('month',CURRENT_DATE)-INTERVAL '5 months',date_trunc('month',CURRENT_DATE),INTERVAL '1 month') AS month_start
      ), requests AS (
        SELECT date_trunc('month',COALESCE(request_date,created_at::date)) month_start,
               COALESCE(SUM(estimated_amount),0) requested,
               COALESCE(SUM(estimated_amount) FILTER (WHERE approved_at IS NOT NULL OR status IN ('Approved','Approved for Payment','Paid','Completed')),0) approved
        FROM purchase_requests
        WHERE COALESCE(request_date,created_at::date)>=date_trunc('month',CURRENT_DATE)-INTERVAL '5 months'
        GROUP BY 1
      ), paid AS (
        SELECT date_trunc('month',COALESCE(payment_date,created_at::date)) month_start,COALESCE(SUM(amount),0) paid
        FROM payments
        WHERE COALESCE(payment_date,created_at::date)>=date_trunc('month',CURRENT_DATE)-INTERVAL '5 months'
        GROUP BY 1
      )
      SELECT to_char(m.month_start,'Mon YYYY') month,COALESCE(r.requested,0) requested,COALESCE(r.approved,0) approved,COALESCE(p.paid,0) paid
      FROM months m LEFT JOIN requests r ON r.month_start=m.month_start LEFT JOIN paid p ON p.month_start=m.month_start
      ORDER BY m.month_start
    `,
    sql<any[]>`
      SELECT COALESCE(NULLIF(role,''),'System') role,COUNT(*)::int count,MAX(created_at) last_activity_at
      FROM activity_logs WHERE created_at>=NOW()-INTERVAL '24 hours'
      GROUP BY COALESCE(NULLIF(role,''),'System') ORDER BY count DESC,role
    `,
    sql<any[]>`
      SELECT
        (SELECT COUNT(*)::int FROM purchase_requests WHERE status='Sent for Procurement Review' AND COALESCE(updated_at,submitted_at,created_at)<NOW()-INTERVAL '24 hours') review_over_24h,
        (SELECT COUNT(*)::int FROM purchase_requests WHERE (next_role='approver' OR status IN ('Submitted for Approval','Pending Approval','Pending Approver/MD Approval')) AND COALESCE(updated_at,submitted_at,created_at)<NOW()-INTERVAL '48 hours') approval_over_48h,
        (SELECT COUNT(*)::int FROM purchase_requests WHERE next_role='finance' AND payment_status='Approved for Payment' AND COALESCE(updated_at,approved_at,created_at)<NOW()-INTERVAL '24 hours') finance_over_24h,
        (SELECT COUNT(*)::int FROM purchase_orders WHERE (next_role IN ('logistics','logistics_officer') OR logistics_status IN ('Released to Logistics','In Transit')) AND COALESCE(updated_at,created_at)<NOW()-INTERVAL '24 hours') logistics_over_24h,
        (SELECT COUNT(*)::int FROM gateway_passes WHERE status IN ('Submitted','Pending Procurement Manager / Approver Review')) gateway_pending,
        (SELECT COUNT(*)::int FROM return_passes WHERE status='Submitted') return_pending
    `,
  ]);

  const m = metricRows[0] || {};
  const metrics = {
    totalUsers: Number(m.total_users || 0),
    activeUsers: Number(m.active_users || 0),
    lockedUsers: Number(m.locked_users || 0),
    pendingApprovals: Number(m.pending_approvals || 0),
    openRequests: Number(m.open_requests || 0),
    openPOs: Number(m.open_pos || 0),
    auditEvents: Number(m.audit_events || 0),
    unreadNotifications: Number(m.unread_notifications || 0),
    legacyPayees: Number(m.legacy_payees || 0),
    financeVerificationPending: Number(m.finance_verification_pending || 0),
  };

  const exceptions: AdminExceptionRow[] = [
    { key: "locked-users", title: "Locked user accounts", detail: "Accounts currently blocked by the authentication security controls.", severity: metrics.lockedUsers > 0 ? "High" : "Normal", count: metrics.lockedUsers },
    { key: "pending-approvals", title: "Pending executive approvals", detail: "Requests waiting in the Approver / MD command chain.", severity: metrics.pendingApprovals > 0 ? "Important" : "Normal", count: metrics.pendingApprovals },
    { key: "high-audit", title: "High-severity audit evidence", detail: "Immutable audit events classified as High severity.", severity: evidence.metrics.highSeverity > 0 ? "High" : "Normal", count: evidence.metrics.highSeverity },
    { key: "audit-exceptions", title: "Audit warnings / denials", detail: "Denied, failed or warning outcomes preserved in the evidence ledger.", severity: evidence.metrics.exceptionOutcomes > 0 ? "High" : "Normal", count: evidence.metrics.exceptionOutcomes },
    { key: "payee-migration", title: "Legacy encrypted payee records", detail: "Historical payee ciphertext preserved after GCP exit. Re-entry under v2 is required before protected Finance processing where the legacy key is unavailable.", severity: metrics.legacyPayees > 0 ? "Important" : "Normal", count: metrics.legacyPayees },
    { key: "payee-verification", title: "Payee verification pending", detail: "Current payee records not yet marked Finance Verified.", severity: metrics.financeVerificationPending > 0 ? "Important" : "Normal", count: metrics.financeVerificationPending },
    { key: "notifications", title: "Unread notifications", detail: "Role/user notifications still carrying unread attention state.", severity: metrics.unreadNotifications > 1000 ? "Important" : "Normal", count: metrics.unreadNotifications },
  ];

  return {
    evidence,
    roles: roleRows.map((row) => ({ id:Number(row.id), name:row.name, description:row.description, permissions:Array.isArray(row.permissions) ? row.permissions.map(String) : [] })),
    permissions: permissionRows.map((row) => ({ id:Number(row.id), name:row.name, description:row.description })),
    approvalPolicies: policyRows.map((row) => ({ policyKey:row.policy_key, amount:Number(row.amount || 0), updatedBy:row.updated_by, updateReason:row.update_reason, updatedAt:textDate(row.updated_at) })),
    availability: availabilityRows.map((row) => ({ id:Number(row.id), userName:row.user_name, role:row.role, status:row.status, awayStartDate:textDate(row.away_start_date), awayEndDate:textDate(row.away_end_date), reason:row.reason, urgency:row.urgency, reviewStatus:row.admin_review_status, delegateName:row.delegate_name, delegateRole:row.recommended_delegate_role, adminNote:row.admin_note, createdAt:textDate(row.created_at) })),
    delegations: delegationRows.map((row) => ({ id:Number(row.id), primaryRole:row.primary_role, primaryUser:row.primary_user, delegateRole:row.delegate_role, delegateUser:row.delegate_user, enabled:Boolean(row.enabled), startDate:textDate(row.start_date), endDate:textDate(row.end_date), reason:row.reason, activatedBy:row.activated_by, activationNote:row.activation_note, createdAt:textDate(row.created_at) })),
    tableStats: tableRows.map((row) => ({ tableName:row.table_name, estimatedRows:Number(row.estimated_rows || 0), totalSizeBytes:Number(row.total_size_bytes || 0) })),
    exceptions,
    requestDetails: requestDetailRows.map((row) => ({
      id:Number(row.id),requestNo:row.request_no,requestedBy:row.requested_by,requesterRole:row.requester_role,departmentProject:row.department_project,
      requestDate:textDate(row.request_date),requiredDate:textDate(row.required_date),category:row.category,justification:row.justification,priority:row.priority,
      estimatedAmount:Number(row.estimated_amount||0),vendorPreference:row.vendor_preference,status:row.status,sourceType:row.source_type,notes:row.notes,
      paymentStatus:row.payment_status,nextRole:row.next_role,facilityManager:row.facility_manager,procurementManager:row.procurement_manager,
      approvalDueAt:textDate(row.approval_due_at),submittedAt:textDate(row.submitted_at),approvedAt:textDate(row.approved_at),approvedBy:row.approved_by,
      approvedByRole:row.approved_by_role,paidAt:textDate(row.paid_at),receiptUploadedAt:textDate(row.receipt_uploaded_at),completedAt:textDate(row.completed_at),
      selectedVendor:row.selected_vendor,linkedPoId:row.linked_po_id==null?null:Number(row.linked_po_id),linkedReceivingSlipId:row.linked_receiving_slip_id==null?null:Number(row.linked_receiving_slip_id),
      approvalRescindedAt:textDate(row.approval_rescinded_at),approvalRescindedReason:row.approval_rescinded_reason,createdAt:textDate(row.created_at),updatedAt:textDate(row.updated_at)
    })),
    requestItems: requestItemRows.map((row) => ({id:Number(row.id),requestId:Number(row.request_id),itemName:row.item_name,description:row.description,quantity:Number(row.quantity||0),unitPrice:Number(row.unit_price||0),total:Number(row.total||0),category:row.category,suggestedVendor:row.suggested_vendor})),
    requestStatusCounts: requestStatusRows.map((row) => ({status:row.status,count:Number(row.count||0),amount:Number(row.amount||0)})),
    monthlyProcurement: monthlyRows.map((row) => ({month:row.month,requested:Number(row.requested||0),approved:Number(row.approved||0),paid:Number(row.paid||0)})),
    roleActivity24h: roleActivityRows.map((row) => ({role:row.role,count:Number(row.count||0),lastActivityAt:textDate(row.last_activity_at)})),
    bottlenecks: (() => { const b=bottleneckRows[0]||{}; return [
      {key:"review",title:"Procurement review > 24h",detail:"Requests still waiting for Procurement review after 24 hours.",count:Number(b.review_over_24h||0),statusFilter:"Sent for Procurement Review",section:"All Procurement Records"},
      {key:"approval",title:"Approval queue > 48h",detail:"Requests waiting for Approver / MD longer than 48 hours.",count:Number(b.approval_over_48h||0),statusFilter:"Pending Approval",section:"All Procurement Records"},
      {key:"finance",title:"Finance-ready > 24h",detail:"Approved requests waiting for Finance payment processing.",count:Number(b.finance_over_24h||0),statusFilter:"Approved for Payment",section:"All Procurement Records"},
      {key:"logistics",title:"Logistics handoff > 24h",detail:"Purchase orders still in Logistics movement or receiving stages.",count:Number(b.logistics_over_24h||0),statusFilter:null,section:"All Procurement Records"},
      {key:"gateway",title:"Gateway passes awaiting review",detail:"Submitted Gateway Passes waiting for Procurement or Logistics review.",count:Number(b.gateway_pending||0),statusFilter:null,section:"Gateway Pass Management"},
      {key:"return",title:"Return passes awaiting verification",detail:"Submitted Return Passes waiting for Logistics Manager verification.",count:Number(b.return_pending||0),statusFilter:null,section:"Gateway Pass Management"}
    ]; })(),
    metrics,
  };
}

import { db } from "@/lib/db";
import { getAuditorDashboardData, type AuditorDashboardData } from "./auditor-data";

export type AdminRoleRow = { id: number; name: string; description: string | null; permissions: string[] };
export type AdminPermissionRow = { id: number; name: string; description: string | null };
export type AdminApprovalPolicyRow = { policyKey: string; amount: number; updatedBy: string | null; updateReason: string | null; updatedAt: string | null };
export type AdminAvailabilityRow = { id: number; userName: string | null; role: string | null; status: string | null; awayStartDate: string | null; awayEndDate: string | null; reason: string | null; urgency: string | null; reviewStatus: string | null; delegateName: string | null; delegateRole: string | null; adminNote: string | null; createdAt: string | null };
export type AdminDelegationRow = { id: number; primaryRole: string; primaryUser: string | null; delegateRole: string; delegateUser: string | null; enabled: boolean; startDate: string | null; endDate: string | null; reason: string | null; activatedBy: string | null; activationNote: string | null; createdAt: string | null };
export type AdminTableStatRow = { tableName: string; estimatedRows: number; totalSizeBytes: number };
export type AdminExceptionRow = { key: string; title: string; detail: string; severity: "Critical" | "High" | "Important" | "Normal"; count: number };

export type AdminDashboardData = {
  evidence: AuditorDashboardData;
  roles: AdminRoleRow[];
  permissions: AdminPermissionRow[];
  approvalPolicies: AdminApprovalPolicyRow[];
  availability: AdminAvailabilityRow[];
  delegations: AdminDelegationRow[];
  tableStats: AdminTableStatRow[];
  exceptions: AdminExceptionRow[];
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
    metrics,
  };
}

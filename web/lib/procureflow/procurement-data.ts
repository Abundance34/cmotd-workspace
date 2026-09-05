import { db } from "@/lib/db";

export type ProcurementRequestRow = {
  id: number;
  requestNo: string;
  facilityManager: string | null;
  departmentProject: string | null;
  requestDate: string;
  requiredDate: string | null;
  category: string | null;
  justification: string | null;
  priority: string | null;
  estimatedAmount: number;
  status: string | null;
  paymentStatus: string | null;
  updatedAt: string | null;
};

export type ProcurementDashboardData = {
  metrics: {
    pendingReview: number;
    requiresSourcing: number;
    vendorRecommendation: number;
    approvedProcessed: number;
    activeVendors: number;
    gatewayWaiting: number;
  };
  inbox: ProcurementRequestRow[];
  requests: ProcurementRequestRow[];
  sourcing: ProcurementRequestRow[];
  recommendations: ProcurementRequestRow[];
};

type RawRow = {
  id: number;
  request_no: string;
  facility_manager: string | null;
  department_project: string | null;
  request_date: Date | string;
  required_date: Date | string | null;
  category: string | null;
  justification: string | null;
  priority: string | null;
  estimated_amount: string | number | null;
  status: string | null;
  payment_status: string | null;
  updated_at: Date | string | null;
};

function dateValue(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: RawRow): ProcurementRequestRow {
  return {
    id: Number(row.id),
    requestNo: row.request_no,
    facilityManager: row.facility_manager,
    departmentProject: row.department_project,
    requestDate: dateValue(row.request_date) || "",
    requiredDate: dateValue(row.required_date),
    category: row.category,
    justification: row.justification,
    priority: row.priority,
    estimatedAmount: Number(row.estimated_amount || 0),
    status: row.status,
    paymentStatus: row.payment_status,
    updatedAt: dateValue(row.updated_at),
  };
}

export async function getProcurementDashboardData(userId: number): Promise<ProcurementDashboardData> {
  const sql = db();

  const [metrics, auxiliary] = await Promise.all([
    sql<{
      pending_review: number;
      requires_sourcing: number;
      vendor_recommendation: number;
      approved_processed: number;
    }[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE next_role = 'procurement_manager'
             OR status IN ('Sent for Procurement Review', 'Submitted to Procurement Manager', 'Submitted')
        )::int AS pending_review,
        COUNT(*) FILTER (WHERE status IN ('Requires Sourcing', 'Vendor Quote Collection'))::int AS requires_sourcing,
        COUNT(*) FILTER (WHERE status = 'Vendor Recommendation')::int AS vendor_recommendation,
        COUNT(*) FILTER (
          WHERE status IN ('Approved', 'Awaiting Payment', 'Approved for Payment', 'Paid', 'Completed', 'Closed')
        )::int AS approved_processed
      FROM purchase_requests
      WHERE assigned_procurement_manager_id = ${userId}
         OR assigned_procurement_manager_id IS NULL
    `,
    sql<{ active_vendors: number; gateway_waiting: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM vendors WHERE COALESCE(status, 'Active') = 'Active') AS active_vendors,
        (SELECT COUNT(*)::int FROM gateway_passes WHERE status IN ('Submitted', 'Pending Procurement Manager / Approver Review')) AS gateway_waiting
    `,
  ]);

  const base = sql`
    SELECT
      pr.id, pr.request_no, fm.full_name AS facility_manager,
      pr.department_project, pr.request_date, pr.required_date, pr.category,
      pr.justification, pr.priority, pr.estimated_amount, pr.status,
      pr.payment_status, pr.updated_at
    FROM purchase_requests pr
    LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id
  `;

  const [inboxRows, requestRows, sourcingRows, recommendationRows] = await Promise.all([
    sql<RawRow[]>`
      ${base}
      WHERE (pr.assigned_procurement_manager_id = ${userId} OR pr.assigned_procurement_manager_id IS NULL)
        AND (
          pr.next_role = 'procurement_manager'
          OR pr.status IN ('Sent for Procurement Review', 'Submitted to Procurement Manager', 'Submitted')
        )
      ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC
      LIMIT 100
    `,
    sql<RawRow[]>`
      ${base}
      WHERE pr.assigned_procurement_manager_id = ${userId}
         OR pr.assigned_procurement_manager_id IS NULL
      ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC
      LIMIT 150
    `,
    sql<RawRow[]>`
      ${base}
      WHERE (pr.assigned_procurement_manager_id = ${userId} OR pr.assigned_procurement_manager_id IS NULL)
        AND pr.status IN ('Requires Sourcing', 'Vendor Quote Collection')
      ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC
      LIMIT 100
    `,
    sql<RawRow[]>`
      ${base}
      WHERE (pr.assigned_procurement_manager_id = ${userId} OR pr.assigned_procurement_manager_id IS NULL)
        AND pr.status = 'Vendor Recommendation'
      ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC
      LIMIT 100
    `,
  ]);

  const metric = metrics[0] || { pending_review: 0, requires_sourcing: 0, vendor_recommendation: 0, approved_processed: 0 };
  const aux = auxiliary[0] || { active_vendors: 0, gateway_waiting: 0 };

  return {
    metrics: {
      pendingReview: Number(metric.pending_review || 0),
      requiresSourcing: Number(metric.requires_sourcing || 0),
      vendorRecommendation: Number(metric.vendor_recommendation || 0),
      approvedProcessed: Number(metric.approved_processed || 0),
      activeVendors: Number(aux.active_vendors || 0),
      gatewayWaiting: Number(aux.gateway_waiting || 0),
    },
    inbox: inboxRows.map(mapRow),
    requests: requestRows.map(mapRow),
    sourcing: sourcingRows.map(mapRow),
    recommendations: recommendationRows.map(mapRow),
  };
}

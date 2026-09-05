import { db } from "@/lib/db";

export type ApproverQuoteRow = {
  id: number;
  vendorName: string;
  amount: number;
  currency: string;
  deliveryDays: number;
  rating: number;
  score: number;
  recommended: boolean;
};

export type ApproverRequestRow = {
  id: number;
  requestNo: string;
  departmentProject: string | null;
  category: string | null;
  priority: string | null;
  estimatedAmount: number;
  status: string | null;
  nextRole: string | null;
  requesterName: string | null;
  requesterRole: string | null;
  facilityManagerName: string | null;
  procurementManagerName: string | null;
  updatedAt: string | null;
  sourcingTaskId: number | null;
  sourcingNo: string | null;
  sourcingApprovalStatus: string | null;
  recommendationReason: string | null;
  recommendedVendor: string | null;
  quotes: ApproverQuoteRow[];
};

export type ApproverHistoryRow = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  statusBefore: string | null;
  statusAfter: string | null;
  approvalMode: string | null;
  note: string | null;
  createdAt: string;
};

export type ApproverDashboardData = {
  metrics: {
    pendingRequests: number;
    pendingPOs: number;
    pendingPayments: number;
    pendingGatewayPasses: number;
  };
  approvalLimit: number;
  pendingRequests: ApproverRequestRow[];
  quoteComparisons: ApproverRequestRow[];
  history: ApproverHistoryRow[];
};

type RawRequest = {
  id: number;
  request_no: string;
  department_project: string | null;
  category: string | null;
  priority: string | null;
  estimated_amount: string | number | null;
  status: string | null;
  next_role: string | null;
  requester_name: string | null;
  requester_role: string | null;
  facility_manager_name: string | null;
  procurement_manager_name: string | null;
  updated_at: Date | string | null;
  sourcing_task_id: number | null;
  sourcing_no: string | null;
  sourcing_approval_status: string | null;
  recommendation_reason: string | null;
  recommended_vendor: string | null;
};

type RawQuote = {
  id: number;
  request_id: number;
  vendor_name: string | null;
  registry_vendor_name: string | null;
  quoted_amount: string | number;
  quotation_total: string | number | null;
  currency: string | null;
  delivery_time_days: string | number | null;
  vendor_rating: string | number | null;
  score: string | number | null;
  is_recommended: boolean | null;
};

function dateValue(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getApproverDashboardData(userId: number): Promise<ApproverDashboardData> {
  const sql = db();
  const [policyRows, metrics, pendingRows, quoteRows, historyRows] = await Promise.all([
    sql<{ amount: string | number }[]>`
      SELECT amount FROM approval_policy_settings
      WHERE policy_key = 'procurement_manager_approval_limit'
      LIMIT 1
    `,
    sql<{
      pending_requests: number;
      pending_pos: number;
      pending_payments: number;
      pending_gateway_passes: number;
    }[]>`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM purchase_requests pr
          LEFT JOIN users requester ON requester.id = pr.requested_by
          CROSS JOIN LATERAL (
            SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
          ) policy
          WHERE pr.status IN ('Submitted for Approval','Pending Approver/MD Approval','Pending Approval')
            AND (
              COALESCE(pr.estimated_amount,0) > policy.approval_limit
              OR (COALESCE(pr.estimated_amount,0) <= policy.approval_limit AND requester.role='Procurement Manager')
            )
        ) AS pending_requests,
        (SELECT COUNT(*)::int FROM purchase_orders WHERE status='Pending Approval') AS pending_pos,
        (SELECT COUNT(*)::int FROM payments WHERE status='Pending Approval') AS pending_payments,
        (
          SELECT COUNT(*)::int FROM gateway_passes
          WHERE next_role='approver' OR status='Submitted for Approval'
        ) AS pending_gateway_passes
    `,
    sql<RawRequest[]>`
      WITH policy AS (
        SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
      )
      SELECT
        pr.id, pr.request_no, pr.department_project, pr.category, pr.priority,
        pr.estimated_amount, pr.status, pr.next_role,
        requester.full_name AS requester_name, requester.role AS requester_role,
        fm.full_name AS facility_manager_name,
        pm.full_name AS procurement_manager_name,
        pr.updated_at,
        st.id AS sourcing_task_id, st.sourcing_no,
        st.approval_status AS sourcing_approval_status,
        st.reason_for_recommendation AS recommendation_reason,
        COALESCE(rv.name, recommended_quote.vendor_name, qv.name) AS recommended_vendor
      FROM purchase_requests pr
      LEFT JOIN users requester ON requester.id=pr.requested_by
      LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
      LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id
      LEFT JOIN sourcing_tasks st ON st.id=pr.linked_sourcing_task_id
      LEFT JOIN vendors rv ON rv.id=st.recommended_vendor_id
      LEFT JOIN LATERAL (
        SELECT vq.vendor_name, vq.vendor_id
        FROM vendor_quotes vq
        WHERE vq.sourcing_task_id=st.id AND COALESCE(vq.is_recommended,FALSE)=TRUE
        ORDER BY vq.score DESC NULLS LAST, vq.id DESC
        LIMIT 1
      ) recommended_quote ON TRUE
      LEFT JOIN vendors qv ON qv.id=recommended_quote.vendor_id
      CROSS JOIN policy
      WHERE pr.status IN ('Submitted for Approval','Pending Approver/MD Approval','Pending Approval')
        AND (
          COALESCE(pr.estimated_amount,0) > policy.approval_limit
          OR (COALESCE(pr.estimated_amount,0) <= policy.approval_limit AND requester.role='Procurement Manager')
        )
      ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC, pr.id DESC
      LIMIT 150
    `,
    sql<RawQuote[]>`
      WITH policy AS (
        SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
      )
      SELECT
        vq.id, pr.id AS request_id, vq.vendor_name, v.name AS registry_vendor_name,
        vq.quoted_amount, vq.quotation_total, vq.currency, vq.delivery_time_days,
        vq.vendor_rating, vq.score, vq.is_recommended
      FROM vendor_quotes vq
      JOIN sourcing_tasks st ON st.id=vq.sourcing_task_id
      JOIN purchase_requests pr ON pr.id=st.request_id
      LEFT JOIN users requester ON requester.id=pr.requested_by
      LEFT JOIN vendors v ON v.id=vq.vendor_id
      CROSS JOIN policy
      WHERE pr.status IN ('Submitted for Approval','Pending Approver/MD Approval','Pending Approval')
        AND (
          COALESCE(pr.estimated_amount,0) > policy.approval_limit
          OR (COALESCE(pr.estimated_amount,0) <= policy.approval_limit AND requester.role='Procurement Manager')
        )
      ORDER BY vq.sourcing_task_id, vq.score DESC NULLS LAST, vq.id
    `,
    sql<{
      id: number;
      entity_type: string;
      entity_id: number;
      action: string;
      status_before: string | null;
      status_after: string | null;
      approval_mode: string | null;
      note: string | null;
      created_at: Date | string;
    }[]>`
      SELECT id, entity_type, entity_id, action, status_before, status_after,
             approval_mode, COALESCE(note,reason) AS note, created_at
      FROM approval_history
      WHERE approved_by_user_id=${userId} OR user_id=${userId}
      ORDER BY created_at DESC, id DESC
      LIMIT 150
    `,
  ]);

  const byRequest = new Map<number, ApproverQuoteRow[]>();
  for (const quote of quoteRows) {
    const requestId = Number(quote.request_id);
    const rows = byRequest.get(requestId) || [];
    rows.push({
      id: Number(quote.id),
      vendorName: quote.vendor_name || quote.registry_vendor_name || 'Unnamed vendor',
      amount: Number(quote.quotation_total ?? quote.quoted_amount ?? 0),
      currency: quote.currency || 'NGN',
      deliveryDays: Number(quote.delivery_time_days || 0),
      rating: Number(quote.vendor_rating || 0),
      score: Number(quote.score || 0),
      recommended: Boolean(quote.is_recommended),
    });
    byRequest.set(requestId, rows);
  }

  const pendingRequests = pendingRows.map((row): ApproverRequestRow => ({
    id: Number(row.id),
    requestNo: row.request_no,
    departmentProject: row.department_project,
    category: row.category,
    priority: row.priority,
    estimatedAmount: Number(row.estimated_amount || 0),
    status: row.status,
    nextRole: row.next_role,
    requesterName: row.requester_name,
    requesterRole: row.requester_role,
    facilityManagerName: row.facility_manager_name,
    procurementManagerName: row.procurement_manager_name,
    updatedAt: dateValue(row.updated_at),
    sourcingTaskId: row.sourcing_task_id == null ? null : Number(row.sourcing_task_id),
    sourcingNo: row.sourcing_no,
    sourcingApprovalStatus: row.sourcing_approval_status,
    recommendationReason: row.recommendation_reason,
    recommendedVendor: row.recommended_vendor,
    quotes: byRequest.get(Number(row.id)) || [],
  }));

  const metric = metrics[0] || { pending_requests: 0, pending_pos: 0, pending_payments: 0, pending_gateway_passes: 0 };
  return {
    metrics: {
      pendingRequests: Number(metric.pending_requests || 0),
      pendingPOs: Number(metric.pending_pos || 0),
      pendingPayments: Number(metric.pending_payments || 0),
      pendingGatewayPasses: Number(metric.pending_gateway_passes || 0),
    },
    approvalLimit: Number(policyRows[0]?.amount || 0),
    pendingRequests,
    quoteComparisons: pendingRequests.filter((row) => row.sourcingTaskId != null && row.quotes.length > 0),
    history: historyRows.map((row) => ({
      id: Number(row.id),
      entityType: row.entity_type,
      entityId: Number(row.entity_id),
      action: row.action,
      statusBefore: row.status_before,
      statusAfter: row.status_after,
      approvalMode: row.approval_mode,
      note: row.note,
      createdAt: dateValue(row.created_at) || '',
    })),
  };
}

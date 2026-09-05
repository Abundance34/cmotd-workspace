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

export type ProcurementVendorOption = {
  id: number;
  name: string;
  category: string | null;
  rating: number;
};

export type ProcurementQuoteRow = {
  id: number;
  sourcingTaskId: number;
  vendorId: number | null;
  vendorName: string;
  quotedAmount: number;
  currency: string;
  deliveryDays: number;
  paymentTerms: string | null;
  warranty: string | null;
  vendorRating: number;
  notes: string | null;
  quoteDate: string | null;
  score: number;
  isRecommended: boolean;
  isSelected: boolean;
};

export type ProcurementSourcingTaskRow = {
  id: number;
  sourcingNo: string;
  requestId: number;
  requestNo: string;
  facilityManager: string | null;
  requesterRole: string | null;
  departmentProject: string | null;
  category: string | null;
  estimatedAmount: number;
  requestStatus: string | null;
  taskStatus: string | null;
  approvalStatus: string | null;
  requiredItemService: string | null;
  recommendedVendor: string | null;
  reasonForRecommendation: string | null;
  quoteCount: number;
  lowestQuote: number | null;
  highestQuote: number | null;
  updatedAt: string | null;
  quotes: ProcurementQuoteRow[];
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
  approvalLimit: number;
  inbox: ProcurementRequestRow[];
  requests: ProcurementRequestRow[];
  sourcing: ProcurementRequestRow[];
  recommendations: ProcurementRequestRow[];
  sourcingTasks: ProcurementSourcingTaskRow[];
  vendors: ProcurementVendorOption[];
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

type RawSourcingRow = {
  id: number;
  sourcing_no: string;
  request_id: number;
  request_no: string;
  facility_manager: string | null;
  requester_role: string | null;
  department_project: string | null;
  category: string | null;
  estimated_amount: string | number | null;
  request_status: string | null;
  task_status: string | null;
  approval_status: string | null;
  required_item_service: string | null;
  recommended_vendor: string | null;
  reason_for_recommendation: string | null;
  quote_count: number;
  lowest_quote: string | number | null;
  highest_quote: string | number | null;
  updated_at: Date | string | null;
};

type RawQuoteRow = {
  id: number;
  sourcing_task_id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  registry_vendor_name: string | null;
  quoted_amount: string | number;
  quotation_total: string | number | null;
  currency: string | null;
  delivery_time_days: string | number | null;
  payment_terms: string | null;
  warranty: string | null;
  vendor_rating: number | null;
  notes: string | null;
  quote_date: Date | string | null;
  created_at: Date | string;
  score: string | number | null;
  is_recommended: boolean | null;
  is_selected: boolean;
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

  const [metrics, auxiliary, policyRows] = await Promise.all([
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
    sql<{ amount: string | number }[]>`
      SELECT amount
      FROM approval_policy_settings
      WHERE policy_key = 'procurement_manager_approval_limit'
      LIMIT 1
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

  const [inboxRows, requestRows, sourcingRows, recommendationRows, sourcingTaskRows, quoteRows, vendorRows] = await Promise.all([
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
    sql<RawSourcingRow[]>`
      SELECT
        st.id,
        st.sourcing_no,
        st.request_id,
        pr.request_no,
        fm.full_name AS facility_manager,
        requester.role AS requester_role,
        pr.department_project,
        pr.category,
        pr.estimated_amount,
        pr.status AS request_status,
        st.status AS task_status,
        st.approval_status,
        st.required_item_service,
        rv.name AS recommended_vendor,
        st.reason_for_recommendation,
        COUNT(vq.id)::int AS quote_count,
        MIN(COALESCE(vq.quotation_total, vq.quoted_amount)) AS lowest_quote,
        MAX(COALESCE(vq.quotation_total, vq.quoted_amount)) AS highest_quote,
        COALESCE(st.updated_at, st.created_at) AS updated_at
      FROM sourcing_tasks st
      JOIN purchase_requests pr ON pr.id = st.request_id
      LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id
      LEFT JOIN users requester ON requester.id = pr.requested_by
      LEFT JOIN vendors rv ON rv.id = st.recommended_vendor_id
      LEFT JOIN vendor_quotes vq ON vq.sourcing_task_id = st.id
      WHERE (st.assigned_to = ${userId} OR pr.assigned_procurement_manager_id = ${userId} OR st.assigned_to IS NULL)
        AND pr.status IN ('Requires Sourcing', 'Vendor Quote Collection', 'Vendor Recommendation')
      GROUP BY st.id, st.sourcing_no, st.request_id, pr.request_no, fm.full_name,
               requester.role, pr.department_project, pr.category, pr.estimated_amount, pr.status,
               st.status, st.approval_status, st.required_item_service, rv.name,
               st.reason_for_recommendation, st.updated_at, st.created_at
      ORDER BY COALESCE(st.updated_at, st.created_at) DESC
      LIMIT 100
    `,
    sql<RawQuoteRow[]>`
      SELECT
        vq.id, vq.sourcing_task_id, vq.vendor_id, vq.vendor_name,
        v.name AS registry_vendor_name,
        vq.quoted_amount, vq.quotation_total, vq.currency,
        vq.delivery_time_days, vq.payment_terms, vq.warranty,
        vq.vendor_rating, vq.notes, vq.quote_date, vq.created_at,
        vq.score, vq.is_recommended, vq.is_selected
      FROM vendor_quotes vq
      JOIN sourcing_tasks st ON st.id = vq.sourcing_task_id
      JOIN purchase_requests pr ON pr.id = st.request_id
      LEFT JOIN vendors v ON v.id = vq.vendor_id
      WHERE (st.assigned_to = ${userId} OR pr.assigned_procurement_manager_id = ${userId} OR st.assigned_to IS NULL)
        AND pr.status IN ('Requires Sourcing', 'Vendor Quote Collection', 'Vendor Recommendation')
      ORDER BY vq.created_at DESC, vq.id DESC
      LIMIT 500
    `,
    sql<{ id: number; name: string; category: string | null; rating: number | null }[]>`
      SELECT id, name, category, rating
      FROM vendors
      WHERE COALESCE(status, 'Active') = 'Active'
      ORDER BY name
      LIMIT 500
    `,
  ]);

  const quotesByTask = new Map<number, ProcurementQuoteRow[]>();
  for (const quote of quoteRows) {
    const taskId = Number(quote.sourcing_task_id);
    const mapped: ProcurementQuoteRow = {
      id: Number(quote.id),
      sourcingTaskId: taskId,
      vendorId: quote.vendor_id == null ? null : Number(quote.vendor_id),
      vendorName: quote.vendor_name || quote.registry_vendor_name || "Unnamed vendor",
      quotedAmount: Number(quote.quotation_total ?? quote.quoted_amount ?? 0),
      currency: quote.currency || "NGN",
      deliveryDays: Number(quote.delivery_time_days || 0),
      paymentTerms: quote.payment_terms,
      warranty: quote.warranty,
      vendorRating: Number(quote.vendor_rating || 3),
      notes: quote.notes,
      quoteDate: dateValue(quote.quote_date || quote.created_at),
      score: Number(quote.score || 0),
      isRecommended: Boolean(quote.is_recommended),
      isSelected: Boolean(quote.is_selected),
    };
    const existing = quotesByTask.get(taskId) || [];
    existing.push(mapped);
    quotesByTask.set(taskId, existing);
  }

  const metric = metrics[0] || { pending_review: 0, requires_sourcing: 0, vendor_recommendation: 0, approved_processed: 0 };
  const aux = auxiliary[0] || { active_vendors: 0, gateway_waiting: 0 };
  const approvalLimit = Number(policyRows[0]?.amount || 0);

  return {
    metrics: {
      pendingReview: Number(metric.pending_review || 0),
      requiresSourcing: Number(metric.requires_sourcing || 0),
      vendorRecommendation: Number(metric.vendor_recommendation || 0),
      approvedProcessed: Number(metric.approved_processed || 0),
      activeVendors: Number(aux.active_vendors || 0),
      gatewayWaiting: Number(aux.gateway_waiting || 0),
    },
    approvalLimit,
    inbox: inboxRows.map(mapRow),
    requests: requestRows.map(mapRow),
    sourcing: sourcingRows.map(mapRow),
    recommendations: recommendationRows.map(mapRow),
    sourcingTasks: sourcingTaskRows.map((task) => {
      const quotes = quotesByTask.get(Number(task.id)) || [];
      const recommendedQuote = quotes.find((quote) => quote.isRecommended);
      return {
        id: Number(task.id),
        sourcingNo: task.sourcing_no,
        requestId: Number(task.request_id),
        requestNo: task.request_no,
        facilityManager: task.facility_manager,
        requesterRole: task.requester_role,
        departmentProject: task.department_project,
        category: task.category,
        estimatedAmount: Number(task.estimated_amount || 0),
        requestStatus: task.request_status,
        taskStatus: task.task_status,
        approvalStatus: task.approval_status,
        requiredItemService: task.required_item_service,
        recommendedVendor: task.recommended_vendor || recommendedQuote?.vendorName || null,
        reasonForRecommendation: task.reason_for_recommendation,
        quoteCount: Number(task.quote_count || 0),
        lowestQuote: task.lowest_quote == null ? null : Number(task.lowest_quote),
        highestQuote: task.highest_quote == null ? null : Number(task.highest_quote),
        updatedAt: dateValue(task.updated_at),
        quotes,
      };
    }),
    vendors: vendorRows.map((vendor) => ({
      id: Number(vendor.id),
      name: vendor.name,
      category: vendor.category,
      rating: Number(vendor.rating || 3),
    })),
  };
}

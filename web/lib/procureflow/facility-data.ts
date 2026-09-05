import { db } from "@/lib/db";

export type FacilityRequestRow = {
  id: number;
  requestNo: string;
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

export type FacilityDashboardData = {
  metrics: {
    pendingReview: number;
    pendingApproval: number;
    awaitingPayment: number;
    pendingReceipt: number;
  };
  drafts: FacilityRequestRow[];
  returned: FacilityRequestRow[];
  approved: FacilityRequestRow[];
  recent: FacilityRequestRow[];
};

type RawRequestRow = {
  id: number;
  request_no: string;
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

function serializeDate(value: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRequest(row: RawRequestRow): FacilityRequestRow {
  return {
    id: Number(row.id),
    requestNo: row.request_no,
    departmentProject: row.department_project,
    requestDate: serializeDate(row.request_date) || "",
    requiredDate: serializeDate(row.required_date),
    category: row.category,
    justification: row.justification,
    priority: row.priority,
    estimatedAmount: Number(row.estimated_amount || 0),
    status: row.status,
    paymentStatus: row.payment_status,
    updatedAt: serializeDate(row.updated_at),
  };
}

export async function getFacilityDashboardData(userId: number): Promise<FacilityDashboardData> {
  const sql = db();
  const metrics = await sql<{
    pending_review: number;
    pending_approval: number;
    awaiting_payment: number;
    pending_receipt: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE status IN (
          'Sent for Procurement Review', 'Submitted to Procurement Manager',
          'Requires Sourcing', 'Vendor Quote Collection', 'Vendor Recommendation'
        )
      )::int AS pending_review,
      COUNT(*) FILTER (
        WHERE status IN ('Reviewed by Procurement', 'Submitted for Approval', 'Pending Approver/MD Approval')
      )::int AS pending_approval,
      COUNT(*) FILTER (
        WHERE status IN ('Approved', 'PO Created', 'Awaiting Payment', 'Approved for Payment')
           OR payment_status = 'Approved for Payment'
      )::int AS awaiting_payment,
      COUNT(*) FILTER (
        WHERE status = 'Paid' AND receipt_uploaded_at IS NULL
      )::int AS pending_receipt
    FROM purchase_requests
    WHERE requested_by = ${userId}
       OR facility_manager_user_id = ${userId}
  `;

  const baseSelect = sql`
    SELECT
      id,
      request_no,
      department_project,
      request_date,
      required_date,
      category,
      justification,
      priority,
      estimated_amount,
      status,
      payment_status,
      updated_at
    FROM purchase_requests
  `;

  const drafts = await sql<RawRequestRow[]>`
    ${baseSelect}
    WHERE (requested_by = ${userId} OR facility_manager_user_id = ${userId})
      AND status IN ('FM Draft', 'Draft')
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 100
  `;

  const returned = await sql<RawRequestRow[]>`
    ${baseSelect}
    WHERE (requested_by = ${userId} OR facility_manager_user_id = ${userId})
      AND status IN ('Returned for Correction', 'Returned to Facility Manager', 'Returned')
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 100
  `;

  const approved = await sql<RawRequestRow[]>`
    ${baseSelect}
    WHERE (requested_by = ${userId} OR facility_manager_user_id = ${userId})
      AND status IN ('Approved', 'PO Created', 'Awaiting Payment', 'Approved for Payment', 'Paid', 'Completed', 'Closed')
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 100
  `;

  const recent = await sql<RawRequestRow[]>`
    ${baseSelect}
    WHERE requested_by = ${userId}
       OR facility_manager_user_id = ${userId}
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 30
  `;

  const metric = metrics[0] || {
    pending_review: 0,
    pending_approval: 0,
    awaiting_payment: 0,
    pending_receipt: 0,
  };

  return {
    metrics: {
      pendingReview: Number(metric.pending_review || 0),
      pendingApproval: Number(metric.pending_approval || 0),
      awaitingPayment: Number(metric.awaiting_payment || 0),
      pendingReceipt: Number(metric.pending_receipt || 0),
    },
    drafts: drafts.map(mapRequest),
    returned: returned.map(mapRequest),
    approved: approved.map(mapRequest),
    recent: recent.map(mapRequest),
  };
}

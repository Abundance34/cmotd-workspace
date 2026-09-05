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

export type ApproverPOItemRow = {
  id: number;
  itemName: string;
  description: string | null;
  category: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type ApproverPORow = {
  id: number;
  poNo: string;
  requestNo: string | null;
  vendorName: string | null;
  poDate: string | null;
  expectedDeliveryDate: string | null;
  status: string | null;
  totalAmount: number;
  paymentStatus: string | null;
  receivingStatus: string | null;
  nextRole: string | null;
  createdByName: string | null;
  createdByRole: string | null;
  updatedAt: string | null;
  items: ApproverPOItemRow[];
};

export type ApproverPaymentRow = {
  id: number;
  paymentNo: string;
  requestNo: string | null;
  poNo: string | null;
  vendorName: string | null;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  transferType: string | null;
  paymentReference: string | null;
  paymentDate: string | null;
  status: string | null;
  verificationStatus: string | null;
  nextRole: string | null;
  createdByName: string | null;
  createdByRole: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ApproverGatewayItemRow = {
  id: number;
  description: string;
  category: string | null;
  quantity: number;
  unitOfMeasure: string;
  qualityCondition: string;
  estimatedValue: number;
  serialNumber: string | null;
  assetTag: string | null;
  colour: string | null;
  fragilityStatus: string;
  handlingInstruction: string | null;
  remarks: string | null;
};

export type ApproverGatewayPassRow = {
  id: number;
  passNumber: string;
  facilityManagerName: string | null;
  department: string | null;
  movementType: string;
  purpose: string;
  originLocation: string | null;
  destination: string | null;
  expectedMovementDate: string | null;
  expectedReturnDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  receiverName: string | null;
  receiverOrganization: string | null;
  status: string | null;
  nextRole: string | null;
  procurementReviewNote: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  items: ApproverGatewayItemRow[];
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
  pendingPOs: ApproverPORow[];
  pendingPayments: ApproverPaymentRow[];
  pendingGatewayPasses: ApproverGatewayPassRow[];
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

type RawPO = {
  id: number;
  po_no: string;
  request_no: string | null;
  vendor_name: string | null;
  po_date: Date | string | null;
  expected_delivery_date: Date | string | null;
  status: string | null;
  total_amount: string | number | null;
  payment_status: string | null;
  receiving_status: string | null;
  next_role: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  updated_at: Date | string | null;
};

type RawPOItem = {
  id: number;
  po_id: number;
  item_name: string;
  description: string | null;
  category: string | null;
  quantity: string | number;
  unit_price: string | number;
  total: string | number;
};

type RawPayment = {
  id: number;
  payment_no: string;
  request_no: string | null;
  po_no: string | null;
  vendor_name: string | null;
  amount: string | number;
  currency: string | null;
  payment_method: string | null;
  transfer_type: string | null;
  payment_reference: string | null;
  payment_date: Date | string | null;
  status: string | null;
  verification_status: string | null;
  next_role: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type RawGateway = {
  id: number;
  pass_number: string;
  facility_manager_name: string | null;
  department: string | null;
  movement_type: string;
  purpose: string;
  origin_location: string | null;
  destination: string | null;
  expected_movement_date: Date | string | null;
  expected_return_date: Date | string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  receiver_name: string | null;
  receiver_organization: string | null;
  status: string | null;
  next_role: string | null;
  procurement_review_note: string | null;
  reviewed_at: Date | string | null;
  submitted_at: Date | string | null;
  updated_at: Date | string | null;
};

type RawGatewayItem = {
  id: number;
  gateway_pass_id: number;
  item_description: string;
  item_category: string | null;
  quantity: string | number;
  unit_of_measure: string;
  quality_condition: string;
  estimated_value: string | number | null;
  serial_number: string | null;
  asset_tag: string | null;
  colour: string | null;
  fragility_status: string;
  handling_instruction: string | null;
  remarks: string | null;
};

function dateValue(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getApproverDashboardData(userId: number): Promise<ApproverDashboardData> {
  const sql = db();
  const [
    policyRows,
    metrics,
    pendingRows,
    quoteRows,
    poRows,
    poItemRows,
    paymentRows,
    gatewayRows,
    gatewayItemRows,
    historyRows,
  ] = await Promise.all([
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
      WITH policy AS (
        SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
      )
      SELECT
        (
          SELECT COUNT(*)::int
          FROM purchase_requests pr
          LEFT JOIN users requester ON requester.id = pr.requested_by
          CROSS JOIN policy
          WHERE pr.status IN ('Submitted for Approval','Pending Approver/MD Approval','Pending Approval')
            AND (
              COALESCE(pr.estimated_amount,0) > policy.approval_limit
              OR (COALESCE(pr.estimated_amount,0) <= policy.approval_limit AND requester.role='Procurement Manager')
            )
        ) AS pending_requests,
        (
          SELECT COUNT(*)::int
          FROM purchase_orders po
          CROSS JOIN policy
          WHERE po.status='Pending Approval'
            AND COALESCE(po.total_amount,0) > policy.approval_limit
        ) AS pending_pos,
        (
          SELECT COUNT(*)::int
          FROM payments p
          CROSS JOIN policy
          WHERE p.status='Pending Approval'
            AND COALESCE(p.amount,0) > policy.approval_limit
        ) AS pending_payments,
        (
          SELECT COUNT(*)::int FROM gateway_passes gp
          WHERE gp.next_role='approver' OR gp.status IN ('Submitted for Approval','Pending Approval')
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
    sql<RawPO[]>`
      WITH policy AS (
        SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
      )
      SELECT po.id, po.po_no, pr.request_no, v.name AS vendor_name,
             po.po_date, po.expected_delivery_date, po.status, po.total_amount,
             po.payment_status, po.receiving_status, po.next_role,
             creator.full_name AS created_by_name, creator.role AS created_by_role,
             po.updated_at
      FROM purchase_orders po
      LEFT JOIN purchase_requests pr ON pr.id=po.request_id
      LEFT JOIN vendors v ON v.id=po.vendor_id
      LEFT JOIN users creator ON creator.id=po.created_by
      CROSS JOIN policy
      WHERE po.status='Pending Approval'
        AND COALESCE(po.total_amount,0) > policy.approval_limit
      ORDER BY COALESCE(po.updated_at,po.created_at) DESC, po.id DESC
      LIMIT 150
    `,
    sql<RawPOItem[]>`
      WITH policy AS (
        SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
      )
      SELECT poi.id, poi.po_id, poi.item_name, poi.description, poi.category,
             poi.quantity, poi.unit_price, poi.total
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id=poi.po_id
      CROSS JOIN policy
      WHERE po.status='Pending Approval'
        AND COALESCE(po.total_amount,0) > policy.approval_limit
      ORDER BY poi.po_id, poi.id
    `,
    sql<RawPayment[]>`
      WITH policy AS (
        SELECT COALESCE((SELECT amount FROM approval_policy_settings WHERE policy_key='procurement_manager_approval_limit' LIMIT 1), 0) AS approval_limit
      )
      SELECT p.id, p.payment_no, pr.request_no, po.po_no, v.name AS vendor_name,
             p.amount, p.currency, p.payment_method, p.transfer_type,
             p.payment_reference, p.payment_date, p.status, p.verification_status,
             p.next_role, creator.full_name AS created_by_name,
             creator.role AS created_by_role, p.created_at, p.updated_at
      FROM payments p
      LEFT JOIN purchase_requests pr ON pr.id=p.request_id
      LEFT JOIN purchase_orders po ON po.id=p.po_id
      LEFT JOIN vendors v ON v.id=p.vendor_id
      LEFT JOIN users creator ON creator.id=p.created_by
      CROSS JOIN policy
      WHERE p.status='Pending Approval'
        AND COALESCE(p.amount,0) > policy.approval_limit
      ORDER BY COALESCE(p.updated_at,p.created_at) DESC, p.id DESC
      LIMIT 150
    `,
    sql<RawGateway[]>`
      SELECT gp.id, gp.pass_number, fm.full_name AS facility_manager_name,
             gp.department, gp.movement_type, gp.purpose, gp.origin_location,
             gp.destination, gp.expected_movement_date, gp.expected_return_date,
             gp.vehicle_number, gp.driver_name, gp.driver_phone,
             gp.receiver_name, gp.receiver_organization, gp.status, gp.next_role,
             gp.procurement_review_note, gp.reviewed_at, gp.submitted_at, gp.updated_at
      FROM gateway_passes gp
      LEFT JOIN users fm ON fm.id=gp.facility_manager_user_id
      WHERE gp.next_role='approver'
         OR gp.status IN ('Submitted for Approval','Pending Approval')
      ORDER BY COALESCE(gp.updated_at,gp.submitted_at,gp.created_at) DESC, gp.id DESC
      LIMIT 150
    `,
    sql<RawGatewayItem[]>`
      SELECT gpi.id, gpi.gateway_pass_id, gpi.item_description, gpi.item_category,
             gpi.quantity, gpi.unit_of_measure, gpi.quality_condition,
             gpi.estimated_value, gpi.serial_number, gpi.asset_tag, gpi.colour,
             gpi.fragility_status, gpi.handling_instruction, gpi.remarks
      FROM gateway_pass_items gpi
      JOIN gateway_passes gp ON gp.id=gpi.gateway_pass_id
      WHERE gp.next_role='approver'
         OR gp.status IN ('Submitted for Approval','Pending Approval')
      ORDER BY gpi.gateway_pass_id, gpi.id
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

  const quotesByRequest = new Map<number, ApproverQuoteRow[]>();
  for (const quote of quoteRows) {
    const requestId = Number(quote.request_id);
    const rows = quotesByRequest.get(requestId) || [];
    rows.push({
      id: Number(quote.id),
      vendorName: quote.vendor_name || quote.registry_vendor_name || "Unnamed vendor",
      amount: Number(quote.quotation_total ?? quote.quoted_amount ?? 0),
      currency: quote.currency || "NGN",
      deliveryDays: Number(quote.delivery_time_days || 0),
      rating: Number(quote.vendor_rating || 0),
      score: Number(quote.score || 0),
      recommended: Boolean(quote.is_recommended),
    });
    quotesByRequest.set(requestId, rows);
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
    quotes: quotesByRequest.get(Number(row.id)) || [],
  }));

  const poItemsById = new Map<number, ApproverPOItemRow[]>();
  for (const item of poItemRows) {
    const poId = Number(item.po_id);
    const rows = poItemsById.get(poId) || [];
    rows.push({
      id: Number(item.id),
      itemName: item.item_name,
      description: item.description,
      category: item.category,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unit_price || 0),
      total: Number(item.total || 0),
    });
    poItemsById.set(poId, rows);
  }

  const gatewayItemsById = new Map<number, ApproverGatewayItemRow[]>();
  for (const item of gatewayItemRows) {
    const gatewayId = Number(item.gateway_pass_id);
    const rows = gatewayItemsById.get(gatewayId) || [];
    rows.push({
      id: Number(item.id),
      description: item.item_description,
      category: item.item_category,
      quantity: Number(item.quantity || 0),
      unitOfMeasure: item.unit_of_measure,
      qualityCondition: item.quality_condition,
      estimatedValue: Number(item.estimated_value || 0),
      serialNumber: item.serial_number,
      assetTag: item.asset_tag,
      colour: item.colour,
      fragilityStatus: item.fragility_status,
      handlingInstruction: item.handling_instruction,
      remarks: item.remarks,
    });
    gatewayItemsById.set(gatewayId, rows);
  }

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
    pendingPOs: poRows.map((row): ApproverPORow => ({
      id: Number(row.id),
      poNo: row.po_no,
      requestNo: row.request_no,
      vendorName: row.vendor_name,
      poDate: dateValue(row.po_date),
      expectedDeliveryDate: dateValue(row.expected_delivery_date),
      status: row.status,
      totalAmount: Number(row.total_amount || 0),
      paymentStatus: row.payment_status,
      receivingStatus: row.receiving_status,
      nextRole: row.next_role,
      createdByName: row.created_by_name,
      createdByRole: row.created_by_role,
      updatedAt: dateValue(row.updated_at),
      items: poItemsById.get(Number(row.id)) || [],
    })),
    pendingPayments: paymentRows.map((row): ApproverPaymentRow => ({
      id: Number(row.id),
      paymentNo: row.payment_no,
      requestNo: row.request_no,
      poNo: row.po_no,
      vendorName: row.vendor_name,
      amount: Number(row.amount || 0),
      currency: row.currency || "NGN",
      paymentMethod: row.payment_method,
      transferType: row.transfer_type,
      paymentReference: row.payment_reference,
      paymentDate: dateValue(row.payment_date),
      status: row.status,
      verificationStatus: row.verification_status,
      nextRole: row.next_role,
      createdByName: row.created_by_name,
      createdByRole: row.created_by_role,
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
    })),
    pendingGatewayPasses: gatewayRows.map((row): ApproverGatewayPassRow => ({
      id: Number(row.id),
      passNumber: row.pass_number,
      facilityManagerName: row.facility_manager_name,
      department: row.department,
      movementType: row.movement_type,
      purpose: row.purpose,
      originLocation: row.origin_location,
      destination: row.destination,
      expectedMovementDate: dateValue(row.expected_movement_date),
      expectedReturnDate: dateValue(row.expected_return_date),
      vehicleNumber: row.vehicle_number,
      driverName: row.driver_name,
      driverPhone: row.driver_phone,
      receiverName: row.receiver_name,
      receiverOrganization: row.receiver_organization,
      status: row.status,
      nextRole: row.next_role,
      procurementReviewNote: row.procurement_review_note,
      reviewedAt: dateValue(row.reviewed_at),
      submittedAt: dateValue(row.submitted_at),
      updatedAt: dateValue(row.updated_at),
      items: gatewayItemsById.get(Number(row.id)) || [],
    })),
    history: historyRows.map((row) => ({
      id: Number(row.id),
      entityType: row.entity_type,
      entityId: Number(row.entity_id),
      action: row.action,
      statusBefore: row.status_before,
      statusAfter: row.status_after,
      approvalMode: row.approval_mode,
      note: row.note,
      createdAt: dateValue(row.created_at) || "",
    })),
  };
}

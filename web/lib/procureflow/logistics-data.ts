import { db } from "@/lib/db";

export type LogisticsPORow = {
  id: number;
  poNo: string;
  requestId: number | null;
  requestNo: string | null;
  vendorName: string | null;
  totalAmount: number;
  expectedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  status: string | null;
  logisticsStatus: string | null;
  receivingStatus: string | null;
  nextRole: string | null;
  vendorDeliveryContact: string | null;
  deliveryAddress: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleNumber: string | null;
  waybillNumber: string | null;
  deliveryInstructions: string | null;
  deliveryExceptionStatus: string | null;
  releasedToLogisticsAt: string | null;
  updatedAt: string | null;
};

export type LogisticsReceivingRow = {
  id: number;
  slipNo: string;
  poId: number;
  poNo: string | null;
  requestNo: string | null;
  vendorName: string | null;
  receivedByName: string | null;
  dateReceived: string | null;
  deliveryNoteNo: string | null;
  discrepancyNotes: string | null;
  status: string | null;
  createdAt: string | null;
};

export type LogisticsExceptionRow = {
  id: number;
  exceptionNo: string;
  poId: number;
  poNo: string | null;
  requestNo: string | null;
  exceptionType: string;
  description: string;
  paymentImpact: boolean;
  status: string | null;
  resolutionNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LogisticsGatewayRow = {
  id: number;
  passNumber: string;
  movementType: string;
  purpose: string;
  destination: string | null;
  expectedMovementDate: string | null;
  status: string | null;
  logisticsStatus: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
};

export type LogisticsDashboardData = {
  metrics: {
    awaitingHandover: number;
    activeDeliveries: number;
    receivingPending: number;
    exceptions: number;
    gatewayPasses: number;
  };
  handover: LogisticsPORow[];
  tracking: LogisticsPORow[];
  receivingPending: LogisticsPORow[];
  receivingSlips: LogisticsReceivingRow[];
  exceptions: LogisticsExceptionRow[];
  gatewayPasses: LogisticsGatewayRow[];
};

function dateValue(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapPO(row: any): LogisticsPORow {
  return {
    id: Number(row.id),
    poNo: row.po_no,
    requestId: row.request_id == null ? null : Number(row.request_id),
    requestNo: row.request_no,
    vendorName: row.vendor_name,
    totalAmount: Number(row.total_amount || 0),
    expectedDeliveryDate: dateValue(row.expected_delivery_date),
    actualDeliveryDate: dateValue(row.actual_delivery_date),
    status: row.status,
    logisticsStatus: row.logistics_status,
    receivingStatus: row.receiving_status,
    nextRole: row.next_role,
    vendorDeliveryContact: row.vendor_delivery_contact,
    deliveryAddress: row.delivery_address,
    driverName: row.driver_name,
    driverPhone: row.driver_phone,
    vehicleNumber: row.vehicle_number,
    waybillNumber: row.waybill_number,
    deliveryInstructions: row.delivery_instructions,
    deliveryExceptionStatus: row.delivery_exception_status,
    releasedToLogisticsAt: dateValue(row.released_to_logistics_at),
    updatedAt: dateValue(row.updated_at),
  };
}

export async function getLogisticsDashboardData(): Promise<LogisticsDashboardData> {
  const sql = db();
  const baseSelect = sql`
    SELECT po.id,po.po_no,po.request_id,pr.request_no,v.name AS vendor_name,po.total_amount,
           po.expected_delivery_date,po.actual_delivery_date,po.status,po.logistics_status,
           po.receiving_status,po.next_role,po.vendor_delivery_contact,po.delivery_address,
           po.driver_name,po.driver_phone,po.vehicle_number,po.waybill_number,
           po.delivery_instructions,po.delivery_exception_status,po.released_to_logistics_at,po.updated_at
    FROM purchase_orders po
    LEFT JOIN purchase_requests pr ON pr.id=po.request_id
    LEFT JOIN vendors v ON v.id=po.vendor_id
  `;

  const [metrics, handoverRows, trackingRows, receivingRows, slipRows, exceptionRows, gatewayRows] = await Promise.all([
    sql<{
      awaiting_handover: number; active_deliveries: number; receiving_pending: number;
      exceptions: number; gateway_passes: number;
    }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM purchase_orders WHERE status='Released to Logistics' OR (next_role='logistics_officer' AND COALESCE(logistics_status,'')='Awaiting Handover')) AS awaiting_handover,
        (SELECT COUNT(*)::int FROM purchase_orders WHERE next_role='logistics_officer' AND status IN ('Scheduled','Sent to Vendor','Dispatched','In Transit','Delayed')) AS active_deliveries,
        (SELECT COUNT(*)::int FROM purchase_orders WHERE next_role='logistics_officer' AND status IN ('Arrived','Awaiting Delivery','Partially Received') AND COALESCE(receiving_status,'Pending Receipt') IN ('Pending Receipt','Partially Received','Disputed')) AS receiving_pending,
        (SELECT COUNT(*)::int FROM logistics_exceptions WHERE status IN ('Open','In Progress')) AS exceptions,
        (SELECT COUNT(*)::int FROM gateway_passes WHERE status IN ('Approved','Generated','Downloaded') AND COALESCE(logistics_status,'Not Coordinated') NOT IN ('Completed','Exited')) AS gateway_passes
    `,
    sql<any[]>`
      ${baseSelect}
      WHERE po.status='Released to Logistics'
         OR (po.next_role='logistics_officer' AND COALESCE(po.logistics_status,'')='Awaiting Handover')
      ORDER BY po.released_to_logistics_at DESC NULLS LAST,po.updated_at DESC
      LIMIT 150
    `,
    sql<any[]>`
      ${baseSelect}
      WHERE po.next_role='logistics_officer'
         OR po.status IN ('Released to Logistics','Scheduled','Sent to Vendor','Dispatched','In Transit','Delayed','Arrived','Awaiting Delivery','Partially Received')
      ORDER BY po.expected_delivery_date ASC NULLS LAST,po.updated_at DESC
      LIMIT 200
    `,
    sql<any[]>`
      ${baseSelect}
      WHERE po.next_role='logistics_officer'
        AND po.status IN ('Arrived','Awaiting Delivery','Partially Received')
        AND COALESCE(po.receiving_status,'Pending Receipt') IN ('Pending Receipt','Partially Received','Disputed')
      ORDER BY po.expected_delivery_date ASC NULLS LAST,po.updated_at DESC
      LIMIT 150
    `,
    sql<{
      id: number; slip_no: string; po_id: number; po_no: string | null; request_no: string | null;
      vendor_name: string | null; received_by_name: string | null; date_received: Date | string | null;
      delivery_note_no: string | null; discrepancy_notes: string | null; status: string | null;
      created_at: Date | string | null;
    }[]>`
      SELECT rs.id,rs.slip_no,rs.po_id,po.po_no,pr.request_no,v.name AS vendor_name,
             u.full_name AS received_by_name,rs.date_received,rs.delivery_note_no,
             rs.discrepancy_notes,rs.status,rs.created_at
      FROM receiving_slips rs
      LEFT JOIN purchase_orders po ON po.id=rs.po_id
      LEFT JOIN purchase_requests pr ON pr.id=po.request_id
      LEFT JOIN vendors v ON v.id=rs.vendor_id
      LEFT JOIN users u ON u.id=COALESCE(rs.logistics_officer_id,rs.received_by)
      ORDER BY rs.created_at DESC,rs.id DESC LIMIT 200
    `,
    sql<{
      id: number; exception_no: string; po_id: number; po_no: string | null; request_no: string | null;
      exception_type: string; description: string; payment_impact: boolean | null; status: string | null;
      resolution_note: string | null; created_at: Date | string | null; updated_at: Date | string | null;
    }[]>`
      SELECT le.id,le.exception_no,le.po_id,po.po_no,pr.request_no,le.exception_type,
             le.description,le.payment_impact,le.status,le.resolution_note,le.created_at,le.updated_at
      FROM logistics_exceptions le
      LEFT JOIN purchase_orders po ON po.id=le.po_id
      LEFT JOIN purchase_requests pr ON pr.id=le.request_id
      ORDER BY COALESCE(le.updated_at,le.created_at) DESC,le.id DESC LIMIT 200
    `,
    sql<{
      id: number; pass_number: string; movement_type: string; purpose: string; destination: string | null;
      expected_movement_date: Date | string | null; status: string | null; logistics_status: string | null;
      vehicle_number: string | null; driver_name: string | null;
    }[]>`
      SELECT id,pass_number,movement_type,purpose,destination,expected_movement_date,status,
             logistics_status,vehicle_number,driver_name
      FROM gateway_passes
      WHERE status IN ('Approved','Generated','Downloaded')
        AND COALESCE(logistics_status,'Not Coordinated') NOT IN ('Completed','Exited')
      ORDER BY expected_movement_date ASC NULLS LAST,updated_at DESC LIMIT 150
    `,
  ]);

  const metric = metrics[0] || { awaiting_handover: 0, active_deliveries: 0, receiving_pending: 0, exceptions: 0, gateway_passes: 0 };
  return {
    metrics: {
      awaitingHandover: Number(metric.awaiting_handover || 0),
      activeDeliveries: Number(metric.active_deliveries || 0),
      receivingPending: Number(metric.receiving_pending || 0),
      exceptions: Number(metric.exceptions || 0),
      gatewayPasses: Number(metric.gateway_passes || 0),
    },
    handover: handoverRows.map(mapPO),
    tracking: trackingRows.map(mapPO),
    receivingPending: receivingRows.map(mapPO),
    receivingSlips: slipRows.map((row) => ({
      id: Number(row.id), slipNo: row.slip_no, poId: Number(row.po_id), poNo: row.po_no,
      requestNo: row.request_no, vendorName: row.vendor_name, receivedByName: row.received_by_name,
      dateReceived: dateValue(row.date_received), deliveryNoteNo: row.delivery_note_no,
      discrepancyNotes: row.discrepancy_notes, status: row.status, createdAt: dateValue(row.created_at),
    })),
    exceptions: exceptionRows.map((row) => ({
      id: Number(row.id), exceptionNo: row.exception_no, poId: Number(row.po_id), poNo: row.po_no,
      requestNo: row.request_no, exceptionType: row.exception_type, description: row.description,
      paymentImpact: Boolean(row.payment_impact), status: row.status, resolutionNote: row.resolution_note,
      createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at),
    })),
    gatewayPasses: gatewayRows.map((row) => ({
      id: Number(row.id), passNumber: row.pass_number, movementType: row.movement_type,
      purpose: row.purpose, destination: row.destination, expectedMovementDate: dateValue(row.expected_movement_date),
      status: row.status, logisticsStatus: row.logistics_status, vehicleNumber: row.vehicle_number,
      driverName: row.driver_name,
    })),
  };
}

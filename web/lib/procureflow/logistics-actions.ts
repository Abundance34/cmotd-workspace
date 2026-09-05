import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

export type LogisticsDeliveryStatus = "Scheduled" | "Sent to Vendor" | "Dispatched" | "In Transit" | "Delayed" | "Arrived";
export type GatewayMovementStatus = "Scheduled" | "Entered" | "Exited" | "Completed";

function assertLogistics(user: CurrentUser) {
  if (user.role !== "Logistics Officer" && user.role !== "Admin") {
    throw new Error("Only Logistics Officer or Admin can perform this logistics action.");
  }
}

function requireId(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`A valid ${label} is required.`);
}

function dateOnly(value: string, label: string) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be a valid date.`);
  return text;
}

function ref(prefix: string) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  return `${prefix}-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function notifyRole(
  tx: any,
  role: string,
  title: string,
  message: string,
  entityType: string,
  entityId: number,
  sectionTarget: string,
  actionLabel: string,
  importance = "Normal",
) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
      delivery_channel,push_sent,email_sent,action_label,section_target,created_at
    ) VALUES (
      NULL,${role},${title},${message},${entityType},${entityId},FALSE,FALSE,${importance},
      'in_app',FALSE,FALSE,${actionLabel},${sectionTarget},${now}
    )
  `;
}

async function notifyUser(
  tx: any,
  userId: number | null,
  title: string,
  message: string,
  entityType: string,
  entityId: number,
  sectionTarget: string,
  actionLabel: string,
  importance = "Normal",
) {
  if (!userId) return;
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
      delivery_channel,push_sent,email_sent,action_label,section_target,created_at
    ) VALUES (
      ${userId},NULL,${title},${message},${entityType},${entityId},FALSE,FALSE,${importance},
      'in_app',FALSE,FALSE,${actionLabel},${sectionTarget},${now}
    )
  `;
}

async function evidence(
  tx: any,
  input: {
    user: CurrentUser;
    entityType: string;
    entityId: number;
    entityReference: string;
    action: string;
    status?: string | null;
    note?: string | null;
    beforeValues?: Record<string, unknown> | null;
    afterValues?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    relatedUserId?: number | null;
    severity?: string;
  },
) {
  const now = new Date().toISOString();
  const note = String(input.note || "").trim() || null;
  await tx`
    INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
    VALUES (${input.entityType},${input.entityId},${input.action},${input.status ?? null},${note},${input.user.id},${now})
  `;
  await tx`
    INSERT INTO activity_logs (
      user_id,role,action,entity_type,entity_id,public_summary,private_details,
      visibility_scope,related_user_id,created_at
    ) VALUES (
      ${input.user.id},${input.user.role},${input.action},${input.entityType},${input.entityId},
      ${`${input.entityReference}: ${input.action}`},${note},'workflow',${input.relatedUserId ?? null},${now}
    )
  `;
  await tx`
    INSERT INTO audit_logs (
      action,entity_type,entity_id,user_id,role,details,before_values,after_values,
      created_at,event_date,event_time,notes
    ) VALUES (
      ${input.action},${input.entityType},${String(input.entityId)},${input.user.id},${input.user.role},${note},
      ${tx.json(input.beforeValues ?? null)},${tx.json(input.afterValues ?? null)},
      ${now},${now.slice(0, 10)},${now.slice(11, 19)},${note}
    )
  `;
  await appendAuditEvent(tx, {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityReference: input.entityReference,
    actorUserId: input.user.id,
    actorUsername: input.user.username,
    actorRole: input.user.role,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
    metadata: input.metadata ?? null,
    reasonOrComment: note,
    severity: input.severity || "Normal",
    source: "nextjs",
  });
}

async function poContext(tx: any, poId: number) {
  const rows = await tx<{
    id: number; po_no: string; request_id: number | null; request_no: string | null;
    vendor_id: number | null; vendor_name: string | null; status: string | null; logistics_status: string | null;
    receiving_status: string | null; next_role: string | null; expected_delivery_date: Date | string | null;
    vendor_delivery_contact: string | null; delivery_address: string | null; driver_name: string | null;
    driver_phone: string | null; vehicle_number: string | null; waybill_number: string | null;
    delivery_instructions: string | null; facility_manager_user_id: number | null; requested_by: number | null;
  }[]>`
    SELECT po.id,po.po_no,po.request_id,pr.request_no,po.vendor_id,v.name AS vendor_name,
           po.status,po.logistics_status,po.receiving_status,po.next_role,po.expected_delivery_date,
           po.vendor_delivery_contact,po.delivery_address,po.driver_name,po.driver_phone,
           po.vehicle_number,po.waybill_number,po.delivery_instructions,
           pr.facility_manager_user_id,pr.requested_by
    FROM purchase_orders po
    LEFT JOIN purchase_requests pr ON pr.id=po.request_id
    LEFT JOIN vendors v ON v.id=po.vendor_id
    WHERE po.id=${poId}
    FOR UPDATE OF po
  `;
  return rows[0] || null;
}

export async function planLogisticsHandover(
  user: CurrentUser,
  poId: number,
  input: {
    vendorDeliveryContact?: string;
    expectedDeliveryDate: string;
    deliveryAddress?: string;
    driverName?: string;
    driverPhone?: string;
    vehicleNumber?: string;
    waybillNumber?: string;
    deliveryInstructions?: string;
    initialStatus: "Scheduled" | "Sent to Vendor";
  },
) {
  assertLogistics(user);
  requireId(poId, "purchase order");
  const expectedDeliveryDate = dateOnly(input.expectedDeliveryDate, "Expected delivery date");
  if (!["Scheduled", "Sent to Vendor"].includes(input.initialStatus)) throw new Error("Choose a valid initial delivery status.");

  const sql = db();
  return sql.begin(async (tx) => {
    const po = await poContext(tx, poId);
    if (!po) throw new Error("Purchase order not found.");
    if (!(String(po.status || "") === "Released to Logistics" || String(po.next_role || "") === "logistics_officer")) {
      throw new Error("This purchase order has not been released to Logistics by Procurement.");
    }

    const before = {
      status: po.status,
      logistics_status: po.logistics_status,
      expected_delivery_date: po.expected_delivery_date,
      waybill_number: po.waybill_number,
    };
    const now = new Date().toISOString();
    const contact = String(input.vendorDeliveryContact || "").trim() || null;
    const address = String(input.deliveryAddress || "").trim() || null;
    const driver = String(input.driverName || "").trim() || null;
    const phone = String(input.driverPhone || "").trim() || null;
    const vehicle = String(input.vehicleNumber || "").trim() || null;
    const waybill = String(input.waybillNumber || "").trim() || null;
    const instructions = String(input.deliveryInstructions || "").trim() || null;

    await tx`
      UPDATE purchase_orders
      SET vendor_delivery_contact=${contact},expected_delivery_date=${expectedDeliveryDate},
          delivery_address=${address},driver_name=${driver},driver_phone=${phone},vehicle_number=${vehicle},
          waybill_number=${waybill},delivery_instructions=${instructions},status=${input.initialStatus},
          logistics_status=${input.initialStatus},next_role='logistics_officer',delivery_updated_by=${user.id},
          delivery_updated_at=${now},sent_to_vendor_date=CASE WHEN ${input.initialStatus}='Sent to Vendor'
            THEN COALESCE(sent_to_vendor_date,${expectedDeliveryDate}) ELSE sent_to_vendor_date END,updated_at=${now}
      WHERE id=${poId}
    `;

    await evidence(tx, {
      user, entityType: "Purchase Order", entityId: poId, entityReference: po.po_no,
      action: "Logistics Handover Planned", status: input.initialStatus,
      note: instructions || "Delivery plan recorded by Logistics Officer.", relatedUserId: po.facility_manager_user_id,
      beforeValues: before,
      afterValues: { status: input.initialStatus, logistics_status: input.initialStatus, expected_delivery_date: expectedDeliveryDate, waybill_number: waybill, next_role: "logistics_officer" },
      metadata: { request_id: po.request_id, request_no: po.request_no, vendor: po.vendor_name },
    });

    await notifyRole(tx, "Procurement Manager", "Delivery handover planned", `Logistics planned delivery for ${po.po_no} (${input.initialStatus}).`, "Purchase Order", poId, "Commercial PO Management", "Open Commercial PO");
    await notifyUser(tx, po.facility_manager_user_id || po.requested_by, "Delivery planned", `Delivery coordination has started for ${po.po_no}. Expected date: ${expectedDeliveryDate}.`, "Purchase Order", poId, "Approved / Accepted Requests", "View Request");
    await notifyRole(tx, "Auditor", "Audit activity: logistics handover", `${user.role} planned delivery for ${po.po_no}.`, "Purchase Order", poId, "Purchase Order & Logistics Evidence", "Open PO Evidence");

    return { poId, poNo: po.po_no, status: input.initialStatus };
  });
}

export async function updateLogisticsTracking(
  user: CurrentUser,
  poId: number,
  input: {
    status: LogisticsDeliveryStatus;
    expectedDeliveryDate: string;
    waybillNumber?: string;
    note?: string;
    actualDeliveryDate?: string | null;
  },
) {
  assertLogistics(user);
  requireId(poId, "purchase order");
  const statuses: LogisticsDeliveryStatus[] = ["Scheduled", "Sent to Vendor", "Dispatched", "In Transit", "Delayed", "Arrived"];
  if (!statuses.includes(input.status)) throw new Error("Choose a valid delivery status.");
  const expected = dateOnly(input.expectedDeliveryDate, "Expected delivery date");
  const actual = input.status === "Arrived" ? dateOnly(input.actualDeliveryDate || new Date().toISOString().slice(0, 10), "Actual delivery date") : null;

  const sql = db();
  return sql.begin(async (tx) => {
    const po = await poContext(tx, poId);
    if (!po) throw new Error("Purchase order not found.");
    const current = String(po.status || "");
    const allowed = ["Released to Logistics", "Scheduled", "Sent to Vendor", "Dispatched", "In Transit", "Delayed", "Arrived", "Awaiting Delivery", "Partially Received"];
    if (!(String(po.next_role || "") === "logistics_officer" || allowed.includes(current))) {
      throw new Error(`Delivery tracking is unavailable while the purchase order is '${current || "Unknown"}'.`);
    }

    const now = new Date().toISOString();
    const waybill = String(input.waybillNumber || "").trim() || null;
    const note = String(input.note || "").trim() || null;
    await tx`
      UPDATE purchase_orders
      SET status=${input.status},logistics_status=${input.status},expected_delivery_date=${expected},
          waybill_number=${waybill},actual_delivery_date=${actual},delivery_updated_by=${user.id},
          delivery_updated_at=${now},next_role='logistics_officer',updated_at=${now}
      WHERE id=${poId}
    `;

    await evidence(tx, {
      user, entityType: "Purchase Order", entityId: poId, entityReference: po.po_no,
      action: "Delivery Tracking Updated", status: input.status,
      note: note || `Status updated to ${input.status}.`, relatedUserId: po.facility_manager_user_id,
      beforeValues: { status: po.status, logistics_status: po.logistics_status, expected_delivery_date: po.expected_delivery_date, waybill_number: po.waybill_number },
      afterValues: { status: input.status, logistics_status: input.status, expected_delivery_date: expected, waybill_number: waybill, actual_delivery_date: actual },
      metadata: { request_id: po.request_id, request_no: po.request_no, vendor: po.vendor_name },
      severity: input.status === "Delayed" ? "High" : "Normal",
    });

    if (input.status === "Delayed" || input.status === "Arrived") {
      const title = input.status === "Delayed" ? "Delivery delayed" : "Delivery arrived";
      const message = `${po.po_no} is now ${input.status.toLowerCase()}.${note ? ` ${note}` : ""}`;
      await notifyRole(tx, "Procurement Manager", title, message, "Purchase Order", poId, "Commercial PO Management", "Open Commercial PO", input.status === "Delayed" ? "High" : "Normal");
      await notifyUser(tx, po.facility_manager_user_id || po.requested_by, title, message, "Purchase Order", poId, "Approved / Accepted Requests", "View Request", input.status === "Delayed" ? "High" : "Normal");
    }
    await notifyRole(tx, "Auditor", "Audit activity: delivery tracking", `${po.po_no} moved from ${current || "Unknown"} to ${input.status}.`, "Purchase Order", poId, "Purchase Order & Logistics Evidence", "Open PO Evidence");

    return { poId, poNo: po.po_no, status: input.status };
  });
}

export async function recordReceivingSlip(
  user: CurrentUser,
  poId: number,
  input: {
    dateReceived: string;
    deliveryNoteNo?: string;
    discrepancyNotes?: string;
    items: Array<{ poItemId: number; quantityReceived: number; itemCondition?: string; discrepancyNotes?: string }>;
  },
) {
  assertLogistics(user);
  requireId(poId, "purchase order");
  const dateReceived = dateOnly(input.dateReceived, "Date received");
  if (!Array.isArray(input.items) || !input.items.length) throw new Error("At least one receiving line is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const po = await poContext(tx, poId);
    if (!po) throw new Error("Purchase order not found.");
    const allowed = ["Arrived", "Awaiting Delivery", "Partially Received", "Scheduled", "Sent to Vendor", "Dispatched", "In Transit"];
    if (!(String(po.next_role || "") === "logistics_officer" || allowed.includes(String(po.status || "")))) {
      throw new Error("This purchase order is not in the Logistics receiving workflow.");
    }

    const ordered = await tx<{
      id: number; item_name: string; quantity: string | number;
    }[]>`
      SELECT id,item_name,quantity FROM purchase_order_items WHERE po_id=${poId} ORDER BY id FOR UPDATE
    `;
    if (!ordered.length) throw new Error("This purchase order has no item lines to receive.");
    const prior = await tx<{ po_item_id: number; received: string | number }[]>`
      SELECT rsi.po_item_id,COALESCE(SUM(rsi.quantity_received),0) AS received
      FROM receiving_slip_items rsi
      JOIN receiving_slips rs ON rs.id=rsi.slip_id
      WHERE rs.po_id=${poId} AND COALESCE(rs.status,'') <> 'Cancelled'
      GROUP BY rsi.po_item_id
    `;
    const priorMap = new Map(prior.map((row) => [Number(row.po_item_id), Number(row.received || 0)]));
    const orderMap = new Map(ordered.map((row) => [Number(row.id), row]));
    const lines = input.items.map((line) => ({
      poItemId: Number(line.poItemId),
      quantityReceived: Number(line.quantityReceived),
      itemCondition: String(line.itemCondition || "Good").trim() || "Good",
      discrepancyNotes: String(line.discrepancyNotes || "").trim() || null,
    })).filter((line) => line.quantityReceived > 0);
    if (!lines.length) throw new Error("Enter a received quantity greater than zero.");

    for (const line of lines) {
      const item = orderMap.get(line.poItemId);
      if (!item) throw new Error("A receiving line does not belong to this purchase order.");
      const orderedQty = Number(item.quantity || 0);
      const previousQty = priorMap.get(line.poItemId) || 0;
      const remaining = Math.max(0, orderedQty - previousQty);
      if (!Number.isFinite(line.quantityReceived) || line.quantityReceived <= 0) throw new Error(`Enter a valid received quantity for ${item.item_name}.`);
      if (line.quantityReceived > remaining + 0.000001) throw new Error(`Received quantity for ${item.item_name} exceeds the remaining ordered quantity (${remaining}).`);
    }

    const slipNo = ref("RS");
    const now = new Date().toISOString();
    const slipRows = await tx<{ id: number }[]>`
      INSERT INTO receiving_slips (
        slip_no,po_id,vendor_id,received_by,date_received,delivery_note_no,discrepancy_notes,
        status,logistics_officer_id,created_at,updated_at
      ) VALUES (
        ${slipNo},${poId},${po.vendor_id},${user.id},${dateReceived},${String(input.deliveryNoteNo || "").trim() || null},
        ${String(input.discrepancyNotes || "").trim() || null},'Recorded',${user.id},${now},${now}
      ) RETURNING id
    `;
    const slipId = Number(slipRows[0].id);

    for (const line of lines) {
      const item = orderMap.get(line.poItemId)!;
      await tx`
        INSERT INTO receiving_slip_items (
          slip_id,po_item_id,item_name,quantity_ordered,quantity_received,item_condition,discrepancy_notes,created_at
        ) VALUES (
          ${slipId},${line.poItemId},${item.item_name},${Number(item.quantity || 0)},${line.quantityReceived},
          ${line.itemCondition},${line.discrepancyNotes},${now}
        )
      `;
      priorMap.set(line.poItemId, (priorMap.get(line.poItemId) || 0) + line.quantityReceived);
    }

    const fullyReceived = ordered.every((item) => (priorMap.get(Number(item.id)) || 0) + 0.000001 >= Number(item.quantity || 0));
    const newStatus = fullyReceived ? "Fully Received" : "Partially Received";
    const nextRole = fullyReceived ? "finance" : "logistics_officer";
    await tx`
      UPDATE purchase_orders
      SET status=${newStatus},receiving_status=${newStatus},logistics_status=${newStatus},next_role=${nextRole},
          actual_delivery_date=COALESCE(actual_delivery_date,${dateReceived}),delivery_updated_by=${user.id},
          delivery_updated_at=${now},updated_at=${now}
      WHERE id=${poId}
    `;

    await evidence(tx, {
      user, entityType: "Receiving Slip", entityId: slipId, entityReference: slipNo,
      action: "Receiving Slip Recorded", status: newStatus,
      note: String(input.discrepancyNotes || "").trim() || `${po.po_no} receipt recorded by Logistics.`,
      relatedUserId: po.facility_manager_user_id,
      beforeValues: { po_status: po.status, receiving_status: po.receiving_status },
      afterValues: { po_status: newStatus, receiving_status: newStatus, next_role: nextRole, line_count: lines.length },
      metadata: { po_id: poId, po_no: po.po_no, request_id: po.request_id, request_no: po.request_no, vendor: po.vendor_name },
      severity: fullyReceived ? "Normal" : "Important",
    });

    await notifyRole(tx, "Procurement Manager", "Delivery receipt recorded", `${slipNo} was recorded for ${po.po_no}. Receiving status: ${newStatus}.`, "Receiving Slip", slipId, "Commercial PO Management", "Open Commercial PO");
    await notifyRole(tx, "Finance", "Goods receipt recorded", `${po.po_no} has a Logistics receiving slip (${slipNo}). Receiving status: ${newStatus}.`, "Receiving Slip", slipId, "Receipts", "Open Receipts", fullyReceived ? "High" : "Normal");
    await notifyUser(tx, po.facility_manager_user_id || po.requested_by, "Delivery receipt recorded", `${po.po_no} receiving status is now ${newStatus}.`, "Receiving Slip", slipId, "Approved / Accepted Requests", "View Request");
    await notifyRole(tx, "Auditor", "Audit activity: receiving slip", `${user.role} recorded ${slipNo} for ${po.po_no}.`, "Receiving Slip", slipId, "Receiving Slips, Proof of Delivery & Returns", "Open Receiving Evidence");

    return { slipId, slipNo, poId, poNo: po.po_no, status: newStatus, nextRole };
  });
}

export async function raiseLogisticsException(
  user: CurrentUser,
  poId: number,
  input: { exceptionType: string; description: string; paymentImpact?: boolean },
) {
  assertLogistics(user);
  requireId(poId, "purchase order");
  const exceptionType = String(input.exceptionType || "").trim();
  const description = String(input.description || "").trim();
  if (!exceptionType) throw new Error("Choose an exception type.");
  if (!description) throw new Error("Describe the delivery exception.");

  const sql = db();
  return sql.begin(async (tx) => {
    const po = await poContext(tx, poId);
    if (!po) throw new Error("Purchase order not found.");
    if (["Closed", "Cancelled", "Paid"].includes(String(po.status || ""))) {
      throw new Error("A delivery exception cannot be raised for this closed purchase order.");
    }

    const exceptionNo = ref("LEX");
    const now = new Date().toISOString();
    const rows = await tx<{ id: number }[]>`
      INSERT INTO logistics_exceptions (
        exception_no,po_id,request_id,exception_type,description,payment_impact,status,raised_by,created_at,updated_at
      ) VALUES (
        ${exceptionNo},${poId},${po.request_id},${exceptionType},${description},${Boolean(input.paymentImpact)},'Open',${user.id},${now},${now}
      ) RETURNING id
    `;
    const exceptionId = Number(rows[0].id);
    await tx`
      UPDATE purchase_orders SET delivery_exception_status='Open',updated_at=${now} WHERE id=${poId}
    `;

    await evidence(tx, {
      user, entityType: "Logistics Exception", entityId: exceptionId, entityReference: exceptionNo,
      action: "Logistics Exception Raised", status: "Open", note: description,
      relatedUserId: po.facility_manager_user_id,
      beforeValues: { po_status: po.status, delivery_exception_status: "None" },
      afterValues: { po_status: po.status, delivery_exception_status: "Open", exception_type: exceptionType, payment_impact: Boolean(input.paymentImpact) },
      metadata: { po_id: poId, po_no: po.po_no, request_id: po.request_id, request_no: po.request_no },
      severity: Boolean(input.paymentImpact) ? "High" : "Important",
    });

    const message = `${exceptionNo}: ${exceptionType} on ${po.po_no}. ${description}`;
    await notifyRole(tx, "Procurement Manager", "Delivery exception raised", message, "Logistics Exception", exceptionId, "Commercial PO Management", "Open Commercial PO", "High");
    await notifyUser(tx, po.facility_manager_user_id || po.requested_by, "Delivery exception raised", message, "Logistics Exception", exceptionId, "Approved / Accepted Requests", "View Request", "High");
    if (input.paymentImpact) await notifyRole(tx, "Finance", "Delivery exception may affect payment", message, "Logistics Exception", exceptionId, "Approved for Payment", "Review Payment", "High");
    await notifyRole(tx, "Auditor", "Audit activity: logistics exception", message, "Logistics Exception", exceptionId, "Purchase Order & Logistics Evidence", "Open Exception Evidence", "High");

    return { exceptionId, exceptionNo, status: "Open" };
  });
}

export async function resolveLogisticsException(user: CurrentUser, exceptionId: number, resolution: string) {
  assertLogistics(user);
  requireId(exceptionId, "logistics exception");
  const note = String(resolution || "").trim();
  if (!note) throw new Error("A resolution note is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<{
      id: number; exception_no: string; po_id: number; request_id: number | null; status: string | null;
      exception_type: string; description: string; payment_impact: boolean | null; po_no: string | null;
      facility_manager_user_id: number | null; requested_by: number | null;
    }[]>`
      SELECT le.id,le.exception_no,le.po_id,le.request_id,le.status,le.exception_type,le.description,le.payment_impact,
             po.po_no,pr.facility_manager_user_id,pr.requested_by
      FROM logistics_exceptions le
      LEFT JOIN purchase_orders po ON po.id=le.po_id
      LEFT JOIN purchase_requests pr ON pr.id=le.request_id
      WHERE le.id=${exceptionId}
      FOR UPDATE OF le
    `;
    const row = rows[0];
    if (!row) throw new Error("Logistics exception not found.");
    if (String(row.status || "") === "Resolved") return { exceptionId, exceptionNo: row.exception_no, status: "Resolved", alreadyResolved: true };

    const now = new Date().toISOString();
    await tx`
      UPDATE logistics_exceptions
      SET status='Resolved',resolved_by=${user.id},resolution_note=${note},updated_at=${now}
      WHERE id=${exceptionId}
    `;
    const open = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM logistics_exceptions
      WHERE po_id=${row.po_id} AND id<>${exceptionId} AND status IN ('Open','In Progress')
    `;
    if (Number(open[0]?.count || 0) === 0) {
      await tx`UPDATE purchase_orders SET delivery_exception_status='None',updated_at=${now} WHERE id=${row.po_id}`;
    }

    await evidence(tx, {
      user, entityType: "Logistics Exception", entityId: exceptionId, entityReference: row.exception_no,
      action: "Logistics Exception Resolved", status: "Resolved", note,
      relatedUserId: row.facility_manager_user_id,
      beforeValues: { status: row.status, exception_type: row.exception_type, payment_impact: Boolean(row.payment_impact) },
      afterValues: { status: "Resolved", resolution_note: note },
      metadata: { po_id: row.po_id, po_no: row.po_no, request_id: row.request_id },
    });

    const message = `${row.exception_no} on ${row.po_no || `PO #${row.po_id}`} was resolved. ${note}`;
    await notifyRole(tx, "Procurement Manager", "Delivery exception resolved", message, "Logistics Exception", exceptionId, "Commercial PO Management", "Open Commercial PO");
    await notifyUser(tx, row.facility_manager_user_id || row.requested_by, "Delivery exception resolved", message, "Logistics Exception", exceptionId, "Approved / Accepted Requests", "View Request");
    if (row.payment_impact) await notifyRole(tx, "Finance", "Payment-impacting delivery exception resolved", message, "Logistics Exception", exceptionId, "Approved for Payment", "Review Payment");
    await notifyRole(tx, "Auditor", "Audit activity: logistics exception resolved", message, "Logistics Exception", exceptionId, "Purchase Order & Logistics Evidence", "Open Exception Evidence");

    return { exceptionId, exceptionNo: row.exception_no, status: "Resolved", alreadyResolved: false };
  });
}

export async function updateGatewayCoordination(
  user: CurrentUser,
  gatewayPassId: number,
  input: {
    movementDate: string;
    driverName?: string;
    driverPhone?: string;
    vehicleNumber?: string;
    deliveryReference?: string;
    waybillNumber?: string;
    status: GatewayMovementStatus;
    note?: string;
  },
) {
  assertLogistics(user);
  requireId(gatewayPassId, "gateway pass");
  const movementDate = dateOnly(input.movementDate, "Movement date");
  const statuses: GatewayMovementStatus[] = ["Scheduled", "Entered", "Exited", "Completed"];
  if (!statuses.includes(input.status)) throw new Error("Choose a valid movement status.");

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<{
      id: number; pass_number: string; facility_manager_user_id: number; status: string | null; logistics_status: string | null;
      movement_type: string; destination: string | null; driver_name: string | null; driver_phone: string | null;
      vehicle_number: string | null; logistics_delivery_reference: string | null; logistics_waybill_number: string | null;
    }[]>`
      SELECT id,pass_number,facility_manager_user_id,status,logistics_status,movement_type,destination,
             driver_name,driver_phone,vehicle_number,logistics_delivery_reference,logistics_waybill_number
      FROM gateway_passes WHERE id=${gatewayPassId} FOR UPDATE
    `;
    const gp = rows[0];
    if (!gp) throw new Error("Gateway pass not found.");
    if (!["Approved", "Generated", "Downloaded"].includes(String(gp.status || ""))) {
      throw new Error("Logistics can coordinate only approved or generated gateway passes.");
    }

    const now = new Date().toISOString();
    const note = String(input.note || "").trim() || null;
    await tx`
      UPDATE gateway_passes
      SET driver_name=${String(input.driverName || "").trim() || null},driver_phone=${String(input.driverPhone || "").trim() || null},
          vehicle_number=${String(input.vehicleNumber || "").trim() || null},logistics_movement_date=${movementDate},
          logistics_delivery_reference=${String(input.deliveryReference || "").trim() || null},
          logistics_waybill_number=${String(input.waybillNumber || "").trim() || null},logistics_status=${input.status},
          logistics_note=${note},logistics_updated_by=${user.id},logistics_updated_at=${now},updated_at=${now}
      WHERE id=${gatewayPassId}
    `;
    await tx`
      INSERT INTO gateway_pass_events (gateway_pass_id,event,status,note,user_id,created_at)
      VALUES (${gatewayPassId},'Logistics Movement Coordination',${input.status},${note},${user.id},${now})
    `;

    await evidence(tx, {
      user, entityType: "Gateway Pass", entityId: gatewayPassId, entityReference: gp.pass_number,
      action: "Gateway Pass Logistics Updated", status: input.status, note,
      relatedUserId: gp.facility_manager_user_id,
      beforeValues: { logistics_status: gp.logistics_status, driver_name: gp.driver_name, vehicle_number: gp.vehicle_number, delivery_reference: gp.logistics_delivery_reference, waybill_number: gp.logistics_waybill_number },
      afterValues: { logistics_status: input.status, movement_date: movementDate, driver_name: input.driverName || null, vehicle_number: input.vehicleNumber || null, delivery_reference: input.deliveryReference || null, waybill_number: input.waybillNumber || null },
      metadata: { gateway_status: gp.status, movement_type: gp.movement_type, destination: gp.destination },
    });

    const message = `${gp.pass_number} movement coordination is now ${input.status}.`;
    await notifyUser(tx, gp.facility_manager_user_id, "Gateway pass movement updated", message, "Gateway Pass", gatewayPassId, "Gateway Pass", "Open Gateway Pass");
    await notifyRole(tx, "Procurement Manager", "Gateway pass movement updated", message, "Gateway Pass", gatewayPassId, "Gateway Pass Review", "Review Gateway Pass");
    await notifyRole(tx, "Auditor", "Audit activity: gateway movement", message, "Gateway Pass", gatewayPassId, "Gateway Pass Audit", "Open Gateway Audit");

    return { gatewayPassId, passNumber: gp.pass_number, logisticsStatus: input.status };
  });
}

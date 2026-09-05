import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

export type ApproverOperationalDecision = "approve" | "reject";
export type ApproverGatewayDecision = ApproverOperationalDecision | "return";

type PORecord = {
  id: number;
  po_no: string;
  request_id: number | null;
  request_no: string | null;
  vendor_name: string | null;
  status: string | null;
  total_amount: string | number | null;
  next_role: string | null;
  payment_status: string | null;
  receiving_status: string | null;
  created_by: number | null;
};

type PaymentRecord = {
  id: number;
  payment_no: string;
  request_id: number | null;
  request_no: string | null;
  po_id: number | null;
  po_no: string | null;
  vendor_name: string | null;
  status: string | null;
  amount: string | number;
  currency: string | null;
  next_role: string | null;
  verification_status: string | null;
  created_by: number | null;
  assigned_procurement_manager_id: number | null;
};

type GatewayRecord = {
  id: number;
  pass_number: string;
  facility_manager_user_id: number;
  department: string | null;
  movement_type: string;
  purpose: string;
  destination: string | null;
  status: string | null;
  next_role: string | null;
  reviewed_by_user_id: number | null;
  procurement_review_note: string | null;
};

function assertApprover(user: CurrentUser) {
  if (user.role !== "Approver" && user.role !== "Admin") {
    throw new Error("Only Approver / MD or Admin can make this decision.");
  }
}

function requireValidId(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`A valid ${label} is required.`);
}

async function approvalLimit(tx: any) {
  const rows = await tx<{ amount: string | number }[]>`
    SELECT amount
    FROM approval_policy_settings
    WHERE policy_key='procurement_manager_approval_limit'
    LIMIT 1
  `;
  if (!rows[0]) throw new Error("Procurement Manager approval policy is not configured.");
  return Number(rows[0].amount || 0);
}

async function insertApprovalEvidence(
  tx: any,
  input: {
    entityType: string;
    entityId: number;
    entityReference: string;
    oldStatus: string;
    newStatus: string;
    action: string;
    note: string;
    user: CurrentUser;
    amount?: number | null;
    department?: string | null;
    beforeValues?: Record<string, unknown>;
    afterValues?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  const now = new Date().toISOString();

  await tx`
    INSERT INTO approval_history (
      entity_type,entity_id,action,status_before,status_after,reason,user_id,
      approved_by_user_id,approved_by_role,approval_mode,note,created_at
    ) VALUES (
      ${input.entityType},${input.entityId},${input.action},${input.oldStatus},${input.newStatus},${input.note},${input.user.id},
      ${input.user.id},${input.user.role},'Normal Approval Mode',${input.note},${now}
    )
  `;

  await tx`
    INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
    VALUES (${input.entityType},${input.entityId},${input.action},${input.newStatus},${input.note},${input.user.id},${now})
  `;

  await tx`
    INSERT INTO activity_logs (
      user_id,role,action,entity_type,entity_id,public_summary,private_details,
      visibility_scope,related_user_id,created_at
    ) VALUES (
      ${input.user.id},${input.user.role},${input.action},${input.entityType},${input.entityId},
      ${`${input.entityReference} moved from ${input.oldStatus} to ${input.newStatus}`},${input.note},
      'workflow',NULL,${now}
    )
  `;

  await tx`
    INSERT INTO audit_logs (
      action,entity_type,entity_id,user_id,role,details,before_values,after_values,
      created_at,event_date,event_time,amount,department,notes
    ) VALUES (
      ${input.action},${input.entityType},${String(input.entityId)},${input.user.id},${input.user.role},${input.note},
      ${tx.json(input.beforeValues || { status: input.oldStatus })},
      ${tx.json(input.afterValues || { status: input.newStatus })},
      ${now},${now.slice(0,10)},${now.slice(11,19)},${input.amount ?? null},${input.department ?? null},${input.note}
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
    beforeValues: input.beforeValues || { status: input.oldStatus },
    afterValues: input.afterValues || { status: input.newStatus },
    metadata: input.metadata || null,
    reasonOrComment: input.note,
    source: "nextjs",
  });
}

async function notifyRole(
  tx: any,
  input: {
    role: string;
    title: string;
    message: string;
    entityType: string;
    entityId: number;
    importance?: string;
    actionLabel: string;
    sectionTarget: string;
  },
) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
      importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
    ) VALUES (
      NULL,${input.role},${input.title},${input.message},${input.entityType},${input.entityId},FALSE,FALSE,
      ${input.importance || 'Important'},'in_app',FALSE,FALSE,${input.actionLabel},${input.sectionTarget},${now}
    )
  `;
}

async function notifyUser(
  tx: any,
  input: {
    userId: number;
    title: string;
    message: string;
    entityType: string;
    entityId: number;
    importance?: string;
    actionLabel: string;
    sectionTarget: string;
  },
) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,
      importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at
    ) VALUES (
      ${input.userId},NULL,${input.title},${input.message},${input.entityType},${input.entityId},FALSE,FALSE,
      ${input.importance || 'Important'},'in_app',FALSE,FALSE,${input.actionLabel},${input.sectionTarget},${now}
    )
  `;
}

export async function decidePurchaseOrder(
  user: CurrentUser,
  poId: number,
  decision: ApproverOperationalDecision,
  note = "",
) {
  assertApprover(user);
  requireValidId(poId, "purchase order");
  if (!["approve", "reject"].includes(decision)) throw new Error("Unsupported purchase-order decision.");
  if (decision === "reject" && !note.trim()) throw new Error("A rejection reason is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<PORecord[]>`
      SELECT po.id,po.po_no,po.request_id,pr.request_no,v.name AS vendor_name,
             po.status,po.total_amount,po.next_role,po.payment_status,po.receiving_status,po.created_by
      FROM purchase_orders po
      LEFT JOIN purchase_requests pr ON pr.id=po.request_id
      LEFT JOIN vendors v ON v.id=po.vendor_id
      WHERE po.id=${poId}
      FOR UPDATE OF po
    `;
    const po = rows[0];
    if (!po) throw new Error("Purchase order not found.");
    const oldStatus = String(po.status || "");
    if (oldStatus !== "Pending Approval") {
      throw new Error(`This purchase order cannot be decided from status '${oldStatus || "Unknown"}'.`);
    }

    const limit = await approvalLimit(tx);
    const amount = Number(po.total_amount || 0);
    if (amount <= limit && user.role !== "Admin") {
      throw new Error("This purchase order is within the Procurement Manager approval limit and does not belong to Approver / MD.");
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "Approved" : "Rejected";
    const action = decision === "approve" ? "Approved Purchase Order" : "Rejected Purchase Order";
    const finalNote = note.trim() || "Approved by Approver / MD";
    const nextRole = decision === "approve" ? "procurement_manager" : null;

    await tx`
      UPDATE purchase_orders
      SET status=${newStatus},next_role=${nextRole},
          approved_by=${decision === "approve" ? user.id : null},
          approved_by_role=${decision === "approve" ? user.role : null},
          approval_mode='Normal Approval Mode',updated_at=${now}
      WHERE id=${poId}
    `;

    await insertApprovalEvidence(tx, {
      entityType: "Purchase Order",
      entityId: poId,
      entityReference: po.po_no,
      oldStatus,
      newStatus,
      action,
      note: finalNote,
      user,
      amount,
      beforeValues: {
        status: oldStatus,
        next_role: po.next_role,
        payment_status: po.payment_status,
        receiving_status: po.receiving_status,
      },
      afterValues: {
        status: newStatus,
        next_role: nextRole,
        approval_mode: "Normal Approval Mode",
      },
      metadata: {
        request_id: po.request_id,
        request_no: po.request_no,
        vendor: po.vendor_name,
        approval_limit: limit,
      },
    });

    await notifyRole(tx, {
      role: "Procurement Manager",
      title: decision === "approve" ? "Purchase order approved" : "Purchase order rejected",
      message: `${po.po_no} was ${decision === "approve" ? "approved by Approver / MD and is ready for commercial release" : `rejected. ${finalNote}`}.`,
      entityType: "Purchase Order",
      entityId: poId,
      importance: decision === "approve" ? "Important" : "High",
      actionLabel: "Open Commercial PO",
      sectionTarget: "Commercial PO Management",
    });
    await notifyRole(tx, {
      role: "Admin",
      title: `PO ${newStatus}`,
      message: `${po.po_no} was ${newStatus.toLowerCase()} by ${user.role}.`,
      entityType: "Purchase Order",
      entityId: poId,
      actionLabel: "Open Procurement Records",
      sectionTarget: "All Procurement Records",
    });
    await notifyRole(tx, {
      role: "Auditor",
      title: `Audit activity: ${action}`,
      message: `${user.role} performed ${action} on ${po.po_no}.`,
      entityType: "Purchase Order",
      entityId: poId,
      importance: "Normal",
      actionLabel: "Open PO Evidence",
      sectionTarget: "Purchase Order & Logistics Evidence",
    });

    return { poId, poNo: po.po_no, status: newStatus, nextRole };
  });
}

export async function decidePayment(
  user: CurrentUser,
  paymentId: number,
  decision: ApproverOperationalDecision,
  note = "",
) {
  assertApprover(user);
  requireValidId(paymentId, "payment request");
  if (!["approve", "reject"].includes(decision)) throw new Error("Unsupported payment decision.");
  if (decision === "reject" && !note.trim()) throw new Error("A rejection reason is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<PaymentRecord[]>`
      SELECT p.id,p.payment_no,p.request_id,pr.request_no,p.po_id,po.po_no,
             v.name AS vendor_name,p.status,p.amount,p.currency,p.next_role,
             p.verification_status,p.created_by,pr.assigned_procurement_manager_id
      FROM payments p
      LEFT JOIN purchase_requests pr ON pr.id=p.request_id
      LEFT JOIN purchase_orders po ON po.id=p.po_id
      LEFT JOIN vendors v ON v.id=p.vendor_id
      WHERE p.id=${paymentId}
      FOR UPDATE OF p
    `;
    const payment = rows[0];
    if (!payment) throw new Error("Payment request not found.");
    const oldStatus = String(payment.status || "");
    if (oldStatus !== "Pending Approval") {
      throw new Error(`This payment cannot be decided from status '${oldStatus || "Unknown"}'.`);
    }

    const limit = await approvalLimit(tx);
    const amount = Number(payment.amount || 0);
    if (amount <= limit && user.role !== "Admin") {
      throw new Error("This payment is within the Procurement Manager approval limit and does not belong to Approver / MD.");
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "Approved" : "Rejected";
    const action = decision === "approve" ? "Approved Payment" : "Rejected Payment";
    const finalNote = note.trim() || "Payment approved by Approver / MD";
    const nextRole = decision === "approve" ? "finance" : null;

    await tx`
      UPDATE payments
      SET status=${newStatus},next_role=${nextRole},
          approved_by=${decision === "approve" ? user.id : null},
          approved_by_role=${decision === "approve" ? user.role : null},
          approval_mode='Normal Approval Mode',updated_at=${now}
      WHERE id=${paymentId}
    `;

    await insertApprovalEvidence(tx, {
      entityType: "Payment",
      entityId: paymentId,
      entityReference: payment.payment_no,
      oldStatus,
      newStatus,
      action,
      note: finalNote,
      user,
      amount,
      beforeValues: {
        status: oldStatus,
        next_role: payment.next_role,
        verification_status: payment.verification_status,
      },
      afterValues: {
        status: newStatus,
        next_role: nextRole,
        verification_status: payment.verification_status,
        approval_mode: "Normal Approval Mode",
      },
      metadata: {
        request_id: payment.request_id,
        request_no: payment.request_no,
        po_id: payment.po_id,
        po_no: payment.po_no,
        vendor: payment.vendor_name,
        currency: payment.currency || "NGN",
        approval_limit: limit,
      },
    });

    if (decision === "approve") {
      await notifyRole(tx, {
        role: "Finance",
        title: "Payment request approved",
        message: `${payment.payment_no} was approved by Approver / MD and is ready for Finance payment processing.`,
        entityType: "Payment",
        entityId: paymentId,
        importance: "High",
        actionLabel: "Open Payments",
        sectionTarget: "Payments",
      });
    }
    await notifyRole(tx, {
      role: "Procurement Manager",
      title: decision === "approve" ? "Payment approval completed" : "Payment request rejected",
      message: `${payment.payment_no} was ${decision === "approve" ? "approved and routed to Finance" : `rejected by Approver / MD. ${finalNote}`}.`,
      entityType: "Payment",
      entityId: paymentId,
      importance: decision === "approve" ? "Normal" : "High",
      actionLabel: "Open Request",
      sectionTarget: "Post-Payment Closure",
    });
    await notifyRole(tx, {
      role: "Admin",
      title: `Payment ${newStatus}`,
      message: `${payment.payment_no} was ${newStatus.toLowerCase()} by ${user.role}.`,
      entityType: "Payment",
      entityId: paymentId,
      actionLabel: "Open Procurement Records",
      sectionTarget: "All Procurement Records",
    });
    await notifyRole(tx, {
      role: "Auditor",
      title: `Audit activity: ${action}`,
      message: `${user.role} performed ${action} on ${payment.payment_no}.`,
      entityType: "Payment",
      entityId: paymentId,
      importance: "Normal",
      actionLabel: "Open Finance Audit",
      sectionTarget: "Finance, Invoice & Payment Audit",
    });

    return { paymentId, paymentNo: payment.payment_no, status: newStatus, nextRole };
  });
}

export async function decideGatewayPass(
  user: CurrentUser,
  gatewayPassId: number,
  decision: ApproverGatewayDecision,
  note = "",
) {
  assertApprover(user);
  requireValidId(gatewayPassId, "gateway pass");
  if (!["approve", "reject", "return"].includes(decision)) throw new Error("Unsupported gateway-pass decision.");
  if ((decision === "reject" || decision === "return") && !note.trim()) {
    throw new Error(decision === "reject" ? "A rejection reason is required." : "A return reason is required.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<GatewayRecord[]>`
      SELECT id,pass_number,facility_manager_user_id,department,movement_type,purpose,
             destination,status,next_role,reviewed_by_user_id,procurement_review_note
      FROM gateway_passes
      WHERE id=${gatewayPassId}
      FOR UPDATE
    `;
    const gateway = rows[0];
    if (!gateway) throw new Error("Gateway pass not found.");
    const oldStatus = String(gateway.status || "");
    const inApproverQueue = gateway.next_role === "approver" || ["Submitted for Approval", "Pending Approval"].includes(oldStatus);
    if (!inApproverQueue) {
      throw new Error("Gateway passes must be submitted by Procurement Manager to Approver / MD before final approval.");
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Returned for Correction";
    const action = decision === "approve" ? "Gateway Pass Approved" : decision === "reject" ? "Gateway Pass Rejected" : "Gateway Pass Returned for Correction";
    const finalNote = note.trim() || "Approved.";
    const nextRole = decision === "approve" || decision === "return" ? "facility_manager" : null;

    if (decision === "approve") {
      await tx`
        UPDATE gateway_passes
        SET status='Approved',next_role='facility_manager',approved_at=${now},
            approved_by_user_id=${user.id},approved_by_role=${user.role},approval_note=${finalNote},
            rejected_at=NULL,rejected_by_user_id=NULL,rejection_reason=NULL,updated_at=${now}
        WHERE id=${gatewayPassId}
      `;
    } else if (decision === "reject") {
      await tx`
        UPDATE gateway_passes
        SET status='Rejected',next_role=NULL,rejected_at=${now},rejected_by_user_id=${user.id},
            rejection_reason=${finalNote},updated_at=${now}
        WHERE id=${gatewayPassId}
      `;
    } else {
      await tx`
        UPDATE gateway_passes
        SET status='Returned for Correction',next_role='facility_manager',rejection_reason=${finalNote},updated_at=${now}
        WHERE id=${gatewayPassId}
      `;
    }

    await tx`
      INSERT INTO gateway_pass_events (gateway_pass_id,event,status,note,user_id,created_at)
      VALUES (${gatewayPassId},${action},${newStatus},${finalNote},${user.id},${now})
    `;
    await tx`
      INSERT INTO gateway_pass_approvals (gateway_pass_id,approver_user_id,approver_role,decision,note,created_at)
      VALUES (${gatewayPassId},${user.id},${user.role},${newStatus},${finalNote},${now})
    `;
    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,
        visibility_scope,related_user_id,created_at
      ) VALUES (
        ${user.id},${user.role},${action},'Gateway Pass',${gatewayPassId},
        ${`${gateway.pass_number} moved from ${oldStatus} to ${newStatus}`},${finalNote},
        'workflow',${gateway.facility_manager_user_id},${now}
      )
    `;
    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,department,notes
      ) VALUES (
        ${action},'Gateway Pass',${String(gatewayPassId)},${user.id},${user.role},${finalNote},
        ${tx.json({status:oldStatus,next_role:gateway.next_role})},
        ${tx.json({status:newStatus,next_role:nextRole})},
        ${now},${now.slice(0,10)},${now.slice(11,19)},${gateway.department},${finalNote}
      )
    `;

    await appendAuditEvent(tx, {
      action,
      entityType: "Gateway Pass",
      entityId: gatewayPassId,
      entityReference: gateway.pass_number,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: oldStatus, next_role: gateway.next_role },
      afterValues: { status: newStatus, next_role: nextRole },
      metadata: {
        department: gateway.department,
        movement_type: gateway.movement_type,
        destination: gateway.destination,
        reviewed_by_user_id: gateway.reviewed_by_user_id,
        procurement_review_note: gateway.procurement_review_note,
      },
      reasonOrComment: finalNote,
      source: "nextjs",
    });

    await notifyUser(tx, {
      userId: Number(gateway.facility_manager_user_id),
      title: decision === "approve" ? "Gateway Pass Approved - Ready to Generate" : decision === "reject" ? "Gateway Pass Rejected" : "Gateway Pass Returned",
      message: decision === "approve"
        ? `${gateway.pass_number} has been approved by Approver / MD. Open Gateway Pass to preview, generate and download it.`
        : `${gateway.pass_number} was ${decision === "reject" ? "rejected" : "returned for correction"}. Reason: ${finalNote}`,
      entityType: "Gateway Pass",
      entityId: gatewayPassId,
      importance: "High",
      actionLabel: decision === "approve" ? "Ready to Generate" : "Open Gateway Pass",
      sectionTarget: "Gateway Pass",
    });

    if (decision === "approve") {
      await notifyRole(tx, {
        role: "Procurement Manager",
        title: "Gateway pass final approval completed",
        message: `${gateway.pass_number} was approved by ${user.role} and routed to Utility Head / Facility Head for generation.`,
        entityType: "Gateway Pass",
        entityId: gatewayPassId,
        importance: "Normal",
        actionLabel: "Review Gateway Pass",
        sectionTarget: "Gateway Pass Review",
      });
    }
    await notifyRole(tx, {
      role: "Admin",
      title: `Gateway pass ${newStatus}`,
      message: `${gateway.pass_number} was ${newStatus.toLowerCase()} by ${user.role}.`,
      entityType: "Gateway Pass",
      entityId: gatewayPassId,
      actionLabel: "Open Gateway Pass Management",
      sectionTarget: "Gateway Pass Management",
    });
    await notifyRole(tx, {
      role: "Auditor",
      title: `Audit activity: ${action}`,
      message: `${user.role} performed ${action} on ${gateway.pass_number}.`,
      entityType: "Gateway Pass",
      entityId: gatewayPassId,
      importance: "Normal",
      actionLabel: "Open Gateway Pass Audit",
      sectionTarget: "Gateway Pass Audit",
    });

    return { gatewayPassId, passNumber: gateway.pass_number, status: newStatus, nextRole };
  });
}

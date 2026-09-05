import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";
import { decryptPayeeValueV2 } from "./payee-crypto";

export type FinanceTransferType = "Internet Bank Transfer" | "Physical Bank Transfer";

function assertFinance(user: CurrentUser) {
  if (user.role !== "Finance" && user.role !== "Admin") {
    throw new Error("Only Finance and Admin may perform payment actions.");
  }
}

function requestPaymentReady(status: string | null, paymentStatus: string | null) {
  return ["Approved", "Awaiting Payment", "Approved for Payment", "Payment Approved", "PO Created"].includes(String(status || ""))
    || String(paymentStatus || "") === "Approved for Payment";
}

function maskedAccount(last4: string | null) {
  return last4 ? `******${last4}` : "—";
}

function payeeSnapshot(row: {
  recipient_known: boolean | null;
  payee_type: string | null;
  payee_name_masked: string | null;
  account_name_masked: string | null;
  bank_name_masked: string | null;
  account_number_last4: string | null;
  currency: string | null;
  payment_readiness_status: string | null;
  verification_status: string | null;
}) {
  return {
    recipient_known: Boolean(row.recipient_known),
    payee_type: row.payee_type,
    payee_name: row.payee_name_masked,
    account_name: row.account_name_masked,
    bank_name: row.bank_name_masked,
    account_number: maskedAccount(row.account_number_last4),
    currency: row.currency || "NGN",
    payment_readiness_status: row.payment_readiness_status,
    verification_status: row.verification_status,
  };
}

function assertV2PayeeReadable(row: {
  payee_name_encrypted: string | null;
  account_name_encrypted: string | null;
  bank_name_encrypted: string | null;
  account_number_encrypted: string | null;
}) {
  const values = [
    row.payee_name_encrypted,
    row.account_name_encrypted,
    row.bank_name_encrypted,
    row.account_number_encrypted,
  ];
  if (values.some((value) => !value)) {
    throw new Error("The linked payee record is incomplete and must be securely re-entered before Finance verification.");
  }
  try {
    for (const value of values) decryptPayeeValueV2(String(value));
  } catch {
    throw new Error(
      "This payee record uses the preserved legacy encryption key and cannot be safely revealed after the GCP exit. Re-enter the payee details under the active v2 key before Finance verification or payment.",
    );
  }
}

async function notifyUser(
  tx: any,
  userId: number,
  title: string,
  message: string,
  entityType: string,
  entityId: number,
  sectionTarget: string,
  actionLabel: string,
  importance = "Normal",
  dedupeKey?: string,
) {
  const now = new Date().toISOString();
  await tx`
    INSERT INTO notifications (
      user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,
      delivery_channel,push_sent,email_sent,action_label,section_target,dedupe_key,created_at
    ) VALUES (
      ${userId},NULL,${title},${message},${entityType},${entityId},FALSE,FALSE,${importance},
      'in_app',FALSE,FALSE,${actionLabel},${sectionTarget},${dedupeKey ?? null},${now}
    )
  `;
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

export async function verifyFinancePayee(user: CurrentUser, requestId: number, reason = "") {
  assertFinance(user);
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid purchase request is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const requests = await tx<{
      id: number; request_no: string; status: string | null; payment_status: string | null;
      selected_payee_detail_id: number | null; selected_vendor_id: number | null;
    }[]>`
      SELECT id,request_no,status,payment_status,selected_payee_detail_id,selected_vendor_id
      FROM purchase_requests WHERE id=${requestId} FOR UPDATE
    `;
    const request = requests[0];
    if (!request) throw new Error("Purchase request not found.");
    if (!requestPaymentReady(request.status, request.payment_status)) {
      throw new Error("Only an approved request can have its payee verified for payment.");
    }

    const payees = await tx<{
      id: number; purchase_request_id: number; vendor_id: number | null; recipient_known: boolean | null;
      payee_type: string | null; payee_name_masked: string | null; account_name_masked: string | null;
      bank_name_masked: string | null; account_number_last4: string | null; currency: string | null;
      payment_readiness_status: string | null; verification_status: string | null;
      payee_name_encrypted: string | null; account_name_encrypted: string | null;
      bank_name_encrypted: string | null; account_number_encrypted: string | null;
    }[]>`
      SELECT id,purchase_request_id,vendor_id,recipient_known,payee_type,payee_name_masked,
             account_name_masked,bank_name_masked,account_number_last4,currency,
             payment_readiness_status,verification_status,payee_name_encrypted,
             account_name_encrypted,bank_name_encrypted,account_number_encrypted
      FROM payment_payee_details
      WHERE id=${request.selected_payee_detail_id}
         OR (${request.selected_payee_detail_id} IS NULL AND purchase_request_id=${requestId} AND COALESCE(is_current,TRUE)=TRUE)
      ORDER BY CASE WHEN id=${request.selected_payee_detail_id} THEN 0 ELSE 1 END,id DESC
      LIMIT 1
      FOR UPDATE
    `;
    const payee = payees[0];
    if (!payee) throw new Error("No approved payee is linked to this request.");
    if (!payee.recipient_known) throw new Error("Payment recipient details are still pending.");
    if (String(payee.verification_status || "") === "Rejected") {
      throw new Error("The linked payee details were rejected and must be corrected before payment.");
    }
    if (request.selected_vendor_id && payee.vendor_id && Number(request.selected_vendor_id) !== Number(payee.vendor_id)) {
      throw new Error("The selected vendor differs from the linked payee. Procurement must resolve the mismatch before payment.");
    }

    assertV2PayeeReadable(payee);
    if (String(payee.verification_status || "") === "Finance Verified") {
      return { requestId, payeeId: Number(payee.id), status: "Finance Verified", alreadyVerified: true };
    }

    const before = payeeSnapshot(payee);
    const now = new Date().toISOString();
    const finalReason = reason.trim() || "Verified during authorized Finance payment processing.";

    await tx`
      UPDATE payment_payee_details
      SET verification_status='Finance Verified',payment_readiness_status='Payment Ready',
          verified_by_user_id=${user.id},verified_at=${now},updated_by_user_id=${user.id},updated_at=${now}
      WHERE id=${payee.id}
    `;
    await tx`
      UPDATE purchase_requests SET selected_payee_detail_id=${payee.id},updated_at=${now} WHERE id=${requestId}
    `;

    const versions = await tx<{ next_version: number }[]>`
      SELECT COALESCE(MAX(version_no),0)::int + 1 AS next_version
      FROM payment_payee_detail_versions WHERE payee_detail_id=${payee.id}
    `;
    const after = { ...before, verification_status: "Finance Verified", payment_readiness_status: "Payment Ready" };
    await tx`
      INSERT INTO payment_payee_detail_versions (
        payee_detail_id,version_no,action,values_redacted_json,changed_by_user_id,reason,created_at
      ) VALUES (
        ${payee.id},${Number(versions[0]?.next_version || 1)},'PAYEE_DETAILS_FINANCE_VERIFIED',
        ${tx.json(after)},${user.id},${finalReason},${now}
      )
    `;
    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,notes
      ) VALUES (
        'PAYEE_DETAILS_FINANCE_VERIFIED','Payment Payee Details',${String(payee.id)},${user.id},${user.role},${finalReason},
        ${tx.json(before)},${tx.json(after)},${now},${now.slice(0,10)},${now.slice(11,19)},${finalReason}
      )
    `;
    await appendAuditEvent(tx, {
      action: "PAYEE_DETAILS_FINANCE_VERIFIED",
      entityType: "Payment Payee Details",
      entityId: Number(payee.id),
      entityReference: request.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: before,
      afterValues: after,
      metadata: { purchase_request_id: requestId },
      reasonOrComment: finalReason,
      severity: "High",
      source: "nextjs",
    });

    await notifyRole(tx, "Procurement Manager", "Payee details Finance verified", `${request.request_no} is payment-ready after Finance verification.`, "Purchase Request", requestId, "Post-Payment Closure", "Open Request");
    await notifyRole(tx, "Auditor", "Audit activity: payee Finance verification", `${user.role} verified masked payee details for ${request.request_no}.`, "Payment Payee Details", Number(payee.id), "Payment Payee / Bank Detail Access Audit", "Open Payee Audit", "High");

    return { requestId, payeeId: Number(payee.id), status: "Finance Verified", alreadyVerified: false };
  });
}

export async function recordFinancePayment(
  user: CurrentUser,
  requestId: number,
  input: {
    transferType: FinanceTransferType;
    paymentReference: string;
    paymentDate: string;
    financeNote?: string;
  },
) {
  assertFinance(user);
  if (!Number.isInteger(requestId) || requestId <= 0) throw new Error("A valid purchase request is required.");
  if (!["Internet Bank Transfer", "Physical Bank Transfer"].includes(input.transferType)) {
    throw new Error("Transfer type must be Internet Bank Transfer or Physical Bank Transfer.");
  }
  const paymentReference = String(input.paymentReference || "").trim();
  if (!paymentReference) throw new Error("A payment reference is required for reconciliation.");
  const paymentDate = String(input.paymentDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("A valid payment date is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const requests = await tx<{
      id: number; request_no: string; requested_by: number | null; facility_manager_user_id: number | null;
      assigned_procurement_manager_id: number | null; approved_by_user_id: number | null;
      status: string | null; payment_status: string | null; approval_rescinded_at: Date | string | null;
      selected_payee_detail_id: number | null; selected_vendor_id: number | null;
      selected_vendor_quote_id: number | null; linked_po_id: number | null; estimated_amount: string | number | null;
    }[]>`
      SELECT id,request_no,requested_by,facility_manager_user_id,assigned_procurement_manager_id,
             approved_by_user_id,status,payment_status,approval_rescinded_at,selected_payee_detail_id,
             selected_vendor_id,selected_vendor_quote_id,linked_po_id,estimated_amount
      FROM purchase_requests WHERE id=${requestId} FOR UPDATE
    `;
    const request = requests[0];
    if (!request) throw new Error("Purchase request not found.");

    if (String(request.payment_status || "") === "Paid") {
      const prior = await tx<{ id: number; payment_no: string }[]>`
        SELECT id,payment_no FROM payments WHERE request_id=${requestId} AND status='Paid' ORDER BY id DESC LIMIT 1
      `;
      if (prior[0]) return { paymentId: Number(prior[0].id), paymentNo: prior[0].payment_no, status: "Paid", alreadyPaid: true };
    }
    if (!requestPaymentReady(request.status, request.payment_status)) {
      throw new Error("Only an approved request can be paid.");
    }
    if (request.approval_rescinded_at && String(request.status || "") !== "Approved") {
      throw new Error("Finance cannot pay a request while its approval is rescinded.");
    }

    const payees = await tx<{
      id: number; vendor_id: number | null; currency: string | null; recipient_known: boolean | null;
      verification_status: string | null; payment_readiness_status: string | null;
      payee_name_encrypted: string | null; account_name_encrypted: string | null;
      bank_name_encrypted: string | null; account_number_encrypted: string | null;
      payee_name_masked: string | null; account_name_masked: string | null; bank_name_masked: string | null;
      account_number_last4: string | null; payee_type: string | null;
    }[]>`
      SELECT id,vendor_id,currency,recipient_known,verification_status,payment_readiness_status,
             payee_name_encrypted,account_name_encrypted,bank_name_encrypted,account_number_encrypted,
             payee_name_masked,account_name_masked,bank_name_masked,account_number_last4,payee_type
      FROM payment_payee_details
      WHERE id=${request.selected_payee_detail_id}
         OR (${request.selected_payee_detail_id} IS NULL AND purchase_request_id=${requestId} AND COALESCE(is_current,TRUE)=TRUE)
      ORDER BY CASE WHEN id=${request.selected_payee_detail_id} THEN 0 ELSE 1 END,id DESC
      LIMIT 1
      FOR UPDATE
    `;
    const payee = payees[0];
    if (!payee) throw new Error("No approved payee is linked to this request.");
    if (String(payee.verification_status || "") !== "Finance Verified") {
      throw new Error("Payee details must be Finance verified before payment.");
    }
    if (String(payee.payment_readiness_status || "") !== "Payment Ready") {
      throw new Error("The linked payee is not marked Payment Ready.");
    }
    assertV2PayeeReadable(payee);
    if (request.selected_vendor_id && payee.vendor_id && Number(request.selected_vendor_id) !== Number(payee.vendor_id)) {
      throw new Error("The selected vendor differs from the linked payee.");
    }

    let amount = Number(request.estimated_amount || 0);
    let quoteCurrency: string | null = null;
    if (request.selected_vendor_quote_id) {
      const quotes = await tx<{ quotation_total: string | number | null; quoted_amount: string | number | null; currency: string | null }[]>`
        SELECT quotation_total,quoted_amount,currency FROM vendor_quotes WHERE id=${request.selected_vendor_quote_id} LIMIT 1
      `;
      if (quotes[0]) {
        amount = Number(quotes[0].quotation_total ?? quotes[0].quoted_amount ?? amount);
        quoteCurrency = quotes[0].currency;
      }
    }
    const currency = payee.currency || quoteCurrency || "NGN";

    const approval = await tx<{ id: number }[]>`
      SELECT id FROM approval_history
      WHERE entity_type='Purchase Request' AND entity_id=${requestId} AND status_after='Approved'
      ORDER BY created_at DESC,id DESC LIMIT 1
    `;
    const approvalId = approval[0] ? Number(approval[0].id) : null;
    const dedupeKey = `payment-recorded:${requestId}:${paymentReference}`;
    const duplicate = await tx<{ id: number; payment_no: string; status: string | null }[]>`
      SELECT id,payment_no,status FROM payments
      WHERE notification_dedupe_key=${dedupeKey}
         OR (request_id=${requestId} AND payment_reference=${paymentReference})
      ORDER BY id DESC LIMIT 1
    `;
    if (duplicate[0] && String(duplicate[0].status || "") === "Paid") {
      return { paymentId: Number(duplicate[0].id), paymentNo: duplicate[0].payment_no, status: "Paid", alreadyPaid: true };
    }

    const now = new Date().toISOString();
    const existing = await tx<{ id: number; payment_no: string }[]>`
      SELECT id,payment_no FROM payments
      WHERE request_id=${requestId} AND status IN ('Approved','Approved for Payment','Pending Payment')
      ORDER BY id DESC LIMIT 1 FOR UPDATE
    `;

    let paymentId: number;
    let paymentNo: string;
    if (existing[0]) {
      paymentId = Number(existing[0].id);
      paymentNo = existing[0].payment_no;
      await tx`
        UPDATE payments SET vendor_id=${request.selected_vendor_id},payee_detail_id=${payee.id},
          approval_history_id=${approvalId},amount=${amount},currency=${currency},payment_method='Bank Transfer',
          transfer_type=${input.transferType},payment_reference=${paymentReference},payment_date=${paymentDate},
          status='Paid',verification_status='Verified',paid_by=${user.id},finance_note=${input.financeNote?.trim() || null},
          notification_dedupe_key=${dedupeKey},next_role='procurement_manager',updated_at=${now}
        WHERE id=${paymentId}
      `;
    } else {
      const compact = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      paymentNo = `PAY-${compact}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const inserted = await tx<{ id: number }[]>`
        INSERT INTO payments (
          payment_no,request_id,po_id,vendor_id,payee_detail_id,approval_history_id,
          amount,currency,payment_method,transfer_type,payment_reference,payment_date,status,
          verification_status,finance_note,paid_by,created_by,notification_dedupe_key,next_role,created_at,updated_at
        ) VALUES (
          ${paymentNo},${requestId},${request.linked_po_id},${request.selected_vendor_id},${payee.id},${approvalId},
          ${amount},${currency},'Bank Transfer',${input.transferType},${paymentReference},${paymentDate},'Paid',
          'Verified',${input.financeNote?.trim() || null},${user.id},${user.id},${dedupeKey},'procurement_manager',${now},${now}
        ) RETURNING id
      `;
      paymentId = Number(inserted[0].id);
    }

    await tx`
      UPDATE purchase_requests SET status='Paid',payment_status='Paid',paid_at=COALESCE(paid_at,${now}),
        next_role='procurement_manager',selected_payee_detail_id=${payee.id},updated_at=${now}
      WHERE id=${requestId}
    `;
    if (request.linked_po_id) {
      await tx`
        UPDATE purchase_orders SET payment_status='Paid',
          status=CASE WHEN status='Closed' THEN status ELSE 'Paid' END,updated_at=${now}
        WHERE id=${request.linked_po_id}
      `;
    }

    const workflowNote = `Payment reference ${paymentReference}; transfer type ${input.transferType}.`;
    await tx`
      INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
      VALUES ('Purchase Request',${requestId},'Payment Recorded','Paid',${workflowNote},${user.id},${now})
    `;
    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,
        visibility_scope,related_user_id,created_at
      ) VALUES (
        ${user.id},${user.role},'Payment Recorded','Purchase Request',${requestId},
        ${`${request.request_no} was paid.`},${`Amount ${amount.toFixed(2)}; reference ${paymentReference}; transfer type ${input.transferType}`},
        'workflow',${request.requested_by},${now}
      )
    `;
    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,before_values,after_values,
        created_at,event_date,event_time,amount,notes
      ) VALUES (
        'PAYMENT_RECORDED','Payment',${String(paymentId)},${user.id},${user.role},${workflowNote},
        ${tx.json({request_status:request.status,payment_status:request.payment_status})},
        ${tx.json({request_status:'Paid',payment_status:'Paid',amount,payment_reference:paymentReference,transfer_type:input.transferType})},
        ${now},${now.slice(0,10)},${now.slice(11,19)},${amount},${input.financeNote?.trim() || null}
      )
    `;
    await appendAuditEvent(tx, {
      action: "PAYMENT_RECORDED",
      entityType: "Payment",
      entityId: paymentId,
      entityReference: paymentNo,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { request_status: request.status, payment_status: request.payment_status },
      afterValues: { request_status: "Paid", payment_status: "Paid", amount, payment_reference: paymentReference, transfer_type: input.transferType },
      metadata: { parent_entity_type: "Purchase Request", parent_entity_id: requestId, payee_detail_id: Number(payee.id), selected_vendor_id: request.selected_vendor_id },
      reasonOrComment: input.financeNote?.trim() || null,
      severity: "High",
      source: "nextjs",
    });

    const participantIds = Array.from(new Set([
      request.requested_by,
      request.facility_manager_user_id,
      request.assigned_procurement_manager_id,
      request.approved_by_user_id,
    ].filter((value): value is number => Number.isInteger(Number(value)) && Number(value) > 0).map(Number)));
    const message = `${request.request_no} was paid. Amount: ${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}. Payment date: ${paymentDate}. Reference: ${paymentReference}. Transfer type: ${input.transferType}. Current status: Paid.`;
    for (const uid of participantIds) {
      await notifyUser(tx, uid, "Procurement Payment Recorded", message, "Purchase Request", requestId, "My Activity History", "View Request", "High", `${dedupeKey}:${uid}`);
    }
    await notifyRole(tx, "Procurement Manager", "Payment recorded - closure required", `${request.request_no} was paid and is now routed to Procurement for post-payment closure.`, "Purchase Request", requestId, "Post-Payment Closure", "Open Closure Queue", "High");
    await notifyRole(tx, "Auditor", "Audit activity: payment recorded", `${user.role} recorded payment ${paymentNo} for ${request.request_no}.`, "Payment", paymentId, "Finance, Invoice & Payment Audit", "Open Finance Audit", "High");

    return { paymentId, paymentNo, status: "Paid", alreadyPaid: false };
  });
}

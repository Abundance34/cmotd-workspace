import { createHmac } from "node:crypto";
import type { CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeAuditSigningKey, appendAuditEvent } from "./audit";
import { encryptPayeeValueV2 } from "./payee-crypto";

export type DraftItemInput = {
  itemName?: string;
  description?: string;
  itemCategory?: string;
  suggestedVendor?: string;
  quantity?: number;
  unitPrice?: number;
};

export type DraftPayeeInput = {
  recipientKnown?: boolean;
  payeeType?: string;
  payeeName?: string;
  accountName?: string;
  bankName?: string;
  accountNumber?: string;
  currency?: string;
  paymentReference?: string;
  contactEmail?: string;
  contactPhone?: string;
  confirmation?: boolean;
  delayedReason?: string;
};

export type DraftRequestInput = {
  departmentProject?: string;
  requiredDate?: string;
  category?: string;
  priority?: string;
  vendorPreference?: string;
  justification?: string;
  items?: DraftItemInput[];
  payee?: DraftPayeeInput | null;
};

const EDITABLE_STATUSES = new Set([
  "FM Draft",
  "PM Draft",
  "Draft",
  "Returned for Correction",
  "Returned to Facility Manager",
  "Returned to Procurement Manager",
  "Returned",
]);

function clean(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeItems(input: DraftItemInput[] | undefined) {
  const source = Array.isArray(input) ? input : [];
  if (!source.length) throw new Error("Add at least one item or service to the request.");
  return source.map((item, index) => {
    const itemName = clean(item.itemName, 250);
    const description = clean(item.description, 1000) || itemName;
    const itemCategory = clean(item.itemCategory, 250);
    const suggestedVendor = clean(item.suggestedVendor, 250);
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    if (!itemName) throw new Error(`Item ${index + 1} requires an item or service name.`);
    if (!(quantity > 0)) throw new Error(`Item ${index + 1} quantity must be greater than zero.`);
    if (!(unitPrice >= 0)) throw new Error(`Item ${index + 1} unit price cannot be negative.`);
    const total = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
    return { itemName, description, itemCategory, suggestedVendor, quantity, unitPrice, total };
  });
}

function normalizeCore(input: DraftRequestInput) {
  const departmentProject = clean(input.departmentProject, 250);
  const requiredDate = clean(input.requiredDate, 30);
  const category = clean(input.category, 250) || "General";
  const priority = clean(input.priority, 80) || "Normal";
  const vendorPreference = clean(input.vendorPreference, 500);
  const justification = clean(input.justification, 3000);
  if (!departmentProject) throw new Error("Choose a Department / Project.");
  if (!requiredDate) throw new Error("Choose a required date.");
  if (!justification) throw new Error("Business justification is required.");
  const items = normalizeItems(input.items);
  const estimatedAmount = Math.round((items.reduce((sum, item) => sum + item.total, 0) + Number.EPSILON) * 100) / 100;
  return { departmentProject, requiredDate, category, priority, vendorPreference, justification, items, estimatedAmount };
}

function normalizePayee(input: DraftPayeeInput) {
  const recipientKnown = Boolean(input.recipientKnown);
  const currency = clean(input.currency, 10).toUpperCase() || "NGN";
  const data = {
    recipientKnown,
    payeeType: clean(input.payeeType, 80) || "Vendor / Supplier",
    payeeName: clean(input.payeeName, 250),
    accountName: clean(input.accountName, 250),
    bankName: clean(input.bankName, 250),
    accountNumber: clean(input.accountNumber, 40).replace(/\s+/g, ""),
    currency,
    paymentReference: clean(input.paymentReference, 250),
    contactEmail: clean(input.contactEmail, 250),
    contactPhone: clean(input.contactPhone, 80),
    delayedReason: clean(input.delayedReason, 1000),
  };
  if (recipientKnown) {
    if (!data.payeeName || !data.accountName || !data.bankName || !data.accountNumber) {
      throw new Error("Payee name, account name, bank name and account number are required when the recipient is known.");
    }
    if (currency === "NGN" && !/^\d{10}$/.test(data.accountNumber)) {
      throw new Error("NGN account numbers must contain exactly 10 numeric digits.");
    }
    if (!input.confirmation) throw new Error("Confirm that the replacement payment details came from an authorized source.");
  } else if (!data.delayedReason) {
    throw new Error("Give a reason when payment recipient details are not yet known.");
  }
  return data;
}

function maskName(value: string) {
  if (!value) return null;
  if (value.length <= 2) return `${value[0] || ""}*`;
  return `${value.slice(0, 1)}${"*".repeat(Math.min(8, Math.max(2, value.length - 2)))}${value.slice(-1)}`;
}

function newProcurementRequestNo() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const random = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `PM-${stamp.slice(0, 8)}-${stamp.slice(8)}-${random}`;
}

async function replacePayee(tx: any, user: CurrentUser, requestId: number, input: DraftPayeeInput, now: string) {
  const payee = normalizePayee(input);
  const known = payee.recipientKnown;
  const fingerprint = known
    ? createHmac("sha256", activeAuditSigningKey()).update(payee.accountNumber, "utf8").digest("hex")
    : null;
  const duplicateRows = known
    ? await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM payment_payee_details
        WHERE account_number_fingerprint = ${fingerprint}
          AND purchase_request_id <> ${requestId}
      `
    : [{ count: 0 }];
  const duplicateWarning = Number(duplicateRows[0]?.count || 0) > 0;
  const verificationStatus = known ? "Requester Confirmed" : "Pending";
  const readinessStatus = known ? "Pending Finance Verification" : "Pending Payee Details";

  await tx`
    UPDATE payment_payee_details
    SET is_current=FALSE, updated_at=${now}, updated_by_user_id=${user.id}
    WHERE purchase_request_id=${requestId} AND COALESCE(is_current, TRUE)=TRUE
  `;

  const inserted = await tx<{ id: number }[]>`
    INSERT INTO payment_payee_details (
      purchase_request_id, payee_type,
      payee_name_encrypted, payee_name_masked,
      account_name_encrypted, account_name_masked,
      bank_name_encrypted, bank_name_masked,
      account_number_encrypted, account_number_last4, account_number_fingerprint,
      currency, payment_reference_encrypted, contact_email_encrypted, contact_phone_encrypted,
      recipient_known, payment_readiness_status, verification_status,
      confirmed_by_user_id, confirmed_at, rejected_reason_encrypted,
      created_by_user_id, created_at, updated_by_user_id, updated_at, is_current
    ) VALUES (
      ${requestId}, ${payee.payeeType},
      ${known ? encryptPayeeValueV2(payee.payeeName) : null}, ${known ? maskName(payee.payeeName) : null},
      ${known ? encryptPayeeValueV2(payee.accountName) : null}, ${known ? maskName(payee.accountName) : null},
      ${known ? encryptPayeeValueV2(payee.bankName) : null}, ${known ? maskName(payee.bankName) : null},
      ${known ? encryptPayeeValueV2(payee.accountNumber) : null}, ${known ? payee.accountNumber.slice(-4) : null}, ${fingerprint},
      ${payee.currency}, ${payee.paymentReference ? encryptPayeeValueV2(payee.paymentReference) : null},
      ${payee.contactEmail ? encryptPayeeValueV2(payee.contactEmail) : null},
      ${payee.contactPhone ? encryptPayeeValueV2(payee.contactPhone) : null},
      ${known}, ${readinessStatus}, ${verificationStatus},
      ${known ? user.id : null}, ${known ? now : null}, ${!known ? encryptPayeeValueV2(payee.delayedReason) : null},
      ${user.id}, ${now}, ${user.id}, ${now}, TRUE
    )
    RETURNING id
  `;
  const payeeId = Number(inserted[0].id);
  const snapshot = {
    payee_type: payee.payeeType,
    payee_name_masked: known ? maskName(payee.payeeName) : null,
    account_name_masked: known ? maskName(payee.accountName) : null,
    bank_name_masked: known ? maskName(payee.bankName) : null,
    account_number_last4: known ? payee.accountNumber.slice(-4) : null,
    currency: payee.currency,
    recipient_known: known,
    duplicate_warning: duplicateWarning,
    payment_readiness_status: readinessStatus,
    verification_status: verificationStatus,
  };
  await tx`
    INSERT INTO payment_payee_detail_versions (
      payee_detail_id, version_no, action, values_redacted_json,
      changed_by_user_id, reason, created_at
    ) VALUES (
      ${payeeId}, 1, 'PAYEE_DETAILS_REPLACED', ${tx.json(snapshot)},
      ${user.id}, 'Draft payment details replaced by request owner', ${now}
    )
  `;
  await tx`UPDATE purchase_requests SET selected_payee_detail_id=${payeeId}, updated_at=${now} WHERE id=${requestId}`;
  return { payeeId, readinessStatus, verificationStatus, duplicateWarning, snapshot };
}

export async function createProcurementDraft(user: CurrentUser, input: DraftRequestInput) {
  if (user.role !== "Procurement Manager" && user.role !== "Admin") {
    throw new Error("Only Procurement Manager or Admin can create a Procurement-originated request.");
  }
  const core = normalizeCore(input);
  const payee = normalizePayee(input.payee || { recipientKnown: false, delayedReason: "Payment recipient details will be supplied before payment." });
  const sql = db();
  return sql.begin(async (tx) => {
    const now = new Date().toISOString();
    const reqNo = newProcurementRequestNo();
    const inserted = await tx<{ id: number }[]>`
      INSERT INTO purchase_requests (
        request_no, requested_by, department_project, request_date, required_date,
        category, justification, priority, estimated_amount, vendor_preference,
        status, source_type, supplier_suggestions, account_details, vendor_suggestions,
        facility_manager_user_id, assigned_procurement_manager_id, next_role,
        created_at, updated_at
      ) VALUES (
        ${reqNo}, ${user.id}, ${core.departmentProject}, ${now.slice(0, 10)}, ${core.requiredDate},
        ${core.category}, ${core.justification}, ${core.priority}, ${core.estimatedAmount}, ${core.vendorPreference || null},
        'PM Draft', 'Procurement Manager', ${tx.json([])}, '', ${tx.json([])},
        NULL, ${user.id}, NULL, ${now}, ${now}
      )
      RETURNING id
    `;
    const requestId = Number(inserted[0].id);
    for (const item of core.items) {
      await tx`
        INSERT INTO purchase_request_items (
          request_id, item_name, description, quantity, unit_price, total,
          category, suggested_vendor, created_at
        ) VALUES (
          ${requestId}, ${item.itemName}, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${item.total},
          ${item.itemCategory || core.category}, ${item.suggestedVendor || null}, ${now}
        )
      `;
    }
    const payeeResult = await replacePayee(tx, user, requestId, { ...payee, confirmation: true }, now);
    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${requestId}, 'Draft Created', 'PM Draft', 'Procurement Manager-originated draft created for independent approval routing.', ${user.id}, ${now})
    `;
    await tx`
      INSERT INTO activity_logs (user_id, role, action, entity_type, entity_id, public_summary, private_details, visibility_scope, related_user_id, created_at)
      VALUES (${user.id}, ${user.role}, 'DRAFT_CREATED', 'Purchase Request', ${requestId}, ${`${reqNo} was created as a PM Draft`}, 'Procurement-originated request. Self-approval is prohibited; submission routes directly to Approver / MD.', 'workflow', ${user.id}, ${now})
    `;
    await appendAuditEvent(tx, {
      action: "DRAFT_CREATED",
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: reqNo,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      afterValues: { status: "PM Draft", estimated_amount: core.estimatedAmount, department_project: core.departmentProject, selected_payee_detail_id: payeeResult.payeeId },
      metadata: { origin: "Procurement Manager", independent_approval_required: true },
      reasonOrComment: "Procurement Manager created a request draft.",
    });
    await tx`
      INSERT INTO notifications (user_id, role, title, message, entity_type, entity_id, is_read, popup_shown, importance, delivery_channel, push_sent, email_sent, action_label, section_target, created_at)
      SELECT u.id, NULL, 'New Procurement draft created', ${`${reqNo} was created by ${user.fullName}. It remains a draft until submitted directly to Approver / MD.`}, 'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE, 'View Request Activity', CASE u.role WHEN 'Procurement Manager' THEN 'Purchase Requests' WHEN 'Approver' THEN 'Approval Dashboard' WHEN 'Admin' THEN 'All Procurement Records' WHEN 'Auditor' THEN 'Audit Dashboard' ELSE 'Dashboard' END, ${now}
      FROM users u
      WHERE u.id <> ${user.id} AND COALESCE(u.is_active, TRUE)=TRUE AND COALESCE(u.account_locked, FALSE)=FALSE
    `;
    return { requestId, requestNo: reqNo, status: "PM Draft", estimatedAmount: core.estimatedAmount, payee: { id: payeeResult.payeeId, verificationStatus: payeeResult.verificationStatus } };
  });
}

export async function updateOwnedDraft(user: CurrentUser, requestId: number, input: DraftRequestInput) {
  if (!["Facility Manager", "Procurement Manager", "Admin"].includes(user.role)) throw new Error("This role cannot edit request drafts.");
  const core = normalizeCore(input);
  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`;
    const record = rows[0];
    if (!record) throw new Error("Purchase request not found.");
    if (user.role !== "Admin" && Number(record.requested_by || 0) !== user.id) throw new Error("You can edit only drafts that you created.");
    if (!EDITABLE_STATUSES.has(String(record.status || ""))) throw new Error(`This request can no longer be edited because it is in '${record.status || "Unknown"}'.`);
    const now = new Date().toISOString();
    await tx`
      UPDATE purchase_requests
      SET department_project=${core.departmentProject}, required_date=${core.requiredDate}, category=${core.category},
          justification=${core.justification}, priority=${core.priority}, vendor_preference=${core.vendorPreference || null},
          estimated_amount=${core.estimatedAmount}, updated_at=${now}
      WHERE id=${requestId}
    `;
    await tx`DELETE FROM purchase_request_items WHERE request_id=${requestId}`;
    for (const item of core.items) {
      await tx`
        INSERT INTO purchase_request_items (request_id, item_name, description, quantity, unit_price, total, category, suggested_vendor, created_at)
        VALUES (${requestId}, ${item.itemName}, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${item.total}, ${item.itemCategory || core.category}, ${item.suggestedVendor || null}, ${now})
      `;
    }
    let payeeResult: any = null;
    if (input.payee) payeeResult = await replacePayee(tx, user, requestId, input.payee, now);
    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${requestId}, 'Draft Updated', ${record.status}, 'Draft content updated by the request owner.', ${user.id}, ${now})
    `;
    await tx`
      INSERT INTO activity_logs (user_id, role, action, entity_type, entity_id, public_summary, private_details, visibility_scope, related_user_id, created_at)
      VALUES (${user.id}, ${user.role}, 'DRAFT_UPDATED', 'Purchase Request', ${requestId}, ${`${record.request_no} draft was updated`}, ${input.payee ? 'Request fields, line items and payment recipient details were updated.' : 'Request fields and line items were updated; existing payment recipient details were preserved.'}, 'workflow', ${record.assigned_procurement_manager_id || null}, ${now})
    `;
    await appendAuditEvent(tx, {
      action: "DRAFT_UPDATED",
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: record.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: record.status, department_project: record.department_project, category: record.category, priority: record.priority, estimated_amount: Number(record.estimated_amount || 0), selected_payee_detail_id: record.selected_payee_detail_id || null },
      afterValues: { status: record.status, department_project: core.departmentProject, category: core.category, priority: core.priority, estimated_amount: core.estimatedAmount, selected_payee_detail_id: payeeResult?.payeeId || record.selected_payee_detail_id || null },
      metadata: { payment_details_replaced: Boolean(input.payee), item_count: core.items.length },
      reasonOrComment: "Request owner edited a draft before resubmission.",
    });
    return { requestId, requestNo: record.request_no, status: record.status, estimatedAmount: core.estimatedAmount, paymentDetailsReplaced: Boolean(input.payee) };
  });
}

export async function submitProcurementOwnedDraft(user: CurrentUser, requestId: number) {
  if (user.role !== "Procurement Manager" && user.role !== "Admin") throw new Error("Only Procurement Manager or Admin can submit this request to Approver / MD.");
  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<any[]>`
      SELECT pr.*, requester.role AS requester_role
      FROM purchase_requests pr JOIN users requester ON requester.id=pr.requested_by
      WHERE pr.id=${requestId}
      FOR UPDATE OF pr
    `;
    const record = rows[0];
    if (!record) throw new Error("Purchase request not found.");
    if (record.requester_role !== "Procurement Manager") throw new Error("Only Procurement Manager-originated requests use this direct approval route.");
    if (user.role !== "Admin" && Number(record.requested_by || 0) !== user.id) throw new Error("You can submit only Procurement drafts that you created.");
    if (!EDITABLE_STATUSES.has(String(record.status || ""))) throw new Error(`This request cannot be submitted from '${record.status || "Unknown"}'.`);
    const now = new Date().toISOString();
    await tx`
      UPDATE purchase_requests
      SET status='Submitted for Approval', next_role='approver', submitted_at=${now}, assigned_procurement_manager_id=${record.assigned_procurement_manager_id || user.id}, updated_at=${now}
      WHERE id=${requestId}
    `;
    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${requestId}, 'Submitted for Approval', 'Submitted for Approval', 'Procurement Manager-originated request routed directly to Approver / MD for segregation-of-duties approval.', ${user.id}, ${now})
    `;
    await tx`
      INSERT INTO activity_logs (user_id, role, action, entity_type, entity_id, public_summary, private_details, visibility_scope, related_user_id, created_at)
      VALUES (${user.id}, ${user.role}, 'Submitted for Approval', 'Purchase Request', ${requestId}, ${`${record.request_no} moved from ${record.status} to Submitted for Approval`}, 'Independent Approver / MD decision required because Procurement originated the request.', 'workflow', ${record.requested_by}, ${now})
    `;
    await appendAuditEvent(tx, {
      action: "Submitted for Approval",
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: record.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: record.status, next_role: record.next_role },
      afterValues: { status: "Submitted for Approval", next_role: "approver" },
      metadata: { requester_role: "Procurement Manager", segregation_of_duties: true },
      reasonOrComment: "Procurement-originated request submitted directly to Approver / MD.",
    });
    await tx`
      INSERT INTO notifications (user_id, role, title, message, entity_type, entity_id, is_read, popup_shown, importance, delivery_channel, push_sent, email_sent, action_label, section_target, created_at)
      VALUES (NULL, 'Approver', 'Procurement request submitted for approval', ${`${record.request_no} was created by Procurement Manager and requires independent Approver / MD approval.`}, 'Purchase Request', ${requestId}, FALSE, FALSE, 'High', 'in_app', FALSE, FALSE, 'Open Pending Approval', 'Pending Approvals', ${now})
    `;
    await tx`
      INSERT INTO notifications (user_id, role, title, message, entity_type, entity_id, is_read, popup_shown, importance, delivery_channel, push_sent, email_sent, action_label, section_target, created_at)
      VALUES (NULL, 'Admin', 'Procurement-originated request submitted', ${`${record.request_no} was submitted directly to Approver / MD.`}, 'Purchase Request', ${requestId}, FALSE, FALSE, 'Important', 'in_app', FALSE, FALSE, 'Open Procurement Records', 'All Procurement Records', ${now})
    `;
    await tx`
      INSERT INTO notifications (user_id, role, title, message, entity_type, entity_id, is_read, popup_shown, importance, delivery_channel, push_sent, email_sent, action_label, section_target, created_at)
      VALUES (NULL, 'Auditor', 'Audit activity: Procurement request submitted', ${`${record.request_no} entered independent approval because Procurement Manager is the requester.`}, 'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE, 'Open Approval Trails', 'Approval Trails', ${now})
    `;
    return { requestId, requestNo: record.request_no, status: "Submitted for Approval", nextRole: "approver" };
  });
}

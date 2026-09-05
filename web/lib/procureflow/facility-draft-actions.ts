import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { activeAuditSigningKey, appendAuditEvent } from "./audit";
import { encryptPayeeValueV2 } from "./payee-crypto";

export const FACILITY_EXPENSE_CATEGORIES = [
  "Diesel/Fuel",
  "Water",
  "Office Supplies",
  "Repairs/Maintenance",
  "Vehicle Maintenance",
  "Generator Maintenance",
  "Plumbing",
  "Welding/Fabrication",
  "Grass Cutting",
  "Transport/Logistics",
  "Staff Welfare",
  "ICT/Software",
  "Utilities",
  "Construction Materials",
  "Professional Services",
  "Operational Purchases",
  "Other",
] as const;

export const FACILITY_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export const PAYEE_TYPES = ["Vendor", "Individual", "Organisation", "Government Agency", "Other"] as const;
export const PAYEE_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "Other"] as const;

export type FacilityDraftItemInput = {
  itemName: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  category?: string | null;
  suggestedVendor?: string | null;
};

export type FacilityDraftPayeeInput = {
  recipientKnown: boolean;
  payeeType?: string | null;
  payeeName?: string | null;
  accountName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  currency?: string | null;
  paymentReference?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  confirmation?: boolean;
  delayedReason?: string | null;
};

export type CreateFacilityDraftInput = {
  departmentProject: string;
  requiredDate: string;
  category: string;
  priority: string;
  vendorPreference?: string | null;
  justification: string;
  items: FacilityDraftItemInput[];
  payee: FacilityDraftPayeeInput;
};

type Tx = any;

type ValidatedPayee = {
  recipientKnown: boolean;
  payeeType: string;
  payeeName: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  currency: string;
  paymentReference: string;
  contactEmail: string;
  contactPhone: string;
  delayedReason: string;
};

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function maskName(value: string) {
  if (!value.trim()) return "—";
  return value
    .trim()
    .split(/\s+/)
    .map((word) => (word.length <= 1 ? "*" : `${word[0]}${"*".repeat(Math.max(2, word.length - 1))}`))
    .join(" ");
}

function accountFingerprint(value: string) {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  return createHmac("sha256", activeAuditSigningKey())
    .update(`fingerprint:${normalized}`, "utf8")
    .digest("hex");
}

function requestNumber(now = new Date()) {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `UF-${date}-${time}-${pad(now.getUTCMilliseconds(), 3)}`;
}

function validateRequiredDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Required date is required.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Required date is invalid.");
  return value;
}

function validatePayee(input: FacilityDraftPayeeInput): ValidatedPayee {
  const recipientKnown = Boolean(input?.recipientKnown);
  const currency = clean(input?.currency || "NGN", 12).toUpperCase();
  const data: ValidatedPayee = {
    recipientKnown,
    payeeType: clean(input?.payeeType || "Vendor", 80),
    payeeName: clean(input?.payeeName, 200),
    accountName: clean(input?.accountName, 200),
    bankName: clean(input?.bankName, 200),
    accountNumber: clean(input?.accountNumber, 40).replace(/\s+/g, ""),
    currency,
    paymentReference: clean(input?.paymentReference, 250),
    contactEmail: clean(input?.contactEmail, 250),
    contactPhone: clean(input?.contactPhone, 80),
    delayedReason: clean(input?.delayedReason, 1000),
  };

  if (recipientKnown) {
    const missing = [
      ["Payee Full / Legal Name", data.payeeName],
      ["Account Name", data.accountName],
      ["Bank Name", data.bankName],
      ["Account Number", data.accountNumber],
    ].filter(([, value]) => !value).map(([label]) => label);
    if (missing.length) throw new Error(`Complete the following payee fields: ${missing.join(", ")}.`);
    if (currency === "NGN" && !/^\d{10}$/.test(data.accountNumber)) {
      throw new Error("NGN account numbers must contain exactly 10 numeric digits.");
    }
    if (!input.confirmation) {
      throw new Error("Confirm that the payment details came from an authorized source.");
    }
  } else if (!data.delayedReason) {
    throw new Error("Give a reason for delayed payee details.");
  }

  return data;
}

async function activeProcurementManager(tx: Tx, facilityManagerUserId: number) {
  const linked = await tx<{ id: number }[]>`
    SELECT u.id
    FROM facility_manager_links fml
    JOIN users u ON u.id = fml.procurement_manager_user_id
    WHERE fml.facility_manager_user_id = ${facilityManagerUserId}
      AND COALESCE(fml.is_active, 1) <> 0
      AND lower(trim(u.role)) = 'procurement manager'
      AND COALESCE(u.is_active, TRUE) = TRUE
      AND COALESCE(u.account_locked, FALSE) = FALSE
    ORDER BY fml.id DESC
    LIMIT 1
  `;
  if (linked[0]) return Number(linked[0].id);

  const fallback = await tx<{ id: number }[]>`
    SELECT id
    FROM users
    WHERE lower(trim(role)) = 'procurement manager'
      AND COALESCE(is_active, TRUE) = TRUE
      AND COALESCE(account_locked, FALSE) = FALSE
    ORDER BY id
    LIMIT 1
  `;
  return fallback[0] ? Number(fallback[0].id) : null;
}

async function savePayee(
  tx: Tx,
  requestId: number,
  user: CurrentUser,
  payee: ValidatedPayee,
  now: string,
) {
  const known = payee.recipientKnown;
  const fingerprint = known ? accountFingerprint(payee.accountNumber) : null;
  const duplicateRows = fingerprint
    ? await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM payment_payee_details
        WHERE account_number_fingerprint = ${fingerprint}
          AND purchase_request_id <> ${requestId}
      `
    : [];
  const duplicateWarning = Number(duplicateRows[0]?.count || 0) > 0;
  const verificationStatus = known ? "Requester Confirmed" : "Pending";
  const readinessStatus = known ? "Pending Finance Verification" : "Pending Payee Details";

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
      ${known ? encryptPayeeValueV2(payee.payeeName) : null}, ${known ? maskName(payee.payeeName) : "Pending"},
      ${known ? encryptPayeeValueV2(payee.accountName) : null}, ${known ? maskName(payee.accountName) : "Pending"},
      ${known ? encryptPayeeValueV2(payee.bankName) : null}, ${known ? maskName(payee.bankName) : "Pending"},
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

  await tx`
    UPDATE purchase_requests
    SET selected_payee_detail_id = ${payeeId}, updated_at = ${now}
    WHERE id = ${requestId}
  `;

  const snapshot = {
    recipient_known: known,
    payee_type: payee.payeeType,
    payee_name: known ? maskName(payee.payeeName) : "Pending",
    account_name: known ? maskName(payee.accountName) : "Pending",
    bank_name: known ? maskName(payee.bankName) : "Pending",
    account_number: known ? `******${payee.accountNumber.slice(-4)}` : "Pending",
    currency: payee.currency,
    payment_readiness_status: readinessStatus,
    verification_status: verificationStatus,
  };

  await tx`
    INSERT INTO payment_payee_detail_versions (
      payee_detail_id, version_no, action, values_redacted_json,
      changed_by_user_id, reason, created_at
    ) VALUES (
      ${payeeId}, 1, 'PAYEE_DETAILS_CREATED', ${tx.json(snapshot)},
      ${user.id}, NULL, ${now}
    )
  `;

  await appendAuditEvent(tx, {
    action: "PAYEE_DETAILS_CREATED",
    entityType: "Payment Payee Details",
    entityId: payeeId,
    entityReference: `Purchase Request ${requestId}`,
    actorUserId: user.id,
    actorUsername: user.username,
    actorRole: user.role,
    afterValues: snapshot,
    metadata: { purchase_request_id: requestId, duplicate_warning: duplicateWarning },
    severity: duplicateWarning ? "High" : "Normal",
    source: "nextjs",
  });

  if (known) {
    await appendAuditEvent(tx, {
      action: "PAYEE_DETAILS_REQUESTER_CONFIRMED",
      entityType: "Payment Payee Details",
      entityId: payeeId,
      entityReference: `Purchase Request ${requestId}`,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      metadata: { purchase_request_id: requestId, verification_status: verificationStatus },
      source: "nextjs",
    });
  }

  return { payeeId, duplicateWarning, verificationStatus, readinessStatus };
}

export async function createFacilityDraft(user: CurrentUser, input: CreateFacilityDraftInput) {
  if (user.role !== "Facility Manager" && user.role !== "Admin") {
    throw new Error("Only Utility Head / Facility Head or Admin can create this draft type.");
  }

  const departmentProject = clean(input?.departmentProject, 250);
  const category = clean(input?.category, 120);
  const justification = clean(input?.justification, 4000);
  const priority = clean(input?.priority || "Normal", 30);
  const vendorPreference = clean(input?.vendorPreference, 500);
  const requiredDate = validateRequiredDate(clean(input?.requiredDate, 10));

  if (!departmentProject) throw new Error("Department / Project is required.");
  if (!category) throw new Error("Category is required.");
  if (!FACILITY_PRIORITIES.includes(priority as (typeof FACILITY_PRIORITIES)[number])) {
    throw new Error("Priority must be Low, Normal, High, or Urgent.");
  }
  if (!justification) throw new Error("Business justification is required.");
  if (!Array.isArray(input?.items) || input.items.length === 0) throw new Error("Add at least one line item.");
  if (input.items.length > 100) throw new Error("A draft can contain at most 100 line items.");

  const items = input.items.map((item, index) => {
    const itemName = clean(item?.itemName, 500);
    const description = clean(item?.description || itemName, 1000);
    const itemCategory = clean(item?.category || category, 120);
    const suggestedVendor = clean(item?.suggestedVendor || vendorPreference, 250);
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice);
    if (!itemName) throw new Error(`Line ${index + 1}: item name is required.`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Line ${index + 1}: quantity must be greater than zero.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Line ${index + 1}: unit price cannot be negative.`);
    const total = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
    return { itemName, description, itemCategory, suggestedVendor, quantity, unitPrice, total };
  });

  const estimatedAmount = Math.round((items.reduce((sum, item) => sum + item.total, 0) + Number.EPSILON) * 100) / 100;
  const payee = validatePayee(input?.payee || { recipientKnown: false, delayedReason: "" });
  const sql = db();

  return sql.begin(async (tx) => {
    const pmId = await activeProcurementManager(tx, user.id);
    if (!pmId) throw new Error("No active Procurement Manager is available for automatic routing.");

    const now = new Date().toISOString();
    let reqNo = requestNumber();
    const collision = await tx<{ exists: boolean }[]>`SELECT EXISTS(SELECT 1 FROM purchase_requests WHERE request_no = ${reqNo}) AS exists`;
    if (collision[0]?.exists) reqNo = `${reqNo}-${String(user.id).padStart(2, "0")}`;

    const inserted = await tx<{ id: number }[]>`
      INSERT INTO purchase_requests (
        request_no, requested_by, department_project, request_date, required_date,
        category, justification, priority, estimated_amount, vendor_preference,
        status, source_type, attachments_json, notes, approval_history_json,
        facility_manager_user_id, assigned_procurement_manager_id, next_role,
        created_at, updated_at
      ) VALUES (
        ${reqNo}, ${user.id}, ${departmentProject}, ${now.slice(0, 10)}, ${requiredDate},
        ${category}, ${justification}, ${priority}, ${estimatedAmount}, ${vendorPreference || null},
        'FM Draft', 'Utility Head / Facility Head', ${tx.json([])}, '', ${tx.json([])},
        ${user.id}, ${pmId}, NULL, ${now}, ${now}
      )
      RETURNING id
    `;
    const requestId = Number(inserted[0].id);

    for (const item of items) {
      await tx`
        INSERT INTO purchase_request_items (
          request_id, item_name, description, quantity, unit_price, total,
          category, suggested_vendor, created_at
        ) VALUES (
          ${requestId}, ${item.itemName}, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${item.total},
          ${item.itemCategory}, ${item.suggestedVendor || null}, ${now}
        )
      `;
    }

    await tx`
      INSERT INTO collaboration_threads (
        entity_type, entity_id, facility_manager_user_id, procurement_manager_user_id,
        created_at, updated_at
      ) VALUES (
        'Purchase Request', ${requestId}, ${user.id}, ${pmId}, ${now}, ${now}
      )
      ON CONFLICT (entity_type, entity_id, facility_manager_user_id, procurement_manager_user_id)
      DO NOTHING
    `;

    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${requestId}, 'Draft Created', 'FM Draft', ${reqNo}, ${user.id}, ${now})
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id, role, action, entity_type, entity_id,
        public_summary, private_details, visibility_scope, related_user_id, created_at
      ) VALUES (
        ${user.id}, ${user.role}, 'DRAFT_CREATED', 'Purchase Request', ${requestId},
        ${`${reqNo} was created as an FM Draft`},
        'Utility / Facility draft created and retained for requester review before procurement submission.',
        'workflow', ${pmId}, ${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action, entity_type, entity_id, user_id, role, details,
        before_values, after_values, created_at, event_date, event_time,
        amount, department, notes
      ) VALUES (
        'DRAFT_CREATED', 'Purchase Request', ${String(requestId)}, ${user.id}, ${user.role},
        ${`Draft ${reqNo} created`}, NULL, ${tx.json({ status: "FM Draft" })},
        ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
        ${estimatedAmount}, ${departmentProject}, 'Utility / Facility draft creation'
      )
    `;

    await appendAuditEvent(tx, {
      action: "DRAFT_CREATED",
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: reqNo,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      afterValues: {
        status: "FM Draft",
        department_project: departmentProject,
        category,
        priority,
        estimated_amount: estimatedAmount,
        assigned_procurement_manager_id: pmId,
      },
      metadata: { line_item_count: items.length },
      reasonOrComment: "Utility / Facility draft created for requester review before procurement submission.",
      source: "nextjs",
    });

    const payeeResult = await savePayee(tx, requestId, user, payee, now);

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        ${user.id}, NULL, 'Draft request created',
        ${`${reqNo} was saved and is ready for review or submission.`},
        'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'My Draft Requests', 'My Draft Requests', ${now}
      )
    `;

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', 'Audit activity: DRAFT_CREATED',
        ${`${user.role} created ${reqNo} as an FM Draft.`},
        'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
    `;

    return {
      requestId,
      requestNo: reqNo,
      status: "FM Draft",
      estimatedAmount,
      procurementManagerId: pmId,
      payee: {
        id: payeeResult.payeeId,
        verificationStatus: payeeResult.verificationStatus,
        paymentReadinessStatus: payeeResult.readinessStatus,
        duplicateWarning: payeeResult.duplicateWarning,
      },
    };
  });
}

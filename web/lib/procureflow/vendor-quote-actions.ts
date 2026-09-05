import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

export type AddVendorQuoteInput = {
  sourcingTaskId: number;
  vendorId?: number | null;
  manualVendor?: string | null;
  quotedAmount: number;
  currency?: string | null;
  deliveryDays?: number | null;
  paymentTerms?: string | null;
  warranty?: string | null;
  vendorRating?: number | null;
  notes?: string | null;
};

function clean(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

export async function addVendorQuote(user: CurrentUser, input: AddVendorQuoteInput) {
  if (user.role !== "Procurement Manager" && user.role !== "Admin") {
    throw new Error("Only Procurement Manager or Admin can add vendor quotes.");
  }

  const sourcingTaskId = Number(input?.sourcingTaskId);
  if (!Number.isInteger(sourcingTaskId) || sourcingTaskId <= 0) throw new Error("A valid sourcing task is required.");

  const vendorId = input?.vendorId == null || Number(input.vendorId) <= 0 ? null : Number(input.vendorId);
  const manualVendor = clean(input?.manualVendor, 250);
  const quotedAmount = Number(input?.quotedAmount);
  const deliveryDays = Number(input?.deliveryDays ?? 0);
  const vendorRating = Number(input?.vendorRating ?? 3);
  const currency = clean(input?.currency || "NGN", 12).toUpperCase();
  const paymentTerms = clean(input?.paymentTerms, 1000);
  const warranty = clean(input?.warranty, 1000);
  const notes = clean(input?.notes, 2000);

  if (!Number.isFinite(quotedAmount) || quotedAmount <= 0) throw new Error("Quoted amount must be greater than zero.");
  if (!Number.isFinite(deliveryDays) || deliveryDays < 0) throw new Error("Delivery days cannot be negative.");
  if (!Number.isInteger(vendorRating) || vendorRating < 1 || vendorRating > 5) throw new Error("Vendor rating must be between 1 and 5.");
  if (!currency) throw new Error("Currency is required.");

  const sql = db();
  return sql.begin(async (tx) => {
    const tasks = await tx<{
      id: number;
      sourcing_no: string;
      request_id: number;
      assigned_to: number | null;
      request_no: string;
      request_status: string | null;
      assigned_procurement_manager_id: number | null;
      facility_manager_user_id: number | null;
    }[]>`
      SELECT st.id, st.sourcing_no, st.request_id, st.assigned_to,
             pr.request_no, pr.status AS request_status,
             pr.assigned_procurement_manager_id, pr.facility_manager_user_id
      FROM sourcing_tasks st
      JOIN purchase_requests pr ON pr.id = st.request_id
      WHERE st.id = ${sourcingTaskId}
      FOR UPDATE OF st, pr
    `;
    const task = tasks[0];
    if (!task) throw new Error("Sourcing task not found.");

    if (
      user.role !== "Admin" &&
      task.assigned_to && Number(task.assigned_to) !== user.id &&
      task.assigned_procurement_manager_id && Number(task.assigned_procurement_manager_id) !== user.id
    ) {
      throw new Error("This sourcing task is assigned to another Procurement Manager.");
    }

    if (!["Requires Sourcing", "Vendor Quote Collection", "Vendor Recommendation"].includes(String(task.request_status || ""))) {
      throw new Error(`Vendor quotes cannot be added while the request is '${task.request_status || "Unknown"}'.`);
    }

    let finalVendorId: number | null = null;
    let finalVendorName = manualVendor;
    if (vendorId) {
      const vendors = await tx<{ id: number; name: string }[]>`
        SELECT id, name
        FROM vendors
        WHERE id = ${vendorId}
          AND COALESCE(status, 'Active') = 'Active'
        LIMIT 1
      `;
      if (!vendors[0]) throw new Error("The selected vendor is unavailable or inactive.");
      finalVendorId = Number(vendors[0].id);
      if (!finalVendorName) finalVendorName = vendors[0].name;
    }
    if (!finalVendorName) throw new Error("Select a registered vendor or enter a manual vendor name.");

    const now = new Date().toISOString();
    const inserted = await tx<{ id: number }[]>`
      INSERT INTO vendor_quotes (
        sourcing_task_id, request_id, vendor_id, vendor_name,
        quoted_amount, quotation_total, currency, quote_date,
        delivery_time_days, payment_terms, warranty, vendor_rating, notes,
        attachment_path, quote_document_path, quote_document_hash,
        is_recommended, is_selected, score, created_at, updated_at
      ) VALUES (
        ${sourcingTaskId}, ${task.request_id}, ${finalVendorId}, ${finalVendorName},
        ${quotedAmount}, ${quotedAmount}, ${currency}, ${now.slice(0, 10)},
        ${deliveryDays}, ${paymentTerms || null}, ${warranty || null}, ${vendorRating}, ${notes || null},
        NULL, NULL, NULL,
        FALSE, FALSE, 0, ${now}, ${now}
      )
      RETURNING id
    `;
    const quoteId = Number(inserted[0].id);

    await tx`
      UPDATE sourcing_tasks
      SET status = 'Collecting Quotes',
          assigned_to = ${user.id},
          updated_at = ${now}
      WHERE id = ${sourcingTaskId}
    `;

    await tx`
      UPDATE purchase_requests
      SET status = 'Vendor Quote Collection',
          linked_sourcing_task_id = ${sourcingTaskId},
          assigned_procurement_manager_id = COALESCE(assigned_procurement_manager_id, ${user.id}),
          next_role = 'procurement_manager',
          updated_at = ${now}
      WHERE id = ${task.request_id}
    `;

    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Sourcing Task', ${sourcingTaskId}, 'Quote Added', 'Collecting Quotes', ${finalVendorName}, ${user.id}, ${now})
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id, role, action, entity_type, entity_id,
        public_summary, private_details, visibility_scope, related_user_id, created_at
      ) VALUES (
        ${user.id}, ${user.role}, 'Quote Added', 'Sourcing Task', ${sourcingTaskId},
        ${`${finalVendorName} quote added to ${task.sourcing_no}`},
        ${`Vendor quote captured for ${task.request_no}; amount ${currency} ${quotedAmount.toFixed(2)}.`},
        'workflow', ${task.facility_manager_user_id}, ${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action, entity_type, entity_id, user_id, role, details,
        before_values, after_values, created_at, event_date, event_time,
        amount, department, notes
      )
      SELECT
        'Quote Added', 'Sourcing Task', ${String(sourcingTaskId)}, ${user.id}, ${user.role},
        ${`Vendor quote ${quoteId} added for ${finalVendorName}`},
        NULL,
        ${tx.json({ quote_id: quoteId, vendor_name: finalVendorName, quoted_amount: quotedAmount, currency, delivery_days: deliveryDays, vendor_rating: vendorRating })},
        ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
        ${quotedAmount}, pr.department_project, ${notes || null}
      FROM purchase_requests pr
      WHERE pr.id = ${task.request_id}
    `;

    await appendAuditEvent(tx, {
      action: "Quote Added",
      entityType: "Vendor Quote",
      entityId: quoteId,
      entityReference: `${task.sourcing_no} / ${finalVendorName}`,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      afterValues: {
        sourcing_task_id: sourcingTaskId,
        request_id: task.request_id,
        vendor_id: finalVendorId,
        vendor_name: finalVendorName,
        quoted_amount: quotedAmount,
        currency,
        delivery_days: deliveryDays,
        payment_terms: paymentTerms || null,
        warranty: warranty || null,
        vendor_rating: vendorRating,
        notes: notes || null,
      },
      metadata: { sourcing_no: task.sourcing_no, request_no: task.request_no },
      reasonOrComment: "Vendor quote captured by Procurement Manager.",
      source: "nextjs",
    });

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', 'Audit activity: Quote Added',
        ${`${user.role} added a ${currency} ${quotedAmount.toFixed(2)} quote from ${finalVendorName} to ${task.sourcing_no}.`},
        'Vendor Quote', ${quoteId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
    `;

    return {
      quoteId,
      sourcingTaskId,
      sourcingNo: task.sourcing_no,
      requestId: Number(task.request_id),
      requestNo: task.request_no,
      vendorId: finalVendorId,
      vendorName: finalVendorName,
      quotedAmount,
      currency,
      status: "Vendor Quote Collection",
    };
  });
}

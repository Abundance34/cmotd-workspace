import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

type QuoteRecord = {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  registry_vendor_name: string | null;
  quoted_amount: string | number;
  quotation_total: string | number | null;
  delivery_time_days: string | number | null;
  vendor_rating: string | number | null;
  currency: string | null;
};

type TaskRecord = {
  id: number;
  sourcing_no: string;
  request_id: number;
  assigned_to: number | null;
  status: string | null;
  approval_status: string | null;
  request_no: string;
  request_status: string | null;
  requested_by: number;
  requester_role: string | null;
  facility_manager_user_id: number | null;
  assigned_procurement_manager_id: number | null;
  next_role: string | null;
  estimated_amount: string | number | null;
  department_project: string | null;
};

type ScoredQuote = QuoteRecord & {
  vendorName: string;
  amount: number;
  deliveryDays: number;
  rating: number;
  score: number;
};

function assertProcurementActor(user: CurrentUser) {
  if (user.role !== "Procurement Manager" && user.role !== "Admin") {
    throw new Error("Only Procurement Manager or Admin can manage vendor recommendations.");
  }
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scoreQuotes(quotes: QuoteRecord[]): ScoredQuote[] {
  if (!quotes.length) return [];

  const normalized = quotes.map((quote) => ({
    ...quote,
    vendorName: quote.vendor_name || quote.registry_vendor_name || "Unnamed vendor",
    amount: Math.max(0, normalizeNumber(quote.quotation_total ?? quote.quoted_amount)),
    deliveryDays: Math.max(0, normalizeNumber(quote.delivery_time_days)),
    rating: Math.min(5, Math.max(0, normalizeNumber(quote.vendor_rating))),
  }));

  const maxAmount = Math.max(1, ...normalized.map((quote) => quote.amount));
  const maxDelivery = Math.max(1, ...normalized.map((quote) => quote.deliveryDays));

  return normalized.map((quote) => {
    // Exact scoring model from the production Streamlit application:
    // price 45%, delivery 25%, vendor rating 30%.
    const raw =
      (1 - quote.amount / maxAmount) * 45 +
      (1 - quote.deliveryDays / maxDelivery) * 25 +
      (quote.rating / 5) * 30;
    return { ...quote, score: Math.round(raw * 10) / 10 };
  });
}

function pickRecommended(scored: ScoredQuote[]) {
  return [...scored].sort((a, b) =>
    b.score - a.score ||
    a.amount - b.amount ||
    a.deliveryDays - b.deliveryDays ||
    b.rating - a.rating ||
    a.id - b.id
  )[0];
}

async function lockedTask(tx: any, sourcingTaskId: number) {
  const rows = await tx<TaskRecord[]>`
    SELECT
      st.id, st.sourcing_no, st.request_id, st.assigned_to,
      st.status, st.approval_status,
      pr.request_no, pr.status AS request_status, pr.requested_by,
      requester.role AS requester_role,
      pr.facility_manager_user_id, pr.assigned_procurement_manager_id,
      pr.next_role, pr.estimated_amount, pr.department_project
    FROM sourcing_tasks st
    JOIN purchase_requests pr ON pr.id = st.request_id
    LEFT JOIN users requester ON requester.id = pr.requested_by
    WHERE st.id = ${sourcingTaskId}
    FOR UPDATE OF st, pr
  `;
  return rows[0] || null;
}

function assertAssigned(user: CurrentUser, task: TaskRecord) {
  if (
    user.role !== "Admin" &&
    task.assigned_to && Number(task.assigned_to) !== user.id &&
    task.assigned_procurement_manager_id && Number(task.assigned_procurement_manager_id) !== user.id
  ) {
    throw new Error("This sourcing task is assigned to another Procurement Manager.");
  }
}

export async function recommendHighestScoringVendor(user: CurrentUser, sourcingTaskId: number) {
  assertProcurementActor(user);
  if (!Number.isInteger(sourcingTaskId) || sourcingTaskId <= 0) {
    throw new Error("A valid sourcing task is required.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const task = await lockedTask(tx, sourcingTaskId);
    if (!task) throw new Error("Sourcing task not found.");
    assertAssigned(user, task);

    if (!["Requires Sourcing", "Vendor Quote Collection", "Vendor Recommendation"].includes(String(task.request_status || ""))) {
      throw new Error(`A vendor cannot be recommended while the request is '${task.request_status || "Unknown"}'.`);
    }

    const quoteRows = await tx<QuoteRecord[]>`
      SELECT
        vq.id, vq.vendor_id, vq.vendor_name, v.name AS registry_vendor_name,
        vq.quoted_amount, vq.quotation_total, vq.delivery_time_days,
        vq.vendor_rating, vq.currency
      FROM vendor_quotes vq
      LEFT JOIN vendors v ON v.id = vq.vendor_id
      WHERE vq.sourcing_task_id = ${sourcingTaskId}
      ORDER BY vq.created_at, vq.id
      FOR UPDATE OF vq
    `;

    const scored = scoreQuotes(quoteRows);
    if (!scored.length) throw new Error("Add at least one vendor quote before making a recommendation.");
    const recommended = pickRecommended(scored);
    const now = new Date().toISOString();
    const oldRequestStatus = String(task.request_status || "");
    const oldTaskStatus = String(task.status || "");
    const reason = `Highest weighted score: ${recommended.score}`;

    for (const quote of scored) {
      await tx`
        UPDATE vendor_quotes
        SET score = ${quote.score},
            is_recommended = ${quote.id === recommended.id},
            updated_at = ${now}
        WHERE id = ${quote.id}
      `;
    }

    await tx`
      UPDATE sourcing_tasks
      SET recommended_vendor_id = ${recommended.vendor_id == null ? null : Number(recommended.vendor_id)},
          reason_for_recommendation = ${reason},
          status = 'Vendor Recommendation',
          approval_status = 'Recommended',
          assigned_to = ${user.id},
          updated_at = ${now}
      WHERE id = ${sourcingTaskId}
    `;

    await tx`
      UPDATE purchase_requests
      SET status = 'Vendor Recommendation',
          next_role = 'procurement_manager',
          assigned_procurement_manager_id = COALESCE(assigned_procurement_manager_id, ${user.id}),
          linked_sourcing_task_id = ${sourcingTaskId},
          updated_at = ${now}
      WHERE id = ${task.request_id}
    `;

    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Sourcing Task', ${sourcingTaskId}, 'Vendor Recommended', 'Vendor Recommendation', ${recommended.vendorName}, ${user.id}, ${now})
    `;
    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${task.request_id}, 'Vendor Recommended', 'Vendor Recommendation', ${`${recommended.vendorName}; ${reason}`}, ${user.id}, ${now})
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id, role, action, entity_type, entity_id,
        public_summary, private_details, visibility_scope, related_user_id, created_at
      ) VALUES (
        ${user.id}, ${user.role}, 'Vendor Recommended', 'Sourcing Task', ${sourcingTaskId},
        ${`${recommended.vendorName} recommended for ${task.request_no}`},
        ${`${reason}. Price ${recommended.currency || "NGN"} ${recommended.amount.toFixed(2)}; delivery ${recommended.deliveryDays} days; rating ${recommended.rating}/5.`},
        'workflow', ${task.facility_manager_user_id}, ${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action, entity_type, entity_id, user_id, role, details,
        before_values, after_values, created_at, event_date, event_time,
        amount, department, notes
      ) VALUES (
        'Vendor Recommended', 'Sourcing Task', ${String(sourcingTaskId)}, ${user.id}, ${user.role},
        ${`${recommended.vendorName} selected by weighted quote comparison`},
        ${tx.json({ request_status: oldRequestStatus, task_status: oldTaskStatus })},
        ${tx.json({ request_status: "Vendor Recommendation", task_status: "Vendor Recommendation", quote_id: recommended.id, vendor_id: recommended.vendor_id, vendor_name: recommended.vendorName, score: recommended.score })},
        ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
        ${recommended.amount}, ${task.department_project}, ${reason}
      )
    `;

    await appendAuditEvent(tx, {
      action: "Vendor Recommended",
      entityType: "Sourcing Task",
      entityId: sourcingTaskId,
      entityReference: task.sourcing_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { request_status: oldRequestStatus, task_status: oldTaskStatus },
      afterValues: {
        request_status: "Vendor Recommendation",
        task_status: "Vendor Recommendation",
        quote_id: recommended.id,
        vendor_id: recommended.vendor_id,
        vendor_name: recommended.vendorName,
        score: recommended.score,
      },
      metadata: {
        request_id: task.request_id,
        request_no: task.request_no,
        amount: recommended.amount,
        currency: recommended.currency || "NGN",
        scoring: { price_weight: 45, delivery_weight: 25, rating_weight: 30 },
      },
      reasonOrComment: reason,
      source: "nextjs",
    });

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        ${user.id}, NULL, 'Vendor recommendation ready',
        ${`Recommended vendor: ${recommended.vendorName}. Submit the recommendation to the correct approval queue when ready.`},
        'Sourcing Task', ${sourcingTaskId}, FALSE, FALSE, 'Important', 'in_app', FALSE, FALSE,
        'Open Vendor Recommendation', 'Vendor Recommendation', ${now}
      )
    `;

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Admin', 'Vendor recommendation prepared',
        ${`${recommended.vendorName} was recommended for ${task.request_no} with score ${recommended.score}.`},
        'Sourcing Task', ${sourcingTaskId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Procurement Records', 'All Procurement Records', ${now}
      )
    `;

    if (task.facility_manager_user_id) {
      await tx`
        INSERT INTO notifications (
          user_id, role, title, message, entity_type, entity_id,
          is_read, popup_shown, importance, delivery_channel,
          push_sent, email_sent, action_label, section_target, created_at
        ) VALUES (
          ${task.facility_manager_user_id}, NULL, 'Vendor recommendation prepared',
          ${`Procurement has prepared a vendor recommendation for ${task.request_no}.`},
          'Purchase Request', ${task.request_id}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
          'Open Request', 'My Activity History', ${now}
        )
      `;
    }

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', 'Audit activity: Vendor Recommended',
        ${`${user.role} recommended ${recommended.vendorName} for ${task.request_no}.`},
        'Sourcing Task', ${sourcingTaskId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
    `;

    return {
      sourcingTaskId,
      sourcingNo: task.sourcing_no,
      requestId: Number(task.request_id),
      requestNo: task.request_no,
      quoteId: recommended.id,
      vendorId: recommended.vendor_id == null ? null : Number(recommended.vendor_id),
      vendorName: recommended.vendorName,
      quotedAmount: recommended.amount,
      currency: recommended.currency || "NGN",
      deliveryDays: recommended.deliveryDays,
      vendorRating: recommended.rating,
      score: recommended.score,
      status: "Vendor Recommendation",
    };
  });
}

export async function submitVendorRecommendationForApproval(user: CurrentUser, sourcingTaskId: number, note = "") {
  assertProcurementActor(user);
  if (!Number.isInteger(sourcingTaskId) || sourcingTaskId <= 0) {
    throw new Error("A valid sourcing task is required.");
  }

  const sql = db();
  return sql.begin(async (tx) => {
    const task = await lockedTask(tx, sourcingTaskId);
    if (!task) throw new Error("Sourcing task not found.");
    assertAssigned(user, task);

    if (String(task.request_status || "") !== "Vendor Recommendation") {
      throw new Error("Only a completed vendor recommendation can be submitted for approval.");
    }

    const recommendation = await tx<{
      id: number;
      vendor_id: number | null;
      vendor_name: string | null;
      registry_vendor_name: string | null;
      score: string | number | null;
      quoted_amount: string | number;
      quotation_total: string | number | null;
      currency: string | null;
    }[]>`
      SELECT vq.id, vq.vendor_id, vq.vendor_name, v.name AS registry_vendor_name,
             vq.score, vq.quoted_amount, vq.quotation_total, vq.currency
      FROM vendor_quotes vq
      LEFT JOIN vendors v ON v.id = vq.vendor_id
      WHERE vq.sourcing_task_id = ${sourcingTaskId}
        AND COALESCE(vq.is_recommended, FALSE) = TRUE
      ORDER BY vq.score DESC NULLS LAST, vq.id
      LIMIT 1
      FOR UPDATE OF vq
    `;
    const selected = recommendation[0];
    if (!selected) throw new Error("No recommended vendor is recorded for this sourcing task.");

    const policy = await tx<{ amount: string | number }[]>`
      SELECT amount
      FROM approval_policy_settings
      WHERE policy_key = 'procurement_manager_approval_limit'
      LIMIT 1
    `;
    if (!policy[0]) throw new Error("Procurement Manager approval policy is not configured.");

    const approvalLimit = normalizeNumber(policy[0].amount);
    const requestAmount = normalizeNumber(task.estimated_amount);
    const requesterIsProcurementManager = task.requester_role === "Procurement Manager";
    const requiresIndependentApprover = requestAmount > approvalLimit || requesterIsProcurementManager;

    if (!requiresIndependentApprover && user.role !== "Admin") {
      throw new Error(
        `This recommendation is within the Procurement Manager approval limit of NGN ${approvalLimit.toLocaleString("en-NG")} and belongs in Low-Value Approvals.`,
      );
    }

    const now = new Date().toISOString();
    const finalNote = note.trim() || "Vendor recommendation submitted for Approver / MD approval";
    const vendorName = selected.vendor_name || selected.registry_vendor_name || "Recommended vendor";
    const amount = normalizeNumber(selected.quotation_total ?? selected.quoted_amount);
    const score = normalizeNumber(selected.score);

    await tx`
      UPDATE purchase_requests
      SET status = 'Submitted for Approval',
          next_role = 'approver',
          updated_at = ${now}
      WHERE id = ${task.request_id}
    `;

    await tx`
      UPDATE sourcing_tasks
      SET approval_status = 'Submitted for Approval',
          updated_at = ${now}
      WHERE id = ${sourcingTaskId}
    `;

    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Purchase Request', ${task.request_id}, 'Submitted for Approval', 'Submitted for Approval', ${finalNote}, ${user.id}, ${now})
    `;
    await tx`
      INSERT INTO workflow_events (entity_type, entity_id, event, status, note, user_id, created_at)
      VALUES ('Sourcing Task', ${sourcingTaskId}, 'Submitted for Approval', 'Submitted for Approval', ${vendorName}, ${user.id}, ${now})
    `;

    await tx`
      INSERT INTO activity_logs (
        user_id, role, action, entity_type, entity_id,
        public_summary, private_details, visibility_scope, related_user_id, created_at
      ) VALUES (
        ${user.id}, ${user.role}, 'Submitted for Approval', 'Purchase Request', ${task.request_id},
        ${`${task.request_no} vendor recommendation submitted to Approver / MD`},
        ${`${vendorName}; score ${score}; ${finalNote}`}, 'workflow', ${task.facility_manager_user_id}, ${now}
      )
    `;

    await tx`
      INSERT INTO approval_history (
        entity_type, entity_id, action, status_before, status_after,
        reason, user_id, approved_by_user_id, approved_by_role,
        approval_mode, note, created_at
      ) VALUES (
        'Purchase Request', ${task.request_id}, 'Submitted for Approval', 'Vendor Recommendation', 'Submitted for Approval',
        ${finalNote}, ${user.id}, ${user.id}, ${user.role},
        'Independent Approver Routing', ${finalNote}, ${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action, entity_type, entity_id, user_id, role, details,
        before_values, after_values, created_at, event_date, event_time,
        amount, department, notes
      ) VALUES (
        'Submitted for Approval', 'Purchase Request', ${String(task.request_id)}, ${user.id}, ${user.role}, ${finalNote},
        ${tx.json({ status: "Vendor Recommendation", next_role: task.next_role, sourcing_approval_status: task.approval_status })},
        ${tx.json({ status: "Submitted for Approval", next_role: "approver", sourcing_approval_status: "Submitted for Approval", recommended_vendor: vendorName, score })},
        ${now}, ${now.slice(0, 10)}, ${now.slice(11, 19)},
        ${amount}, ${task.department_project}, ${finalNote}
      )
    `;

    await appendAuditEvent(tx, {
      action: "Submitted for Approval",
      entityType: "Purchase Request",
      entityId: task.request_id,
      entityReference: task.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: "Vendor Recommendation", next_role: task.next_role, sourcing_approval_status: task.approval_status },
      afterValues: { status: "Submitted for Approval", next_role: "approver", sourcing_approval_status: "Submitted for Approval" },
      metadata: {
        sourcing_task_id: sourcingTaskId,
        sourcing_no: task.sourcing_no,
        recommended_vendor: vendorName,
        recommended_quote_id: selected.id,
        quote_amount: amount,
        quote_currency: selected.currency || "NGN",
        score,
        request_amount: requestAmount,
        approval_limit: approvalLimit,
        requester_role: task.requester_role,
      },
      reasonOrComment: finalNote,
      source: "nextjs",
    });

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Approver', 'Vendor recommendation pending approval',
        ${`${task.request_no} recommends ${vendorName} and requires your decision.`},
        'Purchase Request', ${task.request_id}, FALSE, FALSE, 'High', 'in_app', FALSE, FALSE,
        'Open Quote Comparison', 'Quote Comparison', ${now}
      )
    `;
    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Admin', 'Vendor recommendation submitted for approval',
        ${`${task.request_no} recommends ${vendorName}.`},
        'Purchase Request', ${task.request_id}, FALSE, FALSE, 'Important', 'in_app', FALSE, FALSE,
        'Open Procurement Records', 'All Procurement Records', ${now}
      )
    `;

    if (task.facility_manager_user_id) {
      await tx`
        INSERT INTO notifications (
          user_id, role, title, message, entity_type, entity_id,
          is_read, popup_shown, importance, delivery_channel,
          push_sent, email_sent, action_label, section_target, created_at
        ) VALUES (
          ${task.facility_manager_user_id}, NULL, 'Request submitted for final approval',
          ${`${task.request_no} has been submitted by Procurement to Approver / MD.`},
          'Purchase Request', ${task.request_id}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
          'Open Request', 'My Activity History', ${now}
        )
      `;
    }

    await tx`
      INSERT INTO notifications (
        user_id, role, title, message, entity_type, entity_id,
        is_read, popup_shown, importance, delivery_channel,
        push_sent, email_sent, action_label, section_target, created_at
      ) VALUES (
        NULL, 'Auditor', 'Audit activity: Submitted for Approval',
        ${`${user.role} submitted ${task.request_no} vendor recommendation to Approver / MD.`},
        'Purchase Request', ${task.request_id}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,
        'Open Audit Dashboard', 'Audit Dashboard', ${now}
      )
    `;

    return {
      sourcingTaskId,
      sourcingNo: task.sourcing_no,
      requestId: Number(task.request_id),
      requestNo: task.request_no,
      vendorName,
      score,
      approvalLimit,
      requestAmount,
      requesterRole: task.requester_role,
      status: "Submitted for Approval",
      nextRole: "approver",
    };
  });
}

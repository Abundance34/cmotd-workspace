import type { CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";

const DELETABLE_STATUSES = new Set(["FM Draft", "PM Draft", "Draft"]);

export async function archiveOwnedDraft(user: CurrentUser, requestId: number) {
  if (!["Facility Manager", "Procurement Manager", "Admin"].includes(user.role)) {
    throw new Error("This role cannot delete request drafts.");
  }
  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<any[]>`SELECT * FROM purchase_requests WHERE id=${requestId} FOR UPDATE`;
    const record = rows[0];
    if (!record) throw new Error("Purchase request not found.");
    if (user.role !== "Admin" && Number(record.requested_by || 0) !== user.id) {
      throw new Error("You can delete only a draft that you created.");
    }
    if (!DELETABLE_STATUSES.has(String(record.status || ""))) {
      throw new Error(`This request cannot be deleted because it is already in '${record.status || "Unknown"}'. Only unsubmitted drafts can be deleted.`);
    }
    if (record.submitted_at || record.approved_at || record.linked_sourcing_task_id || record.linked_po_id || record.paid_at || record.completed_at) {
      throw new Error("This request already contains workflow evidence and can no longer be deleted as a draft.");
    }

    const now = new Date().toISOString();
    await tx`
      UPDATE purchase_requests
      SET status='Deleted Draft', archived_at=${now}, archived_by_user_id=${user.id}, next_role=NULL, updated_at=${now}
      WHERE id=${requestId}
    `;
    await tx`
      INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at)
      VALUES ('Purchase Request',${requestId},'Draft Deleted','Deleted Draft','Unsubmitted draft removed from the active workspace by its owner.',${user.id},${now})
    `;
    await tx`
      INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
      VALUES (${user.id},${user.role},'DRAFT_DELETED','Purchase Request',${requestId},${`${record.request_no} was deleted as an unsubmitted draft`},'The draft is hidden from operational request lists while its audit evidence is retained.', 'workflow',${user.id},${now})
    `;
    await appendAuditEvent(tx, {
      action: "DRAFT_DELETED",
      entityType: "Purchase Request",
      entityId: requestId,
      entityReference: record.request_no,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: record.status, archived_at: record.archived_at || null },
      afterValues: { status: "Deleted Draft", archived_at: now, archived_by_user_id: user.id },
      metadata: { soft_deleted: true, line_items_retained_for_audit: true },
      reasonOrComment: "Request owner deleted an unsubmitted draft.",
    });
    return { requestId, requestNo: record.request_no, status: "Deleted Draft" };
  });
}

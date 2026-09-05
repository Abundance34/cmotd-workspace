import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for local notification repair.");

const sql = postgres(url, { max: 1, prepare: false });
try {
  const updated = await sql`
    UPDATE notifications n
    SET user_id = pr.assigned_procurement_manager_id,
        role = NULL,
        action_label = 'Open Facility / Utility Inbox',
        section_target = 'Utility Head / Facility Head Inbox'
    FROM purchase_requests pr
    WHERE n.entity_type = 'Purchase Request'
      AND n.entity_id = pr.id
      AND n.title = 'Request pending procurement review'
      AND pr.assigned_procurement_manager_id IS NOT NULL
      AND (
        n.section_target IS DISTINCT FROM 'Utility Head / Facility Head Inbox'
        OR n.user_id IS DISTINCT FROM pr.assigned_procurement_manager_id
        OR n.role IS NOT NULL
      )
    RETURNING n.id
  `;
  console.log(`Local Procurement notifications aligned: ${updated.length} notification(s) retargeted to the assigned manager inbox.`);
} finally {
  await sql.end({ timeout: 5 });
}

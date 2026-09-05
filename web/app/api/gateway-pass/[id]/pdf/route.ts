import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { gatewayPassPdf } from "@/lib/procureflow/gateway-pass-pdf";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";

function html(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return html(value);
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (["approved", "generated", "downloaded", "closed"].some((part) => value.includes(part))) return "good";
  if (["rejected", "returned", "cancelled"].some((part) => value.includes(part))) return "bad";
  return "pending";
}

function previewHtml(gp: any, items: any[], approvals: any[], events: any[]) {
  const status = String(gp.status || "Draft");
  const itemRows = items.length
    ? items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${html(item.item_description)}</strong>${item.item_category ? `<small>${html(item.item_category)}</small>` : ""}</td><td>${html(item.quantity)} ${html(item.unit_of_measure || "")}</td><td>${html(item.quality_condition || "—")}${item.fragility_status && item.fragility_status !== "Normal" ? `<small>${html(item.fragility_status)}</small>` : ""}</td><td>${html(item.serial_number || "—")}</td><td>${html(item.asset_tag || "—")}</td><td>${html(item.handling_instruction || "—")}</td></tr>`).join("")
    : `<tr><td colspan="7" class="empty">No item lines are recorded.</td></tr>`;
  const approvalRows = approvals.length
    ? approvals.map((row) => `<div class="timeline-row"><span class="dot"></span><div><strong>${html(row.approver_role || "Workflow decision")} · ${html(row.decision)}</strong><p>${html(row.note || "No note recorded")}</p><small>${dateText(row.created_at)}</small></div></div>`).join("")
    : `<div class="empty-block">No separate approval-history rows are recorded yet.</div>`;
  const eventRows = events.length
    ? events.slice(0, 8).map((row) => `<div class="event"><div><strong>${html(row.event)}</strong><span>${html(row.status || "")}</span></div><p>${html(row.note || "")}</p><small>${dateText(row.created_at)}</small></div>`).join("")
    : `<div class="empty-block">No gateway-pass workflow events are recorded yet.</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${html(gp.pass_number)} · Gateway Pass Preview</title><style>
  :root{--navy:#0d2947;--blue:#1b5fab;--ink:#15283b;--muted:#66788a;--line:#d9e3ec;--pale:#f3f7fb;--good:#067647;--goodbg:#ecfdf3;--bad:#b42318;--badbg:#fef3f2;--warn:#a15c00;--warnbg:#fffaeb}*{box-sizing:border-box}body{margin:0;background:#edf3f8;color:var(--ink);font:14px/1.5 Inter,Segoe UI,Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 22px;background:rgba(255,255,255,.95);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}.toolbar a,.toolbar button{border:1px solid #c9d6e2;border-radius:9px;background:#fff;color:var(--navy);padding:9px 13px;font-weight:700;text-decoration:none;cursor:pointer}.toolbar .primary{background:var(--blue);border-color:var(--blue);color:#fff}.toolbar-actions{display:flex;gap:8px;flex-wrap:wrap}.sheet{width:min(1040px,calc(100% - 28px));margin:28px auto 60px;background:#fff;box-shadow:0 20px 55px rgba(17,42,69,.13);border:1px solid #dbe5ee;border-radius:18px;overflow:hidden}.hero{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;background:var(--navy);color:#fff;padding:28px 34px}.brand{display:flex;align-items:center;gap:18px}.brand img{width:210px;max-height:58px;object-fit:contain;object-position:left center;background:#fff;border-radius:8px;padding:7px}.brand strong{display:block;font-size:13px;letter-spacing:.13em}.brand span{display:block;color:#c8daf0;font-size:11px;margin-top:3px}.pass-title{text-align:right}.pass-title h1{margin:0;font-size:27px;letter-spacing:.06em}.pass-title p{margin:4px 0 0;color:#c8daf0;font-weight:700}.summary{display:grid;grid-template-columns:170px 1fr 1fr 1fr;gap:0;border-bottom:1px solid var(--line)}.summary>div{padding:17px 20px;border-right:1px solid var(--line)}.summary>div:last-child{border-right:0}.label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;margin-bottom:5px}.value{font-weight:800;color:var(--ink)}.status{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800}.status.good{background:var(--goodbg);color:var(--good)}.status.bad{background:var(--badbg);color:var(--bad)}.status.pending{background:var(--warnbg);color:var(--warn)}.section{padding:24px 34px;border-bottom:1px solid #edf1f5}.section:last-child{border-bottom:0}.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:15px}.section-head h2{margin:0;color:var(--navy);font-size:16px}.section-head p{margin:3px 0 0;color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-radius:12px;overflow:hidden}.field{padding:14px 15px;min-height:70px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.field:nth-child(3n){border-right:0}.field:nth-last-child(-n+3){border-bottom:0}.purpose{border:1px solid var(--line);background:#fbfdff;border-radius:12px;padding:15px 17px;margin-top:14px}.purpose p{margin:5px 0 0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;min-width:880px}th{background:var(--navy);color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:11px 10px}td{padding:12px 10px;border-bottom:1px solid #e8eef3;vertical-align:top}tbody tr:last-child td{border-bottom:0}td strong,td small{display:block}td small{color:var(--muted);font-size:10px;margin-top:3px}.approval-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.approval-card{border:1px solid var(--line);border-radius:12px;padding:15px;background:#fbfdff}.approval-card strong{display:block;margin-top:4px;color:var(--navy)}.approval-card p{margin:6px 0 0;color:var(--muted);font-size:12px}.control-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.control-card{border:1px dashed #b9c8d7;border-radius:11px;padding:13px;background:#fff}.control-card strong{display:block;margin-top:4px}.timeline{display:grid;grid-template-columns:1fr 1fr;gap:18px}.timeline-col{border:1px solid var(--line);border-radius:12px;padding:15px}.timeline-col h3{margin:0 0 12px;color:var(--navy);font-size:13px}.timeline-row{display:grid;grid-template-columns:12px 1fr;gap:9px;padding:0 0 13px}.dot{width:9px;height:9px;border-radius:50%;background:var(--blue);margin-top:5px}.timeline-row strong,.timeline-row small{display:block}.timeline-row p{margin:3px 0;color:var(--muted);font-size:12px}.timeline-row small,.event small{font-size:10px;color:#91a0ae}.event{padding:10px 0;border-bottom:1px solid #edf1f5}.event:last-child{border-bottom:0}.event>div{display:flex;justify-content:space-between;gap:10px}.event span{font-size:10px;color:var(--blue);font-weight:800}.event p{margin:3px 0;color:var(--muted);font-size:12px}.footer{display:flex;justify-content:space-between;gap:15px;padding:17px 34px;background:var(--pale);font-size:11px;color:var(--muted)}.empty,.empty-block{color:var(--muted);padding:20px;text-align:center}.print-note{display:none}@media(max-width:760px){.hero{grid-template-columns:1fr}.pass-title{text-align:left}.summary{grid-template-columns:1fr 1fr}.grid,.approval-grid,.control-grid,.timeline{grid-template-columns:1fr}.field{border-right:0!important;border-bottom:1px solid var(--line)!important}.summary>div{border-bottom:1px solid var(--line)}.brand img{width:160px}.section{padding:20px}.toolbar{padding:10px}.sheet{width:calc(100% - 16px);margin-top:12px}}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:100%;margin:0;border:0;border-radius:0;box-shadow:none}.hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}.section{break-inside:avoid}.footer{print-color-adjust:exact;-webkit-print-color-adjust:exact}.print-note{display:block}}
  </style></head><body><div class="toolbar"><a href="/app">← Back to ProcureFlow</a><div class="toolbar-actions"><button onclick="window.print()">Print Preview</button><a class="primary" href="?download=1">Download Approved PDF</a></div></div><main class="sheet"><header class="hero"><div class="brand"><img src="/branding/cmotd_company_wordmark.png" alt="CMOTD"/><div><strong>PROCUREFLOW</strong><span>Controlled movement authorization</span></div></div><div class="pass-title"><h1>GATEWAY PASS</h1><p>${html(gp.pass_number)}</p></div></header><section class="summary"><div><span class="label">Status</span><span class="status ${statusTone(status)}">${html(status)}</span></div><div><span class="label">Department</span><span class="value">${html(gp.department || "—")}</span></div><div><span class="label">Movement Type</span><span class="value">${html(gp.movement_type || "—")}</span></div><div><span class="label">Movement Date</span><span class="value">${dateText(gp.expected_movement_date)}</span></div></section><section class="section"><div class="section-head"><div><h2>Movement Details</h2><p>Primary movement, transport and receiving information.</p></div></div><div class="grid"><div class="field"><span class="label">Origin</span><span class="value">${html(gp.origin_location || "—")}</span></div><div class="field"><span class="label">Destination</span><span class="value">${html(gp.destination || "—")}</span></div><div class="field"><span class="label">Expected Return</span><span class="value">${dateText(gp.expected_return_date)}</span></div><div class="field"><span class="label">Vehicle</span><span class="value">${html(gp.vehicle_number || "—")}</span></div><div class="field"><span class="label">Driver</span><span class="value">${html(gp.driver_name || "—")}</span></div><div class="field"><span class="label">Driver Phone</span><span class="value">${html(gp.driver_phone || "—")}</span></div><div class="field"><span class="label">Receiver</span><span class="value">${html(gp.receiver_name || "—")}</span></div><div class="field"><span class="label">Receiver Organisation</span><span class="value">${html(gp.receiver_organization || "—")}</span></div><div class="field"><span class="label">Utility / Facility Head</span><span class="value">${html(gp.facility_manager_name || "—")}</span></div></div><div class="purpose"><span class="label">Purpose</span><p>${html(gp.purpose || "—")}</p></div></section><section class="section"><div class="section-head"><div><h2>Items / Assets</h2><p>Every item covered by this movement authorization.</p></div><span class="status pending">${items.length} item${items.length === 1 ? "" : "s"}</span></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Item / Category</th><th>Quantity</th><th>Condition</th><th>Serial No.</th><th>Asset Tag</th><th>Handling</th></tr></thead><tbody>${itemRows}</tbody></table></div></section><section class="section"><div class="section-head"><div><h2>Authorization</h2><p>Procurement review and final approval evidence.</p></div></div><div class="approval-grid"><div class="approval-card"><span class="label">Utility / Facility Head</span><strong>${html(gp.facility_manager_name || "—")}</strong><p>Originating movement owner.</p></div><div class="approval-card"><span class="label">Procurement Review</span><strong>${html(gp.reviewed_by_name || "Pending / not recorded")}</strong><p>${html(gp.procurement_review_note || "No Procurement review note recorded.")}</p></div><div class="approval-card"><span class="label">Approver / MD</span><strong>${html(gp.approved_by_name || gp.approved_by_role || "Pending / not recorded")}</strong><p>${html(gp.approval_note || "No final approval note recorded.")}</p></div></div></section><section class="section"><div class="section-head"><div><h2>Security & Logistics Control</h2><p>Operational checkpoint fields remain visible in the controlled preview.</p></div></div><div class="control-grid"><div class="control-card"><span class="label">Checkpoint</span><strong>${html(gp.security_checkpoint || "To be completed")}</strong></div><div class="control-card"><span class="label">Security Officer</span><strong>${html(gp.security_officer_name || "To be completed")}</strong></div><div class="control-card"><span class="label">Gate Verification</span><strong>${html(gp.gate_verification_time || "To be completed")}</strong></div><div class="control-card"><span class="label">Movement Status</span><strong>${html(gp.exit_entry_confirmation || gp.logistics_status || "Pending")}</strong></div><div class="control-card"><span class="label">Delivery Reference</span><strong>${html(gp.logistics_delivery_reference || "—")}</strong></div><div class="control-card"><span class="label">Waybill</span><strong>${html(gp.logistics_waybill_number || "—")}</strong></div><div class="control-card"><span class="label">Generated</span><strong>${dateText(gp.generated_at)}</strong></div><div class="control-card"><span class="label">Downloaded</span><strong>${dateText(gp.downloaded_at)}</strong></div></div></section><section class="section"><div class="section-head"><div><h2>Workflow Evidence</h2><p>Approval decisions and movement events retained for auditability.</p></div></div><div class="timeline"><div class="timeline-col"><h3>Approval trail</h3>${approvalRows}</div><div class="timeline-col"><h3>Recent gateway events</h3>${eventRows}</div></div></section><footer class="footer"><span>ProcureFlow · CMOTD controlled gateway pass</span><span>Validate the live status before authorising physical movement.</span></footer></main></body></html>`;
}

async function recordDownload(user: Awaited<ReturnType<typeof getCurrentUser>>, gp: any, id: number) {
  if (!user) return;
  const ready = await verifyActiveAuditSigningKey().catch(() => false);
  if (!ready) throw new Error("The active v2 audit signing key must be verified before a controlled gateway-pass download can be recorded.");
  const sql = db();
  await sql.begin(async (tx) => {
    const currentRows = await tx<any[]>`SELECT * FROM gateway_passes WHERE id=${id} FOR UPDATE`;
    const current = currentRows[0];
    if (!current) throw new Error("Gateway pass not found.");
    const oldStatus = String(current.status || "");
    const facilityControlled = user.role === "Facility Manager" || user.role === "Admin";
    const newStatus = facilityControlled && oldStatus !== "Closed" ? "Downloaded" : oldStatus;
    const nextRole = facilityControlled && oldStatus !== "Closed" ? "logistics_officer" : current.next_role;
    if (facilityControlled) {
      await tx`UPDATE gateway_passes SET status=${newStatus},generated_at=COALESCE(generated_at,NOW()),downloaded_at=NOW(),generated_file_path=${`/api/gateway-pass/${id}/pdf`},next_role=${nextRole},updated_at=NOW() WHERE id=${id}`;
    }
    const now = new Date().toISOString();
    await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,created_at) VALUES (${user.id},${user.role},'Gateway Pass PDF Downloaded','Gateway Pass',${id},${`${current.pass_number} controlled PDF downloaded`},${facilityControlled ? 'Facility-controlled download released the approved pass to Logistics coordination.' : 'Authorised read-only controlled-copy download.'},'workflow',${now})`;
    await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES ('GATEWAY_PASS_PDF_DOWNLOADED','Gateway Pass',${String(id)},${user.id},${user.role},'Controlled gateway-pass PDF downloaded',${tx.json({status:oldStatus,next_role:current.next_role})},${tx.json({status:newStatus,next_role:nextRole})},${now},${now.slice(0,10)},${now.slice(11,19)},'Gateway pass controlled-copy download')`;
    await appendAuditEvent(tx, {
      action: "Gateway Pass PDF Downloaded",
      entityType: "Gateway Pass",
      entityId: id,
      entityReference: current.pass_number,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      beforeValues: { status: oldStatus, next_role: current.next_role },
      afterValues: { status: newStatus, next_role: nextRole, controlled_copy_downloaded: true },
      metadata: { facility_controlled: facilityControlled },
      reasonOrComment: "Approved gateway pass controlled-copy download",
      source: "nextjs",
    });
    if (facilityControlled && oldStatus !== "Downloaded" && oldStatus !== "Closed") {
      await tx`INSERT INTO workflow_events (entity_type,entity_id,event,status,note,user_id,created_at) VALUES ('Gateway Pass',${id},'Downloaded','Downloaded','Approved gateway pass downloaded and released for Logistics coordination',${user.id},${now})`;
      await tx`INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at) VALUES (NULL,'Logistics Officer','Gateway pass ready for movement',${`${current.pass_number} has been downloaded by the Utility / Facility workflow and is ready for Logistics coordination.`},'Gateway Pass',${id},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Open Gateway Coordination','Gateway Pass Coordination',${now})`;
    }
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const { id: idText } = await params;
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid gateway pass." }, { status: 400 });
    const sql = db();
    const rows = await sql<any[]>`
      SELECT gp.*, fm.full_name facility_manager_name, rv.full_name reviewed_by_name, av.full_name approved_by_name
      FROM gateway_passes gp
      LEFT JOIN users fm ON fm.id=gp.facility_manager_user_id
      LEFT JOIN users rv ON rv.id=gp.reviewed_by_user_id
      LEFT JOIN users av ON av.id=gp.approved_by_user_id
      WHERE gp.id=${id} LIMIT 1
    `;
    const gp = rows[0];
    if (!gp) return NextResponse.json({ error: "Gateway pass not found." }, { status: 404 });
    if (user.role === "Facility Manager" && Number(gp.facility_manager_user_id) !== user.id) return NextResponse.json({ error: "This gateway pass is not assigned to you." }, { status: 403 });
    if (!["Facility Manager", "Procurement Manager", "Approver", "Admin", "Auditor", "Logistics Officer"].includes(user.role)) return NextResponse.json({ error: "Gateway pass access denied." }, { status: 403 });
    if (!["Approved", "Generated", "Downloaded", "Closed"].includes(String(gp.status || ""))) return NextResponse.json({ error: "The gateway pass is not approved for preview or generation." }, { status: 409 });

    const [items, approvals, events] = await Promise.all([
      sql<any[]>`SELECT * FROM gateway_pass_items WHERE gateway_pass_id=${id} ORDER BY id`,
      sql<any[]>`SELECT * FROM gateway_pass_approvals WHERE gateway_pass_id=${id} ORDER BY created_at ASC,id ASC`,
      sql<any[]>`SELECT * FROM gateway_pass_events WHERE gateway_pass_id=${id} ORDER BY created_at DESC,id DESC LIMIT 30`,
    ]);
    const url = new URL(request.url);
    if (url.searchParams.get("download") !== "1") {
      return new NextResponse(previewHtml(gp, items, approvals, events), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    await recordDownload(user, gp, id);
    const pdf = gatewayPassPdf({
      passNumber: gp.pass_number,
      status: user.role === "Facility Manager" || user.role === "Admin" ? "Downloaded" : gp.status,
      department: gp.department,
      movementType: gp.movement_type,
      purpose: gp.purpose,
      originLocation: gp.origin_location,
      destination: gp.destination,
      expectedMovementDate: gp.expected_movement_date ? String(gp.expected_movement_date) : null,
      expectedReturnDate: gp.expected_return_date ? String(gp.expected_return_date) : null,
      vehicleNumber: gp.vehicle_number,
      driverName: gp.driver_name,
      driverPhone: gp.driver_phone,
      receiverName: gp.receiver_name,
      receiverOrganization: gp.receiver_organization,
      facilityManagerName: gp.facility_manager_name,
      reviewedByName: gp.reviewed_by_name,
      procurementReviewNote: gp.procurement_review_note,
      approvedByName: gp.approved_by_name,
      approvedByRole: gp.approved_by_role,
      approvalNote: gp.approval_note,
      securityCheckpoint: gp.security_checkpoint,
      securityOfficerName: gp.security_officer_name,
      gateVerificationTime: gp.gate_verification_time,
      exitEntryConfirmation: gp.exit_entry_confirmation,
      logisticsStatus: gp.logistics_status,
      logisticsDeliveryReference: gp.logistics_delivery_reference,
      logisticsWaybillNumber: gp.logistics_waybill_number,
      items,
    });
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${gp.pass_number}.pdf"`, "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to render gateway pass.";
    return NextResponse.json({ error: message }, { status: /access|assigned|Authentication/i.test(message) ? 403 : 500 });
  }
}

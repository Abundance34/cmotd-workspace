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

function dateText(value: unknown, includeTime = false) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return html(value);
  return new Intl.DateTimeFormat("en-NG", {
    day: "2-digit", month: "short", year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
    timeZone: "Africa/Lagos",
  }).format(date);
}

function displayRole(value: unknown) {
  const role = String(value || "").trim();
  return role === "Logistics Officer" ? "Logistics Manager" : role || "—";
}

function wholeQuantity(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.max(0, Math.round(number))) : html(value);
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
    ? items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${html(item.item_description)}</strong>${item.item_category ? `<small>${html(item.item_category)}</small>` : ""}</td><td class="qty">${wholeQuantity(item.quantity)}</td><td>${html(item.unit_of_measure || "—")}</td><td>${html(item.quality_condition || "—")}${item.fragility_status && item.fragility_status !== "Normal" ? `<small>${html(item.fragility_status)}</small>` : ""}</td><td>${html([item.serial_number, item.asset_tag].filter(Boolean).join(" / ") || "—")}</td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">No item lines are recorded.</td></tr>`;
  const approvalRows = approvals.length
    ? approvals.map((row) => `<div class="timeline-row"><strong>${html(displayRole(row.approver_role))} · ${html(row.decision)}</strong><span>${html(row.note || "No note recorded")}</span><small>${dateText(row.created_at, true)}</small></div>`).join("")
    : `<div class="empty-block">No separate approval-history rows are recorded yet.</div>`;
  const eventRows = events.length
    ? events.slice(0, 8).map((row) => `<div class="timeline-row"><strong>${html(row.event)}</strong><span>${html(row.note || row.status || "")}</span><small>${dateText(row.created_at, true)}</small></div>`).join("")
    : `<div class="empty-block">No gateway-pass workflow events are recorded yet.</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${html(gp.pass_number)} · Gateway Pass</title><style>
  :root{--navy:#0d2947;--blue:#1b5fab;--ink:#16283a;--muted:#5f7182;--line:#ccd9e5;--pale:#f3f7fb;--good:#067647;--bad:#b42318}*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:var(--ink);font:13px/1.35 Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:11px 20px;background:#fff;border-bottom:1px solid var(--line)}.toolbar a,.toolbar button{border:1px solid #c9d6e2;border-radius:8px;background:#fff;color:var(--navy);padding:9px 13px;font-weight:700;text-decoration:none;cursor:pointer}.toolbar .primary{background:var(--blue);border-color:var(--blue);color:#fff}.toolbar-actions{display:flex;gap:8px}.sheet{width:min(900px,calc(100% - 24px));margin:20px auto;background:#fff;box-shadow:0 15px 45px rgba(13,41,71,.13);padding:28px 34px 20px}.letterhead{display:grid;grid-template-columns:72px 1fr 72px;align-items:center;gap:12px;padding-bottom:13px;border-bottom:2px solid var(--blue)}.letterhead img{width:68px;height:68px;object-fit:contain}.institution{text-align:center;font-family:Georgia,"Times New Roman",serif}.institution h1{font-size:18px;line-height:1.15;margin:0;font-weight:700}.institution h2{font-size:15px;line-height:1.2;margin:7px 0 0}.institution p{font-size:12px;font-style:italic;margin:6px 0 0}.pass-banner{margin-top:22px;background:var(--navy);color:#fff;border-radius:7px;padding:16px 20px;display:flex;justify-content:space-between;gap:20px;align-items:center}.pass-banner h3{font-size:24px;margin:0;letter-spacing:.02em}.pass-meta{text-align:right}.pass-meta strong,.pass-meta span{display:block}.pass-meta strong{font-size:11px}.pass-meta span{font-size:11px;margin-top:4px}.summary{margin-top:16px;display:grid;grid-template-columns:170px 1fr;border:1px solid var(--line);background:var(--pale)}.summary>div{padding:10px 14px;min-width:0}.summary>div+div{border-left:1px solid var(--line)}.label{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;font-weight:800;letter-spacing:.04em;margin-bottom:4px}.value{font-weight:700;overflow-wrap:anywhere}.section{margin-top:17px}.section-title{margin:0 0 8px;color:var(--navy);font-size:14px;font-weight:800}.grid2,.grid3,.grid4{display:grid;border:1px solid var(--line)}.grid2{grid-template-columns:1fr 1fr}.grid3{grid-template-columns:repeat(3,1fr)}.grid4{grid-template-columns:repeat(4,1fr)}.field{min-width:0;padding:10px 12px;min-height:56px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);overflow:hidden}.grid2 .field:nth-child(2n),.grid3 .field:nth-child(3n),.grid4 .field:nth-child(4n){border-right:0}.purpose{border:1px solid var(--line);padding:11px 12px;overflow-wrap:anywhere}.table-wrap{border:1px solid var(--line);overflow:hidden}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:var(--navy);color:#fff;text-align:left;font-size:9px;padding:8px 7px}td{padding:9px 7px;border-bottom:1px solid #dfe8f0;border-right:1px solid #dfe8f0;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}td small{display:block;color:var(--muted);margin-top:3px}.qty{font-weight:700}.status{color:var(--blue);font-weight:800}.approval-note{grid-column:1/-1;min-height:38px;padding:9px 12px;border-top:1px solid var(--line);overflow-wrap:anywhere}.official-footer{margin-top:28px;padding-top:9px;border-top:1.5px solid var(--blue);text-align:center;font-family:Georgia,"Times New Roman",serif;font-size:10px}.official-footer p{margin:2px 0}.control-copy{display:flex;justify-content:space-between;gap:15px;margin-top:8px;color:var(--muted);font:9px Arial,Helvetica,sans-serif}.screen-evidence{width:min(900px,calc(100% - 24px));margin:0 auto 50px;background:#fff;border:1px solid var(--line);padding:20px 24px}.screen-evidence h3{margin:0 0 12px;color:var(--navy)}.evidence-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.timeline-row{padding:8px 0;border-bottom:1px solid #e5ecf2}.timeline-row strong,.timeline-row span,.timeline-row small{display:block}.timeline-row span{color:var(--muted);margin-top:2px}.timeline-row small{color:#8393a3;margin-top:3px}.empty,.empty-block{color:var(--muted);padding:15px;text-align:center}@media(max-width:720px){.sheet{padding:18px}.letterhead{grid-template-columns:54px 1fr 54px}.letterhead img{width:52px;height:52px}.institution h1{font-size:14px}.institution h2{font-size:12px}.institution p{font-size:10px}.pass-banner{align-items:flex-start}.pass-banner h3{font-size:20px}.summary,.grid2,.grid3,.grid4,.evidence-grid{grid-template-columns:1fr}.summary>div+div,.field{border-left:0;border-right:0}.pass-meta{text-align:left}.pass-banner{flex-direction:column}}@media print{@page{size:A4;margin:12mm}body{background:#fff}.toolbar,.screen-evidence{display:none}.sheet{width:100%;margin:0;padding:0;box-shadow:none}.section,.table-wrap,.grid2,.grid3,.grid4{break-inside:avoid}.letterhead{padding-top:0}.control-copy{font-size:8px}}
  </style></head><body><div class="toolbar"><a href="/app">← Back to ProcureFlow</a><div class="toolbar-actions"><button onclick="window.print()">Print Preview</button><a class="primary" href="?download=1">Download Approved PDF</a></div></div><main class="sheet">
  <header class="letterhead"><img src="/branding/rsu_logo.png" alt="Rivers State University"/><div class="institution"><h1>Centre For Marine and Offshore Technology Development (CMOTD)</h1><h2>Consultancy Services Unit, Rivers State University</h2><p>Where Theory becomes Reality and Individuals are Equipped to Lead in the Industry!</p></div><img src="/branding/cmotd_logo.png" alt="CMOTD"/></header>
  <section class="pass-banner"><h3>GATEWAY PASS</h3><div class="pass-meta"><strong>PROCUREFLOW CONTROLLED DOCUMENT</strong><span>${html(gp.pass_number)}</span></div></section>
  <section class="summary"><div><span class="label">Status</span><span class="status">${html(status)}</span></div><div><span class="label">Department</span><span class="value">${html(gp.department || "—")}</span></div></section>
  <section class="section"><div class="grid2"><div class="field"><span class="label">Movement Type</span><span class="value">${html(gp.movement_type || "—")}</span></div><div class="field"><span class="label">Expected Movement</span><span class="value">${dateText(gp.expected_movement_date)}</span></div><div class="field"><span class="label">Origin</span><span class="value">${html(gp.origin_location || "—")}</span></div><div class="field"><span class="label">Destination</span><span class="value">${html(gp.destination || "—")}</span></div></div><div class="purpose"><span class="label">Purpose</span><span class="value">${html(gp.purpose || "—")}</span></div></section>
  <section class="section"><h3 class="section-title">MOVEMENT & RECEIVER DETAILS</h3><div class="grid3"><div class="field"><span class="label">Vehicle</span><span class="value">${html(gp.vehicle_number || "—")}</span></div><div class="field"><span class="label">Driver</span><span class="value">${html(gp.driver_name || "—")}</span></div><div class="field"><span class="label">Driver Phone</span><span class="value">${html(gp.driver_phone || "—")}</span></div><div class="field"><span class="label">Expected Return</span><span class="value">${dateText(gp.expected_return_date)}</span></div><div class="field"><span class="label">Receiver</span><span class="value">${html(gp.receiver_name || "—")}</span></div><div class="field"><span class="label">Organisation</span><span class="value">${html(gp.receiver_organization || "—")}</span></div></div></section>
  <section class="section"><h3 class="section-title">ITEMS / ASSETS</h3><div class="table-wrap"><table><colgroup><col style="width:5%"><col style="width:42%"><col style="width:8%"><col style="width:10%"><col style="width:13%"><col style="width:22%"></colgroup><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th>Condition</th><th>Serial / Asset</th></tr></thead><tbody>${itemRows}</tbody></table></div></section>
  <section class="section"><h3 class="section-title">AUTHORIZATION & CONTROL</h3><div class="grid3"><div class="field"><span class="label">Utility / Facility Head</span><span class="value">${html(gp.facility_manager_name || "—")}</span></div><div class="field"><span class="label">Approved By</span><span class="value">${html(gp.approved_by_name || displayRole(gp.approved_by_role))}</span><small>${html(displayRole(gp.approved_by_role))}</small></div><div class="field"><span class="label">Approval Date</span><span class="value">${dateText(gp.approved_at, true)}</span></div><div class="approval-note"><span class="label">Approval Note</span><span class="value">${html([displayRole(gp.approved_by_role), gp.approval_note || gp.procurement_review_note].filter(Boolean).join(" - ") || "—")}</span></div></div></section>
  <section class="section"><h3 class="section-title">SECURITY / LOGISTICS CHECKPOINT</h3><div class="grid4"><div class="field"><span class="label">Checkpoint</span><span class="value">${html(gp.security_checkpoint || "To be completed")}</span></div><div class="field"><span class="label">Security Officer</span><span class="value">${html(gp.security_officer_name || "To be completed")}</span></div><div class="field"><span class="label">Gate Verification</span><span class="value">${gp.gate_verification_time ? dateText(gp.gate_verification_time, true) : "To be completed"}</span></div><div class="field"><span class="label">Movement Status</span><span class="value">${html(gp.exit_entry_confirmation || gp.logistics_status || "Pending")}</span></div></div></section>
  <footer class="official-footer"><p>Consultancy Unit, Rivers State University, Nkpolu-Oroworokwo, Port Harcourt, Rivers State</p><p>Email: <strong>info@cmotd.org</strong> &nbsp; | &nbsp; Phone NO.: +2349163505000</p><div class="control-copy"><span>Generated by ProcureFlow | Controlled copy | Validate status in the live system</span><span>${html(gp.pass_number)}</span></div></footer>
  </main><section class="screen-evidence"><h3>Workflow Evidence (screen only)</h3><div class="evidence-grid"><div><strong>Approval trail</strong>${approvalRows}</div><div><strong>Recent gateway events</strong>${eventRows}</div></div></section></body></html>`;
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
    const pdf = await gatewayPassPdf({
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
      approvedAt: gp.approved_at ? String(gp.approved_at) : null,
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

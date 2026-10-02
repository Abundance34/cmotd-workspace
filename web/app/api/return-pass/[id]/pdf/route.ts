import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { returnPassPdf } from "@/lib/procureflow/return-pass-pdf";

export const runtime = "nodejs";

function html(value: unknown) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function dateText(value: unknown, time = false) {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return html(value);
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}), timeZone: "Africa/Lagos" }).format(d);
}
function qty(value: unknown) { const n = Number(value); return Number.isFinite(n) ? String(Math.max(0, Math.round(n))) : html(value); }

function previewHtml(rp: any, items: any[]) {
  const rows = items.map((item, index) => {
    const out = Math.round(Number(item.quantity_outbound || 0));
    const prev = Math.round(Number(item.quantity_previously_returned || 0));
    const now = Math.round(Number(item.quantity_returned || 0));
    const after = Math.max(0, out - prev - now);
    return `<tr><td>${index + 1}</td><td><strong>${html(item.item_description)}</strong><small>${html([item.serial_number, item.asset_tag].filter(Boolean).join(" / ") || "")}</small></td><td>${out}</td><td>${prev}</td><td class="now">${now}</td><td>${after}</td><td>${html(item.condition_on_return || "—")}<small>${html([item.discrepancy_type, item.discrepancy_notes].filter(Boolean).join(" · "))}</small></td></tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${html(rp.return_pass_number)} · Return Pass</title><style>
  :root{--navy:#0d2947;--blue:#1b5fab;--ink:#16283a;--muted:#5f7182;--line:#ccd9e5;--pale:#f3f7fb}*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:var(--ink);font:13px/1.4 Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;padding:11px 20px;background:#fff;border-bottom:1px solid var(--line)}.toolbar a,.toolbar button{border:1px solid #cbd8e4;border-radius:8px;background:#fff;color:var(--navy);padding:9px 13px;text-decoration:none;font-weight:700}.toolbar .primary{background:var(--blue);color:#fff;border-color:var(--blue)}.sheet{width:min(900px,calc(100% - 24px));margin:20px auto;background:#fff;box-shadow:0 15px 45px rgba(13,41,71,.13);padding:28px 34px 20px}.letterhead{display:grid;grid-template-columns:72px 1fr 72px;align-items:center;gap:12px;border-bottom:2px solid var(--blue);padding-bottom:13px}.letterhead img{width:68px;height:68px;object-fit:contain}.institution{text-align:center;font-family:Georgia,serif}.institution h1{font-size:18px;margin:0}.institution h2{font-size:15px;margin:7px 0 0}.institution p{font-size:12px;font-style:italic;margin:6px 0 0}.banner{margin-top:22px;background:var(--navy);color:#fff;border-radius:7px;padding:16px 20px;display:flex;justify-content:space-between;gap:20px}.banner h3{font-size:24px;margin:0}.banner div{text-align:right}.section{margin-top:17px}.section h3{color:var(--navy);font-size:14px;margin:0 0 8px}.grid{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--line)}.field{min-width:0;padding:10px 12px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);overflow-wrap:anywhere}.field:nth-child(2n){border-right:0}.label{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;font-weight:800;margin-bottom:4px}.value{font-weight:700}.table-wrap{border:1px solid var(--line);overflow:hidden}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:var(--navy);color:#fff;text-align:left;font-size:9px;padding:8px 6px}td{padding:9px 6px;border-bottom:1px solid #dfe8f0;border-right:1px solid #dfe8f0;vertical-align:top;overflow-wrap:anywhere}td:last-child{border-right:0}td small{display:block;color:var(--muted);margin-top:3px}.now{font-weight:800;color:var(--blue)}.notice{padding:12px 14px;background:var(--pale);border:1px solid var(--line);margin-top:16px}.footer{margin-top:28px;padding-top:9px;border-top:1.5px solid var(--blue);text-align:center;font-family:Georgia,serif;font-size:10px}.footer p{margin:2px}.control{margin-top:8px;color:var(--muted);font:9px Arial,sans-serif;display:flex;justify-content:space-between}@media print{@page{size:A4;margin:12mm}body{background:#fff}.toolbar{display:none}.sheet{width:100%;margin:0;padding:0;box-shadow:none}.section,.table-wrap,.grid{break-inside:avoid}}@media(max-width:700px){.sheet{padding:18px}.grid{grid-template-columns:1fr}.field{border-right:0}.letterhead{grid-template-columns:52px 1fr 52px}.letterhead img{width:50px;height:50px}.institution h1{font-size:14px}.institution h2{font-size:12px}.institution p{font-size:10px}}
  </style></head><body><div class="toolbar"><a href="/app">← Back to ProcureFlow</a><div><button onclick="window.print()">Print Preview</button> <a class="primary" href="?download=1">Download PDF</a></div></div><main class="sheet">
  <header class="letterhead"><img src="/branding/rsu_logo.png"><div class="institution"><h1>Centre For Marine and Offshore Technology Development (CMOTD)</h1><h2>Consultancy Services Unit, Rivers State University</h2><p>Where Theory becomes Reality and Individuals are Equipped to Lead in the Industry!</p></div><img src="/branding/cmotd_logo.png"></header>
  <section class="banner"><h3>RETURN PASS</h3><div><strong>PROCUREFLOW CONTROLLED DOCUMENT</strong><br><span>${html(rp.return_pass_number)}</span></div></section>
  <div class="notice"><strong>Linked Gateway Pass:</strong> ${html(rp.gateway_pass_number)} &nbsp; | &nbsp; <strong>Gateway Return Status:</strong> ${html(rp.gateway_return_status || "Not Started")}</div>
  <section class="section"><div class="grid"><div class="field"><span class="label">Status</span><span class="value">${html(rp.status)}</span></div><div class="field"><span class="label">Department</span><span class="value">${html(rp.department || "—")}</span></div><div class="field"><span class="label">Actual Return Date</span><span class="value">${dateText(rp.actual_return_date)}</span></div><div class="field"><span class="label">Expected Return Date</span><span class="value">${dateText(rp.expected_return_date)}</span></div><div class="field"><span class="label">Return Origin</span><span class="value">${html(rp.return_origin || "—")}</span></div><div class="field"><span class="label">Receiving Location</span><span class="value">${html(rp.receiving_location || "—")}</span></div><div class="field"><span class="label">Vehicle / Driver</span><span class="value">${html([rp.vehicle_number, rp.driver_name, rp.driver_phone].filter(Boolean).join(" · ") || "—")}</span></div><div class="field"><span class="label">Purpose</span><span class="value">${html(rp.purpose || "—")}</span></div></div></section>
  <section class="section"><h3>RETURN RECONCILIATION</h3><div class="table-wrap"><table><colgroup><col style="width:5%"><col style="width:31%"><col style="width:9%"><col style="width:11%"><col style="width:9%"><col style="width:9%"><col style="width:26%"></colgroup><thead><tr><th>#</th><th>Item / Asset</th><th>Outbound</th><th>Previously Returned</th><th>Returning Now</th><th>Outstanding</th><th>Condition / Exception</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <section class="section"><h3>RETURN AUTHORIZATION & GATE VERIFICATION</h3><div class="grid"><div class="field"><span class="label">Facility Head</span><span class="value">${html(rp.facility_manager_name || "—")}</span></div><div class="field"><span class="label">Verified By</span><span class="value">${html(rp.approved_by_name || rp.approved_by_role || "Pending")}</span></div><div class="field"><span class="label">Verification Date</span><span class="value">${dateText(rp.approved_at, true)}</span></div><div class="field"><span class="label">Verification Note</span><span class="value">${html(rp.approval_note || "—")}</span></div><div class="field"><span class="label">Security Checkpoint</span><span class="value">${html(rp.security_checkpoint || "To be completed")}</span></div><div class="field"><span class="label">Security Officer</span><span class="value">${html(rp.security_officer_name || "To be completed")}</span></div></div></section>
  <footer class="footer"><p>Consultancy Unit, Rivers State University, Nkpolu-Oroworokwo, Port Harcourt, Rivers State</p><p>Email: <strong>info@cmotd.org</strong> &nbsp; | &nbsp; Phone NO.: +2349163505000</p><div class="control"><span>Generated by ProcureFlow | Controlled Return Pass</span><span>${html(rp.return_pass_number)}</span></div></footer>
  </main></body></html>`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const { id: idText } = await params;
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid Return Pass." }, { status: 400 });
    const sql = db();
    const rows = await sql<any[]>`
      SELECT rp.*,gp.pass_number gateway_pass_number,gp.expected_return_date,gp.return_status gateway_return_status,
             fm.full_name facility_manager_name,av.full_name approved_by_name
      FROM return_passes rp
      JOIN gateway_passes gp ON gp.id=rp.gateway_pass_id
      LEFT JOIN users fm ON fm.id=rp.facility_manager_user_id
      LEFT JOIN users av ON av.id=rp.approved_by_user_id
      WHERE rp.id=${id} LIMIT 1`;
    const rp = rows[0];
    if (!rp) return NextResponse.json({ error: "Return Pass not found." }, { status: 404 });
    if (!["Facility Manager","Logistics Officer","Procurement Manager","Approver","Admin","Auditor"].includes(user.role)) return NextResponse.json({ error: "Return Pass access denied." }, { status: 403 });
    if (user.role === "Facility Manager" && Number(rp.facility_manager_user_id) !== user.id) return NextResponse.json({ error: "This Return Pass is not assigned to you." }, { status: 403 });
    if (!["Returned","Partial Return","Returned With Exception"].includes(String(rp.status || ""))) return NextResponse.json({ error: "The Return Pass has not been verified yet." }, { status: 409 });
    const items = await sql<any[]>`
      SELECT rpi.*,gi.item_description,gi.unit_of_measure,gi.serial_number,gi.asset_tag
      FROM return_pass_items rpi JOIN gateway_pass_items gi ON gi.id=rpi.gateway_pass_item_id
      WHERE rpi.return_pass_id=${id} ORDER BY rpi.id`;
    const url = new URL(request.url);
    if (url.searchParams.get("download") !== "1") return new NextResponse(previewHtml(rp, items), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

    await sql`UPDATE return_passes SET downloaded_at=NOW(),updated_at=NOW() WHERE id=${id}`;
    const pdf = await returnPassPdf({
      returnPassNumber: rp.return_pass_number,
      gatewayPassNumber: rp.gateway_pass_number,
      status: rp.status,
      department: rp.department,
      purpose: rp.purpose,
      returnOrigin: rp.return_origin,
      receivingLocation: rp.receiving_location,
      actualReturnDate: rp.actual_return_date ? String(rp.actual_return_date) : null,
      expectedReturnDate: rp.expected_return_date ? String(rp.expected_return_date) : null,
      vehicleNumber: rp.vehicle_number,
      driverName: rp.driver_name,
      driverPhone: rp.driver_phone,
      facilityManagerName: rp.facility_manager_name,
      approvedByName: rp.approved_by_name,
      approvedByRole: rp.approved_by_role,
      approvedAt: rp.approved_at ? String(rp.approved_at) : null,
      approvalNote: rp.approval_note,
      securityCheckpoint: rp.security_checkpoint,
      securityOfficerName: rp.security_officer_name,
      gateVerificationTime: rp.gate_verification_time ? String(rp.gate_verification_time) : null,
      gatewayReturnStatus: rp.gateway_return_status,
      items,
    });
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${rp.return_pass_number}.pdf"`, "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to render Return Pass.";
    return NextResponse.json({ error: message }, { status: /access|assigned|Authentication/i.test(message) ? 403 : 500 });
  }
}

import fs from "node:fs";
import path from "node:path";

const root = "/app";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}
function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}
function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Production usability fix could not find ${label}.`);
  return source.replace(search, replacement);
}
function replaceRegexRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Production usability fix could not find ${label}.`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}
function ensureImport(source, marker, importLine, label) {
  if (source.includes(importLine)) return source;
  return replaceRequired(source, marker, `${marker}\n${importLine}`, label);
}

// 1) Admin All Procurement Records: accept the auditor/admin request-row amount field.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);
  const oldAmount = "money(r.estimatedAmount??r.estimated_amount)";
  const newAmount = "money(r.estimatedAmount??r.estimated_amount??r.amount)";
  if (source.includes(oldAmount)) source = source.replaceAll(oldAmount, newAmount);
  else if (!source.includes(newAmount)) throw new Error("Production usability fix could not find generic request amount rendering.");
  write(relativePath, source);
}

// 2) Admin password resets get their own target dropdown rather than inheriting the edit-user selection.
{
  const relativePath = "components/admin-directory-controls.tsx";
  let source = read(relativePath);
  if (!source.includes("const [resetTargetId,setResetTargetId]")) {
    source = replaceRequired(
      source,
      '  const [resetPassword,setResetPassword]=useState("");',
      '  const initialResetTargetId=users.find((row)=>row.id!==currentUserId)?.id||users[0]?.id||0;\n  const [resetTargetId,setResetTargetId]=useState(initialResetTargetId);\n  const resetTarget=users.find((row)=>row.id===resetTargetId)||null;\n  const [resetPassword,setResetPassword]=useState("");',
      "password-reset state",
    );
  }
  source = replaceRegexRequired(
    source,
    /  async function resetUserPassword\(\)\{[\s\S]*?\n  \}\n\n  return <div className="admin-control-stack">/,
    `  async function resetUserPassword(){
    if(!resetTarget)return;
    setResetBusy(true);setResetFeedback(null);
    try{
      const result=await postAdminAction({action:"reset-user-password",targetUserId:resetTarget.id,temporaryPassword:resetPassword,reason:resetReason});
      setResetFeedback({kind:"success",text:\`Password reset for \${result?.username || resetTarget.username}. Existing active sessions were terminated. Intervention \${result?.interventionNo || "recorded"}.\`});
      setResetPassword("");setResetReason("");setResetConfirm("");router.refresh();
    }catch(error){setResetFeedback({kind:"error",text:error instanceof Error?error.message:"Unable to reset password."});}
    finally{setResetBusy(false);}
  }

  return <div className="admin-control-stack">`,
    "password-reset function",
  );
  const oldTarget = '<label><span>Target</span><input value={target?`${target.fullName} (${target.username})`:"No user selected"} readOnly/></label>';
  const newTarget = '<label><span>Target user</span><select value={resetTargetId} onChange={(e)=>{setResetTargetId(Number(e.target.value));setResetConfirm("");setResetFeedback(null);}}>{users.map((row)=><option key={row.id} value={row.id}>{row.fullName} — {roleLabel(row.role)} ({row.username}){row.id===currentUserId?" — current session":""}</option>)}</select></label>';
  if (source.includes(oldTarget)) source = source.replace(oldTarget, newTarget);
  else if (!source.includes("Target user</span><select value={resetTargetId}")) throw new Error("Production usability fix could not find password-reset target control.");
  source = source
    .replace('<span>Confirm by typing <b>RESET {target?.username || "USER"}</b></span>', '<span>Confirm by typing <b>RESET {resetTarget?.username || "USER"}</b></span>')
    .replace('placeholder={target?`RESET ${target.username}`:"RESET USER"}', 'placeholder={resetTarget?`RESET ${resetTarget.username}`:"RESET USER"}')
    .replace('disabled={!ready||!target||target.id===currentUserId||resetPassword.length<6||resetReason.trim().length<5||resetConfirm.trim()!==`RESET ${target.username}`||resetBusy}', 'disabled={!ready||!resetTarget||resetTarget.id===currentUserId||resetPassword.length<6||resetReason.trim().length<5||resetConfirm.trim()!==`RESET ${resetTarget.username}`||resetBusy}');
  write(relativePath, source);
}

// 3) Historical document downloads must never expose infrastructure/provider errors.
{
  const relativePath = "app/api/parity/document/route.ts";
  let source = read(relativePath);
  source = source.replace(
    "This legacy document points to historical filesystem/GCP storage and has no portable file payload in Neon. Its metadata is preserved, but the binary must be re-uploaded to the GCP-free document store.",
    "This historical document does not contain a downloadable file in the current archive. Its metadata is preserved. Re-upload the original file to make downloads available.",
  );
  write(relativePath, source);
}
{
  const relativePath = "components/parity-workspace.tsx";
  let source = read(relativePath);
  source = source
    .replace("New uploads are stored inside Neon as portable file payloads; no GCP runtime storage is used.", "New uploads are stored inside ProcureFlow as portable file payloads.")
    .replace("Maximum 3 MB per file in the current embedded Neon store.", "Maximum 3 MB per file in the current document archive.")
    .replace("Legacy metadata is preserved. Portable files show a download action; historical filesystem/GCP-only binaries will explain that they must be re-uploaded.", "Historical document metadata is preserved. Files available in the current archive can be downloaded; older records without a stored file are marked for re-upload.")
    .replace("Document uploaded to the GCP-free Neon document register.", "Document uploaded to the ProcureFlow document archive.")
    .replace("Approved passes can be generated as PDF without any GCP dependency.", "Approved passes can be generated and downloaded as PDF.")
    .replace("CSV, PDF and JSON exports are generated from live Neon data.", "CSV, PDF and JSON exports are generated from current ProcureFlow records.");
  const oldDownload = 'r.file_path?<a className="table-action-link" href={`/api/parity/document?source=${encodeURIComponent(r.source_type)}&id=${r.id}`}><Download size={13}/>Download</a>:"Metadata only"';
  const newDownload = 'String(r.file_path||"").startsWith("data:")?<a className="table-action-link" href={`/api/parity/document?source=${encodeURIComponent(r.source_type)}&id=${r.id}`}><Download size={13}/>Download</a>:<span className="document-reupload-status">Re-upload required</span>';
  if (source.includes(oldDownload)) source = source.replace(oldDownload, newDownload);
  else if (!source.includes("document-reupload-status")) throw new Error("Production usability fix could not find historical document download control.");
  write(relativePath, source);
}

// 4) Category choices are consistent across Facility, Procurement and draft editing.
const categories = [
  "Diesel/Fuel", "Diesel", "Fuel", "Water", "Office Supplies", "Repairs/Maintenance", "Vehicle Maintenance",
  "Generator Maintenance", "Plumbing", "Welding/Fabrication", "Grass Cutting", "Transport/Logistics",
  "Staff Welfare", "ICT/Software", "Utilities", "Construction Materials", "Professional Services",
  "Operational Purchases", "Equipment", "Services", "Consumables", "Logistics", "Training", "General", "Other",
];
const categoryLiteral = `const CATEGORIES = ${JSON.stringify(categories)};`;
for (const relativePath of ["components/facility-draft-form.tsx", "components/procurement-draft-form.tsx", "components/request-draft-editor.tsx"]) {
  let source = read(relativePath);
  source = replaceRegexRequired(source, /const CATEGORIES = \[[\s\S]*?\];/, categoryLiteral, `${relativePath} categories`);
  write(relativePath, source);
}

// 5) New vendor suggestions can be created from both request-authoring pages.
{
  const relativePath = "components/facility-draft-form.tsx";
  let source = read(relativePath);
  source = ensureImport(source, 'import { CirclePlus, FileText, Paperclip, ShieldCheck, Trash2, Upload, X } from "lucide-react";', 'import { NewVendorSuggestion } from "@/components/new-vendor-suggestion";', "Facility vendor suggestion import");
  if (!source.includes("<NewVendorSuggestion category={category}")) {
    const marker = `        </section>\n\n        <section className="form-section">\n          <div className="form-section-heading"><div className="form-section-title"><span>2</span><div><strong>Line items</strong>`;
    source = replaceRequired(source, marker, `        </section>\n\n        <NewVendorSuggestion category={category} onVendorAdded={setVendorPreference} />\n\n        <section className="form-section">\n          <div className="form-section-heading"><div className="form-section-title"><span>2</span><div><strong>Line items</strong>`, "Facility line-item section marker");
  }
  write(relativePath, source);
}
{
  const relativePath = "components/procurement-draft-form.tsx";
  let source = read(relativePath);
  source = ensureImport(source, 'import { CirclePlus, Landmark, PackagePlus, Save, ShieldCheck, Trash2 } from "lucide-react";', 'import { NewVendorSuggestion } from "@/components/new-vendor-suggestion";', "Procurement vendor suggestion import");
  if (!source.includes("<NewVendorSuggestion category={category}")) {
    const marker = `      </section>\n\n      <section className="authoring-card">\n        <div className="authoring-title"><CirclePlus size={18}/><div><strong>Line items</strong>`;
    source = replaceRequired(source, marker, `      </section>\n\n      <NewVendorSuggestion category={category} onVendorAdded={setVendorPreference} />\n\n      <section className="authoring-card">\n        <div className="authoring-title"><CirclePlus size={18}/><div><strong>Line items</strong>`, "Procurement line-item section marker");
  }
  write(relativePath, source);
}

// 6) Returned requests show their correction/return reason prominently in both Facility and Procurement detail views.
for (const relativePath of ["components/facility-request-register.tsx", "components/procurement-request-register.tsx"]) {
  let source = read(relativePath);
  const editorImport = 'import { RequestDraftEditor } from "@/components/request-draft-editor";';
  source = ensureImport(source, editorImport, 'import { ReturnReasonPanel } from "@/components/return-reason-panel";', `${relativePath} return reason import`);
  if (!source.includes("<ReturnReasonPanel detail={detail}")) {
    source = source.replace(
      /(<div className="request-detail-toolbar">[\s\S]*?<RequestExportButtons requestId=\{selectedId\} compact \/><\/div>)/,
      '$1\n        <ReturnReasonPanel detail={detail} />',
    );
  }
  if (!source.includes("<ReturnReasonPanel detail={detail}")) throw new Error(`Production usability fix could not add return reason to ${relativePath}.`);
  write(relativePath, source);
}

// 7) Procurement inbox request list is a compact dropdown selector instead of a long left-hand table.
{
  const relativePath = "components/procurement-inbox.tsx";
  let source = read(relativePath);
  if (!source.includes("procurement-request-picker")) {
    source = replaceRegexRequired(
      source,
      /<div className="table-wrap"><table className="data-table procurement-select-table">[\s\S]*?<\/table><\/div>\s*\{selected \?/,
      `<div className="procurement-request-picker">
        <label><span>Select Facility request</span><select value={selected?.id || ""} onChange={(event)=>{setSelectedId(Number(event.target.value));setMessage(null);setNote("");setPendingAction(null);}}>{rows.map((row)=><option key={row.id} value={row.id}>{row.requestNo} — {row.departmentProject || "No department"} — {money(row.estimatedAmount)} — {row.status || "Pending"}</option>)}</select></label>
        {selected ? <div className="procurement-picker-summary"><div><span>Request</span><strong>{selected.requestNo}</strong><small>{dateText(selected.requestDate)}</small></div><div><span>Facility Head</span><strong>{selected.facilityManager || "—"}</strong></div><div><span>Amount</span><strong>{money(selected.estimatedAmount)}</strong></div><div><span>Status</span><strong>{selected.status || "—"}</strong></div></div> : null}
      </div>
      {selected ?`,
      "Procurement inbox request table",
    );
  }
  write(relativePath, source);
}

// 8) Request exports use the structured CMOTD PDF renderer instead of raw key/value text.
{
  const relativePath = "app/api/requests/export/route.ts";
  let source = read(relativePath);
  source = source.replace('import { csvText, simplePdf } from "@/lib/procureflow/simple-pdf";', 'import { csvText } from "@/lib/procureflow/simple-pdf";\nimport { buildRequestPdf } from "@/lib/procureflow/request-pdf";');
  source = source.replace(/function pdfLines\([\s\S]*?\n\}\n\nexport async function GET/, "export async function GET");
  source = replaceRegexRequired(
    source,
    /    if \(format === "pdf"\) \{[\s\S]*?\n    \}\n\n    if \(format === "xlsx"/,
    `    if (format === "pdf") {
      const title = requestId && rows[0]?.request_no ? \`Purchase Request — \${rows[0].request_no}\` : \`ProcureFlow \${user.role === "Facility Manager" ? "Facility" : user.role === "Procurement Manager" ? "Procurement" : "All"} Request Register\`;
      const pdf = await buildRequestPdf(rows, { title, requestSpecific: Boolean(requestId) });
      return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": \`attachment; filename="\${filename}.pdf"\` } });
    }

    if (format === "xlsx"`,
    "request PDF export block",
  );
  write(relativePath, source);
}

// 9) Procurement Reports include Procurement Manager low-value approvals.
{
  const relativePath = "components/parity-workspace.tsx";
  let source = read(relativePath);
  source = source.replace(
    'role==="Procurement Manager"?["purchase-orders","vendors","gateway-passes","activity"]',
    'role==="Procurement Manager"?["low-value-approvals","purchase-orders","vendors","gateway-passes","activity"]',
  );
  source = source.replace("CSV, PDF and JSON exports are generated from live Neon data.", "CSV, PDF and JSON exports are generated from current ProcureFlow records.");
  write(relativePath, source);
}
{
  const relativePath = "app/api/parity/export/route.ts";
  let source = read(relativePath);
  if (!source.includes('if(kind==="low-value-approvals")')) {
    const marker = '  if(kind==="gateway-passes"){';
    const block = `  if(kind==="low-value-approvals"){
    if(!["Procurement Manager","Admin","Auditor"].includes(user.role))throw new Error("Low-value approval exports are not available to this role.");
    return sql<any[]>\`
      SELECT pr.request_no,pr.department_project,pr.category,pr.estimated_amount AS amount,pr.status,pr.payment_status,
             ah.action,COALESCE(u.full_name,ah.approved_by_role) AS approved_by,ah.approved_by_role,ah.approval_mode,ah.note,ah.created_at AS approved_at
      FROM approval_history ah
      JOIN purchase_requests pr ON pr.id=ah.entity_id
      LEFT JOIN users u ON u.id=COALESCE(ah.approved_by_user_id,ah.user_id)
      WHERE ah.entity_type='Purchase Request'
        AND ah.approved_by_role='Procurement Manager'
        AND ah.action='Approved Low-Value Request'
        AND (\${user.role!=="Procurement Manager"} OR COALESCE(ah.approved_by_user_id,ah.user_id)=\${user.id})
      ORDER BY ah.created_at DESC
      LIMIT 1000
    \`;
  }
`;
    source = replaceRequired(source, marker, `${block}${marker}`, "low-value report insertion marker");
  }
  write(relativePath, source);
}

// 10) Final usability styles: wider export buttons, return reasons, request picker, vendor suggestion and historical-file state.
{
  const relativePath = "app/local-request-authoring.css";
  let source = read(relativePath);
  const marker = "/* Production usability completion */";
  if (!source.includes(marker)) {
    source += `\n\n${marker}
.request-export-button{min-width:96px!important;min-height:40px!important;padding:9px 14px!important;justify-content:center!important}
.return-reason-panel{margin-top:14px;padding:13px 15px;border:1px solid rgba(244,106,106,.38);border-left:4px solid #f46a6a;border-radius:8px;background:rgba(244,106,106,.08);display:flex;align-items:flex-start;gap:10px}.return-reason-panel svg{color:#f46a6a;flex:0 0 auto;margin-top:1px}.return-reason-panel strong{display:block;font-size:13.5px;color:var(--pf-text)}.return-reason-panel p{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--pf-text)}.return-reason-panel small{display:block;margin-top:5px;color:var(--pf-muted);font-size:11.5px}
.procurement-request-picker{padding:15px;border:1px solid var(--pf-border);border-radius:10px;background:var(--pf-surface)}.procurement-request-picker label{display:grid;gap:6px}.procurement-request-picker label>span{font-size:12px;font-weight:800;color:var(--pf-text)}.procurement-request-picker select{width:100%;min-height:44px;border:1px solid var(--pf-border-strong);border-radius:7px;background:var(--pf-surface);color:var(--pf-text);font:inherit;padding:8px 10px}.procurement-picker-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.procurement-picker-summary>div{padding:10px;border:1px solid var(--pf-border);border-radius:7px;background:var(--pf-surface-2)}.procurement-picker-summary span,.procurement-picker-summary small{display:block;color:var(--pf-muted);font-size:11px}.procurement-picker-summary strong{display:block;margin-top:2px;font-size:13px;color:var(--pf-text)}
.new-vendor-card{border:1px solid var(--pf-border);border-radius:10px;background:var(--pf-surface);padding:15px 16px}.new-vendor-heading{display:flex;align-items:flex-start;gap:11px}.new-vendor-icon{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;background:var(--pf-primary-soft);color:var(--pf-primary);flex:0 0 auto}.new-vendor-heading>div:nth-child(2){min-width:0;flex:1}.new-vendor-heading strong{display:block;font-size:14px}.new-vendor-heading span{display:block;margin-top:3px;color:var(--pf-muted);font-size:12.5px;line-height:1.45}.new-vendor-heading>button{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:8px 12px;border:1px solid var(--pf-border-strong);border-radius:7px;background:var(--pf-surface);color:var(--pf-primary);font-weight:800;cursor:pointer}.new-vendor-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin-top:14px;padding-top:14px;border-top:1px solid var(--pf-border)}.new-vendor-form label{display:grid;gap:6px}.new-vendor-form label.wide{grid-column:1/-1}.new-vendor-form label span{font-size:12px;font-weight:750}.new-vendor-form input{width:100%;box-sizing:border-box;min-height:40px;border:1px solid var(--pf-border-strong);border-radius:7px;background:var(--pf-surface);color:var(--pf-text);font:inherit;padding:8px 10px}.new-vendor-actions{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}.new-vendor-actions small{color:var(--pf-muted);font-size:11.5px;line-height:1.4}.new-vendor-actions button{display:inline-flex;align-items:center;gap:6px;min-height:39px;border:0;border-radius:7px;background:var(--pf-primary);color:#fff;padding:9px 13px;font-weight:800;cursor:pointer}.new-vendor-actions button:disabled{opacity:.55;cursor:wait}
.document-reupload-status{display:inline-flex;align-items:center;min-height:30px;padding:5px 9px;border-radius:999px;background:rgba(241,180,76,.14);color:#b07812;font-size:11.5px;font-weight:800;white-space:nowrap}
html[data-theme="dark"] .document-reupload-status{color:#f1c96d;background:rgba(241,180,76,.12)}
@media(max-width:800px){.new-vendor-heading{flex-wrap:wrap}.new-vendor-heading>button{width:100%;justify-content:center}.new-vendor-form,.procurement-picker-summary{grid-template-columns:1fr}.new-vendor-form label.wide{grid-column:auto}.new-vendor-actions{align-items:stretch;flex-direction:column}.new-vendor-actions button{justify-content:center}}
`;
  }
  write(relativePath, source);
}

console.log("Production usability fixes applied: correct Admin amounts, user-selectable password resets, safe historical documents, expanded categories, vendor suggestions, return reasons, request picker, structured CMOTD PDFs, wider exports and low-value approval reports.");

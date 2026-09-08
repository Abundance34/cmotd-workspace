import fs from "node:fs";
import path from "node:path";

const root = "/app";
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n"); }
function write(relativePath, value) { fs.writeFileSync(path.join(root, relativePath), value, "utf8"); }
function required(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`ICT/inbox/batch patch could not find ${label}.`);
  return source.replace(search, replacement);
}
function ensureImport(source, marker, importLine, label) {
  if (source.includes(importLine)) return source;
  return required(source, marker, `${marker}\n${importLine}`, label);
}

// 1) Add ICT as a first-class ProcureFlow role and give Procurement one shared Inbox.
{
  const relativePath = "lib/procureflow/roles.ts";
  let source = read(relativePath);
  if (!source.includes('  "ICT",')) source = required(source, '  "Facility Manager",\n', '  "Facility Manager",\n  "ICT",\n', "ICT role constant");
  if (!source.includes('  ICT: "ICT",')) source = required(source, '  "Facility Manager": "Utility Head / Facility Head",\n', '  "Facility Manager": "Utility Head / Facility Head",\n  ICT: "ICT",\n', "ICT role label");
  if (!source.includes('  ICT: "ICT Workspace",')) source = required(source, '  "Facility Manager": "Utility Head / Facility Head Workspace",\n', '  "Facility Manager": "Utility Head / Facility Head Workspace",\n  ICT: "ICT Workspace",\n', "ICT landing");
  source = source.replaceAll('"Utility Head / Facility Head Inbox"', '"Inbox"');
  if (!source.includes('  ICT: {\n    title: "ICT Navigation"')) {
    const marker = '  "Logistics Officer": {';
    const block = `  ICT: {
    title: "ICT Navigation",
    sections: [
      "ICT Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager", "Reimbursement Request",
      "Import Documents", "Gateway Pass", "Shared Thread with Procurement Manager", "Returned Requests",
      "Approved / Accepted Requests", "My Activity History", "Settings",
    ],
  },
`;
    source = required(source, marker, `${block}${marker}`, "ICT navigation section");
  }
  write(relativePath, source);
}

// 2) Load Facility-style request data for ICT accounts.
{
  const relativePath = "app/app/page.tsx";
  let source = read(relativePath);
  source = source.replace('user.role === "Facility Manager" ? getFacilityDashboardData(user.id)', '(user.role === "Facility Manager" || user.role === "ICT") ? getFacilityDashboardData(user.id)');
  write(relativePath, source);
}

// 3) Materialized role shell: unified Inbox, ICT rendering, batch reimbursement workspace.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);
  source = ensureImport(source, 'import { ProcurementInbox } from "@/components/procurement-inbox";', 'import { ProcurementInboxV2 } from "@/components/procurement-inbox-v2";', "unified inbox import");
  source = ensureImport(source, 'import { ReimbursementWorkspace } from "@/components/reimbursement-workspace";', 'import { ReimbursementWorkspaceV2 } from "@/components/reimbursement-workspace-v2";', "batch reimbursement import");
  source = source.replace('if(section==="Utility Head / Facility Head Inbox")return <ProcurementInbox rows={data?.inbox||[]}/>;', 'if(section==="Inbox")return <ProcurementInboxV2 rows={data?.inbox||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;');
  source = source.replace('if(section==="Reimbursement Request")content=<ReimbursementWorkspace/>;', 'if(section==="Reimbursement Request")content=<ReimbursementWorkspaceV2/>;');
  source = source.replace('else if(user.role==="Facility Manager")content=<FacilitySection section={section} data={facilityData} parityData={parityData}/>;', 'else if(user.role==="Facility Manager"||user.role==="ICT")content=<FacilitySection section={section} data={facilityData} parityData={parityData}/>;');
  source = source.replace('if(role==="Facility Manager"){cards=', 'if(role==="Facility Manager"||role==="ICT"){cards=');
  source = source.replace('"Facility handoffs"', '"Facility / ICT handoffs"');
  write(relativePath, source);
}

// 4) Standard notifications target one combined Inbox and support ICT/Reimbursement navigation.
{
  const relativePath = "components/standard-notifications.tsx";
  let source = read(relativePath);
  source = source.replaceAll('"Utility Head / Facility Head Inbox"', '"Inbox"');
  source = source.replace(
    '"Utility / Facility Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager",\n    "Import Documents"',
    '"Utility / Facility Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager", "Reimbursement Request",\n    "Import Documents"',
  );
  source = source.replace(
    '"Operations Dashboard", "Purchase Requests", "Low-Value Approvals", "Inbox",',
    '"Operations Dashboard", "Create Request Draft", "My Draft Requests", "Purchase Requests", "Reimbursement Request", "Low-Value Approvals", "Inbox",',
  );
  source = source.replace('"Logistics Dashboard", "PO Delivery Handover"', '"Logistics Dashboard", "Reimbursement Request", "PO Delivery Handover"');
  source = source.replace('"Dashboard", "Approved for Payment"', '"Dashboard", "Reimbursement Request", "Approved for Payment"');
  source = source.replace('"Dashboard", "Pending Approvals"', '"Dashboard", "Reimbursement Request", "Pending Approvals"');
  source = source.replace('"Admin Control Centre", "Action & Exception Centre"', '"Admin Control Centre", "Reimbursement Request", "Action & Exception Centre"');
  source = source.replace('"Audit Dashboard", "Audit Log"', '"Audit Dashboard", "Reimbursement Request", "Audit Log"');
  if (!source.includes('  ICT: [\n    "ICT Dashboard"')) {
    const marker = '  "Procurement Manager": [';
    const block = `  ICT: [
    "ICT Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager", "Reimbursement Request",
    "Import Documents", "Gateway Pass", "Shared Thread with Procurement Manager", "Returned Requests",
    "Approved / Accepted Requests", "My Activity History", "Settings",
  ],
`;
    source = required(source, marker, `${block}${marker}`, "ICT notification sections");
  }
  source = source.replace('if (/facility|utility head|handoff|pending procurement review|sent for procurement review/.test(text)) return "Inbox";', 'if (/facility|utility head|ict|handoff|pending procurement review|sent for procurement review/.test(text)) return "Inbox";');
  if (!source.includes('  if (role === "ICT") {')) {
    const marker = '  if (role === "Procurement Manager") {';
    const block = `  if (role === "ICT") {
    if (/return|correction|resubmit/.test(text)) return "Returned Requests";
    if (/draft/.test(text)) return "My Draft Requests";
    if (/gateway/.test(text)) return "Gateway Pass";
    if (/thread|message|collaboration/.test(text)) return "Shared Thread with Procurement Manager";
    if (/reimburse/.test(text)) return "Reimbursement Request";
    if (/approved|accepted|processed/.test(text)) return "Approved / Accepted Requests";
    return "ICT Dashboard";
  }

`;
    source = required(source, marker, `${block}${marker}`, "ICT notification inference");
  }
  source = source.replace('if (/low[- ]?value/.test(text)) return "Low-Value Approvals";', 'if (/reimburse/.test(text)) return "Reimbursement Request";\n    if (/low[- ]?value/.test(text)) return "Low-Value Approvals";');
  source = source.replace('if (/receipt|proof of payment/.test(text)) return "Receipts";', 'if (/reimburse/.test(text)) return "Reimbursement Request";\n    if (/receipt|proof of payment/.test(text)) return "Receipts";');
  write(relativePath, source);
}

// 5) Procurement data carries requester/source metadata so the Inbox can filter Facility vs ICT.
{
  const relativePath = "lib/procureflow/procurement-data.ts";
  let source = read(relativePath);
  if (!source.includes('  requesterName: string | null;')) source = required(source, '  facilityManager: string | null;\n', '  facilityManager: string | null;\n  requesterName: string | null;\n  requesterRole: string | null;\n  sourceType: string | null;\n', "Procurement row requester fields");
  if (!source.includes('  requester_name: string | null;')) source = required(source, '  facility_manager: string | null;\n', '  facility_manager: string | null;\n  requester_name: string | null;\n  requester_role: string | null;\n  source_type: string | null;\n', "raw requester fields");
  if (!source.includes('requesterName: row.requester_name')) source = required(source, '    facilityManager: row.facility_manager,\n', '    facilityManager: row.facility_manager,\n    requesterName: row.requester_name,\n    requesterRole: row.requester_role,\n    sourceType: row.source_type,\n', "requester mapping");
  source = source.replace(
    'pr.id, pr.request_no, fm.full_name AS facility_manager,\n      pr.department_project',
    'pr.id, pr.request_no, fm.full_name AS facility_manager, requester.full_name AS requester_name, requester.role AS requester_role, pr.source_type,\n      pr.department_project',
  );
  if (!source.includes('LEFT JOIN users requester ON requester.id = pr.requested_by')) source = required(source, '    LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id\n', '    LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id\n    LEFT JOIN users requester ON requester.id = pr.requested_by\n', "requester join");
  write(relativePath, source);
}

// 6) ICT uses the Facility-style request lifecycle, but its source is visibly ICT.
for (const relativePath of [
  "app/api/facility/requests/create/route.ts",
  "app/api/facility/requests/[id]/route.ts",
  "lib/procureflow/facility-draft-actions.ts",
  "lib/procureflow/facility-actions.ts",
]) {
  let source = read(relativePath);
  source = source.replaceAll('user.role !== "Facility Manager" && user.role !== "Admin"', 'user.role !== "Facility Manager" && user.role !== "ICT" && user.role !== "Admin"');
  source = source.replaceAll('Only Utility Head / Facility Head or Admin', 'Only Utility Head / Facility Head, ICT, or Admin');
  write(relativePath, source);
}
{
  const relativePath = "lib/procureflow/facility-draft-actions.ts";
  let source = read(relativePath);
  source = source.replace("'FM Draft', 'Utility Head / Facility Head',", "'FM Draft', ${user.role === \"ICT\" ? \"ICT\" : \"Utility Head / Facility Head\"},");
  write(relativePath, source);
}
{
  const relativePath = "lib/procureflow/facility-actions.ts";
  let source = read(relativePath);
  source = source.replace('const note = "Submitted to Procurement Manager by Utility / Facility Head";', 'const note = `Submitted to Procurement Manager by ${user.role === "ICT" ? "ICT" : "Utility / Facility Head"}`;');
  source = source.replace("NULL, 'Procurement Manager', 'Request pending procurement review',", "${pmId}, NULL, 'Request pending procurement review',");
  source = source.replace("'Open Procurement Review', 'Procurement Review', ${now}", "'Open Inbox', 'Inbox', ${now}");
  source = source.replace("'Open Facility / Utility Inbox', 'Utility Head / Facility Head Inbox', ${now}", "'Open Inbox', 'Inbox', ${now}");
  write(relativePath, source);
}

// 7) Facility parity data and request history are also valid for ICT accounts.
{
  const relativePath = "lib/procureflow/parity-data.ts";
  let source = read(relativePath);
  source = source.replaceAll('user.role === "Facility Manager"\n    ?', '(user.role === "Facility Manager" || user.role === "ICT")\n    ?');
  source = source.replace('["Facility Manager","Procurement Manager","Admin","Auditor"].includes(user.role)', '["Facility Manager","ICT","Procurement Manager","Admin","Auditor"].includes(user.role)');
  source = source.replace(
    'SELECT e.*, v.name vendor_name, po.po_no, u.full_name requester_name, a.full_name approved_by_name, pr.request_no reimbursement_request_no\n    FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN purchase_orders po ON po.id=e.linked_po_id\n    LEFT JOIN users u ON u.id=e.requested_by LEFT JOIN users a ON a.id=e.approved_by LEFT JOIN purchase_requests pr ON pr.linked_expense_id=e.id',
    'SELECT e.*, v.name vendor_name, po.po_no, u.full_name requester_name, a.full_name approved_by_name, linked.request_nos reimbursement_request_no\n    FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN purchase_orders po ON po.id=e.linked_po_id\n    LEFT JOIN users u ON u.id=e.requested_by LEFT JOIN users a ON a.id=e.approved_by\n    LEFT JOIN LATERAL (SELECT string_agg(pr.request_no, \", \") request_nos FROM purchase_requests pr WHERE pr.linked_expense_id=e.id) linked ON TRUE',
  );
  write(relativePath, source);
}

// 8) Admin can select ICT before the first ICT account exists; backend provisions the role catalogue entry and Facility-equivalent permissions on demand.
{
  const relativePath = "components/admin-directory-controls.tsx";
  let source = read(relativePath);
  source = source.replace('const roles = data.roles.map((row) => row.name);', 'const roles = Array.from(new Set([...data.roles.map((row) => row.name), "ICT"]));');
  write(relativePath, source);
}
{
  const relativePath = "lib/procureflow/admin-user-actions.ts";
  let source = read(relativePath);
  if (!source.includes("async function ensureRoleCatalogue")) {
    const marker = 'function ref(prefix: string) {';
    const helper = `async function ensureRoleCatalogue(tx: any, role: ProcureFlowRole) {
  if (role !== "ICT") return;
  await tx\`INSERT INTO roles (name,description,created_at) VALUES ('ICT','ICT procurement request originator',NOW()) ON CONFLICT (name) DO NOTHING\`;
  await tx\`INSERT INTO role_permissions (role_name,permission_name,created_at) SELECT 'ICT',permission_name,NOW() FROM role_permissions WHERE role_name='Facility Manager' ON CONFLICT (role_name,permission_name) DO NOTHING\`;
}

`;
    source = required(source, marker, `${helper}${marker}`, "role catalogue helper");
  }
  source = source.replace('const roleRows = await tx<{name:string}[]>`SELECT name FROM roles WHERE name=${role} LIMIT 1`;', 'await ensureRoleCatalogue(tx, role);\n    const roleRows = await tx<{name:string}[]>`SELECT name FROM roles WHERE name=${role} LIMIT 1`;');
  write(relativePath, source);
}

// 9) Purchase Requests uses a dropdown selector rather than a long scrolling register.
{
  const relativePath = "components/procurement-request-register.tsx";
  let source = read(relativePath);
  if (!source.includes("purchase-request-picker")) {
    source = source.replace('  const isProcurementOwnedDraft = Boolean(detail?.request?.requester_role === "Procurement Manager"', '  const selectedRow = rows.find((row) => row.id === selectedId) || null;\n  const isProcurementOwnedDraft = Boolean(detail?.request?.requester_role === "Procurement Manager"');
    const pattern = /    <div className="table-wrap procurement-request-table facility-register-table"><table className="data-table">[\s\S]*?<\/table><\/div>\n\n    \{selectedId \?/;
    if (!pattern.test(source)) throw new Error("ICT/inbox/batch patch could not find Purchase Request scrolling table.");
    source = source.replace(pattern, `    <div className="procurement-request-picker purchase-request-picker">
      <label><span>Open purchase request</span><select value={selectedId || ""} onChange={(event) => { const id = Number(event.target.value); const row = rows.find((candidate) => candidate.id === id); if (row) void openRequest(row); else { setSelectedId(null); setDetail(null); } }}><option value="">Select a purchase request…</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.requestNo} — {row.departmentProject || "No department"} — {money(row.estimatedAmount)} — {row.status || "Current"}</option>)}</select></label>
      {selectedRow ? <div className="procurement-picker-summary"><div><span>Request</span><strong>{selectedRow.requestNo}</strong><small>{dateText(selectedRow.requestDate)}</small></div><div><span>Department / Project</span><strong>{selectedRow.departmentProject || "—"}</strong></div><div><span>Category</span><strong>{selectedRow.category || "—"}</strong></div><div><span>Amount</span><strong>{money(selectedRow.estimatedAmount)}</strong></div><div><span>Status</span><strong>{selectedRow.status || "—"}</strong></div></div> : null}
    </div>

    {selectedId ?`);
  }
  write(relativePath, source);
}

// 10) Final presentation layer for unified inbox, request picker and reimbursement batches.
{
  const relativePath = "app/local-preview-parity.css";
  let source = read(relativePath);
  if (!source.includes("ICT + UNIFIED INBOX + REIMBURSEMENT BATCH")) {
    source += `

/* ICT + UNIFIED INBOX + REIMBURSEMENT BATCH */
.procurement-unified-inbox{display:grid;gap:16px}.inbox-filter-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.inbox-filter-head>div:first-child{display:flex;align-items:center;gap:9px}.inbox-filter-head>div:first-child>div{display:grid;gap:2px}.inbox-filter-head span{color:var(--muted,#64748b);font-size:.8rem}.inbox-filter-buttons{display:flex;gap:7px;flex-wrap:wrap}.inbox-filter-buttons button{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 11px;border:1px solid var(--border,#d9e1ec);border-radius:8px;background:var(--surface,#fff);font-weight:700;cursor:pointer}.inbox-filter-buttons button.active{border-color:#5570f1;background:color-mix(in srgb,#5570f1 11%,var(--surface,#fff));color:#405ddd}.inbox-filter-buttons b{min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);font-size:.72rem}.procurement-inbox-detail{display:grid;gap:15px}.purchase-request-picker{margin-top:4px}.procurement-request-picker label{display:grid;gap:6px}.procurement-request-picker select{width:100%;min-height:43px;border:1px solid var(--border,#d9e1ec);border-radius:8px;background:var(--surface,#fff);color:inherit;padding:0 12px}.procurement-picker-summary{grid-template-columns:repeat(5,minmax(0,1fr))}.reimbursement-batch-cart{display:grid;gap:13px;padding:15px;border:1px solid var(--border,#d9e1ec);border-radius:12px;background:color-mix(in srgb,var(--surface,#fff) 96%,#5570f1 4%)}.reimbursement-add-item{display:inline-flex;align-items:center;justify-content:center;gap:7px;justify-self:start;min-height:39px;padding:0 14px;border:1px solid #5570f1;border-radius:8px;background:transparent;color:#405ddd;font-weight:750;cursor:pointer}.reimbursement-batch-total{display:flex;align-items:center;justify-content:flex-end;gap:16px;padding-top:8px;border-top:1px solid var(--border,#d9e1ec)}.reimbursement-batch-total span{color:var(--muted,#64748b);font-weight:700}.reimbursement-batch-total strong{font-size:1.35rem}.reimbursement-batch-note{display:grid;gap:6px}.reimbursement-batch-note textarea,.reimbursement-review-controls input{width:100%;border:1px solid var(--border,#d9e1ec);border-radius:8px;background:var(--surface,#fff);color:inherit;padding:10px 12px}.reimbursement-batch-list{display:grid;gap:14px}.reimbursement-batch-card{display:grid;gap:12px;padding:15px;border:1px solid var(--border,#d9e1ec);border-radius:12px;background:var(--surface,#fff)}.reimbursement-batch-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.reimbursement-batch-head>div{display:grid;gap:3px}.reimbursement-batch-head>div:last-child{text-align:right}.reimbursement-batch-head span,.reimbursement-batch-head small{color:var(--muted,#64748b);font-size:.78rem}.reimbursement-batch-head b{font-size:1.05rem}.reimbursement-review-controls{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:8px;align-items:center}.draft-delete-button.compact{min-height:32px;padding:0 9px}.reimbursement-batch-items .compact-table small{display:block;margin-top:3px;color:var(--muted,#64748b)}
@media(max-width:1050px){.procurement-picker-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.reimbursement-review-controls{grid-template-columns:1fr}.reimbursement-review-controls button{justify-content:center}}@media(max-width:640px){.procurement-picker-summary{grid-template-columns:1fr}.reimbursement-batch-head{flex-direction:column}.reimbursement-batch-head>div:last-child{text-align:left}.reimbursement-add-item{width:100%}}
`;
  }
  write(relativePath, source);
}

console.log("ICT/unified inbox/batch reimbursement applied: ICT joins the Facility request channel, Procurement gets one filtered Inbox with rich line-item detail, Purchase Requests uses a dropdown, and reimbursement items can be submitted as one total.");

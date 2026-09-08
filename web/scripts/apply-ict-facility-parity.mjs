import fs from "node:fs";
import path from "node:path";

const root = "/app";
const MARKER = "ICT_FACILITY_PARITY_V1";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}
function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}
function replaceAll(source, search, replacement) {
  return source.split(search).join(replacement);
}
function ensureContains(source, marker, label) {
  if (!source.includes(marker)) throw new Error(`ICT Facility-parity patch could not confirm ${label}.`);
}

// 1) Keep ICT navigation/functionality identical to Facility while preserving a separate role identity.
{
  const relativePath = "lib/procureflow/roles.ts";
  let source = read(relativePath);
  const block = `  ICT: {\n    title: "ICT Navigation",\n    sections: [\n      "ICT Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager", "Reimbursement Request",\n      "Import Documents", "Gateway Pass", "Shared Thread with Procurement Manager", "Returned Requests",\n      "Approved / Accepted Requests", "Income", "My Activity History", "Settings",\n    ],\n  },\n`;
  source = source.replace(/  ICT: \{\n    title: "ICT Navigation",[\s\S]*?\n  \},\n(?=  "Logistics Officer": \{)/, block);
  ensureContains(source, '  ICT: "ICT",', "ICT role label");
  ensureContains(source, '  ICT: "ICT Workspace",', "ICT landing page");
  write(relativePath, source);
}

// 2) ICT loads the same request/dashboard data as Facility.
{
  const relativePath = "app/app/page.tsx";
  let source = read(relativePath);
  source = source.replace('user.role === "Facility Manager" ? getFacilityDashboardData(user.id)', '(user.role === "Facility Manager" || user.role === "ICT") ? getFacilityDashboardData(user.id)');
  ensureContains(source, 'user.role === "Facility Manager" || user.role === "ICT"', "ICT Facility data loader");
  write(relativePath, source);
}

// 3) Make the shared Facility presentation role-aware so ICT gets the same UI without being labelled Facility.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);
  if (!source.includes(`// ${MARKER}`)) source = source.replace('"use client";', `"use client";\n// ${MARKER}`);
  source = source.replace(
    'function FacilitySection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){',
    'function FacilitySection({section,data,parityData,role}:{section:string;data:any;parityData:ParityData;role:"Facility Manager"|"ICT"}){',
  );
  source = source.replace('if(section==="Create Request Draft")return <FacilityDraftForm/>;', 'if(section==="Create Request Draft")return <FacilityDraftForm role={role}/>;');
  source = source.replace(
    'if(["Import Documents","Gateway Pass","Shared Thread with Procurement Manager","My Activity History"].includes(section))return <ParityWorkspace section={section} role="Facility Manager" data={parityData}/>;',
    'if(["Import Documents","Gateway Pass","Shared Thread with Procurement Manager","My Activity History"].includes(section))return <ParityWorkspace section={section} role={role} data={parityData}/>;',
  );
  source = source.replace(
    'if(section==="My Draft Requests")return <FacilityRequestRegister rows={parityData.requests||[]} notifications={parityData.notifications} emptyText="No Facility requests are available yet." compactPicker/>;',
    'if(section==="My Draft Requests")return <FacilityRequestRegister rows={parityData.requests||[]} notifications={parityData.notifications} emptyText={role==="ICT"?"No ICT requests are available yet.":"No Facility requests are available yet."} compactPicker role={role}/>;',
  );
  source = source.replace(
    'else if(user.role==="Facility Manager"||user.role==="ICT")content=<FacilitySection section={section} data={facilityData} parityData={parityData}/>;',
    'else if(user.role==="Facility Manager"||user.role==="ICT")content=<FacilitySection section={section} data={facilityData} parityData={parityData} role={user.role}/>;',
  );
  source = source.replace(
    '["Admin","Finance","Procurement Manager","Facility Manager","Approver","Auditor"].includes(user.role)',
    '["Admin","Finance","Procurement Manager","Facility Manager","ICT","Approver","Auditor"].includes(user.role)',
  );
  ensureContains(source, MARKER, "materialized ICT shell marker");
  ensureContains(source, 'role={user.role}', "ICT role-aware Facility section");
  write(relativePath, source);
}

// 4) Same draft form, but ICT-labelled when the logged-in role is ICT.
{
  const relativePath = "components/facility-draft-form.tsx";
  let source = read(relativePath);
  source = source.replace('export function FacilityDraftForm() {', 'export function FacilityDraftForm({ role = "Facility Manager" }: { role?: "Facility Manager" | "ICT" }) {');
  if (!source.includes('const isICT = role === "ICT";')) {
    source = source.replace('  const router = useRouter();', '  const router = useRouter();\n  const isICT = role === "ICT";\n  const originLabel = isICT ? "ICT" : "Utility / Facility";');
  }
  source = source.replace('note: "Supporting document attached during Utility / Facility draft creation.",', 'note: `Supporting document attached during ${originLabel} draft creation.`,');
  source = source.replace('<h2>Create Utility / Facility Draft</h2>', '<h2>{isICT ? "Create ICT Draft" : "Create Utility / Facility Draft"}</h2>');
  source = source.replace('Create a draft, capture line items, payment-recipient readiness and supporting evidence, then review it before sending it to Procurement.', '{isICT ? "Create an ICT request draft, capture line items, payment-recipient readiness and supporting evidence, then review it before sending it to Procurement." : "Create a draft, capture line items, payment-recipient readiness and supporting evidence, then review it before sending it to Procurement."}');
  ensureContains(source, 'Create ICT Draft', "ICT draft heading");
  write(relativePath, source);
}

// 5) Request history/detail remains one component, with ICT-specific visible wording only.
{
  const relativePath = "components/facility-request-register.tsx";
  let source = read(relativePath);
  source = source.replace(
    'type Props = { rows: any[]; notifications?: any[]; emptyText?: string; compactPicker?: boolean };',
    'type Props = { rows: any[]; notifications?: any[]; emptyText?: string; compactPicker?: boolean; role?: "Facility Manager" | "ICT" };',
  );
  source = source.replace(
    'export function FacilityRequestRegister({ rows, notifications = [], emptyText = "No Facility drafts are available.", compactPicker = false }: Props) {',
    'export function FacilityRequestRegister({ rows, notifications = [], emptyText = "No Facility drafts are available.", compactPicker = false, role = "Facility Manager" }: Props) {',
  );
  if (!source.includes('const isICT = role === "ICT";')) {
    source = source.replace('  const router = useRouter();', '  const router = useRouter();\n  const isICT = role === "ICT";\n  const visibleStatus = (value: unknown) => isICT && String(value || "") === "FM Draft" ? "ICT Draft" : String(value || "—");');
  }
  source = source.replace('<span>Download every request visible to your Facility account.</span>', '<span>{isICT ? "Download every request visible to your ICT account." : "Download every request visible to your Facility account."}</span>');
  source = source.replace('{row.status || "Unknown"} — {money(row.estimatedAmount ?? row.estimated_amount)}', '{visibleStatus(row.status)} — {money(row.estimatedAmount ?? row.estimated_amount)}');
  source = source.replace('<span className="status-chip">{row.status || "—"}</span>', '<span className="status-chip">{visibleStatus(row.status)}</span>');
  source = source.replace('<strong>{detail.request.status || "—"}</strong>', '<strong>{visibleStatus(detail.request.status)}</strong>');
  write(relativePath, source);
}

// 6) Facility API surface is available to ICT with the same owner-only rules.
for (const relativePath of [
  "app/api/facility/reference-data/route.ts",
  "app/api/facility/requests/create/route.ts",
  "app/api/facility/requests/[id]/route.ts",
  "app/api/facility/requests/documents/route.ts",
  "app/api/requests/drafts/[id]/route.ts",
  "lib/procureflow/facility-draft-actions.ts",
  "lib/procureflow/facility-actions.ts",
  "lib/procureflow/request-draft-actions.ts",
  "lib/procureflow/draft-delete.ts",
]) {
  let source = read(relativePath);
  source = replaceAll(source, '["Facility Manager", "Procurement Manager", "Admin"]', '["Facility Manager", "ICT", "Procurement Manager", "Admin"]');
  source = replaceAll(source, '["Facility Manager", "Procurement Manager", "Finance", "Admin"]', '["Facility Manager", "ICT", "Procurement Manager", "Finance", "Admin"]');
  source = replaceAll(source, '["Facility Manager", "Procurement Manager", "Admin", "Auditor"]', '["Facility Manager", "ICT", "Procurement Manager", "Admin", "Auditor"]');
  source = replaceAll(source, '["Facility Manager", "Procurement Manager", "Admin"].includes(user.role)', '["Facility Manager", "ICT", "Procurement Manager", "Admin"].includes(user.role)');
  source = replaceAll(source, 'user.role !== "Facility Manager" && user.role !== "Admin"', 'user.role !== "Facility Manager" && user.role !== "ICT" && user.role !== "Admin"');
  source = replaceAll(source, 'user.role !== "Facility Manager" && user.role !== "Procurement Manager" && user.role !== "Admin"', 'user.role !== "Facility Manager" && user.role !== "ICT" && user.role !== "Procurement Manager" && user.role !== "Admin"');
  source = replaceAll(source, 'user.role === "Facility Manager" && Number(row.requested_by)', '(user.role === "Facility Manager" || user.role === "ICT") && Number(row.requested_by)');
  source = replaceAll(source, 'Only Utility / Facility Head or Admin', 'Only Utility / Facility Head, ICT, or Admin');
  source = replaceAll(source, 'Only Utility Head / Facility Head or Admin', 'Only Utility Head / Facility Head, ICT, or Admin');
  write(relativePath, source);
}

// 7) Generic document imports and the complete Facility parity action set also accept ICT.
{
  const relativePath = "app/api/parity/action/route.ts";
  let source = read(relativePath);
  source = replaceAll(source, '["Facility Manager","Procurement Manager","Finance","Admin"]', '["Facility Manager","ICT","Procurement Manager","Finance","Admin"]');
  source = source.replace('if(user.role==="Facility Manager" && Number(linkedRequest.requested_by)!==user.id && Number(linkedRequest.facility_manager_user_id)!==user.id)', 'if((user.role==="Facility Manager"||user.role==="ICT") && Number(linkedRequest.requested_by)!==user.id && Number(linkedRequest.facility_manager_user_id)!==user.id)');
  source = source.replace("${linkedRequest?.facility_manager_user_id ?? (user.role==='Facility Manager'?user.id:null)}", "${linkedRequest?.facility_manager_user_id ?? ((user.role==='Facility Manager'||user.role==='ICT')?user.id:null)}");
  write(relativePath, source);
}
{
  const relativePath = "lib/procureflow/parity-actions.ts";
  let source = read(relativePath);
  source = replaceAll(source, '["Facility Manager","Admin"]', '["Facility Manager","ICT","Admin"]');
  source = replaceAll(source, '["Facility Manager", "Admin"]', '["Facility Manager", "ICT", "Admin"]');
  source = source.replace('throw new Error("You can add context only to your own Facility request.")', 'throw new Error("You can add context only to your own request.")');
  source = source.replace('const next=decision==="approve"?"finance":"facility_manager";', 'const next=decision==="approve"?"finance":row.requester_role==="ICT"?"ict":"facility_manager";');
  write(relativePath, source);
}
{
  const relativePath = "components/parity-workspace.tsx";
  let source = read(relativePath);
  source = replaceAll(source, '["Facility Manager","Admin"]', '["Facility Manager","ICT","Admin"]');
  source = replaceAll(source, '["Facility Manager","Procurement Manager","Finance","Admin"]', '["Facility Manager","ICT","Procurement Manager","Finance","Admin"]');
  source = source.replace('Draft → Procurement review → Approver / MD → Facility generation → Logistics coordination.', 'Draft → Procurement review → Approver / MD → originator generation → Logistics coordination.');
  write(relativePath, source);
}

// 8) Return-for-correction routes back to ICT when ICT originated the request, while Facility continues to use facility_manager.
{
  const relativePath = "lib/procureflow/procurement-actions.ts";
  let source = read(relativePath);
  if (!source.includes('requester_role: string | null;')) {
    source = source.replace('  requested_by: number;\n', '  requested_by: number;\n  requester_role: string | null;\n');
  }
  source = source.replace(
    'SELECT id, request_no, requested_by, facility_manager_user_id,\n             assigned_procurement_manager_id, status, next_role,\n             estimated_amount, department_project\n      FROM purchase_requests\n      WHERE id = ${requestId}',
    'SELECT pr.id, pr.request_no, pr.requested_by, requester.role AS requester_role, pr.facility_manager_user_id,\n             pr.assigned_procurement_manager_id, pr.status, pr.next_role,\n             pr.estimated_amount, pr.department_project\n      FROM purchase_requests pr\n      LEFT JOIN users requester ON requester.id=pr.requested_by\n      WHERE pr.id = ${requestId}',
  );
  if (!source.includes('const routedNextRole = action === "return" && request.requester_role === "ICT"')) {
    source = source.replace('    const pmId = request.assigned_procurement_manager_id || user.id;', '    const pmId = request.assigned_procurement_manager_id || user.id;\n    const routedNextRole = action === "return" && request.requester_role === "ICT" ? "ict" : policy.nextRole;');
    source = source.replaceAll('${policy.nextRole}', '${routedNextRole}');
    source = source.replace('return { requestId, requestNo: request.request_no, status: policy.status, nextRole: policy.nextRole };', 'return { requestId, requestNo: request.request_no, status: policy.status, nextRole: routedNextRole };');
  }
  write(relativePath, source);
}

console.log("ICT Facility-parity applied: ICT now has the same Facility UI, draft/request lifecycle, imports, gateway passes, messaging, reimbursement access, editing/deletion and Procurement routing while remaining a separate role/source.");

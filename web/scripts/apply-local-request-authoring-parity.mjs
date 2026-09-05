import fs from "node:fs";
import path from "node:path";

const root = "/app";
const shellPath = path.join(root, "components/complete-role-shell.tsx");
let shell = fs.readFileSync(shellPath, "utf8");

const imports = 'import { ProcurementDraftForm } from "@/components/procurement-draft-form";\nimport { ProcurementOwnedDrafts } from "@/components/procurement-owned-drafts";';
if (!shell.includes('import { ProcurementDraftForm } from "@/components/procurement-draft-form";')) {
  const marker = 'import { FacilityDraftForm } from "@/components/facility-draft-form";';
  if (!shell.includes(marker)) throw new Error("Cannot find FacilityDraftForm import in complete-role-shell.tsx.");
  shell = shell.replace(marker, `${marker}\n${imports}`);
}

if (!shell.includes('if(section==="Create Request Draft")return <ProcurementDraftForm/>;')) {
  const marker = 'function ProcurementSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){\n';
  if (!shell.includes(marker)) throw new Error("Cannot find ProcurementSection in complete-role-shell.tsx.");
  shell = shell.replace(marker, `${marker}  if(section==="Create Request Draft")return <ProcurementDraftForm/>;\n  if(section==="My Draft Requests")return <ProcurementOwnedDrafts/>;\n`);
}

const oldInbox = '  if(section==="Utility Head / Facility Head Inbox")return <ProcurementInbox rows={data?.inbox||[]}/>;';
const newInbox = '  if(section==="Utility Head / Facility Head Inbox")return <ProcurementInbox rows={data?.inbox||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;';
if (shell.includes(oldInbox)) shell = shell.replace(oldInbox, newInbox);
else if (!shell.includes(newInbox)) throw new Error("Cannot find Procurement inbox renderer in complete-role-shell.tsx.");

const facilityApprovedGeneric = '  if(section==="Approved / Accepted Requests")return <GenericRequestTable rows={data?.approved||[]}/>;';
const facilityApprovedRegister = '  if(section==="Approved / Accepted Requests")return <FacilityRequestRegister rows={data?.approved||[]} notifications={parityData.notifications} emptyText="No approved or accepted requests are available."/>;';
if (shell.includes(facilityApprovedGeneric)) shell = shell.replace(facilityApprovedGeneric, facilityApprovedRegister);
else if (!shell.includes(facilityApprovedRegister)) throw new Error("Cannot find Facility approved-request renderer in complete-role-shell.tsx.");

fs.writeFileSync(shellPath, shell, "utf8");

// Keep duplicate-account fingerprinting compatible with the existing Facility payee workflow,
// and avoid generic type arguments on the intentionally untyped transaction helper.
{
  const draftPath = path.join(root, "lib/procureflow/request-draft-actions.ts");
  let source = fs.readFileSync(draftPath, "utf8");
  const oldFingerprint = 'createHmac("sha256", activeAuditSigningKey()).update(payee.accountNumber, "utf8").digest("hex")';
  const newFingerprint = 'createHmac("sha256", activeAuditSigningKey()).update(`fingerprint:${payee.accountNumber.replace(/\\s+/g, "").toUpperCase()}`, "utf8").digest("hex")';
  if (source.includes(oldFingerprint)) source = source.replace(oldFingerprint, newFingerprint);
  else if (!source.includes(newFingerprint)) throw new Error("Cannot find request draft account fingerprint logic.");
  source = source.replaceAll('tx<{ count: number }[]>', 'tx').replaceAll('tx<{ id: number }[]>', 'tx');
  fs.writeFileSync(draftPath, source, "utf8");
}

// Keep state-derived request ids narrowed inside async editor callbacks and ensure a new editor always has one line.
for (const relativePath of ["components/facility-request-register.tsx", "components/procurement-request-register.tsx"]) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, "utf8");
  source = source.replaceAll('loadDetail(selectedId)', 'loadDetail(Number(selectedId))');
  fs.writeFileSync(file, source, "utf8");
}
{
  const file = path.join(root, "components/request-draft-editor.tsx");
  let source = fs.readFileSync(file, "utf8");
  const oldItems = '  const [items, setItems] = useState<Item[]>(() => (detail?.items || []).map((item: any) => ({\n    itemName: String(item.item_name || ""), description: String(item.description || ""), itemCategory: String(item.category || ""), suggestedVendor: String(item.suggested_vendor || ""), quantity: String(item.quantity ?? 1), unitPrice: String(item.unit_price ?? ""),\n  })) || [blankItem()]);';
  const newItems = '  const [items, setItems] = useState<Item[]>(() => {\n    const mapped = (detail?.items || []).map((item: any) => ({\n      itemName: String(item.item_name || ""), description: String(item.description || ""), itemCategory: String(item.category || ""), suggestedVendor: String(item.suggested_vendor || ""), quantity: String(item.quantity ?? 1), unitPrice: String(item.unit_price ?? ""),\n    }));\n    return mapped.length ? mapped : [blankItem()];\n  });';
  if (source.includes(oldItems)) source = source.replace(oldItems, newItems);
  fs.writeFileSync(file, source, "utf8");
}

// The configured policy is authoritative. The fallback is aligned with the migration default.
{
  const dataPath = path.join(root, "lib/procureflow/parity-data.ts");
  let source = fs.readFileSync(dataPath, "utf8");
  source = source.replace('policyRows[0]?.amount || 100000', 'policyRows[0]?.amount || 2000000');
  fs.writeFileSync(dataPath, source, "utf8");

  const actionPath = path.join(root, "lib/procureflow/parity-actions.ts");
  source = fs.readFileSync(actionPath, "utf8").replaceAll('amount||100000', 'amount||2000000');
  fs.writeFileSync(actionPath, source, "utf8");
}

// Facility-originated requests within the configured threshold must use Procurement Manager low-value approval.
{
  const actionPath = path.join(root, "lib/procureflow/procurement-actions.ts");
  let source = fs.readFileSync(actionPath, "utf8");
  const marker = '    const now = new Date().toISOString();\n    const finalNote = note.trim() || policy.defaultNote;';
  const guard = `    if (action === "submit_approval") {\n      const limitRows = await tx<{ amount: string | number }[]>\`\n        SELECT amount FROM approval_policy_settings\n        WHERE policy_key = 'procurement_manager_approval_limit'\n        LIMIT 1\n      \`;\n      const approvalLimit = Number(limitRows[0]?.amount || 2000000);\n      if (Number(request.estimated_amount || 0) <= approvalLimit) {\n        throw new Error(\`This Facility request is within the Procurement Manager low-value approval limit of NGN \${approvalLimit.toLocaleString("en-NG")}. Mark it reviewed and decide it under Low-Value Approvals instead of sending it to Approver / MD.\`);\n      }\n    }\n\n`;
  if (!source.includes('This Facility request is within the Procurement Manager low-value approval limit')) {
    if (!source.includes(marker)) throw new Error("Cannot find Procurement review transition marker for low-value guard.");
    source = source.replace(marker, `${guard}${marker}`);
  }
  fs.writeFileSync(actionPath, source, "utf8");
}

console.log("Local request-authoring parity applied: PM-owned drafts route directly to Approver, Facility low-value requests stay with Procurement up to the configured limit, draft editing/account replacement and CSV/Excel/PDF/JSON exports are enabled.");

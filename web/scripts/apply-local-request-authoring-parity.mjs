import fs from "node:fs";
import path from "node:path";

const root = "/app";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Local request-authoring patch could not find ${label}.`);
  return source.replace(search, replacement);
}

// 1) Wire Procurement request authoring, owned drafts, low-value context and Facility request detail.
{
  const relativePath = "components/complete-role-shell.tsx";
  let shell = read(relativePath);

  if (!shell.includes('import { ProcurementDraftForm } from "@/components/procurement-draft-form";')) {
    const marker = 'import { FacilityDraftForm } from "@/components/facility-draft-form";';
    shell = replaceRequired(
      shell,
      marker,
      `${marker}\nimport { ProcurementDraftForm } from "@/components/procurement-draft-form";\nimport { ProcurementOwnedDrafts } from "@/components/procurement-owned-drafts";`,
      "FacilityDraftForm import",
    );
  }

  if (!shell.includes('if(section==="Create Request Draft")return <ProcurementDraftForm/>;')) {
    const marker = 'function ProcurementSection({section,data,parityData}:{section:string;data:any;parityData:ParityData}){';
    shell = replaceRequired(
      shell,
      marker,
      `${marker}\n  if(section==="Create Request Draft")return <ProcurementDraftForm/>;\n  if(section==="My Draft Requests")return <ProcurementOwnedDrafts/>;`,
      "ProcurementSection declaration",
    );
  }

  const oldInbox = '  if(section==="Utility Head / Facility Head Inbox")return <ProcurementInbox rows={data?.inbox||[]}/>;';
  const newInbox = '  if(section==="Utility Head / Facility Head Inbox")return <ProcurementInbox rows={data?.inbox||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;';
  if (shell.includes(oldInbox)) shell = shell.replace(oldInbox, newInbox);
  else if (!shell.includes(newInbox)) throw new Error("Local request-authoring patch could not find Procurement inbox renderer.");

  const facilityApprovedGeneric = '  if(section==="Approved / Accepted Requests")return <GenericRequestTable rows={data?.approved||[]}/>;';
  const facilityApprovedRegister = '  if(section==="Approved / Accepted Requests")return <FacilityRequestRegister rows={data?.approved||[]} notifications={parityData.notifications} emptyText="No approved or accepted requests are available."/>;';
  if (shell.includes(facilityApprovedGeneric)) shell = shell.replace(facilityApprovedGeneric, facilityApprovedRegister);
  else if (!shell.includes(facilityApprovedRegister)) throw new Error("Local request-authoring patch could not find Facility approved-request renderer.");

  write(relativePath, shell);
}

// 2) Keep duplicate-account fingerprinting compatible with the Facility payee workflow,
// and avoid generic type arguments on the intentionally untyped transaction helper.
{
  const relativePath = "lib/procureflow/request-draft-actions.ts";
  let source = read(relativePath);
  const oldFingerprint = 'createHmac("sha256", activeAuditSigningKey()).update(payee.accountNumber, "utf8").digest("hex")';
  const newFingerprint = 'createHmac("sha256", activeAuditSigningKey()).update(`fingerprint:${payee.accountNumber.replace(/\\s+/g, "").toUpperCase()}`, "utf8").digest("hex")';
  if (source.includes(oldFingerprint)) source = source.replace(oldFingerprint, newFingerprint);
  else if (!source.includes(newFingerprint)) throw new Error("Local request-authoring patch could not find request draft account fingerprint logic.");
  source = source.replaceAll('tx<{ count: number }[]>', 'tx').replaceAll('tx<{ id: number }[]>', 'tx');
  write(relativePath, source);
}

// 3) Keep state-derived request ids narrowed inside async callbacks.
for (const relativePath of [
  "components/facility-request-register.tsx",
  "components/procurement-request-register.tsx",
]) {
  let source = read(relativePath);
  source = source.replaceAll('loadDetail(selectedId)', 'loadDetail(Number(selectedId))');
  write(relativePath, source);
}

// 4) A new editor must always have at least one line item.
{
  const relativePath = "components/request-draft-editor.tsx";
  let source = read(relativePath);
  if (!source.includes("return mapped.length ? mapped : [blankItem()];")) {
    const oldItems = `  const [items, setItems] = useState<Item[]>(() => (detail?.items || []).map((item: any) => ({
    itemName: String(item.item_name || ""), description: String(item.description || ""), itemCategory: String(item.category || ""), suggestedVendor: String(item.suggested_vendor || ""), quantity: String(item.quantity ?? 1), unitPrice: String(item.unit_price ?? ""),
  })) || [blankItem()]);`;
    const newItems = `  const [items, setItems] = useState<Item[]>(() => {
    const mapped = (detail?.items || []).map((item: any) => ({
      itemName: String(item.item_name || ""), description: String(item.description || ""), itemCategory: String(item.category || ""), suggestedVendor: String(item.suggested_vendor || ""), quantity: String(item.quantity ?? 1), unitPrice: String(item.unit_price ?? ""),
    }));
    return mapped.length ? mapped : [blankItem()];
  });`;
    source = replaceRequired(source, oldItems, newItems, "request editor line-item initializer");
  }
  write(relativePath, source);
}

// 5) The configured Admin policy is authoritative. Fallback values only protect missing legacy rows.
{
  const dataPath = "lib/procureflow/parity-data.ts";
  let source = read(dataPath);
  source = source.replace('policyRows[0]?.amount || 100000', 'policyRows[0]?.amount || 2000000');
  write(dataPath, source);

  const actionPath = "lib/procureflow/parity-actions.ts";
  source = read(actionPath).replaceAll('amount||100000', 'amount||2000000');
  write(actionPath, source);
}

// 6) Facility-originated requests within the configured threshold must remain on the
// Procurement Manager low-value path instead of being sent to Approver / MD.
{
  const relativePath = "lib/procureflow/procurement-actions.ts";
  let source = read(relativePath);
  if (!source.includes("This Facility request is within the Procurement Manager low-value approval limit")) {
    const marker = `    const now = new Date().toISOString();
    const finalNote = note.trim() || policy.defaultNote;`;
    const guard = `    if (action === "submit_approval") {
      const limitRows = await tx<{ amount: string | number }[]>\`
        SELECT amount FROM approval_policy_settings
        WHERE policy_key = 'procurement_manager_approval_limit'
        LIMIT 1
      \`;
      const approvalLimit = Number(limitRows[0]?.amount || 2000000);
      if (Number(request.estimated_amount || 0) <= approvalLimit) {
        throw new Error(\`This Facility request is within the Procurement Manager low-value approval limit of NGN \${approvalLimit.toLocaleString("en-NG")}. Mark it reviewed and decide it under Low-Value Approvals instead of sending it to Approver / MD.\`);
      }
    }

`;
    source = replaceRequired(source, marker, `${guard}${marker}`, "Procurement review transition marker");
  }
  write(relativePath, source);
}

console.log("Local request-authoring parity applied: PM-owned drafts route directly to Approver, Facility low-value requests stay with Procurement up to the configured limit, draft editing/account replacement and CSV/Excel/PDF/JSON exports are enabled.");

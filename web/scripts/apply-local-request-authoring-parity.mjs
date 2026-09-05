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
  shell = shell.replace(
    marker,
    `${marker}  if(section==="Create Request Draft")return <ProcurementDraftForm/>;\n  if(section==="My Draft Requests")return <ProcurementOwnedDrafts/>;\n`,
  );
}

fs.writeFileSync(shellPath, shell, "utf8");
console.log("Local request-authoring parity applied: Procurement Manager create/edit drafts, direct Approver routing and role-scoped request exports are wired into the local shell.");

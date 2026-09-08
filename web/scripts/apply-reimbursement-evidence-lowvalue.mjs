import fs from "node:fs";
import path from "node:path";

const root = "/app";
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n"); }
function write(relativePath, value) { fs.writeFileSync(path.join(root, relativePath), value, "utf8"); }
function copy(from, to) { fs.copyFileSync(path.join(root, from), path.join(root, to)); }
function requiredRegex(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Reimbursement evidence/low-value patch could not find ${label}.`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

// Materialize the stronger reimbursement workspace and direct low-value approval Inbox.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);

  if (!source.includes('import { ProcurementInboxV3 } from "@/components/procurement-inbox-v3";')) {
    const marker = /import \{ ProcurementInbox(?:V2)? \} from "@\/components\/procurement-inbox(?:-v2)?";/;
    if (!marker.test(source)) throw new Error("Reimbursement evidence/low-value patch could not find Procurement Inbox import.");
    source = source.replace(marker, (match) => `${match}\nimport { ProcurementInboxV3 } from "@/components/procurement-inbox-v3";`);
  }
  if (!source.includes('import { ReimbursementWorkspaceV3 } from "@/components/reimbursement-workspace-v3";')) {
    const marker = /import \{ ReimbursementWorkspace(?:V2)? \} from "@\/components\/reimbursement-workspace(?:-v2)?";/;
    if (!marker.test(source)) throw new Error("Reimbursement evidence/low-value patch could not find reimbursement workspace import.");
    source = source.replace(marker, (match) => `${match}\nimport { ReimbursementWorkspaceV3 } from "@/components/reimbursement-workspace-v3";`);
  }

  if (!source.includes('if(section==="Inbox")return <ProcurementInboxV3')) {
    source = requiredRegex(
      source,
      /if\(section==="(?:Utility Head \/ Facility Head Inbox|Inbox)"\)return <ProcurementInbox(?:V2)? rows=\{data\?\.inbox\|\|\[\]\}(?: approvalLimit=\{[^}]+\})?\/>;/,
      'if(section==="Inbox")return <ProcurementInboxV3 rows={data?.inbox||[]} approvalLimit={data?.approvalLimit||parityData.policyLimit}/>;',
      "Procurement Inbox renderer",
    );
  }

  if (!source.includes('if(section==="Reimbursement Request")content=<ReimbursementWorkspaceV3/>;')) {
    source = requiredRegex(
      source,
      /if\(section==="Reimbursement Request"\)content=<ReimbursementWorkspace(?:V2)?\/>;/,
      'if(section==="Reimbursement Request")content=<ReimbursementWorkspaceV3/>;',
      "reimbursement renderer",
    );
  }
  write(relativePath, source);
}

// Replace the build-time API implementations with the v3 evidence-aware routes.
copy("app/api/reimbursements/route.v3.ts", "app/api/reimbursements/route.ts");
copy("app/api/reimbursements/proof/route.v3.ts", "app/api/reimbursements/proof/route.ts");

console.log("Reimbursement evidence + low-value approval applied: multiple receipt/proof files are supported, cash claims are capped at NGN 5,000 per batch, and Procurement can approve low-value Inbox requests directly.");

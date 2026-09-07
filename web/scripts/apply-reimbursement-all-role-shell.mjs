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
  if (!source.includes(search)) throw new Error(`All-role reimbursement shell patch could not find ${label}.`);
  return source.replace(search, replacement);
}

const relativePath = "components/complete-role-shell.tsx";
let source = read(relativePath);

const importLine = 'import { ReimbursementWorkspace } from "@/components/reimbursement-workspace";';
if (!source.includes(importLine)) {
  source = replaceRequired(
    source,
    'import { GlobalTools } from "@/components/global-tools";',
    'import { GlobalTools } from "@/components/global-tools";\n' + importLine,
    "Reimbursement workspace import",
  );
}

if (!source.includes('if(section==="Reimbursement Request")content=<ReimbursementWorkspace/>;')) {
  source = replaceRequired(
    source,
    '  if(!isDashboard){\n    if(section==="Income"',
    '  if(!isDashboard){\n    if(section==="Reimbursement Request")content=<ReimbursementWorkspace/>;\n    else if(section==="Income"',
    "shared role content branch",
  );
}

write(relativePath, source);
console.log("All roles can open Reimbursement Request from the shared role shell.");

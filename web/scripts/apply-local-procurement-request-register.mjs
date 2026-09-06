import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value, "utf8"); }
function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Procurement request register patch could not find ${label}.`);
  return source.replace(search, replacement);
}

const path = "/app/components/complete-role-shell.tsx";
let source = read(path);

if (!source.includes('import { ProcurementRequestRegister } from "@/components/procurement-request-register";')) {
  source = replaceRequired(
    source,
    'import { ProcurementInbox } from "@/components/procurement-inbox";',
    'import { ProcurementInbox } from "@/components/procurement-inbox";\nimport { ProcurementRequestRegister } from "@/components/procurement-request-register";',
    "ProcurementInbox import",
  );
}

const genericRegister = '  if(section==="Purchase Requests")return <GenericRequestTable rows={data?.requests||[]}/>;';
const clickableRegister = '  if(section==="Purchase Requests")return <ProcurementRequestRegister rows={data?.requests||[]}/>;';
if (source.includes(genericRegister)) {
  source = source.replace(genericRegister, clickableRegister);
} else if (!source.includes(clickableRegister)) {
  throw new Error("Procurement request register patch could not find Purchase Requests renderer.");
}

write(path, source);
console.log("Local Procurement request register applied: Purchase Requests rows now open complete request detail.");

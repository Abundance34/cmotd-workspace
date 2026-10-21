// Applied after the legacy parity overlays to preserve the new navigation and role workflow.
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const write=(p,s)=>fs.writeFileSync(path.join(root,p),s,"utf8");
const ROLE_NAMES=["Admin","Procurement Manager","Facility Manager","ICT","Logistics Officer","Finance","Approver","Auditor"];
const SECTION='"Expense Reconciliation"';
function addSection(source,role,style){
 const key=(role==="Admin"||role==="Finance"||role==="Approver"||role==="Auditor"||role==="ICT")?role:JSON.stringify(role);
 const heading=style==="roles"?"  "+key+": {":"  "+key+": [";
 const start=source.indexOf(heading);
 if(start<0)throw new Error("Expense reconciliation navigation cannot find "+style+" role "+role);
 const close=style==="roles"?source.indexOf("    ],",start):source.indexOf("  ],",start);
 if(close<0)throw new Error("Missing role nav closing marker for "+role);
 const segment=source.slice(start,close);
 if(segment.includes(SECTION))return source;
 const indent=style==="roles"?"      ":"    ";
 return source.slice(0,close)+indent+SECTION+",\n"+source.slice(close);
}
{
 const p="lib/procureflow/roles.ts";let s=read(p);
 for(const role of ROLE_NAMES)s=addSection(s,role,"roles");
 write(p,s);
}
{
 const p="components/standard-notifications.tsx";let s=read(p);
 for(const role of ROLE_NAMES) {
   // Not all legacy overlays have the same role list; use the known heading if present.
   const key=(role==="Admin"||role==="Finance"||role==="Approver"||role==="Auditor"||role==="ICT")?role:JSON.stringify(role);
   if(s.includes("  "+key+": ["))s=addSection(s,role,"notification");
 }
 write(p,s);
}
{
 const p="components/admin-control-centre-v2.tsx";let s=read(p);
 const marker='"All Procurement Records"';
 if(!s.includes(SECTION)) {
  if(!s.includes(marker))throw new Error("Admin Operations navigation marker not found.");
  s=s.replace(marker,marker+", "+SECTION);
 }
 write(p,s);
}
{
 const p="components/complete-role-shell.tsx";let s=read(p);
 const imp='import { ExpenseReconciliationWorkspace } from "@/components/expense-reconciliation-workspace";';
 if(!s.includes(imp)){
  const marker='import { ReturnPassWorkspace } from "@/components/return-pass-workspace";';
  if(!s.includes(marker))throw new Error("Expense reconciliation shell import anchor missing.");
  s=s.replace(marker,marker+"\n"+imp);
 }
 const point='if(!content)content=<ParityWorkspace';
 if(!s.includes('if(section==="Expense Reconciliation")content='))
 {
  if(!s.includes(point))throw new Error("Expense reconciliation shell insertion anchor missing.");
  s=s.replace(point,'if(section==="Expense Reconciliation")content=<ExpenseReconciliationWorkspace role={user.role}/>;\n    '+point);
 }
 write(p,s);
}
console.log("Expense Reconciliation navigation and workflow materialized.");

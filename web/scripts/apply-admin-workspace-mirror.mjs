// Keep the Admin Workspace Inspector intact after the historical parity overlays.
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
function patch(relativePath,transform){
 const full=path.join(root,relativePath);
 const before=fs.readFileSync(full,"utf8");
 const after=transform(before);
 if(after!==before)fs.writeFileSync(full,after,"utf8");
}
patch("lib/procureflow/roles.ts",(s)=>{
 if(s.includes('"Workspace Inspector"'))return s;
 const anchor='"Workflow Intervention Centre", "User Management",';
 if(!s.includes(anchor))throw new Error("Inspector roles anchor missing.");
 return s.replace(anchor,anchor+' "Workspace Inspector",');
});
patch("components/admin-control-centre-v2.tsx",(s)=>{
 if(s.includes('"Workspace Inspector"'))return s;
 const anchor='"Workflow Intervention Centre", "User Management",';
 if(!s.includes(anchor))throw new Error("Inspector grouped navigation anchor missing.");
 return s.replace(anchor,anchor+' "Workspace Inspector",');
});
patch("components/complete-role-shell.tsx",(s)=>{
 const imp='import { AdminWorkspaceMirrorLauncher } from "@/components/admin-workspace-mirror-launcher";';
 if(!s.includes(imp)){
   const anchor='import { AdminGroupedNavigation, AdminOperationsDashboardV2, AdminProcurementRecordsV2 } from "@/components/admin-control-centre-v2";';
   if(!s.includes(anchor))throw new Error("Inspector shell import anchor missing.");
   s=s.replace(anchor,anchor+"\n"+imp);
 }
 if(!s.includes('export function Dashboard(')){
   if(!s.includes('function Dashboard('))throw new Error("Employee dashboard renderer missing.");
   s=s.replace('function Dashboard(','export function Dashboard(');
 }
 if(!s.includes('if(section==="Workspace Inspector")return')){
   const anchor='if(section==="User Management")return';
   if(!s.includes(anchor))throw new Error("Inspector Admin section anchor missing.");
   s=s.replace(anchor,'if(section==="Workspace Inspector")return <AdminWorkspaceMirrorLauncher users={data?.evidence?.users||[]}/>;\n  '+anchor);
 }
 return s;
});
console.log("Admin Workspace Inspector navigation and read-only dashboard renderer ready.");

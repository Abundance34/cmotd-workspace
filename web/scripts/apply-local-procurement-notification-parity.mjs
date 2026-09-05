import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value, "utf8"); }
function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Procurement notification parity patch could not find ${label}.`);
  return source.replace(search, replacement);
}

// Route future Facility submissions to the actual Procurement Manager inbox and
// target the assigned Procurement Manager rather than every user with that role.
{
  const path = "/app/lib/procureflow/facility-actions.ts";
  let source = read(path);
  if (source.includes("NULL, 'Procurement Manager', 'Request pending procurement review',")) {
    source = source.replace(
      "NULL, 'Procurement Manager', 'Request pending procurement review',",
      "${pmId}, NULL, 'Request pending procurement review',",
    );
  }
  if (source.includes("'Open Procurement Review', 'Procurement Review', ${now}")) {
    source = source.replace(
      "'Open Procurement Review', 'Procurement Review', ${now}",
      "'Open Facility / Utility Inbox', 'Utility Head / Facility Head Inbox', ${now}",
    );
  }
  write(path, source);
}

// Restore visible Procurement Manager cues: sidebar count + on-login dashboard alert.
{
  const path = "/app/components/complete-role-shell.tsx";
  let source = read(path);

  if (!source.includes("const procurementReviewAlerts=")) {
    source = replaceRequired(
      source,
      "const [section,setSection]=useState(nav.sections[0]);",
      "const [section,setSection]=useState(nav.sections[0]);const procurementReviewAlerts=user.role===\"Procurement Manager\"?parityData.notifications.filter((n:any)=>!n.is_read&&(String(n.title||\"\")===\"Request pending procurement review\"||String(n.section_target||\"\")===\"Utility Head / Facility Head Inbox\"||String(n.section_target||\"\")===\"Procurement Review\")):[];const procurementReviewAlert=procurementReviewAlerts[0]||null;",
      "Procurement Manager shell state",
    );
  }

  const oldUnread = 'parityData.notifications.filter((n:any)=>!n.is_read&&String(n.section_target||"")===item).length';
  const newUnread = 'parityData.notifications.filter((n:any)=>!n.is_read&&(String(n.section_target||"")===item||(item==="Utility Head / Facility Head Inbox"&&String(n.section_target||"")==="Procurement Review"))).length';
  if (source.includes(oldUnread)) source = source.replace(oldUnread, newUnread);

  if (!source.includes('className="procurement-login-alert"')) {
    source = replaceRequired(
      source,
      '</div>{isDashboard?<Dashboard',
      '</div>{isDashboard&&procurementReviewAlert?<div className="procurement-login-alert"><div><span>NEW PROCUREMENT REQUEST</span><strong>{procurementReviewAlert.title}</strong><p>{procurementReviewAlert.message}</p></div><button type="button" onClick={()=>setSection("Utility Head / Facility Head Inbox")}>Open Facility / Utility Inbox</button></div>:null}{isDashboard?<Dashboard',
      "Procurement dashboard content marker",
    );
  }

  // Local preview must describe the local Docker/PostgreSQL runtime accurately.
  source = source.replaceAll("Complete Vercel + Neon operational workflow.", "Complete ProcureFlow operational workflow.");
  source = source.replaceAll("Feature-parity build", "Local parity preview");
  source = source.replaceAll("<li><span>Database</span><b>Neon</b></li>", "<li><span>Database</span><b>Local PostgreSQL</b></li>");
  source = source.replaceAll("<li><span>Application runtime</span><b>Next.js / Vercel</b></li>", "<li><span>Application runtime</span><b>Next.js / Docker</b></li>");
  source = source.replaceAll("<li><span>Document store</span><b>Neon portable</b></li>", "<li><span>Document store</span><b>Local PostgreSQL</b></li>");

  write(path, source);
}

console.log("Local Procurement notification parity applied: assigned-PM routing, inbox badge and dashboard alert enabled.");

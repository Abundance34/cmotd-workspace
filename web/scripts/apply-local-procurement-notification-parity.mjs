import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value, "utf8"); }
function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Notification standardization patch could not find ${label}.`);
  return source.replace(search, replacement);
}

// Load the local-only standardized notification surface styles after the base parity layer.
{
  const path = "/app/app/layout.tsx";
  let source = read(path);
  if (!source.includes('import "./local-standard-notifications.css";')) {
    source = replaceRequired(
      source,
      'import "./local-preview-parity.css";',
      'import "./local-preview-parity.css";\nimport "./local-standard-notifications.css";',
      "local notification stylesheet import",
    );
  }
  write(path, source);
}

// Keep the Facility -> Procurement handoff assigned to the actual Procurement Manager
// and point it at a real sidebar section. Other notifications are normalized at render
// time so stale/legacy section names cannot break indicators or navigation.
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

// Apply one notification experience to Facility, Procurement, Approver, Finance,
// Logistics, Admin and Auditor: bell count, sidebar badge, dashboard alert,
// section notice and role-valid navigation target all use the same standardized list.
{
  const path = "/app/components/complete-role-shell.tsx";
  let source = read(path);

  if (!source.includes('import { StandardNotificationBanner, StandardSectionNotice, standardizeNotifications } from "@/components/standard-notifications";')) {
    const importMarker = 'import { GlobalTools } from "@/components/global-tools";';
    const importLine = 'import { StandardNotificationBanner, StandardSectionNotice, standardizeNotifications } from "@/components/standard-notifications";';
    if (source.includes(importMarker)) {
      source = source.replace(importMarker, `${importMarker}\n${importLine}`);
    } else {
      source = replaceRequired(
        source,
        'import { FacilityDraftForm } from "@/components/facility-draft-form";',
        `${importLine}\nimport { FacilityDraftForm } from "@/components/facility-draft-form";`,
        "notification component import anchor",
      );
    }
  }

  if (!source.includes("const standardNotifications=")) {
    source = replaceRequired(
      source,
      'const [section,setSection]=useState(nav.sections[0]);',
      'const [section,setSection]=useState(nav.sections[0]);const standardNotifications=standardizeNotifications(user.role,parityData.notifications);',
      "role shell notification state",
    );
  }

  // Facility request-level unread dots live inside FacilitySection, where the shell-level
  // standardNotifications variable is intentionally out of scope. Keep the raw list there:
  // request dots key by entity id/type, not by section target, so no routing normalization is needed.

  // Standard sidebar unread badge for every role.
  const rawUnread = 'parityData.notifications.filter((n:any)=>!n.is_read&&String(n.section_target||"")===item).length';
  const procurementUnread = 'parityData.notifications.filter((n:any)=>!n.is_read&&(String(n.section_target||"")===item||(item==="Utility Head / Facility Head Inbox"&&String(n.section_target||"")==="Procurement Review"))).length';
  if (source.includes(procurementUnread)) source = source.replaceAll(procurementUnread, 'standardNotifications.filter((n:any)=>!n.is_read&&String(n.section_target||"")===item).length');
  if (source.includes(rawUnread)) source = source.replaceAll(rawUnread, 'standardNotifications.filter((n:any)=>!n.is_read&&String(n.section_target||"")===item).length');

  // The bell / popover must navigate using the same standardized targets.
  source = source.replaceAll('GlobalTools notifications={parityData.notifications}', 'GlobalTools notifications={standardNotifications}');

  // One visible on-login/dashboard alert style for every role.
  if (!source.includes('<StandardNotificationBanner role={user.role}')) {
    source = replaceRequired(
      source,
      '</div>{isDashboard?<Dashboard',
      '</div>{isDashboard?<StandardNotificationBanner role={user.role} notifications={standardNotifications} onNavigate={navigate}/>:null}{isDashboard?<Dashboard',
      "dashboard notification banner anchor",
    );
  }

  // Every non-dashboard workspace shows its own unread notices above the records/actions.
  if (!source.includes('<StandardSectionNotice role={user.role}')) {
    source = replaceRequired(
      source,
      '<span className="status-pill"><ShieldCheck size={13}/> Connected</span></div>{content}</article>',
      '<span className="status-pill"><ShieldCheck size={13}/> Connected</span></div><StandardSectionNotice role={user.role} section={section} notifications={standardNotifications}/>{content}</article>',
      "section notification notice anchor",
    );
  }

  // Local preview must describe its real runtime, not production Neon/Vercel.
  source = source.replaceAll("Complete Vercel + Neon operational workflow.", "Complete ProcureFlow operational workflow.");
  source = source.replaceAll("Feature-parity build", "Local parity preview");
  source = source.replaceAll("<li><span>Database</span><b>Neon</b></li>", "<li><span>Database</span><b>Local PostgreSQL</b></li>");
  source = source.replaceAll("<li><span>Application runtime</span><b>Next.js / Vercel</b></li>", "<li><span>Application runtime</span><b>Next.js / Docker</b></li>");
  source = source.replaceAll("<li><span>Document store</span><b>Neon portable</b></li>", "<li><span>Document store</span><b>Local PostgreSQL</b></li>");

  write(path, source);
}

console.log("Local notification standardization applied: all seven roles now share bell counts, sidebar indicators, dashboard alerts, section notices and valid role-specific navigation targets.");

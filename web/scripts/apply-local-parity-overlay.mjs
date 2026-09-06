import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value, "utf8"); }
function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Local parity overlay could not find ${label}.`);
  return source.replace(search, replacement);
}

// 1) Load the local-only readability and Facility register styling.
{
  const path = "/app/app/layout.tsx";
  let source = read(path);
  if (!source.includes('import "./local-preview-parity.css";')) {
    source = replaceOnce(
      source,
      'import "./minia-theme-controls.css";',
      'import "./minia-theme-controls.css";\nimport "./local-preview-parity.css";',
      "layout theme import",
    );
  }
  write(path, source);
}

// 2) Restore the original database-backed Department / Project dropdown.
{
  const path = "/app/components/facility-draft-form.tsx";
  let source = read(path);
  source = replaceOnce(source, 'import { useMemo, useState } from "react";', 'import { useEffect, useMemo, useState } from "react";', "Facility React hooks");
  source = replaceOnce(
    source,
    '  const [departmentProject, setDepartmentProject] = useState("");',
    '  const [departmentProject, setDepartmentProject] = useState("");\n  const [departments, setDepartments] = useState<string[]>([]);\n  const [departmentsLoading, setDepartmentsLoading] = useState(true);',
    "Facility department state",
  );
  source = replaceOnce(
    source,
    '  const attachmentBytes = useMemo(() => attachments.reduce((sum, file) => sum + file.size, 0), [attachments]);',
    `  const attachmentBytes = useMemo(() => attachments.reduce((sum, file) => sum + file.size, 0), [attachments]);\n\n  useEffect(() => {\n    let active = true;\n    fetch("/api/facility/reference-data", { cache: "no-store" })\n      .then(async (response) => {\n        const payload = await response.json().catch(() => ({}));\n        if (!response.ok) throw new Error(payload?.error || "Unable to load departments.");\n        return Array.isArray(payload?.departments) ? payload.departments.map(String).filter(Boolean) : [];\n      })\n      .then((options) => {\n        if (!active) return;\n        setDepartments(options);\n        setDepartmentProject((current) => current || (options.includes("General") ? "General" : options[0] || ""));\n      })\n      .catch(() => { if (active) setDepartments([]); })\n      .finally(() => { if (active) setDepartmentsLoading(false); });\n    return () => { active = false; };\n  }, []);`,
    "Facility department loader",
  );
  source = replaceOnce(
    source,
    '    setDepartmentProject(""); setRequiredDate(nextRequiredDate()); setCategory(CATEGORIES[0]); setPriority("Normal");',
    '    setDepartmentProject(departments.includes("General") ? "General" : departments[0] || ""); setRequiredDate(nextRequiredDate()); setCategory(CATEGORIES[0]); setPriority("Normal");',
    "Facility reset department",
  );
  source = replaceOnce(
    source,
    '<label><span>Department / Project *</span><input value={departmentProject} onChange={(e) => setDepartmentProject(e.target.value)} placeholder="e.g. Operations / Jetty Maintenance" maxLength={250} /></label>',
    '<label><span>Department / Project *</span><select value={departmentProject} onChange={(e) => setDepartmentProject(e.target.value)} disabled={departmentsLoading}><option value="" disabled>{departmentsLoading ? "Loading departments…" : "Select department / project"}</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>',
    "Facility Department / Project input",
  );
  source = source.replace('Neon write workflow', 'PostgreSQL write workflow');
  write(path, source);
}

// 3) Restore interactive draft processing from My Draft Requests and add section notification badges.
{
  const path = "/app/components/complete-role-shell.tsx";
  let source = read(path);
  if (!source.includes('import { FacilityRequestRegister } from "@/components/facility-request-register";')) {
    source = replaceOnce(
      source,
      'import { FacilityDraftForm } from "@/components/facility-draft-form";',
      'import { FacilityDraftForm } from "@/components/facility-draft-form";\nimport { FacilityRequestRegister } from "@/components/facility-request-register";',
      "Facility request register import",
    );
  }
  source = replaceOnce(
    source,
    '  if(section==="My Draft Requests")return <GenericRequestTable rows={data?.drafts||[]}/>;',
    '  if(section==="My Draft Requests")return <FacilityRequestRegister rows={data?.drafts||[]} notifications={parityData.notifications} emptyText="No draft requests are waiting for your review."/>;',
    "My Draft Requests register",
  );
  source = replaceOnce(
    source,
    '  if(section==="Returned Requests")return <GenericRequestTable rows={data?.returned||[]}/>;',
    '  if(section==="Returned Requests")return <FacilityRequestRegister rows={data?.returned||[]} notifications={parityData.notifications} emptyText="No returned requests require correction."/>;',
    "Returned Requests register",
  );
  const oldSubmit = '  if(section==="Submit to Procurement Manager"){const rows=[...(data?.drafts||[]),...(data?.returned||[])];return <Stack>{msg?<div className={`action-message ${msg.type}`}>{msg.text}</div>:null}{rows.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td><strong>{r.requestNo}</strong></td><td>{r.departmentProject||"—"}</td><td>{money(r.estimatedAmount)}</td><td><Status value={r.status}/></td><td><button className="row-action-button" disabled={busy===r.id} onClick={()=>void submit(r.id)}>{busy===r.id?"Submitting…":"Submit"}</button></td></tr>)}</tbody></table></div>:<Empty text="No drafts are waiting for submission."/>}</Stack>}';
  const newSubmit = '  if(section==="Submit to Procurement Manager"){const rows=[...(data?.drafts||[]),...(data?.returned||[])];return <FacilityRequestRegister rows={rows} notifications={parityData.notifications} emptyText="No drafts are waiting for submission."/>;}';
  source = replaceOnce(source, oldSubmit, newSubmit, "Submit to Procurement Manager register");

  const oldNav = '<nav className="sidebar-nav">{nav.sections.map(item=><button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}><Circle size={8} fill="currentColor"/><span>{item}</span></button>)}</nav>';
  const newNav = '<nav className="sidebar-nav">{nav.sections.map(item=>{const unreadCount=parityData.notifications.filter((n:any)=>!n.is_read&&String(n.section_target||"")===item).length;return <button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}><Circle size={8} fill="currentColor"/><span>{item}</span>{unreadCount?<span className="sidebar-nav-badge">{unreadCount>99?"99+":unreadCount}</span>:null}</button>})}</nav>';
  source = replaceOnce(source, oldNav, newNav, "sidebar notification badges");
  source = source.replace('Neon-backed production feature with role boundaries, auditable writes and GCP-free runtime dependencies.', 'PostgreSQL-backed feature with role boundaries, auditable writes and GCP-free runtime dependencies.');
  write(path, source);
}

// 4) Broadcast a non-actionable draft-created notification to every other active user.
// The Procurement Manager only receives an actionable review notification after the Facility Head explicitly submits the draft.
{
  const path = "/app/lib/procureflow/facility-draft-actions.ts";
  let source = read(path);
  if (!source.includes("'New Facility draft created'")) {
    const auditorMarker = "        NULL, 'Auditor', 'Audit activity: DRAFT_CREATED',";
    const auditorMarkerIndex = source.indexOf(auditorMarker);
    if (auditorMarkerIndex < 0) throw new Error("Local parity overlay could not find Auditor draft notification marker.");
    const auditorBlockStart = source.lastIndexOf("    await tx`", auditorMarkerIndex);
    if (auditorBlockStart < 0) throw new Error("Local parity overlay could not locate the Auditor notification block start.");

    const broadcast = [
      '    await tx`',
      '      INSERT INTO notifications (',
      '        user_id, role, title, message, entity_type, entity_id,',
      '        is_read, popup_shown, importance, delivery_channel,',
      '        push_sent, email_sent, action_label, section_target, created_at',
      '      )',
      '      SELECT',
      "        u.id, NULL, 'New Facility draft created',",
      '        ${`${reqNo} was created by ${user.fullName}. It remains a draft until the Utility / Facility Head sends it to Procurement Manager.`},',
      "        'Purchase Request', ${requestId}, FALSE, FALSE, 'Normal', 'in_app', FALSE, FALSE,",
      "        'View Draft Activity',",
      '        CASE u.role',
      "          WHEN 'Facility Manager' THEN 'My Draft Requests'",
      "          WHEN 'Procurement Manager' THEN 'Purchase Requests'",
      "          WHEN 'Approver' THEN 'Dashboard'",
      "          WHEN 'Finance' THEN 'Dashboard'",
      "          WHEN 'Logistics Officer' THEN 'Logistics Dashboard'",
      "          WHEN 'Admin' THEN 'All Procurement Records'",
      "          WHEN 'Auditor' THEN 'Audit Dashboard'",
      "          ELSE 'Dashboard'",
      '        END,',
      '        ${now}',
      '      FROM users u',
      '      WHERE u.id <> ${user.id}',
      '        AND COALESCE(u.is_active, TRUE) = TRUE',
      '        AND COALESCE(u.account_locked, FALSE) = FALSE',
      '      ON CONFLICT DO NOTHING',
      '    `;',
    ].join("\n");

    source = source.slice(0, auditorBlockStart) + broadcast + "\n\n" + source.slice(auditorBlockStart);
  }
  write(path, source);
}

console.log("Local ProcureFlow parity overlay applied: readable fonts, Department dropdown, interactive drafts, indicators and draft broadcast notifications.");

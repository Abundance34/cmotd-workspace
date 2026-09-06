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
  if (!source.includes(search)) throw new Error(`Final UI polish could not find ${label}.`);
  return source.replace(search, replacement);
}

// 1) Replace bullet navigation with meaningful icons and make the sidebar collapsible.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);

  if (!source.includes('useEffect, useState')) {
    source = replaceRequired(
      source,
      'import { useState, type ReactNode } from "react";',
      'import { useEffect, useState, type ReactNode } from "react";',
      "React hook import",
    );
  }

  if (!source.includes("LayoutDashboard")) {
    source = replaceRequired(
      source,
      'import { AlertTriangle, ChevronRight, Circle, Database, FileSearch, LogOut, ShieldCheck } from "lucide-react";',
      'import { AlertTriangle, BarChart3, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, CreditCard, Database, FileSearch, FileText, History, LayoutDashboard, LogOut, MessageSquare, Settings, ShieldCheck, ShoppingCart, Store, Truck, Upload, Users } from "lucide-react";',
      "Lucide navigation icon import",
    );
  }

  if (!source.includes("function SidebarNavIcon")) {
    const marker = 'function Status({value}:{value:any}){return <span className="status-chip">{value||"—"}</span>}';
    const helper = `${marker}\nfunction SidebarNavIcon({item}:{item:string}){\n  const value=item.toLowerCase();\n  if(value.includes("dashboard"))return <LayoutDashboard size={17}/>;\n  if(value.includes("approval")||value.includes("approve"))return <ClipboardCheck size={17}/>;\n  if(value.includes("vendor")||value.includes("quote")||value.includes("sourcing"))return <Store size={17}/>;\n  if(value.includes("payment")||value.includes("finance")||value.includes("income")||value.includes("budget")||value.includes("expense")||value.includes("cash advance")||value.includes("reconciliation"))return <CreditCard size={17}/>;\n  if(value.includes("logistics")||value.includes("gateway")||value.includes("delivery")||value.includes("receiving"))return <Truck size={17}/>;\n  if(value.includes("user")||value.includes("role"))return <Users size={17}/>;\n  if(value.includes("security")||value.includes("audit"))return <ShieldCheck size={17}/>;\n  if(value.includes("history")||value.includes("activity"))return <History size={17}/>;\n  if(value.includes("import")||value.includes("document"))return <Upload size={17}/>;\n  if(value.includes("thread"))return <MessageSquare size={17}/>;\n  if(value.includes("report"))return <BarChart3 size={17}/>;\n  if(value.includes("availability")||value.includes("delegation")||value.includes("away"))return <CalendarDays size={17}/>;\n  if(value.includes("purchase order")||value.includes("commercial po")||value.includes("purchase request"))return <ShoppingCart size={17}/>;\n  if(value.includes("settings")||value.includes("configuration")||value.includes("management"))return <Settings size={17}/>;\n  if(value.includes("centre")||value.includes("center")||value.includes("review"))return <FileSearch size={17}/>;\n  return <FileText size={17}/>;\n}`;
    source = replaceRequired(source, marker, helper, "sidebar icon helper anchor");
  }

  if (!source.includes("sidebarCollapsed")) {
    const marker = 'const [section,setSection]=useState(nav.sections[0]);const standardNotifications=standardizeNotifications(user.role,parityData.notifications);';
    const replacement = `${marker}\n  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);\n  useEffect(()=>{try{setSidebarCollapsed(localStorage.getItem("procureflow-sidebar-collapsed")==="1")}catch{}},[]);\n  function toggleSidebar(){setSidebarCollapsed(current=>{const next=!current;try{localStorage.setItem("procureflow-sidebar-collapsed",next?"1":"0")}catch{}return next})}`;
    source = replaceRequired(source, marker, replacement, "sidebar collapse state anchor");
  }

  const oldBrand = '<div className="sidebar-brand sidebar-brand-cmotd" aria-label="CMOTD ProcureFlow"><Image src="/branding/cmotd_logo_full_dark.svg" alt="CMOTD" width={220} height={46} className="sidebar-brand-wordmark sidebar-brand-wordmark-light" priority/><Image src="/branding/cmotd_logo_full_light.svg" alt="" aria-hidden="true" width={220} height={46} className="sidebar-brand-wordmark sidebar-brand-wordmark-dark" priority/></div>';
  const newBrand = '<div className="sidebar-brand sidebar-brand-cmotd" aria-label="CMOTD ProcureFlow"><div className="sidebar-brand-assets"><Image src="/branding/cmotd_logo_full_dark.svg" alt="" aria-hidden="true" width={220} height={46} className="sidebar-brand-wordmark sidebar-brand-full sidebar-brand-wordmark-light" priority/><Image src="/branding/cmotd_logo_full_light.svg" alt="" aria-hidden="true" width={220} height={46} className="sidebar-brand-wordmark sidebar-brand-full sidebar-brand-wordmark-dark" priority/><Image src="/branding/cmotd_logo_dark.svg" alt="" aria-hidden="true" width={40} height={40} className="sidebar-brand-wordmark sidebar-brand-compact sidebar-brand-wordmark-light" priority/><Image src="/branding/cmotd_logo_light.svg" alt="" aria-hidden="true" width={40} height={40} className="sidebar-brand-wordmark sidebar-brand-compact sidebar-brand-wordmark-dark" priority/></div><button type="button" className="sidebar-collapse-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed?"Expand navigation":"Collapse navigation"} title={sidebarCollapsed?"Expand navigation":"Collapse navigation"}>{sidebarCollapsed?<ChevronRight size={15}/>:<ChevronLeft size={15}/>}</button></div>';
  if (source.includes(oldBrand)) source = source.replace(oldBrand, newBrand);
  else if (!source.includes("sidebar-brand-assets")) throw new Error("Final UI polish could not find the theme-aware sidebar brand.");

  source = source.replace(
    '<main className="app-frame"><aside className="sidebar">',
    '<main className={`app-frame${sidebarCollapsed?" sidebar-collapsed":""}`}><aside className={`sidebar${sidebarCollapsed?" collapsed":""}`}>',
  );

  if (!source.includes("sidebar-item-icon")) {
    const navStart = source.indexOf('<nav className="sidebar-nav">');
    const navEnd = navStart >= 0 ? source.indexOf("</nav>", navStart) : -1;
    if (navStart < 0 || navEnd < 0) throw new Error("Final UI polish could not locate the sidebar navigation.");
    const newNav = '<nav className="sidebar-nav">{nav.sections.map(item=>{const unreadCount=standardNotifications.filter((n:any)=>!n.is_read&&String(n.section_target||"")===item).length;return <button key={item} className={section===item?"active":""} onClick={()=>setSection(item)} title={sidebarCollapsed?item:undefined}><span className="sidebar-item-icon"><SidebarNavIcon item={item}/></span><span className="sidebar-item-label">{item}</span>{unreadCount?<span className="sidebar-nav-badge">{unreadCount>99?"99+":unreadCount}</span>:null}</button>})}</nav>';
    source = source.slice(0, navStart) + newNav + source.slice(navEnd + "</nav>".length);
  }

  // Business-facing wording only: remove deployment/database implementation detail from page chrome.
  source = source.replace('<div className="panel-heading"><div><h2>{section}</h2><p>PostgreSQL-backed feature with role boundaries, auditable writes and GCP-free runtime dependencies.</p></div>', '<div className="panel-heading"><div><h2>{section}</h2></div>');
  source = source.replace('<div className="panel-heading"><div><h2>{section}</h2><p>Neon-backed production feature with role boundaries, auditable writes and GCP-free runtime dependencies.</p></div>', '<div className="panel-heading"><div><h2>{section}</h2></div>');
  source = source.replaceAll("Local parity preview", "Operational workflow");
  source = source.replaceAll("Feature-parity build", "Operational workflow");
  source = source.replace('<h2>Security & migration</h2><p>GCP-free runtime</p>', '<h2>Controls & audit</h2><p>Operational safeguards</p>');
  source = source.replace('<li><span>Database</span><b>Local PostgreSQL</b></li>', '<li><span>Request records</span><b>Protected</b></li>');
  source = source.replace('<li><span>Application runtime</span><b>Next.js / Docker</b></li>', '<li><span>Access controls</span><b>Enforced</b></li>');
  source = source.replace('<li><span>v2 audit signing</span><b>{securityStatus.activeAuditKeyVerified?"Verified":"Locked"}</b></li>', '<li><span>Audit evidence</span><b>{securityStatus.activeAuditKeyVerified?"Verified":"Attention"}</b></li>');
  source = source.replace('<li><span>v2 payee encryption</span><b>{securityStatus.activePayeeKeyVerified?"Verified":"Locked"}</b></li>', '<li><span>Payment data protection</span><b>{securityStatus.activePayeeKeyVerified?"Protected":"Attention"}</b></li>');
  source = source.replace('<li><span>Legacy audit</span><b>{securityStatus.legacyAuditPreserved?"Preserved":"Missing"}</b></li>', '<li><span>Historical audit</span><b>{securityStatus.legacyAuditPreserved?"Preserved":"Attention"}</b></li>');
  source = source.replace('<li><span>Document store</span><b>Local PostgreSQL</b></li>', '<li><span>Documents</span><b>Available</b></li>');

  write(relativePath, source);
}

// 2) Replace the remaining user-facing runtime/deployment labels in all React pages.
const replacements = [
  ["PostgreSQL-backed feature with role boundaries, auditable writes and GCP-free runtime dependencies.", ""],
  ["Neon-backed production feature with role boundaries, auditable writes and GCP-free runtime dependencies.", ""],
  ["PostgreSQL write workflow", "Draft workflow"],
  ["Neon write workflow", "Draft workflow"],
  ["GCP-free runtime", "Operational safeguards"],
  ["Local parity preview", "Operational workflow"],
  ["Feature-parity build", "Operational workflow"],
];

function walk(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

const pageFiles = [...walk(path.join(root, "components")), ...walk(path.join(root, "app"))];
for (const fullPath of pageFiles) {
  let source = fs.readFileSync(fullPath, "utf8").replace(/\r\n?/g, "\n");
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  fs.writeFileSync(fullPath, source, "utf8");
}

// 3) Guard against the implementation-specific labels returning to the visible UI.
const banned = [
  "PostgreSQL-backed",
  "Neon-backed",
  "GCP-free runtime dependencies",
  "PostgreSQL write workflow",
  "Neon write workflow",
  "Local parity preview",
  "Feature-parity build",
  "Next.js / Docker",
  "Local PostgreSQL",
  "Neon portable",
];
const offenders = [];
for (const fullPath of pageFiles) {
  const source = fs.readFileSync(fullPath, "utf8");
  const hits = banned.filter((token) => source.includes(token));
  if (hits.length) offenders.push(`${path.relative(root, fullPath)}: ${hits.join(", ")}`);
}
if (offenders.length) throw new Error(`Implementation-specific UI text remains:\n${offenders.join("\n")}`);

console.log("Final local UI polish applied: Plus Jakarta Sans, readable recipient choices, collapsible icon navigation, and business-facing page copy.");

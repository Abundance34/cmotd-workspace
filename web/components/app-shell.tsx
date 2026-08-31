"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Circle, LogOut, Search, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS, ROLES, type ProcureFlowRole } from "@/lib/procureflow/roles";

export type ShellUser = { fullName: string; username?: string; role: ProcureFlowRole };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "PF";
}

function isDashboard(section: string) {
  return section.toLowerCase().includes("dashboard");
}

export function AppShell({ user, preview = false }: { user: ShellUser; preview?: boolean }) {
  const router = useRouter();
  const [previewRole, setPreviewRole] = useState<ProcureFlowRole>(user.role);
  const role = preview ? previewRole : user.role;
  const nav = ROLE_SECTIONS[role];
  const [sectionByRole, setSectionByRole] = useState<Record<string, string>>({});
  const activeSection = sectionByRole[role] || nav.sections[0];
  const displayName = preview ? "Migration Preview" : user.fullName;
  const cards = useMemo(() => [
    ["Pending Review", "Procurement queue"], ["Pending Approval", "Approval queue"],
    ["Awaiting Payment", "Finance queue"], ["Pending Receipt", "Evidence queue"],
  ], []);

  async function logout() {
    if (preview) { router.push("/"); return; }
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div>
        <div className="sidebar-context"><span>{nav.title}</span>{preview ? <select value={role} onChange={(e) => setPreviewRole(e.target.value as ProcureFlowRole)}>{ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select> : <strong>{ROLE_LABELS[role]}</strong>}</div>
        <nav className="sidebar-nav">
          {nav.sections.map((section) => (
            <button key={section} className={activeSection === section ? "active" : ""} onClick={() => setSectionByRole((current) => ({ ...current, [role]: section }))}>
              <Circle size={8} fill="currentColor" /><span>{section}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><button onClick={logout}><LogOut size={16} /><span>{preview ? "Exit preview" : "Sign out"}</span></button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><div className="breadcrumb">ProcureFlow <ChevronRight size={14} /> {activeSection}</div><p>{ROLE_LANDING[role]}</p></div>
          <div className="topbar-actions"><button aria-label="Search"><Search size={18} /></button><button aria-label="Notifications"><Bell size={18} /></button><div className="user-chip"><span className="avatar">{initials(displayName)}</span><div><strong>{displayName}</strong><small>{ROLE_LABELS[role]}</small></div></div></div>
        </header>

        <div className="content-wrap">
          {preview ? <div className="migration-banner"><ShieldCheck size={18} /><div><strong>Next.js migration preview</strong><span>This branch is isolated from production. Live business data is deliberately not connected yet.</span></div></div> : null}
          <div className="page-heading"><div><span className="eyebrow">{ROLE_LABELS[role]}</span><h1>{activeSection}</h1><p>{isDashboard(activeSection) ? "Your operational view of work requiring attention and completed activity." : `ProcureFlow ${activeSection} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark" /></div>

          {isDashboard(activeSection) ? (
            <>
              <div className="metric-grid">{cards.map(([title, caption]) => <article className="metric-card" key={title}><span>{title}</span><strong>—</strong><small>{caption}</small></article>)}</div>
              <div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>Command chain</h2><p>Workflow preserved from the production Streamlit application.</p></div><span className="status-pill">Ported foundation</span></div><div className="chain"><span>Utility / Facility</span><ChevronRight /><span>Procurement</span><ChevronRight /><span>Approval</span><ChevronRight /><span>Finance</span><ChevronRight /><span>Closure</span><ChevronRight /><span>Audit</span></div></article><article className="panel"><div className="panel-heading"><div><h2>Migration status</h2><p>Next.js + Vercel foundation</p></div></div><ul className="status-list"><li><span>UI shell & branding</span><b>Ready</b></li><li><span>Role navigation</span><b>Ready</b></li><li><span>Workflow policy port</span><b>Ready</b></li><li><span>PostgreSQL auth adapter</span><b>Ready for DB</b></li><li><span>Business modules</span><b>In migration</b></li></ul></article></div>
            </>
          ) : (
            <article className="panel section-panel"><div className="section-icon"><ShieldCheck size={22} /></div><div><h2>{activeSection}</h2><p>The navigation, role boundary and page shell for this production section are now represented in Next.js. The next migration commits will replace this shell with the corresponding forms, tables, actions and database queries from the existing Streamlit module.</p><div className="section-tags"><span>Role: {ROLE_LABELS[role]}</span><span>Production section preserved</span><span>No GCP write performed</span></div></div></article>
          )}
        </div>
      </section>
    </main>
  );
}

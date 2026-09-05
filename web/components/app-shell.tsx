"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Circle, LogOut, Search, Send, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS, ROLES, type ProcureFlowRole } from "@/lib/procureflow/roles";
import type { FacilityDashboardData, FacilityRequestRow } from "@/lib/procureflow/facility-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import { FacilityDraftForm } from "@/components/facility-draft-form";

export type ShellUser = { id?: number; fullName: string; username?: string; role: ProcureFlowRole };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "PF";
}

function isDashboard(section: string) {
  return section.toLowerCase().includes("dashboard");
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function RequestTable({
  rows,
  emptyText,
  actionLabel,
  onAction,
  busyId,
}: {
  rows: FacilityRequestRow[];
  emptyText: string;
  actionLabel?: string;
  onAction?: (row: FacilityRequestRow) => void;
  busyId?: number | null;
}) {
  if (!rows.length) return <div className="empty-state">{emptyText}</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Request</th>
            <th>Department / Project</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Required</th>
            {actionLabel ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></td>
              <td>{row.departmentProject || "—"}</td>
              <td>{row.category || "—"}</td>
              <td><span className={`priority priority-${(row.priority || "normal").toLowerCase()}`}>{row.priority || "Normal"}</span></td>
              <td className="amount-cell">{money(row.estimatedAmount)}</td>
              <td><span className="status-chip">{row.status || "—"}</span></td>
              <td>{dateText(row.requiredDate)}</td>
              {actionLabel ? (
                <td>
                  <button
                    className="row-action-button"
                    disabled={busyId === row.id}
                    onClick={() => onAction?.(row)}
                  >
                    <Send size={14} />
                    {busyId === row.id ? "Submitting…" : actionLabel}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FacilitySection({
  section,
  data,
  onSubmit,
  busyId,
  actionMessage,
}: {
  section: string;
  data: FacilityDashboardData;
  onSubmit: (row: FacilityRequestRow) => void;
  busyId: number | null;
  actionMessage: { type: "success" | "error"; text: string } | null;
}) {
  if (section === "Create Request Draft") {
    return <FacilityDraftForm />;
  }

  if (section === "My Draft Requests") {
    return (
      <article className="panel live-section-panel">
        <div className="panel-heading"><div><h2>My Draft Requests</h2><p>Live draft requests loaded from the migrated Neon database.</p></div><span className="status-pill">{data.drafts.length} draft{data.drafts.length === 1 ? "" : "s"}</span></div>
        <RequestTable rows={data.drafts} emptyText="You currently have no draft requests." />
      </article>
    );
  }

  if (section === "Submit to Procurement Manager") {
    const rows = [...data.drafts, ...data.returned];
    return (
      <article className="panel live-section-panel">
        <div className="panel-heading"><div><h2>Requests Ready for Submission</h2><p>Submit FM drafts or corrected requests into the Procurement Manager review queue. The transition writes workflow history, activity, notifications and audit evidence in the same transaction.</p></div><span className="status-pill">Write workflow enabled</span></div>
        {actionMessage ? <div className={`action-message ${actionMessage.type}`}>{actionMessage.text}</div> : null}
        <RequestTable rows={rows} emptyText="There are no drafts waiting for submission." actionLabel="Submit" onAction={onSubmit} busyId={busyId} />
      </article>
    );
  }

  if (section === "Returned Requests") {
    return (
      <article className="panel live-section-panel">
        <div className="panel-heading"><div><h2>Returned Requests</h2><p>Requests returned for correction by downstream workflow participants.</p></div><span className="status-pill">{data.returned.length} returned</span></div>
        <RequestTable rows={data.returned} emptyText="No requests have been returned for correction." />
      </article>
    );
  }

  if (section === "Approved / Accepted Requests") {
    return (
      <article className="panel live-section-panel">
        <div className="panel-heading"><div><h2>Approved / Accepted Requests</h2><p>Approved, purchase-order, paid and completed requests from your migrated history.</p></div><span className="status-pill">{data.approved.length} records</span></div>
        <RequestTable rows={data.approved} emptyText="No approved requests are available." />
      </article>
    );
  }

  if (section === "My Activity History") {
    return (
      <article className="panel live-section-panel">
        <div className="panel-heading"><div><h2>My Recent Request Activity</h2><p>Your latest procurement requests and their current workflow state.</p></div><span className="status-pill">Live Neon data</span></div>
        <RequestTable rows={data.recent} emptyText="No request activity is available." />
      </article>
    );
  }

  return null;
}

export function AppShell({ user, preview = false, facilityData, securityStatus }: { user: ShellUser; preview?: boolean; facilityData?: FacilityDashboardData; securityStatus?: SecurityMigrationStatus }) {
  const router = useRouter();
  const [previewRole, setPreviewRole] = useState<ProcureFlowRole>(user.role);
  const role = preview ? previewRole : user.role;
  const nav = ROLE_SECTIONS[role];
  const [sectionByRole, setSectionByRole] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const activeSection = sectionByRole[role] || nav.sections[0];
  const displayName = preview ? "Migration Preview" : user.fullName;

  const defaultCards = useMemo(() => [
    ["Pending Review", "—", "Procurement queue"],
    ["Pending Approval", "—", "Approval queue"],
    ["Awaiting Payment", "—", "Finance queue"],
    ["Pending Receipt", "—", "Evidence queue"],
  ], []);

  const cards = role === "Facility Manager" && facilityData
    ? [
        ["Pending Review", String(facilityData.metrics.pendingReview), "Procurement queue"],
        ["Pending Approval", String(facilityData.metrics.pendingApproval), "Approval queue"],
        ["Awaiting Payment", String(facilityData.metrics.awaitingPayment), "Finance queue"],
        ["Pending Receipt", String(facilityData.metrics.pendingReceipt), "Evidence queue"],
      ]
    : defaultCards;

  async function logout() {
    if (preview) { router.push("/"); return; }
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function submitRequest(row: FacilityRequestRow) {
    if (!window.confirm(`Submit ${row.requestNo} to the Procurement Manager?`)) return;
    setBusyId(row.id);
    setActionMessage(null);
    try {
      const response = await fetch("/api/facility/requests/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: row.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit request.");
      setActionMessage({ type: "success", text: `${row.requestNo} was submitted to the Procurement Manager successfully.` });
      router.refresh();
    } catch (error) {
      setActionMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit request." });
    } finally {
      setBusyId(null);
    }
  }

  const facilitySection = role === "Facility Manager" && facilityData
    ? <FacilitySection section={activeSection} data={facilityData} onSubmit={submitRequest} busyId={busyId} actionMessage={actionMessage} />
    : null;

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div>
        <div className="sidebar-context"><span>{nav.title}</span>{preview ? <select value={role} onChange={(e) => setPreviewRole(e.target.value as ProcureFlowRole)}>{ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select> : <strong>{ROLE_LABELS[role]}</strong>}</div>
        <nav className="sidebar-nav">
          {nav.sections.map((section) => (
            <button key={section} className={activeSection === section ? "active" : ""} onClick={() => { setActionMessage(null); setSectionByRole((current) => ({ ...current, [role]: section })); }}>
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
              <div className="metric-grid">{cards.map(([title, value, caption]) => <article className="metric-card" key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div>
              <div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>Command chain</h2><p>Workflow preserved from the production Streamlit application.</p></div><span className="status-pill">Ported foundation</span></div><div className="chain"><span>Utility / Facility</span><ChevronRight /><span>Procurement</span><ChevronRight /><span>Approval</span><ChevronRight /><span>Finance</span><ChevronRight /><span>Closure</span><ChevronRight /><span>Audit</span></div>{role === "Facility Manager" && facilityData ? <div className="live-summary"><strong>Live data connected</strong><span>{facilityData.drafts.length} drafts · {facilityData.returned.length} returned · {facilityData.approved.length} approved/processed</span></div> : null}</article><article className="panel"><div className="panel-heading"><div><h2>Migration status</h2><p>Next.js + Vercel + Neon</p></div></div><ul className="status-list"><li><span>UI shell & branding</span><b>Ready</b></li><li><span>Role navigation</span><b>Ready</b></li><li><span>Workflow policy port</span><b>Ready</b></li><li><span>PostgreSQL auth adapter</span><b>Connected</b></li><li><span>Facility read layer</span><b>{role === "Facility Manager" && facilityData ? "Live" : "Queued"}</b></li><li><span>Audit signing key</span><b>{securityStatus?.auditKeyVerified ? "Verified" : securityStatus?.auditKeyConfigured ? "Check failed" : "Missing"}</b></li><li><span>Payee encryption key</span><b>{securityStatus?.payeeKeyVerified ? "Verified" : securityStatus?.payeeKeyConfigured ? "Check failed" : "Missing"}</b></li><li><span>Facility draft creation</span><b>Ported</b></li><li><span>Facility submit workflow</span><b>Ported</b></li></ul></article></div>
            </>
          ) : facilitySection || (
            <article className="panel section-panel"><div className="section-icon"><ShieldCheck size={22} /></div><div><h2>{activeSection}</h2><p>The navigation, role boundary and page shell for this production section are represented in Next.js. This section is next in the migration queue for forms, tables, actions and Neon-backed queries.</p><div className="section-tags"><span>Role: {ROLE_LABELS[role]}</span><span>Production section preserved</span><span>Neon migration active</span></div></div></article>
          )}
        </div>
      </section>
    </main>
  );
}

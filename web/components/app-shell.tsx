"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Circle, LogOut, Search, Send, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, ROLE_LANDING, ROLE_SECTIONS, ROLES, type ProcureFlowRole } from "@/lib/procureflow/roles";
import type { FacilityDashboardData, FacilityRequestRow } from "@/lib/procureflow/facility-data";
import type { ProcurementDashboardData, ProcurementRequestRow } from "@/lib/procureflow/procurement-data";
import type { ApproverDashboardData } from "@/lib/procureflow/approver-data";
import type { FinanceDashboardData } from "@/lib/procureflow/finance-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import { FacilityDraftForm } from "@/components/facility-draft-form";
import { ProcurementInbox } from "@/components/procurement-inbox";
import { ProcurementSourcing } from "@/components/procurement-sourcing";
import { ProcurementRecommendations } from "@/components/procurement-recommendations";
import { ApproverRequests } from "@/components/approver-requests";
import {
  ApproverGatewayApprovals,
  ApproverPaymentApprovals,
  ApproverPOApprovals,
} from "@/components/approver-operational-approvals";
import {
  FinanceApprovedForPayment,
  FinanceBudgets,
  FinancePayments,
  FinanceReceipts,
} from "@/components/finance-workspace";
import { IncomeWorkspace, type IncomeWorkspaceRole } from "@/components/income-workspace";
import { SettingsWorkspace } from "@/components/settings-workspace";

export type ShellUser = { id?: number; fullName: string; username?: string; role: ProcureFlowRole };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "PF";
}

function isDashboard(section: string) {
  return section.toLowerCase().includes("dashboard");
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value || 0);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function RequestTable({ rows, emptyText, actionLabel, onAction, busyId }: {
  rows: FacilityRequestRow[];
  emptyText: string;
  actionLabel?: string;
  onAction?: (row: FacilityRequestRow) => void;
  busyId?: number | null;
}) {
  if (!rows.length) return <div className="empty-state">{emptyText}</div>;
  return (
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Department / Project</th><th>Category</th><th>Priority</th><th>Amount</th><th>Status</th><th>Required</th>{actionLabel ? <th>Action</th> : null}</tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></td><td>{row.departmentProject || "—"}</td><td>{row.category || "—"}</td><td><span className={`priority priority-${(row.priority || "normal").toLowerCase()}`}>{row.priority || "Normal"}</span></td><td className="amount-cell">{money(row.estimatedAmount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{dateText(row.requiredDate)}</td>{actionLabel ? <td><button className="row-action-button" disabled={busyId === row.id} onClick={() => onAction?.(row)}><Send size={14} />{busyId === row.id ? "Submitting…" : actionLabel}</button></td> : null}</tr>)}
    </tbody></table></div>
  );
}

function ProcurementTable({ rows, emptyText }: { rows: ProcurementRequestRow[]; emptyText: string }) {
  if (!rows.length) return <div className="empty-state">{emptyText}</div>;
  return (
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Utility / Facility Head</th><th>Department / Project</th><th>Category</th><th>Priority</th><th>Amount</th><th>Status</th><th>Required</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><strong>{row.requestNo}</strong><small>{dateText(row.requestDate)}</small></td><td>{row.facilityManager || "—"}</td><td>{row.departmentProject || "—"}</td><td>{row.category || "—"}</td><td><span className={`priority priority-${(row.priority || "normal").toLowerCase()}`}>{row.priority || "Normal"}</span></td><td className="amount-cell">{money(row.estimatedAmount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{dateText(row.requiredDate)}</td></tr>)}
    </tbody></table></div>
  );
}

function FacilitySection({ section, data, onSubmit, busyId, actionMessage }: {
  section: string;
  data: FacilityDashboardData;
  onSubmit: (row: FacilityRequestRow) => void;
  busyId: number | null;
  actionMessage: { type: "success" | "error"; text: string } | null;
}) {
  if (section === "Create Request Draft") return <FacilityDraftForm />;
  if (section === "My Draft Requests") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>My Draft Requests</h2><p>Live draft requests loaded from the migrated Neon database.</p></div><span className="status-pill">{data.drafts.length} draft{data.drafts.length === 1 ? "" : "s"}</span></div><RequestTable rows={data.drafts} emptyText="You currently have no draft requests." /></article>;
  if (section === "Submit to Procurement Manager") {
    const rows = [...data.drafts, ...data.returned];
    return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Requests Ready for Submission</h2><p>Submit FM drafts or corrected requests into the Procurement Manager review queue.</p></div><span className="status-pill">Write workflow enabled</span></div>{actionMessage ? <div className={`action-message ${actionMessage.type}`}>{actionMessage.text}</div> : null}<RequestTable rows={rows} emptyText="There are no drafts waiting for submission." actionLabel="Submit" onAction={onSubmit} busyId={busyId} /></article>;
  }
  if (section === "Returned Requests") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Returned Requests</h2><p>Requests returned for correction by downstream workflow participants.</p></div><span className="status-pill">{data.returned.length} returned</span></div><RequestTable rows={data.returned} emptyText="No requests have been returned for correction." /></article>;
  if (section === "Approved / Accepted Requests") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Approved / Accepted Requests</h2><p>Approved, purchase-order, paid and completed requests from your migrated history.</p></div><span className="status-pill">{data.approved.length} records</span></div><RequestTable rows={data.approved} emptyText="No approved requests are available." /></article>;
  if (section === "My Activity History") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>My Recent Request Activity</h2><p>Your latest procurement requests and their current workflow state.</p></div><span className="status-pill">Live Neon data</span></div><RequestTable rows={data.recent} emptyText="No request activity is available." /></article>;
  return null;
}

function ProcurementSection({ section, data }: { section: string; data: ProcurementDashboardData }) {
  if (section === "Utility Head / Facility Head Inbox") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Utility Head / Facility Head Inbox</h2><p>Requests routed from Utility / Facility Heads. Review, return for correction, start sourcing, or submit valid requests to Approver / MD.</p></div><span className="status-pill">{data.inbox.length} awaiting review</span></div><ProcurementInbox rows={data.inbox} /></article>;
  if (section === "Purchase Requests") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Purchase Requests</h2><p>Live procurement request register from Neon.</p></div><span className="status-pill">{data.requests.length} loaded</span></div><ProcurementTable rows={data.requests} emptyText="No procurement requests are available." /></article>;
  if (section === "Sourcing") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Sourcing & Vendor Quote Collection</h2><p>Create and compare vendor quotes against live Neon sourcing tasks.</p></div><span className="status-pill">{data.sourcingTasks.length} active task{data.sourcingTasks.length === 1 ? "" : "s"}</span></div><ProcurementSourcing tasks={data.sourcingTasks} vendors={data.vendors} /></article>;
  if (section === "Vendor Quotes") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Vendor Quotes</h2><p>Vendor quote collection remains synchronized with the Sourcing workspace so each supplier retains its own price and commercial terms.</p></div><span className="status-pill">Live Neon data</span></div><ProcurementSourcing tasks={data.sourcingTasks} vendors={data.vendors} /></article>;
  if (section === "Vendor Recommendation") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Vendor Recommendation</h2><p>Review the weighted supplier recommendation and route it to the correct approval authority.</p></div><span className="status-pill">{data.metrics.vendorRecommendation} pending</span></div><ProcurementRecommendations tasks={data.sourcingTasks} approvalLimit={data.approvalLimit} /></article>;
  if (section === "My Activity History") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Recent Procurement Pipeline</h2><p>Latest requests visible to the Procurement Manager and their current states.</p></div><span className="status-pill">Live Neon data</span></div><ProcurementTable rows={data.requests.slice(0, 50)} emptyText="No procurement activity is available." /></article>;
  return null;
}

function ApprovalHistory({ data }: { data: ApproverDashboardData }) {
  if (!data.history.length) return <div className="empty-state">No approval decisions are recorded for this Approver account yet.</div>;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Entity</th><th>Action</th><th>Before</th><th>After</th><th>Approval mode</th><th>Note</th></tr></thead><tbody>{data.history.map((row) => <tr key={row.id}><td>{dateText(row.createdAt)}</td><td><strong>{row.entityType}</strong><small>#{row.entityId}</small></td><td>{row.action}</td><td>{row.statusBefore || "—"}</td><td><span className="status-chip">{row.statusAfter || "—"}</span></td><td>{row.approvalMode || "—"}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div>;
}

function ApproverSection({ section, data }: { section: string; data: ApproverDashboardData }) {
  if (section === "Pending Approvals") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Pending Approvals</h2><p>Approver / MD decides requests above the configured Procurement Manager limit and independently decides Procurement Manager-created requests.</p></div><span className="status-pill">{data.pendingRequests.length} pending</span></div><ApproverRequests rows={data.pendingRequests} approvalLimit={data.approvalLimit} /></article>;
  if (section === "Quote Comparison") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Quote Comparison</h2><p>Review Procurement&apos;s recommended vendor against every captured supplier quote before making the final decision.</p></div><span className="status-pill">{data.quoteComparisons.length} comparison{data.quoteComparisons.length === 1 ? "" : "s"}</span></div><ApproverRequests rows={data.quoteComparisons} approvalLimit={data.approvalLimit} mode="quotes" /></article>;
  if (section === "PO Approval") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>PO Approval</h2><p>Approve or reject purchase orders above the configured Procurement Manager approval limit. Approved POs return to Procurement for commercial release.</p></div><span className="status-pill">{data.pendingPOs.length} pending</span></div><ApproverPOApprovals rows={data.pendingPOs} approvalLimit={data.approvalLimit} /></article>;
  if (section === "Payment Approval") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Payment Approval</h2><p>Authorize high-value payment requests without executing the payment. Approved requests route to Finance for payment processing and evidence.</p></div><span className="status-pill">{data.pendingPayments.length} pending</span></div><ApproverPaymentApprovals rows={data.pendingPayments} approvalLimit={data.approvalLimit} /></article>;
  if (section === "Gateway Pass Approval") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Gateway Pass Approval</h2><p>Final authorization after Procurement Manager review. Approved passes return to the Utility / Facility Head for preview, generation and download.</p></div><span className="status-pill">{data.pendingGatewayPasses.length} pending</span></div><ApproverGatewayApprovals rows={data.pendingGatewayPasses} /></article>;
  if (section === "My Approval History") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>My Approval History</h2><p>Auditable history of decisions recorded against this Approver account.</p></div><span className="status-pill">{data.history.length} records</span></div><ApprovalHistory data={data} /></article>;
  return null;
}

function FinanceSection({ section, data }: { section: string; data: FinanceDashboardData }) {
  if (section === "Approved for Payment") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Approved for Payment</h2><p>Approved procurement items route here automatically. Finance verifies the linked payee, then records payment without manually re-entering bank details.</p></div><span className="status-pill">{data.readyForPayment.length} awaiting payment</span></div><FinanceApprovedForPayment rows={data.readyForPayment} /></article>;
  if (section === "Payments") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Payments</h2><p>Live Finance payment ledger, including migrated payment history and newly recorded transactions.</p></div><span className="status-pill">{data.payments.length} records</span></div><FinancePayments rows={data.payments} /></article>;
  if (section === "Receipts") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Receipts</h2><p>Existing receipt and evidence metadata migrated to Neon. Sensitive raw bank-account fields are excluded from this table.</p></div><span className="status-pill">{data.receipts.length} records</span></div><FinanceReceipts rows={data.receipts} /></article>;
  if (section === "Budgets") return <article className="panel live-section-panel"><div className="panel-heading"><div><h2>Budgets</h2><p>Configured monthly budget controls migrated from the production database.</p></div><span className="status-pill">{data.budgets.length} budgets</span></div><FinanceBudgets rows={data.budgets} /></article>;
  return null;
}

export function AppShell({ user, preview = false, facilityData, procurementData, approverData, financeData, securityStatus }: {
  user: ShellUser;
  preview?: boolean;
  facilityData?: FacilityDashboardData;
  procurementData?: ProcurementDashboardData;
  approverData?: ApproverDashboardData;
  financeData?: FinanceDashboardData;
  securityStatus?: SecurityMigrationStatus;
}) {
  const router = useRouter();
  const [previewRole, setPreviewRole] = useState<ProcureFlowRole>(user.role);
  const role = preview ? previewRole : user.role;
  const nav = ROLE_SECTIONS[role];
  const [sectionByRole, setSectionByRole] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const activeSection = sectionByRole[role] || nav.sections[0];
  const displayName = preview ? "Migration Preview" : user.fullName;

  const defaultCards = useMemo(() => [["Pending Review", "—", "Procurement queue"], ["Pending Approval", "—", "Approval queue"], ["Awaiting Payment", "—", "Finance queue"], ["Pending Receipt", "—", "Evidence queue"]], []);
  const cards = role === "Facility Manager" && facilityData
    ? [["Pending Review", String(facilityData.metrics.pendingReview), "Procurement queue"], ["Pending Approval", String(facilityData.metrics.pendingApproval), "Approval queue"], ["Awaiting Payment", String(facilityData.metrics.awaitingPayment), "Finance queue"], ["Pending Receipt", String(facilityData.metrics.pendingReceipt), "Evidence queue"]]
    : role === "Procurement Manager" && procurementData
      ? [["Pending Review", String(procurementData.metrics.pendingReview), "Facility / request queue"], ["Requires Sourcing", String(procurementData.metrics.requiresSourcing), "Supplier comparison"], ["Vendor Recommendation", String(procurementData.metrics.vendorRecommendation), "Recommendation queue"], ["Approved / Processed", String(procurementData.metrics.approvedProcessed), "Downstream pipeline"]]
      : role === "Approver" && approverData
        ? [["Pending Requests", String(approverData.metrics.pendingRequests), "Executive decision queue"], ["PO Approvals", String(approverData.metrics.pendingPOs), "Purchase order queue"], ["Payment Approvals", String(approverData.metrics.pendingPayments), "Payment queue"], ["Gateway Approvals", String(approverData.metrics.pendingGatewayPasses), "Movement authorization queue"]]
        : role === "Finance" && financeData
          ? [["Awaiting Payment", String(financeData.metrics.awaitingPayment), "Approved payment queue"], ["Pending Receipt", String(financeData.metrics.pendingReceipt), "Evidence queue"], ["Total Paid", String(financeData.metrics.totalPaid), "Cumulative"], ["Completed", String(financeData.metrics.completed), "Cumulative"]]
          : defaultCards;

  async function logout() {
    if (preview) { router.push("/"); return; }
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/"); router.refresh();
  }

  async function submitRequest(row: FacilityRequestRow) {
    if (!window.confirm(`Submit ${row.requestNo} to the Procurement Manager?`)) return;
    setBusyId(row.id); setActionMessage(null);
    try {
      const response = await fetch("/api/facility/requests/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: row.id }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to submit request.");
      setActionMessage({ type: "success", text: `${row.requestNo} was submitted to the Procurement Manager successfully.` });
      router.refresh();
    } catch (error) { setActionMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to submit request." }); }
    finally { setBusyId(null); }
  }

  const incomeSection = !preview && activeSection === "Income" && role !== "Logistics Officer" ? <IncomeWorkspace role={role as IncomeWorkspaceRole} /> : null;
  const settingsSection = !preview && activeSection === "Settings" ? <SettingsWorkspace username={user.username || ""} fullName={user.fullName} role={role} /> : null;
  const facilitySection = role === "Facility Manager" && facilityData ? <FacilitySection section={activeSection} data={facilityData} onSubmit={submitRequest} busyId={busyId} actionMessage={actionMessage} /> : null;
  const procurementSection = role === "Procurement Manager" && procurementData ? <ProcurementSection section={activeSection} data={procurementData} /> : null;
  const approverSection = role === "Approver" && approverData ? <ApproverSection section={activeSection} data={approverData} /> : null;
  const financeSection = role === "Finance" && financeData ? <FinanceSection section={activeSection} data={financeData} /> : null;
  const liveSummary = role === "Facility Manager" && facilityData ? `${facilityData.drafts.length} drafts · ${facilityData.returned.length} returned · ${facilityData.approved.length} approved/processed` : role === "Procurement Manager" && procurementData ? `${procurementData.inbox.length} awaiting review · ${procurementData.metrics.activeVendors} active vendors · ${procurementData.metrics.gatewayWaiting} gateway passes waiting` : role === "Approver" && approverData ? `${approverData.metrics.pendingRequests} pending requests · ${approverData.metrics.pendingPOs} POs · ${approverData.metrics.pendingPayments} payments · ${approverData.metrics.pendingGatewayPasses} gateway passes` : role === "Finance" && financeData ? `${financeData.metrics.awaitingPayment} awaiting payment · ${financeData.metrics.pendingReceipt} pending receipts · ${financeData.metrics.totalPaid} paid records` : null;

  return <main className="app-frame"><aside className="sidebar"><div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div><div className="sidebar-context"><span>{nav.title}</span>{preview ? <select value={role} onChange={(e) => setPreviewRole(e.target.value as ProcureFlowRole)}>{ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select> : <strong>{ROLE_LABELS[role]}</strong>}</div><nav className="sidebar-nav">{nav.sections.map((section) => <button key={section} className={activeSection === section ? "active" : ""} onClick={() => { setActionMessage(null); setSectionByRole((current) => ({ ...current, [role]: section })); }}><Circle size={8} fill="currentColor" /><span>{section}</span></button>)}</nav><div className="sidebar-footer"><button onClick={logout}><LogOut size={16} /><span>{preview ? "Exit preview" : "Sign out"}</span></button></div></aside><section className="workspace"><header className="topbar"><div><div className="breadcrumb">ProcureFlow <ChevronRight size={14} /> {activeSection}</div><p>{ROLE_LANDING[role]}</p></div><div className="topbar-actions"><button aria-label="Search"><Search size={18} /></button><button aria-label="Notifications"><Bell size={18} /></button><div className="user-chip"><span className="avatar">{initials(displayName)}</span><div><strong>{displayName}</strong><small>{ROLE_LABELS[role]}</small></div></div></div></header><div className="content-wrap">{preview ? <div className="migration-banner"><ShieldCheck size={18} /><div><strong>Next.js migration preview</strong><span>This branch is isolated from production. Live business data is deliberately not connected yet.</span></div></div> : null}<div className="page-heading"><div><span className="eyebrow">{ROLE_LABELS[role]}</span><h1>{activeSection}</h1><p>{isDashboard(activeSection) ? "Your operational view of work requiring attention and completed activity." : `ProcureFlow ${activeSection} workspace.`}</p></div><Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark" /></div>{isDashboard(activeSection) ? <><div className="metric-grid">{cards.map(([title, value, caption]) => <article className="metric-card" key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div><div className="dashboard-grid"><article className="panel panel-large"><div className="panel-heading"><div><h2>Command chain</h2><p>Workflow preserved from the production Streamlit application.</p></div><span className="status-pill">Ported foundation</span></div><div className="chain"><span>Utility / Facility</span><ChevronRight /><span>Procurement</span><ChevronRight /><span>Approval</span><ChevronRight /><span>Finance</span><ChevronRight /><span>Closure</span><ChevronRight /><span>Audit</span></div>{liveSummary ? <div className="live-summary"><strong>Live data connected</strong><span>{liveSummary}</span></div> : null}</article><article className="panel"><div className="panel-heading"><div><h2>Migration status</h2><p>Next.js + Vercel + Neon</p></div></div><ul className="status-list"><li><span>UI shell & branding</span><b>Ready</b></li><li><span>Role navigation</span><b>Ready</b></li><li><span>PostgreSQL auth adapter</span><b>Connected</b></li><li><span>Facility workflow</span><b>Ported</b></li><li><span>Procurement review</span><b>Ported</b></li><li><span>Sourcing & vendor quotes</span><b>Ported</b></li><li><span>Vendor recommendation</span><b>Ported</b></li><li><span>Approver request decisions</span><b>{role === "Approver" && approverData ? "Live" : "Ported"}</b></li><li><span>Approver PO / payment / gateway</span><b>{role === "Approver" && approverData ? "Live" : "Ported"}</b></li><li><span>Finance payment core</span><b>{role === "Finance" && financeData ? "Live" : "Ported"}</b></li><li><span>Audit signing key</span><b>{securityStatus?.auditKeyVerified ? "Verified" : securityStatus?.auditKeyConfigured ? "Check failed" : "Missing"}</b></li><li><span>Payee encryption key</span><b>{securityStatus?.payeeKeyVerified ? "Verified" : securityStatus?.payeeKeyConfigured ? "Check failed" : "Missing"}</b></li></ul></article></div></> : incomeSection || settingsSection || facilitySection || procurementSection || approverSection || financeSection || <article className="panel section-panel"><div className="section-icon"><ShieldCheck size={22} /></div><div><h2>{activeSection}</h2><p>The navigation, role boundary and page shell for this production section are represented in Next.js. This section is next in the migration queue for forms, tables, actions and Neon-backed queries.</p><div className="section-tags"><span>Role: {ROLE_LABELS[role]}</span><span>Production section preserved</span><span>Neon migration active</span></div></div></article>}</div></section></main>;
}

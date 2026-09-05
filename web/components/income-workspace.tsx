"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, RefreshCw, TrendingUp } from "lucide-react";

export type IncomeWorkspaceRole = "Admin" | "Procurement Manager" | "Facility Manager" | "Finance" | "Approver" | "Auditor";

type IncomeResponse = {
  period: { month: number; year: number; monthKey: string; department: string; project: string };
  canManage: boolean;
  formula: string;
  summary: {
    totalIncome: number;
    approvedUnpaidCommitments: number;
    pendingCommitments: number;
    paidExpenses: number;
    remainingBalance: number;
  };
  entries: Array<{
    id: number;
    entryNo: string | null;
    entryDate: string;
    monthKey: string;
    department: string | null;
    project: string | null;
    source: string | null;
    entryType: string | null;
    amount: number;
    notes: string | null;
    status: string | null;
    createdAt: string;
    createdBy: string | null;
  }>;
  trend: Array<{ monthKey: string; amount: number }>;
  departments: string[];
};

type Feedback = { kind: "success" | "error"; text: string } | null;

const ENTRY_TYPES = [
  "Opening income / budget allocation",
  "Additional income",
  "Adjustment",
  "Other",
];

function localDateInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function monthName(month: number) {
  return new Intl.DateTimeFormat("en-NG", { month: "long" }).format(new Date(2026, month - 1, 1));
}

export function IncomeWorkspace({ role }: { role: IncomeWorkspaceRole }) {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [department, setDepartment] = useState("All");
  const [project, setProject] = useState("");
  const [data, setData] = useState<IncomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const [entryDate, setEntryDate] = useState(localDateInputValue());
  const [entryDepartment, setEntryDepartment] = useState("General");
  const [entryProject, setEntryProject] = useState("General");
  const [entryType, setEntryType] = useState(ENTRY_TYPES[0]);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState(ENTRY_TYPES[0]);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year), department });
      if (project.trim()) params.set("project", project.trim());
      const response = await fetch(`/api/income?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to load income data.");
      setData(body as IncomeResponse);
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to load income data." });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [department, month, project, year]);

  useEffect(() => { void load(); }, [load]);

  async function submitIncome() {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate,
          department: entryDepartment,
          project: entryProject,
          entryType,
          amount,
          source,
          notes,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to save income entry.");
      setFeedback({ kind: "success", text: `${body?.result?.entryNo || "Income entry"} was saved and added to the signed audit trail.` });
      const savedDate = new Date(`${entryDate}T00:00:00`);
      if (!Number.isNaN(savedDate.getTime())) {
        setMonth(savedDate.getMonth() + 1);
        setYear(savedDate.getFullYear());
        setDepartment("All");
        setProject("");
      }
      setAmount("");
      setNotes("");
      await load();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to save income entry." });
    } finally {
      setBusy(false);
    }
  }

  const maxTrend = Math.max(1, ...(data?.trend.map((row) => row.amount) || [1]));
  const canSubmit = Boolean(data?.canManage && entryDate && entryDepartment.trim() && entryProject.trim() && entryType && source.trim() && amount.trim() && !busy);

  return (
    <article className="panel live-section-panel income-workspace">
      <div className="panel-heading">
        <div>
          <h2>Income & Budget Allocation</h2>
          <p>Shared financial-capacity view across the procurement command chain. Only Admin and Finance with the manage_income permission can add entries.</p>
        </div>
        <span className="status-pill"><Banknote size={13} /> Neon ledger</span>
      </div>

      <div className="income-filter-row">
        <label><span>Month</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{monthName(value)}</option>)}</select></label>
        <label><span>Year</span><input type="number" min={2000} max={2200} value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label><span>Department / Project scope</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="All">All</option>{data?.departments.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Project contains</span><input value={project} onChange={(event) => setProject(event.target.value)} placeholder="Optional project filter" /></label>
        <button type="button" className="income-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {feedback ? <div className={`action-message ${feedback.kind}`}>{feedback.text}</div> : null}

      {loading && !data ? <div className="empty-state">Loading income ledger…</div> : null}

      {data ? <>
        <div className="income-formula"><TrendingUp size={16} /><span>{data.formula}</span><b>{data.period.monthKey}</b></div>
        <div className="income-metric-grid">
          <article><span>Total Income / Allocation</span><strong>{money(data.summary.totalIncome)}</strong><small>Active entries in selected period</small></article>
          <article><span>Approved Unpaid</span><strong>{money(data.summary.approvedUnpaidCommitments)}</strong><small>Approved commitments awaiting payment</small></article>
          <article><span>Pending Commitments</span><strong>{money(data.summary.pendingCommitments)}</strong><small>Review and approval pipeline</small></article>
          <article><span>Paid Expenses</span><strong>{money(data.summary.paidExpenses)}</strong><small>Paid transactions in selected month</small></article>
          <article className={data.summary.remainingBalance < 0 ? "negative" : "positive"}><span>Remaining Balance</span><strong>{money(data.summary.remainingBalance)}</strong><small>Income less paid and approved unpaid</small></article>
        </div>

        <div className="income-layout-grid">
          <section className="income-subpanel">
            <div className="income-subhead"><div><strong>Income trend</strong><span>Last 12 active income periods</span></div></div>
            {data.trend.length ? <div className="income-trend-list">{data.trend.map((row) => <div className="income-trend-row" key={row.monthKey}><span>{row.monthKey}</span><div><i style={{ width: `${Math.max(2, (row.amount / maxTrend) * 100)}%` }} /></div><strong>{money(row.amount)}</strong></div>)}</div> : <div className="empty-state">No active income trend is available yet.</div>}
          </section>

          <section className="income-subpanel">
            <div className="income-subhead"><div><strong>Authority</strong><span>Current access for {role}</span></div></div>
            <div className={`income-authority ${data.canManage ? "manage" : "read"}`}>
              <CheckCircle2 size={18} />
              <div><strong>{data.canManage ? "Income management enabled" : "Read-only income access"}</strong><span>{data.canManage ? "You may add an income / budget-allocation entry. Every write is signed with the active v2 audit key." : "You can review financial capacity and commitments but cannot alter the income ledger."}</span></div>
            </div>
          </section>
        </div>

        {data.canManage ? <section className="income-entry-form">
          <div className="income-subhead"><div><strong>Add Income / Budget Allocation</strong><span>Matches the production Income workflow while using Neon and the v2 audit chain.</span></div></div>
          <div className="income-entry-grid">
            <label><span>Entry date</span><input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
            <label><span>Department</span><input value={entryDepartment} onChange={(event) => setEntryDepartment(event.target.value)} placeholder="General" /></label>
            <label><span>Project</span><input value={entryProject} onChange={(event) => setEntryProject(event.target.value)} placeholder="General" /></label>
            <label><span>Entry type</span><select value={entryType} onChange={(event) => { setEntryType(event.target.value); if (!source.trim() || ENTRY_TYPES.includes(source)) setSource(event.target.value); }}>{ENTRY_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Amount (NGN)</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
            <label><span>Source</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Income source" /></label>
          </div>
          <label className="income-notes"><span>Notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional context, authorization reference, or allocation note." /></label>
          <div className="income-submit-row"><button type="button" disabled={!canSubmit} onClick={() => void submitIncome()}>{busy ? "Saving…" : "Save Income Entry"}</button><small>The entry is written transactionally to income_entries, activity history, audit logs and the signed v2 audit ledger.</small></div>
        </section> : null}

        <section className="income-entry-register">
          <div className="income-subhead"><div><strong>Income Entry Register</strong><span>{data.entries.length} record{data.entries.length === 1 ? "" : "s"} for the selected filter</span></div></div>
          {data.entries.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Entry</th><th>Date</th><th>Department / Project</th><th>Type / Source</th><th>Amount</th><th>Status</th><th>Created by</th><th>Notes</th></tr></thead><tbody>{data.entries.map((row) => <tr key={row.id}><td><strong>{row.entryNo || `Income #${row.id}`}</strong><small>{row.monthKey}</small></td><td>{shortDate(row.entryDate)}</td><td>{row.department || "—"}<small>{row.project || ""}</small></td><td>{row.entryType || "—"}<small>{row.source || ""}</small></td><td className="amount-cell">{money(row.amount)}</td><td><span className="status-chip">{row.status || "—"}</span></td><td>{row.createdBy || "—"}</td><td>{row.notes || "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state">No income entries match the selected period and scope.</div>}
        </section>
      </> : null}
    </article>
  );
}

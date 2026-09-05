import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

const INCOME_VISIBLE_ROLES = new Set([
  "Admin",
  "Procurement Manager",
  "Facility Manager",
  "Finance",
  "Approver",
  "Auditor",
]);

const INCOME_MANAGE_ROLES = new Set(["Admin", "Finance"]);

export type IncomeFilters = {
  month: number;
  year: number;
  department?: string;
  project?: string;
};

export type IncomeEntryInput = {
  entryDate: string;
  department: string;
  project: string;
  source: string;
  entryType: string;
  amount: number | string;
  notes?: string;
};

function assertIncomeVisible(user: CurrentUser) {
  if (!INCOME_VISIBLE_ROLES.has(user.role)) {
    throw new Error("Income workspace is not available to this role.");
  }
}

function normalizeMonth(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error("Choose a valid month.");
  return value;
}

function normalizeYear(value: number) {
  if (!Number.isInteger(value) || value < 2000 || value > 2200) throw new Error("Choose a valid year.");
  return value;
}

function normalizeDate(value: string) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Choose a valid income entry date.");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("Choose a valid income entry date.");
  }
  return text;
}

function normalizeText(value: string, field: string, fallback?: string) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text && fallback != null) return fallback;
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > 250) throw new Error(`${field} is too long.`);
  return text;
}

function normalizeAmount(value: number | string) {
  const clean = String(value ?? "").trim().replace(/[₦,\s]/g, "");
  if (!/^\d+(?:\.\d{1,4})?$/.test(clean)) throw new Error("Amount must be a valid non-negative monetary value.");
  const amount = Number(clean);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be a valid non-negative monetary value.");
  return clean;
}

function entryReference(entryDate: string) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `INC-${entryDate.replaceAll("-", "")}-${stamp.slice(8)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function hasIncomeManagePermission(sql: ReturnType<typeof db>, user: CurrentUser) {
  if (!INCOME_MANAGE_ROLES.has(user.role)) return false;
  const rows = await sql<{ allowed: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM role_permissions
      WHERE role_name=${user.role} AND permission_name='manage_income'
    ) AS allowed
  `;
  return Boolean(rows[0]?.allowed);
}

export async function getIncomeWorkspace(user: CurrentUser, filters: IncomeFilters) {
  assertIncomeVisible(user);
  const month = normalizeMonth(Number(filters.month));
  const year = normalizeYear(Number(filters.year));
  const monthKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const department = String(filters.department || "All").trim() || "All";
  const project = String(filters.project || "").trim();
  const allDepartments = department === "All";
  const anyProject = project.length === 0;
  const projectLike = `%${project}%`;
  const sql = db();

  const [incomeRows, approvedRows, pendingRows, paidRows, entries, trend, departments, permission] = await Promise.all([
    sql<{ amount: string | number }[]>`
      SELECT COALESCE(SUM(amount),0) amount
      FROM income_entries
      WHERE month_key=${monthKey}
        AND status='Active'
        AND (${allDepartments}::boolean OR department=${department})
        AND (${anyProject}::boolean OR project ILIKE ${projectLike})
    `,
    sql<{ amount: string | number }[]>`
      SELECT COALESCE(SUM(estimated_amount),0) amount
      FROM purchase_requests
      WHERE to_char(COALESCE(approved_at,updated_at,created_at),'YYYY-MM')=${monthKey}
        AND (${allDepartments}::boolean OR department_project=${department})
        AND (${anyProject}::boolean OR department_project ILIKE ${projectLike})
        AND status IN ('Approved','Awaiting Payment','Approved for Payment')
    `,
    sql<{ amount: string | number }[]>`
      SELECT COALESCE(SUM(estimated_amount),0) amount
      FROM purchase_requests
      WHERE to_char(COALESCE(approved_at,updated_at,created_at),'YYYY-MM')=${monthKey}
        AND (${allDepartments}::boolean OR department_project=${department})
        AND (${anyProject}::boolean OR department_project ILIKE ${projectLike})
        AND status IN ('Sent for Procurement Review','Submitted for Approval','Pending Approver/MD Approval','Pending Approval')
    `,
    sql<{ amount: string | number }[]>`
      SELECT COALESCE(SUM(amount),0) amount
      FROM payments
      WHERE status='Paid'
        AND to_char(COALESCE(payment_date::timestamp,created_at),'YYYY-MM')=${monthKey}
    `,
    sql<{
      id:number;entry_no:string|null;entry_date:string;month_key:string;department:string|null;project:string|null;
      source:string|null;entry_type:string|null;amount:string|number;notes:string|null;status:string|null;
      created_at:string;created_by:number|null;created_by_name:string|null;
    }[]>`
      SELECT ie.id,ie.entry_no,ie.entry_date::text,ie.month_key,ie.department,ie.project,ie.source,ie.entry_type,
             ie.amount,ie.notes,ie.status,ie.created_at,ie.created_by,u.full_name created_by_name
      FROM income_entries ie
      LEFT JOIN users u ON u.id=ie.created_by
      WHERE ie.month_key=${monthKey}
        AND (${allDepartments}::boolean OR ie.department=${department})
        AND (${anyProject}::boolean OR ie.project ILIKE ${projectLike})
      ORDER BY ie.entry_date DESC,ie.created_at DESC,ie.id DESC
      LIMIT 500
    `,
    sql<{ month_key:string;amount:string|number }[]>`
      SELECT month_key,COALESCE(SUM(amount),0) amount
      FROM income_entries
      WHERE status='Active'
      GROUP BY month_key
      ORDER BY month_key DESC
      LIMIT 12
    `,
    sql<{ department:string }[]>`
      SELECT department FROM (
        SELECT DISTINCT TRIM(department) department
        FROM income_entries
        WHERE department IS NOT NULL AND TRIM(department)<>''
        UNION
        SELECT DISTINCT TRIM(department_project) department
        FROM purchase_requests
        WHERE department_project IS NOT NULL AND TRIM(department_project)<>''
      ) d
      ORDER BY department
      LIMIT 200
    `,
    hasIncomeManagePermission(sql, user),
  ]);

  const totalIncome = Number(incomeRows[0]?.amount || 0);
  const approvedUnpaidCommitments = Number(approvedRows[0]?.amount || 0);
  const pendingCommitments = Number(pendingRows[0]?.amount || 0);
  const paidExpenses = Number(paidRows[0]?.amount || 0);
  const remainingBalance = totalIncome - paidExpenses - approvedUnpaidCommitments;

  return {
    period: { month, year, monthKey, department, project },
    canManage: permission,
    formula: "Remaining Balance = Total Income or Budget Allocation - Paid Expenses - Approved Unpaid Commitments",
    summary: {
      totalIncome,
      approvedUnpaidCommitments,
      pendingCommitments,
      paidExpenses,
      remainingBalance,
    },
    entries: entries.map((row) => ({
      id: Number(row.id),
      entryNo: row.entry_no,
      entryDate: row.entry_date,
      monthKey: row.month_key,
      department: row.department,
      project: row.project,
      source: row.source,
      entryType: row.entry_type,
      amount: Number(row.amount || 0),
      notes: row.notes,
      status: row.status,
      createdAt: row.created_at,
      createdBy: row.created_by_name,
    })),
    trend: trend.reverse().map((row) => ({ monthKey: row.month_key, amount: Number(row.amount || 0) })),
    departments: departments.map((row) => row.department).filter(Boolean),
  };
}

export async function createIncomeEntry(user: CurrentUser, input: IncomeEntryInput) {
  assertIncomeVisible(user);
  if (!INCOME_MANAGE_ROLES.has(user.role)) throw new Error("Only Admin or Finance can add income or budget-allocation entries.");

  const entryDate = normalizeDate(input.entryDate);
  const department = normalizeText(input.department, "Department", "General");
  const project = normalizeText(input.project, "Project", "General");
  const entryType = normalizeText(input.entryType, "Entry type");
  const source = normalizeText(input.source, "Source", entryType);
  const amount = normalizeAmount(input.amount);
  const notes = String(input.notes || "").trim().slice(0, 4000);
  const monthKey = entryDate.slice(0, 7);
  const year = Number(entryDate.slice(0, 4));
  const month = Number(entryDate.slice(5, 7));
  const entryNo = entryReference(entryDate);
  const now = new Date().toISOString();
  const sql = db();

  const canManage = await hasIncomeManagePermission(sql, user);
  if (!canManage) throw new Error("Your current role permissions do not allow income management.");

  return sql.begin(async (tx) => {
    const rows = await tx<{ id:number }[]>`
      INSERT INTO income_entries (
        entry_no,entry_date,month_key,year,month,department,project,source,entry_type,amount,
        notes,status,created_by,created_at,updated_at
      ) VALUES (
        ${entryNo},${entryDate},${monthKey},${year},${month},${department},${project},${source},${entryType},
        CAST(${amount} AS NUMERIC),${notes || null},'Active',${user.id},${now},${now}
      ) RETURNING id
    `;
    const entryId = Number(rows[0].id);

    await tx`
      INSERT INTO activity_logs (
        user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,created_at
      ) VALUES (
        ${user.id},${user.role},'INCOME_ENTRY_CREATED','Income',${entryId},
        ${`Income entry ${entryNo} recorded for ${department} / ${project}`},
        ${notes || `Source: ${source}; Entry type: ${entryType}`},'finance',${now}
      )
    `;

    await tx`
      INSERT INTO audit_logs (
        action,entity_type,entity_id,user_id,role,details,after_values,created_at,event_date,event_time,amount,department,notes
      ) VALUES (
        'INCOME_ENTRY_CREATED','Income',${String(entryId)},${user.id},${user.role},
        ${`Created income entry ${entryNo}`},
        ${tx.json({entry_no:entryNo,entry_date:entryDate,month_key:monthKey,department,project,source,entry_type:entryType,amount:Number(amount),status:'Active'})},
        ${now},${now.slice(0,10)},${now.slice(11,19)},CAST(${amount} AS NUMERIC),${department},${notes || null}
      )
    `;

    await appendAuditEvent(tx, {
      action: "INCOME_ENTRY_CREATED",
      entityType: "Income",
      entityId: entryId,
      entityReference: entryNo,
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      afterValues: {
        entry_no: entryNo,
        entry_date: entryDate,
        month_key: monthKey,
        department,
        project,
        source,
        entry_type: entryType,
        amount: Number(amount),
        status: "Active",
      },
      metadata: { module: "income", permission: "manage_income" },
      reasonOrComment: notes || `Recorded ${entryType} from ${source}`,
      severity: "Normal",
      source: "nextjs-income",
    });

    return { id: entryId, entryNo, entryDate, monthKey, department, project, source, entryType, amount: Number(amount), status: "Active" };
  });
}

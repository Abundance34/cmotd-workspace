import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvText, simplePdf } from "@/lib/procureflow/simple-pdf";

export const runtime = "nodejs";

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "procureflow-requests";
}

function canExport(role: string) {
  return ["Facility Manager", "Procurement Manager", "Admin"].includes(role);
}

function accessSql(user: { id: number; role: string }) {
  if (user.role === "Facility Manager") {
    return { clause: "(pr.requested_by = $USER OR pr.facility_manager_user_id = $USER)", userId: user.id };
  }
  if (user.role === "Procurement Manager") {
    return { clause: "(pr.requested_by = $USER OR pr.assigned_procurement_manager_id = $USER)", userId: user.id };
  }
  return { clause: "TRUE", userId: user.id };
}

async function requestRows(user: { id: number; role: string }, requestId: number | null) {
  const sql = db();
  const access = accessSql(user);

  const baseSelect = sql`
    SELECT
      pr.id,
      pr.request_no,
      requester.full_name AS requester,
      requester.role AS requester_role,
      fm.full_name AS facility_manager,
      pm.full_name AS procurement_manager,
      pr.department_project,
      pr.request_date,
      pr.required_date,
      pr.category,
      pr.priority,
      pr.justification,
      pr.vendor_preference,
      pr.estimated_amount,
      pr.status,
      pr.payment_status,
      pr.next_role,
      pr.source_type,
      pr.submitted_at,
      pr.approved_at,
      pr.created_at,
      pr.updated_at,
      item.id AS item_id,
      item.item_name,
      item.description AS item_description,
      item.quantity,
      item.unit_price,
      item.total AS item_total,
      item.category AS item_category,
      item.suggested_vendor,
      payee.payee_type,
      payee.payee_name_masked,
      payee.account_name_masked,
      payee.bank_name_masked,
      payee.account_number_last4,
      payee.currency,
      payee.payment_readiness_status,
      payee.verification_status AS payee_verification_status
    FROM purchase_requests pr
    JOIN users requester ON requester.id = pr.requested_by
    LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id
    LEFT JOIN users pm ON pm.id = pr.assigned_procurement_manager_id
    LEFT JOIN purchase_request_items item ON item.request_id = pr.id
    LEFT JOIN LATERAL (
      SELECT ppd.*
      FROM payment_payee_details ppd
      WHERE ppd.purchase_request_id = pr.id
      ORDER BY COALESCE(ppd.is_current, FALSE) DESC, ppd.updated_at DESC, ppd.id DESC
      LIMIT 1
    ) payee ON TRUE
  `;

  let rows: any[];
  if (user.role === "Admin") {
    rows = requestId
      ? await sql<any[]>`${baseSelect} WHERE pr.id = ${requestId} ORDER BY item.id`
      : await sql<any[]>`${baseSelect} ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC, pr.id DESC, item.id LIMIT 5000`;
  } else if (user.role === "Facility Manager") {
    rows = requestId
      ? await sql<any[]>`${baseSelect} WHERE pr.id = ${requestId} AND (pr.requested_by = ${access.userId} OR pr.facility_manager_user_id = ${access.userId}) ORDER BY item.id`
      : await sql<any[]>`${baseSelect} WHERE pr.requested_by = ${access.userId} OR pr.facility_manager_user_id = ${access.userId} ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC, pr.id DESC, item.id LIMIT 5000`;
  } else {
    rows = requestId
      ? await sql<any[]>`${baseSelect} WHERE pr.id = ${requestId} AND (pr.requested_by = ${access.userId} OR pr.assigned_procurement_manager_id = ${access.userId}) ORDER BY item.id`
      : await sql<any[]>`${baseSelect} WHERE pr.requested_by = ${access.userId} OR pr.assigned_procurement_manager_id = ${access.userId} ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC, pr.id DESC, item.id LIMIT 5000`;
  }

  if (requestId && !rows.length) throw new Error("This request is not available to your account.");

  return rows.map((row) => ({
    request_no: row.request_no,
    requester: row.requester,
    requester_role: row.requester_role,
    facility_manager: row.facility_manager || "",
    procurement_manager: row.procurement_manager || "",
    department_project: row.department_project || "",
    request_date: row.request_date || "",
    required_date: row.required_date || "",
    category: row.category || "",
    priority: row.priority || "",
    justification: row.justification || "",
    vendor_preference: row.vendor_preference || "",
    estimated_amount: Number(row.estimated_amount || 0),
    status: row.status || "",
    payment_status: row.payment_status || "",
    next_role: row.next_role || "",
    source_type: row.source_type || "",
    submitted_at: row.submitted_at || "",
    approved_at: row.approved_at || "",
    item_name: row.item_name || "",
    item_description: row.item_description || "",
    quantity: row.quantity == null ? "" : Number(row.quantity),
    unit_price: row.unit_price == null ? "" : Number(row.unit_price),
    item_total: row.item_total == null ? "" : Number(row.item_total),
    item_category: row.item_category || "",
    suggested_vendor: row.suggested_vendor || "",
    payee_type: row.payee_type || "",
    payee_name: row.payee_name_masked || "",
    account_name: row.account_name_masked || "",
    bank: row.bank_name_masked || "",
    account_number: row.account_number_last4 ? `******${row.account_number_last4}` : "",
    currency: row.currency || "NGN",
    payment_readiness: row.payment_readiness_status || "",
    payee_verification: row.payee_verification_status || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  }));
}

function pdfLines(rows: Record<string, unknown>[]) {
  return rows.slice(0, 1000).flatMap((row, index) => [
    `${index + 1}. ${Object.entries(row).map(([key, value]) => `${key}: ${value ?? ""}`).join(" | ")}`,
  ]);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canExport(user.role)) return NextResponse.json({ error: "Request exports are available to Facility, Procurement and Admin only." }, { status: 403 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "csv").toLowerCase();
  const idText = url.searchParams.get("id");
  const requestId = idText ? Number(idText) : null;
  if (idText && (!Number.isInteger(requestId) || Number(requestId) <= 0)) {
    return NextResponse.json({ error: "A valid request id is required." }, { status: 400 });
  }
  if (!["csv", "xlsx", "excel", "pdf", "json"].includes(format)) {
    return NextResponse.json({ error: "Choose CSV, Excel, PDF or JSON." }, { status: 400 });
  }

  try {
    const rows = await requestRows(user, requestId);
    const reference = requestId && rows[0]?.request_no ? String(rows[0].request_no) : user.role === "Facility Manager" ? "my-facility-requests" : user.role === "Procurement Manager" ? "procurement-requests" : "all-requests";
    const filename = safeName(`procureflow-${reference}-${new Date().toISOString().slice(0, 10)}`);

    if (format === "json") {
      return new NextResponse(JSON.stringify(rows, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.json"`,
        },
      });
    }

    if (format === "pdf") {
      const title = requestId && rows[0]?.request_no
        ? `ProcureFlow Purchase Request — ${rows[0].request_no}`
        : `ProcureFlow ${user.role === "Facility Manager" ? "Facility" : user.role === "Procurement Manager" ? "Procurement" : "All"} Request Register`;
      const pdf = simplePdf(title, pdfLines(rows), "CMOTD ProcureFlow");
      return new NextResponse(pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        },
      });
    }

    if (format === "xlsx" || format === "excel") {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, requestId ? "Request" : "Requests");
      const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(new Uint8Array(output), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        },
      });
    }

    return new NextResponse(csvText(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate request export." }, { status: 400 });
  }
}

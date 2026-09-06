import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only Procurement Manager or Admin can view Procurement-owned drafts." }, { status: 403 });
    }

    const sql = db();
    const rows = user.role === "Admin"
      ? await sql<any[]>`
          SELECT pr.id, pr.request_no, fm.full_name AS facility_manager,
                 pr.department_project, pr.request_date, pr.required_date, pr.category,
                 pr.justification, pr.priority, pr.estimated_amount, pr.status,
                 pr.payment_status, pr.updated_at
          FROM purchase_requests pr
          JOIN users requester ON requester.id=pr.requested_by
          LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
          WHERE requester.role='Procurement Manager'
            AND pr.status IN ('PM Draft','Draft','Returned for Correction','Returned to Procurement Manager','Returned')
          ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC
          LIMIT 250
        `
      : await sql<any[]>`
          SELECT pr.id, pr.request_no, fm.full_name AS facility_manager,
                 pr.department_project, pr.request_date, pr.required_date, pr.category,
                 pr.justification, pr.priority, pr.estimated_amount, pr.status,
                 pr.payment_status, pr.updated_at
          FROM purchase_requests pr
          JOIN users requester ON requester.id=pr.requested_by
          LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id
          WHERE pr.requested_by=${user.id}
            AND requester.role='Procurement Manager'
            AND pr.status IN ('PM Draft','Draft','Returned for Correction','Returned to Procurement Manager','Returned')
          ORDER BY COALESCE(pr.updated_at, pr.created_at) DESC
          LIMIT 250
        `;

    return NextResponse.json({
      ok: true,
      rows: rows.map((row) => ({
        id: Number(row.id),
        requestNo: row.request_no,
        facilityManager: row.facility_manager,
        departmentProject: row.department_project,
        requestDate: row.request_date ? String(row.request_date) : "",
        requiredDate: row.required_date ? String(row.required_date) : null,
        category: row.category,
        justification: row.justification,
        priority: row.priority,
        estimatedAmount: Number(row.estimated_amount || 0),
        status: row.status,
        paymentStatus: row.payment_status,
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Procurement-owned drafts." }, { status: 500 });
  }
}

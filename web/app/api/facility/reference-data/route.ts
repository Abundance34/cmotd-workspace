import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Facility Manager" && user.role !== "Procurement Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Request reference data is not available to this role." }, { status: 403 });
    }

    const sql = db();
    const departments = await sql<{ name: string }[]>`
      SELECT name
      FROM departments
      WHERE COALESCE(status, 'Active') = 'Active'
      ORDER BY name
    `;

    return NextResponse.json({
      ok: true,
      departments: departments.map((row) => String(row.name)).filter(Boolean),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load request reference data." },
      { status: 500 },
    );
  }
}

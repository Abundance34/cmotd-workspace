import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import { createIncomeEntry, getIncomeWorkspace, type IncomeEntryInput } from "@/lib/procureflow/income";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const url = new URL(request.url);
    const today = new Date();
    const month = Number(url.searchParams.get("month") || today.getMonth() + 1);
    const year = Number(url.searchParams.get("year") || today.getFullYear());
    const department = url.searchParams.get("department") || "All";
    const project = url.searchParams.get("project") || "";

    const result = await getIncomeWorkspace(user, { month, year, department, project });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load income workspace.";
    const status = /not available to this role/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "Income writes are temporarily locked until the active v2 audit signing key verifies." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as IncomeEntryInput | null;
    if (!body) return NextResponse.json({ error: "Income entry details are required." }, { status: 400 });

    const result = await createIncomeEntry(user, body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save income entry.";
    const status = /Only Admin or Finance|role permissions|not available to this role/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

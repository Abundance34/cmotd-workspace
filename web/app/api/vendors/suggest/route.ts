import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";

export const runtime = "nodejs";

const ALLOWED = new Set(["Facility Manager", "Procurement Manager", "Admin"]);

function clean(value: unknown, limit: number) {
  return String(value ?? "").trim().slice(0, limit);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!ALLOWED.has(user.role)) return NextResponse.json({ error: "Your role cannot add vendor suggestions." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = clean(body?.name, 200);
  const category = clean(body?.category, 120) || "Other";
  const email = clean(body?.email, 200);
  const phone = clean(body?.phone, 80);
  const address = clean(body?.address, 500);
  if (name.length < 2) return NextResponse.json({ error: "Vendor name is required." }, { status: 400 });

  const sql = db();
  try {
    const result = await sql.begin(async (tx) => {
      const existing = (await tx<any[]>`
        SELECT id,name,status FROM vendors WHERE LOWER(name)=LOWER(${name}) LIMIT 1
      `)[0];
      if (existing) return { id: Number(existing.id), name: existing.name, status: existing.status || "Existing", created: false };

      const now = new Date().toISOString();
      const row = (await tx<any[]>`
        INSERT INTO vendors (
          name,category,phone,email,address,rating,completed_orders,total_spend,rejection_count,
          status,documents_json,created_at,updated_at
        ) VALUES (
          ${name},${category},${phone || null},${email || null},${address || null},NULL,0,0,0,
          'Pending Vetting',${tx.json({ suggestedBy: user.username, source: "Request authoring" })},${now},${now}
        )
        RETURNING id,name,status
      `)[0];
      const vendorId = Number(row.id);
      await tx`
        INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
        VALUES (${user.id},${user.role},'Vendor Suggested','Vendor',${vendorId},${`${name} added as Pending Vetting`},NULL,'workflow',NULL,${now})
      `;
      await appendAuditEvent(tx, {
        action: "Vendor Suggested",
        entityType: "Vendor",
        entityId: vendorId,
        entityReference: name,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        beforeValues: {},
        afterValues: { name, category, status: "Pending Vetting", email: email || null, phone: phone || null },
        reasonOrComment: "Vendor suggested during request authoring",
        source: "nextjs",
      });
      return { id: vendorId, name: row.name, status: row.status, created: true };
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to add vendor suggestion." }, { status: 400 });
  }
}

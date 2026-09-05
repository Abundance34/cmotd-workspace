import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";

function allowed(user: { role: string }, source: string) {
  if (source === "Imported Document") return ["Facility Manager", "Procurement Manager", "Finance", "Admin", "Auditor"].includes(user.role);
  if (source === "Logistics Document") return ["Logistics Officer", "Procurement Manager", "Admin", "Auditor"].includes(user.role);
  if (source === "Vendor Document") return ["Procurement Manager", "Admin", "Auditor"].includes(user.role);
  if (source === "Receipt" || source === "Invoice") return ["Finance", "Procurement Manager", "Approver", "Admin", "Auditor"].includes(user.role);
  return false;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const source = url.searchParams.get("source") || "";
  const id = Number(url.searchParams.get("id") || 0);
  if (!Number.isInteger(id) || id <= 0 || !allowed(user, source)) {
    return NextResponse.json({ error: "Document unavailable." }, { status: 403 });
  }
  const verified = await verifyActiveAuditSigningKey().catch(() => false);
  if (!verified) return NextResponse.json({ error: "Document downloads are audit-locked until the v2 signing key verifies." }, { status: 503 });
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      let row: any = null;
      if (source === "Imported Document") row = (await tx<any[]>`SELECT id,file_name,file_path,document_type,title FROM imported_legacy_documents WHERE id=${id} LIMIT 1`)[0];
      else if (source === "Logistics Document") row = (await tx<any[]>`SELECT id,file_name,file_path,document_type,file_name title FROM logistics_documents WHERE id=${id} LIMIT 1`)[0];
      else if (source === "Vendor Document") row = (await tx<any[]>`SELECT id,COALESCE(title,'Vendor document') title,file_path,document_type,COALESCE(title,'vendor-document') file_name FROM vendor_documents WHERE id=${id} LIMIT 1`)[0];
      else if (source === "Receipt") row = (await tx<any[]>`SELECT id,COALESCE(original_file_name,receipt_no) file_name,file_path,COALESCE(document_category,receipt_type) document_type,receipt_no title FROM receipt_records WHERE id=${id} LIMIT 1`)[0];
      else if (source === "Invoice") row = (await tx<any[]>`SELECT id,COALESCE(supplier_invoice_no,invoice_no) file_name,file_path,COALESCE(invoice_type,'Invoice') document_type,invoice_no title FROM invoices WHERE id=${id} LIMIT 1`)[0];
      if (!row) throw new Error("Document metadata was not found.");
      const locator = String(row.file_path || "");
      if (!locator.startsWith("data:")) {
        throw new Error("This legacy document points to historical filesystem/GCP storage and has no portable file payload in Neon. Its metadata is preserved, but the binary must be re-uploaded to the GCP-free document store.");
      }
      const match = locator.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) throw new Error("Stored document payload is invalid.");
      const mime = match[1];
      const bytes = Buffer.from(match[2], "base64");
      const now = new Date().toISOString();
      await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},'Document Downloaded',${source},${id},${`Downloaded ${row.title || row.file_name}`},NULL,'workflow',NULL,${now})`;
      await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES ('DOCUMENT_DOWNLOADED',${source},${String(id)},${user.id},${user.role},'Document downloaded',${tx.json({})},${tx.json({ file_name: row.file_name, document_type: row.document_type })},${now},${now.slice(0, 10)},${now.slice(11, 19)},'Audited download')`;
      await appendAuditEvent(tx, {
        action: "Document Downloaded",
        entityType: source,
        entityId: id,
        entityReference: String(row.title || row.file_name),
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        beforeValues: {},
        afterValues: { file_name: row.file_name, document_type: row.document_type, file_size_bytes: bytes.length },
        reasonOrComment: "Authorized document download",
        source: "nextjs",
      });
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `attachment; filename="${String(row.file_name || "document").replace(/["\r\n]/g, "")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to download document." }, { status: 404 });
  }
}

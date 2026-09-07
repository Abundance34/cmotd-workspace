import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

function extensionFor(mime: string) {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "bin";
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id") || 0);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "A valid reimbursement id is required." }, { status: 400 });

    const sql = db();
    const rows = await sql<any[]>`
      SELECT e.id,e.expense_no,e.requested_by,e.document_kind,e.receipt_path
      FROM expenses e
      WHERE e.id=${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.document_kind !== "Reimbursement") return NextResponse.json({ error: "Reimbursement proof not found." }, { status: 404 });
    const canRead = Number(row.requested_by || 0) === user.id || ["Procurement Manager", "Finance", "Admin", "Auditor"].includes(user.role);
    if (!canRead) return NextResponse.json({ error: "You do not have access to this reimbursement proof." }, { status: 403 });

    const locator = String(row.receipt_path || "");
    const match = locator.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!match) return NextResponse.json({ error: "No portable proof file is available for this reimbursement." }, { status: 404 });
    const mime = match[1] || "application/octet-stream";
    const bytes = Buffer.from(match[2], "base64");
    const fileName = `${row.expense_no || `reimbursement-${id}`}-proof.${extensionFor(mime)}`;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to download reimbursement proof." }, { status: 400 });
  }
}

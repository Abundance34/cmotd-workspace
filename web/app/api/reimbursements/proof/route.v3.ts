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

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

function parseBatch(locator: string) {
  if (!locator.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(locator);
    return ["reimbursement-batch-v2", "reimbursement-batch-v3"].includes(String(parsed?.kind || "")) && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id") || 0);
    const itemIndex = Number(url.searchParams.get("item") || 0);
    const proofIndex = Number(url.searchParams.get("proof") || 0);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "A valid reimbursement id is required." }, { status: 400 });
    if (!Number.isInteger(itemIndex) || itemIndex < 0) return NextResponse.json({ error: "A valid reimbursement item is required." }, { status: 400 });
    if (!Number.isInteger(proofIndex) || proofIndex < 0) return NextResponse.json({ error: "A valid receipt/proof index is required." }, { status: 400 });

    const sql = db();
    const rows = await sql<any[]>`
      SELECT e.id,e.expense_no,e.requested_by,e.document_kind,e.receipt_path
      FROM expenses e
      WHERE e.id=${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.document_kind !== "Reimbursement") return NextResponse.json({ error: "Reimbursement proof not found." }, { status: 404 });

    let canRead = Number(row.requested_by || 0) === user.id || ["Finance", "Admin", "Auditor"].includes(user.role);
    if (!canRead && user.role === "Procurement Manager") {
      const access = await sql<any[]>`
        SELECT 1
        FROM purchase_requests pr
        WHERE pr.linked_expense_id=${id}
          AND (pr.assigned_procurement_manager_id=${user.id} OR pr.assigned_procurement_manager_id IS NULL)
        LIMIT 1
      `;
      canRead = Boolean(access[0]);
    }
    if (!canRead) return NextResponse.json({ error: "You do not have access to this reimbursement proof." }, { status: 403 });

    const locator = String(row.receipt_path || "");
    const batch = parseBatch(locator);
    let proofLocator = locator;
    let originalName = "";
    if (batch) {
      const item = batch.items[itemIndex];
      if (!item) return NextResponse.json({ error: "Reimbursement item not found." }, { status: 404 });
      if (Array.isArray(item.proofs)) {
        const proof = item.proofs[proofIndex];
        if (!proof) return NextResponse.json({ error: "Receipt/proof file not found." }, { status: 404 });
        proofLocator = String(proof.locator || "");
        originalName = String(proof.fileName || "");
      } else {
        if (proofIndex !== 0) return NextResponse.json({ error: "This reimbursement item has only one supporting proof." }, { status: 404 });
        proofLocator = String(item.locator || "");
        originalName = String(item.fileName || "");
      }
    } else if (itemIndex !== 0 || proofIndex !== 0) {
      return NextResponse.json({ error: "This legacy reimbursement has only one supporting proof." }, { status: 404 });
    }

    const match = proofLocator.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!match) return NextResponse.json({ error: "No portable receipt/proof file is available for this reimbursement item." }, { status: 404 });
    const mime = match[1] || "application/octet-stream";
    const bytes = Buffer.from(match[2], "base64");
    const fallback = `${row.expense_no || `reimbursement-${id}`}-item-${itemIndex + 1}-proof-${proofIndex + 1}.${extensionFor(mime)}`;
    const fileName = originalName ? `${row.expense_no}-${originalName}` : fallback;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${safeName(fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to download reimbursement proof." }, { status: 400 });
  }
}

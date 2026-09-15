import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 3_000_000;
const MAX_SUPPORT_FILES = 8;

function clean(value: unknown, max = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
function idOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Choose a valid linked record.");
  return id;
}
function amount(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error("Enter a valid receipt amount.");
  return number;
}
function filePayload(input: any) {
  if (!input?.base64) return null;
  const fileName = clean(input.fileName, 180) || "document";
  const mimeType = clean(input.mimeType, 120) || "application/octet-stream";
  const normalized = String(input.base64).replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) throw new Error(`The uploaded file ${fileName} is empty.`);
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${fileName} is too large. Keep each file below 3 MB.`);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return {
    fileName,
    mimeType,
    size: bytes.length,
    checksum,
    locator: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}
function receiptReference() {
  return `REC-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!["Finance", "Admin"].includes(user.role)) {
      return NextResponse.json({ error: "Finance access is required." }, { status: 403 });
    }
    if (!await verifyActiveAuditSigningKey().catch(() => false)) {
      return NextResponse.json({ error: "ProcureFlow writes are locked because the active audit signing key is not verified." }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || "manual") === "attachment" ? "attachment" : "manual";
    const primaryFile = filePayload(body?.file);
    const supportInputs = Array.isArray(body?.supportingFiles) ? body.supportingFiles.slice(0, MAX_SUPPORT_FILES) : [];
    const supportingFiles = supportInputs.map(filePayload).filter(Boolean) as NonNullable<ReturnType<typeof filePayload>>[];
    if (mode === "attachment" && !primaryFile) throw new Error("Choose a receipt file to use attachment-only entry.");

    const receiptNo = clean(body?.receiptNo, 120) || receiptReference();
    const receiptType = clean(body?.documentType, 120) || "Payment Receipt";
    const paymentMethod = clean(body?.paymentMethod, 80) || "Unspecified";
    const paymentDate = clean(body?.paymentDate, 20) || new Date().toISOString().slice(0, 10);
    const receiptAmount = amount(body?.amount);
    if (mode === "manual" && receiptAmount <= 0) throw new Error("Enter the receipt amount for manual entry.");
    const currency = clean(body?.currency, 12).toUpperCase() || "NGN";
    const requestId = idOrNull(body?.requestId);
    const paymentId = idOrNull(body?.paymentId);
    const poId = idOrNull(body?.poId);
    const vendorId = idOrNull(body?.vendorId);
    const payerName = clean(body?.payerName, 180) || null;
    const payeeName = clean(body?.payeeName, 180) || null;
    const purpose = clean(body?.purpose, 500) || null;
    const departmentProject = clean(body?.departmentProject, 180) || null;
    const transferReference = clean(body?.transferReference, 180) || null;
    const note = clean(body?.note, 1500) || null;
    const now = new Date().toISOString();

    const sql = db();
    const result = await sql.begin(async (tx) => {
      const duplicate = await tx<any[]>`
        SELECT id FROM receipt_records
        WHERE lower(COALESCE(receipt_no,''))=lower(${receiptNo})
        ORDER BY id DESC LIMIT 1
      `;
      if (duplicate[0]) throw new Error("A receipt with this receipt number already exists.");

      const inserted = await tx<any[]>`
        INSERT INTO receipt_records (
          receipt_no,receipt_type,payment_method,payment_date,vendor_id,payer_name,payee_name,
          amount,currency,purpose,department_project,linked_payment_id,linked_po_id,status,
          file_path,file_hash,notes,uploaded_by,created_at,updated_at,document_category,
          request_id,payment_id,original_file_name,mime_type,file_size_bytes,file_checksum,
          ocr_status,discrepancy_status,transfer_reference,interface_mode
        ) VALUES (
          ${receiptNo},${receiptType},${paymentMethod},${paymentDate},${vendorId},${payerName},${payeeName},
          ${receiptAmount},${currency},${purpose},${departmentProject},${paymentId},${poId},'Recorded',
          ${primaryFile?.locator || null},${primaryFile?.checksum || null},${note},${user.id},${now},${now},${receiptType},
          ${requestId},${paymentId},${primaryFile?.fileName || null},${primaryFile?.mimeType || null},${primaryFile?.size || null},${primaryFile?.checksum || null},
          'Not Processed','None',${transferReference},'Next.js'
        ) RETURNING id
      `;
      const receiptId = Number(inserted[0].id);

      if (paymentId) {
        await tx`UPDATE payments SET receipt_id=COALESCE(receipt_id,${receiptId}),updated_at=${now} WHERE id=${paymentId}`;
      }
      if (requestId) {
        await tx`UPDATE purchase_requests SET receipt_uploaded_at=COALESCE(receipt_uploaded_at,${now}),updated_at=${now} WHERE id=${requestId}`;
      }

      const supportDocumentIds: number[] = [];
      for (const [index, file] of supportingFiles.entries()) {
        const originalPath = `receipt-support/${receiptNo}/${index + 1}-${randomUUID()}-${file.fileName}`;
        const title = `${receiptNo} supporting document — ${file.fileName}`;
        const rows = await tx<any[]>`
          INSERT INTO imported_legacy_documents (
            source_zip_name,original_path,file_name,file_path,file_hash,document_type,department_project,title,
            likely_date,total_amount,import_status,confidence,linked_request_id,duplicate_warning,imported_by,created_at,updated_at
          ) VALUES (
            'Receipt Supporting Document',${originalPath},${file.fileName},${file.locator},${file.checksum},'Receipt Supporting Document',
            ${departmentProject},${title},${paymentDate},0,'Imported',1,${requestId},FALSE,${user.id},${now},${now}
          ) RETURNING id
        `;
        supportDocumentIds.push(Number(rows[0].id));
      }

      await tx`
        INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
        VALUES (${user.id},${user.role},'RECEIPT_RECORDED','Receipt',${receiptId},${`${receiptNo} recorded in Finance`},${note},'workflow',NULL,${now})
      `;
      await appendAuditEvent(tx, {
        action: "RECEIPT_RECORDED",
        entityType: "Receipt",
        entityId: receiptId,
        entityReference: receiptNo,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        afterValues: {
          entry_mode: mode,
          amount: receiptAmount,
          currency,
          payment_method: paymentMethod,
          request_id: requestId,
          payment_id: paymentId,
          purchase_order_id: poId,
          vendor_id: vendorId,
          primary_file_attached: Boolean(primaryFile),
          supporting_document_count: supportingFiles.length,
        },
        metadata: { primary_file_checksum: primaryFile?.checksum || null, support_document_ids: supportDocumentIds },
        reasonOrComment: note || "Finance receipt recorded.",
        source: "nextjs",
      });

      return { receiptId, receiptNo, supportingDocumentIds: supportDocumentIds };
    });

    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record receipt.";
    const status = /Finance access|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

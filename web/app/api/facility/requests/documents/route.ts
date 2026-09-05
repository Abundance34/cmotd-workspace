import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 3_000_000;

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Facility Manager" && user.role !== "Admin") {
      return NextResponse.json({ error: "Only Utility / Facility Head or Admin can attach documents to Facility drafts." }, { status: 403 });
    }
    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json({ error: "ProcureFlow writes are locked until the active v2 audit signing key verifies." }, { status: 503 });
    }

    const body = await request.json().catch(() => null) as any;
    const requestId = Number(body?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
    }
    const input = body?.file || {};
    const normalized = String(input.base64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const bytes = Buffer.from(normalized, "base64");
    if (!bytes.length) return NextResponse.json({ error: "Choose a supporting document to upload." }, { status: 400 });
    if (bytes.length > MAX_FILE_BYTES) return NextResponse.json({ error: "Keep each supporting document below 3 MB." }, { status: 400 });

    const fileName = clean(input.fileName, 180) || "supporting-document";
    const mimeType = clean(input.mimeType, 120) || "application/octet-stream";
    const documentType = clean(body?.documentType, 120) || "Supporting Document";
    const title = clean(body?.title, 180) || fileName;
    const note = clean(body?.note, 1200) || "Supporting document attached to Utility / Facility draft.";
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const locator = `data:${mimeType};base64,${bytes.toString("base64")}`;
    const sql = db();

    const result = await sql.begin(async (tx) => {
      const requestRows = await tx<any[]>`
        SELECT id,request_no,requested_by,facility_manager_user_id,assigned_procurement_manager_id,
               next_role,department_project,attachments_json,status
        FROM purchase_requests WHERE id=${requestId} FOR UPDATE
      `;
      const row = requestRows[0];
      if (!row) throw new Error("Purchase request not found.");
      if (user.role === "Facility Manager" && Number(row.requested_by) !== user.id && Number(row.facility_manager_user_id) !== user.id) {
        throw new Error("You can attach documents only to your own Utility / Facility requests.");
      }

      const duplicate = await tx<any[]>`
        SELECT id FROM imported_legacy_documents
        WHERE linked_request_id=${requestId} AND file_hash=${checksum}
        ORDER BY id DESC LIMIT 1
      `;
      if (duplicate[0]) throw new Error(`${fileName} is already attached to this request.`);

      const inserted = await tx<any[]>`
        INSERT INTO imported_legacy_documents (
          source_zip_name,original_path,file_name,file_path,file_hash,document_type,department_project,title,
          likely_date,likely_vendor,total_amount,import_status,confidence,linked_request_id,duplicate_warning,
          imported_by,created_at,updated_at,assigned_procurement_manager_id,facility_manager_user_id
        ) VALUES (
          'Facility Draft Upload',${fileName},${fileName},${locator},${checksum},${documentType},${row.department_project},${title},
          NULL,NULL,0,'Imported',1,${requestId},FALSE,${user.id},NOW(),NOW(),${row.assigned_procurement_manager_id},${row.facility_manager_user_id || row.requested_by}
        ) RETURNING id,created_at
      `;
      const documentId = Number(inserted[0].id);
      const existing = Array.isArray(row.attachments_json) ? row.attachments_json : [];
      const attachment = {
        documentId,
        sourceType: "Imported Document",
        fileName,
        mimeType,
        fileSizeBytes: bytes.length,
        checksum,
        documentType,
        title,
        downloadUrl: `/api/parity/document?source=${encodeURIComponent("Imported Document")}&id=${documentId}`,
        uploadedAt: new Date().toISOString(),
      };
      await tx`UPDATE purchase_requests SET attachments_json=${tx.json([...existing, attachment])},updated_at=NOW() WHERE id=${requestId}`;

      await tx`
        INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
        VALUES (${user.id},${user.role},'Supporting Document Attached','Purchase Request',${requestId},
                ${`Supporting document attached — ${row.request_no}`},${note},'workflow',${row.assigned_procurement_manager_id || null},NOW())
      `;
      await tx`
        INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes)
        VALUES ('SUPPORTING_DOCUMENT_ATTACHED','Purchase Request',${String(requestId)},${user.id},${user.role},${note},
                ${tx.json({ attachment_count: existing.length })},
                ${tx.json({ attachment_count: existing.length + 1, document_id: documentId, file_name: fileName, mime_type: mimeType, file_size_bytes: bytes.length, checksum })},
                NOW(),CURRENT_DATE,TO_CHAR(NOW(),'HH24:MI:SS'),${note})
      `;
      await appendAuditEvent(tx, {
        action: "Supporting Document Attached",
        entityType: "Purchase Request",
        entityId: requestId,
        entityReference: row.request_no,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        beforeValues: { attachment_count: existing.length },
        afterValues: { attachment_count: existing.length + 1, document_id: documentId, file_name: fileName, mime_type: mimeType, file_size_bytes: bytes.length, checksum },
        metadata: { source: "facility-draft-upload", document_type: documentType },
        reasonOrComment: note,
        source: "nextjs",
      });
      return { documentId, requestId, requestNo: row.request_no, fileName, mimeType, fileSizeBytes: bytes.length, checksum, downloadUrl: attachment.downloadUrl };
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to attach supporting document.";
    const status = /own Utility|Only Utility|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

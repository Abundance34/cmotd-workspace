import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/lib/procureflow/audit";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 3_000_000;

function clean(value: unknown, max = 500) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max); }

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Procurement Manager" && user.role !== "Admin") return NextResponse.json({ error: "Procurement Manager access is required." }, { status: 403 });
    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) return NextResponse.json({ error: "ProcureFlow writes are locked until the active v2 audit signing key verifies." }, { status: 503 });

    const body = await request.json().catch(() => null) as any;
    const quoteId = Number(body?.quoteId);
    if (!Number.isInteger(quoteId) || quoteId <= 0) return NextResponse.json({ error: "A valid quoteId is required." }, { status: 400 });
    const input = body?.file || {};
    const normalized = String(input.base64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const bytes = Buffer.from(normalized, "base64");
    if (!bytes.length) return NextResponse.json({ error: "Choose the vendor quotation document." }, { status: 400 });
    if (bytes.length > MAX_FILE_BYTES) return NextResponse.json({ error: "Keep the vendor quotation document below 3 MB." }, { status: 400 });
    const fileName = clean(input.fileName, 180) || `quote-${quoteId}`;
    const mimeType = clean(input.mimeType, 120) || "application/octet-stream";
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const locator = `data:${mimeType};base64,${bytes.toString("base64")}`;
    const note = clean(body?.note, 1200) || "Vendor quotation document attached by Procurement Manager.";
    const sql = db();

    const result = await sql.begin(async tx => {
      const rows = await tx<any[]>`
        SELECT vq.id,vq.vendor_name,vq.vendor_id,vq.quote_document_hash,vq.quote_document_path,
               st.id sourcing_task_id,st.sourcing_no,st.assigned_to,
               pr.id request_id,pr.request_no,pr.department_project,pr.assigned_procurement_manager_id,
               pr.facility_manager_user_id,pr.attachments_json,
               COALESCE(vq.vendor_name,v.name,'Vendor') resolved_vendor_name
        FROM vendor_quotes vq
        JOIN sourcing_tasks st ON st.id=vq.sourcing_task_id
        JOIN purchase_requests pr ON pr.id=vq.request_id
        LEFT JOIN vendors v ON v.id=vq.vendor_id
        WHERE vq.id=${quoteId}
        FOR UPDATE OF vq,st,pr
      `;
      const row = rows[0];
      if (!row) throw new Error("Vendor quote not found.");
      if (user.role !== "Admin" && Number(row.assigned_to || 0) !== user.id && Number(row.assigned_procurement_manager_id || 0) !== user.id) {
        throw new Error("This vendor quote belongs to another Procurement Manager workspace.");
      }

      await tx`UPDATE vendor_quotes SET attachment_path=${locator},quote_document_path=${locator},quote_document_hash=${checksum},updated_at=NOW() WHERE id=${quoteId}`;
      const imported = await tx<any[]>`
        INSERT INTO imported_legacy_documents (
          source_zip_name,original_path,file_name,file_path,file_hash,document_type,department_project,title,
          likely_date,likely_vendor,total_amount,import_status,confidence,linked_request_id,duplicate_warning,
          imported_by,created_at,updated_at,assigned_procurement_manager_id,facility_manager_user_id
        ) VALUES (
          'Vendor Quote Upload',${fileName},${fileName},${locator},${checksum},'Vendor Quotation',${row.department_project},
          ${`${row.resolved_vendor_name} — ${row.sourcing_no}`},CURRENT_DATE,${row.resolved_vendor_name},0,'Imported',1,${row.request_id},FALSE,
          ${user.id},NOW(),NOW(),${row.assigned_procurement_manager_id || user.id},${row.facility_manager_user_id}
        ) RETURNING id
      `;
      const documentId = Number(imported[0].id);
      const downloadUrl = `/api/parity/document?source=${encodeURIComponent("Imported Document")}&id=${documentId}`;
      const existing = Array.isArray(row.attachments_json) ? row.attachments_json : [];
      const filtered = existing.filter((item:any) => Number(item?.quoteId || 0) !== quoteId);
      const attachment = { documentId, quoteId, sourceType:"Imported Document", fileName, mimeType, fileSizeBytes:bytes.length, checksum, documentType:"Vendor Quotation", title:`${row.resolved_vendor_name} — ${row.sourcing_no}`, downloadUrl, uploadedAt:new Date().toISOString() };
      await tx`UPDATE purchase_requests SET attachments_json=${tx.json([...filtered,attachment])},updated_at=NOW() WHERE id=${row.request_id}`;

      await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${user.id},${user.role},'Quote Document Attached','Vendor Quote',${quoteId},${`Quotation document attached — ${row.resolved_vendor_name}`},${note},'workflow',${row.facility_manager_user_id},NOW())`;
      await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES ('QUOTE_DOCUMENT_ATTACHED','Vendor Quote',${String(quoteId)},${user.id},${user.role},${note},${tx.json({quote_document_hash:row.quote_document_hash||null})},${tx.json({quote_document_hash:checksum,file_name:fileName,mime_type:mimeType,file_size_bytes:bytes.length,document_id:documentId})},NOW(),CURRENT_DATE,TO_CHAR(NOW(),'HH24:MI:SS'),${note})`;
      await appendAuditEvent(tx,{action:"Quote Document Attached",entityType:"Vendor Quote",entityId:quoteId,entityReference:`${row.sourcing_no} / ${row.resolved_vendor_name}`,actorUserId:user.id,actorUsername:user.username,actorRole:user.role,beforeValues:{quote_document_hash:row.quote_document_hash||null},afterValues:{quote_document_hash:checksum,file_name:fileName,mime_type:mimeType,file_size_bytes:bytes.length,document_id:documentId},metadata:{request_id:Number(row.request_id),request_no:row.request_no,sourcing_task_id:Number(row.sourcing_task_id)},reasonOrComment:note,source:"nextjs"});
      return { quoteId, documentId, fileName, checksum, downloadUrl };
    });
    return NextResponse.json({ ok:true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to attach vendor quotation document.";
    const status = /another Procurement Manager|access/i.test(message) ? 403 : 400;
    return NextResponse.json({ error:message }, { status });
  }
}

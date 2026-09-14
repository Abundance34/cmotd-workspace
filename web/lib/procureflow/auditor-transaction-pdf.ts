import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";

type Row = Record<string, any>;
type Package = {
  requests: Row[];
  items: Row[];
  payees?: Row[];
  sourcing?: Row[];
  quotes: Row[];
  purchaseOrders: Row[];
  poItems: Row[];
  payments: Row[];
  receipts: Row[];
  messages: Row[];
  documents: Row[];
  approvals: Row[];
  workflow: Row[];
};
type PdfOptions = { requestSpecific: boolean };

type PdfContext = {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  page: PDFPage;
  y: number;
  title: string;
  reference?: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NAVY = rgb(24 / 255, 44 / 255, 86 / 255);
const BLUE = rgb(49 / 255, 83 / 255, 189 / 255);
const TEXT = rgb(31 / 255, 41 / 255, 55 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const BORDER = rgb(226 / 255, 232 / 255, 240 / 255);
const SOFT = rgb(248 / 255, 250 / 255, 252 / 255);
const SECTION = rgb(239 / 255, 244 / 255, 255 / 255);

function safe(value: unknown) {
  return String(value ?? "")
    .replace(/₦/g, "NGN ")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/•/g, "-")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?");
}

function money(value: unknown, currency = "NGN") {
  const amount = Number(value || 0);
  return `${safe(currency || "NGN")} ${Number.isFinite(amount) ? amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function dateText(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? safe(value) : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function dateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? safe(value) : date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function clip(font: PDFFont, value: unknown, maxWidth: number, size: number) {
  let text = safe(value) || "-";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > maxWidth) text = text.slice(0, -1);
  return `${text}...`;
}

function wrap(font: PDFFont, value: unknown, maxWidth: number, size: number) {
  const words = safe(value).split(/\s+/).filter(Boolean);
  if (!words.length) return ["-"];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

async function loadLogo(pdf: PDFDocument) {
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "branding", "cmotd_company_wordmark.png"));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function header(ctx: PdfContext) {
  const { page, regular, bold, logo, title, reference } = ctx;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 92, width: PAGE_WIDTH, height: 92, color: SOFT });
  page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 92 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 92 }, thickness: 1, color: BORDER });
  if (logo) {
    const scaled = logo.scaleToFit(205, 52);
    page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - 72, width: scaled.width, height: scaled.height });
  } else {
    page.drawText("CMOTD", { x: MARGIN, y: PAGE_HEIGHT - 55, size: 18, font: bold, color: NAVY });
  }
  page.drawText(clip(bold, title, 250, 15), { x: PAGE_WIDTH - MARGIN - 250, y: PAGE_HEIGHT - 47, size: 15, font: bold, color: NAVY });
  if (reference) page.drawText(clip(regular, reference, 250, 9), { x: PAGE_WIDTH - MARGIN - 250, y: PAGE_HEIGHT - 64, size: 9, font: regular, color: MUTED });
  ctx.y = PAGE_HEIGHT - 116;
}

function addPage(ctx: PdfContext, title?: string, reference?: string) {
  if (title) ctx.title = title;
  ctx.reference = reference;
  ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  header(ctx);
}

function ensure(ctx: PdfContext, needed: number) {
  if (ctx.y - needed < 58) addPage(ctx, ctx.title, ctx.reference);
}

function sectionTitle(ctx: PdfContext, label: string) {
  ensure(ctx, 32);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 18, width: CONTENT_WIDTH, height: 23, color: SECTION });
  ctx.page.drawText(safe(label).toUpperCase(), { x: MARGIN + 9, y: ctx.y - 11, size: 9, font: ctx.bold, color: BLUE });
  ctx.y -= 31;
}

function keyValueRow(ctx: PdfContext, left: [string, unknown], right: [string, unknown]) {
  ensure(ctx, 42);
  const gap = 14;
  const width = (CONTENT_WIDTH - gap) / 2;
  const xs = [MARGIN, MARGIN + width + gap];
  [left, right].forEach(([label, value], index) => {
    const x = xs[index];
    ctx.page.drawText(safe(label).toUpperCase(), { x, y: ctx.y, size: 7.5, font: ctx.bold, color: MUTED });
    ctx.page.drawText(clip(ctx.regular, value, width, 10), { x, y: ctx.y - 15, size: 10, font: ctx.regular, color: TEXT });
  });
  ctx.y -= 38;
}

function paragraph(ctx: PdfContext, value: unknown) {
  const lines = wrap(ctx.regular, value || "No information recorded.", CONTENT_WIDTH - 18, 9.3);
  let offset = 0;
  while (offset < lines.length) {
    const maxLines = Math.min(12, lines.length - offset);
    ensure(ctx, maxLines * 13 + 18);
    const chunk = lines.slice(offset, offset + maxLines);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - chunk.length * 13 - 9, width: CONTENT_WIDTH, height: chunk.length * 13 + 14, borderColor: BORDER, borderWidth: 1, color: SOFT });
    chunk.forEach((line, index) => ctx.page.drawText(line, { x: MARGIN + 9, y: ctx.y - 12 - index * 13, size: 9.3, font: ctx.regular, color: TEXT }));
    ctx.y -= chunk.length * 13 + 20;
    offset += maxLines;
  }
}

type Column = { label: string; width: number; value: (row: Row) => unknown; align?: "left" | "right" };

function tableHeader(ctx: PdfContext, columns: Column[]) {
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 21, width: CONTENT_WIDTH, height: 23, color: NAVY });
  let x = MARGIN + 5;
  for (const column of columns) {
    ctx.page.drawText(column.label, { x, y: ctx.y - 14, size: 7, font: ctx.bold, color: rgb(1, 1, 1) });
    x += column.width;
  }
  ctx.y -= 24;
}

function table(ctx: PdfContext, columns: Column[], rows: Row[], emptyText: string) {
  ensure(ctx, 55);
  tableHeader(ctx, columns);
  if (!rows.length) {
    ctx.page.drawText(emptyText, { x: MARGIN + 6, y: ctx.y - 13, size: 8.5, font: ctx.regular, color: MUTED });
    ctx.y -= 27;
    return;
  }
  for (const row of rows) {
    ensure(ctx, 29);
    if (ctx.y > PAGE_HEIGHT - 135) tableHeader(ctx, columns);
    let x = MARGIN + 5;
    for (const column of columns) {
      const value = clip(ctx.regular, column.value(row), column.width - 9, 7.25);
      const width = ctx.regular.widthOfTextAtSize(value, 7.25);
      const drawX = column.align === "right" ? Math.max(x, x + column.width - 9 - width) : x;
      ctx.page.drawText(value, { x: drawX, y: ctx.y - 13, size: 7.25, font: ctx.regular, color: TEXT });
      x += column.width;
    }
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - 22 }, end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y - 22 }, thickness: 0.6, color: BORDER });
    ctx.y -= 25;
  }
}

function eventCards(ctx: PdfContext, rows: Row[], options: { title:(row:Row)=>unknown; meta:(row:Row)=>unknown; body?:(row:Row)=>unknown }, emptyText: string) {
  if (!rows.length) {
    paragraph(ctx, emptyText);
    return;
  }
  for (const row of rows) {
    const titleLines = wrap(ctx.bold, options.title(row), CONTENT_WIDTH - 18, 8.6);
    const metaLines = wrap(ctx.regular, options.meta(row), CONTENT_WIDTH - 18, 7.8);
    const bodyLines = options.body ? wrap(ctx.regular, options.body(row), CONTENT_WIDTH - 18, 8.2) : [];
    const lines = [...titleLines.slice(0,2), ...metaLines.slice(0,2), ...bodyLines.slice(0,5)];
    const height = Math.max(42, lines.length * 11 + 16);
    ensure(ctx, height + 6);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - height + 5, width: CONTENT_WIDTH, height, borderColor: BORDER, borderWidth: 1, color: SOFT });
    let y = ctx.y - 10;
    titleLines.slice(0,2).forEach((line) => { ctx.page.drawText(line, { x: MARGIN + 9, y, size: 8.6, font: ctx.bold, color: TEXT }); y -= 11; });
    metaLines.slice(0,2).forEach((line) => { ctx.page.drawText(line, { x: MARGIN + 9, y, size: 7.8, font: ctx.regular, color: MUTED }); y -= 10; });
    bodyLines.slice(0,5).forEach((line) => { ctx.page.drawText(line, { x: MARGIN + 9, y, size: 8.2, font: ctx.regular, color: TEXT }); y -= 10; });
    ctx.y -= height + 6;
  }
}

function rowsFor(pkg: Package, key: keyof Package, requestId: number) {
  const rows = Array.isArray(pkg[key]) ? pkg[key] as Row[] : [];
  return rows.filter((row) => Number(row.request_id ?? row.purchase_request_id) === requestId);
}

function requestRegister(ctx: PdfContext, rows: Row[]) {
  table(ctx, [
    { label: "Request", width: 94, value: r => r.request_no },
    { label: "Date", width: 59, value: r => dateText(r.request_date) },
    { label: "Requester", width: 78, value: r => r.requester },
    { label: "Category", width: 82, value: r => r.category },
    { label: "Amount", width: 78, value: r => money(r.estimated_amount), align: "right" },
    { label: "Status", width: 75, value: r => r.status },
    { label: "Payment", width: 49.28, value: r => r.payment_status },
  ], rows, "No transaction records available.");
}

function transactionPacket(ctx: PdfContext, pkg: Package, request: Row) {
  const id = Number(request.id);
  ctx.title = `Transaction 360 - ${safe(request.request_no)}`;
  ctx.reference = safe(request.request_no);
  if (ctx.y < PAGE_HEIGHT - 130) addPage(ctx, ctx.title, ctx.reference);

  sectionTitle(ctx, "Request summary");
  keyValueRow(ctx, ["Request number", request.request_no], ["Estimated amount", money(request.estimated_amount)]);
  keyValueRow(ctx, ["Requester", request.requester], ["Requester role", request.requester_role]);
  keyValueRow(ctx, ["Facility / Utility Head", request.facility_manager], ["Procurement Manager", request.procurement_manager]);
  keyValueRow(ctx, ["Department / Project", request.department_project], ["Category", request.category]);
  keyValueRow(ctx, ["Priority", request.priority], ["Required date", dateText(request.required_date)]);
  keyValueRow(ctx, ["Status", request.status], ["Payment status", request.payment_status]);
  keyValueRow(ctx, ["Next role", request.next_role], ["Submitted", dateText(request.submitted_at)]);

  sectionTitle(ctx, "Business justification");
  paragraph(ctx, request.justification);

  sectionTitle(ctx, "Line items");
  table(ctx, [
    { label: "Item / Service", width: 142, value: r => r.item_name },
    { label: "Qty", width: 35, value: r => r.quantity },
    { label: "Unit price", width: 72, value: r => money(r.unit_price), align: "right" },
    { label: "Total", width: 72, value: r => money(r.total), align: "right" },
    { label: "Category", width: 90, value: r => r.category },
    { label: "Suggested vendor", width: 104.28, value: r => r.suggested_vendor },
  ], rowsFor(pkg, "items", id), "No line items recorded.");

  const payee = rowsFor(pkg, "payees", id)[0] || null;
  sectionTitle(ctx, "Payment recipient");
  keyValueRow(ctx, ["Payee type", payee?.payee_type], ["Payee", payee?.payee_name_masked]);
  keyValueRow(ctx, ["Account name", payee?.account_name_masked], ["Bank", payee?.bank_name_masked]);
  keyValueRow(ctx, ["Account number", payee?.account_number_last4 ? `******${payee.account_number_last4}` : "-"], ["Currency", payee?.currency || "NGN"]);
  keyValueRow(ctx, ["Payment readiness", payee?.payment_readiness_status], ["Verification", payee?.verification_status]);

  sectionTitle(ctx, "Request context & messages");
  eventCards(ctx, rowsFor(pkg, "messages", id), {
    title: r => r.sender_name || r.sender_role || "User",
    meta: r => `${dateTime(r.created_at)} | ${r.sender_role || "-"}`,
    body: r => r.message_text,
  }, "No request-context messages were recorded.");

  sectionTitle(ctx, "Vendor sourcing & quotations");
  const sourcing = rowsFor(pkg, "sourcing", id);
  if (sourcing.length) {
    eventCards(ctx, sourcing, {
      title: r => r.sourcing_no || `Sourcing #${r.id}`,
      meta: r => `${r.status || "-"} | Recommended: ${r.recommended_vendor_name || "Pending"}`,
      body: r => r.reason_for_recommendation || "No recommendation note.",
    }, "No sourcing activity recorded.");
  }
  table(ctx, [
    { label: "Vendor", width: 120, value: r => r.vendor_name },
    { label: "Quote", width: 88, value: r => money(r.quoted_amount, r.currency || "NGN"), align: "right" },
    { label: "Delivery", width: 60, value: r => r.delivery_time_days == null ? "-" : `${r.delivery_time_days} days` },
    { label: "Terms", width: 105, value: r => r.payment_terms },
    { label: "Score", width: 48, value: r => r.score },
    { label: "Decision", width: 94.28, value: r => r.is_selected ? "Selected" : r.is_recommended ? "Recommended" : "-" },
  ], rowsFor(pkg, "quotes", id), "No vendor quotations recorded.");

  sectionTitle(ctx, "Purchase orders");
  table(ctx, [
    { label: "PO", width: 88, value: r => r.po_no },
    { label: "Vendor", width: 110, value: r => r.vendor_name },
    { label: "Amount", width: 82, value: r => money(r.total_amount), align: "right" },
    { label: "Status", width: 70, value: r => r.status },
    { label: "Payment", width: 70, value: r => r.payment_status },
    { label: "Receiving", width: 95.28, value: r => r.receiving_status || r.logistics_status },
  ], rowsFor(pkg, "purchaseOrders", id), "No purchase order recorded.");

  sectionTitle(ctx, "Purchase order line items");
  table(ctx, [
    { label: "PO", width: 78, value: r => r.po_no },
    { label: "Item", width: 168, value: r => r.item_name },
    { label: "Qty", width: 43, value: r => r.quantity },
    { label: "Unit price", width: 91, value: r => money(r.unit_price), align: "right" },
    { label: "Total", width: 100, value: r => money(r.total), align: "right" },
    { label: "Category", width: 35.28, value: r => r.category },
  ], rowsFor(pkg, "poItems", id), "No PO line items recorded.");

  sectionTitle(ctx, "Payments");
  table(ctx, [
    { label: "Payment", width: 90, value: r => r.payment_no },
    { label: "Amount", width: 88, value: r => money(r.amount, r.currency || "NGN"), align: "right" },
    { label: "Status", width: 68, value: r => r.status },
    { label: "Reference", width: 105, value: r => r.payment_reference },
    { label: "Method", width: 92, value: r => r.transfer_type || r.payment_method },
    { label: "Date", width: 72.28, value: r => dateText(r.payment_date) },
  ], rowsFor(pkg, "payments", id), "No payment recorded.");

  sectionTitle(ctx, "Receipts / proof of payment");
  table(ctx, [
    { label: "Receipt", width: 95, value: r => r.receipt_no },
    { label: "Type", width: 90, value: r => r.receipt_type || r.payment_method },
    { label: "Amount", width: 88, value: r => money(r.amount, r.currency || "NGN"), align: "right" },
    { label: "Status", width: 68, value: r => r.status },
    { label: "File", width: 110, value: r => r.original_file_name },
    { label: "Date", width: 64.28, value: r => dateText(r.created_at) },
  ], rowsFor(pkg, "receipts", id), "No receipt or proof of payment recorded.");

  sectionTitle(ctx, "Supporting documents");
  table(ctx, [
    { label: "Document", width: 180, value: r => r.title || r.file_name },
    { label: "Type", width: 130, value: r => r.document_type },
    { label: "Status", width: 90, value: r => r.status },
    { label: "Date", width: 115.28, value: r => dateText(r.created_at) },
  ], rowsFor(pkg, "documents", id), "No supporting documents linked.");

  sectionTitle(ctx, "Approval trail");
  eventCards(ctx, rowsFor(pkg, "approvals", id), {
    title: r => r.action,
    meta: r => `${dateTime(r.created_at)} | ${r.approved_by || r.approved_by_role || "System"} | ${r.approval_mode || "-"}`,
    body: r => `${r.status_before || "-"} -> ${r.status_after || "-"}${r.note ? " | " + r.note : ""}`,
  }, "No approval-history records found.");

  sectionTitle(ctx, "Workflow history");
  eventCards(ctx, rowsFor(pkg, "workflow", id), {
    title: r => r.event,
    meta: r => `${dateTime(r.created_at)} | ${r.user_name || r.user_role || "System"}`,
    body: r => `${r.status || "-"}${r.note ? " | " + r.note : ""}`,
  }, "No workflow-history records found.");

  sectionTitle(ctx, "Record information");
  keyValueRow(ctx, ["Request date", dateText(request.request_date)], ["Last updated", dateText(request.updated_at)]);
  keyValueRow(ctx, ["Source", request.source_type], ["Vendor preference", request.vendor_preference]);
  keyValueRow(ctx, ["Approved", dateText(request.approved_at)], ["Paid", dateText(request.paid_at)]);
  keyValueRow(ctx, ["Completed", dateText(request.completed_at)], ["Exported", dateText(new Date().toISOString())]);
}

function footer(pdf: PDFDocument, regular: PDFFont) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: PAGE_WIDTH - MARGIN, y: 42 }, thickness: 0.7, color: BORDER });
    page.drawText("CMOTD ProcureFlow - Controlled auditor transaction record", { x: MARGIN, y: 27, size: 7.5, font: regular, color: MUTED });
    const pageText = `Page ${index + 1} of ${pages.length}`;
    page.drawText(pageText, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageText, 7.5), y: 27, size: 7.5, font: regular, color: MUTED });
  });
}

export async function buildAuditorTransactionPdf(pkg: Package, options: PdfOptions) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);
  const first = pkg.requests[0];
  const title = options.requestSpecific && first ? `Transaction 360 - ${safe(first.request_no)}` : "Transaction 360 - Complete Register";
  const reference = options.requestSpecific && first ? safe(first.request_no) : undefined;
  const ctx: PdfContext = { pdf, regular, bold, logo, page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: 0, title, reference };
  header(ctx);

  if (!pkg.requests.length) {
    sectionTitle(ctx, "Transaction register");
    paragraph(ctx, "No transaction records were available for this export.");
  } else if (options.requestSpecific) {
    transactionPacket(ctx, pkg, pkg.requests[0]);
  } else {
    sectionTitle(ctx, "Transaction register");
    requestRegister(ctx, pkg.requests);
    sectionTitle(ctx, "Export contents");
    paragraph(ctx, "This controlled Auditor export includes a detailed packet for every transaction in the register: request summary, line items, payment recipient status, context messages, sourcing and quotations, purchase orders, payments, receipts, documents, approvals and workflow history.");
    for (const request of pkg.requests) {
      addPage(ctx, `Transaction 360 - ${safe(request.request_no)}`, safe(request.request_no));
      transactionPacket(ctx, pkg, request);
    }
  }

  footer(pdf, regular);
  return pdf.save();
}

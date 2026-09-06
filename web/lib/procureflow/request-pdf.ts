import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";

type ExportRow = Record<string, unknown>;
type PdfOptions = { title: string; requestSpecific: boolean };

type PdfContext = {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  page: PDFPage;
  y: number;
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

function safe(value: unknown) {
  return String(value ?? "")
    .replace(/₦/g, "NGN ")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/•/g, "-")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?");
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return `NGN ${Number.isFinite(amount) ? amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function dateText(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? safe(value) : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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

function header(ctx: PdfContext, title: string, reference?: string) {
  const { page, regular, bold, logo } = ctx;
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

function newPage(ctx: PdfContext, title: string, reference?: string) {
  ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  header(ctx, title, reference);
}

function ensure(ctx: PdfContext, needed: number, title: string, reference?: string) {
  if (ctx.y - needed < 58) newPage(ctx, title, reference);
}

function sectionTitle(ctx: PdfContext, label: string, title: string, reference?: string) {
  ensure(ctx, 30, title, reference);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 18, width: CONTENT_WIDTH, height: 23, color: rgb(239 / 255, 244 / 255, 255 / 255) });
  ctx.page.drawText(safe(label).toUpperCase(), { x: MARGIN + 9, y: ctx.y - 11, size: 9, font: ctx.bold, color: BLUE });
  ctx.y -= 31;
}

function keyValueRow(ctx: PdfContext, left: [string, unknown], right: [string, unknown], title: string, reference?: string) {
  ensure(ctx, 42, title, reference);
  const gap = 14;
  const width = (CONTENT_WIDTH - gap) / 2;
  const xPositions = [MARGIN, MARGIN + width + gap];
  [left, right].forEach(([label, value], index) => {
    const x = xPositions[index];
    ctx.page.drawText(safe(label).toUpperCase(), { x, y: ctx.y, size: 7.5, font: ctx.bold, color: MUTED });
    ctx.page.drawText(clip(ctx.regular, value, width, 10), { x, y: ctx.y - 15, size: 10, font: ctx.regular, color: TEXT });
  });
  ctx.y -= 38;
}

function paragraph(ctx: PdfContext, value: unknown, title: string, reference?: string) {
  const lines = wrap(ctx.regular, value || "No information recorded.", CONTENT_WIDTH - 18, 9.5);
  for (let offset = 0; offset < lines.length; offset += 12) {
    const chunk = lines.slice(offset, offset + 12);
    ensure(ctx, chunk.length * 13 + 16, title, reference);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - chunk.length * 13 - 9, width: CONTENT_WIDTH, height: chunk.length * 13 + 14, borderColor: BORDER, borderWidth: 1, color: SOFT });
    chunk.forEach((line, index) => ctx.page.drawText(line, { x: MARGIN + 9, y: ctx.y - 12 - index * 13, size: 9.5, font: ctx.regular, color: TEXT }));
    ctx.y -= chunk.length * 13 + 20;
  }
}

function tableHeader(ctx: PdfContext, columns: { label: string; width: number }[]) {
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 21, width: CONTENT_WIDTH, height: 23, color: NAVY });
  let x = MARGIN + 5;
  for (const column of columns) {
    ctx.page.drawText(column.label, { x, y: ctx.y - 14, size: 7.2, font: ctx.bold, color: rgb(1, 1, 1) });
    x += column.width;
  }
  ctx.y -= 24;
}

function lineItems(ctx: PdfContext, rows: ExportRow[], title: string, reference?: string) {
  const columns = [
    { label: "Item / Service", width: 145 },
    { label: "Qty", width: 38 },
    { label: "Unit price", width: 72 },
    { label: "Total", width: 72 },
    { label: "Category", width: 85 },
    { label: "Suggested vendor", width: 103 },
  ];
  ensure(ctx, 55, title, reference);
  tableHeader(ctx, columns);
  const items = rows.filter((row) => row.item_name || row.item_description);
  if (!items.length) {
    ctx.page.drawText("No line items recorded.", { x: MARGIN + 6, y: ctx.y - 13, size: 9, font: ctx.regular, color: MUTED });
    ctx.y -= 26;
    return;
  }
  for (const row of items) {
    ensure(ctx, 31, title, reference);
    if (ctx.y > PAGE_HEIGHT - 135) tableHeader(ctx, columns);
    const values = [
      row.item_name || row.item_description,
      row.quantity,
      money(row.unit_price),
      money(row.item_total),
      row.item_category,
      row.suggested_vendor,
    ];
    let x = MARGIN + 5;
    values.forEach((value, index) => {
      const width = columns[index].width - 8;
      ctx.page.drawText(clip(ctx.regular, value, width, 7.4), { x, y: ctx.y - 13, size: 7.4, font: ctx.regular, color: TEXT });
      x += columns[index].width;
    });
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - 22 }, end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y - 22 }, thickness: 0.6, color: BORDER });
    ctx.y -= 25;
  }
}

function requestRegister(ctx: PdfContext, rows: ExportRow[], title: string) {
  const unique = new Map<string, ExportRow>();
  for (const row of rows) if (!unique.has(String(row.request_no))) unique.set(String(row.request_no), row);
  const columns = [
    { label: "Request", width: 128 },
    { label: "Department / Project", width: 105 },
    { label: "Category", width: 90 },
    { label: "Amount", width: 88 },
    { label: "Status", width: 104 },
  ];
  tableHeader(ctx, columns);
  for (const row of unique.values()) {
    ensure(ctx, 29, title);
    if (ctx.y > PAGE_HEIGHT - 135) tableHeader(ctx, columns);
    const values = [row.request_no, row.department_project, row.category, money(row.estimated_amount), row.status];
    let x = MARGIN + 5;
    values.forEach((value, index) => {
      const width = columns[index].width - 8;
      ctx.page.drawText(clip(ctx.regular, value, width, 7.6), { x, y: ctx.y - 13, size: 7.6, font: ctx.regular, color: TEXT });
      x += columns[index].width;
    });
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - 22 }, end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y - 22 }, thickness: 0.6, color: BORDER });
    ctx.y -= 25;
  }
}

function footer(pdf: PDFDocument, regular: PDFFont) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: PAGE_WIDTH - MARGIN, y: 42 }, thickness: 0.7, color: BORDER });
    page.drawText("CMOTD ProcureFlow - Controlled procurement record", { x: MARGIN, y: 27, size: 7.5, font: regular, color: MUTED });
    const pageText = `Page ${index + 1} of ${pages.length}`;
    page.drawText(pageText, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageText, 7.5), y: 27, size: 7.5, font: regular, color: MUTED });
  });
}

export async function buildRequestPdf(rows: ExportRow[], options: PdfOptions) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);
  const firstReference = options.requestSpecific ? safe(rows[0]?.request_no || "") : undefined;
  const ctx: PdfContext = { pdf, regular, bold, logo, page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: 0 };
  header(ctx, options.title, firstReference);

  if (!rows.length) {
    paragraph(ctx, "No request records were available for this export.", options.title, firstReference);
  } else if (!options.requestSpecific) {
    sectionTitle(ctx, "Request register", options.title);
    requestRegister(ctx, rows, options.title);
  } else {
    const row = rows[0];
    sectionTitle(ctx, "Request summary", options.title, firstReference);
    keyValueRow(ctx, ["Request number", row.request_no], ["Estimated amount", money(row.estimated_amount)], options.title, firstReference);
    keyValueRow(ctx, ["Requester", row.requester], ["Requester role", row.requester_role], options.title, firstReference);
    keyValueRow(ctx, ["Facility / Utility Head", row.facility_manager], ["Procurement Manager", row.procurement_manager], options.title, firstReference);
    keyValueRow(ctx, ["Department / Project", row.department_project], ["Category", row.category], options.title, firstReference);
    keyValueRow(ctx, ["Priority", row.priority], ["Required date", dateText(row.required_date)], options.title, firstReference);
    keyValueRow(ctx, ["Status", row.status], ["Payment status", row.payment_status], options.title, firstReference);
    keyValueRow(ctx, ["Next role", row.next_role], ["Submitted", dateText(row.submitted_at)], options.title, firstReference);

    sectionTitle(ctx, "Business justification", options.title, firstReference);
    paragraph(ctx, row.justification, options.title, firstReference);

    sectionTitle(ctx, "Line items", options.title, firstReference);
    lineItems(ctx, rows, options.title, firstReference);

    sectionTitle(ctx, "Payment recipient", options.title, firstReference);
    keyValueRow(ctx, ["Payee type", row.payee_type], ["Payee", row.payee_name], options.title, firstReference);
    keyValueRow(ctx, ["Account name", row.account_name], ["Bank", row.bank], options.title, firstReference);
    keyValueRow(ctx, ["Account number", row.account_number], ["Currency", row.currency || "NGN"], options.title, firstReference);
    keyValueRow(ctx, ["Payment readiness", row.payment_readiness], ["Verification", row.payee_verification], options.title, firstReference);

    sectionTitle(ctx, "Record information", options.title, firstReference);
    keyValueRow(ctx, ["Request date", dateText(row.request_date)], ["Last updated", dateText(row.updated_at)], options.title, firstReference);
    keyValueRow(ctx, ["Source", row.source_type], ["Vendor preference", row.vendor_preference], options.title, firstReference);
  }

  footer(pdf, regular);
  return pdf.save();
}

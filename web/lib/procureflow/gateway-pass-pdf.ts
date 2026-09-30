import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFPage, PDFFont, PDFImage, StandardFonts, rgb } from "pdf-lib";

export type GatewayPassPdfInput = {
  passNumber: string;
  status: string | null;
  department: string | null;
  movementType: string;
  purpose: string;
  originLocation: string | null;
  destination: string | null;
  expectedMovementDate: string | null;
  expectedReturnDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  receiverName: string | null;
  receiverOrganization: string | null;
  facilityManagerName: string | null;
  reviewedByName: string | null;
  procurementReviewNote: string | null;
  approvedByName: string | null;
  approvedByRole: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  securityCheckpoint: string | null;
  securityOfficerName: string | null;
  gateVerificationTime: string | null;
  exitEntryConfirmation: string | null;
  logisticsStatus: string | null;
  logisticsDeliveryReference: string | null;
  logisticsWaybillNumber: string | null;
  items: Array<{
    item_description: string;
    item_category?: string | null;
    quantity: number | string;
    unit_of_measure?: string | null;
    quality_condition?: string | null;
    serial_number?: string | null;
    asset_tag?: string | null;
    fragility_status?: string | null;
    handling_instruction?: string | null;
    remarks?: string | null;
    colour?: string | null;
  }>;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 36;
const RIGHT = PAGE_W - 36;
const CONTENT_W = RIGHT - LEFT;
const FOOTER_TOP = 51;
const NAVY = rgb(13 / 255, 41 / 255, 71 / 255);
const BLUE = rgb(27 / 255, 95 / 255, 171 / 255);
const PALE = rgb(243 / 255, 247 / 255, 251 / 255);
const LINE = rgb(204 / 255, 217 / 255, 229 / 255);
const MUTED = rgb(95 / 255, 113 / 255, 130 / 255);
const INK = rgb(22 / 255, 40 / 255, 58 / 255);
const WHITE = rgb(1, 1, 1);

function roleLabel(value: unknown) {
  const role = String(value || "").trim();
  return role === "Logistics Officer" ? "Logistics Manager" : role || "-";
}

function quantityText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "-");
  return String(Math.max(0, Math.round(number)));
}

function dateText(value: unknown, includeTime = false) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
    timeZone: "Africa/Lagos",
  }).format(date);
}

function safe(value: unknown) {
  return String(value ?? "-").replace(/[\r\n]+/g, " ").trim() || "-";
}

function wrapText(font: PDFFont, text: unknown, size: number, maxWidth: number, maxLines = 3) {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  const pushLongWord = (word: string) => {
    let part = "";
    for (const ch of word) {
      const next = part + ch;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) part = next;
      else {
        if (part) lines.push(part);
        part = ch;
        if (lines.length >= maxLines) break;
      }
    }
    return part;
  };

  for (const word of words) {
    if (lines.length >= maxLines) break;
    const candidate = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      if (lines.length >= maxLines) break;
    }
    if (font.widthOfTextAtSize(word, size) <= maxWidth) current = word;
    else current = pushLongWord(word);
  }
  if (current && lines.length < maxLines) lines.push(current);

  const raw = safe(text);
  const joined = lines.join(" ");
  if (joined.length < raw.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && font.widthOfTextAtSize(last + "...", size) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "...";
  }
  return lines.length ? lines : ["-"];
}

function fitSize(font: PDFFont, text: unknown, preferred: number, maxWidth: number, min = 6) {
  const raw = safe(text);
  let size = preferred;
  while (size > min && font.widthOfTextAtSize(raw, size) > maxWidth) size -= 0.25;
  return size;
}

function drawLines(page: PDFPage, font: PDFFont, lines: string[], x: number, y: number, size: number, color = INK, lineHeight = size + 2) {
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, font, size, color }));
}

function drawBox(page: PDFPage, x: number, y: number, width: number, height: number, fill = WHITE) {
  page.drawRectangle({ x, y, width, height, color: fill, borderColor: LINE, borderWidth: 0.65 });
}

function drawField(page: PDFPage, fonts: Fonts, x: number, y: number, width: number, height: number, label: string, value: unknown, maxLines = 2) {
  page.drawText(label.toUpperCase(), { x: x + 8, y: y + height - 13, font: fonts.helveticaBold, size: 6.6, color: MUTED });
  const lines = wrapText(fonts.helvetica, value, 8.4, width - 16, maxLines);
  drawLines(page, fonts.helvetica, lines, x + 8, y + height - 29, 8.4, INK, 10);
}

type Fonts = {
  helvetica: PDFFont;
  helveticaBold: PDFFont;
  times: PDFFont;
  timesBold: PDFFont;
  timesItalic: PDFFont;
};

type Branding = {
  rsu: PDFImage | null;
  cmotd: PDFImage | null;
};

async function loadBranding(pdf: PDFDocument): Promise<Branding> {
  const brandingDir = path.join(process.cwd(), "public", "branding");
  const embed = async (filename: string) => {
    try {
      const bytes = fs.readFileSync(path.join(brandingDir, filename));
      return await pdf.embedPng(bytes);
    } catch {
      return null;
    }
  };
  return { rsu: await embed("rsu_logo.png"), cmotd: await embed("cmotd_logo.png") };
}

function drawImageFit(page: PDFPage, image: PDFImage | null, x: number, y: number, width: number, height: number) {
  if (!image) return;
  const ratio = image.width / image.height;
  let drawW = width;
  let drawH = width / ratio;
  if (drawH > height) {
    drawH = height;
    drawW = height * ratio;
  }
  page.drawImage(image, { x: x + (width - drawW) / 2, y: y + (height - drawH) / 2, width: drawW, height: drawH });
}

function drawInstitutionHeader(page: PDFPage, fonts: Fonts, branding: Branding) {
  drawImageFit(page, branding.rsu, 36, 748, 62, 62);
  drawImageFit(page, branding.cmotd, PAGE_W - 98, 748, 62, 62);

  const title1 = "Centre For Marine and Offshore Technology Development (CMOTD)";
  const title2 = "Consultancy Services Unit, Rivers State University";
  const tagline = "Where Theory becomes Reality and Individuals are Equipped to Lead in the Industry!";
  const titleSize = fitSize(fonts.timesBold, title1, 13.3, 390, 10.5);
  page.drawText(title1, { x: (PAGE_W - fonts.timesBold.widthOfTextAtSize(title1, titleSize)) / 2, y: 794, font: fonts.timesBold, size: titleSize, color: rgb(0, 0, 0) });
  page.drawText(title2, { x: (PAGE_W - fonts.timesBold.widthOfTextAtSize(title2, 11.7)) / 2, y: 775, font: fonts.timesBold, size: 11.7, color: rgb(0, 0, 0) });
  const tagSize = fitSize(fonts.timesItalic, tagline, 9.7, 395, 8.2);
  page.drawText(tagline, { x: (PAGE_W - fonts.timesItalic.widthOfTextAtSize(tagline, tagSize)) / 2, y: 758, font: fonts.timesItalic, size: tagSize, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x: LEFT, y: 740 }, end: { x: RIGHT, y: 740 }, thickness: 1.15, color: BLUE });
}

function drawBanner(page: PDFPage, fonts: Fonts, input: GatewayPassPdfInput, continuation = false) {
  page.drawRectangle({ x: LEFT, y: 686, width: CONTENT_W, height: 44, color: NAVY });
  const title = continuation ? "GATEWAY PASS - CONTINUED" : "GATEWAY PASS";
  page.drawText(title, { x: 52, y: 703, font: fonts.helveticaBold, size: continuation ? 12.5 : 15, color: WHITE });
  const controlled = "PROCUREFLOW CONTROLLED DOCUMENT";
  page.drawText(controlled, { x: RIGHT - fonts.helveticaBold.widthOfTextAtSize(controlled, 8.3) - 12, y: 713, font: fonts.helveticaBold, size: 8.3, color: WHITE });
  const passSize = fitSize(fonts.helvetica, input.passNumber, 8.2, 245, 6.8);
  page.drawText(input.passNumber, { x: RIGHT - fonts.helvetica.widthOfTextAtSize(input.passNumber, passSize) - 12, y: 699, font: fonts.helvetica, size: passSize, color: WHITE });
}

function drawFooter(page: PDFPage, fonts: Fonts, pageIndex: number, pageCount: number) {
  page.drawLine({ start: { x: LEFT, y: FOOTER_TOP }, end: { x: RIGHT, y: FOOTER_TOP }, thickness: 0.8, color: BLUE });
  const address = "Consultancy Unit, Rivers State University, Nkpolu-Oroworokwo, Port Harcourt, Rivers State";
  const contact = "Email: info@cmotd.org   |   Phone NO.: +2349163505000";
  page.drawText(address, { x: (PAGE_W - fonts.times.widthOfTextAtSize(address, 7.4)) / 2, y: 37, font: fonts.times, size: 7.4, color: INK });
  page.drawText(contact, { x: (PAGE_W - fonts.times.widthOfTextAtSize(contact, 7.1)) / 2, y: 26, font: fonts.times, size: 7.1, color: INK });
  const controlled = "Generated by ProcureFlow | Controlled copy | Validate status in the live system";
  page.drawText(controlled, { x: LEFT, y: 13, font: fonts.helvetica, size: 6.1, color: MUTED });
  const pageText = `Page ${pageIndex + 1} of ${pageCount}`;
  page.drawText(pageText, { x: RIGHT - fonts.helvetica.widthOfTextAtSize(pageText, 6.1), y: 13, font: fonts.helvetica, size: 6.1, color: MUTED });
}

function drawFirstPageDetails(page: PDFPage, fonts: Fonts, input: GatewayPassPdfInput) {
  let y = 674;
  drawBox(page, LEFT, y - 26, CONTENT_W, 26, PALE);
  page.drawText("STATUS", { x: 48, y: y - 17, font: fonts.helveticaBold, size: 6.5, color: MUTED });
  page.drawText(safe(input.status || "Draft").toUpperCase(), { x: 92, y: y - 17, font: fonts.helveticaBold, size: 8.4, color: BLUE });
  page.drawText("DEPARTMENT", { x: 262, y: y - 17, font: fonts.helveticaBold, size: 6.5, color: MUTED });
  const deptSize = fitSize(fonts.helveticaBold, input.department || "-", 8.4, 215, 6.5);
  page.drawText(safe(input.department || "-"), { x: 328, y: y - 17, font: fonts.helveticaBold, size: deptSize, color: INK });
  y -= 38;

  const moveH = 70;
  drawBox(page, LEFT, y - moveH, CONTENT_W, moveH);
  const mid = PAGE_W / 2;
  page.drawLine({ start: { x: mid, y: y - moveH }, end: { x: mid, y }, thickness: 0.65, color: LINE });
  drawField(page, fonts, LEFT, y - 34, mid - LEFT, 34, "Movement Type", input.movementType);
  drawField(page, fonts, mid, y - 34, RIGHT - mid, 34, "Expected Movement", dateText(input.expectedMovementDate));
  drawField(page, fonts, LEFT, y - moveH, mid - LEFT, 34, "Origin", input.originLocation || "-");
  drawField(page, fonts, mid, y - moveH, RIGHT - mid, 34, "Destination", input.destination || "-");
  y -= 82;

  drawBox(page, LEFT, y - 44, CONTENT_W, 44);
  drawField(page, fonts, LEFT, y - 44, CONTENT_W, 44, "Purpose", input.purpose, 2);
  y -= 60;

  page.drawText("MOVEMENT & RECEIVER DETAILS", { x: LEFT, y, font: fonts.helveticaBold, size: 9.5, color: NAVY });
  y -= 12;
  const detailsH = 54;
  drawBox(page, LEFT, y - detailsH, CONTENT_W, detailsH);
  const cell = CONTENT_W / 3;
  page.drawLine({ start: { x: LEFT + cell, y: y - detailsH }, end: { x: LEFT + cell, y }, thickness: 0.65, color: LINE });
  page.drawLine({ start: { x: LEFT + cell * 2, y: y - detailsH }, end: { x: LEFT + cell * 2, y }, thickness: 0.65, color: LINE });
  drawField(page, fonts, LEFT, y - 27, cell, 27, "Vehicle", input.vehicleNumber || "-");
  drawField(page, fonts, LEFT + cell, y - 27, cell, 27, "Driver", input.driverName || "-");
  drawField(page, fonts, LEFT + cell * 2, y - 27, cell, 27, "Driver Phone", input.driverPhone || "-");
  drawField(page, fonts, LEFT, y - detailsH, cell, 27, "Expected Return", dateText(input.expectedReturnDate));
  drawField(page, fonts, LEFT + cell, y - detailsH, cell, 27, "Receiver", input.receiverName || "-");
  drawField(page, fonts, LEFT + cell * 2, y - detailsH, cell, 27, "Organisation", input.receiverOrganization || "-");
  return y - 68;
}

const ITEM_COLS = [LEFT, 58, 300, 344, 392, 463, RIGHT];

function drawItemsHeader(page: PDFPage, fonts: Fonts, y: number, continued = false) {
  page.drawText(continued ? "ITEMS / ASSETS - CONTINUED" : "ITEMS / ASSETS", { x: LEFT, y, font: fonts.helveticaBold, size: 9.5, color: NAVY });
  y -= 10;
  page.drawRectangle({ x: LEFT, y: y - 22, width: CONTENT_W, height: 22, color: NAVY });
  ["#", "Description", "Qty", "Unit", "Condition", "Serial / Asset"].forEach((heading, index) => {
    page.drawText(heading, { x: ITEM_COLS[index] + 5, y: y - 15, font: fonts.helveticaBold, size: 6.8, color: WHITE });
  });
  return y - 22;
}

function itemRowHeight(fonts: Fonts, item: GatewayPassPdfInput["items"][number]) {
  const desc = wrapText(fonts.helvetica, item.item_description, 7.8, ITEM_COLS[2] - ITEM_COLS[1] - 10, 3);
  const serial = wrapText(fonts.helvetica, [item.serial_number, item.asset_tag].filter(Boolean).join(" / ") || "-", 7.2, RIGHT - ITEM_COLS[5] - 10, 2);
  return Math.max(27, 12 + Math.max(desc.length, serial.length) * 9);
}

function drawItemRow(page: PDFPage, fonts: Fonts, y: number, item: GatewayPassPdfInput["items"][number], index: number, rowHeight: number) {
  drawBox(page, LEFT, y - rowHeight, CONTENT_W, rowHeight, index % 2 === 0 ? PALE : WHITE);
  ITEM_COLS.slice(1, -1).forEach((x) => page.drawLine({ start: { x, y: y - rowHeight }, end: { x, y }, thickness: 0.55, color: LINE }));
  const desc = wrapText(fonts.helvetica, item.item_description, 7.8, ITEM_COLS[2] - ITEM_COLS[1] - 10, 3);
  const condition = [item.quality_condition, item.fragility_status && item.fragility_status !== "Normal" ? item.fragility_status : null].filter(Boolean).join(" / ") || "-";
  const serial = [item.serial_number, item.asset_tag].filter(Boolean).join(" / ") || "-";
  page.drawText(String(index + 1), { x: ITEM_COLS[0] + 6, y: y - 17, font: fonts.helvetica, size: 7.8, color: INK });
  drawLines(page, fonts.helvetica, desc, ITEM_COLS[1] + 6, y - 17, 7.8, INK, 9);
  page.drawText(quantityText(item.quantity), { x: ITEM_COLS[2] + 7, y: y - 17, font: fonts.helvetica, size: 7.8, color: INK });
  page.drawText(safe(item.unit_of_measure || "-"), { x: ITEM_COLS[3] + 6, y: y - 17, font: fonts.helvetica, size: 7.6, color: INK });
  drawLines(page, fonts.helvetica, wrapText(fonts.helvetica, condition, 7.4, ITEM_COLS[5] - ITEM_COLS[4] - 10, 2), ITEM_COLS[4] + 6, y - 17, 7.4, INK, 9);
  drawLines(page, fonts.helvetica, wrapText(fonts.helvetica, serial, 7.2, RIGHT - ITEM_COLS[5] - 10, 2), ITEM_COLS[5] + 6, y - 17, 7.2, INK, 9);
  return y - rowHeight;
}

function drawAuthorization(page: PDFPage, fonts: Fonts, input: GatewayPassPdfInput, y: number) {
  page.drawText("AUTHORIZATION & CONTROL", { x: LEFT, y, font: fonts.helveticaBold, size: 9.5, color: NAVY });
  y -= 10;
  const height = 66;
  drawBox(page, LEFT, y - height, CONTENT_W, height);
  const cell = CONTENT_W / 3;
  page.drawLine({ start: { x: LEFT + cell, y: y - height }, end: { x: LEFT + cell, y }, thickness: 0.65, color: LINE });
  page.drawLine({ start: { x: LEFT + cell * 2, y: y - height }, end: { x: LEFT + cell * 2, y }, thickness: 0.65, color: LINE });
  drawField(page, fonts, LEFT, y - height, cell, height, "Utility / Facility Head", input.facilityManagerName || "-");
  drawField(page, fonts, LEFT + cell, y - height, cell, height, "Approved By", input.approvedByName || roleLabel(input.approvedByRole) || "Pending");
  drawField(page, fonts, LEFT + cell * 2, y - height, cell, height, "Approval Date", dateText(input.approvedAt, true));

  page.drawText("APPROVAL NOTE", { x: LEFT + 8, y: y - height + 10, font: fonts.helveticaBold, size: 6.2, color: MUTED });
  const approvalText = [roleLabel(input.approvedByRole), input.approvalNote || input.procurementReviewNote].filter(Boolean).join(" - ") || "-";
  const approvalSize = fitSize(fonts.helvetica, approvalText, 6.8, CONTENT_W - 78, 5.8);
  page.drawText(approvalText, { x: LEFT + 76, y: y - height + 10, font: fonts.helvetica, size: approvalSize, color: INK });
  return y - height - 16;
}

function drawSecurity(page: PDFPage, fonts: Fonts, input: GatewayPassPdfInput, y: number) {
  page.drawText("SECURITY / LOGISTICS CHECKPOINT", { x: LEFT, y, font: fonts.helveticaBold, size: 9.5, color: NAVY });
  y -= 10;
  const height = 42;
  drawBox(page, LEFT, y - height, CONTENT_W, height);
  const cell = CONTENT_W / 4;
  for (let i = 1; i < 4; i++) page.drawLine({ start: { x: LEFT + cell * i, y: y - height }, end: { x: LEFT + cell * i, y }, thickness: 0.65, color: LINE });
  const values = [
    ["Checkpoint", input.securityCheckpoint || "To be completed"],
    ["Security Officer", input.securityOfficerName || "To be completed"],
    ["Gate Verification", input.gateVerificationTime ? dateText(input.gateVerificationTime, true) : "To be completed"],
    ["Movement Status", input.exitEntryConfirmation || input.logisticsStatus || "Pending"],
  ];
  values.forEach(([label, value], index) => drawField(page, fonts, LEFT + cell * index, y - height, cell, height, label, value, 2));
}

export async function gatewayPassPdf(input: GatewayPassPdfInput) {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    helvetica: await pdf.embedFont(StandardFonts.Helvetica),
    helveticaBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    times: await pdf.embedFont(StandardFonts.TimesRoman),
    timesBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    timesItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };
  const branding = await loadBranding(pdf);
  const pages: PDFPage[] = [];

  const addPage = (continuation = false) => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    drawInstitutionHeader(page, fonts, branding);
    drawBanner(page, fonts, input, continuation);
    return page;
  };

  let page = addPage(false);
  let y = drawFirstPageDetails(page, fonts, input);
  y = drawItemsHeader(page, fonts, y, false);

  input.items.forEach((item, index) => {
    const rowHeight = itemRowHeight(fonts, item);
    const reserveForAuthorization = 174;
    if (y - rowHeight < FOOTER_TOP + reserveForAuthorization) {
      page = addPage(true);
      y = drawItemsHeader(page, fonts, 666, true);
    }
    y = drawItemRow(page, fonts, y, item, index, rowHeight);
  });

  if (y < FOOTER_TOP + 150) {
    page = addPage(true);
    y = 666;
  } else {
    y -= 18;
  }
  y = drawAuthorization(page, fonts, input, y);
  drawSecurity(page, fonts, input, y);

  pages.forEach((current, index) => drawFooter(current, fonts, index, pages.length));
  pdf.setTitle(`${input.passNumber} - CMOTD Gateway Pass`);
  pdf.setSubject("ProcureFlow controlled gateway pass");
  pdf.setAuthor("Centre For Marine and Offshore Technology Development (CMOTD)");
  return Buffer.from(await pdf.save());
}

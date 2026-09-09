import fs from "node:fs";
import path from "node:path";

const root = "/app";
const MARKER = "DARK_PICKER_HOVER_PAYEE_FIX_V1";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}
function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}
function requireContains(source, marker, label) {
  if (!source.includes(marker)) throw new Error(`Dark/payee/inbox fix could not confirm ${label}.`);
}

// 1) PostgreSQL: ICT return-routing introduced a LEFT JOIN before a row lock.
// Lock only the purchase_requests row so the nullable requester join is never locked.
{
  const relativePath = "lib/procureflow/procurement-actions.ts";
  let source = read(relativePath);
  const unsafe = "WHERE pr.id = ${requestId}\n      FOR UPDATE";
  const safe = "WHERE pr.id = ${requestId}\n      FOR UPDATE OF pr";
  if (source.includes(unsafe)) source = source.replace(unsafe, safe);
  requireContains(source, "FOR UPDATE OF pr", "Procurement Inbox row-lock repair");
  write(relativePath, source);
}

// Also repair the known PO release outer-join lock while this final safety patch is materialized.
{
  const relativePath = "lib/procureflow/parity-actions.ts";
  let source = read(relativePath);
  source = source.replace(
    "FROM purchase_orders po LEFT JOIN purchase_requests pr ON pr.id=po.request_id WHERE po.id=${poId} FOR UPDATE`",
    "FROM purchase_orders po LEFT JOIN purchase_requests pr ON pr.id=po.request_id WHERE po.id=${poId} FOR UPDATE OF po`",
  );
  write(relativePath, source);
}

// 2) Add controlled, audited full payee/account detail reveal to Facility/ICT request detail.
{
  const relativePath = "components/facility-request-register.tsx";
  let source = read(relativePath);
  const importLine = 'import { PayeeDetailsReveal } from "@/components/payee-details-reveal";';
  if (!source.includes(importLine)) {
    const marker = 'import { RequestDraftEditor } from "@/components/request-draft-editor";';
    requireContains(source, marker, "Facility request editor import");
    source = source.replace(marker, `${marker}\n${importLine}`);
  }
  if (!source.includes("<PayeeDetailsReveal requestId={selectedId}")) {
    const marker = '<span>Verification: <b>{detail.payee?.verification_status || "Pending"}</b></span></div></div>';
    requireContains(source, marker, "Facility payment recipient summary");
    source = source.replace(
      marker,
      '<span>Verification: <b>{detail.payee?.verification_status || "Pending"}</b></span></div><PayeeDetailsReveal requestId={selectedId} available={Boolean(detail.payee?.recipient_known)} /></div>',
    );
  }
  requireContains(source, "PayeeDetailsReveal", "Facility/ICT account reveal");
  write(relativePath, source);
}

// 3) Procurement gets the same controlled reveal in the shared Facility/ICT Inbox.
{
  const relativePath = "components/procurement-inbox-v3.tsx";
  let source = read(relativePath);
  const importLine = 'import { PayeeDetailsReveal } from "@/components/payee-details-reveal";';
  if (!source.includes(importLine)) {
    const marker = 'import { requestConfirmation } from "@/components/in-app-confirmation";';
    requireContains(source, marker, "Procurement Inbox confirmation import");
    source = source.replace(marker, `${marker}\n${importLine}`);
  }
  if (!source.includes("<PayeeDetailsReveal requestId={selectedId}")) {
    const marker = '<span>Verification<b>{detail.payee?.verification_status || "Pending"}</b></span></div></div>';
    requireContains(source, marker, "Procurement Inbox payment recipient summary");
    source = source.replace(
      marker,
      '<span>Verification<b>{detail.payee?.verification_status || "Pending"}</b></span></div><PayeeDetailsReveal requestId={selectedId} available={Boolean(detail.payee?.recipient_known)} /></div>',
    );
  }
  requireContains(source, "PayeeDetailsReveal", "Procurement account reveal");
  write(relativePath, source);
}

// 4) Dark-mode consistency for request selectors and table hover states, plus reveal presentation.
{
  const relativePath = "app/local-preview-parity.css";
  let source = read(relativePath);
  if (!source.includes(MARKER)) {
    source += `

/* ${MARKER} */
.facility-request-picker,.procurement-request-picker{background:var(--pf-surface)!important;color:var(--pf-text)!important;border-color:var(--pf-border)!important}
.facility-request-picker label>span,.procurement-request-picker label>span{color:var(--pf-text)!important}
.facility-request-picker small,.procurement-request-picker small{color:var(--pf-muted)!important;opacity:1!important}
.facility-request-picker select,.procurement-request-picker select{background:var(--pf-surface-2)!important;color:var(--pf-text)!important;border-color:var(--pf-border-strong)!important}
html[data-theme="dark"] .facility-request-picker select option,html[data-theme="dark"] .procurement-request-picker select option{background:#273047!important;color:#f5f7fb!important}
html[data-theme="dark"] .data-table tbody tr:hover{background:rgba(85,110,230,.16)!important}
html[data-theme="dark"] .data-table tbody tr:hover td{background:transparent!important;color:var(--pf-text)!important}
html[data-theme="dark"] .data-table tbody tr:hover td strong,html[data-theme="dark"] .data-table tbody tr:hover td small,html[data-theme="dark"] .data-table tbody tr:hover td a{color:var(--pf-text)!important}
.payee-reveal-shell{margin-top:12px;padding:12px;border:1px solid var(--pf-border);border-radius:8px;background:var(--pf-surface-2);color:var(--pf-text)}
.payee-reveal-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.payee-reveal-head>div{min-width:0}.payee-reveal-head strong{display:block;font-size:13.5px}.payee-reveal-head span{display:flex;align-items:center;gap:5px;margin-top:3px;color:var(--pf-muted);font-size:11.5px}
.payee-reveal-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:8px 11px;border:1px solid var(--pf-primary);border-radius:7px;background:var(--pf-primary);color:#fff;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap}.payee-reveal-button.secondary{background:var(--pf-surface);color:var(--pf-text);border-color:var(--pf-border-strong)}.payee-reveal-button:disabled{opacity:.55;cursor:wait}
.payee-reveal-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.payee-reveal-grid article{min-width:0;padding:9px 10px;border:1px solid var(--pf-border);border-radius:7px;background:var(--pf-surface)}.payee-reveal-grid article span{display:block;color:var(--pf-muted);font-size:11px}.payee-reveal-grid article strong{display:block;margin-top:3px;color:var(--pf-text);font-size:13px;overflow-wrap:anywhere}.payee-account-number{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;letter-spacing:.05em}.payee-reveal-disabled{margin-top:10px;padding:9px 10px;border-radius:7px;background:var(--pf-surface-2);color:var(--pf-muted);font-size:12px}.payee-reveal-error{margin-top:10px!important}
@media(max-width:1100px){.payee-reveal-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.payee-reveal-head{align-items:flex-start;flex-direction:column}.payee-reveal-button{width:100%}.payee-reveal-grid{grid-template-columns:1fr}}
`;
  }
  requireContains(source, MARKER, "dark picker/hover styles");
  write(relativePath, source);
}

console.log("Dark picker/hover + payee reveal + Procurement Inbox row-lock fixes applied.");

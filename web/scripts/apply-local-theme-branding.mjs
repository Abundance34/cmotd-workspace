import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const root = "/app";
const brandingDir = path.join(root, "public", "branding");
const sourceDir = path.join(root, "branding-source");
fs.mkdirSync(brandingDir, { recursive: true });

function sourceSvg(name) {
  return gunzipSync(fs.readFileSync(path.join(sourceDir, name))).toString("utf8");
}

const fullDark = sourceSvg("logo_full_dark.svg.gz");
const compactDark = sourceSvg("logo_dark.svg.gz");

// These reproduce the user's supplied white-on-dark variants byte-for-byte.
const fullLight = fullDark
  .replaceAll("#040404", "#fefefe")
  .replace("      }\n\n      .cls-3", "      }\n      .cls-3");
const compactLight = compactDark.replaceAll("#040404", "#fefefe");

const assets = {
  "cmotd_logo_full_dark.svg": [fullDark, "5eca8335e2ab70d80775ae5c26ea2713395890f55db05203bdf4433bd7bb4ee1"],
  "cmotd_logo_full_light.svg": [fullLight, "40e4d5f395c4ffa5d34c833a10214c3740b0fd5db0070e955f013cd81e45975e"],
  "cmotd_logo_dark.svg": [compactDark, "c51577b9107dfe43e25d8e01cc3c007e451892dbab0df3a5e6b05ee2e9e1be1e"],
  "cmotd_logo_light.svg": [compactLight, "44a1fccc2c437928b0bed7796af86e7c17e9bde506dbb4c5c54ade6ccd879aa9"],
};

for (const [name, [content, expectedHash]] of Object.entries(assets)) {
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  if (digest !== expectedHash) throw new Error(`CMOTD logo integrity check failed for ${name}: ${digest}`);
  fs.writeFileSync(path.join(brandingDir, name), content, "utf8");
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}
function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}

// Replace the temporary PF / ProcureFlow / Command Centre block with the CMOTD wordmark.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);
  const oldBrand = '<div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Command Centre</small></div></div>';
  const newBrand = '<div className="sidebar-brand sidebar-brand-cmotd" aria-label="CMOTD ProcureFlow"><Image src="/branding/cmotd_logo_full_dark.svg" alt="CMOTD" width={220} height={46} className="sidebar-brand-wordmark sidebar-brand-wordmark-light" priority/><Image src="/branding/cmotd_logo_full_light.svg" alt="" aria-hidden="true" width={220} height={46} className="sidebar-brand-wordmark sidebar-brand-wordmark-dark" priority/></div>';
  if (source.includes(oldBrand)) source = source.replace(oldBrand, newBrand);
  else if (!source.includes("sidebar-brand-cmotd")) throw new Error("Local branding patch could not find the sidebar brand.");

  // Use the same black/white pair for the page-heading wordmark so dark mode remains legible everywhere.
  const oldHeader = '<Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark"/>';
  const newHeader = '<div className="header-wordmark-theme" aria-label="CMOTD"><Image src="/branding/cmotd_logo_full_dark.svg" alt="CMOTD" width={245} height={60} className="header-wordmark header-wordmark-light"/><Image src="/branding/cmotd_logo_full_light.svg" alt="" aria-hidden="true" width={245} height={60} className="header-wordmark header-wordmark-dark"/></div>';
  if (source.includes(oldHeader)) source = source.replace(oldHeader, newHeader);
  else if (!source.includes("header-wordmark-theme")) throw new Error("Local branding patch could not find the page-heading wordmark.");

  write(relativePath, source);
}

{
  const relativePath = "app/local-preview-parity.css";
  let source = read(relativePath);
  const marker = "/* CMOTD theme-aware branding */";
  if (!source.includes(marker)) {
    source += `\n\n${marker}\n.sidebar-brand-cmotd{min-height:76px!important;padding:10px 18px 12px!important;justify-content:flex-start!important;gap:0!important;overflow:hidden}\n.sidebar-brand-wordmark{display:block;width:min(100%,205px)!important;max-width:205px!important;height:auto!important;object-fit:contain!important;object-position:left center!important;flex:0 1 auto}\n.sidebar-brand-wordmark-dark,.header-wordmark-dark{display:none!important}\nhtml[data-theme="dark"] .sidebar-brand-wordmark-light,html[data-theme="dark"] .header-wordmark-light{display:none!important}\nhtml[data-theme="dark"] .sidebar-brand-wordmark-dark,html[data-theme="dark"] .header-wordmark-dark{display:block!important}\n.header-wordmark-theme{width:190px;min-width:190px;display:flex;align-items:center;justify-content:flex-end}\n.header-wordmark-theme .header-wordmark{display:block;width:190px!important;max-width:190px!important;height:auto!important;object-fit:contain!important;opacity:.94}\n@media(max-width:1050px){.header-wordmark-theme{display:none!important}}\n@media(max-width:800px){.sidebar-brand-cmotd{min-height:70px!important}.sidebar-brand-wordmark{max-width:190px!important}}\n`;
  }
  write(relativePath, source);
}

console.log("Local CMOTD branding applied: black full logo on light mode, white full logo on dark mode, with all four supplied SVG variants installed.");

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const roles = read("lib/procureflow/roles.ts");
const shell = read("components/complete-role-shell.tsx");
const parity = read("components/parity-workspace.tsx");
const logistics = read("components/complete-logistics-workspace.tsx");
const draft = read("components/facility-draft-form.tsx");
const sourcing = read("components/procurement-sourcing.tsx");
const appPage = read("app/app/page.tsx");
const loginPage = read("app/page.tsx");
const loginScreen = read("components/login-screen.tsx");
const previewPage = read("app/preview/page.tsx");
const runtime = [shell, parity, logistics, draft, sourcing, appPage, loginPage, loginScreen].join("\n");

const sectionBlocks = [...roles.matchAll(/sections:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]);
const sections = [...new Set(sectionBlocks.flatMap((block) => [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1])))];
const common = new Set(["Income", "Settings"]);
const uncovered = sections.filter((section) => {
  if (common.has(section) || section.toLowerCase().includes("dashboard")) return false;
  return !shell.includes(`"${section}"`) && !parity.includes(`"${section}"`) && !logistics.includes(`"${section}"`);
});

const errors = [];
if (!sections.length) errors.push("No role navigation sections could be parsed from roles.ts.");
if (uncovered.length) errors.push(`Navigation sections without an explicit production implementation: ${uncovered.join(", ")}`);

const stalePhrases = [
  "being ported separately",
  "attachments will be enabled",
  "next in the migration queue",
  "coming soon",
  "live business data is deliberately not connected yet",
  "procureflow migration build",
  "open migration interface preview",
];
for (const phrase of stalePhrases) {
  if (runtime.toLowerCase().includes(phrase.toLowerCase())) errors.push(`Stale migration copy remains in production runtime: "${phrase}"`);
}

if (!draft.includes('/api/facility/requests/documents')) errors.push("Facility draft form is missing the secure supporting-document upload endpoint.");
if (!draft.includes('type="file" multiple')) errors.push("Facility draft form is missing multi-file supporting-document selection.");
if (!sourcing.includes('/api/procurement/sourcing/quotes/document')) errors.push("Vendor quote collection is missing inline quotation-document storage.");
if (!logistics.includes('/api/logistics/receiving/proof')) errors.push("Receiving workflow is missing inline proof-of-delivery storage.");
if (!appPage.includes("CompleteRoleShell")) errors.push("Authenticated production /app is not using CompleteRoleShell.");
if (!previewPage.includes('process.env.VERCEL_ENV === "production"') || !previewPage.includes("notFound()")) errors.push("Legacy preview is not explicitly disabled in production.");
if (!loginPage.includes('process.env.VERCEL_ENV !== "production"') || loginPage.includes("MIGRATION_PREVIEW")) errors.push("Production login can still expose the legacy migration preview flag.");

if (errors.length) {
  console.error("ProcureFlow feature-parity guard FAILED:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`ProcureFlow feature-parity guard passed: ${sections.length} navigation sections mapped; inline Facility/quote/receiving evidence capture connected; production migration copy absent.`);

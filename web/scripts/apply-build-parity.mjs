import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const rootPosix = root.replaceAll("\\", "/");

const scripts = [
  "apply-local-parity-overlay.mjs",
  "apply-local-procurement-notification-parity.mjs",
  "apply-local-procurement-request-register.mjs",
  "apply-local-request-authoring-parity.mjs",
  "apply-local-in-app-confirmations.mjs",
  "apply-local-theme-branding.mjs",
  "apply-local-final-ui-polish.mjs",
  "apply-production-usability-fixes.mjs",
  "apply-facility-request-history-context.mjs",
  "apply-reimbursement-draft-delete.mjs",
  "apply-reimbursement-all-role-shell.mjs",
  "apply-ict-inbox-batch.mjs",
  "apply-reimbursement-evidence-lowvalue.mjs",
];

function alreadyMaterialized() {
  const shellPath = path.join(root, "components", "complete-role-shell.tsx");
  const layoutPath = path.join(root, "app", "layout.tsx");
  if (!fs.existsSync(shellPath) || !fs.existsSync(layoutPath)) return false;
  const shell = fs.readFileSync(shellPath, "utf8");
  const layout = fs.readFileSync(layoutPath, "utf8");
  return shell.includes("function SidebarNavIcon")
    && shell.includes("sidebarCollapsed")
    && shell.includes("sidebar-brand-assets")
    && shell.includes("estimated_amount??r.amount")
    && shell.includes("ReimbursementWorkspaceV3")
    && shell.includes("ProcurementInboxV3")
    && layout.includes('import "./local-preview-parity.css";')
    && layout.includes('import "./local-standard-notifications.css";');
}

function makePortable(source) {
  let output = source.replace(/\r\n?/g, "\n");
  const rootLiteral = JSON.stringify(rootPosix);
  output = output.replaceAll('const root = "/app";', `const root = ${rootLiteral};`);
  output = output.replaceAll('const root="/app";', `const root=${rootLiteral};`);
  output = output.replaceAll('const ROOT = "/app";', `const ROOT = ${rootLiteral};`);
  output = output.replaceAll('const ROOT="/app";', `const ROOT=${rootLiteral};`);
  output = output.replaceAll('"/app/', `"${rootPosix}/`);
  output = output.replaceAll("'/app/", `'${rootPosix}/`);
  output = output.replaceAll('`/app/', `\`${rootPosix}/`);
  return output;
}

if (alreadyMaterialized()) {
  console.log("ProcureFlow production parity is already materialized; skipping duplicate overlay application.");
  process.exit(0);
}

for (const scriptName of scripts) {
  const sourcePath = path.join(root, "scripts", scriptName);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing ProcureFlow parity script: ${scriptName}`);

  const portableSource = makePortable(fs.readFileSync(sourcePath, "utf8"));
  const tempPath = path.join(os.tmpdir(), `procureflow-build-${process.pid}-${scriptName}`);
  fs.writeFileSync(tempPath, portableSource, "utf8");

  try {
    const result = spawnSync(process.execPath, [tempPath], {
      cwd: root,
      env: { ...process.env, PROCUREFLOW_ROOT: rootPosix },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${scriptName} failed with exit code ${result.status ?? "unknown"}.`);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

if (!alreadyMaterialized()) throw new Error("ProcureFlow parity scripts completed but the final UI markers were not materialized.");

console.log("ProcureFlow production build parity materialized successfully.");

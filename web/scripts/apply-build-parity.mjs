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
  "apply-production-runtime-hotfix.mjs",
  "apply-reimbursement-evidence-lowvalue.mjs",
  "apply-ict-facility-parity.mjs",
  "apply-reimbursement-approval-routing.mjs",
  "apply-dark-payee-inbox-fixes.mjs",
];

function alreadyMaterialized() {
  const shellPath = path.join(root, "components", "complete-role-shell.tsx");
  const layoutPath = path.join(root, "app", "layout.tsx");
  const reimbursementPath = path.join(root, "components", "reimbursement-workspace-v3.tsx");
  const adminDirectoryPath = path.join(root, "components", "admin-directory-controls.tsx");
  const facilityRequestPath = path.join(root, "components", "facility-request-register.tsx");
  const cssPath = path.join(root, "app", "local-preview-parity.css");
  const procurementActionsPath = path.join(root, "lib", "procureflow", "procurement-actions.ts");
  if (![shellPath, layoutPath, reimbursementPath, adminDirectoryPath, facilityRequestPath, cssPath, procurementActionsPath].every((item) => fs.existsSync(item))) return false;
  const shell = fs.readFileSync(shellPath, "utf8");
  const layout = fs.readFileSync(layoutPath, "utf8");
  const reimbursement = fs.readFileSync(reimbursementPath, "utf8");
  const adminDirectory = fs.readFileSync(adminDirectoryPath, "utf8");
  const facilityRequest = fs.readFileSync(facilityRequestPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const procurementActions = fs.readFileSync(procurementActionsPath, "utf8");
  return shell.includes("function SidebarNavIcon")
    && shell.includes("sidebarCollapsed")
    && shell.includes("sidebar-brand-assets")
    && shell.includes("estimated_amount??r.amount")
    && shell.includes("ReimbursementWorkspaceV3")
    && shell.includes("ProcurementInboxV3")
    && shell.includes("ICT_FACILITY_PARITY_V1")
    && reimbursement.includes("REIMBURSEMENT_APPROVAL_ROUTING_V1")
    && reimbursement.includes("Finance Payout Queue")
    && adminDirectory.includes("REIMBURSEMENT_APPROVAL_ROUTING_V1")
    && adminDirectory.includes("ICT account setup")
    && facilityRequest.includes("PayeeDetailsReveal")
    && css.includes("DARK_PICKER_HOVER_PAYEE_FIX_V1")
    && procurementActions.includes("FOR UPDATE OF pr")
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

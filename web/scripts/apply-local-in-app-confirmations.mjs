import fs from "node:fs";
import path from "node:path";

const root = "/app";

function patchFile(relativePath, replacements) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, "utf8");
  const original = source;

  if (!source.includes('import { requestConfirmation } from "@/components/in-app-confirmation";')) {
    const marker = 'import { useRouter } from "next/navigation";';
    if (!source.includes(marker)) throw new Error(`Cannot inject confirmation import into ${relativePath}.`);
    source = source.replace(marker, `${marker}\nimport { requestConfirmation } from "@/components/in-app-confirmation";`);
  }

  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`Expected browser-confirmation pattern was not found in ${relativePath}: ${from}`);
    source = source.replace(from, to);
  }

  if (source !== original) fs.writeFileSync(file, source, "utf8");
}

patchFile("components/approver-requests.tsx", [
  [
    'if (!window.confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} ${selected.requestNo}?`)) return;',
    'if (!(await requestConfirmation({ eyebrow: decision === "approve" ? "APPROVAL" : decision === "reject" ? "REJECTION" : "RETURN FOR CORRECTION", title: decision === "approve" ? "Approve this request?" : decision === "reject" ? "Reject this request?" : "Return this request for correction?", description: decision === "approve" ? `${selected.requestNo} will be approved and routed to the next ProcureFlow stage.` : decision === "reject" ? `${selected.requestNo} will be rejected and the recorded reason will remain in workflow and audit history.` : `${selected.requestNo} will be returned for correction with the reason entered in the approval note.`, reference: selected.requestNo, detail: note.trim() ? `Note: ${note.trim()}` : undefined, confirmLabel: decision === "approve" ? "Approve Request" : decision === "reject" ? "Reject Request" : "Return Request", tone: decision === "approve" ? "success" : decision === "reject" ? "danger" : "warning" }))) return;'
  ],
]);

patchFile("components/approver-operational-approvals.tsx", [
  [
    'if (!window.confirm(`${decision === "approve" ? "Approve" : "Reject"} ${selected.poNo}?`)) return;',
    'if (!(await requestConfirmation({ eyebrow: decision === "approve" ? "PO APPROVAL" : "PO REJECTION", title: decision === "approve" ? "Approve this purchase order?" : "Reject this purchase order?", description: decision === "approve" ? `${selected.poNo} will be approved and returned to Procurement for commercial release.` : `${selected.poNo} will be rejected and the rejection reason will be preserved in the audit trail.`, reference: selected.poNo, detail: note.trim() ? `Note: ${note.trim()}` : undefined, confirmLabel: decision === "approve" ? "Approve PO" : "Reject PO", tone: decision === "approve" ? "success" : "danger" }))) return;'
  ],
  [
    'if (!window.confirm(`${decision === "approve" ? "Approve" : "Reject"} ${selected.paymentNo}?`)) return;',
    'if (!(await requestConfirmation({ eyebrow: decision === "approve" ? "PAYMENT APPROVAL" : "PAYMENT REJECTION", title: decision === "approve" ? "Approve this payment request?" : "Reject this payment request?", description: decision === "approve" ? `${selected.paymentNo} will be authorized and routed to Finance for payment execution.` : `${selected.paymentNo} will be rejected and the rejection reason will remain in workflow history.`, reference: selected.paymentNo, detail: note.trim() ? `Note: ${note.trim()}` : undefined, confirmLabel: decision === "approve" ? "Approve Payment" : "Reject Payment", tone: decision === "approve" ? "success" : "danger" }))) return;'
  ],
  [
    'if (!window.confirm(`${verb} ${selected.passNumber}?`)) return;',
    'if (!(await requestConfirmation({ eyebrow: decision === "approve" ? "GATEWAY PASS APPROVAL" : decision === "reject" ? "GATEWAY PASS REJECTION" : "GATEWAY PASS RETURN", title: decision === "approve" ? "Approve this gateway pass?" : decision === "reject" ? "Reject this gateway pass?" : "Return this gateway pass?", description: decision === "approve" ? `${selected.passNumber} will receive final Approver / MD authorization.` : decision === "reject" ? `${selected.passNumber} will be rejected with the recorded reason.` : `${selected.passNumber} will be returned for correction with the recorded reason.`, reference: selected.passNumber, detail: note.trim() ? `Note: ${note.trim()}` : undefined, confirmLabel: decision === "approve" ? "Approve Gateway Pass" : decision === "reject" ? "Reject Gateway Pass" : "Return Gateway Pass", tone: decision === "approve" ? "success" : decision === "reject" ? "danger" : "warning" }))) return;'
  ],
]);

patchFile("components/finance-workspace.tsx", [
  [
    'if (!window.confirm(`Record payment for ${selected.requestNo}? This will move the request to Paid.`)) return;',
    'if (!(await requestConfirmation({ eyebrow: "PAYMENT EXECUTION", title: "Record this payment as executed?", description: `${selected.requestNo} will move to Paid and the payment reference, transfer type and payment date will be written to the Finance ledger.`, reference: selected.requestNo, detail: `${transferType} · ${paymentReference.trim()} · ${paymentDate}`, confirmLabel: "Record Payment", tone: "success" }))) return;'
  ],
]);

patchFile("components/procurement-recommendations.tsx", [
  [
    'if (!window.confirm(`Submit ${selected.requestNo} and the ${recommendedQuote.vendorName} recommendation to Approver / MD?`)) return;',
    'if (!(await requestConfirmation({ eyebrow: "VENDOR RECOMMENDATION", title: "Submit vendor recommendation to Approver / MD?", description: `${selected.requestNo} and the recommendation for ${recommendedQuote.vendorName} will move to independent approval.`, reference: selected.requestNo, detail: note.trim() ? `Submission note: ${note.trim()}` : `Recommended vendor: ${recommendedQuote.vendorName}`, confirmLabel: "Submit Recommendation", tone: "primary" }))) return;'
  ],
]);

patchFile("components/procurement-sourcing.tsx", [
  [
    'if (!window.confirm(`Recommend ${predictedRecommendation.vendorName} for ${selected.requestNo} using the weighted quote score?`)) return;',
    'if (!(await requestConfirmation({ eyebrow: "VENDOR SELECTION", title: "Save this vendor recommendation?", description: `${predictedRecommendation.vendorName} will be recorded as the recommended vendor for ${selected.requestNo} using the server-recalculated weighted quote score.`, reference: selected.requestNo, detail: `${predictedRecommendation.vendorName} · weighted score ${predictedRecommendation.calculatedScore}`, confirmLabel: "Recommend Vendor", tone: "primary" }))) return;'
  ],
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

const scanRoots = [path.join(root, "components"), path.join(root, "app")];
const offenders = [];
for (const scanRoot of scanRoots) {
  for (const file of walk(scanRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const nativePattern = /\bwindow\.(confirm|alert|prompt)\s*\(/g;
    const matches = [...source.matchAll(nativePattern)];
    if (matches.length) offenders.push(`${path.relative(root, file)}: ${matches.map((match) => match[0]).join(", ")}`);
  }
}

if (offenders.length) {
  throw new Error(`Native browser dialogs remain in ProcureFlow:\n${offenders.join("\n")}`);
}

console.log("Local in-app confirmation standard applied: native browser confirm/alert/prompt dialogs are blocked across ProcureFlow UI source.");

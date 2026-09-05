"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, KeyRound, ShieldAlert, SlidersHorizontal, UserCog } from "lucide-react";
import type { AdminDashboardData } from "@/lib/procureflow/admin-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";

type UserSecurityAction =
  | "Lock Account"
  | "Unlock Account"
  | "Suspend Access"
  | "Restore Access"
  | "Force Password Change"
  | "Terminate Active Sessions";

type RequestInterventionAction =
  | "Correct Request Routing"
  | "Reassign Procurement Manager"
  | "Return for Correction"
  | "Return to Procurement Review"
  | "Release Stuck Approval"
  | "Reopen Completed / Closed / Archived"
  | "Cancel Duplicate Request"
  | "Emergency Approve Request"
  | "Emergency Reject Request";

type Feedback = { kind: "success" | "error"; text: string } | null;

async function postAdminAction(payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to complete Admin action.");
  return body?.result;
}

function AuditWriteGate({ securityStatus }: { securityStatus: SecurityMigrationStatus }) {
  const ready = securityStatus.activeAuditKeyVerified;
  return (
    <div className={`admin-write-gate ${ready ? "ready" : "locked"}`}>
      {ready ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}
      <div>
        <strong>{ready ? "Audited Admin writes are enabled" : "Admin writes are audit-locked"}</strong>
        <span>
          {ready
            ? "Every action below requires authentication, an explicit reason, confirmation, an Admin intervention record, and a signed v2 audit event."
            : "The active v2 audit signing key must verify before any control below can change production data."}
        </span>
      </div>
    </div>
  );
}

function FeedbackBox({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return <div className={`admin-feedback ${feedback.kind}`}>{feedback.text}</div>;
}

export function AdminUserManagementControls({
  data,
  securityStatus,
}: {
  data: AdminDashboardData;
  securityStatus: SecurityMigrationStatus;
}) {
  const router = useRouter();
  const users = data.evidence.users;
  const [targetUserId, setTargetUserId] = useState(users[0]?.id || 0);
  const [action, setAction] = useState<UserSecurityAction>("Lock Account");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const target = users.find((row) => row.id === targetUserId) || null;
  const ready = securityStatus.activeAuditKeyVerified;
  const confirmed = Boolean(target && confirmation.trim() === target.username);

  async function submit() {
    if (!target) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postAdminAction({
        action: "user-security",
        targetUserId: target.id,
        securityAction: action,
        reason,
      });
      setFeedback({ kind: "success", text: `${action} completed. Intervention ${result?.interventionNo || "recorded"}.` });
      setReason("");
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to complete user security action." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-control-stack">
      <AuditWriteGate securityStatus={securityStatus} />
      <section className="admin-control-card">
        <div className="admin-control-title"><UserCog size={17} /><div><strong>Account & session intervention</strong><span>Use exceptional Admin controls without changing a user role or deleting an account.</span></div></div>
        <div className="admin-form-grid">
          <label><span>User</span><select value={targetUserId} onChange={(e) => { setTargetUserId(Number(e.target.value)); setConfirmation(""); setFeedback(null); }}>{users.map((row) => <option key={row.id} value={row.id}>{row.fullName} — {row.role} ({row.username})</option>)}</select></label>
          <label><span>Security action</span><select value={action} onChange={(e) => { setAction(e.target.value as UserSecurityAction); setFeedback(null); }}><option>Lock Account</option><option>Unlock Account</option><option>Suspend Access</option><option>Restore Access</option><option>Force Password Change</option><option>Terminate Active Sessions</option></select></label>
        </div>
        {target && <div className="admin-selected-record"><div><span>Account</span><strong>{target.fullName}</strong><small>{target.username} · {target.role}</small></div><div><span>Access</span><strong>{target.active ? "Active" : "Inactive"}</strong><small>{target.locked ? "Account locked" : "Not locked"}</small></div><div><span>Login controls</span><strong>{target.failedLoginCount} failed</strong><small>{target.mustChangePassword ? "Password change required" : "Password change not required"}</small></div></div>}
        <label className="admin-field-wide"><span>Reason for intervention</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this exceptional Admin action is necessary." rows={3} /></label>
        <label className="admin-field-wide"><span>Confirm by typing the username: <b>{target?.username || "—"}</b></span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={target?.username || "Select a user"} /></label>
        <div className="admin-submit-row"><button type="button" className="admin-primary-action" disabled={!ready || !confirmed || reason.trim().length < 5 || busy || !target} onClick={submit}>{busy ? "Applying…" : `Apply ${action}`}</button><small>No account is deleted. Dangerous self-lock, self-suspension and self-session termination are blocked server-side.</small></div>
        <FeedbackBox feedback={feedback} />
      </section>
    </div>
  );
}

export function AdminApprovalConfigurationControls({
  data,
  securityStatus,
}: {
  data: AdminDashboardData;
  securityStatus: SecurityMigrationStatus;
}) {
  const router = useRouter();
  const current = data.approvalPolicies.find((row) => row.policyKey === "procurement_manager_approval_limit") || data.approvalPolicies[0] || null;
  const [amount, setAmount] = useState(current ? String(current.amount) : "");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const ready = securityStatus.activeAuditKeyVerified;

  async function submit() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postAdminAction({ action: "set-approval-limit", amount, reason });
      setFeedback({ kind: "success", text: `Approval limit updated from ${result?.oldAmount ?? "the previous value"} to ${result?.newAmount ?? amount}. Intervention ${result?.interventionNo || "recorded"}.` });
      setReason("");
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to update approval configuration." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-control-stack">
      <AuditWriteGate securityStatus={securityStatus} />
      {current && <div className="admin-policy-current"><SlidersHorizontal size={18}/><div><span>Current Procurement Manager approval limit</span><strong>{new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(current.amount)}</strong><small>Last reason: {current.updateReason || "—"}</small></div></div>}
      <section className="admin-control-card">
        <div className="admin-control-title"><KeyRound size={17}/><div><strong>Change approval authorization limit</strong><span>The application imposes no artificial maximum. The value must simply be a valid positive monetary amount.</span></div></div>
        <label className="admin-field-wide"><span>New approval limit (NGN)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000000.00" /></label>
        <label className="admin-field-wide"><span>Reason for policy change</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Document the authorization or operational reason for changing this global policy." /></label>
        <label className="admin-field-wide"><span>Confirm by typing <b>CHANGE LIMIT</b></span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="CHANGE LIMIT" /></label>
        <div className="admin-submit-row"><button type="button" className="admin-primary-action" disabled={!ready || confirmation.trim() !== "CHANGE LIMIT" || reason.trim().length < 5 || !amount.trim() || busy} onClick={submit}>{busy ? "Updating…" : "Update approval limit"}</button><small>The old and new values are stored in approval-policy history and the signed audit ledger in the same transaction.</small></div>
        <FeedbackBox feedback={feedback} />
      </section>
      <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>Policy</th><th>Amount</th><th>Updated by</th><th>Reason</th><th>Updated</th></tr></thead><tbody>{data.approvalPolicies.map((row) => <tr key={row.policyKey}><td><strong>{row.policyKey}</strong></td><td>{new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(row.amount)}</td><td>{row.updatedBy || "—"}</td><td>{row.updateReason || "—"}</td><td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString("en-NG") : "—"}</td></tr>)}</tbody></table></div>
    </div>
  );
}

const interventionDescriptions: Record<RequestInterventionAction, string> = {
  "Correct Request Routing": "Repair only the command-chain next-role assignment for the request's current status.",
  "Reassign Procurement Manager": "Move Procurement-stage ownership to another active Procurement Manager.",
  "Return for Correction": "Return an eligible pre-payment request to the Facility / Utility originator for correction.",
  "Return to Procurement Review": "Send an eligible pre-payment request back to Procurement review.",
  "Release Stuck Approval": "Recompute and restore the approval queue for a request already awaiting approval.",
  "Reopen Completed / Closed / Archived": "Reopen a closed-stage procurement at Receipt Uploaded for controlled operational follow-up.",
  "Cancel Duplicate Request": "Cancel a duplicate only when no approved/paid payment evidence blocks cancellation.",
  "Emergency Approve Request": "Exceptional Admin approval of a request already awaiting final approval. Self-approval is blocked.",
  "Emergency Reject Request": "Exceptional Admin rejection of a request already awaiting final approval. Self-rejection is blocked.",
};

export function AdminWorkflowInterventionControls({
  data,
  securityStatus,
}: {
  data: AdminDashboardData;
  securityStatus: SecurityMigrationStatus;
}) {
  const router = useRouter();
  const requests = data.evidence.requests;
  const procurementManagers = useMemo(() => data.evidence.users.filter((row) => row.role === "Procurement Manager" && row.active), [data.evidence.users]);
  const [requestId, setRequestId] = useState(requests[0]?.id || 0);
  const [action, setAction] = useState<RequestInterventionAction>("Correct Request Routing");
  const [targetProcurementManagerId, setTargetProcurementManagerId] = useState(procurementManagers[0]?.id || 0);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const selected = requests.find((row) => row.id === requestId) || null;
  const ready = securityStatus.activeAuditKeyVerified;
  const isEmergency = action.startsWith("Emergency") || action.startsWith("Cancel") || action.startsWith("Reopen");
  const confirmed = Boolean(selected && confirmation.trim() === selected.requestNo);
  const pmRequired = action === "Reassign Procurement Manager";

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postAdminAction({
        action: "request-intervention",
        requestId: selected.id,
        interventionAction: action,
        reason,
        targetProcurementManagerId: pmRequired ? targetProcurementManagerId : undefined,
      });
      setFeedback({ kind: "success", text: `${action} completed for ${selected.requestNo}. New status: ${result?.status || selected.status || "unchanged"}. Intervention ${result?.interventionNo || "recorded"}.` });
      setReason("");
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to complete workflow intervention." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-control-stack">
      <AuditWriteGate securityStatus={securityStatus} />
      <section className={`admin-control-card ${isEmergency ? "danger" : ""}`}>
        <div className="admin-control-title"><AlertTriangle size={17}/><div><strong>Workflow intervention</strong><span>These controls are exceptional Admin powers, not ordinary Procurement, Approver, Finance or Logistics work.</span></div></div>
        <div className="admin-form-grid">
          <label><span>Purchase request</span><select value={requestId} onChange={(e) => { setRequestId(Number(e.target.value)); setConfirmation(""); setFeedback(null); }}>{requests.map((row) => <option key={row.id} value={row.id}>{row.requestNo} — {row.status || "Unknown"}</option>)}</select></label>
          <label><span>Intervention</span><select value={action} onChange={(e) => { setAction(e.target.value as RequestInterventionAction); setFeedback(null); }}><option>Correct Request Routing</option><option>Reassign Procurement Manager</option><option>Return for Correction</option><option>Return to Procurement Review</option><option>Release Stuck Approval</option><option>Reopen Completed / Closed / Archived</option><option>Cancel Duplicate Request</option><option>Emergency Approve Request</option><option>Emergency Reject Request</option></select></label>
        </div>
        {selected && <div className="admin-selected-record"><div><span>Request</span><strong>{selected.requestNo}</strong><small>{selected.departmentProject || "No department / project"}</small></div><div><span>Current state</span><strong>{selected.status || "Unknown"}</strong><small>Next role: {selected.nextRole || "—"}</small></div><div><span>Value / PM</span><strong>{new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(selected.amount)}</strong><small>{selected.procurementManager || "No Procurement Manager assigned"}</small></div></div>}
        <div className={`admin-intervention-description ${isEmergency ? "danger" : ""}`}><AlertTriangle size={15}/><span>{interventionDescriptions[action]}</span></div>
        {pmRequired && <label className="admin-field-wide"><span>New Procurement Manager</span><select value={targetProcurementManagerId} onChange={(e) => setTargetProcurementManagerId(Number(e.target.value))}><option value={0}>Choose an active Procurement Manager</option>{procurementManagers.map((row) => <option key={row.id} value={row.id}>{row.fullName} ({row.username})</option>)}</select></label>}
        <label className="admin-field-wide"><span>Mandatory intervention reason</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the exception, authority and intended outcome." /></label>
        <label className="admin-field-wide"><span>Confirm by typing the request number: <b>{selected?.requestNo || "—"}</b></span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={selected?.requestNo || "Select a request"} /></label>
        <div className="admin-submit-row"><button type="button" className={isEmergency ? "admin-danger-action" : "admin-primary-action"} disabled={!ready || !selected || !confirmed || reason.trim().length < 5 || (pmRequired && !targetProcurementManagerId) || busy} onClick={submit}>{busy ? "Applying intervention…" : action}</button><small>Server-side status, ownership, payment-state, duplicate-payment and self-approval guards remain authoritative even after confirmation.</small></div>
        <FeedbackBox feedback={feedback} />
      </section>
    </div>
  );
}

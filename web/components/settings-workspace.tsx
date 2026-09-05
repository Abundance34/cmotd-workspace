"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { ROLE_LABELS, type ProcureFlowRole } from "@/lib/procureflow/roles";

type PasswordPolicy = {
  minimumLength: number;
  historyCount: number;
  algorithm: string;
  rotatesSession: boolean;
};

type SettingsWorkspaceProps = {
  username: string;
  fullName: string;
  role: ProcureFlowRole;
  forced?: boolean;
};

type Feedback = { kind: "success" | "error"; text: string } | null;

export function SettingsWorkspace({ username, fullName, role, forced = false }: SettingsWorkspaceProps) {
  const router = useRouter();
  const [policy, setPolicy] = useState<PasswordPolicy>({ minimumLength: 12, historyCount: 5, algorithm: "Argon2id", rotatesSession: true });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/settings/password", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || "Unable to load password policy.");
        if (active && body?.policy) setPolicy(body.policy as PasswordPolicy);
      })
      .catch((error) => {
        if (active) setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to load password policy." });
      });
    return () => { active = false; };
  }, []);

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const longEnough = newPassword.length >= policy.minimumLength;
  const ready = Boolean(currentPassword && longEnough && passwordsMatch && !busy);

  async function submit() {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to change password.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFeedback({ kind: "success", text: "Password changed successfully. Previous active sessions were revoked and this secure session was refreshed." });
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Unable to change password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`settings-workspace ${forced ? "forced" : ""}`}>
      {forced ? <div className="settings-required-banner"><LockKeyhole size={18} /><div><strong>Password change required</strong><span>Your account is using a temporary or Admin-reset credential. Change it before entering the ProcureFlow workspace.</span></div></div> : null}
      <div className="settings-grid">
        <section className="settings-account-card">
          <div className="settings-card-title"><ShieldCheck size={18} /><div><strong>Account security</strong><span>Authenticated ProcureFlow identity</span></div></div>
          <dl>
            <div><dt>Name</dt><dd>{fullName}</dd></div>
            <div><dt>Username</dt><dd>{username}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABELS[role]}</dd></div>
            <div><dt>Password protection</dt><dd>{policy.algorithm}</dd></div>
          </dl>
          <div className="settings-security-note"><KeyRound size={16} /><span>Password values and password hashes are never written to activity logs or audit evidence.</span></div>
        </section>

        <section className="settings-password-card">
          <div className="settings-card-title"><KeyRound size={18} /><div><strong>Change password</strong><span>The production credential-change workflow rotates your current session automatically.</span></div></div>
          <label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>

          <div className="settings-policy-grid">
            <span className={longEnough ? "met" : ""}><CheckCircle2 size={14} />At least {policy.minimumLength} characters</span>
            <span className={passwordsMatch ? "met" : ""}><CheckCircle2 size={14} />Confirmation matches</span>
            <span><RefreshCw size={14} />Last {policy.historyCount} passwords protected</span>
            <span><ShieldCheck size={14} />Other active sessions revoked</span>
          </div>

          {feedback ? <div className={`action-message ${feedback.kind}`}>{feedback.text}</div> : null}
          <button type="button" className="settings-primary" disabled={!ready} onClick={() => void submit()}>{busy ? "Changing password…" : "Change Password & Rotate Session"}</button>
        </section>
      </div>
    </div>
  );
}

export function ForcedPasswordChangeScreen({ username, fullName, role }: Omit<SettingsWorkspaceProps, "forced">) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <main className="forced-settings-page">
      <header className="forced-settings-header">
        <div className="sidebar-brand"><span className="sidebar-logo">PF</span><div><strong>ProcureFlow</strong><small>Secure Account Setup</small></div></div>
        <Image src="/branding/cmotd_company_wordmark.png" alt="CMOTD" width={245} height={60} className="header-wordmark" />
      </header>
      <section className="forced-settings-content">
        <div className="forced-settings-heading"><span>Security requirement</span><h1>Set your permanent password</h1><p>Complete this required credential change before accessing procurement, approvals, Finance, Logistics or audit records.</p></div>
        <SettingsWorkspace username={username} fullName={fullName} role={role} forced />
        <button type="button" className="settings-signout" onClick={logout}><LogOut size={15} />Sign out instead</button>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, ShieldAlert, UserPlus, UsersRound } from "lucide-react";
import type { AdminDashboardData } from "@/lib/procureflow/admin-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import { ROLE_LABELS, type ProcureFlowRole } from "@/lib/procureflow/roles";

type Feedback = { kind: "success" | "error"; text: string } | null;
type PermissionChange = "Grant" | "Revoke";

function roleLabel(role: string) {
  return ROLE_LABELS[role as ProcureFlowRole] || role;
}

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

function Gate({ securityStatus }: { securityStatus: SecurityMigrationStatus }) {
  const ready = securityStatus.activeAuditKeyVerified;
  return <div className={`admin-write-gate ${ready ? "ready" : "locked"}`}>
    {ready ? <CheckCircle2 size={17}/> : <ShieldAlert size={17}/>}
    <div><strong>{ready ? "Audited user administration enabled" : "User administration audit-locked"}</strong><span>{ready ? "User creation, identity changes, password resets and permission changes are recorded in the Admin intervention ledger and signed v2 audit chain." : "The active v2 audit signing key must verify before these controls can write production data."}</span></div>
  </div>;
}

function FeedbackBox({feedback}:{feedback:Feedback}) {
  return feedback ? <div className={`admin-feedback ${feedback.kind}`}>{feedback.text}</div> : null;
}

export function AdminDirectoryControls({
  data,
  securityStatus,
  currentUserId,
}: {
  data: AdminDashboardData;
  securityStatus: SecurityMigrationStatus;
  currentUserId: number;
}) {
  const router = useRouter();
  const ready = securityStatus.activeAuditKeyVerified;
  const users = data.evidence.users;
  const roles = data.roles.map((row) => row.name);

  const [newUsername,setNewUsername]=useState("");
  const [newFullName,setNewFullName]=useState("");
  const [newEmail,setNewEmail]=useState("");
  const [newRole,setNewRole]=useState(roles[0] || "Facility Manager");
  const [newPassword,setNewPassword]=useState("");
  const [newForce,setNewForce]=useState(true);
  const [newReason,setNewReason]=useState("");
  const [newConfirm,setNewConfirm]=useState("");
  const [createBusy,setCreateBusy]=useState(false);
  const [createFeedback,setCreateFeedback]=useState<Feedback>(null);

  const [targetId,setTargetId]=useState(users[0]?.id || 0);
  const target=users.find((row)=>row.id===targetId)||null;
  const [editUsername,setEditUsername]=useState(target?.username || "");
  const [editFullName,setEditFullName]=useState(target?.fullName || "");
  const [editEmail,setEditEmail]=useState(target?.email || "");
  const [editRole,setEditRole]=useState(target?.role || roles[0] || "Facility Manager");
  const [editReason,setEditReason]=useState("");
  const [editConfirm,setEditConfirm]=useState("");
  const [editBusy,setEditBusy]=useState(false);
  const [editFeedback,setEditFeedback]=useState<Feedback>(null);

  const [resetPassword,setResetPassword]=useState("");
  const [resetReason,setResetReason]=useState("");
  const [resetConfirm,setResetConfirm]=useState("");
  const [resetBusy,setResetBusy]=useState(false);
  const [resetFeedback,setResetFeedback]=useState<Feedback>(null);

  useEffect(()=>{
    if(!target)return;
    setEditUsername(target.username);
    setEditFullName(target.fullName);
    setEditEmail(target.email || "");
    setEditRole(target.role);
    setEditReason("");setEditConfirm("");setEditFeedback(null);
    setResetPassword("");setResetReason("");setResetConfirm("");setResetFeedback(null);
  },[targetId]);

  async function createUser(){
    setCreateBusy(true);setCreateFeedback(null);
    try{
      const result=await postAdminAction({action:"create-user",username:newUsername,fullName:newFullName,email:newEmail,role:newRole,temporaryPassword:newPassword,forcePasswordChange:newForce,reason:newReason});
      setCreateFeedback({kind:"success",text:`User ${result?.username || newUsername} created as ${roleLabel(result?.role || newRole)}. Intervention ${result?.interventionNo || "recorded"}.`});
      setNewUsername("");setNewFullName("");setNewEmail("");setNewPassword("");setNewReason("");setNewConfirm("");setNewForce(true);
      router.refresh();
    }catch(error){setCreateFeedback({kind:"error",text:error instanceof Error?error.message:"Unable to create user."});}
    finally{setCreateBusy(false);}
  }

  async function updateUser(){
    if(!target)return;
    setEditBusy(true);setEditFeedback(null);
    try{
      const result=await postAdminAction({action:"update-user",targetUserId:target.id,username:editUsername,fullName:editFullName,email:editEmail,role:editRole,reason:editReason});
      setEditFeedback({kind:"success",text:`${result?.username || editUsername} updated${result?.roleChanged ? " and signed out so the new role takes effect" : ""}. Intervention ${result?.interventionNo || "recorded"}.`});
      setEditReason("");setEditConfirm("");router.refresh();
    }catch(error){setEditFeedback({kind:"error",text:error instanceof Error?error.message:"Unable to update user."});}
    finally{setEditBusy(false);}
  }

  async function resetUserPassword(){
    if(!target)return;
    setResetBusy(true);setResetFeedback(null);
    try{
      const result=await postAdminAction({action:"reset-user-password",targetUserId:target.id,temporaryPassword:resetPassword,reason:resetReason});
      setResetFeedback({kind:"success",text:`Password reset for ${result?.username || target.username}. Existing active sessions were terminated. Intervention ${result?.interventionNo || "recorded"}.`});
      setResetPassword("");setResetReason("");setResetConfirm("");router.refresh();
    }catch(error){setResetFeedback({kind:"error",text:error instanceof Error?error.message:"Unable to reset password."});}
    finally{setResetBusy(false);}
  }

  return <div className="admin-control-stack">
    <Gate securityStatus={securityStatus}/>
    <section className="admin-control-card">
      <div className="admin-control-title"><UserPlus size={17}/><div><strong>Create new ProcureFlow user</strong><span>Create an active account using an Argon2 password hash. Temporary passwords are never written to logs or audit metadata.</span></div></div>
      <div className="admin-form-grid">
        <label><span>Username</span><input value={newUsername} onChange={(e)=>setNewUsername(e.target.value)} placeholder="username" autoComplete="off"/></label>
        <label><span>Full name</span><input value={newFullName} onChange={(e)=>setNewFullName(e.target.value)} placeholder="Full name"/></label>
        <label><span>Email (optional)</span><input type="email" value={newEmail} onChange={(e)=>setNewEmail(e.target.value)} placeholder="name@example.com"/></label>
        <label><span>Role</span><select value={newRole} onChange={(e)=>setNewRole(e.target.value)}>{roles.map((role)=><option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
        <label><span>Temporary password</span><input type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} autoComplete="new-password" placeholder="Minimum 6 characters"/></label>
        <label><span>First-login control</span><select value={newForce?"yes":"no"} onChange={(e)=>setNewForce(e.target.value==="yes")}><option value="yes">Force password change</option><option value="no">Do not force change</option></select></label>
      </div>
      <label className="admin-field-wide"><span>Reason / authorization</span><textarea rows={3} value={newReason} onChange={(e)=>setNewReason(e.target.value)} placeholder="Document why this account is being created."/></label>
      <label className="admin-field-wide"><span>Confirm by typing <b>CREATE USER</b></span><input value={newConfirm} onChange={(e)=>setNewConfirm(e.target.value)} placeholder="CREATE USER"/></label>
      <div className="admin-submit-row"><button type="button" className="admin-primary-action" disabled={!ready||newConfirm.trim()!=="CREATE USER"||newReason.trim().length<5||newUsername.trim().length<2||newFullName.trim().length<2||newPassword.length<6||createBusy} onClick={createUser}>{createBusy?"Creating…":"Create user"}</button><small>The account starts active and unlocked. Use the Security controls below for suspension or lockout.</small></div>
      <FeedbackBox feedback={createFeedback}/>
    </section>

    <section className="admin-control-card">
      <div className="admin-control-title"><UsersRound size={17}/><div><strong>Edit identity and role</strong><span>Profile and role changes are separated from account lock/suspension controls. Role changes terminate active sessions so permissions cannot remain stale.</span></div></div>
      <label className="admin-field-wide"><span>User</span><select value={targetId} onChange={(e)=>setTargetId(Number(e.target.value))}>{users.map((row)=><option key={row.id} value={row.id}>{row.fullName} — {roleLabel(row.role)} ({row.username})</option>)}</select></label>
      {target&&<div className="admin-selected-record"><div><span>User</span><strong>{target.fullName}</strong><small>{target.username}</small></div><div><span>Role</span><strong>{roleLabel(target.role)}</strong><small>{target.id===currentUserId?"Current Admin session":"Managed account"}</small></div><div><span>Security</span><strong>{target.active?"Active":"Inactive"}</strong><small>{target.locked?"Locked":"Not locked"}</small></div></div>}
      <div className="admin-form-grid">
        <label><span>Username</span><input value={editUsername} onChange={(e)=>setEditUsername(e.target.value)}/></label>
        <label><span>Full name</span><input value={editFullName} onChange={(e)=>setEditFullName(e.target.value)}/></label>
        <label><span>Email</span><input type="email" value={editEmail} onChange={(e)=>setEditEmail(e.target.value)}/></label>
        <label><span>Role</span><select value={editRole} onChange={(e)=>setEditRole(e.target.value)}>{roles.map((role)=><option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
      </div>
      <label className="admin-field-wide"><span>Reason for update</span><textarea rows={3} value={editReason} onChange={(e)=>setEditReason(e.target.value)} placeholder="Explain the identity or authorization change."/></label>
      <label className="admin-field-wide"><span>Confirm by typing the current username: <b>{target?.username || "—"}</b></span><input value={editConfirm} onChange={(e)=>setEditConfirm(e.target.value)} placeholder={target?.username || "Select a user"}/></label>
      <div className="admin-submit-row"><button type="button" className="admin-primary-action" disabled={!ready||!target||editConfirm.trim()!==target.username||editReason.trim().length<5||editBusy} onClick={updateUser}>{editBusy?"Saving…":"Save identity / role"}</button><small>The current Admin cannot change their own role here. Access state is controlled separately.</small></div>
      <FeedbackBox feedback={editFeedback}/>
    </section>

    <section className="admin-control-card danger">
      <div className="admin-control-title"><KeyRound size={17}/><div><strong>Administrative password reset</strong><span>Use only when a user cannot complete the normal password-change flow. The new temporary password is hashed immediately and excluded from audit evidence.</span></div></div>
      <div className="admin-form-grid"><label><span>Temporary password</span><input type="password" value={resetPassword} onChange={(e)=>setResetPassword(e.target.value)} autoComplete="new-password" placeholder="Minimum 6 characters"/></label><label><span>Target</span><input value={target?`${target.fullName} (${target.username})`:"No user selected"} readOnly/></label></div>
      <label className="admin-field-wide"><span>Reason for reset</span><textarea rows={3} value={resetReason} onChange={(e)=>setResetReason(e.target.value)} placeholder="Document why an administrative password reset is necessary."/></label>
      <label className="admin-field-wide"><span>Confirm by typing <b>RESET {target?.username || "USER"}</b></span><input value={resetConfirm} onChange={(e)=>setResetConfirm(e.target.value)} placeholder={target?`RESET ${target.username}`:"RESET USER"}/></label>
      <div className="admin-submit-row"><button type="button" className="admin-danger-action" disabled={!ready||!target||target.id===currentUserId||resetPassword.length<6||resetReason.trim().length<5||resetConfirm.trim()!==`RESET ${target.username}`||resetBusy} onClick={resetUserPassword}>{resetBusy?"Resetting…":"Reset password"}</button><small>All active sessions for the target are terminated and password change is required at the next sign-in.</small></div>
      <FeedbackBox feedback={resetFeedback}/>
    </section>
  </div>;
}

export function AdminRolePermissionControls({data,securityStatus}:{data:AdminDashboardData;securityStatus:SecurityMigrationStatus}) {
  const router=useRouter();
  const ready=securityStatus.activeAuditKeyVerified;
  const roles=data.roles.map((row)=>row.name);
  const permissions=data.permissions.map((row)=>row.name);
  const [role,setRole]=useState(roles[0]||"Admin");
  const [permission,setPermission]=useState(permissions[0]||"");
  const [change,setChange]=useState<PermissionChange>("Grant");
  const [reason,setReason]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState<Feedback>(null);
  const selectedRole=useMemo(()=>data.roles.find((row)=>row.name===role)||null,[data.roles,role]);
  const assigned=Boolean(selectedRole?.permissions.includes(permission));

  async function submit(){
    setBusy(true);setFeedback(null);
    try{
      const result=await postAdminAction({action:"role-permission",role,permission,permissionChange:change,reason});
      setFeedback({kind:"success",text:`${result?.change || change} ${result?.permission || permission} for ${roleLabel(result?.role || role)}. Intervention ${result?.interventionNo || "recorded"}.`});
      setReason("");setConfirmation("");router.refresh();
    }catch(error){setFeedback({kind:"error",text:error instanceof Error?error.message:"Unable to update role permission."});}
    finally{setBusy(false);}
  }

  return <div className="admin-control-stack">
    <Gate securityStatus={securityStatus}/>
    <section className="admin-control-card">
      <div className="admin-control-title"><ShieldAlert size={17}/><div><strong>Grant / revoke role permission</strong><span>Permission changes affect a role, not a single user. High-authority approval and Admin-control permissions are constrained server-side.</span></div></div>
      <div className="admin-form-grid">
        <label><span>Role</span><select value={role} onChange={(e)=>{setRole(e.target.value);setFeedback(null);}}>{roles.map((item)=><option key={item} value={item}>{roleLabel(item)}</option>)}</select></label>
        <label><span>Permission</span><select value={permission} onChange={(e)=>{setPermission(e.target.value);setFeedback(null);}}>{permissions.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>Change</span><select value={change} onChange={(e)=>setChange(e.target.value as PermissionChange)}><option>Grant</option><option>Revoke</option></select></label>
        <label><span>Current assignment</span><input value={assigned?"Assigned":"Not assigned"} readOnly/></label>
      </div>
      <label className="admin-field-wide"><span>Reason for permission change</span><textarea rows={3} value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Document the authorization and reason for changing this role capability."/></label>
      <label className="admin-field-wide"><span>Confirm by typing <b>{change.toUpperCase()} PERMISSION</b></span><input value={confirmation} onChange={(e)=>setConfirmation(e.target.value)} placeholder={`${change.toUpperCase()} PERMISSION`}/></label>
      <div className="admin-submit-row"><button type="button" className={change==="Revoke"?"admin-danger-action":"admin-primary-action"} disabled={!ready||!permission||reason.trim().length<5||confirmation.trim()!==`${change.toUpperCase()} PERMISSION`||busy} onClick={submit}>{busy?"Applying…":`${change} permission`}</button><small>Core Admin-control permissions cannot be removed from Admin. Executive approval rights cannot be assigned to ordinary workflow roles.</small></div>
      <FeedbackBox feedback={feedback}/>
    </section>
  </div>;
}

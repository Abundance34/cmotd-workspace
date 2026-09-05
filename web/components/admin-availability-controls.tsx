"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, CheckCircle2, ShieldAlert } from "lucide-react";
import type { AdminDashboardData } from "@/lib/procureflow/admin-data";
import type { SecurityMigrationStatus } from "@/lib/procureflow/security-check";
import { ROLE_LABELS, type ProcureFlowRole } from "@/lib/procureflow/roles";

type AvailabilityAction="Approve Away Notice"|"Reject Away Notice"|"Activate Delegation"|"Close Delegation / Mark Reviewed";
type Feedback={kind:"success"|"error";text:string}|null;

function roleLabel(role:string|null|undefined){return role?(ROLE_LABELS[role as ProcureFlowRole]||role):"—";}
function dateOnly(value:string|null|undefined){return value?String(value).slice(0,10):"";}

async function post(payload:Record<string,unknown>){const response=await fetch("/api/admin/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error||"Unable to apply availability action.");return body?.result;}

export function AdminAvailabilityControls({data,securityStatus}:{data:AdminDashboardData;securityStatus:SecurityMigrationStatus}){
  const router=useRouter();const rows=data.availability;const ready=securityStatus.activeAuditKeyVerified;
  const [availabilityId,setAvailabilityId]=useState(rows[0]?.id||0);const selected=rows.find((row)=>row.id===availabilityId)||null;
  const [action,setAction]=useState<AvailabilityAction>("Approve Away Notice");
  const [delegateRole,setDelegateRole]=useState(selected?.delegateRole||"Procurement Manager");
  const [delegateUserId,setDelegateUserId]=useState(0);
  const [startDate,setStartDate]=useState(dateOnly(selected?.awayStartDate));const [endDate,setEndDate]=useState(dateOnly(selected?.awayEndDate));
  const [note,setNote]=useState("");const [confirmation,setConfirmation]=useState("");const [busy,setBusy]=useState(false);const [feedback,setFeedback]=useState<Feedback>(null);
  const allowedDelegateRoles=selected?.role==="Approver"?["Procurement Manager","Admin","Approver"]:["Procurement Manager","Admin","Approver","Finance"];
  const delegateUsers=useMemo(()=>data.evidence.users.filter((user)=>user.active&&user.role===delegateRole),[data.evidence.users,delegateRole]);

  useEffect(()=>{if(!selected)return;const preferred=selected.delegateRole&&allowedDelegateRoles.includes(selected.delegateRole)?selected.delegateRole:"Procurement Manager";setDelegateRole(preferred);setDelegateUserId(0);setStartDate(dateOnly(selected.awayStartDate));setEndDate(dateOnly(selected.awayEndDate));setNote("");setConfirmation("");setFeedback(null);},[availabilityId]);
  useEffect(()=>{setDelegateUserId(0);},[delegateRole]);

  if(!rows.length)return <div className="empty-state">No availability or delegation requests are currently stored.</div>;
  const activating=action==="Activate Delegation";const dangerous=action==="Reject Away Notice"||action==="Close Delegation / Mark Reviewed";

  async function submit(){if(!selected)return;setBusy(true);setFeedback(null);try{const result=await post({action:"availability-review",availabilityId:selected.id,availabilityAction:action,adminNote:note,delegateRole:activating?delegateRole:undefined,delegateUserId:activating&&delegateUserId?delegateUserId:null,startDate:activating?startDate:undefined,endDate:activating?endDate:undefined});setFeedback({kind:"success",text:`${action} completed for availability #${selected.id}. Status: ${result?.status||"updated"}. Intervention ${result?.interventionNo||"recorded"}.`});setNote("");setConfirmation("");router.refresh();}catch(error){setFeedback({kind:"error",text:error instanceof Error?error.message:"Unable to apply availability action."});}finally{setBusy(false);}}

  return <div className="admin-control-stack">
    <div className={`admin-write-gate ${ready?"ready":"locked"}`}>{ready?<CheckCircle2 size={17}/>:<ShieldAlert size={17}/>}<div><strong>{ready?"Audited delegation controls enabled":"Delegation controls audit-locked"}</strong><span>{ready?"Availability decisions and delegation activation/closure are protected by explicit confirmation and the signed v2 audit chain.":"The active v2 audit key must verify before Admin can change availability or delegation records."}</span></div></div>
    <section className={`admin-control-card ${dangerous?"danger":""}`}>
      <div className="admin-control-title"><CalendarCheck2 size={17}/><div><strong>Availability & delegation decision</strong><span>Review Approver / Procurement Manager away notices and activate only controlled, time-bounded delegation.</span></div></div>
      <div className="admin-form-grid">
        <label><span>Availability request</span><select value={availabilityId} onChange={(e)=>setAvailabilityId(Number(e.target.value))}>{rows.map((row)=><option key={row.id} value={row.id}>#{row.id} — {row.userName||"User"} — {row.reviewStatus||row.status||"Pending"}</option>)}</select></label>
        <label><span>Admin action</span><select value={action} onChange={(e)=>{setAction(e.target.value as AvailabilityAction);setFeedback(null);}}><option>Approve Away Notice</option><option>Reject Away Notice</option><option>Activate Delegation</option><option>Close Delegation / Mark Reviewed</option></select></label>
      </div>
      {selected&&<div className="admin-selected-record"><div><span>User / role</span><strong>{selected.userName||"—"}</strong><small>{roleLabel(selected.role)}</small></div><div><span>Away period</span><strong>{dateOnly(selected.awayStartDate)||"—"} → {dateOnly(selected.awayEndDate)||"—"}</strong><small>{selected.urgency||"Normal"} urgency</small></div><div><span>Review state</span><strong>{selected.reviewStatus||"—"}</strong><small>{selected.status||"—"}</small></div></div>}
      {selected&&<div className="admin-intervention-description"><CalendarCheck2 size={15}/><span><b>Reason supplied:</b> {selected.reason||"—"}{selected.delegateName||selected.delegateRole?` · Recommended delegate: ${selected.delegateName||roleLabel(selected.delegateRole)}`:""}</span></div>}
      {activating&&<><div className="admin-form-grid"><label><span>Delegate role</span><select value={delegateRole} onChange={(e)=>setDelegateRole(e.target.value)}>{allowedDelegateRoles.map((role)=><option key={role} value={role}>{roleLabel(role)}</option>)}</select></label><label><span>Delegate user (optional)</span><select value={delegateUserId} onChange={(e)=>setDelegateUserId(Number(e.target.value))}><option value={0}>Role-level delegation / no specific user</option>{delegateUsers.map((user)=><option key={user.id} value={user.id}>{user.fullName} ({user.username})</option>)}</select></label><label><span>Start date</span><input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)}/></label><label><span>End date</span><input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)}/></label></div><div className="admin-intervention-description"><ShieldAlert size={15}/><span>Overlapping active delegations are blocked server-side. For an Approver / MD absence, non-executive delegation is normalized to Procurement Manager authority.</span></div></>}
      <label className="admin-field-wide"><span>Mandatory Admin note</span><textarea rows={3} value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Document the review decision, authority and handover expectation."/></label>
      <label className="admin-field-wide"><span>Confirm by typing <b>AVAILABILITY #{selected?.id||"—"}</b></span><input value={confirmation} onChange={(e)=>setConfirmation(e.target.value)} placeholder={selected?`AVAILABILITY #${selected.id}`:"AVAILABILITY #"}/></label>
      <div className="admin-submit-row"><button type="button" className={dangerous?"admin-danger-action":"admin-primary-action"} disabled={!ready||!selected||note.trim().length<5||confirmation.trim()!==`AVAILABILITY #${selected.id}`||(activating&&(!delegateRole||!startDate||!endDate))||busy} onClick={submit}>{busy?"Applying…":action}</button><small>Closing a delegation disables its linked approval-delegation record; historical evidence is retained.</small></div>
      {feedback&&<div className={`admin-feedback ${feedback.kind}`}>{feedback.text}</div>}
    </section>
  </div>;
}

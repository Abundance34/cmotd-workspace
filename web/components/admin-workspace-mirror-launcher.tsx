"use client";
import {useState} from "react";
import {Eye,ShieldCheck,RefreshCw} from "lucide-react";
type UserOption={id:number;fullName:string;username:string;role:string;active:boolean};
type Props={users:UserOption[]};
export function AdminWorkspaceMirrorLauncher({users}:Props){
 const [chosen,setChosen]=useState<string>("");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const targets=users.filter(u=>u.role!=="Admin");
 async function open(){
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/admin/workspace-mirror",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetUserId:Number(chosen),reason})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||"Could not open workspace mirror.");
   window.location.href="/app/workspace-mirror/"+body.viewId;
  }catch(e){setError(e instanceof Error?e.message:"Could not open the workspace.");setBusy(false);}
 }
 return <section className="admin-mirror-launcher">
  <div className="admin-mirror-intro"><Eye size={22}/><div><h3>Admin Workspace Inspector</h3><p>Inspect another user's operational dashboard in read-only mode. No password reset, user sign-in or workflow actions are performed.</p></div></div>
  <div className="admin-mirror-control">
   <label>Employee account<select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">Select an employee</option>{targets.map(u=><option value={u.id} key={u.id}>{u.fullName} · {u.role} ({u.username})</option>)}</select></label>
   <label>Business reason for inspection<textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="For example: Verify pending requests and support an operational review." /></label>
   <button type="button" disabled={!chosen||reason.trim().length<8||busy} onClick={()=>void open()}><Eye size={16}/>{busy?"Opening…":"Open read-only dashboard"}</button>
  </div>
  {error?<p className="admin-mirror-error">{error}</p>:null}
  <p className="admin-mirror-audit"><ShieldCheck size={15}/> Your Admin identity is retained; opening a mirror is independently recorded in the signed audit trail.</p>
 </section>;
}

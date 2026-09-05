"use client";

import { Bell, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export function GlobalTools({notifications,onNavigate}:{notifications:any[];onNavigate:(section:string)=>void}){
  const [searchOpen,setSearchOpen]=useState(false);const [notificationsOpen,setNotificationsOpen]=useState(false);const [q,setQ]=useState("");const [results,setResults]=useState<any[]>([]);const [busy,setBusy]=useState(false);
  const unread=useMemo(()=>notifications.filter(n=>!n.is_read).length,[notifications]);
  async function search(){if(q.trim().length<2){setResults([]);return;}setBusy(true);try{const r=await fetch(`/api/parity/search?q=${encodeURIComponent(q.trim())}`,{cache:"no-store"});const p=await r.json();setResults(p.results||[]);}finally{setBusy(false);}}
  async function markRead(id?:number){await fetch("/api/parity/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"notification-read",payload:id?{notificationId:id}:{}})});window.location.reload();}
  return <div className="global-tools">
    <button type="button" aria-label="Search ProcureFlow" onClick={()=>{setSearchOpen(v=>!v);setNotificationsOpen(false)}}><Search size={18}/></button>
    <button type="button" aria-label="Notifications" className="notification-tool" onClick={()=>{setNotificationsOpen(v=>!v);setSearchOpen(false)}}><Bell size={18}/>{unread?<span>{unread>99?"99+":unread}</span>:null}</button>
    {searchOpen?<div className="global-popover search-popover"><div className="global-popover-head"><strong>Search ProcureFlow</strong><button onClick={()=>setSearchOpen(false)}><X size={16}/></button></div><div className="global-search-row"><input autoFocus value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void search()}} placeholder="Request, PO, vendor, payment, invoice, gateway pass…"/><button onClick={()=>void search()} disabled={busy}>{busy?"Searching…":"Search"}</button></div><div className="global-result-list">{results.map((r,index)=><button type="button" key={`${r.type}-${r.id}-${index}`} onClick={()=>{onNavigate(r.section);setSearchOpen(false)}}><strong>{r.title}</strong><span>{r.type} · {r.subtitle}</span></button>)}{!busy&&q.trim().length>=2&&!results.length?<div className="empty-state compact">No matching records.</div>:null}</div></div>:null}
    {notificationsOpen?<div className="global-popover notification-popover"><div className="global-popover-head"><div><strong>Notifications</strong><span>{unread} unread · history is retained after marking read</span></div><button onClick={()=>setNotificationsOpen(false)}><X size={16}/></button></div><div className="notification-actions"><button onClick={()=>void markRead()}>Mark all read</button></div><div className="notification-list">{notifications.slice(0,60).map(n=><article key={n.id} className={n.is_read?"read":"unread"}><button type="button" onClick={()=>{if(n.section_target)onNavigate(n.section_target);if(!n.is_read)void markRead(n.id);setNotificationsOpen(false)}}><strong>{n.title}</strong><span>{n.message}</span><small>{n.created_at?new Date(n.created_at).toLocaleString("en-NG"):""} · {n.importance||"Normal"}</small></button></article>)}{!notifications.length?<div className="empty-state compact">No notifications recorded.</div>:null}</div></div>:null}
  </div>;
}

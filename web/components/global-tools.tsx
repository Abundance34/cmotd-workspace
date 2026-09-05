"use client";

import { Bell, Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function GlobalTools({notifications,onNavigate}:{notifications:any[];onNavigate:(section:string)=>void}){
  const [searchOpen,setSearchOpen]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [q,setQ]=useState("");
  const [results,setResults]=useState<any[]>([]);
  const [busy,setBusy]=useState(false);
  const [theme,setTheme]=useState<"light"|"dark">("light");
  const unread=useMemo(()=>notifications.filter(n=>!n.is_read).length,[notifications]);

  useEffect(()=>{
    const saved=window.localStorage.getItem("procureflow-theme");
    const next=saved==="dark"||saved==="light"?saved:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
    setTheme(next);
    document.documentElement.dataset.theme=next;
  },[]);

  function toggleTheme(){
    const next=theme==="dark"?"light":"dark";
    setTheme(next);
    document.documentElement.dataset.theme=next;
    window.localStorage.setItem("procureflow-theme",next);
  }

  async function search(){
    if(q.trim().length<2){setResults([]);setSearchOpen(true);return;}
    setBusy(true);
    setSearchOpen(true);
    setNotificationsOpen(false);
    try{
      const r=await fetch(`/api/parity/search?q=${encodeURIComponent(q.trim())}`,{cache:"no-store"});
      const p=await r.json();
      setResults(p.results||[]);
    }finally{setBusy(false);}
  }

  async function markRead(id?:number){
    await fetch("/api/parity/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"notification-read",payload:id?{notificationId:id}:{}})});
    window.location.reload();
  }

  return <div className="global-tools">
    <div className="global-search-shell">
      <Search size={16}/>
      <input value={q} onChange={e=>setQ(e.target.value)} onFocus={()=>{if(results.length)setSearchOpen(true);setNotificationsOpen(false)}} onKeyDown={e=>{if(e.key==="Enter")void search()}} placeholder="Search requests, POs, vendors, payments…" aria-label="Search ProcureFlow"/>
      <button type="button" aria-label="Run search" onClick={()=>void search()}><Search size={14}/></button>
    </div>
    <button type="button" aria-label={theme==="dark"?"Switch to light mode":"Switch to dark mode"} className={theme==="dark"?"tool-icon-button theme-tool active":"tool-icon-button theme-tool"} onClick={toggleTheme}>{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button>
    <button type="button" aria-label="Notifications" className="tool-icon-button notification-tool" onClick={()=>{setNotificationsOpen(v=>!v);setSearchOpen(false)}}><Bell size={18}/>{unread?<span>{unread>99?"99+":unread}</span>:null}</button>

    {searchOpen?<div className="global-popover search-popover"><div className="global-popover-head"><div><strong>Search ProcureFlow</strong><span>Search across the records available to your role.</span></div><button type="button" onClick={()=>setSearchOpen(false)}><X size={16}/></button></div><div className="global-search-row"><input autoFocus value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void search()}} placeholder="Request, PO, vendor, payment, invoice, gateway pass…"/><button type="button" onClick={()=>void search()} disabled={busy}>{busy?"Searching…":"Search"}</button></div><div className="global-result-list">{results.map((r,index)=><button type="button" key={`${r.type}-${r.id}-${index}`} onClick={()=>{onNavigate(r.section);setSearchOpen(false)}}><strong>{r.title}</strong><span>{r.type} · {r.subtitle}</span></button>)}{!busy&&q.trim().length>=2&&!results.length?<div className="empty-state compact">No matching records.</div>:null}</div></div>:null}

    {notificationsOpen?<div className="global-popover notification-popover"><div className="global-popover-head"><div><strong>Notifications</strong><span>{unread} unread · history stays available after marking read</span></div><button type="button" onClick={()=>setNotificationsOpen(false)}><X size={16}/></button></div><div className="notification-actions"><button type="button" onClick={()=>void markRead()}>Mark all read</button></div><div className="notification-list">{notifications.slice(0,60).map(n=><article key={n.id} className={n.is_read?"read":"unread"}><button type="button" onClick={()=>{if(n.section_target)onNavigate(n.section_target);if(!n.is_read)void markRead(n.id);setNotificationsOpen(false)}}><strong>{n.title}</strong><span>{n.message}</span><small>{n.created_at?new Date(n.created_at).toLocaleString("en-NG"):""} · {n.importance||"Normal"}</small></button></article>)}{!notifications.length?<div className="empty-state compact">No notifications recorded.</div>:null}</div></div>:null}
  </div>;
}

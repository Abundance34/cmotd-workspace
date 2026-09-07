import fs from "node:fs";
import path from "node:path";

const root = "/app";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}
function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}
function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Facility request-history patch could not find ${label}.`);
  return source.replace(search, replacement);
}

// 1) My Draft Requests becomes the Facility Manager's complete request history,
// presented through one compact selector so sent/reviewed/approved/paid/completed
// requests remain easy to reopen without a long table occupying the workspace.
{
  const relativePath = "components/complete-role-shell.tsx";
  let source = read(relativePath);
  const oldLine = '  if(section==="My Draft Requests")return <FacilityRequestRegister rows={data?.drafts||[]} notifications={parityData.notifications} emptyText="No draft requests are waiting for your review."/>;';
  const newLine = '  if(section==="My Draft Requests")return <FacilityRequestRegister rows={parityData.requests||[]} notifications={parityData.notifications} emptyText="No Facility requests are available yet." compactPicker/>;';
  if (source.includes(oldLine)) source = source.replace(oldLine, newLine);
  else if (!source.includes(newLine)) throw new Error("Facility request-history patch could not find My Draft Requests renderer.");
  write(relativePath, source);
}

// 2) Facility request detail: compact request picker plus a request-context message box.
{
  const relativePath = "components/facility-request-register.tsx";
  let source = read(relativePath);

  source = source.replace(
    'import { Building2, CalendarDays, ChevronRight, CircleDot, Pencil, Send, X } from "lucide-react";',
    'import { Building2, CalendarDays, ChevronRight, CircleDot, MessageSquare, Pencil, Send, X } from "lucide-react";',
  );

  source = source.replace(
    'type Props = { rows: any[]; notifications?: any[]; emptyText?: string };',
    'type Props = { rows: any[]; notifications?: any[]; emptyText?: string; compactPicker?: boolean };',
  );

  source = source.replace(
    'export function FacilityRequestRegister({ rows, notifications = [], emptyText = "No Facility drafts are available." }: Props) {',
    'export function FacilityRequestRegister({ rows, notifications = [], emptyText = "No Facility drafts are available.", compactPicker = false }: Props) {',
  );

  if (!source.includes('const [contextMessage, setContextMessage]')) {
    source = replaceRequired(
      source,
      '  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);',
      '  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);\n  const [contextMessage, setContextMessage] = useState("");\n  const [sendingContext, setSendingContext] = useState(false);',
      "Facility message state",
    );
  }

  if (!source.includes("async function sendContextMessage()")) {
    const marker = '  if (!rows?.length) return <div className="empty-state">{emptyText}</div>;';
    const fn = `  async function sendContextMessage() {
    if (!selectedId || !detail?.request) return;
    const text = contextMessage.trim();
    if (text.length < 4) { setMessage({ type: "error", text: "Enter a short but meaningful context message before sending." }); return; }
    setSendingContext(true); setMessage(null);
    try {
      const response = await fetch("/api/parity/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request-context-message", payload: { requestId: selectedId, message: text } }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to send request context.");
      setContextMessage("");
      setMessage({ type: "success", text: "Context message saved with this request and shared with the assigned Procurement Manager." });
      await loadDetail(selectedId);
      router.refresh();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to send request context." }); }
    finally { setSendingContext(false); }
  }

`;
    source = replaceRequired(source, marker, `${fn}${marker}`, "Facility register empty-state marker");
  }

  if (!source.includes("facility-request-picker")) {
    source = replaceRequired(
      source,
      '    <div className="table-wrap facility-register-table"><table className="data-table">',
      `    {compactPicker ? <div className="facility-request-picker"><label><span>Open my request</span><select value={selectedId ?? ""} onChange={(event) => { const id = Number(event.target.value); if (!id) { setSelectedId(null); setDetail(null); setMessage(null); setEditing(false); return; } const row = rows.find((item: any) => Number(item.id) === id); if (row) void openRequest(row); }}><option value="">Select a request…</option>{rows.map((row: any) => <option key={row.id} value={row.id}>{row.requestNo || row.request_no} — {row.status || "Unknown"} — {money(row.estimatedAmount ?? row.estimated_amount)}</option>)}</select><small>{rows.length} request(s) available — drafts, sent requests and completed workflow history stay in one list.</small></label></div> : <div className="table-wrap facility-register-table"><table className="data-table">`,
      "Facility register table start",
    );
    source = replaceRequired(
      source,
      '    })}</tbody></table></div>\n\n    {selectedId ?',
      '    })}</tbody></table></div>}\n\n    {selectedId ?',
      "Facility register table end",
    );
  }

  if (!source.includes("Request context & messages")) {
    const workflowMarker = '        <div className="facility-detail-block"><div className="facility-detail-block-title"><strong>Workflow history</strong><span>{detail.workflow?.length || 0} event(s)</span></div>';
    const contextBlock = `        <div className="facility-detail-block request-context-panel"><div className="facility-detail-block-title"><strong>Request context & messages</strong><span>{detail.thread_messages?.length || 0} message(s)</span></div><p className="request-context-help">Use this for operational context that is not captured by the formal request fields. Messages stay attached to this request and are visible to the assigned Procurement Manager.</p><div className="request-context-history">{(detail.thread_messages || []).slice(-12).map((item: any) => <article key={item.id}><div><strong>{item.sender_name || item.sender_role || "User"}</strong><small>{dateTime(item.created_at)}</small></div><p>{item.message_text}</p></article>)}{!detail.thread_messages?.length ? <span className="request-context-empty">No additional context has been sent for this request yet.</span> : null}</div><textarea rows={3} value={contextMessage} maxLength={2000} onChange={(event) => setContextMessage(event.target.value)} placeholder="Add information, clarification, delivery context, special instruction or anything the request fields do not capture…"/><div className="request-context-send"><small>{contextMessage.trim().length}/2000</small><button type="button" className="facility-submit-primary" disabled={sendingContext || contextMessage.trim().length < 4} onClick={() => void sendContextMessage()}><MessageSquare size={16}/>{sendingContext ? "Sending…" : "Send Message"}</button></div></div>\n`;
    source = replaceRequired(source, workflowMarker, `${contextBlock}${workflowMarker}`, "Facility workflow history block");
  }

  write(relativePath, source);
}

// 3) Return the shared request thread and its messages with Facility request detail.
{
  const relativePath = "app/api/facility/requests/[id]/route.ts";
  let source = read(relativePath);
  if (!source.includes("threadMessages")) {
    source = replaceRequired(
      source,
      '    const payee = payeeRows[0] || null;\n    return NextResponse.json({',
      `    const payee = payeeRows[0] || null;
    const threadRows = await sql<any[]>\`
      SELECT ct.id, ct.entity_type, ct.entity_id, ct.facility_manager_user_id,
             ct.procurement_manager_user_id, ct.visibility_scope, ct.created_at, ct.updated_at,
             pm.full_name AS procurement_manager_name
      FROM collaboration_threads ct
      LEFT JOIN users pm ON pm.id = ct.procurement_manager_user_id
      WHERE ct.entity_type = 'Purchase Request' AND ct.entity_id = \${requestId}
      ORDER BY COALESCE(ct.updated_at, ct.created_at) DESC, ct.id DESC
      LIMIT 1
    \`;
    const thread = threadRows[0] || null;
    const threadMessages = thread ? await sql<any[]>\`
      SELECT cm.id, cm.thread_id, cm.sender_user_id, cm.message_text, cm.created_at,
             u.full_name AS sender_name, u.role AS sender_role
      FROM collaboration_messages cm
      LEFT JOIN users u ON u.id = cm.sender_user_id
      WHERE cm.thread_id = \${Number(thread.id)}
      ORDER BY cm.created_at ASC, cm.id ASC
      LIMIT 500
    \` : [];
    return NextResponse.json({`,
      "Facility detail thread query",
    );
    source = replaceRequired(
      source,
      '      workflow: workflow.map((event) => ({ ...event, id: Number(event.id) })),\n      payee:',
      '      workflow: workflow.map((event) => ({ ...event, id: Number(event.id) })),\n      thread: thread ? { ...thread, id: Number(thread.id) } : null,\n      thread_messages: threadMessages.map((item) => ({ ...item, id: Number(item.id), thread_id: Number(item.thread_id) })),\n      payee:',
      "Facility detail response thread fields",
    );
  }
  write(relativePath, source);
}

// 4) A Facility context message creates/reuses the request thread, keeps a full audit trail,
// and notifies Procurement once the request has actually entered the workflow.
{
  const relativePath = "lib/procureflow/parity-actions.ts";
  let source = read(relativePath);
  if (!source.includes('if(action==="request-context-message")')) {
    const marker = '  if(action==="thread-message"){';
    const block = `  if(action==="request-context-message"){
    assertRole(user,["Facility Manager","Admin"]);const requestId=positiveId(payload.requestId,"request");const message=reason(payload.message);
    return sql.begin(async tx=>{
      const request=(await tx<any[]>\`SELECT pr.*,u.role requester_role FROM purchase_requests pr LEFT JOIN users u ON u.id=pr.requested_by WHERE pr.id=\${requestId} FOR UPDATE\`)[0];
      if(!request)throw new Error("Request not found.");
      const facilityId=Number(request.facility_manager_user_id||request.requested_by||0);
      if(user.role!=="Admin"&&Number(request.requested_by)!==user.id&&facilityId!==user.id)throw new Error("You can add context only to your own Facility request.");
      let procurementId=Number(request.assigned_procurement_manager_id||0);
      if(!procurementId){const managers=await tx<any[]>\`SELECT id FROM users WHERE role='Procurement Manager' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(account_locked,FALSE)=FALSE ORDER BY id LIMIT 1\`;procurementId=Number(managers[0]?.id||0);}
      if(!procurementId)throw new Error("No active Procurement Manager is available for this request.");
      const threadRows=await tx<any[]>\`INSERT INTO collaboration_threads (entity_type,entity_id,facility_manager_user_id,procurement_manager_user_id,visibility_scope,created_at,updated_at) VALUES ('Purchase Request',\${requestId},\${facilityId},\${procurementId},'FM_PM_ADMIN',NOW(),NOW()) ON CONFLICT (entity_type,entity_id,facility_manager_user_id,procurement_manager_user_id) DO UPDATE SET updated_at=NOW() RETURNING id\`;
      const threadId=Number(threadRows[0].id);
      const row=await tx<any[]>\`INSERT INTO collaboration_messages (thread_id,sender_user_id,message_text,is_private,created_at) VALUES (\${threadId},\${user.id},\${message},1,NOW()) RETURNING id\`;
      const draftOnly=["FM Draft","Draft"].includes(String(request.status||""));
      if(!draftOnly)await notifyUser(tx,procurementId,"New request context message",String(request.request_no||"Request")+": "+message.slice(0,160),"Purchase Request",requestId,"Utility Head / Facility Head Inbox","Normal");
      await evidence(tx,user,{action:"Request Context Message",entityType:"Purchase Request",entityId:requestId,entityReference:request.request_no,after:{thread_id:threadId,message_id:Number(row[0].id),message_length:message.length},note:"Facility request context message recorded",relatedUserId:procurementId});
      return {threadId,messageId:Number(row[0].id)};
    });
  }

`;
    source = replaceRequired(source, marker, `${block}${marker}`, "shared-thread action marker");
  }
  write(relativePath, source);
}

// 5) Compact selector and request-context presentation.
{
  const relativePath = "app/local-preview-parity.css";
  let source = read(relativePath);
  if (!source.includes("FACILITY REQUEST HISTORY + CONTEXT")) {
    source += `

/* FACILITY REQUEST HISTORY + CONTEXT */
.facility-request-picker{margin:12px 0 18px;padding:14px 16px;border:1px solid var(--border,#d9e1ec);border-radius:12px;background:var(--surface,#fff)}
.facility-request-picker label{display:grid;gap:7px}.facility-request-picker label>span{font-weight:700}.facility-request-picker select{width:100%;min-height:44px;padding:0 12px;border:1px solid var(--border,#cfd8e6);border-radius:9px;background:var(--surface,#fff);color:inherit}.facility-request-picker small{opacity:.72}
.request-context-panel{display:grid;gap:12px}.request-context-help{margin:0;opacity:.76}.request-context-history{display:grid;gap:8px;max-height:260px;overflow:auto}.request-context-history article{padding:10px 12px;border:1px solid var(--border,#d9e1ec);border-radius:10px}.request-context-history article>div{display:flex;justify-content:space-between;gap:12px;align-items:center}.request-context-history article p{margin:6px 0 0;white-space:pre-wrap}.request-context-history small,.request-context-empty{opacity:.68}.request-context-panel textarea{width:100%;resize:vertical;min-height:92px}.request-context-send{display:flex;justify-content:flex-end;gap:12px;align-items:center}.request-context-send small{opacity:.68}
@media(max-width:720px){.request-context-history article>div{align-items:flex-start;flex-direction:column;gap:2px}.request-context-send{justify-content:space-between}}
`;
  }
  write(relativePath, source);
}

console.log("Facility request history/context applied: My Draft Requests now exposes the full Facility-owned request lifecycle in a compact dropdown, with request-linked context messaging to Procurement.");

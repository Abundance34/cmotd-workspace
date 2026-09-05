import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { appendAuditEvent } from "./audit";

export type AdminAvailabilityAction = "Approve Away Notice" | "Reject Away Notice" | "Activate Delegation" | "Close Delegation / Mark Reviewed";

function assertAdmin(user: CurrentUser) {
  if (user.role !== "Admin") throw new Error("Only Admin can review availability and delegation requests.");
}

function reasonText(value: string) {
  const reason=String(value||"").trim().replace(/\s+/g," ");
  if(reason.length<5)throw new Error("A meaningful Admin note is required.");
  return reason;
}

function controlRef(prefix:string){return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,17)}-${randomUUID().slice(0,8).toUpperCase()}`;}

async function recordControl(tx:any,input:{user:CurrentUser;action:string;entityType:string;entityId:number;targetUserId?:number|null;reason:string;before:Record<string,unknown>;after:Record<string,unknown>;severity?:string}){
  const now=new Date().toISOString();const interventionNo=controlRef("ADM-INT");const correlationId=controlRef("ADM-CORR");const severity=input.severity||"High";
  const rows=await tx<{id:number}[]>`
    INSERT INTO admin_interventions (intervention_no,intervention_type,entity_type,entity_id,target_user_id,severity,reason,before_state_json,after_state_json,actor_user_id,actor_role,correlation_id,created_at)
    VALUES (${interventionNo},${input.action},${input.entityType},${input.entityId},${input.targetUserId??null},${severity},${input.reason},${JSON.stringify(input.before)},${JSON.stringify(input.after)},${input.user.id},'Admin',${correlationId},${now}) RETURNING id
  `;
  await tx`INSERT INTO activity_logs (user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at) VALUES (${input.user.id},'Admin',${input.action},${input.entityType},${input.entityId},${`${input.action} recorded as ${interventionNo}`},${input.reason},'admin',${input.targetUserId??null},${now})`;
  await tx`INSERT INTO audit_logs (action,entity_type,entity_id,user_id,role,details,before_values,after_values,created_at,event_date,event_time,notes) VALUES (${input.action.toUpperCase().replace(/[^A-Z0-9]+/g,"_")},${input.entityType},${String(input.entityId)},${input.user.id},'Admin',${input.reason},${tx.json(input.before)},${tx.json(input.after)},${now},${now.slice(0,10)},${now.slice(11,19)},${input.reason})`;
  await appendAuditEvent(tx,{action:input.action.toUpperCase().replace(/[^A-Z0-9]+/g,"_"),entityType:input.entityType,entityId:input.entityId,entityReference:interventionNo,actorUserId:input.user.id,actorUsername:input.user.username,actorRole:"Admin",beforeValues:input.before,afterValues:input.after,metadata:{intervention_no:interventionNo,correlation_id:correlationId,target_user_id:input.targetUserId??null},reasonOrComment:input.reason,severity,source:"nextjs-admin"});
  return {interventionId:Number(rows[0].id),interventionNo,correlationId};
}

async function notifyUser(tx:any,userId:number,title:string,message:string,availabilityId:number){const now=new Date().toISOString();await tx`INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at) VALUES (${userId},NULL,${title},${message},'Availability',${availabilityId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Open Availability','Availability / Away Notice',${now})`;}
async function notifyRole(tx:any,role:string,title:string,message:string,availabilityId:number){const now=new Date().toISOString();await tx`INSERT INTO notifications (user_id,role,title,message,entity_type,entity_id,is_read,popup_shown,importance,delivery_channel,push_sent,email_sent,action_label,section_target,created_at) VALUES (NULL,${role},${title},${message},'Availability',${availabilityId},FALSE,FALSE,'High','in_app',FALSE,FALSE,'Open Availability','Availability / Away Notice',${now})`;}

function cleanDate(value:string,label:string){const text=String(value||"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error(`${label} must be a valid date.`);return text;}

export async function reviewAdminAvailability(
  user:CurrentUser,
  input:{availabilityId:number;action:AdminAvailabilityAction;adminNote:string;delegateRole?:string|null;delegateUserId?:number|null;startDate?:string|null;endDate?:string|null},
){
  assertAdmin(user);const availabilityId=Number(input.availabilityId);if(!Number.isInteger(availabilityId)||availabilityId<=0)throw new Error("Choose a valid availability request.");
  const note=reasonText(input.adminNote);const allowed:AdminAvailabilityAction[]=["Approve Away Notice","Reject Away Notice","Activate Delegation","Close Delegation / Mark Reviewed"];if(!allowed.includes(input.action))throw new Error("Choose a valid Admin availability action.");
  const sql=db();return sql.begin(async(tx)=>{
    const rows=await tx<any[]>`SELECT ua.*,u.full_name,u.username FROM user_availability ua LEFT JOIN users u ON u.id=ua.user_id WHERE ua.id=${availabilityId} FOR UPDATE OF ua`;
    const row=rows[0];if(!row)throw new Error("Availability request was not found.");
    const before={status:row.status,admin_review_status:row.admin_review_status,linked_delegation_id:row.linked_delegation_id,role:row.role,away_start_date:row.away_start_date,away_end_date:row.away_end_date};
    const now=new Date().toISOString();let after:Record<string,unknown>;let event:string;let delegationId:number|null=row.linked_delegation_id==null?null:Number(row.linked_delegation_id);

    if(input.action==="Reject Away Notice"){
      if(row.admin_review_status==="Delegation Active")throw new Error("Close the active delegation before rejecting this away notice.");
      await tx`UPDATE user_availability SET admin_review_status='Rejected',status='Cancelled',reviewed_by_admin_id=${user.id},reviewed_at=${now},admin_note=${note},updated_at=${now} WHERE id=${availabilityId}`;
      event="AWAY_NOTICE_REJECTED";after={...before,status:"Cancelled",admin_review_status:"Rejected",admin_note:note};
      await notifyUser(tx,Number(row.user_id),"Away notice rejected",note,availabilityId);
    }else if(input.action==="Approve Away Notice"){
      if(row.admin_review_status==="Rejected"||row.status==="Cancelled")throw new Error("A rejected/cancelled away notice cannot be approved without a new request.");
      await tx`UPDATE user_availability SET admin_review_status='Approved',status='Away Approved',reviewed_by_admin_id=${user.id},reviewed_at=${now},admin_note=${note},updated_at=${now} WHERE id=${availabilityId}`;
      event="AWAY_NOTICE_APPROVED";after={...before,status:"Away Approved",admin_review_status:"Approved",admin_note:note};
      await notifyUser(tx,Number(row.user_id),"Away notice approved",note,availabilityId);
    }else if(input.action==="Activate Delegation"){
      if(delegationId){const existing=await tx<{enabled:boolean}[]>`SELECT enabled FROM approval_delegations WHERE id=${delegationId} LIMIT 1`;if(existing[0]?.enabled)throw new Error("This availability request already has an active delegation.");}
      const delegateRoles=["Procurement Manager","Admin","Approver","Finance"];let delegateRole=String(input.delegateRole||row.recommended_delegate_role||"").trim();if(!delegateRoles.includes(delegateRole))throw new Error("Choose a valid delegate role.");
      if(row.role==="Approver"&&!['Admin','Approver'].includes(delegateRole))delegateRole="Procurement Manager";
      const startDate=cleanDate(String(input.startDate||row.away_start_date||""),"Delegation start date");const endDate=cleanDate(String(input.endDate||row.away_end_date||""),"Delegation end date");if(startDate>endDate)throw new Error("Delegation end date cannot be before the start date.");
      const delegateUserId=input.delegateUserId==null?null:Number(input.delegateUserId);if(delegateUserId){if(!Number.isInteger(delegateUserId)||delegateUserId<=0)throw new Error("Choose a valid delegate user.");if(delegateUserId===Number(row.user_id))throw new Error("A user cannot be delegated to themselves.");const du=await tx<any[]>`SELECT id,role,is_active,full_name FROM users WHERE id=${delegateUserId} LIMIT 1`;if(!du[0]||!du[0].is_active)throw new Error("The selected delegate user must be active.");if(du[0].role!==delegateRole)throw new Error("The selected delegate user's role does not match the delegation role.");}
      const overlapping=await tx<{id:number}[]>`SELECT id FROM approval_delegations WHERE enabled=TRUE AND (primary_user_id=${Number(row.user_id)} OR (primary_user_id IS NULL AND primary_role=${String(row.role)})) AND (end_date IS NULL OR end_date>=CAST(${startDate} AS DATE)) AND (start_date IS NULL OR start_date<=CAST(${endDate} AS DATE)) LIMIT 1`;
      if(overlapping[0])throw new Error("An active overlapping delegation already exists for this primary user/role. Close it before creating another.");
      const drows=await tx<{id:number}[]>`
        INSERT INTO approval_delegations (id,primary_role,delegate_role,enabled,start_date,end_date,reason,created_by,created_at,updated_at,source_availability_id,source_reason,activated_by_admin_id,activation_note,primary_user_id,delegate_user_id)
        VALUES (nextval('approval_delegations_id_seq'),${String(row.role)},${delegateRole},TRUE,CAST(${startDate} AS DATE),CAST(${endDate} AS DATE),${`Delegation active due to away notice: ${row.reason}`},${user.id},${now},${now},${availabilityId},${String(row.reason)},${user.id},${note},${Number(row.user_id)},${delegateUserId}) RETURNING id
      `;
      delegationId=Number(drows[0].id);
      await tx`UPDATE user_availability SET admin_review_status='Delegation Active',status='Away Active',linked_delegation_id=${delegationId},reviewed_by_admin_id=${user.id},reviewed_at=${now},admin_note=${note},updated_at=${now} WHERE id=${availabilityId}`;
      event="DELEGATION_ACTIVATED_FROM_AWAY";after={...before,status:"Away Active",admin_review_status:"Delegation Active",linked_delegation_id:delegationId,delegate_role:delegateRole,delegate_user_id:delegateUserId,start_date:startDate,end_date:endDate};
      await notifyUser(tx,Number(row.user_id),"Delegation activated",`Admin activated ${delegateRole} delegation during your away period. ${note}`,availabilityId);
      if(delegateUserId)await notifyUser(tx,delegateUserId,"Delegation assigned",`You were selected as delegate for ${row.full_name||row.username||"a ProcureFlow user"}. ${note}`,availabilityId);else await notifyRole(tx,delegateRole,"Delegation activated",`${delegateRole} delegation is active for an approved away period. ${note}`,availabilityId);
    }else{
      if(delegationId)await tx`UPDATE approval_delegations SET enabled=FALSE,updated_at=${now},activation_note=concat_ws(E'\n',NULLIF(activation_note,''),${`Closed by Admin: ${note}`}) WHERE id=${delegationId}`;
      await tx`UPDATE user_availability SET admin_review_status='Closed',status='Returned',reviewed_by_admin_id=${user.id},reviewed_at=${now},admin_note=${note},updated_at=${now} WHERE id=${availabilityId}`;
      event="AWAY_DELEGATION_CLOSED";after={...before,status:"Returned",admin_review_status:"Closed",linked_delegation_id:delegationId,delegation_enabled:false};
      await notifyUser(tx,Number(row.user_id),"Delegation reviewed / closed",note,availabilityId);
    }

    const intervention=await recordControl(tx,{user,action:event,entityType:"Availability",entityId:availabilityId,targetUserId:Number(row.user_id),reason:note,before,after,severity:"High"});
    await notifyRole(tx,"Auditor",`Audit activity: ${event}`,`Admin performed ${event} on availability request #${availabilityId}.`,availabilityId);
    return {...intervention,availabilityId,delegationId,event,status:after.status,reviewStatus:after.admin_review_status};
  });
}

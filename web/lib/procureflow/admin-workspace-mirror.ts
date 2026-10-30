import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {db} from "@/lib/db";
import type {CurrentUser} from "@/lib/auth";
import {isProcureFlowRole} from "@/lib/procureflow/roles";
import {activeAuditSigningKey,appendAuditEvent} from "@/lib/procureflow/audit";

const DOMAIN="procureflow:admin-workspace-mirror:v1";
const LIFETIME_MS=15*60*1000;

function signature(payload:string){
  return createHmac("sha256",activeAuditSigningKey()).update(DOMAIN+"\n"+payload).digest("base64url");
}
export function makeMirrorToken(adminId:number,targetId:number){
  const payload=Buffer.from(JSON.stringify({a:adminId,t:targetId,expires:Date.now()+LIFETIME_MS,nonce:randomBytes(12).toString("hex")})).toString("base64url");
  return payload+"."+signature(payload);
}
export function readMirrorToken(token:string,adminId:number){
  if(token.length>750||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new Error("Invalid inspection link.");
  const [payload,mac]=token.split(".");
  const expected=Buffer.from(signature(payload),"utf8"),supplied=Buffer.from(mac,"utf8");
  if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw new Error("Inspection access is invalid.");
  const parsed=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
  if(!Number.isSafeInteger(parsed.a)||parsed.a!==adminId||!Number.isSafeInteger(parsed.t)||parsed.t<=0||!Number.isFinite(parsed.expires)||parsed.expires<=Date.now()||parsed.expires>Date.now()+LIFETIME_MS)throw new Error("Inspection access has expired.");
  return parsed.t as number;
}
export async function startMirrorInspection(admin:CurrentUser,targetUserId:unknown,purpose:unknown){
  if(admin.role!=="Admin"||admin.mustChangePassword)throw new Error("Only an authenticated Admin can inspect a workspace.");
  const targetId=Number(targetUserId);
  if(!Number.isSafeInteger(targetId)||targetId<=0||targetId===admin.id)throw new Error("Select another employee.");
  const reason=String(purpose??"").trim().slice(0,500);
  if(reason.length<8)throw new Error("Provide a business reason (at least 8 characters).");
  const sql=db();
  const result=await sql.begin(async tx=>{
    const rows=await tx<any[]>`SELECT id,username,full_name,role,is_active FROM users WHERE id=${targetId} LIMIT 1`;
    const target=rows[0];
    if(!target||target.role==="Admin"||!isProcureFlowRole(String(target.role)))throw new Error("Select a valid employee account.");
    await appendAuditEvent(tx,{
      action:"Admin Workspace Mirror Opened",entityType:"User",entityId:targetId,
      entityReference:String(target.username),actorUserId:admin.id,actorUsername:admin.username,actorRole:admin.role,
      afterValues:{mode:"read-only",target_role:target.role,expires_in_minutes:15},
      metadata:{feature:"admin_workspace_mirror",target_user_id:targetId,access:"admin-only"},
      reasonOrComment:reason,severity:"Normal",source:"nextjs"
    });
    await tx`INSERT INTO activity_logs(user_id,role,action,entity_type,entity_id,public_summary,private_details,visibility_scope,related_user_id,created_at)
      VALUES(${admin.id},'Admin','Admin Workspace Mirror Opened','User',${targetId},'Admin read-only workspace inspection',${reason},'admin',NULL,NOW())`;
    return target;
  });
  return {viewId:makeMirrorToken(admin.id,Number(result.id)),targetName:String(result.full_name),role:String(result.role)};
}
export async function getMirrorTarget(admin:CurrentUser,token:string):Promise<CurrentUser>{
  if(admin.role!=="Admin"||admin.mustChangePassword)throw new Error("Admin access required.");
  const id=readMirrorToken(token,admin.id);
  const rows=await db()<any[]>`SELECT id,username,full_name,role,must_change_password FROM users WHERE id=${id}`;
  const row=rows[0];
  if(!row||row.role==="Admin"||!isProcureFlowRole(String(row.role)))throw new Error("Employee workspace is unavailable.");
  return {id:Number(row.id),username:row.username,fullName:row.full_name,role:row.role,mustChangePassword:Boolean(row.must_change_password)};
}

import { db } from "@/lib/db";
import { getAuditorDashboardData, type AuditorDashboardData } from "./auditor-data";

export type AuditorRoleActivityRow = {
  id:number; userId:number|null; userName:string|null; username:string|null; userRole:string|null; activityRole:string|null;
  createdAt:string|null; action:string; entityType:string|null; entityId:number|null; summary:string|null; visibility:string|null;
};

export type AuditorUser360Row = {
  id:number; username:string; fullName:string; role:string; email:string|null; active:boolean; locked:boolean;
  failedLoginCount:number; mustChangePassword:boolean; lastLoginAt:string|null; updatedAt:string|null;
  passwordChangeCount:number; passwordAdminResetCount:number; activityCount:number; sessionCount:number; lastActivityAt:string|null;
};

export type AuditorApprovalTrailRow = {
  id:number; createdAt:string|null; source:"approval"|"workflow"; entityType:string; entityId:number; requestId:number|null;
  action:string; before:string|null; after:string|null; approvedBy:string|null; approvedByRole:string|null;
  approvalMode:string|null; note:string|null; requestNo:string|null; category:string|null; amount:number|null; entityLabel:string;
};

export type AuditorReviewDashboardData = AuditorDashboardData & {
  roleActivities: AuditorRoleActivityRow[];
  user360: AuditorUser360Row[];
  approvalTrail: AuditorApprovalTrailRow[];
  requestWorkflowTrail: AuditorApprovalTrailRow[];
};

function iso(value:unknown){if(!value)return null;return value instanceof Date?value.toISOString():String(value);}

export async function getAuditorReviewDashboardData():Promise<AuditorReviewDashboardData>{
  const base=await getAuditorDashboardData();
  const sql=db();
  const [activityRows,userRows,approvalRows,workflowRows]=await Promise.all([
    sql<any[]>`
      SELECT al.id,al.user_id,u.full_name user_name,u.username,u.role user_role,al.role activity_role,
             al.created_at,al.action,al.entity_type,al.entity_id,al.public_summary,al.visibility_scope
      FROM activity_logs al
      LEFT JOIN users u ON u.id=al.user_id
      ORDER BY al.created_at DESC,al.id DESC
      LIMIT 2500
    `,
    sql<any[]>`
      SELECT u.id,u.username,u.full_name,u.role,u.email,u.is_active,u.account_locked,u.failed_login_count,
             u.must_change_password,u.last_login_at,u.updated_at,
             (SELECT COUNT(*)::int FROM activity_logs a WHERE a.user_id=u.id AND a.action='PASSWORD_CHANGE') password_change_count,
             (SELECT COUNT(*)::int FROM activity_logs a WHERE a.user_id=u.id AND a.action ILIKE '%PASSWORD%' AND a.action<>'PASSWORD_CHANGE') password_admin_reset_count,
             (SELECT COUNT(*)::int FROM activity_logs a WHERE a.user_id=u.id) activity_count,
             (SELECT COUNT(*)::int FROM user_sessions s WHERE s.user_id=u.id) session_count,
             (SELECT MAX(a.created_at) FROM activity_logs a WHERE a.user_id=u.id) last_activity_at
      FROM users u
      ORDER BY u.full_name,u.username
    `,
    sql<any[]>`
      SELECT ah.id,ah.created_at,'approval'::text source,ah.entity_type,ah.entity_id,ah.action,
             ah.status_before,ah.status_after,COALESCE(actor.full_name,ah.approved_by_role) approved_by,
             ah.approved_by_role,ah.approval_mode,COALESCE(ah.note,ah.reason) note,
             pr.id request_id,pr.request_no,pr.category,pr.estimated_amount,
             CASE
               WHEN ah.entity_type='Purchase Request' THEN COALESCE(pr.request_no,'Purchase Request #'||ah.entity_id::text)
               WHEN ah.entity_type='Purchase Order' THEN COALESCE(po.po_no,'Purchase Order #'||ah.entity_id::text)
               WHEN ah.entity_type='Payment' THEN COALESCE(p.payment_no,'Payment #'||ah.entity_id::text)
               WHEN ah.entity_type='Gateway Pass' THEN COALESCE(gp.pass_number,'Gateway Pass #'||ah.entity_id::text)
               ELSE ah.entity_type||' #'||ah.entity_id::text
             END entity_label,
             COALESCE(pr.category,v.name,po.status,p.status,gp.movement_type) entity_category,
             COALESCE(pr.estimated_amount,po.total_amount,p.amount,NULL) entity_amount
      FROM approval_history ah
      LEFT JOIN users actor ON actor.id=COALESCE(ah.approved_by_user_id,ah.user_id)
      LEFT JOIN purchase_requests pr ON ah.entity_type='Purchase Request' AND pr.id=ah.entity_id
      LEFT JOIN purchase_orders po ON ah.entity_type='Purchase Order' AND po.id=ah.entity_id
      LEFT JOIN vendors v ON v.id=po.vendor_id
      LEFT JOIN payments p ON ah.entity_type='Payment' AND p.id=ah.entity_id
      LEFT JOIN gateway_passes gp ON ah.entity_type='Gateway Pass' AND gp.id=ah.entity_id
      ORDER BY ah.created_at DESC,ah.id DESC
      LIMIT 1500
    `,
    sql<any[]>`
      SELECT we.id,we.created_at,'workflow'::text source,we.entity_type,we.entity_id,we.event action,
             NULL::text status_before,we.status status_after,u.full_name approved_by,u.role approved_by_role,
             NULL::text approval_mode,we.note,
             pr.id request_id,pr.request_no,pr.category,pr.estimated_amount,
             COALESCE(pr.request_no,we.entity_type||' #'||we.entity_id::text) entity_label
      FROM workflow_events we
      LEFT JOIN users u ON u.id=we.user_id
      LEFT JOIN purchase_requests pr ON we.entity_type='Purchase Request' AND pr.id=we.entity_id
      WHERE we.entity_type='Purchase Request'
        AND (
          we.event ILIKE '%Sent for Procurement Review%' OR we.status='Sent for Procurement Review'
          OR we.event ILIKE '%Returned for Correction%' OR we.status='Returned for Correction'
        )
      ORDER BY we.created_at DESC,we.id DESC
      LIMIT 1200
    `
  ]);

  const roleActivities:AuditorRoleActivityRow[]=activityRows.map((r:any)=>({
    id:Number(r.id),userId:r.user_id==null?null:Number(r.user_id),userName:r.user_name||null,username:r.username||null,
    userRole:r.user_role||null,activityRole:r.activity_role||null,createdAt:iso(r.created_at),action:r.action,
    entityType:r.entity_type||null,entityId:r.entity_id==null?null:Number(r.entity_id),summary:r.public_summary||null,visibility:r.visibility_scope||null
  }));
  const user360:AuditorUser360Row[]=userRows.map((r:any)=>({
    id:Number(r.id),username:r.username,fullName:r.full_name,role:r.role,email:r.email||null,active:Boolean(r.is_active),
    locked:Boolean(r.account_locked),failedLoginCount:Number(r.failed_login_count||0),mustChangePassword:Boolean(r.must_change_password),
    lastLoginAt:iso(r.last_login_at),updatedAt:iso(r.updated_at),passwordChangeCount:Number(r.password_change_count||0),
    passwordAdminResetCount:Number(r.password_admin_reset_count||0),activityCount:Number(r.activity_count||0),
    sessionCount:Number(r.session_count||0),lastActivityAt:iso(r.last_activity_at)
  }));
  const approvalTrail:AuditorApprovalTrailRow[]=approvalRows.map((r:any)=>({
    id:Number(r.id),createdAt:iso(r.created_at),source:"approval",entityType:r.entity_type,entityId:Number(r.entity_id),
    requestId:r.request_id==null?null:Number(r.request_id),action:r.action,before:r.status_before||null,after:r.status_after||null,
    approvedBy:r.approved_by||null,approvedByRole:r.approved_by_role||null,approvalMode:r.approval_mode||null,note:r.note||null,
    requestNo:r.request_no||null,category:r.entity_category||r.category||null,
    amount:r.entity_amount==null?null:Number(r.entity_amount),entityLabel:r.entity_label
  }));
  const requestWorkflowTrail:AuditorApprovalTrailRow[]=workflowRows.map((r:any)=>({
    id:Number(r.id),createdAt:iso(r.created_at),source:"workflow",entityType:r.entity_type,entityId:Number(r.entity_id),
    requestId:r.request_id==null?null:Number(r.request_id),action:r.action,before:r.status_before||null,after:r.status_after||null,
    approvedBy:r.approved_by||null,approvedByRole:r.approved_by_role||null,approvalMode:null,note:r.note||null,
    requestNo:r.request_no||null,category:r.category||null,amount:r.estimated_amount==null?null:Number(r.estimated_amount),entityLabel:r.entity_label
  }));
  return {...base,roleActivities,user360,approvalTrail,requestWorkflowTrail};
}

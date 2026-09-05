import { db } from "@/lib/db";

export type AuditorMetricData = {
  auditEvents: number;
  highSeverity: number;
  exceptionOutcomes: number;
  openLogisticsExceptions: number;
  activeSessions: number;
  unreadNotifications: number;
};

export type AuditorAuditEventRow = {
  id: number;
  occurredAt: string | null;
  correlationId: string | null;
  entityType: string | null;
  entityId: string | null;
  entityReference: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  action: string;
  outcome: string | null;
  severity: string | null;
  source: string | null;
  reason: string | null;
  signatureKeyVersion: string | null;
};

export type AuditorActivityRow = { id: number; createdAt: string | null; role: string | null; action: string; entityType: string | null; entityId: number | null; summary: string | null; visibility: string | null };
export type AuditorWorkflowRow = { id: number; createdAt: string | null; entityType: string; entityId: number; event: string; status: string | null; note: string | null; userName: string | null };
export type AuditorApprovalRow = { id: number; createdAt: string | null; entityType: string; entityId: number; action: string; before: string | null; after: string | null; approvedBy: string | null; approvedByRole: string | null; approvalMode: string | null; note: string | null };
export type AuditorNotificationRow = { id: number; createdAt: string | null; userName: string | null; role: string | null; title: string; entityType: string | null; entityId: number | null; read: boolean; importance: string | null; deliveryChannel: string | null; pushSent: boolean; emailSent: boolean; sectionTarget: string | null };
export type AuditorUserRow = { id: number; username: string; fullName: string; role: string; email: string | null; active: boolean; locked: boolean; failedLoginCount: number; mustChangePassword: boolean; lastLoginAt: string | null; updatedAt: string | null };
export type AuditorSessionRow = { id: number; userName: string | null; username: string | null; role: string | null; loginAt: string | null; logoutAt: string | null; lastSeenAt: string | null; status: string | null; ipAddress: string | null; userAgent: string | null; expiresAt: string | null };
export type AuditorRequestRow = { id: number; requestNo: string; departmentProject: string | null; category: string | null; amount: number; status: string | null; paymentStatus: string | null; nextRole: string | null; requestedBy: string | null; facilityManager: string | null; procurementManager: string | null; updatedAt: string | null };
export type AuditorQuoteRow = { id: number; requestNo: string | null; vendorName: string | null; quotedAmount: number; currency: string | null; deliveryDays: number | null; paymentTerms: string | null; recommended: boolean; selected: boolean; score: number | null; createdAt: string | null };
export type AuditorPORow = { id: number; poNo: string; requestNo: string | null; vendorName: string | null; amount: number; status: string | null; logisticsStatus: string | null; receivingStatus: string | null; paymentStatus: string | null; approvedByRole: string | null; nextRole: string | null; updatedAt: string | null };
export type AuditorReceivingRow = { id: number; slipNo: string; poNo: string | null; requestNo: string | null; vendorName: string | null; receivedBy: string | null; dateReceived: string | null; deliveryNoteNo: string | null; status: string | null; discrepancyNotes: string | null; createdAt: string | null };
export type AuditorExceptionRow = { id: number; exceptionNo: string; poNo: string | null; requestNo: string | null; exceptionType: string; description: string; paymentImpact: boolean; status: string | null; resolutionNote: string | null; createdAt: string | null; updatedAt: string | null };
export type AuditorPaymentRow = { id: number; paymentNo: string; requestNo: string | null; poNo: string | null; vendorName: string | null; amount: number; currency: string | null; status: string | null; verificationStatus: string | null; transferType: string | null; paymentReference: string | null; paymentDate: string | null; approvedByRole: string | null; createdAt: string | null };
export type AuditorPayeeAuditRow = { id: number; occurredAt: string | null; action: string; outcome: string | null; severity: string | null; actorUsername: string | null; actorRole: string | null; entityId: string | null; entityReference: string | null; reason: string | null };
export type AuditorGatewayRow = { id: number; passNumber: string; facilityManager: string | null; department: string | null; movementType: string; destination: string | null; status: string | null; logisticsStatus: string | null; approvedByRole: string | null; createdAt: string | null; updatedAt: string | null };
export type AuditorVendorRow = { id: number; name: string; category: string | null; status: string | null; rating: number | null; completedOrders: number; totalSpend: number; averageDeliveryTime: number | null; rejectionCount: number; lastPurchaseDate: string | null };
export type AuditorBudgetRow = { id: number; month: string; departmentProject: string | null; category: string | null; limitAmount: number; overrideRequired: boolean };
export type AuditorReceiptRow = { id: number; receiptNo: string; requestNo: string | null; paymentNo: string | null; poNo: string | null; vendorName: string | null; receiptType: string | null; paymentMethod: string | null; amount: number; currency: string | null; status: string | null; originalFileName: string | null; fileChecksum: string | null; ocrStatus: string | null; discrepancyStatus: string | null; createdAt: string | null };

export type AuditorDashboardData = {
  metrics: AuditorMetricData;
  auditEvents: AuditorAuditEventRow[];
  activities: AuditorActivityRow[];
  workflow: AuditorWorkflowRow[];
  approvals: AuditorApprovalRow[];
  notifications: AuditorNotificationRow[];
  users: AuditorUserRow[];
  sessions: AuditorSessionRow[];
  requests: AuditorRequestRow[];
  quotes: AuditorQuoteRow[];
  purchaseOrders: AuditorPORow[];
  receiving: AuditorReceivingRow[];
  exceptions: AuditorExceptionRow[];
  payments: AuditorPaymentRow[];
  payeeAudit: AuditorPayeeAuditRow[];
  gateways: AuditorGatewayRow[];
  vendors: AuditorVendorRow[];
  budgets: AuditorBudgetRow[];
  receipts: AuditorReceiptRow[];
};

function textDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function getAuditorDashboardData(): Promise<AuditorDashboardData> {
  const sql = db();
  const [metricRows, auditRows, activityRows, workflowRows, approvalRows, notificationRows, userRows, sessionRows, requestRows, quoteRows, poRows, receivingRows, exceptionRows, paymentRows, payeeRows, gatewayRows, vendorRows, budgetRows, receiptRows] = await Promise.all([
    sql<any[]>`
      SELECT
        (SELECT COUNT(*)::int FROM audit_events) audit_events,
        (SELECT COUNT(*)::int FROM audit_events WHERE severity='High') high_severity,
        (SELECT COUNT(*)::int FROM audit_events WHERE outcome IN ('Denied','Failure','Warning')) exception_outcomes,
        (SELECT COUNT(*)::int FROM logistics_exceptions WHERE status IN ('Open','In Progress')) open_logistics_exceptions,
        (SELECT COUNT(*)::int FROM user_sessions WHERE status='Active' AND (expires_at IS NULL OR expires_at>NOW())) active_sessions,
        (SELECT COUNT(*)::int FROM notifications WHERE COALESCE(is_read,FALSE)=FALSE) unread_notifications
    `,
    sql<any[]>`SELECT id,occurred_at,correlation_id,entity_type,entity_id,entity_reference,actor_username,actor_role,action,outcome,severity,source,reason_or_comment,signature_key_version FROM audit_events ORDER BY id DESC LIMIT 500`,
    sql<any[]>`SELECT id,created_at,role,action,entity_type,entity_id,public_summary,visibility_scope FROM activity_logs ORDER BY created_at DESC,id DESC LIMIT 400`,
    sql<any[]>`SELECT we.id,we.created_at,we.entity_type,we.entity_id,we.event,we.status,we.note,u.full_name user_name FROM workflow_events we LEFT JOIN users u ON u.id=we.user_id ORDER BY we.created_at DESC,we.id DESC LIMIT 400`,
    sql<any[]>`SELECT ah.id,ah.created_at,ah.entity_type,ah.entity_id,ah.action,ah.status_before,ah.status_after,COALESCE(u.full_name,ah.approved_by_role) approved_by,ah.approved_by_role,ah.approval_mode,COALESCE(ah.note,ah.reason) note FROM approval_history ah LEFT JOIN users u ON u.id=ah.approved_by_user_id ORDER BY ah.created_at DESC,ah.id DESC LIMIT 400`,
    sql<any[]>`SELECT n.id,n.created_at,u.full_name user_name,n.role,n.title,n.entity_type,n.entity_id,n.is_read,n.importance,n.delivery_channel,n.push_sent,n.email_sent,n.section_target FROM notifications n LEFT JOIN users u ON u.id=n.user_id ORDER BY n.created_at DESC,n.id DESC LIMIT 500`,
    sql<any[]>`SELECT id,username,full_name,role,email,is_active,account_locked,failed_login_count,must_change_password,last_login_at,updated_at FROM users ORDER BY id`,
    sql<any[]>`SELECT s.id,u.full_name user_name,u.username,u.role,s.login_at,s.logout_at,s.last_seen_at,s.status,s.ip_address,s.user_agent,s.expires_at FROM user_sessions s LEFT JOIN users u ON u.id=s.user_id ORDER BY COALESCE(s.last_seen_at,s.login_at,s.created_at) DESC LIMIT 300`,
    sql<any[]>`SELECT pr.id,pr.request_no,pr.department_project,pr.category,pr.estimated_amount,pr.status,pr.payment_status,pr.next_role,ru.full_name requested_by,fm.full_name facility_manager,pm.full_name procurement_manager,pr.updated_at FROM purchase_requests pr LEFT JOIN users ru ON ru.id=pr.requested_by LEFT JOIN users fm ON fm.id=pr.facility_manager_user_id LEFT JOIN users pm ON pm.id=pr.assigned_procurement_manager_id ORDER BY COALESCE(pr.updated_at,pr.created_at) DESC LIMIT 300`,
    sql<any[]>`SELECT vq.id,pr.request_no,COALESCE(vq.vendor_name,v.name) vendor_name,COALESCE(vq.quotation_total,vq.quoted_amount,0) quoted_amount,vq.currency,vq.delivery_time_days,vq.payment_terms,vq.is_recommended,vq.is_selected,vq.score,vq.created_at FROM vendor_quotes vq LEFT JOIN purchase_requests pr ON pr.id=vq.request_id LEFT JOIN vendors v ON v.id=vq.vendor_id ORDER BY vq.created_at DESC,vq.id DESC LIMIT 300`,
    sql<any[]>`SELECT po.id,po.po_no,pr.request_no,v.name vendor_name,po.total_amount,po.status,po.logistics_status,po.receiving_status,po.payment_status,po.approved_by_role,po.next_role,po.updated_at FROM purchase_orders po LEFT JOIN purchase_requests pr ON pr.id=po.request_id LEFT JOIN vendors v ON v.id=po.vendor_id ORDER BY COALESCE(po.updated_at,po.created_at) DESC LIMIT 300`,
    sql<any[]>`SELECT rs.id,rs.slip_no,po.po_no,pr.request_no,v.name vendor_name,u.full_name received_by,rs.date_received,rs.delivery_note_no,rs.status,rs.discrepancy_notes,rs.created_at FROM receiving_slips rs LEFT JOIN purchase_orders po ON po.id=rs.po_id LEFT JOIN purchase_requests pr ON pr.id=po.request_id LEFT JOIN vendors v ON v.id=rs.vendor_id LEFT JOIN users u ON u.id=COALESCE(rs.logistics_officer_id,rs.received_by) ORDER BY rs.created_at DESC,rs.id DESC LIMIT 300`,
    sql<any[]>`SELECT le.id,le.exception_no,po.po_no,pr.request_no,le.exception_type,le.description,le.payment_impact,le.status,le.resolution_note,le.created_at,le.updated_at FROM logistics_exceptions le LEFT JOIN purchase_orders po ON po.id=le.po_id LEFT JOIN purchase_requests pr ON pr.id=le.request_id ORDER BY COALESCE(le.updated_at,le.created_at) DESC,le.id DESC LIMIT 300`,
    sql<any[]>`SELECT p.id,p.payment_no,pr.request_no,po.po_no,v.name vendor_name,p.amount,p.currency,p.status,p.verification_status,p.transfer_type,p.payment_reference,p.payment_date,p.approved_by_role,p.created_at FROM payments p LEFT JOIN purchase_requests pr ON pr.id=p.request_id LEFT JOIN purchase_orders po ON po.id=p.po_id LEFT JOIN vendors v ON v.id=p.vendor_id ORDER BY p.created_at DESC,p.id DESC LIMIT 300`,
    sql<any[]>`SELECT id,occurred_at,action,outcome,severity,actor_username,actor_role,entity_id,entity_reference,reason_or_comment FROM audit_events WHERE entity_type='Payment Payee Details' OR action ILIKE '%PAYEE%' ORDER BY id DESC LIMIT 300`,
    sql<any[]>`SELECT gp.id,gp.pass_number,fm.full_name facility_manager,gp.department,gp.movement_type,gp.destination,gp.status,gp.logistics_status,gp.approved_by_role,gp.created_at,gp.updated_at FROM gateway_passes gp LEFT JOIN users fm ON fm.id=gp.facility_manager_user_id ORDER BY COALESCE(gp.updated_at,gp.created_at) DESC LIMIT 300`,
    sql<any[]>`SELECT id,name,category,status,rating,completed_orders,total_spend,average_delivery_time,rejection_count,last_purchase_date FROM vendors ORDER BY name`,
    sql<any[]>`SELECT id,budget_month,department_project,category,limit_amount,override_required FROM budgets ORDER BY budget_month DESC,id DESC`,
    sql<any[]>`SELECT rr.id,rr.receipt_no,pr.request_no,p.payment_no,po.po_no,v.name vendor_name,rr.receipt_type,rr.payment_method,rr.amount,rr.currency,rr.status,rr.original_file_name,rr.file_checksum,rr.ocr_status,rr.discrepancy_status,rr.created_at FROM receipt_records rr LEFT JOIN purchase_requests pr ON pr.id=rr.request_id LEFT JOIN payments p ON p.id=COALESCE(rr.payment_id,rr.linked_payment_id) LEFT JOIN purchase_orders po ON po.id=rr.linked_po_id LEFT JOIN vendors v ON v.id=rr.vendor_id ORDER BY rr.created_at DESC,rr.id DESC LIMIT 300`,
  ]);

  const m = metricRows[0] || {};
  return {
    metrics: { auditEvents:Number(m.audit_events||0), highSeverity:Number(m.high_severity||0), exceptionOutcomes:Number(m.exception_outcomes||0), openLogisticsExceptions:Number(m.open_logistics_exceptions||0), activeSessions:Number(m.active_sessions||0), unreadNotifications:Number(m.unread_notifications||0) },
    auditEvents: auditRows.map((r)=>({id:Number(r.id),occurredAt:textDate(r.occurred_at),correlationId:r.correlation_id,entityType:r.entity_type,entityId:r.entity_id,entityReference:r.entity_reference,actorUsername:r.actor_username,actorRole:r.actor_role,action:r.action,outcome:r.outcome,severity:r.severity,source:r.source,reason:r.reason_or_comment,signatureKeyVersion:r.signature_key_version})),
    activities: activityRows.map((r)=>({id:Number(r.id),createdAt:textDate(r.created_at),role:r.role,action:r.action,entityType:r.entity_type,entityId:r.entity_id==null?null:Number(r.entity_id),summary:r.public_summary,visibility:r.visibility_scope})),
    workflow: workflowRows.map((r)=>({id:Number(r.id),createdAt:textDate(r.created_at),entityType:r.entity_type,entityId:Number(r.entity_id),event:r.event,status:r.status,note:r.note,userName:r.user_name})),
    approvals: approvalRows.map((r)=>({id:Number(r.id),createdAt:textDate(r.created_at),entityType:r.entity_type,entityId:Number(r.entity_id),action:r.action,before:r.status_before,after:r.status_after,approvedBy:r.approved_by,approvedByRole:r.approved_by_role,approvalMode:r.approval_mode,note:r.note})),
    notifications: notificationRows.map((r)=>({id:Number(r.id),createdAt:textDate(r.created_at),userName:r.user_name,role:r.role,title:r.title,entityType:r.entity_type,entityId:r.entity_id==null?null:Number(r.entity_id),read:Boolean(r.is_read),importance:r.importance,deliveryChannel:r.delivery_channel,pushSent:Boolean(r.push_sent),emailSent:Boolean(r.email_sent),sectionTarget:r.section_target})),
    users: userRows.map((r)=>({id:Number(r.id),username:r.username,fullName:r.full_name,role:r.role,email:r.email,active:Boolean(r.is_active),locked:Boolean(r.account_locked),failedLoginCount:Number(r.failed_login_count||0),mustChangePassword:Boolean(r.must_change_password),lastLoginAt:textDate(r.last_login_at),updatedAt:textDate(r.updated_at)})),
    sessions: sessionRows.map((r)=>({id:Number(r.id),userName:r.user_name,username:r.username,role:r.role,loginAt:textDate(r.login_at),logoutAt:textDate(r.logout_at),lastSeenAt:textDate(r.last_seen_at),status:r.status,ipAddress:r.ip_address,userAgent:r.user_agent,expiresAt:textDate(r.expires_at)})),
    requests: requestRows.map((r)=>({id:Number(r.id),requestNo:r.request_no,departmentProject:r.department_project,category:r.category,amount:Number(r.estimated_amount||0),status:r.status,paymentStatus:r.payment_status,nextRole:r.next_role,requestedBy:r.requested_by,facilityManager:r.facility_manager,procurementManager:r.procurement_manager,updatedAt:textDate(r.updated_at)})),
    quotes: quoteRows.map((r)=>({id:Number(r.id),requestNo:r.request_no,vendorName:r.vendor_name,quotedAmount:Number(r.quoted_amount||0),currency:r.currency,deliveryDays:r.delivery_time_days==null?null:Number(r.delivery_time_days),paymentTerms:r.payment_terms,recommended:Boolean(r.is_recommended),selected:Boolean(r.is_selected),score:r.score==null?null:Number(r.score),createdAt:textDate(r.created_at)})),
    purchaseOrders: poRows.map((r)=>({id:Number(r.id),poNo:r.po_no,requestNo:r.request_no,vendorName:r.vendor_name,amount:Number(r.total_amount||0),status:r.status,logisticsStatus:r.logistics_status,receivingStatus:r.receiving_status,paymentStatus:r.payment_status,approvedByRole:r.approved_by_role,nextRole:r.next_role,updatedAt:textDate(r.updated_at)})),
    receiving: receivingRows.map((r)=>({id:Number(r.id),slipNo:r.slip_no,poNo:r.po_no,requestNo:r.request_no,vendorName:r.vendor_name,receivedBy:r.received_by,dateReceived:textDate(r.date_received),deliveryNoteNo:r.delivery_note_no,status:r.status,discrepancyNotes:r.discrepancy_notes,createdAt:textDate(r.created_at)})),
    exceptions: exceptionRows.map((r)=>({id:Number(r.id),exceptionNo:r.exception_no,poNo:r.po_no,requestNo:r.request_no,exceptionType:r.exception_type,description:r.description,paymentImpact:Boolean(r.payment_impact),status:r.status,resolutionNote:r.resolution_note,createdAt:textDate(r.created_at),updatedAt:textDate(r.updated_at)})),
    payments: paymentRows.map((r)=>({id:Number(r.id),paymentNo:r.payment_no,requestNo:r.request_no,poNo:r.po_no,vendorName:r.vendor_name,amount:Number(r.amount||0),currency:r.currency,status:r.status,verificationStatus:r.verification_status,transferType:r.transfer_type,paymentReference:r.payment_reference,paymentDate:textDate(r.payment_date),approvedByRole:r.approved_by_role,createdAt:textDate(r.created_at)})),
    payeeAudit: payeeRows.map((r)=>({id:Number(r.id),occurredAt:textDate(r.occurred_at),action:r.action,outcome:r.outcome,severity:r.severity,actorUsername:r.actor_username,actorRole:r.actor_role,entityId:r.entity_id,entityReference:r.entity_reference,reason:r.reason_or_comment})),
    gateways: gatewayRows.map((r)=>({id:Number(r.id),passNumber:r.pass_number,facilityManager:r.facility_manager,department:r.department,movementType:r.movement_type,destination:r.destination,status:r.status,logisticsStatus:r.logistics_status,approvedByRole:r.approved_by_role,createdAt:textDate(r.created_at),updatedAt:textDate(r.updated_at)})),
    vendors: vendorRows.map((r)=>({id:Number(r.id),name:r.name,category:r.category,status:r.status,rating:r.rating==null?null:Number(r.rating),completedOrders:Number(r.completed_orders||0),totalSpend:Number(r.total_spend||0),averageDeliveryTime:r.average_delivery_time==null?null:Number(r.average_delivery_time),rejectionCount:Number(r.rejection_count||0),lastPurchaseDate:textDate(r.last_purchase_date)})),
    budgets: budgetRows.map((r)=>({id:Number(r.id),month:r.budget_month,departmentProject:r.department_project,category:r.category,limitAmount:Number(r.limit_amount||0),overrideRequired:Boolean(r.override_required)})),
    receipts: receiptRows.map((r)=>({id:Number(r.id),receiptNo:r.receipt_no,requestNo:r.request_no,paymentNo:r.payment_no,poNo:r.po_no,vendorName:r.vendor_name,receiptType:r.receipt_type,paymentMethod:r.payment_method,amount:Number(r.amount||0),currency:r.currency,status:r.status,originalFileName:r.original_file_name,fileChecksum:r.file_checksum,ocrStatus:r.ocr_status,discrepancyStatus:r.discrepancy_status,createdAt:textDate(r.created_at)})),
  };
}

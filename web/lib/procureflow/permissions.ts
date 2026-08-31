import type { ProcureFlowRole } from "./roles";

export const APPROVAL_ROLES = new Set<ProcureFlowRole>(["Admin", "Approver"]);
export const LOW_VALUE_APPROVAL_ROLES = new Set<ProcureFlowRole>(["Admin", "Approver", "Procurement Manager"]);
export const PAYMENT_ROLES = new Set<ProcureFlowRole>(["Finance", "Admin"]);
export const READ_ONLY_ROLES = new Set<ProcureFlowRole>(["Auditor"]);

export function canApprove(role: ProcureFlowRole) {
  return APPROVAL_ROLES.has(role);
}

export function canApproveLowValue(role: ProcureFlowRole) {
  return LOW_VALUE_APPROVAL_ROLES.has(role);
}

export function canPay(role: ProcureFlowRole) {
  return PAYMENT_ROLES.has(role);
}

export function isReadOnly(role: ProcureFlowRole) {
  return READ_ONLY_ROLES.has(role);
}

export function canReviewProcurement(role: ProcureFlowRole) {
  return role === "Admin" || role === "Procurement Manager";
}

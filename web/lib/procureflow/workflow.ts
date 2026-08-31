export const DEFAULT_PM_APPROVAL_THRESHOLD = 2_000_000;

export const STATUS = {
  DRAFT: "Draft",
  SENT_REVIEW: "Sent for Procurement Review",
  RETURNED: "Returned for Correction",
  REVIEWED: "Reviewed by Procurement",
  REQUIRES_SOURCING: "Requires Sourcing",
  VENDOR_QUOTE_COLLECTION: "Vendor Quote Collection",
  VENDOR_RECOMMENDATION: "Vendor Recommendation",
  SUBMITTED_APPROVAL: "Submitted for Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  AWAITING_PAYMENT: "Awaiting Payment",
  PAID: "Paid",
  RECEIPT_UPLOADED: "Receipt Uploaded",
  PAYMENT_VERIFICATION: "Payment Submitted for Verification",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
} as const;

export const REQUEST_NEXT_ROLE_BY_STATUS: Record<string, string | null> = {
  [STATUS.SENT_REVIEW]: "procurement_manager",
  [STATUS.REVIEWED]: "procurement_manager",
  [STATUS.REQUIRES_SOURCING]: "procurement_manager",
  [STATUS.VENDOR_QUOTE_COLLECTION]: "procurement_manager",
  [STATUS.VENDOR_RECOMMENDATION]: "procurement_manager",
  [STATUS.SUBMITTED_APPROVAL]: "approver",
  [STATUS.APPROVED]: "finance",
  [STATUS.AWAITING_PAYMENT]: "finance",
  [STATUS.PAID]: "procurement_manager",
  [STATUS.RECEIPT_UPLOADED]: "procurement_manager",
  [STATUS.PAYMENT_VERIFICATION]: "procurement_manager",
  [STATUS.COMPLETED]: "procurement_manager",
  [STATUS.CLOSED]: "auditor",
  [STATUS.ARCHIVED]: "auditor",
};

export function requiredApprovalRoleForAmount(amount: number, threshold = DEFAULT_PM_APPROVAL_THRESHOLD) {
  return amount <= threshold ? "procurement_manager" : "approver";
}

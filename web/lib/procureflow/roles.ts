export const ROLES = [
  "Admin",
  "Procurement Manager",
  "Facility Manager",
  "Logistics Officer",
  "Finance",
  "Approver",
  "Auditor",
] as const;

export type ProcureFlowRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<ProcureFlowRole, string> = {
  Admin: "Admin",
  "Procurement Manager": "Procurement Manager",
  "Facility Manager": "Utility Head / Facility Head",
  "Logistics Officer": "Logistics Officer",
  Finance: "Finance",
  Approver: "Approver / MD",
  Auditor: "Auditor",
};

export const ROLE_LANDING: Record<ProcureFlowRole, string> = {
  Admin: "Admin Console",
  "Procurement Manager": "Procurement Workspace",
  "Facility Manager": "Utility Head / Facility Head Workspace",
  "Logistics Officer": "Logistics Workspace",
  Finance: "Finance Workspace",
  Approver: "Executive Approval Workspace",
  Auditor: "Audit & Compliance Workspace",
};

export const ROLE_SECTIONS: Record<ProcureFlowRole, { title: string; sections: string[] }> = {
  Admin: {
    title: "Admin Navigation",
    sections: [
      "Admin Dashboard", "Reimbursement Request", "Action & Exception Centre", "Workflow Intervention Centre", "User Management",
      "Roles & Permissions", "Security & Access Management", "Budget Tracker", "Income",
      "Approval Configuration", "Import Center", "All Procurement Records", "Notifications Monitor",
      "Availability & Delegation Requests", "Gateway Pass Management", "Activity & History Logs",
      "Audit Logs", "Database Viewer", "Backup / Export", "Settings",
    ],
  },
  "Procurement Manager": {
    title: "Procurement Navigation",
    sections: [
      "Operations Dashboard", "Create Request Draft", "My Draft Requests", "Purchase Requests", "Reimbursement Request", "Low-Value Approvals",
      "Utility Head / Facility Head Inbox", "Import Center", "Sourcing", "Vendor Quotes", "Vendor Recommendation",
      "Commercial PO Management", "Vendors", "Gateway Pass Review", "Post-Payment Closure", "Availability / Away Notice",
      "Procurement Documents", "Procurement Reports", "Income", "My Activity History", "Settings",
    ],
  },
  "Facility Manager": {
    title: "Utility / Facility Navigation",
    sections: [
      "Utility / Facility Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager", "Reimbursement Request",
      "Import Documents", "Gateway Pass", "Shared Thread with Procurement Manager", "Returned Requests",
      "Approved / Accepted Requests", "Income", "My Activity History", "Settings",
    ],
  },
  "Logistics Officer": {
    title: "Logistics Navigation",
    sections: [
      "Logistics Dashboard", "Reimbursement Request", "PO Delivery Handover", "Delivery Tracking", "Receiving Slips",
      "Delivery Exceptions & Returns", "Gateway Pass Review & Approval", "Gateway Pass Coordination", "Logistics Documents",
      "My Activity History", "Settings",
    ],
  },
  Finance: {
    title: "Finance Navigation",
    sections: [
      "Financial Dashboard", "Reimbursement Request", "Approved for Payment", "Receipts", "Invoices", "Expenses", "Payments",
      "Cash Advances", "Budgets", "Income", "Vendor Payment Records", "Reconciliation",
      "Financial Reports", "Settings",
    ],
  },
  Approver: {
    title: "Executive Navigation",
    sections: [
      "Approval Dashboard", "Reimbursement Request", "Pending Approvals", "Quote Comparison", "PO Approval", "Payment Approval",
      "Approved Gateway Passes", "Availability / Away Notice", "My Approval History", "Income", "Settings",
    ],
  },
  Auditor: {
    title: "Audit Navigation",
    sections: [
      "Audit Dashboard",
      "Transaction 360", "Procurement Records", "Facility / Utility Handoff Trail", "Sourcing & Vendor Quote Audit",
      "Approval Trails", "Delegated Approval Review", "Purchase Order & Logistics Evidence",
      "Receiving Slips, Proof of Delivery & Returns", "Vendor History", "Gateway Pass Audit", "Document Archive & Download Audit",
      "Finance, Invoice & Payment Audit", "Expense Review", "Payment Payee / Bank Detail Access Audit", "Budget Audit", "Income", "Reimbursement Request",
      "Role Activity Mirrors", "User 360", "Exception Centre", "Notification Delivery Audit",
      "All Activity & Evidence Ledger", "Compliance Reports", "Settings",
    ],
  },
};

export function isProcureFlowRole(value: string | null | undefined): value is ProcureFlowRole {
  return Boolean(value && (ROLES as readonly string[]).includes(value));
}

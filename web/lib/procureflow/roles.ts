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
      "Admin Dashboard", "Action & Exception Centre", "Workflow Intervention Centre", "User Management",
      "Roles & Permissions", "Security & Access Management", "Budget Tracker", "Income",
      "Approval Configuration", "Import Center", "All Procurement Records", "Notifications Monitor",
      "Availability & Delegation Requests", "Gateway Pass Management", "Activity & History Logs",
      "Audit Logs", "Database Viewer", "Backup / Export", "Settings",
    ],
  },
  "Procurement Manager": {
    title: "Procurement Navigation",
    sections: [
      "Operations Dashboard", "Create Request Draft", "My Draft Requests", "Purchase Requests", "Low-Value Approvals",
      "Utility Head / Facility Head Inbox", "Import Center", "Sourcing", "Vendor Quotes", "Vendor Recommendation",
      "Commercial PO Management", "Vendors", "Gateway Pass Review", "Post-Payment Closure", "Availability / Away Notice",
      "Procurement Documents", "Procurement Reports", "Income", "My Activity History", "Settings",
    ],
  },
  "Facility Manager": {
    title: "Utility / Facility Navigation",
    sections: [
      "Utility / Facility Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager",
      "Import Documents", "Gateway Pass", "Shared Thread with Procurement Manager", "Returned Requests",
      "Approved / Accepted Requests", "Income", "My Activity History", "Settings",
    ],
  },
  "Logistics Officer": {
    title: "Logistics Navigation",
    sections: [
      "Logistics Dashboard", "PO Delivery Handover", "Delivery Tracking", "Receiving Slips",
      "Delivery Exceptions & Returns", "Gateway Pass Coordination", "Logistics Documents",
      "My Activity History", "Settings",
    ],
  },
  Finance: {
    title: "Finance Navigation",
    sections: [
      "Financial Dashboard", "Approved for Payment", "Receipts", "Invoices", "Expenses", "Payments",
      "Cash Advances", "Budgets", "Income", "Vendor Payment Records", "Reconciliation",
      "Financial Reports", "Settings",
    ],
  },
  Approver: {
    title: "Executive Navigation",
    sections: [
      "Approval Dashboard", "Pending Approvals", "Quote Comparison", "PO Approval", "Payment Approval",
      "Gateway Pass Approval", "Availability / Away Notice", "My Approval History", "Income", "Settings",
    ],
  },
  Auditor: {
    title: "Audit Navigation",
    sections: [
      "Audit Dashboard", "Role Activity Mirrors", "Transaction 360", "User 360", "Exception Centre",
      "All Activity & Evidence Ledger", "Procurement Records", "Sourcing & Vendor Quote Audit",
      "Purchase Order & Logistics Evidence", "Receiving Slips, Proof of Delivery & Returns",
      "Finance, Invoice & Payment Audit", "Approval Trails", "Delegated Approval Review",
      "Payment Payee / Bank Detail Access Audit", "Gateway Pass Audit", "Document Archive & Download Audit",
      "Notification Delivery Audit", "User & Security Audit", "Vendor History", "Budget Audit",
      "Facility / Utility Handoff Trail", "Expense Review", "Compliance Reports", "Income", "Settings",
    ],
  },
};

export function isProcureFlowRole(value: string | null | undefined): value is ProcureFlowRole {
  return Boolean(value && (ROLES as readonly string[]).includes(value));
}

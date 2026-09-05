"use client";

import { BellRing, ChevronRight } from "lucide-react";

const ROLE_SECTIONS: Record<string, string[]> = {
  "Facility Manager": [
    "Utility / Facility Dashboard", "Create Request Draft", "My Draft Requests", "Submit to Procurement Manager",
    "Import Documents", "Gateway Pass", "Shared Thread with Procurement Manager", "Returned Requests",
    "Approved / Accepted Requests", "Income", "My Activity History", "Settings",
  ],
  "Procurement Manager": [
    "Operations Dashboard", "Purchase Requests", "Low-Value Approvals", "Utility Head / Facility Head Inbox",
    "Import Center", "Sourcing", "Vendor Quotes", "Vendor Recommendation", "Commercial PO Management", "Vendors",
    "Gateway Pass Review", "Post-Payment Closure", "Availability / Away Notice", "Procurement Documents",
    "Procurement Reports", "Income", "My Activity History", "Settings",
  ],
  Approver: [
    "Dashboard", "Pending Approvals", "Quote Comparison", "PO Approval", "Payment Approval", "Gateway Pass Approval",
    "Availability / Away Notice", "My Approval History", "Income", "Settings",
  ],
  Finance: [
    "Dashboard", "Approved for Payment", "Receipts", "Invoices", "Expenses", "Payments", "Cash Advances", "Budgets",
    "Income", "Vendor Payment Records", "Reconciliation", "Financial Reports", "Settings",
  ],
  "Logistics Officer": [
    "Logistics Dashboard", "PO Delivery Handover", "Delivery Tracking", "Receiving Slips", "Delivery Exceptions & Returns",
    "Gateway Pass Coordination", "Logistics Documents", "My Activity History", "Settings",
  ],
  Admin: [
    "Admin Control Centre", "Action & Exception Centre", "Workflow Intervention Centre", "User Management",
    "Roles & Permissions", "Security & Access Management", "Approval Configuration", "Budget Tracker", "Income",
    "Import Center", "All Procurement Records", "Notifications", "Availability & Delegation", "Gateway Pass Management",
    "Activity Logs", "Audit Logs", "Database Console", "Backup / Export", "Settings",
  ],
  Auditor: [
    "Audit Dashboard", "Audit Log", "Activities Review", "Facility Head Handoff Trails", "Workflow Status History",
    "Approval Trails", "Sourcing & Vendor Quote Audit", "Purchase Order & Logistics Evidence",
    "Receiving Slips, Proof of Delivery & Returns", "Finance & Payment Audit", "Expense Review",
    "Payee / Payment Detail Audit", "Gateway Pass Audit", "Vendor Performance & Compliance", "Notification Audit",
    "User & Access Audit", "Delegated Approval Audit", "Budget & Income Audit", "Income", "Document Archive",
    "Compliance Reports", "Role Activity Mirrors", "Transaction 360 View", "Settings",
  ],
};

function haystack(notification: any) {
  return [notification?.title, notification?.message, notification?.action_label, notification?.section_target, notification?.entity_type]
    .filter(Boolean).join(" ").toLowerCase();
}

function inferTarget(role: string, notification: any) {
  const text = haystack(notification);

  if (role === "Facility Manager") {
    if (/return|correction|resubmit/.test(text)) return "Returned Requests";
    if (/draft/.test(text)) return "My Draft Requests";
    if (/gateway/.test(text)) return "Gateway Pass";
    if (/thread|message|collaboration/.test(text)) return "Shared Thread with Procurement Manager";
    if (/approved|accepted|processed/.test(text)) return "Approved / Accepted Requests";
    if (/income|budget/.test(text)) return "Income";
    if (/submit|sent for procurement|procurement review/.test(text)) return "My Activity History";
    return "Utility / Facility Dashboard";
  }

  if (role === "Procurement Manager") {
    if (/facility|utility head|handoff|pending procurement review|sent for procurement review/.test(text)) return "Utility Head / Facility Head Inbox";
    if (/low[- ]?value/.test(text)) return "Low-Value Approvals";
    if (/quote/.test(text)) return "Vendor Quotes";
    if (/recommend/.test(text)) return "Vendor Recommendation";
    if (/sourc/.test(text)) return "Sourcing";
    if (/purchase order|\bpo\b/.test(text)) return "Commercial PO Management";
    if (/gateway/.test(text)) return "Gateway Pass Review";
    if (/closure|close|completed|paid/.test(text)) return "Post-Payment Closure";
    if (/document|attachment|receipt/.test(text)) return "Procurement Documents";
    if (/vendor/.test(text)) return "Vendors";
    if (/income|budget/.test(text)) return "Income";
    return "Purchase Requests";
  }

  if (role === "Approver") {
    if (/gateway/.test(text)) return "Gateway Pass Approval";
    if (/payment/.test(text)) return "Payment Approval";
    if (/purchase order|\bpo\b/.test(text)) return "PO Approval";
    if (/quote/.test(text)) return "Quote Comparison";
    if (/history|approved|rejected|returned/.test(text)) return "My Approval History";
    if (/income|budget/.test(text)) return "Income";
    return "Pending Approvals";
  }

  if (role === "Finance") {
    if (/receipt|proof of payment/.test(text)) return "Receipts";
    if (/invoice/.test(text)) return "Invoices";
    if (/expense/.test(text)) return "Expenses";
    if (/cash advance|advance/.test(text)) return "Cash Advances";
    if (/reconcil/.test(text)) return "Reconciliation";
    if (/vendor payment/.test(text)) return "Vendor Payment Records";
    if (/budget/.test(text)) return "Budgets";
    if (/income/.test(text)) return "Income";
    if (/report/.test(text)) return "Financial Reports";
    if (/paid|payment/.test(text)) return "Payments";
    return "Approved for Payment";
  }

  if (role === "Logistics Officer") {
    if (/gateway/.test(text)) return "Gateway Pass Coordination";
    if (/receiv|proof of delivery|delivery note/.test(text)) return "Receiving Slips";
    if (/exception|return/.test(text)) return "Delivery Exceptions & Returns";
    if (/handover|purchase order|\bpo\b/.test(text)) return "PO Delivery Handover";
    if (/document|attachment/.test(text)) return "Logistics Documents";
    if (/activity|history/.test(text)) return "My Activity History";
    return "Delivery Tracking";
  }

  if (role === "Admin") {
    if (/user|account|password|session/.test(text)) return "User Management";
    if (/security|lock|suspend|access/.test(text)) return "Security & Access Management";
    if (/role|permission/.test(text)) return "Roles & Permissions";
    if (/approval limit|approval configuration/.test(text)) return "Approval Configuration";
    if (/gateway/.test(text)) return "Gateway Pass Management";
    if (/budget/.test(text)) return "Budget Tracker";
    if (/income/.test(text)) return "Income";
    if (/audit/.test(text)) return "Audit Logs";
    if (/activity/.test(text)) return "Activity Logs";
    if (/workflow|rescission|intervention/.test(text)) return "Workflow Intervention Centre";
    if (/request|procurement|payment|vendor|purchase order|\bpo\b/.test(text)) return "All Procurement Records";
    return "Notifications";
  }

  if (role === "Auditor") {
    if (/gateway/.test(text)) return "Gateway Pass Audit";
    if (/payment|finance|invoice|receipt/.test(text)) return "Finance & Payment Audit";
    if (/expense/.test(text)) return "Expense Review";
    if (/payee|account detail/.test(text)) return "Payee / Payment Detail Audit";
    if (/vendor|quote|sourc/.test(text)) return "Sourcing & Vendor Quote Audit";
    if (/purchase order|\bpo\b|logistics/.test(text)) return "Purchase Order & Logistics Evidence";
    if (/receiv|delivery|return/.test(text)) return "Receiving Slips, Proof of Delivery & Returns";
    if (/approval|approved|rejected/.test(text)) return "Approval Trails";
    if (/notification/.test(text)) return "Notification Audit";
    if (/user|access|session|security/.test(text)) return "User & Access Audit";
    if (/budget|income/.test(text)) return "Budget & Income Audit";
    if (/workflow|status|handoff/.test(text)) return "Workflow Status History";
    if (/activity/.test(text)) return "Activities Review";
    return "Audit Dashboard";
  }

  return "Dashboard";
}

export function standardizeNotifications(role: string, notifications: any[] = []) {
  const valid = new Set(ROLE_SECTIONS[role] || []);
  return notifications.map((notification) => {
    const originalTarget = String(notification?.section_target || "").trim();
    const sectionTarget = valid.has(originalTarget) ? originalTarget : inferTarget(role, notification);
    return { ...notification, original_section_target: originalTarget || null, section_target: sectionTarget };
  });
}

function importanceRank(value: unknown) {
  const v = String(value || "Normal").toLowerCase();
  if (v === "urgent" || v === "critical") return 4;
  if (v === "high") return 3;
  if (v === "normal") return 2;
  return 1;
}

export function StandardNotificationBanner({
  role,
  notifications,
  onNavigate,
}: {
  role: string;
  notifications: any[];
  onNavigate: (section: string) => void;
}) {
  const unread = standardizeNotifications(role, notifications)
    .filter((notification) => !notification.is_read)
    .sort((a, b) => importanceRank(b.importance) - importanceRank(a.importance));

  if (!unread.length) return null;
  const visible = unread.slice(0, 3);

  return <section className="standard-notification-banner" aria-label="Unread notifications">
    <div className="standard-notification-heading">
      <div className="standard-notification-icon"><BellRing size={18}/></div>
      <div><span>NEW ACTIVITY</span><strong>{unread.length} unread notification{unread.length === 1 ? "" : "s"}</strong><p>Items requiring your attention are shown here and on the relevant sidebar section.</p></div>
    </div>
    <div className="standard-notification-list">
      {visible.map((notification) => <article key={notification.id} data-importance={String(notification.importance || "Normal").toLowerCase()}>
        <div><span>{notification.importance || "Normal"}</span><strong>{notification.title || "ProcureFlow notification"}</strong><p>{notification.message || "New workflow activity is available."}</p></div>
        <button type="button" onClick={() => onNavigate(notification.section_target)}>
          Open {notification.section_target}<ChevronRight size={15}/>
        </button>
      </article>)}
    </div>
    {unread.length > visible.length ? <small>+ {unread.length - visible.length} more unread notification{unread.length - visible.length === 1 ? "" : "s"} in the notification bell.</small> : null}
  </section>;
}

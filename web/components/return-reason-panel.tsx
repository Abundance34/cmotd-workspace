"use client";

import { CornerUpLeft } from "lucide-react";

function dateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-NG");
}

export function ReturnReasonPanel({ detail }: { detail: any }) {
  const status = String(detail?.request?.status || "");
  if (!/return|correction/i.test(status)) return null;

  const candidates = [
    ...(detail?.approvals || []).map((item: any) => ({
      action: item.action,
      reason: item.note || item.reason,
      createdAt: item.created_at,
      by: item.approved_by_name || item.approved_by_role,
    })),
    ...(detail?.workflow || []).map((item: any) => ({
      action: item.event || item.status,
      reason: item.note,
      createdAt: item.created_at,
      by: item.user_name || item.user_role,
    })),
  ]
    .filter((item: any) => /return|correction/i.test(String(item.action || "")))
    .sort((a: any, b: any) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());

  const latest = candidates[0];
  return (
    <div className="return-reason-panel" role="note" aria-label="Return or correction reason">
      <CornerUpLeft size={17}/>
      <div>
        <strong>Return / correction reason</strong>
        <p>{latest?.reason || "This request was returned for correction, but no reason was recorded."}</p>
        {latest?.createdAt || latest?.by ? <small>{latest?.by ? `Returned by ${latest.by}` : "Returned"}{latest?.createdAt ? ` · ${dateTime(latest.createdAt)}` : ""}</small> : null}
      </div>
    </div>
  );
}

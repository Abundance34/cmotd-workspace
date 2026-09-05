"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ProcurementRequestRegister } from "@/components/procurement-request-register";

export function ProcurementOwnedDrafts() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setMessage(null);
    fetch("/api/procurement/requests/owned-drafts", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Unable to load your Procurement drafts.");
        return Array.isArray(payload?.rows) ? payload.rows : [];
      })
      .then((nextRows) => { if (active) setRows(nextRows); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load your Procurement drafts."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  if (loading) return <div className="empty-state">Loading your Procurement request drafts…</div>;
  if (message) return <div className="action-message error">{message}</div>;

  return <div className="owned-drafts-workspace">
    <div className="owned-drafts-toolbar"><div><strong>Procurement-owned drafts</strong><span>These requests were created by your Procurement account and require independent Approver / MD approval when submitted.</span></div><button type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={14}/>Refresh</button></div>
    <ProcurementRequestRegister rows={rows} onChanged={() => setRefreshKey((value) => value + 1)} />
  </div>;
}

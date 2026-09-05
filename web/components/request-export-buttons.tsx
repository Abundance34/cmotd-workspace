"use client";

import { Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";

export function RequestExportButtons({ requestId, compact = false }: { requestId?: number | null; compact?: boolean }) {
  const suffix = requestId ? `&id=${requestId}` : "";
  const items = [
    { format: "csv", label: "CSV", icon: Download },
    { format: "xlsx", label: "Excel", icon: FileSpreadsheet },
    { format: "pdf", label: "PDF", icon: FileText },
    { format: "json", label: "JSON", icon: FileJson },
  ];

  return (
    <div className={compact ? "request-export-actions compact" : "request-export-actions"}>
      {items.map(({ format, label, icon: Icon }) => (
        <a key={format} href={`/api/requests/export?format=${format}${suffix}`} className="request-export-button">
          <Icon size={14} />
          <span>{label}</span>
        </a>
      ))}
    </div>
  );
}

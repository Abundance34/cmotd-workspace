"use client";

import { AlertTriangle, CheckCircle2, Info, Send, XCircle } from "lucide-react";

export type ConfirmationTone = "primary" | "success" | "warning" | "danger" | "info";

type Props = {
  open: boolean;
  eyebrow?: string;
  title: string;
  description: string;
  reference?: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function ToneIcon({ tone }: { tone: ConfirmationTone }) {
  if (tone === "success") return <CheckCircle2 size={21} />;
  if (tone === "warning") return <AlertTriangle size={21} />;
  if (tone === "danger") return <XCircle size={21} />;
  if (tone === "info") return <Info size={21} />;
  return <Send size={21} />;
}

export function ConfirmationDialog({
  open,
  eyebrow = "CONFIRM ACTION",
  title,
  description,
  reference,
  detail,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="pf-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className={`pf-confirm-dialog tone-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pf-confirm-title"
      >
        <div className="pf-confirm-body">
          <div className="pf-confirm-heading">
            <div className="pf-confirm-icon" aria-hidden="true"><ToneIcon tone={tone} /></div>
            <div>
              <span>{eyebrow}</span>
              <h3 id="pf-confirm-title">{title}</h3>
              <p>{description}</p>
            </div>
          </div>
          {(reference || detail) ? (
            <div className="pf-confirm-reference">
              {reference ? <><span>Reference</span><strong>{reference}</strong></> : null}
              {detail ? <p>{detail}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="pf-confirm-actions">
          <button type="button" className="pf-confirm-cancel" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="pf-confirm-submit" disabled={busy} onClick={onConfirm}>{busy ? "Processing…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

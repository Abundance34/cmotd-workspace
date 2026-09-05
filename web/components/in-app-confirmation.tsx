"use client";

import { useEffect, useState } from "react";
import { ConfirmationDialog, type ConfirmationTone } from "@/components/confirmation-dialog";

export type InAppConfirmationOptions = {
  eyebrow?: string;
  title: string;
  description: string;
  reference?: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
};

type ConfirmationRequest = {
  options: InAppConfirmationOptions;
  resolve: (value: boolean) => void;
};

const EVENT_NAME = "procureflow:confirm";

export function requestConfirmation(options: InAppConfirmationOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmationRequest>(EVENT_NAME, { detail: { options, resolve } }));
  });
}

export function ConfirmationCenter() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmationRequest>).detail;
      if (detail?.options && typeof detail.resolve === "function") setRequest(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  function close(value: boolean) {
    const current = request;
    setRequest(null);
    current?.resolve(value);
  }

  return request ? (
    <ConfirmationDialog
      open
      eyebrow={request.options.eyebrow}
      title={request.options.title}
      description={request.options.description}
      reference={request.options.reference}
      detail={request.options.detail}
      confirmLabel={request.options.confirmLabel}
      cancelLabel={request.options.cancelLabel}
      tone={request.options.tone}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;
}

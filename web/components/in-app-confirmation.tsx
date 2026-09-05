"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
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

export type InAppTextPromptOptions = {
  eyebrow?: string;
  title: string;
  description: string;
  reference?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel: string;
  cancelLabel?: string;
  required?: boolean;
  tone?: ConfirmationTone;
};

type ConfirmationRequest = {
  options: InAppConfirmationOptions;
  resolve: (value: boolean) => void;
};

type TextPromptRequest = {
  options: InAppTextPromptOptions;
  resolve: (value: string | null) => void;
};

const CONFIRM_EVENT = "procureflow:confirm";
const TEXT_PROMPT_EVENT = "procureflow:text-prompt";

export function requestConfirmation(options: InAppConfirmationOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmationRequest>(CONFIRM_EVENT, { detail: { options, resolve } }));
  });
}

export function requestTextPrompt(options: InAppTextPromptOptions): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    window.dispatchEvent(new CustomEvent<TextPromptRequest>(TEXT_PROMPT_EVENT, { detail: { options, resolve } }));
  });
}

export function ConfirmationCenter() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const [promptRequest, setPromptRequest] = useState<TextPromptRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");

  useEffect(() => {
    const confirmHandler = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmationRequest>).detail;
      if (detail?.options && typeof detail.resolve === "function") setRequest(detail);
    };
    const promptHandler = (event: Event) => {
      const detail = (event as CustomEvent<TextPromptRequest>).detail;
      if (detail?.options && typeof detail.resolve === "function") {
        setPromptValue(detail.options.initialValue || "");
        setPromptRequest(detail);
      }
    };
    window.addEventListener(CONFIRM_EVENT, confirmHandler);
    window.addEventListener(TEXT_PROMPT_EVENT, promptHandler);
    return () => {
      window.removeEventListener(CONFIRM_EVENT, confirmHandler);
      window.removeEventListener(TEXT_PROMPT_EVENT, promptHandler);
    };
  }, []);

  function closeConfirmation(value: boolean) {
    const current = request;
    setRequest(null);
    current?.resolve(value);
  }

  function closePrompt(value: string | null) {
    const current = promptRequest;
    setPromptRequest(null);
    setPromptValue("");
    current?.resolve(value);
  }

  const promptOptions = promptRequest?.options;
  const promptBlocked = Boolean(promptOptions?.required && !promptValue.trim());

  return (
    <>
      {request ? (
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
          onCancel={() => closeConfirmation(false)}
          onConfirm={() => closeConfirmation(true)}
        />
      ) : null}

      {promptRequest && promptOptions ? (
        <div
          className="pf-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePrompt(null);
          }}
        >
          <section
            className={`pf-confirm-dialog tone-${promptOptions.tone || "primary"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-text-prompt-title"
          >
            <div className="pf-confirm-body">
              <div className="pf-confirm-heading">
                <div className="pf-confirm-icon" aria-hidden="true"><FileText size={21} /></div>
                <div>
                  <span>{promptOptions.eyebrow || "REQUIRED INFORMATION"}</span>
                  <h3 id="pf-text-prompt-title">{promptOptions.title}</h3>
                  <p>{promptOptions.description}</p>
                </div>
              </div>
              {promptOptions.reference ? (
                <div className="pf-confirm-reference"><span>Reference</span><strong>{promptOptions.reference}</strong></div>
              ) : null}
              <label className="pf-prompt-field">
                <span>{promptOptions.label}</span>
                <textarea
                  rows={4}
                  autoFocus
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={promptOptions.placeholder}
                />
              </label>
            </div>
            <div className="pf-confirm-actions">
              <button type="button" className="pf-confirm-cancel" onClick={() => closePrompt(null)}>{promptOptions.cancelLabel || "Cancel"}</button>
              <button type="button" className="pf-confirm-submit" disabled={promptBlocked} onClick={() => closePrompt(promptValue.trim())}>{promptOptions.confirmLabel}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

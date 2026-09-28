"use client";

import { Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConfirmationDialogProps = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  pendingLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  pending?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
};

export function ConfirmationDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  pendingLabel = "Working...",
  cancelLabel = "Cancel",
  tone = "default",
  pending = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onClose,
  children,
}: ConfirmationDialogProps) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-busy={pending}
    >
      <Card className="w-full max-w-[520px] rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
          <div>
            <CardTitle className="text-[24px] font-[700] tracking-[-0.03em] text-[#111712]">
              {title}
            </CardTitle>
            <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
              {description}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onClose}
            disabled={pending}
            className="shrink-0 border border-line"
            aria-label="Close confirmation dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
          {children}
          {error ? (
            <div className="mb-5 rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
              className="sm:min-w-[138px]"
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={tone === "destructive" ? "destructive" : "default"}
              onClick={onConfirm}
              disabled={pending || confirmDisabled}
              className="sm:min-w-[148px]"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {pendingLabel}
                </>
              ) : confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}

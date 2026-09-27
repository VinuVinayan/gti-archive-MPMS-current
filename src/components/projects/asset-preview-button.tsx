"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, FileText, ImageIcon, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileThumbnail, canShowImageThumbnail } from "@/components/projects/file-thumbnail";
import { cn } from "@/lib/utils";

type AssetPreviewButtonProps = {
  fileName: string;
  mimeType: string;
  previewPath: string;
  textContentPath?: string | null;
  downloadPath?: string | null;
  triggerClassName?: string;
  iconOnly?: boolean;
  label?: string;
};

type AssetPreviewDialogProps = {
  isOpen: boolean;
  fileName: string;
  mimeType: string;
  previewPath: string;
  textContentPath?: string | null;
  downloadPath?: string | null;
  onClose: () => void;
};

type AssetImageThumbnailProps = {
  fileName: string;
  mimeType: string;
  previewPath: string;
  downloadPath?: string | null;
  className?: string;
  interactive?: boolean;
};

function isPreviewableAsset(
  fileName: string,
  mimeType: string,
  textContentPath?: string | null,
) {
  if (canShowImageThumbnail(fileName, mimeType)) {
    return true;
  }

  if (mimeType === "application/pdf") {
    return true;
  }

  if (mimeType.startsWith("text/")) {
    return Boolean(textContentPath);
  }

  return fileName.toLowerCase().endsWith(".pdf");
}

function PreviewLoadingState({ mimeType }: { mimeType: string }) {
  const isImage = mimeType.startsWith("image/");

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-start overflow-y-auto bg-[linear-gradient(180deg,rgba(248,251,248,0.96),rgba(243,248,243,0.96))] px-5 py-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(74,148,84,0.08),transparent_48%)]" />
      <div className="relative flex w-full max-w-[720px] flex-col items-center gap-4">
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-[#d8e5d9] bg-white/92 px-3 py-1.5 text-[12px] font-medium text-[#5b685d] shadow-[0_8px_22px_rgba(22,38,29,0.06)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
          Preparing preview
        </div>

        <div className="relative w-full overflow-hidden rounded-[18px] border border-[#dfe9e0] bg-white/92 p-4 shadow-[0_18px_40px_rgba(22,38,29,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-[12px] bg-[#eef6ef] text-brand">
              {isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-40 rounded-full" />
              <Skeleton className="mt-1 h-2.5 w-24 rounded-full" />
            </div>
          </div>

          {isImage ? (
            <div className="space-y-3">
              <Skeleton className="h-[min(44vh,360px)] w-full rounded-[14px]" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-14 rounded-[12px]" />
                <Skeleton className="h-14 rounded-[12px]" />
                <Skeleton className="h-14 rounded-[12px]" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full rounded-[12px]" />
              <Skeleton className="h-8 w-[92%] rounded-[12px]" />
              <Skeleton className="h-8 w-[88%] rounded-[12px]" />
              <Skeleton className="h-8 w-[95%] rounded-[12px]" />
              <Skeleton className="h-8 w-[84%] rounded-[12px]" />
              <Skeleton className="h-8 w-[90%] rounded-[12px]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AssetPreviewDialog({
  isOpen,
  fileName,
  mimeType,
  previewPath,
  textContentPath,
  downloadPath,
  onClose,
}: AssetPreviewDialogProps) {
  const [loading, setLoading] = useState(true);
  const [textContent, setTextContent] = useState("");
  const [textError, setTextError] = useState<string>();
  const [textTruncated, setTextTruncated] = useState(false);
  const isText = Boolean(textContentPath);

  useEffect(() => {
    if (!isOpen || !textContentPath) return;
    const controller = new AbortController();

    void fetch(textContentPath, { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as {
          content?: string;
          truncated?: boolean;
          error?: string;
        };
        if (!response.ok || typeof result.content !== "string") {
          throw new Error(result.error || "Unable to prepare the text preview.");
        }
        setTextContent(result.content);
        setTextTruncated(Boolean(result.truncated));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTextError(
          error instanceof Error ? error.message : "Unable to prepare the text preview.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, textContentPath]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[#112118]/55 px-4 py-8 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${fileName}`}
    >
      <Card className="flex h-full max-h-[86vh] w-full max-w-[1080px] flex-col rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
          <div className="min-w-0">
            <CardTitle className="truncate text-[22px] font-semibold tracking-tight text-[#111712]">
              {fileName}
            </CardTitle>
            {isText ? (
              <p className="mt-1 text-[12px] text-[#748078]">
                Text document · Readable preview
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {downloadPath ? (
              <Button
                asChild
                type="button"
                variant="secondary"
                size="icon"
                className="border border-line"
              >
                <a href={downloadPath} aria-label={`Download ${fileName}`}>
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onClose}
              className="border border-line"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
          <div className="relative flex h-full min-h-[420px] items-center justify-center overflow-hidden rounded-[20px] border border-[#e3e8e2] bg-[#f8fbf8]">
            {loading ? <PreviewLoadingState mimeType={mimeType} /> : null}
            {isText ? (
              <div className="h-full w-full overflow-y-auto bg-[#eef2ed] px-4 py-6 sm:px-8 sm:py-8">
                {textError ? (
                  <div className="mx-auto max-w-[760px] rounded-[16px] border border-[#efcbc8] bg-[#fff4f3] px-5 py-4 text-[13px] text-[#aa4843]">
                    {textError}
                  </div>
                ) : (
                  <article className="mx-auto min-h-full w-full max-w-[820px] rounded-[18px] border border-[#dfe5df] bg-white px-6 py-7 shadow-[0_16px_40px_rgba(24,43,30,0.08)] sm:px-10 sm:py-10">
                    <div className="mb-7 flex items-center gap-3 border-b border-[#e8ede8] pb-5">
                      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#eaf4ec] text-[#2e754f]">
                        <FileText className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-[720] text-[#233027]">
                          {fileName}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#829087]">Plain text</p>
                      </div>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-[#344139] selection:bg-[#dcefe2]">
                      {textContent || "This text file is empty."}
                    </div>
                    {textTruncated ? (
                      <p className="mt-8 border-t border-[#e8ede8] pt-4 text-[11px] text-[#819087]">
                        Preview limited to the first 1 MB. Download the file to read the rest.
                      </p>
                    ) : null}
                  </article>
                )}
              </div>
            ) : canShowImageThumbnail(fileName, mimeType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewPath}
                alt={fileName}
                onLoad={() => setLoading(false)}
                onError={() => setLoading(false)}
                className="h-full max-h-full w-full object-contain"
              />
            ) : (
              <iframe
                src={previewPath}
                title={fileName}
                onLoad={() => setLoading(false)}
                className="h-full w-full bg-white"
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}

export function AssetPreviewButton({
  fileName,
  mimeType,
  previewPath,
  textContentPath,
  downloadPath,
  triggerClassName,
  iconOnly = true,
  label = "View",
}: AssetPreviewButtonProps) {
  const [open, setOpen] = useState(false);

  if (!isPreviewableAsset(fileName, mimeType, textContentPath)) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={iconOnly ? "icon" : "sm"}
        className={triggerClassName}
        onClick={() => setOpen(true)}
        aria-label={`${label} ${fileName}`}
      >
        <Eye className="h-4 w-4" />
        {iconOnly ? null : <span>{label}</span>}
      </Button>

      {open ? (
        <AssetPreviewDialog
          isOpen
          fileName={fileName}
          mimeType={mimeType}
          previewPath={previewPath}
          textContentPath={textContentPath}
          downloadPath={downloadPath}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function AssetImageThumbnail({
  fileName,
  mimeType,
  previewPath,
  downloadPath,
  className,
  interactive = true,
}: AssetImageThumbnailProps) {
  const [open, setOpen] = useState(false);
  const thumbnailImage = (
    <FileThumbnail
      fileName={fileName}
      mimeType={mimeType}
      previewPath={previewPath}
      className="h-full w-full rounded-none border-0 bg-transparent"
    />
  );
  const thumbnailClassName = cn(
    "relative h-10 w-14 shrink-0 overflow-hidden rounded-[9px] border border-[#d8e2d9] bg-[#f4f7f4] shadow-[0_3px_10px_rgba(22,40,28,0.08)]",
    interactive &&
      "group outline-none transition hover:border-[#86b397] focus-visible:ring-2 focus-visible:ring-[#3f8f63] focus-visible:ring-offset-2",
    className,
  );

  if (!interactive || !canShowImageThumbnail(fileName, mimeType) || !previewPath) {
    return <div className={thumbnailClassName}>{thumbnailImage}</div>;
  }

  return (
    <>
      <button
        type="button"
        className={thumbnailClassName}
        onClick={() => setOpen(true)}
        aria-label={`Preview image ${fileName}`}
        title={`Preview ${fileName}`}
      >
        {thumbnailImage}
        <span className="absolute inset-0 grid place-items-center bg-[#102218]/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Eye className="h-3.5 w-3.5" />
        </span>
      </button>

      {open ? (
        <AssetPreviewDialog
          isOpen
          fileName={fileName}
          mimeType={mimeType}
          previewPath={previewPath}
          downloadPath={downloadPath}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

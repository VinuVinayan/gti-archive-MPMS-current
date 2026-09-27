"use client";

import { useRef } from "react";
import { AlertCircle, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import { FileThumbnail } from "@/components/projects/file-thumbnail";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChecklistFileRecord = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  attachmentId?: string;
  file?: File;
  uploadState?: "pending" | "uploading" | "failed";
  uploadProgress?: number;
  uploadError?: string;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChecklistFilePicker({
  fieldLabel,
  files,
  multiple = false,
  compact = false,
  disabled = false,
  accept,
  onChange,
}: {
  fieldLabel: string;
  files: ChecklistFileRecord[];
  multiple?: boolean;
  compact?: boolean;
  disabled?: boolean;
  accept?: string;
  onChange: (files: ChecklistFileRecord[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      file,
      uploadState: "pending" as const,
    }));

    if (selected.length > 0) {
      onChange(multiple ? [...files, ...selected] : selected.slice(0, 1));
    }
    event.currentTarget.value = "";
  }

  return (
    <div className="min-w-0 space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        hidden
        onChange={selectFiles}
      />
      <div className="flex min-w-0 flex-wrap gap-2">
        {files.map((file) => (
          <span
            key={file.id}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-[11px]",
              file.uploadState === "failed"
                ? "border-[#efb7ad] bg-[#fff5f3] text-[#71362f]"
                : "border-[#dfe6df] bg-[#f7faf7] text-[#344038]",
            )}
            title={file.uploadError || file.name}
          >
            {file.uploadState === "uploading" ? (
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[#438060]" />
            ) : file.uploadState === "failed" ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#b5473b]" />
            ) : (
              <FileThumbnail
                fileName={file.name}
                mimeType={file.mimeType}
                file={file.file}
                previewPath={file.attachmentId ? `/api/project-assets/${file.attachmentId}/preview` : undefined}
                className="h-8 w-10"
              />
            )}
            <span className="max-w-[220px] truncate font-[650]">{file.name}</span>
            <span className="shrink-0 text-[#7c867f]">
              {file.uploadState === "uploading"
                ? `${Math.round((file.uploadProgress ?? 0) * 100)}%`
                : file.uploadState === "failed"
                  ? "Not uploaded"
                  : formatFileSize(file.size)}
            </span>
            {file.uploadState === "failed" ? (
              <button
                type="button"
                disabled={disabled}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-white px-2 text-[9px] font-[750] text-[#a33d33] shadow-sm hover:bg-[#fff0ed] disabled:pointer-events-none disabled:opacity-50"
                aria-label={`Retry ${file.name}`}
                onClick={() =>
                  onChange(
                    files.map((item) =>
                      item.id === file.id
                        ? {
                            ...item,
                            uploadState: "pending",
                            uploadProgress: 0,
                            uploadError: undefined,
                          }
                        : item,
                    ),
                  )
                }
              >
                <RotateCcw className="h-2.5 w-2.5" /> Retry
              </button>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              className="grid size-5 place-items-center rounded-full text-[#7d8780] hover:bg-[#e5ebe6] hover:text-[#344038] disabled:pointer-events-none disabled:opacity-50"
              aria-label={`Remove ${file.name}`}
              onClick={() => onChange(files.filter((item) => item.id !== file.id))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`Choose ${fieldLabel} ${multiple ? "files" : "file"}`}
          className={cn(
            "rounded-[11px] border-dashed border-[#9dbba7] bg-[#f8fcf9] font-[680] text-[#347153] shadow-none hover:border-[#6f9f80] hover:bg-[#f0f8f2]",
            compact ? "min-h-10 px-3 text-[11px]" : "min-h-11 px-4 text-[12px]",
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {files.length > 0 && multiple ? "Add more" : multiple ? "Choose files" : "Choose file"}
        </Button>
      </div>
      {files.length === 0 ? (
        <p className="text-[10px] text-[#8a948d]">New files are uploaded when you submit or save.</p>
      ) : null}
    </div>
  );
}

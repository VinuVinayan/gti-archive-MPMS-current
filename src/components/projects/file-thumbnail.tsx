"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";

type FileThumbnailProps = {
  fileName: string;
  mimeType: string;
  previewPath?: string | null;
  file?: File;
  className?: string;
  imageClassName?: string;
  fallback?: ReactNode;
};

export function canShowImageThumbnail(fileName: string, mimeType: string) {
  return mimeType.startsWith("image/") ||
    ((!mimeType || mimeType === "application/octet-stream") &&
      /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(fileName));
}

/** A non-interactive thumbnail that can also be used inside links and buttons. */
export function FileThumbnail({
  fileName,
  mimeType,
  previewPath,
  file,
  className,
  imageClassName,
  fallback,
}: FileThumbnailProps) {
  const isImage = canShowImageThumbnail(fileName, mimeType);
  const [localPreview, setLocalPreview] = useState<{ file: File; url: string }>();
  const [failedSource, setFailedSource] = useState<string>();

  useEffect(() => {
    if (!file || !isImage) return;
    const url = URL.createObjectURL(file);
    // Synchronize the thumbnail with this browser-owned resource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const source = file
    ? localPreview?.file === file ? localPreview.url : undefined
    : previewPath;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-[#d8e2d9] bg-[#f4f7f4] text-[#438060]",
        className,
      )}
    >
      {isImage && source && source !== failedSource ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSource(source)}
          className={cn("h-full w-full object-contain", imageClassName)}
        />
      ) : fallback ?? <FileText className="h-5 w-5" />}
    </span>
  );
}

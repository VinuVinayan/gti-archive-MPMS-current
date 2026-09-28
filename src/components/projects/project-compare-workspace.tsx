"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Expand,
  Eye,
  EyeOff,
  Hand,
  Loader2,
  MessageSquarePlus,
  MousePointer2,
  Send,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  createComparisonCommentAction,
  removeProjectCollaboratorAction,
  setProjectCollaboratorChatVisibilityAction,
} from "@/app/(dashboard)/projects/actions";
import {
  AssetImageThumbnail,
  AssetPreviewButton,
} from "@/components/projects/asset-preview-button";
import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import { ProjectCollaboratorsPanel } from "@/components/projects/project-collaborators-panel";
import {
  SubmissionCaptionDialog,
  type CaptionDialogAttachment,
} from "@/components/projects/submission-caption-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StageHistoryRecord } from "@/lib/project-history";
import type { ProjectConceptChatMode } from "@/lib/project-concepts";
import type {
  ProjectAttachmentRecord,
  ProjectCollaboratorRecord,
  ProjectFlowRecord,
  ProjectStageRecord,
} from "@/lib/projects";
import {
  type ComparisonCommentRecord,
  getStageSubmissionAttachments,
  isCaptionableStageSubmissionAttachment,
  resolveComparisonSelection,
  stageSubmissionCaptionHelpText,
} from "@/lib/comparison-utils";

type ProjectCompareWorkspaceProps = {
  project: ProjectFlowRecord;
  stageId?: string | null;
  history: StageHistoryRecord;
  initialBaseAttachmentId?: string | null;
  initialCompareAttachmentId?: string | null;
  initialComments: ComparisonCommentRecord[];
  canManageCollaborators: boolean;
  canManageChatVisibility: boolean;
  canAddCaptions: boolean;
  currentUserId: string;
  conceptMode?: ProjectConceptChatMode;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type PendingCommentPosition = {
  xPercent: number;
  yPercent: number;
};

type CompareZoomMode = "fit" | "width" | "zoom";
type CompareToolMode = "view" | "pan" | "comment";

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatZoomPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function formatSubmissionLabel(submission: ProjectAttachmentRecord) {
  return submission.submissionNumber
    ? `Submission ${submission.submissionNumber}`
    : "Submission";
}

function buildCompareHref(
  projectId: string,
  stageId: string | null | undefined,
  baseAttachmentId: string,
  compareAttachmentId: string,
  conceptCompareHref?: string,
) {
  const searchParams = new URLSearchParams();

  if (stageId && !conceptCompareHref) {
    searchParams.set("stage", stageId);
  }

  searchParams.set("base", baseAttachmentId);
  searchParams.set("compare", compareAttachmentId);

  const compareHref = conceptCompareHref ?? `/projects/${projectId}/compare`;

  return `${compareHref}?${searchParams.toString()}`;
}

function getFallbackComparisonId(
  submissions: ProjectAttachmentRecord[],
  excludedId: string,
  preferredId?: string | null,
) {
  if (preferredId && preferredId !== excludedId) {
    return preferredId;
  }

  return submissions.find((submission) => submission.id !== excludedId)?.id ?? null;
}

function ComparisonSelector({
  label,
  submission,
  submissions,
  disabled,
  onValueChange,
}: {
  label: string;
  submission: ProjectAttachmentRecord | null;
  submissions: ProjectAttachmentRecord[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="flex h-9 min-w-0 items-center rounded-[10px] border border-[#dce6de] bg-white pl-2.5 shadow-none">
      <span className="shrink-0 text-[9px] font-[800] uppercase tracking-[0.07em] text-[#718074]">
        {label}
      </span>
      <Select
        value={submission?.id}
        onValueChange={onValueChange}
        disabled={disabled || submissions.length === 0}
      >
        <SelectTrigger className="h-full min-w-0 flex-1 rounded-[10px] border-0 bg-transparent px-2 text-[11px] font-[700] shadow-none focus:ring-0 [&>span]:min-w-0 [&>span]:truncate">
          <SelectValue placeholder="Select submission" />
        </SelectTrigger>
        <SelectContent>
          {submissions.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {formatSubmissionLabel(item)} · {item.originalFileName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ComparisonCommentsPanel({
  comments,
  activeCommentId,
  onSelectComment,
  canAddCaptions,
  onAddCaption,
  captionModeActive,
  fullscreenMode = false,
}: {
  comments: ComparisonCommentRecord[];
  activeCommentId: string | null;
  onSelectComment: (commentId: string) => void;
  canAddCaptions: boolean;
  onAddCaption: () => void;
  captionModeActive: boolean;
  fullscreenMode?: boolean;
}) {
  return (
    <Card className={`flex min-h-0 min-w-0 flex-col rounded-[20px] border border-[#dbe4dc] bg-white p-4 shadow-[0_10px_24px_rgba(18,35,23,0.05)] ${
      fullscreenMode ? "h-full" : "max-h-[720px] xl:h-full"
    }`}>
      <div className="shrink-0 border-b border-[#edf1ed] pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[17px] font-semibold tracking-tight text-brand">
            Captions
          </CardTitle>
          <span className="rounded-full bg-[#edf7ef] px-2 py-0.5 text-[10px] font-[800] text-[#2b8b56]">
            {comments.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-[1.45] text-[#6f786f]">
          {captionModeActive
            ? "Click anywhere on the artwork to place a caption."
            : "Select a marker to review its caption."}
        </p>
      </div>
      {comments.length > 0 ? (
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {comments.map((comment, index) => {
            const isActive = activeCommentId === comment.id;

            return (
              <button
                key={comment.id}
                type="button"
                className={`flex w-full items-start gap-2.5 rounded-[14px] border px-3 py-2.5 text-left transition ${
                  isActive
                    ? "border-brand/45 bg-[#f4fbf5] shadow-[0_10px_22px_rgba(18,35,23,0.05)]"
                    : "border-[#e0e7e1] bg-white hover:border-brand/25"
                }`}
                onClick={() => onSelectComment(comment.id)}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#edf7ef] text-[11px] font-[800] text-[#2b8b56]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-[700] text-[#111712]">
                    {comment.author}
                  </span>
                  <span className="block text-[10px] text-[#7d867f]">
                    {comment.role} · {comment.createdAt}
                  </span>
                  <span className="mt-1 block text-[13px] leading-[1.45] text-[#2b342d]">
                    {comment.body}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-28 flex-1 place-items-center py-5 text-center">
          <p className="text-[12px] text-[#6f786f]">No captions yet.</p>
        </div>
      )}
      {canAddCaptions ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={`mt-3 h-9 shrink-0 rounded-[11px] border border-brand/35 ${
            captionModeActive
              ? "bg-brand text-white hover:bg-brand/90"
              : "bg-white text-brand hover:bg-[#f4faf5]"
          }`}
          onClick={onAddCaption}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {captionModeActive ? "Click Artwork to Place" : "Add Caption"}
        </Button>
      ) : null}
    </Card>
  );
}

function ComparisonViewerSurface({
  baseSubmission,
  compareSubmission,
  comments,
  opacity,
  onOpacityChange,
  activeCommentId,
  onActiveCommentChange,
  pendingComment,
  commentDraft,
  onCommentDraftChange,
  onSaveComment,
  onCancelComment,
  onCreatePendingComment,
  isSavingComment,
  commentError,
  onBaseImageLoad,
  onCompareImageLoad,
  comparisonAspectRatio,
  onToggleFullscreen,
  commentsVisible,
  onToggleCommentsVisible,
  canAddCaptions,
  toolMode,
  onToolModeChange,
  selectionControls,
  isSelectionPending,
  captionsPanelOpen,
  onToggleCaptionsPanel,
  fullscreenMode = false,
}: {
  baseSubmission: ProjectAttachmentRecord;
  compareSubmission: ProjectAttachmentRecord;
  comments: ComparisonCommentRecord[];
  opacity: number;
  onOpacityChange: (value: number) => void;
  activeCommentId: string | null;
  onActiveCommentChange: (commentId: string | null) => void;
  pendingComment: PendingCommentPosition | null;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onSaveComment: () => void;
  onCancelComment: () => void;
  onCreatePendingComment: (position: PendingCommentPosition) => void;
  isSavingComment: boolean;
  commentError: string | null;
  onBaseImageLoad: (dimensions: ImageDimensions) => void;
  onCompareImageLoad: (dimensions: ImageDimensions) => void;
  comparisonAspectRatio: number;
  onToggleFullscreen: () => void;
  commentsVisible: boolean;
  onToggleCommentsVisible: () => void;
  canAddCaptions: boolean;
  toolMode: CompareToolMode;
  onToolModeChange: (mode: CompareToolMode) => void;
  selectionControls: React.ReactNode;
  isSelectionPending: boolean;
  captionsPanelOpen: boolean;
  onToggleCaptionsPanel: () => void;
  fullscreenMode?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [zoomMode, setZoomMode] = useState<CompareZoomMode>("fit");
  const [zoomScale, setZoomScale] = useState(1.25);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const activeComment = comments.find((comment) => comment.id === activeCommentId) ?? null;
  const baseOpacity = 1 - opacity / 100;
  const compareOpacity = opacity / 100;
  const isFitMode = zoomMode === "fit";
  const currentZoomLabel =
    zoomMode === "fit" ? "Fit" : zoomMode === "width" ? "Fill" : formatZoomPercent(zoomScale);
  const isPresetZoom = ZOOM_PRESETS.some((preset) => Math.abs(preset - zoomScale) < 0.001);
  const zoomSelectValue =
    zoomMode === "fit"
      ? "fit"
      : zoomMode === "width"
        ? "width"
        : isPresetZoom
          ? String(zoomScale)
          : `custom-${zoomScale}`;
  const fitPadding = fullscreenMode ? 12 : 20;
  const availableFitWidth = Math.max(0, viewportSize.width - fitPadding);
  const availableFitHeight = Math.max(0, viewportSize.height - fitPadding);
  const fitFrameWidth =
    availableFitWidth > 0 && availableFitHeight > 0
      ? Math.min(availableFitWidth, availableFitHeight * comparisonAspectRatio)
      : 0;
  const fitFrameHeight =
    fitFrameWidth > 0 && comparisonAspectRatio > 0 ? fitFrameWidth / comparisonAspectRatio : 0;
  const frameWidth =
    zoomMode === "fit"
      ? fitFrameWidth > 0
        ? `${Math.round(fitFrameWidth)}px`
        : "100%"
      : zoomMode === "width"
        ? "100%"
        : `${Math.round(100 * zoomScale)}%`;
  const frameHeight =
    zoomMode === "fit" && fitFrameHeight > 0 ? `${Math.round(fitFrameHeight)}px` : undefined;
  const baseLabelStrong = baseOpacity >= compareOpacity;
  const compareLabelStrong = compareOpacity >= baseOpacity;
  const panLimit = Math.max(120, Math.round(360 * zoomScale));

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const updateViewportSize = () => {
      const rect = viewport.getBoundingClientRect();

      setViewportSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateViewportSize();

    const resizeObserver = new ResizeObserver(updateViewportSize);
    resizeObserver.observe(viewport);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  function handleFrameClick(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-comment-interactive='true']")) {
      return;
    }

    if (toolMode !== "comment" || !canAddCaptions) {
      return;
    }

    const rect = frameRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const xPercent = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const yPercent = clampPercent(((event.clientY - rect.top) / rect.height) * 100);

    onActiveCommentChange(null);
    onCreatePendingComment({
      xPercent,
      yPercent,
    });
  }

  function setFitMode() {
    setZoomMode("fit");
    setZoomScale(1.25);
    setPanOffset({ x: 0, y: 0 });
  }

  function setWidthMode() {
    setZoomMode("width");
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  }

  function setZoomPreset(nextScale: number) {
    setZoomMode("zoom");
    setZoomScale(nextScale);
  }

  function zoomOut() {
    setZoomMode("zoom");
    setZoomScale((current) => Math.max(0.25, Number((current - 0.25).toFixed(2))));
  }

  function zoomIn() {
    setZoomMode("zoom");
    setZoomScale((current) => Math.min(3, Number((current + 0.25).toFixed(2))));
  }

  function handlePanPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (toolMode !== "pan" || event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest("[data-comment-interactive='true']")) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: panOffset.x,
      offsetY: panOffset.y,
    };
    setIsPanning(true);
  }

  function handlePanPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning || !panStartRef.current) {
      return;
    }

    const nextX =
      panStartRef.current.offsetX + event.clientX - panStartRef.current.pointerX;
    const nextY =
      panStartRef.current.offsetY + event.clientY - panStartRef.current.pointerY;

    setPanOffset({
      x: Math.max(-panLimit, Math.min(panLimit, nextX)),
      y: Math.max(-panLimit, Math.min(panLimit, nextY)),
    });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    panStartRef.current = null;
    setIsPanning(false);
  }

  return (
    <Card
      className={`relative flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden border bg-white shadow-[0_12px_28px_rgba(17,34,24,0.06)] ${
        fullscreenMode
          ? "h-full rounded-[16px] border-[#d8e2d9] p-2 shadow-none"
          : "rounded-[18px] border-[#dbe4dc] p-2 md:h-[calc(100dvh-180px)] md:min-h-[500px] md:max-h-[760px]"
      }`}
    >
      {isSelectionPending ? (
        <div className="absolute inset-0 z-50 grid place-items-center bg-white/72 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#dbe6da] bg-white px-3 py-1.5 text-[11px] font-[700] text-[#31523f] shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating comparison pair
          </div>
        </div>
      ) : null}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-[12px] border border-[#e1e8e2] bg-[#f8faf8] p-1.5 xl:flex-nowrap">
        <div className="grid min-w-0 flex-[1_1_360px] grid-cols-1 gap-1.5 sm:grid-cols-2">
          {selectionControls}
        </div>
        <div className="flex min-w-0 flex-[0_1_auto] flex-wrap items-center gap-1">
          <div className="flex min-w-0 flex-wrap gap-1">
              <Button
                type="button"
                variant={toolMode === "view" ? "default" : "secondary"}
                size="sm"
                className="h-8 rounded-[9px] px-2.5 text-[11px]"
                onClick={() => onToolModeChange("view")}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                View
              </Button>
              <Button
                type="button"
                variant={toolMode === "pan" ? "default" : "secondary"}
                size="sm"
                className="h-8 rounded-[9px] px-2.5 text-[11px]"
                onClick={() => onToolModeChange("pan")}
              >
                <Hand className="h-3.5 w-3.5" />
                Pan
              </Button>
              <Button
                type="button"
                variant={toolMode === "comment" ? "default" : "secondary"}
                size="sm"
                className="h-8 rounded-[9px] px-2.5 text-[11px]"
                onClick={() => onToolModeChange("comment")}
                disabled={!canAddCaptions}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                Caption
              </Button>
          </div>
          <span className="hidden h-5 w-px bg-[#dbe3dc] sm:block" aria-hidden="true" />
          <div className="flex min-w-0 flex-wrap items-center gap-1">
              <Select
                value={zoomSelectValue}
                onValueChange={(value) => {
                  if (value === "fit") {
                    setFitMode();
                    return;
                  }

                  if (value === "width") {
                    setWidthMode();
                    return;
                  }

                  if (value.startsWith("custom-")) {
                    return;
                  }

                  setZoomPreset(Number(value));
                }}
              >
                <SelectTrigger className="h-8 w-[84px] rounded-[9px] border border-[#d8dfd8] bg-white px-2 text-[11px] font-[700] text-[#152019]">
                  <SelectValue placeholder={`Zoom: ${currentZoomLabel}`} />
                </SelectTrigger>
                <SelectContent className="z-[130]">
                  <SelectItem value="fit">Fit</SelectItem>
                  <SelectItem value="width">Fill width</SelectItem>
                  {!isPresetZoom && zoomMode === "zoom" ? (
                    <SelectItem value={zoomSelectValue} disabled>
                      {formatZoomPercent(zoomScale)}
                    </SelectItem>
                  ) : null}
                  {ZOOM_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={String(preset)}>
                      {formatZoomPercent(preset)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-8 rounded-[9px]"
                onClick={zoomOut}
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-8 rounded-[9px]"
                onClick={zoomIn}
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
          </div>
          <span className="hidden h-5 w-px bg-[#dbe3dc] sm:block" aria-hidden="true" />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-[9px] px-2.5 text-[11px]"
              onClick={onToggleCommentsVisible}
              aria-label={commentsVisible ? "Hide markers" : "Show markers"}
            >
              {commentsVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden 2xl:inline">Markers</span>
            </Button>
            <Button
              type="button"
              variant={captionsPanelOpen ? "default" : "secondary"}
              size="sm"
              className="h-8 rounded-[9px] px-2.5 text-[11px]"
              onClick={onToggleCaptionsPanel}
              aria-expanded={captionsPanelOpen}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Captions {comments.length}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-[9px] border border-[#dce5dd] bg-white px-2.5 text-[11px] text-[#27322b]"
              onClick={onToggleFullscreen}
              aria-label={fullscreenMode ? "Close fullscreen" : "Maximize comparison viewer"}
            >
              {fullscreenMode ? <X className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              <span className="hidden 2xl:inline">
                {fullscreenMode ? "Close" : "Maximize"}
              </span>
            </Button>
          </div>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`relative min-h-0 border p-2.5 shadow-[inset_0_0_0_1px_rgba(225,234,226,0.7)] sm:p-3 ${
          fullscreenMode
            ? "flex-1 rounded-[16px] border-[#dce5dd] bg-[#f1f4f0]"
            : "h-[clamp(380px,58dvh,650px)] rounded-[14px] border-[#dce5dd] bg-[radial-gradient(circle_at_top,rgba(69,137,86,0.06),transparent_58%),linear-gradient(180deg,#f7f9f6,#eef2ed)] md:h-auto md:flex-1"
        } ${
          isFitMode || toolMode === "pan" ? "overflow-hidden" : "overflow-auto"
        }`}
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className={`flex min-h-full min-w-full ${
            isFitMode || toolMode === "pan" ? "items-center justify-center" : "items-start justify-start"
          }`}
        >
          <div
            ref={frameRef}
            className={`relative shrink-0 overflow-hidden rounded-[12px] bg-white shadow-[0_14px_34px_rgba(20,37,25,0.12)] ${
              toolMode === "pan"
                ? isPanning
                  ? "cursor-grabbing"
                  : "cursor-grab"
                : toolMode === "comment"
                  ? "cursor-crosshair"
                  : "cursor-default"
            }`}
            style={{
              aspectRatio: comparisonAspectRatio,
              width: frameWidth,
              height: frameHeight,
              maxWidth: isFitMode ? "100%" : undefined,
              maxHeight: isFitMode ? "100%" : undefined,
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
              transition: isPanning ? "none" : "transform 120ms ease",
            }}
            onClick={handleFrameClick}
          >
            <div className="absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2 sm:inset-x-3 sm:top-3">
              <span className="rounded-[8px] bg-white/92 px-2.5 py-1 text-[9px] font-[800] uppercase tracking-[0.08em] text-[#235f3d] shadow-[0_6px_16px_rgba(19,34,24,0.1)] backdrop-blur-sm">
                Base · {formatSubmissionLabel(baseSubmission)}
              </span>
              <span className="rounded-[8px] bg-[#eef8f1]/92 px-2.5 py-1 text-right text-[9px] font-[800] uppercase tracking-[0.08em] text-[#2c8b58] shadow-[0_6px_16px_rgba(19,34,24,0.1)] backdrop-blur-sm">
                Compare · {formatSubmissionLabel(compareSubmission)}
              </span>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={baseSubmission.previewPath}
              alt={baseSubmission.originalFileName}
              onLoad={(event) =>
                onBaseImageLoad({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              className="absolute inset-0 h-full w-full object-contain select-none"
              style={{ opacity: baseOpacity }}
              draggable={false}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={compareSubmission.previewPath}
              alt={compareSubmission.originalFileName}
              onLoad={(event) =>
                onCompareImageLoad({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              className="absolute inset-0 h-full w-full object-contain select-none"
              style={{ opacity: compareOpacity }}
              draggable={false}
            />

            {commentsVisible ? comments.map((comment, index) => {
              const isActive = activeCommentId === comment.id;

              return (
                <button
                  key={comment.id}
                  type="button"
                  data-comment-interactive="true"
                  className={`absolute z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-[11px] font-[800] shadow-[0_12px_22px_rgba(16,33,23,0.16)] transition ${
                    isActive
                      ? "border-[#1f7a4b] bg-[#1f7a4b] text-white"
                      : "border-white/90 bg-[#fff8ed] text-[#8a4e14]"
                  }`}
                  style={{
                    left: `${comment.xPercent}%`,
                    top: `${comment.yPercent}%`,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelComment();
                    onActiveCommentChange(isActive ? null : comment.id);
                  }}
                  aria-label={`Open caption ${index + 1}`}
                >
                  {index + 1}
                </button>
              );
            }) : null}

            {pendingComment ? (
              <span
                data-caption-marker="pending"
                data-comment-interactive="true"
                className="absolute z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/90 bg-[#1f7a4b] text-white shadow-[0_12px_22px_rgba(16,33,23,0.2)]"
                style={{
                  left: `${pendingComment.xPercent}%`,
                  top: `${pendingComment.yPercent}%`,
                }}
                aria-hidden="true"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </span>
            ) : null}
          </div>
        </div>

        {commentsVisible && activeComment ? (
          <div
            data-caption-overlay-layer="true"
            data-comment-interactive="true"
            className="absolute inset-x-3 bottom-3 z-40 mx-auto max-h-[calc(100%-1.5rem)] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto rounded-[18px] border border-[#d8e5d9] bg-white p-3 shadow-[0_18px_36px_rgba(14,31,20,0.14)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:mx-0 sm:w-80"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-[700] text-[#111712]">{activeComment.author}</p>
                <p className="text-[10px] text-[#7b847d]">
                  {activeComment.role} · {activeComment.createdAt}
                </p>
              </div>
              <button
                type="button"
                className="text-[#7d847e] transition hover:text-[#27322b]"
                onClick={() => onActiveCommentChange(null)}
                aria-label="Close caption"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-[1.45] text-[#111712]">{activeComment.body}</p>
          </div>
        ) : null}

        {pendingComment ? (
          <div
            data-caption-editor="true"
            data-caption-overlay-layer="true"
            data-comment-interactive="true"
            className="absolute inset-x-3 bottom-3 z-40 mx-auto max-h-[calc(100%-1.5rem)] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-[20px] border border-[#d8e5d9] bg-white p-4 shadow-[0_20px_38px_rgba(14,31,20,0.16)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:mx-0 sm:w-[22rem]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-[12px] font-[800] uppercase tracking-[0.08em] text-[#2c8b58]">
              New Caption
            </p>
            <Textarea
              value={commentDraft}
              onChange={(event) => onCommentDraftChange(event.target.value)}
              placeholder="Caption"
              className="mt-3 min-h-[90px] rounded-[16px] border border-[#dce6de] bg-[#f8fbf8] text-[13px]"
            />
            {commentError ? (
              <p className="mt-2 text-[12px] text-[#bd554f]">{commentError}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={onCancelComment}
                disabled={isSavingComment}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                onClick={onSaveComment}
                disabled={isSavingComment}
              >
                {isSavingComment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Save Caption
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 shrink-0 rounded-[12px] border border-[#dde6de] bg-[#f8faf8] px-3 py-1.5">
        <div className="grid gap-1">
          <div className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <div className="min-w-0">
              <p
                className={`truncate text-[10px] font-[800] ${
                  baseLabelStrong ? "text-[#173120]" : "text-[#7c887f]"
                }`}
                title={baseSubmission.originalFileName}
              >
                Base: {baseSubmission.originalFileName}
              </p>
            </div>
            <div className="inline-flex min-w-[132px] items-center justify-center rounded-full bg-[#e7f3e9] px-2.5 py-0.5 text-[10px] font-[800] text-[#26704a]">
              Blend: {100 - opacity}% / {opacity}%
            </div>
            <div className="min-w-0 text-left sm:text-right">
              <p
                className={`truncate text-[10px] font-[800] ${
                  compareLabelStrong ? "text-[#173120]" : "text-[#7c887f]"
                }`}
                title={compareSubmission.originalFileName}
              >
                Compare: {compareSubmission.originalFileName}
              </p>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={opacity}
            onChange={(event) => onOpacityChange(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#d9dfda] accent-brand"
            aria-label="Adjust compare submission opacity"
          />
        </div>
      </div>
    </Card>
  );
}

export function ProjectCompareWorkspace({
  project,
  stageId,
  history,
  initialBaseAttachmentId,
  initialCompareAttachmentId,
  initialComments,
  canManageCollaborators,
  canManageChatVisibility,
  canAddCaptions,
  currentUserId,
  conceptMode,
}: ProjectCompareWorkspaceProps) {
  const router = useRouter();
  const [isSelectionPending, startSelectionTransition] = useTransition();
  const [collaborators, setCollaborators] = useState<ProjectCollaboratorRecord[]>(
    project.collaborators,
  );
  const [collaboratorSaving, setCollaboratorSaving] = useState(false);
  const [comments, setComments] = useState<ComparisonCommentRecord[]>(initialComments);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(
    initialComments[0]?.id ?? null,
  );
  const [pendingComment, setPendingComment] = useState<PendingCommentPosition | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(true);
  const [captionsPanelOpen, setCaptionsPanelOpen] = useState(initialComments.length > 0);
  const [toolMode, setToolMode] = useState<CompareToolMode>("view");
  const [captionDialogAttachment, setCaptionDialogAttachment] =
    useState<CaptionDialogAttachment | null>(null);
  const [opacity, setOpacity] = useState(100);
  const [baseImageDimensions, setBaseImageDimensions] = useState<ImageDimensions | null>(null);
  const [compareImageDimensions, setCompareImageDimensions] = useState<ImageDimensions | null>(
    null,
  );
  const activeStage = useMemo<ProjectStageRecord | undefined>(() => {
    if (!stageId) {
      return (
        project.stageCards.find((stage) => stage.id === project.currentStageId) ??
        project.stageCards[0]
      );
    }

    return project.stageCards.find((stage) => stage.id === stageId) ?? project.stageCards[0];
  }, [project.currentStageId, project.stageCards, stageId]);
  const submissions = useMemo(
    () => getStageSubmissionAttachments(history.entries, project.category),
    [history.entries, project.category],
  );
  const { baseSubmission, compareSubmission } = useMemo(
    () =>
      resolveComparisonSelection(
        submissions,
        initialBaseAttachmentId,
        initialCompareAttachmentId,
      ),
    [initialBaseAttachmentId, initialCompareAttachmentId, submissions],
  );
  const comparisonAspectRatio = useMemo(() => {
    const maxWidth = Math.max(baseImageDimensions?.width ?? 1, compareImageDimensions?.width ?? 1);
    const maxHeight = Math.max(
      baseImageDimensions?.height ?? 1,
      compareImageDimensions?.height ?? 1,
    );

    return maxHeight > 0 ? maxWidth / maxHeight : 1;
  }, [baseImageDimensions, compareImageDimensions]);

  useEffect(() => {
    if (!viewerFullscreen && !pendingComment && !activeCommentId) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    if (viewerFullscreen) {
      document.body.style.overflow = "hidden";
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (pendingComment) {
        setPendingComment(null);
        setCommentDraft("");
        setCommentError(null);
        return;
      }

      if (activeCommentId) {
        setActiveCommentId(null);
        return;
      }

      setViewerFullscreen(false);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (viewerFullscreen) {
        document.body.style.overflow = previousOverflow;
      }

      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCommentId, pendingComment, viewerFullscreen]);

  function applyUpdatedCollaborators(updatedCollaborators: ProjectCollaboratorRecord[]) {
    setCollaborators((current) => {
      const owner = current.find((collaborator) => collaborator.access === "owner");
      return owner ? [owner, ...updatedCollaborators] : updatedCollaborators;
    });
  }

  async function removeCollaborator(id: string) {
    setCollaboratorSaving(true);

    try {
      const result = await removeProjectCollaboratorAction(project.id, id);

      if ("error" in result) {
        throw new Error(result.error);
      }

      applyUpdatedCollaborators(result.collaborators);
    } finally {
      setCollaboratorSaving(false);
    }
  }

  async function handleCollaboratorChatVisibilityToggle(
    collaboratorId: string,
    paused: boolean,
  ) {
    setCollaboratorSaving(true);

    try {
      const result = await setProjectCollaboratorChatVisibilityAction({
        projectId: project.id,
        collaboratorId,
        paused,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      applyUpdatedCollaborators(result.collaborators);
    } finally {
      setCollaboratorSaving(false);
    }
  }

  function updateComparisonSelection(kind: "base" | "compare", nextAttachmentId: string) {
    if (!baseSubmission || !compareSubmission) {
      return;
    }

    let nextBaseAttachmentId = baseSubmission.id;
    let nextCompareAttachmentId = compareSubmission.id;

    if (kind === "base") {
      nextBaseAttachmentId = nextAttachmentId;

      if (nextCompareAttachmentId === nextAttachmentId) {
        nextCompareAttachmentId =
          getFallbackComparisonId(submissions, nextAttachmentId, baseSubmission.id) ??
          nextCompareAttachmentId;
      }
    } else {
      nextCompareAttachmentId = nextAttachmentId;

      if (nextBaseAttachmentId === nextAttachmentId) {
        nextBaseAttachmentId =
          getFallbackComparisonId(submissions, nextAttachmentId, compareSubmission.id) ??
          nextBaseAttachmentId;
      }
    }

    if (
      !nextBaseAttachmentId ||
      !nextCompareAttachmentId ||
      nextBaseAttachmentId === nextCompareAttachmentId
    ) {
      return;
    }

    startSelectionTransition(() => {
      router.replace(
        buildCompareHref(
          project.id,
          stageId,
          nextBaseAttachmentId,
          nextCompareAttachmentId,
          conceptMode?.compareHref,
        ),
        { scroll: false },
      );
    });
  }

  async function handleSaveComment() {
    if (!baseSubmission || !compareSubmission || !pendingComment) {
      return;
    }

    const body = commentDraft.trim();

    if (!body) {
      setCommentError("Enter a caption before sending.");
      return;
    }

    if (!stageId) {
      setCommentError("This stage could not be resolved for captions.");
      return;
    }

    setCommentError(null);
    setIsSavingComment(true);

    try {
      const result = await createComparisonCommentAction({
        projectId: project.id,
        stageId,
        baseAttachmentId: baseSubmission.id,
        compareAttachmentId: compareSubmission.id,
        xPercent: pendingComment.xPercent,
        yPercent: pendingComment.yPercent,
        body,
        opacity,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      setComments((current) => [...current, result.comment]);
      setActiveCommentId(result.comment.id);
      setCaptionsPanelOpen(true);
      setPendingComment(null);
      setCommentDraft("");
      router.refresh();
    } catch (error) {
      setCommentError(
        error instanceof Error
          ? error.message
          : "Unable to save the caption right now.",
      );
    } finally {
      setIsSavingComment(false);
    }
  }

  function selectComparisonComment(commentId: string) {
    setPendingComment(null);
    setCommentDraft("");
    setCommentError(null);
    setActiveCommentId(commentId);
  }

  function openCaptionDialog(attachment: CaptionDialogAttachment) {
    setCaptionDialogAttachment(attachment);
  }

  const hasEnoughSubmissions = submissions.length >= 2;
  const insufficientSubmissionMessage =
    submissions.length === 0
      ? "No supported image stage submissions available for comparison."
      : submissions.length === 1
        ? "Upload another valid submission to compare changes."
        : null;
  const comparisonSelectionControls = hasEnoughSubmissions ? (
    <>
      <ComparisonSelector
        label="Base"
        submission={baseSubmission}
        submissions={submissions}
        disabled={isSelectionPending}
        onValueChange={(value) => updateComparisonSelection("base", value)}
      />
      <ComparisonSelector
        label="Compare"
        submission={compareSubmission}
        submissions={submissions}
        disabled={isSelectionPending}
        onValueChange={(value) => updateComparisonSelection("compare", value)}
      />
    </>
  ) : null;

  return (
    <section className="mx-auto w-full min-w-0 max-w-[1600px] space-y-3">
      <ProjectAccessRealtimeGuard projectId={project.id} currentUserId={currentUserId} />
      <div
        className={`grid min-w-0 gap-4 ${
          conceptMode ? "" : "2xl:grid-cols-[minmax(0,1fr)_288px]"
        }`}
      >
        <div className="min-w-0 space-y-2.5">
          <header className="min-w-0 px-0.5">
            <p className="truncate text-[11px] font-[650] leading-4 text-[#69736b]">
              Project: <span className="text-[#29332c]">{project.title}</span>
              {conceptMode ? (
                <>
                  <span className="px-1.5 text-[#a0a8a1]">•</span>
                  Concept: <span className="text-[#29332c]">{conceptMode.conceptName}</span>
                  <span className="px-1.5 text-[#a0a8a1]">•</span>
                  Executor:{" "}
                  <span className="text-[#29332c]">
                    {conceptMode.assignedExecutor?.name?.trim() ||
                      conceptMode.assignedExecutor?.email ||
                      "Not assigned"}
                  </span>
                </>
              ) : null}
              <span className="px-1.5 text-[#a0a8a1]">•</span>
              {submissions.length} submissions
            </p>
          </header>

          {!hasEnoughSubmissions ? (
            <Card className="rounded-[20px] border border-dashed border-[#d7e3d8] bg-white p-6 text-center shadow-[0_12px_28px_rgba(19,28,22,0.04)]">
              <CardTitle className="text-[20px] font-semibold tracking-tight text-[#111712]">
                {insufficientSubmissionMessage}
              </CardTitle>
              <p className="mt-2 text-[13px] text-[#6f786f]">
                {stageSubmissionCaptionHelpText}
              </p>
            </Card>
          ) : null}

          {hasEnoughSubmissions && baseSubmission && compareSubmission ? (
            <div className={`grid min-h-0 min-w-0 gap-2.5 ${
              captionsPanelOpen ? "xl:grid-cols-[minmax(0,1fr)_300px]" : ""
            }`}>
              <ComparisonViewerSurface
                baseSubmission={baseSubmission}
                compareSubmission={compareSubmission}
                comments={comments}
                opacity={opacity}
                onOpacityChange={setOpacity}
                activeCommentId={activeCommentId}
                onActiveCommentChange={setActiveCommentId}
                pendingComment={pendingComment}
                commentDraft={commentDraft}
                onCommentDraftChange={setCommentDraft}
                onSaveComment={handleSaveComment}
                onCancelComment={() => {
                  setPendingComment(null);
                  setCommentDraft("");
                  setCommentError(null);
                }}
                onCreatePendingComment={setPendingComment}
                isSavingComment={isSavingComment}
                commentError={commentError}
                onBaseImageLoad={setBaseImageDimensions}
                onCompareImageLoad={setCompareImageDimensions}
                comparisonAspectRatio={comparisonAspectRatio}
                onToggleFullscreen={() => setViewerFullscreen(true)}
                commentsVisible={commentsVisible}
                onToggleCommentsVisible={() => setCommentsVisible((current) => !current)}
                canAddCaptions={canAddCaptions}
                toolMode={toolMode}
                onToolModeChange={setToolMode}
                selectionControls={comparisonSelectionControls}
                isSelectionPending={isSelectionPending}
                captionsPanelOpen={captionsPanelOpen}
                onToggleCaptionsPanel={() => setCaptionsPanelOpen((current) => !current)}
              />

              {captionsPanelOpen ? (
                <ComparisonCommentsPanel
                  comments={comments}
                  activeCommentId={activeCommentId}
                  onSelectComment={selectComparisonComment}
                  canAddCaptions={canAddCaptions}
                  onAddCaption={() => setToolMode("comment")}
                  captionModeActive={toolMode === "comment"}
                />
              ) : null}
            </div>
          ) : null}

          {submissions.length > 0 ? (
            <Card className="min-w-0 rounded-[20px] border border-[#dbe4dc] bg-white p-4 shadow-[0_10px_24px_rgba(18,35,23,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-[18px] font-semibold tracking-tight text-[#182019]">Available Submissions</CardTitle>
                <span className="text-[11px] font-[700] text-[#7a847c]">{submissions.length} total</span>
              </div>
              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                {submissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="flex min-w-0 flex-col gap-3 rounded-[15px] border border-[#e1e8e2] bg-[#fbfcfb] p-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <AssetImageThumbnail
                        fileName={submission.originalFileName}
                        mimeType={submission.mimeType}
                        previewPath={submission.previewPath}
                        downloadPath={submission.downloadPath}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-[#edf7ef] px-2 py-0.5 text-[9px] font-[800] uppercase tracking-[0.07em] leading-none text-[#2b8b56]">
                            {formatSubmissionLabel(submission)}
                          </span>
                          {submission.id === baseSubmission?.id ? <span className="text-[9px] font-[800] uppercase text-[#285f40]">Base</span> : null}
                          {submission.id === compareSubmission?.id ? <span className="text-[9px] font-[800] uppercase text-[#2c8b58]">Compare</span> : null}
                        </div>
                        <p className="mt-1 truncate text-[12px] font-[700] text-[#111712]">
                          {submission.originalFileName}
                        </p>
                        <p className="mt-0.5 min-w-0 whitespace-normal break-words text-[10px] text-[#687169]">
                          {submission.uploadedBy} · {submission.uploadedAt}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <AssetPreviewButton
                        fileName={submission.originalFileName}
                        mimeType={submission.mimeType}
                        previewPath={submission.previewPath}
                        downloadPath={submission.downloadPath}
                        triggerClassName="h-8 rounded-[9px] border border-[#d6dfd7] px-2.5 text-[11px] text-brand hover:bg-[#f5f8f5]"
                        iconOnly={false}
                      />
                      <Button
                        asChild
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-[9px] px-2.5 text-[11px]"
                      >
                        <a
                          href={submission.downloadPath}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Download ${submission.originalFileName}`}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </a>
                      </Button>
                      {canAddCaptions &&
                      isCaptionableStageSubmissionAttachment(
                        submission,
                        project.category,
                      ) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-8 rounded-[9px] px-2.5 text-[11px]"
                          onClick={() => openCaptionDialog(submission)}
                        >
                          <MessageSquarePlus className="h-4 w-4" />
                          Captions
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        {!conceptMode ? <div className="space-y-4">
          <Card className="rounded-[20px] border border-brand/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-[20px] font-semibold tracking-tight text-brand">Stage Overview</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="space-y-1.5 text-[13px] text-[#242b26]">
                <div>
                  <dt className="inline font-semibold">Execution Type :</dt>{" "}
                  <dd className="inline">{project.executionTypeLabel}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Budget :</dt>{" "}
                  <dd className="inline">{activeStage?.budget ?? project.budget}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Revisions :</dt>{" "}
                  <dd className="inline">
                    {history.entries.filter((entry) => entry.kind === "revision").length}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Stage Started :</dt>{" "}
                  <dd className="inline">{activeStage?.plannedStartAt ?? project.startDate}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Stage Deadline :</dt>{" "}
                  <dd className="inline">{activeStage?.plannedDueAt ?? project.endDate}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {project.canViewParticipants ? (
            <ProjectCollaboratorsPanel
              collaborators={collaborators}
              currentUserId={currentUserId}
              onRemove={
                canManageCollaborators ? (collaboratorId) => removeCollaborator(collaboratorId) : undefined
              }
              onToggleChatVisibility={
                canManageChatVisibility
                  ? (collaboratorId, paused) =>
                      handleCollaboratorChatVisibilityToggle(collaboratorId, paused)
                  : undefined
              }
              saving={collaboratorSaving}
            />
          ) : null}
        </div> : null}
      </div>

      {viewerFullscreen && hasEnoughSubmissions && baseSubmission && compareSubmission ? (
        <div className="fixed inset-0 z-[100] bg-[#f3f5f1]">
          <div className="h-[100dvh] min-h-0 overflow-y-auto bg-[#f3f5f1] p-2 lg:overflow-hidden">
            <h1 className="sr-only">Compare Submissions</h1>
            <div className={`grid h-full min-h-0 gap-2 ${
              captionsPanelOpen ? "lg:grid-cols-[minmax(0,1fr)_300px]" : ""
            }`}>
                <ComparisonViewerSurface
                  baseSubmission={baseSubmission}
                  compareSubmission={compareSubmission}
                  comments={comments}
                  opacity={opacity}
                  onOpacityChange={setOpacity}
                  activeCommentId={activeCommentId}
                  onActiveCommentChange={setActiveCommentId}
                  pendingComment={pendingComment}
                  commentDraft={commentDraft}
                  onCommentDraftChange={setCommentDraft}
                  onSaveComment={handleSaveComment}
                  onCancelComment={() => {
                    setPendingComment(null);
                    setCommentDraft("");
                    setCommentError(null);
                  }}
                  onCreatePendingComment={setPendingComment}
                  isSavingComment={isSavingComment}
                  commentError={commentError}
                  onBaseImageLoad={setBaseImageDimensions}
                  onCompareImageLoad={setCompareImageDimensions}
                  comparisonAspectRatio={comparisonAspectRatio}
                  onToggleFullscreen={() => setViewerFullscreen(false)}
                  commentsVisible={commentsVisible}
                  onToggleCommentsVisible={() => setCommentsVisible((current) => !current)}
                  canAddCaptions={canAddCaptions}
                  toolMode={toolMode}
                  onToolModeChange={setToolMode}
                  selectionControls={comparisonSelectionControls}
                  isSelectionPending={isSelectionPending}
                  captionsPanelOpen={captionsPanelOpen}
                  onToggleCaptionsPanel={() => setCaptionsPanelOpen((current) => !current)}
                  fullscreenMode
                />

                {captionsPanelOpen ? (
                  <ComparisonCommentsPanel
                    comments={comments}
                    activeCommentId={activeCommentId}
                    onSelectComment={selectComparisonComment}
                    canAddCaptions={canAddCaptions}
                    onAddCaption={() => setToolMode("comment")}
                    captionModeActive={toolMode === "comment"}
                    fullscreenMode
                  />
                ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <SubmissionCaptionDialog
        open={Boolean(captionDialogAttachment)}
        attachment={captionDialogAttachment}
        onClose={() => setCaptionDialogAttachment(null)}
        onCaptionCreated={() => router.refresh()}
      />
    </section>
  );
}

"use client";

import { FileThumbnail, canShowImageThumbnail } from "@/components/projects/file-thumbnail";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { flushSync } from "react-dom";
import { useDropzone, type Accept } from "react-dropzone";
import {
  CheckCircle2,
  ArrowLeft,
  Download,
  FileText,
  GitCompare,
  Info,
  Languages,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Mic,
  MoreVertical,
  Paperclip,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  acceptStageBriefAction,
  cancelStageRevisionSubmissionAction,
  cancelStagedConceptRevisionAttachmentsAction,
  completeProjectArchiveAction,
  createStageRevisionAction,
  deleteStageCommentAction,
  markSubmissionCompleteAction,
  markStageCompleteAction,
  prepareProjectCompletionAction,
  removeProjectCollaboratorAction,
  requestStageInvoiceAction,
  requestSubmissionRevisionAction,
  saveProjectCollaboratorsAction,
  setProjectCollaboratorChatVisibilityAction,
} from "@/app/(dashboard)/projects/actions";
import {
  importStageThreeConceptReferenceAction,
  markProjectConceptApprovedAttachmentAction,
  markStageFourFinalApprovedAttachmentAction,
  revokeProjectConceptApprovedAttachmentAction,
  revokeStageFourFinalApprovedAttachmentAction,
} from "@/app/(dashboard)/projects/[slug]/stages/concept-actions";
import { saveCollaboratorAction } from "@/app/(dashboard)/collaboration/actions";
import {
  DEFAULT_CHAT_LANGUAGE,
  SUPPORTED_CHAT_LANGUAGES,
  getSupportedLanguageByCode,
} from "@/lib/ai/languages";
import {
  getStageSubmissionAttachments,
  isCaptionableStageSubmissionAttachment,
} from "@/lib/comparison-utils";
import {
  AssetImageThumbnail,
  AssetPreviewButton,
} from "@/components/projects/asset-preview-button";
import { AttachmentFavoriteButton } from "@/components/projects/attachment-favorite-button";
import { ChatLanguagePicker } from "@/components/projects/chat-language-picker";
import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import {
  CompletedProjectArchiveSummaryCard,
  ProjectCompletionChecklist,
} from "@/components/projects/project-completion-checklist";
import {
  ArchiveMetadataIdentificationStep,
  ArchiveMetadataReviewList,
  ArchiveMetadataTechnicalStep,
} from "@/components/archives/archive-artwork-metadata-form";
import {
  archiveProjectWizardSteps as archiveWizardSteps,
  getArchiveArtworkMetadataMissingGroups as getArchiveMetadataMissingGroups,
  type ArchiveArtworkMetadataDraft,
} from "@/lib/archive-artwork-metadata";
import {
  CollaboratorDialog,
  type CollaboratorForm,
} from "@/components/collaboration/collaborator-dialog";
import { CollaboratorPickerDialog } from "@/components/collaboration/collaborator-picker-dialog";
import {
  ProjectCollaboratorsPanel,
  ProjectExecutorsPanel,
} from "@/components/projects/project-collaborators-panel";
import { ConceptDeadlineTimer } from "@/components/projects/concept-deadline-timer";
import { StageTimeRemainingCard } from "@/components/projects/stage-time-remaining-card";
import {
  SubmissionCaptionDialog,
  type CaptionDialogAttachment,
} from "@/components/projects/submission-caption-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useStageChatRealtime } from "@/hooks/use-stage-chat-realtime";
import type {
  ProjectArchivePreparation,
  ProjectCompletionSummary,
} from "@/lib/archives";
import type { ProjectCompletionWorkflowRecord } from "@/lib/project-completion";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import type { StageHistoryRecord } from "@/lib/project-history";
import { RequestConceptCompletionButton } from "@/components/projects/request-concept-completion-button";
import { CompleteConceptTaskButton } from "@/components/projects/complete-concept-task-button";
import { RevokeTaskCompletionButton } from "@/components/projects/revoke-task-completion-button";
import type { ProjectConceptChatMode } from "@/lib/project-concepts";
import type {
  StageChatRealtimeMessageCreatedPayload,
  StageChatRealtimeMessageDeletedPayload,
  StageChatRealtimeMessageFailedPayload,
  StageChatRealtimeMessagePendingPayload,
  StageChatRealtimeTimelineUpdatedPayload,
  StageChatRealtimeUpdatesResponse,
} from "@/lib/realtime/events";
import type {
  ProjectAttachmentRecord,
  ProjectChatEntry,
  ProjectCollaboratorRecord,
  ProjectFlowRecord,
  ProjectMentionParticipantRecord,
  ProjectStageRecord,
} from "@/lib/projects";
import type { CollaboratorRecord } from "@/lib/collaboration";
import { normalizeProjectCollaboratorPermissions } from "@/lib/project-collaborator-permissions";
import {
  buildFileTypeNotAllowedPayload,
  formatUploadFileTypeError,
  getAllowedFormatLabels,
  getStageSubmissionAllowedExtensions,
  getUploadErrorMessage,
  isAllowedStageSubmissionFile,
  STAGE_SUBMISSION_ALLOWED_EXTENSIONS,
  type UploadFileTypeErrorPayload,
} from "@/lib/upload-validation";

type ProjectChatWorkspaceProps = {
  project: ProjectFlowRecord;
  stageId?: string | null;
  history: StageHistoryRecord;
  availableCollaborators: CollaboratorRecord[];
  currentUserId: string;
  currentUserAvatarSrc?: string | null;
  canManageCollaborators: boolean;
  canManageChatVisibility: boolean;
  canViewCompareSubmissions: boolean;
  canAddCaptions: boolean;
  completionSummary: ProjectCompletionSummary;
  completionWorkflow: ProjectCompletionWorkflowRecord | null;
  deferCompletionData?: boolean;
  conceptMode?: ProjectConceptChatMode;
};

type PendingFile = {
  id: string;
  file: File;
  assetType?: UploadAssetType;
};

type UploadProgressState = "pending" | "uploading" | "uploaded" | "error";
type OptimisticMessageStatus = "sending" | "uploading" | "failed";

type DisplayAttachmentRecord = ProjectAttachmentRecord & {
  localFile?: File;
  uploadState?: UploadProgressState;
  progress?: number;
  errorMessage?: string;
};

type DisplayChatEntry = ProjectChatEntry & {
  attachments?: DisplayAttachmentRecord[];
  isOptimistic?: boolean;
  optimisticStatus?: OptimisticMessageStatus;
  localCreatedAtMs?: number;
  serverEntryId?: string;
};

function isInvoiceUploadedEntry(entry: ProjectChatEntry) {
  return (
    entry.kind === "system" &&
    (entry.title === "Invoice uploaded" ||
      entry.body.toLowerCase().includes("uploaded invoice for"))
  );
}

function isConceptIrrelevantSystemEntry(entry: ProjectChatEntry) {
  if (entry.kind !== "system") {
    return false;
  }

  const text = `${entry.title ?? ""} ${entry.body}`.toLowerCase();

  return [
    "invoice requested",
    "invoice uploaded",
    "project completion",
    "authority approval",
    "copyright transfer",
    "archive preparation",
    "project archived",
    "stage completed",
    "next stage",
  ].some((phrase) => text.includes(phrase));
}

type DeletedMessageOverride = {
  deletedAt: string;
  deletedByUserId: string | null;
  displayText: string;
};

type StageChatMessagesApiResponse =
  | {
      activeStageId: string | null;
      latestRevisionId: string | null;
      entries: ProjectChatEntry[];
      revisionCount?: number;
      nextCursor: string | null;
      hasMore: boolean;
    }
  | {
      error: string;
    };

type StageChatUpdatesApiResponse =
  | StageChatRealtimeUpdatesResponse
  | {
      error: string;
    };

type ProjectCompletionApiResponse =
  | {
      completionSummary: ProjectCompletionSummary;
      completionWorkflow: ProjectCompletionWorkflowRecord | null;
    }
  | {
      error: string;
    };

type AvailableCollaboratorsApiResponse =
  | {
      collaborators: CollaboratorRecord[];
    }
  | {
      error: string;
    };

type CreateStageCommentApiResponse =
  | {
      commentId: string;
      revisionId: string | null;
      createdAt: string;
      mentionedUserIds: string[];
      clientTempId?: string | null;
      entry?: ProjectChatEntry;
    }
  | {
      error: string;
    };

const PROJECT_ASSET_INLINE_LIMIT = 4;
const STAGE_CHAT_MESSAGE_DELETE_WINDOW_MS = 5 * 60 * 1000;
const STAGE_CHAT_PENDING_TIMEOUT_MS = 60 * 1000;
const DELETED_STAGE_CHAT_MESSAGE_TEXT = "This message was deleted";
const UPLOAD_NAVIGATION_WARNING =
  "Your upload is still running. Stay on this page until it finishes, or leave and the upload may not complete.";
const UPLOAD_NAVIGATION_HISTORY_GUARD_KEY = "__gtiUploadNavigationGuard";

type MentionToken = {
  userId: string;
  name: string;
};

type MentionDropdownState = {
  start: number;
  end: number;
  query: string;
};

type RevisionReviewState = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

type RevisionReplyTarget = {
  revisionId: string;
  label: string;
};

const defaultPendingRevisionReviewMessage =
  "A revision is already pending review. Please wait for the project owner to review it.";

type TranslateApiResponse = {
  sourceLanguageCode: string;
  sourceLanguageName: string;
  targetLanguageCode: string;
  translatedText: string;
  error?: string;
};

type TranslateBatchApiResponse = {
  translations?: Array<{
    id: string;
    sourceLanguageCode: string;
    sourceLanguageName: string;
    targetLanguageCode: string;
    translatedText: string;
  }>;
  error?: string;
};

type StageChatTranslation = {
  targetLanguageCode: string;
  translatedText: string;
};

type StageChatTranslationSegment = {
  id: string;
  text: string;
};

type TranscribeApiResponse = {
  detectedSourceLanguage: string;
  detectedSourceLanguageCode: string;
  transcriptOriginal: string;
  translatedText: string;
  targetLanguageCode: string;
  error?: string;
};

type UploadAssetType =
  | "REVISION_ORIGINAL"
  | "COMMENT_ATTACHMENT"
  | "STAGE_SUBMISSION"
  | "STAGE_INVOICE";
type CommentUploadIntent = "COMMENT_ATTACHMENT" | "STAGE_SUBMISSION";
const MAX_RECORDING_DURATION_MS = 60_000;
const AUTO_TRANSLATE_DEBOUNCE_MS = 650;
const STAGE_SUBMISSION_ACCEPT = STAGE_SUBMISSION_ALLOWED_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");
const STAGE_SUBMISSION_FORMAT_LABEL = getAllowedFormatLabels(
  STAGE_SUBMISSION_ALLOWED_EXTENSIONS,
).join(", ");

function getSubmissionDropzoneAccept(): Accept {
  return {
    "application/octet-stream": STAGE_SUBMISSION_ALLOWED_EXTENSIONS.map(
      (extension) => `.${extension}`,
    ),
  };
}

const fileTypeStyles: Record<string, string> = {
  AI: "bg-[#2d1207] text-[#ff9d12]",
  PSD: "bg-[#042a4c] text-[#57b2ff]",
  PDF: "bg-[#fff6f4] text-[#d94a41] border border-[#f2d7d3]",
  FIG: "bg-[#f8fbf8] text-[#657268] border border-[#dde6de]",
  ZIP: "bg-[#f4fbf5] text-[#4a9454] border border-[#dbe8dd]",
};

function getFileBadgeClass(label: string) {
  return fileTypeStyles[label] ?? "bg-[#f8fbf8] text-brand border border-[#dde6de]";
}

type UploadIntentDropzoneProps = {
  intent: CommentUploadIntent;
  projectCategory?: string | null;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  onError: (message: string) => void;
};

function UploadIntentDropzone({
  intent,
  projectCategory,
  disabled = false,
  onFilesSelected,
  onError,
}: UploadIntentDropzoneProps) {
  const dropzoneAccept =
    intent === "STAGE_SUBMISSION"
      ? getSubmissionDropzoneAccept()
      : undefined;

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    multiple: true,
    disabled,
    noClick: true,
    noKeyboard: true,
    accept: dropzoneAccept,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles);
      }
    },
    onDropRejected: (fileRejections) => {
      if (intent === "STAGE_SUBMISSION") {
        const rejectedFile = fileRejections[0]?.file;

        onError(
          formatUploadFileTypeError(
            buildFileTypeNotAllowedPayload({
              fileName: rejectedFile?.name ?? "Selected file",
              mimeType: rejectedFile?.type || "application/octet-stream",
              allowedExtensions: getStageSubmissionAllowedExtensions(projectCategory),
              error: "Formal stage submissions must use a supported file format.",
            }),
          ),
        );
        return;
      }

      onError("Unable to add one or more selected files. Please try different files.");
    },
  });

  return (
    <div
      {...getRootProps()}
      className={`min-h-[112px] rounded-[18px] border border-dashed px-4 py-6 text-left transition ${
        isDragActive
          ? "border-brand bg-[#eef7ef]"
          : "border-[#bfcbbf] bg-[#fbfdfb] hover:border-brand hover:bg-[#f4fbf5]"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input {...getInputProps()} />

      <Upload className="h-5 w-5 text-brand" />

      <p className="mt-3 text-[14px] font-semibold text-brand">
        {isDragActive ? "Drop files here" : "Drag files here"}
      </p>

      <p className="mt-1 text-[11px] text-[#7a837b]">
        {intent === "STAGE_SUBMISSION"
          ? `Supported: ${STAGE_SUBMISSION_FORMAT_LABEL}.`
          : "Choose one or more files to attach to the chat discussion."}
      </p>

      <Button
        type="button"
        size="sm"
        className="mt-4 rounded-full text-[12px]"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          open();
        }}
      >
        Choose files
      </Button>
    </div>
  );
}
function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ChatAvatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClassName =
    size === "sm" ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-[10px]";

  if (src && !imageFailed) {
    return (
      <div
        className={`grid ${sizeClassName} shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(145deg,#f0dcc4,#b58257)] font-semibold text-white`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${name} avatar`}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`grid ${sizeClassName} shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#f0dcc4,#b58257)] font-semibold text-white`}
    >
      {getInitials(name)}
    </div>
  );
}

function escapeMentionPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMentionTriggerState(
  value: string,
  caretPosition: number,
): MentionDropdownState | null {
  if (caretPosition < 0 || caretPosition > value.length) {
    return null;
  }

  const textBeforeCaret = value.slice(0, caretPosition);
  const mentionStart = textBeforeCaret.lastIndexOf("@");

  if (mentionStart < 0) {
    return null;
  }

  const previousCharacter = value[mentionStart - 1];

  if (previousCharacter && !/\s/.test(previousCharacter)) {
    return null;
  }

  const query = value.slice(mentionStart + 1, caretPosition);

  if (/\s/.test(query)) {
    return null;
  }

  return {
    start: mentionStart,
    end: caretPosition,
    query,
  };
}

function resolveCommentMentionUserIds(
  body: string,
  mentions: MentionToken[],
) {
  return Array.from(
    new Set(
      mentions
        .filter((mention) =>
          new RegExp(
            `(^|\\s)@${escapeMentionPattern(mention.name)}(?=[\\s.,!?;:)]|$)`,
            "u",
          ).test(body),
        )
        .map((mention) => mention.userId),
    ),
  );
}

function renderCommentBodyWithMentions(
  body: string,
  mentions?: MentionToken[],
): ReactNode {
  if (!mentions?.length) {
    return body;
  }

  const orderedMentions = [...mentions].sort((left, right) => right.name.length - left.name.length);
  const pattern = new RegExp(
    orderedMentions
      .map((mention) => `@${escapeMentionPattern(mention.name)}`)
      .join("|"),
    "gu",
  );
  const segments: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    const matchedText = match[0];

    if (matchIndex > lastIndex) {
      segments.push(body.slice(lastIndex, matchIndex));
    }

    segments.push(
      <span
        key={`${matchedText}-${matchIndex}`}
        className="inline-block rounded-full bg-[#edf7ef] px-2 py-0.5 font-semibold leading-[1.55] text-[#2b8b56]"
      >
        {matchedText}
      </span>,
    );

    lastIndex = matchIndex + matchedText.length;
  }

  if (segments.length === 0) {
    return body;
  }

  if (lastIndex < body.length) {
    segments.push(body.slice(lastIndex));
  }

  return segments;
}

function buildStageChatTranslationSegmentId(entryId: string, field: string) {
  return `${entryId}:${field}`;
}

function normalizeStageChatTranslationSource(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function buildStageChatTranslationSegment(
  entryId: string,
  field: string,
  text: string | null | undefined,
): StageChatTranslationSegment | null {
  const normalizedText = normalizeStageChatTranslationSource(text);

  if (!normalizedText) {
    return null;
  }

  return {
    id: buildStageChatTranslationSegmentId(entryId, field),
    text: normalizedText,
  };
}

function isLegacyBriefContextMessage(entry: Pick<DisplayChatEntry, "kind" | "body">) {
  if (entry.kind !== "comment") {
    return false;
  }

  const normalizedBody = entry.body.trim().toLowerCase();

  return (
    normalizedBody.startsWith("project brief:") &&
    normalizedBody.includes("stage brief:")
  );
}

function getLocalFileTypeLabel(fileName: string) {
  const extension = fileName.split(".").pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
}

function getLocalFileExtension(fileName: string) {
  const parts = fileName.split(".");

  if (parts.length < 2) {
    return "";
  }

  return parts.at(-1)?.toLowerCase() ?? "";
}

function formatLocalStageDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function getTimelineEntryCreatedAtMs(entry: DisplayChatEntry) {
  if (typeof entry.localCreatedAtMs === "number") {
    return entry.localCreatedAtMs;
  }

  const timestamp = new Date(entry.createdAtValue ?? entry.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatLocalFileSize(fileSize: number) {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (fileSize >= 1024) {
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }

  return `${fileSize} B`;
}

function getUploadNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function getLocalDeleteExpiresAt(createdAtMs: number) {
  return new Date(createdAtMs + STAGE_CHAT_MESSAGE_DELETE_WINDOW_MS).toISOString();
}

function hasPendingAttachmentUpload(message: DisplayChatEntry) {
  const attachments = message.attachments as DisplayAttachmentRecord[] | undefined;

  return (
    attachments?.some(
      (attachment) =>
        attachment.uploadState === "pending" ||
        attachment.uploadState === "uploading",
    ) ?? false
  );
}

function hasInFlightAttachmentUpload(message: DisplayChatEntry) {
  return (
    message.isOptimistic === true &&
    Boolean(message.attachments?.length) &&
    message.optimisticStatus !== "failed" &&
    (message.optimisticStatus === "uploading" ||
      message.optimisticStatus === "sending" ||
      hasPendingAttachmentUpload(message))
  );
}

function hasFailedAttachmentUpload(message: DisplayChatEntry) {
  const attachments = message.attachments as DisplayAttachmentRecord[] | undefined;

  return (
    attachments?.some((attachment) => attachment.uploadState === "error") ?? false
  );
}

type PendingUploadNavigation =
  | {
      kind: "href";
      href: string;
    }
  | {
      kind: "history";
      stepsBack: number;
    };

function useUploadNavigationGuard(enabled: boolean) {
  const router = useRouter();
  const enabledRef = useRef(enabled);
  const currentUrlRef = useRef<string | null>(null);
  const historyGuardIdRef = useRef<string | null>(null);
  const historyGuardActiveRef = useRef(false);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingUploadNavigation | null>(null);

  const pushHistoryGuard = useCallback(() => {
    const currentUrl = currentUrlRef.current ?? window.location.href;
    const currentState = window.history.state;
    const baseState =
      typeof currentState === "object" && currentState !== null
        ? currentState
        : {};
    const guardId = historyGuardIdRef.current ?? crypto.randomUUID();

    historyGuardIdRef.current = guardId;
    window.history.pushState(
      {
        ...baseState,
        [UPLOAD_NAVIGATION_HISTORY_GUARD_KEY]: guardId,
      },
      "",
      currentUrl,
    );
    historyGuardActiveRef.current = true;
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    currentUrlRef.current = window.location.href;

    if (!enabled) {
      const clearPendingNavigationTimer = window.setTimeout(() => {
        setPendingNavigation(null);

        if (historyGuardActiveRef.current) {
          historyGuardActiveRef.current = false;
          window.history.back();
        }
      }, 0);

      return () => window.clearTimeout(clearPendingNavigationTimer);
    }

    if (!historyGuardActiveRef.current) {
      pushHistoryGuard();
    }
  }, [enabled, pushHistoryGuard]);

  const cancelNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const confirmNavigation = useCallback(() => {
    const navigation = pendingNavigation;

    if (!navigation) {
      return;
    }

    enabledRef.current = false;
    setPendingNavigation(null);

    if (navigation.kind === "history") {
      historyGuardActiveRef.current = false;
      window.history.go(-navigation.stepsBack);
      return;
    }

    const nextUrl = new URL(navigation.href, window.location.href);

    if (nextUrl.origin === window.location.origin) {
      router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      return;
    }

    window.location.assign(nextUrl.href);
  }, [pendingNavigation, router]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function shouldConfirmNavigation() {
      return enabledRef.current;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!shouldConfirmNavigation()) {
        return;
      }

      event.preventDefault();
      event.returnValue = UPLOAD_NAVIGATION_WARNING;
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        !shouldConfirmNavigation() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }

      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest("a[href]");

      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);

      if (nextUrl.href === window.location.href) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPendingNavigation({
        kind: "href",
        href: nextUrl.href,
      });
    }

    function handlePopState(event: PopStateEvent) {
      if (!shouldConfirmNavigation()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const currentUrl = currentUrlRef.current;

      if (currentUrl) {
        pushHistoryGuard();
      }

      setPendingNavigation({
        kind: "history",
        stepsBack: 2,
      });
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState, true);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState, true);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [enabled, pushHistoryGuard]);

  return {
    isNavigationDialogOpen: Boolean(pendingNavigation),
    cancelNavigation,
    confirmNavigation,
  };
}

function getCommentStatusLabel(message: DisplayChatEntry) {
  if (!message.isOptimistic) {
    return message.createdAt;
  }

  if (message.optimisticStatus === "failed" || hasFailedAttachmentUpload(message)) {
    return "Failed";
  }

  if (message.optimisticStatus === "uploading" || hasPendingAttachmentUpload(message)) {
    return "Uploading…";
  }

  if (message.optimisticStatus === "sending") {
    return "Sending…";
  }

  return message.createdAt;
}

function getArchiveFileNameError(
  originalFileName: string,
  nextFileName: string,
  otherFileNames: string[],
) {
  const trimmedName = nextFileName.trim();

  if (!trimmedName) {
    return "Archive file name is required.";
  }

  const originalExtension = getLocalFileExtension(originalFileName);
  const nextExtension = getLocalFileExtension(trimmedName);

  if (originalExtension && nextExtension !== originalExtension) {
    return `Keep the .${originalExtension} extension for this file.`;
  }

  if (!originalExtension && nextExtension) {
    return "Use the original file extension format for this archive file.";
  }

  if (
    otherFileNames.some(
      (candidate) => candidate.trim().toLowerCase() === trimmedName.toLowerCase(),
    )
  ) {
    return "Archive file names must be unique within this project archive.";
  }

  return null;
}

type ArchiveWizardStep = 0 | 1 | 2 | 3;

function uploadFileToS3WithProgress(input: {
  uploadUrl: string;
  file: File;
  fileIndex?: number;
  fileCount?: number;
  assetType: UploadAssetType;
  onProgress?: (progress: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const startedAt = getUploadNow();

    function logS3Put(status: number | string) {
      console.info("upload:s3-put", {
        status,
        durationMs: Math.round(getUploadNow() - startedAt),
        fileSize: input.file.size,
        mimeType: input.file.type || "application/octet-stream",
        assetType: input.assetType,
      });
    }

    request.open("PUT", input.uploadUrl, true);
    request.setRequestHeader(
      "Content-Type",
      input.file.type || "application/octet-stream",
    );

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.round((event.loaded / event.total) * 100);
      input.onProgress?.(progress);
    });

    request.addEventListener("load", () => {
      logS3Put(request.status);

      if (request.status >= 200 && request.status < 300) {
        input.onProgress?.(100);
        resolve();
        return;
      }

      reject(new Error(`Upload failed with status ${request.status}.`));
    });

    request.addEventListener("error", () => {
      logS3Put("network-error");
      reject(new Error("Upload failed due to a network error."));
    });

    request.addEventListener("abort", () => {
      logS3Put("aborted");
      reject(new Error("Upload was cancelled."));
    });

    request.send(input.file);
  });
}

function logUploadHost(uploadUrl: string) {
  try {
    console.info("upload:s3-host", new URL(uploadUrl).host);
  } catch {
    // Keep upload diagnostics best-effort only.
  }
}

function getRevisionEntryId(
  entry: Pick<DisplayChatEntry, "id" | "kind" | "revisionId" | "serverEntryId">,
) {
  if (entry.kind !== "revision") {
    return entry.id;
  }

  return entry.revisionId ?? entry.serverEntryId ?? entry.id;
}

function getRevisionLabel(entry: Pick<DisplayChatEntry, "title" | "revisionNumber">) {
  if (entry.revisionNumber) {
    return `Revision ${entry.revisionNumber}`;
  }

  return entry.title?.trim() || "Revision";
}

function buildComparisonHref(
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

  const basePath = conceptCompareHref ?? `/projects/${projectId}/compare`;
  return `${basePath}?${searchParams.toString()}`;
}

function getRevisionStatusMeta(status: RevisionReviewState) {
  switch (status) {
    case "APPROVED":
      return {
        label: "Approved",
        badgeClassName: "bg-[#edf7ef] text-[#2b8b56]",
      };
    case "REJECTED":
      return {
        label: "Revision Requested",
        badgeClassName: "bg-[#fff0ef] text-[#c14f46]",
      };
    default:
      return {
        label: "Pending Review",
        badgeClassName: "bg-[#fff8eb] text-[#b77420]",
      };
  }
}

type TimelineAlignment = "left" | "right";
type TimelineWidth = "compact" | "medium" | "submission" | "wide";

const timelineWidthClassNames: Record<TimelineWidth, string> = {
  compact: "w-full max-w-[94%] sm:max-w-[72%]",
  medium: "w-full max-w-[96%] sm:max-w-[82%] 2xl:max-w-[76%]",
  submission: "w-full max-w-[96%] sm:max-w-[84%] 2xl:max-w-[760px]",
  wide: "w-full max-w-[98%] sm:max-w-[94%] 2xl:max-w-[88%]",
};

function getTimelineEntryAlignment(
  entry: Pick<DisplayChatEntry, "authorId" | "author">,
  currentUserId: string,
  currentUserDisplayName: string,
): TimelineAlignment {
  if (entry.authorId) {
    return entry.authorId === currentUserId ? "right" : "left";
  }

  return entry.author.trim() === currentUserDisplayName.trim() ? "right" : "left";
}

function normalizeDisplayName(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function isCurrentUserDisplayName(value: string | null | undefined, currentUserDisplayName: string) {
  const normalizedValue = normalizeDisplayName(value);

  return (
    normalizedValue.length > 0 &&
    (normalizedValue === "you" ||
      normalizedValue === normalizeDisplayName(currentUserDisplayName))
  );
}

function getActorDisplayName(value: string | null | undefined, currentUserDisplayName: string) {
  if (!value?.trim()) {
    return "Unknown user";
  }

  return isCurrentUserDisplayName(value, currentUserDisplayName) ? "You" : value.trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceCurrentUserNameInText(
  text: string,
  actorName: string | null | undefined,
  currentUserDisplayName: string,
) {
  const normalizedActorName = actorName?.trim();
  let nextText = text;

  if (currentUserDisplayName.trim() && currentUserDisplayName.trim().toLowerCase() !== "you") {
    nextText = nextText.replace(
      new RegExp(`\\b${escapeRegExp(currentUserDisplayName.trim())}\\b`, "g"),
      "You",
    );
  }

  if (normalizedActorName && isCurrentUserDisplayName(actorName, currentUserDisplayName)) {
    nextText = nextText.replace(
      new RegExp(`\\b${escapeRegExp(normalizedActorName)}\\b`, "g"),
      "You",
    );
  }

  return nextText;
}

function getTimelineActorKey(entry: Pick<DisplayChatEntry, "authorId" | "author">) {
  return entry.authorId ?? entry.author.trim().toLowerCase();
}

function shouldGroupWithPreviousMessage(
  previousMessage: DisplayChatEntry | undefined,
  message: DisplayChatEntry,
) {
  if (
    !previousMessage ||
    previousMessage.kind === "system" ||
    message.kind === "system" ||
    previousMessage.kind === "reference" ||
    message.kind === "reference"
  ) {
    return false;
  }

  return getTimelineActorKey(previousMessage) === getTimelineActorKey(message);
}

function TimelineGutter({
  name,
  src,
  icon,
  hidden = false,
}: {
  name?: string;
  src?: string | null;
  icon?: ReactNode;
  hidden?: boolean;
}) {
  return (
    <div className="flex w-8 shrink-0 justify-center sm:w-9">
      {hidden ? null : icon ? (
        <div className="grid h-8 w-8 place-items-center rounded-full bg-[#e6f2e8] text-brand shadow-[0_8px_18px_rgba(18,35,23,0.08)]">
          {icon}
        </div>
      ) : (
        <ChatAvatar name={name ?? "User"} src={src} size="sm" />
      )}
    </div>
  );
}

function TimelineFrame({
  alignment = "left",
  width = "medium",
  avatarName,
  avatarSrc,
  gutterIcon,
  hideGutterContent = false,
  grouped = false,
  children,
}: {
  alignment?: TimelineAlignment;
  width?: TimelineWidth;
  avatarName?: string;
  avatarSrc?: string | null;
  gutterIcon?: ReactNode;
  hideGutterContent?: boolean;
  grouped?: boolean;
  children: ReactNode;
}) {
  // Keep every shared timeline block visually separate. This wrapper is used by
  // briefs, activity, submissions, revisions, captions, comparisons, and comments
  // across all project stages.
  const verticalSpacing = grouped ? "mb-2" : "mb-3";

  if (alignment === "left") {
    return (
      <div
        className={`grid w-full grid-cols-[2rem_minmax(0,1fr)] items-end gap-2.5 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-3 ${verticalSpacing}`}
      >
        <TimelineGutter
          name={avatarName}
          src={avatarSrc}
          icon={gutterIcon}
          hidden={hideGutterContent}
        />
        <div className={`min-w-0 ${timelineWidthClassNames[width]}`}>{children}</div>
      </div>
    );
  }

  return (
    <div className={`flex w-full justify-end ${verticalSpacing}`}>
      <div className={`min-w-0 ${timelineWidthClassNames[width]}`}>{children}</div>
    </div>
  );
}

function getSystemActivityMeta(message: DisplayChatEntry) {
  const text = `${message.title ?? ""} ${message.body}`.toLowerCase();

  if (
    text.includes("reject") ||
    text.includes("revision requested") ||
    text.includes("failed") ||
    text.includes("cannot")
  ) {
    return {
      label: "Action required",
      Icon: Info,
      cardClassName: "border-[#f0d0cc] bg-[#fff8f6]",
      iconClassName: "bg-[#fff0ef] text-[#c14f46]",
      titleClassName: "text-[#8f3832]",
      bodyClassName: "text-[#5f403c]",
    };
  }

  if (
    text.includes("waiting") ||
    text.includes("pending") ||
    text.includes("not available")
  ) {
    return {
      label: "Waiting",
      Icon: Info,
      cardClassName: "border-[#efd9af] bg-[#fffaf0]",
      iconClassName: "bg-[#fff3d6] text-[#b77420]",
      titleClassName: "text-[#8a5718]",
      bodyClassName: "text-[#5d4a2f]",
    };
  }

  if (
    text.includes("accepted") ||
    text.includes("approved") ||
    text.includes("completed") ||
    text.includes("uploaded") ||
    text.includes("imported") ||
    text.includes("started")
  ) {
    return {
      label: "Workflow update",
      Icon: CheckCircle2,
      cardClassName: "border-[#c8e1ce] bg-[#f4fbf5]",
      iconClassName: "bg-[#e2f4e6] text-brand",
      titleClassName: "text-[#173120]",
      bodyClassName: "text-[#405044]",
    };
  }

  return {
    label: "Project update",
    Icon: Info,
    cardClassName: "border-[#d3e1ea] bg-[#f6fbff]",
    iconClassName: "bg-[#e7f3fb] text-[#3e78a6]",
    titleClassName: "text-[#253d4f]",
    bodyClassName: "text-[#435666]",
  };
}

function SystemActivityCard({
  message,
  alignment = "left",
  action,
  currentUserDisplayName,
  activityLabelOverride,
  titleOverride,
  bodyOverride,
  revisionRequestReasonOverride,
}: {
  message: DisplayChatEntry;
  alignment?: TimelineAlignment;
  action?: ReactNode;
  currentUserDisplayName: string;
  activityLabelOverride?: string | null;
  titleOverride?: string | null;
  bodyOverride?: string | null;
  revisionRequestReasonOverride?: string | null;
}) {
  const meta = getSystemActivityMeta(message);
  const Icon = meta.Icon;
  const isCurrentUserActivity = alignment === "right";
  const displayAuthor = isCurrentUserActivity
    ? "You"
    : getActorDisplayName(message.author, currentUserDisplayName);
  const displayBody =
    bodyOverride ??
    replaceCurrentUserNameInText(
      message.body,
      message.author,
      currentUserDisplayName,
    );
  const displayRevisionRequestReason =
    revisionRequestReasonOverride ?? message.revisionRequestReason;

  return (
    <TimelineFrame
      alignment={alignment}
      width="medium"
      avatarName={message.author}
      avatarSrc={message.authorAvatarSrc}
      gutterIcon={<Icon className="h-4 w-4" />}
    >
      <div
        className={`w-full rounded-[18px] border px-4 py-3 shadow-[0_10px_24px_rgba(23,39,28,0.05)] ${
          alignment === "right" ? "rounded-br-[7px]" : "rounded-bl-[7px]"
        } ${meta.cardClassName}`}
      >
        <div className="flex items-start">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full bg-white/65 px-2.5 py-1 text-[9px] font-[800] uppercase tracking-[0.08em] text-[#657269]">
                {activityLabelOverride ?? meta.label}
              </span>
              <span className="text-[10px] font-semibold text-[#7a837b]">
                {message.createdAt}
              </span>
            </div>
            <p className={`mt-1 text-[13px] font-[800] ${meta.titleClassName}`}>
              {titleOverride ?? message.title ?? "Project activity"}
            </p>
            <p className={`mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 ${meta.bodyClassName}`}>
              {displayBody}
            </p>
            {displayRevisionRequestReason ? (
              <div className={`mt-2 text-[12px] leading-5 ${meta.bodyClassName}`}>
                <p className="font-[800]">Reason:</p>
                <RichTextContent
                  value={displayRevisionRequestReason}
                  className="mt-0.5 break-words"
                />
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-[#6c776e]">
              <span>{displayAuthor}</span>
            </div>
            {action ? <div className="mt-3">{action}</div> : null}
          </div>
        </div>
      </div>
    </TimelineFrame>
  );
}

function ConceptReferenceTimelineCard({
  message,
  currentUserId,
  currentUserDisplayName,
}: {
  message: DisplayChatEntry;
  currentUserId: string;
  currentUserDisplayName: string;
}) {
  const reference = message.reference;

  if (!reference) {
    return null;
  }

  return (
    <SystemActivityCard
      message={message}
      alignment={getTimelineEntryAlignment(
        message,
        currentUserId,
        currentUserDisplayName,
      )}
      currentUserDisplayName={currentUserDisplayName}
      activityLabelOverride="Concept update"
      titleOverride="Starting reference imported"
      action={
        <div className="rounded-[14px] border border-[#cfe3d2] bg-white/75 p-3">
          <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#4f765d]">
            {reference.stageNeutral ? "Approved concept" : "Stage 3"} · {reference.sourceConceptName}
          </p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            {reference.mimeType.startsWith("image/") ? (
              <AssetImageThumbnail
                fileName={reference.fileName}
                mimeType={reference.mimeType}
                previewPath={reference.previewPath}
                downloadPath={reference.downloadPath}
              />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-brand" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] font-[680] text-[#2d3a31]">
              {reference.fileName}
            </span>
            <AssetPreviewButton
              fileName={reference.fileName}
              mimeType={reference.mimeType}
              previewPath={reference.previewPath}
              downloadPath={reference.downloadPath}
              triggerClassName="size-8 rounded-full text-brand"
            />
            <Button asChild variant="ghost" size="icon" className="size-8 rounded-full text-brand">
              <a
                href={reference.downloadPath}
                target="_blank"
                rel="noreferrer"
                aria-label={`Download ${reference.fileName}`}
              >
                <Download className="h-4 w-4" />
              </a>
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-[#708077]">
            {reference.stageNeutral
              ? "Read-only approved concept reference. New work remains independent."
              : "Read-only approved Stage 3 reference. New Stage 4 work remains independent."}
          </p>
        </div>
      }
    />
  );
}

function WorkflowNoticeCard({
  title,
  body,
  alignment = "left",
}: {
  title: string;
  body: string;
  alignment?: TimelineAlignment;
}) {
  return (
    <TimelineFrame
      alignment={alignment}
      width="medium"
      gutterIcon={<Info className="h-4 w-4" />}
    >
      <div
        className={`w-full rounded-[18px] border border-[#efd9af] bg-[#fffaf0] px-4 py-3 shadow-[0_10px_24px_rgba(23,39,28,0.05)] ${
          alignment === "right" ? "rounded-br-[7px]" : "rounded-bl-[7px]"
        }`}
      >
        <div className="flex items-start">
          <div className="min-w-0">
            <p className="text-[13px] font-[800] text-[#8a5718]">{title}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-[#5d4a2f]">
              {body}
            </p>
          </div>
        </div>
      </div>
    </TimelineFrame>
  );
}

function StageBriefContextCard({
  projectBriefText,
  stageBriefText,
  projectBriefAttachments,
  stageBriefAttachments,
  createdBy,
  createdAt,
  stageLabel,
  canAcceptBrief,
  showAcceptBriefAction = true,
  waitingTitle,
  waitingBody,
  isAcceptingBrief,
  onAcceptBrief,
  onOpenProjectBrief,
  onOpenStageBrief,
}: {
  projectBriefText: string;
  stageBriefText: string;
  projectBriefAttachments: DisplayAttachmentRecord[];
  stageBriefAttachments: DisplayAttachmentRecord[];
  createdBy: string;
  createdAt: string;
  stageLabel: string;
  canAcceptBrief: boolean;
  showAcceptBriefAction?: boolean;
  waitingTitle: string;
  waitingBody: string;
  isAcceptingBrief: boolean;
  onAcceptBrief: () => void;
  onOpenProjectBrief: () => void;
  onOpenStageBrief: () => void;
}) {
  const hasProjectAttachments = projectBriefAttachments.length > 0;
  const hasStageAttachments = stageBriefAttachments.length > 0;

  return (
    <TimelineFrame
      alignment="left"
      width="wide"
      gutterIcon={<FileText className="h-4 w-4" />}
    >
      <Card className="w-full overflow-hidden rounded-[20px] rounded-bl-[7px] border border-[#cfe3d2] bg-white shadow-[0_12px_30px_rgba(18,35,23,0.07)]">
        <div className="border-b border-[#e4ece5] bg-[linear-gradient(135deg,#f4fbf5,#ffffff)] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e4f3e7] text-brand">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#edf7ef] px-3 py-1 text-[10px] font-[800] uppercase tracking-[0.08em] text-brand">
                  Brief
                </span>
                <span className="text-[10px] font-semibold text-[#7a837b]">
                  {createdAt}
                </span>
              </div>
              <p className="mt-1 text-[15px] font-[800] text-[#111712]">
                Review {stageLabel} brief before starting work
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[#526057]">
                Created by {createdBy}
              </p>
            </div>
          </div>
        </div>

        <CardContent className="space-y-3 px-4 py-4 sm:px-5">
          <div className="grid gap-3 2xl:grid-cols-2">
            <section className="min-w-0 rounded-[16px] border border-[#dfe9e0] bg-[#fbfcfa] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#607064]">
                  Project Brief
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px]"
                  onClick={onOpenProjectBrief}
                >
                  View
                </Button>
              </div>
              <div className="mt-3 max-h-32 overflow-y-auto pr-1">
                <RichTextContent value={projectBriefText} fallback="No project brief has been added." className="break-words text-[13px] leading-5 text-[#26312a]" />
              </div>
              {hasProjectAttachments ? (
                <div className="mt-3">
                  <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#718076]">
                    Attachments
                  </p>
                  <AttachmentHistoryList attachments={projectBriefAttachments} compact />
                </div>
              ) : null}
            </section>

            <section className="min-w-0 rounded-[16px] border border-[#dfe9e0] bg-[#fbfcfa] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#607064]">
                  Stage Brief
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px]"
                  onClick={onOpenStageBrief}
                >
                  View
                </Button>
              </div>
              <div className="mt-3 max-h-32 overflow-y-auto pr-1">
                <RichTextContent value={stageBriefText} fallback="No stage brief has been added for this stage." className="break-words text-[13px] leading-5 text-[#26312a]" />
              </div>
              {hasStageAttachments ? (
                <div className="mt-3">
                  <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#718076]">
                    Attachments
                  </p>
                  <AttachmentHistoryList attachments={stageBriefAttachments} compact />
                </div>
              ) : null}
            </section>
          </div>

          <div className="flex flex-col gap-3 rounded-[16px] border border-[#d8e5d9] bg-[#f7fbf6] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-[#516058]">
              {waitingBody}
            </p>
            {canAcceptBrief && showAcceptBriefAction ? (
              <Button
                type="button"
                className="shrink-0 rounded-full text-[12px]"
                onClick={onAcceptBrief}
                disabled={isAcceptingBrief}
              >
                {isAcceptingBrief ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Accept Brief
              </Button>
            ) : (
              <span className="shrink-0 rounded-full bg-[#fff3d6] px-3 py-2 text-[11px] font-[700] text-[#8a5718]">
                {waitingTitle}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </TimelineFrame>
  );
}

function ConceptBriefContextCard({
  brief,
  attachments,
  assignedExecutorName,
  hasAcceptedBrief,
  canImportStageThreeReference,
  onImportStageThreeReference,
}: {
  brief: string;
  attachments: DisplayAttachmentRecord[];
  assignedExecutorName: string;
  hasAcceptedBrief: boolean;
  canImportStageThreeReference: boolean;
  onImportStageThreeReference: () => void;
}) {
  return (
    <TimelineFrame
      alignment="left"
      width="wide"
      gutterIcon={<FileText className="h-4 w-4" />}
    >
      <Card className="w-full overflow-hidden rounded-[20px] rounded-bl-[7px] border border-[#cfe3d2] bg-white shadow-[0_12px_30px_rgba(18,35,23,0.07)]">
        <div className="flex flex-col gap-3 border-b border-[#e4ece5] bg-[linear-gradient(135deg,#f4fbf5,#ffffff)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-brand">
              Concept Brief
            </p>
            <p className="mt-1 text-[12px] text-[#5d6b61]">
              Assigned to {assignedExecutorName}
            </p>
          </div>
          <span
            className={`w-fit rounded-full px-3 py-1.5 text-[10px] font-[800] uppercase tracking-[0.08em] ${
              hasAcceptedBrief
                ? "bg-[#e7f5eb] text-[#247247]"
                : "bg-[#fff3d6] text-[#8a5718]"
            }`}
          >
            {hasAcceptedBrief ? "Accepted · Work started" : "Awaiting acceptance"}
          </span>
        </div>
        <CardContent className="space-y-4 px-4 py-4 sm:px-5">
          {canImportStageThreeReference ? (
            <div className="flex flex-col gap-3 rounded-[14px] border border-dashed border-[#bcd5c2] bg-[#f7fbf7] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#4f765d]">
                  Optional Starting Reference
                </p>
                <p className="mt-1 text-[11px] leading-4 text-[#708077]">
                  Import one approved Stage 3 concept into this Stage 4 chat.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0 rounded-full"
                onClick={onImportStageThreeReference}
              >
                <Download className="h-3.5 w-3.5" />
                Import Approved Concept
              </Button>
            </div>
          ) : null}
          <RichTextContent value={brief} fallback="No concept brief has been added." className="break-words text-[13px] leading-6 text-[#26312a]" />
          {attachments.length > 0 ? (
            <div>
              <p className="mb-2 text-[10px] font-[800] uppercase tracking-[0.08em] text-[#718076]">
                Brief Attachments
              </p>
              <AttachmentHistoryList attachments={attachments} compact />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </TimelineFrame>
  );
}

function AttachmentHistoryList({
  attachments,
  compact = false,
  actionsDisabled = false,
  tone = "workflow",
  projectCategory,
  onOpenCaptions,
  showCaptionAction = true,
  currentUserDisplayName,
  approvedConceptAttachmentId,
  approvedFileLabel = "Approved Concept",
  markApprovedFileLabel = "Mark as Approved Concept",
  canApproveConceptFile = false,
  singleApprovalSelection = false,
  selectedApprovalAttachmentId,
  approvingConceptAttachmentId,
  onSelectApprovalAttachment,
  onClearApprovalSelection,
  onApproveConceptFile,
}: {
  attachments: DisplayAttachmentRecord[];
  compact?: boolean;
  actionsDisabled?: boolean;
  tone?: "sent" | "received" | "workflow";
  projectCategory?: string | null;
  onOpenCaptions?: (attachment: DisplayAttachmentRecord) => void;
  showCaptionAction?: boolean;
  currentUserDisplayName?: string;
  approvedConceptAttachmentId?: string | null;
  approvedFileLabel?: string;
  markApprovedFileLabel?: string;
  canApproveConceptFile?: boolean;
  singleApprovalSelection?: boolean;
  selectedApprovalAttachmentId?: string | null;
  approvingConceptAttachmentId?: string | null;
  onSelectApprovalAttachment?: (attachment: DisplayAttachmentRecord) => void;
  onClearApprovalSelection?: () => void;
  onApproveConceptFile?: (attachment: DisplayAttachmentRecord) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  const attachmentCardClassName =
    tone === "sent"
      ? "border-[#c7e3ce] bg-white/78"
      : tone === "received"
        ? "border-[#e1e9e2] bg-[#fbfcfa]"
        : "border-[#e1e9e2] bg-white/92";

  return (
    <div
      className={compact ? "mt-3 min-w-0 max-w-full space-y-2" : "mt-3 min-w-0 max-w-full space-y-2.5"}
      role={singleApprovalSelection ? "group" : undefined}
      aria-label={singleApprovalSelection ? "Final Approved File selection" : undefined}
    >
      {attachments.map((attachment) => (
        (() => {
          const isApprovedConcept =
            approvedConceptAttachmentId === attachment.id;
          const isApprovalSelectionSelected =
            selectedApprovalAttachmentId === attachment.id;
          const effectiveSubmissionStatus = attachment.isSubmission
            ? isApprovedConcept
              ? "APPROVED"
              : (attachment.submissionReviewStatus ?? "PENDING_REVIEW")
            : null;
          const canShowFileActions =
            !actionsDisabled &&
            !attachment.uploadState &&
            Boolean(attachment.previewPath && attachment.downloadPath);
          const canShowCaptionAction =
            !attachment.uploadState &&
            Boolean(attachment.previewPath) &&
            showCaptionAction &&
            Boolean(onOpenCaptions) &&
            isCaptionableStageSubmissionAttachment(attachment, projectCategory);
          const canMarkApprovedConcept =
            canApproveConceptFile &&
            !isApprovedConcept &&
            !attachment.uploadState &&
            attachment.isSubmission &&
            (attachment.assetType === "REVISION_ORIGINAL" ||
              attachment.assetType === "STAGE_SUBMISSION") &&
            Boolean(
              singleApprovalSelection
                ? onSelectApprovalAttachment
                : onApproveConceptFile,
            );

          const uploadedBy = currentUserDisplayName
            ? getActorDisplayName(attachment.uploadedBy, currentUserDisplayName)
            : attachment.uploadedBy;

          return (
            <div
              key={attachment.id}
              className={`w-full min-w-0 max-w-full overflow-hidden rounded-[14px] border px-3 py-2.5 text-[#111712] shadow-[0_10px_22px_rgba(18,35,23,0.06)] ${attachmentCardClassName}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                {!attachment.uploadState &&
                canShowImageThumbnail(attachment.originalFileName, attachment.mimeType) &&
                attachment.previewPath ? (
                  <AssetImageThumbnail
                    fileName={attachment.originalFileName}
                    mimeType={attachment.mimeType}
                    previewPath={attachment.previewPath}
                    downloadPath={attachment.downloadPath}
                    interactive={!canShowFileActions}
                  />
                ) : (
                  <FileThumbnail
                    fileName={attachment.originalFileName}
                    mimeType={attachment.mimeType}
                    file={attachment.localFile}
                    previewPath={attachment.previewPath}
                    fallback={<span className={`grid h-full w-full place-items-center text-[10px] font-semibold ${getFileBadgeClass(attachment.fileTypeLabel)}`}>{attachment.fileTypeLabel}</span>}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 max-w-full flex-1 truncate text-[12px] font-semibold text-[#111712]">
                      {attachment.originalFileName}
                    </p>
                    {attachment.uploadState ? (
                      <span
                        className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none ${
                          attachment.uploadState === "error"
                            ? "bg-[#fff0ef] text-[#c14f46]"
                            : attachment.uploadState === "uploaded"
                              ? "bg-[#edf7ef] text-[#2b8b56]"
                              : "bg-[#f4f7f4] text-[#566259]"
                        }`}
                      >
                        {attachment.uploadState === "error"
                          ? "Failed"
                          : attachment.uploadState === "uploaded"
                            ? "Uploaded"
                            : "Uploading"}
                      </span>
                    ) : null}
                    {attachment.isSubmission ? (
                      <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-[#edf7ef] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none text-[#2b8b56]">
                        {attachment.submissionNumber
                          ? `Submission ${attachment.submissionNumber}`
                          : "Submission"}
                      </span>
                    ) : null}
                    {attachment.isSubmission && !attachment.uploadState ? (
                      <span
                        className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none ${
                          effectiveSubmissionStatus === "APPROVED"
                            ? "bg-[#edf7ef] text-[#2b8b56]"
                            : effectiveSubmissionStatus === "REJECTED"
                              ? "bg-[#fff0ef] text-[#c14f46]"
                              : "bg-[#fff8eb] text-[#b77420]"
                        }`}
                      >
                        {effectiveSubmissionStatus === "APPROVED"
                          ? "Approved"
                          : effectiveSubmissionStatus === "REJECTED"
                            ? "Revision Requested"
                            : "Pending Review"}
                      </span>
                    ) : null}
                    {isApprovedConcept ? (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#dff2e5] px-2 py-0.5 text-[9px] font-[800] uppercase tracking-wide leading-none text-[#1f7145]">
                        <CheckCircle2 className="h-3 w-3" /> {approvedFileLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-4 text-[#6c756e]">
	                    {attachment.uploadState
	                      ? attachment.uploadState === "error"
                        ? attachment.errorMessage || "Upload failed."
                        : attachment.uploadState === "uploaded"
                          ? `${attachment.fileSizeLabel} · Uploaded`
                          : attachment.uploadState === "pending"
                            ? `${attachment.fileSizeLabel} · Waiting to upload`
                            : `${attachment.fileSizeLabel} · ${attachment.progress ?? 0}% uploaded`
	                      : `${attachment.fileSizeLabel} · Uploaded by ${uploadedBy}`}
	                  </p>
                  {!attachment.uploadState ? (
                    <p className="text-[10px] leading-4 text-[#89928b]">
                      {attachment.uploadedAt}
                    </p>
                  ) : null}
                  {attachment.uploadState && attachment.uploadState !== "error" ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf2ed]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#2f8d5d,#123f2d)] transition-[width] duration-200"
                        style={{ width: `${attachment.progress ?? 0}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                {canShowFileActions || canShowCaptionAction ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {canShowCaptionAction ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-full text-brand"
                        onClick={() => onOpenCaptions?.(attachment)}
                        aria-label={`Open captions for ${attachment.originalFileName}`}
                      >
                        <MessageSquarePlus className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {canShowFileActions ? (
                      <>
                        <AssetPreviewButton
                          fileName={attachment.originalFileName}
                          mimeType={attachment.mimeType}
                          previewPath={attachment.previewPath}
                          downloadPath={attachment.downloadPath}
                          triggerClassName="size-8 rounded-full text-brand"
                        />
                        <AttachmentFavoriteButton
                          attachmentId={attachment.id}
                          initialIsFavorited={attachment.isFavoritedByCurrentUser}
                          className="size-8 rounded-full text-[#7a847d] hover:bg-[#fff4f5]"
                        />
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-full text-brand"
                        >
                          <a
                            href={attachment.downloadPath}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Download ${attachment.originalFileName}`}
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {canMarkApprovedConcept ? (
                <div className="mt-2 flex justify-end border-t border-[#edf1ed] pt-2">
                  {singleApprovalSelection ? (
                    <label
                      className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-[10px] font-[760] transition-colors ${
                        isApprovalSelectionSelected
                          ? "border-[#2f8d5d] bg-[#e8f5eb] text-[#1f7145]"
                          : "border-[#93bda0] bg-white text-[#276f49] hover:bg-[#f3faf5]"
                      } ${approvingConceptAttachmentId ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        name="stage-four-final-approved-file"
                        value={attachment.id}
                        checked={isApprovalSelectionSelected}
                        disabled={Boolean(approvingConceptAttachmentId)}
                        onChange={() => {
                          if (isApprovalSelectionSelected) {
                            onClearApprovalSelection?.();
                            return;
                          }

                          onSelectApprovalAttachment?.(attachment);
                        }}
                        aria-label={
                          isApprovalSelectionSelected
                            ? `Unselect ${attachment.originalFileName}`
                            : `Select ${attachment.originalFileName}`
                        }
                        className="size-3.5 accent-[#2f8d5d]"
                      />
                      {isApprovalSelectionSelected ? "Selected" : "Select this file"}
                    </label>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full border-[#93bda0] px-3 text-[10px] font-[760] text-[#276f49]"
                      disabled={Boolean(approvingConceptAttachmentId)}
                      onClick={() => onApproveConceptFile?.(attachment)}
                    >
                      {approvingConceptAttachmentId === attachment.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {markApprovedFileLabel}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })()
      ))}
    </div>
  );
}

function BriefDialog({
  isOpen,
  labelledById,
  title,
  heading,
  context,
  body,
  emptyMessage,
  attachmentsTitle,
  attachments,
  onClose,
}: {
  isOpen: boolean;
  labelledById: string;
  title: string;
  heading: string;
  context?: string;
  body: string;
  emptyMessage: string;
  attachmentsTitle: string;
  attachments: DisplayAttachmentRecord[];
  onClose: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
    >
      <Card className="flex max-h-[88vh] w-full max-w-[720px] flex-col rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
          <div>
            <CardTitle
              id={labelledById}
              className="text-[24px] font-semibold tracking-tight text-[#111712]"
            >
              {title}
            </CardTitle>
            <p className="mt-2 text-[14px] font-semibold text-[#111712]">
              {heading}
            </p>
            {context ? (
              <p className="mt-1 text-[13px] leading-5 text-[#6a706b]">
                {context}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onClose}
            className="shrink-0 border border-line"
            aria-label={`Close ${title.toLowerCase()}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
          {body ? (
            <section className="rounded-[20px] border border-line bg-[#fbfcfa] p-4">
              <RichTextContent value={body} className="text-[14px] leading-6 text-[#253028]" />
            </section>
          ) : (
            <div className="rounded-[20px] border border-line bg-[#fbfcfa] px-4 py-5 text-[14px] leading-6 text-[#6a706b]">
              {emptyMessage}
            </div>
          )}

          <section className="mt-5 rounded-[20px] border border-line bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
              {attachmentsTitle}
            </p>
            {attachments.length > 0 ? (
              <AttachmentHistoryList attachments={attachments} compact />
            ) : (
              <p className="mt-2 text-[13px] leading-5 text-[#7a837b]">
                No attachments available.
              </p>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function getFileNameDisplayParts(fileName: string) {
  const safeFileName = fileName.trim() || "Untitled file";
  const dotIndex = safeFileName.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === safeFileName.length - 1) {
    return {
      stem: safeFileName,
      extension: "",
    };
  }

  return {
    stem: safeFileName.slice(0, dotIndex),
    extension: safeFileName.slice(dotIndex),
  };
}

function ProjectAssetCard({
  attachment,
  actionsDisabled = false,
  favoriteOverrides,
  onFavoriteChange,
  currentUserDisplayName,
}: {
  attachment: DisplayAttachmentRecord;
  actionsDisabled?: boolean;
  favoriteOverrides?: Record<string, boolean>;
  onFavoriteChange?: (attachmentId: string, isFavorited: boolean) => void;
  currentUserDisplayName?: string;
}) {
  const { stem, extension } = getFileNameDisplayParts(attachment.originalFileName);
  const uploadedBy = currentUserDisplayName
    ? getActorDisplayName(attachment.uploadedBy, currentUserDisplayName)
    : attachment.uploadedBy.trim() || "Unknown user";
  const canShowActions =
    !actionsDisabled && Boolean(attachment.previewPath && attachment.downloadPath);
  const isFavorited =
    favoriteOverrides?.[attachment.id] ?? attachment.isFavoritedByCurrentUser;

  return (
    <article className="group flex min-h-[190px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-[#dce6dd] bg-[#fbfcfa] p-3 shadow-[0_8px_20px_rgba(18,35,23,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:bg-white hover:shadow-[0_16px_34px_rgba(18,35,23,0.09)]">
      <div className="min-w-0">
        <div
          className="flex min-w-0 items-baseline text-[12px] font-[800] leading-4 text-[#111712]"
          title={attachment.originalFileName}
        >
          <span className="min-w-0 truncate">{stem}</span>
          {extension ? <span className="shrink-0">{extension}</span> : null}
        </div>
        <p className="mt-1 min-w-0 whitespace-normal break-words text-[11px] font-[600] leading-4 text-[#667168]">
          Uploaded by {uploadedBy}
        </p>
      </div>

      <div className="mt-3 min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <FileThumbnail
            fileName={attachment.originalFileName}
            mimeType={attachment.mimeType}
            file={attachment.localFile}
            previewPath={attachment.previewPath}
            fallback={<span className={`grid h-full w-full place-items-center text-[10px] font-semibold ${getFileBadgeClass(attachment.fileTypeLabel)}`}>{attachment.fileTypeLabel}</span>}
          />
          <span className="truncate text-[10px] font-[600] leading-4 text-[#7a837b]">
            {attachment.fileSizeLabel}
          </span>
        </div>
        <p className="truncate text-[10px] leading-4 text-[#89928b]">
          {attachment.uploadedAt}
        </p>
      </div>

      {canShowActions ? (
        <div className="mt-auto flex items-center justify-end gap-1 border-t border-[#e4ebe5] pt-2.5">
          <AssetPreviewButton
            fileName={attachment.originalFileName}
            mimeType={attachment.mimeType}
            previewPath={attachment.previewPath}
            downloadPath={attachment.downloadPath}
            triggerClassName="size-8 rounded-full text-brand hover:bg-[#eef7ef]"
          />
          <AttachmentFavoriteButton
            key={`${attachment.id}-${isFavorited ? "favorited" : "not-favorited"}`}
            attachmentId={attachment.id}
            initialIsFavorited={isFavorited}
            className="size-8 rounded-full text-[#7a847d] hover:bg-[#fff4f5]"
            onChange={(nextState) => onFavoriteChange?.(attachment.id, nextState)}
          />
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 rounded-full text-brand hover:bg-[#eef7ef]"
          >
            <a
              href={attachment.downloadPath}
              target="_blank"
              rel="noreferrer"
              aria-label={`Download ${attachment.originalFileName}`}
            >
              <Download className="h-4 w-4" />
            </a>
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function ProjectAssetGrid({
  attachments,
  actionsDisabled = false,
  variant = "inline",
  favoriteOverrides,
  onFavoriteChange,
  currentUserDisplayName,
}: {
  attachments: DisplayAttachmentRecord[];
  actionsDisabled?: boolean;
  variant?: "inline" | "modal";
  favoriteOverrides?: Record<string, boolean>;
  onFavoriteChange?: (attachmentId: string, isFavorited: boolean) => void;
  currentUserDisplayName?: string;
}) {
  const gridClassName =
    variant === "modal"
      ? "grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3"
      : "grid grid-cols-2 gap-2.5";

  return (
    <div className={gridClassName}>
      {attachments.map((attachment) => (
        <ProjectAssetCard
          key={attachment.id}
          attachment={attachment}
          actionsDisabled={actionsDisabled}
          favoriteOverrides={favoriteOverrides}
          onFavoriteChange={onFavoriteChange}
          currentUserDisplayName={currentUserDisplayName}
        />
      ))}
    </div>
  );
}

function ProjectAssetsModal({
  isOpen,
  attachments,
  actionsDisabled = false,
  favoriteOverrides,
  onFavoriteChange,
  onClose,
  currentUserDisplayName,
}: {
  isOpen: boolean;
  attachments: DisplayAttachmentRecord[];
  actionsDisabled?: boolean;
  favoriteOverrides?: Record<string, boolean>;
  onFavoriteChange?: (attachmentId: string, isFavorited: boolean) => void;
  onClose: () => void;
  currentUserDisplayName?: string;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const assetCountLabel = `${attachments.length} ${
    attachments.length === 1 ? "asset" : "assets"
  }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-assets-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Card className="flex h-full max-h-[88vh] w-full max-w-[860px] flex-col rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
          <div className="min-w-0">
            <CardTitle
              id="project-assets-modal-title"
              className="text-[24px] font-semibold tracking-tight text-[#111712]"
            >
              Project Assets
            </CardTitle>
            <p className="mt-2 text-[13px] font-[600] text-[#6a706b]">
              {assetCountLabel}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onClose}
            className="shrink-0 border border-line"
            aria-label="Close project assets"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
          <ProjectAssetGrid
            attachments={attachments}
            actionsDisabled={actionsDisabled}
            variant="modal"
            favoriteOverrides={favoriteOverrides}
            onFavoriteChange={onFavoriteChange}
            currentUserDisplayName={currentUserDisplayName}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function uploadAssetFile(input: {
  file: File;
  projectId: string;
  stageId: string;
  revisionId?: string | null;
  commentId?: string | null;
  assetType: UploadAssetType;
  fileIndex?: number;
  fileCount?: number;
  onProgress?: (progress: number) => void;
  onUploadStart?: (file: File) => void;
}): Promise<{ attachmentId: string; uploadedFile: File; invoiceCommentId?: string | null }> {
  const uploadFile = input.file;

  input.onUploadStart?.(uploadFile);

  const uploadUrlStartedAt = getUploadNow();
  const requestUploadResponse = await fetch("/api/project-assets/upload-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: input.projectId,
      stageId: input.stageId,
      revisionId: input.revisionId ?? null,
      commentId: input.commentId ?? null,
      originalFileName: uploadFile.name,
      mimeType: uploadFile.type || "application/octet-stream",
      fileSize: uploadFile.size,
      assetType: input.assetType,
    }),
  });
  console.info("upload:upload-url", {
    status: requestUploadResponse.status,
    durationMs: Math.round(getUploadNow() - uploadUrlStartedAt),
    fileSize: uploadFile.size,
    mimeType: uploadFile.type || "application/octet-stream",
    assetType: input.assetType,
  });

  const uploadPayload = (await requestUploadResponse.json()) as {
    error?: string;
    attachmentId?: string;
    uploadUrl?: string;
  } & Partial<UploadFileTypeErrorPayload>;

  if (!requestUploadResponse.ok || !uploadPayload.attachmentId || !uploadPayload.uploadUrl) {
    throw new Error(getUploadErrorMessage(uploadPayload, "Unable to prepare the upload."));
  }

  logUploadHost(uploadPayload.uploadUrl);

  try {
    await uploadFileToS3WithProgress({
      uploadUrl: uploadPayload.uploadUrl,
      file: uploadFile,
      fileIndex: input.fileIndex,
      fileCount: input.fileCount,
      assetType: input.assetType,
      onProgress: input.onProgress,
    });

    const completionStartedAt = getUploadNow();
    const completionResponse = await fetch("/api/project-assets/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attachmentId: uploadPayload.attachmentId,
        projectId: input.projectId,
      }),
    });
    console.info("upload:complete", {
      status: completionResponse.status,
      durationMs: Math.round(getUploadNow() - completionStartedAt),
      fileSize: uploadFile.size,
      mimeType: uploadFile.type || "application/octet-stream",
      assetType: input.assetType,
    });

    const completionPayload = (await completionResponse.json()) as {
      error?: string;
      invoiceCommentId?: string | null;
    } & Partial<UploadFileTypeErrorPayload>;

    if (!completionResponse.ok) {
      throw new Error(
        getUploadErrorMessage(completionPayload, "Unable to finalise the upload."),
      );
    }

    return {
      attachmentId: uploadPayload.attachmentId,
      uploadedFile: uploadFile,
      invoiceCommentId: completionPayload.invoiceCommentId ?? null,
    };
  } catch (error) {
    await fetch("/api/project-assets/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attachmentId: uploadPayload.attachmentId,
        failed: true,
        projectId: input.projectId,
      }),
    }).catch(() => undefined);

    throw error;
  }
}

async function completePreparedAttachmentUpload(input: {
  attachmentId: string;
  projectId: string;
  file: File;
  assetType: UploadAssetType;
}) {
  const completionStartedAt = getUploadNow();
  const completionResponse = await fetch(
    "/api/project-assets/chat-comment-upload/complete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attachmentId: input.attachmentId,
        projectId: input.projectId,
      }),
    },
  );
  console.info("upload:complete", {
    status: completionResponse.status,
    durationMs: Math.round(getUploadNow() - completionStartedAt),
    fileSize: input.file.size,
    mimeType: input.file.type || "application/octet-stream",
    assetType: input.assetType,
  });

  const completionPayload = (await completionResponse.json()) as {
    error?: string;
  } & Partial<UploadFileTypeErrorPayload>;

  if (!completionResponse.ok) {
    throw new Error(
      getUploadErrorMessage(completionPayload, "Unable to finalise the upload."),
    );
  }
}

async function cancelPreparedCommentUpload(input: {
  commentId: string;
  projectId: string;
}) {
  const response = await fetch("/api/project-assets/chat-comment-upload/cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Unable to cancel the upload.");
  }
}

async function finalizePreparedCommentUpload(input: {
  commentId: string;
  projectId: string;
}) {
  const response = await fetch("/api/project-assets/chat-comment-upload/finalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Unable to finalize the upload.");
  }
}

type PreparedPendingUpload = {
  pendingFile: PendingFile;
  uploadFile: File;
};

type ChatCommentUploadPrepareResponse =
  | ({ error?: string } & Partial<UploadFileTypeErrorPayload>)
  | {
      commentId: string;
      revisionId: string | null;
      mentionedUserIds: string[];
      uploads: Array<{
        clientId?: string;
        attachmentId: string;
        fileName: string;
        uploadUrl: string;
        storageKey: string;
      }>;
    };

export function ProjectChatWorkspace({
  project,
  stageId,
  history,
  availableCollaborators,
  currentUserId,
  currentUserAvatarSrc,
  canManageCollaborators,
  canManageChatVisibility,
  canViewCompareSubmissions,
  canAddCaptions,
  completionSummary,
  completionWorkflow,
  deferCompletionData = false,
  conceptMode,
}: ProjectChatWorkspaceProps) {
  const router = useRouter();
  const isConceptMode = conceptMode?.type === "concept";
  const isStageNeutralConceptMode = Boolean(conceptMode?.stageNeutral);
  const draftComposerMaxHeight = isConceptMode ? 96 : 168;
  const isStageFourConceptMode = conceptMode?.stageNumber === 4;
  const approvedFileLabel = isStageFourConceptMode
    ? "Final Approved File"
    : "Approved Concept";
  const markApprovedFileLabel = isStageFourConceptMode
    ? "Mark Final Approved File"
    : "Mark as Approved Concept";
  const [collaborators, setCollaborators] = useState<ProjectCollaboratorRecord[]>(
    project.collaborators,
  );
  const [executors, setExecutors] = useState(project.executors);
  const [availableCollaboratorRecords, setAvailableCollaboratorRecords] =
    useState<CollaboratorRecord[]>(availableCollaborators);
  const [draft, setDraft] = useState("");
  const [replyingToRevision, setReplyingToRevision] =
    useState<RevisionReplyTarget | null>(null);
  const [selectedMentionTokens, setSelectedMentionTokens] = useState<MentionToken[]>([]);
  const [draftSelectionStart, setDraftSelectionStart] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingCommentFiles, setPendingCommentFiles] = useState<PendingFile[]>([]);
  const [expandedMessageEditorOpen, setExpandedMessageEditorOpen] = useState(false);
  const [loadedHistoryEntries, setLoadedHistoryEntries] = useState<ProjectChatEntry[]>(
    history.entries,
  );
  const [olderMessagesCursor, setOlderMessagesCursor] = useState<string | null>(
    history.nextCursor ?? null,
  );
  const [hasEarlierMessages, setHasEarlierMessages] = useState(
    Boolean(history.hasMore && history.nextCursor),
  );
  const [isLoadingEarlierMessages, setIsLoadingEarlierMessages] = useState(false);
  const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);
  const [stageRevisionCount, setStageRevisionCount] = useState(
    history.revisionCount ?? history.entries.filter((entry) => entry.kind === "revision").length,
  );
  const [optimisticComments, setOptimisticComments] = useState<DisplayChatEntry[]>([]);
  const [confirmedComments, setConfirmedComments] = useState<DisplayChatEntry[]>([]);
  const [deletedMessageOverrides, setDeletedMessageOverrides] = useState<
    Record<string, DeletedMessageOverride>
  >({});
  const [deleteMessageTarget, setDeleteMessageTarget] =
    useState<DisplayChatEntry | null>(null);
  const [deleteMessageError, setDeleteMessageError] = useState<string | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [deleteMenuNow, setDeleteMenuNow] = useState(() => Date.now());
  const [pendingRevisionReviewId, setPendingRevisionReviewId] = useState<string | null>(null);
  const [revisionReviewOverrides, setRevisionReviewOverrides] = useState<
    Record<
      string,
      {
        status: RevisionReviewState;
        rejectionReason: string | null;
        reviewedBy?: string | null;
        reviewedAt?: string | null;
      }
    >
  >({});
  const [pendingRevisionFiles, setPendingRevisionFiles] = useState<PendingFile[]>([]);
  const [reviewRevisionId, setReviewRevisionId] = useState<string | null>(null);
  const [reviewRejectMode, setReviewRejectMode] = useState(false);
  const [reviewRejectReason, setReviewRejectReason] = useState("");
  const [reviewDialogError, setReviewDialogError] = useState<string | null>(null);
  const [approvedConceptAttachmentId, setApprovedConceptAttachmentId] =
    useState<string | null>(conceptMode?.approvedAttachmentId ?? null);
  const [selectedConceptApprovalCandidateId, setSelectedConceptApprovalCandidateId] =
    useState<string | null>(null);
  const [conceptApprovalTarget, setConceptApprovalTarget] =
    useState<DisplayAttachmentRecord | null>(null);
  const [conceptApprovalError, setConceptApprovalError] = useState<string | null>(
    null,
  );
  const [approvingConceptAttachmentId, setApprovingConceptAttachmentId] =
    useState<string | null>(null);
  const [revokeConceptApprovalOpen, setRevokeConceptApprovalOpen] =
    useState(false);
  const [revokingConceptApproval, setRevokingConceptApproval] = useState(false);
  const [revokeConceptApprovalError, setRevokeConceptApprovalError] = useState<
    string | null
  >(null);
  const [stageThreeReferenceDialogOpen, setStageThreeReferenceDialogOpen] =
    useState(false);
  const [selectedStageThreeReferenceId, setSelectedStageThreeReferenceId] =
    useState("");
  const [stageThreeReferenceError, setStageThreeReferenceError] = useState<
    string | null
  >(null);
  const [isImportingStageThreeReference, setIsImportingStageThreeReference] =
    useState(false);
  const [commentUploadDialogOpen, setCommentUploadDialogOpen] = useState(false);
  const [commentUploadIntent, setCommentUploadIntent] =
    useState<CommentUploadIntent>("COMMENT_ATTACHMENT");
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [isUploadingRevision, setIsUploadingRevision] = useState(false);
  const [isUploadingStageInvoice, setIsUploadingStageInvoice] = useState(false);
  const [stageInvoiceError, setStageInvoiceError] = useState<string | null>(null);
  const [invoiceRequestDialogOpen, setInvoiceRequestDialogOpen] = useState(false);
  const [invoiceRequestRecipientId, setInvoiceRequestRecipientId] = useState("");
  const [invoiceRequestNote, setInvoiceRequestNote] = useState(
    "Please upload the invoice for this completed stage.",
  );
  const [invoiceRequestError, setInvoiceRequestError] = useState<string | null>(null);
  const [isRequestingStageInvoice, setIsRequestingStageInvoice] = useState(false);
  const [selectedOutputLanguageCode, setSelectedOutputLanguageCode] = useState(
    DEFAULT_CHAT_LANGUAGE.code,
  );
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateAllEnabled, setTranslateAllEnabled] = useState(false);
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateAllError, setTranslateAllError] = useState<string | null>(null);
  const [stageChatTranslations, setStageChatTranslations] = useState<
    Record<string, StageChatTranslation>
  >({});
  const [autoTranslateDraft, setAutoTranslateDraft] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionSummary, setRevisionSummary] = useState("");
  const [revisionDialogError, setRevisionDialogError] = useState<string | null>(null);
  const [stageCompleteDialogOpen, setStageCompleteDialogOpen] = useState(false);
  const [stageCompleteError, setStageCompleteError] = useState<string | null>(null);
  const [isMarkingStageComplete, setIsMarkingStageComplete] = useState(false);
  const [acceptBriefDialogOpen, setAcceptBriefDialogOpen] = useState(false);
  const [projectBriefDialogOpen, setProjectBriefDialogOpen] = useState(false);
  const [stageBriefDialogOpen, setStageBriefDialogOpen] = useState(false);
  const [projectAssetsModalOpen, setProjectAssetsModalOpen] = useState(false);
  const [captionDialogAttachment, setCaptionDialogAttachment] =
    useState<CaptionDialogAttachment | null>(null);
  const [captionDialogInitialCaptionId, setCaptionDialogInitialCaptionId] =
    useState<string | null>(null);
  const [projectAssetFavoriteOverrides, setProjectAssetFavoriteOverrides] = useState<
    Record<string, boolean>
  >({});
  const [acceptBriefError, setAcceptBriefError] = useState<string | null>(null);
  const [isAcceptingBrief, setIsAcceptingBrief] = useState(false);
  const [stageCardOverrides, setStageCardOverrides] = useState<
    Record<
      string,
      {
        actualStartedAt: string;
        actualStartedAtValue: string | null;
        startedByName?: string | null;
        status?: ProjectStageRecord["status"];
        invoiceAttachment?: ProjectStageRecord["invoiceAttachment"];
        invoiceRequest?: ProjectStageRecord["invoiceRequest"];
      }
    >
  >({});
  const [completionPrompt, setCompletionPrompt] = useState<{
    nextStageId: string | null;
    nextStageLabel: string | null;
    allStagesCompleted: boolean;
  } | null>(null);
  const [reviewCompleteDialogOpen, setReviewCompleteDialogOpen] = useState(false);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [draftCollaboratorIds, setDraftCollaboratorIds] = useState<string[]>([]);
  const [collaboratorDialogOpen, setCollaboratorDialogOpen] = useState(false);
  const [collaboratorSaving, setCollaboratorSaving] = useState(false);
  const [collaboratorDialogError, setCollaboratorDialogError] = useState<string>();
  const [completionOverrides, setCompletionOverrides] =
    useState<Partial<ProjectCompletionSummary> | null>(null);
  const [completionData, setCompletionData] = useState<{
    summary: ProjectCompletionSummary;
    workflow: ProjectCompletionWorkflowRecord | null;
  }>({
    summary: completionSummary,
    workflow: completionWorkflow,
  });
  const [isCompletionDataLoading, setIsCompletionDataLoading] =
    useState(deferCompletionData);
  const [projectCompletionError, setProjectCompletionError] = useState<string | null>(null);
  const [completionChecklistOpen, setCompletionChecklistOpen] = useState(false);
  const [isPreparingProjectCompletion, setIsPreparingProjectCompletion] = useState(false);
  const [archivePreparation, setArchivePreparation] =
    useState<ProjectArchivePreparation | null>(null);
  const [archiveWizardStep, setArchiveWizardStep] = useState<ArchiveWizardStep>(0);
  const [archiveFileNames, setArchiveFileNames] = useState<Record<string, string>>({});
  const [archiveFileErrors, setArchiveFileErrors] = useState<Record<string, string>>({});
  const [archiveMetadataDrafts, setArchiveMetadataDrafts] = useState<
    Record<string, ArchiveArtworkMetadataDraft>
  >({});
  const [archiveCategoryId, setArchiveCategoryId] = useState<string>("");
  const [archiveCompletionError, setArchiveCompletionError] = useState<string | null>(null);
  const [isCompletingProject, setIsCompletingProject] = useState(false);
  const [, startRefresh] = useTransition();
  const revisionFileInputRef = useRef<HTMLInputElement | null>(null);
  const revisionDialogFileInputRef = useRef<HTMLInputElement | null>(null);
  const commentAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const stageInvoiceInputRef = useRef<HTMLInputElement | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const expandedDraftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const completionWorkflowRef = useRef<HTMLDivElement | null>(null);
  const mentionDropdownRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const [collaboratorForm, setCollaboratorForm] = useState<CollaboratorForm>({
    name: "",
    email: "",
  });
  const [isNearChatBottom, setIsNearChatBottom] = useState(true);
  const [newRealtimeMessageCount, setNewRealtimeMessageCount] = useState(0);
  const [realtimeWatermark, setRealtimeWatermark] = useState<string | null>(null);
  const confirmedClientTempIdsRef = useRef<Set<string>>(new Set());
  const failedClientTempIdsRef = useRef<Set<string>>(new Set());
  const legacyConceptApprovalRepairRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const autoTranslateTimeoutRef = useRef<number | null>(null);
  const translationRequestIdRef = useRef(0);
  const translateAllRequestIdRef = useRef(0);
  const pendingTranslateAllSegmentIdsRef = useRef<Set<string>>(new Set());
  const lastAppliedTranslationRef = useRef<{
    sourceText: string;
    translatedText: string;
    targetLanguageCode: string;
  } | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setCollaborators(project.collaborators);
    setExecutors(project.executors);
  }, [project.collaborators, project.executors]);

  useEffect(() => {
    setApprovedConceptAttachmentId(
      conceptMode?.approvedAttachmentId ?? null,
    );
  }, [conceptMode?.approvedAttachmentId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDeleteMenuNow(Date.now());
    }, 15_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoadedHistoryEntries(history.entries);
    setOlderMessagesCursor(history.nextCursor ?? null);
    setHasEarlierMessages(Boolean(history.hasMore && history.nextCursor));
    setStageRevisionCount(
      history.revisionCount ??
        history.entries.filter((entry) => entry.kind === "revision").length,
    );
    setOlderMessagesError(null);
    setRealtimeWatermark(null);
    setNewRealtimeMessageCount(0);
    setIsNearChatBottom(true);
    confirmedClientTempIdsRef.current.clear();
    failedClientTempIdsRef.current.clear();
  }, [
    history.activeStageId,
    history.entries,
    history.hasMore,
    history.nextCursor,
    history.revisionCount,
  ]);

  useEffect(() => {
    const input = draftInputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, draftComposerMaxHeight)}px`;
    input.style.overflowY =
      input.scrollHeight > draftComposerMaxHeight ? "auto" : "hidden";
  }, [draft, draftComposerMaxHeight]);

  useEffect(() => {
    if (!expandedMessageEditorOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = expandedDraftInputRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [expandedMessageEditorOpen]);

  function handleProjectAssetFavoriteChange(
    attachmentId: string,
    isFavorited: boolean,
  ) {
    setProjectAssetFavoriteOverrides((current) => ({
      ...current,
      [attachmentId]: isFavorited,
    }));
  }

  const messages = loadedHistoryEntries;
  const startingReferenceTimelineEntry = useMemo<DisplayChatEntry | null>(() => {
    const reference = conceptMode?.startingReference;

    if (!reference) {
      return null;
    }

    const importedByName =
      reference.importedBy?.name?.trim() ||
      reference.importedBy?.email ||
      "Project Owner";

    return {
      id: `concept-reference-${conceptMode.folderId}-${reference.id}`,
      kind: "reference",
      authorId: reference.importedBy?.id,
      author: importedByName,
      authorAvatarSrc: reference.importedBy?.avatarUrl
        ? `/api/profile/avatar?v=${encodeURIComponent(reference.importedBy.avatarUrl)}`
        : null,
      role: "Internal Team",
      body: `${importedByName} imported ${reference.sourceConceptName} as the starting reference for this concept.`,
      createdAt: formatLocalStageDateTime(reference.importedAt),
      createdAtValue: reference.importedAt,
      reference: {
        attachmentId: reference.id,
        fileName: reference.name,
        mimeType: reference.mimeType,
        previewPath: reference.previewPath,
        downloadPath: reference.downloadPath,
        sourceConceptId: reference.sourceConceptId,
        sourceConceptName: reference.sourceConceptName,
        stageNeutral: conceptMode.stageNeutral,
      },
    };
  }, [conceptMode]);
  const completionState = completionOverrides
    ? { ...completionData.summary, ...completionOverrides }
    : completionData.summary;
  const effectiveCompletionWorkflow = completionData.workflow;
  const inlineProjectAssets = project.attachments.slice(0, PROJECT_ASSET_INLINE_LIMIT);
  const hasMoreProjectAssets =
    project.attachments.length > PROJECT_ASSET_INLINE_LIMIT;
  const stageCards = useMemo(
    () =>
      project.stageCards.map((stage) => {
        const override = stageCardOverrides[stage.id];

        return override
          ? {
              ...stage,
              actualStartedAt: override.actualStartedAt,
              actualStartedAtValue: override.actualStartedAtValue,
              startedByName: override.startedByName ?? stage.startedByName,
              status: override.status ?? stage.status,
              invoiceAttachment:
                override.invoiceAttachment === undefined
                  ? stage.invoiceAttachment
                  : override.invoiceAttachment,
              invoiceRequest:
                override.invoiceRequest === undefined
                  ? stage.invoiceRequest
                  : override.invoiceRequest,
            }
          : stage;
      }),
    [project.stageCards, stageCardOverrides],
  );
  const serverMessageIds = useMemo(
    () => new Set(messages.map((entry) => entry.id)),
    [messages],
  );
  const visibleOptimisticComments = useMemo(
    () =>
      optimisticComments.filter((entry) => {
        if (!entry.serverEntryId || !serverMessageIds.has(entry.serverEntryId)) {
          return true;
        }

        return (
          entry.attachments?.some(
            (attachment: DisplayAttachmentRecord) =>
              attachment.uploadState === "pending" ||
              attachment.uploadState === "uploading",
          ) ?? false
        );
      }),
    [optimisticComments, serverMessageIds],
  );
  const isUploadNavigationGuardEnabled = useMemo(
    () =>
      isUploadingRevision ||
      isUploadingStageInvoice ||
      optimisticComments.some(hasInFlightAttachmentUpload),
    [isUploadingRevision, isUploadingStageInvoice, optimisticComments],
  );
  const uploadNavigationGuard = useUploadNavigationGuard(isUploadNavigationGuardEnabled);
  const visibleConfirmedComments = useMemo(
    () =>
      confirmedComments.filter(
        (entry) => !entry.serverEntryId || !serverMessageIds.has(entry.serverEntryId),
      ),
    [confirmedComments, serverMessageIds],
  );
  const serverEntryIdsWithLocalOverrides = useMemo(
    () =>
      new Set(
        [...visibleOptimisticComments, ...visibleConfirmedComments]
          .map((entry) => entry.serverEntryId)
          .filter((entryId): entryId is string => Boolean(entryId)),
      ),
    [visibleConfirmedComments, visibleOptimisticComments],
  );
  const displayedMessages = useMemo(
    () => {
      const localMessages = [
        ...visibleOptimisticComments,
        ...visibleConfirmedComments,
      ].sort(
        (left, right) =>
          (left.localCreatedAtMs ?? 0) - (right.localCreatedAtMs ?? 0),
      );
      const combinedMessages: DisplayChatEntry[] = [
        ...messages.filter(
          (message) => !serverEntryIdsWithLocalOverrides.has(message.id),
        ),
        ...localMessages,
      ];

      const timelineMessages = combinedMessages
        .map((message) => {
          const serverMessageId = message.serverEntryId ?? message.id;
          const deletedOverride = deletedMessageOverrides[serverMessageId];

          if (!deletedOverride) {
            return message;
          }

          return {
            ...message,
            body: deletedOverride.displayText,
            deletedAt: deletedOverride.deletedAt,
            deletedByUserId: deletedOverride.deletedByUserId,
            canDeleteUntil: null,
            mentions: [],
            attachments: [],
          };
        })
        .filter((message) => !isLegacyBriefContextMessage(message))
        .filter((message) => !isConceptMode || !isConceptIrrelevantSystemEntry(message));

      if (!startingReferenceTimelineEntry) {
        return timelineMessages;
      }

      return [...timelineMessages, startingReferenceTimelineEntry].sort(
        (left, right) => {
          const timeDifference =
            getTimelineEntryCreatedAtMs(left) -
            getTimelineEntryCreatedAtMs(right);

          return timeDifference !== 0
            ? timeDifference
            : left.id.localeCompare(right.id);
        },
      );
    },
    [
      deletedMessageOverrides,
      messages,
      serverEntryIdsWithLocalOverrides,
      visibleConfirmedComments,
      visibleOptimisticComments,
      isConceptMode,
      startingReferenceTimelineEntry,
    ],
  );
  const stageSubmissions = useMemo(
    () =>
      getStageSubmissionAttachments(displayedMessages, project.category).filter(
        (attachment) =>
          !("uploadState" in attachment) || attachment.uploadState === "uploaded",
      ),
    [displayedMessages, project.category],
  );
  const hasComparableSubmissions = stageSubmissions.length >= 2;
  const canCompareSubmissions = canViewCompareSubmissions && hasComparableSubmissions;
  const canSendComment = draft.trim().length > 0 || pendingCommentFiles.length > 0;
  const revisionMessages = useMemo(
    () => displayedMessages.filter((entry) => entry.kind === "revision"),
    [displayedMessages],
  );
  const latestRevisionMessage = revisionMessages.at(-1) ?? null;
  const getEffectiveRevisionStatus = useCallback(
    (message: DisplayChatEntry): RevisionReviewState => {
      const reviewOverride =
        revisionReviewOverrides[getRevisionEntryId(message)];
      const containsApprovedConceptFile = Boolean(
        approvedConceptAttachmentId &&
          message.attachments?.some(
            (attachment) => attachment.id === approvedConceptAttachmentId,
          ),
      );

      return (
        reviewOverride?.status ??
        (containsApprovedConceptFile
          ? "APPROVED"
          : message.revisionStatus ?? "PENDING_REVIEW")
      );
    },
    [approvedConceptAttachmentId, revisionReviewOverrides],
  );
  const latestRevisionEntryId = latestRevisionMessage
    ? getRevisionEntryId(latestRevisionMessage)
    : null;
  const latestRevisionStatus = latestRevisionMessage
    ? getEffectiveRevisionStatus(latestRevisionMessage)
    : null;
  const approvedConceptRevisionNeedingRepair = useMemo(() => {
    if (!approvedConceptAttachmentId) {
      return null;
    }

    return (
      revisionMessages.find(
        (message) =>
          message.revisionStatus !== "APPROVED" &&
          message.attachments?.some(
            (attachment) => attachment.id === approvedConceptAttachmentId,
          ),
      ) ?? null
    );
  }, [approvedConceptAttachmentId, revisionMessages]);

  useEffect(() => {
    if (
      !conceptMode?.canReview ||
      !approvedConceptAttachmentId ||
      !approvedConceptRevisionNeedingRepair
    ) {
      return;
    }

    const repairKey = `${conceptMode.folderId}:${approvedConceptAttachmentId}:${getRevisionEntryId(approvedConceptRevisionNeedingRepair)}`;

    if (legacyConceptApprovalRepairRef.current === repairKey) {
      return;
    }

    legacyConceptApprovalRepairRef.current = repairKey;
    const repairInput = {
      projectId: project.id,
      folderId: conceptMode.folderId,
      attachmentId: approvedConceptAttachmentId,
    };

    void (async () => {
      try {
        const result = isStageFourConceptMode
          ? await markStageFourFinalApprovedAttachmentAction(repairInput)
          : await markProjectConceptApprovedAttachmentAction(repairInput);

        if ("error" in result) {
          return;
        }

        router.refresh();
      } catch {
        // The effective approved state still prevents legacy rows from exposing review actions.
      }
    })();
  }, [
    approvedConceptAttachmentId,
    approvedConceptRevisionNeedingRepair,
    conceptMode,
    isStageFourConceptMode,
    project.id,
    router,
  ]);
  const latestRevisionLabel = latestRevisionMessage
    ? getRevisionLabel(latestRevisionMessage)
    : null;
  const hasPendingRevisionReview = latestRevisionStatus === "PENDING_REVIEW";
  const hasApprovedStageSubmission = latestRevisionStatus === "APPROVED";
  const pendingRevisionReviewMessage =
    hasPendingRevisionReview && latestRevisionMessage
      ? `${latestRevisionLabel} is already pending review. Please wait for the project owner to review it.`
      : defaultPendingRevisionReviewMessage;
  const revisionLabelById = useMemo(() => {
    const labels = new Map<string, string>();

    revisionMessages.forEach((entry) => {
      labels.set(getRevisionEntryId(entry), getRevisionLabel(entry));
    });

    return labels;
  }, [revisionMessages]);

  const activeStage = useMemo<ProjectStageRecord | undefined>(() => {
    if (!stageId) {
      return (
        stageCards.find((stage) => stage.id === project.currentStageId) ??
        stageCards[0]
      );
    }

    return stageCards.find((stage) => stage.id === stageId) ?? stageCards[0];
  }, [project.currentStageId, stageCards, stageId]);

  const loadCompletionData = useCallback(
    async (options?: { signal?: AbortSignal; showLoading?: boolean }) => {
      if (options?.showLoading) {
        setIsCompletionDataLoading(true);
      }

      const query = activeStage?.id
        ? `?stage=${encodeURIComponent(activeStage.id)}`
        : "";

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(project.id)}/completion${query}`,
          {
            cache: "no-store",
            signal: options?.signal,
          },
        );
        const payload = (await response.json()) as ProjectCompletionApiResponse;

        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload
              ? payload.error
              : "Unable to load project completion details.",
          );
        }

        if (options?.signal?.aborted) {
          return;
        }

        setCompletionData({
          summary: payload.completionSummary,
          workflow: payload.completionWorkflow,
        });
      } finally {
        if (!options?.signal?.aborted) {
          setIsCompletionDataLoading(false);
        }
      }
    },
    [activeStage?.id, project.id],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!deferCompletionData) {
      setCompletionData({
        summary: completionSummary,
        workflow: completionWorkflow,
      });
      setIsCompletionDataLoading(false);
      return () => controller.abort();
    }

    void loadCompletionData({
      signal: controller.signal,
      showLoading: false,
    })
      .catch((error) => {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    activeStage?.id,
    completionSummary,
    completionWorkflow,
    deferCompletionData,
    loadCompletionData,
  ]);

  const committedCollaboratorIds = useMemo(
    () =>
      collaborators
        .filter((collaborator) => collaborator.access !== "owner")
        .map((collaborator) => collaborator.id),
    [collaborators],
  );
  const selectedCollaboratorIds = collaboratorPickerOpen
    ? draftCollaboratorIds
    : committedCollaboratorIds;
  const currentUserDisplayName = useMemo(() => {
    const executor = project.executors.find(
      (candidate) => candidate.id === currentUserId,
    );

    if (executor) {
      return executor.name;
    }

    const collaborator = project.collaborators.find(
      (candidate) => candidate.id === currentUserId,
    );

    return collaborator?.name || "You";
  }, [currentUserId, project.collaborators, project.executors]);
  const isProjectOwner = useMemo(
    () =>
      project.collaborators.some(
        (collaborator) =>
          collaborator.access === "owner" && collaborator.id === currentUserId,
      ),
    [currentUserId, project.collaborators],
  );
  const canReviewSubmissions = conceptMode
    ? conceptMode.canReview && !conceptMode.isAssignedExecutor
    : project.ownerId === currentUserId;
  const canRevokeConceptApproval = Boolean(
    conceptMode?.approvalRevocationEligibility.canRevoke &&
      approvedConceptAttachmentId,
  );
  const isProjectCompleted = completionState.isCompleted;
  const isFinalStage =
    Boolean(activeStage?.id) && activeStage?.id === completionState.finalStageId;
  const canArchiveProject = !isConceptMode && project.ownerId === currentUserId;
  const canCompleteProject =
    canArchiveProject && completionState.canCompleteProject && !isProjectCompleted;
  const shouldExpectCompletionWorkflow =
    isProjectCompleted ||
    (!isProjectCompleted && completionState.allStagesCompleted);
  const shouldShowCompletionChecklist =
    Boolean(effectiveCompletionWorkflow) && shouldExpectCompletionWorkflow;
  const canUseProjectCompletionWorkflow =
    Boolean(effectiveCompletionWorkflow) &&
    !isProjectCompleted &&
    completionState.allStagesCompleted &&
    (effectiveCompletionWorkflow?.canManage ||
      effectiveCompletionWorkflow?.canUploadApprovalProof ||
      effectiveCompletionWorkflow?.canUploadCopyrightDocument ||
      effectiveCompletionWorkflow?.canUploadInvoice);
  const completionResolvedStepCount = effectiveCompletionWorkflow
    ? [
        effectiveCompletionWorkflow.approvalStatus,
        effectiveCompletionWorkflow.copyrightStatus,
        effectiveCompletionWorkflow.invoiceStatus,
      ].filter((status) => status === "COMPLETED" || status === "NOT_REQUIRED").length
    : 0;
  const completionVisibleBlockers = completionState.allStagesCompleted
    ? completionState.finalCompletionBlockers
    : completionState.incompleteStages.map(
        (stage) => `${stage.name} is ${stage.status.toLowerCase()}.`,
      );
  const showProjectCompletionStickyAction =
    !isConceptMode &&
    canUseProjectCompletionWorkflow &&
    Boolean(effectiveCompletionWorkflow);
  const projectCompletionStickyAction = (() => {
    if (
      effectiveCompletionWorkflow?.canUploadApprovalProof &&
      effectiveCompletionWorkflow.approvalStatus === "PENDING"
    ) {
      return {
        eyebrow: "Authority approval pending",
        title: "Upload the authority approval proof for this project.",
        detail: "Project Completion · Authority approval proof required",
        buttonLabel: "Upload Approval Proof",
      };
    }

    if (
      effectiveCompletionWorkflow?.canUploadCopyrightDocument &&
      effectiveCompletionWorkflow.copyrightStatus === "PENDING"
    ) {
      return {
        eyebrow: "Copyright transfer pending",
        title: "Upload the signed copyright transfer document.",
        detail: "Project Completion · Copyright transfer required",
        buttonLabel: "Upload Copyright",
      };
    }

    if (
      effectiveCompletionWorkflow?.canUploadInvoice &&
      effectiveCompletionWorkflow.invoiceStatus === "PENDING"
    ) {
      return {
        eyebrow: "Final invoice pending",
        title: "Upload the final invoice for this project.",
        detail: "Project Completion · Final invoice required",
        buttonLabel: "Upload Final Invoice",
      };
    }

    return {
      eyebrow: "Project ready for completion",
      title: "Complete the final checks before archiving this project.",
      detail: `Project Completion · ${completionResolvedStepCount} of 3 checks completed`,
      buttonLabel: "Start Completion Checklist",
    };
  })();
  const showProjectCompletionLockedNotice =
    !isConceptMode &&
    !isProjectCompleted &&
    !completionState.allStagesCompleted &&
    completionState.incompleteStages.length > 0 &&
    isProjectOwner;
  const isStageCompleted =
    isProjectCompleted ||
    activeStage?.status === "completed" ||
    Boolean(isConceptMode && approvedConceptAttachmentId);
  const isChatReadOnly = isProjectCompleted || isStageCompleted;
  const stageInvoiceAttachment = activeStage?.invoiceAttachment ?? null;
  const isProjectExecutor = useMemo(
    () =>
      conceptMode
        ? conceptMode.isAssignedExecutor
        : project.executors.some((executor) => executor.id === currentUserId),
    [conceptMode, currentUserId, project.executors],
  );
  const canSubmitWorkAsProjectExecutor = isProjectExecutor;
  const stageInvoiceRequired = Boolean(activeStage?.invoiceRequired);
  const stageInvoiceRequest = activeStage?.invoiceRequest ?? null;
  const stageInvoiceMissing =
    stageInvoiceRequired && !stageInvoiceAttachment && !isStageCompleted && !isProjectCompleted;
  const hasOfficialStageSubmission =
    stageRevisionCount > 0 ||
    revisionMessages.some((message) => !message.id.startsWith("optimistic-revision-"));
  const isRequestedStageInvoiceUploader =
    Boolean(stageInvoiceRequest) && stageInvoiceRequest?.requestedFromId === currentUserId;
  const canUploadStageInvoice =
    !isConceptMode &&
    Boolean(activeStage?.id) &&
    stageInvoiceRequired &&
    !stageInvoiceAttachment &&
    isRequestedStageInvoiceUploader &&
    !isStageCompleted &&
    !isProjectCompleted;
  const isStageInvoiceUploader =
    Boolean(stageInvoiceAttachment) &&
    isCurrentUserDisplayName(
      stageInvoiceAttachment?.uploadedBy ?? "",
      currentUserDisplayName,
    );
  const canUseStageInvoiceFileActions =
    Boolean(stageInvoiceAttachment) &&
    (isProjectOwner ||
      canReviewSubmissions ||
      isRequestedStageInvoiceUploader ||
      isStageInvoiceUploader);
  const canRequestStageInvoice =
    !isConceptMode && isProjectOwner && stageInvoiceMissing && hasApprovedStageSubmission;
  const showPostApprovalInvoiceAction =
    canRequestStageInvoice && !stageInvoiceRequest && !isStageCompleted;
  const canCompleteStageAfterInvoice =
    isProjectOwner &&
    hasApprovedStageSubmission &&
    Boolean(stageInvoiceAttachment) &&
    !isStageCompleted &&
    !isProjectCompleted;
  const showInvoiceUploadedNextAction =
    !isConceptMode &&
    Boolean(stageInvoiceAttachment) &&
    (isProjectOwner || canReviewSubmissions) &&
    !completionState.allStagesCompleted &&
    !isStageCompleted &&
    !isProjectCompleted;
  const invoiceRequestCandidates = useMemo(() => {
    const candidateByUserId = new Map<
      string,
      {
        id: string;
        name: string;
        email?: string;
        role: string;
        rank: number;
      }
    >();
    const addCandidate = (candidate: {
      id: string;
      name: string;
      email?: string;
      role: string;
      rank: number;
    }) => {
      const existing = candidateByUserId.get(candidate.id);

      if (!existing || candidate.rank < existing.rank) {
        candidateByUserId.set(candidate.id, candidate);
      }
    };

    executors.forEach((executor) => {
        addCandidate({
          id: executor.id,
          name: executor.name,
          email: executor.email,
          role: "Executor",
          rank: 0,
        });
      });

    return [...candidateByUserId.values()].sort(
      (left, right) => left.rank - right.rank || left.name.localeCompare(right.name),
    );
  }, [executors]);
  const hasAcceptedBrief = Boolean(activeStage?.actualStartedAtValue);
  const latestRevisionAllowsNewSubmission =
    !latestRevisionMessage || latestRevisionStatus === "REJECTED";
  const canSubmitNewRevision =
    canSubmitWorkAsProjectExecutor &&
    hasAcceptedBrief &&
    latestRevisionAllowsNewSubmission &&
    activeStage?.status !== "pending" &&
    !isStageCompleted &&
    !isProjectCompleted &&
    !hasPendingRevisionReview;
  const submitWorkDisabledReason = !canSubmitWorkAsProjectExecutor
    ? null
    : !activeStage
      ? "No active stage selected."
      : isStageCompleted
        ? isStageNeutralConceptMode
          ? "Concept work is completed."
          : "Stage is completed."
        : isProjectCompleted
          ? "Project is completed."
          : activeStage.status === "pending"
            ? isStageNeutralConceptMode
              ? "Concept work is pending."
              : "Stage is pending."
            : !hasAcceptedBrief
              ? "Accept the brief before submitting work."
              : hasPendingRevisionReview
                ? pendingRevisionReviewMessage
                : null;
  const showSubmitWorkAction =
    canSubmitWorkAsProjectExecutor &&
    Boolean(activeStage) &&
    !isStageCompleted &&
    !isProjectCompleted;
  const projectBriefText = isConceptMode ? "" : project.description.trim();
  const stageBriefText = activeStage?.description.trim() ?? "";
  const projectBriefAttachments = isConceptMode ? [] : project.attachments;
  const stageBriefAttachments = activeStage?.briefAttachments ?? [];
  const hasRevisionEntries = displayedMessages.some((message) => message.kind === "revision");
  const hasBriefAcceptedSystemMessage = displayedMessages.some(
    (message) =>
      message.kind === "system" &&
      (message.title ?? "").toLowerCase() === "brief accepted",
  );
  const hasAcceptedBriefInTimeline =
    hasAcceptedBrief || hasBriefAcceptedSystemMessage;
  const showBriefAcceptancePrompt = !hasAcceptedBriefInTimeline;
  const hasBriefContext =
    projectBriefText.length > 0 ||
    stageBriefText.length > 0 ||
    projectBriefAttachments.length > 0 ||
    stageBriefAttachments.length > 0;
  const canAcceptCurrentStageBrief =
    Boolean(activeStage) &&
    isProjectExecutor &&
    !isProjectCompleted &&
    !isStageCompleted &&
    activeStage?.status !== "pending" &&
    showBriefAcceptancePrompt;
  const showBriefContextCard =
    Boolean(activeStage) &&
    showBriefAcceptancePrompt &&
    hasBriefContext &&
    !isProjectCompleted &&
    !isStageCompleted &&
    activeStage?.status !== "pending";
  const stageExecutionStatus = isStageCompleted
    ? "Completed"
    : hasAcceptedBriefInTimeline
      ? "In progress"
      : isProjectExecutor
        ? "Brief acceptance required"
        : "Waiting for project executor to accept brief";
  const briefAcceptanceWaitingTitle = isProjectExecutor
    ? "Brief acceptance required"
    : "Waiting for project executor";
  const briefAcceptanceWaitingBody = isProjectExecutor
    ? isStageNeutralConceptMode
      ? "You need to accept the brief before submitting concept work."
      : "You need to accept the brief before submitting work for this stage."
    : "Waiting for project executor to accept brief.";
  const selectedOutputLanguage =
    getSupportedLanguageByCode(selectedOutputLanguageCode) ?? DEFAULT_CHAT_LANGUAGE;
  const currentUserDisplayCode = useMemo(
    () => getInitials(currentUserDisplayName),
    [currentUserDisplayName],
  );
  const currentUserRoleLabel = useMemo(() => {
    const executor = project.executors.find(
      (candidate) => candidate.id === currentUserId,
    );

    if (executor) {
      return executor.roleLabel;
    }

    const collaborator = project.collaborators.find(
      (candidate) => candidate.id === currentUserId,
    );

    if (!collaborator) {
      return "Internal Team";
    }

    return collaborator.group === "external" ? "External Collaborator" : "Internal Team";
  }, [currentUserId, project.collaborators, project.executors]);
  const getInvoiceRequestTimelineBody = useCallback(() => {
    if (!stageInvoiceRequest) {
      return null;
    }

    if (stageInvoiceRequest.requestedFromId === currentUserId) {
      return "Invoice requested from you. Please upload the invoice for this completed stage.";
    }

    const recipientName = getActorDisplayName(
      stageInvoiceRequest.requestedFromName,
      currentUserDisplayName,
    );
    const isRequesterOrPrivilegedViewer =
      stageInvoiceRequest.requestedById === currentUserId ||
      isProjectOwner ||
      currentUserRoleLabel.toLowerCase().includes("admin");

    return isRequesterOrPrivilegedViewer
      ? `Invoice requested from ${recipientName}. Waiting for invoice upload.`
      : `Invoice requested from ${recipientName}.`;
  }, [
    currentUserDisplayName,
    currentUserId,
    currentUserRoleLabel,
    isProjectOwner,
    stageInvoiceRequest,
  ]);
  const getInvoiceUploadedTimelineBody = useCallback(
    (message: DisplayChatEntry) => {
      const stageName = activeStage?.label ?? "this stage";

      if (
        message.authorId === currentUserId ||
        isCurrentUserDisplayName(message.author, currentUserDisplayName)
      ) {
        return `You uploaded invoice for ${stageName}.`;
      }

      const actorName = getActorDisplayName(message.author, currentUserDisplayName);
      const canSeeNamedActor =
        isProjectOwner || currentUserRoleLabel.toLowerCase().includes("admin");

      return canSeeNamedActor
        ? `${actorName} uploaded invoice for ${stageName}.`
        : `Invoice uploaded by ${actorName}.`;
    },
    [
      activeStage?.label,
      currentUserDisplayName,
      currentUserId,
      currentUserRoleLabel,
      isProjectOwner,
    ],
  );

  const getVisibleSystemBody = useCallback(
    (message: DisplayChatEntry) => {
      if (message.title === "Invoice requested") {
        return getInvoiceRequestTimelineBody() ?? message.body;
      }

      if (message.title === "Invoice uploaded") {
        return getInvoiceUploadedTimelineBody(message);
      }

      return replaceCurrentUserNameInText(
        message.body,
        message.author,
        currentUserDisplayName,
      );
    },
    [
      currentUserDisplayName,
      getInvoiceRequestTimelineBody,
      getInvoiceUploadedTimelineBody,
    ],
  );

  const getStageChatTranslationSegments = useCallback(
    (message: DisplayChatEntry) => {
      if (message.deletedAt) {
        return [];
      }

      const segments: StageChatTranslationSegment[] = [];
      const addSegment = (field: string, text: string | null | undefined) => {
        const segment = buildStageChatTranslationSegment(message.id, field, text);

        if (segment) {
          segments.push(segment);
        }
      };

      if (message.kind === "system") {
        addSegment("title", message.title ?? "Project activity");
        addSegment("body", getVisibleSystemBody(message));
        addSegment("revisionRequestReason", message.revisionRequestReason);
        return segments;
      }

      if (message.kind === "revision") {
        const revisionEntryId = getRevisionEntryId(message);
        const reviewOverride = revisionReviewOverrides[revisionEntryId];
        const revisionStatus = getEffectiveRevisionStatus(message);
        const revisionStatusMeta = getRevisionStatusMeta(revisionStatus);

        addSegment("workSubmittedLabel", "Work submitted");
        addSegment("statusLabel", revisionStatusMeta.label);
        addSegment("revisionLabel", getRevisionLabel(message));
        addSegment(
          "submittedByLine",
          `Submitted by ${getActorDisplayName(message.author, currentUserDisplayName)} · ${
            message.role
          }`,
        );
        addSegment("revisionNoteLabel", "Revision note");
        addSegment("body", message.body);
        addSegment("submittedFilesLabel", "Submitted files");
        addSegment(
          "rejectionReason",
          reviewOverride?.rejectionReason ?? message.rejectionReason,
        );
        return segments;
      }

      if (message.kind === "caption") {
        addSegment("captionAddedLabel", "Caption added");
        addSegment("body", message.body);
        addSegment("submissionLabel", message.caption?.submissionLabel);
        addSegment("captionBody", message.caption?.body);
        addSegment(
          "pinnedAtLabel",
          `Pinned at ${message.caption?.xPercent.toFixed(1) ?? "0.0"}%, ${
            message.caption?.yPercent.toFixed(1) ?? "0.0"
          }%`,
        );
        addSegment("viewCaptionLabel", "View Caption");
        return segments;
      }

      if (message.kind === "comparison") {
        addSegment("comparisonSubmittedLabel", "Comparison submitted");
        addSegment("body", message.body);
        addSegment("baseLabel", "Base");
        addSegment("compareLabel", "Compare");
        addSegment(
          "pinnedAtLabel",
          `Pinned at ${message.comparison?.xPercent.toFixed(1) ?? "0.0"}%, ${
            message.comparison?.yPercent.toFixed(1) ?? "0.0"
          }%`,
        );
        addSegment("viewComparisonLabel", "View Comparison");
        return segments;
      }

      if (message.revisionId) {
        addSegment("commentOnRevisionLabel", "Comment on revision");
      }

      if (message.attachments?.length) {
        const hasSubmissionAttachment =
          message.attachments.some((attachment) => attachment.isSubmission) ?? false;

        addSegment(
          "attachmentLabel",
          hasSubmissionAttachment ? "Submission uploaded" : "Attachment uploaded",
        );
      }

      addSegment("body", message.body);
      return segments;
    },
    [
      currentUserDisplayName,
      getEffectiveRevisionStatus,
      getVisibleSystemBody,
      revisionReviewOverrides,
    ],
  );

  const getTranslatedStageChatText = useCallback(
    (entryId: string, field: string, sourceText: string) => {
      if (!translateAllEnabled) {
        return sourceText;
      }

      const translation =
        stageChatTranslations[buildStageChatTranslationSegmentId(entryId, field)];

      return translation?.targetLanguageCode === selectedOutputLanguage.code
        ? translation.translatedText
        : sourceText;
    },
    [
      selectedOutputLanguage.code,
      stageChatTranslations,
      translateAllEnabled,
    ],
  );

  const requestStageChatTranslations = useCallback(
    async (segments: StageChatTranslationSegment[]) => {
      const uniqueSegments = Array.from(
        new Map(
          segments
            .filter((segment) => {
              const cached = stageChatTranslations[segment.id];

              return (
                !pendingTranslateAllSegmentIdsRef.current.has(segment.id) &&
                cached?.targetLanguageCode !== selectedOutputLanguage.code
              );
            })
            .map((segment) => [segment.id, segment]),
        ).values(),
      );

      if (uniqueSegments.length === 0) {
        return;
      }

      uniqueSegments.forEach((segment) => {
        pendingTranslateAllSegmentIdsRef.current.add(segment.id);
      });

      const requestId = translateAllRequestIdRef.current + 1;
      translateAllRequestIdRef.current = requestId;
      setTranslateAllError(null);
      setIsTranslatingAll(true);

      try {
        const response = await fetch("/api/ai/translate-batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: uniqueSegments,
            targetLanguageCode: selectedOutputLanguage.code,
            targetLanguageName: selectedOutputLanguage.name,
            projectId: project.id,
            stageId: activeStage?.id ?? project.currentStageId ?? undefined,
          }),
        });

        const payload = (await response.json()) as TranslateBatchApiResponse;

        if (!response.ok || !payload.translations) {
          throw new Error(payload.error || "Unable to translate the conversation right now.");
        }

        setStageChatTranslations((current) => {
          const next = { ...current };

          for (const translation of payload.translations ?? []) {
            next[translation.id] = {
              targetLanguageCode: translation.targetLanguageCode,
              translatedText: translation.translatedText,
            };
          }

          return next;
        });
      } catch (error) {
        setTranslateAllError(
          error instanceof Error
            ? error.message
            : "Unable to translate the conversation right now.",
        );
      } finally {
        uniqueSegments.forEach((segment) => {
          pendingTranslateAllSegmentIdsRef.current.delete(segment.id);
        });

        if (requestId === translateAllRequestIdRef.current) {
          setIsTranslatingAll(false);
        }
      }
    },
    [
      activeStage?.id,
      project.currentStageId,
      project.id,
      selectedOutputLanguage.code,
      selectedOutputLanguage.name,
      stageChatTranslations,
    ],
  );

  const translateAllLoadedMessages = useCallback(() => {
    const segments = displayedMessages.flatMap((message) =>
      getStageChatTranslationSegments(message),
    );

    void requestStageChatTranslations(segments);
  }, [
    displayedMessages,
    getStageChatTranslationSegments,
    requestStageChatTranslations,
  ]);

  function handleTranslateAllToggle() {
    if (translateAllEnabled) {
      setTranslateAllEnabled(false);
      setTranslateAllError(null);
      return;
    }

    setTranslateAllEnabled(true);
    setTranslateAllError(null);
    void loadAllEarlierMessagesForTranslateAll();
    translateAllLoadedMessages();
  }

  useEffect(() => {
    if (!translateAllEnabled) {
      return;
    }

    translateAllLoadedMessages();
  }, [
    displayedMessages,
    selectedOutputLanguage.code,
    translateAllEnabled,
    translateAllLoadedMessages,
  ]);
  const stageStartSystemMessage = useMemo<DisplayChatEntry | null>(() => {
    if (!activeStage?.actualStartedAtValue || hasBriefAcceptedSystemMessage) {
      return null;
    }

    const actorName = activeStage.startedByName ?? "project executor";
    const displayActorName = getActorDisplayName(actorName, currentUserDisplayName);

    return {
      id: `stage-started-${activeStage.id}`,
      kind: "system",
      title: "Brief accepted",
      author: actorName,
      role: "project executor",
      body: isStageNeutralConceptMode
        ? `${displayActorName} accepted the concept brief and started work on this concept.`
        : `${displayActorName} accepted the project and stage brief and started work on this stage.`,
      createdAt: activeStage.actualStartedAt,
    };
  }, [
    activeStage,
    currentUserDisplayName,
    hasBriefAcceptedSystemMessage,
    isStageNeutralConceptMode,
  ]);
  const getParticipantRoleLabel = useCallback(
    (userId: string) => {
      if (userId === currentUserId) {
        return currentUserRoleLabel;
      }

      const executor = project.executors.find((candidate) => candidate.id === userId);

      if (executor) {
        return executor.roleLabel;
      }

      const collaborator = project.collaborators.find(
        (candidate) => candidate.id === userId,
      );

      if (!collaborator) {
        return isStageNeutralConceptMode ? "Project Team" : "Stage Chat";
      }

      return collaborator.group === "external"
        ? "External Collaborator"
        : "Internal Team";
    },
    [
      currentUserId,
      currentUserRoleLabel,
      isStageNeutralConceptMode,
      project.collaborators,
      project.executors,
    ],
  );
  const hasLocalOrConfirmedRealtimeMessage = useCallback(
    (clientTempId: string) => {
      if (
        confirmedClientTempIdsRef.current.has(clientTempId) ||
        failedClientTempIdsRef.current.has(clientTempId)
      ) {
        return true;
      }

      return (
        loadedHistoryEntries.some((entry) => entry.id === clientTempId) ||
        optimisticComments.some(
          (entry) => entry.id === clientTempId || entry.serverEntryId === clientTempId,
        ) ||
        confirmedComments.some(
          (entry) => entry.id === clientTempId || entry.serverEntryId === clientTempId,
        )
      );
    },
    [confirmedComments, loadedHistoryEntries, optimisticComments],
  );
  const buildPendingRealtimeEntry = useCallback(
    (payload: StageChatRealtimeMessagePendingPayload): DisplayChatEntry => {
      const createdAtMs = Date.parse(payload.createdAt);

      return {
        id: payload.clientTempId,
        kind: "comment",
        author: payload.senderDisplayName.trim() || payload.senderDisplayCode || "User",
        authorId: payload.senderId,
        authorAvatarSrc: null,
        role: getParticipantRoleLabel(payload.senderId),
        body: payload.body,
        mentions: [],
        createdAt: "Sending…",
        isOptimistic: true,
        optimisticStatus: "sending",
        localCreatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
        attachments: [],
      };
    },
    [getParticipantRoleLabel],
  );
  const markStalePendingTextMessages = useCallback(() => {
    const cutoff = Date.now() - STAGE_CHAT_PENDING_TIMEOUT_MS;

    setOptimisticComments((current) =>
      current.map((entry) => {
        const isPendingTextComment =
          entry.kind === "comment" &&
          entry.optimisticStatus === "sending" &&
          !entry.serverEntryId &&
          (entry.attachments?.length ?? 0) === 0;

        if (!isPendingTextComment || (entry.localCreatedAtMs ?? Date.now()) >= cutoff) {
          return entry;
        }

        failedClientTempIdsRef.current.add(entry.id);

        return {
          ...entry,
          createdAt: "Failed",
          optimisticStatus: "failed",
        };
      }),
    );
  }, []);
  const scrollToChatBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    chatBottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);
  const scrollToCompletionWorkflow = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const scrollToTarget = () => {
        completionWorkflowRef.current?.scrollIntoView({
          block: "start",
          behavior,
        });
      };

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scrollToTarget);
      });
    },
    [],
  );
  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nextIsNearBottom = distanceFromBottom < 160;
    setIsNearChatBottom(nextIsNearBottom);

    if (nextIsNearBottom) {
      setNewRealtimeMessageCount(0);
    }
  }, []);
  const mergeServerChatEntry = useCallback(
    (
      entry: ProjectChatEntry,
      options: { clientTempId?: string | null; countAsNew?: boolean } = {},
    ) => {
      if (options.clientTempId) {
        confirmedClientTempIdsRef.current.add(options.clientTempId);
        failedClientTempIdsRef.current.delete(options.clientTempId);
      }

      setLoadedHistoryEntries((current) => {
        const existingIndex = current.findIndex((candidate) => candidate.id === entry.id);

        if (existingIndex >= 0) {
          const next = [...current];
          next[existingIndex] = {
            ...current[existingIndex],
            ...entry,
          };
          return next;
        }

        return [...current, entry];
      });
      setOptimisticComments((current) =>
        current.filter(
          (candidate) =>
            candidate.id !== options.clientTempId &&
            candidate.serverEntryId !== entry.id,
        ),
      );
      setConfirmedComments((current) =>
        current.filter((candidate) => candidate.serverEntryId !== entry.id),
      );

      if (entry.deletedAt) {
        setDeletedMessageOverrides((current) => ({
          ...current,
          [entry.id]: {
            deletedAt: entry.deletedAt ?? new Date().toISOString(),
            deletedByUserId: entry.deletedByUserId ?? null,
            displayText: DELETED_STAGE_CHAT_MESSAGE_TEXT,
          },
        }));
      }

      if (options.countAsNew && !isNearChatBottom && entry.authorId !== currentUserId) {
        setNewRealtimeMessageCount((current) => current + 1);
      }
    },
    [currentUserId, isNearChatBottom],
  );
  const applyRealtimeDeletedMessage = useCallback(
    (payload: StageChatRealtimeMessageDeletedPayload) => {
      setDeletedMessageOverrides((current) => ({
        ...current,
        [payload.commentId]: {
          deletedAt: payload.deletedAt,
          deletedByUserId: payload.deletedByUserId,
          displayText: DELETED_STAGE_CHAT_MESSAGE_TEXT,
        },
      }));
      setLoadedHistoryEntries((current) =>
        current.map((entry) =>
          entry.id === payload.commentId
            ? {
                ...entry,
                body: DELETED_STAGE_CHAT_MESSAGE_TEXT,
                deletedAt: payload.deletedAt,
                deletedByUserId: payload.deletedByUserId,
                canDeleteUntil: null,
                mentions: [],
                attachments: [],
              }
            : entry,
        ),
      );
      setOptimisticComments((current) =>
        current.filter((entry) => entry.serverEntryId !== payload.commentId),
      );
      setConfirmedComments((current) =>
        current.filter((entry) => entry.serverEntryId !== payload.commentId),
      );
    },
    [],
  );
  const handleRealtimeMessagePending = useCallback(
    (payload: StageChatRealtimeMessagePendingPayload) => {
      if (payload.projectId !== project.id || payload.stageId !== activeStage?.id) {
        return;
      }

      if (hasLocalOrConfirmedRealtimeMessage(payload.clientTempId)) {
        return;
      }

      const pendingEntry = buildPendingRealtimeEntry(payload);

      setOptimisticComments((current) => {
        if (
          current.some(
            (entry) =>
              entry.id === payload.clientTempId ||
              entry.serverEntryId === payload.clientTempId,
          ) ||
          confirmedClientTempIdsRef.current.has(payload.clientTempId) ||
          failedClientTempIdsRef.current.has(payload.clientTempId)
        ) {
          return current;
        }

        return [...current, pendingEntry];
      });

      if (payload.senderId !== currentUserId && !isNearChatBottom) {
        setNewRealtimeMessageCount((current) => current + 1);
      }
    },
    [
      activeStage?.id,
      buildPendingRealtimeEntry,
      currentUserId,
      hasLocalOrConfirmedRealtimeMessage,
      isNearChatBottom,
      project.id,
    ],
  );
  const handleRealtimeMessageCreated = useCallback(
    (payload: StageChatRealtimeMessageCreatedPayload) => {
      if (payload.projectId !== project.id || payload.stageId !== activeStage?.id) {
        return;
      }

      mergeServerChatEntry(payload.entry, {
        clientTempId: payload.clientTempId,
        countAsNew: true,
      });
      setRealtimeWatermark(payload.createdAt);

      if (isInvoiceUploadedEntry(payload.entry)) {
        startRefresh(() => {
          router.refresh();
        });
        return;
      }

      if (
        payload.entry.kind === "system" &&
        (payload.entry.title === "Brief accepted" ||
          payload.entry.title === "Invoice requested")
      ) {
        startRefresh(() => {
          router.refresh();
        });
      }
    },
    [
      activeStage?.id,
      mergeServerChatEntry,
      project.id,
      router,
      startRefresh,
    ],
  );
  const handleRealtimeMessageFailed = useCallback(
    (payload: StageChatRealtimeMessageFailedPayload) => {
      if (payload.projectId !== project.id || payload.stageId !== activeStage?.id) {
        return;
      }

      if (confirmedClientTempIdsRef.current.has(payload.clientTempId)) {
        return;
      }

      failedClientTempIdsRef.current.add(payload.clientTempId);

      setOptimisticComments((current) =>
        current.map((entry) => {
          if (
            entry.id !== payload.clientTempId ||
            entry.serverEntryId ||
            entry.authorId !== payload.senderId
          ) {
            return entry;
          }

          return {
            ...entry,
            body:
              payload.senderId === currentUserId
                ? entry.body
                : "Message failed to send.",
            createdAt: "Failed",
            optimisticStatus: "failed",
          };
        }),
      );
    },
    [activeStage?.id, currentUserId, project.id],
  );
  const handleRealtimeMessageDeleted = useCallback(
    (payload: StageChatRealtimeMessageDeletedPayload) => {
      if (payload.projectId !== project.id || payload.stageId !== activeStage?.id) {
        return;
      }

      applyRealtimeDeletedMessage(payload);
      setRealtimeWatermark(payload.deletedAt);
    },
    [activeStage?.id, applyRealtimeDeletedMessage, project.id],
  );

  const reconcileStageChat = useCallback(async () => {
    const activeStageId = activeStage?.id;

    if (!activeStageId) {
      return;
    }

    const params = new URLSearchParams({
      limit: "50",
    });

    if (realtimeWatermark) {
      params.set("after", realtimeWatermark);
    }

    const response = await fetch(
      `/api/projects/${encodeURIComponent(project.id)}/stages/${encodeURIComponent(
        activeStageId,
      )}/chat/updates?${params.toString()}`,
      {
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as StageChatUpdatesApiResponse;

    if (!response.ok || "error" in payload) {
      throw new Error(
        "error" in payload ? payload.error : "Unable to load chat updates.",
      );
    }

    const hasInvoiceUploadEntry = payload.entries.some(isInvoiceUploadedEntry);

    payload.entries.forEach((entry) => {
      mergeServerChatEntry(entry, { countAsNew: false });
    });
    if (hasInvoiceUploadEntry) {
      startRefresh(() => {
        router.refresh();
      });
    }
    markStalePendingTextMessages();
    setRealtimeWatermark(payload.watermark);
  }, [
    activeStage?.id,
    markStalePendingTextMessages,
    mergeServerChatEntry,
    project.id,
    realtimeWatermark,
    router,
    startRefresh,
  ]);
  const handleRealtimeTimelineUpdated = useCallback(
    (payload: StageChatRealtimeTimelineUpdatedPayload) => {
      if (payload.projectId !== project.id || payload.stageId !== activeStage?.id) {
        return;
      }

      void reconcileStageChat();
      if (payload.eventType === "completion_updated") {
        void loadCompletionData({ showLoading: false });
        return;
      }

      startRefresh(() => {
        router.refresh();
      });
    },
    [
      activeStage?.id,
      loadCompletionData,
      project.id,
      reconcileStageChat,
      router,
      startRefresh,
    ],
  );
  const mentionableParticipants = useMemo<ProjectMentionParticipantRecord[]>(
    () =>
      project.mentionParticipants.filter(
        (participant) =>
          participant.id !== currentUserId && !participant.chatVisibilityPaused,
      ),
    [currentUserId, project.mentionParticipants],
  );
  const {
    realtimeEnabled,
    connectionState: realtimeConnectionState,
    onlineUsers,
    typingUsers,
    notifyTypingActivity,
    publishTypingStopped,
    publishPendingMessage,
    publishFailedMessage,
  } = useStageChatRealtime({
    projectId: project.id,
    stageId: activeStage?.id,
    currentUserId,
    currentUserDisplayName,
    currentUserDisplayCode,
    onMessagePending: handleRealtimeMessagePending,
    onMessageCreated: handleRealtimeMessageCreated,
    onMessageFailed: handleRealtimeMessageFailed,
    onMessageDeleted: handleRealtimeMessageDeleted,
    onTimelineUpdated: handleRealtimeTimelineUpdated,
    onReconcile: reconcileStageChat,
  });
  const typingIndicatorText = useMemo(() => {
    if (typingUsers.length === 0) {
      return null;
    }

    if (typingUsers.length === 1) {
      return `${typingUsers[0].displayName} is typing...`;
    }

    if (typingUsers.length === 2) {
      return `${typingUsers[0].displayName} and ${typingUsers[1].displayName} are typing...`;
    }

    return `${typingUsers[0].displayName} and ${typingUsers.length - 1} others are typing...`;
  }, [typingUsers]);
  const realtimeStatusLabel = useMemo(() => {
    if (!realtimeEnabled) {
      return "Realtime disabled";
    }

    if (realtimeConnectionState === "connected") {
      return "Live";
    }

    if (
      realtimeConnectionState === "failed" ||
      realtimeConnectionState === "closed" ||
      realtimeConnectionState === "suspended"
    ) {
      return "Live chat unavailable";
    }

    return "Connecting live chat";
  }, [realtimeConnectionState, realtimeEnabled]);
  const mentionTriggerState = useMemo(
    () => getMentionTriggerState(draft, draftSelectionStart),
    [draft, draftSelectionStart],
  );
  const mentionSuggestions = useMemo(() => {
    if (!mentionTriggerState) {
      return [];
    }

    const query = mentionTriggerState.query.trim().toLowerCase();

    return mentionableParticipants.filter((participant) => {
      if (!query) {
        return true;
      }

      return (
        participant.name.toLowerCase().includes(query) ||
        participant.email?.toLowerCase().includes(query)
      );
    });
  }, [mentionTriggerState, mentionableParticipants]);
  const mentionDropdownOpen = mentionSuggestions.length > 0 && Boolean(mentionTriggerState);
  const safeActiveMentionIndex =
    mentionDropdownOpen && mentionSuggestions.length > 0
      ? Math.min(activeMentionIndex, mentionSuggestions.length - 1)
      : 0;
  const reviewRevisionMessage = useMemo(
    () =>
      reviewRevisionId
        ? displayedMessages.find(
            (entry) =>
              entry.kind === "revision" && getRevisionEntryId(entry) === reviewRevisionId,
          )
        : undefined,
    [displayedMessages, reviewRevisionId],
  );
  const canSelectStageFourFinalApprovedFile = Boolean(
    reviewRevisionMessage &&
      isStageFourConceptMode &&
      conceptMode?.canReview &&
      !conceptMode.isWorkflowCompleted &&
      getEffectiveRevisionStatus(reviewRevisionMessage) !== "REJECTED",
  );
  const selectedConceptApprovalCandidate =
    reviewRevisionMessage?.attachments?.find(
      (attachment) => attachment.id === selectedConceptApprovalCandidateId,
    ) ?? null;
  const reviewCompletionIsFinalStage =
    Boolean(activeStage?.id) && activeStage?.id === completionState.finalStageId;
  const canReviewLatestRevision =
    Boolean(latestRevisionMessage) &&
    !isProjectCompleted &&
    canReviewSubmissions &&
    latestRevisionMessage?.authorId !== currentUserId &&
    latestRevisionStatus === "PENDING_REVIEW";
  const canMarkLatestRevisionComplete =
    Boolean(latestRevisionMessage) &&
    isProjectOwner &&
    latestRevisionStatus === "APPROVED" &&
    !isFinalStage &&
    !isStageCompleted &&
    !isProjectCompleted;
  const showLatestRevisionActionBar =
    Boolean(latestRevisionMessage) &&
    ((!isStageCompleted && !isProjectCompleted) ||
      (isConceptMode && canCompareSubmissions));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (isNearChatBottom) {
        scrollToChatBottom("auto");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeStage?.id,
    displayedMessages,
    stageStartSystemMessage,
    pendingCommentFiles.length,
    replyingToRevision?.revisionId,
    composerError,
    aiStatus,
    typingIndicatorText,
    isNearChatBottom,
    scrollToChatBottom,
  ]);

  useEffect(() => {
    if (!mentionDropdownOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!mentionDropdownRef.current?.contains(event.target as Node)) {
        setActiveMentionIndex(0);
        setDraftSelectionStart(-1);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [mentionDropdownOpen]);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        window.clearTimeout(recordingTimeoutRef.current);
      }

      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    };
  }, []);

  function applyUpdatedCollaborators(updatedCollaborators: ProjectCollaboratorRecord[]) {
    setCollaborators((current) => {
      const owner = current.find((collaborator) => collaborator.access === "owner");
      return owner ? [owner, ...updatedCollaborators] : updatedCollaborators;
    });
    setExecutors((current) =>
      current.map((executor) => {
        const updatedExecutor = updatedCollaborators.find(
          (collaborator) => collaborator.id === executor.id,
        );

        return updatedExecutor
          ? {
              ...executor,
              chatVisibilityPaused: updatedExecutor.chatVisibilityPaused,
            }
          : executor;
      }),
    );
  }

  async function removeCollaborator(id: string) {
    setCollaboratorSaving(true);
    setCollaboratorDialogError(undefined);

    try {
      const result = await removeProjectCollaboratorAction(project.id, id);

      if ("error" in result) {
        throw new Error(result.error);
      }

      applyUpdatedCollaborators(result.collaborators);
      showSuccessToast("Collaborator removed successfully.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to remove the collaborator right now.";
      setCollaboratorDialogError(message);
      showErrorToast("Unable to remove collaborator.", message);
    } finally {
      setCollaboratorSaving(false);
    }
  }

  async function handleCollaboratorChatVisibilityToggle(
    collaboratorId: string,
    paused: boolean,
  ) {
    setCollaboratorSaving(true);
    setCollaboratorDialogError(undefined);

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
      showSuccessToast(
        paused ? "Chat visibility paused." : "Chat visibility resumed.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update collaborator chat visibility right now.";
      setCollaboratorDialogError(message);
      showErrorToast(
        paused ? "Unable to pause chat visibility." : "Unable to resume chat visibility.",
        message,
      );
    } finally {
      setCollaboratorSaving(false);
    }
  }

  function setCollaboratorFormValue<K extends keyof CollaboratorForm>(
    field: K,
    value: CollaboratorForm[K],
  ) {
    setCollaboratorForm((current) => ({ ...current, [field]: value }));
  }

  function openCollaboratorInvite() {
    setCollaboratorPickerOpen(false);
    setDraftCollaboratorIds([]);
    setCollaboratorForm({
      name: "",
      email: "",
    });
    setCollaboratorDialogError(undefined);
    setCollaboratorDialogOpen(true);
  }

  async function openCollaboratorPicker() {
    setCollaboratorDialogError(undefined);
    setDraftCollaboratorIds(committedCollaboratorIds);
    setCollaboratorSaving(true);

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/collaborators/available`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as AvailableCollaboratorsApiResponse;

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Unable to load collaborators.",
        );
      }

      setAvailableCollaboratorRecords(payload.collaborators);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load collaborators right now.";
      setCollaboratorDialogError(message);
      showErrorToast("Unable to load collaborators.", message);
      return;
    } finally {
      setCollaboratorSaving(false);
    }

    setCollaboratorPickerOpen(true);
  }

  function toggleAssignedCollaborator(collaboratorId: string) {
    const availableCollaborator = availableCollaboratorRecords.find(
      (collaborator) => collaborator.id === collaboratorId,
    );

    if (!availableCollaborator) {
      return;
    }

    setDraftCollaboratorIds((current) => {
      const exists = current.includes(collaboratorId);

      if (exists) {
        return current.filter((id) => id !== collaboratorId);
      }

      return [...current, collaboratorId];
    });
  }

  function buildCollaboratorSelection(selectedIds: string[]) {
    const committedCollaboratorMap = new Map(
      collaborators
        .filter((collaborator) => collaborator.access !== "owner")
        .map((collaborator) => [collaborator.id, collaborator] as const),
    );
    const availableCollaboratorMap = new Map(
      availableCollaboratorRecords.map((collaborator) => [collaborator.id, collaborator] as const),
    );

    return selectedIds.reduce<ProjectCollaboratorRecord[]>((selection, collaboratorId) => {
      const committedCollaborator = committedCollaboratorMap.get(collaboratorId);

      if (committedCollaborator) {
        selection.push(committedCollaborator);
        return selection;
      }

      const availableCollaborator = availableCollaboratorMap.get(collaboratorId);

      if (!availableCollaborator) {
        return selection;
      }

      selection.push({
        id: availableCollaborator.id,
        name: availableCollaborator.name,
        email: availableCollaborator.email,
        role: "Project Participant",
        group: "internal",
        ...normalizeProjectCollaboratorPermissions(null),
        chatVisibilityPaused: false,
        access: "view",
        removable: true,
      });

      return selection;
    }, []);
  }

  async function applyCollaboratorsSelection() {
    setCollaboratorSaving(true);
    setCollaboratorDialogError(undefined);

    const nextCollaborators = buildCollaboratorSelection(draftCollaboratorIds);

    try {
      const result = await saveProjectCollaboratorsAction(
        project.id,
        nextCollaborators.map((collaborator) => ({
          id: collaborator.id,
          ...normalizeProjectCollaboratorPermissions(collaborator),
        })),
      );

      if ("error" in result) {
        setCollaboratorDialogError(result.error);
        showErrorToast("Unable to update collaborators.", result.error);
        return;
      }

      applyUpdatedCollaborators(result.collaborators);
      setCollaboratorPickerOpen(false);
      setDraftCollaboratorIds([]);
      setCollaboratorDialogError(undefined);
      showSuccessToast("Project collaborators updated successfully.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update project collaborators right now.";
      setCollaboratorDialogError(message);
      showErrorToast("Unable to update collaborators.", message);
    } finally {
      setCollaboratorSaving(false);
    }
  }

  async function handleCollaboratorInvite() {
    if (!collaboratorForm.name.trim() || !collaboratorForm.email.trim()) {
      setCollaboratorDialogError("Enter both collaborator name and email.");
      return;
    }

    setCollaboratorSaving(true);
    setCollaboratorDialogError(undefined);

    try {
      const inviteResult = await saveCollaboratorAction({
        ...collaboratorForm,
      });

      if ("error" in inviteResult) {
        setCollaboratorDialogError(inviteResult.error);
        showErrorToast("Unable to add collaborator.", inviteResult.error);
        return;
      }

      setAvailableCollaboratorRecords((current) => [
        ...current,
        inviteResult.collaborator,
      ]);

      const saveResult = await saveProjectCollaboratorsAction(project.id, [
        ...collaborators
          .filter((collaborator) => collaborator.access !== "owner")
          .map((collaborator) => ({
            id: collaborator.id,
            ...normalizeProjectCollaboratorPermissions(collaborator),
          })),
        {
          id: inviteResult.collaborator.id,
          ...normalizeProjectCollaboratorPermissions(null),
        },
      ]);

      if ("error" in saveResult) {
        setCollaboratorDialogError(saveResult.error);
        showErrorToast("Unable to add collaborator.", saveResult.error);
        return;
      }

      applyUpdatedCollaborators(saveResult.collaborators);
      setCollaboratorDialogOpen(false);
      showSuccessToast("Collaborator added successfully.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save the collaborator right now. Please try again.";
      setCollaboratorDialogError(message);
      showErrorToast("Unable to add collaborator.", message);
    } finally {
      setCollaboratorSaving(false);
    }
  }

  function refreshHistory() {
    startRefresh(() => {
      router.refresh();
    });
  }

  function navigateToStage(nextStageId: string) {
    setCompletionPrompt(null);
    router.push(
      `/projects/${encodeURIComponent(project.id)}/chat?stage=${encodeURIComponent(nextStageId)}`,
    );
    window.requestAnimationFrame(() => {
      chatScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function loadEarlierMessages() {
    const activeStageId = activeStage?.id;

    if (!activeStageId || !olderMessagesCursor || isLoadingEarlierMessages) {
      return;
    }

    setIsLoadingEarlierMessages(true);
    setOlderMessagesError(null);

    try {
      const params = new URLSearchParams({
        cursor: olderMessagesCursor,
        limit: "30",
      });
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/stages/${encodeURIComponent(
          activeStageId,
        )}/chat/messages?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as StageChatMessagesApiResponse;

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Unable to load earlier messages.",
        );
      }

      setLoadedHistoryEntries((current) => {
        const currentIds = new Set(current.map((entry) => entry.id));
        const earlierEntries = payload.entries.filter(
          (entry) => !currentIds.has(entry.id),
        );

        return [...earlierEntries, ...current];
      });
      setOlderMessagesCursor(payload.nextCursor);
      setHasEarlierMessages(Boolean(payload.hasMore && payload.nextCursor));
      if (typeof payload.revisionCount === "number") {
        setStageRevisionCount(payload.revisionCount);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load earlier messages.";
      setOlderMessagesError(message);
    } finally {
      setIsLoadingEarlierMessages(false);
    }
  }

  async function loadAllEarlierMessagesForTranslateAll() {
    const activeStageId = activeStage?.id;

    if (!activeStageId || !olderMessagesCursor || isLoadingEarlierMessages) {
      return;
    }

    setIsLoadingEarlierMessages(true);
    setOlderMessagesError(null);

    try {
      let cursor: string | null = olderMessagesCursor;
      let hasMorePages = true;
      let pageCount = 0;
      const allEarlierEntries: ProjectChatEntry[] = [];
      let nextRevisionCount: number | null = null;

      while (cursor && hasMorePages && pageCount < 20) {
        pageCount += 1;
        const params = new URLSearchParams({
          cursor,
          limit: "50",
        });
        const response = await fetch(
          `/api/projects/${encodeURIComponent(project.id)}/stages/${encodeURIComponent(
            activeStageId,
          )}/chat/messages?${params.toString()}`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as StageChatMessagesApiResponse;

        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload ? payload.error : "Unable to load earlier messages.",
          );
        }

        allEarlierEntries.push(...payload.entries);
        cursor = payload.nextCursor;
        hasMorePages = Boolean(payload.hasMore && payload.nextCursor);

        if (typeof payload.revisionCount === "number") {
          nextRevisionCount = payload.revisionCount;
        }
      }

      setLoadedHistoryEntries((current) => {
        const currentIds = new Set(current.map((entry) => entry.id));
        const earlierEntries = allEarlierEntries.filter(
          (entry) => !currentIds.has(entry.id),
        );

        return [...earlierEntries, ...current];
      });
      setOlderMessagesCursor(cursor);
      setHasEarlierMessages(Boolean(hasMorePages && cursor));

      if (nextRevisionCount !== null) {
        setStageRevisionCount(nextRevisionCount);
      }

      if (hasMorePages && cursor) {
        setTranslateAllError(
          "Some older messages were not loaded yet. Click Translate All again to continue.",
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load earlier messages.";
      setOlderMessagesError(message);
      setTranslateAllError(message);
    } finally {
      setIsLoadingEarlierMessages(false);
    }
  }

  function resetDraftComposerHeight() {
    const input = draftInputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.overflowY = "hidden";
  }

  function getServerCommentId(message: DisplayChatEntry) {
    return message.serverEntryId ?? (message.isOptimistic ? null : message.id);
  }

  function canDeleteMessage(message: DisplayChatEntry, isCurrentUserMessage: boolean) {
    if (
      message.kind !== "comment" ||
      !isCurrentUserMessage ||
      message.deletedAt ||
      message.isOptimistic
    ) {
      return false;
    }

    if (!getServerCommentId(message) || !message.canDeleteUntil) {
      return false;
    }

    const deleteUntilMs = Date.parse(message.canDeleteUntil);

    return Number.isFinite(deleteUntilMs) && deleteMenuNow <= deleteUntilMs;
  }

  function openDeleteMessageDialog(message: DisplayChatEntry) {
    setDeleteMessageTarget(message);
    setDeleteMessageError(null);
  }

  async function handleConfirmDeleteMessage() {
    const target = deleteMessageTarget;
    const activeStageId = activeStage?.id;
    const commentId = target ? getServerCommentId(target) : null;

    if (!target || !commentId || !activeStageId) {
      setDeleteMessageError("This message could not be resolved.");
      return;
    }

    const deletedAt = new Date().toISOString();

    setIsDeletingMessage(true);
    setDeleteMessageError(null);
    setDeletedMessageOverrides((current) => ({
      ...current,
      [commentId]: {
        deletedAt,
        deletedByUserId: currentUserId,
        displayText: DELETED_STAGE_CHAT_MESSAGE_TEXT,
      },
    }));

    try {
      const result = await deleteStageCommentAction({
        projectId: project.id,
        stageId: activeStageId,
        commentId,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      setDeletedMessageOverrides((current) => ({
        ...current,
        [commentId]: {
          deletedAt: result.deletedAt,
          deletedByUserId: result.deletedByUserId,
          displayText: result.displayText,
        },
      }));
      setDeleteMessageTarget(null);
      showSuccessToast("Message deleted.");
    } catch (error) {
      setDeletedMessageOverrides((current) => {
        const next = { ...current };
        delete next[commentId];
        return next;
      });

      const message =
        error instanceof Error ? error.message : "Unable to delete the message right now.";
      setDeleteMessageError(message);
      showErrorToast("Unable to delete message.", message);
    } finally {
      setIsDeletingMessage(false);
    }
  }

  function resetProjectCompletionFlow() {
    setProjectCompletionError(null);
    setArchiveCompletionError(null);
    setArchivePreparation(null);
    setArchiveWizardStep(0);
    setArchiveFileNames({});
    setArchiveFileErrors({});
    setArchiveMetadataDrafts({});
    setArchiveCategoryId("");
  }

  function updateArchiveFileName(sourceAttachmentId: string, nextValue: string) {
    setArchiveFileNames((current) => {
      const nextNames = {
        ...current,
        [sourceAttachmentId]: nextValue,
      };

      if (archivePreparation) {
        const file = archivePreparation.files.find(
          (candidate) => candidate.sourceAttachmentId === sourceAttachmentId,
        );

        if (file) {
          const otherNames = archivePreparation.files
            .filter((candidate) => candidate.sourceAttachmentId !== sourceAttachmentId)
            .map(
              (candidate) =>
                nextNames[candidate.sourceAttachmentId] ?? candidate.defaultArchiveFileName,
            );
          const nextError = getArchiveFileNameError(
            file.originalFileName,
            nextValue,
            otherNames,
          );

          setArchiveFileErrors((currentErrors) => ({
            ...currentErrors,
            [sourceAttachmentId]: nextError ?? "",
          }));
        }
      }

      return nextNames;
    });
  }

  function updateArchiveMetadataField(
    sourceAttachmentId: string,
    field: keyof ArchiveArtworkMetadataDraft,
    value: string,
  ) {
    setArchiveMetadataDrafts((current) => {
      const currentDraft = current[sourceAttachmentId];

      if (!currentDraft) {
        return current;
      }

      return {
        ...current,
        [sourceAttachmentId]: {
          ...currentDraft,
          [field]: value,
        },
      };
    });
  }

  function applyProjectMetadataToAllArchiveFiles() {
    if (!archivePreparation || archivePreparation.files.length === 0) {
      return;
    }

    const firstDraft =
      archiveMetadataDrafts[archivePreparation.files[0].sourceAttachmentId] ??
      archivePreparation.files[0].metadataDraft;

    setArchiveMetadataDrafts((current) =>
      Object.fromEntries(
        archivePreparation.files.map((file) => {
          const existingDraft = current[file.sourceAttachmentId] ?? file.metadataDraft;

          return [
            file.sourceAttachmentId,
            {
              ...existingDraft,
              languageMarket: firstDraft.languageMarket,
              artworkType: firstDraft.artworkType,
              brandSubBrand: firstDraft.brandSubBrand,
              productSku: firstDraft.productSku,
              campaignProject: firstDraft.campaignProject,
              colourSpace: firstDraft.colourSpace,
              printProcess: firstDraft.printProcess,
              specialFinishes: firstDraft.specialFinishes,
              archiveStatus: firstDraft.archiveStatus,
              clientBrandOwner: firstDraft.clientBrandOwner,
              regulatoryClearance: firstDraft.regulatoryClearance,
              fontsUsed: firstDraft.fontsUsed,
              imagesPhotography: firstDraft.imagesPhotography,
              illustrationsIcons: firstDraft.illustrationsIcons,
              colourCodes: firstDraft.colourCodes,
              thirdPartyLogosIp: firstDraft.thirdPartyLogosIp,
              supplierPrinter: firstDraft.supplierPrinter,
              printProofRef: firstDraft.printProofRef,
              packagingDielineRef: firstDraft.packagingDielineRef,
              relatedArtworks: firstDraft.relatedArtworks,
              briefSpecLink: firstDraft.briefSpecLink,
              generalNotes: firstDraft.generalNotes,
            },
          ];
        }),
      ),
    );
  }

  async function handlePrepareProjectCompletion() {
    const finalStageId = completionState.finalStageId;

    if (!finalStageId) {
      setProjectCompletionError("This project does not have a final stage.");
      return;
    }

    setProjectCompletionError(null);
    setArchiveCompletionError(null);
    setIsPreparingProjectCompletion(true);

    try {
      const result = await prepareProjectCompletionAction({
        projectId: project.id,
        stageId: finalStageId,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      setArchivePreparation(result.preparation);
      setArchiveCategoryId(result.preparation.selectedCategoryId);
      setArchiveFileNames(
        Object.fromEntries(
          result.preparation.files.map((file) => [
            file.sourceAttachmentId,
            file.defaultArchiveFileName,
          ]),
        ),
      );
      setArchiveMetadataDrafts(
        Object.fromEntries(
          result.preparation.files.map((file) => [
            file.sourceAttachmentId,
            file.metadataDraft,
          ]),
        ),
      );
      setArchiveFileErrors({});
      setArchiveWizardStep(0);
      setCompletionChecklistOpen(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to prepare the archive files right now.";
      setProjectCompletionError(message);
      showErrorToast("Unable to prepare project archive.", message);
    } finally {
      setIsPreparingProjectCompletion(false);
    }
  }

  async function handleCompleteProjectArchive() {
    if (!archivePreparation) {
      return;
    }

    const nextErrors = archivePreparation.files.reduce<Record<string, string>>(
      (current, file) => {
        const nextName =
          archiveFileNames[file.sourceAttachmentId] ?? file.defaultArchiveFileName;
        const otherNames = archivePreparation.files
          .filter((candidate) => candidate.sourceAttachmentId !== file.sourceAttachmentId)
          .map(
            (candidate) =>
              archiveFileNames[candidate.sourceAttachmentId] ??
              candidate.defaultArchiveFileName,
          );
        const error = getArchiveFileNameError(
          file.originalFileName,
          nextName,
          otherNames,
        );

        current[file.sourceAttachmentId] = error ?? "";
        return current;
      },
      {},
    );

    setArchiveFileErrors(nextErrors);

    if (!archiveCategoryId) {
      setArchiveCompletionError(
        archivePreparation.categories.length === 0
          ? "Create an archive category before archiving final files."
          : "Choose an archive category before continuing.",
      );
      return;
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setArchiveCompletionError("Fix the archive file names before continuing.");
      setArchiveWizardStep(0);
      return;
    }

    const missingMetadataByFile = archivePreparation.files
      .map((file) => {
        const metadata = archiveMetadataDrafts[file.sourceAttachmentId] ?? file.metadataDraft;
        const missingGroups = getArchiveMetadataMissingGroups(metadata);

        return {
          file,
          missingGroups,
        };
      })
      .filter((item) => item.missingGroups.length > 0);

    if (missingMetadataByFile.length > 0) {
      setArchiveCompletionError(
        `Complete archive metadata before archiving. ${missingMetadataByFile[0].file.originalFileName} is missing ${missingMetadataByFile[0].missingGroups
          .map((group) => `${group.section}: ${group.fields.join(", ")}`)
          .join("; ")}.`,
      );
      setArchiveWizardStep(1);
      return;
    }

    setArchiveCompletionError(null);
    setIsCompletingProject(true);

    try {
      const result = await completeProjectArchiveAction({
        projectId: archivePreparation.projectId,
        stageId: archivePreparation.finalStageId,
        archiveCategoryId,
        files: archivePreparation.files.map((file) => ({
          sourceAttachmentId: file.sourceAttachmentId,
          finalArchiveFileName:
            archiveFileNames[file.sourceAttachmentId] ?? file.defaultArchiveFileName,
          artworkMetadata: archiveMetadataDrafts[file.sourceAttachmentId] ?? file.metadataDraft,
        })),
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      setCompletionOverrides((current) => ({
        ...(current ?? {}),
        isCompleted: true,
        canCompleteProject: false,
      }));
      resetProjectCompletionFlow();
      showSuccessToast("Project archived.");
      refreshHistory();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to complete and archive the project right now.";
      setArchiveCompletionError(message);
      showErrorToast("Archive failed.", message);
    } finally {
      setIsCompletingProject(false);
    }
  }

  function closeRevisionReviewDialog() {
    setPendingRevisionReviewId(null);
    setReviewRevisionId(null);
    setReviewCompleteDialogOpen(false);
    setReviewRejectMode(false);
    setReviewRejectReason("");
    setReviewDialogError(null);
    setSelectedConceptApprovalCandidateId(null);
  }

  function clearConceptApprovalSelection() {
    setConceptApprovalError(null);
    setSelectedConceptApprovalCandidateId(null);
  }

  function updateOptimisticAttachment(
    commentId: string,
    attachmentId: string,
    updater: (attachment: DisplayAttachmentRecord) => DisplayAttachmentRecord,
  ) {
    setOptimisticComments((current) =>
      current.map((entry) =>
        entry.id === commentId
          ? {
              ...entry,
              attachments: entry.attachments?.map((attachment: DisplayAttachmentRecord) =>
                attachment.id === attachmentId ? updater(attachment) : attachment,
              ),
            }
          : entry,
      ),
    );
  }

  function updateOptimisticComment(
    commentId: string,
    updater: (entry: DisplayChatEntry) => DisplayChatEntry,
  ) {
    setOptimisticComments((current) =>
      current.map((entry) => (entry.id === commentId ? updater(entry) : entry)),
    );
  }

  function clearRecorderResources() {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    audioChunksRef.current = [];
  }

  const translateDraftText = useCallback(async (
    sourceText: string,
    options: { mode: "manual" | "auto" },
  ) => {
    const normalizedSourceText = sourceText.trim();

    if (!normalizedSourceText) {
      setComposerError("Enter a message to translate.");
      return;
    }

    const requestId = translationRequestIdRef.current + 1;
    translationRequestIdRef.current = requestId;
    setComposerError(null);
    setAiStatus(options.mode === "auto" ? "Updating translation…" : "Translating…");
    setIsTranslating(true);

    try {
      const response = await fetch("/api/ai/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: sourceText,
          targetLanguageCode: selectedOutputLanguage.code,
          targetLanguageName: selectedOutputLanguage.name,
          projectId: project.id,
          stageId: activeStage?.id ?? project.currentStageId ?? undefined,
        }),
      });

      const payload = (await response.json()) as TranslateApiResponse;

      if (!response.ok || !payload.translatedText) {
        throw new Error(payload.error || "Unable to translate the message right now.");
      }

      if (
        requestId !== translationRequestIdRef.current ||
        draftRef.current !== sourceText
      ) {
        return;
      }

      lastAppliedTranslationRef.current = {
        sourceText,
        translatedText: payload.translatedText,
        targetLanguageCode: selectedOutputLanguage.code,
      };
      setAutoTranslateDraft(true);
      setDraft(payload.translatedText);
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Unable to translate the message right now.",
      );
    } finally {
      if (requestId === translationRequestIdRef.current) {
        setIsTranslating(false);
        setAiStatus(null);
      }
    }
  }, [
    activeStage?.id,
    project.currentStageId,
    project.id,
    selectedOutputLanguage.code,
    selectedOutputLanguage.name,
  ]);

  async function handleTranslateDraft() {
    await translateDraftText(draft, { mode: "manual" });
  }

  useEffect(() => {
    if (!autoTranslateDraft || isListening || isTranscribing) {
      return;
    }

    if (autoTranslateTimeoutRef.current) {
      window.clearTimeout(autoTranslateTimeoutRef.current);
      autoTranslateTimeoutRef.current = null;
    }

    const text = draft.trim();
    const lastTranslation = lastAppliedTranslationRef.current;

    if (!text) {
      lastAppliedTranslationRef.current = null;
      setAutoTranslateDraft(false);
      return;
    }

    if (
      lastTranslation &&
      lastTranslation.targetLanguageCode === selectedOutputLanguageCode &&
      lastTranslation.translatedText === draft
    ) {
      return;
    }

    autoTranslateTimeoutRef.current = window.setTimeout(() => {
      void translateDraftText(draft, { mode: "auto" });
    }, AUTO_TRANSLATE_DEBOUNCE_MS);

    return () => {
      if (autoTranslateTimeoutRef.current) {
        window.clearTimeout(autoTranslateTimeoutRef.current);
        autoTranslateTimeoutRef.current = null;
      }
    };
  }, [
    autoTranslateDraft,
    draft,
    isListening,
    isTranscribing,
    selectedOutputLanguageCode,
    translateDraftText,
  ]);

  function getRecordingMimeType() {
    if (typeof MediaRecorder === "undefined") {
      return "";
    }

    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];

    return (
      preferredTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
    );
  }

  async function handleRecordedAudio(blob: Blob) {
    const extension = blob.type.includes("mp4")
      ? "m4a"
      : blob.type.includes("ogg")
        ? "ogg"
        : "webm";
    const audioFile = new File([blob], `stage-chat-${Date.now()}.${extension}`, {
      type: blob.type || "audio/webm",
    });

    setIsTranscribing(true);
    setAiStatus("Transcribing…");
    setComposerError(null);

    try {
      const formData = new FormData();
      formData.append("audio", audioFile);
      formData.append("targetLanguageCode", selectedOutputLanguage.code);
      formData.append("targetLanguageName", selectedOutputLanguage.name);
      formData.append("projectId", project.id);
      formData.append("stageId", activeStage?.id ?? project.currentStageId ?? "");

      const response = await fetch("/api/ai/transcribe", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as TranscribeApiResponse;

      if (!response.ok || !payload.translatedText) {
        throw new Error(payload.error || "Unable to transcribe the recording right now.");
      }

      setDraft((current) =>
        current.trim() ? `${current.trim()}\n${payload.translatedText}` : payload.translatedText,
      );
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Unable to transcribe the recording right now.",
      );
    } finally {
      setIsTranscribing(false);
      setAiStatus(null);
    }
  }

  async function handleMicrophoneToggle() {
    if (isTranscribing || isTranslating) {
      return;
    }

    if (isListening) {
      setAiStatus("Transcribing…");
      mediaRecorderRef.current?.stop();
      return;
    }

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setComposerError(
        "Voice input is not supported in this browser. Try Chrome, Edge, or Safari with microphone access enabled.",
      );
      return;
    }

    try {
      setComposerError(null);
      setAiStatus("Requesting microphone…");

      if ("permissions" in navigator && navigator.permissions?.query) {
        try {
          const permissionStatus = await navigator.permissions.query({
            name: "microphone" as PermissionName,
          });

          if (permissionStatus.state === "denied") {
            setAiStatus(null);
            setComposerError(
              "Microphone permission is blocked in the browser. Allow microphone access in site settings and try again.",
            );
            return;
          }
        } catch {
          // Permission query support varies by browser. Continue to getUserMedia.
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      setAiStatus("Listening…");
      setIsListening(true);

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        setIsListening(false);
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        clearRecorderResources();

        if (!audioBlob.size) {
          setAiStatus(null);
          setComposerError("No speech was captured. Please try again.");
          return;
        }

        void handleRecordedAudio(audioBlob);
      });

      try {
        recorder.start();
      } catch (error) {
        clearRecorderResources();
        setIsListening(false);
        setAiStatus(null);
        setComposerError(
          error instanceof Error
            ? error.message
            : "Unable to start microphone recording right now.",
        );
        return;
      }

      recordingTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          setAiStatus("Transcribing…");
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_DURATION_MS);
    } catch (error) {
      setIsListening(false);
      setAiStatus(null);
      clearRecorderResources();
      setComposerError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No microphone was found on this device."
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "The microphone is already being used by another application."
          : "Unable to access the microphone right now.",
      );
    }
  }

  function openRevisionDialog() {
    if (!canSubmitWorkAsProjectExecutor) {
      const message = "Only a project executor can submit work for review.";
      setComposerError(message);
      showErrorToast("Unable to submit work.", message);
      return;
    }

    if (isProjectCompleted) {
      const message = "This project has already been completed.";
      setComposerError(message);
      showErrorToast("Unable to submit work.", message);
      return;
    }

    if (isStageCompleted) {
      const message = "This stage is already completed.";
      setComposerError(message);
      showErrorToast("Unable to submit work.", message);
      return;
    }

    if (!hasAcceptedBrief) {
      const message = "Please accept the brief before submitting work.";
      setComposerError(message);
      showErrorToast("Unable to submit work.", message);
      return;
    }

    if (hasPendingRevisionReview) {
      setComposerError(pendingRevisionReviewMessage);
      showErrorToast("Unable to submit work.", pendingRevisionReviewMessage);
      return;
    }

    setRevisionDialogError(null);
    setRevisionSummary("");
    setPendingRevisionFiles([]);
    setRevisionDialogOpen(true);
  }

  function handleRevisionFilesSelected(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    const allowedExtensions = getStageSubmissionAllowedExtensions(project.category);
    const invalidFile = selectedFiles.find(
      (file) =>
        !isAllowedStageSubmissionFile({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          projectCategory: project.category,
        }),
    );

    if (invalidFile) {
      setRevisionDialogError(
        formatUploadFileTypeError(
          buildFileTypeNotAllowedPayload({
            fileName: invalidFile.name,
            mimeType: invalidFile.type || "application/octet-stream",
            allowedExtensions,
            error: "Formal stage submissions must use a supported file format.",
          }),
        ),
      );
      return;
    }

    setRevisionDialogError(null);
    setPendingRevisionFiles((current) => [
      ...current,
      ...selectedFiles.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
      })),
    ]);

    if (revisionFileInputRef.current) {
      revisionFileInputRef.current.value = "";
    }

    if (revisionDialogFileInputRef.current) {
      revisionDialogFileInputRef.current.value = "";
    }
  }

  function openRevisionFilePicker() {
    if (revisionDialogOpen && revisionDialogFileInputRef.current) {
      revisionDialogFileInputRef.current.click();
      return;
    }

    revisionFileInputRef.current?.click();
  }

  function removePendingRevisionFile(fileId: string) {
    setPendingRevisionFiles((current) => current.filter((file) => file.id !== fileId));
  }

  function applyStageCompletionLocally(completedStageId: string) {
    const completedStage = stageCards.find((stage) => stage.id === completedStageId);
    const stageIndex = stageCards.findIndex((stage) => stage.id === completedStageId);
    const nextStage = stageIndex >= 0 ? stageCards[stageIndex + 1] ?? null : null;
    const allStagesCompleted = !nextStage;

    setStageCardOverrides((current) => ({
      ...current,
      ...(completedStage
        ? {
            [completedStageId]: {
              ...(current[completedStageId] ?? {}),
              actualStartedAt:
                current[completedStageId]?.actualStartedAt ?? completedStage.actualStartedAt,
              actualStartedAtValue:
                current[completedStageId]?.actualStartedAtValue ??
                completedStage.actualStartedAtValue,
              startedByName:
                current[completedStageId]?.startedByName ?? completedStage.startedByName,
              status: "completed",
            },
          }
        : {}),
      ...(nextStage
        ? {
            [nextStage.id]: {
              ...(current[nextStage.id] ?? {}),
              actualStartedAt:
                current[nextStage.id]?.actualStartedAt ?? nextStage.actualStartedAt,
              actualStartedAtValue:
                current[nextStage.id]?.actualStartedAtValue ?? nextStage.actualStartedAtValue,
              startedByName:
                current[nextStage.id]?.startedByName ?? nextStage.startedByName,
              status: nextStage.status === "pending" ? "in-progress" : nextStage.status,
            },
          }
        : {}),
    }));

    if (allStagesCompleted) {
      setCompletionOverrides((current) => ({
        ...(current ?? {}),
        allStagesCompleted: true,
        incompleteStages: completionState.incompleteStages.filter(
          (stage) => stage.id !== completedStageId,
        ),
        isSelectedStageFinal:
          completionState.isSelectedStageFinal ||
          completedStageId === completionState.finalStageId,
      }));
    }

    setCompletionPrompt({
      nextStageId: nextStage?.id ?? null,
      nextStageLabel: nextStage?.label ?? null,
      allStagesCompleted,
    });

    return {
      allStagesCompleted,
      nextStageId: nextStage?.id ?? null,
    };
  }

  async function handleMarkStageComplete() {
    const activeStageId = activeStage?.id;

    if (!activeStageId) {
      setStageCompleteError("This project does not have an active stage.");
      return;
    }

    if (isProjectCompleted) {
      setStageCompleteError("This project has already been completed.");
      return;
    }

    setStageCompleteError(null);
    setIsMarkingStageComplete(true);

    try {
      const result = await markStageCompleteAction({
        projectId: project.id,
        stageId: activeStageId,
      });

      if ("error" in result) {
        setStageCompleteError(
          result.error ?? "Unable to mark this stage as complete right now.",
        );
        showErrorToast(
          "Unable to mark stage complete.",
          result.error ?? "Unable to mark this stage as complete right now.",
        );
        return;
      }

      applyStageCompletionLocally(activeStageId);
      setStageCompleteDialogOpen(false);
      showSuccessToast("Stage marked as complete.");
      scrollToCompletionWorkflow();
      refreshHistory();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to mark this stage as complete right now.";
      setStageCompleteError(message);
      showErrorToast("Unable to mark stage complete.", message);
    } finally {
      setIsMarkingStageComplete(false);
    }
  }

  async function handleAcceptBrief() {
    const activeStageId = activeStage?.id;

    if (!activeStageId) {
      setAcceptBriefError("This project does not have an active stage.");
      return;
    }

    if (isProjectCompleted) {
      setAcceptBriefError("This project has already been completed.");
      return;
    }

    setAcceptBriefError(null);
    setIsAcceptingBrief(true);

    try {
      const result = await acceptStageBriefAction({
        projectId: project.id,
        stageId: activeStageId,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      const startedAtValue = result.result.stage.actualStartedAt
        ? new Date(result.result.stage.actualStartedAt).toISOString()
        : null;
      const startedAtLabel = startedAtValue
        ? formatLocalStageDateTime(startedAtValue)
        : "Just now";

      setStageCardOverrides((current) => ({
        ...current,
        [activeStageId]: {
          actualStartedAt: startedAtLabel,
          actualStartedAtValue: startedAtValue,
          startedByName: currentUserDisplayName,
          status: "in-progress",
        },
      }));
      setConfirmedComments((current) => [
        ...current,
        {
          id: `confirmed-comment-${result.result.activityComment.id}`,
          serverEntryId: result.result.activityComment.id,
          kind: "system",
          title: "Brief accepted",
          author: currentUserDisplayName,
          authorId: currentUserId,
          authorAvatarSrc: currentUserAvatarSrc,
          role: currentUserRoleLabel,
          body: result.result.activityComment.body,
          createdAt: "Just now",
          localCreatedAtMs: Date.now(),
        },
      ]);
      setAcceptBriefDialogOpen(false);
      showSuccessToast("Brief accepted. Stage timer started.");
      refreshHistory();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to accept the brief right now.";
      setAcceptBriefError(message);
      showErrorToast("Unable to accept brief.", message);
    } finally {
      setIsAcceptingBrief(false);
    }
  }

  function openCommentUploadDialog() {
    if (isProjectCompleted) {
      const message = "This project has already been completed.";
      setComposerError(message);
      showErrorToast("Unable to upload files.", message);
      return;
    }

    if (isStageCompleted) {
      const message = "This stage has already been completed. Chat is read-only.";
      setComposerError(message);
      showErrorToast("Unable to upload files.", message);
      return;
    }

    setComposerError(null);
    setCommentUploadIntent("COMMENT_ATTACHMENT");
    setCommentUploadDialogOpen(true);
  }

  function openCaptionDialog(
    attachment: CaptionDialogAttachment,
    captionId?: string | null,
  ) {
    setCaptionDialogAttachment(attachment);
    setCaptionDialogInitialCaptionId(captionId ?? null);
  }

  function closeCaptionDialog() {
    setCaptionDialogAttachment(null);
    setCaptionDialogInitialCaptionId(null);
  }

  function handleCommentFilesSelected(files: File[] | FileList | null) {
    const selectedFiles = Array.isArray(files) ? files : Array.from(files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    if (isProjectCompleted) {
      const message = "This project has already been completed.";
      setComposerError(message);
      showErrorToast("Unable to upload files.", message);
      return;
    }

    if (isStageCompleted) {
      const message = "This stage has already been completed. Chat is read-only.";
      setComposerError(message);
      showErrorToast("Unable to upload files.", message);
      return;
    }

    const selectedAssetType: CommentUploadIntent = "COMMENT_ATTACHMENT";

    setComposerError(null);
    setPendingCommentFiles((current) => [
      ...current,
      ...selectedFiles.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        assetType: selectedAssetType,
      })),
    ]);
    setCommentUploadDialogOpen(false);
  }

  function removePendingCommentFile(fileId: string) {
    setPendingCommentFiles((current) => current.filter((file) => file.id !== fileId));
  }

  function openRevisionReview(revisionEntryId: string) {
    setReviewDialogError(null);
    setReviewRejectMode(false);
    setReviewCompleteDialogOpen(false);
    setReviewRejectReason("");
    setSelectedConceptApprovalCandidateId(null);
    setReviewRevisionId(revisionEntryId);
  }

  function openConceptApprovalConfirmation(
    attachment: DisplayAttachmentRecord,
  ) {
    setConceptApprovalError(null);
    setConceptApprovalTarget(attachment);
  }

  async function confirmConceptApproval() {
    if (!conceptMode || !conceptApprovalTarget) {
      return;
    }

    setConceptApprovalError(null);
    setApprovingConceptAttachmentId(conceptApprovalTarget.id);

    try {
      const actionInput = {
        projectId: project.id,
        folderId: conceptMode.folderId,
        attachmentId: conceptApprovalTarget.id,
      };
      const result = isStageFourConceptMode
        ? await markStageFourFinalApprovedAttachmentAction(actionInput)
        : await markProjectConceptApprovedAttachmentAction(actionInput);

      if ("error" in result) {
        throw new Error(result.error);
      }

      setApprovedConceptAttachmentId(result.attachment.id);
      setRevisionReviewOverrides((current) => ({
        ...current,
        [result.revisionId]: {
          status: "APPROVED",
          rejectionReason: null,
          reviewedBy: currentUserDisplayName,
          reviewedAt: "Just now",
        },
      }));
      setConceptApprovalTarget(null);
      closeRevisionReviewDialog();

      showSuccessToast(
        result.changed
          ? "Submission approved. Return to the concept list to create another concept or continue manually."
          : `This submission is already approved as the ${approvedFileLabel}.`,
      );
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to approve this concept file right now.";
      setConceptApprovalError(message);
    } finally {
      setApprovingConceptAttachmentId(null);
    }
  }

  async function confirmConceptApprovalRevocation() {
    if (!conceptMode || !approvedConceptAttachmentId) {
      return;
    }

    setRevokeConceptApprovalError(null);
    setRevokingConceptApproval(true);

    try {
      const actionInput = {
        projectId: project.id,
        folderId: conceptMode.folderId,
      };
      const result = isStageFourConceptMode
        ? await revokeStageFourFinalApprovedAttachmentAction(actionInput)
        : await revokeProjectConceptApprovedAttachmentAction(actionInput);

      if ("error" in result) {
        throw new Error(result.error);
      }

      setApprovedConceptAttachmentId(null);
      setRevisionReviewOverrides((current) => ({
        ...current,
        [result.revisionId]: {
          status: "PENDING_REVIEW",
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      }));
      setRevokeConceptApprovalOpen(false);
      closeRevisionReviewDialog();
      showSuccessToast(
        "Approval revoked.",
        result.resetThroughStageFive
          ? isStageFourConceptMode
            ? "Stage 4 reopened for rework. Stage 5 was relocked, and work tied to the revoked final file was reset."
            : "Stage 3 reopened for rework. Its dependent Stage 4 approval and Stage 5 handoff were reset."
          : `${approvedFileLabel} was returned to Pending Review.`,
      );
      router.refresh();
    } catch (error) {
      setRevokeConceptApprovalError(
        error instanceof Error
          ? error.message
          : "Unable to revoke this approval right now.",
      );
    } finally {
      setRevokingConceptApproval(false);
    }
  }

  function startRevisionReply(message: DisplayChatEntry) {
    if (isChatReadOnly) {
      setComposerError(
        isProjectCompleted
          ? "This project has already been completed."
          : "This stage has already been completed. Chat is read-only.",
      );
      return;
    }

    const revisionId = message.revisionId ?? getRevisionEntryId(message);
    const label = getRevisionLabel(message);

    setReplyingToRevision({ revisionId, label });
    setComposerError(null);

    window.requestAnimationFrame(() => {
      draftInputRef.current?.focus();
    });
  }

  function handleSelectMention(participant: ProjectMentionParticipantRecord) {
    if (!mentionTriggerState) {
      return;
    }

    const mentionText = `@${participant.name}`;
    const textBeforeMention = draft.slice(0, mentionTriggerState.start);
    const textAfterMention = draft.slice(mentionTriggerState.end);
    const needsTrailingSpace =
      textAfterMention.length === 0 || !textAfterMention.startsWith(" ");
    const nextDraft = `${textBeforeMention}${mentionText}${needsTrailingSpace ? " " : ""}${textAfterMention}`;
    const nextCursorPosition =
      textBeforeMention.length + mentionText.length + (needsTrailingSpace ? 1 : 0);

    setDraft(nextDraft);
    setSelectedMentionTokens((current) => {
      const nextToken = {
        userId: participant.id,
        name: participant.name,
      };

      return current.some((token) => token.userId === participant.id)
        ? current
        : [...current, nextToken];
    });
    setActiveMentionIndex(0);
    setDraftSelectionStart(nextCursorPosition);

    window.requestAnimationFrame(() => {
      draftInputRef.current?.focus();
      draftInputRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function preparePendingUploadFile(
    optimisticCommentId: string,
    pendingFile: PendingFile,
  ): Promise<PreparedPendingUpload> {
    const uploadFile = pendingFile.file;

    updateOptimisticAttachment(optimisticCommentId, pendingFile.id, (attachment) => ({
      ...attachment,
      originalFileName: uploadFile.name,
      fileTypeLabel: getLocalFileTypeLabel(uploadFile.name),
      mimeType: uploadFile.type || "application/octet-stream",
      fileSizeLabel: formatLocalFileSize(uploadFile.size),
      uploadState: "uploading",
      progress: 0,
      uploadedAt: "Uploading…",
    }));

    return {
      pendingFile,
      uploadFile,
    };
  }

  async function handleSendComment() {
    const body = draft.trim();
    const activeStageId = activeStage?.id;
    const mentionedUserIds = resolveCommentMentionUserIds(body, selectedMentionTokens);
    const revisionReplyTarget = replyingToRevision;
    const commentRevisionId = revisionReplyTarget?.revisionId ?? null;

    if (!body && pendingCommentFiles.length === 0) {
      return;
    }

    if (!activeStageId) {
      setComposerError("This project does not have an active stage to comment on.");
      return;
    }

    if (isProjectCompleted) {
      setComposerError("This project has already been completed.");
      return;
    }

    if (isStageCompleted) {
      setComposerError("This stage has already been completed. Chat is read-only.");
      return;
    }

    setComposerError(null);
    setIsSendingComment(true);
    const optimisticCommentId = `optimistic-comment-${crypto.randomUUID()}`;
    const localCreatedAtMs = Date.now();
    const filesToUpload = [...pendingCommentFiles];
    const hasPendingFiles = filesToUpload.length > 0;
    const startingSubmissionNumber =
      getStageSubmissionAttachments(displayedMessages, project.category).filter(
        (attachment) =>
          !("uploadState" in attachment) || attachment.uploadState === "uploaded",
      ).length + 1;

    const optimisticComment: DisplayChatEntry = {
      id: optimisticCommentId,
      kind: "comment",
      revisionId: commentRevisionId ?? undefined,
      author: currentUserDisplayName,
      authorId: currentUserId,
      authorAvatarSrc: currentUserAvatarSrc,
      role: currentUserRoleLabel,
      body: body || "Attachment uploaded.",
      mentions: selectedMentionTokens.filter((mention) =>
        mentionedUserIds.includes(mention.userId),
      ),
      createdAt: hasPendingFiles ? "Uploading…" : "Sending…",
      isOptimistic: true,
      optimisticStatus: hasPendingFiles ? "uploading" : "sending",
      localCreatedAtMs,
      attachments: filesToUpload.map((pendingFile) => ({
        id: pendingFile.id,
        localFile: pendingFile.file,
        assetType: pendingFile.assetType ?? "COMMENT_ATTACHMENT",
        isSubmission: pendingFile.assetType === "STAGE_SUBMISSION",
        originalFileName: pendingFile.file.name,
        fileTypeLabel: getLocalFileTypeLabel(pendingFile.file.name),
        mimeType: pendingFile.file.type || "application/octet-stream",
        fileSizeLabel: formatLocalFileSize(pendingFile.file.size),
        uploadedBy: currentUserDisplayName,
        uploadedAt: "Uploading…",
        previewPath: "",
        downloadPath: "",
        isFavoritedByCurrentUser: false,
        uploadState: "pending",
        progress: 0,
      })),
    };

    if (hasPendingFiles) {
      flushSync(() => {
        setOptimisticComments((current) => [...current, optimisticComment]);
        setDraft("");
        setReplyingToRevision(null);
        setSelectedMentionTokens([]);
        setDraftSelectionStart(0);
        setPendingCommentFiles([]);
        setIsSendingComment(false);
      });
      resetDraftComposerHeight();
      publishTypingStopped();
    } else {
      flushSync(() => {
        setOptimisticComments((current) => [...current, optimisticComment]);
        setDraft("");
        setReplyingToRevision(null);
        setSelectedMentionTokens([]);
        setDraftSelectionStart(0);
        setPendingCommentFiles([]);
      });
      resetDraftComposerHeight();
      publishTypingStopped();
      void publishPendingMessage({
        projectId: project.id,
        stageId: activeStageId,
        clientTempId: optimisticCommentId,
        senderId: currentUserId,
        senderDisplayName: currentUserDisplayName,
        senderDisplayCode: currentUserDisplayCode,
        body,
        createdAt: new Date(localCreatedAtMs).toISOString(),
        state: "pending",
      });
    }

    try {
      if (hasPendingFiles) {
        const uploadMentionTokens = selectedMentionTokens.filter((mention) =>
          mentionedUserIds.includes(mention.userId),
        );

        void (async () => {
          await waitForNextPaint();

          try {
            const preparedFiles = await Promise.all(
              filesToUpload.map((pendingFile) =>
                preparePendingUploadFile(optimisticCommentId, pendingFile),
              ),
            );
            const prepareStartedAt = getUploadNow();
            const prepareResponse = await fetch("/api/project-assets/chat-comment-upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                projectId: project.id,
                stageId: activeStageId,
                revisionId: commentRevisionId,
                body,
                allowEmptyBody: true,
                mentionedUserIds,
                files: preparedFiles.map(({ pendingFile, uploadFile }) => ({
                  clientId: pendingFile.id,
                  originalFileName: uploadFile.name,
                  mimeType: uploadFile.type || "application/octet-stream",
                  fileSize: uploadFile.size,
                  assetType: pendingFile.assetType ?? "COMMENT_ATTACHMENT",
                })),
              }),
            });
            console.info("upload:chat-comment-upload", {
              status: prepareResponse.status,
              durationMs: Math.round(getUploadNow() - prepareStartedAt),
              fileCount: preparedFiles.length,
            });

            const preparePayload =
              (await prepareResponse.json()) as ChatCommentUploadPrepareResponse;

            if (
              !prepareResponse.ok ||
              "error" in preparePayload ||
              !("commentId" in preparePayload)
            ) {
              throw new Error(
                getUploadErrorMessage(preparePayload, "Unable to prepare the upload."),
              );
            }

            updateOptimisticComment(optimisticCommentId, (entry) => ({
              ...entry,
              serverEntryId: preparePayload.commentId,
            }));

            const uploadByClientId = new Map(
              preparePayload.uploads.map((upload) => [upload.clientId, upload]),
            );
            const uploadResults = await Promise.allSettled(
              preparedFiles.map(({ pendingFile, uploadFile }, index) => {
                const upload = uploadByClientId.get(pendingFile.id);

                if (!upload?.attachmentId || !upload.uploadUrl) {
                  return Promise.reject(new Error("Upload target was not prepared."));
                }

                logUploadHost(upload.uploadUrl);

                return uploadFileToS3WithProgress({
                  uploadUrl: upload.uploadUrl,
                  file: uploadFile,
                  fileIndex: index + 1,
                  fileCount: preparedFiles.length,
                  assetType: pendingFile.assetType ?? "COMMENT_ATTACHMENT",
                  onProgress: (progress) => {
                    updateOptimisticAttachment(optimisticCommentId, pendingFile.id, (attachment) => ({
                      ...attachment,
                      uploadState: "uploading",
                      progress,
                    }));
                  },
                })
                  .then(() => {
                    updateOptimisticAttachment(optimisticCommentId, pendingFile.id, (attachment) => ({
                      ...attachment,
                      uploadState: "uploaded",
                      progress: 100,
                      uploadedAt: "Uploaded",
                    }));

                    return {
                      pendingFile,
                      attachmentId: upload.attachmentId,
                      uploadedFile: uploadFile,
                    };
                  })
                  .catch((error) => {
                    updateOptimisticAttachment(optimisticCommentId, pendingFile.id, (attachment) => ({
                      ...attachment,
                      uploadState: "error",
                      progress: attachment.progress ?? 0,
                      uploadedAt: "Upload failed",
                      errorMessage:
                        error instanceof Error
                          ? error.message
                          : "Unable to upload this file right now.",
                    }));
                    throw error;
                  });
              }),
            );

            const failedUploads = uploadResults.filter(
              (result): result is PromiseRejectedResult => result.status === "rejected",
            );
            const successfulUploads = uploadResults
              .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
              .map((result, index, allSuccessfulUploads) => {
                const successfulSubmissionIndex = allSuccessfulUploads
                  .slice(0, index + 1)
                  .filter(
                    (item) => item.pendingFile.assetType === "STAGE_SUBMISSION",
                  ).length;

                return {
                  ...result,
                  submissionNumber:
                    result.pendingFile.assetType === "STAGE_SUBMISSION"
                      ? startingSubmissionNumber + successfulSubmissionIndex - 1
                      : undefined,
                };
              });

            if (failedUploads.length > 0) {
              await cancelPreparedCommentUpload({
                commentId: preparePayload.commentId,
                projectId: project.id,
              }).catch(() => undefined);
              setOptimisticComments((current) =>
                current.filter((entry) => entry.id !== optimisticCommentId),
              );
              setDraft(body);
              setReplyingToRevision(revisionReplyTarget);
              setSelectedMentionTokens(selectedMentionTokens);
              setDraftSelectionStart(body.length);
              setPendingCommentFiles(filesToUpload);
              setIsSendingComment(false);

              const message =
                "Comment was not sent because one or more file uploads failed. Please try again.";
              setComposerError(message);
              showErrorToast("Attachment upload failed.", message);
              return;
            }

            const completionResults = await Promise.allSettled(
              successfulUploads.map((result) =>
                completePreparedAttachmentUpload({
                  attachmentId: result.attachmentId,
                  projectId: project.id,
                  file: result.uploadedFile,
                  assetType: result.pendingFile.assetType ?? "COMMENT_ATTACHMENT",
                }),
              ),
            );
            const failedCompletions = completionResults.filter(
              (result): result is PromiseRejectedResult => result.status === "rejected",
            );

            if (failedCompletions.length > 0) {
              await cancelPreparedCommentUpload({
                commentId: preparePayload.commentId,
                projectId: project.id,
              }).catch(() => undefined);
              setOptimisticComments((current) =>
                current.filter((entry) => entry.id !== optimisticCommentId),
              );
              setDraft(body);
              setReplyingToRevision(revisionReplyTarget);
              setSelectedMentionTokens(selectedMentionTokens);
              setDraftSelectionStart(body.length);
              setPendingCommentFiles(filesToUpload);
              setIsSendingComment(false);

              const message =
                "Comment was not sent because the upload could not be finalized. Please try again.";
              setComposerError(message);
              showErrorToast("Attachment upload failed.", message);
              return;
            }

            updateOptimisticComment(optimisticCommentId, (entry) => ({
              ...entry,
              createdAt: "Sending…",
              optimisticStatus: "sending",
            }));

            try {
              await finalizePreparedCommentUpload({
                commentId: preparePayload.commentId,
                projectId: project.id,
              });
            } catch (error) {
              await cancelPreparedCommentUpload({
                commentId: preparePayload.commentId,
                projectId: project.id,
              }).catch(() => undefined);
              setOptimisticComments((current) =>
                current.filter((entry) => entry.id !== optimisticCommentId),
              );
              setDraft(body);
              setReplyingToRevision(revisionReplyTarget);
              setSelectedMentionTokens(selectedMentionTokens);
              setDraftSelectionStart(body.length);
              setPendingCommentFiles(filesToUpload);
              setIsSendingComment(false);

              throw error;
            }

            setConfirmedComments((current) => [
              ...current,
              {
                id: `confirmed-comment-${preparePayload.commentId}`,
                serverEntryId: preparePayload.commentId,
                revisionId: preparePayload.revisionId ?? undefined,
                kind: "comment",
                author: currentUserDisplayName,
                authorId: currentUserId,
                authorAvatarSrc: currentUserAvatarSrc,
                role: currentUserRoleLabel,
                body: body || "Attachment uploaded.",
                mentions: uploadMentionTokens,
                createdAt: "Just now",
                canDeleteUntil: getLocalDeleteExpiresAt(localCreatedAtMs),
                localCreatedAtMs,
                attachments: successfulUploads.map((result) => ({
                  id: result.attachmentId,
                  assetType: result.pendingFile.assetType ?? "COMMENT_ATTACHMENT",
                  isSubmission: result.pendingFile.assetType === "STAGE_SUBMISSION",
                  submissionNumber: result.submissionNumber,
                  originalFileName: result.uploadedFile.name,
                  fileTypeLabel: getLocalFileTypeLabel(result.uploadedFile.name),
                  mimeType: result.uploadedFile.type || "application/octet-stream",
                  fileSizeLabel: formatLocalFileSize(result.uploadedFile.size),
                  uploadedBy: currentUserDisplayName,
                  uploadedAt: "Just now",
                  previewPath: `/api/project-assets/${result.attachmentId}/preview`,
                  downloadPath: `/api/project-assets/${result.attachmentId}/download`,
                  isFavoritedByCurrentUser: false,
                  submissionReviewStatus:
                    result.pendingFile.assetType === "STAGE_SUBMISSION"
                      ? "PENDING_REVIEW"
                      : null,
                })),
              },
            ]);
            setOptimisticComments((current) =>
              current.filter((entry) => entry.id !== optimisticCommentId),
            );
            setIsSendingComment(false);
          } catch (error) {
            filesToUpload.forEach((pendingFile) => {
              updateOptimisticAttachment(optimisticCommentId, pendingFile.id, (attachment) => ({
                ...attachment,
                uploadState: "error",
                progress: attachment.progress ?? 0,
                uploadedAt: "Upload failed",
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : "Unable to upload this file right now.",
              }));
            });

            const message =
              error instanceof Error ? error.message : "Unable to send the comment right now.";
            setOptimisticComments((current) =>
              current.filter((entry) => entry.id !== optimisticCommentId),
            );
            setDraft(body);
            setReplyingToRevision(revisionReplyTarget);
            setSelectedMentionTokens(selectedMentionTokens);
            setDraftSelectionStart(body.length);
            setPendingCommentFiles(filesToUpload);
            setIsSendingComment(false);
            setComposerError(message);
            showErrorToast("Unable to send comment.", message);
          }
        })();

        return;
      }

      const commentResponse = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/stages/${encodeURIComponent(
          activeStageId,
        )}/chat/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            revisionId: commentRevisionId,
            body,
            mentionedUserIds,
            clientTempId: optimisticCommentId,
          }),
        },
      );
      const commentResult =
        (await commentResponse.json()) as CreateStageCommentApiResponse;

      if (!commentResponse.ok || "error" in commentResult) {
        throw new Error(
          "error" in commentResult
            ? commentResult.error
            : "Unable to send the comment right now.",
        );
      }

      if (commentResult.entry) {
        mergeServerChatEntry(commentResult.entry, {
          clientTempId: commentResult.clientTempId ?? optimisticCommentId,
          countAsNew: false,
        });
      } else {
        updateOptimisticComment(optimisticCommentId, (entry) => ({
          ...entry,
          serverEntryId: commentResult.commentId,
        }));

        setConfirmedComments((current) => [
          ...current,
          {
            id: `confirmed-comment-${commentResult.commentId}`,
            serverEntryId: commentResult.commentId,
            revisionId: commentResult.revisionId ?? undefined,
            kind: "comment",
            author: currentUserDisplayName,
            authorId: currentUserId,
            authorAvatarSrc: currentUserAvatarSrc,
            role: currentUserRoleLabel,
            body: body || "Attachment uploaded.",
            mentions: selectedMentionTokens.filter((mention) =>
              mentionedUserIds.includes(mention.userId),
            ),
            createdAt: "Just now",
            canDeleteUntil: getLocalDeleteExpiresAt(localCreatedAtMs),
            localCreatedAtMs,
            attachments: [],
          },
        ]);
        setOptimisticComments((current) =>
          current.filter((entry) => entry.id !== optimisticCommentId),
        );
      }
      setIsSendingComment(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send the comment right now.";
      if (!hasPendingFiles) {
        failedClientTempIdsRef.current.add(optimisticCommentId);
        updateOptimisticComment(optimisticCommentId, (entry) => ({
          ...entry,
          createdAt: "Failed",
          optimisticStatus: "failed",
        }));
        void publishFailedMessage({
          projectId: project.id,
          stageId: activeStageId,
          clientTempId: optimisticCommentId,
          senderId: currentUserId,
          failedAt: new Date().toISOString(),
          state: "failed",
          reason: "save_failed",
        });
      } else {
        setOptimisticComments((current) =>
          current.filter((entry) => entry.id !== optimisticCommentId),
        );
        setDraft(body);
        setReplyingToRevision(revisionReplyTarget);
        setSelectedMentionTokens(selectedMentionTokens);
        setDraftSelectionStart(body.length);
      }
      setComposerError(message);
      showErrorToast("Unable to send comment.", message);
    } finally {
      setIsSendingComment(false);
    }
  }

  async function handleCreateRevision() {
    const activeStageId = activeStage?.id;
    const summary = revisionSummary;

    if (!activeStageId) {
      setRevisionDialogError("This project does not have an active stage to upload into.");
      return;
    }

    if (isProjectCompleted) {
      setRevisionDialogError("This project has already been completed.");
      return;
    }

    if (isStageCompleted) {
      setRevisionDialogError("This stage is already completed.");
      return;
    }

    if (!hasAcceptedBrief) {
      setRevisionDialogError("Please accept the brief before submitting work.");
      return;
    }

    if (hasPendingRevisionReview) {
      setRevisionDialogError(pendingRevisionReviewMessage);
      return;
    }

    if (!canSubmitWorkAsProjectExecutor) {
      setRevisionDialogError("Only a project executor can submit work for review.");
      return;
    }

    if (!richTextToPlainText(summary)) {
      setRevisionDialogError("Enter the revision details before creating it.");
      return;
    }

    if (isConceptMode && pendingRevisionFiles.length === 0) {
      setRevisionDialogError("Attach at least one concept submission file before submitting.");
      return;
    }

    setRevisionDialogError(null);
    setComposerError(null);
    setIsUploadingRevision(true);
    const optimisticRevisionId = `optimistic-revision-${crypto.randomUUID()}`;
    const localCreatedAtMs = Date.now();
    const filesToUpload = [...pendingRevisionFiles];

    setOptimisticComments((current) => [
      ...current,
      {
        id: optimisticRevisionId,
        kind: "revision",
        title: "Submitting work…",
        revisionStatus: "PENDING_REVIEW",
        rejectionReason: null,
        author: currentUserDisplayName,
        authorId: currentUserId,
        authorAvatarSrc: currentUserAvatarSrc,
        role: currentUserRoleLabel,
        body: summary,
        createdAt: "Uploading…",
        isOptimistic: true,
        localCreatedAtMs,
        attachments: filesToUpload.map((pendingFile) => ({
          id: pendingFile.id,
          localFile: pendingFile.file,
          assetType: "REVISION_ORIGINAL",
          isSubmission: false,
          originalFileName: pendingFile.file.name,
          fileTypeLabel: getLocalFileTypeLabel(pendingFile.file.name),
          mimeType: pendingFile.file.type || "application/octet-stream",
          fileSizeLabel: formatLocalFileSize(pendingFile.file.size),
          uploadedBy: currentUserDisplayName,
          uploadedAt: "Uploading…",
          previewPath: "",
          downloadPath: "",
          isFavoritedByCurrentUser: false,
          uploadState: "pending",
          progress: 0,
        })),
      },
    ]);

    try {
      const uploadRevisionFiles = (revisionId?: string) => Promise.allSettled(
        filesToUpload.map((pendingFile) => {
          return uploadAssetFile({
            file: pendingFile.file,
            projectId: project.id,
            stageId: activeStageId,
            revisionId,
            assetType: "REVISION_ORIGINAL",
            onUploadStart: (uploadFile) => {
              updateOptimisticAttachment(optimisticRevisionId, pendingFile.id, (attachment) => ({
                ...attachment,
                originalFileName: uploadFile.name,
                fileTypeLabel: getLocalFileTypeLabel(uploadFile.name),
                mimeType: uploadFile.type || "application/octet-stream",
                fileSizeLabel: formatLocalFileSize(uploadFile.size),
                uploadState: "uploading",
                progress: 0,
                uploadedAt: "Uploading…",
              }));
            },
            onProgress: (progress) => {
              updateOptimisticAttachment(optimisticRevisionId, pendingFile.id, (attachment) => ({
                ...attachment,
                uploadState: "uploading",
                progress,
              }));
            },
          })
            .then((uploadResult) => {
              updateOptimisticAttachment(optimisticRevisionId, pendingFile.id, (attachment) => ({
                ...attachment,
                uploadState: "uploaded",
                progress: 100,
                uploadedAt: "Uploaded",
              }));
              return {
                pendingFile,
                attachmentId: uploadResult.attachmentId,
                uploadedFile: uploadResult.uploadedFile,
              };
            })
            .catch((error) => {
              updateOptimisticAttachment(optimisticRevisionId, pendingFile.id, (attachment) => ({
                ...attachment,
                uploadState: "error",
                progress: attachment.progress ?? 0,
                uploadedAt: "Upload failed",
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : "Unable to upload this file right now.",
              }));
              throw error;
            });
        }),
      );
      let revisionResult: {
        revisionId: string;
        title: string;
        revisionNumber: number;
      };
      let successfulUploads: Array<{
        pendingFile: PendingFile;
        attachmentId: string;
        uploadedFile: File;
      }>;

      if (isConceptMode) {
        const uploadResults = await uploadRevisionFiles();
        const failedUploads = uploadResults.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        successfulUploads = uploadResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );

        if (failedUploads.length > 0) {
          if (successfulUploads.length > 0) {
            await cancelStagedConceptRevisionAttachmentsAction({
              projectId: project.id,
              stageId: activeStageId,
              attachmentIds: successfulUploads.map((result) => result.attachmentId),
            });
          }
          throw new Error(
            "Revision was not submitted because one or more files failed to upload. Please retry.",
          );
        }

        const createdRevision = await createStageRevisionAction({
          projectId: project.id,
          stageId: activeStageId,
          summary,
          attachmentIds: successfulUploads.map((result) => result.attachmentId),
        });

        if ("error" in createdRevision) {
          await cancelStagedConceptRevisionAttachmentsAction({
            projectId: project.id,
            stageId: activeStageId,
            attachmentIds: successfulUploads.map((result) => result.attachmentId),
          });
          throw new Error(createdRevision.error);
        }

        revisionResult = createdRevision;
      } else {
        const createdRevision = await createStageRevisionAction({
          projectId: project.id,
          stageId: activeStageId,
          summary,
        });

        if ("error" in createdRevision) {
          throw new Error(createdRevision.error);
        }

        revisionResult = createdRevision;
        const uploadResults = await uploadRevisionFiles(revisionResult.revisionId);
        const failedUploads = uploadResults.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        successfulUploads = uploadResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );

        if (failedUploads.length > 0) {
          const cancelResult = await cancelStageRevisionSubmissionAction({
            projectId: project.id,
            stageId: activeStageId,
            revisionId: revisionResult.revisionId,
          });

          if ("error" in cancelResult) {
            throw new Error(cancelResult.error);
          }

          throw new Error(
            "Revision was not created because one or more file uploads failed. Please try again.",
          );
        }
      }

      updateOptimisticComment(optimisticRevisionId, (entry) => ({
        ...entry,
        title: revisionResult.title,
        revisionNumber: revisionResult.revisionNumber,
        serverEntryId: revisionResult.revisionId,
      }));

      setConfirmedComments((current) => [
        ...current,
        {
          id: `confirmed-revision-${revisionResult.revisionId}`,
          serverEntryId: revisionResult.revisionId,
          revisionId: revisionResult.revisionId,
          kind: "revision",
          title: revisionResult.title,
          revisionNumber: revisionResult.revisionNumber,
          revisionStatus: "PENDING_REVIEW",
          rejectionReason: null,
          author: currentUserDisplayName,
          authorId: currentUserId,
          authorAvatarSrc: currentUserAvatarSrc,
          role: currentUserRoleLabel,
          body: summary,
          createdAt: "Just now",
          localCreatedAtMs,
          attachments: successfulUploads.map((result) => ({
            id: result.attachmentId,
            assetType: "REVISION_ORIGINAL",
            isSubmission: false,
            originalFileName: result.uploadedFile.name,
            fileTypeLabel: getLocalFileTypeLabel(result.uploadedFile.name),
            mimeType: result.uploadedFile.type || "application/octet-stream",
            fileSizeLabel: formatLocalFileSize(result.uploadedFile.size),
            uploadedBy: currentUserDisplayName,
            uploadedAt: "Just now",
            previewPath: `/api/project-assets/${result.attachmentId}/preview`,
            downloadPath: `/api/project-assets/${result.attachmentId}/download`,
            isFavoritedByCurrentUser: false,
          })),
        },
      ]);

      setOptimisticComments((current) =>
        current.filter((entry) => entry.id !== optimisticRevisionId),
      );
      setRevisionDialogOpen(false);
      setRevisionSummary("");
      setPendingRevisionFiles([]);
      showSuccessToast("Work submitted successfully.");
      refreshHistory();
    } catch (error) {
      setOptimisticComments((current) =>
        current.filter((entry) => entry.id !== optimisticRevisionId),
      );
      const message =
        error instanceof Error ? error.message : "Unable to create the revision right now.";
      setRevisionDialogError(message);
      showErrorToast("Unable to submit work.", message);
    } finally {
      setIsUploadingRevision(false);

      if (revisionFileInputRef.current) {
        revisionFileInputRef.current.value = "";
      }

      if (revisionDialogFileInputRef.current) {
        revisionDialogFileInputRef.current.value = "";
      }
    }
  }

  function openInvoiceRequestDialog() {
    setInvoiceRequestError(null);
    setStageInvoiceError(null);
    setInvoiceRequestRecipientId(
      stageInvoiceRequest?.requestedFromId ??
        (invoiceRequestCandidates.length === 1 ? invoiceRequestCandidates[0]?.id : "") ??
        "",
    );
    setInvoiceRequestNote(
      stageInvoiceRequest?.note ?? "Please upload the invoice for this completed stage.",
    );
    setInvoiceRequestDialogOpen(true);
  }

  async function handleRequestStageInvoice() {
    const activeStageId = activeStage?.id;

    if (!activeStageId) {
      setInvoiceRequestError("This project does not have an active stage.");
      return;
    }

    if (!canRequestStageInvoice) {
      setInvoiceRequestError("Invoice request is not available for this stage.");
      return;
    }

    if (!invoiceRequestRecipientId) {
      setInvoiceRequestError("Choose who should upload the invoice.");
      return;
    }

    setInvoiceRequestError(null);
    setIsRequestingStageInvoice(true);

    try {
      const result = await requestStageInvoiceAction({
        projectId: project.id,
        stageId: activeStageId,
        requestedFromId: invoiceRequestRecipientId,
        note: invoiceRequestNote,
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      const request = result.request;
      const nextInvoiceRequest: ProjectStageRecord["invoiceRequest"] = {
        id: request.id,
        requestedById: currentUserId,
        requestedByName: request.requestedByName,
        requestedFromId: request.requestedFromId,
        requestedFromName: request.requestedFromName,
        note: request.note,
        requestedAt: "Just now",
        fulfilledAt: null,
      };
      const stageName = activeStage?.label ?? "this stage";

      setStageCardOverrides((current) => ({
        ...current,
        [activeStageId]: {
          actualStartedAt:
            current[activeStageId]?.actualStartedAt ??
            activeStage?.actualStartedAt ??
            "—",
          actualStartedAtValue:
            current[activeStageId]?.actualStartedAtValue ??
            activeStage?.actualStartedAtValue ??
            null,
          startedByName:
            current[activeStageId]?.startedByName ?? activeStage?.startedByName,
          status: current[activeStageId]?.status ?? activeStage?.status,
          invoiceRequest: nextInvoiceRequest,
        },
      }));
      setConfirmedComments((current) => [
        ...current,
        {
          id: `confirmed-invoice-request-${request.id}`,
          serverEntryId: request.commentId,
          kind: "system",
          title: "Invoice requested",
          author: currentUserDisplayName,
          authorId: currentUserId,
          authorAvatarSrc: currentUserAvatarSrc,
          role: currentUserRoleLabel,
          body: `${currentUserDisplayName} requested invoice from ${request.requestedFromName} for ${stageName}.`,
          createdAt: "Just now",
          localCreatedAtMs: Date.now(),
        },
      ]);
      setInvoiceRequestDialogOpen(false);
      showSuccessToast("Invoice request sent in-app.");
      refreshHistory();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to request the invoice right now.";
      setInvoiceRequestError(message);
      showErrorToast("Unable to request invoice.", message);
    } finally {
      setIsRequestingStageInvoice(false);
    }
  }

  function openStageInvoiceUpload() {
    setStageInvoiceError(null);
    setReviewDialogError(null);
    setStageCompleteError(null);

    if (!canUploadStageInvoice) {
      const message = stageInvoiceRequired
        ? "Only the requested invoice recipient can upload the invoice for this stage."
        : "Invoice is not required for this stage.";
      setStageInvoiceError(message);
      showErrorToast("Unable to upload invoice.", message);
      return;
    }

    setCommentUploadDialogOpen(false);
    stageInvoiceInputRef.current?.click();
  }

  async function handleStageInvoiceSelected(files: FileList | null) {
    const invoiceFile = Array.from(files ?? [])[0] ?? null;
    const activeStageId = activeStage?.id;

    if (stageInvoiceInputRef.current) {
      stageInvoiceInputRef.current.value = "";
    }

    if (!invoiceFile) {
      return;
    }

    if (!activeStageId) {
      const message = "This project does not have an active stage.";
      setStageInvoiceError(message);
      showErrorToast("Unable to upload invoice.", message);
      return;
    }

    if (!canUploadStageInvoice) {
      const message = stageInvoiceRequired
        ? "Only the requested invoice recipient can upload the invoice for this stage."
        : "Invoice is not required for this stage.";
      setStageInvoiceError(message);
      showErrorToast("Unable to upload invoice.", message);
      return;
    }

    setStageInvoiceError(null);
    setIsUploadingStageInvoice(true);

    try {
      const result = await uploadAssetFile({
        file: invoiceFile,
        projectId: project.id,
        stageId: activeStageId,
        assetType: "STAGE_INVOICE",
      });
      const invoiceAttachment: ProjectAttachmentRecord = {
        id: result.attachmentId,
        assetType: "STAGE_INVOICE",
        isSubmission: false,
        originalFileName: result.uploadedFile.name,
        fileTypeLabel: getLocalFileTypeLabel(result.uploadedFile.name),
        mimeType: result.uploadedFile.type || "application/octet-stream",
        fileSizeLabel: formatLocalFileSize(result.uploadedFile.size),
        uploadedBy: currentUserDisplayName,
        uploadedAt: "Just now",
        previewPath: `/api/project-assets/${result.attachmentId}/preview`,
        downloadPath: `/api/project-assets/${result.attachmentId}/download`,
        isFavoritedByCurrentUser: false,
      };
      const stageName = activeStage?.label ?? "this stage";

      setStageCardOverrides((current) => {
        const existingInvoiceRequest =
          current[activeStageId]?.invoiceRequest ?? activeStage?.invoiceRequest ?? null;

        return {
          ...current,
          [activeStageId]: {
            actualStartedAt:
              current[activeStageId]?.actualStartedAt ??
              activeStage?.actualStartedAt ??
              "—",
            actualStartedAtValue:
              current[activeStageId]?.actualStartedAtValue ??
              activeStage?.actualStartedAtValue ??
              null,
            startedByName:
              current[activeStageId]?.startedByName ?? activeStage?.startedByName,
            status: current[activeStageId]?.status ?? activeStage?.status,
            invoiceAttachment,
            invoiceRequest: existingInvoiceRequest
              ? {
                  ...existingInvoiceRequest,
                  fulfilledAt: "Just now",
                }
              : null,
          },
        };
      });
      setConfirmedComments((current) => [
        ...current,
        {
          id: result.invoiceCommentId ?? `confirmed-invoice-${result.attachmentId}`,
          serverEntryId: result.invoiceCommentId ?? undefined,
          kind: "system",
          title: "Invoice uploaded",
          author: currentUserDisplayName,
          authorId: currentUserId,
          authorAvatarSrc: currentUserAvatarSrc,
          role: currentUserRoleLabel,
          body: `${currentUserDisplayName} uploaded invoice for ${stageName}.`,
          createdAt: "Just now",
          localCreatedAtMs: Date.now(),
        },
      ]);
      showSuccessToast("Invoice uploaded.");
      refreshHistory();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to upload the invoice right now.";
      setStageInvoiceError(message);
      showErrorToast("Unable to upload invoice.", message);
    } finally {
      setIsUploadingStageInvoice(false);
    }
  }

  async function handleRevisionReview(
    status: Extract<RevisionReviewState, "APPROVED" | "REJECTED">,
  ) {
    const activeStageId = activeStage?.id;

    if (!reviewRevisionMessage?.revisionId || !activeStageId) {
      setReviewDialogError("Submission not found.");
      return;
    }

    const revisionEntryId = getRevisionEntryId(reviewRevisionMessage);
    const reviewRevisionLabel = getRevisionLabel(reviewRevisionMessage);
    const rejectionReason = reviewRejectReason;

    if (status === "REJECTED" && !richTextToPlainText(rejectionReason)) {
      setReviewDialogError("Revision reason is required.");
      return;
    }

    setReviewDialogError(null);
    setPendingRevisionReviewId(revisionEntryId);

    try {
      const result =
        status === "APPROVED"
          ? await markSubmissionCompleteAction({
              projectId: project.id,
              stageId: activeStageId,
              revisionId: reviewRevisionMessage.revisionId,
            })
          : await requestSubmissionRevisionAction({
              projectId: project.id,
              stageId: activeStageId,
              revisionId: reviewRevisionMessage.revisionId,
              reason: rejectionReason,
            });

      if ("error" in result) {
        throw new Error(result.error);
      }

      const nextStatus = result.revision.status as RevisionReviewState;
      const nextReason = result.revision.rejectionReason ?? null;
      const reviewedBy = result.revision.reviewedBy ?? currentUserDisplayName;
      const reviewedAt = "Just now";
      const localCreatedAtMs = Date.now();

      setRevisionReviewOverrides((current) => ({
        ...current,
        [revisionEntryId]: {
          status: nextStatus,
          rejectionReason: nextReason,
          reviewedBy,
          reviewedAt,
        },
      }));

      setConfirmedComments((current) => {
        const nextEntries = current.map((entry) =>
          entry.kind === "revision" && getRevisionEntryId(entry) === revisionEntryId
            ? {
                ...entry,
                revisionStatus: nextStatus,
                rejectionReason: nextReason,
                reviewedBy,
                reviewedAt,
              }
            : entry,
        );

        if (result.revision.rejectionComment) {
          const revisionReasonText = nextReason || rejectionReason;

          return [
            ...nextEntries,
            {
              id: `confirmed-comment-${result.revision.rejectionComment.id}`,
              serverEntryId: result.revision.rejectionComment.id,
              revisionId: reviewRevisionMessage.revisionId,
              kind: "system",
              title: "Revision requested",
              author: currentUserDisplayName,
              authorId: currentUserId,
              authorAvatarSrc: currentUserAvatarSrc,
              role: currentUserRoleLabel,
              body: `${currentUserDisplayName} requested a revision for ${reviewRevisionLabel}.`,
              revisionRequestReason: revisionReasonText,
              createdAt: "Just now",
              localCreatedAtMs,
            },
          ];
        }

        if (status === "APPROVED") {
          const systemTitle = result.revision.stageCompletion
            ? "Stage completed"
            : "Submission approved";
          const systemBody = result.revision.stageCompletion
            ? `${currentUserDisplayName} completed this stage after approving ${reviewRevisionLabel}.`
            : stageInvoiceMissing
              ? `${currentUserDisplayName} approved ${reviewRevisionLabel}. Invoice is required before this stage can be completed.`
              : `${currentUserDisplayName} approved ${reviewRevisionLabel}.`;

          return [
            ...nextEntries,
            {
              id: `confirmed-system-${revisionEntryId}-${nextStatus}`,
              revisionId: reviewRevisionMessage.revisionId,
              kind: "system",
              title: systemTitle,
              author: currentUserDisplayName,
              authorId: currentUserId,
              authorAvatarSrc: currentUserAvatarSrc,
              role: currentUserRoleLabel,
              body: systemBody,
              createdAt: "Just now",
              localCreatedAtMs,
            },
          ];
        }

        return nextEntries;
      });

      if (status === "APPROVED" && result.revision.stageCompletion) {
        applyStageCompletionLocally(activeStageId);
        scrollToCompletionWorkflow();
      }

      closeRevisionReviewDialog();
      setReviewCompleteDialogOpen(false);
      showSuccessToast(
        status === "APPROVED"
          ? result.revision.stageCompletion
            ? "Stage marked as complete."
            : "Submission approved."
          : "Revision requested.",
      );
      refreshHistory();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to review the submission right now.";
      setReviewDialogError(message);
      showErrorToast(
        status === "APPROVED"
          ? "Unable to mark stage as complete."
          : "Unable to request revision.",
        message,
      );
      setPendingRevisionReviewId(null);
    }
  }

  function renderStageInvoiceActions(options?: { includeCompleteAction?: boolean }) {
    if (!stageInvoiceAttachment || !canUseStageInvoiceFileActions) {
      return null;
    }

    const showCompleteAction =
      Boolean(options?.includeCompleteAction) && canCompleteStageAfterInvoice;
    const hasViewAction = Boolean(
      stageInvoiceAttachment.previewPath && stageInvoiceAttachment.downloadPath,
    );
    const hasDownloadAction = Boolean(stageInvoiceAttachment.downloadPath);

    if (!showCompleteAction && !hasViewAction && !hasDownloadAction) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {showCompleteAction ? (
          <Button
            type="button"
            size="sm"
            className="rounded-full text-[12px]"
            onClick={() => {
              setStageCompleteError(null);
              setStageCompleteDialogOpen(true);
            }}
          >
            Complete Stage
          </Button>
        ) : null}
        {hasViewAction ? (
          <AssetPreviewButton
            fileName={stageInvoiceAttachment.originalFileName}
            mimeType={stageInvoiceAttachment.mimeType}
            previewPath={stageInvoiceAttachment.previewPath}
            downloadPath={stageInvoiceAttachment.downloadPath}
            iconOnly={false}
            label="View Invoice"
            triggerClassName={
              showCompleteAction
                ? "rounded-full border border-[#dfe8df] bg-white px-4 text-[12px] font-[800] text-[#173120] shadow-[0_10px_22px_rgba(23,39,28,0.05)] hover:bg-[#f4fbf5]"
                : "rounded-full bg-[linear-gradient(90deg,#2f8d5d,#123f2d)] px-4 text-[12px] font-[800] text-white shadow-[0_12px_24px_rgba(34,102,70,0.18)] hover:bg-brand"
            }
          />
        ) : null}
        {hasDownloadAction ? (
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="rounded-full text-[12px]"
          >
            <Link href={stageInvoiceAttachment.downloadPath ?? "#"}>
              <Download className="h-3.5 w-3.5" />
              Download
            </Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const archiveMetadataWizardFiles =
    archivePreparation?.files.map((file) => ({
      id: file.sourceAttachmentId,
      originalFileName: file.originalFileName,
      metadata: archiveMetadataDrafts[file.sourceAttachmentId] ?? file.metadataDraft,
    })) ?? [];
  const archiveMissingMetadataByFile =
    archivePreparation?.files.map((file) => {
      const metadata = archiveMetadataDrafts[file.sourceAttachmentId] ?? file.metadataDraft;

      return {
        file,
        metadata,
        missingGroups: getArchiveMetadataMissingGroups(metadata),
      };
    }) ?? [];
  const archiveMissingMetadataCount = archiveMissingMetadataByFile.reduce(
    (count, item) =>
      count + item.missingGroups.reduce((groupCount, group) => groupCount + group.fields.length, 0),
    0,
  );
  const archiveHasBlockingFileErrors = Object.values(archiveFileErrors).some(Boolean);
  const canSubmitFinalArchive =
    canArchiveProject &&
    Boolean(archivePreparation) &&
    Boolean(archiveCategoryId) &&
    !archiveHasBlockingFileErrors &&
    archiveMissingMetadataCount === 0;
  const composerPositionClass = isConceptMode ? "" : "sticky bottom-1";

  async function handleImportStageThreeReference() {
    if (!conceptMode || !selectedStageThreeReferenceId) {
      setStageThreeReferenceError("Choose an approved Stage 3 concept.");
      return;
    }

    setStageThreeReferenceError(null);
    setIsImportingStageThreeReference(true);
    const result = await importStageThreeConceptReferenceAction({
      projectId: project.id,
      folderId: conceptMode.folderId,
      sourceConceptId: selectedStageThreeReferenceId,
    });
    setIsImportingStageThreeReference(false);

    if ("error" in result) {
      setStageThreeReferenceError(
        result.error ?? "Unable to import the approved Stage 3 concept.",
      );
      return;
    }

    setStageThreeReferenceDialogOpen(false);
    showSuccessToast("Approved Stage 3 concept imported into this chat.");
    router.refresh();
  }

  return (
    <section
      className={`min-h-0 ${
        isConceptMode
          ? "flex h-full flex-col overflow-hidden"
          : "[@media_(min-width:1536px)_and_(min-height:900px)]:h-[calc(100dvh-11rem)] [@media_(min-width:1536px)_and_(min-height:900px)]:overflow-hidden"
      }`}
    >
      <ProjectAccessRealtimeGuard
        projectId={project.id}
        currentUserId={currentUserId}
        fallbackRefreshIntervalMs={isConceptMode ? 10_000 : undefined}
      />
      {conceptMode && stageThreeReferenceDialogOpen ? (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-[#112118]/35 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stage-three-reference-dialog-title"
        >
          <Card className="w-full max-w-[520px] overflow-hidden rounded-[24px] border-[#dfe6df] shadow-[0_32px_80px_rgba(14,31,20,0.2)]">
            <CardHeader className="border-b border-[#e5ebe6]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle
                    id="stage-three-reference-dialog-title"
                    className="text-[21px] font-[760] tracking-[-0.03em]"
                  >
                    Import Approved Concept
                  </CardTitle>
                  <p className="mt-1 text-[12px] leading-5 text-[#6f7a72]">
                    Add one approved Stage 3 concept as a read-only starting reference in this chat.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => setStageThreeReferenceDialogOpen(false)}
                  disabled={isImportingStageThreeReference}
                  aria-label="Close import dialog"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5 sm:p-6">
              <label className="block space-y-2">
                <span className="text-[12px] font-[700] text-[#2d372f]">
                  Approved Stage 3 Concept
                </span>
                <Select
                  value={selectedStageThreeReferenceId}
                  onValueChange={(value) => {
                    setSelectedStageThreeReferenceId(value);
                    setStageThreeReferenceError(null);
                  }}
                >
                  <SelectTrigger className="h-12 rounded-[14px] border-[#cfdad1] bg-[#fbfdfb] px-4 shadow-none">
                    <SelectValue placeholder="Choose an approved concept" />
                  </SelectTrigger>
                  <SelectContent className="z-[210]">
                    {conceptMode.availableStageThreeReferences.map((reference) => (
                      <SelectItem
                        key={reference.sourceConceptId}
                        value={reference.sourceConceptId}
                      >
                        {reference.sourceConceptName} · {reference.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {stageThreeReferenceError ? (
                <p className="rounded-[12px] border border-[#f0d4d2] bg-[#fff5f4] px-3 py-2 text-[12px] font-semibold text-[#a64038]">
                  {stageThreeReferenceError}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStageThreeReferenceDialogOpen(false)}
                  disabled={isImportingStageThreeReference}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleImportStageThreeReference()}
                  disabled={
                    isImportingStageThreeReference || !selectedStageThreeReferenceId
                  }
                >
                  {isImportingStageThreeReference ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Import into Chat
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {conceptMode ? (
        <div className="mb-2 shrink-0 rounded-[18px] border border-[#dbe7dd] bg-white/94 px-2.5 py-2 shadow-[0_8px_20px_rgba(18,35,23,0.04)] sm:px-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="h-9 w-fit shrink-0 rounded-full px-3 text-[11px]"
            >
              <Link href={conceptMode.backHref}>
                <ArrowLeft className="h-3.5 w-3.5" />
                {conceptMode.backLabel ??
                  (isStageNeutralConceptMode
                    ? "Back to Workspace"
                    : `Back to Stage ${conceptMode.stageNumber}`)}
              </Link>
            </Button>
            <dl
              className={`grid min-w-0 flex-1 grid-cols-2 divide-x divide-[#e2e9e2] overflow-hidden rounded-[12px] bg-[#f7faf6] ${
                isStageNeutralConceptMode ? "lg:grid-cols-3" : "lg:grid-cols-4"
              }`}
            >
              {[
                ["Project", project.title],
                ...(isStageNeutralConceptMode
                  ? []
                  : [["Stage", conceptMode.stageLabel]]),
                ["Concept", conceptMode.conceptName],
                [
                  "Assigned Executor",
                  conceptMode.assignedExecutor?.name?.trim() ||
                    conceptMode.assignedExecutor?.email ||
                    "Unassigned",
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 px-3 py-1.5">
                  <dt className="text-[8px] font-[800] uppercase tracking-[0.08em] text-[#718076]">
                    {label}
                  </dt>
                  <dd className="mt-0.5 truncate text-[11px] font-[750] text-[#1c2a21]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {conceptMode.completedWithoutFile ? <span className="rounded-full bg-[#e7f5eb] px-3 py-1.5 text-[11px] font-semibold text-[#247247]">Completed · No file</span> : null}
            <RevokeTaskCompletionButton projectId={project.id} folderId={conceptMode.folderId} stageKey={conceptMode.workflowStageKey}
              name={conceptMode.conceptName} eligibility={conceptMode.completionRevocationEligibility}
              onReopened={() => setStageCardOverrides((current) => {
                const next = { ...current };
                if (activeStage) delete next[activeStage.id];
                return next;
              })} />
            {conceptMode.canCompleteWithoutFile && activeStage && !isStageCompleted ? (
              <CompleteConceptTaskButton projectId={project.id} folderId={conceptMode.folderId} stageKey={conceptMode.workflowStageKey} name={conceptMode.conceptName} completionRequest={conceptMode.completionRequest} onCompleted={() => setStageCardOverrides((current) => ({
                ...current, [activeStage.id]: { ...current[activeStage.id], actualStartedAt: activeStage.actualStartedAt, actualStartedAtValue: activeStage.actualStartedAtValue, status: "completed" },
              }))} />
            ) : null}
            {conceptMode.canRequestCompletion && !isStageCompleted ? <RequestConceptCompletionButton projectId={project.id} folderId={conceptMode.folderId} stageKey={conceptMode.workflowStageKey} name={conceptMode.conceptName} /> : null}
            {canRevokeConceptApproval ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-12 w-full shrink-0 rounded-[12px] border-[#e3aaa5] px-3 text-[10px] font-[780] text-[#ad4039] hover:bg-[#fff3f1] hover:text-[#96352f] lg:w-auto"
                disabled={revokingConceptApproval}
                onClick={() => {
                  setRevokeConceptApprovalError(null);
                  setRevokeConceptApprovalOpen(true);
                }}
              >
                {revokingConceptApproval ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Revoke Approval
              </Button>
            ) : null}
            <ConceptDeadlineTimer
              deadline={activeStage?.plannedDueAtValue ?? null}
            />
          </div>
          {conceptMode.completionRequest && !isStageCompleted ? (
            <div role="status" className="mt-3 rounded-xl border border-[#d9cfeb] bg-[#f7f3fc] px-4 py-3 text-sm text-[#60417f]">
              <p className="font-semibold">Waiting for completion review</p>
              <p className="mt-1">{conceptMode.assignedExecutor?.name?.trim() || conceptMode.assignedExecutor?.email || "The assigned executor"} requested completion without a file. The project owner can review the work and complete the task.</p>
              {conceptMode.completionRequest.note ? <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words">{conceptMode.completionRequest.note}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={`grid min-h-0 gap-4 ${
          isConceptMode
            ? "flex-1 overflow-hidden [@media_(min-width:1680px)_and_(min-height:900px)]:grid-cols-[minmax(0,1fr)_300px]"
            : "[@media_(min-width:1536px)_and_(min-height:900px)]:h-full [@media_(min-width:1536px)_and_(min-height:900px)]:grid-cols-[minmax(0,1fr)_300px]"
        }`}
      >
        <div
          className={`flex min-h-0 min-w-0 flex-col gap-2 ${
            isConceptMode
              ? "h-full overflow-hidden"
              : "[@media_(min-width:1536px)_and_(min-height:900px)]:h-full [@media_(min-width:1536px)_and_(min-height:900px)]:gap-0 [@media_(min-width:1536px)_and_(min-height:900px)]:overflow-hidden"
          }`}
        >
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className={`no-scrollbar overflow-y-auto overscroll-contain rounded-[24px] border border-[#e1e9e2] bg-[#f4f8f3] px-2.5 pb-5 pt-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] sm:rounded-[28px] sm:px-5 sm:pb-6 sm:pt-3 ${
              isConceptMode
                ? "min-h-0 flex-1"
                : "h-[clamp(360px,calc(100dvh-13rem),720px)] [@media_(min-width:1536px)_and_(min-height:900px)]:h-auto [@media_(min-width:1536px)_and_(min-height:900px)]:min-h-0 [@media_(min-width:1536px)_and_(min-height:900px)]:flex-1"
            }`}
          >
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2.5 pb-6">
              <div
                aria-hidden={isConceptMode}
                className={`sticky top-0 z-30 -mx-1 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-[#dbe7dd] bg-[#f4f8f3]/94 px-2 py-2 text-[12px] font-semibold text-[#5f6b62] shadow-[0_12px_28px_rgba(18,35,23,0.08)] backdrop-blur sm:-mx-2 sm:px-3 ${
                  isConceptMode ? "hidden" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${
                      realtimeEnabled && realtimeConnectionState === "connected"
                        ? "bg-[#2f8d5d]"
                        : "bg-[#b7c0b8]"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{realtimeStatusLabel}</span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  {!isConceptMode ? (
                    <>
                  <Button
                    type="button"
                    variant={translateAllEnabled ? "default" : "secondary"}
                    size="sm"
                    className={`h-8 rounded-full px-3 text-[11px] font-[800] ${
                      translateAllEnabled
                        ? "shadow-[0_10px_20px_rgba(34,102,70,0.16)]"
                        : "border border-[#cfe0d4] bg-white/88 text-[#24573d] shadow-[0_8px_18px_rgba(18,35,23,0.06)]"
                    }`}
                    onClick={handleTranslateAllToggle}
                    disabled={isTranslatingAll || isLoadingEarlierMessages}
                    title={
                      translateAllEnabled
                        ? "Show original conversation text"
                        : "Translate loaded stage chat messages"
                    }
                  >
                    {isTranslatingAll || isLoadingEarlierMessages ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Languages className="h-3.5 w-3.5" />
                    )}
                    {translateAllEnabled ? "Original" : "Translate All"}
                  </Button>
                  <ChatLanguagePicker
                    languages={SUPPORTED_CHAT_LANGUAGES}
                    selectedLanguage={selectedOutputLanguage}
                    disabled={isTranslatingAll || isLoadingEarlierMessages}
                    onSelect={(language) => setSelectedOutputLanguageCode(language.code)}
                  />
                    </>
                  ) : null}
                  {realtimeEnabled || onlineUsers.length > 0 ? (
                    <div
                      className="flex min-w-0 items-center gap-2 rounded-full border border-[#cfe0d4] bg-white/88 px-2.5 py-1 text-[#2f6f4b] shadow-[0_8px_18px_rgba(18,35,23,0.06)]"
                      aria-label={`${onlineUsers.length} ${
                        onlineUsers.length === 1 ? "person" : "people"
                      } online`}
                      title={
                        onlineUsers.length > 0
                          ? onlineUsers.map((user) => user.displayName).join(", ")
                          : "No users online"
                      }
                    >
                      <span className="size-2 rounded-full bg-[#2f8d5d]" aria-hidden="true" />
                      <div className="hidden -space-x-2 sm:flex">
                        {onlineUsers.slice(0, 4).map((user) => (
                          <span
                            key={user.userId}
                            className="grid size-6 place-items-center rounded-full border-2 border-white bg-[#e8f3eb] text-[9px] font-[800] text-[#2f6f4b]"
                            title={user.displayName}
                          >
                            {user.displayCode}
                          </span>
                        ))}
                      </div>
                      <span className="whitespace-nowrap">
                        {onlineUsers.length} online
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              {!isConceptMode && translateAllError ? (
                <div className="mb-2 rounded-[16px] border border-[#f0d4d2] bg-[#fff5f4] px-4 py-3 text-left text-[12px] font-semibold text-[#a64038]">
                  {translateAllError}
                </div>
              ) : null}
              {!isConceptMode && canAcceptCurrentStageBrief ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#acd9bd] bg-[linear-gradient(135deg,#f5fff6,#e6f7ea)] p-3 shadow-[0_18px_42px_rgba(22,93,56,0.16)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        Action required
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#173120]">
                      Accept the brief to start work on {activeStage?.label ?? "this stage"}.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="min-h-[44px] shrink-0 rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(34,102,70,0.2)]"
                      onClick={() => {
                        setAcceptBriefError(null);
                        setAcceptBriefDialogOpen(true);
                      }}
                      disabled={isAcceptingBrief}
                    >
                      {isAcceptingBrief ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {isConceptMode ? "Accept Brief / Start Work" : "Accept Brief"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {!isConceptMode &&
              canReviewLatestRevision &&
              latestRevisionMessage &&
              latestRevisionEntryId ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#b8dec5] bg-white/96 p-3 shadow-[0_18px_42px_rgba(22,93,56,0.14)] backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        Pending review
                      </p>
                      <p className="mt-1 truncate text-[14px] font-[800] leading-5 text-[#173120]">
                        {latestRevisionLabel} · Pending Review
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="min-h-[44px] shrink-0 rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(34,102,70,0.2)]"
                        onClick={() => openRevisionReview(latestRevisionEntryId)}
                        disabled={pendingRevisionReviewId === latestRevisionEntryId}
                      >
                        Review Submission
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-[44px] shrink-0 rounded-full border border-[#cfe0d4] bg-white px-5 text-[14px] font-[800] text-[#24573d]"
                        onClick={() => startRevisionReply(latestRevisionMessage)}
                        disabled={isChatReadOnly}
                      >
                        Add Comment
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              {showPostApprovalInvoiceAction ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#efd9af] bg-[#fffaf0]/96 p-3 shadow-[0_18px_42px_rgba(118,84,33,0.12)] backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#9a6a23]">
                        Invoice required
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#4a3a20]">
                        Submission approved. Invoice is required before this stage can be completed.
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[#775a2e]">
                        This stage requires an invoice before completion.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="min-h-[44px] shrink-0 rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(118,84,33,0.14)]"
                      onClick={openInvoiceRequestDialog}
                    >
                      Request Invoice
                    </Button>
                  </div>
                </div>
              ) : null}
              {canUploadStageInvoice ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#b8dec5] bg-white/96 p-3 shadow-[0_18px_42px_rgba(22,93,56,0.14)] backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        Invoice requested
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#173120]">
                        Please upload the invoice for this completed stage.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="min-h-[44px] shrink-0 rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(34,102,70,0.2)]"
                      onClick={openStageInvoiceUpload}
                      disabled={isUploadingStageInvoice}
                    >
                      {isUploadingStageInvoice ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload Invoice
                    </Button>
                  </div>
                </div>
              ) : null}
              {showInvoiceUploadedNextAction ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#b8dec5] bg-white/96 p-3 shadow-[0_18px_42px_rgba(22,93,56,0.14)] backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        Invoice uploaded
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#173120]">
                        {getActorDisplayName(
                          stageInvoiceAttachment?.uploadedBy ?? "Executor",
                          currentUserDisplayName,
                        )}{" "}
                        uploaded the invoice for this stage.
                      </p>
                    </div>
                    <div className="shrink-0">
                      {renderStageInvoiceActions({ includeCompleteAction: true })}
                    </div>
                  </div>
                </div>
              ) : null}
              {showProjectCompletionStickyAction ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#b8dec5] bg-white/96 p-3 shadow-[0_18px_42px_rgba(22,93,56,0.14)] backdrop-blur">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        {projectCompletionStickyAction.eyebrow}
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#173120]">
                        {projectCompletionStickyAction.title}
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[#5f6b62]">
                        {projectCompletionStickyAction.detail}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        className="min-h-[44px] rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(34,102,70,0.2)]"
                        onClick={() => setCompletionChecklistOpen(true)}
                      >
                        {projectCompletionStickyAction.buttonLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              {completionPrompt?.nextStageId && !completionPrompt.allStagesCompleted ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#acd9bd] bg-[linear-gradient(135deg,#f5fff6,#e6f7ea)] p-3 shadow-[0_18px_42px_rgba(22,93,56,0.16)] backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        Stage completed
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#173120]">
                        You can now move to the next stage.
                      </p>
                      {completionPrompt.nextStageLabel ? (
                        <p className="mt-1 text-[12px] leading-5 text-[#5f6b62]">
                          Next stage: {completionPrompt.nextStageLabel}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        className="min-h-[44px] rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(34,102,70,0.2)]"
                        onClick={() => navigateToStage(completionPrompt.nextStageId as string)}
                      >
                        Go to Next Stage
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-[44px] rounded-full border border-[#cfe0d4] bg-white px-5 text-[14px] font-[800] text-[#24573d]"
                        onClick={() => setCompletionPrompt(null)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              {!isConceptMode &&
              showSubmitWorkAction &&
              hasAcceptedBrief &&
              (canSubmitNewRevision || isUploadingRevision) ? (
                <div className="sticky top-[56px] z-20 mb-2 rounded-[22px] border border-[#acd9bd] bg-white/96 p-3 shadow-[0_18px_42px_rgba(22,93,56,0.14)] backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                        Ready for review
                      </p>
                      <p className="mt-1 text-[14px] font-[800] leading-5 text-[#173120]">
                        Submit your work for {activeStage?.label ?? "this stage"}.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="min-h-[44px] shrink-0 rounded-full px-5 text-[14px] font-[800] shadow-[0_12px_24px_rgba(34,102,70,0.2)]"
                      onClick={openRevisionDialog}
                      disabled={!canSubmitNewRevision || isUploadingRevision}
                    >
                      {isUploadingRevision ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Submit Work
                    </Button>
                  </div>
                </div>
              ) : null}
              <div ref={completionWorkflowRef} className="space-y-2.5 scroll-mt-24">
                {isProjectCompleted ? (
                  <CompletedProjectArchiveSummaryCard completionSummary={completionState} />
                ) : null}

                {shouldExpectCompletionWorkflow && isCompletionDataLoading ? (
                  <Card className="rounded-[20px] border border-[#dbe7dd] bg-[#f7fbf6] shadow-none">
                    <CardContent className="flex items-center gap-2 px-5 py-4 text-[13px] font-semibold text-[#5f6b62]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading completion details...
                    </CardContent>
                  </Card>
                ) : null}

                {showProjectCompletionLockedNotice ? (
                  <Card className="rounded-[18px] border border-[#efd9af] bg-[#fffaf0] shadow-none">
                    <CardContent className="px-5 py-4">
                      <p className="text-[14px] font-[800] text-[#8a5718]">
                        Project completion is locked until all stages are completed.
                      </p>
                      <ul className="mt-2 space-y-1 text-[12px] leading-5 text-[#5d4a2f]">
                        {completionVisibleBlockers.slice(0, 3).map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {!isProjectCompleted &&
                completionState.isFinalCompletionPending &&
                !showProjectCompletionStickyAction ? (
                  <Card className="rounded-[20px] border border-[#efd9af] bg-[#fffaf0] shadow-none">
                    <CardContent className="px-5 py-4">
                      <p className="text-[14px] font-semibold text-[#8a5718]">
                        Final completion requirements must be resolved before archive.
                      </p>
                      {completionState.finalCompletionBlockers.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-[12px] leading-5 text-[#5d4a2f]">
                          {completionState.finalCompletionBlockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                {!isProjectCompleted && shouldShowCompletionChecklist ? (
                  <Card className="rounded-[18px] border border-[#dbe7dd] bg-[#f7fbf6] shadow-none">
                    <CardContent className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[14px] font-[800] text-[#173120]">
                          Project Completion · {completionResolvedStepCount} of 3 checks completed
                        </p>
                        <p className="mt-1 text-[12px] text-[#5f6b62]">
                          {canCompleteProject
                            ? `${completionState.approvedFileCount} final file${
                                completionState.approvedFileCount === 1 ? "" : "s"
                              } ready for final archive.`
                            : "Open the guided checklist to resolve final completion blockers."}
                        </p>
                        {projectCompletionError ? (
                          <p className="mt-2 text-[12px] font-semibold text-[#bb4d49]">
                            {projectCompletionError}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-full text-[12px]"
                        onClick={() => setCompletionChecklistOpen(true)}
                      >
                        Open Checklist
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                {completionPrompt?.allStagesCompleted ? (
                  <Card className="rounded-[18px] border border-[#dbe7dd] bg-[#f7fbf6] shadow-none">
                    <CardContent className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[14px] font-semibold text-[#173120]">
                          All stages completed. Final project completion is now available.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="rounded-full text-[12px]"
                          onClick={() => setCompletionPrompt(null)}
                        >
                          Close
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
              </div>

          {hasEarlierMessages ? (
            <div className="flex justify-center py-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full border border-[#dbe7dd] bg-white text-[12px]"
                onClick={() => {
                  void loadEarlierMessages();
                }}
                disabled={isLoadingEarlierMessages}
              >
                {isLoadingEarlierMessages ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Load earlier messages
              </Button>
            </div>
          ) : null}

          {olderMessagesError ? (
            <div className="mx-auto max-w-[520px] rounded-[16px] border border-[#f0d4d2] bg-[#fff5f4] px-4 py-3 text-left text-[12px] font-semibold text-[#a64038]">
              {olderMessagesError}
            </div>
          ) : null}

          {stageStartSystemMessage ? (
            <SystemActivityCard
              message={stageStartSystemMessage}
              alignment={getTimelineEntryAlignment(
                stageStartSystemMessage,
                currentUserId,
                currentUserDisplayName,
              )}
              currentUserDisplayName={currentUserDisplayName}
              activityLabelOverride={
                isStageNeutralConceptMode ? "Concept update" : undefined
              }
            />
          ) : null}

          {isConceptMode && conceptMode && activeStage ? (
            <ConceptBriefContextCard
              brief={stageBriefText}
              attachments={stageBriefAttachments}
              assignedExecutorName={
                conceptMode.assignedExecutor?.name?.trim() ||
                conceptMode.assignedExecutor?.email ||
                "Unassigned"
              }
              hasAcceptedBrief={hasAcceptedBriefInTimeline}
              canImportStageThreeReference={
                conceptMode.stageNumber === 4 &&
                conceptMode.canManage &&
                !conceptMode.isWorkflowCompleted &&
                conceptMode.availableStageThreeReferences.length > 0
              }
              onImportStageThreeReference={() => {
                setSelectedStageThreeReferenceId(
                  conceptMode.availableStageThreeReferences[0]?.sourceConceptId ?? "",
                );
                setStageThreeReferenceError(null);
                setStageThreeReferenceDialogOpen(true);
              }}
            />
          ) : showBriefContextCard && activeStage ? (
            <StageBriefContextCard
              projectBriefText={projectBriefText}
              stageBriefText={stageBriefText}
              projectBriefAttachments={projectBriefAttachments}
              stageBriefAttachments={stageBriefAttachments}
              createdBy={project.createdBy}
              createdAt={project.createdOn}
              stageLabel={activeStage.label}
              canAcceptBrief={canAcceptCurrentStageBrief}
              showAcceptBriefAction={!canAcceptCurrentStageBrief}
              waitingTitle={briefAcceptanceWaitingTitle}
              waitingBody={briefAcceptanceWaitingBody}
              isAcceptingBrief={isAcceptingBrief}
              onAcceptBrief={() => {
                setAcceptBriefError(null);
                setAcceptBriefDialogOpen(true);
              }}
              onOpenProjectBrief={() => setProjectBriefDialogOpen(true)}
              onOpenStageBrief={() => setStageBriefDialogOpen(true)}
            />
          ) : null}

          {displayedMessages.length === 0 ? (
            <Card className="border border-dashed border-[#d8e1d8] px-6 py-10 text-left">
              <CardTitle className="text-[20px] font-semibold tracking-tight">
                {isStageNeutralConceptMode
                  ? "Concept Activity"
                  : `${activeStage?.label ?? "Stage"} History`}
              </CardTitle>
              <p className="mt-2 text-[14px] text-[#6e776f]">
                {isStageNeutralConceptMode
                  ? "No revisions or comments have been added to this concept yet."
                  : "No revisions or comments have been added to this stage yet."}
              </p>
              <p className="mt-1 text-[13px] text-[#8a938c]">
                {showBriefContextCard
                  ? "Accept the brief from the action panel before submitting the first revision."
                  : canAcceptCurrentStageBrief
                    ? "Accept the brief from the action panel before submitting the first revision."
                    : "Upload the first revision to start the proof and archive trail."}
              </p>
              {!isProjectCompleted && showBriefAcceptancePrompt ? (
                <div className="mt-5">
                  <WorkflowNoticeCard
                    title={briefAcceptanceWaitingTitle}
                    body={briefAcceptanceWaitingBody}
                  />
                </div>
              ) : null}
            </Card>
          ) : null}

          {displayedMessages.map((message) =>
            message.kind === "reference" ? (
              <ConceptReferenceTimelineCard
                key={message.id}
                message={message}
                currentUserId={currentUserId}
                currentUserDisplayName={currentUserDisplayName}
              />
            ) : message.kind === "system" ? (
              (() => {
                const isInvoiceUploadedMessage =
                  message.title === "Invoice uploaded";
                const bodyOverride =
                  message.title === "Invoice requested"
                    ? getInvoiceRequestTimelineBody()
                    : isInvoiceUploadedMessage
                      ? getInvoiceUploadedTimelineBody(message)
                      : null;
                const systemTitle = message.title ?? "Project activity";
                const systemBody = bodyOverride ??
                  replaceCurrentUserNameInText(
                    message.body,
                    message.author,
                    currentUserDisplayName,
                  );
                const translatedSystemTitle = getTranslatedStageChatText(
                  message.id,
                  "title",
                  systemTitle,
                );
                const translatedSystemBody = getTranslatedStageChatText(
                  message.id,
                  "body",
                  systemBody,
                );
                const translatedRevisionRequestReason =
                  message.revisionRequestReason
                    ? getTranslatedStageChatText(
                        message.id,
                        "revisionRequestReason",
                        message.revisionRequestReason,
                      )
                    : null;
                const action = isInvoiceUploadedMessage && !showInvoiceUploadedNextAction
                  ? renderStageInvoiceActions({
                      includeCompleteAction: isProjectOwner || canReviewSubmissions,
                    })
                  : null;

                return (
                  <SystemActivityCard
                    key={message.id}
                    message={message}
                    alignment={getTimelineEntryAlignment(
                      message,
                      currentUserId,
                      currentUserDisplayName,
                    )}
                    titleOverride={translatedSystemTitle}
                    bodyOverride={translatedSystemBody}
                    revisionRequestReasonOverride={translatedRevisionRequestReason}
                    action={action}
                    currentUserDisplayName={currentUserDisplayName}
                    activityLabelOverride={
                      isStageNeutralConceptMode ? "Concept update" : undefined
                    }
                  />
                );
              })()
            ) : message.kind === "revision" ? (
              (() => {
                const revisionAlignment = getTimelineEntryAlignment(
                  message,
                  currentUserId,
                  currentUserDisplayName,
                );
                const revisionEntryId = getRevisionEntryId(message);
                const reviewOverride = revisionReviewOverrides[revisionEntryId];
                const effectiveRevisionStatus = getEffectiveRevisionStatus(message);
                const effectiveRejectionReason =
                  reviewOverride?.rejectionReason ??
                  message.rejectionReason ??
                  null;
                const effectiveReviewedBy =
                  reviewOverride?.reviewedBy ?? message.reviewedBy ?? null;
                const effectiveReviewedAt =
                  reviewOverride?.reviewedAt ?? message.reviewedAt ?? null;
                const translatedRevisionBody = getTranslatedStageChatText(
                  message.id,
                  "body",
                  message.body,
                );
                const translatedRejectionReason = effectiveRejectionReason
                  ? getTranslatedStageChatText(
                      message.id,
                      "rejectionReason",
                      effectiveRejectionReason,
                    )
                  : null;
                const revisionStatusMeta = getRevisionStatusMeta(effectiveRevisionStatus);
                const revisionLabel = getRevisionLabel(message);
                const translatedWorkSubmittedLabel = getTranslatedStageChatText(
                  message.id,
                  "workSubmittedLabel",
                  "Work submitted",
                );
                const translatedRevisionStatusLabel = getTranslatedStageChatText(
                  message.id,
                  "statusLabel",
                  revisionStatusMeta.label,
                );
                const translatedRevisionLabel = getTranslatedStageChatText(
                  message.id,
                  "revisionLabel",
                  revisionLabel,
                );
                const submittedByLine = `Submitted by ${getActorDisplayName(
                  message.author,
                  currentUserDisplayName,
                )} · ${message.role}`;
                const translatedSubmittedByLine = getTranslatedStageChatText(
                  message.id,
                  "submittedByLine",
                  submittedByLine,
                );
                const translatedRevisionNoteLabel = getTranslatedStageChatText(
                  message.id,
                  "revisionNoteLabel",
                  "Revision note",
                );
                const translatedSubmittedFilesLabel = getTranslatedStageChatText(
                  message.id,
                  "submittedFilesLabel",
                  "Submitted files",
                );

                return (
                  <TimelineFrame
                    key={message.id}
                    alignment={revisionAlignment}
                    width="submission"
                    avatarName={message.author}
                    avatarSrc={message.authorAvatarSrc}
                  >
                    <Card
                      className={`min-w-0 overflow-hidden rounded-[22px] border border-[#cfe3d2] bg-white shadow-[0_12px_30px_rgba(18,35,23,0.07)] ${
                        revisionAlignment === "right" ? "rounded-br-[8px]" : "rounded-bl-[8px]"
                      }`}
                    >
                      <div className="space-y-3.5 bg-[linear-gradient(135deg,#f8fbf7,#ffffff)] px-4 py-4 sm:px-5">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e4f3e7] text-brand">
                            <Upload className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[#edf7ef] px-2.5 py-1 text-[9px] font-[800] uppercase tracking-[0.08em] text-brand">
                                {translatedWorkSubmittedLabel}
                              </span>
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide ${revisionStatusMeta.badgeClassName}`}
                              >
                                {translatedRevisionStatusLabel}
                              </span>
                              <span className="ml-auto min-w-fit text-[11px] font-semibold text-[#7a837b]">
                                {message.createdAt}
                              </span>
                            </div>
                            <h2 className="mt-2 text-[16px] font-[800] tracking-tight text-[#173120]">
                              {translatedRevisionLabel}
                            </h2>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-[#6f786f]">
                              <span>{translatedSubmittedByLine}</span>
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 rounded-[16px] border border-[#e3ece4] bg-white/78 px-3.5 py-3">
                          <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#657269]">
                            {translatedRevisionNoteLabel}
                          </p>
                          <RichTextContent value={translatedRevisionBody} className="mt-1.5 break-words text-[13px] leading-5 text-[#253028]" />
                        </div>

                        {effectiveRejectionReason ? (
                          <div className="rounded-[16px] border border-[#f0d0cc] bg-[#fff8f6] px-3.5 py-3 text-[#6f2721]">
                            <p className="text-[12px] font-[800] text-[#a73831]">
                              Revision requested
                            </p>
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[#b7655d]">
                              {effectiveReviewedBy
                                ? `Requested by ${getActorDisplayName(effectiveReviewedBy, currentUserDisplayName)}${
                                    effectiveReviewedAt ? ` · ${effectiveReviewedAt}` : ""
                                  }`
                                : "Requested by Project Owner"}
                            </p>
                            <RichTextContent value={translatedRejectionReason} className="mt-2 break-words text-[12px] font-semibold leading-5" />
                          </div>
                        ) : null}

                        {message.attachments?.length ? (
                          <div className="min-w-0 rounded-[16px] border border-[#e1e9e2] bg-[#f8fbf8] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#657269]">
                                {translatedSubmittedFilesLabel}
                              </p>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#6f786f]">
                                {message.attachments.length}
                              </span>
                            </div>
                            <AttachmentHistoryList
                              attachments={message.attachments}
                              approvedConceptAttachmentId={approvedConceptAttachmentId}
                              approvedFileLabel={approvedFileLabel}
                              markApprovedFileLabel={markApprovedFileLabel}
                              actionsDisabled={isProjectCompleted}
                              tone={revisionAlignment === "right" ? "sent" : "received"}
                              projectCategory={project.category}
                              showCaptionAction={canAddCaptions}
                              onOpenCaptions={(attachment) => openCaptionDialog(attachment)}
                              currentUserDisplayName={currentUserDisplayName}
                            />
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  </TimelineFrame>
                );
              })()
            ) : message.kind === "caption" ? (
              (() => {
                const caption = message.caption;

                if (!caption) {
                  return null;
                }

                const captionAlignment = getTimelineEntryAlignment(
                  message,
                  currentUserId,
                  currentUserDisplayName,
                );
                const translatedCaptionMessageBody = getTranslatedStageChatText(
                  message.id,
                  "body",
                  message.body,
                );
                const translatedCaptionBody = getTranslatedStageChatText(
                  message.id,
                  "captionBody",
                  caption.body,
                );
                const translatedCaptionAddedLabel = getTranslatedStageChatText(
                  message.id,
                  "captionAddedLabel",
                  "Caption added",
                );
                const translatedSubmissionLabel = getTranslatedStageChatText(
                  message.id,
                  "submissionLabel",
                  caption.submissionLabel,
                );
                const pinnedAtLabel = `Pinned at ${caption.xPercent.toFixed(1)}%, ${caption.yPercent.toFixed(1)}%`;
                const translatedPinnedAtLabel = getTranslatedStageChatText(
                  message.id,
                  "pinnedAtLabel",
                  pinnedAtLabel,
                );
                const translatedViewCaptionLabel = getTranslatedStageChatText(
                  message.id,
                  "viewCaptionLabel",
                  "View Caption",
                );

                return (
                  <TimelineFrame
                    key={message.id}
                    alignment={captionAlignment}
                    width="medium"
                    avatarName={message.author}
                    avatarSrc={message.authorAvatarSrc}
                  >
                    <Card
                      className={`w-full overflow-hidden rounded-[22px] border border-[#d8e7dc] bg-[linear-gradient(135deg,#f7fbf7,#ffffff)] p-4 shadow-[0_12px_30px_rgba(18,35,23,0.06)] ${
                        captionAlignment === "right" ? "rounded-br-[8px]" : "rounded-bl-[8px]"
                      }`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf7ef] px-3 py-1 text-[10px] font-[800] uppercase tracking-[0.08em] text-[#2b8b56]">
                              <MessageSquarePlus className="h-3.5 w-3.5" />
                              {translatedCaptionAddedLabel}
                            </span>
                            <span className="text-[11px] font-[600] text-[#7a837b]">
                              {message.createdAt}
                            </span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-[#253029]">
                            {translatedCaptionMessageBody}
                          </p>
                          <div className="mt-4 rounded-[16px] border border-[#dce9df] bg-white px-3 py-2.5">
                            <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#66806d]">
                              {translatedSubmissionLabel}
                            </p>
                            <p className="mt-1 truncate text-[12px] font-[700] text-[#1b241e]">
                              {caption.fileName}
                            </p>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-[#253029]">
                            {translatedCaptionBody}
                          </p>
                          <p className="mt-3 text-[10px] font-[600] uppercase tracking-[0.08em] text-[#7a837b]">
                            {translatedPinnedAtLabel}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 rounded-full text-[12px]"
                          onClick={() =>
                            openCaptionDialog(
                              {
                                id: caption.attachmentId,
                                originalFileName: caption.fileName,
                                mimeType: "image/png",
                                previewPath: `/api/project-assets/${caption.attachmentId}/preview`,
                              },
                              caption.id,
                            )
                          }
                        >
                          {translatedViewCaptionLabel}
                        </Button>
                      </div>
                    </Card>
                  </TimelineFrame>
                );
              })()
            ) : message.kind === "comparison" ? (
              (() => {
                const comparison = message.comparison;

                if (!comparison) {
                  return null;
                }

                const comparisonAlignment = getTimelineEntryAlignment(
                  message,
                  currentUserId,
                  currentUserDisplayName,
                );
                const comparisonHref = buildComparisonHref(
                  project.id,
                  activeStage?.id,
                  comparison.baseAttachmentId,
                  comparison.compareAttachmentId,
                  conceptMode?.compareHref,
                );
                const translatedComparisonBody = getTranslatedStageChatText(
                  message.id,
                  "body",
                  message.body,
                );
                const translatedComparisonSubmittedLabel = getTranslatedStageChatText(
                  message.id,
                  "comparisonSubmittedLabel",
                  "Comparison submitted",
                );
                const translatedBaseLabel = getTranslatedStageChatText(
                  message.id,
                  "baseLabel",
                  "Base",
                );
                const translatedCompareLabel = getTranslatedStageChatText(
                  message.id,
                  "compareLabel",
                  "Compare",
                );
                const comparisonPinnedAtLabel = `Pinned at ${comparison.xPercent.toFixed(1)}%, ${comparison.yPercent.toFixed(1)}%`;
                const translatedComparisonPinnedAtLabel = getTranslatedStageChatText(
                  message.id,
                  "pinnedAtLabel",
                  comparisonPinnedAtLabel,
                );
                const translatedViewComparisonLabel = getTranslatedStageChatText(
                  message.id,
                  "viewComparisonLabel",
                  "View Comparison",
                );

                return (
                  <TimelineFrame
                    key={message.id}
                    alignment={comparisonAlignment}
                    width="medium"
                    avatarName={message.author}
                    avatarSrc={message.authorAvatarSrc}
                  >
                    <Card
                      className={`w-full overflow-hidden rounded-[22px] border border-[#d3e1ea] bg-[linear-gradient(135deg,#f7fbff,#ffffff)] p-4 shadow-[0_12px_30px_rgba(18,35,23,0.06)] ${
                        comparisonAlignment === "right" ? "rounded-br-[8px]" : "rounded-bl-[8px]"
                      }`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f3fb] px-3 py-1 text-[10px] font-[800] uppercase tracking-[0.08em] text-[#3e78a6]">
                              <GitCompare className="h-3.5 w-3.5" />
                              {translatedComparisonSubmittedLabel}
                            </span>
                            <span className="text-[11px] font-[600] text-[#7a837b]">
                              {message.createdAt}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <div className="min-w-0">
	                              <p className="min-w-0 whitespace-normal break-words text-[13px] font-[700] text-[#111712]">
	                                {getActorDisplayName(
                                  message.author,
                                  currentUserDisplayName,
                                )}
	                              </p>
                              <p className="truncate text-[10px] text-[#7a837b]">
                                {message.role}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-[#253029]">
                            {translatedComparisonBody}
                          </p>
                          <div className="mt-4 grid gap-2 lg:grid-cols-2">
                            {[
                              {
                                label: translatedBaseLabel,
                                submission: comparison.baseSubmissionLabel,
                                fileName: comparison.baseFileName,
                              },
                              {
                                label: translatedCompareLabel,
                                submission: comparison.compareSubmissionLabel,
                                fileName: comparison.compareFileName,
                              },
                            ].map((item) => (
                              <div
                                key={item.label}
                                className="min-w-0 rounded-[16px] border border-[#dbe8ef] bg-white px-3 py-2.5"
                              >
                                <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#668092]">
                                  {item.label} · {item.submission}
                                </p>
                                <p className="mt-1 truncate text-[12px] font-[700] text-[#1b241e]">
                                  {item.fileName}
                                </p>
                              </div>
                            ))}
                          </div>
                          <p className="mt-3 text-[10px] font-[600] uppercase tracking-[0.08em] text-[#7a837b]">
                            {translatedComparisonPinnedAtLabel}
                          </p>
                        </div>
                        <Button
                          asChild
                          type="button"
                          size="sm"
                          className="shrink-0 rounded-full text-[12px]"
                        >
                          <Link href={comparisonHref}>{translatedViewComparisonLabel}</Link>
                        </Button>
                      </div>
                    </Card>
                  </TimelineFrame>
                );
              })()
            ) : (
              (() => {
                const linkedRevisionLabel = message.revisionId
                  ? revisionLabelById.get(message.revisionId) ?? "Revision"
                  : null;
                const isCurrentUserMessage =
                  getTimelineEntryAlignment(
                    message,
                    currentUserId,
                    currentUserDisplayName,
                  ) === "right";
                const isDeletedMessage = Boolean(message.deletedAt);
                const showDeleteMessageAction = canDeleteMessage(
                  message,
                  isCurrentUserMessage,
                );
                const previousMessageIndex = displayedMessages.findIndex(
                  (entry) => entry.id === message.id,
                ) - 1;
                const isGroupedWithPrevious =
                  !isCurrentUserMessage &&
                  shouldGroupWithPreviousMessage(
                    displayedMessages[previousMessageIndex],
                    message,
                  );
                const hasAttachments =
                  !isDeletedMessage && Boolean(message.attachments?.length);
                const hasSubmissionAttachment =
                  !isDeletedMessage &&
                  (message.attachments?.some((attachment) => attachment.isSubmission) ??
                    false);
                const attachmentLabel = hasSubmissionAttachment
                  ? "Submission uploaded"
                  : "Attachment uploaded";
                const translatedCommentOnRevisionLabel = getTranslatedStageChatText(
                  message.id,
                  "commentOnRevisionLabel",
                  "Comment on revision",
                );
                const translatedAttachmentLabel = getTranslatedStageChatText(
                  message.id,
                  "attachmentLabel",
                  attachmentLabel,
                );
                const translatedCommentBody = getTranslatedStageChatText(
                  message.id,
                  "body",
                  message.body,
                );
                const isTranslatedCommentBody =
                  translateAllEnabled && translatedCommentBody !== message.body;
                const bubbleClassName = linkedRevisionLabel
                  ? isCurrentUserMessage
                    ? "rounded-[18px] rounded-br-[6px] border border-[#abd7b6] bg-[#f1fbf3] p-2.5 shadow-[0_10px_24px_rgba(19,28,22,0.06)]"
                    : "rounded-[18px] rounded-bl-[6px] border border-[#d7e5d9] bg-white p-2.5 shadow-[0_10px_24px_rgba(19,28,22,0.05)]"
                  : isCurrentUserMessage
                    ? "rounded-[18px] rounded-br-[6px] border border-[#c3e2cb] bg-[#edf8ef] p-3 shadow-[0_10px_24px_rgba(19,28,22,0.06)]"
                    : "rounded-[18px] rounded-bl-[6px] border border-[#e2e9e2] bg-white p-3 shadow-[0_10px_24px_rgba(19,28,22,0.05)]";

                return (
                  <TimelineFrame
                    key={message.id}
                    alignment={isCurrentUserMessage ? "right" : "left"}
                    width="compact"
                    avatarName={message.author}
                    avatarSrc={message.authorAvatarSrc}
                    hideGutterContent={isGroupedWithPrevious}
                    grouped={isGroupedWithPrevious}
                  >
                    <Card
                      className={`relative min-w-0 ${bubbleClassName}`}
                      style={showDeleteMessageAction ? { paddingRight: "2.75rem" } : undefined}
                    >
                      {showDeleteMessageAction ? (
                        <div className="absolute right-2 top-2 z-10">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 border border-[#d9e5db] bg-white/90 text-[#58675d] shadow-[0_8px_18px_rgba(18,35,23,0.08)] hover:bg-white hover:text-[#173120]"
                                aria-label="Message actions"
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[11rem]">
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteMessageDialog(message)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete message
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                      {linkedRevisionLabel ? (
                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[9px] font-[800] uppercase tracking-[0.08em] ${
                              isCurrentUserMessage
                                ? "bg-white/78 text-brand"
                                : "bg-[#edf7ef] text-brand"
                            }`}
                          >
                            {linkedRevisionLabel}
                          </span>
                          <span className="text-[11px] font-[800] text-[#253028]">
                            {translatedCommentOnRevisionLabel}
                          </span>
                        </div>
                      ) : null}
                      {hasAttachments && !linkedRevisionLabel ? (
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-[800] uppercase tracking-[0.08em] text-brand">
                          <Paperclip className="h-3.5 w-3.5" />
                          {translatedAttachmentLabel}
                        </div>
                      ) : null}
                      <div
                        className={`flex min-w-0 items-center gap-2 ${
                          isCurrentUserMessage ? "justify-end" : ""
                        }`}
                      >
                        {isCurrentUserMessage ? (
                          <span className="text-[10px] font-semibold text-[#5d7463]">
                            You
                          </span>
	                        ) : (
	                          <div className="min-w-0">
	                            <p className="min-w-0 whitespace-normal break-words text-[12px] font-semibold text-[#111712]">
	                              {getActorDisplayName(
                                message.author,
                                currentUserDisplayName,
                              )}
	                            </p>
                            <p className="truncate text-[10px] text-[#8acb74]">
                              {message.role}
                            </p>
                          </div>
                        )}
                        <span
                          className={`shrink-0 text-[10px] ${
                            isCurrentUserMessage
                              ? "text-[#6f806f]"
                              : "ml-auto text-[#7d847e]"
                          }`}
                        >
                          {getCommentStatusLabel(message)}
                        </span>
                      </div>
                      {isDeletedMessage ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 whitespace-pre-wrap break-words text-[13px] italic leading-5 text-[#7b877f]">
                          <Trash2 className="h-3.5 w-3.5 shrink-0" />
                          {DELETED_STAGE_CHAT_MESSAGE_TEXT}
                        </p>
                      ) : (
                        <p
                          className={`mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 ${
                            isCurrentUserMessage ? "text-[#173120]" : "text-[#111712]"
                          }`}
                        >
                          {isTranslatedCommentBody
                            ? translatedCommentBody
                            : renderCommentBodyWithMentions(message.body, message.mentions)}
                        </p>
                      )}
                      {!isDeletedMessage && message.attachments?.length ? (
                        <AttachmentHistoryList
                          attachments={message.attachments}
                          compact
                          actionsDisabled={isProjectCompleted}
                          tone={isCurrentUserMessage ? "sent" : "received"}
                          projectCategory={project.category}
                          showCaptionAction={canAddCaptions}
                          onOpenCaptions={(attachment) => openCaptionDialog(attachment)}
                          currentUserDisplayName={currentUserDisplayName}
                        />
                      ) : null}
                    </Card>
                  </TimelineFrame>
                );
              })()
            ),
          )}

          {!hasRevisionEntries &&
          displayedMessages.length > 0 &&
          !isProjectCompleted &&
          !isStageCompleted &&
          showBriefAcceptancePrompt &&
          !showBriefContextCard ? (
            <div className="flex flex-wrap gap-2">
              {showBriefAcceptancePrompt ? (
                <div className="w-full">
                  <WorkflowNoticeCard
                    title={briefAcceptanceWaitingTitle}
                    body={briefAcceptanceWaitingBody}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {typingIndicatorText ? (
            <div className="mx-auto mb-2 mt-1 flex w-full max-w-[520px] items-center justify-center gap-2 rounded-full border border-[#dbe7dd] bg-white/88 px-4 py-2 text-[12px] font-semibold text-[#587062] shadow-[0_10px_24px_rgba(18,35,23,0.06)]">
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="size-1.5 rounded-full bg-[#6f9d7d] animate-pulse" />
                <span className="size-1.5 rounded-full bg-[#6f9d7d] animate-pulse [animation-delay:120ms]" />
                <span className="size-1.5 rounded-full bg-[#6f9d7d] animate-pulse [animation-delay:240ms]" />
              </span>
              {typingIndicatorText}
            </div>
          ) : null}
          {newRealtimeMessageCount > 0 ? (
            <div className="sticky bottom-2 z-20 flex justify-center">
              <Button
                type="button"
                size="sm"
                className="rounded-full text-[12px] shadow-[0_12px_28px_rgba(31,115,74,0.18)]"
                onClick={() => {
                  setNewRealtimeMessageCount(0);
                  setIsNearChatBottom(true);
                  scrollToChatBottom();
                }}
              >
                {newRealtimeMessageCount === 1
                  ? "New message"
                  : `${newRealtimeMessageCount} new messages`}
              </Button>
            </div>
          ) : null}
              <div ref={chatBottomRef} />
            </div>
          </div>

          {isConceptMode && canAcceptCurrentStageBrief ? (
            <Card className="mx-auto w-full max-w-[1120px] shrink-0 rounded-[20px] border border-[#acd9bd] bg-[linear-gradient(135deg,#f5fff6,#e6f7ea)] px-3 py-2.5 shadow-[0_10px_28px_rgba(22,93,56,0.1)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                    Action required
                  </p>
                  <p className="mt-0.5 truncate text-[13px] font-[800] text-[#173120]">
                    {isStageNeutralConceptMode
                      ? "Accept the brief to start work on this concept."
                      : `Accept the brief to start work on ${activeStage?.label ?? "this stage"}.`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 rounded-full px-4 text-[12px] font-[800]"
                  onClick={() => {
                    setAcceptBriefError(null);
                    setAcceptBriefDialogOpen(true);
                  }}
                  disabled={isAcceptingBrief}
                >
                  {isAcceptingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Accept Brief / Start Work
                </Button>
              </div>
            </Card>
          ) : null}

          {isConceptMode &&
          showSubmitWorkAction &&
          hasAcceptedBrief &&
          (canSubmitNewRevision || isUploadingRevision) ? (
            <Card className="mx-auto w-full max-w-[1120px] shrink-0 rounded-[20px] border border-[#dbe7dd] bg-white/96 px-3 py-2.5 shadow-[0_10px_28px_rgba(22,93,56,0.08)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-[12px] font-[650] text-[#536158]">
                  {submitWorkDisabledReason ?? "Submit the next concept revision for review."}
                </p>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    onClick={openRevisionDialog}
                    disabled={!canSubmitNewRevision || isUploadingRevision}
                  >
                    <Upload className="h-4 w-4" />
                    Submit Work
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          {showLatestRevisionActionBar && latestRevisionMessage ? (
            <Card
              className={`mx-auto w-full shrink-0 rounded-[20px] border border-[#dfe8df] bg-white/95 px-3 py-2 shadow-[0_10px_28px_rgba(18,35,23,0.07)] backdrop-blur ${
                isConceptMode
                  ? "max-w-[1120px]"
                  : "max-w-[980px] [@media_(min-width:1536px)_and_(min-height:900px)]:mt-2 [@media_(min-width:1536px)_and_(min-height:900px)]:rounded-[22px] [@media_(min-width:1536px)_and_(min-height:900px)]:px-4 [@media_(min-width:1536px)_and_(min-height:900px)]:py-3"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#657269]">
                    Latest revision actions
                  </p>
                  <p className="mt-1 truncate text-[13px] font-semibold text-[#173120]">
                    {latestRevisionLabel} ·{" "}
                    {getRevisionStatusMeta(latestRevisionStatus ?? "PENDING_REVIEW").label}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canCompareSubmissions && conceptMode ? (
                    <Button
                      asChild
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-full text-[12px]"
                    >
                      <Link href={conceptMode.compareHref}>
                        <GitCompare className="h-4 w-4" />
                        Compare Submissions
                      </Link>
                    </Button>
                  ) : null}
                  {canReviewLatestRevision && latestRevisionEntryId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-full text-[12px]"
                      disabled={pendingRevisionReviewId === latestRevisionEntryId}
                      onClick={() => openRevisionReview(latestRevisionEntryId)}
                    >
                      Review Submission
                    </Button>
                  ) : null}
                  {canMarkLatestRevisionComplete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-full text-[12px]"
                      disabled={isStageCompleted || isMarkingStageComplete}
                      onClick={() => {
                        setStageCompleteError(null);
                        setStageCompleteDialogOpen(true);
                      }}
                    >
                      {isStageCompleted ? "Stage completed" : "Mark as complete"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={() => startRevisionReply(latestRevisionMessage)}
                    size="sm"
                    variant="secondary"
                    className="rounded-full text-[12px]"
                    disabled={isChatReadOnly}
                  >
                    Add Comments
                  </Button>
                  {conceptMode ? (
                    <Button
                      asChild
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-full text-[12px]"
                    >
                      <Link href={conceptMode.backHref}>
                        <ArrowLeft className="h-4 w-4" />
                        {conceptMode.backLabel ??
                          (isStageNeutralConceptMode
                            ? "Back to Workspace"
                            : "Back to Concept Taskers")}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}

          {isChatReadOnly ? (
            <Card className={`${composerPositionClass} z-30 mx-auto w-full max-w-[980px] shrink-0 rounded-[20px] border border-[#dbe7dd] bg-[#f7fbf6]/96 p-3 shadow-[0_14px_34px_rgba(18,35,23,0.08)] backdrop-blur [@media_(min-width:1536px)_and_(min-height:900px)]:static [@media_(min-width:1536px)_and_(min-height:900px)]:mt-2 [@media_(min-width:1536px)_and_(min-height:900px)]:rounded-[22px] [@media_(min-width:1536px)_and_(min-height:900px)]:bg-[#f7fbf6] [@media_(min-width:1536px)_and_(min-height:900px)]:p-4 [@media_(min-width:1536px)_and_(min-height:900px)]:shadow-none`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#173120]">
                    {isProjectCompleted
                      ? "Project chat is locked."
                      : isStageNeutralConceptMode
                        ? "Concept activity is read-only."
                        : "Stage chat is read-only."}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-[#5f6b62]">
                    {isProjectCompleted
                      ? "This project has been completed. Only final archived files and completion documents remain available for viewing or download."
                      : isStageNeutralConceptMode
                        ? "This concept work has been completed. Existing conversations remain available for reference, but new comments and attachments are disabled."
                        : "This stage has been completed. Existing conversations remain available for reference, but new comments and attachments are disabled."}
                  </p>
                </div>
                {conceptMode && !showLatestRevisionActionBar ? (
                  <Button
                    asChild
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-full shrink-0 rounded-full text-[12px] sm:w-auto"
                  >
                    <Link href={conceptMode.backHref}>
                      <ArrowLeft className="h-4 w-4" />
                      {conceptMode.backLabel ??
                        (isStageNeutralConceptMode
                          ? "Back to Workspace"
                          : "Back to Concept Taskers")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card
              className={`${composerPositionClass} z-30 mx-auto w-full shrink-0 border border-[#dfe8df] bg-white/96 shadow-[0_10px_28px_rgba(18,35,23,0.07)] backdrop-blur ${
                isConceptMode
                  ? "max-w-[1120px] rounded-[18px] p-1.5"
                  : "max-w-[980px] rounded-[22px] p-2 [@media_(min-width:1536px)_and_(min-height:900px)]:static [@media_(min-width:1536px)_and_(min-height:900px)]:mt-2 [@media_(min-width:1536px)_and_(min-height:900px)]:rounded-[26px] [@media_(min-width:1536px)_and_(min-height:900px)]:bg-white/95 [@media_(min-width:1536px)_and_(min-height:900px)]:p-3"
              }`}
            >
              <input
                ref={revisionFileInputRef}
                type="file"
                multiple
                accept={STAGE_SUBMISSION_ACCEPT}
                className="sr-only"
                onChange={(event) => {
                  handleRevisionFilesSelected(event.target.files);
                }}
              />
              <input
                ref={commentAttachmentInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  handleCommentFilesSelected(event.target.files);

                  if (commentAttachmentInputRef.current) {
                    commentAttachmentInputRef.current.value = "";
                  }
                }}
              />
              <input
                ref={stageInvoiceInputRef}
                type="file"
                className="sr-only"
                onChange={(event) => {
                  void handleStageInvoiceSelected(event.target.files);
                }}
              />

              {replyingToRevision ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[18px] border border-[#cfe3d2] bg-[#f7fbf6] px-3 py-2.5 text-[12px] text-[#304138]">
                  <span className="font-semibold text-brand">
                    Reply to {replyingToRevision.label}
                  </span>
                  <span className="text-[#66736a]">
                    This comment will stay linked to the revision.
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyingToRevision(null)}
                    className="ml-auto inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#6d776f] transition hover:bg-white hover:text-[#27322b]"
                    aria-label="Clear revision reply context"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}

              {pendingCommentFiles.length ? (
                <div className="mb-3 flex flex-wrap gap-2 rounded-[18px] border border-[#e2e7e2] bg-[#fbfcfa] px-3 py-2.5">
                  {pendingCommentFiles.map((pendingFile) => (
                    <div
                      key={pendingFile.id}
                      className="inline-flex items-center gap-2 rounded-full border border-[#d6dfd7] bg-white px-3 py-1.5 text-[11px] text-[#324138]"
                    >
                      {pendingFile.assetType === "STAGE_SUBMISSION" ? (
                        <span className="rounded-full bg-[#edf7ef] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#2b8b56]">
                          Submission
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#f4f7f4] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#566259]">
                          Attachment
                        </span>
                      )}
                      <FileThumbnail fileName={pendingFile.file.name} mimeType={pendingFile.file.type} file={pendingFile.file} className="h-8 w-10" />
                      <span className="max-w-[180px] truncate">{pendingFile.file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePendingCommentFile(pendingFile.id)}
                        className="cursor-pointer text-[#7d847e] transition hover:text-[#27322b]"
                        aria-label={`Remove ${pendingFile.file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {aiStatus ? (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#dbe6da] bg-[#f7fbf6] px-3 py-1.5 text-[12px] font-semibold text-[#31523f]">
                  {isListening ? (
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d9645b] opacity-70" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-[#d9645b]" />
                    </span>
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {aiStatus}
                </div>
              ) : null}

              {composerError ? (
                <div className="mb-3 rounded-[18px] border border-[#f0d4d2] bg-[#fff5f4] px-4 py-3 text-[13px] text-[#bd554f]">
                  {composerError}
                </div>
              ) : null}

              <div
                ref={mentionDropdownRef}
                className={`relative flex min-w-0 border border-[#dde6dd] bg-[#fbfcfa] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ${
                  isConceptMode
                    ? "flex-row items-end gap-1.5 rounded-[14px] px-2 py-1.5"
                    : "flex-col gap-1.5 rounded-[18px] px-2.5 py-2 sm:gap-2.5 sm:rounded-[22px] sm:px-4 sm:py-3"
                }`}
              >
                <Textarea
                  ref={draftInputRef}
                  value={draft}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDraft(nextValue);
                    setDraftSelectionStart(event.target.selectionStart ?? event.target.value.length);
                    if (nextValue.trim()) {
                      notifyTypingActivity();
                    } else {
                      publishTypingStopped();
                    }
                  }}
                  onClick={(event) => {
                    setDraftSelectionStart(event.currentTarget.selectionStart ?? draft.length);
                  }}
                  onBlur={() => {
                    setDraftSelectionStart(-1);
                    publishTypingStopped();
                  }}
                  onKeyUp={(event) => {
                    setDraftSelectionStart(event.currentTarget.selectionStart ?? draft.length);
                  }}
                  onKeyDown={(event) => {
                    if (!mentionDropdownOpen) {
                      return;
                    }

                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveMentionIndex((current) =>
                        current + 1 >= mentionSuggestions.length ? 0 : current + 1,
                      );
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveMentionIndex((current) =>
                        current - 1 < 0 ? mentionSuggestions.length - 1 : current - 1,
                      );
                      return;
                    }

                    if (event.key === "Enter") {
                      const activeMention = mentionSuggestions[safeActiveMentionIndex];

                      if (activeMention) {
                        event.preventDefault();
                        handleSelectMention(activeMention);
                      }

                      return;
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setActiveMentionIndex(0);
                      setDraftSelectionStart(-1);
                    }
                  }}
                  placeholder={
                    isStageNeutralConceptMode
                      ? "Add a comment or upload files for this concept activity."
                      : "Add a comment or upload files for this stage revision history."
                  }
                  rows={1}
                  className={`box-border w-full min-w-0 resize-none overflow-y-hidden border border-transparent bg-white/70 text-[#29322c] shadow-none outline-none placeholder:text-[#9aa39b] focus-visible:ring-0 ${
                    isConceptMode
                      ? "max-h-[96px] min-h-10 rounded-[11px] px-2.5 py-2 text-[13px] leading-5"
                      : "max-h-[120px] min-h-[42px] rounded-[14px] px-3 py-2 text-[13px] leading-[20px] sm:max-h-[168px] sm:min-h-[58px] sm:rounded-[16px] sm:px-3.5 sm:py-3.5 sm:text-[14px] sm:leading-[22px]"
                  }`}
                />
                {mentionDropdownOpen ? (
                  <div className="absolute bottom-[calc(100%+10px)] left-0 right-0 z-20 overflow-hidden rounded-[22px] border border-[#dbe7dd] bg-white shadow-[0_18px_45px_rgba(23,39,28,0.12)]">
                    <div className="border-b border-[#eef2ee] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#6a756d]">
                      Mention collaborators
                    </div>
                    <div className="max-h-[260px] overflow-y-auto py-1.5">
                      {mentionSuggestions.map((participant, index) => {
                        const isActive = index === safeActiveMentionIndex;

                        return (
                          <button
                            key={participant.id}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleSelectMention(participant);
                            }}
                            className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition ${
                              isActive ? "bg-[#f4fbf5]" : "hover:bg-[#f8fbf8]"
                            }`}
                          >
                            <div className="grid h-10 w-10 place-items-center rounded-full bg-[linear-gradient(145deg,#f0dcc4,#b58257)] text-[12px] font-semibold text-white">
                              {getInitials(participant.name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="min-w-0 whitespace-normal break-words text-[14px] font-semibold text-[#173120]">
                                {participant.name}
                              </p>
                              <p className="truncate text-[12px] text-[#68736a]">
                                {participant.email || participant.role}
                              </p>
                            </div>
                            <span className="rounded-full bg-[#edf7ef] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#2b8b56]">
                              {participant.role}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div
                  className={`flex min-w-0 flex-nowrap items-center justify-end gap-1 ${
                    isConceptMode
                      ? "w-auto shrink-0 overflow-visible pb-0.5"
                      : "w-full overflow-x-auto border-t border-[#e5ece5] pt-1 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pt-2"
                  }`}
                >
                  {conceptMode && !showLatestRevisionActionBar ? (
                    <Button
                      asChild
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 rounded-full px-2 text-[11px] font-[750] text-[#405248]"
                    >
                      <Link href={conceptMode.backHref}>
                        <ArrowLeft className="h-4 w-4" />
                        <span>
                          {conceptMode.backLabel === "Back to Tasks"
                            ? "Tasks"
                            : isStageNeutralConceptMode
                              ? "Workspace"
                              : "Taskers"}
                        </span>
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-[#607064] sm:size-8"
                    aria-label="Expand message editor"
                    title="Expand message editor"
                    onClick={() => setExpandedMessageEditorOpen(true)}
                  >
                    <Maximize2 className="h-4.5 w-4.5" />
                  </Button>
                  {!isConceptMode ? (
                    <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-2 text-[11px] font-[700] text-[#5083ff] sm:h-8 sm:px-2.5"
                    aria-label="Translate"
                    title="Translate"
                    onClick={() => {
                      void handleTranslateDraft();
                    }}
                    disabled={isTranslating || isListening || isTranscribing}
                  >
                    {isTranslating ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Languages className="h-5 w-5" />
                    )}
                    <span className="hidden sm:inline">Translate</span>
                  </Button>
                  <ChatLanguagePicker
                    languages={SUPPORTED_CHAT_LANGUAGES}
                    selectedLanguage={selectedOutputLanguage}
                    disabled={isTranslating || isListening || isTranscribing}
                    onSelect={(language) => setSelectedOutputLanguageCode(language.code)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`size-7 sm:size-8 ${isListening ? "bg-[#fff1ef] text-[#d9645b] hover:bg-[#ffe7e3]" : "text-brand"}`}
                    aria-label={isListening ? "Stop recording" : "Start voice input"}
                    onClick={() => {
                      void handleMicrophoneToggle();
                    }}
                    disabled={isTranscribing || isTranslating}
                  >
                    {isTranscribing ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : isListening ? (
                      <Square className="h-4 w-4 fill-current" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-brand sm:size-8"
                    aria-label="Attach file"
                    onClick={openCommentUploadDialog}
                  >
                    <Paperclip className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      void handleSendComment();
                    }}
                    size="sm"
                    className="h-8 rounded-full px-3 text-[12px] sm:px-4"
                    disabled={isSendingComment || !canSendComment}
                  >
                    {isSendingComment ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <aside
          className={`no-scrollbar min-w-0 space-y-4 pr-1 ${
            isConceptMode
              ? "hidden [@media_(min-width:1680px)_and_(min-height:900px)]:block [@media_(min-width:1680px)_and_(min-height:900px)]:h-full [@media_(min-width:1680px)_and_(min-height:900px)]:min-h-0 [@media_(min-width:1680px)_and_(min-height:900px)]:overflow-y-auto"
              : "[@media_(min-width:1536px)_and_(min-height:900px)]:h-full [@media_(min-width:1536px)_and_(min-height:900px)]:min-h-0 [@media_(min-width:1536px)_and_(min-height:900px)]:overflow-y-auto [@media_(min-width:1536px)_and_(min-height:900px)]:overscroll-contain"
          }`}
        >
          {conceptMode ? (
            <>
              <Card className="rounded-[20px] border border-brand/35">
                <CardHeader className="pb-3">
                  <CardTitle className="text-[18px] font-semibold tracking-tight text-brand">
                    Concept Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <dl className="space-y-2 text-[12px] text-[#344139]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-semibold text-[#6b776e]">Assigned Executor</dt>
                      <dd className="min-w-0 whitespace-normal break-words font-[750]">
                        {conceptMode.assignedExecutor?.name?.trim() ||
                          conceptMode.assignedExecutor?.email ||
                          "Unassigned"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-semibold text-[#6b776e]">Work</dt>
                      <dd className="font-[750]">{stageExecutionStatus}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-semibold text-[#6b776e]">Revisions</dt>
                      <dd className="font-[750]">{stageRevisionCount}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-semibold text-[#6b776e]">Concept files</dt>
                      <dd className="font-[750]">{stageSubmissions.length}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
              <StageTimeRemainingCard
                actualStartedAt={activeStage?.actualStartedAtValue ?? null}
                stageDueAt={activeStage?.plannedDueAtValue ?? null}
              />
            </>
          ) : (
            <>
          <Card className="rounded-[20px] border border-brand/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-[20px] font-semibold tracking-tight text-brand">
                Stage Overview
              </CardTitle>
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
                  <dd className="inline">{stageRevisionCount}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Started At :</dt>{" "}
                  <dd className="inline">{activeStage?.actualStartedAt ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Started By :</dt>{" "}
                  <dd className="inline">{activeStage?.startedByName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Stage Deadline :</dt>{" "}
                  <dd className="inline">{activeStage?.plannedDueAt ?? project.endDate}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Status :</dt>{" "}
                  <dd className="inline">{stageExecutionStatus}</dd>
                </div>
              </dl>
              <div className="mt-5 space-y-2.5">
                {isStageCompleted ? (
                  <div className="rounded-[16px] border border-[#cfe6d5] bg-[#f3fbf5] px-3.5 py-3 text-[#1f6f46]">
                    <div className="flex items-center gap-2 text-[13px] font-[800]">
                      <CheckCircle2 className="h-4 w-4" />
                      Stage Completed
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-[#5f6b62]">
                      Work for this stage has already been submitted and completed.
                    </p>
                  </div>
                ) : null}
                {canUploadStageInvoice ? (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={openStageInvoiceUpload}
                      disabled={isUploadingStageInvoice}
                      className="min-w-[170px] text-[13px]"
                    >
                      {isUploadingStageInvoice ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload Invoice
                    </Button>
                    <p className="text-[11px] leading-4 text-[#6f786f]">
                      Invoice requested by{" "}
                      {getActorDisplayName(
                        stageInvoiceRequest?.requestedByName ?? "Project Owner",
                        currentUserDisplayName,
                      )}
                      .
                    </p>
                  </div>
                ) : null}
                {showSubmitWorkAction ? (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={openRevisionDialog}
                      disabled={!canSubmitNewRevision || isUploadingRevision}
                      className="min-w-[170px] text-[13px]"
                    >
                      {isUploadingRevision ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Submit Work
                    </Button>
                    {submitWorkDisabledReason ? (
                      <p className="text-[11px] leading-4 text-[#6f786f]">
                        {submitWorkDisabledReason}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {!isProjectCompleted && canCompareSubmissions ? (
                  <Button asChild size="sm" className="min-w-[170px] text-[13px]">
                    <Link href={`/projects/${project.id}/compare?stage=${activeStage?.id ?? ""}`}>
                      Compare Submissions
                    </Link>
                  </Button>
                ) : !isProjectCompleted && canViewCompareSubmissions ? (
                  <div className="space-y-1.5">
                    <Button type="button" size="sm" disabled className="min-w-[170px] text-[13px]">
                      Compare Submissions
                    </Button>
                    <p className="text-[11px] leading-4 text-[#6f786f]">
                      Upload at least two submissions to compare.
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setProjectBriefDialogOpen(true)}
                    className="min-w-[132px] text-[13px]"
                  >
                    <FileText className="h-4 w-4" />
                    Project Brief
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setStageBriefDialogOpen(true)}
                    disabled={!activeStage}
                    className="min-w-[120px] text-[13px]"
                  >
                    <FileText className="h-4 w-4" />
                    Stage Brief
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[20px] font-semibold tracking-tight text-[#111712]">
                Stage Invoice
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {activeStage?.invoiceRequired === false ? (
                <p className="text-[13px] leading-5 text-[#6f786f]">
                  {project.executionType === "INTERNAL"
                    ? "Not required for internal execution."
                    : "Invoice not required for this stage."}
                </p>
              ) : stageInvoiceAttachment ? (
                <AttachmentHistoryList
                  attachments={[stageInvoiceAttachment]}
                  compact
                  currentUserDisplayName={currentUserDisplayName}
                />
              ) : stageInvoiceRequest ? (
	                <div className="space-y-3">
	                  <p className="text-[13px] leading-5 text-[#6f786f]">
                    {canUploadStageInvoice ? "Invoice requested by " : "Invoice requested from "}
                    <span className="font-semibold text-[#26342c]">
                      {canUploadStageInvoice
                        ? getActorDisplayName(
                            stageInvoiceRequest.requestedByName,
                            currentUserDisplayName,
                          )
                        : getActorDisplayName(
                            stageInvoiceRequest.requestedFromName,
                            currentUserDisplayName,
                          )}
                    </span>
                    .
	                  </p>
                  {stageInvoiceRequest.note ? (
                    <p className="rounded-[14px] border border-[#dfe8df] bg-[#fbfcfa] px-3 py-2 text-[12px] leading-5 text-[#5f6b62]">
                      {stageInvoiceRequest.note}
                    </p>
                  ) : null}
                  {canUploadStageInvoice ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={openStageInvoiceUpload}
                      disabled={isUploadingStageInvoice}
                      className="text-[13px]"
                    >
                      {isUploadingStageInvoice ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload Invoice
                    </Button>
                  ) : (
                    <p className="text-[12px] leading-5 text-[#7b837d]">
                      Waiting for invoice upload.
                    </p>
                  )}
                </div>
              ) : canRequestStageInvoice ? (
                <div className="space-y-3">
                  <p className="text-[13px] leading-5 text-[#6f786f]">
                    This external stage requires an invoice before completion. Request
                    the invoice from the executor/vendor who performed the work.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="text-[13px]"
                    onClick={openInvoiceRequestDialog}
                  >
                    Request Invoice
                  </Button>
                </div>
              ) : (
                <p className="text-[13px] leading-5 text-[#6f786f]">
                  {hasApprovedStageSubmission
                    ? "Stage invoice is required before completion. Waiting for invoice request."
                    : hasOfficialStageSubmission
                      ? "Approve the submitted work before requesting the stage invoice."
                    : "Invoice can be requested after the first submission."}
                </p>
              )}
              {stageInvoiceError ? (
                <p className="mt-3 rounded-[14px] border border-[#f3c6c2] bg-[#fff5f3] px-3 py-2 text-[12px] leading-5 text-[#a64038]">
                  {stageInvoiceError}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <StageTimeRemainingCard
            actualStartedAt={activeStage?.actualStartedAtValue ?? null}
            stageDueAt={activeStage?.plannedDueAtValue ?? null}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[20px] font-semibold tracking-tight text-[#111712]">
                Project Assets
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {project.attachments.length > 0 ? (
                <div className="space-y-3">
                  <ProjectAssetGrid
                    attachments={inlineProjectAssets}
                    actionsDisabled={isProjectCompleted}
                    favoriteOverrides={projectAssetFavoriteOverrides}
                    onFavoriteChange={handleProjectAssetFavoriteChange}
                    currentUserDisplayName={currentUserDisplayName}
                  />
                  {hasMoreProjectAssets ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full rounded-full border border-line text-[12px]"
                      onClick={() => setProjectAssetsModalOpen(true)}
                    >
                      View More
                      <span className="text-[11px] text-[#6d776f]">
                        {project.attachments.length} assets
                      </span>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-[16px] border border-dashed border-[#d7ded7] bg-[#fbfcfa] px-4 py-5 text-left text-[13px] text-[#6e776f]">
                  No project assets uploaded yet.
                </div>
              )}
            </CardContent>
          </Card>

          {project.canViewParticipants ? (
            <>
              <ProjectExecutorsPanel
                executors={executors}
                currentUserId={currentUserId}
                onToggleChatVisibility={
                  canManageChatVisibility && !isProjectCompleted
                    ? (executorId, paused) =>
                        handleCollaboratorChatVisibilityToggle(executorId, paused)
                    : undefined
                }
                saving={collaboratorSaving}
              />

              <ProjectCollaboratorsPanel
                collaborators={collaborators}
                currentUserId={currentUserId}
                onRemove={
                  canManageCollaborators && !isProjectCompleted
                    ? (collaboratorId) => removeCollaborator(collaboratorId)
                    : undefined
                }
                onAdd={
                  canManageCollaborators && !isProjectCompleted
                    ? () => {
                        void openCollaboratorPicker();
                      }
                    : undefined
                }
                onToggleChatVisibility={
                  canManageChatVisibility && !isProjectCompleted
                    ? (collaboratorId, paused) =>
                        handleCollaboratorChatVisibilityToggle(collaboratorId, paused)
                    : undefined
                }
                saving={collaboratorSaving}
              />
            </>
          ) : null}
            </>
          )}
        </aside>
      </div>
      {expandedMessageEditorOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expanded-message-editor-title"
        >
          <Card className="flex max-h-[calc(100dvh-4rem)] w-full max-w-[760px] flex-col rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
              <div className="min-w-0">
                <CardTitle
                  id="expanded-message-editor-title"
                  className="text-[24px] font-semibold tracking-tight text-[#111712]"
                >
                  Write message
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  Compose a longer stage message before sending.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => {
                  publishTypingStopped();
                  setExpandedMessageEditorOpen(false);
                }}
                disabled={isSendingComment}
                className="shrink-0 border border-line"
                aria-label="Close expanded message editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
              <Textarea
                ref={expandedDraftInputRef}
                value={draft}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDraft(nextValue);
                  setDraftSelectionStart(event.target.selectionStart ?? event.target.value.length);
                  if (nextValue.trim()) {
                    notifyTypingActivity();
                  } else {
                    publishTypingStopped();
                  }
                }}
                onClick={(event) => {
                  setDraftSelectionStart(event.currentTarget.selectionStart ?? draft.length);
                }}
                onBlur={() => {
                  publishTypingStopped();
                }}
                onKeyUp={(event) => {
                  setDraftSelectionStart(event.currentTarget.selectionStart ?? draft.length);
                }}
                placeholder={
                  isStageNeutralConceptMode
                    ? "Add a comment or upload files for this concept activity."
                    : "Add a comment or upload files for this stage revision history."
                }
                className="box-border min-h-[340px] flex-1 resize-none rounded-[22px] border border-[#dfe8df] bg-[#fbfcfa] px-4 py-4 text-[15px] leading-6 text-[#29322c] shadow-inner outline-none placeholder:text-[#9aa39b] focus-visible:ring-3 focus-visible:ring-brand/15"
                disabled={isSendingComment || isChatReadOnly}
              />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] font-semibold text-[#7a847c]">
                  {draft.length.toLocaleString()} characters
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      publishTypingStopped();
                      setExpandedMessageEditorOpen(false);
                    }}
                    disabled={isSendingComment}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      await handleSendComment();
                      setExpandedMessageEditorOpen(false);
                    }}
                    disabled={isSendingComment || isChatReadOnly || !canSendComment}
                  >
                    {isSendingComment ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      <ProjectAssetsModal
        isOpen={projectAssetsModalOpen}
        attachments={project.attachments}
        actionsDisabled={isProjectCompleted}
        favoriteOverrides={projectAssetFavoriteOverrides}
        onFavoriteChange={handleProjectAssetFavoriteChange}
        onClose={() => setProjectAssetsModalOpen(false)}
        currentUserDisplayName={currentUserDisplayName}
      />
      <CollaboratorPickerDialog
        isOpen={collaboratorPickerOpen}
        collaborators={availableCollaboratorRecords}
        selectedIds={selectedCollaboratorIds}
        saving={collaboratorSaving}
        onToggle={toggleAssignedCollaborator}
        onClose={() => {
          setCollaboratorDialogError(undefined);
          setDraftCollaboratorIds([]);
          setCollaboratorPickerOpen(false);
        }}
        onConfirm={() => {
          void applyCollaboratorsSelection();
        }}
        onInviteFallback={openCollaboratorInvite}
        confirmLabel="Apply Selection"
      />
      <CollaboratorDialog
        isOpen={collaboratorDialogOpen}
        mode="invite"
        form={collaboratorForm}
        error={collaboratorDialogError}
        saving={collaboratorSaving}
        onClose={() => {
          setCollaboratorDialogError(undefined);
          setCollaboratorDialogOpen(false);
        }}
        onSubmit={() => {
          void handleCollaboratorInvite();
        }}
        onChange={setCollaboratorFormValue}
      />
      <ConfirmationDialog
        isOpen={uploadNavigationGuard.isNavigationDialogOpen}
        title="Upload in progress"
        description={UPLOAD_NAVIGATION_WARNING}
        confirmLabel="Leave Page"
        cancelLabel="Stay"
        onClose={uploadNavigationGuard.cancelNavigation}
        onConfirm={uploadNavigationGuard.confirmNavigation}
      />
      <ConfirmationDialog
        isOpen={acceptBriefDialogOpen}
        title={isConceptMode ? "Accept concept brief and start work?" : "Accept brief and start work?"}
        description={
          isConceptMode
            ? "This confirms that you reviewed the Concept Brief and are starting work on this concept. The work timer starts from this moment."
            : "This confirms that you have reviewed the Project Brief and Stage Brief and are starting work on this stage. The stage timer will start from this moment."
        }
        confirmLabel="Accept & Start Work"
        pending={isAcceptingBrief}
        error={acceptBriefError ?? undefined}
        onClose={() => {
          setAcceptBriefError(null);
          setAcceptBriefDialogOpen(false);
        }}
        onConfirm={() => {
          void handleAcceptBrief();
        }}
      />
      <ConfirmationDialog
        isOpen={reviewCompleteDialogOpen && !activeStage?.isTasker}
        title={reviewCompletionIsFinalStage ? "Approve final submission?" : "Approve submission?"}
        description={
          stageInvoiceMissing
            ? "This will approve the submitted work. Invoice is required after approval before this stage can be completed."
            : reviewCompletionIsFinalStage
            ? "This will approve the submitted revision and complete the final stage. Project completion and final archive happen after all stages are complete."
            : "This will mark the submitted revision as completed, complete the current stage, and make the next stage available."
        }
        confirmLabel="Approve Submission"
        pending={Boolean(pendingRevisionReviewId)}
        error={reviewDialogError ?? undefined}
        onClose={() => {
          if (pendingRevisionReviewId) {
            return;
          }

          setReviewDialogError(null);
          setReviewCompleteDialogOpen(false);
        }}
        onConfirm={() => {
          void handleRevisionReview("APPROVED");
        }}
      />
      <ConfirmationDialog
        isOpen={stageCompleteDialogOpen}
        title={stageInvoiceMissing ? "Invoice required" : "Mark Stage Complete"}
        description={
          stageInvoiceMissing
            ? stageInvoiceRequest
              ? "Invoice is required before completing this stage. Waiting for the requested executor/vendor to upload it."
              : !hasOfficialStageSubmission
                ? "Invoice is required before completing this stage. Submit work first to request an invoice."
              : "Invoice is required before completing this stage. Request invoice from the executor."
            : "This will mark the current stage as completed. Project owners, co-owners, and administrators can do this."
        }
        confirmLabel={
          stageInvoiceMissing
            ? !hasOfficialStageSubmission
              ? "Waiting for Submission"
              : canRequestStageInvoice && !stageInvoiceRequest
              ? "Request Invoice"
              : "Waiting for Invoice"
            : "Mark as Complete"
        }
        pending={stageInvoiceMissing ? false : isMarkingStageComplete}
        confirmDisabled={stageInvoiceMissing && (!canRequestStageInvoice || Boolean(stageInvoiceRequest))}
        error={(stageInvoiceMissing ? stageInvoiceError : stageCompleteError) ?? undefined}
        onClose={() => {
          setStageCompleteError(null);
          setStageCompleteDialogOpen(false);
        }}
        onConfirm={() => {
          if (stageInvoiceMissing) {
            if (canRequestStageInvoice && !stageInvoiceRequest) {
              openInvoiceRequestDialog();
            }
            return;
          }

          void handleMarkStageComplete();
        }}
      />
      <ConfirmationDialog
        isOpen={Boolean(deleteMessageTarget)}
        title="Delete message?"
        description="Delete this message? Others will see that a message was deleted."
        confirmLabel="Delete message"
        tone="destructive"
        pending={isDeletingMessage}
        error={deleteMessageError ?? undefined}
        onClose={() => {
          if (isDeletingMessage) {
            return;
          }

          setDeleteMessageError(null);
          setDeleteMessageTarget(null);
        }}
        onConfirm={() => {
          void handleConfirmDeleteMessage();
        }}
      />
      {!isConceptMode ? <>
      <BriefDialog
        isOpen={projectBriefDialogOpen}
        labelledById="project-brief-title"
        title="Project Brief"
        heading={project.title}
        context={activeStage ? `Current stage: ${activeStage.label}` : undefined}
        body={projectBriefText}
        emptyMessage="No project brief has been added."
        attachmentsTitle="Project Brief Attachments"
        attachments={projectBriefAttachments}
        onClose={() => setProjectBriefDialogOpen(false)}
      />
      <BriefDialog
        isOpen={stageBriefDialogOpen}
        labelledById="stage-brief-title"
        title="Stage Brief"
        heading={activeStage?.label ?? "Current stage"}
        context={project.title}
        body={stageBriefText}
        emptyMessage="No stage brief has been added for this stage."
        attachmentsTitle="Stage Brief Attachments"
        attachments={stageBriefAttachments}
        onClose={() => setStageBriefDialogOpen(false)}
      />
      </> : null}
      {!isConceptMode && completionChecklistOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]">
          <Card className="flex h-full max-h-[90vh] w-full max-w-[1120px] flex-col rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-[#e7ede7] p-6 sm:p-7">
              <div className="min-w-0">
                <p className="text-[11px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                  Guided final workflow
                </p>
                <CardTitle className="mt-1 text-[24px] font-semibold tracking-tight text-[#111712]">
                  Project Completion
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  Complete the final checks before archiving this project.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCompletionChecklistOpen(false)}
                className="shrink-0 border border-line"
                aria-label="Close project completion checklist"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>

            <CardContent className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
              {effectiveCompletionWorkflow ? (
                <>
                  <div className="mb-4 rounded-[20px] border border-[#dbe7dd] bg-[#f7fbf6] px-4 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-[14px] font-[800] text-[#173120]">
                          Project Completion · {completionResolvedStepCount} of 3 checks completed
                        </p>
                        <p className="mt-1 text-[12px] leading-5 text-[#5f6b62]">
                          {canCompleteProject
                            ? "All final completion checks are resolved. Archive can proceed."
                            : "Resolve the blockers below before archiving."}
                        </p>
                      </div>
                      <span
                        className={`inline-flex w-fit rounded-full px-3 py-1 text-[10px] font-[800] uppercase tracking-[0.08em] ${
                          canCompleteProject
                            ? "bg-[#edf7ef] text-[#2b8b56]"
                            : "bg-[#fff7ea] text-[#b77420]"
                        }`}
                      >
                        {canCompleteProject ? "Ready to archive" : "Blocked"}
                      </span>
                    </div>

                    {completionVisibleBlockers.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-[12px] leading-5 text-[#5d4a2f]">
                        {completionVisibleBlockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <ProjectCompletionChecklist
                    projectId={project.id}
                    workflow={effectiveCompletionWorkflow}
                    surface="plain"
                  />
                </>
              ) : (
                <div className="rounded-[20px] border border-[#dbe7dd] bg-[#f7fbf6] px-5 py-5">
                  <div className="flex items-center gap-2 text-[13px] font-[800] text-[#5f6b62]">
                    {isCompletionDataLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {isCompletionDataLoading
                      ? "Loading completion details..."
                      : "Completion workflow is unavailable for this project."}
                  </div>
                  {!isCompletionDataLoading ? (
                    <p className="mt-2 text-[12px] leading-5 text-[#6a706b]">
                      Complete all stages first, then reopen the guided checklist.
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>

            <div className="flex flex-col gap-3 border-t border-[#e7ede7] px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="text-[12px] leading-5 text-[#6a706b]">
                Archive remains locked until authority approval, copyright transfer,
                and final invoice are completed or marked not required.
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-full text-[12px]"
                  onClick={() => setCompletionChecklistOpen(false)}
                  disabled={isPreparingProjectCompletion}
                >
                  Close
                </Button>
                {canArchiveProject ? (
                  <Button
                    type="button"
                    className="rounded-full text-[12px]"
                    disabled={
                      !effectiveCompletionWorkflow ||
                      !canCompleteProject ||
                      isPreparingProjectCompletion ||
                      isCompletionDataLoading
                    }
                    onClick={() => {
                      void handlePrepareProjectCompletion();
                    }}
                  >
                    {isPreparingProjectCompletion ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Archive Project
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      ) : null}
      {archivePreparation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]">
          <Card className="flex h-full max-h-[88vh] w-full max-w-[1080px] flex-col rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
              <div>
                <CardTitle className="text-[24px] font-semibold tracking-tight text-[#111712]">
                  Final Archive Files
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  Review final files, complete Artwork Legend metadata, and archive only
                  after all required fields are ready.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={resetProjectCompletionFlow}
                disabled={isCompletingProject}
                className="shrink-0 border border-line"
                aria-label="Close archive preparation dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
              {archiveCompletionError ? (
                <div className="mb-5 rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
                  {archiveCompletionError}
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-4">
                {archiveWizardSteps.map((step, index) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setArchiveWizardStep(index as ArchiveWizardStep)}
                    className={`rounded-[16px] border px-3 py-3 text-left transition ${
                      archiveWizardStep === index
                        ? "border-brand bg-[#eef8f0] text-[#173120]"
                        : "border-[#dce6dd] bg-white text-[#5f6b62] hover:border-brand/50"
                    }`}
                    disabled={isCompletingProject}
                  >
                    <span className="block text-[10px] font-[800] uppercase tracking-[0.08em]">
                      Step {index + 1}
                    </span>
                    <span className="mt-1 block text-[13px] font-[800]">{step}</span>
                  </button>
                ))}
              </div>

              {archiveWizardStep === 0 ? (
                <div className="mt-5 space-y-4">
                  <div className="grid gap-4 rounded-[20px] border border-line bg-[#fbfcfa] p-4 sm:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
                        Project
                      </p>
                      <p className="mt-1 text-[16px] font-semibold text-[#111712]">
                        {archivePreparation.projectName}
                      </p>
                      <p className="mt-1 text-[13px] text-[#687269]">
                        Final stage: {archivePreparation.finalStageName}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
                        Archive Category *
                      </p>
                      <Select value={archiveCategoryId} onValueChange={setArchiveCategoryId}>
                        <SelectTrigger className="h-11 rounded-[14px] border border-line">
                          <SelectValue placeholder="Choose archive category" />
                        </SelectTrigger>
                        <SelectContent>
                          {archivePreparation.categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.parentName
                                ? `${category.parentName} / ${category.name}`
                                : category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {archivePreparation.files.map((file) => {
                    const nextFileName =
                      archiveFileNames[file.sourceAttachmentId] ?? file.defaultArchiveFileName;
                    const inlineError = archiveFileErrors[file.sourceAttachmentId];

                    return (
                      <div
                        key={file.sourceAttachmentId}
                        className="rounded-[20px] border border-[#dbe4dc] bg-white p-4 shadow-[0_10px_26px_rgba(16,26,20,0.05)]"
                      >
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <FileThumbnail
                                fileName={file.originalFileName}
                                mimeType={file.mimeType}
                                previewPath={file.previewPath}
                                fallback={<span className={`grid h-full w-full place-items-center text-[10px] font-semibold ${getFileBadgeClass(file.fileTypeLabel)}`}>{file.fileTypeLabel}</span>}
                              />
                              <p className="truncate text-[14px] font-semibold text-[#111712]">
                                {file.originalFileName}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-3 text-[12px] text-[#667168]">
                              <span>{file.fileSizeLabel}</span>
                              <span>{file.sourceLabel}</span>
                            </div>
                            <div className="flex gap-2">
                              <AssetPreviewButton
                                fileName={file.originalFileName}
                                mimeType={file.mimeType}
                                previewPath={file.previewPath}
                                downloadPath={file.downloadPath}
                                iconOnly={false}
                                triggerClassName="rounded-full border border-line px-3 text-brand"
                              />
                              <Button
                                asChild
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="rounded-full text-[12px]"
                              >
                                <a href={file.downloadPath} target="_blank" rel="noreferrer">
                                  <Download className="h-4 w-4" />
                                  Download
                                </a>
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#70806f]">
                              Final Archive File Name *
                            </p>
                            <Input
                              value={nextFileName}
                              onChange={(event) =>
                                updateArchiveFileName(
                                  file.sourceAttachmentId,
                                  event.target.value,
                                )
                              }
                              placeholder="Enter archive file name"
                              className={`h-11 rounded-[14px] border ${inlineError ? "border-[#df6f66]" : "border-line"}`}
                              disabled={isCompletingProject}
                            />
                            {inlineError ? (
                              <p className="text-[12px] text-[#c14f46]">{inlineError}</p>
                            ) : (
                              <p className="text-[11px] text-[#7a837b]">
                                Keep the original file extension when renaming.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {archiveWizardStep === 1 ? (
                <div className="mt-5">
                  <ArchiveMetadataIdentificationStep
                    files={archiveMetadataWizardFiles}
                    onChange={updateArchiveMetadataField}
                    onApplyToAll={applyProjectMetadataToAllArchiveFiles}
                    disabled={isCompletingProject}
                    description="Complete Artwork Legend identification for each final file."
                  />
                </div>
              ) : null}

              {archiveWizardStep === 2 ? (
                <div className="mt-5">
                  <ArchiveMetadataTechnicalStep
                    files={archiveMetadataWizardFiles}
                    onChange={updateArchiveMetadataField}
                    disabled={isCompletingProject}
                  />
                </div>
              ) : null}

              {archiveWizardStep === 3 ? (
                <div className="mt-5">
                  <ArchiveMetadataReviewList
                    files={archiveMetadataWizardFiles}
                    getFinalFileName={(file) => {
                      const sourceFile = archivePreparation.files.find(
                        (candidate) => candidate.sourceAttachmentId === file.id,
                      );

                      return (
                        archiveFileNames[file.id] ??
                        sourceFile?.defaultArchiveFileName ??
                        file.originalFileName
                      );
                    }}
                    onEditMetadata={() => setArchiveWizardStep(1)}
                    missingMetadataCount={archiveMissingMetadataCount}
                    fileCountLabel={`${archivePreparation.files.length} final files`}
                  />
                </div>
              ) : null}

              <div className="sticky bottom-0 mt-6 flex flex-col gap-3 border-t border-[#e3ebe4] bg-white/95 pt-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-5 text-[#687269]">
                  Working files remain in logs, Library, and stage history. Only final
                  approved files are archived.
                </p>
                <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={resetProjectCompletionFlow}
                  disabled={isCompletingProject}
                >
                  Cancel
                </Button>
                {archiveWizardStep > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isCompletingProject}
                    onClick={() =>
                      setArchiveWizardStep((current) => Math.max(0, current - 1) as ArchiveWizardStep)
                    }
                  >
                    Previous
                  </Button>
                ) : null}
                {archiveWizardStep < 3 ? (
                  <Button
                    type="button"
                    disabled={
                      isCompletingProject ||
                      (archiveWizardStep === 0 &&
                        (!archiveCategoryId || archiveHasBlockingFileErrors))
                    }
                    onClick={() =>
                      setArchiveWizardStep((current) => Math.min(3, current + 1) as ArchiveWizardStep)
                    }
                  >
                    Next
                  </Button>
                ) : null}
                {archiveWizardStep === 3 ? (
                <Button
                  type="button"
                  onClick={() => {
                    void handleCompleteProjectArchive();
                  }}
                  disabled={isCompletingProject || !canSubmitFinalArchive}
                >
                  {isCompletingProject ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Archive Project
                </Button>
                ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {commentUploadDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]">
          <Card className="w-full max-w-[560px] rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
              <div>
                <CardTitle className="text-[24px] font-semibold tracking-tight text-[#111712]">
                  Upload attachment
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  Attach discussion files here. Use Submit Work to send files for review.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCommentUploadDialogOpen(false)}
                className="shrink-0 border border-line"
                aria-label="Close upload type dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
              {!isConceptMode && canUploadStageInvoice ? (
                <button
                  type="button"
                  onClick={openStageInvoiceUpload}
                  disabled={isUploadingStageInvoice}
                  className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-[22px] border border-[#b9d9c2] bg-[#f4fbf5] px-5 py-4 text-left shadow-[0_10px_24px_rgba(18,35,23,0.06)] transition hover:border-brand hover:bg-[#eef8ef] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold text-[#173120]">
                      Upload Requested Invoice
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-[#52705c]">
	                      Submit the invoice requested by{" "}
	                      {getActorDisplayName(
                        stageInvoiceRequest?.requestedByName ?? "the project owner",
                        currentUserDisplayName,
                      )}{" "}
                      for this stage.
                    </p>
                  </div>
                  <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white">
                    {isUploadingStageInvoice ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </span>
                </button>
              ) : null}

              <div className="w-full rounded-[22px] border border-brand bg-[#f4fbf5] px-5 py-4 text-left shadow-[0_10px_24px_rgba(18,35,23,0.06)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[16px] font-semibold text-[#111712]">Attachment</p>
                    <p className="mt-1 text-[13px] leading-5 text-[#697169]">
                      Use for chat, references, supporting documents, or normal
                      discussion files.
                    </p>
                  </div>
                  <div className="mt-1 h-5 w-5 rounded-full border border-brand bg-brand" />
                </div>
              </div>

              <div className="rounded-[18px] border border-[#e4e8e3] bg-[#fafcf9] px-4 py-3 text-[12px] text-[#657067]">
                Use Submit Work to send files for review.
              </div>

              <div className="flex flex-col gap-3">
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-[#2d372f]">Choose Files</p>
                  <UploadIntentDropzone
                    intent={commentUploadIntent}
                    projectCategory={project.category}
                    onFilesSelected={handleCommentFilesSelected}
                    onError={(message) => setComposerError(message)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCommentUploadDialogOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {!isConceptMode && invoiceRequestDialogOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]">
          <Card className="w-full max-w-[600px] rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
              <div>
                <CardTitle className="text-[24px] font-semibold tracking-tight text-[#111712]">
                  Request Invoice
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  Send an in-app request to the executor responsible for this stage.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => {
                  setInvoiceRequestError(null);
                  setInvoiceRequestDialogOpen(false);
                }}
                disabled={isRequestingStageInvoice}
                className="shrink-0 border border-line"
                aria-label="Close invoice request dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
              {invoiceRequestError ? (
                <div className="rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
                  {invoiceRequestError}
                </div>
              ) : null}
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-[#2d372f]">
                  Invoice requested from *
                </p>
                <Select
                  value={invoiceRequestRecipientId}
                  onValueChange={setInvoiceRequestRecipientId}
                  disabled={isRequestingStageInvoice}
                >
                  <SelectTrigger className="h-12 rounded-[16px] border border-line">
                    <SelectValue placeholder="Select executor" />
                  </SelectTrigger>
                  <SelectContent className="z-[120]">
                    {invoiceRequestCandidates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name} · {candidate.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {invoiceRequestCandidates.length === 0 ? (
                  <p className="text-[12px] leading-5 text-[#a64038]">
                    No eligible executor found for invoice request. Add an executor to this project first.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-[#2d372f]">
                  Optional message
                </p>
                <RichTextEditor
                  value={invoiceRequestNote}
                  onChange={setInvoiceRequestNote}
                  placeholder="Please upload the invoice for this completed stage."
                  minHeightClassName="min-h-[110px]"
                  ariaLabel="Invoice request message"
                  disabled={isRequestingStageInvoice}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setInvoiceRequestError(null);
                    setInvoiceRequestDialogOpen(false);
                  }}
                  disabled={isRequestingStageInvoice}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleRequestStageInvoice();
                  }}
                  disabled={isRequestingStageInvoice || invoiceRequestCandidates.length === 0}
                >
                  {isRequestingStageInvoice ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Send Invoice Request
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {revisionDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8 backdrop-blur-[2px]">
          <Card className="w-full max-w-[640px] rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-6 sm:p-7">
              <div>
                <CardTitle className="text-[24px] font-semibold tracking-tight text-[#111712]">
                  Submit Work for Review
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  {isConceptMode
                    ? "Describe the concept revision and attach at least one submission file. The review notification is sent only after every file is ready."
                    : "Describe the work submission and attach supporting files if needed."}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => {
                  setRevisionDialogError(null);
                  setRevisionDialogOpen(false);
                }}
                disabled={isUploadingRevision}
                className="shrink-0 border border-line"
                aria-label="Close revision dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
              <input
                ref={revisionDialogFileInputRef}
                type="file"
                multiple
                accept={STAGE_SUBMISSION_ACCEPT}
                className="sr-only"
                onChange={(event) => {
                  handleRevisionFilesSelected(event.target.files);
                }}
                disabled={isUploadingRevision}
              />
              {revisionDialogError ? (
                <div className="mb-5 rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
                  {revisionDialogError}
                </div>
              ) : null}
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-[#2d372f]">Revision Notes</p>
                  <RichTextEditor
                    value={revisionSummary}
                    onChange={setRevisionSummary}
                    placeholder="Describe the corrections required for this revision."
                    minHeightClassName="min-h-[140px]"
                    ariaLabel="Revision notes"
                    disabled={isUploadingRevision}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-semibold text-[#2d372f]">Attachments</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={openRevisionFilePicker}
                      disabled={isUploadingRevision}
                    >
                      <Paperclip className="h-4 w-4" />
                      Add files
                    </Button>
                  </div>
                  {pendingRevisionFiles.length > 0 ? (
                    <div className="flex flex-wrap gap-2 rounded-[18px] border border-[#e2e7e2] bg-[#fbfcfa] px-3 py-2.5">
                      {pendingRevisionFiles.map((pendingFile) => (
                        <div
                          key={pendingFile.id}
                          className="inline-flex items-center gap-2 rounded-full border border-[#d6dfd7] bg-white px-3 py-1.5 text-[11px] text-[#324138]"
                        >
                          <FileThumbnail fileName={pendingFile.file.name} mimeType={pendingFile.file.type} file={pendingFile.file} className="h-8 w-10" />
                          <span className="max-w-[220px] truncate">{pendingFile.file.name}</span>
                          <button
                            type="button"
                            onClick={() => removePendingRevisionFile(pendingFile.id)}
                            className="cursor-pointer text-[#7d847e] transition hover:text-[#27322b]"
                            aria-label={`Remove ${pendingFile.file.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-[#d8e1d8] px-4 py-5 text-[13px] text-[#7a837b]">
                      {isConceptMode
                        ? "At least one concept submission file is required."
                        : "No files attached yet."}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setRevisionDialogError(null);
                      setRevisionDialogOpen(false);
                    }}
                    disabled={isUploadingRevision}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      void handleCreateRevision();
                    }}
                    disabled={
                      isUploadingRevision ||
                      !canSubmitNewRevision ||
                      (isConceptMode && pendingRevisionFiles.length === 0)
                    }
                  >
                    {isUploadingRevision ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Submit Work
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      <ConfirmationDialog
        isOpen={Boolean(conceptApprovalTarget)}
        title={
          approvedConceptAttachmentId &&
          approvedConceptAttachmentId !== conceptApprovalTarget?.id
            ? isStageFourConceptMode
              ? "Replace the currently approved final file?"
              : "Replace the currently approved concept file?"
            : isStageFourConceptMode
              ? "Mark Final Approved File?"
              : "Mark as Approved Concept?"
        }
        description={
          approvedConceptAttachmentId &&
          approvedConceptAttachmentId !== conceptApprovalTarget?.id
            ? isStageFourConceptMode
              ? `This replaces the current Final Approved File with ${conceptApprovalTarget?.originalFileName ?? "this file"}. The selected revision will be approved and this concept will be completed.`
              : `This replaces the current Approved Concept with ${conceptApprovalTarget?.originalFileName ?? "this file"}. The selected revision will be approved and this concept will be completed.`
            : `${conceptApprovalTarget?.originalFileName ?? "This file"} will become the one formal ${approvedFileLabel} for this concept. Its revision will be approved and this concept will be completed.`
        }
        confirmLabel={
          approvedConceptAttachmentId &&
          approvedConceptAttachmentId !== conceptApprovalTarget?.id
            ? isStageFourConceptMode
              ? "Replace Final Approved File"
              : "Replace Approved Concept"
            : markApprovedFileLabel
        }
        pending={Boolean(approvingConceptAttachmentId)}
        error={conceptApprovalError ?? undefined}
        onConfirm={() => {
          void confirmConceptApproval();
        }}
        onClose={() => {
          if (approvingConceptAttachmentId) return;
          setConceptApprovalTarget(null);
          setConceptApprovalError(null);
        }}
      />
      <ConfirmationDialog
        isOpen={revokeConceptApprovalOpen && canRevokeConceptApproval}
        title={
          isStageFourConceptMode
            ? "Revoke Final Approved File?"
            : "Revoke Approved Concept?"
        }
        description={
          isStageFourConceptMode
            ? "This removes the Final Approved File designation, returns its revision to Pending Review, and reopens Stage 4. Stage 5 will be relocked, and any in-progress checklist, requests, or attachments tied to this final file will be reset. Revocation is unavailable after Stage 5 is completed."
            : "This starts Stage 3 rework and returns the concept to Pending Review. If it is already used downstream, its dependent Stage 4 approval and Stage 5 handoff/checklist will be reset. Rework is allowed through completed Stage 5, but is blocked after Stage 6 production work begins."
        }
        confirmLabel="Revoke Approval"
        cancelLabel="Keep Approval"
        tone="destructive"
        pending={revokingConceptApproval}
        error={revokeConceptApprovalError ?? undefined}
        onConfirm={() => {
          void confirmConceptApprovalRevocation();
        }}
        onClose={() => {
          if (revokingConceptApproval) return;
          setRevokeConceptApprovalOpen(false);
          setRevokeConceptApprovalError(null);
        }}
      />

      {reviewRevisionMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#112118]/45 p-4 backdrop-blur-[2px] sm:p-8">
          <Card className="flex h-[calc(100dvh-2rem)] max-h-[860px] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-[#e1e7e1] p-0 shadow-[0_35px_90px_rgba(11,26,18,0.22)] sm:h-[calc(100dvh-4rem)]">
            <CardHeader className="shrink-0 flex-row items-start justify-between gap-4 space-y-0 border-b border-line/70 p-6 sm:p-7">
              <div>
                <CardTitle className="text-[24px] font-semibold tracking-tight text-[#111712]">
                  Review Submission
                </CardTitle>
                <p className="mt-2 text-[14px] leading-6 text-[#6a706b]">
                  {isConceptMode
                    ? isStageFourConceptMode
                      ? "Inspect the final concept submission, compare files, add review markers, request changes, or designate the Final Approved File."
                      : "Inspect the concept submission, compare files, add review markers, request changes, or designate the Approved Concept."
                    : reviewCompletionIsFinalStage
                    ? "Review the submitted revision. Approval completes the final stage; project completion and final archive are handled after all stages are complete."
                    : "Review the submitted revision and decide whether to mark this stage as complete or request another revision."}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={closeRevisionReviewDialog}
                disabled={Boolean(pendingRevisionReviewId)}
                className="shrink-0 border border-line"
                aria-label="Close review dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5 [scrollbar-gutter:stable] sm:px-7">
              {reviewDialogError ? (
                <div className="rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
                  {reviewDialogError}
                </div>
              ) : null}
              <div className="grid gap-3 rounded-[20px] border border-line bg-[#fbfcfa] p-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
                    Revision
                  </p>
                  <p className="mt-1 text-[15px] font-semibold text-[#111712]">
                    {reviewRevisionMessage.title}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
                    Current Status
                  </p>
                  <div className="mt-1">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        getRevisionStatusMeta(
                          getEffectiveRevisionStatus(reviewRevisionMessage),
                        ).badgeClassName
                      }`}
                    >
                      {
                        getRevisionStatusMeta(
                          getEffectiveRevisionStatus(reviewRevisionMessage),
                        ).label
                      }
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
                    Submitted By
                  </p>
                  <p className="mt-1 text-[14px] text-[#27322b]">
                    {getActorDisplayName(
                      reviewRevisionMessage.author,
                      currentUserDisplayName,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70806f]">
                    Submitted At
                  </p>
                  <p className="mt-1 text-[14px] text-[#27322b]">
                    {reviewRevisionMessage.createdAt}
                  </p>
                </div>
              </div>
              {reviewRevisionMessage.attachments?.length ? (
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-[#2d372f]">Submitted Files</p>
                  {canSelectStageFourFinalApprovedFile ? (
                    <div className="rounded-[14px] border border-[#cfe2d4] bg-[#f3faf5] px-3.5 py-3 text-[12px] leading-5 text-[#41644d]" role="note">
                      <p>Select exactly one submitted file below. Only that file will be designated as the Final Approved File for this concept.</p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold" aria-live="polite">
                          {selectedConceptApprovalCandidate
                            ? `Selected: ${selectedConceptApprovalCandidate.originalFileName}. Click Selected again or clear the selection before continuing.`
                            : "No file selected yet."}
                        </p>
                        {selectedConceptApprovalCandidate ? (
                          <button
                            type="button"
                            className="shrink-0 rounded-full border border-[#9fc7ab] bg-white px-3 py-1 text-[11px] font-[750] text-[#276f49] transition hover:bg-[#edf7ef] disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={clearConceptApprovalSelection}
                            disabled={
                              Boolean(pendingRevisionReviewId) ||
                              Boolean(approvingConceptAttachmentId)
                            }
                          >
                            Clear selection
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <AttachmentHistoryList
                    attachments={reviewRevisionMessage.attachments}
                    approvedConceptAttachmentId={approvedConceptAttachmentId}
                    approvedFileLabel={approvedFileLabel}
                    markApprovedFileLabel={markApprovedFileLabel}
                    canApproveConceptFile={
                      isStageFourConceptMode
                        ? canSelectStageFourFinalApprovedFile
                        : Boolean(
                            conceptMode?.stageNumber === 3 &&
                              conceptMode.canReview &&
                              !conceptMode.isWorkflowCompleted &&
                              getEffectiveRevisionStatus(reviewRevisionMessage) !==
                                "REJECTED",
                          )
                    }
                    singleApprovalSelection={canSelectStageFourFinalApprovedFile}
                    selectedApprovalAttachmentId={selectedConceptApprovalCandidateId}
                    approvingConceptAttachmentId={approvingConceptAttachmentId}
                    onSelectApprovalAttachment={(attachment) => {
                      setConceptApprovalError(null);
                      setSelectedConceptApprovalCandidateId(attachment.id);
                    }}
                    onClearApprovalSelection={clearConceptApprovalSelection}
                    onApproveConceptFile={openConceptApprovalConfirmation}
                    actionsDisabled={isProjectCompleted}
                    projectCategory={project.category}
                    showCaptionAction={canAddCaptions}
                    onOpenCaptions={(attachment) => openCaptionDialog(attachment)}
                    currentUserDisplayName={currentUserDisplayName}
                  />
                </div>
              ) : null}
              {reviewRejectMode ? (
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-[#2d372f]">
                    Revision Brief / Reason *
                  </p>
                  <RichTextEditor
                    value={reviewRejectReason}
                    onChange={setReviewRejectReason}
                    placeholder="Explain what needs to be changed for the next revision."
                    minHeightClassName="min-h-[120px]"
                    ariaLabel="Revision brief or reason"
                    disabled={Boolean(pendingRevisionReviewId)}
                  />
                </div>
              ) : null}
            </CardContent>
            <CardFooter className="shrink-0 flex-col-reverse gap-3 border-t border-line/70 bg-white px-6 py-4 sm:flex-row sm:flex-nowrap sm:justify-end sm:px-7">
              <Button
                type="button"
                variant="secondary"
                onClick={closeRevisionReviewDialog}
                disabled={Boolean(pendingRevisionReviewId)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              {!reviewRejectMode ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setReviewDialogError(null);
                      setReviewRejectMode(true);
                    }}
                    disabled={Boolean(pendingRevisionReviewId)}
                    className="w-full sm:w-auto"
                  >
                    {isConceptMode ? "Request Changes" : "Request Revision"}
                  </Button>
                  {canSelectStageFourFinalApprovedFile ? (
                    <Button
                      type="button"
                      onClick={() => {
                        if (selectedConceptApprovalCandidate) {
                          openConceptApprovalConfirmation(selectedConceptApprovalCandidate);
                        }
                      }}
                      disabled={
                        Boolean(pendingRevisionReviewId) ||
                        Boolean(approvingConceptAttachmentId) ||
                        !selectedConceptApprovalCandidate
                      }
                      className="w-full sm:w-auto"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mark Final Approved File
                    </Button>
                  ) : null}
                  {!activeStage?.isTasker ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setReviewDialogError(null);
                        setReviewCompleteDialogOpen(true);
                      }}
                      disabled={Boolean(pendingRevisionReviewId)}
                      className="w-full sm:w-auto"
                    >
                      Approve Submission
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    void handleRevisionReview("REJECTED");
                  }}
                  disabled={
                    Boolean(pendingRevisionReviewId) || richTextToPlainText(reviewRejectReason).length === 0
                  }
                  className="w-full sm:w-auto"
                >
                  {pendingRevisionReviewId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {isConceptMode ? "Request Changes" : "Request Revision"}
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      ) : null}

      <SubmissionCaptionDialog
        open={Boolean(captionDialogAttachment)}
        attachment={captionDialogAttachment}
        initialCaptionId={captionDialogInitialCaptionId}
        onClose={closeCaptionDialog}
        onCaptionCreated={refreshHistory}
      />
    </section>
  );
}

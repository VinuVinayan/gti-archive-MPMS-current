import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import {
  ActivityLogAction,
  AttachmentAssetType,
  AttachmentStatus,
  Prisma,
  ProjectExecutionType,
  ProjectFileChecklistRequestChannel,
  ProjectFileChecklistRequestWorkflowStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  SubmissionReviewStatus,
  UserRole,
  type User,
} from "@prisma/client";

import type { ProjectAttachmentRecord, ProjectChatEntry } from "@/lib/projects";
import { getUserRoleLabel } from "@/lib/user-role-compatibility";
import { projectCollaboratorPermissionSelect } from "@/lib/project-collaborator-permissions";
import type { PermissionKey } from "@/lib/permissions/definitions";
import {
  hasPermission,
  hasProjectPermission,
  isGlobalProjectAdministrator,
  isProjectExecutor,
  type PermissionUser,
  type ProjectPermissionContext,
} from "@/lib/permissions/resolver";
import {
  notifyFileUploaded,
  notifyInvoiceUploaded,
  runNotificationTaskAfterResponse,
} from "@/lib/notification-center";
import { getFavoriteAttachmentIdSetForUser } from "@/lib/file-favorite-queries";
import { sanitizeRichText } from "@/lib/rich-text";
import { getVisibleStageEventRecipientUserIds } from "@/lib/notification-center/recipients";
import {
  assertProjectTimestampVisibleForUser,
  canBypassCollaboratorVisibility,
  getProjectCollaboratorVisibilityState,
  isTimestampHiddenByPauseWindows,
  type ProjectCollaboratorVisibilityPauseRecord,
} from "@/lib/project-collaborator-visibility";
import { PROJECTS_CACHE_TAG } from "@/lib/projects";
import {
  assertProjectResearchFileAccess,
  assertResearchFolderUploadAccess,
} from "@/lib/project-research-access";
import { assertProjectPrivateAttachmentAccess } from "@/lib/project-private-folders";
import {
  assertConceptTaskerAccessIfNeeded,
  canViewProjectConcept,
  getProjectConceptAccessContext,
  isProjectConceptWorkflowAccessible,
} from "@/lib/project-concept-access";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { isProjectStatusCompleted } from "@/lib/project-statuses";
import { logChatSendFastTiming, logStageChatTiming } from "@/lib/stage-chat-timing";
import { getLockedStageInfo } from "@/lib/stage-locking";
import { canOpenProjectStageChatContainer } from "@/lib/workflow-stage-access";
import type { LibraryUploadMetadata } from "@/lib/library-shared";
import {
  buildProjectAssetKey,
  createPresignedDownloadUrl,
  createPresignedPreviewUrl,
  createPresignedUploadTarget,
  createPresignedUploadUrl,
  deleteObjectIfNeeded,
  getDefaultS3UploadEndpointMode,
  getFileExtension,
  getMaxAssetUploadBytes,
  getS3BucketName,
  isAllowedAssetFile,
  isAllowedSubmissionImage,
  sanitizeFileName,
  type S3UploadEndpointMode,
} from "@/lib/storage/s3";
import {
  PROJECT_ASSET_ALLOWED_EXTENSIONS,
  STAGE_SEVEN_EVIDENCE_ALLOWED_EXTENSIONS,
  buildFileTypeNotAllowedPayload,
  getStageSubmissionAllowedExtensions,
  isAllowedStageSubmissionFile,
  isAllowedStageSevenEvidenceFile,
  type UploadFileTypeErrorPayload,
} from "@/lib/upload-validation";
import { validateActiveAssetTagIds } from "@/lib/asset-tags";

const STAGE_CHAT_MESSAGE_DELETE_WINDOW_MS = 5 * 60 * 1000;
const DELETED_STAGE_CHAT_MESSAGE_TEXT = "This message was deleted";
const DEFAULT_STAGE_CHAT_MESSAGE_LIMIT = 30;
const MAX_STAGE_CHAT_MESSAGE_LIMIT = 50;

async function ensureFinalCompletionWorkflowExistsTx(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  await tx.projectCompletionWorkflow.upsert({
    where: {
      projectId,
    },
    update: {},
    create: {
      projectId,
    },
    select: {
      id: true,
    },
  });
}

type AccessUser = Pick<
  User,
  "id" | "email" | "name" | "role"
> &
  PermissionUser;

const projectStatusSelect = {
  id: true,
  name: true,
  slug: true,
  color: true,
  group: {
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      isActive: true,
    },
  },
} as const;

export type ProjectHistoryAccessUser = AccessUser;

type StageHistoryQueryRecord = {
  id: string;
  projectId: string;
  stageId: string;
  revisionNumber: number;
  title: string;
  summary: string | null;
  status: ProjectRevisionStatus;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: Pick<User, "name" | "email"> | null;
  createdAt: Date;
  updatedAt?: Date;
  createdBy: Pick<
    User,
    "id" | "name" | "email" | "role" | "avatarUrl"
  >;
  attachments: Array<{
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus: SubmissionReviewStatus | null;
    createdAt: Date;
    status: AttachmentStatus;
    uploadedBy: Pick<User, "name" | "email">;
  }>;
};

type StageCommentQueryRecord = {
  id: string;
  projectId: string;
  stageId: string;
  revisionId: string | null;
  body: string;
  deletedAt: Date | string | null;
  deletedByUserId: string | null;
  createdAt: Date;
  updatedAt?: Date;
  author: Pick<
    User,
    "id" | "name" | "email" | "role" | "avatarUrl"
  >;
  mentions: Array<{
    mentionedUserId: string;
    mentionedUser: Pick<User, "name" | "email">;
  }>;
  attachments: Array<{
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus: SubmissionReviewStatus | null;
    createdAt: Date;
    status: AttachmentStatus;
    uploadedBy: Pick<User, "name" | "email">;
  }>;
};

type StageComparisonQueryRecord = {
  id: string;
  projectId: string;
  stageId: string;
  baseAttachmentId: string;
  compareAttachmentId: string;
  captionAttachmentId: string | null;
  isCaption: boolean;
  comparisonOpacity: number | null;
  xPercent: number;
  yPercent: number;
  body: string;
  createdAt: Date;
  updatedAt?: Date;
  createdBy: Pick<
    User,
    "id" | "name" | "email" | "role" | "avatarUrl"
  >;
  baseAttachment: {
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus: SubmissionReviewStatus | null;
    createdAt: Date;
    status: AttachmentStatus;
    uploadedBy: Pick<User, "name" | "email">;
  };
  compareAttachment: {
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus: SubmissionReviewStatus | null;
    createdAt: Date;
    status: AttachmentStatus;
    uploadedBy: Pick<User, "name" | "email">;
  };
  captionAttachment: {
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus: SubmissionReviewStatus | null;
    createdAt: Date;
    status: AttachmentStatus;
    uploadedBy: Pick<User, "name" | "email">;
  } | null;
};

export type StageHistoryRecord = {
  activeStageId: string | null;
  latestRevisionId: string | null;
  entries: ProjectChatEntry[];
  revisionCount?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
};

export type StageChatCommentEntryRecord = {
  entry: ProjectChatEntry;
  projectId: string;
  stageId: string;
  commentId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
};

export type StageChatUpdatesRecord = {
  projectId: string;
  stageId: string;
  entries: ProjectChatEntry[];
  watermark: string;
  hasMore: boolean;
};

export type StageTextCommentFastResult = {
  id: string;
  projectId: string;
  stageId: string;
  revisionId: string | null;
  authorId: string;
  createdAt: Date;
  mentions: Array<{
    mentionedUserId: string;
  }>;
  entry: ProjectChatEntry;
};

type ActivePendingStageReview =
  {
    kind: "revision";
    revisionNumber: number;
  };

export type RequestUploadInput = {
  projectId: string;
  stageId?: string | null;
  revisionId?: string | null;
  commentId?: string | null;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  assetType: AttachmentAssetType;
  assetTagIds?: string[];
  uploadEndpointMode?: S3UploadEndpointMode;
  /** Publicly declared upload purpose; all Stage 5 authority is revalidated server-side. */
  stageFiveDirectSource?: boolean;
  /** Server-only context. Public upload routes must never forward this field. */
  researchFolderId?: string;
  /** Server-only request scope used by the authenticated Stage 5 response route. */
  checklistRequestId?: string;
};

type UploadRequestErrorResult = { error: string } | UploadFileTypeErrorPayload;

export type RequestUploadResult =
  | UploadRequestErrorResult
  | {
      attachmentId: string;
      fileName: string;
      uploadUrl: string;
      uploadHost: string;
      uploadEndpointMode: S3UploadEndpointMode;
      uploadRegion: string;
      uploadExpiresInSeconds: number;
      uploadExpectedHeaders: {
        "Content-Type": string;
      };
      storageKey: string;
    };

export type StageCommentUploadFileInput = {
  clientId?: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  assetType: "COMMENT_ATTACHMENT" | "STAGE_SUBMISSION";
};

export type PrepareStageCommentUploadsInput = {
  projectId: string;
  stageId: string;
  revisionId?: string | null;
  body: string;
  allowEmptyBody?: boolean;
  mentionedUserIds?: string[];
  files: StageCommentUploadFileInput[];
};

export type PrepareStageCommentUploadsResult =
  | UploadRequestErrorResult
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

export type FinalizePreparedStageCommentUploadsResult = {
  commentId: string;
  stageId: string;
  mentionedUserIds: string[];
};

async function getStageReviewState(projectId: string, stageId: string) {
  const latestRevision = await prisma.projectRevision.findFirst({
    where: {
      projectId,
      stageId,
    },
    orderBy: {
      revisionNumber: "desc",
    },
    select: {
      id: true,
      revisionNumber: true,
      status: true,
    },
  });

  if (latestRevision?.status === ProjectRevisionStatus.PENDING_REVIEW) {
    return {
      latestRevisionNumber: latestRevision.revisionNumber,
      pendingReview: {
        kind: "revision",
        revisionNumber: latestRevision.revisionNumber,
      } satisfies ActivePendingStageReview,
    };
  }

  return {
    latestRevisionNumber: latestRevision?.revisionNumber ?? 0,
    pendingReview: null,
  };
}

function getPendingStageReviewMessage(pendingReview: ActivePendingStageReview) {
  return `Revision ${pendingReview.revisionNumber} is already pending review. Please wait for the project owner to review it.`;
}

function getDisplayName(user: Pick<User, "name" | "email">) {
  return user.name?.trim() || user.email;
}

function getActorRole(user: Pick<User, "role">) {
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
    return "Internal Team";
  }

  return getUserRoleLabel(user.role);
}

function getProfileAvatarSrc(user: Pick<User, "avatarUrl">) {
  return user.avatarUrl
    ? `/api/profile/avatar?v=${encodeURIComponent(user.avatarUrl)}`
    : null;
}

function formatHistoryTimestamp(date: Date | string | number) {
  const normalizedDate = toHistoryDate(date);

  if (Number.isNaN(normalizedDate.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(normalizedDate);
}

function toHistoryDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

function formatFileSize(fileSize: number) {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (fileSize >= 1024) {
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }

  return `${fileSize} B`;
}

function getFileTypeLabel(fileName: string, mimeType: string) {
  const extension = getFileExtension(fileName).toUpperCase();

  if (extension) {
    return extension;
  }

  const subtype = mimeType.split("/")[1];
  return subtype ? subtype.toUpperCase() : "FILE";
}

function mapAttachmentRecord(
  attachment: {
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus?: SubmissionReviewStatus | null;
    createdAt: Date | string;
    uploadedBy: Pick<User, "name" | "email">;
  },
  submissionNumber?: number,
  favoritedAttachmentIds?: ReadonlySet<string>,
): ProjectAttachmentRecord {
  const createdAt = toHistoryDate(attachment.createdAt);

  return {
    id: attachment.id,
    assetType: attachment.assetType,
    isSubmission: submissionNumber !== undefined,
    submissionNumber,
    submissionReviewStatus: attachment.submissionReviewStatus ?? null,
    originalFileName: attachment.originalFileName,
    fileTypeLabel: getFileTypeLabel(attachment.originalFileName, attachment.mimeType),
    mimeType: attachment.mimeType,
    fileSizeLabel: formatFileSize(attachment.fileSize),
    uploadedBy: getDisplayName(attachment.uploadedBy),
    uploadedAt: Number.isNaN(createdAt.getTime())
      ? "—"
      : formatHistoryTimestamp(createdAt),
    previewPath: `/api/project-assets/${attachment.id}/preview`,
    downloadPath: `/api/project-assets/${attachment.id}/download`,
    isFavoritedByCurrentUser: favoritedAttachmentIds?.has(attachment.id) ?? false,
  };
}

function buildStageSubmissionNumberMap(
  revisions: StageHistoryQueryRecord[],
  comments: StageCommentQueryRecord[],
) {
  const revisionAttachments = revisions.flatMap((entry) => entry.attachments);
  const revisionCommentAttachments = comments
    .filter((entry) => Boolean(entry.revisionId))
    .flatMap((entry) => entry.attachments);
  const submissions = [...revisionAttachments, ...revisionCommentAttachments]
    .filter(
      (attachment) =>
        (attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION ||
          (attachment.assetType === AttachmentAssetType.REVISION_ORIGINAL &&
            isAllowedSubmissionImage(attachment.originalFileName, attachment.mimeType))) &&
        attachment.status === AttachmentStatus.READY,
    )
    .filter(
      (attachment, index, allAttachments) =>
        allAttachments.findIndex((candidate) => candidate.id === attachment.id) === index,
    )
    .sort((left, right) => {
      const timeDifference =
        toHistoryDate(left.createdAt).getTime() - toHistoryDate(right.createdAt).getTime();

      return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id);
    });

  return new Map(submissions.map((attachment, index) => [attachment.id, index + 1]));
}

function mapRevisionEntry(
  revision: StageHistoryQueryRecord,
  submissionNumbers: ReadonlyMap<string, number>,
  favoritedAttachmentIds?: ReadonlySet<string>,
): ProjectChatEntry {
  return {
    id: revision.id,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    kind: "revision",
    title: revision.title,
    revisionStatus: revision.status,
    rejectionReason: revision.rejectionReason,
    reviewedBy: revision.reviewedBy ? getDisplayName(revision.reviewedBy) : null,
    reviewedAt: revision.reviewedAt
      ? formatHistoryTimestamp(revision.reviewedAt)
      : null,
    authorId: revision.createdBy.id,
    author: getDisplayName(revision.createdBy),
    authorAvatarSrc: getProfileAvatarSrc(revision.createdBy),
    role: getActorRole(revision.createdBy),
    body: revision.summary?.trim() || "Revision uploaded.",
    createdAt: formatHistoryTimestamp(revision.createdAt),
    createdAtValue: toHistoryDate(revision.createdAt).toISOString(),
    attachments: revision.attachments
      .filter((attachment) => attachment.status === AttachmentStatus.READY)
      .map((attachment) =>
        mapAttachmentRecord(
          attachment,
          submissionNumbers.get(attachment.id),
          favoritedAttachmentIds,
        ),
      ),
  };
}

function isBriefAcceptedSystemBody(body: string) {
  const normalizedBody = body.trim().toLowerCase();
  return (
    (normalizedBody.includes("accepted the brief") ||
      normalizedBody.includes("accepted the project and stage brief")) &&
    normalizedBody.includes("started work on this stage")
  );
}

function getRevisionRequestSystemDetails(body: string) {
  const match = body
    .trim()
    .match(/^Revision brief for Revision (\d+):\s*([\s\S]*)$/i);

  if (!match) {
    return null;
  }

  return {
    revisionLabel: `Revision ${match[1]}`,
    reason: match[2]?.trim() || null,
  };
}

function isInvoiceUploadedSystemBody(body: string) {
  return body.trim().toLowerCase().includes("uploaded invoice for");
}

function isInvoiceRequestedSystemBody(body: string) {
  return body.trim().toLowerCase().startsWith("invoice requested from ");
}

function isLegacyBriefContextBody(body: string) {
  const normalizedBody = body.trim().toLowerCase();

  return (
    normalizedBody.startsWith("project brief:") &&
    normalizedBody.includes("stage brief:")
  );
}

function isSystemCommentBody(body: string) {
  return (
    isBriefAcceptedSystemBody(body) ||
    Boolean(getRevisionRequestSystemDetails(body)) ||
    isInvoiceUploadedSystemBody(body) ||
    isInvoiceRequestedSystemBody(body) ||
    isLegacyBriefContextBody(body)
  );
}

function getStageChatDeleteExpiresAt(createdAt: Date | string | number) {
  return new Date(toHistoryDate(createdAt).getTime() + STAGE_CHAT_MESSAGE_DELETE_WINDOW_MS);
}

function isDeletableStageComment(
  comment: {
    body: string;
    attachments: Array<{
      assetType: AttachmentAssetType;
    }>;
  },
) {
  return (
    !isSystemCommentBody(comment.body) &&
    comment.attachments.every(
      (attachment) => attachment.assetType === AttachmentAssetType.COMMENT_ATTACHMENT,
    )
  );
}

function mapCommentEntry(
  comment: StageCommentQueryRecord,
  submissionNumbers: ReadonlyMap<string, number>,
  favoritedAttachmentIds?: ReadonlySet<string>,
): ProjectChatEntry {
  if (comment.deletedAt) {
    return {
      id: comment.id,
      revisionId: comment.revisionId ?? undefined,
      kind: "comment",
      authorId: comment.author.id,
      author: getDisplayName(comment.author),
      authorAvatarSrc: getProfileAvatarSrc(comment.author),
      role: getActorRole(comment.author),
      body: DELETED_STAGE_CHAT_MESSAGE_TEXT,
      createdAt: formatHistoryTimestamp(comment.createdAt),
      createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
      deletedAt: toHistoryDate(comment.deletedAt).toISOString(),
      deletedByUserId: comment.deletedByUserId,
      mentions: [],
      attachments: [],
    };
  }

  if (isBriefAcceptedSystemBody(comment.body)) {
    const actorName = getDisplayName(comment.author);

    return {
      id: comment.id,
      revisionId: comment.revisionId ?? undefined,
      kind: "system",
      title: "Brief accepted",
      authorId: comment.author.id,
      author: actorName,
      role: getActorRole(comment.author),
      body: `${actorName} accepted the project and stage brief and started work on this stage.`,
      createdAt: formatHistoryTimestamp(comment.createdAt),
      createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
      mentions: [],
      attachments: [],
    };
  }

  const revisionRequestSystemDetails = getRevisionRequestSystemDetails(comment.body);

  if (revisionRequestSystemDetails) {
    const actorName = getDisplayName(comment.author);

    return {
      id: comment.id,
      revisionId: comment.revisionId ?? undefined,
      kind: "system",
      title: "Revision requested",
      authorId: comment.author.id,
      author: actorName,
      role: getActorRole(comment.author),
      body: `${actorName} requested a revision for ${revisionRequestSystemDetails.revisionLabel}.`,
      revisionRequestReason: revisionRequestSystemDetails.reason,
      createdAt: formatHistoryTimestamp(comment.createdAt),
      createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
      mentions: [],
      attachments: [],
    };
  }

  if (isInvoiceUploadedSystemBody(comment.body)) {
    const actorName = getDisplayName(comment.author);

    return {
      id: comment.id,
      revisionId: comment.revisionId ?? undefined,
      kind: "system",
      title: "Invoice uploaded",
      authorId: comment.author.id,
      author: actorName,
      role: getActorRole(comment.author),
      body: comment.body,
      createdAt: formatHistoryTimestamp(comment.createdAt),
      createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
      mentions: [],
      attachments: [],
    };
  }

  if (isInvoiceRequestedSystemBody(comment.body)) {
    const actorName = getDisplayName(comment.author);

    return {
      id: comment.id,
      revisionId: comment.revisionId ?? undefined,
      kind: "system",
      title: "Invoice requested",
      authorId: comment.author.id,
      author: actorName,
      role: getActorRole(comment.author),
      body: comment.body,
      createdAt: formatHistoryTimestamp(comment.createdAt),
      createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
      mentions: [],
      attachments: [],
    };
  }

  return {
    id: comment.id,
    revisionId: comment.revisionId ?? undefined,
    kind: "comment",
    authorId: comment.author.id,
    author: getDisplayName(comment.author),
    authorAvatarSrc: getProfileAvatarSrc(comment.author),
    role: getActorRole(comment.author),
    body: comment.body,
    createdAt: formatHistoryTimestamp(comment.createdAt),
    createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
    canDeleteUntil: isDeletableStageComment(comment)
      ? getStageChatDeleteExpiresAt(comment.createdAt).toISOString()
      : null,
    mentions: comment.mentions.map((mention) => ({
      userId: mention.mentionedUserId,
      name: getDisplayName(mention.mentionedUser),
    })),
    attachments: comment.attachments
      .filter((attachment) => attachment.status === AttachmentStatus.READY)
      .map((attachment) =>
        mapAttachmentRecord(
          attachment,
          submissionNumbers.get(attachment.id),
          favoritedAttachmentIds,
        ),
    ),
  };
}

function getComparisonSubmissionLabel(
  attachment: Pick<StageComparisonQueryRecord["baseAttachment"], "id" | "status">,
  submissionNumbers: ReadonlyMap<string, number>,
) {
  if (attachment.status !== AttachmentStatus.READY) {
    return "File unavailable";
  }

  const submissionNumber = submissionNumbers.get(attachment.id);
  return submissionNumber ? `Submission ${submissionNumber}` : "Submission";
}

function getComparisonFileName(
  attachment: Pick<StageComparisonQueryRecord["baseAttachment"], "originalFileName" | "status">,
) {
  return attachment.status === AttachmentStatus.READY
    ? attachment.originalFileName
    : "File unavailable";
}

function mapComparisonEntry(
  comparison: StageComparisonQueryRecord,
  submissionNumbers: ReadonlyMap<string, number>,
): ProjectChatEntry {
  if (comparison.isCaption) {
    const captionAttachment = comparison.captionAttachment ?? comparison.compareAttachment;
    const captionFileName = getComparisonFileName(captionAttachment);
    const captionSubmissionLabel = getComparisonSubmissionLabel(
      captionAttachment,
      submissionNumbers,
    );
    const authorName = getDisplayName(comparison.createdBy);

    return {
      id: `caption-${comparison.id}`,
      kind: "caption",
      title: "Caption added",
      authorId: comparison.createdBy.id,
      author: authorName,
      authorAvatarSrc: getProfileAvatarSrc(comparison.createdBy),
      role: getActorRole(comparison.createdBy),
      body: `${authorName} added a caption on ${captionFileName}.`,
      createdAt: formatHistoryTimestamp(comparison.createdAt),
      createdAtValue: toHistoryDate(comparison.createdAt).toISOString(),
      attachments: [],
      caption: {
        id: comparison.id,
        attachmentId:
          comparison.captionAttachmentId ??
          comparison.captionAttachment?.id ??
          comparison.compareAttachmentId,
        fileName: captionFileName,
        submissionLabel: captionSubmissionLabel,
        xPercent: comparison.xPercent,
        yPercent: comparison.yPercent,
        body: comparison.body,
        isReadOnly: true,
      },
    };
  }

  return {
    id: `comparison-${comparison.id}`,
    kind: "comparison",
    title: "Comparison submitted",
    authorId: comparison.createdBy.id,
    author: getDisplayName(comparison.createdBy),
    authorAvatarSrc: getProfileAvatarSrc(comparison.createdBy),
    role: getActorRole(comparison.createdBy),
    body: comparison.body,
    createdAt: formatHistoryTimestamp(comparison.createdAt),
    createdAtValue: toHistoryDate(comparison.createdAt).toISOString(),
    attachments: [],
    comparison: {
      baseAttachmentId: comparison.baseAttachmentId,
      compareAttachmentId: comparison.compareAttachmentId,
      baseFileName: getComparisonFileName(comparison.baseAttachment),
      compareFileName: getComparisonFileName(comparison.compareAttachment),
      baseSubmissionLabel: getComparisonSubmissionLabel(
        comparison.baseAttachment,
        submissionNumbers,
      ),
      compareSubmissionLabel: getComparisonSubmissionLabel(
        comparison.compareAttachment,
        submissionNumbers,
      ),
      xPercent: comparison.xPercent,
      yPercent: comparison.yPercent,
    },
  };
}

async function getProjectAccessRecord(
  projectId: string,
  userId?: string,
  selectedStageId?: string,
) {
  return withPrismaRetry(() =>
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        category: true,
        ownerId: true,
        coOwners: {
          select: { userId: true },
        },
        executors: {
          ...(userId
            ? {
                where: {
                  userId,
                },
              }
            : {}),
          select: {
            userId: true,
          },
        },
        status: {
          select: projectStatusSelect,
        },
        archivedAt: true,
        executionType: true,
        currency: true,
        budget: true,
        endDate: true,
        collaborators: userId
          ? {
              where: {
                userId,
              },
              select: projectCollaboratorPermissionSelect,
            }
          : false,
        workflowStages: {
          select: {
            stageKey: true,
            status: true,
          },
        },
        stages: {
          where: selectedStageId
            ? {
                OR: [{ isTasker: false }, { id: selectedStageId }],
              }
            : { isTasker: false },
          orderBy: {
            order: "asc",
          },
          select: {
            id: true,
            name: true,
            isTasker: true,
            conceptFolder: {
              select: {
                workflowStageKey: true,
              },
            },
            budget: true,
            invoiceRequired: true,
            actualStartedAt: true,
            status: true,
            order: true,
            createdAt: true,
          },
        },
      },
    }),
  );
}

export type ProjectStageChatAccessRecord = ProjectPermissionContext & {
  id: string;
  stages: Array<{
    id: string;
    isTasker?: boolean;
    name?: string | null;
    order?: number | null;
    status?: StageStatus | string | null;
    createdAt?: Date | null;
    budget?: Prisma.Decimal | number | null;
    invoiceRequired?: boolean | null;
    actualStartedAt?: Date | null;
    revisionCount?: number;
    comparisonCount?: number;
  }>;
};

async function getStageChatAccessRecord(
  projectId: string,
  stageId: string,
  user: AccessUser,
): Promise<ProjectStageChatAccessRecord | null> {
  const stage = await withPrismaRetry(() =>
    prisma.projectStage.findUnique({
      where: {
        id: stageId,
      },
      select: {
        id: true,
        projectId: true,
        isTasker: true,
        conceptFolder: {
          select: {
            workflowStageKey: true,
          },
        },
        _count: {
          select: {
            revisions: true,
            comparisonComments: true,
          },
        },
        project: {
          select: {
            id: true,
            ownerId: true,
            coOwners: {
              select: { userId: true },
            },
            executors: {
              where: {
                userId: user.id,
              },
              select: {
                userId: true,
              },
            },
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
            workflowStages: {
              select: {
                stageKey: true,
                status: true,
              },
            },
            stages: {
              where: {
                OR: [{ isTasker: false }, { id: stageId }],
              },
              orderBy: {
                order: "asc",
              },
              select: {
                id: true,
                isTasker: true,
                name: true,
                order: true,
                status: true,
                _count: {
                  select: {
                    revisions: true,
                    comparisonComments: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  if (!stage || stage.projectId !== projectId) {
    return null;
  }

  if (
    !canOpenProjectStageChatContainer({
      isTasker: stage.isTasker,
      conceptFolder: stage.conceptFolder,
      workflowStages: stage.project.workflowStages,
    })
  ) {
    return null;
  }

  try {
    await assertConceptTaskerAccessIfNeeded(user, {
      projectId,
      stageId,
      mode: "view",
    });
  } catch {
    return null;
  }

  return {
    id: stage.project.id,
    ownerId: stage.project.ownerId,
    coOwners: stage.project.coOwners,
    executors: stage.project.executors,
    collaborators: stage.project.collaborators,
    stages: stage.project.stages
      .filter((projectStage) =>
        stage.isTasker
          ? projectStage.id === stage.id
          : !projectStage.isTasker,
      )
      .map((projectStage) => ({
        id: projectStage.id,
        isTasker: projectStage.isTasker,
        name: projectStage.name,
        order: projectStage.order,
        status: projectStage.status,
        revisionCount:
          projectStage.id === stage.id
            ? stage._count.revisions
            : projectStage._count.revisions,
        comparisonCount:
          projectStage.id === stage.id
            ? stage._count.comparisonComments
            : projectStage._count.comparisonComments,
      })),
  };
}

function isProjectExecutorUser(
  project: {
    executors?: Array<{ userId: string }>;
  },
  userId: string,
) {
  return isProjectExecutor({ id: userId }, project);
}

export async function assertProjectAccess(
  user: AccessUser,
  projectId: string,
  selectedStageId?: string,
) {
  const project = await getProjectAccessRecord(projectId, user.id, selectedStageId);

  if (!project) {
    throw new Error("Project not found.");
  }

  const selectedStage = selectedStageId
    ? project.stages.find((stage) => stage.id === selectedStageId)
    : null;

  if (
    selectedStage &&
    !canOpenProjectStageChatContainer({
      isTasker: selectedStage.isTasker,
      conceptFolder: selectedStage.conceptFolder,
      workflowStages: project.workflowStages,
    })
  ) {
    throw new Error("This workflow stage is locked.");
  }

  if (selectedStage) {
    await assertConceptTaskerAccessIfNeeded(user, {
      projectId,
      stageId: selectedStage.id,
      mode: "view",
    });
  }

  if (hasProjectPermission(user, project, "project.view")) {
    return project;
  }

  throw new Error("You do not have access to this project.");
}

function assertProjectAccessFromContext(
  user: AccessUser,
  project: ProjectPermissionContext,
) {
  if (hasProjectPermission(user, project, "project.view")) {
    return project;
  }

  throw new Error("You do not have access to this project.");
}

function assertProjectWorkflowPermission(
  user: AccessUser,
  project: ProjectPermissionContext,
  permissionKey: PermissionKey,
  message: string,
) {
  if (!hasProjectPermission(user, project, permissionKey)) {
    throw new Error(message);
  }
}

type StageChatWriteProjectContext = ProjectPermissionContext & {
  archivedAt?: Date | null;
  status: Parameters<typeof isProjectStatusCompleted>[0];
  workflowStages: Array<{
    stageKey: ProjectWorkflowStageKey;
    status: ProjectWorkflowStageStatus;
  }>;
};

type StageChatWriteStageContext = {
  id: string;
  isTasker: boolean;
  conceptFolder: { workflowStageKey: ProjectWorkflowStageKey } | null;
  actualStartedAt: Date | null;
  status: StageStatus;
  project: StageChatWriteProjectContext;
};

export async function assertStageChatWriteAccess(
  user: AccessUser,
  input: {
    projectId: string;
    stage: StageChatWriteStageContext;
    permissionKey?: PermissionKey;
    permissionMessage?: string;
    requireBriefAccepted?: boolean;
  },
) {
  const permissionKey = input.permissionKey ?? "chat.createComment";
  const project = assertProjectAccessFromContext(user, input.stage.project);

  await assertConceptTaskerAccessIfNeeded(user, {
    projectId: input.projectId,
    stageId: input.stage.id,
    mode: "view",
  });

  if (
    !canOpenProjectStageChatContainer({
      isTasker: input.stage.isTasker,
      conceptFolder: input.stage.conceptFolder,
      workflowStages: input.stage.project.workflowStages,
    })
  ) {
    throw new Error("This workflow stage is locked.");
  }

  assertProjectWorkflowPermission(
    user,
    project,
    permissionKey,
    input.permissionMessage ?? "You do not have permission to add project comments.",
  );

  if (isProjectStatusCompleted(input.stage.project.status)) {
    throw new Error("This project is already completed.");
  }

  if (input.stage.project.archivedAt) {
    throw new Error("This project has already been archived.");
  }

  if (input.stage.status === StageStatus.COMPLETED) {
    throw new Error("This stage is already completed. Chat is read-only.");
  }

  if (input.requireBriefAccepted !== false && !input.stage.actualStartedAt) {
    throw new Error("Please accept the brief before adding stage chat.");
  }

  if (
    !canBypassCollaboratorVisibility(user, input.stage.project.ownerId ?? "") &&
    !hasProjectPermission(user, input.stage.project, "collaborator.pauseVisibility")
  ) {
    const visibilityState = await getProjectCollaboratorVisibilityState(
      input.projectId,
      user.id,
    );

    if (visibilityState?.chatVisibilityPaused) {
      throw new Error("Your chat access is currently paused for this project.");
    }
  }

  return project;
}

function getUploadPermissionKey(assetType: AttachmentAssetType): PermissionKey {
  switch (assetType) {
    case AttachmentAssetType.STAGE_SUBMISSION:
    case AttachmentAssetType.REVISION_ORIGINAL:
      return "file.uploadSubmission";
    case AttachmentAssetType.STAGE_INVOICE:
      return "completion.uploadInvoice";
    case AttachmentAssetType.COMMENT_ATTACHMENT:
      return "chat.uploadAttachment";
    case AttachmentAssetType.GENERAL_PROJECT_ASSET:
    default:
      return "file.uploadAttachment";
  }
}

function getUploadPermissionErrorMessage(assetType: AttachmentAssetType) {
  return assetType === AttachmentAssetType.GENERAL_PROJECT_ASSET
    ? "You do not have permission to upload project attachments."
    : "You do not have permission to upload assets to the library.";
}

function isStageInvoiceRequired(
  project: { executionType: ProjectExecutionType | null },
  stage: { invoiceRequired: boolean },
) {
  return project.executionType === ProjectExecutionType.EXTERNAL && stage.invoiceRequired;
}

function resolveStageId(
  project: ProjectStageChatAccessRecord | null,
  preferredStageId?: string | null,
) {
  if (!project) {
    return null;
  }

  if (preferredStageId && project.stages.some((stage) => stage.id === preferredStageId)) {
    return preferredStageId;
  }

  return project.stages[0]?.id ?? null;
}

function filterAttachmentsOutsidePauseWindows<
  T extends {
    createdAt: Date | string;
  },
>(attachments: T[], pauseWindows: ProjectCollaboratorVisibilityPauseRecord[]) {
  if (pauseWindows.length === 0) {
    return attachments;
  }

  return attachments.filter(
    (attachment) => !isTimestampHiddenByPauseWindows(attachment.createdAt, pauseWindows),
  );
}

function filterHistoryEntriesOutsidePauseWindows<
  T extends {
    createdAt: Date;
    attachments: Array<{
      createdAt: Date;
    }>;
  },
>(entries: T[], pauseWindows: ProjectCollaboratorVisibilityPauseRecord[]) {
  if (pauseWindows.length === 0) {
    return entries;
  }

  return entries
    .filter((entry) => !isTimestampHiddenByPauseWindows(entry.createdAt, pauseWindows))
    .map((entry) => ({
      ...entry,
      attachments: filterAttachmentsOutsidePauseWindows(entry.attachments, pauseWindows),
    }));
}

async function getProjectVisibilityPauseWindows(
  user: AccessUser,
  project: Pick<ProjectStageChatAccessRecord, "id" | "ownerId" | "coOwners">,
) {
  if (
    canBypassCollaboratorVisibility(user, project.ownerId ?? "") ||
    hasProjectPermission(user, project, "collaborator.pauseVisibility")
  ) {
    return [];
  }

  const visibilityState = await getProjectCollaboratorVisibilityState(project.id, user.id);
  return visibilityState?.visibilityPauses ?? [];
}

type StageChatCursorSource = "revision" | "comment" | "comparison";

type StageChatCursor = {
  source: StageChatCursorSource;
  id: string;
  createdAt: string;
};

type DecodedStageChatCursor = Omit<StageChatCursor, "createdAt"> & {
  createdAt: Date;
};

type StageChatTimelineItem =
  | {
      source: "revision";
      id: string;
      createdAt: Date;
      entry: StageHistoryQueryRecord;
    }
  | {
      source: "comment";
      id: string;
      createdAt: Date;
      entry: StageCommentQueryRecord;
    }
  | {
      source: "comparison";
      id: string;
      createdAt: Date;
      entry: StageComparisonQueryRecord;
    };

function clampStageChatMessageLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return DEFAULT_STAGE_CHAT_MESSAGE_LIMIT;
  }

  return Math.min(MAX_STAGE_CHAT_MESSAGE_LIMIT, Math.floor(limit));
}

function encodeStageChatCursor(
  source: StageChatCursorSource,
  createdAt: Date | string | number,
  id: string,
) {
  const payload: StageChatCursor = {
    source,
    id,
    createdAt: toHistoryDate(createdAt).toISOString(),
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeStageChatCursor(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<StageChatCursor>;
    const createdAt = payload.createdAt ? new Date(payload.createdAt) : null;

    if (
      !payload.source ||
      !payload.id ||
      !createdAt ||
      Number.isNaN(createdAt.getTime())
    ) {
      return null;
    }

    return {
      source: payload.source,
      id: payload.id,
      createdAt,
    } satisfies DecodedStageChatCursor;
  } catch {
    return null;
  }
}

function buildStageChatCreatedAtWhere(cursor: DecodedStageChatCursor | null) {
  return cursor
    ? {
        lt: cursor.createdAt,
      }
    : undefined;
}

function mapStageChatTimelineItem(
  item: StageChatTimelineItem,
  submissionNumbers: ReadonlyMap<string, number>,
  favoritedAttachmentIds: ReadonlySet<string>,
) {
  const cursor = encodeStageChatCursor(item.source, item.createdAt, item.id);

  if (item.source === "revision") {
    return {
      ...mapRevisionEntry(item.entry, submissionNumbers, favoritedAttachmentIds),
      cursor,
    };
  }

  if (item.source === "comparison") {
    return {
      ...mapComparisonEntry(item.entry, submissionNumbers),
      cursor,
    };
  }

  return {
    ...mapCommentEntry(item.entry, submissionNumbers, favoritedAttachmentIds),
    cursor,
  };
}

async function hasReadyStageInvoice(projectId: string, stageId: string) {
  const invoice = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        projectId,
        stageId,
        assetType: AttachmentAssetType.STAGE_INVOICE,
        status: AttachmentStatus.READY,
      },
      select: {
        id: true,
      },
    }),
  );

  return Boolean(invoice);
}

export async function assertProjectAttachmentVisibilityForUser(
  user: AccessUser,
  attachment: {
    id?: string;
    projectId: string;
    stageId?: string | null;
    createdAt: Date;
    project: {
      ownerId: string | null;
      coOwners?: Array<{ userId: string }>;
    };
  },
) {
  if (attachment.stageId) {
    const sourceConcept = await getProjectConceptAccessContext({
      projectId: attachment.projectId,
      taskerStageId: attachment.stageId,
    });

    if (sourceConcept && !isProjectConceptWorkflowAccessible(sourceConcept)) {
      throw new Error("This workflow stage is locked.");
    }

    if (sourceConcept && !canViewProjectConcept(user, sourceConcept)) {
      const startingReferenceConcept = attachment.id
        ? await withPrismaRetry(() =>
            prisma.projectConceptFolder.findFirst({
              where: {
                projectId: attachment.projectId,
                workflowStageKey:
                  ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                sourceStage3ApprovedAttachmentId: attachment.id,
              },
              select: {
                id: true,
                projectId: true,
                taskerStageId: true,
                workflowStageKey: true,
                assignedExecutorId: true,
                project: {
                  select: {
                    ownerId: true,
                    coOwners: { select: { userId: true } },
                  },
                },
              },
            }),
          )
        : null;
      const startingReferenceContext = startingReferenceConcept
        ? {
            folderId: startingReferenceConcept.id,
            projectId: startingReferenceConcept.projectId,
            taskerStageId: startingReferenceConcept.taskerStageId,
            workflowStageKey: startingReferenceConcept.workflowStageKey,
            assignedExecutorId: startingReferenceConcept.assignedExecutorId,
            ownerId: startingReferenceConcept.project.ownerId,
            coOwnerIds: startingReferenceConcept.project.coOwners.map(
              (coOwner) => coOwner.userId,
            ),
          }
        : null;

      if (
        !startingReferenceContext ||
        !canViewProjectConcept(user, startingReferenceContext)
      ) {
        throw new Error("You do not have access to this concept.");
      }

      return;
    }
  }

  if (hasProjectPermission(user, attachment.project, "collaborator.pauseVisibility")) {
    return;
  }

  await assertProjectTimestampVisibleForUser(user, {
    projectId: attachment.projectId,
    projectOwnerId: attachment.project.ownerId ?? "",
    timestamp: attachment.createdAt,
    message: "You do not have permission to access this file.",
  });
}

async function isConceptWorkflowCompleted(input: {
  projectId: string;
  taskerStageId: string;
}) {
  const concept = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findFirst({
      where: {
        projectId: input.projectId,
        taskerStageId: input.taskerStageId,
      },
      select: {
        workflowStageKey: true,
        project: {
          select: {
            workflowStages: {
              select: { stageKey: true, status: true },
            },
          },
        },
      },
    }),
  );

  return Boolean(
    concept?.project.workflowStages.some(
      (stage) =>
        stage.stageKey === concept.workflowStageKey &&
        stage.status === ProjectWorkflowStageStatus.COMPLETED,
    ),
  );
}

export async function getProjectStageChatMessages(
  user: AccessUser,
  projectId: string,
  preferredStageId?: string | null,
  options: {
    limit?: number;
    cursor?: string | null;
    requiredPermissionKey?: PermissionKey;
    projectAccessRecord?: ProjectStageChatAccessRecord | null;
    includeWorkflowCards?: "auto" | "always" | "never";
  } = {},
): Promise<StageHistoryRecord> {
  const totalStartedAt = performance.now();
  const projectLookupStartedAt = performance.now();
  const project =
    options.projectAccessRecord ??
    (preferredStageId
      ? await getStageChatAccessRecord(projectId, preferredStageId, user)
      : await getProjectAccessRecord(projectId, user.id));
  logStageChatTiming("init", "project lookup", projectLookupStartedAt, {
    projectId,
    reusedRouteContext: Boolean(options.projectAccessRecord),
    stageScoped: Boolean(!options.projectAccessRecord && preferredStageId),
  });

  const permissionStartedAt = performance.now();
  if (!project) {
    throw new Error("Project not found.");
  }

  if (!hasProjectPermission(user, project, "project.view")) {
    throw new Error("You do not have access to this project.");
  }

  const requiredPermissionKey = options.requiredPermissionKey ?? "chat.view";
  const conceptComparisonAccess =
    requiredPermissionKey === "compare.view" && preferredStageId
      ? await assertConceptTaskerAccessIfNeeded(user, {
          projectId,
          stageId: preferredStageId,
          mode: "view",
        })
      : null;

  if (!conceptComparisonAccess) {
    assertProjectWorkflowPermission(
      user,
      project,
      requiredPermissionKey,
      requiredPermissionKey === "compare.view"
        ? "You do not have permission to compare project submissions."
        : "You do not have permission to view project chat.",
    );
  }
  logStageChatTiming("init", "permission check", permissionStartedAt);

  const stageLookupStartedAt = performance.now();
  const activeStageId = resolveStageId(project, preferredStageId);
  const lockedStageInfo = getLockedStageInfo(
    project.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      status: stage.status,
    })),
    activeStageId,
  );

  if (lockedStageInfo) {
    throw new Error(lockedStageInfo.message);
  }

  logStageChatTiming("init", "stage lookup", stageLookupStartedAt, {
    activeStageId,
    preferredStageId,
  });

  if (!activeStageId) {
    logStageChatTiming("init", "total page data", totalStartedAt, {
      entries: 0,
      hasMore: false,
    });

    return {
      activeStageId: null,
      latestRevisionId: null,
      entries: [],
      revisionCount: 0,
      nextCursor: null,
      hasMore: false,
    };
  }

  const limit = clampStageChatMessageLimit(options.limit);
  const cursor = decodeStageChatCursor(options.cursor);
  const createdAtWhere = buildStageChatCreatedAtWhere(cursor);
  const take = limit + 1;
  const activeStage = project.stages.find((stageItem) => stageItem.id === activeStageId);
  const knownRevisionCount =
    activeStage &&
    "revisionCount" in activeStage &&
    typeof activeStage.revisionCount === "number"
      ? activeStage.revisionCount
      : null;
  const knownComparisonCount =
    activeStage &&
    "comparisonCount" in activeStage &&
    typeof activeStage.comparisonCount === "number"
      ? activeStage.comparisonCount
      : null;

  const messagesQueryStartedAt = performance.now();
  const commentsPromise = withPrismaRetry(() =>
    prisma.projectComment.findMany({
      where: {
        projectId,
        stageId: activeStageId,
        createdAt: createdAtWhere,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
        mentions: {
          select: {
            mentionedUserId: true,
            mentionedUser: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        attachments: {
          orderBy: {
            createdAt: "asc",
          },
          select: {
            id: true,
            assetType: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
            submissionReviewStatus: true,
            createdAt: true,
            status: true,
            uploadedBy: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
  ).finally(() =>
    logStageChatTiming("init", "latest messages query", messagesQueryStartedAt, {
      limit: take,
    }),
  );

  const latestRevisionStartedAt = performance.now();
  const latestRevisionPromise =
    options.includeWorkflowCards === "never" || knownRevisionCount === 0
      ? Promise.resolve(null).finally(() =>
          logStageChatTiming("init", "latest revision query", latestRevisionStartedAt, {
            skipped: true,
            knownRevisionCount,
          }),
        )
      : withPrismaRetry(() =>
          prisma.projectRevision.findFirst({
            where: {
              projectId,
              stageId: activeStageId,
            },
            orderBy: {
              revisionNumber: "desc",
            },
            select: {
              id: true,
            },
          }),
        ).finally(() =>
          logStageChatTiming("init", "latest revision query", latestRevisionStartedAt),
        );

  const comparisonProbeStartedAt = performance.now();
  const comparisonProbePromise =
    options.includeWorkflowCards === "never" || knownComparisonCount === 0
      ? Promise.resolve(null).finally(() =>
          logStageChatTiming("init", "comparison activity probe", comparisonProbeStartedAt, {
            skipped: true,
            knownComparisonCount,
          }),
        )
      : knownComparisonCount !== null && knownComparisonCount > 0
        ? Promise.resolve({ id: "__known_comparison_activity__" }).finally(() =>
            logStageChatTiming(
              "init",
              "comparison activity probe",
              comparisonProbeStartedAt,
              {
                skipped: true,
                knownComparisonCount,
              },
            ),
          )
      : withPrismaRetry(() =>
          prisma.comparisonComment.findFirst({
            where: {
              projectId,
              stageId: activeStageId,
              createdAt: createdAtWhere,
            },
            select: {
              id: true,
            },
          }),
        ).finally(() =>
          logStageChatTiming("init", "comparison activity probe", comparisonProbeStartedAt),
        );

  const [allComments, latestRevision, comparisonProbe] = await Promise.all([
    commentsPromise,
    latestRevisionPromise,
    comparisonProbePromise,
  ]);

  const workflowDecisionStartedAt = performance.now();
  const includeWorkflowCards =
    options.includeWorkflowCards === "always" ||
    (options.includeWorkflowCards !== "never" &&
      (Boolean(latestRevision) || Boolean(comparisonProbe)));
  logStageChatTiming("init", "workflow query decision", workflowDecisionStartedAt, {
    includeWorkflowCards,
    hasRevision: Boolean(latestRevision),
    hasComparison: Boolean(comparisonProbe),
    knownRevisionCount,
    knownComparisonCount,
  });

  let allRevisions: StageHistoryQueryRecord[] = [];
  let allComparisons: StageComparisonQueryRecord[] = [];
  let revisionCount = 0;

  if (includeWorkflowCards) {
    const countStartedAt = performance.now();
    const revisionCountPromise =
      knownRevisionCount !== null
        ? Promise.resolve(knownRevisionCount).finally(() =>
            logStageChatTiming("init", "sidebar/count query", countStartedAt, {
              skipped: true,
              knownRevisionCount,
            }),
          )
        : latestRevision
          ? withPrismaRetry(() =>
              prisma.projectRevision.count({
                where: {
                  projectId,
                  stageId: activeStageId,
                },
              }),
            ).finally(() =>
              logStageChatTiming("init", "sidebar/count query", countStartedAt),
            )
          : Promise.resolve(0).finally(() =>
              logStageChatTiming("init", "sidebar/count query", countStartedAt, {
                skipped: true,
              }),
            );

    const revisionQueryStartedAt = performance.now();
    const revisionsPromise = latestRevision
      ? withPrismaRetry(() =>
          prisma.projectRevision.findMany({
            where: {
              projectId,
              stageId: activeStageId,
              createdAt: createdAtWhere,
            },
            orderBy: [
              {
                createdAt: "desc",
              },
              {
                id: "desc",
              },
            ],
            take,
            include: {
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  avatarUrl: true,
                },
              },
              reviewedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
              attachments: {
                orderBy: {
                  createdAt: "asc",
                },
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          }),
        ).finally(() =>
          logStageChatTiming("init", "revision/history query", revisionQueryStartedAt, {
            limit: take,
          }),
        )
      : Promise.resolve([] as StageHistoryQueryRecord[]).finally(() =>
          logStageChatTiming("init", "revision/history query", revisionQueryStartedAt, {
            skipped: true,
          }),
        );

    const comparisonQueryStartedAt = performance.now();
    const comparisonsPromise = comparisonProbe
      ? withPrismaRetry(() =>
          prisma.comparisonComment.findMany({
            where: {
              projectId,
              stageId: activeStageId,
              createdAt: createdAtWhere,
            },
            orderBy: [
              {
                createdAt: "desc",
              },
              {
                id: "desc",
              },
            ],
            take,
            include: {
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  avatarUrl: true,
                },
              },
              baseAttachment: {
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
              compareAttachment: {
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
              captionAttachment: {
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          }),
        ).finally(() =>
          logStageChatTiming("init", "comparison query", comparisonQueryStartedAt, {
            limit: take,
          }),
        )
      : Promise.resolve([] as StageComparisonQueryRecord[]).finally(() =>
          logStageChatTiming("init", "comparison query", comparisonQueryStartedAt, {
            skipped: true,
          }),
        );

    [allRevisions, allComparisons, revisionCount] = await Promise.all([
      revisionsPromise,
      comparisonsPromise,
      revisionCountPromise,
    ]);
  } else {
    logStageChatTiming("init", "sidebar/count query", performance.now(), {
      skipped: true,
      reason: "no workflow activity",
    });
    logStageChatTiming("init", "revision/history query", performance.now(), {
      skipped: true,
      reason: "no workflow activity",
    });
    logStageChatTiming("init", "comparison query", performance.now(), {
      skipped: true,
      reason: "no workflow activity",
    });
  }

  const visibilityStartedAt = performance.now();
  const pauseWindows = await getProjectVisibilityPauseWindows(user, project);
  const revisions = filterHistoryEntriesOutsidePauseWindows(allRevisions, pauseWindows);
  const comments = filterHistoryEntriesOutsidePauseWindows(allComments, pauseWindows);
  const comparisons =
    pauseWindows.length > 0
      ? allComparisons.filter(
          (comparison) =>
            !isTimestampHiddenByPauseWindows(comparison.createdAt, pauseWindows),
        )
      : allComparisons;
  logStageChatTiming("init", "visibility filter", visibilityStartedAt, {
    pauseWindows: pauseWindows.length,
  });

  const timeline: StageChatTimelineItem[] = [
    ...revisions.map((entry) => ({
      source: "revision" as const,
      id: entry.id,
      createdAt: entry.createdAt,
      entry,
    })),
    ...comments.map((entry) => ({
      source: "comment" as const,
      id: entry.id,
      createdAt: entry.createdAt,
      entry,
    })),
    ...comparisons.map((entry) => ({
      source: "comparison" as const,
      id: entry.id,
      createdAt: entry.createdAt,
      entry,
    })),
  ].sort((left, right) => {
    const timeDifference =
      toHistoryDate(right.createdAt).getTime() - toHistoryDate(left.createdAt).getTime();

    return timeDifference !== 0
      ? timeDifference
      : right.id.localeCompare(left.id);
  });
  const selectedTimelineItems = timeline.slice(0, limit);
  const selectedCommentAndRevisionEntries = selectedTimelineItems.flatMap((item) =>
    item.source === "comparison" ? [] : [item.entry],
  );
  const favoriteLookupStartedAt = performance.now();
  const favoritedAttachmentIds = await getFavoriteAttachmentIdSetForUser(
    user.id,
    selectedCommentAndRevisionEntries
      .flatMap((entry) => entry.attachments)
      .filter((attachment) => attachment.status === AttachmentStatus.READY)
      .map((attachment) => attachment.id),
  );
  logStageChatTiming("init", "favorite lookup", favoriteLookupStartedAt, {
    attachments: selectedCommentAndRevisionEntries.flatMap((entry) => entry.attachments).length,
  });

  const mappingStartedAt = performance.now();
  const submissionNumbers = buildStageSubmissionNumberMap(revisions, comments);
  const entries = selectedTimelineItems
    .slice()
    .sort((left, right) => {
      const timeDifference =
        toHistoryDate(left.createdAt).getTime() - toHistoryDate(right.createdAt).getTime();

      return timeDifference !== 0
        ? timeDifference
        : left.id.localeCompare(right.id);
    })
    .map((item) =>
      mapStageChatTimelineItem(item, submissionNumbers, favoritedAttachmentIds),
    );
  const hasMore =
    timeline.length > limit ||
    allRevisions.length > limit ||
    allComments.length > limit ||
    allComparisons.length > limit;
  const nextCursor = hasMore ? entries[0]?.cursor ?? null : null;
  logStageChatTiming("init", "final data mapping", mappingStartedAt, {
    entries: entries.length,
    hasMore,
  });
  logStageChatTiming("init", "total page data", totalStartedAt, {
    entries: entries.length,
    hasMore,
  });

  return {
    activeStageId,
    latestRevisionId: latestRevision?.id ?? null,
    entries,
    revisionCount,
    nextCursor,
    hasMore,
  };
}

async function assertStageChatRealtimeAccess(
  user: AccessUser,
  projectId: string,
  stageId: string,
) {
  const project = await getStageChatAccessRecord(projectId, stageId, user);

  if (!project) {
    throw new Error("Project not found.");
  }

  if (!hasProjectPermission(user, project, "project.view")) {
    throw new Error("You do not have access to this project.");
  }

  assertProjectWorkflowPermission(
    user,
    project,
    "chat.view",
    "You do not have permission to view project chat.",
  );
  const lockedStageInfo = getLockedStageInfo(project.stages, stageId);

  if (lockedStageInfo) {
    throw new Error(lockedStageInfo.message);
  }

  return project;
}

async function findStageChatCommentForRealtime(input: {
  projectId: string;
  stageId: string;
  commentId: string;
}) {
  return withPrismaRetry(() =>
    prisma.projectComment.findFirst({
      where: {
        id: input.commentId,
        projectId: input.projectId,
        stageId: input.stageId,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
        mentions: {
          select: {
            mentionedUserId: true,
            mentionedUser: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        attachments: {
          orderBy: {
            createdAt: "asc",
          },
          select: {
            id: true,
            assetType: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
            submissionReviewStatus: true,
            createdAt: true,
            status: true,
            uploadedBy: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
  );
}

async function mapRealtimeCommentsForUser(
  user: AccessUser,
  project: ProjectStageChatAccessRecord,
  comments: StageCommentQueryRecord[],
) {
  const pauseWindows = await getProjectVisibilityPauseWindows(user, project);
  const visibleComments = filterHistoryEntriesOutsidePauseWindows(comments, pauseWindows);
  const favoritedAttachmentIds = await getFavoriteAttachmentIdSetForUser(
    user.id,
    visibleComments
      .flatMap((entry) => entry.attachments)
      .filter((attachment) => attachment.status === AttachmentStatus.READY)
      .map((attachment) => attachment.id),
  );
  const submissionNumbers = buildStageSubmissionNumberMap([], visibleComments);

  return visibleComments.map((comment) => ({
    comment,
    entry: mapCommentEntry(comment, submissionNumbers, favoritedAttachmentIds),
  }));
}

export async function getStageChatCommentEntryForUser(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    commentId: string;
  },
): Promise<StageChatCommentEntryRecord | null> {
  const project = await assertStageChatRealtimeAccess(
    user,
    input.projectId,
    input.stageId,
  );
  const comment = await findStageChatCommentForRealtime(input);

  if (!comment) {
    return null;
  }

  const [mappedComment] = await mapRealtimeCommentsForUser(user, project, [comment]);

  if (!mappedComment) {
    return null;
  }

  return {
    entry: mappedComment.entry,
    projectId: mappedComment.comment.projectId,
    stageId: mappedComment.comment.stageId,
    commentId: mappedComment.comment.id,
    authorId: mappedComment.comment.author.id,
    createdAt: toHistoryDate(mappedComment.comment.createdAt).toISOString(),
    updatedAt: toHistoryDate(
      mappedComment.comment.updatedAt ?? mappedComment.comment.createdAt,
    ).toISOString(),
  };
}

export async function getStageChatUpdatesForUser(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    after?: string | null;
    limit?: number;
  },
): Promise<StageChatUpdatesRecord> {
  const project = await assertStageChatRealtimeAccess(
    user,
    input.projectId,
    input.stageId,
  );
  const parsedAfter = input.after ? new Date(input.after) : null;
  const after =
    parsedAfter && !Number.isNaN(parsedAfter.getTime()) ? parsedAfter : null;
  const limit = Math.max(1, Math.min(input.limit ?? 50, 50));
  const take = limit + 1;
  const updatedAtWhere = after
    ? {
        gt: after,
      }
    : undefined;
  const [comments, revisions, comparisons] = await Promise.all([
    withPrismaRetry(() =>
      prisma.projectComment.findMany({
        where: {
          projectId: input.projectId,
          stageId: input.stageId,
          updatedAt: updatedAtWhere,
        },
        orderBy: [
          {
            updatedAt: after ? "asc" : "desc",
          },
          {
            id: after ? "asc" : "desc",
          },
        ],
        take,
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
            },
          },
          mentions: {
            select: {
              mentionedUserId: true,
              mentionedUser: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
          attachments: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              assetType: true,
              originalFileName: true,
              mimeType: true,
              fileSize: true,
              submissionReviewStatus: true,
              createdAt: true,
              status: true,
              uploadedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ),
    withPrismaRetry(() =>
      prisma.projectRevision.findMany({
        where: {
          projectId: input.projectId,
          stageId: input.stageId,
          updatedAt: updatedAtWhere,
        },
        orderBy: [
          {
            updatedAt: after ? "asc" : "desc",
          },
          {
            id: after ? "asc" : "desc",
          },
        ],
        take,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
            },
          },
          reviewedBy: {
            select: {
              name: true,
              email: true,
            },
          },
          attachments: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              assetType: true,
              originalFileName: true,
              mimeType: true,
              fileSize: true,
              submissionReviewStatus: true,
              createdAt: true,
              status: true,
              uploadedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ),
    withPrismaRetry(() =>
      prisma.comparisonComment.findMany({
        where: {
          projectId: input.projectId,
          stageId: input.stageId,
          updatedAt: updatedAtWhere,
        },
        orderBy: [
          {
            updatedAt: after ? "asc" : "desc",
          },
          {
            id: after ? "asc" : "desc",
          },
        ],
        take,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
            },
          },
          baseAttachment: {
            select: {
              id: true,
              assetType: true,
              originalFileName: true,
              mimeType: true,
              fileSize: true,
              submissionReviewStatus: true,
              createdAt: true,
              status: true,
              uploadedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
          compareAttachment: {
            select: {
              id: true,
              assetType: true,
              originalFileName: true,
              mimeType: true,
              fileSize: true,
              submissionReviewStatus: true,
              createdAt: true,
              status: true,
              uploadedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
          captionAttachment: {
            select: {
              id: true,
              assetType: true,
              originalFileName: true,
              mimeType: true,
              fileSize: true,
              submissionReviewStatus: true,
              createdAt: true,
              status: true,
              uploadedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ),
  ]);
  const changes = [
    ...comments.map((comment) => ({
      source: "comment" as const,
      id: comment.id,
      updatedAt: comment.updatedAt ?? comment.createdAt,
      createdAt: comment.createdAt,
      entry: comment,
    })),
    ...revisions.map((revision) => ({
      source: "revision" as const,
      id: revision.id,
      updatedAt: revision.updatedAt ?? revision.createdAt,
      createdAt: revision.createdAt,
      entry: revision,
    })),
    ...comparisons.map((comparison) => ({
      source: "comparison" as const,
      id: comparison.id,
      updatedAt: comparison.updatedAt ?? comparison.createdAt,
      createdAt: comparison.createdAt,
      entry: comparison,
    })),
  ].sort((left, right) => {
    const timeDifference =
      after
        ? left.updatedAt.getTime() - right.updatedAt.getTime()
        : right.updatedAt.getTime() - left.updatedAt.getTime();

    return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id);
  });
  const selectedChanges = changes.slice(0, limit);
  const pauseWindows = await getProjectVisibilityPauseWindows(user, project);
  const selectedRevisions = selectedChanges
    .filter((item): item is Extract<typeof item, { source: "revision" }> => item.source === "revision")
    .map((item) => item.entry);
  const selectedComments = selectedChanges
    .filter((item): item is Extract<typeof item, { source: "comment" }> => item.source === "comment")
    .map((item) => item.entry);
  const selectedComparisons = selectedChanges
    .filter((item): item is Extract<typeof item, { source: "comparison" }> => item.source === "comparison")
    .map((item) => item.entry);
  const visibleRevisions = filterHistoryEntriesOutsidePauseWindows(
    selectedRevisions,
    pauseWindows,
  );
  const visibleComments = filterHistoryEntriesOutsidePauseWindows(
    selectedComments,
    pauseWindows,
  );
  const visibleComparisons =
    pauseWindows.length > 0
      ? selectedComparisons.filter(
          (comparison) =>
            !isTimestampHiddenByPauseWindows(comparison.createdAt, pauseWindows),
        )
      : selectedComparisons;
  const favoritedAttachmentIds = await getFavoriteAttachmentIdSetForUser(
    user.id,
    [...visibleRevisions, ...visibleComments]
      .flatMap((entry) => entry.attachments)
      .filter((attachment) => attachment.status === AttachmentStatus.READY)
      .map((attachment) => attachment.id),
  );
  const submissionNumbers = buildStageSubmissionNumberMap(
    visibleRevisions,
    visibleComments,
  );
  const mappedEntries = [
    ...visibleRevisions.map((revision) => ({
      createdAt: toHistoryDate(revision.createdAt).getTime(),
      entry: mapRevisionEntry(revision, submissionNumbers, favoritedAttachmentIds),
    })),
    ...visibleComments.map((comment) => ({
      createdAt: toHistoryDate(comment.createdAt).getTime(),
      entry: mapCommentEntry(comment, submissionNumbers, favoritedAttachmentIds),
    })),
    ...visibleComparisons.map((comparison) => ({
      createdAt: toHistoryDate(comparison.createdAt).getTime(),
      entry: mapComparisonEntry(comparison, submissionNumbers),
    })),
  ]
    .sort((left, right) => {
      const timeDifference = left.createdAt - right.createdAt;

      return timeDifference !== 0
        ? timeDifference
        : left.entry.id.localeCompare(right.entry.id);
    })
    .map((item) => item.entry);
  const newestUpdatedAt = selectedChanges.reduce<Date | null>((current, item) => {
    if (!current || item.updatedAt.getTime() > current.getTime()) {
      return item.updatedAt;
    }

    return current;
  }, null);

  return {
    projectId: input.projectId,
    stageId: input.stageId,
    entries: mappedEntries,
    watermark: (newestUpdatedAt ?? after ?? new Date()).toISOString(),
    hasMore:
      changes.length > selectedChanges.length ||
      comments.length > limit ||
      revisions.length > limit ||
      comparisons.length > limit,
  };
}

export async function getProjectStageHistory(
  user: AccessUser,
  projectId: string,
  preferredStageId?: string | null,
  requiredPermissionKey: PermissionKey = "chat.view",
): Promise<StageHistoryRecord> {
  const project = preferredStageId
    ? await getStageChatAccessRecord(projectId, preferredStageId, user)
    : await assertProjectAccess(user, projectId);

  if (!project) {
    throw new Error("Project not found.");
  }

  if (!hasProjectPermission(user, project, "project.view")) {
    throw new Error("You do not have access to this project.");
  }
  const conceptComparisonAccess =
    requiredPermissionKey === "compare.view" &&
    hasPermission(user, "compare.view") &&
    preferredStageId
      ? await assertConceptTaskerAccessIfNeeded(user, {
          projectId,
          stageId: preferredStageId,
          mode: "view",
        })
      : null;

  if (!conceptComparisonAccess) {
    assertProjectWorkflowPermission(
      user,
      project,
      requiredPermissionKey,
      requiredPermissionKey === "compare.view"
        ? "You do not have permission to compare project submissions."
        : "You do not have permission to view project chat.",
    );
  }
  const activeStageId = resolveStageId(project, preferredStageId);
  const lockedStageInfo = getLockedStageInfo(
    project.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      status: stage.status,
    })),
    activeStageId,
  );

  if (lockedStageInfo) {
    throw new Error(lockedStageInfo.message);
  }

  if (!activeStageId) {
    return {
      activeStageId: null,
      latestRevisionId: null,
      entries: [],
    };
  }

  const getCachedHistory = unstable_cache(
    async () =>
      withPrismaRetry(() =>
        Promise.all([
          prisma.projectRevision.findMany({
            where: {
              projectId,
              stageId: activeStageId,
            },
            orderBy: {
              createdAt: "asc",
            },
            include: {
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  avatarUrl: true,
                },
              },
              reviewedBy: {
                select: {
                  name: true,
                  email: true,
                },
              },
              attachments: {
                orderBy: {
                  createdAt: "asc",
                },
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          }),
          prisma.projectComment.findMany({
            where: {
              projectId,
              stageId: activeStageId,
            },
            orderBy: {
              createdAt: "asc",
            },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  avatarUrl: true,
                },
              },
              mentions: {
                select: {
                  mentionedUserId: true,
                  mentionedUser: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
              attachments: {
                orderBy: {
                  createdAt: "asc",
                },
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          }),
          prisma.comparisonComment.findMany({
            where: {
              projectId,
              stageId: activeStageId,
            },
            orderBy: {
              createdAt: "asc",
            },
            include: {
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  avatarUrl: true,
                },
              },
              baseAttachment: {
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
              compareAttachment: {
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
              captionAttachment: {
                select: {
                  id: true,
                  assetType: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  submissionReviewStatus: true,
                  createdAt: true,
                  status: true,
                  uploadedBy: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          }),
        ]),
      ),
    ["project-stage-history", projectId, activeStageId],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  );

  const [allRevisions, allComments, allComparisons] = await getCachedHistory();
  const submissionNumbers = buildStageSubmissionNumberMap(allRevisions, allComments);
  const pauseWindows = await getProjectVisibilityPauseWindows(user, project);
  const revisions = filterHistoryEntriesOutsidePauseWindows(allRevisions, pauseWindows);
  const comments = filterHistoryEntriesOutsidePauseWindows(allComments, pauseWindows);
  const comparisons =
    pauseWindows.length > 0
      ? allComparisons.filter(
          (comparison) =>
            !isTimestampHiddenByPauseWindows(comparison.createdAt, pauseWindows),
        )
      : allComparisons;
  const favoritedAttachmentIds = await getFavoriteAttachmentIdSetForUser(
    user.id,
    [...revisions, ...comments]
      .flatMap((entry) => entry.attachments)
      .filter((attachment) => attachment.status === AttachmentStatus.READY)
      .map((attachment) => attachment.id),
  );
  const entries = [
    ...revisions.map((revision) => ({
      createdAt: toHistoryDate(revision.createdAt).getTime(),
      entry: mapRevisionEntry(revision, submissionNumbers, favoritedAttachmentIds),
    })),
    ...comments.map((comment) => ({
      createdAt: toHistoryDate(comment.createdAt).getTime(),
      entry: mapCommentEntry(comment, submissionNumbers, favoritedAttachmentIds),
    })),
    ...comparisons.map((comparison) => ({
      createdAt: toHistoryDate(comparison.createdAt).getTime(),
      entry: mapComparisonEntry(comparison, submissionNumbers),
    })),
  ]
    .sort((left, right) => {
      const timeDifference = left.createdAt - right.createdAt;

      return timeDifference !== 0
        ? timeDifference
        : left.entry.id.localeCompare(right.entry.id);
    })
    .map((item) => item.entry);

  return {
    activeStageId,
    latestRevisionId: revisions.at(-1)?.id ?? null,
    entries,
  };
}

export async function createStageRevision(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    summary?: string;
    attachmentIds?: string[];
  },
) {
  const summary = sanitizeRichText(input.summary) || null;
  const project = await assertProjectAccess(user, input.projectId, input.stageId);
  const stage = project.stages.find((item) => item.id === input.stageId);

  if (!stage) {
    throw new Error("Stage not found.");
  }

  assertProjectWorkflowPermission(
    user,
    project,
    "stage.submitWork",
    "Only a project executor can submit work for review.",
  );

  if (!isProjectExecutorUser(project, user.id)) {
    throw new Error("Only a project executor can submit work for review.");
  }

  if (isProjectStatusCompleted(project.status)) {
    throw new Error("This project is already completed.");
  }

  if (project.archivedAt) {
    throw new Error("This project has already been archived.");
  }

  if (stage.status === StageStatus.COMPLETED) {
    throw new Error("This stage is already completed.");
  }

  if (!stage.actualStartedAt) {
    throw new Error("Please accept the brief before submitting work.");
  }

  const concept = await assertConceptTaskerAccessIfNeeded(user, {
    projectId: input.projectId,
    stageId: stage.id,
    mode: "work",
  });

  const stagedAttachmentIds = Array.from(
    new Set((input.attachmentIds ?? []).map((id) => id.trim()).filter(Boolean)),
  );

  if (concept && stagedAttachmentIds.length === 0) {
    throw new Error("Concept revisions require at least one submitted file.");
  }

  if (!concept && stagedAttachmentIds.length > 0) {
    throw new Error("Staged attachments are only supported for concept revisions.");
  }

  if (concept) {
    return withPrismaRetry(async () => {
      const reviewState = await getStageReviewState(input.projectId, stage.id);

      if (reviewState.pendingReview) {
        throw new Error(getPendingStageReviewMessage(reviewState.pendingReview));
      }

      const revisionNumber = reviewState.latestRevisionNumber + 1;

      return prisma.$transaction(async (tx) => {
        const stagedAttachmentCount = await tx.projectAttachment.count({
          where: {
            id: { in: stagedAttachmentIds },
            projectId: input.projectId,
            stageId: stage.id,
            revisionId: null,
            commentId: null,
            uploadedById: user.id,
            assetType: AttachmentAssetType.REVISION_ORIGINAL,
            status: AttachmentStatus.READY,
          },
        });

        if (stagedAttachmentCount !== stagedAttachmentIds.length) {
          throw new Error(
            "Every concept revision file must be uploaded successfully before submission.",
          );
        }

        const revision = await tx.projectRevision.create({
          data: {
            projectId: input.projectId,
            stageId: stage.id,
            createdById: user.id,
            revisionNumber,
            title: `Revision ${revisionNumber}`,
            summary,
            status: ProjectRevisionStatus.PENDING_REVIEW,
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
          },
          select: {
            id: true,
            title: true,
            revisionNumber: true,
            status: true,
          },
        });
        const attached = await tx.projectAttachment.updateMany({
          where: {
            id: { in: stagedAttachmentIds },
            projectId: input.projectId,
            stageId: stage.id,
            revisionId: null,
            commentId: null,
            uploadedById: user.id,
            assetType: AttachmentAssetType.REVISION_ORIGINAL,
            status: AttachmentStatus.READY,
          },
          data: { revisionId: revision.id },
        });

        if (attached.count !== stagedAttachmentIds.length) {
          throw new Error("Concept revision files changed before submission. Please retry.");
        }

        // A file submission replaces any earlier request to complete without a file.
        await tx.projectConceptFolder.updateMany({
          where: { projectId: input.projectId, taskerStageId: stage.id, completionRequestedAt: { not: null } },
          data: { completionRequestedAt: null, completionRequestNote: null },
        });

        await tx.projectActivityLog.create({
          data: {
            projectId: input.projectId,
            stageId: stage.id,
            revisionId: revision.id,
            actorId: user.id,
            action: ActivityLogAction.REVISION_CREATED,
            metadata: {
              title: revision.title,
              stageName: stage.name,
            },
          },
        });

        return revision;
      });
    });
  }

  const revision = await withPrismaRetry(async () => {
    const reviewState = await getStageReviewState(input.projectId, stage.id);

    if (reviewState.pendingReview) {
      throw new Error(getPendingStageReviewMessage(reviewState.pendingReview));
    }

    const revisionNumber = reviewState.latestRevisionNumber + 1;

    return prisma.projectRevision.create({
      data: {
        projectId: input.projectId,
        stageId: stage.id,
        createdById: user.id,
        revisionNumber,
        title: `Revision ${revisionNumber}`,
        summary,
        status: ProjectRevisionStatus.PENDING_REVIEW,
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
      },
      select: {
        id: true,
        title: true,
        revisionNumber: true,
        status: true,
      },
    });
  });

  await withPrismaRetry(() =>
    prisma.projectActivityLog.create({
      data: {
        projectId: input.projectId,
        stageId: stage.id,
        revisionId: revision.id,
        actorId: user.id,
        action: ActivityLogAction.REVISION_CREATED,
        metadata: {
          title: revision.title,
          stageName: stage.name,
        },
      },
    }),
  );

  return revision;
}

export async function createStageComment(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    revisionId?: string | null;
    body: string;
    allowEmptyBody?: boolean;
    mentionedUserIds?: string[];
  },
) {
  const totalStartedAt = performance.now();
  const stageLookupStartedAt = performance.now();
  const stage = await withPrismaRetry(() =>
    prisma.projectStage.findFirst({
      where: {
        id: input.stageId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        isTasker: true,
        conceptFolder: {
          select: { workflowStageKey: true },
        },
        actualStartedAt: true,
        status: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executors: {
              where: {
                userId: user.id,
              },
              select: {
                userId: true,
              },
            },
            status: {
              select: projectStatusSelect,
            },
            archivedAt: true,
            workflowStages: {
              select: { stageKey: true, status: true },
            },
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
          },
        },
      },
    }),
  );
  logStageChatTiming("send", "project/stage lookup", stageLookupStartedAt, {
    projectId: input.projectId,
    stageId: input.stageId,
  });

  if (!stage) {
    throw new Error("Stage not found.");
  }

  const permissionStartedAt = performance.now();
  const project = await assertStageChatWriteAccess(user, {
    projectId: input.projectId,
    stage,
    permissionKey: "chat.createComment",
    permissionMessage:
      "You do not have permission to add project comments.",
  });
  logStageChatTiming("send", "permission/access check", permissionStartedAt);

  const body = input.body.trim();
  const requestedRevisionId = input.revisionId?.trim() || null;

  if (requestedRevisionId) {
    const revisionLookupStartedAt = performance.now();
    const revision = await withPrismaRetry(() =>
      prisma.projectRevision.findFirst({
        where: {
          id: requestedRevisionId,
          projectId: input.projectId,
          stageId: stage.id,
        },
        select: {
          id: true,
        },
      }),
    );
    logStageChatTiming("send", "revision lookup", revisionLookupStartedAt, {
      revisionId: requestedRevisionId,
    });

    if (!revision) {
      throw new Error("Revision not found.");
    }
  }

  if (!body && !input.allowEmptyBody) {
    throw new Error("Enter a comment before sending.");
  }

  const requestedMentionUserIds = Array.from(
    new Set(
      (input.mentionedUserIds ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (requestedMentionUserIds.length > 0) {
    assertProjectWorkflowPermission(
      user,
      project,
      "chat.mentionUser",
      "You do not have permission to mention users.",
    );
  }
  const mentionLookupStartedAt = performance.now();
  const validMentionUserIds =
    requestedMentionUserIds.length > 0
      ? (
          await getVisibleStageEventRecipientUserIds(input.projectId, new Date(), {
            includeOwner: true,
            includeExecutor: true,
            includeCollaborators: true,
            stageId: input.stageId,
          })
        ).filter(
          (recipientUserId) =>
            recipientUserId !== user.id &&
            requestedMentionUserIds.includes(recipientUserId),
        )
      : [];
  logStageChatTiming("send", "mention recipient lookup", mentionLookupStartedAt, {
    requestedMentions: requestedMentionUserIds.length,
    validMentions: validMentionUserIds.length,
  });

  const createStartedAt = performance.now();
  const comment = await withPrismaRetry(() =>
    prisma.projectComment.create({
      data: {
        projectId: input.projectId,
        stageId: stage.id,
        revisionId: requestedRevisionId,
        authorId: user.id,
        body: body || "Attachment uploaded.",
        mentions:
          validMentionUserIds.length > 0
            ? {
                createMany: {
                  data: validMentionUserIds.map((mentionedUserId) => ({
                    mentionedUserId,
                  })),
                },
              }
            : undefined,
      },
      select: {
        id: true,
        revisionId: true,
        createdAt: true,
        mentions: {
          select: {
            mentionedUserId: true,
          },
        },
      },
    }),
  );
  logStageChatTiming("send", "create comment", createStartedAt, {
    commentId: comment.id,
  });
  logStageChatTiming("send", "total send action", totalStartedAt, {
    commentId: comment.id,
  });

  return comment;
}

export async function createStageTextCommentFast(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    revisionId?: string | null;
    body: string;
    mentionedUserIds?: string[];
  },
): Promise<StageTextCommentFastResult> {
  const totalStartedAt = performance.now();
  const mentionParseStartedAt = performance.now();
  const body = input.body.trim();

  if (!body) {
    throw new Error("Enter a comment before sending.");
  }

  const requestedRevisionId = input.revisionId?.trim() || null;
  const requestedMentionUserIds = Array.from(
    new Set(
      (input.mentionedUserIds ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  logChatSendFastTiming("mention parsing", mentionParseStartedAt, {
    requestedMentions: requestedMentionUserIds.length,
  });
  logStageChatTiming("send", "mentions parsing", totalStartedAt, {
    requestedMentions: requestedMentionUserIds.length,
  });

  const accessQueryStartedAt = performance.now();
  const stage = await withPrismaRetry(() =>
    prisma.projectStage.findUnique({
      where: {
        id: input.stageId,
      },
      select: {
        id: true,
        projectId: true,
        isTasker: true,
        conceptFolder: {
          select: { workflowStageKey: true },
        },
        actualStartedAt: true,
        status: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executors: {
              where: {
                userId: user.id,
              },
              select: {
                userId: true,
              },
            },
            status: {
              select: {
                id: true,
                name: true,
                slug: true,
                color: true,
                group: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    color: true,
                    isActive: true,
                  },
                },
              },
            },
            archivedAt: true,
            workflowStages: {
              select: { stageKey: true, status: true },
            },
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
          },
        },
      },
    }),
  );
  logChatSendFastTiming("stage/access query", accessQueryStartedAt, {
    projectId: input.projectId,
    stageId: input.stageId,
  });
  logStageChatTiming("send", "project access/stage query", accessQueryStartedAt, {
    projectId: input.projectId,
    stageId: input.stageId,
  });

  const stageLookupStartedAt = performance.now();
  if (!stage || stage.projectId !== input.projectId) {
    throw new Error("Stage not found.");
  }
  logChatSendFastTiming("project/stage lookup", stageLookupStartedAt, {
    stageId: stage.id,
  });
  logStageChatTiming("send", "stage lookup", stageLookupStartedAt, {
    stageId: stage.id,
  });

  const projectAccessStartedAt = performance.now();
  const project = await assertStageChatWriteAccess(user, {
    projectId: input.projectId,
    stage,
    permissionKey: "chat.createComment",
    permissionMessage:
      "You do not have permission to add project comments.",
  });
  logChatSendFastTiming("project access check", projectAccessStartedAt);

  if (requestedMentionUserIds.length > 0) {
    const mentionPermissionStartedAt = performance.now();
    assertProjectWorkflowPermission(
      user,
      project,
      "chat.mentionUser",
      "You do not have permission to mention users.",
    );
    logChatSendFastTiming("chat.mentionUser permission check", mentionPermissionStartedAt);
  }

  if (requestedRevisionId) {
    const revisionLookupStartedAt = performance.now();
    const revision = await withPrismaRetry(() =>
      prisma.projectRevision.findFirst({
        where: {
          id: requestedRevisionId,
          projectId: input.projectId,
          stageId: stage.id,
        },
        select: {
          id: true,
        },
      }),
    );
    logStageChatTiming("send", "revision lookup", revisionLookupStartedAt, {
      revisionId: requestedRevisionId,
    });

    if (!revision) {
      throw new Error("Revision not found.");
    }
    logChatSendFastTiming("revision lookup used", revisionLookupStartedAt, {
      revisionId: requestedRevisionId,
    });
  } else {
    logChatSendFastTiming("revision lookup skipped", performance.now(), {
      skipped: true,
    });
    logStageChatTiming("send", "revision lookup", performance.now(), {
      skipped: true,
    });
  }

  const mentionLookupStartedAt = performance.now();
  const validMentionUserIds =
    requestedMentionUserIds.length > 0
      ? (
          await getVisibleStageEventRecipientUserIds(input.projectId, new Date(), {
            includeOwner: true,
            includeExecutor: true,
            includeCollaborators: true,
            stageId: input.stageId,
          })
        ).filter(
          (recipientUserId) =>
            recipientUserId !== user.id &&
            requestedMentionUserIds.includes(recipientUserId),
        )
      : [];
  logChatSendFastTiming(
    requestedMentionUserIds.length > 0
      ? "mention user lookup used"
      : "mention user lookup skipped",
    mentionLookupStartedAt,
    {
      requestedMentions: requestedMentionUserIds.length,
      validMentions: validMentionUserIds.length,
      skipped: requestedMentionUserIds.length === 0,
    },
  );
  logStageChatTiming("send", "mention recipient lookup", mentionLookupStartedAt, {
    requestedMentions: requestedMentionUserIds.length,
    validMentions: validMentionUserIds.length,
    skipped: requestedMentionUserIds.length === 0,
  });

  const createStartedAt = performance.now();
  const comment =
    validMentionUserIds.length > 0
      ? await withPrismaRetry(() =>
          prisma.projectComment.create({
            data: {
              projectId: input.projectId,
              stageId: stage.id,
              revisionId: requestedRevisionId,
              authorId: user.id,
              body,
              mentions: {
                createMany: {
                  data: validMentionUserIds.map((mentionedUserId) => ({
                    mentionedUserId,
                  })),
                },
              },
            },
            select: {
              id: true,
              projectId: true,
              stageId: true,
              revisionId: true,
              authorId: true,
              body: true,
              createdAt: true,
              mentions: {
                select: {
                  mentionedUserId: true,
                  mentionedUser: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          }),
        )
      : {
          ...(await withPrismaRetry(() =>
            prisma.projectComment.create({
              data: {
                projectId: input.projectId,
                stageId: stage.id,
                revisionId: requestedRevisionId,
                authorId: user.id,
                body,
              },
              select: {
                id: true,
                projectId: true,
                stageId: true,
                revisionId: true,
                authorId: true,
                body: true,
                createdAt: true,
              },
            }),
          )),
          mentions: [],
        };
  logChatSendFastTiming("ProjectComment insert", createStartedAt, {
    commentId: comment.id,
    mentions: validMentionUserIds.length,
  });
  logStageChatTiming("send", "create ProjectComment insert", createStartedAt, {
    commentId: comment.id,
    mentions: validMentionUserIds.length,
  });

  const dtoMappingStartedAt = performance.now();
  const commentMentions = comment.mentions.map((mention) => ({
    mentionedUserId: mention.mentionedUserId,
    mentionedUser:
      "mentionedUser" in mention
        ? mention.mentionedUser
        : {
            name: null,
            email: "",
          },
  }));
  const entry: ProjectChatEntry = {
    id: comment.id,
    revisionId: comment.revisionId ?? undefined,
    kind: "comment",
    authorId: user.id,
    author: getDisplayName(user),
    authorAvatarSrc:
      "avatarUrl" in user &&
      typeof user.avatarUrl === "string" &&
      user.avatarUrl
        ? `/api/profile/avatar?v=${encodeURIComponent(user.avatarUrl)}`
        : null,
    role: getActorRole(user),
    body: comment.body,
    createdAt: formatHistoryTimestamp(comment.createdAt),
    createdAtValue: toHistoryDate(comment.createdAt).toISOString(),
    canDeleteUntil: isDeletableStageComment({
      body: comment.body,
      attachments: [],
    })
      ? getStageChatDeleteExpiresAt(comment.createdAt).toISOString()
      : null,
    mentions: commentMentions.map((mention) => ({
      userId: mention.mentionedUserId,
      name: getDisplayName(mention.mentionedUser),
    })),
    attachments: [],
  };
  logChatSendFastTiming("returned DTO mapping", dtoMappingStartedAt, {
    commentId: comment.id,
    mentions: commentMentions.length,
  });
  logChatSendFastTiming("total", totalStartedAt, {
    commentId: comment.id,
  });
  logStageChatTiming("send", "total fast text comment", totalStartedAt, {
    commentId: comment.id,
  });

  return {
    id: comment.id,
    projectId: comment.projectId,
    stageId: comment.stageId,
    revisionId: comment.revisionId,
    authorId: comment.authorId,
    createdAt: comment.createdAt,
    mentions: comment.mentions.map((mention) => ({
      mentionedUserId: mention.mentionedUserId,
    })),
    entry,
  };
}

export async function deleteStageComment(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    commentId: string;
  },
) {
  const comment = await withPrismaRetry(() =>
    prisma.projectComment.findFirst({
      where: {
        id: input.commentId,
        projectId: input.projectId,
        stageId: input.stageId,
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        authorId: true,
        body: true,
        createdAt: true,
        deletedAt: true,
        deletedByUserId: true,
        attachments: {
          select: {
            assetType: true,
          },
        },
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executors: {
              select: {
                userId: true,
              },
            },
            status: {
              select: projectStatusSelect,
            },
            archivedAt: true,
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
          },
        },
      },
    }),
  );

  if (!comment) {
    throw new Error("Message not found.");
  }

  const project = assertProjectAccessFromContext(user, comment.project);

  assertProjectWorkflowPermission(
    user,
    project,
    "chat.view",
    "You do not have permission to view project chat.",
  );

  if (comment.authorId !== user.id) {
    throw new Error("You can only delete your own messages.");
  }

  if (comment.deletedAt) {
    throw new Error("This message was already deleted.");
  }

  if (!isDeletableStageComment(comment)) {
    throw new Error("This message cannot be deleted.");
  }

  if (Date.now() > getStageChatDeleteExpiresAt(comment.createdAt).getTime()) {
    throw new Error("Messages can only be deleted within 5 minutes.");
  }

  const deletedAt = new Date();
  const deletedComment = await withPrismaRetry(() =>
    prisma.projectComment.update({
      where: {
        id: comment.id,
      },
      data: {
        deletedAt,
        deletedByUserId: user.id,
      },
      select: {
        id: true,
        deletedAt: true,
        deletedByUserId: true,
      },
    }),
  );

  return {
    id: deletedComment.id,
    projectId: comment.projectId,
    stageId: comment.stageId,
    deletedAt: deletedComment.deletedAt ?? deletedAt,
    deletedByUserId: deletedComment.deletedByUserId,
    displayText: DELETED_STAGE_CHAT_MESSAGE_TEXT,
  };
}

export async function prepareStageCommentUploads(
  user: AccessUser,
  input: PrepareStageCommentUploadsInput,
): Promise<PrepareStageCommentUploadsResult> {
  const body = input.body.trim();
  const uploadFiles = input.files;

  if (!body && !input.allowEmptyBody) {
    return { error: "Enter a comment before sending." };
  }

  if (uploadFiles.length === 0) {
    return { error: "Choose a file to upload." };
  }

  for (const file of uploadFiles) {
    if (!file.originalFileName.trim()) {
      return { error: "Choose a file to upload." };
    }

    if (!isAllowedAssetFile(file.originalFileName)) {
      return buildFileTypeNotAllowedPayload({
        fileName: file.originalFileName,
        mimeType: file.mimeType,
        allowedExtensions: PROJECT_ASSET_ALLOWED_EXTENSIONS,
      });
    }

    if (!Number.isFinite(file.fileSize) || file.fileSize <= 0) {
      return { error: "File size is invalid." };
    }

    if (file.fileSize > getMaxAssetUploadBytes()) {
      return { error: "This file exceeds the allowed size limit." };
    }

    if (
      file.assetType !== AttachmentAssetType.COMMENT_ATTACHMENT &&
      file.assetType !== AttachmentAssetType.STAGE_SUBMISSION
    ) {
      return { error: "Unsupported chat upload type." };
    }

    if (file.assetType === AttachmentAssetType.STAGE_SUBMISSION) {
      return { error: "Use Submit Work to send files for review." };
    }
  }

  const stage = await withPrismaRetry(() =>
    prisma.projectStage.findFirst({
      where: {
        id: input.stageId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        isTasker: true,
        conceptFolder: {
          select: { workflowStageKey: true },
        },
        actualStartedAt: true,
        status: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executors: {
              select: {
                userId: true,
              },
            },
            status: {
              select: projectStatusSelect,
            },
            archivedAt: true,
            workflowStages: {
              select: { stageKey: true, status: true },
            },
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
          },
        },
        revisions: {
          orderBy: {
            revisionNumber: "desc",
          },
          take: 1,
          select: {
            id: true,
          },
        },
      },
    }),
  );

  if (!stage) {
    return { error: "Stage not found." };
  }

  let project: ProjectPermissionContext;

  try {
    project = await assertStageChatWriteAccess(user, {
      projectId: input.projectId,
      stage,
      permissionKey: "chat.createComment",
      permissionMessage:
        "You do not have permission to add project comments.",
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "You do not have permission to add project comments.",
    };
  }

  if (
    uploadFiles.some((file) => file.assetType === AttachmentAssetType.COMMENT_ATTACHMENT) &&
    !hasProjectPermission(user, project, "chat.uploadAttachment")
  ) {
    return { error: "You do not have permission to upload chat attachments." };
  }

  const requestedMentionUserIds = Array.from(
    new Set(
      (input.mentionedUserIds ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (requestedMentionUserIds.length > 0) {
    assertProjectWorkflowPermission(
      user,
      project,
      "chat.mentionUser",
      "You do not have permission to mention users.",
    );
  }

  const validMentionUserIds =
    requestedMentionUserIds.length > 0
      ? (
          await getVisibleStageEventRecipientUserIds(input.projectId, new Date(), {
            includeOwner: true,
            includeExecutor: true,
            includeCollaborators: true,
            stageId: input.stageId,
          })
        ).filter(
          (recipientUserId) =>
            recipientUserId !== user.id &&
            requestedMentionUserIds.includes(recipientUserId),
        )
      : [];
  const requestedRevisionId = input.revisionId?.trim() || null;

  if (requestedRevisionId) {
    const revision = await withPrismaRetry(() =>
      prisma.projectRevision.findFirst({
        where: {
          id: requestedRevisionId,
          projectId: input.projectId,
          stageId: stage.id,
        },
        select: {
          id: true,
        },
      }),
    );

    if (!revision) {
      return { error: "Revision not found." };
    }
  }

  const commentId = randomUUID();
  const preparedFiles = uploadFiles.map((file) => {
    const attachmentId = randomUUID();
    const uniqueFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFileName(
      file.originalFileName,
    )}`;

    return {
      ...file,
      attachmentId,
      uniqueFileName,
      storageKey: buildProjectAssetKey({
        projectId: input.projectId,
        stageId: stage.id,
        revisionId: requestedRevisionId,
        commentId,
        assetType: file.assetType,
        safeFileName: uniqueFileName,
      }),
    };
  });

  await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectComment.create({
        data: {
          id: commentId,
          projectId: input.projectId,
          stageId: stage.id,
          revisionId: requestedRevisionId,
          authorId: user.id,
          body: body || "Attachment uploaded.",
          mentions:
            validMentionUserIds.length > 0
              ? {
                  createMany: {
                    data: validMentionUserIds.map((mentionedUserId) => ({
                      mentionedUserId,
                    })),
                  },
                }
              : undefined,
        },
        select: {
          id: true,
        },
      }),
      prisma.projectAttachment.createMany({
        data: preparedFiles.map((file) => ({
          id: file.attachmentId,
          projectId: input.projectId,
          stageId: stage.id,
          revisionId: requestedRevisionId,
          commentId,
          uploadedById: user.id,
          fileName: file.uniqueFileName,
          originalFileName: file.originalFileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          bucket: getS3BucketName(),
          storageKey: file.storageKey,
          assetType: file.assetType,
          status: AttachmentStatus.UPLOADING,
          submissionReviewStatus:
            file.assetType === AttachmentAssetType.STAGE_SUBMISSION
              ? SubmissionReviewStatus.PENDING_REVIEW
              : null,
          reviewedById: null,
          reviewedAt: null,
          reviewNote: null,
        })),
      }),
    ]),
  );

  const uploads = await Promise.all(
    preparedFiles.map(async (file) => ({
      clientId: file.clientId,
      attachmentId: file.attachmentId,
      fileName: file.uniqueFileName,
      storageKey: file.storageKey,
      uploadUrl: await createPresignedUploadUrl({
        storageKey: file.storageKey,
        mimeType: file.mimeType,
      }),
    })),
  );

  return {
    commentId,
    revisionId: requestedRevisionId,
    mentionedUserIds: validMentionUserIds,
    uploads,
  };
}

export async function cancelPreparedStageCommentUploads(
  user: AccessUser,
  input: {
    projectId: string;
    commentId: string;
  },
) {
  const comment = await withPrismaRetry(() =>
    prisma.projectComment.findFirst({
      where: {
        id: input.commentId,
        projectId: input.projectId,
        authorId: user.id,
      },
      select: {
        id: true,
      },
    }),
  );

  if (!comment) {
    return;
  }

  await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectAttachment.deleteMany({
        where: {
          projectId: input.projectId,
          commentId: comment.id,
          uploadedById: user.id,
          assetType: {
            in: [
              AttachmentAssetType.COMMENT_ATTACHMENT,
              AttachmentAssetType.STAGE_SUBMISSION,
            ],
          },
        },
      }),
      prisma.projectComment.delete({
        where: {
          id: comment.id,
        },
      }),
    ]),
  );
}

export async function finalizePreparedStageCommentUploads(
  user: AccessUser,
  input: {
    projectId: string;
    commentId: string;
  },
): Promise<FinalizePreparedStageCommentUploadsResult> {
  const comment = await withPrismaRetry(() =>
    prisma.projectComment.findFirst({
      where: {
        id: input.commentId,
        projectId: input.projectId,
        authorId: user.id,
      },
      select: {
        id: true,
        stageId: true,
        stage: {
          select: {
            id: true,
            isTasker: true,
            conceptFolder: {
              select: { workflowStageKey: true },
            },
            actualStartedAt: true,
            status: true,
            project: {
              select: {
                ownerId: true,
                coOwners: { select: { userId: true } },
                executors: {
                  where: {
                    userId: user.id,
                  },
                  select: {
                    userId: true,
                  },
                },
                status: {
                  select: projectStatusSelect,
                },
                archivedAt: true,
                workflowStages: {
                  select: { stageKey: true, status: true },
                },
                collaborators: {
                  where: {
                    userId: user.id,
                  },
                  select: projectCollaboratorPermissionSelect,
                },
              },
            },
          },
        },
        attachments: {
          where: {
            assetType: {
              in: [
                AttachmentAssetType.COMMENT_ATTACHMENT,
                AttachmentAssetType.STAGE_SUBMISSION,
              ],
            },
          },
          select: {
            id: true,
            status: true,
          },
        },
        mentions: {
          select: {
            mentionedUserId: true,
          },
        },
      },
    }),
  );

  if (!comment) {
    throw new Error("Comment not found.");
  }

  if (!comment.stage) {
    throw new Error("Stage not found.");
  }

  await assertStageChatWriteAccess(user, {
    projectId: input.projectId,
    stage: comment.stage,
    permissionKey: "chat.createComment",
    permissionMessage:
      "You do not have permission to add project comments.",
  });

  if (
    comment.attachments.length === 0 ||
    comment.attachments.some((attachment) => attachment.status !== AttachmentStatus.READY)
  ) {
    throw new Error("All attachment uploads must finish before sending the comment.");
  }

  return {
    commentId: comment.id,
    stageId: comment.stageId,
    mentionedUserIds: comment.mentions.map((mention) => mention.mentionedUserId),
  };
}

export async function cancelStageRevisionSubmission(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    revisionId: string;
  },
) {
  const revision = await withPrismaRetry(() =>
    prisma.projectRevision.findFirst({
      where: {
        id: input.revisionId,
        projectId: input.projectId,
        stageId: input.stageId,
        createdById: user.id,
        status: ProjectRevisionStatus.PENDING_REVIEW,
        reviewedById: null,
        reviewedAt: null,
      },
      select: {
        id: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executors: {
              select: {
                userId: true,
              },
            },
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
          },
        },
      },
    }),
  );

  if (!revision) {
    return;
  }

  const project = assertProjectAccessFromContext(user, revision.project);

  assertProjectWorkflowPermission(
    user,
    project,
    "stage.submitWork",
    "Only a project executor can submit work for review.",
  );

  if (!isProjectExecutorUser(revision.project, user.id)) {
    throw new Error("Only a project executor can cancel this revision.");
  }

  await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectAttachment.deleteMany({
        where: {
          projectId: input.projectId,
          stageId: input.stageId,
          revisionId: revision.id,
          uploadedById: user.id,
          assetType: AttachmentAssetType.REVISION_ORIGINAL,
        },
      }),
      prisma.projectActivityLog.deleteMany({
        where: {
          projectId: input.projectId,
          stageId: input.stageId,
          revisionId: revision.id,
        },
      }),
      prisma.projectRevision.delete({
        where: {
          id: revision.id,
        },
      }),
    ]),
  );
}

export async function cancelStagedConceptRevisionAttachments(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    attachmentIds: string[];
  },
) {
  await assertConceptTaskerAccessIfNeeded(user, {
    projectId: input.projectId,
    stageId: input.stageId,
    mode: "work",
  });

  const attachmentIds = Array.from(
    new Set(input.attachmentIds.map((id) => id.trim()).filter(Boolean)),
  );

  if (attachmentIds.length === 0) {
    return { count: 0 };
  }

  const attachments = await withPrismaRetry(() =>
    prisma.projectAttachment.findMany({
      where: {
        id: { in: attachmentIds },
        projectId: input.projectId,
        stageId: input.stageId,
        revisionId: null,
        commentId: null,
        uploadedById: user.id,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
      },
      select: { id: true, bucket: true, storageKey: true },
    }),
  );

  await Promise.allSettled(
    attachments.map((attachment) =>
      deleteObjectIfNeeded(attachment.storageKey, attachment.bucket),
    ),
  );

  return withPrismaRetry(() =>
    prisma.projectAttachment.updateMany({
      where: {
        id: { in: attachments.map((attachment) => attachment.id) },
        revisionId: null,
      },
      data: { status: AttachmentStatus.DELETED },
    }),
  );
}

export async function startProjectStageWork(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
  },
) {
  const project = await assertProjectAccess(user, input.projectId, input.stageId);
  const stage = project.stages.find((item) => item.id === input.stageId);

  if (!stage) {
    throw new Error("Stage not found.");
  }

  await assertConceptTaskerAccessIfNeeded(user, {
    projectId: input.projectId,
    stageId: input.stageId,
    mode: "work",
  });

  assertProjectWorkflowPermission(
    user,
    project,
    "stage.acceptBrief",
    "Only a project executor can accept the brief for this stage.",
  );

  if (!isProjectExecutorUser(project, user.id)) {
    throw new Error("Only a project executor can accept the brief for this stage.");
  }

  if (isProjectStatusCompleted(project.status)) {
    throw new Error("This project is already completed.");
  }

  if (project.archivedAt) {
    throw new Error("This project has already been archived.");
  }

  if (stage.actualStartedAt) {
    throw new Error("This stage has already been started.");
  }

  if (stage.status === StageStatus.COMPLETED) {
    throw new Error("This stage is already completed.");
  }

  return withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const startedAt = new Date();

      const startedStage = await tx.projectStage.update({
        where: {
          id: stage.id,
        },
        data: {
          actualStartedAt: startedAt,
          startedById: user.id,
          status: StageStatus.ONGOING,
        },
        select: {
          id: true,
          actualStartedAt: true,
          status: true,
        },
      });

      const activityComment = await tx.projectComment.create({
        data: {
          projectId: input.projectId,
          stageId: stage.id,
          authorId: user.id,
          body: `${getDisplayName(user)} accepted the project and stage brief and started work on this stage.`,
        },
        select: {
          id: true,
          body: true,
          createdAt: true,
        },
      });

      return {
        stage: startedStage,
        activityComment,
      };
    }),
  );
}

export async function completeProjectStage(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
  },
) {
  const project = await getProjectAccessRecord(
    input.projectId,
    undefined,
    input.stageId,
  );

  if (!project) {
    throw new Error("Project not found.");
  }

  assertProjectWorkflowPermission(
    user,
    project,
    "stage.markStageComplete",
    "Only a project owner, co-owner, or administrator can mark this stage as complete.",
  );

  if (isProjectStatusCompleted(project.status)) {
    throw new Error("This project is already completed.");
  }

  const stage = project.stages.find((item) => item.id === input.stageId);

  if (!stage) {
    throw new Error("Stage not found.");
  }

  if (stage.isTasker) {
    throw new Error("Concept taskers do not use the stage completion flow.");
  }

  const orderedStages = project.stages
    .filter((item) => !item.isTasker)
    .sort((left, right) => left.order - right.order);
  const stageIndex = orderedStages.findIndex((item) => item.id === stage.id);
  const nextStage = stageIndex >= 0 ? orderedStages[stageIndex + 1] ?? null : null;

  if (stage.status === StageStatus.COMPLETED) {
    return {
      id: stage.id,
      status: stage.status,
      nextStage: nextStage
        ? {
            id: nextStage.id,
            name: nextStage.name,
            status: nextStage.status,
          }
        : null,
      allStagesCompleted: !nextStage,
    };
  }

  const latestRevision = await withPrismaRetry(() =>
    prisma.projectRevision.findFirst({
      where: {
        projectId: input.projectId,
        stageId: stage.id,
      },
      orderBy: {
        revisionNumber: "desc",
      },
      select: {
        status: true,
      },
    }),
  );

  if (!latestRevision) {
    throw new Error("Submit work before completing this stage.");
  }

  if (latestRevision.status === ProjectRevisionStatus.PENDING_REVIEW) {
    throw new Error("Approve the latest submission before completing this stage.");
  }

  if (latestRevision.status !== ProjectRevisionStatus.APPROVED) {
    throw new Error("Submit an approved revision before completing this stage.");
  }

  if (
    isStageInvoiceRequired(project, stage) &&
    !(await hasReadyStageInvoice(input.projectId, stage.id))
  ) {
    throw new Error("Invoice is required before completing this stage.");
  }

  const updatedStage = await withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const completedStage = await tx.projectStage.update({
        where: {
          id: stage.id,
        },
        data: {
          status: StageStatus.COMPLETED,
          completedAt: new Date(),
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (nextStage) {
        const nextStageStatus =
          nextStage.status === StageStatus.PENDING ? StageStatus.ONGOING : nextStage.status;

        if (nextStageStatus !== nextStage.status) {
          await tx.projectStage.update({
            where: {
              id: nextStage.id,
            },
            data: {
              status: nextStageStatus,
            },
          });
        }

        await tx.project.update({
          where: {
            id: input.projectId,
          },
          data: {
            currentStageName: nextStage.name,
          },
        });
      } else {
        await tx.project.update({
          where: {
            id: input.projectId,
          },
          data: {
            currentStageName: stage.name,
          },
        });

        await ensureFinalCompletionWorkflowExistsTx(tx, input.projectId);
      }

      return completedStage;
    }),
  );

  return {
    ...updatedStage,
    nextStage: nextStage
      ? {
          id: nextStage.id,
          name: nextStage.name,
          status: nextStage.status === StageStatus.PENDING ? StageStatus.ONGOING : nextStage.status,
        }
      : null,
    allStagesCompleted: !nextStage,
  };
}

export async function reviewStageSubmission(
  user: AccessUser,
  input: {
    attachmentId: string;
    status: "APPROVED" | "REJECTED";
    note?: string;
  },
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: input.attachmentId,
      },
      select: {
        id: true,
        assetType: true,
        status: true,
        projectId: true,
        stageId: true,
        commentId: true,
        uploadedById: true,
        submissionReviewStatus: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executionType: true,
            status: {
              select: projectStatusSelect,
            },
          },
        },
      },
    }),
  );

  if (
    !attachment ||
    attachment.assetType !== AttachmentAssetType.STAGE_SUBMISSION ||
    attachment.status !== AttachmentStatus.READY
  ) {
    throw new Error("Submission not found.");
  }

  const concept = attachment.stageId
    ? await assertConceptTaskerAccessIfNeeded(user, {
        projectId: attachment.projectId,
        stageId: attachment.stageId,
        mode: "review",
      })
    : null;

  if (concept && input.status === "APPROVED") {
    throw new Error(
      "Concept taskers cannot use the legacy approve/complete action. Request changes remains available.",
    );
  }

  if (attachment.uploadedById === user.id) {
    throw new Error("You cannot review your own submission.");
  }

  if (
    !hasProjectPermission(
      user,
      attachment.project,
      "stage.reviewSubmission",
    )
  ) {
    throw new Error("Only a project owner, co-owner, or administrator can review submissions.");
  }

  if (isProjectStatusCompleted(attachment.project.status)) {
    throw new Error("This project is already completed.");
  }

  if (
    attachment.submissionReviewStatus &&
    attachment.submissionReviewStatus !== SubmissionReviewStatus.PENDING_REVIEW
  ) {
    throw new Error("This submission has already been reviewed.");
  }

  return withPrismaRetry(() =>
    prisma.projectAttachment.update({
      where: {
        id: attachment.id,
      },
      data: {
        submissionReviewStatus: input.status,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: input.note?.trim() || null,
      },
      select: {
        id: true,
        submissionReviewStatus: true,
      },
    }),
  );
}

export async function reviewProjectRevision(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    revisionId: string;
    status: "APPROVED" | "REJECTED";
    reason?: string;
  },
) {
  const revision = await withPrismaRetry(() =>
    prisma.projectRevision.findFirst({
      where: {
        id: input.revisionId,
        projectId: input.projectId,
        stageId: input.stageId,
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        revisionNumber: true,
        createdById: true,
        status: true,
        title: true,
        stage: {
          select: {
            id: true,
            name: true,
            order: true,
            isTasker: true,
            status: true,
            invoiceRequired: true,
          },
        },
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executionType: true,
            status: {
              select: projectStatusSelect,
            },
          },
        },
      },
    }),
  );

  if (!revision) {
    throw new Error("Submission not found.");
  }

  await assertConceptTaskerAccessIfNeeded(user, {
    projectId: input.projectId,
    stageId: input.stageId,
    mode: "review",
  });

  if (revision.createdById === user.id) {
    throw new Error("You cannot review your own submission.");
  }

  if (revision.stage.isTasker && input.status === "APPROVED") {
    throw new Error(
      "Concept taskers cannot use the legacy approve/complete action. Request changes remains available.",
    );
  }

  assertProjectWorkflowPermission(
    user,
    revision.project,
    input.status === "APPROVED"
      ? "stage.markSubmissionComplete"
      : "stage.requestRevision",
    input.status === "APPROVED"
      ? "Only a project owner, co-owner, or administrator can review this submission."
      : "Only a project owner, co-owner, or administrator can request revisions.",
  );

  if (isProjectStatusCompleted(revision.project.status)) {
    throw new Error("This project is already completed.");
  }

  if (revision.status !== ProjectRevisionStatus.PENDING_REVIEW) {
    throw new Error("This submission is no longer pending review.");
  }

  const rejectionReason = sanitizeRichText(input.reason);

  if (input.status === "REJECTED" && !rejectionReason) {
    throw new Error("Revision reason is required.");
  }

  const canCompleteStageOnApproval =
    input.status === "APPROVED" &&
    revision.stage.status !== StageStatus.COMPLETED &&
    (!isStageInvoiceRequired(revision.project, revision.stage) ||
      (await hasReadyStageInvoice(input.projectId, revision.stageId)));

  const reviewedAt = new Date();
  const attachmentReviewStatus =
    input.status === "APPROVED"
      ? SubmissionReviewStatus.APPROVED
      : SubmissionReviewStatus.REJECTED;

  return withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const updatedRevision = await tx.projectRevision.update({
        where: {
          id: revision.id,
        },
        data: {
          status: input.status,
          reviewedById: user.id,
          reviewedAt,
          rejectionReason: input.status === "REJECTED" ? rejectionReason : null,
        },
        select: {
          id: true,
          status: true,
          rejectionReason: true,
          reviewedAt: true,
          reviewedBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      await tx.projectAttachment.updateMany({
        where: {
          projectId: revision.projectId,
          stageId: revision.stageId,
          revisionId: revision.id,
          submissionReviewStatus: SubmissionReviewStatus.PENDING_REVIEW,
        },
        data: {
          submissionReviewStatus: attachmentReviewStatus,
          reviewedById: user.id,
          reviewedAt,
          reviewNote: input.status === "REJECTED" ? rejectionReason : null,
        },
      });

      let rejectionComment:
        | {
            id: string;
            body: string;
          }
        | null = null;
      let stageCompletion:
        | {
            id: string;
            status: StageStatus;
            nextStage: {
              id: string;
              name: string;
              status: string;
            } | null;
            allStagesCompleted: boolean;
          }
        | null = null;

      if (canCompleteStageOnApproval) {
        const orderedStages = await tx.projectStage.findMany({
          where: {
            projectId: revision.projectId,
            isTasker: false,
          },
          orderBy: {
            order: "asc",
          },
          select: {
            id: true,
            name: true,
            status: true,
            order: true,
          },
        });

        const stageIndex = orderedStages.findIndex((item) => item.id === revision.stageId);
        const nextStage = stageIndex >= 0 ? orderedStages[stageIndex + 1] ?? null : null;

        const completedAt = new Date();

        await tx.projectStage.update({
          where: {
            id: revision.stageId,
          },
          data: {
            status: StageStatus.COMPLETED,
            completedAt,
          },
        });

        if (nextStage) {
          const nextStageStatus =
            nextStage.status === StageStatus.PENDING ? StageStatus.ONGOING : nextStage.status;

          if (nextStageStatus !== nextStage.status) {
            await tx.projectStage.update({
              where: {
                id: nextStage.id,
              },
              data: {
                status: nextStageStatus,
              },
            });
          }

          await tx.project.update({
            where: {
              id: revision.projectId,
            },
            data: {
              currentStageName: nextStage.name,
            },
          });

          stageCompletion = {
            id: revision.stageId,
            status: StageStatus.COMPLETED,
            nextStage: {
              id: nextStage.id,
              name: nextStage.name,
              status: nextStage.status === StageStatus.PENDING ? StageStatus.ONGOING : nextStage.status,
            },
            allStagesCompleted: false,
          };
        } else {
          await tx.project.update({
            where: {
              id: revision.projectId,
            },
            data: {
              currentStageName: revision.stage.name,
            },
          });

          await ensureFinalCompletionWorkflowExistsTx(tx, revision.projectId);

          stageCompletion = {
            id: revision.stageId,
            status: StageStatus.COMPLETED,
            nextStage: null,
            allStagesCompleted: true,
          };
        }
      }

      if (input.status === "REJECTED") {
        rejectionComment = await tx.projectComment.create({
          data: {
            projectId: revision.projectId,
            stageId: revision.stageId,
            revisionId: revision.id,
            authorId: user.id,
            body: `Revision brief for Revision ${revision.revisionNumber}: ${rejectionReason}`,
          },
          select: {
            id: true,
            body: true,
          },
        });
      }

      return {
        ...updatedRevision,
        reviewedBy: updatedRevision.reviewedBy
          ? getDisplayName(updatedRevision.reviewedBy)
          : null,
        rejectionComment,
        stageCompletion,
      };
    }),
  );
}

export async function requestStageInvoice(
  user: AccessUser,
  input: {
    projectId: string;
    stageId: string;
    requestedFromId: string;
    note?: string;
  },
) {
  const requestedFromId = input.requestedFromId.trim();

  if (!requestedFromId) {
    throw new Error("Choose who should upload the invoice.");
  }

  const stage = await withPrismaRetry(() =>
    prisma.projectStage.findFirst({
      where: {
        id: input.stageId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        name: true,
        status: true,
        invoiceRequired: true,
        revisions: {
          orderBy: {
            revisionNumber: "desc",
          },
          select: {
            status: true,
          },
          take: 1,
        },
        attachments: {
          where: {
            assetType: AttachmentAssetType.STAGE_INVOICE,
            status: AttachmentStatus.READY,
          },
          select: {
            id: true,
          },
          take: 1,
        },
        project: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            coOwners: { select: { userId: true } },
            executionType: true,
            status: {
              select: projectStatusSelect,
            },
            archivedAt: true,
            executors: {
              select: {
                userId: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
            collaborators: {
              select: {
                userId: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  if (!stage) {
    throw new Error("Stage not found.");
  }

  assertProjectWorkflowPermission(
    user,
    stage.project,
    "stage.markSubmissionComplete",
    "Only a project owner, co-owner, or administrator can request an invoice.",
  );

  if (isProjectStatusCompleted(stage.project.status)) {
    throw new Error("This project is already completed.");
  }

  if (stage.project.archivedAt) {
    throw new Error("This project has already been archived.");
  }

  if (stage.status === StageStatus.COMPLETED) {
    throw new Error("This stage is already completed.");
  }

  if (!isStageInvoiceRequired(stage.project, stage)) {
    throw new Error("Invoice is not required for this stage.");
  }

  const latestRevision = stage.revisions[0] ?? null;

  if (!latestRevision) {
    throw new Error("Invoice can be requested only after submission approval.");
  }

  if (latestRevision.status !== ProjectRevisionStatus.APPROVED) {
    throw new Error("Invoice can be requested only after the submitted work is approved.");
  }

  if (stage.attachments.length > 0) {
    throw new Error("An invoice has already been uploaded for this stage.");
  }

  const executorCandidate = stage.project.executors.find(
    (executor) => executor.userId === requestedFromId,
  );
  const candidate = executorCandidate?.user ?? null;

  if (!candidate) {
    throw new Error("Invoice can only be requested from a project executor.");
  }

  const note = input.note?.trim() || null;
  const now = new Date();
  const requestedFromName = getDisplayName(candidate);
  const invoiceRequestBody = note
    ? `Invoice requested from ${requestedFromName} for ${stage.name}.\n${note}`
    : `Invoice requested from ${requestedFromName} for ${stage.name}.`;

  const { request, comment } = await withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const request = await tx.stageInvoiceRequest.upsert({
        where: {
          stageId: stage.id,
        },
        create: {
          projectId: stage.project.id,
          stageId: stage.id,
          requestedById: user.id,
          requestedFromId,
          note,
          fulfilledAt: null,
        },
        update: {
          requestedById: user.id,
          requestedFromId,
          note,
          fulfilledAt: null,
          updatedAt: now,
        },
        select: {
          id: true,
          requestedFromId: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          requestedBy: {
            select: {
              name: true,
              email: true,
            },
          },
          requestedFrom: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });
      const comment = await tx.projectComment.create({
        data: {
          projectId: stage.project.id,
          stageId: stage.id,
          authorId: user.id,
          body: invoiceRequestBody,
        },
        select: {
          id: true,
        },
      });

      return { request, comment };
    }),
  );

  return {
    id: request.id,
    requestedFromId: request.requestedFromId,
    requestedFromName: getDisplayName(request.requestedFrom),
    requestedByName: getDisplayName(request.requestedBy),
    note: request.note,
    requestedAt: request.updatedAt,
    commentId: comment.id,
  };
}

function getUploadAction(assetType: AttachmentAssetType) {
  return assetType === AttachmentAssetType.COMMENT_ATTACHMENT
    ? ActivityLogAction.COMMENT_ATTACHMENT_UPLOADED
    : ActivityLogAction.ASSET_UPLOADED;
}

async function hasChecklistResponseUploadAccess(
  user: AccessUser,
  input: { requestId?: string; projectId: string },
) {
  if (!input.requestId) return false;
  const request = await withPrismaRetry(() =>
    prisma.projectFileChecklistRequest.findFirst({
      where: {
        id: input.requestId,
        projectId: input.projectId,
        channel: ProjectFileChecklistRequestChannel.IN_APP,
        workflowStatus: ProjectFileChecklistRequestWorkflowStatus.ACCEPTED,
        ...(user.role === UserRole.SUPER_ADMIN ? {} : { recipientUserId: user.id }),
      },
      select: { id: true },
    }),
  );
  return Boolean(request);
}

async function hasStageSevenEvidenceUploadAccess(
  user: AccessUser,
  projectId: string,
) {
  const project = await withPrismaRetry(() =>
    prisma.project.findFirst({
      where: {
        id: projectId,
        completedAt: null,
        archivedAt: null,
        workflowStages: {
          some: {
            stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
            status: ProjectWorkflowStageStatus.AVAILABLE,
          },
        },
      },
      select: {
        ownerId: true,
        coOwners: { where: { userId: user.id }, select: { userId: true } },
      },
    }),
  );
  return Boolean(
    project &&
      (isGlobalProjectAdministrator(user) ||
        project.ownerId === user.id ||
        project.coOwners.length),
  );
}

function getDirectStageFiveSourceAccessError(
  user: AccessUser,
  project: ProjectPermissionContext & {
    status: Parameters<typeof isProjectStatusCompleted>[0];
    archivedAt: Date | null;
    workflowStages: Array<{
      stageKey: ProjectWorkflowStageKey;
      status: ProjectWorkflowStageStatus;
    }>;
  },
) {
  if (
    !isGlobalProjectAdministrator(user) ||
    !hasProjectPermission(user, project, "file.uploadAttachment")
  ) {
    return "You do not have permission to upload a Stage 5 final file.";
  }

  if (isProjectStatusCompleted(project.status) || project.archivedAt) {
    return "This project no longer accepts Stage 5 final files.";
  }

  const stageFour = project.workflowStages.find(
    (stage) =>
      stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
  );
  const stageFive = project.workflowStages.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
  );

  if (
    stageFour?.status !== ProjectWorkflowStageStatus.COMPLETED ||
    stageFive?.status !== ProjectWorkflowStageStatus.AVAILABLE
  ) {
    return "Direct final-file uploads are available only while Stage 5 is active.";
  }

  return null;
}

export async function requestAttachmentUpload(
  user: AccessUser,
  input: RequestUploadInput,
): Promise<RequestUploadResult> {
  if (!input.originalFileName.trim()) {
    return { error: "Choose a file to upload." };
  }

  const isFormalStageSubmission =
    input.assetType === AttachmentAssetType.STAGE_SUBMISSION ||
    input.assetType === AttachmentAssetType.REVISION_ORIGINAL;

  const isProjectResearchFile =
    input.assetType === AttachmentAssetType.PROJECT_RESEARCH_FILE;
  const isProjectPrivateFile =
    input.assetType === AttachmentAssetType.PROJECT_PRIVATE_FILE;
  const isStageSevenEvidence =
    input.assetType === AttachmentAssetType.SAMPLE_ROUND_EVIDENCE;

  if (
    input.stageFiveDirectSource &&
    (input.assetType !== AttachmentAssetType.GENERAL_PROJECT_ASSET ||
      Boolean(input.stageId || input.revisionId || input.commentId))
  ) {
    return { error: "A direct Stage 5 source must be a standalone project asset." };
  }

  if (isProjectPrivateFile) {
    return { error: "Use the private folder upload endpoint." };
  }

  if (
    !isFormalStageSubmission &&
    !isProjectResearchFile &&
    !isStageSevenEvidence &&
    !isAllowedAssetFile(input.originalFileName)
  ) {
    return buildFileTypeNotAllowedPayload({
      fileName: input.originalFileName,
      mimeType: input.mimeType,
      allowedExtensions: PROJECT_ASSET_ALLOWED_EXTENSIONS,
    });
  }

  if (
    isStageSevenEvidence &&
    !isAllowedStageSevenEvidenceFile(input.originalFileName, input.mimeType)
  ) {
    return buildFileTypeNotAllowedPayload({
      fileName: input.originalFileName,
      mimeType: input.mimeType,
      allowedExtensions: STAGE_SEVEN_EVIDENCE_ALLOWED_EXTENSIONS,
      error: "Stage 7 evidence must be an image or video.",
    });
  }

  if (
    isStageSevenEvidence &&
    !(await hasStageSevenEvidenceUploadAccess(user, input.projectId))
  ) {
    return { error: "Only a Stage 7 manager can upload sample-round evidence." };
  }

  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { error: "File size is invalid." };
  }

  if (input.fileSize > getMaxAssetUploadBytes()) {
    return { error: "This file exceeds the allowed size limit." };
  }

  if (input.stageId) {
    const isConceptBriefAttachment =
      input.assetType === AttachmentAssetType.GENERAL_PROJECT_ASSET &&
      !input.revisionId &&
      !input.commentId;

    try {
      const concept = await assertConceptTaskerAccessIfNeeded(user, {
        projectId: input.projectId,
        stageId: input.stageId,
        mode: isConceptBriefAttachment
          ? "manage"
          : input.assetType === AttachmentAssetType.REVISION_ORIGINAL
            ? "work"
            : "view",
      });

      if (
        concept &&
        isConceptBriefAttachment &&
        (await isConceptWorkflowCompleted({
          projectId: input.projectId,
          taskerStageId: input.stageId,
        }))
      ) {
        return {
          error: "Concept files are locked because this workflow stage is completed.",
        };
      }

      if (concept && isConceptBriefAttachment) {
        const tasker = await withPrismaRetry(() =>
          prisma.projectStage.findUnique({
            where: { id: input.stageId ?? "" },
            select: { actualStartedAt: true },
          }),
        );

        if (tasker?.actualStartedAt) {
          return { error: "Concept Brief attachments are locked after work starts." };
        }
      }
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "You do not have permission to upload to this concept.",
      };
    }
  }

  let stageSubmissionProjectCategory: string | null = null;

  if (input.assetType === AttachmentAssetType.REVISION_ORIGINAL) {
    if (!input.stageId) {
      return { error: "Stage uploads require a valid stage." };
    }

    const stageId = input.stageId;

    if (!input.revisionId) {
      try {
        const project = await assertProjectAccess(user, input.projectId, stageId);
        const stage = project.stages.find((item) => item.id === stageId);
        const concept = await assertConceptTaskerAccessIfNeeded(user, {
          projectId: input.projectId,
          stageId,
          mode: "work",
        });

        if (!concept || !stage?.isTasker) {
          return { error: "Stage uploads require a valid revision." };
        }

        assertProjectWorkflowPermission(
          user,
          project,
          getUploadPermissionKey(input.assetType),
          "Only the assigned concept executor can submit work for review.",
        );

        if (!stage.actualStartedAt) {
          return { error: "Please accept the brief before submitting work." };
        }

        if (stage.status === StageStatus.COMPLETED) {
          return { error: "This stage is already completed." };
        }

        if (isProjectStatusCompleted(project.status)) {
          return { error: "This project is already completed." };
        }

        if (project.archivedAt) {
          return { error: "This project has already been archived." };
        }

        stageSubmissionProjectCategory = project.category;
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Only the assigned concept executor can submit work for review.",
        };
      }
    } else {
    const revisionId = input.revisionId;

    const revision = await withPrismaRetry(() =>
      prisma.projectRevision.findFirst({
        where: {
          id: revisionId,
          projectId: input.projectId,
          stageId,
        },
        select: {
          id: true,
          stage: {
            select: {
              id: true,
              isTasker: true,
              conceptFolder: {
                select: { workflowStageKey: true },
              },
              actualStartedAt: true,
              status: true,
            },
          },
          project: {
            select: {
              category: true,
              ownerId: true,
              coOwners: { select: { userId: true } },
              executors: {
                select: {
                  userId: true,
                },
              },
              status: {
                select: projectStatusSelect,
              },
              archivedAt: true,
              workflowStages: {
                select: { stageKey: true, status: true },
              },
              collaborators: {
                where: {
                  userId: user.id,
                },
                select: projectCollaboratorPermissionSelect,
              },
            },
          },
        },
      }),
    );

    if (!revision) {
      return { error: "Revision not found." };
    }

    stageSubmissionProjectCategory = revision.project.category;

    try {
      await assertStageChatWriteAccess(user, {
        projectId: input.projectId,
        stage: {
          ...revision.stage,
          project: revision.project,
        },
        permissionKey: getUploadPermissionKey(input.assetType),
        permissionMessage:
          "Only a project executor can upload submissions for review.",
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Only a project executor can upload submissions for review.",
      };
    }

    const project = assertProjectAccessFromContext(user, revision.project);

    if (!hasProjectPermission(user, project, getUploadPermissionKey(input.assetType))) {
      return { error: "Only a project executor can submit work for review." };
    }

    if (!isProjectExecutorUser(revision.project, user.id)) {
      return { error: "Only a project executor can submit work for review." };
    }

    if (isProjectStatusCompleted(revision.project.status)) {
      return { error: "This project is already completed." };
    }

    if (revision.project.archivedAt) {
      return { error: "This project has already been archived." };
    }

    if (!revision.stage.actualStartedAt) {
      return { error: "Please accept the brief before submitting work." };
    }

    if (revision.stage.status === StageStatus.COMPLETED) {
      return { error: "This stage is already completed." };
    }
    }
  } else if (input.assetType === AttachmentAssetType.STAGE_INVOICE) {
    if (!input.stageId) {
      return { error: "Stage uploads require a valid stage." };
    }

    const stageId = input.stageId;

    const stage = await withPrismaRetry(() =>
      prisma.projectStage.findFirst({
        where: {
          id: stageId,
          projectId: input.projectId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          invoiceRequired: true,
          attachments: {
            where: {
              assetType: AttachmentAssetType.STAGE_INVOICE,
              status: AttachmentStatus.READY,
            },
            select: {
              id: true,
            },
            take: 1,
          },
          invoiceRequests: {
            select: {
              requestedFromId: true,
              fulfilledAt: true,
            },
            take: 1,
          },
          project: {
            select: {
              category: true,
              ownerId: true,
              coOwners: { select: { userId: true } },
              executors: {
                select: {
                  userId: true,
                },
              },
              status: {
                select: projectStatusSelect,
              },
              archivedAt: true,
              executionType: true,
              collaborators: {
                where: {
                  userId: user.id,
                },
                select: projectCollaboratorPermissionSelect,
              },
            },
          },
        },
      }),
    );

    if (!stage) {
      return { error: "Stage not found." };
    }

    assertProjectAccessFromContext(user, stage.project);
    const activeInvoiceRequest = stage.invoiceRequests[0] ?? null;
    const canUploadStageInvoice =
      activeInvoiceRequest?.fulfilledAt === null &&
      activeInvoiceRequest.requestedFromId === user.id;

    if (!canUploadStageInvoice) {
      return {
        error:
          "Only the requested invoice recipient can upload the invoice for this stage.",
      };
    }

    if (isProjectStatusCompleted(stage.project.status)) {
      return { error: "This project is already completed." };
    }

    if (stage.project.archivedAt) {
      return { error: "This project has already been archived." };
    }

    if (stage.status === StageStatus.COMPLETED) {
      return { error: "This stage is already completed." };
    }

    if (!isStageInvoiceRequired(stage.project, stage)) {
      return { error: "Invoice is not required for this stage." };
    }

    if (stage.attachments.length > 0) {
      return { error: "An invoice has already been uploaded for this stage." };
    }
  } else if (input.assetType === AttachmentAssetType.STAGE_SUBMISSION) {
    if (input.commentId) {
      return { error: "Use Submit Work to send files for review." };
    }

    if (!input.revisionId || !input.stageId) {
      return { error: "Use Submit Work to send files for review." };
    }

    const revisionId = input.revisionId;
    const stageId = input.stageId;

    const revision = await withPrismaRetry(() =>
      prisma.projectRevision.findFirst({
        where: {
          id: revisionId,
          projectId: input.projectId,
          stageId,
        },
        select: {
          id: true,
          stage: {
            select: {
              id: true,
              isTasker: true,
              conceptFolder: {
                select: { workflowStageKey: true },
              },
              actualStartedAt: true,
              status: true,
            },
          },
          project: {
            select: {
              category: true,
              ownerId: true,
              coOwners: { select: { userId: true } },
              executors: {
                select: {
                  userId: true,
                },
              },
              status: {
                select: projectStatusSelect,
              },
              archivedAt: true,
              workflowStages: {
                select: { stageKey: true, status: true },
              },
              collaborators: {
                where: {
                  userId: user.id,
                },
                select: projectCollaboratorPermissionSelect,
              },
            },
          },
        },
      }),
    );

    if (!revision) {
      return { error: "Revision not found." };
    }

    stageSubmissionProjectCategory = revision.project.category;

    try {
      await assertStageChatWriteAccess(user, {
        projectId: input.projectId,
        stage: {
          ...revision.stage,
          project: revision.project,
        },
        permissionKey: getUploadPermissionKey(input.assetType),
        permissionMessage:
          "Only a project executor can upload submissions for review.",
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Only a project executor can upload submissions for review.",
      };
    }

    const project = assertProjectAccessFromContext(user, revision.project);

    if (!hasProjectPermission(user, project, getUploadPermissionKey(input.assetType))) {
      return { error: "Only a project executor can upload submissions for review." };
    }

    if (!isProjectExecutorUser(revision.project, user.id)) {
      return { error: "Only a project executor can upload submissions for review." };
    }

    if (isProjectStatusCompleted(revision.project.status)) {
      return { error: "This project is already completed." };
    }

    if (!revision.stage.actualStartedAt) {
      return { error: "Please accept the brief before submitting work." };
    }

    if (revision.stage.status === StageStatus.COMPLETED) {
      return { error: "This stage is already completed." };
    }
  } else if (input.assetType === AttachmentAssetType.COMMENT_ATTACHMENT) {
    if (!input.commentId || !input.stageId) {
      return { error: "Chat uploads require a valid comment and stage." };
    }

    const commentId = input.commentId;
    const stageId = input.stageId;

    const comment = await withPrismaRetry(() =>
      prisma.projectComment.findFirst({
        where: {
          id: commentId,
          projectId: input.projectId,
          stageId,
        },
        select: {
          id: true,
          revisionId: true,
          stage: {
            select: {
              isTasker: true,
              conceptFolder: {
                select: { workflowStageKey: true },
              },
              actualStartedAt: true,
              status: true,
            },
          },
          project: {
            select: {
              ownerId: true,
              coOwners: { select: { userId: true } },
              executors: {
                select: {
                  userId: true,
                },
              },
              status: {
                select: projectStatusSelect,
              },
              archivedAt: true,
              workflowStages: {
                select: { stageKey: true, status: true },
              },
              collaborators: {
                where: {
                  userId: user.id,
                },
                select: projectCollaboratorPermissionSelect,
              },
            },
          },
        },
      }),
    );

    if (!comment) {
      return { error: "Comment not found." };
    }

    try {
      await assertStageChatWriteAccess(user, {
        projectId: input.projectId,
        stage: {
          id: stageId,
          isTasker: comment.stage.isTasker,
          conceptFolder: comment.stage.conceptFolder,
          actualStartedAt: comment.stage.actualStartedAt,
          status: comment.stage.status,
          project: comment.project,
        },
        permissionKey: getUploadPermissionKey(input.assetType),
        permissionMessage:
          "You do not have permission to upload chat attachments.",
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "You do not have permission to upload chat attachments.",
      };
    }

    if ((comment.revisionId ?? null) !== (input.revisionId ?? null)) {
      return { error: "Comment upload context is invalid." };
    }
  } else if (isProjectResearchFile) {
    if (!input.researchFolderId) {
      return { error: "Research uploads require a valid folder." };
    }

    try {
      await assertResearchFolderUploadAccess(user, {
        projectId: input.projectId,
        folderId: input.researchFolderId,
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "You do not have permission to upload to this folder.",
      };
    }
  } else {
    const project = await withPrismaRetry(() =>
      prisma.project.findUnique({
        where: {
          id: input.projectId,
        },
        select: {
          id: true,
          status: {
            select: projectStatusSelect,
          },
        },
      }),
    );

    if (!project) {
      return { error: "Project not found." };
    }

    const accessProject = await assertProjectAccess(user, input.projectId);

    const hasRequestScopedAccess =
      input.assetType === AttachmentAssetType.FILE_CHECKLIST_ATTACHMENT &&
      (await hasChecklistResponseUploadAccess(user, {
        requestId: input.checklistRequestId,
        projectId: input.projectId,
      }));

    if (
      !hasRequestScopedAccess &&
      !hasProjectPermission(user, accessProject, getUploadPermissionKey(input.assetType))
    ) {
      return { error: getUploadPermissionErrorMessage(input.assetType) };
    }

    if (input.stageFiveDirectSource) {
      const directSourceAccessError = getDirectStageFiveSourceAccessError(
        user,
        accessProject,
      );
      if (directSourceAccessError) {
        return { error: directSourceAccessError };
      }
    }

    if (
      input.assetType !== AttachmentAssetType.FINAL_ARCHIVE &&
      isProjectStatusCompleted(project.status)
    ) {
      return { error: "This project is already completed." };
    }
  }

  if (
    isFormalStageSubmission &&
    !isAllowedStageSubmissionFile({
      fileName: input.originalFileName,
      mimeType: input.mimeType,
      projectCategory: stageSubmissionProjectCategory,
    })
  ) {
    return buildFileTypeNotAllowedPayload({
      fileName: input.originalFileName,
      mimeType: input.mimeType,
      allowedExtensions: getStageSubmissionAllowedExtensions(
        stageSubmissionProjectCategory,
      ),
      error: "Formal stage submissions must use a supported file format.",
    });
  }

  const tagSelection = await validateActiveAssetTagIds(input.assetTagIds ?? []);

  if (tagSelection.error) {
    return { error: tagSelection.error };
  }

  const uniqueFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFileName(
    input.originalFileName,
  )}`;
  const storageKey = buildProjectAssetKey({
    projectId: input.projectId,
    stageId: input.stageId,
    revisionId: input.revisionId,
    commentId: input.commentId,
    researchFolderId: input.researchFolderId,
    assetType: input.assetType,
    safeFileName: uniqueFileName,
  });

  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.create({
      data: {
        projectId: input.projectId,
        stageId: input.stageId ?? null,
        revisionId: input.revisionId ?? null,
        commentId: input.commentId ?? null,
        uploadedById: user.id,
        fileName: uniqueFileName,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        bucket: getS3BucketName(),
        storageKey,
        assetType: input.assetType,
        checklistResponseRequestId: input.checklistRequestId ?? null,
        status: AttachmentStatus.UPLOADING,
        submissionReviewStatus:
          input.assetType === AttachmentAssetType.STAGE_SUBMISSION
            ? SubmissionReviewStatus.PENDING_REVIEW
            : null,
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
        assetTags:
          tagSelection.tagIds.length > 0
            ? {
                create: tagSelection.tagIds.map((tagId) => ({
                  tag: {
                    connect: {
                      id: tagId,
                    },
                  },
                })),
              }
            : undefined,
      },
      select: {
        id: true,
        fileName: true,
        storageKey: true,
      },
    }),
  );

  const uploadEndpointMode =
    input.uploadEndpointMode ?? getDefaultS3UploadEndpointMode();
  const uploadTarget = await createPresignedUploadTarget({
    storageKey: attachment.storageKey,
    mimeType: input.mimeType,
    endpointMode: uploadEndpointMode,
  });

  return {
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    uploadUrl: uploadTarget.uploadUrl,
    uploadHost: uploadTarget.uploadHost,
    uploadEndpointMode: uploadTarget.endpointMode,
    uploadRegion: uploadTarget.region,
    uploadExpiresInSeconds: uploadTarget.expiresInSeconds,
    uploadExpectedHeaders: uploadTarget.expectedHeaders,
    storageKey: attachment.storageKey,
  };
}

async function completeDirectStageFiveSourceUpload(
  user: AccessUser,
  input: { attachmentId: string; failed: boolean; notify: boolean },
) {
  const result = await withPrismaRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const attachment = await tx.projectAttachment.findUnique({
          where: { id: input.attachmentId },
          select: {
            id: true,
            projectId: true,
            stageId: true,
            revisionId: true,
            commentId: true,
            uploadedById: true,
            assetType: true,
            status: true,
            originalFileName: true,
            storageKey: true,
            project: {
              select: {
                ownerId: true,
                coOwners: { select: { userId: true } },
                collaborators: {
                  where: { userId: user.id },
                  select: projectCollaboratorPermissionSelect,
                },
                status: { select: projectStatusSelect },
                archivedAt: true,
                workflowStages: {
                  select: { stageKey: true, status: true },
                },
              },
            },
          },
        });

        if (
          !attachment ||
          attachment.uploadedById !== user.id ||
          attachment.assetType !== AttachmentAssetType.GENERAL_PROJECT_ASSET ||
          attachment.stageId ||
          attachment.revisionId ||
          attachment.commentId
        ) {
          throw new Error("The direct Stage 5 upload is invalid.");
        }

        const accessError = getDirectStageFiveSourceAccessError(
          user,
          attachment.project,
        );

        const existingHandoff = await tx.projectStageFileHandoff.findUnique({
          where: {
            projectId_sourceAttachmentId_targetWorkflowStageKey: {
              projectId: attachment.projectId,
              sourceAttachmentId: attachment.id,
              targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
            },
          },
          select: {
            id: true,
            projectId: true,
            sourceAttachmentId: true,
            sourceWorkflowStageKey: true,
            targetWorkflowStageKey: true,
            checklist: {
              select: {
                id: true,
                projectId: true,
                sourceAttachmentId: true,
              },
            },
          },
        });

        if (input.failed) {
          if (existingHandoff?.checklist) {
            return {
              projectId: attachment.projectId,
              handoffId: existingHandoff.id,
              checklistId: existingHandoff.checklist.id,
              created: false,
              failed: false,
            } as const;
          }

          await tx.projectAttachment.updateMany({
            where: {
              id: attachment.id,
              status: AttachmentStatus.UPLOADING,
            },
            data: { status: AttachmentStatus.FAILED },
          });
          return {
            projectId: attachment.projectId,
            handoffId: null,
            checklistId: null,
            created: false,
            failed: true,
          } as const;
        }

        if (accessError) {
          throw new Error(accessError);
        }

        if (
          attachment.status !== AttachmentStatus.UPLOADING &&
          attachment.status !== AttachmentStatus.READY
        ) {
          throw new Error("Attachment cannot be completed.");
        }

        if (existingHandoff) {
          if (
            existingHandoff.projectId !== attachment.projectId ||
            existingHandoff.sourceAttachmentId !== attachment.id ||
            existingHandoff.sourceWorkflowStageKey !==
              ProjectWorkflowStageKey.FINAL_LAYOUT ||
            existingHandoff.targetWorkflowStageKey !==
              ProjectWorkflowStageKey.FINAL_LAYOUT ||
            !existingHandoff.checklist ||
            existingHandoff.checklist.projectId !== attachment.projectId ||
            existingHandoff.checklist.sourceAttachmentId !== attachment.id
          ) {
            throw new Error(
              "The existing Stage 5 source lineage conflicts with this upload.",
            );
          }

          return {
            projectId: attachment.projectId,
            handoffId: existingHandoff.id,
            checklistId: existingHandoff.checklist.id,
            created: false,
            failed: false,
          } as const;
        }

        const wasUploading = attachment.status === AttachmentStatus.UPLOADING;
        if (wasUploading) {
          const finalized = await tx.projectAttachment.updateMany({
            where: {
              id: attachment.id,
              status: AttachmentStatus.UPLOADING,
            },
            data: { status: AttachmentStatus.READY },
          });
          if (finalized.count !== 1) {
            throw new Error("The Stage 5 source upload changed before completion.");
          }
        }

        const handoff = await tx.projectStageFileHandoff.upsert({
          where: {
            projectId_sourceAttachmentId_targetWorkflowStageKey: {
              projectId: attachment.projectId,
              sourceAttachmentId: attachment.id,
              targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
            },
          },
          update: {},
          create: {
            projectId: attachment.projectId,
            sourceWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
            sourceAttachmentId: attachment.id,
            targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
            handedOffById: user.id,
          },
          select: { id: true, sourceWorkflowStageKey: true },
        });
        if (
          handoff.sourceWorkflowStageKey !==
          ProjectWorkflowStageKey.FINAL_LAYOUT
        ) {
          throw new Error(
            "The existing Stage 5 source lineage conflicts with this upload.",
          );
        }
        const checklist = await tx.projectFileChecklist.upsert({
          where: { handoffId: handoff.id },
          update: {},
          create: {
            projectId: attachment.projectId,
            handoffId: handoff.id,
            sourceAttachmentId: attachment.id,
          },
          select: {
            id: true,
            projectId: true,
            sourceAttachmentId: true,
          },
        });
        if (
          checklist.projectId !== attachment.projectId ||
          checklist.sourceAttachmentId !== attachment.id
        ) {
          throw new Error(
            "The existing Stage 5 checklist conflicts with this upload.",
          );
        }

        if (wasUploading) {
          await tx.projectActivityLog.create({
            data: {
              projectId: attachment.projectId,
              actorId: user.id,
              action: ActivityLogAction.ASSET_UPLOADED,
              metadata: {
                attachmentId: attachment.id,
                fileName: attachment.originalFileName,
                storageKey: attachment.storageKey,
                source: "stage_five_direct_upload",
                handoffId: handoff.id,
                checklistId: checklist.id,
              },
            },
          });
        }

        return {
          projectId: attachment.projectId,
          handoffId: handoff.id,
          checklistId: checklist.id,
          created: true,
          failed: false,
        } as const;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      },
    ),
  );

  if (result.created && input.notify) {
    runNotificationTaskAfterResponse("file-uploaded", () =>
      notifyFileUploaded({
        actorId: user.id,
        actorName: getDisplayName(user),
        projectId: result.projectId,
        stageId: null,
        attachmentId: input.attachmentId,
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
      }),
    );
  }

  return result;
}

export async function completeAttachmentUpload(
  user: AccessUser,
  attachmentId: string,
  failed = false,
  uploadMetadata?: LibraryUploadMetadata,
  options?: {
    researchFolderId?: string;
    checklistRequestId?: string;
    stageFiveDirectSource?: boolean;
    /** Integration-only escape hatch for service calls outside a Next request. */
    suppressUploadNotification?: boolean;
  },
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: attachmentId,
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        revisionId: true,
        commentId: true,
        uploadedById: true,
        assetType: true,
        checklistResponseRequestId: true,
        status: true,
        submissionReviewStatus: true,
        bucket: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
            executors: {
              select: {
                userId: true,
              },
            },
            collaborators: {
              where: {
                userId: user.id,
              },
              select: projectCollaboratorPermissionSelect,
            },
            status: {
              select: projectStatusSelect,
            },
            archivedAt: true,
            executionType: true,
            workflowStages: {
              select: {
                stageKey: true,
                status: true,
              },
            },
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
            status: true,
            invoiceRequired: true,
          },
        },
      },
    }),
  );

  if (!attachment) {
    throw new Error("Attachment not found.");
  }

  if (attachment.stageId) {
    const isConceptBriefAttachment =
      attachment.assetType === AttachmentAssetType.GENERAL_PROJECT_ASSET &&
      !attachment.revisionId &&
      !attachment.commentId;
    const concept = await assertConceptTaskerAccessIfNeeded(user, {
      projectId: attachment.projectId,
      stageId: attachment.stageId,
      mode: isConceptBriefAttachment
        ? "manage"
        : attachment.assetType === AttachmentAssetType.REVISION_ORIGINAL
          ? "work"
          : "view",
    });

    if (concept && attachment.stage?.status === StageStatus.COMPLETED &&
      attachment.status !== AttachmentStatus.READY &&
      (attachment.assetType === AttachmentAssetType.REVISION_ORIGINAL || attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION)) {
      throw new Error("This task is already completed.");
    }

    if (
      concept &&
      isConceptBriefAttachment &&
      (await isConceptWorkflowCompleted({
        projectId: attachment.projectId,
        taskerStageId: attachment.stageId,
      }))
    ) {
      throw new Error(
        "Concept files are locked because this workflow stage is completed.",
      );
    }

    if (concept && isConceptBriefAttachment) {
      const tasker = await withPrismaRetry(() =>
        prisma.projectStage.findUnique({
          where: { id: attachment.stageId ?? "" },
          select: { actualStartedAt: true },
        }),
      );
      if (tasker?.actualStartedAt) {
        throw new Error("Concept Brief attachments are locked after work starts.");
      }
    }
  }

  const project = assertProjectAccessFromContext(user, attachment.project);

  const isProjectResearchFile =
    attachment.assetType === AttachmentAssetType.PROJECT_RESEARCH_FILE;

  if (attachment.assetType === AttachmentAssetType.PROJECT_PRIVATE_FILE) {
    throw new Error("Use the private folder completion endpoint.");
  }

  if (isProjectResearchFile) {
    if (!options?.researchFolderId) {
      throw new Error("Research uploads must be completed from their folder.");
    }
    if (attachment.uploadedById !== user.id) {
      throw new Error("Only the uploader can complete this research file upload.");
    }
    await assertResearchFolderUploadAccess(user, {
      projectId: attachment.projectId,
      folderId: options.researchFolderId,
    });
    const expectedStoragePrefix = `projects/${attachment.projectId}/research/${options.researchFolderId}/`;
    if (!attachment.storageKey.startsWith(expectedStoragePrefix)) {
      throw new Error("Research upload context is invalid.");
    }

    if (attachment.status === AttachmentStatus.READY) {
      const association = await withPrismaRetry(() =>
        prisma.projectResearchFolderFile.findUnique({
          where: { attachmentId: attachment.id },
          select: { folderId: true },
        }),
      );
      if (association?.folderId !== options.researchFolderId) {
        throw new Error("Research upload context is invalid.");
      }
      return {
        projectId: attachment.projectId,
        stageId: attachment.stageId,
        assetType: attachment.assetType,
        invoiceCommentId: null,
      };
    }

    if (attachment.status !== AttachmentStatus.UPLOADING) {
      throw new Error("Attachment cannot be completed.");
    }
  }

  const hasRequestScopedAccess =
    attachment.assetType === AttachmentAssetType.FILE_CHECKLIST_ATTACHMENT &&
    attachment.uploadedById === user.id &&
    attachment.checklistResponseRequestId === options?.checklistRequestId &&
    (await hasChecklistResponseUploadAccess(user, {
      requestId: options?.checklistRequestId,
      projectId: attachment.projectId,
    }));

  if (
    !isProjectResearchFile &&
    attachment.assetType !== AttachmentAssetType.STAGE_INVOICE &&
    !hasRequestScopedAccess &&
    !hasProjectPermission(user, project, getUploadPermissionKey(attachment.assetType))
  ) {
    throw new Error("You do not have permission to complete this upload.");
  }

  if (options?.stageFiveDirectSource) {
    if (
      attachment.uploadedById !== user.id ||
      attachment.assetType !== AttachmentAssetType.GENERAL_PROJECT_ASSET ||
      attachment.stageId ||
      attachment.revisionId ||
      attachment.commentId
    ) {
      throw new Error("The direct Stage 5 upload is invalid.");
    }
    if (!isGlobalProjectAdministrator(user)) {
      throw new Error(
        "You do not have permission to upload a Stage 5 final file.",
      );
    }

    const directSource = await completeDirectStageFiveSourceUpload(user, {
      attachmentId: attachment.id,
      failed,
      notify: options.suppressUploadNotification !== true,
    });
    return {
      projectId: attachment.projectId,
      stageId: null,
      assetType: attachment.assetType,
      invoiceCommentId: null,
      stageFiveSource: directSource.failed
        ? null
        : {
            handoffId: directSource.handoffId!,
            checklistId: directSource.checklistId!,
          },
    };
  }

  if (
    attachment.assetType === AttachmentAssetType.SAMPLE_ROUND_EVIDENCE &&
    (attachment.uploadedById !== user.id ||
      !(await hasStageSevenEvidenceUploadAccess(user, attachment.projectId)))
  ) {
    throw new Error("Only the Stage 7 evidence uploader can complete this upload.");
  }

  if (attachment.assetType === AttachmentAssetType.STAGE_INVOICE) {
    if (attachment.uploadedById !== user.id) {
      throw new Error("Only the invoice uploader can complete this upload.");
    }

    if (!attachment.stageId || !attachment.stage) {
      throw new Error("Stage not found.");
    }

    if (isProjectStatusCompleted(attachment.project.status)) {
      throw new Error("This project is already completed.");
    }

    if (attachment.project.archivedAt) {
      throw new Error("This project has already been archived.");
    }

    if (attachment.stage.status === StageStatus.COMPLETED) {
      throw new Error("This stage is already completed.");
    }

    if (!isStageInvoiceRequired(attachment.project, attachment.stage)) {
      throw new Error("Invoice is not required for this stage.");
    }

    const activeInvoiceRequest = await withPrismaRetry(() =>
      prisma.stageInvoiceRequest.findUnique({
        where: {
          stageId: attachment.stageId ?? attachment.stage?.id ?? "",
        },
        select: {
          requestedFromId: true,
          fulfilledAt: true,
        },
      }),
    );

    if (
      !activeInvoiceRequest ||
      activeInvoiceRequest.fulfilledAt ||
      activeInvoiceRequest.requestedFromId !== user.id
    ) {
      throw new Error(
        "Only the requested invoice recipient can upload the invoice for this stage.",
      );
    }

    const existingReadyInvoice = await withPrismaRetry(() =>
      prisma.projectAttachment.findFirst({
        where: {
          id: {
            not: attachment.id,
          },
          projectId: attachment.projectId,
          stageId: attachment.stageId,
          assetType: AttachmentAssetType.STAGE_INVOICE,
          status: AttachmentStatus.READY,
        },
        select: {
          id: true,
        },
      }),
    );

    if (existingReadyInvoice) {
      throw new Error("An invoice has already been uploaded for this stage.");
    }
  }

  if (failed) {
    await withPrismaRetry(() =>
      prisma.projectAttachment.update({
        where: {
          id: attachment.id,
        },
        data: {
          status: AttachmentStatus.FAILED,
        },
      }),
    );

    return;
  }

  const transactionResults = await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectAttachment.update({
        where: {
          id: attachment.id,
        },
        data: {
          status: AttachmentStatus.READY,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
          submissionReviewStatus:
            attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION
              ? attachment.submissionReviewStatus ?? SubmissionReviewStatus.PENDING_REVIEW
              : undefined,
        },
      }),
      ...(!isProjectResearchFile
        ? [
            prisma.projectActivityLog.create({
              data: {
                projectId: attachment.projectId,
                stageId: attachment.stageId,
                revisionId: attachment.revisionId,
                actorId: user.id,
                action: getUploadAction(attachment.assetType),
                metadata: {
                  attachmentId: attachment.id,
                  commentId: attachment.commentId,
                  fileName: attachment.originalFileName,
                  storageKey: attachment.storageKey,
                  ...(uploadMetadata?.source ? { source: uploadMetadata.source } : {}),
                  ...(uploadMetadata?.category ? { category: uploadMetadata.category } : {}),
                  ...(uploadMetadata?.note ? { note: uploadMetadata.note } : {}),
                },
              },
            }),
          ]
        : []),
      ...(isProjectResearchFile && options?.researchFolderId
        ? [
            prisma.projectResearchFolderFile.create({
              data: {
                folderId: options.researchFolderId,
                attachmentId: attachment.id,
                addedById: user.id,
              },
            }),
          ]
        : []),
      ...(attachment.assetType === AttachmentAssetType.STAGE_INVOICE && attachment.stage
        ? [
            prisma.stageInvoiceRequest.updateMany({
              where: {
                projectId: attachment.projectId,
                stageId: attachment.stageId ?? attachment.stage.id,
                fulfilledAt: null,
              },
              data: {
                fulfilledAt: new Date(),
              },
            }),
            prisma.projectComment.create({
              data: {
                projectId: attachment.projectId,
                stageId: attachment.stageId ?? attachment.stage.id,
                authorId: user.id,
                body: `${getDisplayName(user)} uploaded invoice for ${attachment.stage.name}.`,
              },
            }),
          ]
        : []),
    ]),
  );
  const invoiceComment =
    attachment.assetType === AttachmentAssetType.STAGE_INVOICE && attachment.stage
      ? (transactionResults[3] as { id: string } | undefined)
      : null;

  if (!isProjectResearchFile) {
    runNotificationTaskAfterResponse("file-uploaded", () =>
      notifyFileUploaded({
        actorId: user.id,
        actorName: getDisplayName(user),
        projectId: attachment.projectId,
        stageId: attachment.stageId,
        attachmentId: attachment.id,
        assetType: attachment.assetType,
      }),
    );
  }

  if (attachment.assetType === AttachmentAssetType.STAGE_INVOICE) {
    runNotificationTaskAfterResponse("invoice-uploaded", () =>
      notifyInvoiceUploaded({
        actorId: user.id,
        actorName: getDisplayName(user),
        projectId: attachment.projectId,
        stageId: attachment.stageId,
        attachmentId: attachment.id,
      }),
    );
  }

  return {
    projectId: attachment.projectId,
    stageId: attachment.stageId,
    assetType: attachment.assetType,
    invoiceCommentId: invoiceComment?.id ?? null,
  };
}

export async function completePreparedChatAttachmentUpload(
  user: AccessUser,
  input: {
    attachmentId: string;
    projectId: string;
    failed?: boolean;
  },
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        id: input.attachmentId,
        projectId: input.projectId,
        uploadedById: user.id,
        assetType: {
          in: [
            AttachmentAssetType.COMMENT_ATTACHMENT,
            AttachmentAssetType.STAGE_SUBMISSION,
          ],
        },
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        revisionId: true,
        commentId: true,
        assetType: true,
        status: true,
        submissionReviewStatus: true,
        originalFileName: true,
        storageKey: true,
        stage: {
          select: {
            id: true,
            isTasker: true,
            conceptFolder: {
              select: { workflowStageKey: true },
            },
            actualStartedAt: true,
            status: true,
            project: {
              select: {
                ownerId: true,
                coOwners: { select: { userId: true } },
                executors: {
                  where: {
                    userId: user.id,
                  },
                  select: {
                    userId: true,
                  },
                },
                status: {
                  select: projectStatusSelect,
                },
                archivedAt: true,
                workflowStages: {
                  select: { stageKey: true, status: true },
                },
                collaborators: {
                  where: {
                    userId: user.id,
                  },
                  select: projectCollaboratorPermissionSelect,
                },
              },
            },
          },
        },
      },
    }),
  );

  if (!attachment) {
    throw new Error("Attachment not found.");
  }

  if (attachment.status === AttachmentStatus.READY) {
    return;
  }

  if (attachment.status !== AttachmentStatus.UPLOADING) {
    throw new Error("Attachment cannot be completed.");
  }

  if (input.failed) {
    await withPrismaRetry(() =>
      prisma.projectAttachment.update({
        where: {
          id: attachment.id,
        },
        data: {
          status: AttachmentStatus.FAILED,
        },
      }),
    );

    return;
  }

  if (!attachment.stage) {
    throw new Error("Stage not found.");
  }

  await assertStageChatWriteAccess(user, {
    projectId: attachment.projectId,
    stage: attachment.stage,
    permissionKey:
      attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION
        ? "file.uploadSubmission"
        : "chat.uploadAttachment",
    permissionMessage:
      attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION
        ? "Only a project executor can upload submissions for review."
        : "You do not have permission to upload chat attachments.",
  });

  if (
    attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION &&
    !isProjectExecutorUser(attachment.stage.project, user.id)
  ) {
    throw new Error("Only a project executor can upload submissions for review.");
  }

  await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectAttachment.update({
        where: {
          id: attachment.id,
        },
        data: {
          status: AttachmentStatus.READY,
          submissionReviewStatus:
            attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION
              ? attachment.submissionReviewStatus ?? SubmissionReviewStatus.PENDING_REVIEW
              : undefined,
        },
      }),
      prisma.projectActivityLog.create({
        data: {
          projectId: attachment.projectId,
          stageId: attachment.stageId,
          revisionId: attachment.revisionId,
          actorId: user.id,
          action: getUploadAction(attachment.assetType),
          metadata: {
            attachmentId: attachment.id,
            commentId: attachment.commentId,
            fileName: attachment.originalFileName,
            storageKey: attachment.storageKey,
          },
        },
      }),
    ]),
  );

  runNotificationTaskAfterResponse("file-uploaded", () =>
    notifyFileUploaded({
      actorId: user.id,
      actorName: getDisplayName(user),
      projectId: attachment.projectId,
      stageId: attachment.stageId,
      attachmentId: attachment.id,
      assetType: attachment.assetType,
    }),
  );
}

export async function getAttachmentDownloadUrlForUser(
  user: AccessUser,
  attachmentId: string,
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: attachmentId,
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        bucket: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        status: true,
        assetType: true,
        createdAt: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
          },
        },
      },
    }),
  );

  if (!attachment || attachment.status !== AttachmentStatus.READY) {
    throw new Error("Attachment not found.");
  }

  if (attachment.assetType === AttachmentAssetType.PROJECT_RESEARCH_FILE) {
    await assertProjectResearchFileAccess(user, attachment.id, "read");

    return createPresignedDownloadUrl({
      bucket: attachment.bucket,
      storageKey: attachment.storageKey,
      fileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
    });
  }

  if (attachment.assetType === AttachmentAssetType.PROJECT_PRIVATE_FILE) {
    await assertProjectPrivateAttachmentAccess(user, attachment.id);

    return createPresignedDownloadUrl({
      bucket: attachment.bucket,
      storageKey: attachment.storageKey,
      fileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
    });
  }

  const project = await assertProjectAccess(user, attachment.projectId);
  assertProjectWorkflowPermission(
    user,
    project,
    "file.download",
    "You do not have permission to download this file.",
  );
  await assertProjectAttachmentVisibilityForUser(user, attachment);

  return createPresignedDownloadUrl({
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
  });
}

export async function getAttachmentPreviewUrlForUser(
  user: AccessUser,
  attachmentId: string,
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: attachmentId,
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        revisionId: true,
        commentId: true,
        bucket: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        status: true,
        assetType: true,
        createdAt: true,
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
          },
        },
      },
    }),
  );

  if (!attachment || attachment.status !== AttachmentStatus.READY) {
    throw new Error("Attachment not found.");
  }

  if (attachment.assetType === AttachmentAssetType.PROJECT_RESEARCH_FILE) {
    await assertProjectResearchFileAccess(user, attachment.id, "read");

    return createPresignedPreviewUrl({
      bucket: attachment.bucket,
      storageKey: attachment.storageKey,
      fileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
    });
  }

  if (attachment.assetType === AttachmentAssetType.PROJECT_PRIVATE_FILE) {
    await assertProjectPrivateAttachmentAccess(user, attachment.id);

    return createPresignedPreviewUrl({
      bucket: attachment.bucket,
      storageKey: attachment.storageKey,
      fileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
    });
  }

  const project = await assertProjectAccess(user, attachment.projectId);
  assertProjectWorkflowPermission(
    user,
    project,
    "file.view",
    "You do not have permission to preview this file.",
  );
  await assertProjectAttachmentVisibilityForUser(user, attachment);

  return createPresignedPreviewUrl({
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
  });
}

export async function deleteAttachmentForUser(
  user: AccessUser,
  attachmentId: string,
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: attachmentId,
      },
      select: {
        id: true,
        projectId: true,
        stageId: true,
        revisionId: true,
        commentId: true,
        bucket: true,
        storageKey: true,
        status: true,
        assetType: true,
        createdAt: true,
        approvedConceptFolder: { select: { id: true } },
        conceptStartingReference: { select: { id: true } },
        stageFileHandoffs: { select: { id: true }, take: 1 },
        sourceProductionUnits: { select: { id: true }, take: 1 },
        productionUnitFile: { select: { id: true } },
        fileChecklistItems: {
          select: {
            checklistItem: {
              select: {
                checklist: {
                  select: {
                    productionUnit: { select: { status: true } },
                  },
                },
              },
            },
          },
        },
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
          },
        },
      },
    }),
  );

  if (!attachment || attachment.status === AttachmentStatus.DELETED) {
    throw new Error("Attachment not found.");
  }

  if (attachment.assetType === AttachmentAssetType.PROJECT_RESEARCH_FILE) {
    await assertProjectResearchFileAccess(user, attachment.id, "write");

    await deleteObjectIfNeeded(attachment.storageKey, attachment.bucket).catch(
      () => undefined,
    );
    await withPrismaRetry(() =>
      prisma.$transaction([
        prisma.projectResearchFolderFile.deleteMany({
          where: { attachmentId: attachment.id },
        }),
        prisma.projectAttachment.update({
          where: { id: attachment.id },
          data: { status: AttachmentStatus.DELETED },
        }),
      ]),
    );
    return;
  }

  if (attachment.assetType === AttachmentAssetType.PROJECT_PRIVATE_FILE) {
    await assertProjectPrivateAttachmentAccess(user, attachment.id);

    await deleteObjectIfNeeded(attachment.storageKey, attachment.bucket).catch(
      () => undefined,
    );
    await withPrismaRetry(() =>
      prisma.projectAttachment.update({
        where: { id: attachment.id },
        data: { status: AttachmentStatus.DELETED },
      }),
    );
    return;
  }

  const project = await assertProjectAccess(user, attachment.projectId);
  assertProjectWorkflowPermission(
    user,
    project,
    "file.delete",
    "You do not have permission to delete this file.",
  );
  await assertProjectAttachmentVisibilityForUser(user, attachment);

  if (attachment.approvedConceptFolder || attachment.conceptStartingReference) {
    throw new Error(
      "This file is locked because it is an Approved Concept or a Stage 4 starting reference.",
    );
  }

  if (attachment.stageFileHandoffs.length > 0) {
    throw new Error(
      "This file is locked because it is the source of a Stage 5 checklist.",
    );
  }

  if (attachment.sourceProductionUnits.length > 0) {
    throw new Error(
      "This file is locked because it is the source of a Stage 6 Production Unit.",
    );
  }

  if (attachment.productionUnitFile) {
    throw new Error(
      "Remove this file from its Stage 6 Production Unit before deleting it.",
    );
  }

  if (
    attachment.fileChecklistItems.some(({ checklistItem }) => {
      const status = checklistItem.checklist.productionUnit?.status;
      return status && status !== "PREPARATION";
    })
  ) {
    throw new Error(
      "This checklist file is locked because its Stage 6 approval workflow has started.",
    );
  }

  if (
    attachment.stageId &&
    attachment.assetType === AttachmentAssetType.GENERAL_PROJECT_ASSET &&
    !attachment.revisionId &&
    !attachment.commentId
  ) {
    const concept = await assertConceptTaskerAccessIfNeeded(user, {
      projectId: attachment.projectId,
      stageId: attachment.stageId,
      mode: "manage",
    });
    if (concept) {
      if (
        await isConceptWorkflowCompleted({
          projectId: attachment.projectId,
          taskerStageId: attachment.stageId,
        })
      ) {
        throw new Error(
          "Concept files are locked because this workflow stage is completed.",
        );
      }

      const tasker = await withPrismaRetry(() =>
        prisma.projectStage.findUnique({
          where: { id: attachment.stageId ?? "" },
          select: { actualStartedAt: true },
        }),
      );
      if (tasker?.actualStartedAt) {
        throw new Error("Concept Brief attachments are locked after work starts.");
      }
    }
  }

  await deleteObjectIfNeeded(attachment.storageKey, attachment.bucket).catch(() => undefined);

  await withPrismaRetry(() =>
    prisma.projectAttachment.update({
      where: {
        id: attachment.id,
      },
      data: {
        status: AttachmentStatus.DELETED,
      },
    }),
  );
}

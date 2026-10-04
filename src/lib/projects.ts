import { canManageProjectStages } from "./project-templates";
import type { StageInstanceView } from "./project-template-definitions";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  AttachmentStatus,
  AttachmentAssetType,
  Prisma,
  ProjectExecutionType,
  ProjectRevisionStatus,
  StageStatus,
  SubmissionReviewStatus,
  UserRole,
} from "@prisma/client";
import type {
  Project,
  ProjectCollaborator,
  ProjectExecutor,
  ProjectWorkflowStage,
  ProjectTag,
  ProjectStage,
  User,
} from "@prisma/client";

import {
  compareProjectsByPriority,
  DEFAULT_PROJECT_PRIORITY,
  formatProjectPriority,
} from "@/lib/project-priority";
import {
  DEFAULT_PROJECT_CURRENCY,
  resolveProjectCurrency,
} from "@/lib/project-currencies";
import {
  canBypassCollaboratorVisibility,
  getProjectCollaboratorVisibilityState,
  isTimestampHiddenByPauseWindows,
} from "@/lib/project-collaborator-visibility";
import {
  normalizeProjectCollaboratorPermissions,
  pickProjectCollaboratorPermissions,
  projectCollaboratorPermissionSelect,
  type ProjectCollaboratorPermissions,
} from "@/lib/project-collaborator-permissions";
import { getFavoriteAttachmentIdSetForUser } from "@/lib/file-favorite-queries";
import {
  canUseProjects,
  canViewProjectTypeSwitcher,
  getAccessibleProjectsWhere,
  hasPermission,
  hasProjectPermission,
  isProjectAdmin,
  isProjectExecutor,
  isProjectOwner,
  type ProjectPermissionContext,
  type PermissionUser,
} from "@/lib/permissions/resolver";
import {
  buildProjectListStageWhere,
  buildProjectListStatusWhere,
  deriveProjectListWorkflowState,
  type ProjectListRole,
  type ProjectListStatus,
} from "@/lib/project-list-workflow";
import type { PermissionKey } from "@/lib/permissions/definitions";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import {
  getProjectStageAccessRecordById,
  type ProjectStageAccessRecord,
} from "@/lib/project-stage-data";
import { ensureProjectPrivateFolder } from "@/lib/project-private-folders";
import { canViewProjectConcept } from "@/lib/project-concept-access";
import {
  defaultProjectStatusGroupSlugs,
  getProjectStatusDisplay,
  isProjectStatusCompleted,
} from "@/lib/project-statuses";

export const PROJECTS_CACHE_TAG = "projects";
export const INTERNAL_EXECUTION_NOT_REQUIRED_LABEL =
  "Not required for internal execution";
export const PROJECT_BUDGET_NOT_REQUIRED_LABEL = "No budget required";
export const PROJECT_BUDGET_REQUIRED_NOT_SET_LABEL = "Budget required - not set";
export const MAX_PROJECT_TAGS = 5;
const PROJECT_LIST_PAGE_SIZE = 20;

export type ProjectAccessUser = PermissionUser;
type ProjectStageWithStarter = ProjectStage & {
  startedBy?: Pick<User, "name" | "email"> | null;
  _count?: {
    revisions: number;
    comparisonComments: number;
  };
  invoiceRequests?: Array<{
    id: string;
    requestedById: string;
    requestedFromId: string;
    note: string | null;
    fulfilledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    requestedBy: Pick<User, "name" | "email">;
    requestedFrom: Pick<User, "name" | "email">;
  }>;
};

const projectStatusGroupSelect = {
  id: true,
  name: true,
  slug: true,
  color: true,
  isActive: true,
} as const;

type ProjectStatusGroupRelation = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  isActive?: boolean;
} | null;

type ProjectStatusRelation = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  group: ProjectStatusGroupRelation;
  isActive?: boolean;
} | null;

type ProjectWithCreator = Project & {
  createdBy: Pick<User, "name" | "email">;
  owner?: Pick<User, "id" | "name" | "email"> | null;
  coOwners?: Array<{
    userId: string;
    user: Pick<User, "id" | "name" | "email">;
  }>;
  workflowStages?: ProjectWorkflowStage[];
  status: ProjectStatusRelation;
  tags?: Array<{
    tag: Pick<ProjectTag, "id" | "name" | "color">;
  }>;
  executors?: Array<
    ProjectExecutor & {
      user: Pick<User, "id" | "name" | "email">;
    }
  >;
  stages: ProjectStageWithStarter[];
  collaborators?: Array<
    ProjectCollaborator & {
      user: Pick<User, "id" | "name" | "email">;
    }
  >;
  attachments: Array<{
    id: string;
    stageId: string | null;
    revisionId: string | null;
    commentId: string | null;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus?: SubmissionReviewStatus | null;
    createdAt: Date;
    uploadedBy: Pick<User, "name" | "email">;
  }>;
};

type ProjectCardProject = Pick<
  Project,
  | "id"
  | "name"
  | "updatedAt"
  | "completedAt"
  | "ownerId"
  | "isPinned"
  | "priority"
> & {
  owner: Pick<User, "id" | "name" | "email"> | null;
  stageInstances?: Array<{ order: number; name: string; status: ProjectWorkflowStage["status"] }>;
  closure: { id: string } | null;
  workflowStages: Array<
    Pick<ProjectWorkflowStage, "stageKey" | "status">
  >;
  coOwners?: Array<{ userId: string }>;
  executors: Array<{
    userId: string;
    user: Pick<User, "id" | "name" | "email">;
  }>;
  collaborators?: Array<Pick<ProjectCollaborator, "userId">>;
};

export type ProjectCardRecord = {
  id: string;
  title: string;
  businessStatus: "ACTIVE" | "COMPLETED" | null;
  statusLabel: "Active" | "Completed" | null;
  workflowHealth: "VALID" | "MISSING" | "INVALID";
  workflowDiagnosticLabel: "Workflow Missing" | "Legacy Project" | null;
  showWorkflowDiagnostic: boolean;
  currentStageNumber: number | null;
  currentStageName: string | null;
  stageStatuses: ProjectWorkflowStage["status"][];
  owner: ProjectListUserFilterOption | null;
  executors: ProjectListUserFilterOption[];
  updatedLabel: string;
  updatedAt: string;
  isPinned: boolean;
  canPin: boolean;
  canDelete: boolean;
  canEdit: boolean;
};

export type ProjectStageVisualStatus =
  | "completed"
  | "in-progress"
  | "pending"
  | "on-hold";

export type ProjectStageRecord = {
  id: string;
  isTasker: boolean;
  order: number;
  label: string;
  name: string;
  statusLabel: "Pending" | "Ongoing" | "On Hold" | "Completed";
  subtitle: string;
  description: string;
  title: string;
  createdOn: string;
  budget: string;
  actualStartedAt: string;
  actualStartedAtValue: string | null;
  startedByName: string | null;
  plannedStartAt: string;
  plannedStartAtValue: string | null;
  plannedDueAt: string;
  plannedDueAtValue: string | null;
  status: ProjectStageVisualStatus;
  revisionCount?: number;
  comparisonCount?: number;
  invoiceRequired: boolean;
  invoiceAttachment: ProjectAttachmentRecord | null;
  invoiceRequest: {
    id: string;
    requestedById: string;
    requestedByName: string;
    requestedFromId: string;
    requestedFromName: string;
    note: string | null;
    requestedAt: string;
    fulfilledAt: string | null;
  } | null;
  briefAttachments: ProjectAttachmentRecord[];
};

function toProjectIsoString(
  date: Date | string | number | null | undefined,
) {
  if (!date) {
    return null;
  }

  const normalizedDate = toProjectDate(date);

  return Number.isNaN(normalizedDate.getTime()) ? null : normalizedDate.toISOString();
}

export type ProjectCollaboratorRecord = ProjectCollaboratorPermissions & {
  id: string;
  name: string;
  email?: string;
  role: string;
  group: "internal" | "external";
  chatVisibilityPaused: boolean;
  access: "owner" | "view";
  removable?: boolean;
};

export type ProjectExecutorRecord = {
  id: string;
  name: string;
  email?: string;
  roleLabel: string;
  group: "internal" | "external";
  chatVisibilityPaused: boolean;
};

export type ProjectMentionParticipantRecord = {
  id: string;
  name: string;
  email?: string;
  role: string;
  group: "internal" | "external";
  chatVisibilityPaused: boolean;
};

export type ProjectAttachmentRecord = {
  id: string;
  assetType: AttachmentAssetType;
  isSubmission: boolean;
  submissionNumber?: number;
  submissionReviewStatus?: SubmissionReviewStatus | null;
  originalFileName: string;
  fileTypeLabel: string;
  mimeType: string;
  fileSizeLabel: string;
  uploadedBy: string;
  uploadedAt: string;
  previewPath: string;
  downloadPath: string;
  isFavoritedByCurrentUser: boolean;
};

export type ProjectChatEntry = {
  id: string;
  kind:
    | "revision"
    | "comment"
    | "system"
    | "comparison"
    | "caption"
    | "reference";
  cursor?: string;
  revisionId?: string;
  revisionNumber?: number;
  title?: string;
  revisionStatus?: ProjectRevisionStatus | null;
  rejectionReason?: string | null;
  revisionRequestReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  authorId?: string;
  author: string;
  authorAvatarSrc?: string | null;
  role: string;
  body: string;
  createdAt: string;
  createdAtValue?: string;
  deletedAt?: string | null;
  deletedByUserId?: string | null;
  canDeleteUntil?: string | null;
  mentions?: Array<{
    userId: string;
    name: string;
  }>;
  attachments?: ProjectAttachmentRecord[];
  comparison?: {
    baseAttachmentId: string;
    compareAttachmentId: string;
    baseFileName: string;
    compareFileName: string;
    baseSubmissionLabel: string;
    compareSubmissionLabel: string;
    xPercent: number;
    yPercent: number;
  };
  caption?: {
    id: string;
    attachmentId: string;
    fileName: string;
    submissionLabel: string;
    xPercent: number;
    yPercent: number;
    body: string;
    isReadOnly: boolean;
  };
  reference?: {
    attachmentId: string;
    fileName: string;
    mimeType: string;
    previewPath: string;
    downloadPath: string;
    sourceConceptId: string;
    sourceConceptName: string;
    stageNeutral?: boolean;
  };
};

export type ProjectCompareNote = {
  id: string;
  author: string;
  role: string;
  date: string;
  body: string;
  x: string;
  y: string;
  attachments?: string[];
};

export type ProjectFlowRecord = {
  id: string;
  ownerId: string | null;
  isCompleted: boolean;
  canEdit: boolean;
  executors: ProjectExecutorRecord[];
  workflowStages: Array<
    Pick<ProjectWorkflowStage, "id" | "stageKey" | "status"> & {
      unlockedAt: string | null;
      completedAt: string | null;
    }
  >;
  canViewParticipants: boolean;
  canRemoveCollaborators: boolean;
  canViewBudget: boolean;
  title: string;
  category: string;
  executorDisplayName: string;
  description: string;
  executionType: ProjectExecutionType | null;
  executionTypeLabel: string;
  budget: string;
  currency: string | null;
  statusLabel: string;
  currentStageName: string;
  currentStageId: string | null;
  stageCount: number;
  startDate: string;
  endDate: string;
  createdOn: string;
  createdBy: string;
  tags: string[];
  priority: string;
  stageCards: ProjectStageRecord[];
  collaborators: ProjectCollaboratorRecord[];
  mentionParticipants: ProjectMentionParticipantRecord[];
  attachments: ProjectAttachmentRecord[];
  chatEntries: ProjectChatEntry[];
  compareNotes: ProjectCompareNote[];
};

export type ProjectStageShellRecord = Pick<
  ProjectFlowRecord,
  | "id"
  | "ownerId"
  | "canEdit"
  | "executors"
  | "workflowStages"
  | "canViewParticipants"
  | "title"
  | "collaborators"
> & { stageInstances?: StageInstanceView[]; templateName?: string | null; templateKey?: string | null; structureApproval?: string; canManageStages?: boolean };

export type DashboardProjectCounts = {
  total: number;
  ongoing: number;
  onHold: number;
  pending: number;
  completed: number;
};

export type ProjectsListFilter = {
  status?: ProjectListStatus;
  query?: string;
  sort?: "priority" | "updated" | "newest" | "oldest" | "name-asc" | "name-desc";
  page?: number;
  stage?: number;
  ownerId?: string;
  executorId?: string;
  myRole?: ProjectListRole;
};

export type ProjectListUserFilterOption = {
  id: string;
  name: string;
  email: string;
};

export type ProjectListFilterOptions = {
  stages: Array<{ number: number; name: string }>;
  owners: ProjectListUserFilterOption[];
  executors: ProjectListUserFilterOption[];
};

function toProjectDate(date: Date | string | number) {
  return date instanceof Date ? date : new Date(date);
}

export function formatProjectDate(date: Date | string | number | null | undefined) {
  if (!date) {
    return "—";
  }

  const normalizedDate = toProjectDate(date);

  if (Number.isNaN(normalizedDate.getTime())) {
    return "—";
  }

  const day = `${normalizedDate.getDate()}`.padStart(2, "0");
  const month = `${normalizedDate.getMonth() + 1}`.padStart(2, "0");
  const year = normalizedDate.getFullYear();

  return `${day}/${month}/${year}`;
}

export function formatProjectBudget(
  budget: number | null | undefined,
  currency: string | null | undefined = DEFAULT_PROJECT_CURRENCY,
) {
  if (!budget || budget <= 0) {
    return "Not specified";
  }

  const currencyCode = resolveProjectCurrency(currency ?? "");

  if (!currencyCode) {
    return "Not specified";
  }

  return `${budget.toLocaleString("en-US")} ${currencyCode}`;
}

export function formatProjectExecutionTypeLabel(
  executionType: ProjectExecutionType | null | undefined,
) {
  if (!executionType) {
    return "Not configured";
  }

  return executionType === ProjectExecutionType.INTERNAL
    ? "Internal Execution"
    : "External Execution";
}

function isInternalExecutionProject(project: Pick<Project, "executionType">) {
  return project.executionType === ProjectExecutionType.INTERNAL;
}

function formatProjectBudgetForRequirement(
  project: Pick<Project, "budgetRequired" | "currency">,
  budget: number | null | undefined,
) {
  if (budget && budget > 0) {
    return formatProjectBudget(budget, project.currency);
  }

  return project.budgetRequired
    ? PROJECT_BUDGET_REQUIRED_NOT_SET_LABEL
    : PROJECT_BUDGET_NOT_REQUIRED_LABEL;
}

export function canViewProjectBudget(
  project: ProjectPermissionContext,
  currentUser: ProjectAccessUser,
) {
  return (
    hasProjectPermission(currentUser, project, "project.viewBudget") ||
    hasProjectPermission(currentUser, project, "project.updateBudget")
  );
}

function getCreatorName(creator: Pick<User, "name" | "email">) {
  if (creator.name?.trim()) {
    return creator.name.trim();
  }

  return creator.email;
}

function uniqueTrimmedValues(values: Array<string | null | undefined>) {
  const normalized = new Map<string, string>();

  values.forEach((value) => {
    const trimmedValue = value?.trim();

    if (!trimmedValue) {
      return;
    }

    const key = trimmedValue.toLowerCase();
    if (!normalized.has(key)) {
      normalized.set(key, trimmedValue);
    }
  });

  return [...normalized.values()];
}

function getProjectTagNames(
  project: {
    tags?: Array<{
      tag: Pick<ProjectTag, "name">;
    }>;
  },
) {
  const relationTags =
    project.tags
      ?.map((assignment) => assignment.tag.name)
      .filter((tagName) => tagName.trim())
      .sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" }),
      ) ?? [];

  return uniqueTrimmedValues(relationTags);
}

function shouldLogProjectTimings() {
  return process.env.NODE_ENV !== "production";
}

function logProjectTiming(label: string, startedAt: number, metadata?: Record<string, unknown>) {
  if (!shouldLogProjectTimings()) {
    return;
  }

  console.log(`[projects:list] ${label}`, {
    ms: Math.round(performance.now() - startedAt),
    ...metadata,
  });
}

function formatProjectTagsLabel(tags: string[]) {
  return tags.length > 0 ? tags.join(", ") : "—";
}

function formatAttachmentTimestamp(date: Date | string | number) {
  const normalizedDate = toProjectDate(date);

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

export function formatProjectDateTime(date: Date | string | number | null | undefined) {
  if (!date) {
    return "—";
  }

  const normalizedDate = toProjectDate(date);

  if (Number.isNaN(normalizedDate.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(normalizedDate);
}

function getAttachmentFileTypeLabel(fileName: string, mimeType: string) {
  const extension = fileName.split(".").at(-1)?.toUpperCase();

  if (extension && extension !== fileName.toUpperCase()) {
    return extension;
  }

  const subtype = mimeType.split("/")[1];
  return subtype ? subtype.toUpperCase() : "FILE";
}

function formatAttachmentFileSize(fileSize: number) {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (fileSize >= 1024) {
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }

  return `${fileSize} B`;
}

function mapProjectCollaboratorAssignmentToRecord(
  assignment: ProjectCollaborator & {
    user: Pick<User, "id" | "name" | "email">;
  },
): ProjectCollaboratorRecord {
  const permissions = normalizeProjectCollaboratorPermissions(assignment);

  return {
    id: assignment.user.id,
    name: assignment.user.name?.trim() || assignment.user.email,
    email: assignment.user.email,
    role: "Project Participant",
    group: "internal",
    ...permissions,
    chatVisibilityPaused: assignment.chatVisibilityPaused,
    access: "view",
    removable: true,
  };
}

function mapProjectOwnerToRecord(
  user: Pick<User, "id" | "name" | "email">,
  role: "Project Owner" | "Project Co-Owner",
): ProjectCollaboratorRecord {
  return {
    id: user.id,
    name: user.name?.trim() || user.email,
    email: user.email,
    role,
    group: "internal",
    canInteract: true,
    canAddCaptions: true,
    canDownloadFiles: true,
    canViewBudget: true,
    canViewVendorInfo: true,
    canAccessProjectArchives: true,
    chatVisibilityPaused: false,
    access: "owner",
    removable: false,
  };
}

function compareProjectExecutorRecords(
  left: ProjectExecutorRecord,
  right: ProjectExecutorRecord,
) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function mapProjectExecutorAssignmentToRecord(
  assignment: ProjectExecutor & {
    user: Pick<User, "id" | "name" | "email">;
  },
  visibilityStateByUserId: ReadonlyMap<string, boolean>,
): ProjectExecutorRecord {
  return {
    id: assignment.user.id,
    name: assignment.user.name?.trim() || assignment.user.email,
    email: assignment.user.email,
    roleLabel: "Executor",
    group: "internal",
    chatVisibilityPaused: visibilityStateByUserId.get(assignment.user.id) ?? false,
  };
}

function getProjectExecutorRecords(
  project: Pick<
    ProjectWithCreator,
    "executors" | "collaborators"
  >,
) {
  const visibilityStateByUserId = new Map(
    (project.collaborators ?? []).map((collaborator) => [
      collaborator.userId,
      collaborator.chatVisibilityPaused,
    ] as const),
  );
  const mappedExecutors = (project.executors ?? [])
    .map((assignment) =>
      mapProjectExecutorAssignmentToRecord(assignment, visibilityStateByUserId),
    )
    .filter((executor, index, current) =>
      current.findIndex((item) => item.id === executor.id) === index,
    )
    .sort(compareProjectExecutorRecords);

  return mappedExecutors;
}

function getProjectExecutorDisplayName(executors: ProjectExecutorRecord[]) {
  if (executors.length === 0) {
    return "Self-managed";
  }

  const firstExecutor = executors[0];

  if (!firstExecutor) {
    return "Self-managed";
  }

  const remainingCount = executors.length - 1;
  return remainingCount > 0
    ? `${firstExecutor.name} +${remainingCount}`
    : firstExecutor.name;
}

function maskExecutorVisibilityState(executor: ProjectExecutorRecord) {
  return {
    ...executor,
    chatVisibilityPaused: false,
  };
}

function maskCollaboratorVisibilityState(collaborator: ProjectCollaboratorRecord) {
  return {
    ...collaborator,
    chatVisibilityPaused: false,
  };
}

function canAccessProjectRecord(
  project: Pick<Project, "ownerId"> & {
    coOwners?: Array<{ userId: string }>;
    executors?: Array<Pick<ProjectExecutor, "userId">>;
    collaborators?: Array<Pick<ProjectCollaborator, "userId">>;
  },
  currentUser: ProjectAccessUser,
) {
  return hasProjectPermission(currentUser, project, "project.view");
}

function canViewBriefContent(
  project: Pick<Project, "ownerId"> & {
    coOwners?: Array<{ userId: string }>;
    executors?: Array<Pick<ProjectExecutor, "userId">>;
  },
  currentUser: ProjectAccessUser,
) {
  return (
    isProjectAdmin(currentUser) ||
    isProjectOwner(currentUser, project) ||
    hasProjectPermission(currentUser, project, "project.update") ||
    isProjectExecutor(currentUser, project)
  );
}

function isStageBriefAttachment(
  attachment: Pick<
    ProjectWithCreator["attachments"][number],
    "assetType" | "stageId" | "revisionId" | "commentId"
  >,
) {
  return (
    attachment.assetType === AttachmentAssetType.GENERAL_PROJECT_ASSET &&
    Boolean(attachment.stageId) &&
    !attachment.revisionId &&
    !attachment.commentId
  );
}

function isProjectBriefAttachment(
  attachment: Pick<
    ProjectWithCreator["attachments"][number],
    "assetType" | "stageId" | "revisionId" | "commentId"
  >,
) {
  return (
    attachment.assetType === AttachmentAssetType.GENERAL_PROJECT_ASSET &&
    !isStageBriefAttachment(attachment)
  );
}

async function getProjectAttachmentsVisibleToUser(
  currentUser: ProjectAccessUser,
  project: Pick<ProjectWithCreator, "id" | "ownerId" | "coOwners" | "executors" | "attachments">,
) {
  const taskerStageIds = Array.from(
    new Set(
      project.attachments
        .map((attachment) => attachment.stageId)
        .filter((stageId): stageId is string => Boolean(stageId)),
    ),
  );
  const concepts = taskerStageIds.length
    ? await withPrismaRetry(() =>
        prisma.projectConceptFolder.findMany({
          where: {
            projectId: project.id,
            taskerStageId: { in: taskerStageIds },
          },
          select: {
            id: true,
            projectId: true,
            taskerStageId: true,
            workflowStageKey: true,
            assignedExecutorId: true,
          },
        }),
      )
    : [];
  const conceptByTaskerStageId = new Map(
    concepts.map((concept) => [concept.taskerStageId, concept] as const),
  );
  const coOwnerIds = project.coOwners?.map((coOwner) => coOwner.userId) ?? [];
  const conceptAccessFilteredAttachments = project.attachments.filter((attachment) => {
    const concept = attachment.stageId
      ? conceptByTaskerStageId.get(attachment.stageId)
      : null;

    return (
      !concept ||
      canViewProjectConcept(currentUser, {
        folderId: concept.id,
        projectId: concept.projectId,
        taskerStageId: concept.taskerStageId,
        workflowStageKey: concept.workflowStageKey,
        assignedExecutorId: concept.assignedExecutorId,
        ownerId: project.ownerId,
        coOwnerIds,
      })
    );
  });

  if (
    canBypassCollaboratorVisibility(currentUser, project.ownerId ?? "") ||
    hasProjectPermission(currentUser, project, "collaborator.pauseVisibility")
  ) {
    return conceptAccessFilteredAttachments;
  }

  const visibilityState = await getProjectCollaboratorVisibilityState(
    project.id,
    currentUser.id,
  );

  if (!visibilityState) {
    return conceptAccessFilteredAttachments;
  }

  if (
    visibilityState.chatVisibilityPaused &&
    visibilityState.visibilityPauses.length === 0
  ) {
    return [];
  }

  return conceptAccessFilteredAttachments.filter(
    (attachment) =>
      !isTimestampHiddenByPauseWindows(
        attachment.createdAt,
        visibilityState.visibilityPauses,
      ),
  );
}

export function buildAccessibleProjectsWhere(
  currentUser?: ProjectAccessUser,
): Prisma.ProjectWhereInput {
  if (!currentUser || !hasPermission(currentUser, "project.view")) {
    return {
      id: "__permission_denied__",
    };
  }

  return getAccessibleProjectsWhere(currentUser);
}

function mapAttachmentToRecord(
  attachment: {
    id: string;
    assetType: AttachmentAssetType;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    submissionReviewStatus?: SubmissionReviewStatus | null;
    createdAt: Date | string | number;
    uploadedBy: Pick<User, "name" | "email">;
  },
  favoritedAttachmentIds?: ReadonlySet<string>,
): ProjectAttachmentRecord {
  return {
    id: attachment.id,
    assetType: attachment.assetType,
    isSubmission: attachment.assetType === AttachmentAssetType.STAGE_SUBMISSION,
    submissionReviewStatus: attachment.submissionReviewStatus ?? null,
    originalFileName: attachment.originalFileName,
    fileTypeLabel: getAttachmentFileTypeLabel(
      attachment.originalFileName,
      attachment.mimeType,
    ),
    mimeType: attachment.mimeType,
    fileSizeLabel: formatAttachmentFileSize(attachment.fileSize),
    uploadedBy: getCreatorName(attachment.uploadedBy),
    uploadedAt: formatAttachmentTimestamp(attachment.createdAt),
    previewPath: `/api/project-assets/${attachment.id}/preview`,
    downloadPath: `/api/project-assets/${attachment.id}/download`,
    isFavoritedByCurrentUser: favoritedAttachmentIds?.has(attachment.id) ?? false,
  };
}

function mapStageStatusToVisual(status: StageStatus): ProjectStageVisualStatus {
  switch (status) {
    case StageStatus.COMPLETED:
      return "completed";
    case StageStatus.ON_HOLD:
      return "on-hold";
    case StageStatus.PENDING:
      return "pending";
    default:
      return "in-progress";
  }
}

function mapStageStatusToDisplayLabel(
  status: StageStatus,
): ProjectStageRecord["statusLabel"] {
  switch (status) {
    case StageStatus.COMPLETED:
      return "Completed";
    case StageStatus.ON_HOLD:
      return "On Hold";
    case StageStatus.PENDING:
      return "Pending";
    default:
      return "Ongoing";
  }
}

function buildSyntheticStages(project: ProjectWithCreator): ProjectStageWithStarter[] {
  const isInternalExecution = isInternalExecutionProject(project);
  const completed = Boolean(project.completedAt || project.archivedAt);

  return Array.from({ length: Math.max(project.stageCount ?? 1, 1) }, (_, index) => ({
    id: `${project.id}-stage-${index + 1}`,
    projectId: project.id,
    name:
      index === 0
        ? project.currentStageName?.trim() || `Stage ${index + 1}`
        : `Stage ${index + 1}`,
    description: null,
    budget: isInternalExecution ? null : index === 0 ? project.budget : null,
    actualStartedAt: null,
    startedById: null,
    completedAt: null,
    invoiceRequired: !isInternalExecution,
    isTasker: false,
    plannedStartAt: project.startDate,
    plannedDueAt: project.endDate,
    status: completed
      ? StageStatus.COMPLETED
      : index === 0
        ? StageStatus.ONGOING
        : StageStatus.PENDING,
    order: index + 1,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }));
}

type ProjectStageSelection = {
  taskerStageIds?: readonly string[];
  participantUserIds?: readonly string[];
  includeStageInvoiceData?: boolean;
};

function getProjectStages(
  project: ProjectWithCreator,
  selection?: ProjectStageSelection,
) {
  const selectedTaskerStageIds = selection?.taskerStageIds
    ? new Set(selection.taskerStageIds)
    : null;
  const persistedStages = project.stages.filter((stage) =>
    selectedTaskerStageIds
      ? stage.isTasker && selectedTaskerStageIds.has(stage.id)
      : !stage.isTasker,
  );

  if (persistedStages.length > 0) {
    return [...persistedStages].sort((left, right) => left.order - right.order);
  }

  if (selectedTaskerStageIds) {
    return [];
  }

  return project.stageCount === null ? [] : buildSyntheticStages(project);
}

export function formatProjectStageLabel(
  project: Pick<Project, "currentStageName"> & {
    status: ProjectStatusRelation;
    stages?: Array<Pick<ProjectStage, "name" | "status" | "order">>;
  },
) {
  const stages = [...(project.stages ?? [])].sort((left, right) => left.order - right.order);

  if (stages.length === 0 && !project.currentStageName?.trim()) {
    return "Workflow unavailable";
  }
  const currentStage =
    stages.find((stage) => stage.name === project.currentStageName) ?? stages[0] ?? null;
  const fallbackStageName = project.currentStageName?.trim() || "Stage 1";
  const stageName = currentStage?.name ?? fallbackStageName;
  const statusLabel = currentStage
    ? mapStageStatusToDisplayLabel(currentStage.status)
    : getProjectStatusDisplay(project.status).name;

  return `${stageName} : ${statusLabel}`;
}

function mapProjectToCard(
  project: ProjectCardProject,
  currentUser: ProjectAccessUser,
): ProjectCardRecord {
  const workflowState = deriveProjectListWorkflowState(project);
  const updatedAt = toProjectDate(project.updatedAt);

  return {
    id: project.id,
    title: project.name,
    ...workflowState,
    showWorkflowDiagnostic: currentUser.role === UserRole.SUPER_ADMIN,
    owner: project.owner
      ? {
          id: project.owner.id,
          name: getCreatorName(project.owner),
          email: project.owner.email,
        }
      : null,
    executors: project.executors.map(({ user }) => ({
      id: user.id,
      name: getCreatorName(user),
      email: user.email,
    })),
    updatedLabel: formatProjectListRelativeTime(updatedAt),
    updatedAt: Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toISOString(),
    isPinned: project.isPinned,
    canPin: hasProjectPermission(currentUser, project, "project.update"),
    canDelete:
      workflowState.businessStatus !== "COMPLETED" &&
      hasProjectPermission(currentUser, project, "project.delete"),
    canEdit:
      workflowState.businessStatus !== "COMPLETED" &&
      hasProjectPermission(currentUser, project, "project.update") &&
      hasProjectPermission(currentUser, project, "project.manageCollaborators"),
  };
}

function formatProjectListRelativeTime(value: Date | string | number) {
  const normalizedValue = toProjectDate(value);

  if (Number.isNaN(normalizedValue.getTime())) return "Updated recently";

  const elapsedMs = Math.max(0, Date.now() - normalizedValue.getTime());
  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;

  return `Updated ${formatProjectDate(normalizedValue)}`;
}

function mapStageToCard(
  project: ProjectWithCreator,
  stage: ProjectStageWithStarter,
  allowBudgetView: boolean,
  canViewBrief: boolean,
  briefAttachments: ProjectAttachmentRecord[] = [],
): ProjectStageRecord {
  const invoiceRequest = stage.invoiceRequests?.[0] ?? null;

  return {
    id: stage.id,
    isTasker: stage.isTasker,
    order: stage.order,
    label: `${stage.name} : ${mapStageStatusToDisplayLabel(stage.status)}`,
    name: stage.name,
    statusLabel: mapStageStatusToDisplayLabel(stage.status),
    subtitle: project.category?.trim() || "Uncategorized",
    description: canViewBrief ? stage.description?.trim() || "" : "",
    title: project.name,
    createdOn: formatProjectDate(stage.createdAt),
    budget: allowBudgetView
      ? formatProjectBudgetForRequirement(project, stage.budget)
      : "Restricted",
    actualStartedAt: formatProjectDateTime(stage.actualStartedAt),
    actualStartedAtValue: toProjectIsoString(stage.actualStartedAt),
    startedByName: stage.startedBy ? getCreatorName(stage.startedBy) : null,
    plannedStartAt: formatProjectDateTime(stage.plannedStartAt),
    plannedStartAtValue: toProjectIsoString(stage.plannedStartAt),
    plannedDueAt: formatProjectDateTime(stage.plannedDueAt),
    plannedDueAtValue: toProjectIsoString(stage.plannedDueAt),
    status: mapStageStatusToVisual(stage.status),
    revisionCount: stage._count?.revisions,
    comparisonCount: stage._count?.comparisonComments,
    invoiceRequired: stage.invoiceRequired,
    invoiceAttachment: null,
    invoiceRequest: invoiceRequest
      ? {
          id: invoiceRequest.id,
          requestedById: invoiceRequest.requestedById,
          requestedByName: getCreatorName(invoiceRequest.requestedBy),
          requestedFromId: invoiceRequest.requestedFromId,
          requestedFromName: getCreatorName(invoiceRequest.requestedFrom),
          note: invoiceRequest.note,
          requestedAt: formatProjectDateTime(invoiceRequest.updatedAt),
          fulfilledAt: invoiceRequest.fulfilledAt
            ? formatProjectDateTime(invoiceRequest.fulfilledAt)
            : null,
        }
      : null,
    briefAttachments: canViewBrief ? briefAttachments : [],
  };
}

function mapProjectToFlow(
  project: ProjectWithCreator,
  currentUser: ProjectAccessUser,
  favoritedAttachmentIds?: ReadonlySet<string>,
  stageSelection?: ProjectStageSelection,
): ProjectFlowRecord {
  const creatorName = getCreatorName(project.createdBy);
  const rawExecutorRecords = getProjectExecutorRecords(project);
  const canViewChatVisibilityState = hasProjectPermission(
    currentUser,
    project,
    "collaborator.pauseVisibility",
  );
  const canViewParticipants = hasProjectPermission(
    currentUser,
    project,
    "project.viewParticipants",
  );
  const canRemoveCollaborators = hasProjectPermission(
    currentUser,
    project,
    "collaborator.removeFromProject",
  );
  const executorRecords = canViewChatVisibilityState
    ? rawExecutorRecords
    : rawExecutorRecords.map(maskExecutorVisibilityState);
  const visibleExecutorRecords = canViewParticipants
    ? executorRecords
    : executorRecords.filter((executor) => executor.id === currentUser.id);
  const executorDisplayName = canViewParticipants
    ? getProjectExecutorDisplayName(executorRecords)
    : visibleExecutorRecords.length > 0
      ? getProjectExecutorDisplayName(visibleExecutorRecords)
      : "Restricted";
  const allowBudgetView = canViewProjectBudget(project, currentUser);
  const allowBriefView = canViewBriefContent(project, currentUser);
  const editingLocked = Boolean(
    project.completedAt || project.archivedAt || isProjectStatusCompleted(project.status),
  );
  const stages = getProjectStages(project, stageSelection);
  const allStagesCompleted =
    stages.length > 0 && stages.every((stage) => stage.status === StageStatus.COMPLETED);
  const currentStage =
    stages.find((stage) => stage.name === project.currentStageName) ?? stages[0] ?? null;
  const projectBriefAttachments = project.attachments
    .filter(isProjectBriefAttachment)
    .map((attachment) => mapAttachmentToRecord(attachment, favoritedAttachmentIds));
  const stageBriefAttachmentMap = new Map<string, ProjectAttachmentRecord[]>();
  const stageInvoiceAttachmentMap = new Map<string, ProjectAttachmentRecord>();
  const tags = getProjectTagNames(project);

  project.attachments
    .filter(isStageBriefAttachment)
    .forEach((attachment) => {
      if (!attachment.stageId) {
        return;
      }

      const existingAttachments = stageBriefAttachmentMap.get(attachment.stageId) ?? [];
      stageBriefAttachmentMap.set(attachment.stageId, [
        ...existingAttachments,
        mapAttachmentToRecord(attachment, favoritedAttachmentIds),
      ]);
    });

  project.attachments
    .filter((attachment) => attachment.assetType === AttachmentAssetType.STAGE_INVOICE)
    .forEach((attachment) => {
      if (!attachment.stageId || stageInvoiceAttachmentMap.has(attachment.stageId)) {
        return;
      }

      stageInvoiceAttachmentMap.set(
        attachment.stageId,
        mapAttachmentToRecord(attachment, favoritedAttachmentIds),
      );
    });

  const rawCollaboratorRecords = (project.collaborators ?? [])
    .map(mapProjectCollaboratorAssignmentToRecord)
    .filter((collaborator, index, current) =>
      current.findIndex((item) => item.id === collaborator.id) === index,
    );
  const collaboratorRecords = canViewChatVisibilityState
    ? rawCollaboratorRecords
    : rawCollaboratorRecords.map(maskCollaboratorVisibilityState);
  const visibleCollaboratorRecords = canViewParticipants
    ? collaboratorRecords
    : collaboratorRecords.filter((collaborator) => collaborator.id === currentUser.id);
  const ownerRecords = [
    ...(project.owner
      ? [mapProjectOwnerToRecord(project.owner, "Project Owner")]
      : []),
    ...(project.coOwners ?? []).map(({ user }) =>
      mapProjectOwnerToRecord(user, "Project Co-Owner"),
    ),
  ];
  const visibleOwnerRecords = canViewParticipants
    ? ownerRecords
    : ownerRecords.filter((owner) => owner.id === currentUser.id);
  const mentionParticipants = [
    ...visibleOwnerRecords.map((owner) => ({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
      group: owner.group,
      chatVisibilityPaused: false,
    })),
    ...visibleExecutorRecords.map((executor) => ({
      id: executor.id,
      name: executor.name,
      email: executor.email,
      role: executor.roleLabel,
      group: executor.group,
      chatVisibilityPaused: executor.chatVisibilityPaused,
    })),
    ...visibleCollaboratorRecords.map((collaborator) => ({
      id: collaborator.id,
      name: collaborator.name,
      email: collaborator.email,
      role: collaborator.role,
      group: collaborator.group,
      chatVisibilityPaused: collaborator.chatVisibilityPaused,
    })),
  ].filter(
    (participant, index, current) =>
      current.findIndex((item) => item.id === participant.id) === index,
  );

  return {
    id: project.id,
    ownerId: project.ownerId,
    isCompleted: editingLocked,
    canEdit:
      !editingLocked &&
      hasProjectPermission(currentUser, project, "project.update"),
    executors: visibleExecutorRecords,
    workflowStages: (project.workflowStages ?? []).map((stage) => ({
      id: stage.id,
      stageKey: stage.stageKey,
      status: stage.status,
      unlockedAt: toProjectIsoString(stage.unlockedAt),
      completedAt: toProjectIsoString(stage.completedAt),
    })),
    canViewParticipants,
    canRemoveCollaborators,
    canViewBudget: allowBudgetView,
    title: project.name,
    category: project.category ?? "Uncategorized",
    executorDisplayName,
    description: allowBriefView ? project.description ?? "" : "",
    executionType: project.executionType,
    executionTypeLabel: formatProjectExecutionTypeLabel(project.executionType),
    budget: allowBudgetView
      ? formatProjectBudgetForRequirement(project, project.budget)
      : "Restricted",
    currency: allowBudgetView ? project.currency : null,
    statusLabel: allStagesCompleted
      ? "Completed"
      : getProjectStatusDisplay(project.status).name,
    currentStageName:
      currentStage?.name ?? project.currentStageName?.trim() ?? "Workflow unavailable",
    currentStageId: currentStage?.id ?? null,
    stageCount: stages.length,
    startDate: formatProjectDate(project.startDate),
    endDate: formatProjectDate(project.endDate),
    createdOn: formatProjectDate(project.createdAt),
    createdBy: creatorName,
    tags,
    priority: formatProjectPriority(project.priority ?? DEFAULT_PROJECT_PRIORITY),
    stageCards: stages.map((stage) => ({
      ...mapStageToCard(
        project,
        stage,
        allowBudgetView,
        allowBriefView,
        stageBriefAttachmentMap.get(stage.id) ?? [],
      ),
      invoiceAttachment: stageInvoiceAttachmentMap.get(stage.id) ?? null,
    })),
    collaborators: [
      ...visibleOwnerRecords,
      ...visibleCollaboratorRecords,
    ],
    mentionParticipants,
    attachments: allowBriefView ? projectBriefAttachments : [],
    chatEntries: [],
    compareNotes: [],
  };
}

export async function updateProjectCollaborators(
  projectId: string,
  collaborators: Array<{
    id?: string;
    userId?: string;
  } & Partial<ProjectCollaboratorPermissions>>,
  actor: ProjectAccessUser,
) {
  await assertProjectCollaboratorManagementAccess(
    actor,
    projectId,
    "project.manageCollaborators",
  );

  if (!Array.isArray(collaborators)) {
    throw new Error("Collaborator selection is required.");
  }

  const normalizedCollaborators = collaborators.reduce<
    Array<{
      id: string;
      permissions: ProjectCollaboratorPermissions | null;
    }>
  >((current, collaborator) => {
    const id = (collaborator.userId ?? collaborator.id ?? "").trim();

    if (!id || current.some((item) => item.id === id)) {
      return current;
    }

    const hasSubmittedPermissions = Object.keys(
      pickProjectCollaboratorPermissions(collaborator),
    ).some((key) => typeof collaborator[key as keyof ProjectCollaboratorPermissions] === "boolean");

    current.push({
      id,
      permissions: hasSubmittedPermissions
        ? pickProjectCollaboratorPermissions(collaborator)
        : null,
    });
    return current;
  }, []);
  const normalizedIds = normalizedCollaborators.map((collaborator) => collaborator.id);

  const validCollaborators = normalizedIds.length
    ? await withPrismaRetry(() =>
        prisma.user.findMany({
          where: {
            id: {
              in: normalizedIds,
            },
            role: "USER",
          },
          select: {
            id: true,
          },
        }),
      )
    : [];

  const validIds = validCollaborators.map((collaborator) => collaborator.id);

  if (validIds.length !== normalizedIds.length) {
    throw new Error("One or more selected collaborators could not be found.");
  }

  const submittedPermissionMap = new Map(
    normalizedCollaborators
      .filter((collaborator) => validIds.includes(collaborator.id))
      .map((collaborator) => [collaborator.id, collaborator.permissions] as const),
  );

  const existingAssignments = await withPrismaRetry(() =>
    prisma.projectCollaborator.findMany({
      where: {
        projectId,
      },
      select: {
        userId: true,
        canInteract: true,
        canAddCaptions: true,
        canDownloadFiles: true,
        canViewBudget: true,
        canViewVendorInfo: true,
        canAccessProjectArchives: true,
      },
    }),
  );
  const projectExecutors = await withPrismaRetry(() =>
    prisma.projectExecutor.findMany({
      where: {
        projectId,
      },
      select: {
        userId: true,
      },
    }),
  );
  const executorIdSet = new Set(projectExecutors.map((executor) => executor.userId));
  const existingIds = new Set(existingAssignments.map((assignment) => assignment.userId));
  const existingPermissionMap = new Map(
    existingAssignments.map((assignment) => [
      assignment.userId,
      normalizeProjectCollaboratorPermissions(
        assignment,
        { isExecutor: executorIdSet.has(assignment.userId) },
      ),
    ]),
  );
  const nextIds = new Set(validIds);
  const idsToDelete = existingAssignments
    .map((assignment) => assignment.userId)
    .filter((userId) => !nextIds.has(userId));
  const idsToCreate = validIds.filter((userId) => !existingIds.has(userId));
  const idsToUpdate = validIds.filter((userId) => existingIds.has(userId));
  const resolvePermissions = (userId: string) =>
    normalizeProjectCollaboratorPermissions(
      submittedPermissionMap.get(userId) ?? existingPermissionMap.get(userId),
      { isExecutor: executorIdSet.has(userId) },
    );

  await withPrismaRetry(() =>
    prisma.$transaction([
      ...(idsToDelete.length > 0
        ? [
            prisma.projectCollaborator.deleteMany({
              where: {
                projectId,
                userId: {
                  in: idsToDelete,
                },
              },
            }),
          ]
        : []),
      ...idsToUpdate.map((userId) =>
        prisma.projectCollaborator.update({
          where: {
            projectId_userId: {
              projectId,
              userId,
            },
          },
          data: resolvePermissions(userId),
        }),
      ),
      ...(idsToCreate.length > 0
        ? [
            prisma.projectCollaborator.createMany({
              data: idsToCreate.map((userId) => ({
                  projectId,
                  userId,
                  addedById: actor.id,
                  ...resolvePermissions(userId),
                })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]),
  );

  for (const userId of validIds) {
    await ensureProjectPrivateFolder(projectId, userId);
  }

  const assignments = await withPrismaRetry(() =>
    prisma.projectCollaborator.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  );

  return assignments.map(mapProjectCollaboratorAssignmentToRecord);
}

async function assertProjectCollaboratorManagementAccess(
  actor: ProjectAccessUser,
  projectId: string,
  permissionKey: PermissionKey,
) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        ownerId: true,
        coOwners: {
          select: { userId: true },
        },
        executors: {
          select: {
            userId: true,
          },
        },
      },
    }),
  );

  if (!project) {
    throw new Error("Project not found.");
  }

  if (
    !hasProjectPermission(actor, project, permissionKey)
  ) {
    throw new Error("You are not allowed to update project collaborators.");
  }

  return project;
}

async function getProjectCollaboratorAssignments(projectId: string) {
  const assignments = await withPrismaRetry(() =>
    prisma.projectCollaborator.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  );

  return assignments.map(mapProjectCollaboratorAssignmentToRecord);
}

export async function getProjectExecutors(projectId: string) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        executors: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
  );

  return project ? getProjectExecutorRecords(project) : [];
}

export async function requireProjectExecutor(projectId: string, userId: string) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        executors: {
          select: {
            userId: true,
          },
        },
      },
    }),
  );

  if (!project) {
    throw new Error("Project not found.");
  }

  if (!isProjectExecutor({ id: userId }, project)) {
    throw new Error("Only a project executor can perform this action.");
  }

  return project;
}

export async function removeProjectCollaborator(
  actor: ProjectAccessUser,
  projectId: string,
  collaboratorId: string,
) {
  await assertProjectCollaboratorManagementAccess(
    actor,
    projectId,
    "collaborator.removeFromProject",
  );

  const assignment = await withPrismaRetry(() =>
    prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: collaboratorId,
        },
      },
      select: projectCollaboratorPermissionSelect,
    }),
  );

  if (!assignment) {
    throw new Error("Collaborator not found.");
  }

  await withPrismaRetry(() =>
    prisma.projectCollaborator.delete({
      where: {
        projectId_userId: {
          projectId,
          userId: collaboratorId,
        },
      },
    }),
  );

  return getProjectCollaboratorAssignments(projectId);
}

export async function setProjectCollaboratorChatVisibility(
  actor: ProjectAccessUser,
  input: {
    projectId: string;
    collaboratorId: string;
    paused: boolean;
  },
) {
  const project = await assertProjectCollaboratorManagementAccess(
    actor,
    input.projectId,
    "collaborator.pauseVisibility",
  );

  if (input.collaboratorId === actor.id) {
    throw new Error("You cannot change your own chat visibility.");
  }

  if (
    input.collaboratorId === project.ownerId ||
    project.coOwners.some((coOwner) => coOwner.userId === input.collaboratorId)
  ) {
    throw new Error("Project owner chat visibility cannot be changed.");
  }

  const isExecutorTarget = project.executors.some(
    (executor) => executor.userId === input.collaboratorId,
  );

  let assignment = await withPrismaRetry(() =>
    prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: {
          projectId: input.projectId,
          userId: input.collaboratorId,
        },
      },
      select: {
        projectId: true,
        userId: true,
        chatVisibilityPaused: true,
      },
    }),
  );

  if (!assignment) {
    if (!input.paused || !isExecutorTarget) {
      throw new Error("Collaborator not found.");
    }

    const targetUser = await withPrismaRetry(() =>
      prisma.user.findUnique({
        where: {
          id: input.collaboratorId,
        },
        select: {
          id: true,
          role: true,
        },
      }),
    );

    if (!targetUser || targetUser.role !== UserRole.USER) {
      throw new Error("Collaborator not found.");
    }

    assignment = await withPrismaRetry(() =>
      prisma.projectCollaborator.create({
        data: {
          projectId: input.projectId,
          userId: input.collaboratorId,
          addedById: actor.id,
          ...normalizeProjectCollaboratorPermissions(null, {
            isExecutor: isExecutorTarget,
          }),
        },
        select: {
          projectId: true,
          userId: true,
          chatVisibilityPaused: true,
        },
      }),
    );
    await ensureProjectPrivateFolder(input.projectId, input.collaboratorId);
  }

  if (assignment.chatVisibilityPaused === input.paused) {
    return getProjectCollaboratorAssignments(input.projectId);
  }

  await withPrismaRetry(async () =>
    prisma.$transaction(async (tx) => {
      if (input.paused) {
        await tx.projectCollaborator.update({
          where: {
            projectId_userId: {
              projectId: input.projectId,
              userId: input.collaboratorId,
            },
          },
          data: {
            chatVisibilityPaused: true,
          },
        });

        await tx.projectCollaboratorVisibilityPause.create({
          data: {
            projectId: input.projectId,
            userId: input.collaboratorId,
            pausedAt: new Date(),
            createdById: actor.id,
          },
        });

        return;
      }

      const latestOpenPause = await tx.projectCollaboratorVisibilityPause.findFirst({
        where: {
          projectId: input.projectId,
          userId: input.collaboratorId,
          resumedAt: null,
        },
        orderBy: {
          pausedAt: "desc",
        },
        select: {
          id: true,
        },
      });

      await tx.projectCollaborator.update({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.collaboratorId,
          },
        },
        data: {
          chatVisibilityPaused: false,
        },
      });

      if (latestOpenPause) {
        await tx.projectCollaboratorVisibilityPause.update({
          where: {
            id: latestOpenPause.id,
          },
          data: {
            resumedAt: new Date(),
          },
        });
      }
    }),
  );

  return getProjectCollaboratorAssignments(input.projectId);
}

function buildProjectsWhere(
  filter: ProjectsListFilter,
  currentUserId: string,
) {
  const query = filter.query?.trim();
  const ownerId = filter.ownerId?.trim();
  const executorId = filter.executorId?.trim();
  const clauses: Prisma.ProjectWhereInput[] = [
    buildProjectListStatusWhere(filter.status ?? "ALL"),
    buildProjectListStageWhere(filter.stage ?? null),
  ];

  if (query) {
    clauses.push({
      OR: [
        {
          name: {
            contains: query,
            mode: "insensitive",
          },
        },
        {
          owner: {
            is: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
        {
          coOwners: {
            some: {
              user: {
                is: {
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { email: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        },
        {
          executors: {
            some: {
              user: {
                is: {
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { email: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        },
      ],
    });
  }

  if (ownerId) {
    clauses.push({ ownerId });
  }

  if (executorId) {
    clauses.push({
      executors: {
        some: {
          userId: executorId,
        },
      },
    });
  }

  if (filter.myRole && filter.myRole !== "ALL") {
    const roleWhere: Record<Exclude<ProjectListRole, "ALL">, Prisma.ProjectWhereInput> = {
      OWNER: { ownerId: currentUserId },
      CO_OWNER: { coOwners: { some: { userId: currentUserId } } },
      EXECUTOR: { executors: { some: { userId: currentUserId } } },
      COLLABORATOR: { collaborators: { some: { userId: currentUserId } } },
    };

    clauses.push(roleWhere[filter.myRole]);
  }

  return { AND: clauses };
}

export async function getProjectListFilterOptions(
  currentUser: ProjectAccessUser,
): Promise<ProjectListFilterOptions> {
  if (!canUseProjects(currentUser)) {
    return {
      stages: [],
      owners: [],
      executors: [],
    };
  }

  const startedAt = performance.now();
  const accessibleWhereStartedAt = performance.now();
  const accessibleWhere = buildAccessibleProjectsWhere(currentUser);
  logProjectTiming("filter accessible where", accessibleWhereStartedAt);
  const queryStartedAt = performance.now();
  const projects = await unstable_cache(
    async () =>
      withPrismaRetry(() =>
        prisma.project.findMany({
          where: accessibleWhere,
          select: {
            stageInstances: { where: { retiredAt: null }, select: { order: true, name: true } },
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            executors: {
              select: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        }),
      ),
    ["project-list-v2-filter-options", currentUser.id, currentUser.role],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  )();
  logProjectTiming("filter options query", queryStartedAt, {
    projects: projects.length,
  });

  const mappingStartedAt = performance.now();
  const owners = new Map<string, ProjectListUserFilterOption>();
  const executors = new Map<string, ProjectListUserFilterOption>();

  for (const project of projects) {
    if (project.owner) {
      owners.set(project.owner.id, {
        id: project.owner.id,
        name: getCreatorName(project.owner),
        email: project.owner.email,
      });
    }

    for (const executor of project.executors) {
      executors.set(executor.user.id, {
        id: executor.user.id,
        name: getCreatorName(executor.user),
        email: executor.user.email,
      });
    }

  }

  const stageNames = new Map<number, Set<string>>();
  for (const project of projects) for (const stage of project.stageInstances) {
    const names = stageNames.get(stage.order) ?? new Set<string>();
    names.add(stage.name); stageNames.set(stage.order,names);
  }
  const options = {
    stages: [...stageNames].sort(([a],[b])=>a-b).map(([number,names])=>({number,name:names.size===1 ? [...names][0] : "Across project templates"})),
    owners: sortProjectListUserFilterOptions([...owners.values()]),
    executors: sortProjectListUserFilterOptions([...executors.values()]),
  };
  logProjectTiming("filter options mapping", mappingStartedAt, {
    owners: owners.size,
    executors: executors.size,
  });
  logProjectTiming("filter options total", startedAt);
  return options;
}

export async function getProjectTypeSwitcherVisibility(
  currentUser: ProjectAccessUser,
) {
  const noProjectAuthority = {
    isProjectOwner: false,
    isProjectCoOwner: false,
  };

  if (canViewProjectTypeSwitcher(currentUser, noProjectAuthority)) {
    return true;
  }

  const [artworkProject, flexibleProject] = await withPrismaRetry(() =>
    Promise.all([
      prisma.project.findFirst({
        where: {
          OR: [
            { ownerId: currentUser.id },
            { coOwners: { some: { userId: currentUser.id } } },
          ],
        },
        select: {
          ownerId: true,
          coOwners: {
            where: { userId: currentUser.id },
            select: { userId: true },
          },
        },
      }),
      prisma.flexibleProject.findFirst({
        where: { ownerId: currentUser.id },
        select: { id: true },
      }),
    ]),
  );

  return canViewProjectTypeSwitcher(currentUser, {
    isProjectOwner:
      artworkProject?.ownerId === currentUser.id || Boolean(flexibleProject),
    isProjectCoOwner: Boolean(artworkProject?.coOwners.length),
  });
}

function sortProjectListUserFilterOptions(
  users: ProjectListUserFilterOption[],
) {
  return users.sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });

    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.email.localeCompare(right.email, undefined, {
      sensitivity: "base",
    });
  });
}

export async function getDashboardProjectCounts(
  currentUser?: ProjectAccessUser,
): Promise<DashboardProjectCounts> {
  const startedAt = performance.now();
  const accessibleWhereStartedAt = performance.now();
  const accessibleWhere = buildAccessibleProjectsWhere(currentUser);
  logProjectTiming("sidebar count accessible where", accessibleWhereStartedAt);
  const getCachedCounts = unstable_cache(
    async () =>
      withPrismaRetry(() =>
        prisma.project.findMany({
          where: accessibleWhere,
          select: {
            status: {
              select: {
                group: {
                  select: projectStatusGroupSelect,
                },
              },
            },
          },
        }),
      ),
    [
      "dashboard-project-counts",
      currentUser?.id ?? "all",
      currentUser?.role ?? "all",
    ],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  );

  const queryStartedAt = performance.now();
  const projects = await getCachedCounts();
  logProjectTiming("sidebar count query", queryStartedAt, {
    projects: projects.length,
  });

  const mappingStartedAt = performance.now();
  const counts = projects.reduce(
    (accumulator, project) => {
      const groupSlug = project.status?.group?.slug;

      if (groupSlug === defaultProjectStatusGroupSlugs.pending) {
        accumulator.pending += 1;
      } else if (groupSlug === defaultProjectStatusGroupSlugs.onHold) {
        accumulator.onHold += 1;
      } else if (
        groupSlug === defaultProjectStatusGroupSlugs.completed ||
        groupSlug === defaultProjectStatusGroupSlugs.archived
      ) {
        accumulator.completed += 1;
      } else if (groupSlug === defaultProjectStatusGroupSlugs.active) {
        accumulator.ongoing += 1;
      }

      return accumulator;
    },
    {
      ongoing: 0,
      onHold: 0,
      pending: 0,
      completed: 0,
    },
  );

  const result = {
    total: projects.length,
    ongoing: counts.ongoing,
    onHold: counts.onHold,
    pending: counts.pending,
    completed: counts.completed,
  };
  logProjectTiming("sidebar count mapping", mappingStartedAt);
  logProjectTiming("sidebar count total", startedAt);
  return result;
}

export async function getRecentProjects(limit = 5, currentUser?: ProjectAccessUser) {
  const accessibleWhere = buildAccessibleProjectsWhere(currentUser);
  const projects = await unstable_cache(
    async () =>
      withPrismaRetry(() =>
        prisma.project.findMany({
          where: accessibleWhere,
          orderBy: {
            createdAt: "desc",
          },
          take: limit,
          select: {
            id: true,
            name: true,
            status: {
              select: {
                id: true,
                name: true,
                slug: true,
                color: true,
                group: {
                  select: projectStatusGroupSelect,
                },
              },
            },
            category: true,
            tags: {
              include: {
                tag: true,
              },
            },
            createdAt: true,
          },
        }),
      ),
    [
      "recent-projects",
      String(limit),
      currentUser?.id ?? "all",
      currentUser?.role ?? "all",
    ],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  )();

  return projects.map((project, index) => {
    const tags = getProjectTagNames(project);
    const tagLabel = formatProjectTagsLabel(tags);

    return {
      id: project.id,
      name: project.name,
      statusLabel: getProjectStatusDisplay(project.status).name,
      meta: [
        project.category,
        tagLabel === "—" ? null : tagLabel,
        `Created ${formatProjectDate(project.createdAt)}`,
      ].filter(Boolean).join(" • "),
      href: `/projects/${project.id}`,
      tone: index < 2 ? "brand" : index < 4 ? "deep" : "muted",
    };
  }) as {
    id: string;
    name: string;
    statusLabel: string;
    meta: string;
    href: string;
    tone: "brand" | "deep" | "muted";
  }[];
}

export async function getProjectsList(
  filter: ProjectsListFilter,
  currentUser: ProjectAccessUser,
) {
  if (!canUseProjects(currentUser)) {
    return { projects: [], total: 0 };
  }

  const startedAt = performance.now();
  const accessibleWhereStartedAt = performance.now();
  const accessibleWhere = buildAccessibleProjectsWhere(currentUser);
  logProjectTiming("accessible where", accessibleWhereStartedAt);

  const filterWhereStartedAt = performance.now();
  const filterWhere = buildProjectsWhere(filter, currentUser.id);
  logProjectTiming("filter where", filterWhereStartedAt);

  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const skip = (page - 1) * PROJECT_LIST_PAGE_SIZE;
  const activeSort = filter.sort ?? "priority";
  const isPrioritySort = activeSort === "priority";
  const orderBy: Prisma.ProjectOrderByWithRelationInput[] = [
    { isPinned: "desc" },
    ...(activeSort === "oldest"
      ? [{ createdAt: "asc" as const }]
      : activeSort === "newest"
        ? [{ createdAt: "desc" as const }]
        : activeSort === "name-asc"
          ? [{ name: "asc" as const }]
          : activeSort === "name-desc"
            ? [{ name: "desc" as const }]
            : [{ updatedAt: "desc" as const }]),
    { id: "asc" },
  ];

  const queryStartedAt = performance.now();
  const where = { AND: [accessibleWhere, filterWhere] };
  const projectCardSelect = {
    id: true,
    name: true,
    priority: true,
    updatedAt: true,
    completedAt: true,
    ownerId: true,
    isPinned: true,
    owner: {
      select: { id: true, name: true, email: true },
    },
    closure: {
      select: { id: true },
    },
    stageInstances: { where: { retiredAt: null }, orderBy: { order: "asc" }, select: { order: true, name: true, status: true } },
    workflowStages: {
      select: {
        stageKey: true,
        status: true,
        unlockedAt: true,
        completedAt: true,
      },
    },
    coOwners: {
      select: { userId: true },
    },
    executors: {
      orderBy: { createdAt: "asc" as const },
      select: {
        userId: true,
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    },
    collaborators: {
      select: { userId: true },
    },
  } satisfies Prisma.ProjectSelect;
  const { projects, total } = await unstable_cache(
    async () =>
      withPrismaRetry(async () => {
        if (!isPrioritySort) {
          const [projects, total] = await Promise.all([
            prisma.project.findMany({
              where,
              select: projectCardSelect,
              orderBy,
              skip,
              take: PROJECT_LIST_PAGE_SIZE,
            }),
            prisma.project.count({ where }),
          ]);
          return { projects, total };
        }

        const candidates = await prisma.project.findMany({
          where,
          select: {
            id: true,
            name: true,
            priority: true,
            updatedAt: true,
            isPinned: true,
            stageInstances: { where: { retiredAt: null }, orderBy: { order: "asc" }, select: { order: true, name: true, status: true } },
    workflowStages: {
              select: {
                stageKey: true,
                status: true,
                unlockedAt: true,
                completedAt: true,
              },
            },
          },
        });
        const pageIds = candidates
          .map((project) => ({
            project,
            isCompleted:
              deriveProjectListWorkflowState(project).businessStatus === "COMPLETED",
          }))
          .sort((left, right) =>
            compareProjectsByPriority(
              {
                id: left.project.id,
                name: left.project.name,
                priority: left.project.priority,
                isCompleted: left.isCompleted,
                isPinned: left.project.isPinned,
                updatedAt: left.project.updatedAt,
              },
              {
                id: right.project.id,
                name: right.project.name,
                priority: right.project.priority,
                isCompleted: right.isCompleted,
                isPinned: right.project.isPinned,
                updatedAt: right.project.updatedAt,
              },
            ),
          )
          .slice(skip, skip + PROJECT_LIST_PAGE_SIZE)
          .map(({ project }) => project.id);

        if (pageIds.length === 0) {
          return { projects: [], total: candidates.length };
        }

        const pageRecords = await prisma.project.findMany({
          where: { id: { in: pageIds } },
          select: projectCardSelect,
        });
        const pageRecordById = new Map(
          pageRecords.map((project) => [project.id, project] as const),
        );

        return {
          projects: pageIds.flatMap((id) => {
            const project = pageRecordById.get(id);
            return project ? [project] : [];
          }),
          total: candidates.length,
        };
      }),
    [
      "projects-list-v3-priority-dashboard",
      filter.status ?? "all",
      filter.query?.trim().toLowerCase() ?? "",
      String(filter.stage ?? "all"),
      filter.ownerId?.trim() ?? "",
      filter.executorId?.trim() ?? "",
      filter.myRole ?? "all",
      activeSort,
      String(page),
      String(PROJECT_LIST_PAGE_SIZE),
      currentUser.id,
      currentUser.role,
    ],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  )();
  logProjectTiming("project query", queryStartedAt, {
    projects: projects.length,
    total,
    page,
    pageSize: PROJECT_LIST_PAGE_SIZE,
  });

  const mappingStartedAt = performance.now();
  const mappedProjects = projects.map((project) =>
    mapProjectToCard(project, currentUser),
  );
  logProjectTiming("mapping", mappingStartedAt, {
    projects: mappedProjects.length,
  });
  logProjectTiming("total", startedAt);

  return { projects: mappedProjects, total };
}

export async function getProjectById(
  id: string,
  currentUser: ProjectAccessUser,
) {
  const project = await unstable_cache(
    async () =>
      withPrismaRetry(() =>
        prisma.project.findUnique({
          where: { id },
          include: {
            status: {
              select: {
                id: true,
                name: true,
                slug: true,
                color: true,
                group: {
                  select: projectStatusGroupSelect,
                },
              },
            },
            tags: {
              include: {
                tag: true,
              },
            },
            createdBy: {
              select: {
                name: true,
                email: true,
              },
            },
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            coOwners: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            executors: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            stages: {
              include: {
                startedBy: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
                invoiceRequests: {
                  include: {
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
                },
              },
            },
            collaborators: {
              orderBy: {
                createdAt: "asc",
              },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            attachments: {
              where: {
                assetType: {
                  in: [
                    "GENERAL_PROJECT_ASSET" as AttachmentAssetType,
                    "STAGE_INVOICE" as AttachmentAssetType,
                  ],
                },
                status: "READY" as AttachmentStatus,
              },
              orderBy: {
                createdAt: "desc",
              },
              select: {
                id: true,
                stageId: true,
                revisionId: true,
                commentId: true,
                assetType: true,
                originalFileName: true,
                mimeType: true,
                fileSize: true,
                createdAt: true,
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
    ["project-by-id", id, currentUser.id, currentUser.role],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  )();

  if (!project) {
    return null;
  }

  if (!canAccessProjectRecord(project, currentUser)) {
    return null;
  }

  const visibleAttachments = await getProjectAttachmentsVisibleToUser(
    currentUser,
    project,
  );
  const favoritedAttachmentIds = await getFavoriteAttachmentIdSetForUser(
    currentUser.id,
    visibleAttachments.map((attachment) => attachment.id),
  );

  return mapProjectToFlow(
    {
      ...project,
      attachments: visibleAttachments,
    },
    currentUser,
    favoritedAttachmentIds,
  );
}

export async function getProjectShellById(
  id: string,
  currentUser: ProjectAccessUser,
) {
  const project = await unstable_cache(
    async () =>
      withPrismaRetry(() =>
        prisma.project.findUnique({
          where: { id },
          include: {
            status: {
              select: {
                id: true,
                name: true,
                slug: true,
                color: true,
                group: {
                  select: projectStatusGroupSelect,
                },
              },
            },
            tags: {
              include: {
                tag: true,
              },
            },
            createdBy: {
              select: {
                name: true,
                email: true,
              },
            },
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            coOwners: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            executors: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            stageInstances: { where: { retiredAt: null }, orderBy: { order: "asc" }, select: { order: true, name: true, status: true } },
    workflowStages: {
              orderBy: {
                createdAt: "asc",
              },
            },
            stages: {
              include: {
                startedBy: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
                invoiceRequests: {
                  include: {
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
                },
              },
            },
            collaborators: {
              orderBy: {
                createdAt: "asc",
              },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        }),
      ),
    ["project-shell-by-id", id, currentUser.id, currentUser.role],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  )();

  if (!project) {
    return null;
  }

  if (!canAccessProjectRecord(project, currentUser)) {
    return null;
  }

  return mapProjectToFlow(
    {
      ...project,
      attachments: [],
    },
    currentUser,
  );
}

function mapProjectToStageShell(
  project: ProjectStageAccessRecord,
  currentUser: ProjectAccessUser,
): ProjectStageShellRecord {
  const canViewChatVisibilityState = hasProjectPermission(
    currentUser,
    project,
    "collaborator.pauseVisibility",
  );
  const canViewParticipants = hasProjectPermission(
    currentUser,
    project,
    "project.viewParticipants",
  );
  const rawExecutors = getProjectExecutorRecords(project);
  const executorsWithVisibleState = canViewChatVisibilityState
    ? rawExecutors
    : rawExecutors.map(maskExecutorVisibilityState);
  const executors = canViewParticipants
    ? executorsWithVisibleState
    : executorsWithVisibleState.filter((executor) => executor.id === currentUser.id);
  const rawCollaborators = project.collaborators
    .map(mapProjectCollaboratorAssignmentToRecord)
    .filter(
      (collaborator, index, records) =>
        records.findIndex((record) => record.id === collaborator.id) === index,
    );
  const collaboratorsWithVisibleState = canViewChatVisibilityState
    ? rawCollaborators
    : rawCollaborators.map(maskCollaboratorVisibilityState);
  const visibleCollaborators = canViewParticipants
    ? collaboratorsWithVisibleState
    : collaboratorsWithVisibleState.filter(
        (collaborator) => collaborator.id === currentUser.id,
      );
  const ownerRecords = [
    ...(project.owner
      ? [mapProjectOwnerToRecord(project.owner, "Project Owner")]
      : []),
    ...project.coOwners.map(({ user }) =>
      mapProjectOwnerToRecord(user, "Project Co-Owner"),
    ),
  ];
  const visibleOwnerRecords = canViewParticipants
    ? ownerRecords
    : ownerRecords.filter((owner) => owner.id === currentUser.id);
  const editingLocked = Boolean(
    project.completedAt ||
      project.archivedAt ||
      isProjectStatusCompleted(project.status),
  );

  return {
    id: project.id,
    ownerId: project.ownerId,
    canEdit:
      !editingLocked &&
      hasProjectPermission(currentUser, project, "project.update"),
    executors,
    templateName: project.templateName,
    templateKey: project.templateKey,
    structureApproval: project.structureApproval,
    canManageStages: canManageProjectStages(currentUser, project),
    stageInstances: canManageProjectStages(currentUser, project) ? project.stageInstances.map(stage => ({ ...stage, skippedAt: toProjectIsoString(stage.skippedAt) })) : [],
    workflowStages: project.workflowStages.map((stage) => ({
      ...stage,
      unlockedAt: toProjectIsoString(stage.unlockedAt),
      completedAt: toProjectIsoString(stage.completedAt),
    })),
    canViewParticipants,
    title: project.name,
    collaborators: [...visibleOwnerRecords, ...visibleCollaborators],
  };
}

export const getProjectStageShellById = cache(
  async (id: string, currentUser: ProjectAccessUser) => {
    const project = await getProjectStageAccessRecordById(id);

    if (!project || !canAccessProjectRecord(project, currentUser)) {
      return null;
    }

    return mapProjectToStageShell(project, currentUser);
  },
);

export async function getProjectChatShellById(
  id: string,
  currentUser: ProjectAccessUser,
  options: ProjectStageSelection = {},
) {
  const taskerStageIds = [...(options.taskerStageIds ?? [])].sort();
  const participantUserIds = [...(options.participantUserIds ?? [])].sort();
  const limitParticipants = options.participantUserIds !== undefined;
  const includeStageInvoiceData = options.includeStageInvoiceData !== false;
  const project = await unstable_cache(
    async () =>
      withPrismaRetry(() =>
        prisma.project.findUnique({
          where: { id },
          include: {
            status: {
              select: {
                id: true,
                name: true,
                slug: true,
                color: true,
                group: {
                  select: projectStatusGroupSelect,
                },
              },
            },
            createdBy: {
              select: {
                name: true,
                email: true,
              },
            },
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            coOwners: {
              where: limitParticipants
                ? { userId: { in: participantUserIds } }
                : undefined,
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            executors: {
              where: limitParticipants
                ? { userId: { in: participantUserIds } }
                : undefined,
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            stages: {
              where:
                taskerStageIds.length > 0
                  ? { id: { in: taskerStageIds } }
                  : undefined,
              orderBy: {
                order: "asc",
              },
              include: {
                _count: {
                  select: {
                    revisions: true,
                    comparisonComments: true,
                  },
                },
                startedBy: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
                invoiceRequests: {
                  where: includeStageInvoiceData
                    ? undefined
                    : { id: { in: [] } },
                  include: {
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
                },
              },
            },
            collaborators: {
              where: limitParticipants
                ? { userId: { in: participantUserIds } }
                : undefined,
              orderBy: {
                createdAt: "asc",
              },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            attachments: {
              where: {
                stageId:
                  taskerStageIds.length > 0
                    ? { in: taskerStageIds }
                    : undefined,
                assetType: {
                  in: includeStageInvoiceData
                    ? [
                        "GENERAL_PROJECT_ASSET" as AttachmentAssetType,
                        "STAGE_INVOICE" as AttachmentAssetType,
                      ]
                    : ["GENERAL_PROJECT_ASSET" as AttachmentAssetType],
                },
                status: "READY" as AttachmentStatus,
              },
              orderBy: {
                createdAt: "desc",
              },
              select: {
                id: true,
                stageId: true,
                revisionId: true,
                commentId: true,
                assetType: true,
                originalFileName: true,
                mimeType: true,
                fileSize: true,
                createdAt: true,
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
    [
      "project-chat-shell-by-id-v3",
      id,
      currentUser.id,
      currentUser.role,
      taskerStageIds.join(",") || "workflow-stages",
      participantUserIds.join(",") || "all-participants",
      includeStageInvoiceData ? "with-stage-invoices" : "without-stage-invoices",
    ],
    { revalidate: 20, tags: [PROJECTS_CACHE_TAG] },
  )();

  if (!project) {
    return null;
  }

  if (!canAccessProjectRecord(project, currentUser)) {
    return null;
  }

  const visibleAttachments = await getProjectAttachmentsVisibleToUser(
    currentUser,
    project,
  );
  const favoritedAttachmentIds = await getFavoriteAttachmentIdSetForUser(
    currentUser.id,
    visibleAttachments.map((attachment) => attachment.id),
  );

  return mapProjectToFlow(
    {
      ...project,
      attachments: visibleAttachments,
      tags: [],
    },
    currentUser,
    favoritedAttachmentIds,
    taskerStageIds.length > 0 ? { taskerStageIds } : undefined,
  );
}

export async function getProjectRouteAvailability(
  id: string,
  currentUser: ProjectAccessUser,
): Promise<"available" | "not-found" | "access-unavailable"> {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: { id },
      select: {
        ownerId: true,
        coOwners: {
          select: { userId: true },
        },
        executors: {
          select: {
            userId: true,
          },
        },
        collaborators: {
          select: projectCollaboratorPermissionSelect,
        },
      },
    }),
  );

  if (!project) {
    return "not-found";
  }

  return canAccessProjectRecord(project, currentUser)
    ? "available"
    : "access-unavailable";
}

import {
  ActivityLogAction,
  AttachmentAssetType,
  AttachmentStatus,
  Prisma,
  ProductionApprovalStepStatus,
  ProductionDispatchStatus,
  ProjectProductionUnitStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  SubmissionReviewStatus,
} from "@prisma/client";

import {
  type PermissionUser,
} from "@/lib/permissions/resolver";
import {
  canCompleteProjectConceptStage,
  canManageProjectConcept,
  canReviewProjectConcept,
  canViewProjectConcept,
  getProjectConceptParticipantUserIds,
  type ConceptAccessContext,
} from "@/lib/project-concept-access";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { sanitizeRichText } from "@/lib/rich-text";
import { getWorkflowStageCompletionMode } from "@/lib/project-workflow";
import {
  getProjectStageAccessRecordById,
  projectStageAccessSelect,
  type ProjectStageAccessRecord,
} from "@/lib/project-stage-data";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";
import { isAllowedStageSubmissionFile } from "@/lib/upload-validation";
import { hasStageFiveDownstreamActivityForAttachment } from "@/lib/stage-five";
import { deleteObjectIfNeeded } from "@/lib/storage/s3";
import { isProjectStatusCompleted } from "@/lib/project-statuses";

export type ProjectConceptAttachmentReference = {
  id: string;
  name: string;
  mimeType: string;
  fileSize: number;
  previewPath: string;
  downloadPath: string;
};

export type ProjectConceptStageThreeReference =
  ProjectConceptAttachmentReference & {
    sourceConceptId: string;
    sourceConceptName: string;
  };

export type ProjectConceptStartingReference =
  ProjectConceptStageThreeReference & {
    importedAt: string;
    importedBy: {
      id: string;
      name: string | null;
      email: string;
      avatarUrl: string | null;
    } | null;
  };

export type ConceptWorkflowStageKey =
  | typeof ProjectWorkflowStageKey.CONCEPT_CREATION
  | typeof ProjectWorkflowStageKey.PROJECT_DEVELOPMENT;

export type ConceptApprovalRevocationReason =
  | "NOT_APPROVED"
  | "UNAUTHORIZED"
  | "STAGE6_PRODUCTION_STARTED"
  | "STAGE5_DEPENDENCY_EXISTS"
  | "PROJECT_STATE_INVALID";

export type ConceptApprovalRevocationEligibility =
  | { canRevoke: true; reason: null }
  | { canRevoke: false; reason: ConceptApprovalRevocationReason };

export type ProjectConceptFolderRecord = {
  id: string;
  name: string;
  deadline: Date | null;
  canDelete: boolean;
  sortOrder: number;
  taskerStageId: string;
  assignedExecutorId: string | null;
  assignedExecutor: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
  brief: string | null;
  actualStartedAt: Date | null;
  latestRevisionStatus: ProjectRevisionStatus | null;
  approvedAttachment: ProjectConceptAttachmentReference | null;
  approvedBy: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  approvedAt: Date | null;
  completedWithoutFileAt: Date | null;
  canCompleteWithoutFile: boolean;
  completionRequest: ConceptCompletionRequest | null;
  canRequestCompletion: boolean;
  sourceStage3Concept: { id: string; name: string } | null;
  startingReference: ProjectConceptAttachmentReference | null;
  briefAttachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    fileSize: number;
  }>;
};

export type ConceptCompletionRequest = { requestedAt: string; note: string | null };

export type ProjectConceptChatMode = {
  type: "concept";
  stageNeutral?: boolean;
  folderId: string;
  workflowStageKey: ConceptWorkflowStageKey;
  stageNumber: 3 | 4;
  stageLabel: "Stage 3 - Initial Concept" | "Stage 4 - Final Concept";
  conceptName: string;
  assignedExecutor: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
  canManage: boolean;
  canReview: boolean;
  isAssignedExecutor: boolean;
  participantUserIds: string[];
  approvedAttachmentId: string | null;
  completedWithoutFile: boolean;
  canCompleteWithoutFile: boolean;
  completionRequest: ConceptCompletionRequest | null;
  canRequestCompletion: boolean;
  approvalRevocationEligibility: ConceptApprovalRevocationEligibility;
  isWorkflowCompleted: boolean;
  startingReference: ProjectConceptStartingReference | null;
  availableStageThreeReferences: ProjectConceptStageThreeReference[];
  backHref: string;
  backLabel?: string;
  compareHref: string;
};

export const DEFAULT_CONCEPT_FOLDER_NAME = "Concept 1";
export const CONCEPT_FOLDER_NAME_MAX_LENGTH = 120;

type ConceptProject = ProjectStageAccessRecord;

function isSupportedConceptStageKey(
  stageKey: ProjectWorkflowStageKey,
): stageKey is ConceptWorkflowStageKey {
  return (
    stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION ||
    stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT
  );
}

function cleanConceptFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeConceptFolderName(value: string) {
  return cleanConceptFolderName(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function validateConceptFolderName(value: string):
  | { error: string }
  | { name: string; normalizedName: string } {
  const name = cleanConceptFolderName(value);

  if (!name) {
    return { error: "Task name is required." };
  }

  if (name.length > CONCEPT_FOLDER_NAME_MAX_LENGTH) {
    return {
      error: `Task names can be up to ${CONCEPT_FOLDER_NAME_MAX_LENGTH} characters.`,
    };
  }

  return {
    name,
    normalizedName: normalizeConceptFolderName(name),
  };
}

function getWorkflowStageStatus(
  project: ConceptProject,
  stageKey: ConceptWorkflowStageKey,
) {
  return project.workflowStages.find((stage) => stage.stageKey === stageKey)?.status;
}

async function getAuthorizedConceptProject(
  user: PermissionUser,
  projectId: string,
  stageKey: ProjectWorkflowStageKey,
) {
  if (!isSupportedConceptStageKey(stageKey)) {
    return null;
  }

  const project = await getProjectStageAccessRecordById(projectId);

  if (!project) {
    return null;
  }

  if (
    !canOpenImplementedWorkflowStage({
      stageKey,
      status: getWorkflowStageStatus(project, stageKey),
    })
  ) {
    return null;
  }

  return project;
}

function getTaskerStageOrder(stageKey: ConceptWorkflowStageKey, sortOrder: number) {
  const stageBase =
    stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION ? 30_000 : 40_000;

  return stageBase + sortOrder;
}

const formalConceptAttachmentTypes: AttachmentAssetType[] = [
  AttachmentAssetType.REVISION_ORIGINAL,
  AttachmentAssetType.STAGE_SUBMISSION,
];

const conceptCompletionStageSelect = {
  status: true,
  actualStartedAt: true,
  _count: { select: { attachments: { where: {
    assetType: { in: formalConceptAttachmentTypes },
    status: { in: [AttachmentStatus.READY, AttachmentStatus.UPLOADING] },
  } } } },
} satisfies Prisma.ProjectStageSelect;

function isConceptCompletedWithoutFile(folder: {
  completedWithoutFileAt: Date | null;
  taskerStage: { status: StageStatus };
}) {
  return Boolean(folder.completedWithoutFileAt && folder.taskerStage.status === StageStatus.COMPLETED);
}

type FilelessConceptTask = {
  id: string; taskerStageId: string; assignedExecutorId: string | null;
  approvedAttachmentId?: string | null;
  approvedAttachment?: { id: string } | null;
  completedWithoutFileAt: Date | null;
  taskerStage: { status: StageStatus; actualStartedAt: Date | null; _count: { attachments: number } };
};

function isOpenConceptWithoutSubmission(project: ConceptProject, folder: FilelessConceptTask, stageKey: ConceptWorkflowStageKey) {
  return isSupportedConceptStageKey(stageKey) &&
    getWorkflowStageStatus(project, stageKey) === ProjectWorkflowStageStatus.AVAILABLE &&
    !project.completedAt && !project.archivedAt && !isProjectStatusCompleted(project.status) &&
    !folder.approvedAttachmentId && !folder.approvedAttachment && !folder.completedWithoutFileAt &&
    folder.taskerStage.status !== StageStatus.COMPLETED && folder.taskerStage._count.attachments === 0;
}

function canCompleteConceptWithoutFile(user: PermissionUser, project: ConceptProject, folder: FilelessConceptTask, stageKey: ConceptWorkflowStageKey) {
  return canCompleteProjectConceptStage(user, getConceptAccessContext(project, folder, stageKey)) &&
    isOpenConceptWithoutSubmission(project, folder, stageKey);
}

function canRequestConceptCompletion(user: PermissionUser, project: ConceptProject, folder: FilelessConceptTask & { completionRequestedAt: Date | null }, stageKey: ConceptWorkflowStageKey) {
  return folder.assignedExecutorId === user.id && Boolean(folder.taskerStage.actualStartedAt) &&
    !folder.completionRequestedAt && isOpenConceptWithoutSubmission(project, folder, stageKey);
}

function mapCompletionRequest(folder: {
  completionRequestedAt: Date | null; completionRequestNote: string | null;
  taskerStage: { status: StageStatus };
}): ConceptCompletionRequest | null {
  return folder.completionRequestedAt && folder.taskerStage.status !== StageStatus.COMPLETED
    ? { requestedAt: folder.completionRequestedAt.toISOString(), note: folder.completionRequestNote }
    : null;
}

const conceptFolderSelect = {
  id: true,
  name: true,
  createdById: true,
  sortOrder: true,
  taskerStageId: true,
  assignedExecutorId: true,
  approvedAt: true,
  completedWithoutFileAt: true,
  completionRequestedAt: true,
  completionRequestNote: true,
  approvedBy: {
    select: { id: true, name: true, email: true },
  },
  approvedAttachment: {
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
    },
  },
  sourceStage3Concept: {
    select: { id: true, name: true },
  },
  promotedStage4Concept: {
    select: { id: true },
  },
  sourceStage3ApprovedAttachment: {
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
    },
  },
  assignedExecutor: {
    select: {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
  },
  taskerStage: {
    select: {
      ...conceptCompletionStageSelect,
      description: true,
      actualStartedAt: true,
      plannedDueAt: true,
      revisions: {
        orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { status: true },
      },
      attachments: {
        where: {
          revisionId: null,
          commentId: null,
          assetType: "GENERAL_PROJECT_ASSET",
          status: "READY",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
        },
      },
    },
  },
} satisfies Prisma.ProjectConceptFolderSelect;

function mapConceptAttachmentReference(attachment: {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
}): ProjectConceptAttachmentReference {
  return {
    id: attachment.id,
    name: attachment.originalFileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    previewPath: `/api/project-assets/${attachment.id}/preview`,
    downloadPath: `/api/project-assets/${attachment.id}/download`,
  };
}

function getConceptAccessContext(
  project: ConceptProject,
  folder: { id: string; taskerStageId: string; assignedExecutorId: string | null },
  stageKey: ConceptWorkflowStageKey,
): ConceptAccessContext {
  return {
    folderId: folder.id,
    projectId: project.id,
    taskerStageId: folder.taskerStageId,
    workflowStageKey: stageKey,
    assignedExecutorId: folder.assignedExecutorId,
    ownerId: project.ownerId,
    coOwnerIds: project.coOwners.map((coOwner) => coOwner.userId),
  };
}

function mapConceptFolder(
  folder: Prisma.ProjectConceptFolderGetPayload<{
    select: typeof conceptFolderSelect;
  }>,
  currentUserId: string,
  canCompleteWithoutFile = false,
  canRequestCompletion = false,
): ProjectConceptFolderRecord {
  return {
    id: folder.id,
    name: folder.name,
    deadline: folder.taskerStage.plannedDueAt,
    canDelete:
      folder.createdById === currentUserId && !folder.promotedStage4Concept,
    sortOrder: folder.sortOrder,
    taskerStageId: folder.taskerStageId,
    assignedExecutorId: folder.assignedExecutorId,
    assignedExecutor: folder.assignedExecutor?.user ?? null,
    brief: folder.taskerStage.description,
    actualStartedAt: folder.taskerStage.actualStartedAt,
    latestRevisionStatus: folder.taskerStage.revisions[0]?.status ?? null,
    approvedAttachment: folder.approvedAttachment
      ? mapConceptAttachmentReference(folder.approvedAttachment)
      : null,
    approvedBy: folder.approvedBy,
    approvedAt: folder.approvedAt,
    completedWithoutFileAt: isConceptCompletedWithoutFile(folder) ? folder.completedWithoutFileAt : null,
    canCompleteWithoutFile,
    completionRequest: mapCompletionRequest(folder),
    canRequestCompletion,
    sourceStage3Concept: folder.sourceStage3Concept,
    startingReference: folder.sourceStage3ApprovedAttachment
      ? mapConceptAttachmentReference(folder.sourceStage3ApprovedAttachment)
      : null,
    briefAttachments: folder.taskerStage.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.originalFileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
    })),
  };
}

export async function getProjectConceptFolders(
  user: PermissionUser,
  projectId: string,
  stageKey: ConceptWorkflowStageKey,
  options: { executorId?: string | null } = {},
) {
  const project = await getAuthorizedConceptProject(user, projectId, stageKey);
  if (!project) {
    return null;
  }

  const managerContext: ConceptAccessContext = {
    folderId: "",
    projectId,
    taskerStageId: "",
    workflowStageKey: stageKey,
    assignedExecutorId: null,
    ownerId: project.ownerId,
    coOwnerIds: project.coOwners.map((coOwner) => coOwner.userId),
  };
  const canManage = canManageProjectConcept(user, managerContext);
  const canCompleteStage = canCompleteProjectConceptStage(user, managerContext) &&
    !project.completedAt && !project.archivedAt && !isProjectStatusCompleted(project.status);
  const isProjectExecutor = project.executors.some(
    (executor) => executor.userId === user.id,
  );
  const requestedExecutor = options.executorId?.trim() || null;
  const requestedExecutorId = canManage
    ? requestedExecutor &&
      project.executors.some((executor) => executor.userId === requestedExecutor)
      ? requestedExecutor
      : null
    : user.id;
  const folders = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findMany({
      where: {
        projectId,
        workflowStageKey: stageKey,
        ...(canManage ? {} : { assignedExecutorId: user.id }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: conceptFolderSelect,
    }),
  );

  const visibleFolders = folders.filter((folder) =>
    canViewProjectConcept(user, getConceptAccessContext(project, folder, stageKey)),
  );
  const displayedFolders = requestedExecutorId
    ? visibleFolders.filter(
        (folder) => folder.assignedExecutorId === requestedExecutorId,
      )
    : visibleFolders;

  if (!canManage && !isProjectExecutor && visibleFolders.length === 0) {
    return null;
  }

  return {
    folders: displayedFolders.map((folder) => mapConceptFolder(folder, user.id,
      canCompleteConceptWithoutFile(user, project, folder, stageKey),
      canRequestConceptCompletion(user, project, folder, stageKey))),
    canManage,
    canCompleteStage,
    workflowStatus: getWorkflowStageStatus(project, stageKey) ?? null,
    completionConcepts: canCompleteStage
      ? visibleFolders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          isApproved: Boolean(folder.approvedAttachment),
          completedWithoutFile: isConceptCompletedWithoutFile(folder),
          canCompleteWithoutFile: canCompleteConceptWithoutFile(user, project, folder, stageKey),
        }))
      : [],
    selectedExecutorId: requestedExecutorId,
    executors: canManage
      ? project.executors.map((executor) => ({
          id: executor.user.id,
          name: executor.user.name,
          email: executor.user.email,
          avatarUrl: executor.user.avatarUrl,
        }))
      : [],
  };
}

export async function createProjectConceptFolder(
  user: PermissionUser,
  input: {
    projectId: string;
    stageKey: ConceptWorkflowStageKey;
    name: string;
    assignedExecutorId: string;
    deadline: string;
    brief?: string | null;
    briefAttachmentIds?: string[];
  },
) {
  const validatedName = validateConceptFolderName(input.name);

  if ("error" in validatedName) {
    return validatedName;
  }

  const project = await getAuthorizedConceptProject(
    user,
    input.projectId,
    input.stageKey,
  );

  const managerContext: ConceptAccessContext | null = project
    ? {
        folderId: "",
        projectId: input.projectId,
        taskerStageId: "",
        workflowStageKey: input.stageKey,
        assignedExecutorId: null,
        ownerId: project.ownerId,
        coOwnerIds: project.coOwners.map((coOwner) => coOwner.userId),
      }
    : null;

  if (!project || !managerContext || !canManageProjectConcept(user, managerContext)) {
    return { error: "You do not have permission to create concept tasks." } as const;
  }

  if (
    getWorkflowStageStatus(project, input.stageKey) ===
    ProjectWorkflowStageStatus.COMPLETED
  ) {
    return {
      error: `Concept management is locked because ${
        input.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
          ? "Stage 3"
          : "Stage 4"
      } is completed.`,
    } as const;
  }

  const assignedExecutorId = input.assignedExecutorId.trim();
  if (!assignedExecutorId) {
    return { error: "Assigned Executor is required." } as const;
  }

  if (!project.executors.some((executor) => executor.userId === assignedExecutorId)) {
    return { error: "Assigned Executor must be a current project executor." } as const;
  }

  const brief = sanitizeRichText(input.brief) || null;
  if (!brief) {
    return { error: "Concept Brief is required." } as const;
  }

  const deadline = new Date(input.deadline);
  if (Number.isNaN(deadline.getTime())) {
    return { error: "Deadline must be a valid date and time." } as const;
  }
  if (deadline.getTime() <= Date.now()) {
    return { error: "Deadline must be in the future." } as const;
  }

  const briefAttachmentIds = [
    ...new Set(
      (input.briefAttachmentIds ?? [])
        .map((attachmentId) => attachmentId.trim())
        .filter(Boolean),
    ),
  ];

  try {
    const folder = await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const duplicate = await tx.projectConceptFolder.findUnique({
            where: {
              projectId_workflowStageKey_normalizedName: {
                projectId: input.projectId,
                workflowStageKey: input.stageKey,
                normalizedName: validatedName.normalizedName,
              },
            },
            select: { id: true },
          });

          if (duplicate) {
            throw new Error("DUPLICATE_CONCEPT_FOLDER");
          }

          const lastFolder = await tx.projectConceptFolder.findFirst({
            where: {
              projectId: input.projectId,
              workflowStageKey: input.stageKey,
            },
            orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
            select: { sortOrder: true },
          });
          const sortOrder = (lastFolder?.sortOrder ?? 0) + 1;
          if (briefAttachmentIds.length > 0) {
            const stagedAttachments = await tx.projectAttachment.findMany({
              where: {
                id: { in: briefAttachmentIds },
                projectId: input.projectId,
                stageId: null,
                revisionId: null,
                commentId: null,
                uploadedById: user.id,
                assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
                status: AttachmentStatus.READY,
              },
              select: { id: true },
            });

            if (stagedAttachments.length !== briefAttachmentIds.length) {
              throw new Error("INVALID_CONCEPT_BRIEF_ATTACHMENTS");
            }
          }

          const taskerStage = await tx.projectStage.create({
            data: {
              projectId: input.projectId,
              name: validatedName.name,
              description: brief,
              plannedDueAt: deadline,
              invoiceRequired: false,
              isTasker: true,
              actualStartedAt: null,
              startedById: null,
              status: StageStatus.ONGOING,
              order: getTaskerStageOrder(input.stageKey, sortOrder),
            },
            select: { id: true },
          });

          const folder = await tx.projectConceptFolder.create({
            data: {
              projectId: input.projectId,
              workflowStageKey: input.stageKey,
              taskerStageId: taskerStage.id,
              assignedExecutorId,
              name: validatedName.name,
              normalizedName: validatedName.normalizedName,
              sortOrder,
              createdById: user.id,
            },
            select: { id: true },
          });
          if (briefAttachmentIds.length > 0) {
            const attached = await tx.projectAttachment.updateMany({
              where: {
                id: { in: briefAttachmentIds },
                projectId: input.projectId,
                stageId: null,
                uploadedById: user.id,
                assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
                status: AttachmentStatus.READY,
              },
              data: { stageId: taskerStage.id },
            });

            if (attached.count !== briefAttachmentIds.length) {
              throw new Error("INVALID_CONCEPT_BRIEF_ATTACHMENTS");
            }
          }

          return tx.projectConceptFolder.findUniqueOrThrow({
            where: { id: folder.id },
            select: conceptFolderSelect,
          });
        },
        { maxWait: 5_000, timeout: 15_000 },
      ),
    );

    return { folder: mapConceptFolder(folder, user.id, canCompleteConceptWithoutFile(user, project, folder, input.stageKey)) } as const;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "INVALID_CONCEPT_BRIEF_ATTACHMENTS"
    ) {
      return {
        error:
          "Every Brief Attachment must finish uploading before the concept can be created.",
      } as const;
    }

    if (
      (error instanceof Error && error.message === "DUPLICATE_CONCEPT_FOLDER") ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      return { error: "A concept task with this name already exists." } as const;
    }

    throw error;
  }
}

export async function deleteProjectConceptFolder(
  user: PermissionUser,
  input: {
    projectId: string;
    stageKey: ConceptWorkflowStageKey;
    folderId: string;
  },
) {
  const project = await getAuthorizedConceptProject(
    user,
    input.projectId,
    input.stageKey,
  );

  if (!project) {
    return { error: "You do not have permission to delete this task." } as const;
  }

  try {
    const result = await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const workflowStage = await tx.projectWorkflowStage.findUnique({
            where: {
              projectId_stageKey: {
                projectId: input.projectId,
                stageKey: input.stageKey,
              },
            },
            select: { status: true },
          });

          if (workflowStage?.status === ProjectWorkflowStageStatus.COMPLETED) {
            return {
              error: "Task management is locked because this workflow stage is completed.",
            } as const;
          }

          const folder = await tx.projectConceptFolder.findFirst({
            where: {
              id: input.folderId,
              projectId: input.projectId,
              workflowStageKey: input.stageKey,
            },
            select: {
              id: true,
              name: true,
              taskerStageId: true,
              assignedExecutorId: true,
              createdById: true,
              promotedStage4Concept: { select: { id: true } },
              taskerStage: {
                select: {
                  attachments: {
                    select: { id: true, storageKey: true, bucket: true },
                  },
                },
              },
            },
          });

          if (
            !folder ||
            !canViewProjectConcept(
              user,
              getConceptAccessContext(project, folder, input.stageKey),
            )
          ) {
            return { error: "Task not found." } as const;
          }

          if (folder.createdById !== user.id) {
            return { error: "Only the person who created this task can delete it." } as const;
          }

          if (folder.promotedStage4Concept) {
            return {
              error: "This task cannot be deleted because it is already used in Stage 4.",
            } as const;
          }

          const attachmentStorage = folder.taskerStage.attachments;
          const attachmentIds = attachmentStorage.map((attachment) => attachment.id);

          await tx.notification.deleteMany({
            where: {
              projectId: input.projectId,
              OR: [
                { stageId: folder.taskerStageId },
                { entityId: folder.id },
                ...(attachmentIds.length > 0
                  ? [{ attachmentId: { in: attachmentIds } }]
                  : []),
              ],
            },
          });
          await tx.projectFormDraft.deleteMany({
            where: {
              projectId: input.projectId,
              formKey: `concept-details:${input.stageKey}:${folder.id}`,
            },
          });
          await tx.projectConceptFolder.delete({ where: { id: folder.id } });
          await tx.projectStage.delete({ where: { id: folder.taskerStageId } });

          return {
            folder: {
              id: folder.id,
              name: folder.name,
              taskerStageId: folder.taskerStageId,
            },
            attachmentStorage,
          } as const;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      ),
    );

    if ("error" in result) {
      return result;
    }

    await Promise.allSettled(
      result.attachmentStorage.map((attachment) =>
        deleteObjectIfNeeded(attachment.storageKey, attachment.bucket),
      ),
    );

    return { folder: result.folder } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return {
          error: "This task cannot be deleted because it is already used by later project work.",
        } as const;
      }

      if (error.code === "P2034") {
        return { error: "The task changed at the same time. Please try again." } as const;
      }
    }

    throw error;
  }
}

export async function importStageThreeConceptReference(
  user: PermissionUser,
  input: {
    projectId: string;
    folderId: string;
    sourceConceptId: string;
  },
) {
  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const folder = await tx.projectConceptFolder.findFirst({
            where: {
              id: input.folderId,
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
              taskerStage: { projectId: input.projectId, isTasker: true },
            },
            select: {
              id: true,
              taskerStageId: true,
              assignedExecutorId: true,
              sourceStage3ConceptId: true,
              sourceStage3ApprovedAttachmentId: true,
              sourceStage3ImportedAt: true,
              sourceStage3ImportedById: true,
              project: {
                select: {
                  ownerId: true,
                  coOwners: { select: { userId: true } },
                  workflowStages: {
                    where: {
                      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                    },
                    select: { status: true },
                  },
                },
              },
            },
          });

          if (!folder) {
            return { error: "Stage 4 concept not found." } as const;
          }

          const accessContext: ConceptAccessContext = {
            folderId: folder.id,
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            assignedExecutorId: folder.assignedExecutorId,
            ownerId: folder.project.ownerId,
            coOwnerIds: folder.project.coOwners.map((coOwner) => coOwner.userId),
          };

          if (!canCompleteProjectConceptStage(user, accessContext)) {
            return {
              error: "Only a project owner, co-owner, or administrator can import an approved Stage 3 concept.",
            } as const;
          }

          if (
            folder.project.workflowStages[0]?.status !==
            ProjectWorkflowStageStatus.AVAILABLE
          ) {
            return { error: "Stage 4 is not currently available." } as const;
          }

          if (folder.sourceStage3ConceptId) {
            if (folder.sourceStage3ConceptId === input.sourceConceptId) {
              if (!folder.sourceStage3ImportedAt) {
                await tx.projectConceptFolder.update({
                  where: { id: folder.id },
                  data: {
                    sourceStage3ImportedAt: new Date(),
                    sourceStage3ImportedById:
                      folder.sourceStage3ImportedById ?? user.id,
                  },
                });
              }
              const existingSource = await tx.projectConceptFolder.findUnique({
                where: { id: input.sourceConceptId },
                select: {
                  id: true,
                  name: true,
                  approvedAttachment: {
                    select: {
                      id: true,
                      originalFileName: true,
                      mimeType: true,
                      fileSize: true,
                    },
                  },
                },
              });

              if (existingSource?.approvedAttachment) {
                return {
                  imported: false,
                  reference: {
                    ...mapConceptAttachmentReference(existingSource.approvedAttachment),
                    sourceConceptId: existingSource.id,
                    sourceConceptName: existingSource.name,
                  },
                } as const;
              }
            }

            return {
              error: "This Stage 4 concept already has an imported Stage 3 reference.",
            } as const;
          }

          const sourceConcept = await tx.projectConceptFolder.findFirst({
            where: {
              id: input.sourceConceptId,
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
              approvedAttachmentId: { not: null },
            },
            select: {
              id: true,
              name: true,
              approvedAttachmentId: true,
              approvedAttachment: {
                select: {
                  id: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                },
              },
            },
          });

          if (!sourceConcept?.approvedAttachmentId || !sourceConcept.approvedAttachment) {
            return {
              error: "Choose a Stage 3 concept that has an Approved Concept file.",
            } as const;
          }

          await tx.projectConceptFolder.update({
            where: { id: folder.id },
            data: {
              sourceStage3ConceptId: sourceConcept.id,
              sourceStage3ApprovedAttachmentId: sourceConcept.approvedAttachmentId,
              sourceStage3ImportedAt: new Date(),
              sourceStage3ImportedById: user.id,
            },
          });

          return {
            imported: true,
            reference: {
              ...mapConceptAttachmentReference(sourceConcept.approvedAttachment),
              sourceConceptId: sourceConcept.id,
              sourceConceptName: sourceConcept.name,
            },
          } as const;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      ),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return {
          error: "That Stage 3 concept is already imported into another Stage 4 concept.",
        } as const;
      }

      if (error.code === "P2034") {
        return {
          error: "The concept reference changed at the same time. Please try again.",
        } as const;
      }
    }

    throw error;
  }
}

export async function renameProjectConceptFolder(
  user: PermissionUser,
  input: {
    projectId: string;
    stageKey: ConceptWorkflowStageKey;
    folderId: string;
    name: string;
  },
) {
  const validatedName = validateConceptFolderName(input.name);

  if ("error" in validatedName) {
    return validatedName;
  }

  return editProjectConceptFolder(user, input);
}

export async function editProjectConceptFolder(
  user: PermissionUser,
  input: {
    projectId: string;
    stageKey: ConceptWorkflowStageKey;
    folderId: string;
    name: string;
    assignedExecutorId?: string;
    deadline?: string;
    brief?: string | null;
  },
) {
  const validatedName = validateConceptFolderName(input.name);

  if ("error" in validatedName) {
    return validatedName;
  }

  const project = await getAuthorizedConceptProject(
    user,
    input.projectId,
    input.stageKey,
  );

  if (!project) {
    return { error: "You do not have permission to rename concept tasks." } as const;
  }

  const folder = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
        workflowStageKey: input.stageKey,
      },
      select: {
        id: true,
        taskerStageId: true,
        assignedExecutorId: true,
        taskerStage: {
          select: {
            actualStartedAt: true,
            status: true,
            description: true,
            plannedDueAt: true,
          },
        },
      },
    }),
  );

  if (!folder) {
    return { error: "Concept task not found." } as const;
  }

  const accessContext = getConceptAccessContext(project, folder, input.stageKey);
  if (!canManageProjectConcept(user, accessContext)) {
    return { error: "You do not have permission to edit concept tasks." } as const;
  }

  if (
    getWorkflowStageStatus(project, input.stageKey) ===
    ProjectWorkflowStageStatus.COMPLETED
  ) {
    return {
      error: "Concept management is locked because this workflow stage is completed.",
    } as const;
  }

  const requestedExecutorId = input.assignedExecutorId?.trim();
  const assignmentChanged =
    requestedExecutorId !== undefined &&
    requestedExecutorId !== folder.assignedExecutorId;
  const requestedBrief =
    input.brief === undefined ? undefined : sanitizeRichText(input.brief) || null;
  if (input.brief !== undefined && !requestedBrief) {
    return { error: "Concept Brief is required." } as const;
  }
  const briefChanged =
    requestedBrief !== undefined && requestedBrief !== folder.taskerStage.description;
  const requestedDeadline =
    input.deadline === undefined
      ? folder.taskerStage.plannedDueAt
      : new Date(input.deadline);
  if (input.deadline !== undefined && Number.isNaN(requestedDeadline?.getTime())) {
    return { error: "Deadline must be a valid date and time." } as const;
  }
  const deadlineChanged =
    input.deadline !== undefined &&
    folder.taskerStage.plannedDueAt?.getTime() !== requestedDeadline?.getTime();
  if (deadlineChanged && requestedDeadline && requestedDeadline.getTime() <= Date.now()) {
    return { error: "Deadline must be in the future." } as const;
  }

  if (requestedExecutorId === "") {
    return { error: "Assigned Executor is required." } as const;
  }

  if (
    requestedExecutorId &&
    !project.executors.some((executor) => executor.userId === requestedExecutorId)
  ) {
    return { error: "Assigned Executor must be a current project executor." } as const;
  }

  if ((folder.taskerStage.actualStartedAt || folder.taskerStage.status === StageStatus.COMPLETED) && (briefChanged || (assignmentChanged && folder.assignedExecutorId))) {
    return {
      error: "Assigned Executor and Concept Brief are locked after work starts.",
    } as const;
  }

  try {
    await withPrismaRetry(() =>
      prisma.$transaction([
        prisma.projectConceptFolder.update({
          where: { id: folder.id },
          data: {
            name: validatedName.name,
            normalizedName: validatedName.normalizedName,
            ...(requestedExecutorId !== undefined
              ? { assignedExecutorId: requestedExecutorId }
              : {}),
          },
        }),
        prisma.projectStage.update({
          where: { id: folder.taskerStageId },
          data: {
            name: validatedName.name,
            ...(input.deadline !== undefined
              ? { plannedDueAt: requestedDeadline }
              : {}),
            ...(requestedBrief !== undefined ? { description: requestedBrief } : {}),
          },
        }),
      ]),
    );

    return {
      folder: {
        id: folder.id,
        name: validatedName.name,
        taskerStageId: folder.taskerStageId,
        assignedExecutorId: requestedExecutorId ?? folder.assignedExecutorId,
        deadline: requestedDeadline,
        assignmentChanged,
      },
    } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A concept task with this name already exists." } as const;
    }

    throw error;
  }
}

type FormalConceptAttachment = {
  id: string;
  projectId: string;
  stageId: string | null;
  revisionId: string | null;
  commentId: string | null;
  assetType: AttachmentAssetType;
  status: AttachmentStatus;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  revision: {
    projectId: string;
    stageId: string;
    status: ProjectRevisionStatus;
  } | null;
};

const formalConceptAttachmentSelect = {
  id: true,
  projectId: true,
  stageId: true,
  revisionId: true,
  commentId: true,
  assetType: true,
  status: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  revision: {
    select: {
      projectId: true,
      stageId: true,
      status: true,
    },
  },
} satisfies Prisma.ProjectAttachmentSelect;

async function approveConceptRevision(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    taskerStageId: string;
    revisionId: string;
    approvedAttachmentId: string;
    reviewedById: string;
    approvedAt: Date;
  },
) {
  await tx.projectRevision.updateMany({
    where: {
      projectId: input.projectId,
      stageId: input.taskerStageId,
      id: { not: input.revisionId },
      status: ProjectRevisionStatus.APPROVED,
    },
    data: {
      status: ProjectRevisionStatus.PENDING_REVIEW,
      reviewedById: null,
      reviewedAt: null,
      rejectionReason: null,
    },
  });
  await tx.projectRevision.update({
    where: { id: input.revisionId },
    data: {
      status: ProjectRevisionStatus.APPROVED,
      reviewedById: input.reviewedById,
      reviewedAt: input.approvedAt,
      rejectionReason: null,
    },
  });
  await tx.projectAttachment.updateMany({
    where: {
      projectId: input.projectId,
      stageId: input.taskerStageId,
      id: { not: input.approvedAttachmentId },
      status: AttachmentStatus.READY,
      assetType: { in: formalConceptAttachmentTypes },
      submissionReviewStatus: SubmissionReviewStatus.APPROVED,
    },
    data: {
      submissionReviewStatus: SubmissionReviewStatus.PENDING_REVIEW,
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    },
  });
  await tx.projectAttachment.update({
    where: { id: input.approvedAttachmentId },
    data: {
      submissionReviewStatus: SubmissionReviewStatus.APPROVED,
      reviewedById: input.reviewedById,
      reviewedAt: input.approvedAt,
      reviewNote: null,
    },
  });
  await tx.projectStage.update({
    where: { id: input.taskerStageId },
    data: {
      status: StageStatus.COMPLETED,
      completedAt: input.approvedAt,
    },
  });
}

function getFormalConceptAttachmentError(input: {
  attachment: FormalConceptAttachment | null;
  projectId: string;
  taskerStageId: string;
  projectCategory: string | null;
  workflowStageKey: ConceptWorkflowStageKey;
}) {
  const attachment = input.attachment;

  if (!attachment) {
    return "The selected concept file was not found.";
  }

  if (
    attachment.projectId !== input.projectId ||
    attachment.stageId !== input.taskerStageId ||
    !attachment.revisionId ||
    attachment.commentId !== null ||
    attachment.status !== AttachmentStatus.READY ||
    !formalConceptAttachmentTypes.includes(attachment.assetType) ||
    !attachment.revision ||
    attachment.revision.projectId !== input.projectId ||
    attachment.revision.stageId !== input.taskerStageId ||
    (attachment.revision.status !== ProjectRevisionStatus.PENDING_REVIEW &&
      attachment.revision.status !== ProjectRevisionStatus.APPROVED) ||
    !isAllowedStageSubmissionFile({
      fileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
      projectCategory: input.projectCategory,
    })
  ) {
    return input.workflowStageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
      ? "Only a ready formal revision file from this Stage 3 concept can be marked as the Approved Concept."
      : "Only a ready formal revision file from this exact Stage 4 concept can be marked as the Final Approved File.";
  }

  return null;
}

export async function markProjectConceptApprovedAttachment(
  user: PermissionUser,
  input: {
    projectId: string;
    folderId: string;
    attachmentId: string;
  },
) {
  try {
    const designation = await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const folder = await tx.projectConceptFolder.findFirst({
            where: {
              id: input.folderId,
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
              taskerStage: { projectId: input.projectId, isTasker: true },
            },
            select: {
              id: true,
              taskerStageId: true,
              assignedExecutorId: true,
              approvedAttachmentId: true,
              approvedById: true,
              approvedAt: true,
              promotedStage4Concept: { select: { id: true } },
              project: {
                select: {
                  category: true,
                  ownerId: true,
                  coOwners: { select: { userId: true } },
                  workflowStages: {
                    where: {
                      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
                    },
                    select: { status: true },
                  },
                },
              },
            },
          });

          if (!folder) {
            return { error: "Stage 3 concept not found." } as const;
          }

          const accessContext: ConceptAccessContext = {
            folderId: folder.id,
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
            assignedExecutorId: folder.assignedExecutorId,
            ownerId: folder.project.ownerId,
            coOwnerIds: folder.project.coOwners.map((coOwner) => coOwner.userId),
          };

          if (!canReviewProjectConcept(user, accessContext)) {
            return {
              error: "You do not have permission to approve concept files.",
            } as const;
          }

          const stageThreeStatus = folder.project.workflowStages[0]?.status;

          if (
            stageThreeStatus === ProjectWorkflowStageStatus.COMPLETED &&
            folder.approvedAttachmentId !== input.attachmentId
          ) {
            return {
              error: "Approved Concept selection is locked because Stage 3 is completed.",
            } as const;
          }

          if (
            stageThreeStatus !== ProjectWorkflowStageStatus.AVAILABLE &&
            stageThreeStatus !== ProjectWorkflowStageStatus.COMPLETED
          ) {
            return { error: "Stage 3 is not currently available." } as const;
          }

          const attachment = await tx.projectAttachment.findUnique({
            where: { id: input.attachmentId },
            select: formalConceptAttachmentSelect,
          });
          const attachmentError = getFormalConceptAttachmentError({
            attachment,
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            projectCategory: folder.project.category,
            workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          });

          if (attachmentError || !attachment) {
            return {
              error:
                attachmentError ?? "The selected concept file was not found.",
            } as const;
          }

          const changed = folder.approvedAttachmentId !== attachment.id;
          const approvedAt = changed
            ? new Date()
            : (folder.approvedAt ?? new Date());
          const reviewedById = changed
            ? user.id
            : (folder.approvedById ?? user.id);

          if (changed) {
            await tx.projectConceptFolder.update({
              where: { id: folder.id },
              data: {
                approvedAttachmentId: attachment.id,
                completedWithoutFileAt: null,
                completionRequestedAt: null,
                completionRequestNote: null,
                approvedById: user.id,
                approvedAt,
              },
            });
            if (folder.promotedStage4Concept) {
              await tx.projectConceptFolder.update({
                where: { id: folder.promotedStage4Concept.id },
                data: { sourceStage3ApprovedAttachmentId: attachment.id },
              });
            }
          }

          await approveConceptRevision(tx, {
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            revisionId: attachment.revisionId!,
            approvedAttachmentId: attachment.id,
            reviewedById,
            approvedAt,
          });
          const unapprovedConceptCount = await tx.projectConceptFolder.count({
            where: {
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
              approvedAttachmentId: null,
              NOT: { completedWithoutFileAt: { not: null }, taskerStage: { status: StageStatus.COMPLETED } },
            },
          });

          return {
            changed,
            folderId: folder.id,
            taskerStageId: folder.taskerStageId,
            assignedExecutorId: folder.assignedExecutorId,
            approvedAt,
            revisionId: attachment.revisionId!,
            revisionStatus: ProjectRevisionStatus.APPROVED,
            allConceptsApproved: unapprovedConceptCount === 0,
            attachment: mapConceptAttachmentReference(attachment),
          } as const;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      ),
    );

    return designation;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return {
          error: "This file is already designated for another concept.",
        } as const;
      }

      if (error.code === "P2034") {
        return {
          error: "The concept changed at the same time. Please try again.",
        } as const;
      }
    }

    throw error;
  }
}

export async function markStageFourFinalApprovedAttachment(
  user: PermissionUser,
  input: {
    projectId: string;
    folderId: string;
    attachmentId: string;
  },
) {
  try {
    const designation = await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const folder = await tx.projectConceptFolder.findFirst({
            where: {
              id: input.folderId,
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
              taskerStage: { projectId: input.projectId, isTasker: true },
            },
            select: {
              id: true,
              taskerStageId: true,
              assignedExecutorId: true,
              approvedAttachmentId: true,
              approvedById: true,
              approvedAt: true,
              project: {
                select: {
                  category: true,
                  ownerId: true,
                  coOwners: { select: { userId: true } },
                  workflowStages: {
                    where: {
                      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                    },
                    select: { status: true },
                  },
                },
              },
            },
          });

          if (!folder) {
            return { error: "Stage 4 concept not found." } as const;
          }

          const accessContext: ConceptAccessContext = {
            folderId: folder.id,
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            assignedExecutorId: folder.assignedExecutorId,
            ownerId: folder.project.ownerId,
            coOwnerIds: folder.project.coOwners.map((coOwner) => coOwner.userId),
          };

          if (!canReviewProjectConcept(user, accessContext)) {
            return {
              error: "You do not have permission to approve final Stage 4 files.",
            } as const;
          }

          const stageFourStatus = folder.project.workflowStages[0]?.status;

          if (
            stageFourStatus === ProjectWorkflowStageStatus.COMPLETED &&
            folder.approvedAttachmentId !== input.attachmentId
          ) {
            return {
              error: "Final Approved File selection is locked because Stage 4 is completed.",
            } as const;
          }

          if (
            stageFourStatus !== ProjectWorkflowStageStatus.AVAILABLE &&
            stageFourStatus !== ProjectWorkflowStageStatus.COMPLETED
          ) {
            return { error: "Stage 4 is not currently available." } as const;
          }

          const attachment = await tx.projectAttachment.findUnique({
            where: { id: input.attachmentId },
            select: formalConceptAttachmentSelect,
          });
          const attachmentError = getFormalConceptAttachmentError({
            attachment,
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            projectCategory: folder.project.category,
            workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          });

          if (attachmentError || !attachment) {
            return {
              error:
                attachmentError ?? "The selected Stage 4 file was not found.",
            } as const;
          }

          const changed = folder.approvedAttachmentId !== attachment.id;
          let removedUnusedHandoff = false;

          if (changed && folder.approvedAttachmentId) {
            const downstream =
              await hasStageFiveDownstreamActivityForAttachment(tx, {
                projectId: input.projectId,
                attachmentId: folder.approvedAttachmentId,
              });

            if (downstream.hasActivity) {
              return {
                error:
                  "This final file already has Stage 5 activity and cannot be replaced directly.",
              } as const;
            }

            if (downstream.handoffId) {
              await tx.projectStageFileHandoff.delete({
                where: { id: downstream.handoffId },
              });
              removedUnusedHandoff = true;
            }
          }

          const approvedAt = changed
            ? new Date()
            : (folder.approvedAt ?? new Date());
          const reviewedById = changed
            ? user.id
            : (folder.approvedById ?? user.id);
          if (changed) {
            await tx.projectConceptFolder.update({
              where: { id: folder.id },
              data: {
                approvedAttachmentId: attachment.id,
                completedWithoutFileAt: null, completionRequestedAt: null, completionRequestNote: null,
                approvedById: user.id,
                approvedAt,
              },
            });
          }

          await approveConceptRevision(tx, {
            projectId: input.projectId,
            taskerStageId: folder.taskerStageId,
            revisionId: attachment.revisionId!,
            approvedAttachmentId: attachment.id,
            reviewedById,
            approvedAt,
          });
          const conceptsWithoutFinalFile = await tx.projectConceptFolder.count({
            where: {
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
              approvedAttachmentId: null,
              NOT: { completedWithoutFileAt: { not: null }, taskerStage: { status: StageStatus.COMPLETED } },
            },
          });

          return {
            changed,
            folderId: folder.id,
            taskerStageId: folder.taskerStageId,
            assignedExecutorId: folder.assignedExecutorId,
            approvedAt,
            removedUnusedHandoff,
            revisionId: attachment.revisionId!,
            revisionStatus: ProjectRevisionStatus.APPROVED,
            allConceptsApproved: conceptsWithoutFinalFile === 0,
            attachment: mapConceptAttachmentReference(attachment),
          } as const;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 20_000,
        },
      ),
    );

    return designation;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return {
          error: "This file is already designated for another concept.",
        } as const;
      }

      if (error.code === "P2034") {
        return {
          error: "The final file changed at the same time. Please try again.",
        } as const;
      }
    }

    throw error;
  }
}

const conceptApprovalRevocationFolderSelect = {
  id: true,
  taskerStageId: true,
  assignedExecutorId: true,
  approvedAttachmentId: true,
  approvedAttachment: {
    select: { id: true, revisionId: true },
  },
  promotedStage4Concept: {
    select: {
      id: true,
      taskerStageId: true,
      approvedAttachmentId: true,
      approvedAttachment: {
        select: { id: true, revisionId: true },
      },
    },
  },
  project: {
    select: {
      ownerId: true,
      coOwners: { select: { userId: true } },
      workflowStages: {
        select: { id: true, stageKey: true, status: true },
      },
    },
  },
} satisfies Prisma.ProjectConceptFolderSelect;

type ConceptApprovalRevocationFolder =
  Prisma.ProjectConceptFolderGetPayload<{
    select: typeof conceptApprovalRevocationFolderSelect;
  }>;

type ConceptApprovalRevocationWorkflowStage =
  ConceptApprovalRevocationFolder["project"]["workflowStages"][number];

type ConceptApprovalRevocationResolution =
  | {
      eligibility: {
        canRevoke: false;
        reason: ConceptApprovalRevocationReason;
      };
      error: string;
    }
  | {
      eligibility: { canRevoke: true; reason: null };
      error: null;
      folder: ConceptApprovalRevocationFolder;
      approvedAttachment: { id: string; revisionId: string };
      workflowStage: ConceptApprovalRevocationWorkflowStage;
      nextWorkflowStage: ConceptApprovalRevocationWorkflowStage;
      stageFiveWorkflow: ConceptApprovalRevocationWorkflowStage | null;
      stageSixWorkflow: ConceptApprovalRevocationWorkflowStage | null;
      reopensWorkflowStage: boolean;
      stageFourDownstreamHandoffId: string | null;
    };

function denyConceptApprovalRevocation(
  reason: ConceptApprovalRevocationReason,
  error: string,
): ConceptApprovalRevocationResolution {
  return {
    eligibility: { canRevoke: false, reason },
    error,
  };
}

async function resolveConceptApprovalRevocationEligibility(
  tx: Prisma.TransactionClient,
  user: PermissionUser,
  input: {
    projectId: string;
    folderId: string;
  },
  workflowStageKey: ConceptWorkflowStageKey,
): Promise<ConceptApprovalRevocationResolution> {
  const stageNumber =
    workflowStageKey === ProjectWorkflowStageKey.CONCEPT_CREATION ? 3 : 4;
  const nextWorkflowStageKey =
    stageNumber === 3
      ? ProjectWorkflowStageKey.PROJECT_DEVELOPMENT
      : ProjectWorkflowStageKey.FINAL_LAYOUT;
  const approvalLabel =
    stageNumber === 3 ? "Approved Concept" : "Final Approved File";
  const folder = await tx.projectConceptFolder.findFirst({
    where: {
      id: input.folderId,
      projectId: input.projectId,
      workflowStageKey,
      taskerStage: { projectId: input.projectId, isTasker: true },
    },
    select: conceptApprovalRevocationFolderSelect,
  });

  if (!folder) {
    return denyConceptApprovalRevocation(
      "PROJECT_STATE_INVALID",
      `Stage ${stageNumber} concept not found.`,
    );
  }

  const accessContext: ConceptAccessContext = {
    folderId: folder.id,
    projectId: input.projectId,
    taskerStageId: folder.taskerStageId,
    workflowStageKey,
    assignedExecutorId: folder.assignedExecutorId,
    ownerId: folder.project.ownerId,
    coOwnerIds: folder.project.coOwners.map((coOwner) => coOwner.userId),
  };

  if (!canReviewProjectConcept(user, accessContext)) {
    return denyConceptApprovalRevocation(
      "UNAUTHORIZED",
      `You do not have permission to revoke the ${approvalLabel}.`,
    );
  }

  const workflowStage = folder.project.workflowStages.find(
    (stage) => stage.stageKey === workflowStageKey,
  );
  const nextWorkflowStage = folder.project.workflowStages.find(
    (stage) => stage.stageKey === nextWorkflowStageKey,
  );
  const stageFiveWorkflow =
    folder.project.workflowStages.find(
      (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
    ) ?? null;
  const stageSixWorkflow =
    folder.project.workflowStages.find(
      (stage) =>
        stage.stageKey === ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
    ) ?? null;
  const stageSevenWorkflow =
    folder.project.workflowStages.find(
      (stage) =>
        stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
    ) ?? null;
  const workflowStatus = workflowStage?.status;

  if (
    workflowStatus !== ProjectWorkflowStageStatus.AVAILABLE &&
    workflowStatus !== ProjectWorkflowStageStatus.COMPLETED
  ) {
    return denyConceptApprovalRevocation(
      "PROJECT_STATE_INVALID",
      `Stage ${stageNumber} is not currently available.`,
    );
  }

  if (!workflowStage || !nextWorkflowStage) {
    return denyConceptApprovalRevocation(
      "PROJECT_STATE_INVALID",
      `Stage ${stageNumber} and Stage ${stageNumber + 1} workflow records are required for revocation.`,
    );
  }

  const reopensWorkflowStage =
    workflowStatus === ProjectWorkflowStageStatus.COMPLETED;

  if (
    stageNumber === 3 &&
    reopensWorkflowStage &&
    (!stageFiveWorkflow || !stageSixWorkflow || !stageSevenWorkflow)
  ) {
    return denyConceptApprovalRevocation(
      "PROJECT_STATE_INVALID",
      "Stage 3 through Stage 7 workflow records are required for rework.",
    );
  }

  const approvedAttachment = folder.approvedAttachment;
  if (
    !folder.approvedAttachmentId ||
    !approvedAttachment ||
    !approvedAttachment.revisionId
  ) {
    return denyConceptApprovalRevocation(
      "NOT_APPROVED",
      `This concept does not currently have a designated ${approvalLabel}.`,
    );
  }

  if (stageNumber === 3) {
    if (reopensWorkflowStage) {
      if (
        stageSixWorkflow!.status === ProjectWorkflowStageStatus.COMPLETED ||
        stageSevenWorkflow!.status !== ProjectWorkflowStageStatus.LOCKED
      ) {
        return denyConceptApprovalRevocation(
          "STAGE6_PRODUCTION_STARTED",
          "Stage 6 production work has already started, so this Stage 3 approval can no longer be revoked.",
        );
      }

      const stageSixUnits = await tx.projectProductionUnit.findMany({
        where: { projectId: input.projectId },
        select: {
          status: true,
          approvedAt: true,
          handedOverAt: true,
          _count: { select: { files: true } },
          handover: { select: { id: true } },
          supervision: { select: { id: true } },
          approvalSteps: {
            select: {
              sequence: true,
              isMarketingDirectorRequired: true,
              clientRequestId: true,
              requestedById: true,
              status: true,
              dispatchStatus: true,
              activatedAt: true,
              sentAt: true,
              decidedAt: true,
              removedAt: true,
            },
          },
        },
      });
      const stageSixHasActivity = stageSixUnits.some((unit) => {
        const bootstrapStep = unit.approvalSteps[0];

        return (
          unit.status !== ProjectProductionUnitStatus.PREPARATION ||
          unit.approvedAt !== null ||
          unit.handedOverAt !== null ||
          unit._count.files > 0 ||
          unit.handover !== null ||
          unit.supervision !== null ||
          unit.approvalSteps.length !== 1 ||
          !bootstrapStep ||
          bootstrapStep.sequence !== 1 ||
          !bootstrapStep.isMarketingDirectorRequired ||
          bootstrapStep.clientRequestId !== null ||
          bootstrapStep.requestedById !== null ||
          bootstrapStep.status !== ProductionApprovalStepStatus.WAITING ||
          bootstrapStep.dispatchStatus !== ProductionDispatchStatus.NOT_SENT ||
          bootstrapStep.activatedAt !== null ||
          bootstrapStep.sentAt !== null ||
          bootstrapStep.decidedAt !== null ||
          bootstrapStep.removedAt !== null
        );
      });

      if (stageSixHasActivity) {
        return denyConceptApprovalRevocation(
          "STAGE6_PRODUCTION_STARTED",
          "Stage 6 production work has already started, so this Stage 3 approval can no longer be revoked.",
        );
      }
    }

    const promotedApproval = folder.promotedStage4Concept?.approvedAttachment;
    if (
      folder.promotedStage4Concept?.approvedAttachmentId &&
      (!promotedApproval || !promotedApproval.revisionId)
    ) {
      return denyConceptApprovalRevocation(
        "PROJECT_STATE_INVALID",
        "The dependent Stage 4 approval is incomplete and could not be reset safely.",
      );
    }
  }

  let stageFourDownstreamHandoffId: string | null = null;
  if (stageNumber === 4) {
    if (nextWorkflowStage.status === ProjectWorkflowStageStatus.COMPLETED) {
      return denyConceptApprovalRevocation(
        "STAGE5_DEPENDENCY_EXISTS",
        "Stage 5 is already completed, so this Final Approved File cannot be revoked.",
      );
    }

    const downstreamHandoff = await tx.projectStageFileHandoff.findFirst({
      where: {
        projectId: input.projectId,
        sourceWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        sourceAttachmentId: approvedAttachment.id,
        targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
      },
      select: { id: true },
    });
    stageFourDownstreamHandoffId = downstreamHandoff?.id ?? null;
  }

  return {
    eligibility: { canRevoke: true, reason: null },
    error: null,
    folder,
    approvedAttachment: {
      id: approvedAttachment.id,
      revisionId: approvedAttachment.revisionId,
    },
    workflowStage,
    nextWorkflowStage,
    stageFiveWorkflow,
    stageSixWorkflow,
    reopensWorkflowStage,
    stageFourDownstreamHandoffId,
  };
}

export async function getConceptApprovalRevocationEligibility(
  user: PermissionUser,
  input: {
    projectId: string;
    folderId: string;
    workflowStageKey: ConceptWorkflowStageKey;
  },
): Promise<ConceptApprovalRevocationEligibility> {
  return withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const resolution = await resolveConceptApprovalRevocationEligibility(
        tx,
        user,
        input,
        input.workflowStageKey,
      );
      return resolution.eligibility;
    }),
  );
}

async function revokeConceptApprovedAttachment(
  user: PermissionUser,
  input: {
    projectId: string;
    folderId: string;
  },
  workflowStageKey: ConceptWorkflowStageKey,
  conflictRetryCount = 0,
) {
  const stageNumber =
    workflowStageKey === ProjectWorkflowStageKey.CONCEPT_CREATION ? 3 : 4;

  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const resolution = await resolveConceptApprovalRevocationEligibility(
            tx,
            user,
            input,
            workflowStageKey,
          );
          if (!("folder" in resolution)) {
            return { error: resolution.error } as const;
          }
          const {
            folder,
            approvedAttachment,
            workflowStage,
            nextWorkflowStage,
            stageFiveWorkflow,
            stageSixWorkflow,
            reopensWorkflowStage,
            stageFourDownstreamHandoffId,
          } = resolution;

          let cascadedStageFourApproval = false;
          let removedStageFiveHandoff = false;
          let resetThroughStageFive = false;

          if (stageNumber === 3) {
            if (reopensWorkflowStage) {
              resetThroughStageFive = [
                nextWorkflowStage,
                stageFiveWorkflow!,
                stageSixWorkflow!,
              ].some(
                (stage) =>
                  stage.status !== ProjectWorkflowStageStatus.LOCKED,
              );
            }

            const stageThreeFallbackHandoff =
              await tx.projectStageFileHandoff.findFirst({
                where: {
                  projectId: input.projectId,
                  sourceWorkflowStageKey:
                    ProjectWorkflowStageKey.CONCEPT_CREATION,
                  sourceAttachmentId: approvedAttachment.id,
                  targetWorkflowStageKey:
                    ProjectWorkflowStageKey.FINAL_LAYOUT,
                },
                select: { id: true },
              });

            if (stageThreeFallbackHandoff) {
              await tx.projectStageFileHandoff.delete({
                where: { id: stageThreeFallbackHandoff.id },
              });
              removedStageFiveHandoff = true;
            }

            const promotedConcept = folder.promotedStage4Concept;
            if (promotedConcept) {
              const promotedApproval = promotedConcept.approvedAttachment;

              if (promotedApproval?.revisionId) {
                const handoff = await tx.projectStageFileHandoff.findFirst({
                  where: {
                    projectId: input.projectId,
                    sourceWorkflowStageKey:
                      ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                    sourceAttachmentId: promotedApproval.id,
                    targetWorkflowStageKey:
                      ProjectWorkflowStageKey.FINAL_LAYOUT,
                  },
                  select: { id: true },
                });

                if (handoff) {
                  await tx.projectStageFileHandoff.delete({
                    where: { id: handoff.id },
                  });
                  removedStageFiveHandoff = true;
                }

                await tx.projectRevision.update({
                  where: { id: promotedApproval.revisionId },
                  data: {
                    status: ProjectRevisionStatus.PENDING_REVIEW,
                    reviewedById: null,
                    reviewedAt: null,
                    rejectionReason: null,
                  },
                });
                await tx.projectAttachment.updateMany({
                  where: {
                    projectId: input.projectId,
                    stageId: promotedConcept.taskerStageId,
                    revisionId: promotedApproval.revisionId,
                    status: AttachmentStatus.READY,
                    assetType: { in: formalConceptAttachmentTypes },
                  },
                  data: {
                    submissionReviewStatus:
                      SubmissionReviewStatus.PENDING_REVIEW,
                    reviewedById: null,
                    reviewedAt: null,
                    reviewNote: null,
                  },
                });
                cascadedStageFourApproval = true;
              }

              await tx.projectConceptFolder.update({
                where: { id: promotedConcept.id },
                data: {
                  ...(promotedConcept.approvedAttachmentId
                    ? {
                        approvedAttachmentId: null,
                        approvedById: null,
                        approvedAt: null,
                      }
                    : {}),
                },
              });
              await tx.projectStage.update({
                where: { id: promotedConcept.taskerStageId },
                data: {
                  status: StageStatus.ONGOING,
                  completedAt: null,
                },
              });
            }
          }

          if (stageNumber === 4 && stageFourDownstreamHandoffId) {
            await tx.projectStageFileHandoff.delete({
              where: { id: stageFourDownstreamHandoffId },
            });
            removedStageFiveHandoff = true;
          }

          if (reopensWorkflowStage) {
            await tx.projectWorkflowStage.update({
              where: { id: workflowStage.id },
              data: {
                status: ProjectWorkflowStageStatus.AVAILABLE,
                completedAt: null,
              },
            });

            if (stageNumber === 3) {
              await tx.projectWorkflowStage.updateMany({
                where: {
                  projectId: input.projectId,
                  stageKey: {
                    in: [
                      ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                      ProjectWorkflowStageKey.FINAL_LAYOUT,
                      ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
                      ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
                    ],
                  },
                },
                data: {
                  status: ProjectWorkflowStageStatus.LOCKED,
                  unlockedAt: null,
                  completedAt: null,
                },
              });
            } else if (
              nextWorkflowStage.status === ProjectWorkflowStageStatus.AVAILABLE
            ) {
              await tx.projectWorkflowStage.update({
                where: { id: nextWorkflowStage.id },
                data: {
                  status: ProjectWorkflowStageStatus.LOCKED,
                  unlockedAt: null,
                  completedAt: null,
                },
              });
              resetThroughStageFive = true;
            }
          }

          await tx.projectConceptFolder.update({
            where: { id: folder.id },
            data: {
              approvedAttachmentId: null,
              approvedById: null,
              approvedAt: null,
            },
          });
          await tx.projectRevision.update({
            where: { id: approvedAttachment.revisionId },
            data: {
              status: ProjectRevisionStatus.PENDING_REVIEW,
              reviewedById: null,
              reviewedAt: null,
              rejectionReason: null,
            },
          });
          await tx.projectAttachment.updateMany({
            where: {
              projectId: input.projectId,
              stageId: folder.taskerStageId,
              revisionId: approvedAttachment.revisionId,
              status: AttachmentStatus.READY,
              assetType: { in: formalConceptAttachmentTypes },
            },
            data: {
              submissionReviewStatus: SubmissionReviewStatus.PENDING_REVIEW,
              reviewedById: null,
              reviewedAt: null,
              reviewNote: null,
            },
          });
          await tx.projectStage.update({
            where: { id: folder.taskerStageId },
            data: {
              status: StageStatus.ONGOING,
              completedAt: null,
            },
          });

          return {
            changed: true,
            folderId: folder.id,
            taskerStageId: folder.taskerStageId,
            assignedExecutorId: folder.assignedExecutorId,
            attachmentId: approvedAttachment.id,
            revisionId: approvedAttachment.revisionId,
            revisionStatus: ProjectRevisionStatus.PENDING_REVIEW,
            cascadedStageFourApproval,
            removedStageFiveHandoff,
            reopensWorkflowStage,
            resetThroughStageFive,
          } as const;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 30_000,
        },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      if (conflictRetryCount < 1) {
        return revokeConceptApprovedAttachment(
          user,
          input,
          workflowStageKey,
          conflictRetryCount + 1,
        );
      }

      return {
        error: "The concept approval changed at the same time. Please try again.",
      } as const;
    }

    throw error;
  }
}

export async function revokeProjectConceptApprovedAttachment(
  user: PermissionUser,
  input: { projectId: string; folderId: string },
) {
  return revokeConceptApprovedAttachment(
    user,
    input,
    ProjectWorkflowStageKey.CONCEPT_CREATION,
  );
}

export async function revokeStageFourFinalApprovedAttachment(
  user: PermissionUser,
  input: { projectId: string; folderId: string },
) {
  return revokeConceptApprovedAttachment(
    user,
    input,
    ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
  );
}

export async function requestStageThreeTaskCompletion(
  user: PermissionUser,
  input: { projectId: string; folderId: string; note?: string },
) {
  return requestProjectConceptTaskCompletion(user, { ...input, stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION });
}

export async function completeStageThreeTaskWithoutFile(
  user: PermissionUser,
  input: { projectId: string; folderId: string },
) {
  return completeProjectConceptTaskWithoutFile(user, { ...input, stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION });
}

export async function requestProjectConceptTaskCompletion(
  user: PermissionUser,
  input: { projectId: string; folderId: string; stageKey: ConceptWorkflowStageKey; note?: string },
  conflictRetryCount = 0,
): Promise<{ changed: boolean; taskerStageId: string } | { error: string }> {
  if (!isSupportedConceptStageKey(input.stageKey)) return { error: "Task completion is available only in Stages 3 and 4." };
  if (input.note !== undefined && typeof input.note !== "string") return { error: "Enter a text note." };
  const note = input.note?.trim() || null;
  if (note && note.length > 2_000) return { error: "The completion note must be 2,000 characters or fewer." };
  try {
    return await withPrismaRetry(() => prisma.$transaction(async (tx) => {
      const folder = await tx.projectConceptFolder.findFirst({
        where: {
          id: input.folderId, projectId: input.projectId,
          workflowStageKey: input.stageKey,
          taskerStage: { projectId: input.projectId, isTasker: true },
        },
        select: { ...conceptFolderSelect, project: { select: projectStageAccessSelect } },
      });
      if (!folder || folder.assignedExecutorId !== user.id) {
        return { error: "Only the assigned executor can request completion of this task." };
      }
      if (!isOpenConceptWithoutSubmission(folder.project, folder, input.stageKey)) {
        return { error: folder.taskerStage._count.attachments > 0 || folder.approvedAttachment
          ? "This task already has a file submission or upload in progress. Use the file review process."
          : "Completion cannot be requested because the task, stage, or project is closed." };
      }
      if (!folder.taskerStage.actualStartedAt) return { error: "Accept the task brief before requesting completion." };
      if (folder.completionRequestedAt) return { changed: false, taskerStageId: folder.taskerStageId };
      await tx.projectConceptFolder.update({ where: { id: folder.id }, data: {
        completionRequestedAt: new Date(), completionRequestNote: note,
      } });
      // Store the note as text; escaping prevents user text being treated as chat HTML.
      const escapedNote = note?.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
      await tx.projectComment.create({ data: {
        projectId: input.projectId, stageId: folder.taskerStageId, authorId: user.id,
        body: `<p>Task completion requested without a file submission.</p>${escapedNote ? `<p>${escapedNote}</p>` : ""}`,
      } });
      return { changed: true, taskerStageId: folder.taskerStageId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      if (conflictRetryCount < 2) return requestProjectConceptTaskCompletion(user, input, conflictRetryCount + 1);
      return { error: "The task changed at the same time. Please try again." };
    }
    throw error;
  }
}

export async function completeProjectConceptTaskWithoutFile(
  user: PermissionUser,
  input: { projectId: string; folderId: string; stageKey: ConceptWorkflowStageKey },
  conflictRetryCount = 0,
): Promise<{ changed: boolean; taskerStageId: string } | { error: string }> {
  if (!isSupportedConceptStageKey(input.stageKey)) return { error: "Task completion is available only in Stages 3 and 4." };
  try {
    return await withPrismaRetry(() => prisma.$transaction(async (tx) => {
      const folder = await tx.projectConceptFolder.findFirst({
        where: {
          id: input.folderId, projectId: input.projectId,
          workflowStageKey: input.stageKey,
          taskerStage: { projectId: input.projectId, isTasker: true },
        },
        select: { ...conceptFolderSelect, project: { select: projectStageAccessSelect } },
      });
      if (!folder) return { error: "Task not found." };
      const context = getConceptAccessContext(folder.project, folder, input.stageKey);
      if (!canCompleteProjectConceptStage(user, context)) {
        return { error: "Only the project owner or an administrator can complete a task without a file." };
      }
      if (isConceptCompletedWithoutFile(folder)) return { changed: false, taskerStageId: folder.taskerStageId };
      if (!canCompleteConceptWithoutFile(user, folder.project, folder, input.stageKey)) {
        return { error: folder.taskerStage._count.attachments > 0 || folder.approvedAttachment
          ? "This task has a submitted file or an upload in progress. Review the submission to complete it."
          : "This task cannot be completed because the task, stage, or project is closed." };
      }
      const completedAt = new Date();
      await tx.projectStage.update({
        where: { id: folder.taskerStageId },
        data: { status: StageStatus.COMPLETED, completedAt },
      });
      await tx.projectConceptFolder.update({
        where: { id: folder.id }, data: {
          completedWithoutFileAt: completedAt, completionRequestedAt: null, completionRequestNote: null,
        },
      });
      await tx.projectComment.create({ data: {
        projectId: input.projectId, stageId: folder.taskerStageId, authorId: user.id,
        body: "Task completed without a file submission.",
      } });
      return { changed: true, taskerStageId: folder.taskerStageId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      if (conflictRetryCount < 2) return completeProjectConceptTaskWithoutFile(user, input, conflictRetryCount + 1);
      return { error: "The task changed at the same time. Please try again." };
    }
    throw error;
  }
}

type StageThreeCompletionResult = {
  transitioned: boolean;
  createdFolderIds: string[];
  promotedFolderIds: string[];
  approvedCount: number;
  skipped: boolean;
  unapprovedConcepts: Array<{ id: string; name: string }>;
  completedTaskIds: string[];
};

export async function completeStageThreeConcepts(
  user: PermissionUser,
  input: { projectId: string; completeOpenTasks?: boolean },
  conflictRetryCount = 0,
) {
  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx): Promise<StageThreeCompletionResult | { error: string }> => {
          const project = await tx.project.findUnique({
            where: { id: input.projectId },
            select: {
              ...projectStageAccessSelect,
              category: true,
              conceptFolders: {
                where: {
                  workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
                },
                orderBy: [
                  { sortOrder: "asc" },
                  { createdAt: "asc" },
                  { id: "asc" },
                ],
                select: {
                  id: true,
                  name: true,
                  normalizedName: true,
                  taskerStageId: true,
                  assignedExecutorId: true,
                  approvedAttachmentId: true,
                  completedWithoutFileAt: true,
                  taskerStage: { select: conceptCompletionStageSelect },
                  approvedAttachment: {
                    select: formalConceptAttachmentSelect,
                  },
                },
              },
            },
          });

          if (!project) {
            return { error: "Project not found." };
          }

          const managerContext: ConceptAccessContext = {
            folderId: "",
            projectId: project.id,
            taskerStageId: "",
            workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
            assignedExecutorId: null,
            ownerId: project.ownerId,
            coOwnerIds: project.coOwners.map((coOwner) => coOwner.userId),
          };

          if (!canCompleteProjectConceptStage(user, managerContext)) {
            return {
              error:
                "Only the project owner or an administrator can complete Stage 3.",
            };
          }

          if (project.completedAt || project.archivedAt || isProjectStatusCompleted(project.status)) {
            return { error: "Stage 3 cannot be completed because the project is closed." };
          }

          const stageThreeWorkflow = project.workflowStages.find(
            (stage) =>
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
          );
          const stageFourWorkflow = project.workflowStages.find(
            (stage) =>
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          );

          if (!stageThreeWorkflow || !stageFourWorkflow) {
            return {
              error: "Stage 3 and Stage 4 workflow records are required before completion.",
            };
          }

          const completionMode = getWorkflowStageCompletionMode(
            project.workflowStages,
            ProjectWorkflowStageKey.CONCEPT_CREATION,
          );

          if (completionMode === "UNAVAILABLE") {
            return { error: "Stage 3 is not currently available." };
          }

          const approvedConcepts = project.conceptFolders.filter(
            (folder) => Boolean(folder.approvedAttachmentId),
          );
          const pendingConcepts = project.conceptFolders.filter(
            (folder) => !folder.approvedAttachmentId && !isConceptCompletedWithoutFile(folder),
          );
          const manuallyCompleteTasks = input.completeOpenTasks === true && completionMode === "TRANSITION";
          const unapprovedConcepts = pendingConcepts.map((folder) => ({ id: folder.id, name: folder.name }));

          if (unapprovedConcepts.length > 0 && !manuallyCompleteTasks) {
            return {
              error: `Every Stage 3 task must have an approved file or be completed without a file before Stage 3 can be completed. Pending: ${unapprovedConcepts.map((concept) => concept.name).join(", ")}.`,
            };
          }

          if (manuallyCompleteTasks) {
            const blockedTasks = pendingConcepts.filter((folder) =>
              !canCompleteConceptWithoutFile(user, project, folder, ProjectWorkflowStageKey.CONCEPT_CREATION),
            );
            if (blockedTasks.length > 0) {
              return { error: `These tasks have a submitted file, an upload in progress, or are already closed. Review them before completing Stage 3: ${blockedTasks.map((folder) => folder.name).join(", ")}.` };
            }
          }

          for (const concept of approvedConcepts) {
            const attachmentError = getFormalConceptAttachmentError({
              attachment: concept.approvedAttachment,
              projectId: project.id,
              taskerStageId: concept.taskerStageId,
              projectCategory: project.category,
              workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
            });

            if (attachmentError) {
              return {
                error: `The Approved Concept for “${concept.name}” is no longer eligible. Select a valid formal revision file before completing Stage 3.`,
              };
            }
          }

          const transitioned = completionMode === "TRANSITION";
          const completedAt = new Date();

          if (transitioned) {
            if (manuallyCompleteTasks && pendingConcepts.length > 0) {
              await tx.projectStage.updateMany({
                where: { id: { in: pendingConcepts.map((folder) => folder.taskerStageId) }, projectId: project.id },
                data: { status: StageStatus.COMPLETED, completedAt },
              });
              await tx.projectConceptFolder.updateMany({
                where: { id: { in: pendingConcepts.map((folder) => folder.id) }, projectId: project.id },
                data: { completedWithoutFileAt: completedAt, completionRequestedAt: null, completionRequestNote: null },
              });
              await tx.projectComment.createMany({ data: pendingConcepts.map((folder) => ({
                projectId: project.id, stageId: folder.taskerStageId, authorId: user.id,
                body: "Task completed without a file submission during manual Stage 3 completion.",
              })) });
            }
            const completed = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageThreeWorkflow.id,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                completedAt,
              },
            });

            if (completed.count === 1) {
              await tx.projectWorkflowStage.updateMany({
                where: {
                  id: stageFourWorkflow.id,
                  status: ProjectWorkflowStageStatus.LOCKED,
                },
                data: {
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                  unlockedAt: completedAt,
                },
              });
            }
          }

          return {
            transitioned,
            createdFolderIds: [],
            promotedFolderIds: [],
            approvedCount: approvedConcepts.length,
            skipped: project.conceptFolders.length === 0,
            unapprovedConcepts: [],
            completedTaskIds: manuallyCompleteTasks ? pendingConcepts.map((folder) => folder.id) : [],
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 30_000,
        },
      ),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (
        (error.code === "P2002" || error.code === "P2034") &&
        conflictRetryCount < 1
      ) {
        return completeStageThreeConcepts(
          user,
          input,
          conflictRetryCount + 1,
        );
      }

      if (error.code === "P2002" || error.code === "P2034") {
        return {
          error: "Stage 3 changed at the same time. Please try completion again.",
        } as const;
      }
    }

    throw error;
  }
}

type StageFourCompletionResult = {
  transitioned: boolean;
  skipped: boolean;
  finalApprovedCount: number;
  conceptsWithoutFinalFile: Array<{ id: string; name: string }>;
  handoffs: Array<{
    id: string;
    sourceAttachmentId: string;
    checklistId: string;
  }>;
};

export async function completeStageFourConcepts(
  user: PermissionUser,
  input: { projectId: string },
  conflictRetryCount = 0,
) {
  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx): Promise<StageFourCompletionResult | { error: string }> => {
          const project = await tx.project.findUnique({
            where: { id: input.projectId },
            select: {
              id: true,
              completedAt: true, archivedAt: true, status: projectStageAccessSelect.status,
              category: true,
              ownerId: true,
              coOwners: { select: { userId: true } },
              workflowStages: {
                select: {
                  id: true,
                  stageKey: true,
                  status: true,
                  completedAt: true,
                  unlockedAt: true,
                },
              },
              stageFileHandoffs: {
                where: {
                  targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
                },
                select: { id: true },
              },
              conceptFolders: {
                where: {
                  workflowStageKey: {
                    in: [
                      ProjectWorkflowStageKey.CONCEPT_CREATION,
                      ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                    ],
                  },
                },
                orderBy: [
                  { sortOrder: "asc" },
                  { createdAt: "asc" },
                  { id: "asc" },
                ],
                select: {
                  id: true,
                  name: true,
                  workflowStageKey: true,
                  taskerStageId: true,
                  approvedAttachmentId: true,
                  completedWithoutFileAt: true,
                  taskerStage: { select: { status: true } },
                  approvedAttachment: {
                    select: formalConceptAttachmentSelect,
                  },
                },
              },
            },
          });

          if (!project) {
            return { error: "Project not found." };
          }

          const managerContext: ConceptAccessContext = {
            folderId: "",
            projectId: project.id,
            taskerStageId: "",
            workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            assignedExecutorId: null,
            ownerId: project.ownerId,
            coOwnerIds: project.coOwners.map((coOwner) => coOwner.userId),
          };

          if (!canCompleteProjectConceptStage(user, managerContext)) {
            return {
              error:
                "Only the project owner or an administrator can complete Stage 4.",
            };
          }

          if (project.completedAt || project.archivedAt || isProjectStatusCompleted(project.status)) {
            return { error: "Stage 4 cannot be completed because the project is closed." };
          }

          const stageFourWorkflow = project.workflowStages.find(
            (stage) =>
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          );
          const stageThreeWorkflow = project.workflowStages.find(
            (stage) =>
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
          );
          const stageFiveWorkflow = project.workflowStages.find(
            (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
          );

          if (!stageThreeWorkflow || !stageFourWorkflow || !stageFiveWorkflow) {
            return {
              error:
                "Stage 3, Stage 4, and Stage 5 workflow records are required before completion.",
            };
          }

          const completionMode = getWorkflowStageCompletionMode(
            project.workflowStages,
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          );

          if (completionMode === "UNAVAILABLE") {
            return { error: "Stage 4 is not currently available." };
          }

          const stageThreeConcepts = project.conceptFolders.filter(
            (folder) =>
              folder.workflowStageKey ===
              ProjectWorkflowStageKey.CONCEPT_CREATION,
          );
          const stageFourConcepts = project.conceptFolders.filter(
            (folder) =>
              folder.workflowStageKey ===
              ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          );
          const skipped = stageFourConcepts.length === 0;

          if (skipped) {
            if (
              stageFourWorkflow.status !==
                ProjectWorkflowStageStatus.AVAILABLE ||
              stageFiveWorkflow.status !== ProjectWorkflowStageStatus.LOCKED
            ) {
              return {
                error:
                  "Stage 4 can be skipped only while it is available and Stage 5 is still locked.",
              };
            }

            if (project.stageFileHandoffs.length > 0) {
              return {
                error:
                  "Stage 4 cannot be skipped because Stage 5 source files already exist.",
              };
            }

            if (
              stageThreeWorkflow.status !==
              ProjectWorkflowStageStatus.COMPLETED
            ) {
              return {
                error:
                  "Stage 3 must be completed before its approved files can be carried into Stage 5.",
              };
            }

            const approvedStageThreeConcepts = stageThreeConcepts.filter(
              (folder) => Boolean(folder.approvedAttachmentId),
            );
            const stageThreeConceptsWithoutApprovedFile = stageThreeConcepts
              .filter((folder) => !folder.approvedAttachmentId && !isConceptCompletedWithoutFile(folder))
              .map((folder) => folder.name);

            if (stageThreeConceptsWithoutApprovedFile.length > 0) {
              return {
                error: `Every Stage 3 task must have an approved file or be completed without a file before Stage 4 can be skipped. Missing: ${stageThreeConceptsWithoutApprovedFile.join(", ")}.`,
              };
            }

            for (const concept of approvedStageThreeConcepts) {
              const attachmentError = getFormalConceptAttachmentError({
                attachment: concept.approvedAttachment,
                projectId: project.id,
                taskerStageId: concept.taskerStageId,
                projectCategory: project.category,
                workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
              });

              if (attachmentError) {
                return {
                  error: `The Approved Concept for “${concept.name}” is no longer eligible for Stage 5. Reopen Stage 3 and select a valid formal file.`,
                };
              }
            }

            const handoffs: StageFourCompletionResult["handoffs"] = [];

            for (const concept of approvedStageThreeConcepts) {
              const sourceAttachmentId = concept.approvedAttachmentId!;
              const handoff = await tx.projectStageFileHandoff.upsert({
                where: {
                  projectId_sourceAttachmentId_targetWorkflowStageKey: {
                    projectId: project.id,
                    sourceAttachmentId,
                    targetWorkflowStageKey:
                      ProjectWorkflowStageKey.FINAL_LAYOUT,
                  },
                },
                update: {},
                create: {
                  projectId: project.id,
                  sourceWorkflowStageKey:
                    ProjectWorkflowStageKey.CONCEPT_CREATION,
                  sourceAttachmentId,
                  targetWorkflowStageKey:
                    ProjectWorkflowStageKey.FINAL_LAYOUT,
                  handedOffById: user.id,
                },
                select: { id: true, sourceAttachmentId: true },
              });
              const checklist = await tx.projectFileChecklist.upsert({
                where: { handoffId: handoff.id },
                update: {},
                create: {
                  projectId: project.id,
                  handoffId: handoff.id,
                  sourceAttachmentId,
                },
                select: {
                  id: true,
                  projectId: true,
                  sourceAttachmentId: true,
                },
              });

              if (
                checklist.projectId !== project.id ||
                checklist.sourceAttachmentId !== sourceAttachmentId
              ) {
                throw new Error(
                  "Existing Stage 5 checklist does not match its Stage 3 source file.",
                );
              }

              handoffs.push({
                id: handoff.id,
                sourceAttachmentId,
                checklistId: checklist.id,
              });
            }

            const completedAt = new Date();
            const completed = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageFourWorkflow.id,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                completedAt,
              },
            });

            if (completed.count !== 1) {
              return { error: "Stage 4 changed before it could be skipped." };
            }

            const unlocked = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageFiveWorkflow.id,
                status: ProjectWorkflowStageStatus.LOCKED,
              },
              data: {
                status: ProjectWorkflowStageStatus.AVAILABLE,
                unlockedAt: completedAt,
              },
            });

            if (unlocked.count !== 1) {
              throw new Error(
                "Stage 5 changed before Stage 4 could be skipped safely.",
              );
            }

            await tx.projectActivityLog.create({
              data: {
                projectId: project.id,
                actorId: user.id,
                action: ActivityLogAction.STAGE_SKIPPED,
                metadata: {
                  stageNumber: 4,
                  workflowStageKey:
                    ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                  nextWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
                },
              },
            });

            return {
              transitioned: true,
              skipped: true,
              finalApprovedCount: approvedStageThreeConcepts.length,
              conceptsWithoutFinalFile: [],
              handoffs,
            };
          }

          const finalConcepts = stageFourConcepts.filter(
            (folder) => Boolean(folder.approvedAttachmentId),
          );
          const conceptsWithoutFinalFile = stageFourConcepts
            .filter((folder) => !folder.approvedAttachmentId && !isConceptCompletedWithoutFile(folder))
            .map((folder) => ({ id: folder.id, name: folder.name }));

          if (conceptsWithoutFinalFile.length > 0) {
            return {
              error: `Every Stage 4 task must have a Final Approved File or be marked as complete before Stage 4 can be completed. Pending: ${conceptsWithoutFinalFile.map((concept) => concept.name).join(", ")}.`,
            };
          }

          for (const concept of finalConcepts) {
            const attachmentError = getFormalConceptAttachmentError({
              attachment: concept.approvedAttachment,
              projectId: project.id,
              taskerStageId: concept.taskerStageId,
              projectCategory: project.category,
              workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            });

            if (attachmentError) {
              return {
                error: `The Final Approved File for “${concept.name}” is no longer eligible. Select a valid formal Stage 4 revision file before completing Stage 4.`,
              };
            }
          }

          const finalAttachmentIds = finalConcepts.map(
            (concept) => concept.approvedAttachmentId!,
          );
          const [existingHandoffs, existingChecklists] = await Promise.all([
            tx.projectStageFileHandoff.findMany({
              where: {
                projectId: project.id,
                sourceAttachmentId: { in: finalAttachmentIds },
                targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
              },
              select: {
                id: true,
                sourceWorkflowStageKey: true,
              },
            }),
            tx.projectFileChecklist.findMany({
              where: {
                projectId: project.id,
                sourceAttachmentId: { in: finalAttachmentIds },
              },
              select: {
                id: true,
                sourceAttachmentId: true,
                handoff: {
                  select: {
                    id: true,
                    projectId: true,
                    sourceAttachmentId: true,
                    sourceWorkflowStageKey: true,
                    targetWorkflowStageKey: true,
                  },
                },
              },
            }),
          ]);

          if (
            existingHandoffs.some(
              (handoff) =>
                handoff.sourceWorkflowStageKey !==
                ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            )
          ) {
            return {
              error:
                "An existing Stage 5 handoff conflicts with its final file source stage. Stage 4 was not completed.",
            };
          }

          for (const checklist of existingChecklists) {
            if (
              checklist.handoff.projectId !== project.id ||
              checklist.handoff.sourceAttachmentId !==
                checklist.sourceAttachmentId ||
              checklist.handoff.sourceWorkflowStageKey !==
                ProjectWorkflowStageKey.PROJECT_DEVELOPMENT ||
              checklist.handoff.targetWorkflowStageKey !==
                ProjectWorkflowStageKey.FINAL_LAYOUT
            ) {
              return {
                error:
                  "An existing Stage 5 checklist conflicts with its final file handoff. Stage 4 was not completed.",
              };
            }
          }

          const handoffs: StageFourCompletionResult["handoffs"] = [];

          for (const concept of finalConcepts) {
            const sourceAttachmentId = concept.approvedAttachmentId!;
            const handoff = await tx.projectStageFileHandoff.upsert({
              where: {
                projectId_sourceAttachmentId_targetWorkflowStageKey: {
                  projectId: project.id,
                  sourceAttachmentId,
                  targetWorkflowStageKey:
                    ProjectWorkflowStageKey.FINAL_LAYOUT,
                },
              },
              update: {},
              create: {
                projectId: project.id,
                sourceWorkflowStageKey:
                  ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                sourceAttachmentId,
                targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
                handedOffById: user.id,
              },
              select: { id: true, sourceAttachmentId: true },
            });
            const checklist = await tx.projectFileChecklist.upsert({
              where: { handoffId: handoff.id },
              update: {},
              create: {
                projectId: project.id,
                handoffId: handoff.id,
                sourceAttachmentId,
              },
              select: {
                id: true,
                projectId: true,
                sourceAttachmentId: true,
              },
            });

            if (
              checklist.projectId !== project.id ||
              checklist.sourceAttachmentId !== sourceAttachmentId
            ) {
              throw new Error(
                "Existing Stage 5 checklist does not match its final file.",
              );
            }

            handoffs.push({
              id: handoff.id,
              sourceAttachmentId,
              checklistId: checklist.id,
            });
          }

          const transitioned = completionMode === "TRANSITION";
          const completedAt = new Date();

          if (transitioned) {
            const completed = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageFourWorkflow.id,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                completedAt,
              },
            });

            if (completed.count === 1) {
              await tx.projectWorkflowStage.updateMany({
                where: {
                  id: stageFiveWorkflow.id,
                  status: ProjectWorkflowStageStatus.LOCKED,
                },
                data: {
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                  unlockedAt: completedAt,
                },
              });
            }
          }

          return {
            transitioned,
            skipped: false,
            finalApprovedCount: finalConcepts.length,
            conceptsWithoutFinalFile,
            handoffs,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 30_000,
        },
      ),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (
        (error.code === "P2002" || error.code === "P2034") &&
        conflictRetryCount < 1
      ) {
        return completeStageFourConcepts(
          user,
          input,
          conflictRetryCount + 1,
        );
      }

      if (error.code === "P2002" || error.code === "P2034") {
        return {
          error:
            "Stage 4 changed at the same time. Please try completion again.",
        } as const;
      }
    }

    throw error;
  }
}

export async function getProjectConceptChatContext(
  user: PermissionUser,
  input: {
    projectId: string;
    stageKey: ConceptWorkflowStageKey;
    folderId: string;
  },
) {
  const record = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
        workflowStageKey: input.stageKey,
        taskerStage: {
          projectId: input.projectId,
          isTasker: true,
        },
      },
      relationLoadStrategy: "join",
      select: {
        id: true,
        name: true,
        taskerStageId: true,
        assignedExecutorId: true,
        approvedAttachmentId: true,
        completedWithoutFileAt: true,
        completionRequestedAt: true,
        completionRequestNote: true,
        taskerStage: { select: conceptCompletionStageSelect },
        sourceStage3Concept: {
          select: { id: true, name: true },
        },
        sourceStage3ApprovedAttachment: {
          select: {
            id: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
          },
        },
        sourceStage3ImportedAt: true,
        sourceStage3ImportedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        createdAt: true,
        updatedAt: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        assignedExecutor: {
          select: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        },
        project: { select: projectStageAccessSelect },
      },
    }),
  );

  if (
    !record ||
    !canViewProjectConcept(
      user,
      getConceptAccessContext(record.project, record, input.stageKey),
    ) ||
    !canOpenImplementedWorkflowStage({
      stageKey: input.stageKey,
      status: getWorkflowStageStatus(record.project, input.stageKey),
    })
  ) {
    return null;
  }

  const accessContext = getConceptAccessContext(
    record.project,
    record,
    input.stageKey,
  );
  const stageNumber =
    input.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION ? 3 : 4;
  const conceptPath = `/projects/${encodeURIComponent(input.projectId)}/stages/${stageNumber}/concepts/${encodeURIComponent(record.id)}`;
  const canManage = canManageProjectConcept(user, accessContext);
  const canReview = canReviewProjectConcept(user, accessContext);
  const workflowStatus = getWorkflowStageStatus(record.project, input.stageKey);
  const startingReference =
    record.sourceStage3Concept && record.sourceStage3ApprovedAttachment
      ? {
          ...mapConceptAttachmentReference(record.sourceStage3ApprovedAttachment),
          sourceConceptId: record.sourceStage3Concept.id,
          sourceConceptName: record.sourceStage3Concept.name,
          importedAt: (
            record.sourceStage3ImportedAt ??
            record.updatedAt ??
            record.createdAt
          ).toISOString(),
          importedBy: record.sourceStage3ImportedBy ?? record.createdBy,
        }
      : null;
  const availableStageThreeReferences =
    input.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT &&
    canCompleteProjectConceptStage(user, accessContext) &&
    workflowStatus === ProjectWorkflowStageStatus.AVAILABLE &&
    !startingReference
      ? await withPrismaRetry(() =>
          prisma.projectConceptFolder.findMany({
            where: {
              projectId: input.projectId,
              workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
              approvedAttachmentId: { not: null },
              promotedStage4Concept: null,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              approvedAttachment: {
                select: {
                  id: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                },
              },
            },
          }),
        ).then((concepts) =>
          concepts.flatMap((concept) =>
            concept.approvedAttachment
              ? [
                  {
                    ...mapConceptAttachmentReference(concept.approvedAttachment),
                    sourceConceptId: concept.id,
                    sourceConceptName: concept.name,
                  },
                ]
              : [],
          ),
        )
      : [];
  const approvalRevocationEligibility =
    await getConceptApprovalRevocationEligibility(user, {
      projectId: input.projectId,
      folderId: record.id,
      workflowStageKey: input.stageKey,
    });

  return {
    projectId: input.projectId,
    workflowStageKey: input.stageKey,
    folder: {
      id: record.id,
      name: record.name,
      taskerStageId: record.taskerStageId,
    },
    chatMode: {
      type: "concept",
      folderId: record.id,
      workflowStageKey: input.stageKey,
      stageNumber,
      stageLabel:
        stageNumber === 3
          ? "Stage 3 - Initial Concept"
          : "Stage 4 - Final Concept",
      conceptName: record.name,
      assignedExecutor: record.assignedExecutor?.user ?? null,
      canManage,
      canReview,
      isAssignedExecutor: record.assignedExecutorId === user.id,
      participantUserIds: getProjectConceptParticipantUserIds(accessContext),
      approvedAttachmentId: record.approvedAttachmentId,
      completedWithoutFile: isConceptCompletedWithoutFile(record),
      canCompleteWithoutFile: canCompleteConceptWithoutFile(user, record.project, record, input.stageKey),
      completionRequest: mapCompletionRequest(record),
      canRequestCompletion: canRequestConceptCompletion(user, record.project, record, input.stageKey),
      approvalRevocationEligibility,
      isWorkflowCompleted:
        workflowStatus === ProjectWorkflowStageStatus.COMPLETED,
      startingReference,
      availableStageThreeReferences,
      backHref: `/projects/${encodeURIComponent(input.projectId)}/stages/${stageNumber}`,
      compareHref: `${conceptPath}/compare`,
    } satisfies ProjectConceptChatMode,
  };
}

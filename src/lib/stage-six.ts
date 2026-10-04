import {
  ArchiveRecordStatus,
  AttachmentAssetType,
  AttachmentStatus,
  Prisma,
  ProductionApprovalRecipientType,
  ProductionApprovalStepStatus,
  ProductionDispatchStatus,
  ProductionHandoverDeliveryStatus,
  ProductionHandoverRoute,
  ProjectFileChecklistField,
  ProjectFileChecklistRequestWorkflowStatus,
  ProjectProductionUnitStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
} from "@prisma/client";

import {
  buildProductionApprovalEmail,
  buildProductionHandoverEmail,
} from "@/lib/email/production-workflow";
import { sendResendEmail } from "@/lib/email/resend";
import {
  hasProjectPermission,
  isGlobalProjectAdministrator,
  isProjectCoOwner,
  isProjectOwner,
  type PermissionUser,
} from "@/lib/permissions/resolver";
import { normalizeInternationalPhone } from "@/lib/project-contact-validation";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { richTextToPlainText, sanitizeRichText } from "@/lib/rich-text";
import {
  buildExternalProductionApprovalUrl,
  buildExternalProductionHandoverUrl,
  createProductionApprovalToken,
  createProductionHandoverToken,
  hashProductionExternalToken,
} from "@/lib/production-external-token";
import {
  getProjectStageAccessRecordById,
  projectStageAccessSelect,
  type ProjectStageAccessRecord,
} from "@/lib/project-stage-data";
import { getWorkflowStageCompletionMode } from "@/lib/project-workflow";
import {
  STAGE_FIVE_FIELD_KEYS,
  STAGE_FIVE_FIELD_LABELS,
} from "@/lib/stage-five-fields";
import {
  isStageFiveSourceWorkflowStageKey,
  STAGE_FIVE_SOURCE_WORKFLOW_STAGE_KEYS,
} from "@/lib/stage-five-lineage";
import {
  createPresignedDownloadUrl,
  createPresignedPreviewUrl,
} from "@/lib/storage/s3";
import {
  ACCESSIBLE_WORKFLOW_STAGE_STATUSES,
  canOpenImplementedWorkflowStage,
} from "@/lib/workflow-stage-access";
import { isSuperAdminRole } from "@/lib/user-role-compatibility";
import { disableProjectRequestReminders } from "@/lib/request-reminders";
import { isProjectStatusCompleted } from "@/lib/project-statuses";

type EmailSender = typeof sendResendEmail;
type StageProject = ProjectStageAccessRecord;

const SLAVOMIR_APPROVAL_NAME = "Slavomir Kluziak";
const SLAVOMIR_APPROVAL_CONFIGURATION_ERROR =
  "Slavomir's approval email is missing or invalid. Ask an administrator to configure it.";

// Read at request time so each deployment controls its own approval recipient.
function getSlavomirApprovalRecipient() {
  const recipientEmail = normalizeEmail(process.env.SLAVOMIR_APPROVAL_EMAIL ?? "");
  if (!recipientEmail) return null;
  return {
    recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
    recipientUserId: null,
    recipientName: SLAVOMIR_APPROVAL_NAME,
    recipientEmail,
  };
}

const accessibleStageSixProjectWhere = {
  workflowStages: {
    some: {
      stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
      status: { in: [...ACCESSIBLE_WORKFLOW_STAGE_STATUSES] },
    },
  },
} satisfies Prisma.ProjectWhereInput;

class StageSixWorkflowError extends Error {}

export type ProductionFileRecord = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isSource: boolean;
};

export type ProductionSharedFieldSnapshot = {
  key: ProjectFileChecklistField;
  label: string;
  value: Prisma.JsonValue | null;
  attachments: Array<Omit<ProductionFileRecord, "isSource">>;
};

export type ProductionSharedSnapshot = {
  version: 1;
  capturedAt: string;
  fields: ProductionSharedFieldSnapshot[];
  files: ProductionFileRecord[];
};

export type StageSixApprovalStepRecord = {
  id: string;
  reviewHref: string | null;
  sequence: number;
  isMarketingDirectorRequired: boolean;
  isConfigured: boolean;
  recipientType: ProductionApprovalRecipientType | null;
  recipientName: string;
  recipientEmail: string | null;
  sharedFieldKeys: ProjectFileChecklistField[];
  selectedFileIds: string[];
  message: string | null;
  status: ProductionApprovalStepStatus;
  dispatchStatus: ProductionDispatchStatus;
  activatedAt: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  rejectionHistory: Array<{ decidedAt: string; decisionComment: string | null; recipientName: string; resentAt: string }>;
  failureMessage: string | null;
  removedAt: string | null;
  removedByName: string | null;
  statusAtRemoval: ProductionApprovalStepStatus | null;
};

export type StageSixUnitRecord = {
  id: string;
  name: string;
  status: ProjectProductionUnitStatus;
  sourceHandoffId: string;
  sourceChecklistId: string;
  sourceFile: ProductionFileRecord;
  productionFiles: ProductionFileRecord[];
  checklist: Array<{
    key: ProjectFileChecklistField;
    label: string;
    value: Prisma.JsonValue | null;
    attachments: Array<Omit<ProductionFileRecord, "isSource">>;
  }>;
  approvalSteps: StageSixApprovalStepRecord[];
  removedApprovalSteps: StageSixApprovalStepRecord[];
  approvalState: "NOT_REQUIRED" | "PENDING" | "REJECTED" | "APPROVED";
  handoverReady: boolean;
  handoverBlocker: string | null;
  handover: {
    route: ProductionHandoverRoute;
    recipientName: string;
    recipientEmail: string;
    recipientCompany: string | null;
    recipientPhone: string | null;
    deliveryStatus: ProductionHandoverDeliveryStatus;
    sentAt: string | null;
    failureMessage: string | null;
  } | null;
  approvedAt: string | null;
  handedOverAt: string | null;
};

export type StageSixWorkspaceData = {
  units: StageSixUnitRecord[];
  marketingDirectorRecipient: { name: string; email: string | null };
  participants: Array<{ id: string; name: string; email: string; role: string }>;
  handoverRecipients: Array<{ id: string; name: string; email: string; role: string }>;
  canManage: boolean;
  canSaveArchive: boolean;
  stageCompleted: boolean;
  savedArchive: {
    archiveCategorySlug: string | null;
    archiveCategoryLabel: string;
    fileCount: number;
    savedAt: string;
  } | null;
  summary: {
    total: number;
    approved: number;
    approvalNotRequired: number;
    pending: number;
    rejected: number;
    ready: number;
    handedOver: number;
  };
};

export type ProductionApprovalData =
  | { state: "invalid" | "expired" | "unavailable" | "locked" }
  | {
      state: "completed";
      decision: "APPROVED" | "REJECTED";
      projectName: string;
      unitName: string;
      decidedAt: string | null;
    }
  | {
      state: "active" | "approved" | "rejected";
      stepId: string;
      project: { id: string; name: string };
      unit: { id: string; name: string };
      stepLabel: string;
      requestedBy: string;
      requestVersion: string | null;
      message: string | null;
      snapshot: ProductionSharedSnapshot;
      decisionComment: string | null;
      decidedAt: string | null;
    };

export type ProductionHandoverData =
  | { state: "invalid" | "expired" | "unavailable" }
  | {
      state: "active";
      project: { id: string; name: string };
      unit: { id: string; name: string };
      sender: string;
      route: ProductionHandoverRoute;
      note: string | null;
      snapshot: ProductionSharedSnapshot;
      sentAt: string;
    };

const attachmentSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  bucket: true,
  storageKey: true,
  status: true,
  projectId: true,
  assetType: true,
  stageId: true,
  revisionId: true,
  commentId: true,
} satisfies Prisma.ProjectAttachmentSelect;

function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLocaleLowerCase("en-US");
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function validClientRequestId(value: string) {
  return /^[a-zA-Z0-9_-]{16,120}$/.test(value);
}

function stageStatus(project: StageProject, key: ProjectWorkflowStageKey) {
  return project.workflowStages.find((stage) => stage.stageKey === key)?.status;
}

export function canManageStageSix(user: PermissionUser, project: StageProject) {
  return (
    (isProjectOwner(user, project) ||
      isProjectCoOwner(user, project) ||
      isGlobalProjectAdministrator(user)) &&
    hasProjectPermission(user, project, "stage.view")
  );
}

function isProjectParticipant(project: StageProject, userId: string) {
  return (
    project.ownerId === userId ||
    project.coOwners.some((entry) => entry.userId === userId) ||
    project.executors.some((entry) => entry.userId === userId) ||
    project.collaborators.some((entry) => entry.userId === userId)
  );
}

function getParticipants(project: StageProject) {
  const candidates = [
    ...(project.owner ? [{ user: project.owner, role: "Project Owner" }] : []),
    ...project.coOwners.map(({ user }) => ({ user, role: "Project Co-Owner" })),
    ...project.executors.map(({ user }) => ({ user, role: "Project Executor" })),
    ...project.collaborators.map(({ user }) => ({ user, role: "Project Collaborator" })),
  ];
  const unique = new Map<string, { id: string; name: string; email: string; role: string }>();
  for (const { user, role } of candidates) {
    if (!unique.has(user.id)) {
      unique.set(user.id, {
        id: user.id,
        name: displayName(user),
        email: user.email,
        role,
      });
    }
  }
  return [...unique.values()];
}

function getHandoverRecipients(project: StageProject) {
  return getParticipants(project).filter(
    (participant) => participant.id !== project.ownerId,
  );
}

function mapFile(
  attachment: {
    id: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
  },
  isSource: boolean,
): ProductionFileRecord {
  return {
    id: attachment.id,
    name: attachment.originalFileName,
    mimeType: attachment.mimeType,
    size: attachment.fileSize,
    isSource,
  };
}

function deriveProductionUnitReadiness(input: {
  sourceAttachmentStatus: AttachmentStatus;
  approvalSteps: Array<{ status: ProductionApprovalStepStatus }>;
}) {
  const approvalState =
    input.approvalSteps.length === 0
      ? ("NOT_REQUIRED" as const)
      : input.approvalSteps.some(
            (step) => step.status === ProductionApprovalStepStatus.REJECTED,
          )
        ? ("REJECTED" as const)
        : input.approvalSteps.every(
              (step) => step.status === ProductionApprovalStepStatus.APPROVED,
            )
          ? ("APPROVED" as const)
          : ("PENDING" as const);
  const sourceReady = input.sourceAttachmentStatus === AttachmentStatus.READY;
  const approvalReady =
    approvalState === "NOT_REQUIRED" || approvalState === "APPROVED";

  return {
    approvalState,
    handoverReady: sourceReady && approvalReady,
    handoverBlocker: !sourceReady
      ? "The required Stage 5 production source is not ready."
      : approvalState === "REJECTED"
        ? "Resolve or remove the rejected approval step first."
        : approvalState === "PENDING"
          ? "Complete this unit's approval chain first."
          : null,
  };
}

function parseSnapshot(value: Prisma.JsonValue | null): ProductionSharedSnapshot | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const snapshot = value as unknown as ProductionSharedSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.files)) {
    return null;
  }
  return snapshot;
}

function uniqueAllowedFieldKeys(values: ProjectFileChecklistField[]) {
  const keys = Array.from(new Set(values));
  return keys.length === values.length &&
    keys.every((key) => STAGE_FIVE_FIELD_KEYS.includes(key))
    ? keys
    : null;
}

async function getAuthorizedStageSixProject(user: PermissionUser, projectId: string) {
  const project = await getProjectStageAccessRecordById(projectId);
  if (
    !project ||
    !hasProjectPermission(user, project, "project.view") ||
    !hasProjectPermission(user, project, "stage.view")
  ) {
    return null;
  }
  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
      status: stageStatus(project, ProjectWorkflowStageKey.FINAL_LAYOUT),
    })
  ) {
    return null;
  }
  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
      status: stageStatus(project, ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER),
    })
  ) {
    return null;
  }
  return project;
}

async function getStageSixManagerProject(user: PermissionUser, projectId: string) {
  const project = await getAuthorizedStageSixProject(user, projectId);
  return project && canManageStageSix(user, project) ? project : null;
}

function createDedupeNotificationData(input: {
  userIds: Array<string | null | undefined>;
  actorId?: string;
  dedupePrefix: string;
  type:
    | "NEXT_STAGE_ACTIVATED"
    | "PRODUCTION_APPROVAL_REQUESTED"
    | "PRODUCTION_APPROVAL_APPROVED"
    | "PRODUCTION_APPROVAL_REJECTED"
    | "PRODUCTION_HANDOVER_COMPLETED";
  title: string;
  message: string;
  entityType: "PROJECT" | "PRODUCTION_UNIT" | "PRODUCTION_APPROVAL";
  entityId: string;
  projectId: string;
  url: string;
}) {
  return Array.from(new Set(input.userIds.filter((id): id is string => Boolean(id))))
    .filter((id) => id !== input.actorId)
    .map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId,
      url: input.url,
      dedupeKey: `${input.dedupePrefix}:${userId}`,
    }));
}

async function createNotifications(
  tx: Prisma.TransactionClient,
  data: ReturnType<typeof createDedupeNotificationData>,
) {
  if (!data.length) return;
  await tx.notification.createMany({ data, skipDuplicates: true });
}

async function buildSharedSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    productionUnitId: string;
    fieldKeys: ProjectFileChecklistField[];
    selectedFileIds: string[];
    now?: Date;
  },
) {
  const fieldKeys = uniqueAllowedFieldKeys(input.fieldKeys);
  const selectedFileIds = Array.from(
    new Set(input.selectedFileIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (!fieldKeys || selectedFileIds.length !== input.selectedFileIds.length) {
    return { error: "The shared-information selection is invalid." } as const;
  }

  const unit = await tx.projectProductionUnit.findUnique({
    where: { id: input.productionUnitId },
    select: {
      id: true,
      projectId: true,
      sourceAttachment: { select: attachmentSelect },
      files: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { attachment: { select: attachmentSelect } },
      },
      sourceChecklist: {
        select: {
          items: {
            where: { fieldKey: { in: fieldKeys } },
            select: {
              fieldKey: true,
              value: true,
              attachments: {
                orderBy: { createdAt: "asc" },
                select: { attachment: { select: attachmentSelect } },
              },
            },
          },
        },
      },
    },
  });
  if (!unit) return { error: "Production Unit not found." } as const;

  const allowedFiles = [
    unit.sourceAttachment,
    ...unit.files.map(({ attachment }) => attachment),
  ].filter(
    (attachment) =>
      attachment.projectId === unit.projectId && attachment.status === AttachmentStatus.READY,
  );
  const allowedFileById = new Map(allowedFiles.map((file) => [file.id, file]));
  if (selectedFileIds.some((id) => !allowedFileById.has(id))) {
    return {
      error: "One or more selected production files are invalid or belong to another project.",
    } as const;
  }
  if (!fieldKeys.length && !selectedFileIds.length) {
    return { error: "Select at least one production file or shared detail." } as const;
  }

  const itemByKey = new Map(
    unit.sourceChecklist.items.map((item) => [item.fieldKey, item]),
  );
  for (const item of unit.sourceChecklist.items) {
    if (
      item.attachments.some(
        ({ attachment }) =>
          attachment.projectId !== unit.projectId || attachment.status !== AttachmentStatus.READY,
      )
    ) {
      return { error: "A selected checklist attachment is missing or invalid." } as const;
    }
  }

  const snapshot: ProductionSharedSnapshot = {
    version: 1,
    capturedAt: (input.now ?? new Date()).toISOString(),
    fields: fieldKeys.map((key) => {
      const item = itemByKey.get(key);
      return {
        key,
        label: STAGE_FIVE_FIELD_LABELS[key],
        value: item?.value ?? null,
        attachments:
          item?.attachments.map(({ attachment }) => ({
            id: attachment.id,
            name: attachment.originalFileName,
            mimeType: attachment.mimeType,
            size: attachment.fileSize,
          })) ?? [],
      };
    }),
    files: selectedFileIds.map((id) => {
      const file = allowedFileById.get(id)!;
      return mapFile(file, file.id === unit.sourceAttachment.id);
    }),
  };
  return { snapshot } as const;
}

const workspaceUnitSelect = {
  id: true,
  status: true,
  sourceHandoffId: true,
  sourceChecklistId: true,
  sourceAttachment: { select: attachmentSelect },
  sourceChecklist: {
    select: {
      items: {
        orderBy: { fieldKey: "asc" as const },
        select: {
          fieldKey: true,
          value: true,
          attachments: {
            orderBy: { createdAt: "asc" as const },
            select: { attachment: { select: attachmentSelect } },
          },
        },
      },
    },
  },
  files: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: { attachment: { select: attachmentSelect } },
  },
  approvalSteps: {
    orderBy: [{ sequence: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      clientRequestId: true,
      sequence: true,
      isMarketingDirectorRequired: true,
      recipientType: true,
      recipientUserId: true,
      recipientName: true,
      recipientEmail: true,
      sharedFieldKeys: true,
      selectedFileIds: true,
      message: true,
      status: true,
      dispatchStatus: true,
      activatedAt: true,
      sentAt: true,
      decidedAt: true,
      decisionComment: true,
      rejectionHistory: true,
      failureMessage: true,
      removedAt: true,
      statusAtRemoval: true,
      removedByUser: { select: { name: true, email: true } },
    },
  },
  handover: {
    select: {
      route: true,
      recipientName: true,
      recipientEmail: true,
      recipientCompany: true,
      recipientPhone: true,
      deliveryStatus: true,
      sentAt: true,
      failureMessage: true,
    },
  },
  approvedAt: true,
  handedOverAt: true,
} satisfies Prisma.ProjectProductionUnitSelect;

export async function getStageSixWorkspaceData(
  user: PermissionUser,
  projectId: string,
): Promise<StageSixWorkspaceData | null> {
  const project = await getAuthorizedStageSixProject(user, projectId);
  if (!project || !canManageStageSix(user, project)) return null;
  const [records, savedArchive] = await withPrismaRetry(() =>
    Promise.all([
      prisma.projectProductionUnit.findMany({
        where: { projectId },
        relationLoadStrategy: "join",
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: workspaceUnitSelect,
      }),
      prisma.projectArchive.findUnique({
        where: { projectId },
        select: {
          status: true,
          archivedAt: true,
          archiveCategory: { select: { slug: true, name: true } },
          _count: { select: { files: true } },
        },
      }),
    ]),
  );
  const marketingDirectorRecipient = {
    name: SLAVOMIR_APPROVAL_NAME,
    email: getSlavomirApprovalRecipient()?.recipientEmail ?? null,
  };
  const units: StageSixUnitRecord[] = records.map((unit) => {
    const itemByKey = new Map(
      unit.sourceChecklist.items.map((item) => [item.fieldKey, item]),
    );
    const approvalSteps = unit.approvalSteps.map((step) => {
      const { recipientUserId, clientRequestId, removedByUser, ...visibleStep } = step;
      const isUnconfiguredFirstApprover =
        step.isMarketingDirectorRequired &&
        step.sequence === 1 &&
        !step.clientRequestId;
      const usesConfiguredRecipient = step.isMarketingDirectorRequired && !step.removedAt &&
        (step.status === ProductionApprovalStepStatus.WAITING || step.dispatchStatus === ProductionDispatchStatus.FAILED);
      return {
        ...visibleStep,
        isConfigured: Boolean(clientRequestId),
        rejectionHistory: readRejectionHistory(step.rejectionHistory).map((entry) => ({
          decidedAt: String(entry.decidedAt), decisionComment: typeof entry.decisionComment === "string" ? richTextToPlainText(entry.decisionComment) : null,
          recipientName: typeof entry.recipientName === "string" ? entry.recipientName : "Approver", resentAt: String(entry.resentAt),
        })),
        reviewHref:
          !step.removedAt &&
          recipientUserId === user.id &&
          step.status === ProductionApprovalStepStatus.ACTIVE &&
          step.dispatchStatus === ProductionDispatchStatus.SENT
            ? `/production-approvals/${step.id}`
            : null,
        recipientType: isUnconfiguredFirstApprover ? null : usesConfiguredRecipient ? ProductionApprovalRecipientType.EXTERNAL_EMAIL : step.recipientType,
        recipientName: usesConfiguredRecipient ? marketingDirectorRecipient.name : step.recipientName?.trim() || "Not assigned",
        recipientEmail: usesConfiguredRecipient ? marketingDirectorRecipient.email : step.recipientEmail,
        activatedAt: step.activatedAt?.toISOString() ?? null,
        sentAt: step.sentAt?.toISOString() ?? null,
        decidedAt: step.decidedAt?.toISOString() ?? null,
        removedAt: step.removedAt?.toISOString() ?? null,
        removedByName: removedByUser ? displayName(removedByUser) : null,
      };
    });
    const liveApprovalSteps = approvalSteps.filter((step) => !step.removedAt);
    const readiness = deriveProductionUnitReadiness({
      sourceAttachmentStatus: unit.sourceAttachment.status,
      approvalSteps: liveApprovalSteps,
    });
    return {
      id: unit.id,
      name: unit.sourceAttachment.originalFileName,
      status: unit.status,
      sourceHandoffId: unit.sourceHandoffId,
      sourceChecklistId: unit.sourceChecklistId,
      sourceFile: mapFile(unit.sourceAttachment, true),
      productionFiles: unit.files.map(({ attachment }) => mapFile(attachment, false)),
      checklist: STAGE_FIVE_FIELD_KEYS.map((key) => {
        const item = itemByKey.get(key);
        return {
          key,
          label: STAGE_FIVE_FIELD_LABELS[key],
          value: item?.value ?? null,
          attachments:
            item?.attachments.map(({ attachment }) => ({
              id: attachment.id,
              name: attachment.originalFileName,
              mimeType: attachment.mimeType,
              size: attachment.fileSize,
            })) ?? [],
        };
      }),
      approvalSteps: liveApprovalSteps,
      removedApprovalSteps: approvalSteps.filter((step) => Boolean(step.removedAt)),
      ...readiness,
      handover: unit.handover
        ? {
            ...unit.handover,
            sentAt: unit.handover.sentAt?.toISOString() ?? null,
          }
        : null,
      approvedAt: unit.approvedAt?.toISOString() ?? null,
      handedOverAt: unit.handedOverAt?.toISOString() ?? null,
    };
  });
  return {
    units,
    marketingDirectorRecipient,
    participants: getParticipants(project),
    handoverRecipients: getHandoverRecipients(project),
    canManage: canManageStageSix(user, project),
    canSaveArchive:
      (isSuperAdminRole(user.role) ||
        isProjectOwner(user, project) ||
        isProjectCoOwner(user, project)) &&
      hasProjectPermission(user, project, "project.completeArchive"),
    stageCompleted:
      stageStatus(project, ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER) ===
      ProjectWorkflowStageStatus.COMPLETED,
    savedArchive:
      savedArchive?.status === ArchiveRecordStatus.SAVED
        ? {
            archiveCategorySlug: savedArchive.archiveCategory?.slug ?? null,
            archiveCategoryLabel:
              savedArchive.archiveCategory?.name ?? "Uncategorized",
            fileCount: savedArchive._count.files,
            savedAt: savedArchive.archivedAt.toISOString(),
          }
        : null,
    summary: {
      total: units.length,
      approved: units.filter(
        (unit) => unit.approvalState === "APPROVED",
      ).length,
      approvalNotRequired: units.filter(
        (unit) => unit.approvalState === "NOT_REQUIRED",
      ).length,
      pending: units.filter((unit) => unit.approvalState === "PENDING").length,
      rejected: units.filter((unit) => unit.approvalState === "REJECTED").length,
      ready: units.filter((unit) => unit.handoverReady).length,
      handedOver: units.filter((unit) => unit.status === ProjectProductionUnitStatus.HANDED_OVER).length,
    },
  };
}

export async function getStageFiveCompletionState(
  user: PermissionUser,
  projectId: string,
) {
  const project = await getProjectStageAccessRecordById(projectId);
  if (!project || !hasProjectPermission(user, project, "project.view")) return null;
  const [handoffCount, pendingRequestCount] = await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectStageFileHandoff.count({
        where: {
          projectId,
          sourceWorkflowStageKey: {
            in: [...STAGE_FIVE_SOURCE_WORKFLOW_STAGE_KEYS],
          },
          targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
        },
      }),
      prisma.projectFileChecklistRequest.count({
        where: {
          projectId,
          workflowStatus: {
            in: [
              ProjectFileChecklistRequestWorkflowStatus.REQUESTED,
              ProjectFileChecklistRequestWorkflowStatus.ACCEPTED,
            ],
          },
        },
      }),
    ]),
  );
  return {
    canComplete:
      canManageStageSix(user, project) &&
      hasProjectPermission(user, project, "stage.markStageComplete"),
    completed:
      stageStatus(project, ProjectWorkflowStageKey.FINAL_LAYOUT) ===
      ProjectWorkflowStageStatus.COMPLETED,
    handoffCount,
    pendingRequestCount,
  };
}

export async function completeStageFive(
  user: PermissionUser,
  input: { projectId: string },
  conflictRetryCount = 0,
) {
  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const project = await tx.project.findUnique({
            where: { id: input.projectId },
            select: {
              id: true,
              name: true,
              ownerId: true,
              coOwners: { select: { userId: true } },
              workflowStages: {
                select: {
                  id: true,
                  stageKey: true,
                  status: true,
                  unlockedAt: true,
                  completedAt: true,
                },
              },
              stageFileHandoffs: {
                where: {
                  sourceWorkflowStageKey: {
                    in: [...STAGE_FIVE_SOURCE_WORKFLOW_STAGE_KEYS],
                  },
                  targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
                },
                orderBy: [{ handedOffAt: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  projectId: true,
                  sourceWorkflowStageKey: true,
                  sourceAttachmentId: true,
                  sourceAttachment: { select: attachmentSelect },
                  checklist: {
                    select: {
                      id: true,
                      projectId: true,
                      handoffId: true,
                      sourceAttachmentId: true,
                      items: {
                        select: {
                          checklistId: true,
                          attachments: {
                            select: { attachment: { select: attachmentSelect } },
                          },
                        },
                      },
                    },
                  },
                },
              },
              fileChecklistRequests: {
                where: {
                  workflowStatus: {
                    in: [
                      ProjectFileChecklistRequestWorkflowStatus.REQUESTED,
                      ProjectFileChecklistRequestWorkflowStatus.ACCEPTED,
                    ],
                  },
                },
                select: { id: true },
              },
            },
          });
          if (!project) return { error: "Project not found." } as const;
          const manager =
            (isProjectOwner(user, project) ||
              isProjectCoOwner(user, project) ||
              isGlobalProjectAdministrator(user)) &&
            hasProjectPermission(user, project, "stage.markStageComplete");
          if (!manager) {
            return { error: "You do not have permission to complete Stage 5." } as const;
          }
          const stageFive = project.workflowStages.find(
            (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
          );
          const stageSix = project.workflowStages.find(
            (stage) => stage.stageKey === ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
          );
          const stageSeven = project.workflowStages.find(
            (stage) => stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
          );
          if (!stageFive || !stageSix || !stageSeven) {
            return { error: "Stage 5, Stage 6, and Stage 7 workflow records are required." } as const;
          }
          const completionMode = getWorkflowStageCompletionMode(
            project.workflowStages,
            ProjectWorkflowStageKey.FINAL_LAYOUT,
          );
          if (completionMode === "UNAVAILABLE") {
            return { error: "Stage 5 is not currently available." } as const;
          }
          if (!project.stageFileHandoffs.length) {
            return { error: "At least one Stage 5 final file is required before completion." } as const;
          }
          for (const handoff of project.stageFileHandoffs) {
            const checklist = handoff.checklist;
            if (
              handoff.projectId !== project.id ||
              !isStageFiveSourceWorkflowStageKey(
                handoff.sourceWorkflowStageKey,
              ) ||
              handoff.sourceAttachment.projectId !== project.id ||
              handoff.sourceAttachment.status !== AttachmentStatus.READY
            ) {
              return { error: "A Stage 5 source handoff is missing or corrupt." } as const;
            }
            if (
              handoff.sourceWorkflowStageKey ===
                ProjectWorkflowStageKey.FINAL_LAYOUT &&
              (handoff.sourceAttachment.assetType !==
                AttachmentAssetType.GENERAL_PROJECT_ASSET ||
                handoff.sourceAttachment.stageId ||
                handoff.sourceAttachment.revisionId ||
                handoff.sourceAttachment.commentId)
            ) {
              return {
                error: "A direct Stage 5 source has invalid provenance.",
              } as const;
            }
            if (
              !checklist ||
              checklist.projectId !== project.id ||
              checklist.handoffId !== handoff.id ||
              checklist.sourceAttachmentId !== handoff.sourceAttachmentId ||
              checklist.items.some((item) => item.checklistId !== checklist.id)
            ) {
              return { error: "A Stage 5 checklist reference is invalid." } as const;
            }
            if (
              checklist.items.some((item) =>
                item.attachments.some(
                  ({ attachment }) =>
                    attachment.projectId !== project.id ||
                    attachment.status !== AttachmentStatus.READY,
                ),
              )
            ) {
              return { error: "A Stage 5 checklist attachment is missing or invalid." } as const;
            }
          }

          const transitioned = completionMode === "TRANSITION";
          if (transitioned && stageSeven.status !== ProjectWorkflowStageStatus.LOCKED) {
            return { error: "Stage 7 must remain locked while Stage 5 is completed." } as const;
          }
          const units: Array<{ id: string; sourceHandoffId: string }> = [];
          for (const handoff of project.stageFileHandoffs) {
            const checklist = handoff.checklist!;
            const unit = await tx.projectProductionUnit.upsert({
              where: { sourceHandoffId: handoff.id },
              update: {},
              create: {
                projectId: project.id,
                sourceHandoffId: handoff.id,
                sourceChecklistId: checklist.id,
                sourceAttachmentId: handoff.sourceAttachmentId,
                createdById: user.id,
              },
              select: {
                id: true,
                projectId: true,
                sourceHandoffId: true,
                sourceChecklistId: true,
                sourceAttachmentId: true,
              },
            });
            if (
              unit.projectId !== project.id ||
              unit.sourceChecklistId !== checklist.id ||
              unit.sourceAttachmentId !== handoff.sourceAttachmentId
            ) {
              return { error: "An existing Production Unit conflicts with Stage 5 lineage." } as const;
            }
            const requiredStep = await tx.productionApprovalStep.upsert({
              where: {
                productionUnitId_sequence: {
                  productionUnitId: unit.id,
                  sequence: 1,
                },
              },
              update: {},
              create: {
                productionUnitId: unit.id,
                sequence: 1,
                isMarketingDirectorRequired: true,
              },
              select: { isMarketingDirectorRequired: true },
            });
            if (!requiredStep.isMarketingDirectorRequired) {
              return { error: "Production approval Step 1 is invalid." } as const;
            }
            units.push({ id: unit.id, sourceHandoffId: handoff.id });
          }
          const now = new Date();
          if (transitioned) {
            const completed = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageFive.id,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                completedAt: now,
              },
            });

            if (completed.count === 1) {
              await disableProjectRequestReminders(tx, {
                projectId: project.id,
                stage: "FIVE",
                now,
              });
              await tx.projectWorkflowStage.updateMany({
                where: {
                  id: stageSix.id,
                  status: ProjectWorkflowStageStatus.LOCKED,
                },
                data: {
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                  unlockedAt: now,
                },
              });
            }
          }
          if (transitioned) {
            await createNotifications(
              tx,
              createDedupeNotificationData({
                userIds: [project.ownerId, ...project.coOwners.map((entry) => entry.userId)],
                actorId: user.id,
                dedupePrefix: `stage-six-activated:${project.id}`,
                type: "NEXT_STAGE_ACTIVATED",
                title: "Stage 6 available",
                message: `${units.length} Production Unit${units.length === 1 ? " is" : "s are"} ready in ${project.name}.`,
                entityType: "PROJECT",
                entityId: project.id,
                projectId: project.id,
                url: `/projects/${project.id}/stages/6`,
              }),
            );
          }
          return {
            transitioned,
            productionUnitCount: units.length,
            pendingRequestCount: project.fileChecklistRequests.length,
            warning:
              project.fileChecklistRequests.length > 0
                ? "Some checklist information requests are still pending."
                : null,
            units,
          } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034") &&
      conflictRetryCount < 1
    ) {
      return completeStageFive(user, input, conflictRetryCount + 1);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return { error: "Stage 5 changed at the same time. Please try again." } as const;
    }
    throw error;
  }
}

async function resolveRecipient(
  project: StageProject,
  input: {
    recipientType: ProductionApprovalRecipientType;
    recipientUserId?: string;
    recipientName?: string;
    recipientEmail?: string;
    recipientCompany?: string;
    recipientPhone?: string;
  },
) {
  if (input.recipientType === ProductionApprovalRecipientType.EXISTING_COLLABORATOR) {
    const recipientUserId = input.recipientUserId?.trim();
    if (!recipientUserId || !isProjectParticipant(project, recipientUserId)) {
      return { ok: false, error: "Select a current project collaborator." } as const;
    }
    const participant = getParticipants(project).find((entry) => entry.id === recipientUserId);
    if (!participant) return { ok: false, error: "The selected collaborator is unavailable." } as const;
    return {
      ok: true,
      recipientType: input.recipientType,
      recipientUserId,
      recipientName: participant.name,
      recipientEmail: participant.email,
    } as const;
  }
  const recipientEmail = normalizeEmail(input.recipientEmail ?? "");
  if (!recipientEmail) return { ok: false, error: "Enter a valid recipient email address." } as const;
  const recipientName = input.recipientName?.trim() || recipientEmail;
  if (recipientName.length > 160) return { ok: false, error: "Recipient name is too long." } as const;
  return {
    ok: true,
    recipientType: input.recipientType,
    recipientUserId: null,
    recipientName,
    recipientEmail,
  } as const;
}

function validateApproverInput(input: {
  clientRequestId: string;
  sharedFieldKeys: ProjectFileChecklistField[];
  selectedFileIds: string[];
  message?: string;
}) {
  if (!validClientRequestId(input.clientRequestId)) return "Invalid request identifier.";
  if (!uniqueAllowedFieldKeys(input.sharedFieldKeys)) return "Unknown shared-information field.";
  if (input.message && richTextToPlainText(input.message).length > 5_000) return "The approver message is too long.";
  return null;
}

async function sendExternalApproval(
  input: { stepId: string; rawToken: string; tokenHash: string },
  sendEmail: EmailSender,
) {
  const step = await withPrismaRetry(() =>
    prisma.productionApprovalStep.findFirst({
      where: {
        id: input.stepId,
        removedAt: null,
        status: ProductionApprovalStepStatus.ACTIVE,
        dispatchStatus: ProductionDispatchStatus.PENDING,
        externalTokenHash: input.tokenHash,
        recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
      },
      select: {
        id: true,
        sequence: true,
        isMarketingDirectorRequired: true,
        recipientName: true,
        recipientEmail: true,
        message: true,
        requestedBy: { select: { name: true, email: true } },
        productionUnit: {
          select: {
            sourceAttachment: { select: { originalFileName: true } },
            project: { select: { name: true } },
          },
        },
      },
    }),
  );
  if (!step?.recipientEmail || !step.requestedBy) {
    return { error: "This approval dispatch is unavailable." } as const;
  }
  const email = buildProductionApprovalEmail({
    recipientName: step.recipientName?.trim() || step.recipientEmail,
    requesterName: displayName(step.requestedBy),
    projectName: step.productionUnit.project.name,
    unitName: step.productionUnit.sourceAttachment.originalFileName,
    stepLabel: step.isMarketingDirectorRequired
      ? "Marketing Director"
      : `Step ${step.sequence}`,
    message: step.message,
    approvalUrl: buildExternalProductionApprovalUrl(input.rawToken),
  });
  let result: Awaited<ReturnType<EmailSender>>;
  try {
    result = await sendEmail({
      to: step.recipientEmail,
      ...email,
      replyTo: step.requestedBy.email,
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "The email provider could not be reached.",
    };
  }
  const now = new Date();
  if (!result.ok) {
    await withPrismaRetry(() =>
      prisma.productionApprovalStep.updateMany({
        where: {
          id: step.id,
          removedAt: null,
          dispatchStatus: ProductionDispatchStatus.PENDING,
          externalTokenHash: input.tokenHash,
        },
        data: {
          dispatchStatus: ProductionDispatchStatus.FAILED,
          failedAt: now,
          failureMessage: result.error.slice(0, 5_000),
          externalTokenRevokedAt: now,
        },
      }),
    );
    return { error: `The approval email could not be sent: ${result.error}` } as const;
  }
  await withPrismaRetry(() =>
    prisma.productionApprovalStep.updateMany({
      where: {
        id: step.id,
        removedAt: null,
        dispatchStatus: ProductionDispatchStatus.PENDING,
        externalTokenHash: input.tokenHash,
      },
      data: {
        dispatchStatus: ProductionDispatchStatus.SENT,
        sentAt: now,
        failedAt: null,
        failureMessage: null,
      },
    }),
  );
  return { sent: true } as const;
}

export async function configureMarketingDirector(
  user: PermissionUser,
  input: {
    clientRequestId: string;
    projectId: string;
    productionUnitId: string;
    recipientType: ProductionApprovalRecipientType;
    recipientUserId?: string;
    recipientName?: string;
    recipientEmail?: string;
    sharedFieldKeys: ProjectFileChecklistField[];
    selectedFileIds: string[];
    message?: string;
  },
  options: { sendEmail?: EmailSender } = {},
) {
  void options; // Saving an approver never dispatches a request.
  const validationError = validateApproverInput(input);
  if (validationError) return { error: validationError } as const;
  if (!input.selectedFileIds.length) {
    return { error: "Marketing Director approval must include at least one production file." } as const;
  }
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  const recipientData = getSlavomirApprovalRecipient();
  if (!recipientData) return { error: SLAVOMIR_APPROVAL_CONFIGURATION_ERROR } as const;
  const message = sanitizeRichText(input.message) || null;
  let prepared;
  try {
    prepared = await withPrismaRetry(() =>
      prisma.$transaction(
      async (tx) => {
        const existingRequest = await tx.productionApprovalStep.findUnique({
          where: { clientRequestId: input.clientRequestId },
          select: { id: true, productionUnitId: true, status: true, dispatchStatus: true },
        });
        if (existingRequest) {
          return existingRequest.productionUnitId === input.productionUnitId
            ? ({ duplicate: true, step: existingRequest } as const)
            : ({ error: "This request identifier is already in use." } as const);
        }
        const unit = await tx.projectProductionUnit.findFirst({
          where: {
            id: input.productionUnitId,
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.PREPARATION,
                ProjectProductionUnitStatus.APPROVAL_PENDING,
              ],
            },
            project: {
              workflowStages: {
                some: {
                  stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                },
              },
            },
          },
          select: { id: true },
        });
        if (!unit) return { error: "This Production Unit is no longer in preparation." } as const;
        const snapshot = await buildSharedSnapshot(tx, {
          productionUnitId: unit.id,
          fieldKeys: input.sharedFieldKeys,
          selectedFileIds: input.selectedFileIds,
        });
        if ("error" in snapshot) return { error: snapshot.error } as const;
        const updated = await tx.productionApprovalStep.updateMany({
          where: {
            productionUnitId: unit.id,
            sequence: 1,
            isMarketingDirectorRequired: true,
            clientRequestId: null,
            removedAt: null,
            status: ProductionApprovalStepStatus.WAITING,
          },
          data: {
            clientRequestId: input.clientRequestId,
            ...recipientData,
            requestedById: user.id,
            sharedFieldKeys: input.sharedFieldKeys,
            selectedFileIds: input.selectedFileIds,
            message,
            status: ProductionApprovalStepStatus.WAITING,
            dispatchStatus: ProductionDispatchStatus.NOT_SENT,
          },
        });
        if (updated.count !== 1) {
          return { error: "The Marketing Director step has already been assigned." } as const;
        }
        await tx.projectProductionUnit.update({
          where: { id: unit.id },
          data: { status: ProjectProductionUnitStatus.PREPARATION },
        });
        const step = await tx.productionApprovalStep.findUniqueOrThrow({
          where: {
            productionUnitId_sequence: { productionUnitId: unit.id, sequence: 1 },
          },
          select: { id: true, status: true, dispatchStatus: true },
        });
        return { duplicate: false, step } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const existing = await withPrismaRetry(() =>
        prisma.productionApprovalStep.findUnique({
          where: { clientRequestId: input.clientRequestId },
          select: { id: true, productionUnitId: true, status: true, dispatchStatus: true },
        }),
      );
      return existing?.productionUnitId === input.productionUnitId
        ? ({ duplicate: true, step: existing } as const)
        : ({ error: "The approval chain changed at the same time. Please try again." } as const);
    }
    throw error;
  }
  return prepared;
}

export async function addProductionApprover(
  user: PermissionUser,
  input: {
    clientRequestId: string;
    projectId: string;
    productionUnitId: string;
    recipientType: ProductionApprovalRecipientType;
    recipientUserId?: string;
    recipientName?: string;
    recipientEmail?: string;
    sharedFieldKeys: ProjectFileChecklistField[];
    selectedFileIds: string[];
    message?: string;
  },
  options: { sendEmail?: EmailSender } = {},
  conflictRetryCount = 0,
) {
  const validationError = validateApproverInput(input);
  if (validationError) return { error: validationError } as const;
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  const recipient = await resolveRecipient(project, input);
  if (!recipient.ok) return { error: recipient.error } as const;
  const recipientData = {
    recipientType: recipient.recipientType,
    recipientUserId: recipient.recipientUserId,
    recipientName: recipient.recipientName,
    recipientEmail: recipient.recipientEmail,
  };
  const message = sanitizeRichText(input.message) || null;
  let outcome;
  try {
    outcome = await withPrismaRetry(() =>
      prisma.$transaction(
      async (tx) => {
        const existing = await tx.productionApprovalStep.findUnique({
          where: { clientRequestId: input.clientRequestId },
          select: { id: true, productionUnitId: true, sequence: true },
        });
        if (existing) {
          return existing.productionUnitId === input.productionUnitId
            ? ({ step: existing, duplicate: true } as const)
            : ({ error: "This request identifier is already in use." } as const);
        }
        const unit = await tx.projectProductionUnit.findFirst({
          where: {
            id: input.productionUnitId,
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.PREPARATION,
                ProjectProductionUnitStatus.APPROVAL_PENDING,
                ProjectProductionUnitStatus.REJECTED,
                ProjectProductionUnitStatus.HANDOVER_READY,
              ],
            },
            project: {
              workflowStages: {
                some: {
                  stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                },
              },
            },
          },
          select: {
            id: true,
            status: true,
            project: { select: { id: true, name: true } },
            approvalSteps: {
              orderBy: { sequence: "desc" },
              select: {
                id: true,
                sequence: true,
                status: true,
                removedAt: true,
                clientRequestId: true,
                isMarketingDirectorRequired: true,
              },
            },
          },
        });
        if (!unit) {
          return {
            error: "This approval chain is locked after handover or Stage 6 completion.",
          } as const;
        }
        const snapshotValidation = await buildSharedSnapshot(tx, {
          productionUnitId: unit.id,
          fieldKeys: input.sharedFieldKeys,
          selectedFileIds: input.selectedFileIds,
        });
        if ("error" in snapshotValidation) {
          return { error: snapshotValidation.error } as const;
        }
        const sequence = (unit.approvalSteps[0]?.sequence ?? 0) + 1;
        const step = await tx.productionApprovalStep.create({
          data: {
            clientRequestId: input.clientRequestId,
            productionUnitId: unit.id,
            sequence,
            ...recipientData,
            requestedById: user.id,
            sharedFieldKeys: input.sharedFieldKeys,
            selectedFileIds: input.selectedFileIds,
            message,
          },
          select: {
            id: true,
            productionUnitId: true,
            sequence: true,
            recipientType: true,
            recipientUserId: true,
            recipientName: true,
            sharedFieldKeys: true,
            selectedFileIds: true,
          },
        });
        const liveBeforeAdd = unit.approvalSteps.filter((candidate) => !candidate.removedAt);
        const hasExecutionBlocker = liveBeforeAdd.some(
          (candidate) =>
            candidate.status === ProductionApprovalStepStatus.ACTIVE ||
            candidate.status === ProductionApprovalStepStatus.REJECTED,
        );
        if (!hasExecutionBlocker) {
          await tx.projectProductionUnit.update({
            where: { id: unit.id },
            data: { status: ProjectProductionUnitStatus.PREPARATION, approvedAt: null },
          });
        }
        return { step, duplicate: false } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (error instanceof StageSixWorkflowError) return { error: error.message } as const;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const existing = await withPrismaRetry(() =>
        prisma.productionApprovalStep.findUnique({
          where: { clientRequestId: input.clientRequestId },
          select: { id: true, productionUnitId: true, sequence: true },
        }),
      );
      if (existing?.productionUnitId === input.productionUnitId) {
        return { step: existing, duplicate: true } as const;
      }
      if (conflictRetryCount < 1) {
        return addProductionApprover(user, input, options, conflictRetryCount + 1);
      }
      return { error: "The approval chain changed at the same time. Please try again." } as const;
    }
    throw error;
  }
  return outcome;
}

export async function removeProductionApprover(
  user: PermissionUser,
  input: { projectId: string; productionUnitId: string; stepId: string },
  options: { sendEmail?: EmailSender } = {},
  conflictRetryCount = 0,
) {
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  let outcome;
  try {
    outcome = await withPrismaRetry(() =>
      prisma.$transaction(
      async (tx) => {
        const unit = await tx.projectProductionUnit.findFirst({
          where: {
            id: input.productionUnitId,
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.PREPARATION,
                ProjectProductionUnitStatus.APPROVAL_PENDING,
                ProjectProductionUnitStatus.REJECTED,
                ProjectProductionUnitStatus.HANDOVER_READY,
              ],
            },
            project: {
              workflowStages: {
                some: {
                  stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                },
              },
            },
          },
          select: {
            id: true,
            status: true,
            project: {
              select: {
                id: true,
                name: true,
                ownerId: true,
                coOwners: { select: { userId: true } },
              },
            },
            sourceAttachment: { select: { originalFileName: true, status: true } },
            approvedAt: true,
          },
        });
        if (!unit) return { error: "This approval chain can no longer be changed." } as const;
        const step = await tx.productionApprovalStep.findFirst({
          where: { id: input.stepId, productionUnitId: unit.id },
          select: {
            id: true,
            sequence: true,
            requestedById: true,
            isMarketingDirectorRequired: true,
            status: true,
            removedAt: true,
          },
        });
        if (!step) return { error: "Approval step not found." } as const;
        if (step.removedAt) return { error: "This approval step was already removed." } as const;
        const wasActive = step.status === ProductionApprovalStepStatus.ACTIVE;
        const removedAt = new Date();
        const removed = await tx.productionApprovalStep.updateMany({
          where: { id: step.id, productionUnitId: unit.id, removedAt: null },
          data: {
            removedAt,
            removedByUserId: user.id,
            statusAtRemoval: step.status,
            externalTokenRevokedAt: removedAt,
            // The partial one-active-step index keys on status. Preserve the original
            // value in statusAtRemoval while releasing the live ACTIVE slot.
            status: wasActive ? ProductionApprovalStepStatus.WAITING : undefined,
          },
        });
        if (removed.count !== 1) {
          return { error: "This approval step was already removed." } as const;
        }
        if (wasActive) {
          await tx.notification.deleteMany({
            where: { entityType: "PRODUCTION_APPROVAL", entityId: step.id },
          });
        }
        const remaining = await tx.productionApprovalStep.findMany({
          where: {
            productionUnitId: unit.id,
            removedAt: null,
          },
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
          select: {
            id: true,
            productionUnitId: true,
            recipientType: true,
            recipientUserId: true,
            recipientName: true,
            sequence: true,
            sharedFieldKeys: true,
            selectedFileIds: true,
            status: true,
          },
        });
        const active = remaining.find(
          (candidate) => candidate.status === ProductionApprovalStepStatus.ACTIVE,
        );
        if (active) {
          await tx.projectProductionUnit.update({
            where: { id: unit.id },
            data: {
              status: ProjectProductionUnitStatus.APPROVAL_PENDING,
              approvedAt: null,
            },
          });
          return { removed: true, next: null } as const;
        }
        const rejected = remaining.some(
          (candidate) => candidate.status === ProductionApprovalStepStatus.REJECTED,
        );
        if (rejected) {
          await tx.projectProductionUnit.update({
            where: { id: unit.id },
            data: { status: ProjectProductionUnitStatus.REJECTED, approvedAt: null },
          });
          return { removed: true, next: null } as const;
        }
        const next = remaining.find(
          (candidate) => candidate.status === ProductionApprovalStepStatus.WAITING,
        );
        if (next) {
          await tx.projectProductionUnit.update({
            where: { id: unit.id },
            data: { status: ProjectProductionUnitStatus.PREPARATION, approvedAt: null },
          });
          return { removed: true, next: null } as const;
        }

        if (remaining.length === 0) {
          const sourceReady = unit.sourceAttachment.status === AttachmentStatus.READY;
          await tx.projectProductionUnit.update({
            where: { id: unit.id },
            data: {
              status: sourceReady
                ? ProjectProductionUnitStatus.HANDOVER_READY
                : ProjectProductionUnitStatus.PREPARATION,
              approvedAt: null,
            },
          });
          return { removed: true, next: null } as const;
        }

        await tx.projectProductionUnit.update({
          where: { id: unit.id },
          data: {
            status: ProjectProductionUnitStatus.HANDOVER_READY,
            approvedAt: unit.approvedAt ?? new Date(),
          },
        });
        await createNotifications(
          tx,
          createDedupeNotificationData({
            userIds: [
              unit.project.ownerId,
              ...unit.project.coOwners.map((entry) => entry.userId),
              step.requestedById,
            ],
            actorId: user.id,
            dedupePrefix: `production-approval-chain-completed:${unit.id}`,
            type: "PRODUCTION_APPROVAL_APPROVED",
            title: "Production approval chain completed",
            message: `${unit.sourceAttachment.originalFileName} is ready for handover.`,
            entityType: "PRODUCTION_UNIT",
            entityId: unit.id,
            projectId: unit.project.id,
            url: `/projects/${unit.project.id}/stages/6?unit=${unit.id}`,
          }),
        );
        return { removed: true, next: null } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (error instanceof StageSixWorkflowError) return { error: error.message } as const;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034") &&
      conflictRetryCount < 1
    ) {
      return removeProductionApprover(user, input, options, conflictRetryCount + 1);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return { error: "The approval chain changed at the same time. Please try again." } as const;
    }
    throw error;
  }
  return outcome;
}

export async function reorderProductionApprover(
  user: PermissionUser,
  input: {
    projectId: string;
    productionUnitId: string;
    stepId: string;
    direction: "UP" | "DOWN";
  },
  conflictRetryCount = 0,
) {
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;

  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const unit = await tx.projectProductionUnit.findFirst({
            where: {
              id: input.productionUnitId,
              projectId: input.projectId,
              status: {
                in: [
                  ProjectProductionUnitStatus.PREPARATION,
                  ProjectProductionUnitStatus.APPROVAL_PENDING,
                  ProjectProductionUnitStatus.REJECTED,
                  ProjectProductionUnitStatus.HANDOVER_READY,
                ],
              },
              project: {
                workflowStages: {
                  some: {
                    stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
                    status: ProjectWorkflowStageStatus.AVAILABLE,
                  },
                },
              },
            },
            select: {
              id: true,
              approvalSteps: {
                orderBy: [{ sequence: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  sequence: true,
                  isMarketingDirectorRequired: true,
                  status: true,
                  removedAt: true,
                },
              },
            },
          });
          if (!unit) return { error: "This approval chain can no longer be reordered." } as const;

          const waitingSteps = unit.approvalSteps.filter(
            (step) =>
              step.sequence > 1 &&
              !step.isMarketingDirectorRequired &&
              !step.removedAt &&
              step.status === ProductionApprovalStepStatus.WAITING,
          );
          const currentIndex = waitingSteps.findIndex((step) => step.id === input.stepId);
          if (currentIndex < 0) {
            return { error: "Only waiting approval steps can be reordered." } as const;
          }
          const targetIndex = input.direction === "UP" ? currentIndex - 1 : currentIndex + 1;
          const current = waitingSteps[currentIndex];
          const target = waitingSteps[targetIndex];
          if (!target) return { moved: false } as const;

          const temporarySequence =
            Math.max(...unit.approvalSteps.map((step) => step.sequence)) + 1;
          await tx.productionApprovalStep.update({
            where: { id: current.id },
            data: { sequence: temporarySequence },
          });
          await tx.productionApprovalStep.update({
            where: { id: target.id },
            data: { sequence: current.sequence },
          });
          await tx.productionApprovalStep.update({
            where: { id: current.id },
            data: { sequence: target.sequence },
          });
          return { moved: true } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      if (conflictRetryCount < 1) {
        return reorderProductionApprover(user, input, conflictRetryCount + 1);
      }
      return { error: "The approval order changed at the same time. Please try again." } as const;
    }
    throw error;
  }
}

export async function sendProductionApprovalRequest(
  user: PermissionUser,
  input: { projectId: string; productionUnitId: string; stepId: string },
  options: { sendEmail?: EmailSender } = {},
  conflictRetryCount = 0,
): Promise<{ sent: boolean; stepId: string } | { error: string }> {
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." };
  let prepared;
  try {
    prepared = await withPrismaRetry(() => prisma.$transaction(async (tx) => {
      const unit = await tx.projectProductionUnit.findFirst({
        where: {
          id: input.productionUnitId,
          projectId: input.projectId,
          status: { in: [ProjectProductionUnitStatus.PREPARATION, ProjectProductionUnitStatus.APPROVAL_PENDING] },
          project: {
            completedAt: null,
            archivedAt: null,
            workflowStages: { some: {
              stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
              status: ProjectWorkflowStageStatus.AVAILABLE,
            } },
          },
        },
        select: {
          id: true,
          approvalSteps: {
            where: { removedAt: null },
            orderBy: [{ sequence: "asc" }, { id: "asc" }],
            select: {
              id: true, productionUnitId: true, sequence: true, status: true,
              dispatchStatus: true, clientRequestId: true,
              isMarketingDirectorRequired: true,
              recipientType: true, recipientUserId: true, recipientName: true, recipientEmail: true,
              sharedFieldKeys: true, selectedFileIds: true,
            },
          },
        },
      });
      if (!unit) return { error: "This approval request is locked or unavailable." } as const;
      const step = unit.approvalSteps.find((candidate) => candidate.id === input.stepId);
      if (!step) return { error: "Approval step not found." } as const;
      if (step.status === ProductionApprovalStepStatus.ACTIVE) {
        return step.dispatchStatus === ProductionDispatchStatus.FAILED
          ? { error: "The previous delivery failed. Use Retry to send this request again." } as const
          : { duplicate: true, stepId: step.id } as const;
      }
      if (unit.approvalSteps.some((candidate) => candidate.status === ProductionApprovalStepStatus.ACTIVE || candidate.status === ProductionApprovalStepStatus.REJECTED)) {
        return { error: "Finish or remove the active or rejected approval before sending another request." } as const;
      }
      const next = unit.approvalSteps.find((candidate) => candidate.status === ProductionApprovalStepStatus.WAITING);
      if (next?.id !== step.id) return { error: "Send requests in the approval chain's order." } as const;
      if (!step.clientRequestId || !step.recipientType || !step.recipientName || !step.recipientEmail) {
        return { error: "Assign a recipient and select the information to share before sending." } as const;
      }
      const configuredRecipient = step.isMarketingDirectorRequired ? getSlavomirApprovalRecipient() : null;
      if (step.isMarketingDirectorRequired && !configuredRecipient) {
        return { error: SLAVOMIR_APPROVAL_CONFIGURATION_ERROR } as const;
      }
      const dispatchStep = { ...step, ...configuredRecipient };
      if (dispatchStep.recipientType === ProductionApprovalRecipientType.EXISTING_COLLABORATOR &&
          (!dispatchStep.recipientUserId || !isProjectParticipant(project, dispatchStep.recipientUserId))) {
        return { error: "The selected approver is no longer a project participant." } as const;
      }
      if (!normalizeEmail(dispatchStep.recipientEmail ?? "")) return { error: "The approver email address is invalid." } as const;
      await tx.productionApprovalStep.update({
        where: { id: step.id },
        data: { requestedById: user.id, ...configuredRecipient },
      });
      const activation = await activateNextStep(tx, dispatchStep, project);
      if ("error" in activation) throw new StageSixWorkflowError(activation.error);
      await tx.projectProductionUnit.update({
        where: { id: unit.id },
        data: { status: ProjectProductionUnitStatus.APPROVAL_PENDING, approvedAt: null },
      });
      return { duplicate: false, stepId: step.id, access: activation.access } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof StageSixWorkflowError) return { error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      if (conflictRetryCount < 2) return sendProductionApprovalRequest(user, input, options, conflictRetryCount + 1);
      return { error: "The approval chain changed at the same time. Please try again." };
    }
    throw error;
  }
  if (prepared.error) return { error: prepared.error };
  if (prepared.duplicate) return { sent: false, stepId: prepared.stepId };
  if (prepared.access) {
    const dispatch = await sendExternalApproval({
      stepId: prepared.stepId,
      rawToken: prepared.access.token,
      tokenHash: prepared.access.tokenHash,
    }, options.sendEmail ?? sendResendEmail);
    if (dispatch.error) return { error: dispatch.error };
  }
  return { sent: true, stepId: prepared.stepId };
}

function readRejectionHistory(value: Prisma.JsonValue): Prisma.JsonObject[] {
  return Array.isArray(value) ? value.filter((entry): entry is Prisma.JsonObject =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.decidedAt === "string" && typeof entry.resentAt === "string")) : [];
}

export type ResendProductionApprovalInput = {
  projectId: string;
  productionUnitId: string;
  stepId: string;
  expectedDecidedAt: string;
  sharedFieldKeys: ProjectFileChecklistField[];
  selectedFileIds: string[];
  message?: string;
};

export async function resendRejectedProductionApproval(
  user: PermissionUser,
  input: ResendProductionApprovalInput,
  options: { sendEmail?: EmailSender } = {},
  conflictRetryCount = 0,
): Promise<{ sent: boolean; stepId: string } | { error: string }> {
  if (!input.expectedDecidedAt || Number.isNaN(Date.parse(input.expectedDecidedAt))) return { error: "Refresh the rejected approval before resending." };
  if (!Array.isArray(input.sharedFieldKeys) || !uniqueAllowedFieldKeys(input.sharedFieldKeys) ||
      !Array.isArray(input.selectedFileIds) || input.selectedFileIds.some((id) => typeof id !== "string" || !id)) {
    return { error: "Choose valid files and information to share." };
  }
  if (input.message !== undefined && typeof input.message !== "string") return { error: "Enter a text message." };
  const message = sanitizeRichText(input.message) || null;
  if (message && richTextToPlainText(message).length > 5_000) return { error: "The approver message is too long." };
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." };
  let prepared;
  try {
    prepared = await withPrismaRetry(() => prisma.$transaction(async (tx) => {
      const unit = await tx.projectProductionUnit.findFirst({
        where: { id: input.productionUnitId, projectId: input.projectId },
        include: {
          project: { select: projectStageAccessSelect },
          handover: { select: { id: true } },
          approvalSteps: { where: { removedAt: null }, orderBy: [{ sequence: "asc" }, { id: "asc" }] },
        },
      });
      if (!unit || !canManageStageSix(user, unit.project) || unit.project.completedAt || unit.project.archivedAt ||
          isProjectStatusCompleted(unit.project.status) ||
          stageStatus(unit.project, ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER) !== ProjectWorkflowStageStatus.AVAILABLE ||
          stageStatus(unit.project, ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION) !== ProjectWorkflowStageStatus.LOCKED ||
          unit.handover || unit.handedOverAt) return { error: "This approval chain is locked or unavailable." } as const;
      const step = unit.approvalSteps.find((candidate) => candidate.id === input.stepId);
      if (!step) return { error: "Approval step not found." } as const;
      const history = readRejectionHistory(step.rejectionHistory);
      if (history.some((entry) => entry.decidedAt === input.expectedDecidedAt)) {
        return step.status === ProductionApprovalStepStatus.ACTIVE && step.dispatchStatus === ProductionDispatchStatus.FAILED
          ? { error: "The resend delivery failed. Use Retry to deliver the new request." } as const
          : { duplicate: true, stepId: step.id } as const;
      }
      if (unit.status !== ProjectProductionUnitStatus.REJECTED || step.status !== ProductionApprovalStepStatus.REJECTED ||
          !step.decidedAt || step.decidedAt.toISOString() !== input.expectedDecidedAt) {
        return { error: "This rejection has changed. Refresh before resending." } as const;
      }
      if (unit.approvalSteps.some((candidate) => candidate.id !== step.id &&
          (candidate.status === ProductionApprovalStepStatus.ACTIVE || candidate.status === ProductionApprovalStepStatus.REJECTED ||
          (candidate.sequence < step.sequence && candidate.status !== ProductionApprovalStepStatus.APPROVED) ||
          (candidate.sequence > step.sequence && candidate.status !== ProductionApprovalStepStatus.WAITING)))) {
        return { error: "The approval chain has changed. Resolve earlier requests before resending this step." } as const;
      }
      const configuredRecipient = step.isMarketingDirectorRequired ? getSlavomirApprovalRecipient() : null;
      if (step.isMarketingDirectorRequired && !configuredRecipient) return { error: SLAVOMIR_APPROVAL_CONFIGURATION_ERROR } as const;
      if (step.isMarketingDirectorRequired && !input.selectedFileIds.length) return { error: "Marketing Director approval must include at least one production file." } as const;
      const recipient = { ...step, ...configuredRecipient };
      if (!recipient.recipientType || !recipient.recipientName || !normalizeEmail(recipient.recipientEmail ?? "") ||
          (recipient.recipientType === ProductionApprovalRecipientType.EXISTING_COLLABORATOR &&
          (!recipient.recipientUserId || !isProjectParticipant(unit.project, recipient.recipientUserId)))) {
        return { error: "This approver is no longer available. Check the recipient before resending." } as const;
      }
      const resentAt = new Date();
      await tx.productionApprovalStep.update({ where: { id: step.id }, data: {
        ...configuredRecipient,
        requestedById: user.id, sharedFieldKeys: input.sharedFieldKeys, selectedFileIds: [...new Set(input.selectedFileIds)], message,
        rejectionHistory: [...history, {
          decidedAt: step.decidedAt.toISOString(), decisionComment: step.decisionComment, decidedByUserId: step.decidedByUserId,
          recipientType: step.recipientType, recipientUserId: step.recipientUserId, recipientName: step.recipientName, recipientEmail: step.recipientEmail,
          requestedById: step.requestedById, activatedAt: step.activatedAt?.toISOString() ?? null, sentAt: step.sentAt?.toISOString() ?? null,
          sharedFieldKeys: step.sharedFieldKeys, selectedFileIds: step.selectedFileIds, sharedSnapshot: step.sharedSnapshot, message: step.message,
          resentAt: resentAt.toISOString(), resentByUserId: user.id,
        }] as Prisma.InputJsonValue,
        status: ProductionApprovalStepStatus.WAITING, dispatchStatus: ProductionDispatchStatus.NOT_SENT,
        decidedAt: null, decisionComment: null, decidedByUserId: null,
        externalTokenHash: null, externalTokenRevokedAt: null, externalTokenCreatedAt: null, externalTokenExpiresAt: null, externalOpenedAt: null,
        failedAt: null, failureMessage: null,
      } });
      const activation = await activateNextStep(tx, {
        ...recipient, sharedFieldKeys: input.sharedFieldKeys, selectedFileIds: input.selectedFileIds,
      }, unit.project);
      if ("error" in activation) throw new StageSixWorkflowError(activation.error);
      await tx.projectProductionUnit.update({ where: { id: unit.id }, data: { status: ProjectProductionUnitStatus.APPROVAL_PENDING, approvedAt: null } });
      return { duplicate: false, stepId: step.id, access: activation.access } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof StageSixWorkflowError) return { error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
      if (conflictRetryCount < 2) return resendRejectedProductionApproval(user, input, options, conflictRetryCount + 1);
      return { error: "The approval chain changed at the same time. Refresh and try again." };
    }
    throw error;
  }
  if (prepared.error) return { error: prepared.error };
  if (prepared.duplicate) return { sent: false, stepId: prepared.stepId };
  if (prepared.access) {
    const dispatch = await sendExternalApproval({ stepId: prepared.stepId, rawToken: prepared.access.token, tokenHash: prepared.access.tokenHash }, options.sendEmail ?? sendResendEmail);
    if (dispatch.error) return { error: dispatch.error };
  }
  return { sent: true, stepId: prepared.stepId };
}

export async function retryProductionApprovalDispatch(
  user: PermissionUser,
  input: { projectId: string; stepId: string },
  options: { sendEmail?: EmailSender } = {},
) {
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  if (project.completedAt || project.archivedAt || isProjectStatusCompleted(project.status)) {
    return { error: "This project's approval requests are closed." } as const;
  }
  const step = await withPrismaRetry(() => prisma.productionApprovalStep.findFirst({
    where: { id: input.stepId, productionUnit: { projectId: input.projectId }, removedAt: null },
    select: { isMarketingDirectorRequired: true },
  }));
  if (!step) return { error: "This approval email cannot be retried." } as const;
  const configuredRecipient = step.isMarketingDirectorRequired ? getSlavomirApprovalRecipient() : null;
  if (step.isMarketingDirectorRequired && !configuredRecipient) {
    return { error: SLAVOMIR_APPROVAL_CONFIGURATION_ERROR } as const;
  }
  const access = createProductionApprovalToken();
  const updated = await withPrismaRetry(() =>
    prisma.productionApprovalStep.updateMany({
      where: {
        id: input.stepId,
        productionUnit: {
          projectId: input.projectId,
          status: ProjectProductionUnitStatus.APPROVAL_PENDING,
          project: {
            completedAt: null,
            archivedAt: null,
            workflowStages: {
              some: {
                stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
            },
          },
        },
        removedAt: null,
        status: ProductionApprovalStepStatus.ACTIVE,
        dispatchStatus: ProductionDispatchStatus.FAILED,
        recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
      },
      data: {
        ...configuredRecipient,
        dispatchStatus: ProductionDispatchStatus.PENDING,
        externalTokenHash: access.tokenHash,
        externalTokenCreatedAt: access.createdAt,
        externalTokenExpiresAt: access.expiresAt,
        externalTokenRevokedAt: null,
        failedAt: null,
        failureMessage: null,
      },
    }),
  );
  if (updated.count !== 1) return { error: "This approval email cannot be retried." } as const;
  return sendExternalApproval(
    { stepId: input.stepId, rawToken: access.token, tokenHash: access.tokenHash },
    options.sendEmail ?? sendResendEmail,
  );
}

async function activateNextStep(
  tx: Prisma.TransactionClient,
  step: {
    id: string;
    productionUnitId: string;
    recipientType: ProductionApprovalRecipientType | null;
    recipientUserId: string | null;
    recipientName: string | null;
    sequence: number;
    sharedFieldKeys: ProjectFileChecklistField[];
    selectedFileIds: string[];
  },
  project: { id: string; name: string },
) {
  if (!step.recipientType || !step.recipientName) {
    return { error: "The next approval step has no recipient." } as const;
  }
  const snapshot = await buildSharedSnapshot(tx, {
    productionUnitId: step.productionUnitId,
    fieldKeys: step.sharedFieldKeys,
    selectedFileIds: step.selectedFileIds,
  });
  if ("error" in snapshot) return { error: snapshot.error } as const;
  const access =
    step.recipientType === ProductionApprovalRecipientType.EXTERNAL_EMAIL
      ? createProductionApprovalToken()
      : null;
  const activatedAt = new Date();
  const updated = await tx.productionApprovalStep.updateMany({
    where: {
      id: step.id,
      removedAt: null,
      status: ProductionApprovalStepStatus.WAITING,
    },
    data: {
      status: ProductionApprovalStepStatus.ACTIVE,
      dispatchStatus: access
        ? ProductionDispatchStatus.PENDING
        : ProductionDispatchStatus.SENT,
      activatedAt,
      sentAt: access ? null : activatedAt,
      sharedSnapshot: snapshot.snapshot as unknown as Prisma.InputJsonValue,
      externalTokenHash: access?.tokenHash ?? null,
      externalTokenCreatedAt: access?.createdAt ?? null,
      externalTokenExpiresAt: access?.expiresAt ?? null,
    },
  });
  if (updated.count !== 1) return { error: "The next approval step changed." } as const;
  if (step.recipientUserId) {
    await createNotifications(
      tx,
      createDedupeNotificationData({
        userIds: [step.recipientUserId],
        dedupePrefix: `production-approval-requested:${step.id}:${activatedAt.toISOString()}`,
        type: "PRODUCTION_APPROVAL_REQUESTED",
        title: "Production approval requested",
        message: `Approval Step ${step.sequence} is ready for ${project.name}.`,
        entityType: "PRODUCTION_APPROVAL",
        entityId: step.id,
        projectId: project.id,
        url: `/production-approvals/${step.id}`,
      }),
    );
  }
  return { access } as const;
}

type ApprovalDecisionScope =
  | { kind: "authenticated"; user: PermissionUser; stepId: string }
  | { kind: "external"; token: string };

export async function decideProductionApproval(
  scope: ApprovalDecisionScope,
  input: {
    decision: "APPROVE" | "REJECT";
    comment?: string;
    confirmed?: boolean;
    requestVersion?: string;
  },
  options: { sendEmail?: EmailSender } = {},
) {
  void options; // The next request always waits for an explicit send.
  if (input.confirmed !== true) {
    return { error: "Confirm Approve or Reject before recording this decision." } as const;
  }
  const comment = sanitizeRichText(input.comment) || null;
  if (comment && richTextToPlainText(comment).length > 5_000) return { error: "The decision comment is too long." } as const;
  const tokenHash = scope.kind === "external" ? hashProductionExternalToken(scope.token) : null;
  if (scope.kind === "external" && !tokenHash) {
    return { error: "This approval link is unavailable." } as const;
  }
  let outcome;
  try {
    outcome = await withPrismaRetry(() =>
      prisma.$transaction(
      async (tx) => {
        const step = await tx.productionApprovalStep.findFirst({
          where:
            scope.kind === "authenticated"
              ? {
                  id: scope.stepId,
                  recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
                  recipientUserId: scope.user.id,
                  removedAt: null,
                  productionUnit: { project: accessibleStageSixProjectWhere },
                }
              : {
                  externalTokenHash: tokenHash!,
                  removedAt: null,
                  recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
                  externalTokenRevokedAt: null,
                  externalTokenExpiresAt: { gt: new Date() },
                },
          select: {
            id: true,
            sequence: true,
            productionUnitId: true,
            requestedById: true,
            status: true,
            dispatchStatus: true,
            activatedAt: true,
            rejectionHistory: true,
            productionUnit: {
              select: {
                status: true,
                sourceAttachment: { select: { originalFileName: true } },
                project: {
                  select: {
                    id: true,
                    name: true,
                    ownerId: true,
                    coOwners: { select: { userId: true } },
                  },
                },
              },
            },
          },
        });
        if (
          !step ||
          step.status !== ProductionApprovalStepStatus.ACTIVE ||
          step.dispatchStatus !== ProductionDispatchStatus.SENT ||
          step.productionUnit.status !== ProjectProductionUnitStatus.APPROVAL_PENDING
        ) {
          return { error: "This approval step is not active." } as const;
        }
        if (scope.kind === "authenticated" && (input.requestVersion !== undefined || readRejectionHistory(step.rejectionHistory).length > 0) &&
            input.requestVersion !== step.activatedAt?.toISOString()) {
          return { error: "This approval request was resent. Refresh and review the latest files before deciding." } as const;
        }
        const decidedAt = new Date();
        const decidedByUserId = scope.kind === "authenticated" ? scope.user.id : null;
        const updated = await tx.productionApprovalStep.updateMany({
          where: {
            id: step.id,
            removedAt: null,
            status: ProductionApprovalStepStatus.ACTIVE,
            dispatchStatus: ProductionDispatchStatus.SENT,
          },
          data: {
            status:
              input.decision === "APPROVE"
                ? ProductionApprovalStepStatus.APPROVED
                : ProductionApprovalStepStatus.REJECTED,
            decisionComment: comment,
            decidedAt,
            decidedByUserId,
            externalTokenRevokedAt: scope.kind === "external" ? decidedAt : undefined,
          },
        });
        if (updated.count !== 1) return { error: "This approval was already decided." } as const;
        const managerIds = [
          step.productionUnit.project.ownerId,
          ...step.productionUnit.project.coOwners.map((entry) => entry.userId),
          step.requestedById,
        ];
        if (input.decision === "REJECT") {
          await tx.projectProductionUnit.updateMany({
            where: {
              id: step.productionUnitId,
              status: ProjectProductionUnitStatus.APPROVAL_PENDING,
            },
            data: { status: ProjectProductionUnitStatus.REJECTED },
          });
          await createNotifications(
            tx,
            createDedupeNotificationData({
              userIds: managerIds,
              actorId: decidedByUserId ?? undefined,
              dedupePrefix: `production-approval-rejected:${step.id}:${step.activatedAt?.toISOString()}`,
              type: "PRODUCTION_APPROVAL_REJECTED",
              title: "Production approval rejected",
              message: `${step.productionUnit.sourceAttachment.originalFileName} was rejected at Step ${step.sequence}.${comment ? ` ${comment}` : ""}`.slice(0, 500),
              entityType: "PRODUCTION_APPROVAL",
              entityId: step.id,
              projectId: step.productionUnit.project.id,
              url: `/projects/${step.productionUnit.project.id}/stages/6?unit=${step.productionUnitId}`,
            }),
          );
          return {
            decision: "REJECTED" as const,
            next: null,
            projectId: step.productionUnit.project.id,
            productionUnitId: step.productionUnitId,
          };
        }
        const next = await tx.productionApprovalStep.findFirst({
          where: {
            productionUnitId: step.productionUnitId,
            sequence: { gt: step.sequence },
            removedAt: null,
            status: ProductionApprovalStepStatus.WAITING,
          },
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            productionUnitId: true,
            recipientType: true,
            recipientUserId: true,
            recipientName: true,
            sequence: true,
            sharedFieldKeys: true,
            selectedFileIds: true,
          },
        });
        if (!next) {
          await tx.projectProductionUnit.updateMany({
            where: {
              id: step.productionUnitId,
              status: ProjectProductionUnitStatus.APPROVAL_PENDING,
            },
            data: {
              status: ProjectProductionUnitStatus.HANDOVER_READY,
              approvedAt: decidedAt,
            },
          });
          await createNotifications(
            tx,
            createDedupeNotificationData({
              userIds: managerIds,
              actorId: decidedByUserId ?? undefined,
              dedupePrefix: `production-approval-chain-completed:${step.productionUnitId}`,
              type: "PRODUCTION_APPROVAL_APPROVED",
              title: "Production approval chain completed",
              message: `${step.productionUnit.sourceAttachment.originalFileName} is ready for handover.`,
              entityType: "PRODUCTION_UNIT",
              entityId: step.productionUnitId,
              projectId: step.productionUnit.project.id,
              url: `/projects/${step.productionUnit.project.id}/stages/6?unit=${step.productionUnitId}`,
            }),
          );
          return {
            decision: "APPROVED" as const,
            next: null,
            projectId: step.productionUnit.project.id,
            productionUnitId: step.productionUnitId,
          };
        }
        await createNotifications(
          tx,
          createDedupeNotificationData({
            userIds: managerIds,
            actorId: decidedByUserId ?? undefined,
            dedupePrefix: `production-approval-approved:${step.id}:${step.activatedAt?.toISOString()}`,
            type: "PRODUCTION_APPROVAL_APPROVED",
            title: "Production approval accepted",
            message: `${step.productionUnit.sourceAttachment.originalFileName} passed Approval Step ${step.sequence}.`,
            entityType: "PRODUCTION_APPROVAL",
            entityId: step.id,
            projectId: step.productionUnit.project.id,
            url: `/projects/${step.productionUnit.project.id}/stages/6?unit=${step.productionUnitId}`,
          }),
        );
        await tx.projectProductionUnit.update({
          where: { id: step.productionUnitId },
          data: { status: ProjectProductionUnitStatus.PREPARATION, approvedAt: null },
        });
        return {
          decision: "APPROVED" as const,
          projectId: step.productionUnit.project.id,
          productionUnitId: step.productionUnitId,
          next: null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (error instanceof StageSixWorkflowError) return { error: error.message } as const;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return { error: "This approval was already decided or changed at the same time." } as const;
    }
    throw error;
  }
  return outcome;
}

const approvalReadSelect = {
  id: true,
  sequence: true,
  isMarketingDirectorRequired: true,
  recipientType: true,
  recipientUserId: true,
  status: true,
  dispatchStatus: true,
  externalTokenExpiresAt: true,
  externalTokenRevokedAt: true,
  externalOpenedAt: true,
  removedAt: true,
  message: true,
  sharedSnapshot: true,
  decisionComment: true,
  decidedAt: true,
  activatedAt: true,
  requestedBy: { select: { name: true, email: true } },
  productionUnit: {
    select: {
      id: true,
      sourceAttachment: { select: { originalFileName: true } },
      project: {
        select: {
          id: true,
          name: true,
          workflowStages: {
            where: {
              stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
            },
            select: { status: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductionApprovalStepSelect;

function mapApprovalData(
  step: Prisma.ProductionApprovalStepGetPayload<{ select: typeof approvalReadSelect }>,
): ProductionApprovalData {
  if (step.removedAt) return { state: "unavailable" };
  const snapshot = parseSnapshot(step.sharedSnapshot);
  if (!snapshot || !step.requestedBy) return { state: "unavailable" };
  const state =
    step.status === ProductionApprovalStepStatus.APPROVED && step.decidedAt
      ? "approved"
      : step.status === ProductionApprovalStepStatus.REJECTED && step.decidedAt
        ? "rejected"
        : step.status === ProductionApprovalStepStatus.ACTIVE &&
            step.dispatchStatus === ProductionDispatchStatus.SENT
          ? "active"
          : null;
  if (!state) return { state: "unavailable" };
  return {
    state,
    stepId: step.id,
    project: step.productionUnit.project,
    unit: {
      id: step.productionUnit.id,
      name: step.productionUnit.sourceAttachment.originalFileName,
    },
    stepLabel: step.isMarketingDirectorRequired
      ? "Marketing Director"
      : `Approval Step ${step.sequence}`,
    requestedBy: displayName(step.requestedBy),
    requestVersion: step.activatedAt?.toISOString() ?? null,
    message: step.message,
    snapshot,
    decisionComment: step.decisionComment,
    decidedAt: step.decidedAt?.toISOString() ?? null,
  };
}

export async function getAuthenticatedProductionApprovalData(
  user: PermissionUser,
  stepId: string,
) {
  const step = await withPrismaRetry(() =>
    prisma.productionApprovalStep.findFirst({
      where: {
        id: stepId,
        removedAt: null,
        recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
        recipientUserId: user.id,
      },
      select: approvalReadSelect,
    }),
  );
  if (!step) return { state: "invalid" } as const;
  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
      status: step.productionUnit.project.workflowStages[0]?.status,
    })
  ) {
    return { state: "locked" } as const;
  }
  return mapApprovalData(step);
}

export async function getExternalProductionApprovalData(token: string) {
  const tokenHash = hashProductionExternalToken(token);
  if (!tokenHash) return { state: "invalid" } as const;
  const step = await withPrismaRetry(() =>
    prisma.productionApprovalStep.findFirst({
      where: {
        externalTokenHash: tokenHash,
        removedAt: null,
        recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
      },
      select: approvalReadSelect,
    }),
  );
  if (!step) return { state: "invalid" } as const;
  if (
    (step.status === ProductionApprovalStepStatus.APPROVED ||
      step.status === ProductionApprovalStepStatus.REJECTED) &&
    step.decidedAt
  ) {
    return {
      state: "completed",
      decision:
        step.status === ProductionApprovalStepStatus.APPROVED
          ? "APPROVED"
          : "REJECTED",
      projectName: step.productionUnit.project.name,
      unitName: step.productionUnit.sourceAttachment.originalFileName,
      decidedAt: step.decidedAt?.toISOString() ?? null,
    } as const;
  }
  if (
    step.status === ProductionApprovalStepStatus.ACTIVE &&
    step.externalTokenExpiresAt &&
    step.externalTokenExpiresAt <= new Date() &&
    !step.externalTokenRevokedAt
  ) {
    return { state: "expired" } as const;
  }
  if (
    step.status === ProductionApprovalStepStatus.ACTIVE &&
    (step.externalTokenRevokedAt ||
      !step.externalTokenExpiresAt ||
      step.externalTokenExpiresAt <= new Date())
  ) {
    return { state: "unavailable" } as const;
  }
  if (!step.externalOpenedAt && step.status === ProductionApprovalStepStatus.ACTIVE) {
    await withPrismaRetry(() =>
      prisma.productionApprovalStep.updateMany({
        where: { id: step.id, removedAt: null, externalOpenedAt: null },
        data: { externalOpenedAt: new Date() },
      }),
    );
  }
  return mapApprovalData(step);
}

async function getApprovalStepForFileScope(scope: ApprovalDecisionScope) {
  const tokenHash = scope.kind === "external" ? hashProductionExternalToken(scope.token) : null;
  if (scope.kind === "external" && !tokenHash) return null;
  return withPrismaRetry(() =>
    prisma.productionApprovalStep.findFirst({
      where:
        scope.kind === "authenticated"
          ? {
              id: scope.stepId,
              removedAt: null,
              recipientUserId: scope.user.id,
              recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
              productionUnit: { project: accessibleStageSixProjectWhere },
            }
          : {
              externalTokenHash: tokenHash!,
              removedAt: null,
              recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
              externalTokenExpiresAt: { gt: new Date() },
              externalTokenRevokedAt: null,
            },
      select: { status: true, sharedSnapshot: true, productionUnit: { select: { projectId: true } } },
    }),
  );
}

export async function getProductionApprovalFileUrl(
  scope: ApprovalDecisionScope,
  attachmentId: string,
  mode: "preview" | "download",
) {
  const step = await getApprovalStepForFileScope(scope);
  if (
    !step ||
    (scope.kind === "external" && step.status !== ProductionApprovalStepStatus.ACTIVE)
  ) {
    throw new Error("Approval file not found.");
  }
  const snapshot = parseSnapshot(step.sharedSnapshot);
  const allowedIds = new Set([
    ...(snapshot?.files.map((file) => file.id) ?? []),
    ...(snapshot?.fields.flatMap((field) => field.attachments.map((file) => file.id)) ?? []),
  ]);
  if (!allowedIds.has(attachmentId)) throw new Error("Approval file not found.");
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        id: attachmentId,
        projectId: step.productionUnit.projectId,
        status: AttachmentStatus.READY,
      },
      select: attachmentSelect,
    }),
  );
  if (!attachment) throw new Error("Approval file not found.");
  const fileInput = {
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
  };
  return mode === "download"
    ? createPresignedDownloadUrl(fileInput)
    : createPresignedPreviewUrl(fileInput);
}

export async function addProductionUnitFile(
  user: PermissionUser,
  input: { projectId: string; productionUnitId: string; attachmentId: string },
) {
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  const unit = await withPrismaRetry(() =>
    prisma.projectProductionUnit.findFirst({
      where: {
        id: input.productionUnitId,
        projectId: input.projectId,
        status: { in: [ProjectProductionUnitStatus.PREPARATION, ProjectProductionUnitStatus.REJECTED] },
      },
      select: { id: true },
    }),
  );
  if (!unit) return { error: "Production files are locked for this unit." } as const;
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        id: input.attachmentId,
        projectId: input.projectId,
        status: AttachmentStatus.READY,
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
      },
      select: { id: true },
    }),
  );
  if (!attachment) {
    return { error: "The production file is invalid or belongs to another project." } as const;
  }
  try {
    const file = await withPrismaRetry(() =>
      prisma.projectProductionUnitFile.create({
        data: {
          productionUnitId: unit.id,
          attachmentId: attachment.id,
          addedById: user.id,
        },
        select: { id: true, productionUnitId: true, attachmentId: true },
      }),
    );
    return { file, duplicate: false } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await withPrismaRetry(() =>
        prisma.projectProductionUnitFile.findUnique({
          where: { attachmentId: attachment.id },
          select: { id: true, productionUnitId: true, attachmentId: true },
        }),
      );
      return existing?.productionUnitId === unit.id
        ? ({ file: existing, duplicate: true } as const)
        : ({ error: "This file already belongs to another Production Unit." } as const);
    }
    throw error;
  }
}

export async function removeProductionUnitFile(
  user: PermissionUser,
  input: { projectId: string; productionUnitId: string; attachmentId: string },
) {
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  const removed = await withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const selectedByApproval = await tx.productionApprovalStep.count({
        where: {
          productionUnitId: input.productionUnitId,
          removedAt: null,
          selectedFileIds: { has: input.attachmentId },
        },
      });
      if (selectedByApproval > 0) return { count: 0, selected: true } as const;
      const result = await tx.projectProductionUnitFile.deleteMany({
        where: {
          productionUnitId: input.productionUnitId,
          attachmentId: input.attachmentId,
          productionUnit: {
            projectId: input.projectId,
            status: { in: [ProjectProductionUnitStatus.PREPARATION, ProjectProductionUnitStatus.REJECTED] },
          },
        },
      });
      return { count: result.count, selected: false } as const;
    }),
  );
  if (removed.selected) {
    return { error: "This file is selected in the approval chain and cannot be removed." } as const;
  }
  return removed.count === 1
    ? ({ removed: true } as const)
    : ({ error: "This production file cannot be removed." } as const);
}

export async function handoverProductionUnit(
  user: PermissionUser,
  input: {
    clientRequestId: string;
    projectId: string;
    productionUnitId: string;
    route: ProductionHandoverRoute;
    recipientType: ProductionApprovalRecipientType;
    recipientUserId?: string;
    recipientName?: string;
    recipientEmail?: string;
    recipientCompany?: string;
    recipientPhone?: string;
    sharedFieldKeys: ProjectFileChecklistField[];
    selectedFileIds: string[];
    note?: string;
  },
  options: { sendEmail?: EmailSender } = {},
) {
  if (!validClientRequestId(input.clientRequestId)) return { error: "Invalid request identifier." } as const;
  if (!uniqueAllowedFieldKeys(input.sharedFieldKeys)) return { error: "Unknown shared-information field." } as const;
  if (!input.selectedFileIds.length) return { error: "Select at least one approved production file." } as const;
  const note = sanitizeRichText(input.note) || null;
  if (note && richTextToPlainText(note).length > 5_000) return { error: "The handover note is too long." } as const;
  const isInternal = input.route === ProductionHandoverRoute.PURCHASE_DEPARTMENT;
  if (
    isInternal &&
    input.recipientType !== ProductionApprovalRecipientType.EXISTING_COLLABORATOR
  ) {
    return { error: "Internal handover requires an existing project participant." } as const;
  }
  if (
    !isInternal &&
    input.recipientType !== ProductionApprovalRecipientType.EXTERNAL_EMAIL
  ) {
    return { error: "External handover requires external recipient details." } as const;
  }
  const recipientCompany = input.recipientCompany?.trim() || null;
  const recipientPhone = input.recipientPhone
    ? normalizeInternationalPhone(input.recipientPhone)
    : null;
  if (!isInternal && !recipientCompany) {
    return { error: "Enter the external recipient company name." } as const;
  }
  if (recipientCompany && recipientCompany.length > 160) {
    return { error: "The external recipient company name is too long." } as const;
  }
  if (!isInternal && !input.recipientName?.trim()) {
    return { error: "Enter the external contact name." } as const;
  }
  if (!isInternal && !recipientPhone) {
    return {
      error: "Enter a valid external phone number including country code.",
    } as const;
  }
  const project = await getStageSixManagerProject(user, input.projectId);
  if (!project) return { error: "You do not have permission to manage Stage 6." } as const;
  if (isInternal && input.recipientUserId?.trim() === project.ownerId) {
    return {
      error: "The Project Owner cannot receive an internal production handover.",
    } as const;
  }
  const recipient = await resolveRecipient(project, input);
  if (!recipient.ok) return { error: recipient.error } as const;
  const recipientData = {
    recipientType: recipient.recipientType,
    recipientUserId: recipient.recipientUserId,
    recipientName: recipient.recipientName,
    recipientEmail: recipient.recipientEmail,
    recipientCompany: isInternal ? null : recipientCompany,
    recipientPhone: isInternal ? null : recipientPhone,
  };
  const requester = await withPrismaRetry(() =>
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
  );
  if (!requester) return { error: "The handover sender was not found." } as const;
  const access = createProductionHandoverToken();
  let prepared;
  try {
    prepared = await withPrismaRetry(() =>
      prisma.$transaction(
      async (tx) => {
      const unit = await tx.projectProductionUnit.findFirst({
          where: {
            id: input.productionUnitId,
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.PREPARATION,
                ProjectProductionUnitStatus.HANDOVER_READY,
              ],
            },
          },
          select: {
            id: true,
            status: true,
            sourceAttachment: {
              select: { originalFileName: true, status: true },
            },
            handover: {
              select: { id: true, clientRequestId: true, deliveryStatus: true },
            },
            approvalSteps: {
              where: { removedAt: null },
              select: { status: true, selectedFileIds: true },
            },
          },
        });
        if (!unit) {
          const completed = await tx.projectProductionHandover.findUnique({
            where: { productionUnitId: input.productionUnitId },
            select: { id: true, deliveryStatus: true },
          });
          return completed?.deliveryStatus === ProductionHandoverDeliveryStatus.SENT
            ? ({ duplicate: true, handover: completed, unitName: "" } as const)
            : ({ error: "This Production Unit is not ready for handover." } as const);
        }
        const readiness = deriveProductionUnitReadiness({
          sourceAttachmentStatus: unit.sourceAttachment.status,
          approvalSteps: unit.approvalSteps,
        });
        if (!readiness.handoverReady) {
          return { error: readiness.handoverBlocker ?? "This Production Unit is not ready for handover." } as const;
        }
        if (unit.status === ProjectProductionUnitStatus.PREPARATION) {
          const recalculated = await tx.projectProductionUnit.updateMany({
            where: {
              id: unit.id,
              status: ProjectProductionUnitStatus.PREPARATION,
            },
            data: {
              status: ProjectProductionUnitStatus.HANDOVER_READY,
              approvedAt: null,
            },
          });
          if (recalculated.count !== 1) {
            return { error: "This Production Unit's readiness changed. Please try again." } as const;
          }
        }
        const approvedFileIds = new Set(
          unit.approvalSteps
            .filter((step) => step.status === ProductionApprovalStepStatus.APPROVED)
            .flatMap((step) => step.selectedFileIds),
        );
        if (
          unit.approvalSteps.length > 0 &&
          input.selectedFileIds.some((id) => !approvedFileIds.has(id))
        ) {
          return { error: "Handover may include only production files reviewed in the completed approval chain." } as const;
        }
        const snapshot = await buildSharedSnapshot(tx, {
          productionUnitId: unit.id,
          fieldKeys: input.sharedFieldKeys,
          selectedFileIds: input.selectedFileIds,
        });
        if ("error" in snapshot) return { error: snapshot.error } as const;
        let handover;
        if (unit.handover) {
          if (unit.handover.deliveryStatus === ProductionHandoverDeliveryStatus.SENT) {
            return { duplicate: true, handover: unit.handover, unitName: unit.sourceAttachment.originalFileName } as const;
          }
          if (unit.handover.deliveryStatus === ProductionHandoverDeliveryStatus.PENDING) {
            return { error: "This handover is already being sent." } as const;
          }
          handover = await tx.projectProductionHandover.update({
            where: { id: unit.handover.id },
            data: {
              clientRequestId: input.clientRequestId,
              route: input.route,
              ...recipientData,
              sharedFieldKeys: input.sharedFieldKeys,
              selectedFileIds: input.selectedFileIds,
              contentSnapshot: snapshot.snapshot as unknown as Prisma.InputJsonValue,
              note,
              requestedById: user.id,
              deliveryStatus: ProductionHandoverDeliveryStatus.PENDING,
              failedAt: null,
              failureMessage: null,
              externalTokenHash: access.tokenHash,
              externalTokenCreatedAt: access.createdAt,
              externalTokenExpiresAt: access.expiresAt,
              externalTokenRevokedAt: null,
            },
            select: { id: true, deliveryStatus: true },
          });
        } else {
          handover = await tx.projectProductionHandover.create({
            data: {
              clientRequestId: input.clientRequestId,
              productionUnitId: unit.id,
              route: input.route,
              ...recipientData,
              sharedFieldKeys: input.sharedFieldKeys,
              selectedFileIds: input.selectedFileIds,
              contentSnapshot: snapshot.snapshot as unknown as Prisma.InputJsonValue,
              note,
              requestedById: user.id,
              externalTokenHash: access.tokenHash,
              externalTokenCreatedAt: access.createdAt,
              externalTokenExpiresAt: access.expiresAt,
            },
            select: { id: true, deliveryStatus: true },
          });
        }
        return { duplicate: false, handover, unitName: unit.sourceAttachment.originalFileName } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const existing = await withPrismaRetry(() =>
        prisma.projectProductionHandover.findFirst({
          where: {
            OR: [
              { productionUnitId: input.productionUnitId },
              { clientRequestId: input.clientRequestId },
            ],
          },
          select: { id: true, productionUnitId: true, deliveryStatus: true },
        }),
      );
      if (
        existing?.productionUnitId === input.productionUnitId &&
        existing.deliveryStatus === ProductionHandoverDeliveryStatus.SENT
      ) {
        return { duplicate: true, handover: existing, unitName: "" } as const;
      }
      if (
        existing?.productionUnitId === input.productionUnitId &&
        existing.deliveryStatus === ProductionHandoverDeliveryStatus.PENDING
      ) {
        return { error: "This handover is already being sent." } as const;
      }
      return { error: "The handover changed at the same time. Please try again." } as const;
    }
    throw error;
  }
  if ("error" in prepared || prepared.duplicate) return prepared;
  const email = buildProductionHandoverEmail({
    recipientName: recipient.recipientName,
    senderName: displayName(requester),
    projectName: project.name,
    unitName: prepared.unitName,
    routeLabel:
      isInternal ? "Internal" : "External",
    recipientCompany,
    recipientPhone,
    note: input.note,
    handoverUrl: buildExternalProductionHandoverUrl(access.token),
  });
  let result: Awaited<ReturnType<EmailSender>>;
  try {
    result = await (options.sendEmail ?? sendResendEmail)({
      to: recipient.recipientEmail,
      ...email,
      replyTo: requester.email,
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "The email provider could not be reached.",
    };
  }
  const now = new Date();
  if (!result.ok) {
    await withPrismaRetry(() =>
      prisma.projectProductionHandover.updateMany({
        where: {
          id: prepared.handover.id,
          deliveryStatus: ProductionHandoverDeliveryStatus.PENDING,
          externalTokenHash: access.tokenHash,
        },
        data: {
          deliveryStatus: ProductionHandoverDeliveryStatus.FAILED,
          failedAt: now,
          failureMessage: result.error.slice(0, 5_000),
          externalTokenRevokedAt: now,
        },
      }),
    );
    return { error: `The handover email could not be sent: ${result.error}` } as const;
  }
  return withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const delivered = await tx.projectProductionHandover.updateMany({
        where: {
          id: prepared.handover.id,
          deliveryStatus: ProductionHandoverDeliveryStatus.PENDING,
          externalTokenHash: access.tokenHash,
        },
        data: {
          deliveryStatus: ProductionHandoverDeliveryStatus.SENT,
          providerMessageId: result.id ?? null,
          sentAt: now,
          handedOverById: user.id,
          failedAt: null,
          failureMessage: null,
        },
      });
      if (delivered.count !== 1) return { error: "The handover delivery state changed." } as const;
      const updatedUnit = await tx.projectProductionUnit.updateMany({
        where: {
          id: input.productionUnitId,
          projectId: input.projectId,
          status: ProjectProductionUnitStatus.HANDOVER_READY,
        },
        data: { status: ProjectProductionUnitStatus.HANDED_OVER, handedOverAt: now },
      });
      if (updatedUnit.count !== 1) {
        throw new Error("The Production Unit changed before handover completed.");
      }
      await createNotifications(
        tx,
        createDedupeNotificationData({
          userIds: [
            project.ownerId,
            ...project.coOwners.map((entry) => entry.userId),
            recipient.recipientUserId,
          ],
          actorId: user.id,
          dedupePrefix: `production-handover-completed:${prepared.handover.id}`,
          type: "PRODUCTION_HANDOVER_COMPLETED",
          title: "Production handover completed",
          message: `${prepared.unitName} was handed over successfully.`,
          entityType: "PRODUCTION_UNIT",
          entityId: input.productionUnitId,
          projectId: project.id,
          url: `/production-handovers/${prepared.handover.id}`,
        }),
      );
      return { handedOver: true, handoverId: prepared.handover.id } as const;
    }),
  );
}

export async function getExternalProductionHandoverData(token: string) {
  const tokenHash = hashProductionExternalToken(token);
  if (!tokenHash) return { state: "invalid" } as const;
  const handover = await withPrismaRetry(() =>
    prisma.projectProductionHandover.findFirst({
      where: { externalTokenHash: tokenHash },
      select: {
        route: true,
        note: true,
        deliveryStatus: true,
        sentAt: true,
        externalTokenExpiresAt: true,
        externalTokenRevokedAt: true,
        contentSnapshot: true,
        handedOverBy: { select: { name: true, email: true } },
        productionUnit: {
          select: {
            id: true,
            sourceAttachment: { select: { originalFileName: true } },
            project: { select: { id: true, name: true } },
          },
        },
      },
    }),
  );
  if (!handover) return { state: "invalid" } as const;
  if (
    handover.externalTokenExpiresAt &&
    handover.externalTokenExpiresAt <= new Date() &&
    !handover.externalTokenRevokedAt
  ) {
    return { state: "expired" } as const;
  }
  const snapshot = parseSnapshot(handover.contentSnapshot);
  if (
    handover.deliveryStatus !== ProductionHandoverDeliveryStatus.SENT ||
    !handover.sentAt ||
    !handover.handedOverBy ||
    !snapshot ||
    handover.externalTokenRevokedAt ||
    !handover.externalTokenExpiresAt ||
    handover.externalTokenExpiresAt <= new Date()
  ) {
    return { state: "unavailable" } as const;
  }
  return {
    state: "active",
    project: {
      id: handover.productionUnit.project.id,
      name: handover.productionUnit.project.name,
    },
    unit: {
      id: handover.productionUnit.id,
      name: handover.productionUnit.sourceAttachment.originalFileName,
    },
    sender: displayName(handover.handedOverBy),
    route: handover.route,
    note: handover.note,
    snapshot,
    sentAt: handover.sentAt.toISOString(),
  } as const;
}

type AuthenticatedProductionHandoverRecord = {
  recipientUserId: string | null;
  requestedById: string;
  handedOverById: string | null;
  productionUnit: {
    project: {
      ownerId: string | null;
      coOwners: Array<{ userId: string }>;
    };
  };
};

function canAccessAuthenticatedProductionHandover(
  userId: string,
  handover: AuthenticatedProductionHandoverRecord,
) {
  return (
    handover.recipientUserId === userId ||
    handover.requestedById === userId ||
    handover.handedOverById === userId ||
    handover.productionUnit.project.ownerId === userId ||
    handover.productionUnit.project.coOwners.some(
      (coOwner) => coOwner.userId === userId,
    )
  );
}

export async function getAuthenticatedProductionHandoverData(
  user: PermissionUser,
  handoverId: string,
): Promise<ProductionHandoverData> {
  const handover = await withPrismaRetry(() =>
    prisma.projectProductionHandover.findUnique({
      where: { id: handoverId },
      select: {
        id: true,
        route: true,
        recipientUserId: true,
        requestedById: true,
        handedOverById: true,
        note: true,
        deliveryStatus: true,
        sentAt: true,
        contentSnapshot: true,
        handedOverBy: { select: { name: true, email: true } },
        productionUnit: {
          select: {
            id: true,
            sourceAttachment: { select: { originalFileName: true } },
            project: {
              select: {
                id: true,
                name: true,
                ownerId: true,
                coOwners: { select: { userId: true } },
              },
            },
          },
        },
      },
    }),
  );
  if (
    !handover ||
    !canAccessAuthenticatedProductionHandover(user.id, handover)
  ) {
    return { state: "invalid" } as const;
  }
  const snapshot = parseSnapshot(handover.contentSnapshot);
  if (
    handover.deliveryStatus !== ProductionHandoverDeliveryStatus.SENT ||
    !handover.sentAt ||
    !handover.handedOverBy ||
    !snapshot
  ) {
    return { state: "unavailable" } as const;
  }
  return {
    state: "active",
    project: {
      id: handover.productionUnit.project.id,
      name: handover.productionUnit.project.name,
    },
    unit: {
      id: handover.productionUnit.id,
      name: handover.productionUnit.sourceAttachment.originalFileName,
    },
    sender: displayName(handover.handedOverBy),
    route: handover.route,
    note: handover.note,
    snapshot,
    sentAt: handover.sentAt.toISOString(),
  } as const;
}

async function createProductionHandoverFileUrl(
  handover: { contentSnapshot: Prisma.JsonValue; projectId: string },
  attachmentId: string,
  mode: "preview" | "download",
) {
  const snapshot = parseSnapshot(handover.contentSnapshot);
  const allowedIds = new Set([
    ...(snapshot?.files.map((file) => file.id) ?? []),
    ...(snapshot?.fields.flatMap((field) =>
      field.attachments.map((file) => file.id),
    ) ?? []),
  ]);
  if (!allowedIds.has(attachmentId)) {
    throw new Error("Handover file not found.");
  }
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        id: attachmentId,
        projectId: handover.projectId,
        status: AttachmentStatus.READY,
      },
      select: attachmentSelect,
    }),
  );
  if (!attachment) throw new Error("Handover file not found.");
  const fileInput = {
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
  };
  return mode === "download"
    ? createPresignedDownloadUrl(fileInput)
    : createPresignedPreviewUrl(fileInput);
}

export async function getProductionHandoverFileUrl(
  token: string,
  attachmentId: string,
  mode: "preview" | "download",
) {
  const tokenHash = hashProductionExternalToken(token);
  if (!tokenHash) throw new Error("Handover file not found.");
  const handover = await withPrismaRetry(() =>
    prisma.projectProductionHandover.findFirst({
      where: {
        externalTokenHash: tokenHash,
        deliveryStatus: ProductionHandoverDeliveryStatus.SENT,
        externalTokenRevokedAt: null,
        externalTokenExpiresAt: { gt: new Date() },
      },
      select: {
        contentSnapshot: true,
        productionUnit: { select: { projectId: true } },
      },
    }),
  );
  if (!handover) throw new Error("Handover file not found.");
  return createProductionHandoverFileUrl(
    {
      contentSnapshot: handover.contentSnapshot,
      projectId: handover.productionUnit.projectId,
    },
    attachmentId,
    mode,
  );
}

export async function getAuthenticatedProductionHandoverFileUrl(
  user: PermissionUser,
  handoverId: string,
  attachmentId: string,
  mode: "preview" | "download",
) {
  const handover = await withPrismaRetry(() =>
    prisma.projectProductionHandover.findUnique({
      where: { id: handoverId },
      select: {
        recipientUserId: true,
        requestedById: true,
        handedOverById: true,
        deliveryStatus: true,
        contentSnapshot: true,
        productionUnit: {
          select: {
            projectId: true,
            project: {
              select: {
                ownerId: true,
                coOwners: { select: { userId: true } },
              },
            },
          },
        },
      },
    }),
  );
  if (
    !handover ||
    handover.deliveryStatus !== ProductionHandoverDeliveryStatus.SENT ||
    !canAccessAuthenticatedProductionHandover(user.id, handover)
  ) {
    throw new Error("Handover file not found.");
  }
  return createProductionHandoverFileUrl(
    {
      contentSnapshot: handover.contentSnapshot,
      projectId: handover.productionUnit.projectId,
    },
    attachmentId,
    mode,
  );
}

export async function completeStageSix(
  user: PermissionUser,
  input: { projectId: string },
  conflictRetryCount = 0,
) {
  const accessProject = await getStageSixManagerProject(user, input.projectId);
  if (
    !accessProject ||
    !hasProjectPermission(user, accessProject, "stage.markStageComplete")
  ) {
    return { error: "You do not have permission to complete Stage 6." } as const;
  }
  try {
    return await withPrismaRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const project = await tx.project.findUnique({
            where: { id: input.projectId },
            select: {
              id: true,
              name: true,
              ownerId: true,
              coOwners: { select: { userId: true } },
              productionUnits: {
                select: {
                  id: true,
                  status: true,
                  sourceAttachment: { select: { status: true } },
                  approvalSteps: {
                    where: { removedAt: null },
                    select: { status: true },
                  },
                },
              },
              workflowStages: {
                select: {
                  id: true,
                  stageKey: true,
                  status: true,
                  unlockedAt: true,
                  completedAt: true,
                },
              },
            },
          });
          if (!project) return { error: "Project not found." } as const;
          const stageSix = project.workflowStages.find(
            (stage) => stage.stageKey === ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
          );
          const stageSeven = project.workflowStages.find(
            (stage) => stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
          );
          if (!stageSix || !stageSeven) {
            return { error: "Stage 6 and Stage 7 workflow records are required." } as const;
          }
          const completionMode = getWorkflowStageCompletionMode(
            project.workflowStages,
            ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
          );
          if (completionMode === "UNAVAILABLE") {
            return { error: "Stage 6 is not currently available." } as const;
          }
          if (!project.productionUnits.length) {
            return { error: "Stage 6 has no Production Units." } as const;
          }
          const approvalNotRequiredReadyIds = project.productionUnits
            .filter(
              (unit) =>
                unit.status !== ProjectProductionUnitStatus.HANDED_OVER &&
                unit.approvalSteps.length === 0 &&
                unit.sourceAttachment.status === AttachmentStatus.READY,
            )
            .map((unit) => unit.id);
          if (approvalNotRequiredReadyIds.length > 0) {
            await tx.projectProductionUnit.updateMany({
              where: { id: { in: approvalNotRequiredReadyIds } },
              data: {
                status: ProjectProductionUnitStatus.HANDOVER_READY,
                approvedAt: null,
              },
            });
          }
          const incomplete = project.productionUnits.filter((unit) => {
            if (unit.status === ProjectProductionUnitStatus.HANDED_OVER) return false;
            return !deriveProductionUnitReadiness({
              sourceAttachmentStatus: unit.sourceAttachment.status,
              approvalSteps: unit.approvalSteps,
            }).handoverReady;
          });
          if (incomplete.length) {
            return {
              error: `${incomplete.length} Production Unit${incomplete.length === 1 ? " is" : "s are"} not ready for handover.`,
              incompleteUnitIds: incomplete.map((unit) => unit.id),
            } as const;
          }
          const transitioned = completionMode === "TRANSITION";
          const now = new Date();
          if (transitioned) {
            const completed = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageSix.id,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                completedAt: now,
              },
            });

            if (completed.count === 1) {
              await tx.projectWorkflowStage.updateMany({
                where: {
                  id: stageSeven.id,
                  status: ProjectWorkflowStageStatus.LOCKED,
                },
                data: {
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                  unlockedAt: now,
                },
              });
            }
          }
          if (transitioned) {
            await createNotifications(
              tx,
              createDedupeNotificationData({
                userIds: [project.ownerId, ...project.coOwners.map((entry) => entry.userId)],
                actorId: user.id,
                dedupePrefix: `stage-seven-activated:${project.id}`,
                type: "NEXT_STAGE_ACTIVATED",
                title: "Stage 7 available",
                message: `Production approval is complete for ${project.name}.`,
                entityType: "PROJECT",
                entityId: project.id,
                projectId: project.id,
                url: `/projects/${project.id}/stages/7`,
              }),
            );
          }
          return {
            transitioned,
            productionUnitCount: project.productionUnits.length,
            stageSevenAvailable: true,
          } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034") &&
      conflictRetryCount < 1
    ) {
      return completeStageSix(user, input, conflictRetryCount + 1);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return { error: "Stage 6 changed at the same time. Please try again." } as const;
    }
    throw error;
  }
}

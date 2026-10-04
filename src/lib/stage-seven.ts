import {
  AttachmentStatus,
  NotificationEntityType,
  NotificationType,
  PhysicalSampleDecision,
  Prisma,
  ProductionApprovalRecipientType,
  ProductionDispatchStatus,
  ProductionHandoverRoute,
  ProductionSampleRoundStatus,
  ProductionSampleRoundType,
  ProductionSupervisionStatus,
  ProjectFileChecklistField,
  ProjectProductionUnitStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
} from "@prisma/client";

import { sendResendEmail } from "@/lib/email/resend";
import {
  hasProjectPermission,
  isGlobalProjectAdministrator,
  isProjectOwner,
  isProjectCoOwner,
  type PermissionUser,
} from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { publishNotificationChanges } from "@/lib/realtime/server";
import { richTextToPlainText, sanitizeRichText } from "@/lib/rich-text";
import { normalizeInternationalPhone } from "@/lib/project-contact-validation";
import {
  getProjectStageAccessRecordById,
  type ProjectStageAccessRecord,
} from "@/lib/project-stage-data";
import { getWorkflowStageCompletionMode } from "@/lib/project-workflow";
import { createPresignedDownloadUrl } from "@/lib/storage/s3";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";
import {
  buildRequestReminderCreateData,
  disableProjectRequestReminders,
  isRequestReminderInterval,
  mapRequestReminder,
  setRequestReminder,
  stopRequestReminder,
  type RequestReminderConfiguration,
  type RequestReminderIntervalHours,
} from "@/lib/request-reminders";

type StageProject = ProjectStageAccessRecord;
type EmailSender = typeof sendResendEmail;

type ReferenceAttachment = {
  id: string;
  projectId: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  bucket: string;
  storageKey: string;
  status: AttachmentStatus;
};

export type StageSevenWorkspaceData = {
  canManage: boolean;
  stageCompleted: boolean;
  projectClosedAt: string | null;
  participants: Array<{ id: string; name: string; email: string; role: string }>;
  selectedUnitId: string | null;
  selectedRoundId: string | null;
  units: Array<{
    id: string;
    name: string;
    rawFileName: string;
    sourceAttachmentId: string;
    sourceMimeType: string;
    status: ProductionSupervisionStatus;
    signedOffAt: string | null;
    acceptedBy: string | null;
    rounds: Array<{
      id: string;
      sequence: number;
      name: string;
      type: ProductionSampleRoundType;
      customTypeName: string | null;
      deadline: string;
      recipientRoute: ProductionHandoverRoute | null;
      recipientType: ProductionApprovalRecipientType | null;
      recipientUserId: string | null;
      recipientName: string | null;
      recipientEmail: string | null;
      recipientCompany: string | null;
      recipientPhone: string | null;
      requestNote: string | null;
      emailStatus: ProductionDispatchStatus;
      emailSentAt: string | null;
      emailError: string | null;
      status: ProductionSampleRoundStatus;
      receivedAt: string | null;
      canReview: boolean;
      decision: PhysicalSampleDecision | null;
      decisionNote: string | null;
      decidedBy: string | null;
      decidedAt: string | null;
      overdue: boolean;
      reminder: RequestReminderConfiguration | null;
      reminderManageable: boolean;
      referenceFiles: Array<{
        id: string;
        name: string;
        mimeType: string;
        size: number;
        downloadPath: string;
      }>;
      createdAt: string;
    }>;
  }>;
  summary: {
    totalUnits: number;
    waitingUnits: number;
    overdueRounds: number;
    acceptedUnits: number;
  };
};

export class StageSevenWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageSevenWorkflowError";
  }
}

function stageStatus(project: StageProject) {
  return project.workflowStages.find(
    (stage) =>
      stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
  )?.status;
}

export function canManageStageSeven(
  user: PermissionUser,
  project: StageProject,
) {
  return (
    (isProjectOwner(user, project) ||
      isProjectCoOwner(user, project) ||
      isGlobalProjectAdministrator(user)) &&
    hasProjectPermission(user, project, "stage.view")
  );
}

function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email;
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

function validClientRequestId(value: string) {
  return /^[a-zA-Z0-9_-]{16,120}$/.test(value);
}

function normalizeOptionalText(value: string | null | undefined, max: number) {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new StageSevenWorkflowError(`Text must be ${max} characters or fewer.`);
  }
  return text;
}

function normalizeOptionalRichText(value: string | null | undefined, max: number) {
  const html = sanitizeRichText(value);
  if (richTextToPlainText(html).length > max) {
    throw new StageSevenWorkflowError(`Text must be ${max} characters or fewer.`);
  }
  return html || null;
}

function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function parseDeadlineDate(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const deadline = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(deadline.getTime()) && deadline.toISOString().slice(0, 10) === value) {
      return deadline;
    }
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new StageSevenWorkflowError("Deadline is not a valid date.");
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function startOfUtcDate(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function outputNameFromChecklist(value: Prisma.JsonValue | null | undefined) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const text = (value as Record<string, Prisma.JsonValue>).text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

function productionUnitName(unit: {
  sourceAttachment: { originalFileName: string };
  sourceChecklist: {
    items: Array<{ fieldKey: ProjectFileChecklistField; value: Prisma.JsonValue | null }>;
  };
}) {
  const output = unit.sourceChecklist.items.find(
    (item) => item.fieldKey === ProjectFileChecklistField.OUTPUT_NAME,
  );
  return outputNameFromChecklist(output?.value) ?? unit.sourceAttachment.originalFileName;
}

function uniqueReferenceAttachments(unit: {
  projectId: string;
  sourceAttachment: ReferenceAttachment;
  files: Array<{ attachment: ReferenceAttachment }>;
}) {
  const unique = new Map<string, ReferenceAttachment>();
  for (const attachment of [
    unit.sourceAttachment,
    ...unit.files.map(({ attachment }) => attachment),
  ]) {
    if (
      attachment.projectId === unit.projectId &&
      attachment.status === AttachmentStatus.READY
    ) {
      unique.set(attachment.id, attachment);
    }
  }
  return [...unique.values()];
}

function selectReferenceAttachments(
  unit: {
    projectId: string;
    sourceAttachment: ReferenceAttachment;
    files: Array<{ attachment: ReferenceAttachment }>;
  },
  requestedIds?: string[],
) {
  const allowed = uniqueReferenceAttachments(unit);
  const allowedById = new Map(allowed.map((attachment) => [attachment.id, attachment]));
  if (requestedIds) {
    const uniqueIds = Array.from(new Set(requestedIds));
    if (
      uniqueIds.length !== requestedIds.length ||
      !uniqueIds.length ||
      uniqueIds.some((id) => !allowedById.has(id))
    ) {
      throw new StageSevenWorkflowError(
        "One or more sample-request reference files are invalid or belong to another Production Unit.",
      );
    }
    return uniqueIds.map((id) => allowedById.get(id)!);
  }
  if (!allowed.length) {
    throw new StageSevenWorkflowError(
      "This Production Unit has no approved reference files available.",
    );
  }
  return allowed;
}

async function getAuthorizedStageSevenProject(
  user: PermissionUser,
  projectId: string,
) {
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
      stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
      status: stageStatus(project),
    })
  ) {
    return null;
  }
  return project;
}

async function getManagerProject(user: PermissionUser, projectId: string) {
  const project = await getAuthorizedStageSevenProject(user, projectId);
  if (!project || !canManageStageSeven(user, project)) {
    throw new StageSevenWorkflowError(
      "Only a project owner, co-owner, or administrator can manage Stage 7.",
    );
  }
  if (project.archivedAt) {
    throw new StageSevenWorkflowError("Archived projects are read-only.");
  }
  if (project.completedAt || stageStatus(project) === ProjectWorkflowStageStatus.COMPLETED) {
    throw new StageSevenWorkflowError("Stage 7 is complete and is now read-only.");
  }
  if (stageStatus(project) !== ProjectWorkflowStageStatus.AVAILABLE) {
    throw new StageSevenWorkflowError("Stage 7 is not currently available.");
  }
  return project;
}

async function getSampleReviewerProject(user: PermissionUser, projectId: string) {
  const project = await getAuthorizedStageSevenProject(user, projectId);
  if (!project) {
    throw new StageSevenWorkflowError("Physical sample request not found.");
  }
  if (project.archivedAt) {
    throw new StageSevenWorkflowError("Archived projects are read-only.");
  }
  if (project.completedAt || stageStatus(project) === ProjectWorkflowStageStatus.COMPLETED) {
    throw new StageSevenWorkflowError("Stage 7 is complete and is now read-only.");
  }
  if (stageStatus(project) !== ProjectWorkflowStageStatus.AVAILABLE) {
    throw new StageSevenWorkflowError("Stage 7 is not currently available.");
  }
  return {
    canManage: canManageStageSeven(user, project),
  };
}

function canReviewPhysicalSampleRound(input: {
  userId: string;
  canManage: boolean;
  recipientUserId: string | null;
}) {
  return input.recipientUserId
    ? input.recipientUserId === input.userId
    : input.canManage;
}

function assertCanReviewPhysicalSampleRound(input: {
  userId: string;
  canManage: boolean;
  recipientUserId: string | null;
}) {
  if (canReviewPhysicalSampleRound(input)) return;

  throw new StageSevenWorkflowError(
    input.recipientUserId
      ? "Only the assigned internal recipient can review this sample request."
      : "Only an authorized project manager can review this sample request.",
  );
}

const workspaceAttachmentSelect = {
  id: true,
  projectId: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  bucket: true,
  storageKey: true,
  status: true,
} satisfies Prisma.ProjectAttachmentSelect;

export async function getStageSevenWorkspaceData(
  user: PermissionUser,
  projectId: string,
  selectedUnitId?: string | null,
  selectedRoundId?: string | null,
): Promise<StageSevenWorkspaceData | null> {
  const project = await getAuthorizedStageSevenProject(user, projectId);
  if (!project) return null;

  const canManage = canManageStageSeven(user, project);
  const assignedRecipientId = canManage ? null : user.id;

  const [units, closure] = await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.projectProductionUnit.findMany({
        where: {
          projectId,
          status: {
            in: [
              ProjectProductionUnitStatus.HANDOVER_READY,
              ProjectProductionUnitStatus.HANDED_OVER,
            ],
          },
          ...(assignedRecipientId
            ? {
                supervision: {
                  is: {
                    sampleRounds: {
                      some: { recipientUserId: assignedRecipientId },
                    },
                  },
                },
              }
            : {}),
        },
        orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
        include: {
          sourceAttachment: { select: workspaceAttachmentSelect },
          files: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: { attachment: { select: workspaceAttachmentSelect } },
          },
          sourceChecklist: {
            select: {
              items: {
                where: { fieldKey: ProjectFileChecklistField.OUTPUT_NAME },
                select: { fieldKey: true, value: true },
              },
            },
          },
          supervision: {
            include: {
              signedOffBy: { select: { name: true, email: true } },
              sampleRounds: {
                ...(assignedRecipientId
                  ? { where: { recipientUserId: assignedRecipientId } }
                  : {}),
                orderBy: [{ sequence: "asc" }, { id: "asc" }],
                include: {
                  decidedBy: { select: { name: true, email: true } },
                  reminder: {
                    select: {
                      enabled: true,
                      intervalHours: true,
                      nextReminderAt: true,
                      lastReminderAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.projectClosure.findUnique({ where: { projectId } }),
    ]),
  );

  if (!canManage && !units.length) return null;

  const currentDate = startOfUtcDate(new Date());
  const mappedUnits: StageSevenWorkspaceData["units"] = units.map((unit) => {
    const referenceById = new Map(
      uniqueReferenceAttachments(unit).map((attachment) => [attachment.id, attachment]),
    );
    return {
      id: unit.id,
      name: productionUnitName(unit),
      rawFileName: unit.sourceAttachment.originalFileName,
      sourceAttachmentId: unit.sourceAttachmentId,
      sourceMimeType: unit.sourceAttachment.mimeType,
      status: unit.supervision?.status ?? ProductionSupervisionStatus.NOT_STARTED,
      signedOffAt: unit.supervision?.signedOffAt?.toISOString() ?? null,
      acceptedBy: unit.supervision?.signedOffBy
        ? displayName(unit.supervision.signedOffBy)
        : null,
      rounds:
        unit.supervision?.sampleRounds.map((round, roundIndex, rounds) => ({
          id: round.id,
          sequence: round.sequence,
          name: round.name,
          type: round.type,
          customTypeName: round.customTypeName,
          deadline: round.deadline.toISOString(),
          recipientRoute: round.recipientRoute,
          recipientType: round.recipientType,
          recipientUserId: round.recipientUserId,
          recipientName: round.recipientName,
          recipientEmail: round.recipientEmail,
          recipientCompany: round.recipientCompany,
          recipientPhone: round.recipientPhone,
          requestNote: round.requestNote,
          emailStatus: round.emailStatus,
          emailSentAt: round.emailSentAt?.toISOString() ?? null,
          emailError: round.emailError,
          status: round.status,
          receivedAt: round.deliveredAt?.toISOString() ?? null,
          canReview: canReviewPhysicalSampleRound({
            userId: user.id,
            canManage,
            recipientUserId: round.recipientUserId,
          }),
          decision: round.decision,
          decisionNote: round.decisionNote,
          decidedBy: round.decidedBy ? displayName(round.decidedBy) : null,
          decidedAt: round.decidedAt?.toISOString() ?? null,
          overdue:
            round.decision === null &&
            round.deadline.getTime() < currentDate.getTime(),
          reminder: mapRequestReminder(round.reminder),
          reminderManageable:
            canManage &&
            !round.decision &&
            round.status !== ProductionSampleRoundStatus.COMPLETED &&
            roundIndex === rounds.length - 1,
          referenceFiles: round.requestReferenceFileIds.flatMap((id) => {
            const attachment = referenceById.get(id);
            return attachment
              ? [
                  {
                    id: attachment.id,
                    name: attachment.originalFileName,
                    mimeType: attachment.mimeType,
                    size: attachment.fileSize,
                    downloadPath: `/api/project-assets/${attachment.id}/download`,
                  },
                ]
              : [];
          }),
          createdAt: round.createdAt.toISOString(),
        })) ?? [],
    };
  });

  const resolvedUnitId = mappedUnits.some((unit) => unit.id === selectedUnitId)
    ? selectedUnitId!
    : mappedUnits[0]?.id ?? null;
  const selectedUnit = mappedUnits.find((unit) => unit.id === resolvedUnitId);
  const resolvedRoundId = selectedUnit?.rounds.some(
    (round) => round.id === selectedRoundId,
  )
    ? selectedRoundId!
    : selectedUnit?.rounds.at(-1)?.id ?? null;
  const allRounds = mappedUnits.flatMap((unit) => unit.rounds);

  return {
    canManage,
    stageCompleted: stageStatus(project) === ProjectWorkflowStageStatus.COMPLETED,
    projectClosedAt: closure?.closedAt.toISOString() ?? null,
    participants: canManage ? getParticipants(project) : [],
    selectedUnitId: resolvedUnitId,
    selectedRoundId: resolvedRoundId,
    units: mappedUnits,
    summary: {
      totalUnits: mappedUnits.length,
      waitingUnits: mappedUnits.filter(
        (unit) => unit.status === ProductionSupervisionStatus.IN_REVIEW,
      ).length,
      overdueRounds: allRounds.filter((round) => round.overdue).length,
      acceptedUnits: mappedUnits.filter(
        (unit) => unit.status === ProductionSupervisionStatus.SIGNED_OFF,
      ).length,
    },
  };
}

async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await withPrismaRetry(() =>
        prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }),
      );
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new StageSevenWorkflowError("Unable to save after multiple attempts.");
}

async function refreshProductionSupervisionStatus(
  tx: Prisma.TransactionClient,
  supervisionId: string,
) {
  const [undecidedRoundCount, latestRound] = await Promise.all([
    tx.productionSampleRound.count({
      where: { supervisionId, decision: null },
    }),
    tx.productionSampleRound.findFirst({
      where: { supervisionId },
      orderBy: [{ sequence: "desc" }, { id: "desc" }],
      select: {
        decision: true,
        decidedById: true,
        decidedAt: true,
      },
    }),
  ]);

  const signedOff =
    undecidedRoundCount === 0 &&
    latestRound?.decision === PhysicalSampleDecision.ACCEPTED;
  const status = signedOff
    ? ProductionSupervisionStatus.SIGNED_OFF
    : undecidedRoundCount > 0
      ? ProductionSupervisionStatus.IN_REVIEW
      : latestRound?.decision === PhysicalSampleDecision.REJECTED
        ? ProductionSupervisionStatus.REVISIONS_NEEDED
        : ProductionSupervisionStatus.NOT_STARTED;

  await tx.projectProductionSupervision.update({
    where: { id: supervisionId },
    data: {
      status,
      signedOffById: signedOff ? latestRound?.decidedById : null,
      signedOffAt: signedOff ? latestRound?.decidedAt : null,
    },
  });
}

async function assertStageSevenActive(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const project = await tx.project.findFirst({
    where: {
      id: projectId,
      archivedAt: null,
      completedAt: null,
      closure: null,
      workflowStages: {
        some: {
          stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
          status: ProjectWorkflowStageStatus.AVAILABLE,
        },
      },
    },
    select: { id: true },
  });
  if (!project) {
    throw new StageSevenWorkflowError("Stage 7 is complete or no longer editable.");
  }
}

const requestUnitInclude = {
  sourceAttachment: { select: workspaceAttachmentSelect },
  files: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: { attachment: { select: workspaceAttachmentSelect } },
  },
  sourceChecklist: {
    select: {
      items: {
        where: { fieldKey: ProjectFileChecklistField.OUTPUT_NAME },
        select: { fieldKey: true, value: true },
      },
    },
  },
  supervision: true,
} satisfies Prisma.ProjectProductionUnitInclude;

function validateSampleRequestInput(input: {
  clientRequestId: string;
  name: string;
  type: ProductionSampleRoundType;
  customTypeName?: string | null;
  deadline: string | Date;
  requestNote?: string | null;
}) {
  if (!validClientRequestId(input.clientRequestId)) {
    throw new StageSevenWorkflowError("The request identifier is invalid.");
  }
  const name = normalizeOptionalText(input.name, 160);
  if (!name) throw new StageSevenWorkflowError("Enter a round name.");
  if (!Object.values(ProductionSampleRoundType).includes(input.type)) {
    throw new StageSevenWorkflowError("Select a valid sample type.");
  }
  const customTypeName = normalizeOptionalText(input.customTypeName, 120);
  if (input.type === ProductionSampleRoundType.CUSTOM && !customTypeName) {
    throw new StageSevenWorkflowError("Enter a custom sample type.");
  }
  if (input.type !== ProductionSampleRoundType.CUSTOM && customTypeName) {
    throw new StageSevenWorkflowError(
      "A custom sample type can only be used when Sample Type is Custom.",
    );
  }
  return {
    name,
    customTypeName,
    deadline: parseDeadlineDate(input.deadline),
    requestNote: normalizeOptionalRichText(input.requestNote, 8_000),
  };
}

function resolveSampleRecipient(
  project: StageProject,
  input: {
    recipientRoute: ProductionHandoverRoute;
    recipientType: ProductionApprovalRecipientType;
    recipientUserId?: string | null;
    recipientName?: string | null;
    recipientEmail?: string | null;
    recipientCompany?: string | null;
    recipientPhone?: string | null;
  },
) {
  const isInternal = input.recipientRoute === ProductionHandoverRoute.PURCHASE_DEPARTMENT;
  if (
    !Object.values(ProductionHandoverRoute).includes(input.recipientRoute) ||
    !Object.values(ProductionApprovalRecipientType).includes(input.recipientType)
  ) {
    throw new StageSevenWorkflowError("Select a valid sample recipient type.");
  }
  if (isInternal) {
    if (
      input.recipientType !== ProductionApprovalRecipientType.EXISTING_COLLABORATOR ||
      !input.recipientUserId
    ) {
      throw new StageSevenWorkflowError(
        "Internal sample requests require an existing project participant.",
      );
    }
    const participant = getParticipants(project).find(
      (candidate) => candidate.id === input.recipientUserId,
    );
    if (!participant) {
      throw new StageSevenWorkflowError(
        "The selected internal recipient is not part of this project.",
      );
    }
    return {
      recipientRoute: input.recipientRoute,
      recipientType: input.recipientType,
      recipientUserId: participant.id,
      recipientName: participant.name,
      recipientEmail: participant.email,
      recipientCompany: null,
      recipientPhone: null,
    };
  }
  if (input.recipientType !== ProductionApprovalRecipientType.EXTERNAL_EMAIL) {
    throw new StageSevenWorkflowError(
      "External sample requests require external recipient details.",
    );
  }
  const recipientCompany = normalizeOptionalText(input.recipientCompany, 160);
  if (!recipientCompany) {
    throw new StageSevenWorkflowError("Enter the external recipient company name.");
  }
  const recipientName = normalizeOptionalText(input.recipientName, 160);
  if (!recipientName) {
    throw new StageSevenWorkflowError("Enter the external contact name.");
  }
  const recipientEmail = normalizeEmail(input.recipientEmail);
  if (!recipientEmail) {
    throw new StageSevenWorkflowError("Enter a valid external recipient email address.");
  }
  const recipientPhone = input.recipientPhone
    ? normalizeInternationalPhone(input.recipientPhone)
    : null;
  if (!recipientPhone) {
    throw new StageSevenWorkflowError(
      "Enter a valid external phone number including country code.",
    );
  }
  return {
    recipientRoute: input.recipientRoute,
    recipientType: input.recipientType,
    recipientUserId: null,
    recipientName,
    recipientEmail,
    recipientCompany,
    recipientPhone,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanizeEnum(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase("en-US") + part.slice(1))
    .join(" ");
}

async function buildSampleRequestEmail(roundId: string) {
  const round = await withPrismaRetry(() =>
    prisma.productionSampleRound.findUnique({
      where: { id: roundId },
      include: {
        project: { select: { name: true } },
        supervision: {
          include: {
            productionUnit: { include: requestUnitInclude },
          },
        },
      },
    }),
  );
  if (!round?.recipientEmail) {
    throw new StageSevenWorkflowError("The sample request has no valid recipient email.");
  }
  const unit = round.supervision.productionUnit;
  const referenceFiles = selectReferenceAttachments(unit, round.requestReferenceFileIds);
  const links = await Promise.all(
    referenceFiles.map(async (attachment) => ({
      name: attachment.originalFileName,
      url: await createPresignedDownloadUrl({
        bucket: attachment.bucket,
        storageKey: attachment.storageKey,
        fileName: attachment.originalFileName,
        expiresInSeconds: 60 * 60 * 24 * 7,
      }),
    })),
  );
  const unitName = productionUnitName(unit);
  const sampleType =
    round.type === ProductionSampleRoundType.CUSTOM
      ? round.customTypeName || "Custom"
      : round.type === ProductionSampleRoundType.FINAL_MASS_PRODUCTION_SIGN_OFF
        ? "Final Mass-Production Sample"
        : humanizeEnum(round.type);
  const deadline = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(round.deadline);
  const greeting = round.recipientName ? `Hello ${round.recipientName},` : "Hello,";
  const requestNoteText = richTextToPlainText(round.requestNote);
  const subject = `[GTI Archive] Physical Sample Request — ${round.project.name} — ${unitName}`;
  const fileLines = links.map((file) => `- ${file.name}: ${file.url}`);
  const text = [
    greeting,
    "",
    "GTI has requested a physical production sample.",
    "",
    `Project: ${round.project.name}`,
    `Production Unit: ${unitName}`,
    `Sample Round: ${round.name}`,
    `Sample Type: ${sampleType}`,
    `Deadline: ${deadline}`,
    ...(requestNoteText ? [`Request Note: ${requestNoteText}`] : []),
    "",
    "Please prepare the physical sample based on the approved production material and arrange delivery/courier before the requested deadline.",
    "",
    "Relevant production files (secure links expire in 7 days):",
    ...fileLines,
    "",
    "Regards,",
    "GTI Archive",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#18221b;line-height:1.55">
      <p>${escapeHtml(greeting)}</p>
      <p>GTI has requested a physical production sample.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:3px 14px 3px 0"><strong>Project</strong></td><td>${escapeHtml(round.project.name)}</td></tr>
        <tr><td style="padding:3px 14px 3px 0"><strong>Production Unit</strong></td><td>${escapeHtml(unitName)}</td></tr>
        <tr><td style="padding:3px 14px 3px 0"><strong>Sample Round</strong></td><td>${escapeHtml(round.name)}</td></tr>
        <tr><td style="padding:3px 14px 3px 0"><strong>Sample Type</strong></td><td>${escapeHtml(sampleType)}</td></tr>
        <tr><td style="padding:3px 14px 3px 0"><strong>Deadline</strong></td><td>${escapeHtml(deadline)}</td></tr>
      </table>
      ${requestNoteText ? `<p><strong>Request Note</strong><br>${escapeHtml(requestNoteText).replaceAll("\n", "<br>")}</p>` : ""}
      <p>Please prepare the physical sample based on the approved production material and arrange delivery/courier before the requested deadline.</p>
      <h3>Relevant production files</h3>
      <p>These secure links expire in 7 days.</p>
      <ul>${links.map((file) => `<li><a href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a></li>`).join("")}</ul>
      <p>Regards,<br>GTI Archive</p>
    </div>`;
  return { round, subject, text, html };
}

async function deliverSampleRequestEmail(
  roundId: string,
  sendEmail: EmailSender,
) {
  async function markFailed(error: string) {
    await withPrismaRetry(() =>
      prisma.productionSampleRound.updateMany({
        where: { id: roundId, emailStatus: ProductionDispatchStatus.PENDING },
        data: {
          emailStatus: ProductionDispatchStatus.FAILED,
          emailError: error.slice(0, 4_000),
        },
      }),
    );
    return { status: ProductionDispatchStatus.FAILED, error } as const;
  }

  let draft: Awaited<ReturnType<typeof buildSampleRequestEmail>>;
  let result: Awaited<ReturnType<EmailSender>>;
  try {
    draft = await buildSampleRequestEmail(roundId);
    result = await sendEmail({
      to: draft.round.recipientEmail!,
      subject: draft.subject,
      html: draft.html,
      text: draft.text,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to send the physical sample request email.";
    return markFailed(message);
  }
  if (!result.ok) return markFailed(result.error);

  const sentAt = new Date();
  await serializable(async (tx) => {
    const claimed = await tx.productionSampleRound.updateMany({
      where: { id: roundId, emailStatus: ProductionDispatchStatus.PENDING },
      data: {
        emailStatus: ProductionDispatchStatus.SENT,
        emailSentAt: sentAt,
        emailError: null,
        emailProviderMessageId: result.id ?? null,
      },
    });
    if (!claimed.count) return;
    const round = await tx.productionSampleRound.findUniqueOrThrow({
      where: { id: roundId },
      select: { supervisionId: true },
    });
    await tx.projectProductionSupervision.updateMany({
      where: {
        id: round.supervisionId,
        status: { not: ProductionSupervisionStatus.SIGNED_OFF },
      },
      data: { status: ProductionSupervisionStatus.IN_REVIEW },
    });
  });
  return { status: ProductionDispatchStatus.SENT, error: null } as const;
}

async function ensureInternalSampleRequestNotification(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    projectName: string;
    productionUnitId: string;
    roundId: string;
    roundName: string;
    recipientUserId: string;
    unitName?: string;
  },
) {
  const dedupeKey =
    `stage7-physical-sample-requested:${input.roundId}:${input.recipientUserId}`;
  const notification = {
    userId: input.recipientUserId,
    type: NotificationType.PRODUCTION_SAMPLE_REQUESTED,
    title: "Physical sample requested",
    entityType: NotificationEntityType.SAMPLE_ROUND,
    entityId: input.roundId,
    projectId: input.projectId,
    url: `/tasks/samples/${input.roundId}`,
  } as const;

  await tx.notification.upsert({
    where: { dedupeKey },
    update: notification,
    create: {
      ...notification,
      message: input.unitName
        ? `${input.roundName} for ${input.unitName} in ${input.projectName} has been assigned to you.`
        : `${input.roundName} in ${input.projectName} has been assigned to you.`,
      dedupeKey,
    },
  });
}

export async function createProductionSampleRound(
  user: PermissionUser,
  input: {
    projectId: string;
    productionUnitId: string;
    clientRequestId: string;
    name: string;
    type: ProductionSampleRoundType;
    customTypeName?: string | null;
    deadline: string | Date;
    recipientRoute: ProductionHandoverRoute;
    recipientType: ProductionApprovalRecipientType;
    recipientUserId?: string | null;
    recipientName?: string | null;
    recipientEmail?: string | null;
    recipientCompany?: string | null;
    recipientPhone?: string | null;
    requestNote?: string | null;
    referenceFileIds?: string[];
    reminderIntervalHours?: number | null;
  },
  options: { sendEmail?: EmailSender } = {},
) {
  const project = await getManagerProject(user, input.projectId);
  const validated = validateSampleRequestInput(input);
  if (
    input.reminderIntervalHours !== undefined &&
    input.reminderIntervalHours !== null &&
    !isRequestReminderInterval(input.reminderIntervalHours)
  ) {
    throw new StageSevenWorkflowError("Select a valid reminder interval.");
  }
  const recipient = resolveSampleRecipient(project, input);
  const prepared = await serializable(async (tx) => {
    await assertStageSevenActive(tx, input.projectId);
    const duplicate = await tx.productionSampleRound.findUnique({
      where: { clientRequestId: input.clientRequestId },
      select: {
        id: true,
        name: true,
        projectId: true,
        recipientUserId: true,
        emailStatus: true,
        emailError: true,
        supervision: { select: { productionUnitId: true } },
      },
    });
    if (duplicate) {
      if (
        duplicate.projectId !== input.projectId ||
        duplicate.supervision.productionUnitId !== input.productionUnitId
      ) {
        throw new StageSevenWorkflowError("The request identifier is already in use.");
      }
      if (duplicate.recipientUserId) {
        await ensureInternalSampleRequestNotification(tx, {
          projectId: duplicate.projectId,
          projectName: project.name,
          productionUnitId: duplicate.supervision.productionUnitId,
          roundId: duplicate.id,
          roundName: duplicate.name,
          recipientUserId: duplicate.recipientUserId,
        });
      }
      return { ...duplicate, duplicate: true } as const;
    }

    const unit = await tx.projectProductionUnit.findFirst({
      where: {
        id: input.productionUnitId,
        projectId: input.projectId,
        status: {
          in: [
            ProjectProductionUnitStatus.HANDOVER_READY,
            ProjectProductionUnitStatus.HANDED_OVER,
          ],
        },
      },
      include: requestUnitInclude,
    });
    if (!unit) {
      throw new StageSevenWorkflowError(
        "Only approved Stage 6 Production Units can request physical samples.",
      );
    }
    if (unit.supervision?.status === ProductionSupervisionStatus.SIGNED_OFF) {
      throw new StageSevenWorkflowError("Accepted Production Units are read-only.");
    }
    const references = selectReferenceAttachments(unit, input.referenceFileIds);
    const supervision = unit.supervision
      ? unit.supervision
      : await tx.projectProductionSupervision.create({
          data: {
            projectId: input.projectId,
            productionUnitId: input.productionUnitId,
            status: ProductionSupervisionStatus.NOT_STARTED,
          },
        });
    const latestSequence = await tx.productionSampleRound.aggregate({
      where: { supervisionId: supervision.id },
      _max: { sequence: true },
    });
    const requestCreatedAt = new Date();
    const reminderCreateData = buildRequestReminderCreateData({
      projectId: input.projectId,
      configuredById: user.id,
      intervalHours: input.reminderIntervalHours,
      now: requestCreatedAt,
    });
    await tx.requestReminder.updateMany({
      where: {
        enabled: true,
        stageSevenSampleRound: { supervisionId: supervision.id },
      },
      data: {
        enabled: false,
        nextReminderAt: null,
        stoppedAt: requestCreatedAt,
        processingToken: null,
        processingStartedAt: null,
      },
    });
    const created = await tx.productionSampleRound.create({
      data: {
        clientRequestId: input.clientRequestId,
        projectId: input.projectId,
        supervisionId: supervision.id,
        sequence: (latestSequence._max.sequence ?? 0) + 1,
        name: validated.name,
        type: input.type,
        customTypeName: validated.customTypeName,
        deadline: validated.deadline,
        ...recipient,
        requestNote: validated.requestNote,
        requestReferenceFileIds: references.map((attachment) => attachment.id),
        emailStatus: ProductionDispatchStatus.PENDING,
        emailAttemptCount: 1,
        status: ProductionSampleRoundStatus.PENDING,
        createdById: user.id,
        createdAt: requestCreatedAt,
        ...(reminderCreateData
          ? { reminder: { create: reminderCreateData } }
          : {}),
      },
      select: { id: true, emailStatus: true, emailError: true },
    });

    if (recipient.recipientUserId) {
      await ensureInternalSampleRequestNotification(tx, {
        projectId: input.projectId,
        projectName: project.name,
        productionUnitId: input.productionUnitId,
        roundId: created.id,
        roundName: validated.name,
        recipientUserId: recipient.recipientUserId,
        unitName: productionUnitName(unit),
      });
    }

    return {
      ...created,
      recipientUserId: recipient.recipientUserId,
      duplicate: false,
    } as const;
  });

  if (prepared.recipientUserId) {
    await publishNotificationChanges({
      recipientUserIds: [prepared.recipientUserId],
      reason: "created",
    });
  }
  if (prepared.duplicate) return prepared;
  const delivery = await deliverSampleRequestEmail(
    prepared.id,
    options.sendEmail ?? sendResendEmail,
  );
  return {
    id: prepared.id,
    duplicate: false,
    emailStatus: delivery.status,
    emailError: delivery.error,
  } as const;
}

export async function configureStageSevenSampleRequestReminder(
  user: PermissionUser,
  input: {
    projectId: string;
    productionUnitId: string;
    sampleRoundId: string;
    intervalHours: RequestReminderIntervalHours | null;
  },
) {
  await getManagerProject(user, input.projectId);
  const round = await withPrismaRetry(() =>
    prisma.productionSampleRound.findFirst({
      where: {
        id: input.sampleRoundId,
        projectId: input.projectId,
        decision: null,
        status: { not: ProductionSampleRoundStatus.COMPLETED },
        supervision: {
          productionUnitId: input.productionUnitId,
          status: { not: ProductionSupervisionStatus.SIGNED_OFF },
        },
      },
      select: {
        id: true,
        supervisionId: true,
        supervision: {
          select: {
            sampleRounds: {
              orderBy: [{ sequence: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    }),
  );
  if (!round) {
    throw new StageSevenWorkflowError(
      "This physical sample request is no longer pending.",
    );
  }
  if (round.supervision.sampleRounds[0]?.id !== round.id) {
    throw new StageSevenWorkflowError(
      "Only the latest physical sample round can send reminders.",
    );
  }
  if (input.intervalHours === null) {
    await stopRequestReminder({ stageSevenSampleRoundId: round.id });
    return { reminder: null } as const;
  }
  if (!isRequestReminderInterval(input.intervalHours)) {
    throw new StageSevenWorkflowError("Select a valid reminder interval.");
  }
  const reminder = await setRequestReminder({
    projectId: input.projectId,
    configuredById: user.id,
    target: { stageSevenSampleRoundId: round.id },
    intervalHours: input.intervalHours,
  });
  return { reminder } as const;
}

export async function retryProductionSampleRequestEmail(
  user: PermissionUser,
  input: { projectId: string; productionUnitId: string; sampleRoundId: string },
  options: { sendEmail?: EmailSender } = {},
) {
  await getManagerProject(user, input.projectId);
  await serializable(async (tx) => {
    await assertStageSevenActive(tx, input.projectId);
    const round = await tx.productionSampleRound.findFirst({
      where: {
        id: input.sampleRoundId,
        projectId: input.projectId,
        supervision: {
          productionUnitId: input.productionUnitId,
          productionUnit: {
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.HANDOVER_READY,
                ProjectProductionUnitStatus.HANDED_OVER,
              ],
            },
          },
        },
      },
      select: {
        id: true,
        decision: true,
        emailStatus: true,
        supervision: { select: { status: true } },
      },
    });
    if (!round) throw new StageSevenWorkflowError("Sample request not found.");
    if (round.decision) {
      throw new StageSevenWorkflowError("Decided sample requests are read-only.");
    }
    if (round.supervision.status === ProductionSupervisionStatus.SIGNED_OFF) {
      throw new StageSevenWorkflowError("Accepted Production Units are read-only.");
    }
    if (round.emailStatus === ProductionDispatchStatus.PENDING) {
      throw new StageSevenWorkflowError("This sample request email is already being sent.");
    }
    const updated = await tx.productionSampleRound.updateMany({
      where: {
        id: round.id,
        emailStatus: {
          in: [
            ProductionDispatchStatus.FAILED,
            ProductionDispatchStatus.NOT_SENT,
            ProductionDispatchStatus.SENT,
          ],
        },
        decision: null,
      },
      data: {
        emailStatus: ProductionDispatchStatus.PENDING,
        emailError: null,
        emailAttemptCount: { increment: 1 },
      },
    });
    if (!updated.count) {
      throw new StageSevenWorkflowError("This sample request email could not be claimed for sending.");
    }
    return true;
  });
  const delivery = await deliverSampleRequestEmail(
    input.sampleRoundId,
    options.sendEmail ?? sendResendEmail,
  );
  return {
    duplicate: false,
    emailStatus: delivery.status,
    emailError: delivery.error,
  } as const;
}

export async function deleteProductionSampleRound(
  user: PermissionUser,
  input: { projectId: string; productionUnitId: string; sampleRoundId: string },
) {
  await getManagerProject(user, input.projectId);
  const deleted = await serializable(async (tx) => {
    await assertStageSevenActive(tx, input.projectId);
    const round = await tx.productionSampleRound.findFirst({
      where: {
        id: input.sampleRoundId,
        projectId: input.projectId,
        supervision: {
          productionUnitId: input.productionUnitId,
          productionUnit: {
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.HANDOVER_READY,
                ProjectProductionUnitStatus.HANDED_OVER,
              ],
            },
          },
        },
      },
      select: {
        id: true,
        decision: true,
        recipientUserId: true,
        supervisionId: true,
      },
    });
    if (!round) throw new StageSevenWorkflowError("Sample request not found.");
    if (round.decision) {
      throw new StageSevenWorkflowError(
        "Accepted or rejected sample requests cannot be deleted.",
      );
    }
    await tx.notification.deleteMany({
      where: {
        entityType: NotificationEntityType.SAMPLE_ROUND,
        entityId: round.id,
      },
    });
    const removed = await tx.productionSampleRound.deleteMany({
      where: { id: round.id, decision: null },
    });
    if (!removed.count) {
      throw new StageSevenWorkflowError(
        "This sample request was completed before it could be deleted.",
      );
    }

    await refreshProductionSupervisionStatus(tx, round.supervisionId);
    return { recipientUserId: round.recipientUserId };
  });

  if (deleted.recipientUserId) {
    await publishNotificationChanges({
      recipientUserIds: [deleted.recipientUserId],
      reason: "deleted",
    });
  }
  return { deleted: true } as const;
}

export async function decidePhysicalSampleRound(
  user: PermissionUser,
  input: {
    projectId: string;
    productionUnitId: string;
    sampleRoundId: string;
    decision: PhysicalSampleDecision;
    decisionNote?: string | null;
  },
) {
  const reviewer = await getSampleReviewerProject(user, input.projectId);
  if (!Object.values(PhysicalSampleDecision).includes(input.decision)) {
    throw new StageSevenWorkflowError("Select Accept or Reject.");
  }
  const decisionNote = normalizeOptionalRichText(input.decisionNote, 8_000);
  if (input.decision === PhysicalSampleDecision.REJECTED && !decisionNote) {
    throw new StageSevenWorkflowError("Enter a review note before rejecting the sample.");
  }
  return serializable(async (tx) => {
    await assertStageSevenActive(tx, input.projectId);
    const round = await tx.productionSampleRound.findFirst({
      where: {
        id: input.sampleRoundId,
        projectId: input.projectId,
        supervision: {
          productionUnitId: input.productionUnitId,
          productionUnit: {
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.HANDOVER_READY,
                ProjectProductionUnitStatus.HANDED_OVER,
              ],
            },
          },
        },
      },
      include: { supervision: true },
    });
    if (!round) throw new StageSevenWorkflowError("Sample request not found.");
    assertCanReviewPhysicalSampleRound({
      userId: user.id,
      canManage: reviewer.canManage,
      recipientUserId: round.recipientUserId,
    });
    if (round.decision) {
      if (round.decision === input.decision) return { duplicate: true } as const;
      throw new StageSevenWorkflowError("This sample request already has a final decision.");
    }
    if (round.supervision.status === ProductionSupervisionStatus.SIGNED_OFF) {
      throw new StageSevenWorkflowError("Accepted Production Units are read-only.");
    }
    if (
      round.status !== ProductionSampleRoundStatus.UNDER_REVIEW ||
      !round.deliveredAt
    ) {
      throw new StageSevenWorkflowError(
        "Mark the physical sample as received before accepting or rejecting it.",
      );
    }
    const now = new Date();
    const updated = await tx.productionSampleRound.updateMany({
      where: {
        id: round.id,
        decision: null,
        status: ProductionSampleRoundStatus.UNDER_REVIEW,
        deliveredAt: { not: null },
      },
      data: {
        decision: input.decision,
        decisionNote,
        decidedById: user.id,
        decidedAt: now,
        status: ProductionSampleRoundStatus.COMPLETED,
        completedById: user.id,
        completedAt: now,
      },
    });
    if (!updated.count) {
      const decided = await tx.productionSampleRound.findUniqueOrThrow({
        where: { id: round.id },
        select: { decision: true },
      });
      if (decided.decision === input.decision) return { duplicate: true } as const;
      if (decided.decision) {
        throw new StageSevenWorkflowError(
          "This sample request already has a final decision.",
        );
      }
      throw new StageSevenWorkflowError(
        "Mark the physical sample as received before accepting or rejecting it.",
      );
    }
    await tx.requestReminder.updateMany({
      where: { enabled: true, stageSevenSampleRoundId: round.id },
      data: {
        enabled: false,
        nextReminderAt: null,
        stoppedAt: now,
        processingToken: null,
        processingStartedAt: null,
      },
    });
    await refreshProductionSupervisionStatus(tx, round.supervisionId);
    return { duplicate: false } as const;
  });
}

export async function markPhysicalSampleRoundReceived(
  user: PermissionUser,
  input: {
    projectId: string;
    productionUnitId: string;
    sampleRoundId: string;
  },
) {
  const reviewer = await getSampleReviewerProject(user, input.projectId);
  return serializable(async (tx) => {
    await assertStageSevenActive(tx, input.projectId);
    const round = await tx.productionSampleRound.findFirst({
      where: {
        id: input.sampleRoundId,
        projectId: input.projectId,
        supervision: {
          productionUnitId: input.productionUnitId,
          productionUnit: {
            projectId: input.projectId,
            status: {
              in: [
                ProjectProductionUnitStatus.HANDOVER_READY,
                ProjectProductionUnitStatus.HANDED_OVER,
              ],
            },
          },
        },
      },
      include: { supervision: true },
    });
    if (!round) throw new StageSevenWorkflowError("Sample request not found.");
    assertCanReviewPhysicalSampleRound({
      userId: user.id,
      canManage: reviewer.canManage,
      recipientUserId: round.recipientUserId,
    });
    if (round.decision || round.status === ProductionSampleRoundStatus.COMPLETED) {
      throw new StageSevenWorkflowError(
        "This sample request already has a final decision.",
      );
    }
    if (round.supervision.status === ProductionSupervisionStatus.SIGNED_OFF) {
      throw new StageSevenWorkflowError("Accepted Production Units are read-only.");
    }
    if (round.status === ProductionSampleRoundStatus.UNDER_REVIEW) {
      return { duplicate: true } as const;
    }

    const receivedAt = new Date();
    const updated = await tx.productionSampleRound.updateMany({
      where: {
        id: round.id,
        status: ProductionSampleRoundStatus.PENDING,
        decision: null,
      },
      data: {
        status: ProductionSampleRoundStatus.UNDER_REVIEW,
        deliveredAt: receivedAt,
      },
    });
    if (!updated.count) {
      const current = await tx.productionSampleRound.findUniqueOrThrow({
        where: { id: round.id },
        select: { status: true, decision: true },
      });
      if (
        current.status === ProductionSampleRoundStatus.UNDER_REVIEW &&
        !current.decision
      ) {
        return { duplicate: true } as const;
      }
      throw new StageSevenWorkflowError(
        "This sample request is no longer awaiting receipt.",
      );
    }
    return { duplicate: false, receivedAt: receivedAt.toISOString() } as const;
  });
}

export async function closeStageSevenProject(
  user: PermissionUser,
  input: { projectId: string },
) {
  const project = await getAuthorizedStageSevenProject(user, input.projectId);
  if (
    !project ||
    !canManageStageSeven(user, project) ||
    !hasProjectPermission(user, project, "project.completeArchive")
  ) {
    throw new StageSevenWorkflowError(
      "Only a project owner, co-owner, or administrator can complete the project.",
    );
  }
  if (project.archivedAt) throw new StageSevenWorkflowError("Archived projects are read-only.");

  return serializable(async (tx) => {
    const existing = await tx.projectClosure.findUnique({
      where: { projectId: input.projectId },
    });
    if (existing) {
      return { duplicate: true, closedAt: existing.closedAt.toISOString() } as const;
    }
    const workflowStages = await tx.projectWorkflowStage.findMany({
      where: { projectId: input.projectId },
    });
    const stage = workflowStages.find(
      (workflowStage) =>
        workflowStage.stageKey ===
        ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
    );
    const instance = await tx.projectStageInstance.findFirst({ where: { projectId: input.projectId, workspace: "PACKAGING_ACCEPTANCE", retiredAt: null } });
    const followingStage = instance ? await tx.projectStageInstance.findFirst({ where: { projectId: input.projectId, order: { gt: instance.order }, retiredAt: null }, orderBy: { order: "asc" } }) : null;
    if (followingStage && stage?.status === ProjectWorkflowStageStatus.COMPLETED) {
      return { duplicate: true, closedAt: stage.completedAt!.toISOString() } as const;
    }
    if (
      !stage ||
      getWorkflowStageCompletionMode(
        workflowStages,
        ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
      ) !== "TRANSITION"
    ) {
      throw new StageSevenWorkflowError("Stage 7 is not currently available.");
    }
    const units = await tx.projectProductionUnit.findMany({
      where: {
        projectId: input.projectId,
        status: {
          in: [
            ProjectProductionUnitStatus.HANDOVER_READY,
            ProjectProductionUnitStatus.HANDED_OVER,
          ],
        },
      },
      select: { id: true, supervision: { select: { status: true } } },
    });
    if (!units.length) {
      throw new StageSevenWorkflowError("No approved Production Units are available.");
    }
    if (
      units.some(
        (unit) => unit.supervision?.status !== ProductionSupervisionStatus.SIGNED_OFF,
      )
    ) {
      throw new StageSevenWorkflowError(
        "All physical Production Unit samples must be accepted before the project can be completed.",
      );
    }
    const now = new Date();
    if (!followingStage) await tx.projectClosure.create({
      data: { projectId: input.projectId, closedById: user.id, closedAt: now },
    });
    await tx.projectWorkflowStage.update({
      where: { id: stage.id },
      data: { status: ProjectWorkflowStageStatus.COMPLETED, completedAt: now },
    });
    if (!followingStage) await tx.project.update({
      where: { id: input.projectId },
      data: { completedAt: now },
    });
    await disableProjectRequestReminders(tx, {
      projectId: input.projectId,
      stage: "SEVEN",
      now,
    });
    return { duplicate: false, closedAt: now.toISOString() } as const;
  });
}

export async function processStageSevenOverdueDeadlines(now = new Date()) {
  const currentDate = startOfUtcDate(now);
  const rounds = await withPrismaRetry(() =>
    prisma.productionSampleRound.findMany({
      where: {
        decision: null,
        deadline: { lt: currentDate },
        supervision: { status: { not: ProductionSupervisionStatus.SIGNED_OFF } },
        project: {
          completedAt: null,
          archivedAt: null,
          workflowStages: {
            some: {
              stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
              status: ProjectWorkflowStageStatus.AVAILABLE,
            },
          },
        },
      },
      include: {
        project: {
          select: {
            ownerId: true,
            coOwners: { select: { userId: true } },
          },
        },
        supervision: {
          include: {
            productionUnit: {
              include: {
                sourceAttachment: { select: { originalFileName: true } },
                sourceChecklist: {
                  select: {
                    items: {
                      where: { fieldKey: ProjectFileChecklistField.OUTPUT_NAME },
                      select: { fieldKey: true, value: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  for (const round of rounds) {
    const recipients = Array.from(
      new Set([
        round.project.ownerId,
        ...round.project.coOwners.map((coOwner) => coOwner.userId),
      ]),
    ).filter((userId): userId is string => Boolean(userId));
    const unitName = productionUnitName(round.supervision.productionUnit);
    for (const userId of recipients) {
      notifications.push({
        userId,
        type: NotificationType.STAGE_SEVEN_OVERDUE,
        title: "Physical sample request is overdue",
        message: `${unitName}, ${round.name}, is past its physical sample deadline.`,
        entityType: NotificationEntityType.SAMPLE_ROUND,
        entityId: round.id,
        projectId: round.projectId,
        url: `/projects/${round.projectId}/stages/7?unit=${round.supervision.productionUnitId}&round=${round.id}`,
        dedupeKey: `stage7-physical-sample-overdue:${round.id}:${userId}`,
      });
    }
  }
  if (notifications.length) {
    await withPrismaRetry(() =>
      prisma.notification.createMany({ data: notifications, skipDuplicates: true }),
    );
  }
  return { scannedRounds: rounds.length, attemptedNotifications: notifications.length };
}

/** Tasker entry point: only the assigned recipient and the requested sample. */
export async function getAssignedPhysicalSampleTask(user: PermissionUser, roundId: string) {
  const round = await prisma.productionSampleRound.findFirst({
    where: { id: roundId, recipientUserId: user.id },
    select: { projectId: true, name: true, supervision: { select: { productionUnitId: true } }, project: { select: { name: true } } },
  });
  if (!round) return null;
  const data = await getStageSevenWorkspaceData(user, round.projectId, round.supervision.productionUnitId, roundId);
  const unit = data?.units.find(unit => unit.id === round.supervision.productionUnitId);
  if (!data || !unit || !unit.rounds.some(round => round.id === roundId)) return null;
  return { projectId: round.projectId, projectName: round.project.name, name: round.name, stageCompleted: data.stageCompleted, unit: { ...unit, rounds: unit.rounds.filter(round => round.id === roundId) } };
}

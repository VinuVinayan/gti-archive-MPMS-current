import { randomUUID } from "node:crypto";

import {
  NotificationEntityType,
  NotificationType,
  Prisma,
  ProductionSampleRoundStatus,
  ProductionSupervisionStatus,
  ProjectFileChecklistField,
  ProjectFileChecklistItemStatus,
  ProjectFileChecklistRequestStatus,
  ProjectFileChecklistRequestWorkflowStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  RequestReminderDeliveryStatus,
} from "@prisma/client";

import {
  buildExternalChecklistRequestUrl,
  createExternalChecklistToken,
} from "@/lib/checklist-external-token";
import { getApplicationUrl } from "@/lib/secure-external-token";
import { buildChecklistInformationReminderEmail } from "@/lib/email/checklist-information-request";
import { buildPhysicalSampleReminderEmail } from "@/lib/email/production-workflow";
import { sendResendEmail } from "@/lib/email/resend";
import { publishNotificationChanges } from "@/lib/realtime/server";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { defaultProjectStatusGroupSlugs } from "@/lib/project-statuses";
import { createPresignedDownloadUrl } from "@/lib/storage/s3";
import { STAGE_FIVE_FIELD_LABELS } from "@/lib/stage-five-fields";
import {
  getNextReminderAt,
  isRequestReminderInterval,
  type RequestReminderIntervalHours,
} from "@/lib/request-reminder-shared";

export {
  formatRequestReminderInterval,
  getNextReminderAt,
  isRequestReminderInterval,
  REQUEST_REMINDER_INTERVAL_HOURS,
  type RequestReminderIntervalHours,
} from "@/lib/request-reminder-shared";

export type RequestReminderConfiguration = {
  enabled: boolean;
  intervalHours: RequestReminderIntervalHours;
  nextReminderAt: string | null;
  lastReminderAt: string | null;
};

type ReminderTarget =
  | { stageFiveRequestId: string; stageSevenSampleRoundId?: never }
  | { stageFiveRequestId?: never; stageSevenSampleRoundId: string };

type EmailSender = typeof sendResendEmail;

const TERMINAL_PROJECT_STATUS_GROUPS = new Set<string>([
  defaultProjectStatusGroupSlugs.completed,
  defaultProjectStatusGroupSlugs.archived,
  defaultProjectStatusGroupSlugs.cancelled,
]);
const PROCESSING_LEASE_MINUTES = 15;
const DEFAULT_BATCH_SIZE = 50;

export function mapRequestReminder(
  reminder:
    | {
        enabled: boolean;
        intervalHours: number;
        nextReminderAt: Date | null;
        lastReminderAt: Date | null;
      }
    | null
    | undefined,
): RequestReminderConfiguration | null {
  if (!reminder || !isRequestReminderInterval(reminder.intervalHours)) return null;
  return {
    enabled: reminder.enabled,
    intervalHours: reminder.intervalHours,
    nextReminderAt: reminder.nextReminderAt?.toISOString() ?? null,
    lastReminderAt: reminder.lastReminderAt?.toISOString() ?? null,
  };
}

export function buildRequestReminderCreateData(input: {
  projectId: string;
  configuredById: string;
  intervalHours?: number | null;
  now: Date;
}) {
  if (!isRequestReminderInterval(input.intervalHours)) return undefined;
  return {
    projectId: input.projectId,
    configuredById: input.configuredById,
    enabled: true,
    intervalHours: input.intervalHours,
    nextReminderAt: getNextReminderAt(input.now, input.intervalHours),
  } satisfies Prisma.RequestReminderUncheckedCreateWithoutStageFiveRequestInput;
}

function reminderTargetWhere(target: ReminderTarget): Prisma.RequestReminderWhereInput {
  return "stageFiveRequestId" in target
    ? { stageFiveRequestId: target.stageFiveRequestId }
    : { stageSevenSampleRoundId: target.stageSevenSampleRoundId };
}

export async function setRequestReminder(input: {
  projectId: string;
  configuredById: string;
  target: ReminderTarget;
  intervalHours: RequestReminderIntervalHours;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nextReminderAt = getNextReminderAt(now, input.intervalHours);
  const where = reminderTargetWhere(input.target);
  const existing = await withPrismaRetry(() =>
    prisma.requestReminder.findFirst({ where, select: { id: true } }),
  );
  const reminder = existing
    ? await withPrismaRetry(() =>
        prisma.requestReminder.update({
          where: { id: existing.id },
          data: {
            enabled: true,
            intervalHours: input.intervalHours,
            nextReminderAt,
            stoppedAt: null,
            configuredById: input.configuredById,
            processingToken: null,
            processingStartedAt: null,
            lastError: null,
          },
          select: {
            enabled: true,
            intervalHours: true,
            nextReminderAt: true,
            lastReminderAt: true,
          },
        }),
      )
    : await withPrismaRetry(() =>
        prisma.requestReminder.create({
          data: {
            projectId: input.projectId,
            configuredById: input.configuredById,
            ...input.target,
            enabled: true,
            intervalHours: input.intervalHours,
            nextReminderAt,
          },
          select: {
            enabled: true,
            intervalHours: true,
            nextReminderAt: true,
            lastReminderAt: true,
          },
        }),
      );
  return mapRequestReminder(reminder)!;
}

export async function stopRequestReminder(target: ReminderTarget, now = new Date()) {
  const result = await withPrismaRetry(() =>
    prisma.requestReminder.updateMany({
      where: { ...reminderTargetWhere(target), enabled: true },
      data: {
        enabled: false,
        nextReminderAt: null,
        stoppedAt: now,
        processingToken: null,
        processingStartedAt: null,
      },
    }),
  );
  return { stopped: result.count > 0 };
}

export async function disableProjectRequestReminders(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    stage: "FIVE" | "SEVEN";
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return tx.requestReminder.updateMany({
    where: {
      projectId: input.projectId,
      enabled: true,
      ...(input.stage === "FIVE"
        ? { stageFiveRequestId: { not: null } }
        : { stageSevenSampleRoundId: { not: null } }),
    },
    data: {
      enabled: false,
      nextReminderAt: null,
      stoppedAt: now,
      processingToken: null,
      processingStartedAt: null,
    },
  });
}

function isProjectStillValid(project: {
  completedAt: Date | null;
  archivedAt: Date | null;
  status: { group: { slug: string } | null } | null;
}) {
  return (
    !project.completedAt &&
    !project.archivedAt &&
    !TERMINAL_PROJECT_STATUS_GROUPS.has(project.status?.group?.slug ?? "")
  );
}

function isCurrentParticipant(
  project: {
    ownerId: string | null;
    coOwners: Array<{ userId: string }>;
    executors: Array<{ userId: string }>;
    collaborators: Array<{ userId: string }>;
  },
  userId: string,
) {
  return (
    project.ownerId === userId ||
    project.coOwners.some((item) => item.userId === userId) ||
    project.executors.some((item) => item.userId === userId) ||
    project.collaborators.some((item) => item.userId === userId)
  );
}

async function recoverExpiredClaims(now: Date) {
  const cutoff = new Date(now.getTime() - PROCESSING_LEASE_MINUTES * 60 * 1_000);
  const stale = await withPrismaRetry(() =>
    prisma.requestReminder.findMany({
      where: {
        processingToken: { not: null },
        processingStartedAt: { lt: cutoff },
      },
      select: { id: true, intervalHours: true, processingToken: true },
      take: DEFAULT_BATCH_SIZE,
    }),
  );
  for (const reminder of stale) {
    if (!isRequestReminderInterval(reminder.intervalHours)) continue;
    const intervalHours = reminder.intervalHours;
    await withPrismaRetry(() =>
      prisma.$transaction([
        prisma.requestReminderDeliveryAttempt.updateMany({
          where: {
            reminderId: reminder.id,
            status: RequestReminderDeliveryStatus.PROCESSING,
          },
          data: {
            status: RequestReminderDeliveryStatus.FAILED,
            error: "Processing lease expired; this delivery was not replayed to avoid duplicates.",
            finishedAt: now,
          },
        }),
        prisma.requestReminder.updateMany({
          where: {
            id: reminder.id,
            processingToken: reminder.processingToken,
            processingStartedAt: { lt: cutoff },
          },
          data: {
            processingToken: null,
            processingStartedAt: null,
            lastAttemptAt: now,
            lastError:
              "Processing lease expired; this delivery was not replayed to avoid duplicates.",
            nextReminderAt: getNextReminderAt(now, intervalHours),
          },
        }),
      ]),
    );
  }
  return stale.length;
}

async function claimReminder(reminderId: string, now: Date) {
  const processingToken = randomUUID();
  return withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.requestReminder.updateMany({
        where: {
          id: reminderId,
          enabled: true,
          nextReminderAt: { lte: now },
          processingToken: null,
        },
        data: { processingToken, processingStartedAt: now },
      });
      if (!claimed.count) return null;
      const reminder = await tx.requestReminder.findUniqueOrThrow({
        where: { id: reminderId },
        select: {
          id: true,
          projectId: true,
          stageFiveRequestId: true,
          stageSevenSampleRoundId: true,
          intervalHours: true,
          nextReminderAt: true,
        },
      });
      if (!reminder.nextReminderAt || !isRequestReminderInterval(reminder.intervalHours)) {
        await tx.requestReminder.update({
          where: { id: reminder.id },
          data: {
            enabled: false,
            nextReminderAt: null,
            processingToken: null,
            processingStartedAt: null,
            stoppedAt: now,
            lastError: "Reminder configuration was invalid.",
          },
        });
        return null;
      }
      const intervalHours = reminder.intervalHours;
      const priorAttempt = await tx.requestReminderDeliveryAttempt.findUnique({
        where: {
          reminderId_scheduledFor: {
            reminderId: reminder.id,
            scheduledFor: reminder.nextReminderAt,
          },
        },
        select: { id: true },
      });
      if (priorAttempt) {
        await tx.requestReminder.update({
          where: { id: reminder.id },
          data: {
            processingToken: null,
            processingStartedAt: null,
            nextReminderAt: getNextReminderAt(now, intervalHours),
            lastError: "A prior attempt already owns this reminder window.",
          },
        });
        return null;
      }
      const attempt = await tx.requestReminderDeliveryAttempt.create({
        data: {
          reminderId: reminder.id,
          scheduledFor: reminder.nextReminderAt,
          channelSummary: "PENDING",
          status: RequestReminderDeliveryStatus.PROCESSING,
          startedAt: now,
        },
        select: { id: true },
      });
      return {
        reminderId: reminder.id,
        projectId: reminder.projectId,
        stageFiveRequestId: reminder.stageFiveRequestId,
        stageSevenSampleRoundId: reminder.stageSevenSampleRoundId,
        intervalHours,
        nextReminderAt: reminder.nextReminderAt,
        processingToken,
        attemptId: attempt.id,
      };
    }),
  );
}

async function finishAttempt(input: {
  reminderId: string;
  attemptId: string;
  processingToken: string;
  intervalHours: RequestReminderIntervalHours;
  now: Date;
  status: RequestReminderDeliveryStatus;
  channelSummary: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  providerMessageId?: string | null;
  error?: string | null;
  disable?: boolean;
}) {
  await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.requestReminderDeliveryAttempt.updateMany({
        where: { id: input.attemptId },
        data: {
          status: input.status,
          channelSummary: input.channelSummary,
          recipientUserId: input.recipientUserId ?? null,
          recipientEmail: input.recipientEmail ?? null,
          providerMessageId: input.providerMessageId ?? null,
          error: input.error?.slice(0, 5_000) ?? null,
          finishedAt: input.now,
        },
      }),
      prisma.requestReminder.updateMany({
        where: { id: input.reminderId, processingToken: input.processingToken },
        data: input.disable
          ? {
              enabled: false,
              nextReminderAt: null,
              stoppedAt: input.now,
              processingToken: null,
              processingStartedAt: null,
              lastAttemptAt: input.now,
              lastError: input.error?.slice(0, 5_000) ?? null,
            }
          : {
              nextReminderAt: getNextReminderAt(input.now, input.intervalHours),
              lastReminderAt:
                input.status === RequestReminderDeliveryStatus.SENT
                  ? input.now
                  : undefined,
              lastAttemptAt: input.now,
              lastError: input.error?.slice(0, 5_000) ?? null,
              processingToken: null,
              processingStartedAt: null,
            },
      }),
    ]),
  );
}

function sampleTypeLabel(type: string, customTypeName: string | null) {
  if (type === "CUSTOM") return customTypeName || "Custom";
  if (type === "FINAL_MASS_PRODUCTION_SIGN_OFF") {
    return "Final Mass-Production Sample";
  }
  return type
    .toLocaleLowerCase("en-US")
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase("en-US") + part.slice(1))
    .join(" ");
}

function outputName(value: Prisma.JsonValue | null | undefined) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const text = (value as Record<string, Prisma.JsonValue>).text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

async function revalidateStageSevenDelivery(input: {
  reminderId: string;
  processingToken: string;
  roundId: string;
  projectId: string;
}) {
  const [reminder, round] = await withPrismaRetry(() =>
    prisma.$transaction([
      prisma.requestReminder.findFirst({
        where: {
          id: input.reminderId,
          enabled: true,
          processingToken: input.processingToken,
        },
        select: { id: true },
      }),
      prisma.productionSampleRound.findFirst({
        where: {
          id: input.roundId,
          projectId: input.projectId,
          decision: null,
          status: { not: ProductionSampleRoundStatus.COMPLETED },
          supervision: { status: { not: ProductionSupervisionStatus.SIGNED_OFF } },
          project: {
            completedAt: null,
            archivedAt: null,
            workflowStages: {
              some: {
                stageKey:
                  ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
                status: ProjectWorkflowStageStatus.AVAILABLE,
              },
            },
          },
        },
        select: {
          id: true,
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
    ]),
  );
  return Boolean(
    reminder && round && round.supervision.sampleRounds[0]?.id === round.id,
  );
}

async function processStageFiveReminder(
  claim: NonNullable<Awaited<ReturnType<typeof claimReminder>>>,
  now: Date,
  sendEmail: EmailSender,
) {
  const request = claim.stageFiveRequestId
    ? await withPrismaRetry(() =>
        prisma.projectFileChecklistRequest.findUnique({
          where: { id: claim.stageFiveRequestId! },
          include: {
            project: {
              select: {
                name: true,
                ownerId: true,
                completedAt: true,
                archivedAt: true,
                status: { select: { group: { select: { slug: true } } } },
                coOwners: { select: { userId: true } },
                executors: { select: { userId: true } },
                collaborators: { select: { userId: true } },
                workflowStages: {
                  where: { stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT },
                  select: { status: true },
                },
              },
            },
            requestedBy: { select: { name: true, email: true } },
            recipientUser: { select: { name: true, email: true } },
            checklist: {
              select: {
                handoffId: true,
                sourceAttachment: {
                  select: { id: true, originalFileName: true },
                },
              },
            },
            checklistItem: { select: { status: true } },
          },
        }),
      )
    : null;
  const active = Boolean(
    request &&
      request.projectId === claim.projectId &&
      request.status === ProjectFileChecklistRequestStatus.SENT &&
      (request.workflowStatus ===
        ProjectFileChecklistRequestWorkflowStatus.REQUESTED ||
        request.workflowStatus ===
          ProjectFileChecklistRequestWorkflowStatus.ACCEPTED) &&
      request.checklistItem.status !== ProjectFileChecklistItemStatus.FILLED &&
      isProjectStillValid(request.project) &&
      request.project.workflowStages[0]?.status ===
        ProjectWorkflowStageStatus.AVAILABLE &&
      (!request.recipientUserId ||
        isCurrentParticipant(request.project, request.recipientUserId)),
  );
  if (!request || !active) {
    await finishAttempt({
      ...claim,
      now,
      status: RequestReminderDeliveryStatus.SKIPPED,
      channelSummary: "NONE",
      error: "The Stage 5 request is no longer eligible for reminders.",
      disable: true,
    });
    return { status: "skipped" as const };
  }

  if (request.recipientUserId) {
    const dedupeKey = `request-reminder:${claim.attemptId}`;
    const notification = await withPrismaRetry(() =>
      prisma.$transaction(async (tx) => {
        const stillActive = await tx.projectFileChecklistRequest.count({
          where: {
            id: request.id,
            status: ProjectFileChecklistRequestStatus.SENT,
            workflowStatus: {
              in: [
                ProjectFileChecklistRequestWorkflowStatus.REQUESTED,
                ProjectFileChecklistRequestWorkflowStatus.ACCEPTED,
              ],
            },
            checklistItem: {
              status: { not: ProjectFileChecklistItemStatus.FILLED },
            },
          },
        });
        if (!stillActive) return null;
        return tx.notification.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            userId: request.recipientUserId!,
            type: NotificationType.CHECKLIST_INFORMATION_REQUESTED,
            title: "Reminder: information requested",
            message: `“${STAGE_FIVE_FIELD_LABELS[request.fieldKey]}” is still needed for “${request.checklist.sourceAttachment.originalFileName}”.`,
            entityType: NotificationEntityType.CHECKLIST_REQUEST,
            entityId: request.id,
            projectId: request.projectId,
            attachmentId: request.checklist.sourceAttachment.id,
            url: `/requests/checklist/${request.id}`,
            dedupeKey,
          },
          select: { id: true },
        });
      }),
    );
    if (!notification) {
      await finishAttempt({
        ...claim,
        now,
        status: RequestReminderDeliveryStatus.SKIPPED,
        channelSummary: "NONE",
        error: "The Stage 5 request was resolved before delivery.",
        disable: true,
      });
      return { status: "skipped" as const };
    }
    await finishAttempt({
      ...claim,
      now,
      status: RequestReminderDeliveryStatus.SENT,
      channelSummary: "IN_APP",
      recipientUserId: request.recipientUserId,
    });
    await publishNotificationChanges({
      recipientUserIds: [request.recipientUserId],
      reason: "created",
    });
    return { status: "sent" as const };
  }

  if (!request.recipientEmail) {
    await finishAttempt({
      ...claim,
      now,
      status: RequestReminderDeliveryStatus.SKIPPED,
      channelSummary: "NONE",
      error: "The Stage 5 request has no recipient.",
      disable: true,
    });
    return { status: "skipped" as const };
  }
  const access = createExternalChecklistToken(now);
  const prepared = await withPrismaRetry(() =>
    prisma.projectFileChecklistRequest.updateMany({
      where: {
        id: request.id,
        status: ProjectFileChecklistRequestStatus.SENT,
        workflowStatus: {
          in: [
            ProjectFileChecklistRequestWorkflowStatus.REQUESTED,
            ProjectFileChecklistRequestWorkflowStatus.ACCEPTED,
          ],
        },
        checklistItem: { status: { not: ProjectFileChecklistItemStatus.FILLED } },
      },
      data: {
        externalTokenHash: access.tokenHash,
        externalTokenCreatedAt: access.createdAt,
        externalTokenExpiresAt: access.expiresAt,
        externalTokenRevokedAt: null,
      },
    }),
  );
  if (!prepared.count) {
    await finishAttempt({
      ...claim,
      now,
      status: RequestReminderDeliveryStatus.SKIPPED,
      channelSummary: "NONE",
      error: "The Stage 5 request was resolved before delivery.",
      disable: true,
    });
    return { status: "skipped" as const };
  }
  const email = buildChecklistInformationReminderEmail({
    recipientName: request.recipientName,
    requesterName:
      request.requestedBy.name?.trim() || request.requestedBy.email,
    projectName: request.project.name,
    fileName: request.checklist.sourceAttachment.originalFileName,
    fieldLabel: STAGE_FIVE_FIELD_LABELS[request.fieldKey],
    message: request.message,
    responseUrl: buildExternalChecklistRequestUrl(access.token),
  });
  let result: Awaited<ReturnType<EmailSender>>;
  try {
    result = await sendEmail({
      to: request.recipientEmail,
      ...email,
      replyTo: request.requestedBy.email,
      idempotencyKey: `request-reminder-${claim.attemptId}`,
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "Email delivery failed.",
    };
  }
  await finishAttempt({
    ...claim,
    now,
    status: result.ok
      ? RequestReminderDeliveryStatus.SENT
      : RequestReminderDeliveryStatus.FAILED,
    channelSummary: "EMAIL",
    recipientEmail: request.recipientEmail,
    providerMessageId: result.ok ? result.id : null,
    error: result.ok ? null : result.error,
  });
  return { status: result.ok ? ("sent" as const) : ("failed" as const) };
}

async function processStageSevenReminder(
  claim: NonNullable<Awaited<ReturnType<typeof claimReminder>>>,
  now: Date,
  sendEmail: EmailSender,
) {
  const round = claim.stageSevenSampleRoundId
    ? await withPrismaRetry(() =>
        prisma.productionSampleRound.findUnique({
          where: { id: claim.stageSevenSampleRoundId! },
          include: {
            recipientUser: { select: { name: true, email: true } },
            project: {
              select: {
                name: true,
                ownerId: true,
                completedAt: true,
                archivedAt: true,
                status: { select: { group: { select: { slug: true } } } },
                coOwners: { select: { userId: true } },
                executors: { select: { userId: true } },
                collaborators: { select: { userId: true } },
                workflowStages: {
                  where: {
                    stageKey:
                      ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
                  },
                  select: { status: true },
                },
              },
            },
            supervision: {
              include: {
                sampleRounds: {
                  orderBy: [{ sequence: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { id: true },
                },
                productionUnit: {
                  include: {
                    sourceAttachment: true,
                    files: { include: { attachment: true } },
                    sourceChecklist: {
                      select: {
                        items: {
                          where: {
                            fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
                          },
                          select: { value: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      )
    : null;
  const active = Boolean(
    round &&
      round.projectId === claim.projectId &&
      !round.decision &&
      round.status !== ProductionSampleRoundStatus.COMPLETED &&
      round.supervision.status !== ProductionSupervisionStatus.SIGNED_OFF &&
      round.supervision.sampleRounds[0]?.id === round.id &&
      isProjectStillValid(round.project) &&
      round.project.workflowStages[0]?.status ===
        ProjectWorkflowStageStatus.AVAILABLE &&
      Boolean(round.recipientEmail) &&
      (!round.recipientUserId ||
        isCurrentParticipant(round.project, round.recipientUserId)),
  );
  if (!round || !active || !round.recipientEmail) {
    await finishAttempt({
      ...claim,
      now,
      status: RequestReminderDeliveryStatus.SKIPPED,
      channelSummary: "NONE",
      error: "The Stage 7 sample round is no longer eligible for reminders.",
      disable: true,
    });
    return { status: "skipped" as const };
  }

  const unit = round.supervision.productionUnit;
  const availableFiles = [
    unit.sourceAttachment,
    ...unit.files.map((file) => file.attachment),
  ];
  const referenceById = new Map(availableFiles.map((file) => [file.id, file]));
  const referenceFiles = await Promise.all(
    round.requestReferenceFileIds.flatMap((id) => {
      const file = referenceById.get(id);
      return file ? [file] : [];
    }).map(async (file) => ({
      name: file.originalFileName,
      url: await createPresignedDownloadUrl({
        bucket: file.bucket,
        storageKey: file.storageKey,
        fileName: file.originalFileName,
        expiresInSeconds: 60 * 60 * 24 * 7,
      }),
    })),
  );
  const unitName =
    outputName(unit.sourceChecklist.items[0]?.value) ||
    unit.sourceAttachment.originalFileName;
  const email = buildPhysicalSampleReminderEmail({
    recipientName:
      round.recipientName?.trim() ||
      round.recipientUser?.name?.trim() ||
      "there",
    projectName: round.project.name,
    unitName,
    roundName: round.name,
    sampleType: sampleTypeLabel(round.type, round.customTypeName),
    deadline: new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(round.deadline),
    message: round.requestNote,
    referenceFiles,
    actionUrl: round.recipientUserId
      ? `${getApplicationUrl()}/tasks/samples/${round.id}`
      : referenceFiles[0]?.url ?? getApplicationUrl(),
    actionLabel: round.recipientUserId
      ? "Open Sample Request"
      : "Download Reference File",
  });
  let notificationDelivered = false;
  if (
    !(await revalidateStageSevenDelivery({
      reminderId: claim.reminderId,
      processingToken: claim.processingToken,
      roundId: round.id,
      projectId: round.projectId,
    }))
  ) {
    await finishAttempt({
      ...claim,
      now,
      status: RequestReminderDeliveryStatus.SKIPPED,
      channelSummary: "NONE",
      error: "The Stage 7 sample round changed before delivery.",
      disable: true,
    });
    return { status: "skipped" as const };
  }
  let result: Awaited<ReturnType<EmailSender>>;
  try {
    result = await sendEmail({
      to: round.recipientEmail,
      ...email,
      idempotencyKey: `request-reminder-${claim.attemptId}`,
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "Email delivery failed.",
    };
  }

  if (
    round.recipientUserId &&
    (await revalidateStageSevenDelivery({
      reminderId: claim.reminderId,
      processingToken: claim.processingToken,
      roundId: round.id,
      projectId: round.projectId,
    }))
  ) {
    const dedupeKey = `request-reminder:${claim.attemptId}`;
    await withPrismaRetry(() =>
      prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          userId: round.recipientUserId!,
          type: NotificationType.PRODUCTION_SAMPLE_REQUESTED,
          title: "Reminder: physical sample requested",
          message: `${round.name} for ${unitName} in ${round.project.name} is still awaiting completion.`,
          entityType: NotificationEntityType.SAMPLE_ROUND,
          entityId: round.id,
          projectId: round.projectId,
          url: `/tasks/samples/${round.id}`,
          dedupeKey,
        },
      }),
    );
    await publishNotificationChanges({
      recipientUserIds: [round.recipientUserId],
      reason: "created",
    });
    notificationDelivered = true;
  }
  await finishAttempt({
    ...claim,
    now,
    status: result.ok
      ? RequestReminderDeliveryStatus.SENT
      : RequestReminderDeliveryStatus.FAILED,
    channelSummary: notificationDelivered ? "EMAIL+IN_APP" : "EMAIL",
    recipientUserId: round.recipientUserId,
    recipientEmail: round.recipientEmail,
    providerMessageId: result.ok ? result.id : null,
    error: result.ok ? null : result.error,
  });
  return { status: result.ok ? ("sent" as const) : ("failed" as const) };
}

export async function processDueRequestReminders(
  now = new Date(),
  options: { sendEmail?: EmailSender; batchSize?: number } = {},
) {
  const recoveredClaims = await recoverExpiredClaims(now);
  const candidates = await withPrismaRetry(() =>
    prisma.requestReminder.findMany({
      where: {
        enabled: true,
        nextReminderAt: { lte: now },
        processingToken: null,
      },
      orderBy: [{ nextReminderAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1), 200),
      select: { id: true },
    }),
  );
  const summary = {
    recoveredClaims,
    scanned: candidates.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of candidates) {
    const claim = await claimReminder(candidate.id, now);
    if (!claim) continue;
    summary.claimed += 1;
    try {
      const result = claim.stageFiveRequestId
        ? await processStageFiveReminder(
            claim,
            now,
            options.sendEmail ?? sendResendEmail,
          )
        : await processStageSevenReminder(
            claim,
            now,
            options.sendEmail ?? sendResendEmail,
          );
      summary[result.status] += 1;
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unexpected reminder delivery failure.";
      console.error("[request-reminders] reminder delivery failed", {
        reminderId: claim.reminderId,
        attemptId: claim.attemptId,
        error: message,
      });
      await finishAttempt({
        ...claim,
        now,
        status: RequestReminderDeliveryStatus.FAILED,
        channelSummary: "ERROR",
        error: message,
      });
      summary.failed += 1;
    }
  }
  return summary;
}

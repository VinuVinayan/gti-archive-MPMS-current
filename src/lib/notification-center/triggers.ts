import {
  AttachmentAssetType,
  ProjectWorkflowStageKey,
} from "@prisma/client";
import { after } from "next/server";

import { getProjectConceptAccessContext } from "@/lib/project-concept-access";
import { prisma, withPrismaRetry } from "@/lib/prisma";

import {
  getCompletionWorkflowRecipientUserIds,
  dedupeRecipients,
  filterRecipientsVisibleForStageEvent,
  getProjectExecutorRecipientUserIds,
  getProjectNotificationContext,
  getProjectParticipantUserIds,
  getVisibleStageEventRecipientUserIds,
} from "./recipients";
import {
  buildNotificationUrl,
  buildProjectAssignmentNotificationUrl,
  createNotificationsForUsers,
} from "./service";

type ActorInput = {
  actorId: string;
  actorName: string;
};

async function getProjectStageContext(projectId: string, stageId?: string | null) {
  return withPrismaRetry(() =>
    prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        coOwners: {
          select: { userId: true },
        },
        executors: {
          select: {
            userId: true,
          },
        },
        stages: stageId
          ? {
              where: {
                id: stageId,
              },
              select: {
                id: true,
                name: true,
              },
            }
          : false,
      },
    }),
  );
}

async function buildProjectStageNotificationUrl(
  projectId: string,
  stageId: string,
) {
  const concept = await getProjectConceptAccessContext({
    projectId,
    taskerStageId: stageId,
  });

  if (!concept) {
    return buildNotificationUrl({
      kind: "project-stage",
      projectId,
      stageId,
    });
  }

  const stageNumber =
    concept.workflowStageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
      ? 3
      : 4;

  return `/projects/${encodeURIComponent(projectId)}/stages/${stageNumber}/concepts/${encodeURIComponent(concept.folderId)}`;
}

export async function runNotificationTask(
  label: string,
  task: () => Promise<void>,
) {
  try {
    await task();
  } catch (error) {
    console.error(`[notifications] ${label} failed`, error);
  }
}

export function runNotificationTaskAfterResponse(
  label: string,
  task: () => Promise<void>,
) {
  after(() => runNotificationTask(label, task));
}

export async function notifyConceptTaskCompletion(input: {
  projectId: string; folderId: string; actorId: string; event: "requested" | "completed";
}) {
  const folder = await withPrismaRetry(() => prisma.projectConceptFolder.findFirst({
    where: { id: input.folderId, projectId: input.projectId, workflowStageKey: { in: ["CONCEPT_CREATION", "PROJECT_DEVELOPMENT"] } },
    select: {
      id: true, name: true, workflowStageKey: true, taskerStageId: true, assignedExecutorId: true,
      completionRequestedAt: true, completedWithoutFileAt: true,
      assignedExecutor: { select: { user: { select: { name: true, email: true } } } },
      project: { select: { name: true, ownerId: true } },
    },
  }));
  if (!folder) return;
  const requested = input.event === "requested";
  if (requested ? !folder.completionRequestedAt : !folder.completedWithoutFileAt) return;
  const recipientId = requested ? folder.project.ownerId : folder.assignedExecutorId;
  if (!recipientId || recipientId === input.actorId) return;
  const executor = folder.assignedExecutor?.user;
  await createNotificationsForUsers({
    recipientUserIds: [recipientId],
    type: requested ? "APPROVAL_REQUIRED" : "STAGE_COMPLETED",
    title: requested ? "Task completion requested" : "Task completed",
    message: requested
      ? `${executor?.name?.trim() || executor?.email || "The assigned executor"} requested completion of ${folder.name} in ${folder.project.name}. Review the work and mark the task completed.`
      : `${folder.name} in ${folder.project.name} has been completed without a file submission.`,
    entityType: "STAGE", entityId: folder.taskerStageId,
    projectId: input.projectId, stageId: folder.taskerStageId,
    url: `/projects/${encodeURIComponent(input.projectId)}/stages/${folder.workflowStageKey === "CONCEPT_CREATION" ? 3 : 4}/concepts/${encodeURIComponent(folder.id)}`,
  });
}

export async function notifyConceptFileApproved(input: {
  projectId: string;
  folderId: string;
  attachmentId: string;
  actorId: string;
}) {
  const folder = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        approvedAttachmentId: input.attachmentId,
      },
      select: {
        id: true,
        name: true,
        taskerStageId: true,
        assignedExecutorId: true,
        approvedAttachment: {
          select: { id: true, originalFileName: true },
        },
      },
    }),
  );

  if (
    !folder?.assignedExecutorId ||
    folder.assignedExecutorId === input.actorId ||
    !folder.approvedAttachment
  ) {
    return;
  }

  await createNotificationsForUsers({
    recipientUserIds: [folder.assignedExecutorId],
    type: "REVISION_APPROVED",
    title: "Concept file approved",
    message: `Your concept file ${folder.approvedAttachment.originalFileName} for ${folder.name} has been approved.`,
    entityType: "ATTACHMENT",
    entityId: folder.approvedAttachment.id,
    projectId: input.projectId,
    stageId: folder.taskerStageId,
    attachmentId: folder.approvedAttachment.id,
    url: `/projects/${encodeURIComponent(input.projectId)}/stages/3/concepts/${encodeURIComponent(folder.id)}`,
  });
}

export async function notifyStageFourFinalFileApproved(input: {
  projectId: string;
  folderId: string;
  attachmentId: string;
  actorId: string;
}) {
  const folder = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
        workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        approvedAttachmentId: input.attachmentId,
      },
      select: {
        id: true,
        name: true,
        taskerStageId: true,
        assignedExecutorId: true,
        approvedAttachment: {
          select: { id: true, originalFileName: true },
        },
      },
    }),
  );

  if (
    !folder?.assignedExecutorId ||
    folder.assignedExecutorId === input.actorId ||
    !folder.approvedAttachment
  ) {
    return;
  }

  await createNotificationsForUsers({
    recipientUserIds: [folder.assignedExecutorId],
    type: "REVISION_APPROVED",
    title: "Final concept file approved",
    message: `Your final concept file ${folder.approvedAttachment.originalFileName} for ${folder.name} has been approved.`,
    entityType: "ATTACHMENT",
    entityId: folder.approvedAttachment.id,
    projectId: input.projectId,
    stageId: folder.taskerStageId,
    attachmentId: folder.approvedAttachment.id,
    url: `/projects/${encodeURIComponent(input.projectId)}/stages/4/concepts/${encodeURIComponent(folder.id)}`,
  });
}

export async function notifyStageFourConceptsActivated(input: {
  projectId: string;
  folderIds: string[];
  actorId: string;
}) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        coOwners: { select: { userId: true } },
        executors: { select: { userId: true } },
        conceptFolders: {
          where: {
            id: { in: input.folderIds },
            workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          },
          select: { assignedExecutorId: true },
        },
      },
    }),
  );

  if (!project) {
    return;
  }

  const recipientUserIds = dedupeRecipients([
    project.ownerId,
    ...project.coOwners.map((coOwner) => coOwner.userId),
    ...project.executors.map((executor) => executor.userId),
    ...project.conceptFolders.map((folder) => folder.assignedExecutorId),
  ]).filter((userId) => userId !== input.actorId);

  await createNotificationsForUsers({
    recipientUserIds,
    type: "NEXT_STAGE_ACTIVATED",
    title: "Stage 4 activated",
    message: `Stage 4 is ready in ${project.name}. Create final-concept taskers and optionally import an approved Stage 3 concept as a starting reference.`,
    entityType: "PROJECT",
    entityId: project.id,
    projectId: project.id,
    url: `/projects/${encodeURIComponent(project.id)}/stages/4`,
  });
}

export async function notifyStageFiveActivated(input: {
  projectId: string;
  finalFileCount: number;
  skippedStageFour?: boolean;
  actorId: string;
}) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        coOwners: { select: { userId: true } },
      },
    }),
  );

  if (!project) {
    return;
  }

  const recipientUserIds = dedupeRecipients([
    project.ownerId,
    ...project.coOwners.map((coOwner) => coOwner.userId),
  ]).filter((userId) => userId !== input.actorId);

  await createNotificationsForUsers({
    recipientUserIds,
    type: "NEXT_STAGE_ACTIVATED",
    title: "Stage 5 available",
    message: input.skippedStageFour
      ? input.finalFileCount > 0
        ? `Stage 4 was skipped in ${project.name}. ${input.finalFileCount} approved Stage 3 file${input.finalFileCount === 1 ? " is" : "s are"} ready for file checklists.`
        : `Stage 4 was skipped in ${project.name}. Upload the final file directly in Stage 5 to start its checklist.`
      : input.finalFileCount > 0
        ? `${input.finalFileCount} final approved file${input.finalFileCount === 1 ? " is" : "s are"} ready for file checklists in ${project.name}.`
        : `Stage 4 is complete in ${project.name}. Stage 5 is now available; a final file can be uploaded there.`,
    entityType: "PROJECT",
    entityId: project.id,
    projectId: project.id,
    url: `/projects/${encodeURIComponent(project.id)}/stages/5`,
  });
}

export async function notifyProjectCreated(input: {
  projectId: string;
  actorId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }
  const assignmentUrl = buildProjectAssignmentNotificationUrl({
    projectId: project.id,
    workflowStages: project.workflowStages,
  });

  const executorIds = getProjectExecutorRecipientUserIds(project).filter(
    (userId) => userId !== input.actorId,
  );

  if (executorIds.length > 0) {
    await createNotificationsForUsers({
      recipientUserIds: executorIds,
      type: "PROJECT_ASSIGNED",
      title: "Project assigned to you",
      message: `You have been assigned as executor for ${project.name}.`,
      entityType: "PROJECT",
      entityId: project.id,
      projectId: project.id,
      url: assignmentUrl,
    });
  }

  const collaboratorIds = project.collaborators
    .map((collaborator) => collaborator.userId)
    .filter(
      (userId) => userId !== input.actorId && !executorIds.includes(userId),
    );

  await createNotificationsForUsers({
    recipientUserIds: collaboratorIds,
    type: "COLLABORATOR_ADDED",
    title: "Added to project",
    message: `You have been added to ${project.name}.`,
    entityType: "PROJECT",
    entityId: project.id,
    projectId: project.id,
    url: assignmentUrl,
  });
}

export async function notifyProjectAssignmentChanges(input: {
  projectId: string;
  actorId: string;
  previousExecutorUserId?: string | null;
  nextExecutorUserId?: string | null;
  previousExecutorUserIds?: string[];
  nextExecutorUserIds?: string[];
  addedCollaboratorIds?: string[];
  removedCollaboratorIds?: string[];
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }
  const assignmentUrl = buildProjectAssignmentNotificationUrl({
    projectId: project.id,
    workflowStages: project.workflowStages,
  });

  const previousExecutorIds = new Set(
    dedupeRecipients([
      input.previousExecutorUserId,
      ...(input.previousExecutorUserIds ?? []),
    ]),
  );
  const nextExecutorIds = dedupeRecipients([
    input.nextExecutorUserId,
    ...(input.nextExecutorUserIds ?? []),
  ]);
  const addedExecutorIds = nextExecutorIds.filter(
    (executorId) => executorId !== input.actorId && !previousExecutorIds.has(executorId),
  );

  if (addedExecutorIds.length > 0) {
    await createNotificationsForUsers({
      recipientUserIds: addedExecutorIds,
      type: "PROJECT_ASSIGNED",
      title: "Project assigned to you",
      message: `You have been assigned as executor for ${project.name}.`,
      entityType: "PROJECT",
      entityId: project.id,
      projectId: project.id,
      url: assignmentUrl,
    });
  }

  const addedCollaboratorIds = (input.addedCollaboratorIds ?? []).filter(
    (userId) => userId !== input.actorId && !nextExecutorIds.includes(userId),
  );

  if (addedCollaboratorIds.length > 0) {
    await createNotificationsForUsers({
      recipientUserIds: addedCollaboratorIds,
      type: "COLLABORATOR_ADDED",
      title: "Added to project",
      message: `You have been added to ${project.name}.`,
      entityType: "PROJECT",
      entityId: project.id,
      projectId: project.id,
      url: assignmentUrl,
    });
  }

  if (
    (input.removedCollaboratorIds?.length ?? 0) > 0 &&
    project.ownerId !== input.actorId
  ) {
    await createNotificationsForUsers({
      recipientUserIds: dedupeRecipients([
        project.ownerId,
        ...project.coOwners.map((coOwner) => coOwner.userId),
      ]).filter((userId) => userId !== input.actorId),
      type: "COLLABORATOR_REMOVED",
      title: "Collaborator removed",
      message: `A collaborator was removed from ${project.name}.`,
      entityType: "PROJECT",
      entityId: project.id,
      projectId: project.id,
      url: buildNotificationUrl({
        kind: "project",
        projectId: project.id,
      }),
    });
  }
}

export async function notifyConceptBriefAssigned(input: {
  projectId: string;
  folderId: string;
  actorId: string;
}) {
  const folder = await withPrismaRetry(() =>
    prisma.projectConceptFolder.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        name: true,
        workflowStageKey: true,
        assignedExecutorId: true,
        taskerStage: {
          select: {
            id: true,
            actualStartedAt: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  );

  if (
    !folder?.assignedExecutorId ||
    folder.assignedExecutorId === input.actorId ||
    folder.taskerStage.actualStartedAt
  ) {
    return;
  }

  const stageNumber =
    folder.workflowStageKey === ProjectWorkflowStageKey.CONCEPT_CREATION ? 3 : 4;
  const url = `/projects/${encodeURIComponent(folder.project.id)}/stages/${stageNumber}/concepts/${encodeURIComponent(folder.id)}`;

  await createNotificationsForUsers({
    recipientUserIds: [folder.assignedExecutorId],
    type: "BRIEF_ACCEPTANCE_REQUIRED",
    title: "Concept brief ready",
    message: `You have been assigned to ${folder.name} in ${folder.project.name}. Review and accept the brief to begin work.`,
    entityType: "STAGE",
    entityId: folder.taskerStage.id,
    projectId: folder.project.id,
    stageId: folder.taskerStage.id,
    url,
  });
}

export async function notifyBriefAccepted(
  input: ActorInput & {
    projectId: string;
    stageId: string;
  },
) {
  const project = await getProjectStageContext(input.projectId, input.stageId);
  const stage = project?.stages?.[0];

  if (!project || !stage) {
    return;
  }

  await createNotificationsForUsers({
    recipientUserIds: dedupeRecipients([
      project.ownerId,
      ...project.coOwners.map((coOwner) => coOwner.userId),
    ]).filter((userId) => userId !== input.actorId),
    type: "BRIEF_ACCEPTED",
    title: "Brief accepted",
    message: `${input.actorName} accepted the brief and started work on ${stage.name}.`,
    entityType: "STAGE",
    entityId: stage.id,
    projectId: project.id,
    stageId: stage.id,
    url: await buildProjectStageNotificationUrl(project.id, stage.id),
  });
}

export async function notifyRevisionSubmitted(
  input: ActorInput & {
    projectId: string;
    stageId: string;
    revisionId: string;
  },
) {
  const revision = await withPrismaRetry(() =>
    prisma.projectRevision.findUnique({
      where: {
        id: input.revisionId,
      },
      select: {
        id: true,
        revisionNumber: true,
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
        project: {
          select: {
            id: true,
            ownerId: true,
            coOwners: {
              select: { userId: true },
            },
          },
        },
      },
    }),
  );

  if (!revision) {
    return;
  }

  await createNotificationsForUsers({
    recipientUserIds: dedupeRecipients([
      revision.project.ownerId,
      ...revision.project.coOwners.map((coOwner) => coOwner.userId),
    ]).filter((userId) => userId !== input.actorId),
    type: "REVISION_SUBMITTED",
    title: "Work submitted for review",
    message: `${input.actorName} submitted Revision ${revision.revisionNumber} for ${revision.stage.name}.`,
    entityType: "REVISION",
    entityId: revision.id,
    projectId: revision.project.id,
    stageId: revision.stage.id,
    revisionId: revision.id,
    url: await buildProjectStageNotificationUrl(
      revision.project.id,
      revision.stage.id,
    ),
  });
}

export async function notifyStageSubmissionReviewDecision(
  input: {
    attachmentId: string;
    status: "APPROVED" | "REJECTED";
  },
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: input.attachmentId,
      },
      select: {
        id: true,
        stageId: true,
        project: {
          select: {
            id: true,
            executors: {
              select: {
                userId: true,
              },
            },
          },
        },
        stage: {
          select: {
            name: true,
          },
        },
      },
    }),
  );

  if (!attachment?.stageId) {
    return;
  }

  const recipients = await getVisibleStageEventRecipientUserIds(
    attachment.project.id,
    new Date(),
    {
      includeOwner: false,
      includeCollaborators: false,
      stageId: attachment.stageId,
    },
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type:
      input.status === "APPROVED" ? "REVISION_APPROVED" : "REVISION_REJECTED",
    title:
      input.status === "APPROVED" ? "Revision approved" : "Revision rejected",
    message:
      input.status === "APPROVED"
        ? `Your latest submission for ${attachment.stage?.name ?? "this stage"} was approved.`
        : `Your latest submission for ${attachment.stage?.name ?? "this stage"} was rejected. Please review the feedback.`,
    entityType: "ATTACHMENT",
    entityId: attachment.id,
    projectId: attachment.project.id,
    stageId: attachment.stageId,
    attachmentId: attachment.id,
    url: await buildProjectStageNotificationUrl(
      attachment.project.id,
      attachment.stageId,
    ),
  });
}

export async function notifySubmissionWorkflowDecision(input: {
  projectId: string;
  stageId: string;
  status: "COMPLETED" | "REVISION_REQUESTED";
  actorId: string;
}) {
  const project = await getProjectStageContext(input.projectId, input.stageId);
  const stage = project?.stages?.[0];

  if (!project || !stage) {
    return;
  }

  const recipients = await getVisibleStageEventRecipientUserIds(
    project.id,
    new Date(),
    {
      excludeUserId: input.actorId,
      includeOwner: false,
      includeCollaborators: false,
      stageId: input.stageId,
    },
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type:
      input.status === "COMPLETED"
        ? "SUBMISSION_COMPLETED"
        : "SUBMISSION_REVISION_REQUESTED",
    title:
      input.status === "COMPLETED"
        ? "Submission approved"
        : "Revision requested",
    message:
      input.status === "COMPLETED"
        ? `Your submission for ${stage.name} was approved.`
        : `Changes were requested for ${stage.name}.`,
    entityType: "STAGE",
    entityId: stage.id,
    projectId: project.id,
    stageId: stage.id,
    url: await buildProjectStageNotificationUrl(project.id, stage.id),
  });
}

export async function notifyStageTransition(input: {
  projectId: string;
  completedStageId: string;
  nextStageId?: string | null;
  actorId: string;
}) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: {
        id: input.projectId,
      },
      select: {
        id: true,
        executors: {
          select: {
            userId: true,
          },
        },
        stages: {
          where: {
            id: {
              in: [input.completedStageId, input.nextStageId ?? ""].filter(Boolean),
            },
          },
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  );

  if (!project) {
    return;
  }

  const completedStage = project.stages.find(
    (stage) => stage.id === input.completedStageId,
  );

  if (!completedStage) {
    return;
  }

  const stageRecipients = await getVisibleStageEventRecipientUserIds(
    project.id,
    new Date(),
    {
      excludeUserId: input.actorId,
    },
  );

  await createNotificationsForUsers({
    recipientUserIds: stageRecipients,
    type: "STAGE_COMPLETED",
    title: "Stage completed",
    message: `${completedStage.name} has been completed.`,
    entityType: "STAGE",
    entityId: completedStage.id,
    projectId: project.id,
    stageId: completedStage.id,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });

  if (!input.nextStageId) {
    return;
  }

  const nextStage = project.stages.find((stage) => stage.id === input.nextStageId);

  if (!nextStage) {
    return;
  }

  const executorRecipients = getProjectExecutorRecipientUserIds(project, {
    excludeUserId: input.actorId,
  });
  const nextStageRecipients = await filterRecipientsVisibleForStageEvent(
    project.id,
    executorRecipients,
    new Date(),
  );

  await createNotificationsForUsers({
    recipientUserIds: nextStageRecipients,
    type: "NEXT_STAGE_ACTIVATED",
    title: "Next stage activated",
    message: `${nextStage.name} is now ready to start.`,
    entityType: "STAGE",
    entityId: nextStage.id,
    projectId: project.id,
    stageId: nextStage.id,
    url: await buildProjectStageNotificationUrl(project.id, nextStage.id),
  });
}

export async function notifyCommentAdded(
  input: ActorInput & {
    projectId: string;
    stageId: string;
    commentId: string;
    excludedRecipientUserIds?: string[];
  },
) {
  const project = await getProjectStageContext(input.projectId, input.stageId);
  const stage = project?.stages?.[0];

  if (!project || !stage) {
    return;
  }

  const comment = await withPrismaRetry(() =>
    prisma.projectComment.findUnique({
      where: {
        id: input.commentId,
      },
      select: {
        createdAt: true,
      },
    }),
  );

  if (!comment) {
    return;
  }

  const recipients = await getVisibleStageEventRecipientUserIds(
    project.id,
    comment.createdAt,
    {
      excludeUserId: input.actorId,
      stageId: input.stageId,
    },
  );
  const excludedRecipientUserIds = new Set(
    dedupeRecipients(input.excludedRecipientUserIds ?? []),
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients.filter(
      (recipientUserId) => !excludedRecipientUserIds.has(recipientUserId),
    ),
    type: "COMMENT_ADDED",
    title: "New comment",
    message: `${input.actorName} commented on ${stage.name}.`,
    entityType: "COMMENT",
    entityId: input.commentId,
    projectId: project.id,
    stageId: stage.id,
    commentId: input.commentId,
    url: await buildProjectStageNotificationUrl(project.id, stage.id),
  });
}

export async function notifyCommentMentioned(
  input: ActorInput & {
    projectId: string;
    stageId: string;
    commentId: string;
    mentionedUserIds: string[];
  },
) {
  const project = await getProjectStageContext(input.projectId, input.stageId);
  const stage = project?.stages?.[0];

  if (!project || !stage) {
    return;
  }

  const comment = await withPrismaRetry(() =>
    prisma.projectComment.findUnique({
      where: {
        id: input.commentId,
      },
      select: {
        createdAt: true,
      },
    }),
  );

  if (!comment) {
    return;
  }

  const mentionedRecipients = dedupeRecipients(input.mentionedUserIds).filter(
    (recipientUserId) => recipientUserId !== input.actorId,
  );
  const allowedRecipients = new Set(
    await getVisibleStageEventRecipientUserIds(project.id, comment.createdAt, {
      excludeUserId: input.actorId,
      stageId: input.stageId,
    }),
  );
  const recipients = mentionedRecipients.filter((recipientUserId) =>
    allowedRecipients.has(recipientUserId),
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "MENTION",
    title: "You were mentioned",
    message: `${input.actorName} mentioned you in ${project.name}.`,
    entityType: "COMMENT",
    entityId: input.commentId,
    projectId: project.id,
    stageId: stage.id,
    commentId: input.commentId,
    url: await buildProjectStageNotificationUrl(project.id, stage.id),
  });
}

export async function notifyFileUploaded(
  input: ActorInput & {
    projectId: string;
    stageId?: string | null;
    attachmentId: string;
    assetType: AttachmentAssetType;
  },
) {
  if (
    input.assetType !== "COMMENT_ATTACHMENT" &&
    input.assetType !== "GENERAL_PROJECT_ASSET"
  ) {
    return;
  }

  const project = await getProjectStageContext(input.projectId, input.stageId ?? null);
  const stage = project?.stages?.[0] ?? null;

  if (!project) {
    return;
  }

  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findUnique({
      where: {
        id: input.attachmentId,
      },
      select: {
        createdAt: true,
      },
    }),
  );

  if (!attachment) {
    return;
  }

  const recipients = await getVisibleStageEventRecipientUserIds(
    project.id,
    attachment.createdAt,
    {
      excludeUserId: input.actorId,
      stageId: input.stageId,
    },
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "FILE_UPLOADED",
    title: "File uploaded",
    message: input.stageId && stage
      ? `${input.actorName} uploaded a file in ${stage.name}.`
      : `${input.actorName} uploaded a project file.`,
    entityType: "ATTACHMENT",
    entityId: input.attachmentId,
    projectId: project.id,
    stageId: input.stageId ?? undefined,
    attachmentId: input.attachmentId,
    url: input.stageId
      ? await buildProjectStageNotificationUrl(project.id, input.stageId)
      : buildNotificationUrl({
          kind: "project",
          projectId: project.id,
        }),
  });
}

export async function notifyProjectArchived(input: {
  projectId: string;
  archiveId: string;
  actorId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  const archive = await withPrismaRetry(() =>
    prisma.projectArchive.findUnique({
      where: {
        id: input.archiveId,
      },
      select: {
        archivedAt: true,
      },
    }),
  );

  if (!archive) {
    return;
  }

  const baseRecipients = await getProjectParticipantUserIds(project.id, {
    excludeUserId: input.actorId,
  });
  const recipients = await filterRecipientsVisibleForStageEvent(
    project.id,
    baseRecipients,
    archive.archivedAt,
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "PROJECT_ARCHIVED",
    title: "Project archived",
    message: `${project.name} has been completed and archived.`,
    entityType: "ARCHIVE",
    entityId: input.archiveId,
    projectId: project.id,
    archiveId: input.archiveId,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });
}

export async function notifyApprovalRequired(input: {
  projectId: string;
  actorId: string;
  recipientUserId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  const executorRecipients = input.recipientUserId === input.actorId ? [] : [input.recipientUserId];
  const recipients = await filterRecipientsVisibleForStageEvent(
    project.id,
    executorRecipients,
    new Date(),
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "APPROVAL_REQUIRED",
    title: "Approval required",
    message: `Authority approval is required for ${project.name}.`,
    entityType: "COMPLETION_WORKFLOW",
    projectId: project.id,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });
}

export async function notifyApprovalProofUploaded(input: {
  projectId: string;
  actorId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  const baseRecipients = await getCompletionWorkflowRecipientUserIds(project.id, {
    excludeUserId: input.actorId,
  });
  const recipients = await filterRecipientsVisibleForStageEvent(
    project.id,
    baseRecipients,
    new Date(),
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "APPROVAL_PROOF_UPLOADED",
    title: "Approval proof uploaded",
    message: `Approval proof has been uploaded for ${project.name}.`,
    entityType: "COMPLETION_DOCUMENT",
    projectId: project.id,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });
}

export async function notifyCopyrightTransferRequired(input: {
  projectId: string;
  actorId: string;
  recipientUserId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  const executorRecipients = input.recipientUserId === input.actorId ? [] : [input.recipientUserId];
  const recipients = await filterRecipientsVisibleForStageEvent(
    project.id,
    executorRecipients,
    new Date(),
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "COPYRIGHT_TRANSFER_REQUIRED",
    title: "Copyright transfer required",
    message: `Copyright transfer is required for ${project.name}.`,
    entityType: "COMPLETION_WORKFLOW",
    projectId: project.id,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });
}

export async function notifyCopyrightDocumentUploaded(input: {
  projectId: string;
  actorId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  const baseRecipients = await getCompletionWorkflowRecipientUserIds(project.id, {
    excludeUserId: input.actorId,
  });
  const recipients = await filterRecipientsVisibleForStageEvent(
    project.id,
    baseRecipients,
    new Date(),
  );

  await createNotificationsForUsers({
    recipientUserIds: recipients,
    type: "COPYRIGHT_DOCUMENT_UPLOADED",
    title: "Copyright document uploaded",
    message: "Copyright transfer document has been uploaded.",
    entityType: "COMPLETION_DOCUMENT",
    projectId: project.id,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });
}

export async function notifyStageInvoiceRequested(input: {
  projectId: string;
  stageId: string;
  recipientUserId: string;
}) {
  const project = await getProjectStageContext(input.projectId, input.stageId);
  const stage = project?.stages?.[0];

  if (!project || !stage) {
    return;
  }

  await createNotificationsForUsers({
    recipientUserIds: [input.recipientUserId],
    type: "INVOICE_REQUESTED",
    title: "Invoice requested",
    message: `Invoice has been requested for ${project.name} / ${stage.name}.`,
    entityType: "STAGE",
    entityId: stage.id,
    projectId: project.id,
    stageId: stage.id,
    url: await buildProjectStageNotificationUrl(project.id, stage.id),
  });
}

export async function notifyFinalInvoiceRequested(input: {
  projectId: string;
  recipientUserId: string;
}) {
  const project = await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  await createNotificationsForUsers({
    recipientUserIds: [input.recipientUserId],
    type: "INVOICE_REQUESTED",
    title: "Final invoice requested",
    message: `Final invoice has been requested for ${project.name}.`,
    entityType: "COMPLETION_WORKFLOW",
    projectId: project.id,
    url: buildNotificationUrl({
      kind: "project",
      projectId: project.id,
    }),
  });
}

export async function notifyInvoiceUploaded(input: {
  projectId: string;
  actorId: string;
  actorName?: string;
  stageId?: string | null;
  attachmentId?: string;
}) {
  const project = input.stageId
    ? await getProjectStageContext(input.projectId, input.stageId)
    : await getProjectNotificationContext(input.projectId);

  if (!project) {
    return;
  }

  const stage = "stages" in project ? project.stages?.[0] ?? null : null;

  await createNotificationsForUsers({
    recipientUserIds: dedupeRecipients([
      project.ownerId,
      ...project.coOwners.map((coOwner) => coOwner.userId),
    ]).filter((userId) => userId !== input.actorId),
    type: "INVOICE_UPLOADED",
    title: "Invoice uploaded",
    message:
      input.stageId && stage
        ? `${input.actorName ?? "Executor"} uploaded invoice for ${stage.name}.`
        : `Invoice has been uploaded for ${project.name}.`,
    entityType: input.attachmentId ? "ATTACHMENT" : "COMPLETION_DOCUMENT",
    entityId: input.attachmentId,
    projectId: project.id,
    stageId: input.stageId ?? undefined,
    attachmentId: input.attachmentId,
    url:
      input.stageId && stage
        ? await buildProjectStageNotificationUrl(project.id, input.stageId)
        : buildNotificationUrl({
            kind: "project",
            projectId: project.id,
          }),
  });
}

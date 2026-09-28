import {
  ActivityLogAction, AttachmentAssetType, AttachmentStatus, Prisma,
  ProjectFileChecklistItemStatus, ProjectWorkflowStageKey, ProjectWorkflowStageStatus, StageStatus, UserRole,
} from "@prisma/client";

import { canCompleteProjectConceptStage } from "@/lib/project-concept-access";
import type { PermissionUser } from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { projectStageAccessSelect } from "@/lib/project-stage-data";
import { isProjectStatusCompleted } from "@/lib/project-statuses";
import { getProjectWorkflowSequenceState, PROJECT_WORKFLOW_STAGE_DEFINITIONS } from "@/lib/project-workflow";

type ConceptStageKey = "CONCEPT_CREATION" | "PROJECT_DEVELOPMENT";
type Input = { projectId: string; stageKey: ConceptStageKey };
type TaskInput = Input & { folderId: string; executorId?: string };
type ReopeningInput = Input & ({ kind: "skip" } | { kind: "task"; folderId: string; executorId?: string });

export type StageSkipRevocationEligibility = {
  visible: boolean;
  canRevoke: boolean;
  requiresExecutor: boolean;
  reason: string | null;
  emptyChecklistCount: number;
};

export type TaskCompletionRevocationEligibility = StageSkipRevocationEligibility & {
  reopensStage: boolean;
  executorOptions: Array<{ id: string; name: string }>;
};

// Both actions use the same checks for downstream work, inside the mutation transaction.
async function resolveConceptReopening(tx: Prisma.TransactionClient, user: PermissionUser, input: ReopeningInput) {
  const eligibility: TaskCompletionRevocationEligibility = {
    visible: false, canRevoke: false, requiresExecutor: false, reason: null, emptyChecklistCount: 0,
    reopensStage: false, executorOptions: [],
  };
  const deny = (reason: string, requiresExecutor = false) => ({
    eligibility: { ...eligibility, reason, requiresExecutor },
    resetStageIds: [] as string[], handoffIds: [] as string[], targetStageId: "",
    taskerStageId: "", assignedExecutorId: null as string | null, assignmentChanged: false,
  });
  if (input.stageKey !== "CONCEPT_CREATION" && input.stageKey !== "PROJECT_DEVELOPMENT") {
    return deny("Only Stage 3 or Stage 4 can be reopened.");
  }
  if (input.kind === "task" && (typeof input.folderId !== "string" || !input.folderId.trim())) {
    return deny("Choose the task whose completion should be revoked.");
  }
  const project = await tx.project.findUnique({
    where: { id: input.projectId },
    select: {
      ...projectStageAccessSelect,
      executors: { select: { userId: true, user: { select: { role: true, name: true, email: true } } } },
      conceptFolders: { select: { workflowStageKey: true, approvedAttachmentId: true } },
      _count: { select: { productionUnits: true, productionSupervisions: true, productionSampleRounds: true, archivedFiles: true, fileChecklists: true } },
      archive: { select: { id: true } },
    },
  });
  if (!project || !canCompleteProjectConceptStage(user, {
    projectId: input.projectId, folderId: "", taskerStageId: "", assignedExecutorId: null,
    workflowStageKey: input.stageKey, ownerId: project.ownerId,
    coOwnerIds: project.coOwners.map((entry) => entry.userId),
  })) return deny("Only the project owner or an administrator can reopen this work.");

  const target = project.workflowStages.find((stage) => stage.stageKey === input.stageKey);
  const task = input.kind === "task" ? await tx.projectConceptFolder.findFirst({
    where: { id: input.folderId, projectId: input.projectId, workflowStageKey: input.stageKey,
      taskerStage: { projectId: input.projectId, isTasker: true } },
    select: { id: true, taskerStageId: true, assignedExecutorId: true, approvedAttachmentId: true,
      completedWithoutFileAt: true, taskerStage: { select: { status: true } } },
  }) : null;
  if (input.kind === "skip") {
    if (target?.status !== ProjectWorkflowStageStatus.COMPLETED ||
        project.conceptFolders.some((folder) => folder.workflowStageKey === input.stageKey)) {
      return deny("This stage was not skipped, or has already been reopened.");
    }
  } else if (!task?.completedWithoutFileAt || task.taskerStage.status !== StageStatus.COMPLETED || task.approvedAttachmentId) {
    return deny("This task is not completed without a file, or has already been reopened.");
  }
  eligibility.visible = true;
  if (!target || (target.status !== ProjectWorkflowStageStatus.COMPLETED && target.status !== ProjectWorkflowStageStatus.AVAILABLE)) {
    return deny("This workflow stage is locked and cannot be reopened.");
  }
  eligibility.reopensStage = target.status === ProjectWorkflowStageStatus.COMPLETED;
  if (project.completedAt || project.archivedAt || isProjectStatusCompleted(project.status)) {
    return deny("Completed or archived projects cannot be reopened.");
  }

  const targetIndex = PROJECT_WORKFLOW_STAGE_DEFINITIONS.findIndex((stage) => stage.key === input.stageKey);
  const orderedStages = PROJECT_WORKFLOW_STAGE_DEFINITIONS.map((definition) =>
    project.workflowStages.find((stage) => stage.stageKey === definition.key));
  if (orderedStages.some((stage) => !stage) ||
      orderedStages.slice(0, targetIndex).some((stage) => stage?.status !== ProjectWorkflowStageStatus.COMPLETED)) {
    return deny("The preceding stages must be completed before this work can be reopened.");
  }
  const laterStages = orderedStages.slice(targetIndex + 1).filter((stage) => Boolean(stage));
  const stageFive = orderedStages[4]!;
  if (stageFive.status === ProjectWorkflowStageStatus.COMPLETED ||
      orderedStages.slice(5).some((stage) => stage?.status !== ProjectWorkflowStageStatus.LOCKED) ||
      project._count.productionUnits || project._count.productionSupervisions || project._count.productionSampleRounds ||
      project.archive || project._count.archivedFiles) {
    return deny("Stage 5 is completed or production work exists. This work cannot be reopened safely.");
  }
  if (getProjectWorkflowSequenceState(project.workflowStages).kind !== "ACTIVE") {
    return deny("The later stages are not in a consistent state. This work cannot be reopened safely.");
  }
  if (input.stageKey === "CONCEPT_CREATION" && project.conceptFolders.some((folder) =>
    folder.workflowStageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT)) {
    return deny("Stage 4 already has tasks. This work cannot be reopened safely.");
  }

  const handoffs = await tx.projectStageFileHandoff.findMany({
    where: { projectId: project.id },
    select: {
      id: true, sourceWorkflowStageKey: true, targetWorkflowStageKey: true, sourceAttachmentId: true,
      checklist: { select: {
        id: true, projectId: true, sourceAttachmentId: true,
        _count: { select: { requests: true } },
        items: { select: {
          status: true, value: true, updatedById: true,
          _count: { select: { attachments: true, requests: true } },
        } },
      } },
    },
  });
  const sourceStageKey = input.kind === "skip" ? "CONCEPT_CREATION" : input.stageKey;
  const approvedSourceFiles = new Set(project.conceptFolders
    .filter((folder) => folder.workflowStageKey === sourceStageKey)
    .map((folder) => folder.approvedAttachmentId).filter(Boolean));
  // Only untouched, automatically generated checklists can be rebuilt on completion.
  if (handoffs.some((handoff) => (input.kind === "skip" && input.stageKey !== "PROJECT_DEVELOPMENT") ||
      !eligibility.reopensStage || handoff.sourceWorkflowStageKey !== sourceStageKey || handoff.targetWorkflowStageKey !== "FINAL_LAYOUT" ||
      !approvedSourceFiles.has(handoff.sourceAttachmentId) || !handoff.checklist ||
      handoff.checklist.projectId !== project.id || handoff.checklist.sourceAttachmentId !== handoff.sourceAttachmentId) ||
      project._count.fileChecklists !== handoffs.length) {
    return deny("Stage 5 has uploaded files or dependent work. This work cannot be reopened safely.");
  }
  if (handoffs.some(({ checklist }) => checklist && (checklist._count.requests > 0 || checklist.items.some((item) =>
    item.status !== ProjectFileChecklistItemStatus.PENDING || item.value !== null || item.updatedById !== null ||
    item._count.attachments > 0 || item._count.requests > 0)))) {
    return deny("Stage 5 checklist work or information requests already exist. Reopening is blocked to preserve that work.");
  }

  const uploads = await tx.projectAttachment.count({
    where: {
      projectId: project.id, status: { not: AttachmentStatus.DELETED },
      OR: [
        { status: AttachmentStatus.UPLOADING },
        { assetType: { in: [AttachmentAssetType.FILE_CHECKLIST_ATTACHMENT, AttachmentAssetType.SAMPLE_ROUND_EVIDENCE, AttachmentAssetType.FINAL_ARCHIVE] } },
        // Direct Stage 5 uploads are unassigned until completion. Research and private
        // folder files are independent supporting materials and remain in place.
        ...(stageFive.status !== ProjectWorkflowStageStatus.LOCKED ? [{
          assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET, stageId: null,
          inquiryAssociations: { none: {} }, researchFolderFile: null, privateFolderId: null,
        }] : []),
      ],
    },
  });
  if (uploads) return deny("An upload is in progress or later-stage files exist. This work cannot be reopened safely.");
  if (task && await tx.projectAttachment.count({ where: {
    projectId: project.id, stageId: task.taskerStageId,
    assetType: { in: [AttachmentAssetType.REVISION_ORIGINAL, AttachmentAssetType.STAGE_SUBMISSION] },
    status: { in: [AttachmentStatus.READY, AttachmentStatus.UPLOADING] },
  } })) return deny("This task has a submitted file. Review that submission before changing its completion.");
  const drafts = await tx.projectFormDraft.count({
    where: { projectId: project.id, OR: [
      { formKey: { startsWith: "stage-five-" } }, { formKey: { startsWith: "stage-six-" } },
      { formKey: { startsWith: "stage-seven-" } },
      ...(input.stageKey === "CONCEPT_CREATION" ? [{ formKey: { startsWith: "concept-details:PROJECT_DEVELOPMENT:" } }] : []),
    ] },
  });
  if (drafts) return deny("Later stages have saved drafts. Finish or discard those drafts before reopening this work.");
  eligibility.emptyChecklistCount = handoffs.length;
  const executors = project.executors.filter((executor) => executor.user.role === UserRole.USER);
  let assignedExecutorId = task?.assignedExecutorId ?? null;
  let assignmentChanged = false;
  if (input.kind === "task" && task) {
    if (!executors.some((executor) => executor.userId === assignedExecutorId)) {
      eligibility.executorOptions = executors.map((executor) => ({ id: executor.userId, name: executor.user.name?.trim() || executor.user.email }));
      if (!input.executorId || !executors.some((executor) => executor.userId === input.executorId)) {
        return deny(executors.length ? "Choose a project executor before revoking completion." : "Add an executor in Edit Project, then choose them when revoking completion.", true);
      }
      assignedExecutorId = input.executorId;
      assignmentChanged = true;
    } else if (input.executorId && input.executorId !== assignedExecutorId) {
      return deny("This task already has an assigned executor. Revoke completion with the existing assignment.");
    }
  } else if (!executors.length) {
    return deny("Add an executor in Edit Project before reopening this stage. Each new task must then be assigned to an executor.", true);
  }
  return {
    eligibility: { ...eligibility, canRevoke: true, emptyChecklistCount: handoffs.length },
    targetStageId: target.id, resetStageIds: laterStages.map((stage) => stage!.id), handoffIds: handoffs.map((handoff) => handoff.id),
    taskerStageId: task?.taskerStageId ?? "", assignedExecutorId, assignmentChanged,
  };
}

export async function getStageSkipRevocationEligibility(user: PermissionUser, input: Input) {
  return withPrismaRetry(() => prisma.$transaction(async (tx) =>
    (await resolveConceptReopening(tx, user, { ...input, kind: "skip" })).eligibility,
  { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

export async function revokeSkippedConceptStage(
  user: PermissionUser, input: Input,
): Promise<{ changed: true } | { error: string }> {
  return reopenConceptWork(user, { ...input, kind: "skip" });
}

export async function getTaskCompletionRevocationEligibility(user: PermissionUser, input: Omit<TaskInput, "executorId">) {
  return withPrismaRetry(() => prisma.$transaction(async (tx) =>
    (await resolveConceptReopening(tx, user, { ...input, kind: "task" })).eligibility,
  { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

export async function revokeConceptTaskCompletion(user: PermissionUser, input: TaskInput) {
  return reopenConceptWork(user, { ...input, kind: "task" });
}

async function reopenConceptWork(
  user: PermissionUser, input: ReopeningInput, retryCount = 0,
): Promise<{ changed: true; taskerStageId: string; reopensStage: boolean } | { error: string }> {
  try {
    return await withPrismaRetry(() => prisma.$transaction(async (tx) => {
      const resolution = await resolveConceptReopening(tx, user, input);
      if (!resolution.eligibility.canRevoke) return { error: resolution.eligibility.reason ?? "This work cannot be reopened safely." };
      const now = new Date();
      // Revalidate everything in this transaction before changing stages or empty derived records.
      if (resolution.eligibility.reopensStage) {
        const reopened = await tx.projectWorkflowStage.updateMany({
          where: { id: resolution.targetStageId, status: ProjectWorkflowStageStatus.COMPLETED },
          data: { status: ProjectWorkflowStageStatus.AVAILABLE, completedAt: null, unlockedAt: now },
        });
        if (reopened.count !== 1) throw new Error("The workflow changed while reopening the stage.");
        await tx.projectWorkflowStage.updateMany({
          where: { projectId: input.projectId, id: { in: resolution.resetStageIds } },
          data: { status: ProjectWorkflowStageStatus.LOCKED, unlockedAt: null, completedAt: null },
        });
        await tx.projectStageFileHandoff.deleteMany({ where: { projectId: input.projectId, id: { in: resolution.handoffIds } } });
      }
      if (input.kind === "task") {
        await tx.projectStage.update({ where: { id: resolution.taskerStageId }, data: {
          status: StageStatus.ONGOING, completedAt: null,
          ...(resolution.assignmentChanged ? { actualStartedAt: null, startedById: null } : {}),
        } });
        await tx.projectConceptFolder.update({ where: { id: input.folderId }, data: {
          completedWithoutFileAt: null, completionRequestedAt: null, completionRequestNote: null,
          assignedExecutorId: resolution.assignedExecutorId,
        } });
        await tx.projectComment.create({ data: {
          projectId: input.projectId, stageId: resolution.taskerStageId, authorId: user.id,
          body: `Task completion revoked. The task is open for further work.${resolution.eligibility.reopensStage ? " The workflow stage was reopened and later stages were locked." : ""}`,
        } });
      } else await tx.projectActivityLog.create({ data: {
        projectId: input.projectId, actorId: user.id, action: ActivityLogAction.STAGE_SKIP_REVOKED,
        metadata: { workflowStageKey: input.stageKey, resetStageIds: resolution.resetStageIds, removedEmptyChecklistCount: resolution.handoffIds.length },
      } });
      return { changed: true, taskerStageId: resolution.taskerStageId, reopensStage: resolution.eligibility.reopensStage } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      if (retryCount < 2) return reopenConceptWork(user, input, retryCount + 1);
      return { error: "The project changed at the same time. Refresh and try again." };
    }
    throw error;
  }
}

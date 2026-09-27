import {
  ActivityLogAction, AttachmentAssetType, AttachmentStatus, Prisma,
  ProjectFileChecklistItemStatus, ProjectWorkflowStageKey, ProjectWorkflowStageStatus, UserRole,
} from "@prisma/client";

import { canCompleteProjectConceptStage } from "@/lib/project-concept-access";
import type { PermissionUser } from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { projectStageAccessSelect } from "@/lib/project-stage-data";
import { isProjectStatusCompleted } from "@/lib/project-statuses";
import { getProjectWorkflowSequenceState, PROJECT_WORKFLOW_STAGE_DEFINITIONS } from "@/lib/project-workflow";

type ConceptStageKey = "CONCEPT_CREATION" | "PROJECT_DEVELOPMENT";
type Input = { projectId: string; stageKey: ConceptStageKey };

export type StageSkipRevocationEligibility = {
  visible: boolean;
  canRevoke: boolean;
  requiresExecutor: boolean;
  reason: string | null;
  emptyChecklistCount: number;
};

async function resolveSkipRevocation(tx: Prisma.TransactionClient, user: PermissionUser, input: Input) {
  const eligibility: StageSkipRevocationEligibility = {
    visible: false, canRevoke: false, requiresExecutor: false, reason: null, emptyChecklistCount: 0,
  };
  const deny = (reason: string, requiresExecutor = false) => ({
    eligibility: { ...eligibility, reason, requiresExecutor },
    resetStageIds: [] as string[], handoffIds: [] as string[], targetStageId: "",
  });
  if (input.stageKey !== "CONCEPT_CREATION" && input.stageKey !== "PROJECT_DEVELOPMENT") {
    return deny("Only a skipped Stage 3 or Stage 4 can be reopened.");
  }
  const project = await tx.project.findUnique({
    where: { id: input.projectId },
    select: {
      ...projectStageAccessSelect,
      executors: { select: { user: { select: { role: true } } } },
      conceptFolders: { select: { workflowStageKey: true, approvedAttachmentId: true } },
      _count: { select: { productionUnits: true, productionSupervisions: true, productionSampleRounds: true, archivedFiles: true, fileChecklists: true } },
      archive: { select: { id: true } },
    },
  });
  if (!project || !canCompleteProjectConceptStage(user, {
    projectId: input.projectId, folderId: "", taskerStageId: "", assignedExecutorId: null,
    workflowStageKey: input.stageKey, ownerId: project.ownerId,
    coOwnerIds: project.coOwners.map((entry) => entry.userId),
  })) return deny("Only the project owner or an administrator can undo a stage skip.");

  const target = project.workflowStages.find((stage) => stage.stageKey === input.stageKey);
  if (target?.status !== ProjectWorkflowStageStatus.COMPLETED ||
      project.conceptFolders.some((folder) => folder.workflowStageKey === input.stageKey)) {
    return deny("This stage was not skipped, or has already been reopened.");
  }
  eligibility.visible = true;
  if (project.completedAt || project.archivedAt || isProjectStatusCompleted(project.status)) {
    return deny("Completed or archived projects cannot be reopened.");
  }

  const targetIndex = PROJECT_WORKFLOW_STAGE_DEFINITIONS.findIndex((stage) => stage.key === input.stageKey);
  const orderedStages = PROJECT_WORKFLOW_STAGE_DEFINITIONS.map((definition) =>
    project.workflowStages.find((stage) => stage.stageKey === definition.key));
  if (orderedStages.some((stage) => !stage) ||
      orderedStages.slice(0, targetIndex).some((stage) => stage?.status !== ProjectWorkflowStageStatus.COMPLETED)) {
    return deny("The preceding stages must be completed before this skip can be undone.");
  }
  const laterStages = orderedStages.slice(targetIndex + 1).filter((stage) => Boolean(stage));
  const stageFive = orderedStages[4]!;
  if (stageFive.status === ProjectWorkflowStageStatus.COMPLETED ||
      orderedStages.slice(5).some((stage) => stage?.status !== ProjectWorkflowStageStatus.LOCKED) ||
      project._count.productionUnits || project._count.productionSupervisions || project._count.productionSampleRounds ||
      project.archive || project._count.archivedFiles) {
    return deny("Stage 5 is completed or production work exists. This skip cannot be undone safely.");
  }
  if (getProjectWorkflowSequenceState(project.workflowStages).kind !== "ACTIVE") {
    return deny("The later stages are not in a consistent state. This skip cannot be undone safely.");
  }
  if (input.stageKey === "CONCEPT_CREATION" && project.conceptFolders.some((folder) =>
    folder.workflowStageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT)) {
    return deny("Stage 4 already has tasks. This skip cannot be undone safely.");
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
  const approvedStageThreeFiles = new Set(project.conceptFolders
    .filter((folder) => folder.workflowStageKey === "CONCEPT_CREATION")
    .map((folder) => folder.approvedAttachmentId).filter(Boolean));
  // Only untouched checklists automatically created by skipping Stage 4 may be reset.
  if (handoffs.some((handoff) => input.stageKey !== "PROJECT_DEVELOPMENT" ||
      handoff.sourceWorkflowStageKey !== "CONCEPT_CREATION" || handoff.targetWorkflowStageKey !== "FINAL_LAYOUT" ||
      !approvedStageThreeFiles.has(handoff.sourceAttachmentId) || !handoff.checklist ||
      handoff.checklist.projectId !== project.id || handoff.checklist.sourceAttachmentId !== handoff.sourceAttachmentId) ||
      project._count.fileChecklists !== handoffs.length) {
    return deny("Stage 5 has uploaded files or dependent work. This skip cannot be undone safely.");
  }
  if (handoffs.some(({ checklist }) => checklist && (checklist._count.requests > 0 || checklist.items.some((item) =>
    item.status !== ProjectFileChecklistItemStatus.PENDING || item.value !== null || item.updatedById !== null ||
    item._count.attachments > 0 || item._count.requests > 0)))) {
    return deny("Stage 5 checklist work or information requests already exist. Keep this stage skipped to preserve that work.");
  }

  const uploads = await tx.projectAttachment.count({
    where: {
      projectId: project.id, status: { not: AttachmentStatus.DELETED },
      OR: [
        { status: AttachmentStatus.UPLOADING },
        { assetType: { in: [AttachmentAssetType.FILE_CHECKLIST_ATTACHMENT, AttachmentAssetType.SAMPLE_ROUND_EVIDENCE, AttachmentAssetType.FINAL_ARCHIVE] } },
        // Direct Stage 5 uploads have no stage or inquiry association until completion.
        { assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET, stageId: null, inquiryAssociations: { none: {} } },
      ],
    },
  });
  if (uploads) return deny("An upload is in progress or later-stage files exist. This skip cannot be undone safely.");
  const drafts = await tx.projectFormDraft.count({
    where: { projectId: project.id, OR: [
      { formKey: { startsWith: "stage-five-" } }, { formKey: { startsWith: "stage-six-" } },
      { formKey: { startsWith: "stage-seven-" } },
      ...(input.stageKey === "CONCEPT_CREATION" ? [{ formKey: { startsWith: "concept-details:PROJECT_DEVELOPMENT:" } }] : []),
    ] },
  });
  if (drafts) return deny("Later stages have saved drafts. Finish or discard those drafts before undoing this skip.");
  if (!project.executors.some((executor) => executor.user.role === UserRole.USER)) {
    return deny("Add an executor in Edit Project before reopening this stage. Each new task must then be assigned to an executor.", true);
  }
  return {
    eligibility: { ...eligibility, canRevoke: true, emptyChecklistCount: handoffs.length },
    targetStageId: target.id, resetStageIds: laterStages.map((stage) => stage!.id), handoffIds: handoffs.map((handoff) => handoff.id),
  };
}

export async function getStageSkipRevocationEligibility(user: PermissionUser, input: Input) {
  return withPrismaRetry(() => prisma.$transaction(async (tx) =>
    (await resolveSkipRevocation(tx, user, input)).eligibility,
  { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

export async function revokeSkippedConceptStage(
  user: PermissionUser, input: Input, retryCount = 0,
): Promise<{ changed: true } | { error: string }> {
  try {
    return await withPrismaRetry(() => prisma.$transaction(async (tx) => {
      const resolution = await resolveSkipRevocation(tx, user, input);
      if (!resolution.eligibility.canRevoke) return { error: resolution.eligibility.reason ?? "This skip cannot be undone safely." };
      const now = new Date();
      // Revalidate everything in this transaction before changing stages or empty derived records.
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
      await tx.projectActivityLog.create({ data: {
        projectId: input.projectId, actorId: user.id, action: ActivityLogAction.STAGE_SKIP_REVOKED,
        metadata: { workflowStageKey: input.stageKey, resetStageIds: resolution.resetStageIds, removedEmptyChecklistCount: resolution.handoffIds.length },
      } });
      return { changed: true } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      if (retryCount < 2) return revokeSkippedConceptStage(user, input, retryCount + 1);
      return { error: "The project changed at the same time. Refresh and try again." };
    }
    throw error;
  }
}

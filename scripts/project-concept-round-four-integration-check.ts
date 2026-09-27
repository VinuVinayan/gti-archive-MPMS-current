import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectFileChecklistField,
  ProjectProductionUnitStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import {
  completeStageFourConcepts,
  getConceptApprovalRevocationEligibility,
  getProjectConceptChatContext,
  markProjectConceptApprovedAttachment,
  markStageFourFinalApprovedAttachment,
  revokeProjectConceptApprovedAttachment,
  revokeStageFourFinalApprovedAttachment,
} from "../src/lib/project-concepts";
import { reviewStageSubmission } from "../src/lib/project-history";
import {
  notifyStageFiveActivated,
  notifyStageFourFinalFileApproved,
} from "../src/lib/notification-center/triggers";
import { prisma } from "../src/lib/prisma";
import {
  completeStageFive,
  getStageFiveWorkspaceData,
  saveStageFiveChecklist,
} from "../src/lib/stage-five";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Concept Round 4 integration check failed: ${message}`);
}

function isError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

async function expectRejected(task: Promise<unknown>, message: string) {
  let rejected = false;
  try {
    await task;
  } catch {
    rejected = true;
  }
  check(rejected, message);
}

async function main() {
  const runId = randomUUID();
  const projectId = `concept-round-four-${runId}`;
  const foreignProjectId = `concept-round-four-foreign-${runId}`;
  const skipProjectId = `concept-round-four-skip-${runId}`;
  const stageThreeFallbackProjectId = `concept-round-four-stage-three-fallback-${runId}`;
  const userSpecs = [
    ["super", UserRole.SUPER_ADMIN],
    ["owner", UserRole.ADMIN],
    ["coowner", UserRole.ADMIN],
    ["executor", UserRole.USER],
    ["collaborator", UserRole.USER],
    ["admin-outsider", UserRole.ADMIN],
  ] as const;
  const userIds = userSpecs.map(([label]) => `round-four-${label}-${runId}`);

  try {
    await prisma.user.createMany({
      data: userSpecs.map(([label, role], index) => ({
        id: userIds[index],
        email: `${label}-${runId}@example.test`,
        name: `Round Four ${label}`,
        passwordHash: "round-four-test-only",
        role,
      })),
    });
    const [superAdmin, owner, coOwner, executor, collaborator] =
      await Promise.all(
        userIds.map((id) =>
          prisma.user.findUniqueOrThrow({
            where: { id },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          }),
        ),
      );

    const now = new Date();
    await prisma.project.create({
      data: {
        id: projectId,
        name: `Concept Round 4 ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        coOwners: { create: [{ userId: coOwner.id, addedById: superAdmin.id }] },
        executors: { create: [{ userId: executor.id, addedById: owner.id }] },
        collaborators: {
          create: [{ userId: collaborator.id, addedById: owner.id }],
        },
        workflowStages: {
          create: getInitialProjectWorkflowStageData().map((stage) => ({
            ...stage,
            status:
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING ||
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
                ? ProjectWorkflowStageStatus.COMPLETED
                : stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT
                  ? ProjectWorkflowStageStatus.AVAILABLE
                  : ProjectWorkflowStageStatus.LOCKED,
            completedAt:
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING ||
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
                ? now
                : null,
            unlockedAt:
              stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT ||
              stage.stageKey === ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER ||
              stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION
                ? null
                : now,
          })),
        },
      },
    });
    await prisma.project.create({
      data: {
        id: skipProjectId,
        name: `Concept Round 4 Skip ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        workflowStages: {
          create: getInitialProjectWorkflowStageData().map((stage) => ({
            ...stage,
            status:
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING ||
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
                ? ProjectWorkflowStageStatus.COMPLETED
                : stage.stageKey ===
                    ProjectWorkflowStageKey.PROJECT_DEVELOPMENT
                  ? ProjectWorkflowStageStatus.AVAILABLE
                  : ProjectWorkflowStageStatus.LOCKED,
            completedAt:
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING ||
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
                ? now
                : null,
            unlockedAt:
              stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER ||
              stage.stageKey ===
                ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION
                ? null
                : now,
          })),
        },
      },
    });

    check(
      isError(
        await completeStageFourConcepts(executor, {
          projectId: skipProjectId,
        }),
      ),
      "an unauthorized user must not skip an empty Stage 4",
    );
    const skippedStageFour = await completeStageFourConcepts(owner, {
      projectId: skipProjectId,
    });
    check(
      !isError(skippedStageFour) &&
        skippedStageFour.skipped &&
        skippedStageFour.finalApprovedCount === 0 &&
        skippedStageFour.handoffs.length === 0,
      "an authorized owner must skip an empty available Stage 4 without fake handoffs",
    );
    const skippedWorkflow = await prisma.projectWorkflowStage.findMany({
      where: {
        projectId: skipProjectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            ProjectWorkflowStageKey.FINAL_LAYOUT,
          ],
        },
      },
      select: { stageKey: true, status: true },
    });
    const skippedWorkspace = await getStageFiveWorkspaceData(
      owner,
      skipProjectId,
    );
    check(
      skippedWorkflow.find(
        (stage) =>
          stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      )?.status === ProjectWorkflowStageStatus.COMPLETED &&
        skippedWorkflow.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
        )?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        skippedWorkspace?.files.length === 0 &&
        skippedWorkspace.canUploadSource &&
        (await prisma.projectAttachment.count({
          where: { projectId: skipProjectId },
        })) === 0 &&
        (await prisma.projectStageFileHandoff.count({
          where: { projectId: skipProjectId },
        })) === 0 &&
        (await prisma.projectActivityLog.count({
          where: {
            projectId: skipProjectId,
            action: "STAGE_SKIPPED",
          },
        })) === 1,
      "Stage 4 skip must complete Stage 4, unlock an empty Stage 5, and record one audit event",
    );
    check(
      isError(
        await completeStageFourConcepts(owner, { projectId: skipProjectId }),
      ),
      "Stage 4 skip must be accepted only from AVAILABLE state",
    );
    await prisma.project.create({
      data: {
        id: foreignProjectId,
        name: `Foreign Round 4 ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
      },
    });

    const [stageThreeTasker, taskerA, taskerB, taskerC, foreignTasker] =
      await Promise.all([
        prisma.projectStage.create({
          data: {
            projectId,
            name: "Approved Stage 3 Source",
            invoiceRequired: false,
            isTasker: true,
            status: StageStatus.ONGOING,
            order: 30_001,
          },
        }),
        ...["Final Concept A", "Final Concept B", "Final Concept C"].map(
          (name, index) =>
            prisma.projectStage.create({
              data: {
                projectId,
                name,
                invoiceRequired: false,
                isTasker: true,
                actualStartedAt: now,
                startedById: executor.id,
                status: StageStatus.ONGOING,
                order: 40_001 + index,
              },
            }),
        ),
        prisma.projectStage.create({
          data: {
            projectId: foreignProjectId,
            name: "Foreign Final Concept",
            invoiceRequired: false,
            isTasker: true,
            status: StageStatus.ONGOING,
            order: 40_001,
          },
        }),
      ]);

    const [sourceRevision, revisionA, revisionB, revisionC, foreignRevision] =
      await Promise.all([
        prisma.projectRevision.create({
          data: {
            projectId,
            stageId: stageThreeTasker.id,
            createdById: executor.id,
            revisionNumber: 1,
            title: "Approved source",
            status: ProjectRevisionStatus.PENDING_REVIEW,
          },
        }),
        prisma.projectRevision.create({
          data: {
            projectId,
            stageId: taskerA.id,
            createdById: executor.id,
            revisionNumber: 1,
            title: "Final A submission",
            status: ProjectRevisionStatus.PENDING_REVIEW,
          },
        }),
        prisma.projectRevision.create({
          data: {
            projectId,
            stageId: taskerB.id,
            createdById: executor.id,
            revisionNumber: 1,
            title: "Final B submission",
            status: ProjectRevisionStatus.PENDING_REVIEW,
          },
        }),
        prisma.projectRevision.create({
          data: {
            projectId,
            stageId: taskerC.id,
            createdById: executor.id,
            revisionNumber: 1,
            title: "Final C submission",
            status: ProjectRevisionStatus.PENDING_REVIEW,
          },
        }),
        prisma.projectRevision.create({
          data: {
            projectId: foreignProjectId,
            stageId: foreignTasker.id,
            createdById: executor.id,
            revisionNumber: 1,
            title: "Foreign submission",
            status: ProjectRevisionStatus.PENDING_REVIEW,
          },
        }),
      ]);

    const createAttachment = (input: {
      id: string;
      targetProjectId?: string;
      stageId: string;
      revisionId?: string | null;
      commentId?: string | null;
      assetType: AttachmentAssetType;
      name: string;
    }) =>
      prisma.projectAttachment.create({
        data: {
          id: input.id,
          projectId: input.targetProjectId ?? projectId,
          stageId: input.stageId,
          revisionId: input.revisionId ?? null,
          commentId: input.commentId ?? null,
          uploadedById: executor.id,
          fileName: input.name,
          originalFileName: input.name,
          mimeType: "image/png",
          fileSize: 64,
          bucket: "round-four-integration",
          storageKey: `round-four/${runId}/${input.id}.png`,
          assetType: input.assetType,
          status: AttachmentStatus.READY,
        },
      });

    await prisma.project.create({
      data: {
        id: stageThreeFallbackProjectId,
        name: `Concept Round Four Stage 3 Fallback ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        executors: {
          create: [{ userId: executor.id, addedById: owner.id }],
        },
        workflowStages: {
          create: getInitialProjectWorkflowStageData().map((stage) => ({
            ...stage,
            status:
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING ||
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
                ? ProjectWorkflowStageStatus.COMPLETED
                : stage.stageKey ===
                    ProjectWorkflowStageKey.PROJECT_DEVELOPMENT
                  ? ProjectWorkflowStageStatus.AVAILABLE
                  : ProjectWorkflowStageStatus.LOCKED,
            completedAt:
              stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING ||
              stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
                ? now
                : null,
            unlockedAt:
              stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT ||
              stage.stageKey ===
                ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER ||
              stage.stageKey ===
                ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION
                ? null
                : now,
          })),
        },
      },
    });
    const stageThreeFallbackTasker = await prisma.projectStage.create({
      data: {
        projectId: stageThreeFallbackProjectId,
        name: "Approved Stage 3 Fallback",
        invoiceRequired: false,
        isTasker: true,
        actualStartedAt: now,
        startedById: executor.id,
        status: StageStatus.COMPLETED,
        completedAt: now,
        order: 30_001,
      },
    });
    const stageThreeFallbackRevision = await prisma.projectRevision.create({
      data: {
        projectId: stageThreeFallbackProjectId,
        stageId: stageThreeFallbackTasker.id,
        createdById: executor.id,
        revisionNumber: 1,
        title: "Approved Stage 3 fallback source",
        status: ProjectRevisionStatus.APPROVED,
        reviewedById: owner.id,
        reviewedAt: now,
      },
    });
    const stageThreeFallbackFile = await createAttachment({
      id: `round-four-stage-three-fallback-${runId}`,
      targetProjectId: stageThreeFallbackProjectId,
      stageId: stageThreeFallbackTasker.id,
      revisionId: stageThreeFallbackRevision.id,
      assetType: AttachmentAssetType.REVISION_ORIGINAL,
      name: "approved-stage-three-fallback.png",
    });
    const stageThreeFallbackConcept = await prisma.projectConceptFolder.create({
      data: {
        projectId: stageThreeFallbackProjectId,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        taskerStageId: stageThreeFallbackTasker.id,
        assignedExecutorId: executor.id,
        approvedAttachmentId: stageThreeFallbackFile.id,
        approvedById: owner.id,
        approvedAt: now,
        name: "Approved Stage 3 Fallback",
        normalizedName: "approved stage 3 fallback",
        createdById: owner.id,
      },
    });

    const stageThreeFallbackCompletion = await completeStageFourConcepts(
      owner,
      { projectId: stageThreeFallbackProjectId },
    );
    const stageThreeFallbackWorkspace = await getStageFiveWorkspaceData(
      owner,
      stageThreeFallbackProjectId,
    );
    const stageThreeFallbackHandoff =
      await prisma.projectStageFileHandoff.findFirst({
        where: { projectId: stageThreeFallbackProjectId },
        select: {
          sourceWorkflowStageKey: true,
          sourceAttachmentId: true,
          checklist: { select: { sourceAttachmentId: true } },
        },
      });
    check(
      !isError(stageThreeFallbackCompletion) &&
        stageThreeFallbackCompletion.skipped &&
        stageThreeFallbackCompletion.handoffs.length === 1 &&
        stageThreeFallbackCompletion.finalApprovedCount === 1 &&
        stageThreeFallbackWorkspace?.files.length === 1 &&
        stageThreeFallbackWorkspace.files[0].sourceOrigin === "STAGE_THREE" &&
        stageThreeFallbackWorkspace.files[0].sourceAttachment.id ===
          stageThreeFallbackFile.id &&
        stageThreeFallbackHandoff?.sourceWorkflowStageKey ===
          ProjectWorkflowStageKey.CONCEPT_CREATION &&
        stageThreeFallbackHandoff.sourceAttachmentId ===
          stageThreeFallbackFile.id &&
        stageThreeFallbackHandoff.checklist?.sourceAttachmentId ===
          stageThreeFallbackFile.id,
      "skipping Stage 4 after Stage 3 completion must carry approved Stage 3 files into Stage 5",
    );
    const revokedStageThreeFallback =
      await revokeProjectConceptApprovedAttachment(owner, {
        projectId: stageThreeFallbackProjectId,
        folderId: stageThreeFallbackConcept.id,
      });
    check(
      !isError(revokedStageThreeFallback) &&
        revokedStageThreeFallback.removedStageFiveHandoff &&
        (await prisma.projectStageFileHandoff.count({
          where: { projectId: stageThreeFallbackProjectId },
        })) === 0 &&
        (await prisma.projectFileChecklist.count({
          where: { projectId: stageThreeFallbackProjectId },
        })) === 0,
      "reopening Stage 3 must remove its fallback Stage 5 handoff and checklist",
    );

    const sourceFile = await createAttachment({
      id: `round-four-source-${runId}`,
      stageId: stageThreeTasker.id,
      revisionId: sourceRevision.id,
      assetType: AttachmentAssetType.REVISION_ORIGINAL,
      name: "approved-stage-three-source.png",
    });
    const stageThreeConcept = await prisma.projectConceptFolder.create({
      data: {
        projectId,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        taskerStageId: stageThreeTasker.id,
        assignedExecutorId: executor.id,
        approvedAttachmentId: sourceFile.id,
        approvedById: owner.id,
        approvedAt: now,
        name: "Approved Stage 3 Source",
        normalizedName: "approved stage 3 source",
        sortOrder: 1,
        createdById: owner.id,
      },
    });
    const [conceptA, conceptB, conceptC] = await Promise.all(
      [taskerA, taskerB, taskerC].map((tasker, index) =>
        prisma.projectConceptFolder.create({
          data: {
            projectId,
            workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            taskerStageId: tasker.id,
            assignedExecutorId: executor.id,
            name: `Final Concept ${String.fromCharCode(65 + index)}`,
            normalizedName: `final concept ${String.fromCharCode(97 + index)}`,
            sortOrder: index + 1,
            createdById: owner.id,
            ...(index === 0
              ? {
                  sourceStage3ConceptId: stageThreeConcept.id,
                  sourceStage3ApprovedAttachmentId: sourceFile.id,
                }
              : {}),
          },
        }),
      ),
    );

    const chatComment = await prisma.projectComment.create({
      data: {
        projectId,
        stageId: taskerA.id,
        authorId: executor.id,
        body: "Chat attachment fixture",
      },
    });
    const [finalA, alternateA, finalB, finalC, briefAttachment, chatAttachment, foreignFile] =
      await Promise.all([
        createAttachment({
          id: `round-four-final-a-${runId}`,
          stageId: taskerA.id,
          revisionId: revisionA.id,
          assetType: AttachmentAssetType.REVISION_ORIGINAL,
          name: "final-a.png",
        }),
        createAttachment({
          id: `round-four-alternate-a-${runId}`,
          stageId: taskerA.id,
          revisionId: revisionA.id,
          assetType: AttachmentAssetType.STAGE_SUBMISSION,
          name: "final-a-alternate.png",
        }),
        createAttachment({
          id: `round-four-final-b-${runId}`,
          stageId: taskerB.id,
          revisionId: revisionB.id,
          assetType: AttachmentAssetType.REVISION_ORIGINAL,
          name: "final-b.png",
        }),
        createAttachment({
          id: `round-four-final-c-${runId}`,
          stageId: taskerC.id,
          revisionId: revisionC.id,
          assetType: AttachmentAssetType.REVISION_ORIGINAL,
          name: "final-c.png",
        }),
        createAttachment({
          id: `round-four-brief-${runId}`,
          stageId: taskerA.id,
          assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
          name: "concept-brief.png",
        }),
        createAttachment({
          id: `round-four-chat-${runId}`,
          stageId: taskerA.id,
          commentId: chatComment.id,
          assetType: AttachmentAssetType.COMMENT_ATTACHMENT,
          name: "chat-file.png",
        }),
        createAttachment({
          id: `round-four-foreign-${runId}`,
          targetProjectId: foreignProjectId,
          stageId: foreignTasker.id,
          revisionId: foreignRevision.id,
          assetType: AttachmentAssetType.REVISION_ORIGINAL,
          name: "foreign-file.png",
        }),
      ]);

    check(
      isError(await completeStageFourConcepts(owner, { projectId })),
      "Stage 4 completion must be blocked with zero final files",
    );
    check(
      isError(await completeStageFourConcepts(coOwner, { projectId })),
      "Stage 4 completion must reject an ADMIN while final files are missing",
    );
    for (const actor of [executor, collaborator]) {
      check(
        isError(
          await markStageFourFinalApprovedAttachment(actor, {
            projectId,
            folderId: conceptA.id,
            attachmentId: finalA.id,
          }),
        ),
        "executor and project collaborator must not mark a final file",
      );
      check(
        isError(await completeStageFourConcepts(actor, { projectId })),
        "executor and project collaborator must not complete Stage 4",
      );
    }

    for (const attachmentId of [
      sourceFile.id,
      briefAttachment.id,
      chatAttachment.id,
      finalB.id,
      foreignFile.id,
    ]) {
      check(
        isError(
          await markStageFourFinalApprovedAttachment(owner, {
            projectId,
            folderId: conceptA.id,
            attachmentId,
          }),
        ),
        "starting references, brief/chat files, other concepts, and cross-project files must be rejected",
      );
    }

    const ownerApproval = await markStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(!isError(ownerApproval) && ownerApproval.changed, "owner must mark a final file");
    const coOwnerApproval = await markStageFourFinalApprovedAttachment(coOwner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: alternateA.id,
    });
    check(!isError(coOwnerApproval) && coOwnerApproval.changed, "co-owner must replace a final file before completion");
    const superApproval = await markStageFourFinalApprovedAttachment(superAdmin, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(!isError(superApproval) && superApproval.changed, "SUPER_ADMIN must mark a final file");
    const repeatedApproval = await markStageFourFinalApprovedAttachment(superAdmin, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(!isError(repeatedApproval) && !repeatedApproval.changed, "same final designation must be idempotent");
    check(
      isError(
        await revokeStageFourFinalApprovedAttachment(executor, {
          projectId,
          folderId: conceptA.id,
        }),
      ),
      "the assigned executor must not revoke a Final Approved File",
    );
    const revokedApproval = await revokeStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
    });
    check(
      !isError(revokedApproval) &&
        revokedApproval.revisionStatus === ProjectRevisionStatus.PENDING_REVIEW,
      "an authorized reviewer must revoke a final approval before Stage 4 completion",
    );
    const revokedState = await prisma.projectConceptFolder.findUniqueOrThrow({
      where: { id: conceptA.id },
      select: {
        approvedAttachmentId: true,
        approvedById: true,
        approvedAt: true,
        taskerStage: {
          select: {
            status: true,
            completedAt: true,
            revisions: {
              where: { id: revisionA.id },
              select: { status: true },
            },
          },
        },
      },
    });
    check(
      revokedState.approvedAttachmentId === null &&
        revokedState.approvedById === null &&
        revokedState.approvedAt === null &&
        revokedState.taskerStage.status === StageStatus.ONGOING &&
        revokedState.taskerStage.completedAt === null &&
        revokedState.taskerStage.revisions[0]?.status ===
          ProjectRevisionStatus.PENDING_REVIEW,
      "revocation must clear the final designation, restore Pending Review, and reopen the tasker",
    );
    const restoredApproval = await markStageFourFinalApprovedAttachment(superAdmin, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(
      !isError(restoredApproval) && restoredApproval.changed,
      "a revoked Stage 4 final submission must be approvable again",
    );

    const preCompletion = await prisma.$transaction([
      prisma.projectConceptFolder.findUniqueOrThrow({
        where: { id: conceptA.id },
        select: { approvedAttachmentId: true, approvedById: true, approvedAt: true },
      }),
      prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          },
        },
      }),
      prisma.projectStageFileHandoff.count({ where: { projectId } }),
      prisma.projectCompletionWorkflow.count({ where: { projectId } }),
      prisma.projectAttachment.count({
        where: { id: { in: [finalA.id, alternateA.id] } },
      }),
      prisma.projectStage.findUniqueOrThrow({
        where: { id: taskerA.id },
        select: { status: true, completedAt: true },
      }),
      prisma.projectRevision.findUniqueOrThrow({
        where: { id: revisionA.id },
        select: { status: true, reviewedById: true, reviewedAt: true },
      }),
      prisma.projectAttachment.count({
        where: {
          revisionId: revisionA.id,
          submissionReviewStatus: "APPROVED",
        },
      }),
    ]);
    check(
      preCompletion[0].approvedAttachmentId === finalA.id &&
        preCompletion[0].approvedById === superAdmin.id &&
        preCompletion[0].approvedAt !== null &&
        preCompletion[1].status === ProjectWorkflowStageStatus.AVAILABLE &&
        preCompletion[2] === 0 &&
        preCompletion[3] === 0 &&
        preCompletion[5].status === StageStatus.COMPLETED &&
        preCompletion[5].completedAt !== null,
      "approving a final submission must complete its tasker while leaving the overall workflow available for remaining concepts",
    );
    check(preCompletion[4] === 2, "replacement must preserve previous files and revisions");
    check(
      preCompletion[6].status === ProjectRevisionStatus.APPROVED &&
        preCompletion[6].reviewedById === superAdmin.id &&
        preCompletion[6].reviewedAt !== null &&
        preCompletion[7] === 1,
      "the final submission revision and only its selected formal file must be approved",
    );

    await notifyStageFourFinalFileApproved({
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
      actorId: owner.id,
    });
    check(
      (await prisma.notification.count({
        where: {
          projectId,
          userId: executor.id,
          attachmentId: finalA.id,
          title: "Final concept file approved",
        },
      })) === 1,
      "final approval notification must target the assigned executor",
    );

    const emptyHandoff = await prisma.projectStageFileHandoff.create({
      data: {
        projectId,
        sourceWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        sourceAttachmentId: finalA.id,
        targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
        handedOffById: owner.id,
      },
    });
    await prisma.projectFileChecklist.create({
      data: {
        projectId,
        handoffId: emptyHandoff.id,
        sourceAttachmentId: finalA.id,
      },
    });
    const emptyReplacement = await markStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: alternateA.id,
    });
    check(
      !isError(emptyReplacement) && emptyReplacement.removedUnusedHandoff,
      "an untouched initialized Stage 5 checklist must be safely reconciled",
    );
    check(
      (await prisma.projectStageFileHandoff.count({ where: { id: emptyHandoff.id } })) === 0,
      "safe replacement must remove only the unused old handoff/checklist",
    );

    const activeHandoff = await prisma.projectStageFileHandoff.create({
      data: {
        projectId,
        sourceWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        sourceAttachmentId: alternateA.id,
        targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
        handedOffById: owner.id,
      },
    });
    const activeChecklist = await prisma.projectFileChecklist.create({
      data: {
        projectId,
        handoffId: activeHandoff.id,
        sourceAttachmentId: alternateA.id,
      },
    });
    await prisma.projectFileChecklistItem.create({
      data: {
        checklistId: activeChecklist.id,
        fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
        value: { text: "Meaningful Stage 5 work" },
        status: "FILLED",
        updatedById: owner.id,
      },
    });
    const protectedReplacement = await markStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(
      isError(protectedReplacement) &&
        protectedReplacement.error ===
          "This final file already has Stage 5 activity and cannot be replaced directly.",
      "meaningful Stage 5 activity must block replacement",
    );
    check(
      (await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: conceptA.id } }))
        .approvedAttachmentId === alternateA.id,
      "blocked replacement must preserve the current final designation",
    );
    await prisma.projectStageFileHandoff.delete({ where: { id: activeHandoff.id } });
    const finalReplacement = await markStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(!isError(finalReplacement) && finalReplacement.changed, "replacement must resume after the test activity fixture is removed");
    check(
      !isError(
        await markStageFourFinalApprovedAttachment(coOwner, {
          projectId,
          folderId: conceptB.id,
          attachmentId: finalB.id,
        }),
      ),
      "a second concept must retain its own final file",
    );
    const prematureCompletion = await completeStageFourConcepts(owner, {
      projectId,
    });
    check(
      isError(prematureCompletion) &&
        prematureCompletion.error.includes("Every Stage 4 task") &&
        prematureCompletion.error.includes(conceptC.name),
      "Stage 4 completion must identify and reject concepts still awaiting Final Approval",
    );
    check(
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          },
        },
      })).status === ProjectWorkflowStageStatus.AVAILABLE &&
        (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 0,
      "premature Stage 4 completion must not change workflow state or create handoffs",
    );

    await prisma.projectConceptFolder.update({
      where: { id: conceptC.id },
      data: {
        approvedAttachmentId: foreignFile.id,
        approvedById: owner.id,
        approvedAt: now,
      },
    });
    const invalidCompletion = await completeStageFourConcepts(owner, { projectId });
    check(isError(invalidCompletion), "completion must revalidate every designated final file");
    check(
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          },
        },
      })).status === ProjectWorkflowStageStatus.AVAILABLE &&
        (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 0,
      "an invalid final file must not partially hand off or complete Stage 4",
    );
    await prisma.$transaction([
      prisma.projectConceptFolder.update({
        where: { id: conceptC.id },
        data: {
          approvedAttachmentId: finalC.id,
          approvedById: owner.id,
          approvedAt: now,
        },
      }),
      prisma.projectRevision.update({
        where: { id: revisionC.id },
        data: {
          status: ProjectRevisionStatus.APPROVED,
          reviewedById: owner.id,
          reviewedAt: now,
        },
      }),
      prisma.projectAttachment.update({
        where: { id: finalC.id },
        data: {
          submissionReviewStatus: "APPROVED",
          reviewedById: owner.id,
          reviewedAt: now,
        },
      }),
      prisma.projectStage.update({
        where: { id: taskerC.id },
        data: { status: StageStatus.COMPLETED, completedAt: now },
      }),
    ]);

    const conflictingHandoff = await prisma.projectStageFileHandoff.create({
      data: {
        projectId,
        sourceWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        sourceAttachmentId: briefAttachment.id,
        targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
        handedOffById: owner.id,
      },
    });
    await prisma.projectFileChecklist.create({
      data: {
        projectId,
        handoffId: conflictingHandoff.id,
        sourceAttachmentId: finalA.id,
      },
    });
    const checklistFailure = await completeStageFourConcepts(owner, { projectId });
    check(isError(checklistFailure), "a conflicting checklist must abort Stage 4 completion");
    check(
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
          },
        },
      })).status === ProjectWorkflowStageStatus.LOCKED &&
        (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 1,
      "a checklist failure must not unlock Stage 5 or create partial final handoffs",
    );
    await prisma.projectStageFileHandoff.delete({ where: { id: conflictingHandoff.id } });

    const attachmentCountBeforeCompletion = await prisma.projectAttachment.count({
      where: { id: { in: [finalA.id, finalB.id, finalC.id] } },
    });
    const [completion, concurrentCompletion] = await Promise.all([
      completeStageFourConcepts(coOwner, { projectId }),
      completeStageFourConcepts(superAdmin, { projectId }),
    ]);
    check(!isError(completion) && !isError(concurrentCompletion), "concurrent Stage 4 completion must retry idempotently");
    check(
      (completion.transitioned || concurrentCompletion.transitioned) &&
        completion.finalApprovedCount === 3 &&
        completion.conceptsWithoutFinalFile.length === 0,
      "completion must include all three finally approved concepts",
    );

    const handoffs = await prisma.projectStageFileHandoff.findMany({
      where: { projectId },
      include: { checklist: true },
      orderBy: { sourceAttachmentId: "asc" },
    });
    check(
      handoffs.length === 3 &&
        handoffs.every((handoff) => handoff.checklist) &&
        new Set(handoffs.map((handoff) => handoff.sourceAttachmentId)).size === 3 &&
        handoffs.every((handoff) =>
          [finalA.id, finalB.id, finalC.id].includes(handoff.sourceAttachmentId),
        ),
      "only final-approved files must receive one handoff and one checklist each",
    );
    check(
      attachmentCountBeforeCompletion === 3 &&
        (await prisma.projectAttachment.count({
          where: { id: { in: [finalA.id, finalB.id, finalC.id] } },
        })) === 3,
      "handoff must reuse original ProjectAttachment rows without binary duplication",
    );

    const workflow = await prisma.projectWorkflowStage.findMany({
      where: {
        projectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            ProjectWorkflowStageKey.FINAL_LAYOUT,
            ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
            ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
          ],
        },
      },
      select: { stageKey: true, status: true, completedAt: true, unlockedAt: true },
    });
    const stageFour = workflow.find(
      (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    );
    const stageFive = workflow.find(
      (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
    );
    check(
      stageFour?.status === ProjectWorkflowStageStatus.COMPLETED &&
        stageFour.completedAt !== null &&
        stageFive?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        stageFive.unlockedAt !== null &&
        workflow
          .filter((stage) =>
            stage.stageKey === ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER ||
            stage.stageKey ===
              ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
          )
          .every((stage) => stage.status === ProjectWorkflowStageStatus.LOCKED),
      "Stage 4 must complete, Stage 5 must unlock, and Stage 6/7 must stay locked",
    );

    const firstUnlockedAt = stageFive.unlockedAt!.getTime();
    const repeatedCompletion = await completeStageFourConcepts(superAdmin, { projectId });
    check(!isError(repeatedCompletion) && !repeatedCompletion.transitioned, "completion retry must be idempotent");
    check(
      (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 3 &&
        (await prisma.projectFileChecklist.count({ where: { projectId } })) === 3 &&
        (await prisma.projectWorkflowStage.findUniqueOrThrow({
          where: {
            projectId_stageKey: {
              projectId,
              stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
            },
          },
        })).unlockedAt?.getTime() === firstUnlockedAt,
      "retry must not duplicate handoffs/checklists or reset Stage 5 unlockedAt",
    );

    const lockedReplacement = await markStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: alternateA.id,
    });
    check(isError(lockedReplacement), "final designation must lock after Stage 4 completion");
    const [completedStageFourEligibility, completedStageFourContext, executorEligibility] =
      await Promise.all([
        getConceptApprovalRevocationEligibility(owner, {
          projectId,
          folderId: conceptA.id,
          workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
        getProjectConceptChatContext(owner, {
          projectId,
          folderId: conceptA.id,
          stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
        getConceptApprovalRevocationEligibility(executor, {
          projectId,
          folderId: conceptA.id,
          workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
      ]);
    check(
      completedStageFourEligibility.canRevoke &&
        completedStageFourContext?.chatMode.isWorkflowCompleted === true &&
        completedStageFourContext.chatMode.approvalRevocationEligibility.canRevoke,
      "an authorized reviewer must see Revoke Approval on completed Stage 4 when only empty initialized handoffs/checklists exist",
    );
    check(
      !executorEligibility.canRevoke && executorEligibility.reason === "UNAUTHORIZED",
      "an assigned USER executor must not receive Stage 4 revocation eligibility",
    );
    const completedStageRevocation =
      await revokeStageFourFinalApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.id,
      });
    check(
      !isError(completedStageRevocation) &&
        completedStageRevocation.reopensWorkflowStage,
      "final approval revocation must safely reopen completed Stage 4 before Stage 5 work begins",
    );
    const revokedStageFourEligibility =
      await getConceptApprovalRevocationEligibility(owner, {
        projectId,
        folderId: conceptA.id,
        workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      });
    check(
      !revokedStageFourEligibility.canRevoke &&
        revokedStageFourEligibility.reason === "NOT_APPROVED",
      "a revoked Stage 4 concept must no longer expose Revoke Approval",
    );
    const reopenedWorkflow = await prisma.projectWorkflowStage.findMany({
      where: {
        projectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            ProjectWorkflowStageKey.FINAL_LAYOUT,
          ],
        },
      },
      select: { stageKey: true, status: true },
    });
    check(
      reopenedWorkflow.find(
        (stage) =>
          stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      )?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        reopenedWorkflow.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
        )?.status === ProjectWorkflowStageStatus.LOCKED,
      "safe revocation must reopen Stage 4 and relock Stage 5",
    );
    const restoredCompletedApproval =
      await markStageFourFinalApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.id,
        attachmentId: finalA.id,
      });
    check(
      !isError(restoredCompletedApproval) && restoredCompletedApproval.changed,
      "the safely reopened final submission must be approvable again",
    );
    const restoredCompletion = await completeStageFourConcepts(owner, { projectId });
    check(
      !isError(restoredCompletion) && restoredCompletion.transitioned,
      "Stage 4 must complete again after the restored approval",
    );
    const reapprovedStageFourEligibility =
      await getConceptApprovalRevocationEligibility(owner, {
        projectId,
        folderId: conceptA.id,
        workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      });
    check(
      reapprovedStageFourEligibility.canRevoke,
      "a re-approved completed Stage 4 concept must expose Revoke Approval while its initialized Stage 5 handoff remains untouched",
    );

    const stageFiveData = await getStageFiveWorkspaceData(owner, projectId);
    check(
      stageFiveData?.files.length === 3 &&
        stageFiveData.files.every((file) =>
          [finalA.id, finalB.id, finalC.id].includes(file.sourceAttachment.id),
        ),
      "Stage 5 selector must immediately show the real final-approved files",
    );
    const handoffA = stageFiveData.files.find(
      (file) => file.sourceAttachment.id === finalA.id,
    )!;
    const handoffB = stageFiveData.files.find(
      (file) => file.sourceAttachment.id === finalB.id,
    )!;
    const saved = await saveStageFiveChecklist(owner, {
      projectId,
      handoffId: handoffA.handoffId,
      items: [
        {
          fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
          value: { text: "Final A output" },
          attachmentIds: [],
        },
      ],
    });
    check(!isError(saved), "existing Stage 5 Edit persistence must work for a real final handoff");
    const [activeStageFourEligibility, activeStageFourContext] =
      await Promise.all([
        getConceptApprovalRevocationEligibility(owner, {
          projectId,
          folderId: conceptA.id,
          workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
        getProjectConceptChatContext(owner, {
          projectId,
          folderId: conceptA.id,
          stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
      ]);
    check(
      activeStageFourEligibility.canRevoke &&
        activeStageFourContext?.chatMode.approvalRevocationEligibility.canRevoke === true,
      "ongoing Stage 5 checklist activity must keep Stage 4 Revoke Approval visible until Stage 5 is completed",
    );
    const selectedB = await getStageFiveWorkspaceData(owner, projectId, handoffB.handoffId);
    check(
      selectedB?.files
        .find((file) => file.handoffId === handoffB.handoffId)
        ?.items.find((item) => item.fieldKey === ProjectFileChecklistField.OUTPUT_NAME)
        ?.value.text !== "Final A output",
      "Checklist A values must not leak into Checklist B",
    );

    const activeStageFiveRevocation =
      await revokeStageFourFinalApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.id,
      });
    check(
      !isError(activeStageFiveRevocation) &&
        activeStageFiveRevocation.reopensWorkflowStage &&
        activeStageFiveRevocation.resetThroughStageFive &&
        activeStageFiveRevocation.removedStageFiveHandoff,
      "Stage 4 revocation must remain available while Stage 5 is ongoing and reset its dependent handoff",
    );
    const [revokedWorkflow, remainingHandoffs] = await Promise.all([
      prisma.projectWorkflowStage.findMany({
        where: {
          projectId,
          stageKey: {
            in: [
              ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
              ProjectWorkflowStageKey.FINAL_LAYOUT,
            ],
          },
        },
        select: { stageKey: true, status: true },
      }),
      prisma.projectStageFileHandoff.findMany({
        where: { projectId },
        select: { id: true, sourceAttachmentId: true },
      }),
    ]);
    check(
      revokedWorkflow.find(
        (stage) =>
          stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      )?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        revokedWorkflow.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
        )?.status === ProjectWorkflowStageStatus.LOCKED &&
        remainingHandoffs.length === 2 &&
        !remainingHandoffs.some((handoff) => handoff.id === handoffA.handoffId) &&
        remainingHandoffs.some((handoff) => handoff.id === handoffB.handoffId),
      "active Stage 5 revocation must relock Stage 5 and remove only the revoked final file's downstream work",
    );

    const restoredActiveFinal = await markStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: finalA.id,
    });
    check(
      !isError(restoredActiveFinal) && restoredActiveFinal.changed,
      "the final file must be approvable again after active Stage 5 revocation",
    );
    const restoredActiveStageFour = await completeStageFourConcepts(owner, {
      projectId,
    });
    check(
      !isError(restoredActiveStageFour) && restoredActiveStageFour.transitioned,
      "Stage 4 must complete again and recreate the revoked Stage 5 handoff",
    );
    const restoredStageFiveData = await getStageFiveWorkspaceData(owner, projectId);
    const restoredHandoffA = restoredStageFiveData?.files.find(
      (file) => file.sourceAttachment.id === finalA.id,
    );
    check(
      Boolean(restoredHandoffA) &&
        restoredHandoffA?.handoffId !== handoffA.handoffId,
      "reapproval must create a fresh Stage 5 handoff for the restored final file",
    );
    const restoredChecklist = await saveStageFiveChecklist(owner, {
      projectId,
      handoffId: restoredHandoffA!.handoffId,
      items: [
        {
          fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
          value: { text: "Restored Final A output" },
          attachmentIds: [],
        },
      ],
    });
    check(
      !isError(restoredChecklist),
      "Stage 5 work must resume on the fresh handoff after Stage 4 is completed again",
    );

    await notifyStageFiveActivated({
      projectId,
      finalFileCount: 3,
      actorId: superAdmin.id,
    });
    const stageFiveNotificationRecipients = await prisma.notification.findMany({
      where: { projectId, title: "Stage 5 available" },
      select: { userId: true },
    });
    check(
      stageFiveNotificationRecipients.some((item) => item.userId === owner.id) &&
        stageFiveNotificationRecipients.some((item) => item.userId === coOwner.id) &&
        !stageFiveNotificationRecipients.some((item) => item.userId === executor.id) &&
        !stageFiveNotificationRecipients.some((item) => item.userId === collaborator.id),
      "Stage 5 activation notification must stay owner/co-owner scoped",
    );

    const legacySubmission = await createAttachment({
      id: `round-four-legacy-${runId}`,
      stageId: taskerA.id,
      revisionId: revisionA.id,
      assetType: AttachmentAssetType.STAGE_SUBMISSION,
      name: "legacy-tasker-approval.png",
    });
    await expectRejected(
      reviewStageSubmission(owner, {
        attachmentId: legacySubmission.id,
        status: "APPROVED",
      }),
      "legacy tasker Approve Submission must remain blocked",
    );
    check(
      (await prisma.projectCompletionWorkflow.count({ where: { projectId } })) === 0,
      "Round 4 must not initialize completion/archive workflow",
    );

    const completedStageFive = await completeStageFive(owner, { projectId });
    check(
      !isError(completedStageFive) &&
        completedStageFive.transitioned &&
        completedStageFive.productionUnitCount === 3,
      "Stage 5 completion must create untouched Stage 6 bootstrap units",
    );
    const [completedStageFiveEligibility, completedStageFiveContext] =
      await Promise.all([
        getConceptApprovalRevocationEligibility(owner, {
          projectId,
          folderId: conceptA.id,
          workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
        getProjectConceptChatContext(owner, {
          projectId,
          folderId: conceptA.id,
          stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        }),
      ]);
    check(
      !completedStageFiveEligibility.canRevoke &&
        completedStageFiveEligibility.reason === "STAGE5_DEPENDENCY_EXISTS" &&
        completedStageFiveContext?.chatMode.approvalRevocationEligibility
          .canRevoke === false,
      "completed Stage 5 must hide Stage 4 Revoke Approval before Stage 6 work begins",
    );
    const completedStageFiveRevocation =
      await revokeStageFourFinalApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.id,
      });
    check(
      isError(completedStageFiveRevocation) &&
        completedStageFiveRevocation.error.includes("Stage 5 is already completed"),
      "Stage 5 completion must be the server-enforced cutoff for Stage 4 revocation",
    );
    const stageSixUnit = await prisma.projectProductionUnit.findFirstOrThrow({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    await prisma.projectProductionUnit.update({
      where: { id: stageSixUnit.id },
      data: { status: ProjectProductionUnitStatus.APPROVAL_PENDING },
    });
    const blockedStageThreeRework =
      await revokeProjectConceptApprovedAttachment(owner, {
        projectId,
        folderId: stageThreeConcept.id,
      });
    check(
      isError(blockedStageThreeRework) &&
        blockedStageThreeRework.error.includes(
          "Stage 6 production work has already started",
        ),
      "Stage 3 rework must stop after Stage 6 production activity begins",
    );
    await prisma.projectProductionUnit.update({
      where: { id: stageSixUnit.id },
      data: { status: ProjectProductionUnitStatus.PREPARATION },
    });

    const completedStageFiveRework =
      await revokeProjectConceptApprovedAttachment(owner, {
        projectId,
        folderId: stageThreeConcept.id,
      });
    check(
      !isError(completedStageFiveRework) &&
        completedStageFiveRework.reopensWorkflowStage &&
        completedStageFiveRework.resetThroughStageFive &&
        completedStageFiveRework.cascadedStageFourApproval &&
        completedStageFiveRework.removedStageFiveHandoff,
      "completed Stage 5 must still allow Stage 3 rework while Stage 6 is untouched",
    );
    const [reworkWorkflow, resetStageFourConcept] = await Promise.all([
      prisma.projectWorkflowStage.findMany({
        where: {
          projectId,
          stageKey: {
            in: [
              ProjectWorkflowStageKey.CONCEPT_CREATION,
              ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
              ProjectWorkflowStageKey.FINAL_LAYOUT,
              ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER,
              ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
            ],
          },
        },
        select: { stageKey: true, status: true },
      }),
      prisma.projectConceptFolder.findUniqueOrThrow({
        where: { id: conceptA.id },
        select: {
          approvedAttachmentId: true,
          sourceStage3ApprovedAttachmentId: true,
          taskerStage: { select: { status: true } },
        },
      }),
    ]);
    check(
      reworkWorkflow.find(
        (stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
      )?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        reworkWorkflow
          .filter(
            (stage) =>
              stage.stageKey !== ProjectWorkflowStageKey.CONCEPT_CREATION,
          )
          .every((stage) => stage.status === ProjectWorkflowStageStatus.LOCKED),
      "Stage 3 rework must restore one available stage followed by a locked suffix",
    );
    check(
      resetStageFourConcept.approvedAttachmentId === null &&
        resetStageFourConcept.sourceStage3ApprovedAttachmentId === sourceFile.id &&
        resetStageFourConcept.taskerStage.status === StageStatus.ONGOING &&
        (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 2 &&
        (await prisma.projectFileChecklist.count({ where: { projectId } })) === 2 &&
        (await prisma.projectProductionUnit.count({ where: { projectId } })) === 2,
      "Stage 3 rework must reset only its dependent Stage 4 and Stage 5/6 lineage",
    );
    const reapprovedStageThree = await markProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: stageThreeConcept.id,
      attachmentId: sourceFile.id,
    });
    check(
      !isError(reapprovedStageThree) &&
        reapprovedStageThree.changed &&
        (await prisma.projectConceptFolder.findUniqueOrThrow({
          where: { id: conceptA.id },
          select: { sourceStage3ApprovedAttachmentId: true },
        })).sourceStage3ApprovedAttachmentId === sourceFile.id,
      "reapproving Stage 3 must relink the dependent Stage 4 starting reference",
    );
  } finally {
    await prisma.project.deleteMany({
      where: {
        id: {
          in: [
            projectId,
            foreignProjectId,
            skipProjectId,
            stageThreeFallbackProjectId,
          ],
        },
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Stage 3/4 Round 4 final-file and Stage 5 handoff integration checks passed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

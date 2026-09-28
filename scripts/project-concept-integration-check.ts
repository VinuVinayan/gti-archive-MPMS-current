import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import {
  completeStageThreeConcepts,
  createProjectConceptFolder as createProjectConceptFolderService,
  deleteProjectConceptFolder,
  editProjectConceptFolder,
  getProjectConceptChatContext,
  getProjectConceptFolders,
  importStageThreeConceptReference,
  markProjectConceptApprovedAttachment,
  revokeProjectConceptApprovedAttachment,
} from "../src/lib/project-concepts";
import {
  canCompleteProjectConceptStage,
  canManageProjectConcept,
  canReviewProjectConcept,
  canViewProjectConcept,
  canWorkOnProjectConcept,
  getProjectConceptAccessContext,
} from "../src/lib/project-concept-access";
import {
  createComparisonComment,
  getComparisonCommentsForPair,
} from "../src/lib/comparison";
import {
  assertProjectAttachmentVisibilityForUser,
  createStageRevision,
  createStageTextCommentFast,
  deleteAttachmentForUser,
  getProjectStageChatMessages,
  reviewProjectRevision,
  reviewStageSubmission,
  startProjectStageWork,
} from "../src/lib/project-history";
import {
  notifyConceptBriefAssigned,
  notifyConceptFileApproved,
  notifyStageFourConceptsActivated,
} from "../src/lib/notification-center/triggers";
import { getVisibleStageEventRecipientUserIds } from "../src/lib/notification-center/recipients";
import { prisma } from "../src/lib/prisma";
import {
  getInitialProjectWorkflowStageData,
  PROJECT_WORKFLOW_STAGE_DEFINITIONS,
} from "../src/lib/project-workflow";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Concept Round 1/2 integration check failed: ${message}`);
}

function isErrorResult(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

function futureConceptDeadline() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
}

async function createProjectConceptFolder(
  user: Parameters<typeof createProjectConceptFolderService>[0],
  input: Omit<
    Parameters<typeof createProjectConceptFolderService>[1],
    "briefAttachmentIds" | "deadline"
  > & { deadline?: string },
) {
  const attachmentId = randomUUID();
  await prisma.projectAttachment.create({
    data: {
      id: attachmentId,
      projectId: input.projectId,
      uploadedById: user.id,
      fileName: `${attachmentId}.pdf`,
      originalFileName: "concept-brief.pdf",
      mimeType: "application/pdf",
      fileSize: 128,
      bucket: "integration-test",
      storageKey: `integration/concept-brief/${attachmentId}.pdf`,
      assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
      status: AttachmentStatus.READY,
    },
  });

  return createProjectConceptFolderService(user, {
    ...input,
    deadline: input.deadline ?? futureConceptDeadline(),
    briefAttachmentIds: [attachmentId],
  });
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

function workflowAt(currentStageKey: ProjectWorkflowStageKey) {
  const currentIndex = PROJECT_WORKFLOW_STAGE_DEFINITIONS.findIndex(
    (definition) => definition.key === currentStageKey,
  );
  const now = new Date();
  return getInitialProjectWorkflowStageData(now).map((stage, index) => ({
    ...stage,
    status:
      index < currentIndex
        ? ProjectWorkflowStageStatus.COMPLETED
        : index === currentIndex
          ? ProjectWorkflowStageStatus.AVAILABLE
          : ProjectWorkflowStageStatus.LOCKED,
    unlockedAt: index <= currentIndex ? now : null,
    completedAt: index < currentIndex ? now : null,
  }));
}

async function main() {
  const runId = randomUUID();
  const projectId = `concept-round-one-${runId}`;
  const foreignProjectId = `concept-round-two-foreign-${runId}`;
  const conflictProjectId = `concept-round-three-conflict-${runId}`;
  const optionalStageThreeProjectId = `concept-round-three-optional-${runId}`;
  const userSpecs = [
    ["super", UserRole.SUPER_ADMIN],
    ["owner", UserRole.ADMIN],
    ["coowner", UserRole.ADMIN],
    ["executor-a", UserRole.USER],
    ["executor-b", UserRole.USER],
    ["collaborator", UserRole.USER],
    ["admin-outsider", UserRole.ADMIN],
  ] as const;
  const userIds = userSpecs.map(([label]) => `concept-${label}-${runId}`);

  try {
    await prisma.user.createMany({
      data: userSpecs.map(([label, role], index) => ({
        id: userIds[index],
        email: `${label}-${runId}@example.test`,
        name: label.replaceAll("-", " "),
        passwordHash: "round-one-test-only",
        role,
      })),
    });
    const [superAdmin, owner, coOwner, executorA, executorB, collaborator, adminOutsider] =
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

    await prisma.project.create({
      data: {
        id: projectId,
        name: `Concept Round 1 ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        coOwners: { create: [{ userId: coOwner.id, addedById: superAdmin.id }] },
        executors: {
          create: [
            { userId: executorA.id, addedById: owner.id },
            { userId: executorB.id, addedById: owner.id },
          ],
        },
        collaborators: {
          create: [{ userId: collaborator.id, addedById: owner.id }],
        },
        workflowStages: {
          create: workflowAt(ProjectWorkflowStageKey.CONCEPT_CREATION),
        },
      },
    });

    const countBeforeReads = await prisma.projectConceptFolder.count({ where: { projectId } });
    const emptyStageThree = await getProjectConceptFolders(
      owner,
      projectId,
      ProjectWorkflowStageKey.CONCEPT_CREATION,
    );
    const emptyStageFour = await getProjectConceptFolders(
      superAdmin,
      projectId,
      ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    );
    check(emptyStageThree?.folders.length === 0, "Stage 3 must render an empty state");
    check(emptyStageFour === null, "locked Stage 4 must not expose its workspace");
    check(
      (await prisma.projectConceptFolder.count({ where: { projectId } })) === countBeforeReads,
      "reading Stage 3/4 must not create Concept 1",
    );

    const missingExecutor = await createProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Concept 1",
      assignedExecutorId: "",
      brief: "First direction",
    });
    check(isErrorResult(missingExecutor), "new concepts must require an executor");

    const invalidExecutor = await createProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Concept 1",
      assignedExecutorId: collaborator.id,
      brief: "First direction",
    });
    check(isErrorResult(invalidExecutor), "a normal collaborator cannot be assigned");

    const missingBrief = await createProjectConceptFolderService(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Missing Brief",
      assignedExecutorId: executorA.id,
      deadline: futureConceptDeadline(),
      brief: "  ",
      briefAttachmentIds: [],
    });
    check(isErrorResult(missingBrief), "new concepts must require a brief");

    const missingAttachment = await createProjectConceptFolderService(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Missing Attachment",
      assignedExecutorId: executorA.id,
      deadline: futureConceptDeadline(),
      brief: "A valid brief without a file",
      briefAttachmentIds: [],
    });
    check(!isErrorResult(missingAttachment), "new concepts must allow an optional brief attachment");
    check(missingAttachment.folder.canDelete, "the task creator must receive delete access");
    const nonCreatorDelete = await deleteProjectConceptFolder(coOwner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      folderId: missingAttachment.folder.id,
    });
    check(isErrorResult(nonCreatorDelete), "a non-creator must not delete a concept task");
    const creatorDelete = await deleteProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      folderId: missingAttachment.folder.id,
    });
    check(!isErrorResult(creatorDelete), "the creator must delete their Stage 3 task");
    check(
      (await prisma.projectConceptFolder.count({
        where: { id: missingAttachment.folder.id },
      })) === 0 &&
        (await prisma.projectStage.count({
          where: { id: missingAttachment.folder.taskerStageId },
        })) === 0,
      "task deletion must remove both its concept record and tasker stage",
    );

    const conceptA = await createProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "  Concept   1  ",
      assignedExecutorId: executorA.id,
      brief: "  First direction  ",
    });
    check(!isErrorResult(conceptA), "owner must create a concept");
    const taskerA = await prisma.projectStage.findUniqueOrThrow({
      where: { id: conceptA.folder.taskerStageId },
    });
    check(
      taskerA.description === "<p>First direction</p>",
      "rich-text brief must use ProjectStage.description",
    );
    check(taskerA.actualStartedAt === null, "new tasker must not be accepted automatically");
    check(taskerA.startedById === null, "new tasker starter must remain null");
    check(taskerA.status === StageStatus.ONGOING, "new tasker must remain ONGOING");
    check(!taskerA.invoiceRequired, "concept taskers must not require invoices");

    await notifyConceptBriefAssigned({
      projectId,
      folderId: conceptA.folder.id,
      actorId: owner.id,
    });
    const briefAssignmentNotifications = await prisma.notification.findMany({
      where: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        type: "BRIEF_ACCEPTANCE_REQUIRED",
      },
      select: {
        userId: true,
        entityId: true,
        url: true,
      },
    });
    check(
      briefAssignmentNotifications.length === 1 &&
        briefAssignmentNotifications[0].userId === executorA.id &&
        briefAssignmentNotifications[0].entityId === conceptA.folder.taskerStageId &&
        briefAssignmentNotifications[0].url ===
          `/projects/${projectId}/stages/3/concepts/${conceptA.folder.id}`,
      "a new concept brief must notify only its assigned executor and open its Stage 3 chat",
    );

    const duplicate = await createProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: " concept 1 ",
      assignedExecutorId: executorA.id,
      brief: "Duplicate direction",
    });
    check(isErrorResult(duplicate), "normalized duplicate names must be rejected");

    const conceptB = await createProjectConceptFolder(coOwner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Concept 2",
      assignedExecutorId: executorB.id,
      brief: "Second direction",
    });
    check(!isErrorResult(conceptB), "co-owner must create a concept");

    const stageFourTasker = await prisma.projectStage.create({
      data: {
        projectId,
        name: "Final Concept Direction",
        description: "Stage 4 final concept brief",
        invoiceRequired: false,
        isTasker: true,
        actualStartedAt: null,
        startedById: null,
        status: StageStatus.ONGOING,
        order: 4_001,
      },
    });
    const stageFourConcept = await prisma.projectConceptFolder.create({
      data: {
        projectId,
        workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        taskerStageId: stageFourTasker.id,
        assignedExecutorId: executorA.id,
        name: "Final Concept Direction",
        normalizedName: "final concept direction",
        sortOrder: 1,
        createdById: owner.id,
      },
    });
    const stageFourContext = await getProjectConceptChatContext(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      folderId: stageFourConcept.id,
    });
    check(stageFourContext === null, "a direct Stage 4 concept URL must be blocked while Stage 3 is current");

    const ownerView = await getProjectConceptFolders(owner, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION);
    const coOwnerView = await getProjectConceptFolders(coOwner, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION);
    const superView = await getProjectConceptFolders(superAdmin, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION);
    const executorAView = await getProjectConceptFolders(executorA, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION);
    const executorATamperedView = await getProjectConceptFolders(
      executorA,
      projectId,
      ProjectWorkflowStageKey.CONCEPT_CREATION,
      { executorId: executorB.id },
    );
    check(ownerView?.folders.length === 2, "owner must see every concept");
    check(coOwnerView?.folders.length === 2, "co-owner must see every concept");
    check(superView?.folders.length === 2, "SUPER_ADMIN must see every concept");
    check(ownerView?.canCompleteStage, "owner must be able to complete the concept stage");
    check(superView?.canCompleteStage, "SUPER_ADMIN must be able to complete the concept stage");
    check(
      coOwnerView?.canCompleteStage === true,
      "ADMIN co-owners receive global stage completion authority",
    );
    check(
      executorAView?.folders.length === 1 && executorAView.folders[0].id === conceptA.folder.id,
      "executor A must see only its assigned concept",
    );
    check(
      executorAView.canCompleteStage === false,
      "assigned executor must not receive stage completion permission",
    );
    check(
      executorATamperedView?.folders.length === 1 &&
        executorATamperedView.folders[0].id === conceptA.folder.id &&
        !executorATamperedView.canManage,
      "executor query tampering must not broaden access or expose the switcher",
    );
    check(
      (await getProjectConceptFolders(collaborator, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION)) === null,
      "normal collaborator must be denied",
    );
    check(
      (await getProjectConceptFolders(adminOutsider, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION)) !== null,
      "ADMIN receives global concept access",
    );

    const accessA = await getProjectConceptAccessContext({
      projectId,
      folderId: conceptA.folder.id,
    });
    check(accessA, "concept access context must resolve");
    check(canManageProjectConcept(owner, accessA), "owner must manage concepts");
    check(canManageProjectConcept(coOwner, accessA), "co-owner must manage concepts");
    check(
      canCompleteProjectConceptStage(owner, accessA),
      "owner must complete concept stages",
    );
    check(
      canCompleteProjectConceptStage(superAdmin, accessA),
      "SUPER_ADMIN must complete concept stages",
    );
    check(
      canCompleteProjectConceptStage(coOwner, accessA) &&
        !canCompleteProjectConceptStage(executorA, accessA),
      "ADMIN co-owners can complete concept stages while executors cannot",
    );
    check(canReviewProjectConcept(owner, accessA), "owner must review concepts");
    check(canReviewProjectConcept(coOwner, accessA), "co-owner must review concepts");
    check(
      !canReviewProjectConcept(executorA, accessA),
      "assigned executor must not review concepts",
    );
    check(
      !canReviewProjectConcept(owner, {
        ...accessA,
        assignedExecutorId: owner.id,
      }),
      "an assigned executor must not review their own concept even when they also manage the project",
    );
    check(canViewProjectConcept(superAdmin, accessA), "SUPER_ADMIN must view concepts");
    check(canWorkOnProjectConcept(executorA, accessA), "assigned executor must work");
    check(!canViewProjectConcept(executorB, accessA), "other executor must not view");
    check(canViewProjectConcept(adminOutsider, accessA), "ADMIN must view globally");

    const [ownerChatContext, coOwnerChatContext, superChatContext, executorChatContext] =
      await Promise.all(
        [owner, coOwner, superAdmin, executorA].map((actor) =>
          getProjectConceptChatContext(actor, {
            projectId,
            stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
            folderId: conceptA.folder.id,
          }),
        ),
      );
    check(executorChatContext, "assigned executor must open its folder route");
    check(
      ownerChatContext?.chatMode.canReview &&
        coOwnerChatContext?.chatMode.canReview &&
        superChatContext?.chatMode.canReview,
      "owner, co-owner, and SUPER_ADMIN must receive concept review UI",
    );
    check(
      !executorChatContext.chatMode.canReview &&
        executorChatContext.chatMode.isAssignedExecutor,
      "assigned executor must receive work controls without review controls",
    );
    check(
      ownerChatContext?.chatMode.stageLabel === "Stage 3 - Initial Concept" &&
        ownerChatContext.chatMode.conceptName === conceptA.folder.name &&
        ownerChatContext.chatMode.assignedExecutor?.id === executorA.id,
      "Stage 3 concept context must include stage, concept, and assigned executor",
    );
    check(
      (await getProjectConceptChatContext(executorA, {
        projectId,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        folderId: conceptB.folder.id,
      })) === null,
      "executor must not guess another folder URL",
    );
    await expectRejected(
      getProjectStageChatMessages(executorA, projectId, conceptB.folder.taskerStageId),
      "executor must not guess another taskerStageId",
    );

    await expectRejected(
      createStageRevision(executorA, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        summary: "Must not submit before acceptance",
        attachmentIds: [],
      }),
      "assigned executor must not submit before accepting the brief",
    );
    check(
      (await prisma.projectRevision.count({
        where: { projectId, stageId: conceptA.folder.taskerStageId },
      })) === 0,
      "a rejected pre-acceptance submission must not create a revision",
    );

    await expectRejected(
      startProjectStageWork(executorB, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
      }),
      "other executor must not accept the concept",
    );
    await startProjectStageWork(executorA, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
    });
    const startedA = await prisma.projectStage.findUniqueOrThrow({
      where: { id: conceptA.folder.taskerStageId },
    });
    check(startedA.actualStartedAt !== null, "acceptance must set actualStartedAt");
    check(startedA.startedById === executorA.id, "acceptance must record assigned executor");

    await expectRejected(
      createStageRevision(executorA, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        summary: "Empty concept revision",
        attachmentIds: [],
      }),
      "accepted concept revisions must still require a file",
    );
    const incompleteUpload = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        uploadedById: executorA.id,
        fileName: `incomplete-concept-${runId}.png`,
        originalFileName: "incomplete-concept.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/incomplete-concept.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.UPLOADING,
      },
    });
    await expectRejected(
      createStageRevision(executorA, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        summary: "Upload did not finish",
        attachmentIds: [incompleteUpload.id],
      }),
      "an unfinished upload must not become a reviewable revision",
    );
    check(
      (await prisma.projectRevision.count({
        where: { projectId, stageId: conceptA.folder.taskerStageId },
      })) === 0,
      "a failed file validation must not leave a false pending revision",
    );

    const firstRevisionFile = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        uploadedById: executorA.id,
        fileName: `concept-revision-one-${runId}.png`,
        originalFileName: "concept-revision-one.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/concept-revision-one.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
      },
    });
    await expectRejected(
      createStageRevision(executorB, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        summary: "Unauthorized concept work",
        attachmentIds: [firstRevisionFile.id],
      }),
      "a non-assigned executor must not submit through the server service",
    );
    const firstRevision = await createStageRevision(executorA, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      summary: "First valid concept submission",
      attachmentIds: [firstRevisionFile.id],
    });
    check(
      firstRevision.status === ProjectRevisionStatus.PENDING_REVIEW,
      "a valid file-backed revision must become PENDING_REVIEW",
    );
    check(
      (await prisma.projectAttachment.findUniqueOrThrow({
        where: { id: firstRevisionFile.id },
      })).revisionId === firstRevision.id,
      "the READY file must be atomically linked to its revision",
    );

    const lockedEdit = await editProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      folderId: conceptA.folder.id,
      name: "Renamed Accepted Concept",
      assignedExecutorId: executorB.id,
      brief: "Changed after acceptance",
    });
    check(isErrorResult(lockedEdit), "accepted assignment and brief must be locked");
    const renameOnly = await editProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      folderId: conceptA.folder.id,
      name: "Renamed Accepted Concept",
    });
    check(!isErrorResult(renameOnly), "safe display rename may remain available");
    check(
      renameOnly.folder.taskerStageId === conceptA.folder.taskerStageId,
      "rename must preserve tasker/chat identity",
    );

    await startProjectStageWork(executorB, {
      projectId,
      stageId: conceptB.folder.taskerStageId,
    });
    const commentA = await createStageTextCommentFast(executorA, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      body: `Only concept A ${runId}`,
      mentionedUserIds: [owner.id, coOwner.id, executorB.id, collaborator.id],
    });
    const commentB = await createStageTextCommentFast(executorB, {
      projectId,
      stageId: conceptB.folder.taskerStageId,
      body: `Only concept B ${runId}`,
    });
    check(
      commentA.mentions.some((mention) => mention.mentionedUserId === owner.id) &&
        commentA.mentions.some((mention) => mention.mentionedUserId === coOwner.id) &&
        !commentA.mentions.some((mention) => mention.mentionedUserId === executorB.id) &&
        !commentA.mentions.some((mention) => mention.mentionedUserId === collaborator.id),
      "concept mentions must be owner/co-owner/assigned-executor scoped",
    );
    const historyA = await getProjectStageChatMessages(
      executorA,
      projectId,
      conceptA.folder.taskerStageId,
      { includeWorkflowCards: "never" },
    );
    check(
      historyA.entries.some((entry) => entry.id === commentA.id) &&
        !historyA.entries.some((entry) => entry.id === commentB.id),
      "concept messages must remain isolated by taskerStageId",
    );

    const attachmentA = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        uploadedById: owner.id,
        fileName: `concept-a-${runId}.txt`,
        originalFileName: "concept-a.txt",
        mimeType: "text/plain",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/concept-a.txt`,
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
        status: AttachmentStatus.READY,
      },
    });
    await assertProjectAttachmentVisibilityForUser(owner, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      createdAt: attachmentA.createdAt,
      project: { ownerId: owner.id, coOwners: [{ userId: coOwner.id }] },
    });
    await expectRejected(
      assertProjectAttachmentVisibilityForUser(executorB, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        createdAt: attachmentA.createdAt,
        project: { ownerId: owner.id, coOwners: [{ userId: coOwner.id }] },
      }),
      "another executor must not retrieve a concept attachment",
    );

    const recipients = await getVisibleStageEventRecipientUserIds(projectId, new Date(), {
      stageId: conceptA.folder.taskerStageId,
      excludeUserId: executorA.id,
    });
    check(recipients.includes(owner.id) && recipients.includes(coOwner.id), "concept notifications must include managers");
    check(!recipients.includes(executorB.id), "concept notifications must exclude other executors");
    check(!recipients.includes(collaborator.id), "concept notifications must exclude collaborators");
    check(!recipients.includes(superAdmin.id), "SUPER_ADMIN must not be auto-notified");

    const legacyTaskerSubmission = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        uploadedById: executorA.id,
        fileName: `legacy-tasker-submission-${runId}.png`,
        originalFileName: "legacy-tasker-submission.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/legacy-tasker-submission.png`,
        assetType: AttachmentAssetType.STAGE_SUBMISSION,
        status: AttachmentStatus.READY,
        submissionReviewStatus: "PENDING_REVIEW",
      },
    });
    await expectRejected(
      reviewStageSubmission(owner, {
        attachmentId: legacyTaskerSubmission.id,
        status: "APPROVED",
      }),
      "legacy direct attachment approval must also be blocked for taskers",
    );
    const legacyRejection = await reviewStageSubmission(owner, {
      attachmentId: legacyTaskerSubmission.id,
      status: "REJECTED",
      note: "Request changes through the safe legacy path.",
    });
    check(
      legacyRejection.submissionReviewStatus === "REJECTED",
      "legacy attachment rejection must remain available",
    );

    await expectRejected(
      reviewProjectRevision(owner, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        revisionId: firstRevision.id,
        status: "APPROVED",
      }),
      "legacy tasker approval must be blocked",
    );
    const stillPending = await prisma.projectRevision.findUniqueOrThrow({
      where: { id: firstRevision.id },
    });
    check(stillPending.status === ProjectRevisionStatus.PENDING_REVIEW, "blocked approval must not mutate revision");
    check(
      (await prisma.projectCompletionWorkflow.count({ where: { projectId } })) === 0,
      "blocked tasker approval must not initialize project completion",
    );
    await expectRejected(
      reviewProjectRevision(collaborator, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        revisionId: firstRevision.id,
        status: "REJECTED",
        reason: "Normal collaborators must not review.",
      }),
      "normal collaborators must not review a concept",
    );
    await expectRejected(
      reviewProjectRevision(executorA, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        revisionId: firstRevision.id,
        status: "REJECTED",
        reason: "Executors must not review their own concept.",
      }),
      "assigned executor must not review their own concept",
    );
    const requestedChanges = await reviewProjectRevision(coOwner, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      revisionId: firstRevision.id,
      status: "REJECTED",
      reason: "Please revise this direction.",
    });
    check(requestedChanges.status === ProjectRevisionStatus.REJECTED, "Request Changes must remain available");
    const rejectedRevision = await prisma.projectRevision.findUniqueOrThrow({
      where: { id: firstRevision.id },
    });
    check(
      rejectedRevision.reviewedById === coOwner.id &&
        rejectedRevision.reviewedAt !== null &&
        rejectedRevision.rejectionReason === "<p>Please revise this direction.</p>",
      "Request Changes must persist reviewer, reviewedAt, and reason",
    );
    const requestChangesRecipients = await getVisibleStageEventRecipientUserIds(
      projectId,
      new Date(),
      {
        stageId: conceptA.folder.taskerStageId,
        excludeUserId: coOwner.id,
        includeOwner: false,
        includeExecutor: true,
        includeCollaborators: false,
      },
    );
    check(
      requestChangesRecipients.length === 1 &&
        requestChangesRecipients[0] === executorA.id,
      "Request Changes notifications must target only the assigned executor",
    );

    const secondRevisionFile = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        uploadedById: executorA.id,
        fileName: `concept-revision-two-${runId}.png`,
        originalFileName: "concept-revision-two.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/concept-revision-two.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
      },
    });
    const secondRevision = await createStageRevision(executorA, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      summary: "Second valid concept submission",
      attachmentIds: [secondRevisionFile.id],
    });
    check(
      secondRevision.status === ProjectRevisionStatus.PENDING_REVIEW &&
        secondRevision.revisionNumber === firstRevision.revisionNumber + 1,
      "assigned executor must be able to resubmit after Request Changes",
    );

    await createComparisonComment(owner, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      baseAttachmentId: firstRevisionFile.id,
      compareAttachmentId: secondRevisionFile.id,
      xPercent: 25,
      yPercent: 35,
      body: "Owner review marker",
      opacity: 70,
    });
    await createComparisonComment(coOwner, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      baseAttachmentId: firstRevisionFile.id,
      compareAttachmentId: secondRevisionFile.id,
      xPercent: 55,
      yPercent: 65,
      body: "Co-owner review marker",
      opacity: 60,
    });
    const executorComparison = await getComparisonCommentsForPair(executorA, {
      projectId,
      stageId: conceptA.folder.taskerStageId,
      baseAttachmentId: firstRevisionFile.id,
      compareAttachmentId: secondRevisionFile.id,
    });
    check(
      executorComparison.length === 2,
      "the assigned executor must read manager feedback in the comparison workspace",
    );
    await expectRejected(
      createComparisonComment(executorA, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        baseAttachmentId: firstRevisionFile.id,
        compareAttachmentId: secondRevisionFile.id,
        xPercent: 20,
        yPercent: 20,
        body: "Executor must not create this marker",
      }),
      "assigned executor must not create concept review markers",
    );

    const conceptBRevision = await prisma.projectRevision.create({
      data: {
        projectId,
        stageId: conceptB.folder.taskerStageId,
        createdById: executorB.id,
        revisionNumber: 1,
        title: "Concept B submission",
        status: ProjectRevisionStatus.PENDING_REVIEW,
      },
    });
    const conceptBFile = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptB.folder.taskerStageId,
        revisionId: conceptBRevision.id,
        uploadedById: executorB.id,
        fileName: `concept-b-cross-scope-${runId}.png`,
        originalFileName: "concept-b-cross-scope.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/concept-b-cross-scope.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
      },
    });
    check(
      (
        await getComparisonCommentsForPair(owner, {
          projectId,
          stageId: conceptA.folder.taskerStageId,
          baseAttachmentId: secondRevisionFile.id,
          compareAttachmentId: conceptBFile.id,
        })
      ).length === 0,
      "comparison must reject a submission from another concept tasker",
    );
    await expectRejected(
      createComparisonComment(owner, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        baseAttachmentId: secondRevisionFile.id,
        compareAttachmentId: conceptBFile.id,
        xPercent: 10,
        yPercent: 10,
        body: "Cross-concept marker",
      }),
      "comparison marker creation must reject another concept's file",
    );

    await expectRejected(
      startProjectStageWork(executorA, {
        projectId,
        stageId: stageFourTasker.id,
      }),
      "Stage 4 work must be rejected while Stage 4 is locked",
    );
    const stageFourBase = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: stageFourTasker.id,
        uploadedById: executorA.id,
        fileName: `stage-four-base-${runId}.png`,
        originalFileName: "stage-four-base.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/stage-four-base.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
        createdAt: new Date(Date.now() - 1_000),
      },
    });
    const stageFourCompare = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: stageFourTasker.id,
        uploadedById: executorA.id,
        fileName: `stage-four-compare-${runId}.png`,
        originalFileName: "stage-four-compare.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/stage-four-compare.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
        createdAt: new Date(),
      },
    });
    await expectRejected(
      createComparisonComment(owner, {
        projectId,
        stageId: stageFourTasker.id,
        baseAttachmentId: stageFourBase.id,
        compareAttachmentId: stageFourCompare.id,
        xPercent: 40,
        yPercent: 50,
        body: "Locked Stage 4 review marker",
      }),
      "Stage 4 comparison mutations must be rejected while Stage 4 is locked",
    );

    await prisma.project.create({
      data: {
        id: foreignProjectId,
        name: `Foreign Concept Project ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        executors: {
          create: [{ userId: executorA.id, addedById: owner.id }],
        },
        workflowStages: {
          create: workflowAt(ProjectWorkflowStageKey.CONCEPT_CREATION),
        },
      },
    });
    const foreignTasker = await prisma.projectStage.create({
      data: {
        projectId: foreignProjectId,
        name: "Foreign Concept",
        invoiceRequired: false,
        isTasker: true,
        status: StageStatus.ONGOING,
        actualStartedAt: new Date(),
        startedById: executorA.id,
        order: 3_001,
      },
    });
    const foreignFolder = await prisma.projectConceptFolder.create({
      data: {
        projectId: foreignProjectId,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        taskerStageId: foreignTasker.id,
        assignedExecutorId: executorA.id,
        name: "Foreign Concept",
        normalizedName: "foreign concept",
        sortOrder: 1,
        createdById: owner.id,
      },
    });
    const foreignFile = await prisma.projectAttachment.create({
      data: {
        projectId: foreignProjectId,
        stageId: foreignTasker.id,
        uploadedById: executorA.id,
        fileName: `foreign-project-${runId}.png`,
        originalFileName: "foreign-project.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/foreign-project.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
      },
    });
    check(
      (await getProjectConceptChatContext(owner, {
        projectId,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        folderId: foreignFolder.id,
      })) === null,
      "a folder ID from another project must not resolve on the current project route",
    );
    check(
      (
        await getComparisonCommentsForPair(owner, {
          projectId,
          stageId: conceptA.folder.taskerStageId,
          baseAttachmentId: secondRevisionFile.id,
          compareAttachmentId: foreignFile.id,
        })
      ).length === 0,
      "comparison must reject another project's file",
    );

    const chatAttachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        commentId: commentA.id,
        uploadedById: executorA.id,
        fileName: `chat-attachment-${runId}.png`,
        originalFileName: "chat-attachment.png",
        mimeType: "image/png",
        fileSize: 12,
        bucket: "integration-test",
        storageKey: `integration/${runId}/chat-attachment.png`,
        assetType: AttachmentAssetType.COMMENT_ATTACHMENT,
        status: AttachmentStatus.READY,
      },
    });
    const invalidExecutorApproval = await markProjectConceptApprovedAttachment(
      executorA,
      {
        projectId,
        folderId: conceptA.folder.id,
        attachmentId: secondRevisionFile.id,
      },
    );
    check(
      isErrorResult(invalidExecutorApproval),
      "the assigned executor must not designate an Approved Concept",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(collaborator, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: secondRevisionFile.id,
        }),
      ),
      "a normal collaborator must not designate an Approved Concept",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptB.folder.id,
          attachmentId: secondRevisionFile.id,
        }),
      ),
      "a formal file from another concept must be rejected",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: firstRevisionFile.id,
        }),
      ),
      "a file from a rejected revision must not be designated",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: attachmentA.id,
        }),
      ),
      "a concept brief attachment must not be designated",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: chatAttachment.id,
        }),
      ),
      "a chat/comment attachment must not be designated",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: stageFourBase.id,
        }),
      ),
      "a Stage 4 file must not be designated for a Stage 3 concept",
    );
    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: foreignFile.id,
        }),
      ),
      "a foreign-project file must not be designated",
    );

    const initialApproval = await markProjectConceptApprovedAttachment(coOwner, {
      projectId,
      folderId: conceptA.folder.id,
      attachmentId: secondRevisionFile.id,
    });
    check(!isErrorResult(initialApproval) && initialApproval.changed, "co-owner must designate a valid formal revision file");
    const initialApprovalRecord = await prisma.projectConceptFolder.findUniqueOrThrow({
      where: { id: conceptA.folder.id },
      select: { approvedAttachmentId: true, approvedById: true, approvedAt: true },
    });
    check(
      initialApprovalRecord.approvedAttachmentId === secondRevisionFile.id &&
        initialApprovalRecord.approvedById === coOwner.id &&
        initialApprovalRecord.approvedAt !== null,
      "designation must persist the exact attachment and audit fields",
    );
    const repeatedApproval = await markProjectConceptApprovedAttachment(superAdmin, {
      projectId,
      folderId: conceptA.folder.id,
      attachmentId: secondRevisionFile.id,
    });
    check(
      !isErrorResult(repeatedApproval) && !repeatedApproval.changed,
      "repeating the same designation must be idempotent",
    );
    const unauthorizedRevocation = await revokeProjectConceptApprovedAttachment(
      executorA,
      { projectId, folderId: conceptA.folder.id },
    );
    check(
      isErrorResult(unauthorizedRevocation),
      "the assigned executor must not revoke an Approved Concept",
    );
    const revokedApproval = await revokeProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.folder.id,
    });
    check(
      !isErrorResult(revokedApproval) &&
        revokedApproval.revisionStatus === ProjectRevisionStatus.PENDING_REVIEW,
      "an authorized reviewer must revoke an Approved Concept before Stage 3 completion",
    );
    const revokedApprovalState = await prisma.projectConceptFolder.findUniqueOrThrow({
      where: { id: conceptA.folder.id },
      select: {
        approvedAttachmentId: true,
        approvedById: true,
        approvedAt: true,
        taskerStage: {
          select: {
            status: true,
            completedAt: true,
            revisions: {
              where: { id: secondRevision.id },
              select: { status: true },
            },
          },
        },
      },
    });
    check(
      revokedApprovalState.approvedAttachmentId === null &&
        revokedApprovalState.approvedById === null &&
        revokedApprovalState.approvedAt === null &&
        revokedApprovalState.taskerStage.status === StageStatus.ONGOING &&
        revokedApprovalState.taskerStage.completedAt === null &&
        revokedApprovalState.taskerStage.revisions[0]?.status ===
          ProjectRevisionStatus.PENDING_REVIEW,
      "revocation must clear approval audit state, restore Pending Review, and reopen the tasker",
    );
    const restoredApproval = await markProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.folder.id,
      attachmentId: secondRevisionFile.id,
    });
    check(
      !isErrorResult(restoredApproval) && restoredApproval.changed,
      "a revoked Stage 3 submission must be approvable again",
    );

    const replacementFile = await prisma.projectAttachment.create({
      data: {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        revisionId: secondRevision.id,
        uploadedById: executorA.id,
        fileName: `concept-revision-two-alternate-${runId}.png`,
        originalFileName: "concept-revision-two-alternate.png",
        mimeType: "image/png",
        fileSize: 24,
        bucket: "integration-test",
        storageKey: `integration/${runId}/concept-revision-two-alternate.png`,
        assetType: AttachmentAssetType.STAGE_SUBMISSION,
        status: AttachmentStatus.READY,
      },
    });
    const replacementApproval = await markProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.folder.id,
      attachmentId: replacementFile.id,
    });
    check(
      !isErrorResult(replacementApproval) &&
        replacementApproval.changed &&
        replacementApproval.attachment.id === replacementFile.id,
      "a manager must be able to replace the designation before completion",
    );
    check(
      (await prisma.projectConceptFolder.count({
        where: { id: conceptA.folder.id, approvedAttachmentId: { not: null } },
      })) === 1,
      "each concept must retain exactly one Approved Concept designation",
    );
    const stageThreeCardView = await getProjectConceptFolders(
      owner,
      projectId,
      ProjectWorkflowStageKey.CONCEPT_CREATION,
    );
    const approvedConceptCard = stageThreeCardView?.folders.find(
      (folder) => folder.id === conceptA.folder.id,
    );
    check(
      approvedConceptCard?.approvedAttachment?.id === replacementFile.id &&
        approvedConceptCard.approvedAttachment.name ===
          replacementFile.originalFileName &&
        approvedConceptCard.approvedAttachment.previewPath.includes(replacementFile.id) &&
        approvedConceptCard.approvedAttachment.downloadPath.includes(replacementFile.id),
      "the Stage 3 concept card payload must expose the exact Approved Concept file with preview and download paths",
    );
    const preCompletionState = await prisma.$transaction([
      prisma.projectStage.findUniqueOrThrow({
        where: { id: conceptA.folder.taskerStageId },
        select: { status: true },
      }),
      prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          },
        },
        select: { status: true },
      }),
      prisma.projectCompletionWorkflow.count({ where: { projectId } }),
      prisma.projectRevision.count({
        where: { id: { in: [firstRevision.id, secondRevision.id] } },
      }),
      prisma.projectAttachment.count({
        where: { id: { in: [firstRevisionFile.id, secondRevisionFile.id] } },
      }),
      prisma.projectRevision.findUniqueOrThrow({
        where: { id: secondRevision.id },
        select: { status: true, reviewedById: true, reviewedAt: true },
      }),
      prisma.projectAttachment.count({
        where: {
          revisionId: secondRevision.id,
          submissionReviewStatus: "APPROVED",
        },
      }),
    ]);
    check(
      preCompletionState[0].status === StageStatus.COMPLETED &&
        preCompletionState[1].status === ProjectWorkflowStageStatus.AVAILABLE &&
        preCompletionState[2] === 0,
      "approving a concept submission must complete its tasker without completing the overall workflow while other concepts remain",
    );
    check(
      preCompletionState[3] === 2 && preCompletionState[4] === 2,
      "replacing the designation must preserve prior revisions and files",
    );
    check(
      preCompletionState[5].status === ProjectRevisionStatus.APPROVED &&
        preCompletionState[5].reviewedById === owner.id &&
        preCompletionState[5].reviewedAt !== null &&
        preCompletionState[6] === 1,
      "the designated submission revision and only its selected formal file must be approved",
    );

    await notifyConceptFileApproved({
      projectId,
      folderId: conceptA.folder.id,
      attachmentId: replacementFile.id,
      actorId: owner.id,
    });
    const approvalNotifications = await prisma.notification.findMany({
      where: {
        projectId,
        attachmentId: replacementFile.id,
        title: "Concept file approved",
      },
      select: { userId: true },
    });
    check(
      approvalNotifications.length === 1 &&
        approvalNotifications[0].userId === executorA.id,
      "approval notification must target only the assigned executor",
    );

    await prisma.projectWorkflowStage.update({
      where: {
        projectId_stageKey: {
          projectId,
          stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        },
      },
      data: {
        status: ProjectWorkflowStageStatus.LOCKED,
        unlockedAt: null,
      },
    });
    const attachmentCountBeforeImport = await prisma.projectAttachment.count({
      where: { id: replacementFile.id },
    });
    check(
      isErrorResult(await completeStageThreeConcepts(coOwner, { projectId })),
      "Stage 3 completion must reject an ADMIN while a concept is still unapproved",
    );
    const prematureCompletion = await completeStageThreeConcepts(owner, { projectId });
    check(
      isErrorResult(prematureCompletion) &&
        prematureCompletion.error.includes("Every Stage 3 task") &&
        prematureCompletion.error.includes(conceptB.folder.name),
      "Stage 3 completion must reject concepts that are still awaiting approval",
    );
    const conceptBApproval = await markProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptB.folder.id,
      attachmentId: conceptBFile.id,
    });
    check(
      !isErrorResult(conceptBApproval) &&
        conceptBApproval.allConceptsApproved &&
        !("stageTransition" in conceptBApproval),
      "approving the final pending Stage 3 concept must wait for explicit completion confirmation",
    );
    const [completion, concurrentCompletion] = await Promise.all([
      completeStageThreeConcepts(coOwner, { projectId }),
      completeStageThreeConcepts(superAdmin, { projectId }),
    ]);
    check(
      !isErrorResult(completion) &&
        !isErrorResult(concurrentCompletion) &&
        (completion.transitioned || concurrentCompletion.transitioned),
      "explicit concurrent completion must transition once and resolve idempotently",
    );
    check(
      completion.approvedCount === 2 &&
        completion.unapprovedConcepts.length === 0 &&
        concurrentCompletion.approvedCount === 2,
      "completion must validate every approved concept without leaving pending concepts behind",
    );
    const workflowAfterCompletion = await prisma.projectWorkflowStage.findMany({
      where: {
        projectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.CONCEPT_CREATION,
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          ],
        },
      },
      select: { stageKey: true, status: true, completedAt: true, unlockedAt: true },
    });
    const completedStageThree = workflowAfterCompletion.find(
      (stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
    );
    const unlockedStageFour = workflowAfterCompletion.find(
      (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    );
    check(
      completedStageThree?.status === ProjectWorkflowStageStatus.COMPLETED &&
        completedStageThree.completedAt !== null,
      "completion must persist Stage 3 workflow completion",
    );
    check(
      unlockedStageFour?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        unlockedStageFour.unlockedAt !== null,
      "completion must unlock Stage 4",
    );
    check(
      completion.promotedFolderIds.length === 0 &&
        concurrentCompletion.promotedFolderIds.length === 0,
      "Stage 3 completion must not automatically create or promote Stage 4 folders",
    );
    const executorBEmptyStageFourView = await getProjectConceptFolders(
      executorB,
      projectId,
      ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    );
    check(
      executorBEmptyStageFourView !== null &&
        executorBEmptyStageFourView.folders.length === 0 &&
        !executorBEmptyStageFourView.canManage,
      "a project executor must reach an unlocked empty Stage 4 workspace without seeing unassigned concepts",
    );
    const completedStageRevocation =
      await revokeProjectConceptApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.folder.id,
      });
    check(
      !isErrorResult(completedStageRevocation) &&
        completedStageRevocation.reopensWorkflowStage &&
        completedStageRevocation.resetThroughStageFive,
      "completed Stage 3 approval revocation must reopen Stage 3 before downstream work starts",
    );
    const reopenedStageThree = await prisma.projectWorkflowStage.findMany({
      where: {
        projectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.CONCEPT_CREATION,
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          ],
        },
      },
      select: { stageKey: true, status: true },
    });
    check(
      reopenedStageThree.find(
        (stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
      )?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        reopenedStageThree.find(
          (stage) =>
            stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        )?.status === ProjectWorkflowStageStatus.LOCKED,
      "Stage 3 rework must restore a valid available-stage/locked-suffix sequence",
    );
    const restoredCompletedStageApproval =
      await markProjectConceptApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.folder.id,
        attachmentId: replacementFile.id,
      });
    check(
      !isErrorResult(restoredCompletedStageApproval) &&
        restoredCompletedStageApproval.changed,
      "a completed Stage 3 approval must be selectable again after rework",
    );
    const recompletedStageThree = await completeStageThreeConcepts(owner, {
      projectId,
    });
    check(
      !isErrorResult(recompletedStageThree) && recompletedStageThree.transitioned,
      "Stage 3 must complete again and return Stage 4 to the available state",
    );
    const stageFourUnlockedAfterRework =
      await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          },
        },
        select: { unlockedAt: true },
      });

    const deletableStageFourTask = await createProjectConceptFolderService(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      name: "Temporary Stage 4 Task",
      assignedExecutorId: executorA.id,
      deadline: futureConceptDeadline(),
      brief: "Delete this temporary final-concept task",
      briefAttachmentIds: [],
    });
    check(!isErrorResult(deletableStageFourTask), "the owner must create a Stage 4 task");
    const deletedStageFourTask = await deleteProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      folderId: deletableStageFourTask.folder.id,
    });
    check(!isErrorResult(deletedStageFourTask), "the creator must delete their Stage 4 task");

    const independentStageFourConcept = await createProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      name: "Renamed Accepted Concept",
      assignedExecutorId: executorA.id,
      brief: "Independent Stage 4 refinement brief",
    });
    check(
      !isErrorResult(independentStageFourConcept),
      "Stage 4 folders must be created independently after the manual transition",
    );
    const explicitImport = await importStageThreeConceptReference(owner, {
      projectId,
      folderId: independentStageFourConcept.folder.id,
      sourceConceptId: conceptA.folder.id,
    });
    check(
      !isErrorResult(explicitImport) &&
        explicitImport.reference.id === replacementFile.id,
      "the owner must explicitly import an approved Stage 3 concept into a Stage 4 chat",
    );

    const unlockedStageFourContext = await getProjectConceptChatContext(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      folderId: stageFourConcept.id,
    });
    check(
      unlockedStageFourContext?.chatMode.stageLabel === "Stage 4 - Final Concept" &&
        unlockedStageFourContext.chatMode.compareHref.endsWith(
          `/stages/4/concepts/${stageFourConcept.id}/compare`,
        ),
      "Stage 4 concept routes must open after the real Stage 3 transition",
    );
    await startProjectStageWork(executorA, {
      projectId,
      stageId: stageFourTasker.id,
    });
    const stageFourMarker = await createComparisonComment(owner, {
      projectId,
      stageId: stageFourTasker.id,
      baseAttachmentId: stageFourBase.id,
      compareAttachmentId: stageFourCompare.id,
      xPercent: 40,
      yPercent: 50,
      body: "Stage 4 review marker",
    });
    const stageFourExecutorComparison = await getComparisonCommentsForPair(
      executorA,
      {
        projectId,
        stageId: stageFourTasker.id,
        baseAttachmentId: stageFourBase.id,
        compareAttachmentId: stageFourCompare.id,
      },
    );
    check(
      stageFourExecutorComparison.some((comment) => comment.id === stageFourMarker.id),
      "the assigned Stage 4 executor must read manager comparison feedback",
    );

    const promotedConcept = await prisma.projectConceptFolder.findUniqueOrThrow({
      where: { sourceStage3ConceptId: conceptA.folder.id },
      select: {
        id: true,
        name: true,
        workflowStageKey: true,
        assignedExecutorId: true,
        sourceStage3ConceptId: true,
        sourceStage3ApprovedAttachmentId: true,
        sourceStage3ImportedAt: true,
        sourceStage3ImportedById: true,
        taskerStage: {
          select: {
            id: true,
            description: true,
            actualStartedAt: true,
            startedById: true,
            status: true,
            _count: { select: { revisions: true, attachments: true } },
          },
        },
      },
    });
    check(
      promotedConcept.id === independentStageFourConcept.folder.id &&
        promotedConcept.name === "Renamed Accepted Concept" &&
        promotedConcept.workflowStageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT &&
        promotedConcept.assignedExecutorId === executorA.id &&
        promotedConcept.sourceStage3ApprovedAttachmentId === replacementFile.id &&
        promotedConcept.sourceStage3ImportedById === owner.id &&
        promotedConcept.sourceStage3ImportedAt instanceof Date,
      "the independently created Stage 4 concept must preserve its identity and the explicitly imported source binary",
    );
    check(
      (await prisma.projectAttachment.findUniqueOrThrow({
        where: { id: replacementFile.id },
        select: { stageId: true },
      })).stageId === conceptA.folder.taskerStageId,
      "the starting reference must remain a Stage 3 attachment rather than becoming a Stage 4 submission",
    );
    check(
      (await prisma.comparisonComment.count({
        where: { id: stageFourMarker.id },
      })) === 1,
      "unrelated legacy Stage 4 chat/comparison data must be preserved",
    );
    check(
      promotedConcept.taskerStage.description ===
        "<p>Independent Stage 4 refinement brief</p>" &&
        promotedConcept.taskerStage.actualStartedAt === null &&
        promotedConcept.taskerStage.startedById === null &&
        promotedConcept.taskerStage.status === StageStatus.ONGOING &&
        promotedConcept.taskerStage._count.revisions === 0 &&
        promotedConcept.taskerStage._count.attachments === 1,
      "explicit import must preserve the independently created Stage 4 tasker and required brief",
    );
    check(
      attachmentCountBeforeImport === 1 &&
        (await prisma.projectAttachment.count({ where: { id: replacementFile.id } })) === 1,
      "explicit import must reference the existing binary without copying it",
    );
    check(
      (await prisma.projectStageFileHandoff.count({
        where: { projectId, sourceAttachmentId: replacementFile.id },
      })) === 0,
      "Round 3 completion must not create a Stage 4 to Stage 5 handoff",
    );

    await notifyStageFourConceptsActivated({
      projectId,
      folderIds: [],
      actorId: owner.id,
    });
    const activationRecipients = await prisma.notification.findMany({
      where: { projectId, title: "Stage 4 activated" },
      select: { userId: true },
    });
    const activationRecipientIds = activationRecipients.map(
      (notification) => notification.userId,
    );
    check(
      activationRecipientIds.includes(coOwner.id) &&
        activationRecipientIds.includes(executorA.id) &&
        activationRecipientIds.includes(executorB.id) &&
        !activationRecipientIds.includes(owner.id) &&
        !activationRecipientIds.includes(collaborator.id) &&
        !activationRecipientIds.includes(superAdmin.id),
      "Stage 4 activation notifications must remain manager/project-executor scoped",
    );

    const stageFourEdit = await editProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      folderId: promotedConcept.id,
      name: promotedConcept.name,
      assignedExecutorId: executorB.id,
      brief: "Fresh Stage 4 refinement brief",
    });
    check(!isErrorResult(stageFourEdit), "Stage 4 assignment and brief must be editable before acceptance");
    const reassignedStageFourContext = await getProjectConceptChatContext(executorB, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      folderId: promotedConcept.id,
    });
    check(
      reassignedStageFourContext?.chatMode.startingReference?.id === replacementFile.id &&
        reassignedStageFourContext.chatMode.startingReference.sourceConceptId === conceptA.folder.id &&
        reassignedStageFourContext.chatMode.startingReference.importedBy?.id === owner.id &&
        !Number.isNaN(
          Date.parse(
            reassignedStageFourContext.chatMode.startingReference.importedAt,
          ),
        ),
      "the reassigned Stage 4 executor must see the read-only starting reference",
    );
    await assertProjectAttachmentVisibilityForUser(executorB, {
      id: replacementFile.id,
      projectId,
      stageId: conceptA.folder.taskerStageId,
      createdAt: replacementFile.createdAt,
      project: { ownerId: owner.id, coOwners: [{ userId: coOwner.id }] },
    });
    await expectRejected(
      deleteAttachmentForUser(owner, replacementFile.id),
      "an Approved Concept/starting reference must not be deletable",
    );

    await startProjectStageWork(executorB, {
      projectId,
      stageId: promotedConcept.taskerStage.id,
    });
    const lockedStageFourEdit = await editProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      folderId: promotedConcept.id,
      name: promotedConcept.name,
      assignedExecutorId: executorA.id,
      brief: "Must not replace accepted brief",
    });
    check(
      isErrorResult(lockedStageFourEdit),
      "Stage 4 assignment and brief must lock after acceptance",
    );

    check(
      isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.folder.id,
          attachmentId: secondRevisionFile.id,
        }),
      ),
      "Approved Concept replacement must lock after Stage 3 completion",
    );
    check(
      isErrorResult(
        await editProjectConceptFolder(owner, {
          projectId,
          stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          folderId: conceptA.folder.id,
          name: "Locked Stage 3 Concept",
        }),
      ),
      "Stage 3 concept edits must lock after completion",
    );
    check(
      isErrorResult(
        await createProjectConceptFolder(owner, {
          projectId,
          stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          name: "Late Concept",
          assignedExecutorId: executorA.id,
        }),
      ),
      "new Stage 3 concepts must be blocked after completion",
    );
    await prisma.$transaction([
      prisma.projectRevision.update({
        where: { id: secondRevision.id },
        data: {
          status: ProjectRevisionStatus.PENDING_REVIEW,
          reviewedById: null,
          reviewedAt: null,
        },
      }),
      prisma.projectAttachment.updateMany({
        where: { revisionId: secondRevision.id },
        data: {
          submissionReviewStatus: "PENDING_REVIEW",
          reviewedById: null,
          reviewedAt: null,
        },
      }),
      prisma.projectStage.update({
        where: { id: conceptA.folder.taskerStageId },
        data: { status: StageStatus.ONGOING, completedAt: null },
      }),
    ]);
    const legacyApprovalRepair = await markProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.folder.id,
      attachmentId: replacementFile.id,
    });
    check(
      !isErrorResult(legacyApprovalRepair) && !legacyApprovalRepair.changed,
      "the already-designated file must reconcile stale pending data after workflow completion",
    );
    check(
      (await prisma.projectStage.findUniqueOrThrow({
        where: { id: conceptA.folder.taskerStageId },
      })).status === StageStatus.COMPLETED &&
        (await prisma.projectAttachment.count({
          where: {
            revisionId: secondRevision.id,
            submissionReviewStatus: "APPROVED",
          },
        })) === 1,
      "legacy reconciliation must restore the completed tasker and only the designated approved file status",
    );
    await expectRejected(
      createStageTextCommentFast(executorA, {
        projectId,
        stageId: conceptA.folder.taskerStageId,
        body: "Approved concept chat must be read-only",
      }),
      "an approved concept tasker must be read-only while preserving its existing history",
    );
    check(
      (await prisma.projectRevision.findUniqueOrThrow({
        where: { id: secondRevision.id },
      })).status === ProjectRevisionStatus.APPROVED,
      "formal concept approval must persist the approved revision status",
    );

    const countsBeforeRetry = await prisma.$transaction([
      prisma.projectConceptFolder.count({
        where: {
          projectId,
          workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          sourceStage3ConceptId: conceptA.folder.id,
        },
      }),
      prisma.projectStage.count({
        where: { projectId, id: promotedConcept.taskerStage.id },
      }),
    ]);
    const repeatedCompletion = await completeStageThreeConcepts(superAdmin, {
      projectId,
    });
    check(
      !isErrorResult(repeatedCompletion) && !repeatedCompletion.transitioned,
      "Stage 3 completion retry must be idempotent",
    );
    const countsAfterRetry = await prisma.$transaction([
      prisma.projectConceptFolder.count({
        where: {
          projectId,
          workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          sourceStage3ConceptId: conceptA.folder.id,
        },
      }),
      prisma.projectStage.count({
        where: { projectId, id: promotedConcept.taskerStage.id },
      }),
      prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          },
        },
        select: { unlockedAt: true },
      }),
    ]);
    check(
      countsBeforeRetry[0] === countsAfterRetry[0] &&
        countsBeforeRetry[1] === countsAfterRetry[1],
      "completion retry must not duplicate Stage 4 folders or taskers",
    );
    check(
      countsAfterRetry[2].unlockedAt?.getTime() ===
        stageFourUnlockedAfterRework.unlockedAt?.getTime(),
      "completion retry must preserve the current rework cycle's Stage 4 unlockedAt timestamp",
    );

    await prisma.project.create({
      data: {
        id: conflictProjectId,
        name: `Concept Round 3 Collision ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        executors: {
          create: [{ userId: executorA.id, addedById: owner.id }],
        },
        workflowStages: {
          create: workflowAt(ProjectWorkflowStageKey.CONCEPT_CREATION),
        },
      },
    });
    const collisionConcept = await createProjectConceptFolder(owner, {
      projectId: conflictProjectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Collision Concept",
      assignedExecutorId: executorA.id,
      brief: "Collision fixture brief",
    });
    check(!isErrorResult(collisionConcept), "collision fixture concept must be created");
    const collisionControlConcept = await createProjectConceptFolder(owner, {
      projectId: conflictProjectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      name: "Unapproved Collision Control",
      assignedExecutorId: executorA.id,
      brief: "Unapproved collision control brief",
    });
    check(
      !isErrorResult(collisionControlConcept),
      "collision fixture must retain an unapproved concept so automatic progression waits",
    );
    const zeroApprovalCompletion = await completeStageThreeConcepts(owner, {
      projectId: conflictProjectId,
    });
    check(
      isErrorResult(zeroApprovalCompletion),
      "the server must block Stage 3 completion with zero approved concepts",
    );
    await prisma.projectStage.update({
      where: { id: collisionConcept.folder.taskerStageId },
      data: { actualStartedAt: new Date(), startedById: executorA.id },
    });
    const collisionRevision = await prisma.projectRevision.create({
      data: {
        projectId: conflictProjectId,
        stageId: collisionConcept.folder.taskerStageId,
        createdById: executorA.id,
        revisionNumber: 1,
        title: "Collision submission",
        status: ProjectRevisionStatus.PENDING_REVIEW,
      },
    });
    const collisionFile = await prisma.projectAttachment.create({
      data: {
        projectId: conflictProjectId,
        stageId: collisionConcept.folder.taskerStageId,
        revisionId: collisionRevision.id,
        uploadedById: executorA.id,
        fileName: `collision-${runId}.png`,
        originalFileName: "collision.png",
        mimeType: "image/png",
        fileSize: 16,
        bucket: "integration-test",
        storageKey: `integration/${runId}/collision.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
      },
    });
    check(
      !isErrorResult(
        await markProjectConceptApprovedAttachment(owner, {
          projectId: conflictProjectId,
          folderId: collisionConcept.folder.id,
          attachmentId: collisionFile.id,
        }),
      ),
      "collision fixture approval must be valid",
    );
    const collisionStageFourTasker = await prisma.projectStage.create({
      data: {
        projectId: conflictProjectId,
        name: "Collision Concept",
        invoiceRequired: false,
        isTasker: true,
        status: StageStatus.ONGOING,
        order: 40_001,
      },
    });
    const collisionStageFourFolder = await prisma.projectConceptFolder.create({
      data: {
        projectId: conflictProjectId,
        workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        taskerStageId: collisionStageFourTasker.id,
        assignedExecutorId: executorA.id,
        name: "Collision Concept",
        normalizedName: "collision concept",
        sortOrder: 1,
        createdById: owner.id,
      },
    });
    const collisionCompletion = await completeStageThreeConcepts(owner, {
      projectId: conflictProjectId,
    });
    check(
      isErrorResult(collisionCompletion) &&
        collisionCompletion.error.includes("Every Stage 3 task") &&
        collisionCompletion.error.includes(collisionControlConcept.folder.name),
      "Stage 3 completion must report pending concepts before attempting promotion",
    );
    check(
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId: conflictProjectId,
            stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          },
        },
      })).status === ProjectWorkflowStageStatus.AVAILABLE &&
        (await prisma.projectConceptFolder.count({
          where: {
            projectId: conflictProjectId,
            sourceStage3ConceptId: collisionConcept.folder.id,
          },
        })) === 0,
      "premature completion must leave Stage 3 available without a partial promotion",
    );

    await prisma.projectConceptFolder.delete({
      where: { id: collisionStageFourFolder.id },
    });
    await prisma.projectStage.delete({
      where: { id: collisionStageFourTasker.id },
    });
    await prisma.projectStage.update({
      where: { id: collisionControlConcept.folder.taskerStageId },
      data: { actualStartedAt: new Date(), startedById: executorA.id },
    });
    const collisionControlRevision = await prisma.projectRevision.create({
      data: {
        projectId: conflictProjectId,
        stageId: collisionControlConcept.folder.taskerStageId,
        createdById: executorA.id,
        revisionNumber: 1,
        title: "Automatic progression submission",
        status: ProjectRevisionStatus.PENDING_REVIEW,
      },
    });
    const collisionControlFile = await prisma.projectAttachment.create({
      data: {
        projectId: conflictProjectId,
        stageId: collisionControlConcept.folder.taskerStageId,
        revisionId: collisionControlRevision.id,
        uploadedById: executorA.id,
        fileName: `automatic-progression-${runId}.png`,
        originalFileName: "automatic-progression.png",
        mimeType: "image/png",
        fileSize: 16,
        bucket: "integration-test",
        storageKey: `integration/${runId}/automatic-progression.png`,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
        status: AttachmentStatus.READY,
      },
    });
    const automaticCompletion = await markProjectConceptApprovedAttachment(owner, {
      projectId: conflictProjectId,
      folderId: collisionControlConcept.folder.id,
      attachmentId: collisionControlFile.id,
    });
    check(
      !isErrorResult(automaticCompletion) &&
        automaticCompletion.allConceptsApproved &&
        !("stageTransition" in automaticCompletion),
      "approving the final pending concept must keep Stage 3 open for explicit confirmation",
    );
    check(
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId: conflictProjectId,
            stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          },
        },
      })).status === ProjectWorkflowStageStatus.AVAILABLE &&
        (await prisma.projectWorkflowStage.findUniqueOrThrow({
          where: {
            projectId_stageKey: {
              projectId: conflictProjectId,
              stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            },
          },
        })).status === ProjectWorkflowStageStatus.LOCKED,
      "final concept approval must not bypass the Stage 3 completion confirmation",
    );
    const confirmedCompletion = await completeStageThreeConcepts(owner, {
      projectId: conflictProjectId,
    });
    check(
      !isErrorResult(confirmedCompletion) && confirmedCompletion.transitioned,
      "explicit Stage 3 confirmation must activate Stage 4",
    );
    check(
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId: conflictProjectId,
            stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
          },
        },
      })).status === ProjectWorkflowStageStatus.COMPLETED &&
        (await prisma.projectWorkflowStage.findUniqueOrThrow({
          where: {
            projectId_stageKey: {
              projectId: conflictProjectId,
              stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
            },
          },
        })).status === ProjectWorkflowStageStatus.AVAILABLE,
      "confirmed concept completion must persist the Stage 3 to Stage 4 workflow transition",
    );

    await prisma.project.create({
      data: {
        id: optionalStageThreeProjectId,
        name: `Optional Stage 3 ${runId}`,
        ownerId: owner.id,
        createdById: superAdmin.id,
        executors: {
          create: [{ userId: executorA.id, addedById: owner.id }],
        },
        workflowStages: {
          create: workflowAt(ProjectWorkflowStageKey.CONCEPT_CREATION),
        },
      },
    });
    const skippedStageThree = await completeStageThreeConcepts(owner, {
      projectId: optionalStageThreeProjectId,
    });
    check(
      !isErrorResult(skippedStageThree) &&
        skippedStageThree.transitioned &&
        skippedStageThree.skipped &&
        skippedStageThree.approvedCount === 0,
      "an empty Stage 3 must be skippable through the explicit owner action",
    );
    const optionalWorkflow = await prisma.projectWorkflowStage.findMany({
      where: {
        projectId: optionalStageThreeProjectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.CONCEPT_CREATION,
            ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
          ],
        },
      },
      select: { stageKey: true, status: true },
    });
    check(
      optionalWorkflow.find(
        (stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
      )?.status === ProjectWorkflowStageStatus.COMPLETED &&
        optionalWorkflow.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        )?.status === ProjectWorkflowStageStatus.AVAILABLE &&
        (await prisma.projectConceptFolder.count({
          where: { projectId: optionalStageThreeProjectId },
        })) === 0,
      "skipping Stage 3 must unlock an empty Stage 4 without creating concept folders",
    );

    const normalStage = await prisma.projectStage.create({
      data: {
        projectId,
        name: "Normal regression stage",
        description: "Non-tasker approval control",
        invoiceRequired: false,
        isTasker: false,
        actualStartedAt: new Date(),
        startedById: executorA.id,
        status: StageStatus.ONGOING,
        order: 1,
      },
    });
    const normalRevision = await prisma.projectRevision.create({
      data: {
        projectId,
        stageId: normalStage.id,
        createdById: executorA.id,
        revisionNumber: 1,
        title: "Normal stage submission",
      },
    });
    const normalApproval = await reviewProjectRevision(owner, {
      projectId,
      stageId: normalStage.id,
      revisionId: normalRevision.id,
      status: "APPROVED",
    });
    check(normalApproval.status === ProjectRevisionStatus.APPROVED, "normal stage approval must remain healthy");
  } finally {
    await prisma.project.deleteMany({
      where: {
        id: {
          in: [
            projectId,
            foreignProjectId,
            conflictProjectId,
            optionalStageThreeProjectId,
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
    console.log("Stage 3/4 Round 1/2/3 concept integration checks passed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

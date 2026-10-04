import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectFileChecklistField,
  ProjectFileChecklistRequestChannel,
  ProjectFileChecklistRequestWorkflowStatus,
  ProjectProductionUnitStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import {
  createComparisonComment,
  createSubmissionCaption,
  getComparisonCommentsForPair,
} from "../src/lib/comparison";
import type { SendEmailInput } from "../src/lib/email/resend";
import { createProjectV2 } from "../src/lib/project-creation";
import {
  completeStageFourConcepts,
  completeStageThreeConcepts,
  createProjectConceptFolder as createProjectConceptFolderService,
  editProjectConceptFolder,
  getConceptApprovalRevocationEligibility,
  getProjectConceptChatContext,
  getProjectConceptFolders,
  importStageThreeConceptReference,
  markProjectConceptApprovedAttachment,
  markStageFourFinalApprovedAttachment,
  revokeProjectConceptApprovedAttachment,
  revokeStageFourFinalApprovedAttachment,
} from "../src/lib/project-concepts";
import {
  completeAttachmentUpload,
  completePreparedChatAttachmentUpload,
  createStageRevision,
  createStageTextCommentFast,
  finalizePreparedStageCommentUploads,
  getAttachmentPreviewUrlForUser,
  prepareStageCommentUploads,
  requestAttachmentUpload,
  reviewProjectRevision,
  startProjectStageWork,
} from "../src/lib/project-history";
import {
  notifyConceptFileApproved,
  notifyRevisionSubmitted,
  notifyStageFiveActivated,
  notifyStageFourConceptsActivated,
  notifyStageFourFinalFileApproved,
  notifySubmissionWorkflowDecision,
} from "../src/lib/notification-center/triggers";
import { prisma } from "../src/lib/prisma";
import {
  acceptStageFiveChecklistRequest,
  completeStageFive,
  getStageFiveChecklistRequestData,
  getStageFiveWorkspaceData,
  requestStageFiveChecklistInformation,
  saveStageFiveChecklist,
  submitStageFiveChecklistResponse,
} from "../src/lib/stage-five";
import {
  getExternalChecklistRequestData,
  submitExternalChecklistResponse,
} from "../src/lib/stage-five-external";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Stage 3-5 E2E QA failed: ${message}`);
}

function isError(value: unknown): value is { error: string } {
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
      fileName: `${attachmentId}.png`,
      originalFileName: "concept-brief.png",
      mimeType: "image/png",
      fileSize: 128,
      bucket: "integration-test",
      storageKey: `integration/concept-brief/${attachmentId}.png`,
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

const pngBytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=",
    "base64",
  ),
);
const qaProjectIds: string[] = [];
const qaUserIds: string[] = [];

type QaUser = Parameters<typeof requestAttachmentUpload>[0];

async function putPresignedFile(
  uploadUrl: string,
  mimeType: string,
  bytes = pngBytes,
) {
  // The isolated regression mode validates application persistence and workflow
  // boundaries without writing test objects to a real cloud bucket. Upload
  // completion does not depend on a remote HEAD request, so the test can safely
  // exercise the same service path with an inert presigned target.
  if (process.env.STAGE_E2E_SKIP_S3_PUT === "1") return;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  check(response.ok, `S3 upload failed with HTTP ${response.status}`);
}

async function completeUploadFromCli(
  attachmentId: string,
  complete: () => Promise<unknown>,
) {
  try {
    await complete();
  } catch (error) {
    const committed = await prisma.projectAttachment.findUnique({
      where: { id: attachmentId },
      select: { status: true },
    });
    if (
      !(error instanceof Error) ||
      !error.message.includes("after` was called outside a request scope") ||
      committed?.status !== AttachmentStatus.READY
    ) {
      throw error;
    }
  }
}

async function uploadProjectFile(input: {
  user: QaUser;
  projectId: string;
  stageId: string;
  originalFileName: string;
  assetType: AttachmentAssetType;
  revisionId?: string | null;
  commentId?: string | null;
}) {
  const prepared = await requestAttachmentUpload(input.user, {
    projectId: input.projectId,
    stageId: input.stageId,
    revisionId: input.revisionId ?? null,
    commentId: input.commentId ?? null,
    originalFileName: input.originalFileName,
    mimeType: "image/png",
    fileSize: pngBytes.byteLength,
    assetType: input.assetType,
  });
  check(!isError(prepared), `upload preparation failed for ${input.originalFileName}`);
  await putPresignedFile(prepared.uploadUrl, "image/png");
  await completeUploadFromCli(prepared.attachmentId, () =>
    completeAttachmentUpload(input.user, prepared.attachmentId),
  );
  return prepared.attachmentId;
}

async function submitConceptRevision(input: {
  user: QaUser;
  actorName: string;
  projectId: string;
  stageId: string;
  summary: string;
  fileNames: string[];
}) {
  const attachmentIds = [];
  for (const originalFileName of input.fileNames) {
    attachmentIds.push(
      await uploadProjectFile({
        user: input.user,
        projectId: input.projectId,
        stageId: input.stageId,
        originalFileName,
        assetType: AttachmentAssetType.REVISION_ORIGINAL,
      }),
    );
  }
  const revision = await createStageRevision(input.user, {
    projectId: input.projectId,
    stageId: input.stageId,
    summary: input.summary,
    attachmentIds,
  });
  await notifyRevisionSubmitted({
    actorId: input.user.id,
    actorName: input.actorName,
    projectId: input.projectId,
    stageId: input.stageId,
    revisionId: revision.id,
  });
  return { revision, attachmentIds };
}

function getExternalToken(email: SendEmailInput | null) {
  const token = email?.text.match(
    /\/external\/checklist-request\/([A-Za-z0-9_-]{43})/,
  )?.[1];
  check(token, "manual email must contain a secure external token");
  return token;
}

async function main() {
  process.env.AWS_REGION ||= "us-east-1";
  process.env.AWS_ACCESS_KEY_ID ||= "stage-three-five-test";
  process.env.AWS_SECRET_ACCESS_KEY ||= "stage-three-five-test-secret";
  process.env.AWS_S3_BUCKET ||= "stage-three-five-integration";
  process.env.S3_USE_ACCELERATE_ENDPOINT ||= "false";
  process.env.STAGE_E2E_SKIP_S3_PUT ||= "1";

  const runId = randomUUID();
  const runLabel = runId.slice(0, 8);
  const userSpecs = [
    ["super-admin", UserRole.SUPER_ADMIN],
    ["owner", UserRole.ADMIN],
    ["co-owner", UserRole.ADMIN],
    ["executor-a", UserRole.USER],
    ["executor-b", UserRole.USER],
    ["collaborator", UserRole.USER],
    ["admin-outsider", UserRole.ADMIN],
    ["unrelated-user", UserRole.USER],
  ] as const;
  const userIds = userSpecs.map(
    ([label]) => `e2e-qa-${runLabel}-${label}`,
  );
  qaUserIds.push(...userIds);

  await prisma.user.createMany({
    data: userSpecs.map(([label, role], index) => ({
      id: userIds[index],
      email: `e2e-qa-${runLabel}-${label}@example.test`,
      name: `E2E QA ${label}`,
      passwordHash: "e2e-qa-service-actor",
      role,
    })),
  });
  const [
    superAdmin,
    owner,
    coOwner,
    executorA,
    executorB,
    collaborator,
    adminOutsider,
    unrelatedUser,
  ] = await Promise.all(
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

  const createdProject = await createProjectV2(owner, {
    name: `E2E QA - Concept Workflow - ${runLabel}`,
    ownerId: owner.id,
    coOwnerIds: [coOwner.id],
    executorIds: [executorA.id, executorB.id],
    collaboratorIds: [collaborator.id],
  });
  check(!isError(createdProject), "the real project-creation service must succeed");
  const projectId = createdProject.projectId;
  qaProjectIds.push(projectId);

  // Stages 1 and 2 are outside this audit. Advance only their workflow records so
  // the real Stage 3 services can be exercised without fabricating concept rows.
  const now = new Date();
  await prisma.$transaction([
    prisma.projectWorkflowStage.updateMany({
      where: {
        projectId,
        stageKey: {
          in: [
            ProjectWorkflowStageKey.PROJECT_INQUIRY,
            ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
          ],
        },
      },
      data: {
        status: ProjectWorkflowStageStatus.COMPLETED,
        unlockedAt: now,
        completedAt: now,
      },
    }),
    prisma.projectWorkflowStage.update({
      where: {
        projectId_stageKey: {
          projectId,
          stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        },
      },
      data: {
        status: ProjectWorkflowStageStatus.AVAILABLE,
        unlockedAt: now,
      },
    }),
  ]);

  const conceptInputs = [
    {
      name: "Concept A - Botanical",
      assignedExecutorId: executorA.id,
      brief: "Develop a botanical identity with premium green packaging cues.",
    },
    {
      name: "Concept B - Geometric",
      assignedExecutorId: executorB.id,
      brief: "Develop a geometric identity with restrained architectural forms.",
    },
  ];
  const concepts: Array<{
    id: string;
    name: string;
    taskerStageId: string;
    assignedExecutorId: string | null;
  }> = [];
  for (const conceptInput of conceptInputs) {
    const concept = await createProjectConceptFolder(owner, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      ...conceptInput,
    });
    check(!isError(concept), `real concept creation must succeed for ${conceptInput.name}`);
    concepts.push(concept.folder);
  }
  const [conceptA, conceptB] = concepts;

  const duplicateConcept = await createProjectConceptFolder(owner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
    name: "  concept a - BOTANICAL  ",
    assignedExecutorId: executorA.id,
    brief: "Duplicate should be rejected.",
  });
  check(isError(duplicateConcept), "concept names must be unique case-insensitively");
  const stageThreeTaskers = await prisma.projectStage.findMany({
    where: { id: { in: concepts.map((concept) => concept.taskerStageId) } },
    select: {
      id: true,
      description: true,
      invoiceRequired: true,
      actualStartedAt: true,
      startedById: true,
    },
  });
  check(
    stageThreeTaskers.length === 2 &&
      new Set(stageThreeTaskers.map((tasker) => tasker.id)).size === 2 &&
      stageThreeTaskers.every(
        (tasker) =>
          tasker.description &&
          !tasker.invoiceRequired &&
          tasker.actualStartedAt === null &&
          tasker.startedById === null,
      ),
    "each Stage 3 concept must persist a unique unstarted no-invoice tasker and brief",
  );

  const briefAttachmentA = await uploadProjectFile({
    user: owner,
    projectId,
    stageId: conceptA.taskerStageId,
    originalFileName: "concept-a-brief-reference.png",
    assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
  });
  check(
    (await prisma.projectAttachment.findUnique({
      where: { id: briefAttachmentA },
      select: { status: true, stageId: true, revisionId: true, commentId: true },
    }))?.status === AttachmentStatus.READY,
    "the real brief attachment upload must persist as READY",
  );

  const [ownerView, coOwnerView, superView, executorAView, executorBView] =
    await Promise.all([
      getProjectConceptFolders(owner, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION),
      getProjectConceptFolders(coOwner, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION),
      getProjectConceptFolders(superAdmin, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION),
      getProjectConceptFolders(executorA, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION),
      getProjectConceptFolders(executorB, projectId, ProjectWorkflowStageKey.CONCEPT_CREATION),
    ]);
  check(ownerView?.folders.length === 2, "owner must see all concepts");
  check(coOwnerView?.folders.length === 2, "co-owner must see all concepts");
  check(superView?.folders.length === 2, "SUPER_ADMIN must see all concepts");
  check(
    executorAView?.folders.length === 1 && executorAView.folders[0]?.id === conceptA.id,
    "Executor A must see only Concept A",
  );
  check(
    executorBView?.folders.length === 1 && executorBView.folders[0].id === conceptB.id,
    "Executor B must see only Concept B",
  );
  check(
    (await getProjectConceptFolders(
      adminOutsider,
      projectId,
      ProjectWorkflowStageKey.CONCEPT_CREATION,
    ))?.folders.length === 2,
    "ADMIN must retain global Stage 3 management access",
  );
  for (const actor of [collaborator, unrelatedUser]) {
    check(
      (await getProjectConceptFolders(
        actor,
        projectId,
        ProjectWorkflowStageKey.CONCEPT_CREATION,
      )) === null,
      "unassigned project participants and unrelated USER accounts must be denied",
    );
  }
  check(
    (await getProjectConceptFolders(
      executorA,
      projectId,
      ProjectWorkflowStageKey.CONCEPT_CREATION,
      { executorId: executorB.id },
    ))?.folders.every((folder) => folder.assignedExecutor?.id === executorA.id),
    "executor query tampering must not broaden access",
  );
  check(
    (await getProjectConceptChatContext(executorA, {
      projectId,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      folderId: conceptB.id,
    })) === null,
    "Executor A must not guess Executor B's concept route",
  );

  await expectRejected(
    createStageRevision(executorA, {
      projectId,
      stageId: conceptA.taskerStageId,
      summary: "Cannot submit before acceptance",
      attachmentIds: [],
    }),
    "the assigned executor must not submit before accepting the brief",
  );
  await expectRejected(
    startProjectStageWork(executorB, {
      projectId,
      stageId: conceptA.taskerStageId,
    }),
    "Executor B must not accept Executor A's concept",
  );

  await startProjectStageWork(executorA, {
    projectId,
    stageId: conceptA.taskerStageId,
  });
  const startedTasker = await prisma.projectStage.findUniqueOrThrow({
    where: { id: conceptA.taskerStageId },
    select: { actualStartedAt: true, startedById: true },
  });
  check(
    startedTasker.actualStartedAt !== null && startedTasker.startedById === executorA.id,
    "Accept Brief must persist the assigned executor and start time",
  );
  await expectRejected(
    startProjectStageWork(executorA, {
      projectId,
      stageId: conceptA.taskerStageId,
    }),
    "a second Accept Brief action must be rejected cleanly",
  );
  const repeatedStart = await prisma.projectStage.findUniqueOrThrow({
    where: { id: conceptA.taskerStageId },
    select: { actualStartedAt: true, startedById: true },
  });
  check(
    repeatedStart.actualStartedAt?.getTime() === startedTasker.actualStartedAt?.getTime() &&
      repeatedStart.startedById === executorA.id,
    "double Accept Brief must preserve the original start record",
  );
  const lockedEdit = await editProjectConceptFolder(owner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
    folderId: conceptA.id,
    name: conceptA.name,
    assignedExecutorId: executorB.id,
    brief: "Attempted post-start change",
  });
  check(isError(lockedEdit), "brief and executor assignment must lock after acceptance");

  const chatMessage = await createStageTextCommentFast(executorA, {
    projectId,
    stageId: conceptA.taskerStageId,
    body: "Concept A work has started. @Owner please review the direction.",
    mentionedUserIds: [owner.id, coOwner.id, executorB.id, collaborator.id],
  });
  check(
    chatMessage.mentions.some((mention) => mention.mentionedUserId === owner.id) &&
      chatMessage.mentions.some((mention) => mention.mentionedUserId === coOwner.id) &&
      !chatMessage.mentions.some((mention) => mention.mentionedUserId === executorB.id) &&
      !chatMessage.mentions.some((mention) => mention.mentionedUserId === collaborator.id),
    "concept mentions must stay scoped to owner, co-owner, and assigned executor",
  );

  const preparedChat = await prepareStageCommentUploads(executorA, {
    projectId,
    stageId: conceptA.taskerStageId,
    body: "Attached working reference.",
    mentionedUserIds: [owner.id],
    files: [
      {
        originalFileName: "concept-a-chat-reference.png",
        mimeType: "image/png",
        fileSize: pngBytes.byteLength,
        assetType: "COMMENT_ATTACHMENT",
      },
    ],
  });
  check(!isError(preparedChat), "chat attachment preparation must succeed");
  await putPresignedFile(preparedChat.uploads[0].uploadUrl, "image/png");
  await completeUploadFromCli(preparedChat.uploads[0].attachmentId, () =>
    completePreparedChatAttachmentUpload(executorA, {
      attachmentId: preparedChat.uploads[0].attachmentId,
      projectId,
    }),
  );
  await finalizePreparedStageCommentUploads(executorA, {
    projectId,
    commentId: preparedChat.commentId,
  });

  const preparedUpload = await requestAttachmentUpload(executorA, {
    projectId,
    stageId: conceptA.taskerStageId,
    revisionId: null,
    commentId: null,
    originalFileName: "concept-a-revision-1.png",
    mimeType: "image/png",
    fileSize: pngBytes.byteLength,
    assetType: AttachmentAssetType.REVISION_ORIGINAL,
  });
  check(
    !isError(preparedUpload) &&
      preparedUpload.storageKey.includes("/revisions/staged/"),
    "a real concept revision file must receive a staged upload target before its revision exists",
  );
  await putPresignedFile(preparedUpload.uploadUrl, "image/png");
  await completeUploadFromCli(preparedUpload.attachmentId, () =>
    completeAttachmentUpload(executorA, preparedUpload.attachmentId),
  );
  const revisionOne = await createStageRevision(executorA, {
    projectId,
    stageId: conceptA.taskerStageId,
    summary: "Concept A revision one",
    attachmentIds: [preparedUpload.attachmentId],
  });
  await notifyRevisionSubmitted({
    actorId: executorA.id,
    actorName: executorA.name ?? executorA.email,
    projectId,
    stageId: conceptA.taskerStageId,
    revisionId: revisionOne.id,
  });
  check(
    revisionOne.revisionNumber === 1 &&
      revisionOne.status === ProjectRevisionStatus.PENDING_REVIEW &&
      (await prisma.projectAttachment.findUniqueOrThrow({
        where: { id: preparedUpload.attachmentId },
      })).revisionId === revisionOne.id,
    "Revision 1 must atomically bind the uploaded formal file and become pending review",
  );
  const revisionOneNotifications = await prisma.notification.findMany({
    where: {
      projectId,
      revisionId: revisionOne.id,
      type: "REVISION_SUBMITTED",
    },
    select: { userId: true },
  });
  check(
    revisionOneNotifications.some((notification) => notification.userId === owner.id) &&
      revisionOneNotifications.some((notification) => notification.userId === coOwner.id) &&
      !revisionOneNotifications.some(
        (notification) => notification.userId === superAdmin.id,
      ) &&
      !revisionOneNotifications.some(
        (notification) => notification.userId === collaborator.id,
      ),
    "revision notification must target owners without notifying SUPER_ADMIN or unrelated collaborators",
  );

  const ownerRejection = await reviewProjectRevision(owner, {
    projectId,
    stageId: conceptA.taskerStageId,
    revisionId: revisionOne.id,
    status: "REJECTED",
    reason: "Increase spacing and simplify the leaf geometry.",
  });
  await notifySubmissionWorkflowDecision({
    projectId,
    stageId: conceptA.taskerStageId,
    status: "REVISION_REQUESTED",
    actorId: owner.id,
  });
  check(
    ownerRejection.status === ProjectRevisionStatus.REJECTED &&
      ownerRejection.reviewedAt !== null &&
      ownerRejection.rejectionReason ===
        "<p>Increase spacing and simplify the leaf geometry.</p>" &&
      ownerRejection.rejectionComment?.body.includes("Increase spacing") &&
      (await prisma.projectRevision.findUniqueOrThrow({
        where: { id: revisionOne.id },
      })).reviewedById === owner.id,
    "owner Request Changes must persist reviewer, time, reason, and chat history",
  );
  const revisionOneDecisionRecipients = await prisma.notification.findMany({
    where: {
      projectId,
      stageId: conceptA.taskerStageId,
      type: "SUBMISSION_REVISION_REQUESTED",
    },
    select: { userId: true },
  });
  check(
    revisionOneDecisionRecipients.some(
      (notification) => notification.userId === executorA.id,
    ) &&
      !revisionOneDecisionRecipients.some(
        (notification) => notification.userId === executorB.id,
      ) &&
      !revisionOneDecisionRecipients.some(
        (notification) => notification.userId === collaborator.id,
      ),
    "Request Changes must notify only the assigned concept executor",
  );

  const revisionTwo = await submitConceptRevision({
    user: executorA,
    actorName: executorA.name ?? executorA.email,
    projectId,
    stageId: conceptA.taskerStageId,
    summary: "Concept A revision two",
    fileNames: ["concept-a-revision-2.png"],
  });
  check(revisionTwo.revision.revisionNumber === 2, "revision number must increment");
  const coOwnerRejection = await reviewProjectRevision(coOwner, {
    projectId,
    stageId: conceptA.taskerStageId,
    revisionId: revisionTwo.revision.id,
    status: "REJECTED",
    reason: "Refine the typography before final selection.",
  });
  check(
    coOwnerRejection.status === ProjectRevisionStatus.REJECTED &&
      (await prisma.projectRevision.findUniqueOrThrow({
        where: { id: revisionTwo.revision.id },
      })).reviewedById === coOwner.id,
    "co-owner must have the same Request Changes capability",
  );

  const revisionThree = await submitConceptRevision({
    user: executorA,
    actorName: executorA.name ?? executorA.email,
    projectId,
    stageId: conceptA.taskerStageId,
    summary: "Concept A final selection",
    fileNames: [
      "concept-a-final-option-1.png",
      "concept-a-final-option-2.png",
    ],
  });
  check(
    revisionThree.revision.revisionNumber === 3 &&
      (await prisma.projectRevision.count({
        where: { projectId, stageId: conceptA.taskerStageId },
      })) === 3,
    "revision history must retain all revisions",
  );

  await createComparisonComment(owner, {
    projectId,
    stageId: conceptA.taskerStageId,
    baseAttachmentId: revisionTwo.attachmentIds[0],
    compareAttachmentId: revisionThree.attachmentIds[1],
    xPercent: 30,
    yPercent: 40,
    body: "Owner comparison marker",
    opacity: 55,
  });
  await createSubmissionCaption(coOwner, {
    attachmentId: revisionThree.attachmentIds[1],
    xPercent: 60,
    yPercent: 70,
    body: "Co-owner caption",
  });
  await expectRejected(
    createComparisonComment(executorA, {
      projectId,
      stageId: conceptA.taskerStageId,
      baseAttachmentId: revisionTwo.attachmentIds[0],
      compareAttachmentId: revisionThree.attachmentIds[1],
      xPercent: 10,
      yPercent: 10,
      body: "Executor must not create review markers",
    }),
    "assigned executor must not create owner-review comparison markers",
  );
  check(
    (await getComparisonCommentsForPair(owner, {
      projectId,
      stageId: conceptA.taskerStageId,
      baseAttachmentId: revisionTwo.attachmentIds[0],
      compareAttachmentId: revisionThree.attachmentIds[1],
    })).length >= 1,
    "comparison markers must persist for the exact concept pair",
  );
  await expectRejected(
    getAttachmentPreviewUrlForUser(executorB, revisionThree.attachmentIds[0]),
    "Executor B must not access Executor A's formal attachment by ID",
  );

  const firstApproval = await markProjectConceptApprovedAttachment(owner, {
    projectId,
    folderId: conceptA.id,
    attachmentId: revisionThree.attachmentIds[0],
  });
  check(!isError(firstApproval) && firstApproval.changed, "owner must approve Concept A");
  const replacementApproval = await markProjectConceptApprovedAttachment(coOwner, {
    projectId,
    folderId: conceptA.id,
    attachmentId: revisionThree.attachmentIds[1],
  });
  check(
    !isError(replacementApproval) && replacementApproval.changed,
    "co-owner must safely replace the approved Concept A file",
  );
  const prematureStageThreeCompletion = await completeStageThreeConcepts(owner, {
    projectId,
  });
  check(
    isError(prematureStageThreeCompletion) &&
      prematureStageThreeCompletion.error.includes("Every Stage 3 task") &&
      prematureStageThreeCompletion.error.includes(conceptB.name),
    "Stage 3 must not complete while another executor's concept is still awaiting approval",
  );
  const duplicateApproval = await markProjectConceptApprovedAttachment(superAdmin, {
    projectId,
    folderId: conceptA.id,
    attachmentId: revisionThree.attachmentIds[1],
  });
  check(
    !isError(duplicateApproval) && !duplicateApproval.changed,
    "double Mark Approved Concept must be idempotent",
  );
  await notifyConceptFileApproved({
    projectId,
    folderId: conceptA.id,
    attachmentId: revisionThree.attachmentIds[1],
    actorId: owner.id,
  });
  for (const invalidAttachmentId of [
    briefAttachmentA,
    preparedChat.uploads[0].attachmentId,
  ]) {
    check(
      isError(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.id,
          attachmentId: invalidAttachmentId,
        }),
      ),
      "brief and chat attachments must never become the Approved Concept",
    );
  }

  await startProjectStageWork(executorB, {
    projectId,
    stageId: conceptB.taskerStageId,
  });
  const conceptBRevision = await submitConceptRevision({
    user: executorB,
    actorName: executorB.name ?? executorB.email,
    projectId,
    stageId: conceptB.taskerStageId,
    summary: "Concept B approved direction",
    fileNames: ["concept-b-approved.png"],
  });
  check(
    isError(
      await markProjectConceptApprovedAttachment(owner, {
        projectId,
        folderId: conceptA.id,
        attachmentId: conceptBRevision.attachmentIds[0],
      }),
    ),
    "another concept's formal file must be rejected",
  );
  const conceptBApproval = await markProjectConceptApprovedAttachment(coOwner, {
    projectId,
    folderId: conceptB.id,
    attachmentId: conceptBRevision.attachmentIds[0],
  });
  check(
    !isError(conceptBApproval) &&
      conceptBApproval.allConceptsApproved &&
      !("stageTransition" in conceptBApproval),
    "final concept approval must wait for explicit owner completion confirmation",
  );
  const coOwnerStageThreeCompletion = await completeStageThreeConcepts(coOwner, {
    projectId,
  });
  check(
    !isError(coOwnerStageThreeCompletion) && coOwnerStageThreeCompletion.transitioned,
    "ADMIN co-owner must be able to complete Stage 3",
  );

  const [stageThreeCompletionA, stageThreeCompletionB] = await Promise.all([
    completeStageThreeConcepts(owner, { projectId }),
    completeStageThreeConcepts(superAdmin, { projectId }),
  ]);
  check(
    !isError(stageThreeCompletionA) &&
      !isError(stageThreeCompletionB) &&
      !stageThreeCompletionA.transitioned &&
      !stageThreeCompletionB.transitioned,
    "repeated Stage 3 confirmation must remain idempotent",
  );
  const stageThreeCompletion = coOwnerStageThreeCompletion;
  check(
    stageThreeCompletion.approvedCount === 2 &&
      stageThreeCompletion.unapprovedConcepts.length === 0,
    "Stage 3 completion must include every approved concept",
  );
  await notifyStageFourConceptsActivated({
    projectId,
    folderIds: [],
    actorId: owner.id,
  });

  const stageFourAResult = await createProjectConceptFolder(owner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    name: conceptA.name,
    assignedExecutorId: executorA.id,
    brief: "Fresh Stage 4 botanical finalization brief.",
  });
  const stageFourBResult = await createProjectConceptFolder(owner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    name: conceptB.name,
    assignedExecutorId: executorB.id,
    brief: "Fresh Stage 4 geometric finalization brief.",
  });
  check(
    !isError(stageFourAResult) && !isError(stageFourBResult),
    "Stage 4 concepts must be created independently after Stage 3 completes",
  );
  const stageFourAImport = await importStageThreeConceptReference(owner, {
    projectId,
    folderId: stageFourAResult.folder.id,
    sourceConceptId: conceptA.id,
  });
  const stageFourBImport = await importStageThreeConceptReference(owner, {
    projectId,
    folderId: stageFourBResult.folder.id,
    sourceConceptId: conceptB.id,
  });
  check(
    !isError(stageFourAImport) && !isError(stageFourBImport),
    "approved Stage 3 concepts must be imported explicitly into their Stage 4 chats",
  );

  const stageFourFolders = await prisma.projectConceptFolder.findMany({
    where: {
      projectId,
      workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    },
    include: { taskerStage: true },
    orderBy: { sortOrder: "asc" },
  });
  check(
    stageFourFolders.length === 2 &&
      stageFourFolders.map((folder) => folder.name).sort().join(",") ===
        [conceptA.name, conceptB.name].sort().join(",") &&
      stageFourFolders.every(
        (folder) =>
          folder.taskerStageId !==
            concepts.find((concept) => concept.name === folder.name)?.taskerStageId &&
          folder.taskerStage.actualStartedAt === null &&
          folder.taskerStage.startedById === null &&
          Boolean(folder.taskerStage.description) &&
          folder.sourceStage3ConceptId &&
          folder.sourceStage3ApprovedAttachmentId,
      ),
    "independently created A/B concepts must retain new taskers and explicit source references",
  );
  const stageThreeWorkflow = await prisma.projectWorkflowStage.findUniqueOrThrow({
    where: {
      projectId_stageKey: {
        projectId,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      },
    },
  });
  const stageFourWorkflow = await prisma.projectWorkflowStage.findUniqueOrThrow({
    where: {
      projectId_stageKey: {
        projectId,
        stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      },
    },
  });
  check(
    stageThreeWorkflow.status === ProjectWorkflowStageStatus.COMPLETED &&
      stageFourWorkflow.status === ProjectWorkflowStageStatus.AVAILABLE,
    "Stage 3 completion must complete Stage 3 and unlock Stage 4",
  );
  check(
    isError(
      await createProjectConceptFolder(owner, {
        projectId,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
        name: "Post-completion concept",
        assignedExecutorId: executorA.id,
      }),
    ) &&
      isError(
        await markProjectConceptApprovedAttachment(owner, {
          projectId,
          folderId: conceptA.id,
          attachmentId: revisionThree.attachmentIds[0],
        }),
    ),
    "Stage 3 concept creation and approval selection must lock after completion",
  );

  const stageFourA = stageFourFolders.find((folder) => folder.name === conceptA.name)!;
  const stageFourB = stageFourFolders.find((folder) => folder.name === conceptB.name)!;
  check(
    stageFourA.assignedExecutorId === executorA.id &&
      stageFourB.assignedExecutorId === executorB.id &&
      stageFourA.sourceStage3ConceptId === conceptA.id &&
      stageFourA.sourceStage3ApprovedAttachmentId ===
        revisionThree.attachmentIds[1],
    "Stage 4 must preserve default executors and exact Stage 3 source identity",
  );
  const temporaryReassignment = await editProjectConceptFolder(coOwner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    folderId: stageFourA.id,
    name: stageFourA.name,
    assignedExecutorId: executorB.id,
    brief: "Fresh Stage 4 botanical finalization brief.",
  });
  check(!isError(temporaryReassignment), "co-owner must edit Stage 4 before acceptance");
  const restoreAssignment = await editProjectConceptFolder(owner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    folderId: stageFourA.id,
    name: stageFourA.name,
    assignedExecutorId: executorA.id,
    brief: "Fresh Stage 4 botanical finalization brief.",
  });
  check(!isError(restoreAssignment), "owner must restore the known Stage 4 executor");
  const stageFourBriefAttachment = await uploadProjectFile({
    user: owner,
    projectId,
    stageId: stageFourA.taskerStageId,
    originalFileName: "stage-four-a-brief.png",
    assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
  });
  check(
    (await prisma.projectConceptFolder.findUniqueOrThrow({
      where: { id: stageFourA.id },
      include: { taskerStage: true },
    })).sourceStage3ApprovedAttachmentId === revisionThree.attachmentIds[1],
    "editing Stage 4 brief/assignment must not alter the immutable starting reference",
  );

  await startProjectStageWork(executorA, {
    projectId,
    stageId: stageFourA.taskerStageId,
  });
  const stageFourARevisionOne = await submitConceptRevision({
    user: executorA,
    actorName: executorA.name ?? executorA.email,
    projectId,
    stageId: stageFourA.taskerStageId,
    summary: "Stage 4 A revision one",
    fileNames: ["stage-four-a-revision-1.png"],
  });
  await reviewProjectRevision(coOwner, {
    projectId,
    stageId: stageFourA.taskerStageId,
    revisionId: stageFourARevisionOne.revision.id,
    status: "REJECTED",
    reason: "Tighten final layout alignment.",
  });
  const stageFourARevisionTwo = await submitConceptRevision({
    user: executorA,
    actorName: executorA.name ?? executorA.email,
    projectId,
    stageId: stageFourA.taskerStageId,
    summary: "Stage 4 A final revision",
    fileNames: ["final-a-option-1.png", "final-a-option-2.png"],
  });
  await createComparisonComment(owner, {
    projectId,
    stageId: stageFourA.taskerStageId,
    baseAttachmentId: stageFourARevisionOne.attachmentIds[0],
    compareAttachmentId: stageFourARevisionTwo.attachmentIds[1],
    xPercent: 45,
    yPercent: 55,
    body: "Stage 4 final comparison marker",
    opacity: 60,
  });
  const firstFinalA = await markStageFourFinalApprovedAttachment(owner, {
    projectId,
    folderId: stageFourA.id,
    attachmentId: stageFourARevisionTwo.attachmentIds[0],
  });
  check(!isError(firstFinalA) && firstFinalA.changed, "owner must mark Final A");
  const replacedFinalA = await markStageFourFinalApprovedAttachment(coOwner, {
    projectId,
    folderId: stageFourA.id,
    attachmentId: stageFourARevisionTwo.attachmentIds[1],
  });
  check(
    !isError(replacedFinalA) && replacedFinalA.changed,
    "safe Stage 4 final replacement must work before completion",
  );
  const repeatedFinalA = await markStageFourFinalApprovedAttachment(superAdmin, {
    projectId,
    folderId: stageFourA.id,
    attachmentId: stageFourARevisionTwo.attachmentIds[1],
  });
  check(
    !isError(repeatedFinalA) && !repeatedFinalA.changed,
    "double Mark Final Approved must be idempotent",
  );
  const revokedFinalA = await revokeStageFourFinalApprovedAttachment(owner, {
    projectId,
    folderId: stageFourA.id,
  });
  check(
    !isError(revokedFinalA) &&
      revokedFinalA.revisionStatus === ProjectRevisionStatus.PENDING_REVIEW,
    "an authorized reviewer must revoke Final A before Stage 4 completion",
  );
  const restoredFinalA = await markStageFourFinalApprovedAttachment(owner, {
    projectId,
    folderId: stageFourA.id,
    attachmentId: stageFourARevisionTwo.attachmentIds[1],
  });
  check(
    !isError(restoredFinalA) && restoredFinalA.changed,
    "a revoked Stage 4 final file must be approvable again",
  );
  await notifyStageFourFinalFileApproved({
    projectId,
    folderId: stageFourA.id,
    attachmentId: stageFourARevisionTwo.attachmentIds[1],
    actorId: owner.id,
  });
  for (const invalidAttachmentId of [
    revisionThree.attachmentIds[1],
    stageFourBriefAttachment,
    conceptBRevision.attachmentIds[0],
  ]) {
    check(
      isError(
        await markStageFourFinalApprovedAttachment(owner, {
          projectId,
          folderId: stageFourA.id,
          attachmentId: invalidAttachmentId,
        }),
      ),
      "starting references, briefs, and other concept files must not become Final A",
    );
  }
  const incompleteStageFourCompletion = await completeStageFourConcepts(owner, {
    projectId,
  });
  check(
    isError(incompleteStageFourCompletion) &&
      incompleteStageFourCompletion.error.includes("Every Stage 4 task") &&
      incompleteStageFourCompletion.error.includes(stageFourB.name),
    "Project Owner must not complete Stage 4 while another concept is still In Progress",
  );

  const stageFourBEdit = await editProjectConceptFolder(owner, {
    projectId,
    stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    folderId: stageFourB.id,
    name: stageFourB.name,
    assignedExecutorId: executorB.id,
    brief: "Fresh Stage 4 geometric finalization brief.",
  });
  check(!isError(stageFourBEdit), "owner must configure the second Stage 4 concept");
  await startProjectStageWork(executorB, {
    projectId,
    stageId: stageFourB.taskerStageId,
  });
  const stageFourBRevision = await submitConceptRevision({
    user: executorB,
    actorName: executorB.name ?? executorB.email,
    projectId,
    stageId: stageFourB.taskerStageId,
    summary: "Stage 4 B final revision",
    fileNames: ["final-b.png"],
  });
  const stageFiveBefore = await prisma.projectWorkflowStage.findUniqueOrThrow({
    where: {
      projectId_stageKey: {
        projectId,
        stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
      },
    },
  });
  check(
    isError(await completeStageFourConcepts(coOwner, { projectId })),
    "Stage 4 must remain incomplete for an ADMIN while a concept has no final file",
  );
  const finalBApproval = await markStageFourFinalApprovedAttachment(owner, {
    projectId,
    folderId: stageFourB.id,
    attachmentId: stageFourBRevision.attachmentIds[0],
  });
  check(
    !isError(finalBApproval) &&
      finalBApproval.allConceptsApproved &&
      !("stageTransition" in finalBApproval),
    "final Stage 4 approval must wait for explicit owner completion confirmation",
  );

  const [stageFourCompletionA, stageFourCompletionB] = await Promise.all([
    completeStageFourConcepts(coOwner, { projectId }),
    completeStageFourConcepts(superAdmin, { projectId }),
  ]);
  check(
    !isError(stageFourCompletionA) &&
      !isError(stageFourCompletionB) &&
      (stageFourCompletionA.transitioned || stageFourCompletionB.transitioned),
    "manual Stage 4 confirmation must transition once and remain idempotent",
  );
  const stageFourCompletion = stageFourCompletionA;
  await notifyStageFiveActivated({
    projectId,
    finalFileCount: stageFourCompletion.finalApprovedCount,
    actorId: superAdmin.id,
  });
  const workflowAfterStageFour = await prisma.projectWorkflowStage.findMany({
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
  });
  const completedStageFour = workflowAfterStageFour.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
  );
  const availableStageFive = workflowAfterStageFour.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
  );
  check(
    completedStageFour?.status === ProjectWorkflowStageStatus.COMPLETED &&
      availableStageFive?.status === ProjectWorkflowStageStatus.AVAILABLE &&
      availableStageFive.unlockedAt !== null &&
      workflowAfterStageFour
        .filter(
          (stage) =>
            stage.stageKey === ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER ||
            stage.stageKey ===
              ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
        )
        .every((stage) => stage.status === ProjectWorkflowStageStatus.LOCKED),
    "Stage 4 must complete, Stage 5 unlock, and Stage 6/7 remain locked",
  );
  const repeatedStageFourCompletion = await completeStageFourConcepts(
    superAdmin,
    { projectId },
  );
  check(
    stageFiveBefore.unlockedAt === null &&
      !isError(repeatedStageFourCompletion) &&
      repeatedStageFourCompletion.transitioned === false &&
      (await prisma.projectWorkflowStage.findUniqueOrThrow({
        where: {
          projectId_stageKey: {
            projectId,
            stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
          },
        },
      })).unlockedAt?.getTime() === availableStageFive.unlockedAt?.getTime(),
    "Stage 4 completion retry must preserve the first Stage 5 unlock time",
  );

  const finalAttachmentIds = [
    stageFourARevisionTwo.attachmentIds[1],
    stageFourBRevision.attachmentIds[0],
  ];
  const handoffs = await prisma.projectStageFileHandoff.findMany({
    where: { projectId },
    include: { checklist: true },
  });
  check(
    handoffs.length === 2 &&
      handoffs.every((handoff) => handoff.checklist) &&
      handoffs.every((handoff) => finalAttachmentIds.includes(handoff.sourceAttachmentId)) &&
      new Set(handoffs.map((handoff) => handoff.sourceAttachmentId)).size === 2 &&
      (await prisma.projectAttachment.count({
        where: { id: { in: finalAttachmentIds } },
      })) === 2,
    "handoff must reference each original final attachment exactly once with one checklist",
  );

  const stageFiveWorkspace = await getStageFiveWorkspaceData(owner, projectId);
  check(
    stageFiveWorkspace?.files.length === 2 &&
      stageFiveWorkspace.files.every((file) =>
        finalAttachmentIds.includes(file.sourceAttachment.id),
      ),
    "Stage 5 selector must contain exactly Final A and Final B",
  );
  const fileA = stageFiveWorkspace.files.find(
    (file) => file.sourceAttachment.id === finalAttachmentIds[0],
  )!;
  const fileB = stageFiveWorkspace.files.find(
    (file) => file.sourceAttachment.id === finalAttachmentIds[1],
  )!;
  check(
    !isError(
      await saveStageFiveChecklist(owner, {
        projectId,
        handoffId: fileA.handoffId,
        items: [
          {
            fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
            value: { text: "Product A" },
            attachmentIds: [],
          },
          {
            fieldKey: ProjectFileChecklistField.BARCODE,
            value: { text: "AAA111" },
            attachmentIds: [],
          },
        ],
      }),
    ) &&
      !isError(
        await saveStageFiveChecklist(coOwner, {
          projectId,
          handoffId: fileB.handoffId,
          items: [
            {
              fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
              value: { text: "Product B" },
              attachmentIds: [],
            },
            {
              fieldKey: ProjectFileChecklistField.BARCODE,
              value: { text: "BBB222" },
              attachmentIds: [],
            },
          ],
        }),
      ),
    "Stage 5 owner/co-owner checklist edits must persist",
  );
  const refreshedA = await getStageFiveWorkspaceData(owner, projectId, fileA.handoffId);
  const refreshedB = await getStageFiveWorkspaceData(owner, projectId, fileB.handoffId);
  const outputValue = (
    workspace: NonNullable<typeof refreshedA>,
    fieldKey: ProjectFileChecklistField,
  ) => workspace.files.find((file) => file.handoffId === workspace.files.find(
    (candidate) => candidate.items.length > 0,
  )?.handoffId)?.items.find((item) => item.fieldKey === fieldKey)?.value.text;
  check(
    outputValue(refreshedA!, ProjectFileChecklistField.OUTPUT_NAME) === "Product A" &&
      outputValue(refreshedA!, ProjectFileChecklistField.BARCODE) === "AAA111" &&
      outputValue(refreshedB!, ProjectFileChecklistField.OUTPUT_NAME) === "Product B" &&
      outputValue(refreshedB!, ProjectFileChecklistField.BARCODE) === "BBB222",
    "Final A and Final B checklist values must remain isolated after refresh",
  );

  const inAppRequest = await requestStageFiveChecklistInformation(owner, {
    clientRequestId: `e2e_inapp_${runId}`,
    projectId,
    handoffId: fileA.handoffId,
    fieldKey: ProjectFileChecklistField.COMPULSORY_TEXT,
    channel: ProjectFileChecklistRequestChannel.IN_APP,
    recipientUserId: collaborator.id,
    message: "Provide the approved compulsory copy.",
  });
  check(!isError(inAppRequest), "existing collaborator request must succeed");
  check(
    (await getStageFiveChecklistRequestData(unrelatedUser, inAppRequest.request.id)) ===
      null,
    "unrelated user must not open the authenticated request",
  );
  check(
    !isError(
      await acceptStageFiveChecklistRequest(
        collaborator,
        inAppRequest.request.id,
      ),
    ),
    "exact collaborator recipient must accept the request",
  );
  const inAppResponse = await submitStageFiveChecklistResponse(collaborator, {
    requestId: inAppRequest.request.id,
    value: { values: ["Approved copy for Product A"] },
    attachmentIds: [],
  });
  check(!isError(inAppResponse), "authenticated collaborator response must complete");
  const completedInApp = await prisma.projectFileChecklistRequest.findUniqueOrThrow({
    where: { id: inAppRequest.request.id },
    include: { checklistItem: true },
  });
  check(
    completedInApp.workflowStatus ===
      ProjectFileChecklistRequestWorkflowStatus.COMPLETED &&
      (completedInApp.checklistItem.value as { values?: string[] } | null)?.values?.[0] ===
        "Approved copy for Product A" &&
      completedInApp.checklistId === fileA.checklistId,
    "authenticated response must update only the real Final A checklist",
  );

  let capturedEmail: SendEmailInput | null = null;
  const emailRequest = await requestStageFiveChecklistInformation(
    owner,
    {
      clientRequestId: `e2e_email_${runId}`,
      projectId,
      handoffId: fileB.handoffId,
      fieldKey: ProjectFileChecklistField.TAX_STAMP,
      channel: ProjectFileChecklistRequestChannel.EMAIL,
      recipientName: "E2E External Reviewer",
      recipientEmail: "e2e-external@example.test",
      message: "Provide the Product B tax stamp reference.",
    },
    {
      sendEmail: async (email) => {
        capturedEmail = email;
        return { ok: true, id: "e2e-safe-email" };
      },
    },
  );
  check(!isError(emailRequest), "safe manual-email request must persist");
  const externalToken = getExternalToken(capturedEmail);
  const persistedEmailRequest = await prisma.projectFileChecklistRequest.findUniqueOrThrow({
    where: { id: emailRequest.request.id },
  });
  check(
    Boolean(persistedEmailRequest.externalTokenHash) &&
      !JSON.stringify(persistedEmailRequest).includes(externalToken) &&
      (await getExternalChecklistRequestData(externalToken)).state === "active",
    "external request must persist only a token hash and expose only its scoped page",
  );
  const externalResponse = await submitExternalChecklistResponse(externalToken, {
    value: { text: "Product B approved external tax stamp" },
    attachmentIds: [],
  });
  check(!isError(externalResponse), "external response must complete without login");
  const completedEmail = await prisma.projectFileChecklistRequest.findUniqueOrThrow({
    where: { id: emailRequest.request.id },
    include: { checklistItem: true },
  });
  check(
    completedEmail.workflowStatus ===
      ProjectFileChecklistRequestWorkflowStatus.COMPLETED &&
      completedEmail.checklistId === fileB.checklistId &&
      (completedEmail.checklistItem.value as { text?: string } | null)?.text ===
        "<p>Product B approved external tax stamp</p>" &&
      (await getExternalChecklistRequestData(externalToken)).state === "completed",
    "external response must update only the real Final B checklist and revoke reuse",
  );
  const [activeFinalEligibility, activeFinalContext] = await Promise.all([
    getConceptApprovalRevocationEligibility(owner, {
      projectId,
      folderId: stageFourA.id,
      workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    }),
    getProjectConceptChatContext(owner, {
      projectId,
      folderId: stageFourA.id,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    }),
  ]);
  check(
    activeFinalEligibility.canRevoke &&
      activeFinalContext?.chatMode.approvalRevocationEligibility.canRevoke === true,
    "Stage 5 requests, responses, values, and attachments must keep Stage 4 Revoke Approval visible while Stage 5 is ongoing",
  );

  const protectedReplacement = await markStageFourFinalApprovedAttachment(owner, {
    projectId,
    folderId: stageFourB.id,
    attachmentId: stageFourBRevision.attachmentIds[0],
  });
  check(
    !isError(protectedReplacement) && !protectedReplacement.changed,
    "the same final designation must remain idempotent for legacy status reconciliation after Stage 4 completion",
  );
  const postCompletionReplacement = await markStageFourFinalApprovedAttachment(owner, {
    projectId,
    folderId: stageFourA.id,
    attachmentId: stageFourARevisionTwo.attachmentIds[0],
  });
  check(
    isError(postCompletionReplacement) &&
      postCompletionReplacement.error.includes("Stage 4 is completed"),
    "Stage 4 final replacement must be locked after completion without losing Stage 5 data",
  );
  check(
    (await prisma.projectFileChecklistRequest.count({ where: { projectId } })) === 2 &&
      (await prisma.projectFileChecklist.count({ where: { projectId } })) === 2 &&
      (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 2,
    "revocation eligibility checks must leave downstream requests, checklists, and handoffs intact",
  );

  const stageFiveCompletion = await completeStageFive(owner, { projectId });
  check(
    !isError(stageFiveCompletion) &&
      stageFiveCompletion.transitioned &&
      stageFiveCompletion.productionUnitCount === 2,
    "completed Stage 5 must create untouched Stage 6 bootstrap units",
  );
  const completedStageFiveRevocation =
    await revokeStageFourFinalApprovedAttachment(owner, {
      projectId,
      folderId: stageFourA.id,
    });
  check(
    isError(completedStageFiveRevocation) &&
      completedStageFiveRevocation.error.includes("Stage 5 is already completed"),
    "Stage 4 final revocation must become unavailable only after Stage 5 completion",
  );
  const stageSixUnit = await prisma.projectProductionUnit.findFirstOrThrow({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const [untouchedStageSixEligibility, untouchedStageSixContext, executorRevokeEligibility] =
    await Promise.all([
      getConceptApprovalRevocationEligibility(owner, {
        projectId,
        folderId: conceptA.id,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      }),
      getProjectConceptChatContext(owner, {
        projectId,
        folderId: conceptA.id,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      }),
      getConceptApprovalRevocationEligibility(executorA, {
        projectId,
        folderId: conceptA.id,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      }),
    ]);
  check(
    untouchedStageSixEligibility.canRevoke &&
      untouchedStageSixContext?.chatMode.isWorkflowCompleted === true &&
      untouchedStageSixContext.chatMode.approvalRevocationEligibility.canRevoke,
    "completed Stage 5 with untouched Stage 6 bootstrap units must keep Stage 3 Revoke Approval visible",
  );
  check(
    !executorRevokeEligibility.canRevoke &&
      executorRevokeEligibility.reason === "UNAUTHORIZED",
    "a USER executor must never receive Stage 3 revocation eligibility",
  );
  await prisma.projectProductionUnit.update({
    where: { id: stageSixUnit.id },
    data: { status: ProjectProductionUnitStatus.APPROVAL_PENDING },
  });
  const [startedStageSixEligibility, startedStageSixContext] = await Promise.all([
    getConceptApprovalRevocationEligibility(owner, {
      projectId,
      folderId: conceptA.id,
      workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
    }),
    getProjectConceptChatContext(owner, {
      projectId,
      folderId: conceptA.id,
      stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
    }),
  ]);
  check(
    !startedStageSixEligibility.canRevoke &&
      startedStageSixEligibility.reason === "STAGE6_PRODUCTION_STARTED" &&
      startedStageSixContext?.chatMode.approvalRevocationEligibility.canRevoke === false,
    "actual Stage 6 production activity must hide Stage 3 Revoke Approval",
  );
  const startedStageSixRevocation =
    await revokeProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
    });
  check(
    isError(startedStageSixRevocation) &&
      startedStageSixRevocation.error.includes(
        "Stage 6 production work has already started",
      ),
    "Stage 3 rework must be blocked after Stage 6 production work starts",
  );
  await prisma.projectProductionUnit.update({
    where: { id: stageSixUnit.id },
    data: { status: ProjectProductionUnitStatus.PREPARATION },
  });
  const restoredStageThreeEligibility =
    await getConceptApprovalRevocationEligibility(owner, {
      projectId,
      folderId: conceptA.id,
      workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
    });
  check(
    restoredStageThreeEligibility.canRevoke,
    "Stage 3 Revoke Approval must return when Stage 6 is restored to its untouched bootstrap state",
  );

  const stageThreeRework = await revokeProjectConceptApprovedAttachment(owner, {
    projectId,
    folderId: conceptA.id,
  });
  check(
    !isError(stageThreeRework) &&
      stageThreeRework.reopensWorkflowStage &&
      stageThreeRework.resetThroughStageFive &&
      stageThreeRework.cascadedStageFourApproval &&
      stageThreeRework.removedStageFiveHandoff,
    "Stage 3 rework must be allowed after completed Stage 5 while Stage 6 remains untouched",
  );
  const [reworkWorkflow, dependentStageFour] = await Promise.all([
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
      where: { id: stageFourA.id },
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
    "Stage 3 rework must relock Stages 4 through 7 as a valid workflow suffix",
  );
  check(
    dependentStageFour.approvedAttachmentId === null &&
      dependentStageFour.sourceStage3ApprovedAttachmentId ===
        stageFourA.sourceStage3ApprovedAttachmentId &&
      dependentStageFour.taskerStage.status === StageStatus.ONGOING &&
      (await prisma.projectStageFileHandoff.count({ where: { projectId } })) === 1 &&
      (await prisma.projectFileChecklist.count({ where: { projectId } })) === 1 &&
      (await prisma.projectFileChecklistRequest.count({ where: { projectId } })) === 1 &&
      (await prisma.projectProductionUnit.count({ where: { projectId } })) === 1,
    "rework must reset only the dependent Stage 4 approval and Stage 5/6 lineage",
  );
  const revokedStageThreeEligibility =
    await getConceptApprovalRevocationEligibility(owner, {
      projectId,
      folderId: conceptA.id,
      workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
    });
  check(
    !revokedStageThreeEligibility.canRevoke &&
      revokedStageThreeEligibility.reason === "NOT_APPROVED",
    "a revoked Stage 3 concept must no longer expose Revoke Approval",
  );
  const reworkedStageThreeApproval =
    await markProjectConceptApprovedAttachment(owner, {
      projectId,
      folderId: conceptA.id,
      attachmentId: revisionThree.attachmentIds[0],
    });
  check(
    !isError(reworkedStageThreeApproval) &&
      reworkedStageThreeApproval.changed &&
      (await prisma.projectConceptFolder.findUniqueOrThrow({
        where: { id: stageFourA.id },
        select: { sourceStage3ApprovedAttachmentId: true },
      })).sourceStage3ApprovedAttachmentId === revisionThree.attachmentIds[0],
    "the dependent Stage 4 task must relink to the newly approved Stage 3 file",
  );
  check(
    (
      await getConceptApprovalRevocationEligibility(owner, {
        projectId,
        folderId: conceptA.id,
        workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      })
    ).canRevoke,
    "a re-approved Stage 3 concept must expose Revoke Approval again when downstream work remains safe",
  );

  console.log(
    JSON.stringify(
      {
        qaProjectId: projectId,
        qaProjectName: `E2E QA - Concept Workflow - ${runLabel}`,
        qaUserIds: userIds,
        stageThreeConcepts: concepts.map((concept) => concept.name),
        stageFourConcepts: stageFourFolders.map((concept) => concept.name),
        finalFileIds: finalAttachmentIds,
        stageFiveHandoffIds: [fileA.handoffId, fileB.handoffId],
        result: "Stage 3 -> Stage 4 -> Stage 5 service-path E2E passed",
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => {
    console.log("Stage 3-5 E2E QA passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.project.deleteMany({ where: { id: { in: qaProjectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: qaUserIds } } });
    await prisma.$disconnect();
  });

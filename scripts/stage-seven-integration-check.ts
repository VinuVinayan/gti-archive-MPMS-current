import { randomUUID } from "node:crypto";
import {
  AttachmentAssetType,
  AttachmentStatus,
  PhysicalSampleDecision,
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
  UserRole,
} from "@prisma/client";

import type { SendEmailInput } from "../src/lib/email/resend";
import { getNotificationsForUser } from "../src/lib/notification-center";
import { prisma } from "../src/lib/prisma";
import {
  closeStageSevenProject,
  createProductionSampleRound,
  deleteProductionSampleRound,
  decidePhysicalSampleRound,
  getStageSevenWorkspaceData,
  getAssignedPhysicalSampleTask,
  markPhysicalSampleRoundReceived,
  processStageSevenOverdueDeadlines,
  retryProductionSampleRequestEmail,
} from "../src/lib/stage-seven";
import { getPhysicalSampleRequestActionState } from "../src/lib/stage-seven-sample-actions";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Stage 7 integration check failed: ${message}`);
}

async function expectRejected(task: Promise<unknown>, message: string) {
  try {
    await task;
  } catch {
    return;
  }
  throw new Error(`Stage 7 integration check failed: ${message}`);
}

function deadlineDate(offsetDays = 1) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function checkPhysicalSampleRequestActionStates() {
  const base = {
    selected: true,
    canManage: true,
    canReview: true,
    stageCompleted: false,
    hasDecision: false,
    unitStatus: ProductionSupervisionStatus.IN_REVIEW,
    roundStatus: ProductionSampleRoundStatus.UNDER_REVIEW,
  };
  const selectedReceived = getPhysicalSampleRequestActionState(base);
  check(
    selectedReceived.showRowDelete &&
      selectedReceived.showDetailsDelete &&
      selectedReceived.showReviewAction &&
      selectedReceived.reviewable &&
      selectedReceived.reviewActionsEnabled,
    "a selected eligible request must retain its row Delete action, expose the details Delete action, and enable both review actions",
  );

  const unselected = getPhysicalSampleRequestActionState({
    ...base,
    selected: false,
  });
  check(
    unselected.showRowDelete && !unselected.showDetailsDelete,
    "an unselected eligible request must expose its own row-level Delete action",
  );

  const pending = getPhysicalSampleRequestActionState({
    ...base,
    roundStatus: ProductionSampleRoundStatus.PENDING,
  });
  check(
    pending.showMarkReceived && !pending.reviewActionsEnabled,
    "a pending external request must require receipt before either review action is enabled",
  );

  const pendingInternalRecipient = getPhysicalSampleRequestActionState({
    ...base,
    canManage: false,
    roundStatus: ProductionSampleRoundStatus.PENDING,
  });
  check(
    pendingInternalRecipient.showMarkReceived &&
      !pendingInternalRecipient.reviewActionsEnabled,
    "a pending internal request must require its assigned recipient to record receipt before deciding",
  );

  const internalOwner = getPhysicalSampleRequestActionState({
    ...base,
    canReview: false,
  });
  check(
    internalOwner.showDetailsDelete &&
      !internalOwner.showReviewAction &&
      !internalOwner.reviewable &&
      !internalOwner.reviewActionsEnabled,
    "an internal-request owner may manage the selected request but must not review it",
  );

  const internalRecipient = getPhysicalSampleRequestActionState({
    ...base,
    canManage: false,
  });
  check(
    !internalRecipient.showRowDelete &&
      !internalRecipient.showDetailsDelete &&
      internalRecipient.showReviewAction &&
      internalRecipient.reviewActionsEnabled,
    "the assigned internal recipient must review a received request without receiving Delete access",
  );

  const accepted = getPhysicalSampleRequestActionState({
    ...base,
    hasDecision: true,
    unitStatus: ProductionSupervisionStatus.SIGNED_OFF,
  });
  check(
    !accepted.reviewable &&
      !accepted.showReviewAction &&
      !accepted.reviewActionsEnabled &&
      !accepted.showMarkReceived &&
      !accepted.showRowDelete &&
      !accepted.showDetailsDelete,
    "an accepted request must immediately remove every receipt, review, and delete action",
  );
}

type FixtureUnit = {
  id: string;
  sourceAttachmentId: string;
  referenceAttachmentId: string;
  outputName: string;
  rawFileName: string;
};

async function createReadyAttachment(input: {
  projectId: string;
  uploadedById: string;
  runId: string;
  name: string;
}) {
  return prisma.projectAttachment.create({
    data: {
      projectId: input.projectId,
      uploadedById: input.uploadedById,
      fileName: input.name.replaceAll(" ", "-").toLocaleLowerCase("en-US"),
      originalFileName: input.name,
      mimeType: "application/pdf",
      fileSize: 1024,
      bucket: "stage-seven-integration",
      storageKey: `stage-seven/${input.runId}/${input.projectId}/${randomUUID()}`,
      assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
      status: AttachmentStatus.READY,
    },
  });
}

async function createProjectFixture(input: {
  id: string;
  ownerId: string;
  coOwnerId: string;
  executorId: string;
  collaboratorId: string;
  unitNames: string[];
  runId: string;
}) {
  await prisma.project.create({
    data: {
      id: input.id,
      name: `Stage 7 Physical Sample ${input.id}`,
      createdById: input.ownerId,
      ownerId: input.ownerId,
      coOwners: { create: [{ userId: input.coOwnerId, addedById: input.ownerId }] },
      executors: { create: [{ userId: input.executorId, addedById: input.ownerId }] },
      collaborators: {
        create: [{ userId: input.collaboratorId, addedById: input.ownerId, canInteract: true }],
      },
      workflowStages: {
        create: getInitialProjectWorkflowStageData().map((stage, index) => {
          const now = new Date();
          return {
            ...stage,
            status:
              index < 6
                ? ProjectWorkflowStageStatus.COMPLETED
                : ProjectWorkflowStageStatus.AVAILABLE,
            unlockedAt: now,
            completedAt: index < 6 ? now : null,
          };
        }),
      },
    },
  });

  const units: FixtureUnit[] = [];
  for (const [index, outputName] of input.unitNames.entries()) {
    const rawFileName = `unit-${index + 1}-source.pdf`;
    const source = await createReadyAttachment({
      projectId: input.id,
      uploadedById: input.ownerId,
      runId: input.runId,
      name: rawFileName,
    });
    const reference = await createReadyAttachment({
      projectId: input.id,
      uploadedById: input.ownerId,
      runId: input.runId,
      name: `unit-${index + 1}-production-reference.pdf`,
    });
    const handoff = await prisma.projectStageFileHandoff.create({
      data: {
        projectId: input.id,
        sourceWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        sourceAttachmentId: source.id,
        targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
        handedOffById: input.ownerId,
      },
    });
    const checklist = await prisma.projectFileChecklist.create({
      data: {
        projectId: input.id,
        handoffId: handoff.id,
        sourceAttachmentId: source.id,
        items: {
          create: {
            fieldKey: ProjectFileChecklistField.OUTPUT_NAME,
            value: { text: outputName },
            updatedById: input.ownerId,
          },
        },
      },
    });
    const unit = await prisma.projectProductionUnit.create({
      data: {
        projectId: input.id,
        sourceHandoffId: handoff.id,
        sourceChecklistId: checklist.id,
        sourceAttachmentId: source.id,
        status: ProjectProductionUnitStatus.HANDED_OVER,
        createdById: input.ownerId,
        approvedAt: new Date(),
        handedOverAt: new Date(),
        files: {
          create: {
            attachmentId: reference.id,
            addedById: input.ownerId,
          },
        },
      },
    });
    units.push({
      id: unit.id,
      sourceAttachmentId: source.id,
      referenceAttachmentId: reference.id,
      outputName,
      rawFileName,
    });
  }
  return units;
}

async function main() {
  checkPhysicalSampleRequestActionStates();

  process.env.AWS_REGION ||= "us-east-1";
  process.env.AWS_ACCESS_KEY_ID ||= "stage-seven-test";
  process.env.AWS_SECRET_ACCESS_KEY ||= "stage-seven-test-secret";
  process.env.AWS_S3_BUCKET ||= "stage-seven-integration";
  process.env.S3_USE_ACCELERATE_ENDPOINT ||= "false";

  const runId = randomUUID();
  const ids = {
    owner: `s7-owner-${runId}`,
    coOwner: `s7-coowner-${runId}`,
    executor: `s7-executor-${runId}`,
    collaborator: `s7-collab-${runId}`,
    admin: `s7-admin-${runId}`,
    superAdmin: `s7-super-${runId}`,
    outsider: `s7-outsider-${runId}`,
    project: `s7-main-${runId}`,
    foreignProject: `s7-foreign-${runId}`,
  };
  const userIds = [ids.owner, ids.coOwner, ids.executor, ids.collaborator, ids.admin, ids.superAdmin, ids.outsider];
  const projectIds = [ids.project, ids.foreignProject];
  const owner = { id: ids.owner, role: UserRole.ADMIN };
  const coOwner = { id: ids.coOwner, role: UserRole.ADMIN };
  const executor = { id: ids.executor, role: UserRole.USER };
  const collaborator = { id: ids.collaborator, role: UserRole.USER };
  const superAdmin = { id: ids.superAdmin, role: UserRole.SUPER_ADMIN };
  const sentEmails: SendEmailInput[] = [];
  const sentEmailCount = () => sentEmails.length;
  const sendSuccess = async (email: SendEmailInput) => {
    sentEmails.push(email);
    return { ok: true as const, id: `sample-email-${sentEmails.length}` };
  };
  const sendFailure = async (): Promise<{ ok: true; id?: string } | { ok: false; error: string }> => {
    throw new Error("Mock Resend delivery failure");
  };

  try {
    await prisma.user.createMany({
      data: [
        [ids.owner, UserRole.ADMIN],
        [ids.coOwner, UserRole.ADMIN],
        [ids.executor, UserRole.USER],
        [ids.collaborator, UserRole.USER],
        [ids.admin, UserRole.ADMIN],
        [ids.superAdmin, UserRole.SUPER_ADMIN],
        [ids.outsider, UserRole.USER],
      ].map(([id, role]) => ({
        id,
        email: `${id}@example.test`,
        name: id,
        passwordHash: "integration-only",
        role: role as UserRole,
      })),
    });

    const units = await createProjectFixture({
      id: ids.project,
      ownerId: ids.owner,
      coOwnerId: ids.coOwner,
      executorId: ids.executor,
      collaboratorId: ids.collaborator,
      unitNames: ["Retail Carton", "Master Shipping Case"],
      runId,
    });
    const foreignUnits = await createProjectFixture({
      id: ids.foreignProject,
      ownerId: ids.outsider,
      coOwnerId: ids.coOwner,
      executorId: ids.executor,
      collaboratorId: ids.collaborator,
      unitNames: ["Foreign Pack"],
      runId,
    });

    const initial = await getStageSevenWorkspaceData(owner, ids.project);
    check(initial?.units.length === 2, "the loader must derive handed-over Stage 6 units");
    check(
      (await getStageSevenWorkspaceData(executor, ids.project)) === null,
      "project membership must not expose the Stage 7 manager workspace to a USER",
    );
    check(initial.units[0].name === "Retail Carton" && initial.units[0].rawFileName === "unit-1-source.pdf", "OUTPUT_NAME must be primary and raw filename secondary");
    check(initial.units.every((unit) => unit.status === ProductionSupervisionStatus.NOT_STARTED), "missing supervision must display Not Started");
    check((await prisma.projectProductionSupervision.count({ where: { projectId: ids.project } })) === 0, "read-only loading must not create supervision rows");

    const baseInput = {
      projectId: ids.project,
      productionUnitId: units[0].id,
      name: "Retail carton courier sample",
      type: ProductionSampleRoundType.PRODUCTION_SAMPLE,
      deadline: deadlineDate(2),
      recipientRoute: ProductionHandoverRoute.DIRECT_VENDOR,
      recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
      recipientCompany: "ABC Packaging LLC",
      recipientName: "ABC Packaging",
      recipientEmail: "supplier.external@example.test",
      recipientPhone: "971 50 123 4567",
      requestNote: "Please courier one physical sample before the deadline.",
    };
    await expectRejected(createProductionSampleRound(executor, { ...baseInput, clientRequestId: `executor-${runId}` }, { sendEmail: sendSuccess }), "an executor must not manage Stage 7");
    await expectRejected(createProductionSampleRound(collaborator, { ...baseInput, clientRequestId: `collab-${runId}` }, { sendEmail: sendSuccess }), "a collaborator must not manage Stage 7");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `blank-name-${runId}`, name: " " }, { sendEmail: sendSuccess }), "Round Name must be required");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `bad-date-${runId}`, deadline: "not-a-date" }, { sendEmail: sendSuccess }), "Deadline must be a valid date");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `bad-email-${runId}`, recipientEmail: "invalid" }, { sendEmail: sendSuccess }), "Recipient Email must be valid");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `bad-company-${runId}`, recipientCompany: "" }, { sendEmail: sendSuccess }), "External recipient company must be required");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `bad-phone-${runId}`, recipientPhone: "0501234567" }, { sendEmail: sendSuccess }), "External recipient phone must include a country code");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `bad-internal-${runId}`, recipientRoute: ProductionHandoverRoute.PURCHASE_DEPARTMENT, recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR, recipientUserId: ids.outsider }, { sendEmail: sendSuccess }), "Internal recipient must belong to the project");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `custom-${runId}`, type: ProductionSampleRoundType.CUSTOM }, { sendEmail: sendSuccess }), "Custom Sample Type must require a label");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `foreign-ref-${runId}`, referenceFileIds: [foreignUnits[0].sourceAttachmentId] }, { sendEmail: sendSuccess }), "reference files must not cross projects or Production Units");

    const failedClientRequestId = `failed-request-${runId}`;
    const failed = await createProductionSampleRound(owner, {
      ...baseInput,
      clientRequestId: failedClientRequestId,
    }, { sendEmail: sendFailure });
    check(!failed.duplicate && failed.emailStatus === ProductionDispatchStatus.FAILED, "a delivery failure must return FAILED without deleting the request");
    const failedRow = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: failed.id } });
    check(failedRow.emailStatus === ProductionDispatchStatus.FAILED && failedRow.emailAttemptCount === 1 && failedRow.emailSentAt === null, "the request must persist before email and retain its failed audit");
    check(failedRow.requestReferenceFileIds.length === 2 && failedRow.requestReferenceFileIds.includes(units[0].sourceAttachmentId) && failedRow.requestReferenceFileIds.includes(units[0].referenceAttachmentId), "the request snapshot must contain only this unit's source and production files");
    check((await prisma.projectProductionSupervision.findUniqueOrThrow({ where: { productionUnitId: units[0].id } })).status === ProductionSupervisionStatus.NOT_STARTED, "failed delivery must not claim that GTI is waiting for a sample");
    const duplicateFailure = await createProductionSampleRound(owner, { ...baseInput, clientRequestId: failedClientRequestId }, { sendEmail: sendSuccess });
    check(duplicateFailure.duplicate && sentEmailCount() === 0, "the create idempotency key must not duplicate or silently resend a failed request");
    const parallelRequest = await createProductionSampleRound(owner, { ...baseInput, clientRequestId: `parallel-pending-${runId}`, name: "Parallel physical sample request" }, { sendEmail: sendFailure });
    check(!parallelRequest.duplicate && parallelRequest.emailStatus === ProductionDispatchStatus.FAILED, "a manager must be able to create another request while an earlier request is still pending");

    const retried = await retryProductionSampleRequestEmail(owner, {
      projectId: ids.project,
      productionUnitId: units[0].id,
      sampleRoundId: failed.id,
    }, { sendEmail: sendSuccess });
    check(!retried.duplicate && retried.emailStatus === ProductionDispatchStatus.SENT && sentEmailCount() === 1, "retry must send the same persisted round exactly once");
    const retriedRow = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: failed.id } });
    check(retriedRow.emailStatus === ProductionDispatchStatus.SENT && retriedRow.emailAttemptCount === 2 && Boolean(retriedRow.emailSentAt), "retry success must persist SENT, sentAt, and attempt count");
    check((await prisma.projectProductionSupervision.findUniqueOrThrow({ where: { productionUnitId: units[0].id } })).status === ProductionSupervisionStatus.IN_REVIEW, "successful send must move the unit to Waiting for Sample");
    const firstEmail = sentEmails[0];
    check(firstEmail.to === "supplier.external@example.test", "the request must send to the arbitrary external recipient email");
    check(failedRow.recipientRoute === ProductionHandoverRoute.DIRECT_VENDOR && failedRow.recipientType === ProductionApprovalRecipientType.EXTERNAL_EMAIL && failedRow.recipientCompany === "ABC Packaging LLC" && failedRow.recipientPhone === "+971501234567", "external sample recipient route, company, and normalized phone must persist");
    check(firstEmail.text.includes("Retail Carton") && firstEmail.text.includes("Retail carton courier sample") && firstEmail.text.includes("Production Sample") && firstEmail.text.includes("Please courier one physical sample"), "the professional email must include project-unit-round-type-deadline-note context");
    check(firstEmail.text.includes("unit-1-source.pdf") && firstEmail.text.includes("unit-1-production-reference.pdf") && !firstEmail.text.includes("unit-2-source.pdf") && !firstEmail.text.includes("Foreign Pack"), "email links must be scoped to the selected Stage 6 unit");
    check((firstEmail.text.match(/X-Amz-/g) ?? []).length >= 2, "reference files must use expiring signed download links");
    const resent = await retryProductionSampleRequestEmail(coOwner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id }, { sendEmail: sendSuccess });
    check(!resent.duplicate && resent.emailStatus === ProductionDispatchStatus.SENT && sentEmailCount() === 2, "an already sent request must support an explicit resend");
    check((await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: failed.id } })).emailAttemptCount === 3, "resend must increment the audited email attempt count");

    const olderDeletableRound = await createProductionSampleRound(owner, {
      ...baseInput,
      clientRequestId: `older-deletable-${runId}`,
      name: "Older active sample request",
    }, { sendEmail: sendFailure });
    const newerDeletableRound = await createProductionSampleRound(owner, {
      ...baseInput,
      clientRequestId: `newer-deletable-${runId}`,
      name: "Newer active sample request",
    }, { sendEmail: sendFailure });
    const deletedOlderRound = await deleteProductionSampleRound(owner, {
      projectId: ids.project,
      productionUnitId: units[0].id,
      sampleRoundId: olderDeletableRound.id,
    });
    check(
      deletedOlderRound.deleted &&
        (await prisma.productionSampleRound.findUnique({ where: { id: olderDeletableRound.id } })) === null &&
        Boolean(await prisma.productionSampleRound.findUnique({ where: { id: newerDeletableRound.id } })),
      "a manager must be able to delete an older active request without deleting the newer active request",
    );
    await deleteProductionSampleRound(owner, {
      projectId: ids.project,
      productionUnitId: units[0].id,
      sampleRoundId: newerDeletableRound.id,
    });

    await expectRejected(deleteProductionSampleRound(executor, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: parallelRequest.id }), "an executor must not delete physical sample requests");
    const deletedPending = await deleteProductionSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: parallelRequest.id });
    check(deletedPending.deleted && (await prisma.productionSampleRound.findUnique({ where: { id: parallelRequest.id } })) === null, "a manager must be able to delete an undecided physical sample request");
    check((await prisma.projectProductionSupervision.findUniqueOrThrow({ where: { productionUnitId: units[0].id } })).status === ProductionSupervisionStatus.IN_REVIEW, "deleting one pending request must preserve the status derived from remaining requests");

    await expectRejected(decidePhysicalSampleRound(executor, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "Executor cannot decide." }), "executors must not decide physical sample requests");
    await expectRejected(decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.REJECTED }), "rejection must require a physical review note");
    await expectRejected(decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "Wrong unit." }), "a decision must not cross Production Units");
    await expectRejected(decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.ACCEPTED }), "a physical sample must not be accepted before it is received");
    await expectRejected(markPhysicalSampleRoundReceived(executor, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id }), "an executor must not mark a physical sample as received");
    const received = await markPhysicalSampleRoundReceived(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id });
    check(!received.duplicate, "a manager must be able to mark a pending physical sample as received");
    check((await markPhysicalSampleRoundReceived(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id })).duplicate, "marking the same physical sample as received must be idempotent");
    const receivedRow = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: failed.id } });
    check(receivedRow.status === ProductionSampleRoundStatus.UNDER_REVIEW && Boolean(receivedRow.deliveredAt), "receipt must persist the Under Review status and received timestamp");
    const receivedWorkspace = await getStageSevenWorkspaceData(owner, ids.project, units[0].id, failed.id);
    check(receivedWorkspace?.units[0].rounds[0].status === ProductionSampleRoundStatus.UNDER_REVIEW && Boolean(receivedWorkspace.units[0].rounds[0].receivedAt), "the Stage 7 workspace must expose the persisted receipt state");
    const rejected = await decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "Colour is outside the approved tolerance." });
    check(!rejected.duplicate, "the manager must be able to reject the delivered physical sample");
    const rejectedRow = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: failed.id } });
    check(rejectedRow.decision === PhysicalSampleDecision.REJECTED && rejectedRow.decisionNote === "<p>Colour is outside the approved tolerance.</p>" && rejectedRow.decidedById === ids.owner && Boolean(rejectedRow.decidedAt), "rejection must persist immutable decision audit fields");
    check(rejectedRow.status === ProductionSampleRoundStatus.COMPLETED && (await prisma.projectProductionSupervision.findUniqueOrThrow({ where: { productionUnitId: units[0].id } })).status === ProductionSupervisionStatus.REVISIONS_NEEDED, "rejection must map to Rejected while preserving the legacy status field");
    check((await decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "Ignored duplicate note" })).duplicate, "the same final decision must be idempotent");
    await expectRejected(decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.ACCEPTED }), "a rejected round must never be overwritten as accepted");
    await expectRejected(deleteProductionSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id }), "rejected sample-request history must not be deletable");

    const stalePendingRound = await createProductionSampleRound(coOwner, {
      ...baseInput,
      clientRequestId: `stale-pending-${runId}`,
      name: "Parallel request to remove after acceptance",
      deadline: deadlineDate(4),
    }, { sendEmail: sendSuccess });
    const acceptedRound = await createProductionSampleRound(coOwner, {
      ...baseInput,
      clientRequestId: `accepted-round-${runId}`,
      name: "Retail carton corrected final sample",
      type: ProductionSampleRoundType.FINAL_MASS_PRODUCTION_SIGN_OFF,
      deadline: deadlineDate(3),
    }, { sendEmail: sendSuccess });
    check(!acceptedRound.duplicate && acceptedRound.emailStatus === ProductionDispatchStatus.SENT, "rejection must allow a new independent sample request");
    check((await decidePhysicalSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: failed.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "Old round" })).duplicate, "replaying the same decision on an earlier round must be a no-op");
    await markPhysicalSampleRoundReceived(superAdmin, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: acceptedRound.id });
    const accepted = await decidePhysicalSampleRound(superAdmin, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: acceptedRound.id, decision: PhysicalSampleDecision.ACCEPTED, decisionNote: "Physical sample matches approved production artwork." });
    check(!accepted.duplicate, "SUPER_ADMIN must be able to accept a physical sample");
    const acceptedSupervision = await prisma.projectProductionSupervision.findUniqueOrThrow({ where: { productionUnitId: units[0].id } });
    check(acceptedSupervision.status === ProductionSupervisionStatus.IN_REVIEW && !acceptedSupervision.signedOffById && !acceptedSupervision.signedOffAt, "accepting one request must keep the unit in review while another request is active");
    const siblingAfterAcceptance = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: stalePendingRound.id } });
    check(siblingAfterAcceptance.status === ProductionSampleRoundStatus.PENDING && siblingAfterAcceptance.decision === null, "accepting one request must not complete or change an active sibling request");
    const workspaceAfterAcceptance = await getStageSevenWorkspaceData(owner, ids.project, units[0].id, acceptedRound.id);
    const unitAfterAcceptance = workspaceAfterAcceptance?.units.find((unit) => unit.id === units[0].id);
    check(
      unitAfterAcceptance?.rounds.some((round) => round.id === acceptedRound.id && round.decision === PhysicalSampleDecision.ACCEPTED) &&
        unitAfterAcceptance.rounds.some((round) => round.id === stalePendingRound.id && round.decision === null),
      "the Stage 7 list must retain both the accepted request and every active sibling request",
    );
    check((await prisma.projectProductionUnit.findUniqueOrThrow({ where: { id: units[0].id } })).status === ProjectProductionUnitStatus.HANDED_OVER, "Stage 7 must not mutate the Stage 6 HANDED_OVER state");
    const retriedSibling = await retryProductionSampleRequestEmail(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: stalePendingRound.id }, { sendEmail: sendSuccess });
    check(!retriedSibling.duplicate && retriedSibling.emailStatus === ProductionDispatchStatus.SENT, "accepting one request must preserve the actions of an active sibling request");
    await deleteProductionSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: stalePendingRound.id });
    const signedOffSupervision = await prisma.projectProductionSupervision.findUniqueOrThrow({ where: { productionUnitId: units[0].id } });
    check(signedOffSupervision.status === ProductionSupervisionStatus.SIGNED_OFF && signedOffSupervision.signedOffById === ids.superAdmin && Boolean(signedOffSupervision.signedOffAt), "the unit must become Accepted only after no sibling request remains active");
    await expectRejected(createProductionSampleRound(owner, { ...baseInput, clientRequestId: `locked-unit-${runId}` }, { sendEmail: sendSuccess }), "accepted units must lock further sample requests");
    await expectRejected(deleteProductionSampleRound(owner, { projectId: ids.project, productionUnitId: units[0].id, sampleRoundId: acceptedRound.id }), "accepted sample-request history must not be deletable");

    const deletableInternalRound = await createProductionSampleRound(owner, {
      projectId: ids.project,
      productionUnitId: units[1].id,
      clientRequestId: `delete-internal-${runId}`,
      name: "Temporary internal sample request",
      type: ProductionSampleRoundType.PRE_PRODUCTION_SAMPLE,
      deadline: deadlineDate(2),
      recipientRoute: ProductionHandoverRoute.PURCHASE_DEPARTMENT,
      recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
      recipientUserId: ids.executor,
      requestNote: "This request will be deleted by the integration check.",
    }, { sendEmail: sendSuccess });
    check((await prisma.notification.count({ where: { type: "PRODUCTION_SAMPLE_REQUESTED", entityId: deletableInternalRound.id, userId: ids.executor } })) === 1, "an internal request must create its recipient notification before deletion");
    await deleteProductionSampleRound(owner, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: deletableInternalRound.id });
    check((await prisma.notification.count({ where: { entityType: "SAMPLE_ROUND", entityId: deletableInternalRound.id } })) === 0, "deleting an internal request must remove its recipient notification");
    check((await getStageSevenWorkspaceData(executor, ids.project, units[1].id, deletableInternalRound.id)) === null, "a deleted request must disappear from the internal recipient workspace");

    const recipientDecisionInput = {
      projectId: ids.project,
      productionUnitId: units[1].id,
      clientRequestId: `recipient-decision-${runId}`,
      name: "Internal recipient review sample",
      type: ProductionSampleRoundType.PRODUCTION_SAMPLE,
      deadline: deadlineDate(2),
      recipientRoute: ProductionHandoverRoute.PURCHASE_DEPARTMENT,
      recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
      recipientUserId: ids.executor,
      requestNote: "The assigned internal recipient will review this sample.",
    };
    const recipientDecisionRound = await createProductionSampleRound(
      owner,
      recipientDecisionInput,
      { sendEmail: sendSuccess },
    );
    check(
      (await prisma.notification.count({
        where: {
          type: "PRODUCTION_SAMPLE_REQUESTED",
          entityId: recipientDecisionRound.id,
          userId: ids.executor,
        },
      })) === 1,
      "creating an internal request must immediately persist its recipient notification",
    );
    await prisma.notification.deleteMany({
      where: {
        type: "PRODUCTION_SAMPLE_REQUESTED",
        entityId: recipientDecisionRound.id,
      },
    });
    const replayedRecipientDecisionRound = await createProductionSampleRound(
      owner,
      recipientDecisionInput,
      { sendEmail: sendSuccess },
    );
    check(
      replayedRecipientDecisionRound.duplicate &&
        (await prisma.notification.count({
          where: {
            type: "PRODUCTION_SAMPLE_REQUESTED",
            entityId: recipientDecisionRound.id,
            userId: ids.executor,
          },
        })) === 1,
      "an idempotent internal-request retry must repair a missing recipient notification",
    );
    const recipientInbox = await getNotificationsForUser({
      userId: ids.executor,
      page: 1,
      pageSize: 50,
    });
    check(
      recipientInbox.notifications.some(
        (notification) =>
          notification.title === "Physical sample requested" &&
          notification.targetHref ===
            `/tasks/samples/${recipientDecisionRound.id}`,
      ),
      "the repaired request notification must appear in the recipient inbox and link to the assigned request",
    );
    const ownerInternalWorkspace = await getStageSevenWorkspaceData(
      owner,
      ids.project,
      units[1].id,
      recipientDecisionRound.id,
    );
    const ownerInternalRound = ownerInternalWorkspace?.units
      .find((unit) => unit.id === units[1].id)
      ?.rounds.find((round) => round.id === recipientDecisionRound.id);
    check(
      ownerInternalRound?.canReview === false,
      "the project owner who created an internal sample request must receive a read-only review state",
    );
    await expectRejected(
      markPhysicalSampleRoundReceived(owner, {
        projectId: ids.project,
        productionUnitId: units[1].id,
        sampleRoundId: recipientDecisionRound.id,
      }),
      "the project owner who created an internal request must not mark its sample as received",
    );
    await expectRejected(
      decidePhysicalSampleRound(owner, {
        projectId: ids.project,
        productionUnitId: units[1].id,
        sampleRoundId: recipientDecisionRound.id,
        decision: PhysicalSampleDecision.REJECTED,
        decisionNote: "The sender must not review its own internal request.",
      }),
      "the project owner who created an internal request must not accept or reject it",
    );
    await expectRejected(
      markPhysicalSampleRoundReceived(superAdmin, {
        projectId: ids.project,
        productionUnitId: units[1].id,
        sampleRoundId: recipientDecisionRound.id,
      }),
      "global administration must not override an explicitly assigned internal reviewer",
    );
    const recipientDecisionWorkspace = await getStageSevenWorkspaceData(executor, ids.project, units[1].id, recipientDecisionRound.id);
    check(recipientDecisionWorkspace?.units[0].rounds[0].canReview === true, "the assigned internal recipient workspace must enable review for its own request");
    await expectRejected(markPhysicalSampleRoundReceived(collaborator, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: recipientDecisionRound.id }), "an unassigned collaborator must not mark another recipient's sample as received");
    await expectRejected(decidePhysicalSampleRound(collaborator, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: recipientDecisionRound.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "Unauthorized review." }), "an unassigned collaborator must not decide another recipient's sample request");
    await expectRejected(decidePhysicalSampleRound(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: recipientDecisionRound.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "The physical sample needs correction." }), "the assigned internal recipient must not decide before marking the sample as received");
    const recipientReceipt = await markPhysicalSampleRoundReceived(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: recipientDecisionRound.id });
    check(!recipientReceipt.duplicate, "the assigned internal recipient must be able to mark its sample as received");
    const recipientRejection = await decidePhysicalSampleRound(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: recipientDecisionRound.id, decision: PhysicalSampleDecision.REJECTED, decisionNote: "The physical sample needs correction." });
    check(!recipientRejection.duplicate, "the assigned internal recipient must be able to reject its received sample request");
    const recipientRejectedRow = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: recipientDecisionRound.id } });
    check(
      recipientRejectedRow.decision === PhysicalSampleDecision.REJECTED &&
        recipientRejectedRow.decidedById === ids.executor &&
        recipientRejectedRow.status === ProductionSampleRoundStatus.COMPLETED &&
        Boolean(recipientRejectedRow.deliveredAt),
      "the internal recipient's rejection must preserve receipt and persist the decision audit",
    );
    await expectRejected(retryProductionSampleRequestEmail(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: recipientDecisionRound.id }, { sendEmail: sendSuccess }), "review authority must not grant the internal recipient resend management access");

    const overdueRound = await createProductionSampleRound(superAdmin, {
      projectId: ids.project,
      productionUnitId: units[1].id,
      clientRequestId: `overdue-${runId}`,
      name: "Master case physical proof",
      type: ProductionSampleRoundType.PRE_PRODUCTION_SAMPLE,
      deadline: deadlineDate(-1),
      recipientRoute: ProductionHandoverRoute.PURCHASE_DEPARTMENT,
      recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
      recipientUserId: ids.executor,
      requestNote: "Courier the physical shipping case proof.",
    }, { sendEmail: sendSuccess });
    const internalRound = await prisma.productionSampleRound.findUniqueOrThrow({ where: { id: overdueRound.id } });
    check(internalRound.recipientRoute === ProductionHandoverRoute.PURCHASE_DEPARTMENT && internalRound.recipientType === ProductionApprovalRecipientType.EXISTING_COLLABORATOR && internalRound.recipientUserId === ids.executor, "internal sample requests must persist the selected project participant");
    const requestNotifications = await prisma.notification.findMany({
      where: {
        type: "PRODUCTION_SAMPLE_REQUESTED",
        entityId: overdueRound.id,
      },
    });
    check(
      requestNotifications.length === 1 &&
        requestNotifications[0].userId === ids.executor &&
        requestNotifications[0].entityType === "SAMPLE_ROUND" &&
        requestNotifications[0].url === `/tasks/samples/${overdueRound.id}`,
      "the selected internal recipient must receive one notification linked to the assigned request",
    );
    const sampleTask = await getAssignedPhysicalSampleTask(executor, overdueRound.id);
    check(sampleTask?.unit.rounds.length === 1 && sampleTask.unit.rounds[0].id === overdueRound.id, "Tasker must expose only the assigned sample request");
    check(await getAssignedPhysicalSampleTask(collaborator, overdueRound.id) === null, "unassigned users must not open a sample task");
    const recipientWorkspace = await getStageSevenWorkspaceData(
      executor,
      ids.project,
      units[1].id,
      overdueRound.id,
    );
    check(
      recipientWorkspace?.canManage === false &&
        recipientWorkspace.participants.length === 0 &&
        recipientWorkspace.units.length === 1 &&
        recipientWorkspace.units[0].rounds.length === 2 &&
        recipientWorkspace.units[0].rounds.some(
          (round) => round.id === overdueRound.id && round.canReview,
        ),
      "the internal recipient must receive a review-enabled workspace containing only assigned sample requests",
    );
    check(
      (await getStageSevenWorkspaceData(collaborator, ids.project, units[1].id, overdueRound.id)) === null,
      "an unassigned project participant must not gain Stage 7 request access",
    );
    await expectRejected(closeStageSevenProject(owner, { projectId: ids.project }), "project completion must remain blocked while any unit is not accepted");
    const overdueFirst = await processStageSevenOverdueDeadlines(new Date());
    check(overdueFirst.attemptedNotifications >= 2, "a pending past-deadline request must be processed as overdue");
    await processStageSevenOverdueDeadlines(new Date());
    const overdueNotifications = await prisma.notification.findMany({ where: { type: "STAGE_SEVEN_OVERDUE", entityId: overdueRound.id } });
    check(overdueNotifications.length === 2, "owner and co-owner must each receive one deduplicated overdue notification");
    check(overdueNotifications.every((item) => item.userId === ids.owner || item.userId === ids.coOwner), "supplier, executor, collaborators, and SUPER_ADMIN must not receive the automatic overdue alert");
    const overdueWorkspace = await getStageSevenWorkspaceData(owner, ids.project, units[1].id, overdueRound.id);
    check(overdueWorkspace?.summary.totalUnits === 2 && overdueWorkspace.summary.waitingUnits === 1 && overdueWorkspace.summary.overdueRounds === 1 && overdueWorkspace.summary.acceptedUnits === 1, "summary must report Production Units, Waiting, Overdue, and Accepted from persisted physical-sample state");

    await expectRejected(decidePhysicalSampleRound(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: overdueRound.id, decision: PhysicalSampleDecision.ACCEPTED }), "the assigned internal recipient must not accept an overdue sample before recording receipt");
    await markPhysicalSampleRoundReceived(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: overdueRound.id });
    await decidePhysicalSampleRound(executor, { projectId: ids.project, productionUnitId: units[1].id, sampleRoundId: overdueRound.id, decision: PhysicalSampleDecision.ACCEPTED });
    const directlyAcceptedInternalRound =
      await prisma.productionSampleRound.findUniqueOrThrow({
        where: { id: overdueRound.id },
      });
    check(
      directlyAcceptedInternalRound.decision === PhysicalSampleDecision.ACCEPTED &&
        directlyAcceptedInternalRound.status === ProductionSampleRoundStatus.COMPLETED &&
        Boolean(directlyAcceptedInternalRound.deliveredAt),
      "the assigned internal recipient's acceptance must preserve receipt and persist final acceptance",
    );
    await processStageSevenOverdueDeadlines(new Date());
    check(
      (await prisma.productionSampleRound.count({
        where: {
          id: overdueRound.id,
          decision: null,
          deadline: { lt: new Date() },
        },
      })) === 0,
      "a decided past-deadline request must no longer be overdue",
    );
    const archiveCount = await prisma.projectArchive.count({ where: { projectId: ids.project } });
    const closure = await closeStageSevenProject(owner, { projectId: ids.project });
    check(!closure.duplicate, "all accepted units must permit manual project completion");
    check((await closeStageSevenProject(owner, { projectId: ids.project })).duplicate, "manual project completion must be idempotent");
    const closedProject = await prisma.project.findUniqueOrThrow({ where: { id: ids.project }, include: { closure: true, workflowStages: true } });
    check(Boolean(closedProject.closure && closedProject.completedAt), "completion audit and project completion time must persist");
    check(closedProject.archivedAt === null && (await prisma.projectArchive.count({ where: { projectId: ids.project } })) === archiveCount, "closing Stage 7 must not archive the project");
    check(closedProject.workflowStages.find((stage) => stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION)?.status === ProjectWorkflowStageStatus.COMPLETED, "Stage 7 must become COMPLETED only after manual closure");

    console.log("Stage 7 physical-sample request, scoped email/retry, permissions, decisions, overdue, and manual project completion integration checks passed.");
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.deleteMany({
      where: {
        id: { in: userIds },
        projectInquiryPartySelections: { none: {} },
      },
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

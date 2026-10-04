import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  PhysicalSampleDecision,
  ProductionApprovalRecipientType,
  ProductionHandoverRoute,
  ProductionSampleRoundType,
  ProjectFileChecklistField,
  ProjectFileChecklistRequestChannel,
  ProjectProductionUnitStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import type { SendEmailInput } from "../src/lib/email/resend";
import { prisma } from "../src/lib/prisma";
import {
  processDueRequestReminders,
} from "../src/lib/request-reminders";
import {
  acceptStageFiveChecklistRequest,
  configureStageFiveChecklistRequestReminder,
  requestStageFiveChecklistInformation,
  submitStageFiveChecklistResponse,
} from "../src/lib/stage-five";
import {
  configureStageSevenSampleRequestReminder,
  createProductionSampleRound,
  decidePhysicalSampleRound,
  markPhysicalSampleRoundReceived,
} from "../src/lib/stage-seven";

process.env.AWS_REGION ||= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ||= "request-reminder-integration";
process.env.AWS_SECRET_ACCESS_KEY ||= "request-reminder-integration";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Request reminder integration check failed: ${message}`);
}

function isError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

async function expectRejected(task: Promise<unknown>, message: string) {
  try {
    await task;
  } catch {
    return;
  }
  throw new Error(`Request reminder integration check failed: ${message}`);
}

function deadlineDate(offsetDays = 2) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

async function main() {
  const runId = randomUUID();
  const ids = {
    owner: `reminder-owner-${runId}`,
    recipient: `reminder-recipient-${runId}`,
    outsider: `reminder-outsider-${runId}`,
    project: `reminder-project-${runId}`,
    stage: `reminder-stage-${runId}`,
    sourceA: `reminder-source-a-${runId}`,
    sourceB: `reminder-source-b-${runId}`,
    handoffA: `reminder-handoff-a-${runId}`,
    handoffB: `reminder-handoff-b-${runId}`,
    checklistA: `reminder-checklist-a-${runId}`,
    checklistB: `reminder-checklist-b-${runId}`,
    unitA: `reminder-unit-a-${runId}`,
    unitB: `reminder-unit-b-${runId}`,
  };
  const userIds = [ids.owner, ids.recipient, ids.outsider];
  try {
    await prisma.user.createMany({
      data: [
        {
          id: ids.owner,
          email: `reminder-owner-${runId}@example.test`,
          name: "Reminder Owner",
          passwordHash: "integration-only",
          role: UserRole.ADMIN,
        },
        {
          id: ids.recipient,
          email: `reminder-recipient-${runId}@example.test`,
          name: "Reminder Recipient",
          passwordHash: "integration-only",
          role: UserRole.USER,
        },
        {
          id: ids.outsider,
          email: `reminder-outsider-${runId}@example.test`,
          name: "Reminder Outsider",
          passwordHash: "integration-only",
          role: UserRole.USER,
        },
      ],
    });
    await prisma.project.create({
      data: {
        id: ids.project,
        name: "Reminder Integration Project",
        ownerId: ids.owner,
        createdById: ids.owner,
        collaborators: {
          create: [
            { userId: ids.recipient, addedById: ids.owner, canInteract: true },
            { userId: ids.outsider, addedById: ids.owner, canInteract: true },
          ],
        },
        workflowStages: {
          create: [
            {
              stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
              status: ProjectWorkflowStageStatus.AVAILABLE,
              unlockedAt: new Date(),
            },
            {
              stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
              status: ProjectWorkflowStageStatus.AVAILABLE,
              unlockedAt: new Date(),
            },
          ],
        },
        stages: {
          create: {
            id: ids.stage,
            name: "Reminder source stage",
            order: 1,
            status: StageStatus.ONGOING,
          },
        },
      },
    });
    await prisma.projectAttachment.createMany({
      data: [ids.sourceA, ids.sourceB].map((id, index) => ({
        id,
        projectId: ids.project,
        stageId: ids.stage,
        uploadedById: ids.owner,
        fileName: `source-${index + 1}.ai`,
        originalFileName: `Source ${index + 1}.ai`,
        mimeType: "application/postscript",
        fileSize: 4_096,
        bucket: "request-reminder-integration",
        storageKey: `request-reminder-integration/${runId}/${index + 1}`,
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
        status: AttachmentStatus.READY,
      })),
    });
    await prisma.projectStageFileHandoff.createMany({
      data: [
        { id: ids.handoffA, sourceAttachmentId: ids.sourceA },
        { id: ids.handoffB, sourceAttachmentId: ids.sourceB },
      ].map((item) => ({
        ...item,
        projectId: ids.project,
        sourceWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        targetWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
        handedOffById: ids.owner,
      })),
    });
    await prisma.projectFileChecklist.createMany({
      data: [
        {
          id: ids.checklistA,
          handoffId: ids.handoffA,
          sourceAttachmentId: ids.sourceA,
        },
        {
          id: ids.checklistB,
          handoffId: ids.handoffB,
          sourceAttachmentId: ids.sourceB,
        },
      ].map((item) => ({ ...item, projectId: ids.project })),
    });
    await prisma.projectProductionUnit.createMany({
      data: [
        {
          id: ids.unitA,
          sourceHandoffId: ids.handoffA,
          sourceChecklistId: ids.checklistA,
          sourceAttachmentId: ids.sourceA,
        },
        {
          id: ids.unitB,
          sourceHandoffId: ids.handoffB,
          sourceChecklistId: ids.checklistB,
          sourceAttachmentId: ids.sourceB,
        },
      ].map((item) => ({
        ...item,
        projectId: ids.project,
        status: ProjectProductionUnitStatus.HANDOVER_READY,
        approvedAt: new Date(),
        createdById: ids.owner,
      })),
    });
    await prisma.projectProductionSupervision.createMany({
      data: [ids.unitA, ids.unitB].map((productionUnitId) => ({
        projectId: ids.project,
        productionUnitId,
      })),
    });

    const owner = { id: ids.owner, role: UserRole.ADMIN };
    const recipient = { id: ids.recipient, role: UserRole.USER };
    const outsider = { id: ids.outsider, role: UserRole.USER };
    const initialEmails: SendEmailInput[] = [];
    const sendInitial = async (email: SendEmailInput) => {
      initialEmails.push(email);
      return { ok: true as const, id: `initial-${initialEmails.length}` };
    };

    const stageFiveInternal = await requestStageFiveChecklistInformation(owner, {
      clientRequestId: `s5-internal-${runId}`,
      projectId: ids.project,
      handoffId: ids.handoffA,
      fieldKey: ProjectFileChecklistField.MARKETING_COPY,
      channel: ProjectFileChecklistRequestChannel.IN_APP,
      recipientUserId: ids.recipient,
      reminderIntervalHours: 24,
    });
    check(!isError(stageFiveInternal), "Stage 5 internal reminder request must be created");
    const stageFiveExternal = await requestStageFiveChecklistInformation(
      owner,
      {
        clientRequestId: `s5-external-${runId}`,
        projectId: ids.project,
        handoffId: ids.handoffA,
        fieldKey: ProjectFileChecklistField.QR_CODE,
        channel: ProjectFileChecklistRequestChannel.EMAIL,
        recipientName: "External Checklist Recipient",
        recipientEmail: `checklist-${runId}@example.test`,
        reminderIntervalHours: 48,
      },
      { sendEmail: sendInitial },
    );
    check(!isError(stageFiveExternal), "Stage 5 external reminder request must be created");
    const historical = await requestStageFiveChecklistInformation(owner, {
      clientRequestId: `s5-no-reminder-${runId}`,
      projectId: ids.project,
      handoffId: ids.handoffA,
      fieldKey: ProjectFileChecklistField.BARCODE,
      channel: ProjectFileChecklistRequestChannel.IN_APP,
      recipientUserId: ids.recipient,
    });
    check(!isError(historical), "a request without reminders must still be created");
    check(
      (await prisma.requestReminder.count({
        where: { stageFiveRequestId: historical.request.id },
      })) === 0,
      "requests without an explicit opt-in must remain reminder-off",
    );

    const stageSevenExternal = await createProductionSampleRound(
      owner,
      {
        projectId: ids.project,
        productionUnitId: ids.unitA,
        clientRequestId: `s7-external-${runId}`,
        name: "External physical sample",
        type: ProductionSampleRoundType.PRODUCTION_SAMPLE,
        deadline: deadlineDate(),
        recipientRoute: ProductionHandoverRoute.DIRECT_VENDOR,
        recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
        recipientName: "External Sample Recipient",
        recipientEmail: `sample-${runId}@example.test`,
        recipientCompany: "Sample Supplier",
        recipientPhone: "+971501234567",
        reminderIntervalHours: 72,
      },
      { sendEmail: sendInitial },
    );
    const stageSevenInternal = await createProductionSampleRound(
      owner,
      {
        projectId: ids.project,
        productionUnitId: ids.unitB,
        clientRequestId: `s7-internal-${runId}`,
        name: "Internal physical sample",
        type: ProductionSampleRoundType.PRE_PRODUCTION_SAMPLE,
        deadline: deadlineDate(),
        recipientRoute: ProductionHandoverRoute.PURCHASE_DEPARTMENT,
        recipientType: ProductionApprovalRecipientType.EXISTING_COLLABORATOR,
        recipientUserId: ids.recipient,
        reminderIntervalHours: 24,
      },
      { sendEmail: sendInitial },
    );

    const reminderRows = await prisma.requestReminder.findMany({
      where: { projectId: ids.project },
    });
    check(reminderRows.length === 4, "all four opted-in Stage 5/7 paths must persist reminders");
    check(
      reminderRows.every(
        (row) => row.nextReminderAt && row.nextReminderAt > row.createdAt,
      ),
      "no original request may schedule an immediate additional reminder",
    );
    const noImmediate = await processDueRequestReminders(new Date(), {
      sendEmail: async () => {
        throw new Error("a future reminder must not send");
      },
    });
    check(noImmediate.claimed === 0, "future reminders must be ignored");

    const unauthorizedStageFive = await configureStageFiveChecklistRequestReminder(
      outsider,
      {
        projectId: ids.project,
        requestId: stageFiveInternal.request.id,
        intervalHours: 48,
      },
    );
    check(isError(unauthorizedStageFive), "a project USER must not manage Stage 5 reminders");
    await expectRejected(
      configureStageSevenSampleRequestReminder(outsider, {
        projectId: ids.project,
        productionUnitId: ids.unitA,
        sampleRoundId: stageSevenExternal.id,
        intervalHours: 48,
      }),
      "a project USER must not manage Stage 7 reminders",
    );
    const changedAt = new Date();
    const changed = await configureStageFiveChecklistRequestReminder(owner, {
      projectId: ids.project,
      requestId: stageFiveExternal.request.id,
      intervalHours: 72,
    });
    check(!isError(changed), "an authorized Stage 5 manager must change reminder intervals");
    const changedRow = await prisma.requestReminder.findUniqueOrThrow({
      where: { stageFiveRequestId: stageFiveExternal.request.id },
    });
    check(
      changedRow.nextReminderAt!.getTime() >= changedAt.getTime() + 72 * 60 * 60 * 1_000,
      "an interval change must recalculate from the change time without sending",
    );

    const dueAt = new Date();
    await prisma.requestReminder.updateMany({
      where: { projectId: ids.project, enabled: true },
      data: { nextReminderAt: new Date(dueAt.getTime() - 60_000) },
    });
    const reminderEmails: SendEmailInput[] = [];
    const sendReminder = async (email: SendEmailInput) => {
      reminderEmails.push(email);
      return { ok: true as const, id: `reminder-${reminderEmails.length}` };
    };
    await Promise.all([
      processDueRequestReminders(dueAt, { sendEmail: sendReminder }),
      processDueRequestReminders(dueAt, { sendEmail: sendReminder }),
    ]);
    check(
      reminderEmails.length === 3,
      "concurrent scheduler runs must send one email for each email-capable request, without duplicates",
    );
    check(
      new Set(reminderEmails.map((email) => email.to)).size === 3 &&
        reminderEmails.some((email) => email.to === `checklist-${runId}@example.test`) &&
        reminderEmails.some((email) => email.to === `sample-${runId}@example.test`) &&
        reminderEmails.some(
          (email) => email.to === `reminder-recipient-${runId}@example.test`,
        ),
      "reminders must use each request's exact persisted recipient",
    );
    check(
      reminderEmails.every(
        (email) => email.subject.includes("Reminder:") && email.idempotencyKey,
      ),
      "email reminders must be explicit and carry a provider idempotency key",
    );
    check(
      (await prisma.requestReminderDeliveryAttempt.count({
        where: { reminder: { projectId: ids.project } },
      })) === 4,
      "one immutable delivery attempt must own each due reminder window",
    );
    check(
      (await prisma.notification.count({
        where: {
          projectId: ids.project,
          title: { startsWith: "Reminder:" },
        },
      })) === 2,
      "internal Stage 5 and Stage 7 recipients must each receive an in-app reminder",
    );

    const floodReminder = await prisma.requestReminder.findUniqueOrThrow({
      where: { stageFiveRequestId: stageFiveExternal.request.id },
    });
    await prisma.requestReminder.update({
      where: { id: floodReminder.id },
      data: { nextReminderAt: new Date(dueAt.getTime() - 5 * 24 * 60 * 60 * 1_000) },
    });
    reminderEmails.length = 0;
    const catchUpAt = new Date(dueAt.getTime() + 1_000);
    await processDueRequestReminders(catchUpAt, { sendEmail: sendReminder });
    check(reminderEmails.length === 1, "an overdue reminder must not emit catch-up spam");
    const afterCatchUp = await prisma.requestReminder.findUniqueOrThrow({
      where: { id: floodReminder.id },
    });
    check(
      afterCatchUp.nextReminderAt!.getTime() ===
        catchUpAt.getTime() + afterCatchUp.intervalHours * 60 * 60 * 1_000,
      "an overdue reminder must schedule one future interval from processing time",
    );

    await prisma.requestReminder.update({
      where: { id: floodReminder.id },
      data: { nextReminderAt: new Date(catchUpAt.getTime() - 1) },
    });
    const failureAt = new Date(catchUpAt.getTime() + 2_000);
    const failed = await processDueRequestReminders(failureAt, {
      sendEmail: async () => ({ ok: false as const, error: "Mock reminder failure" }),
    });
    check(failed.failed === 1, "delivery failure must be audited without resolving the request");
    const afterFailure = await prisma.requestReminder.findUniqueOrThrow({
      where: { id: floodReminder.id },
    });
    check(
      afterFailure.enabled &&
        afterFailure.lastError === "Mock reminder failure" &&
        afterFailure.nextReminderAt! > failureAt,
      "failed reminders must avoid a rapid retry loop and preserve the pending request",
    );

    const stopped = await configureStageFiveChecklistRequestReminder(owner, {
      projectId: ids.project,
      requestId: stageFiveExternal.request.id,
      intervalHours: null,
    });
    check(!isError(stopped), "an authorized manager must stop a reminder");
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { id: floodReminder.id },
      })).enabled,
      "manual stop must disable only future reminders",
    );

    await acceptStageFiveChecklistRequest(recipient, stageFiveInternal.request.id);
    const response = await submitStageFiveChecklistResponse(recipient, {
      requestId: stageFiveInternal.request.id,
      value: { values: ["Approved reminder integration copy"] },
      attachmentIds: [],
    });
    check(!isError(response), "the Stage 5 request must still complete normally");
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { stageFiveRequestId: stageFiveInternal.request.id },
      })).enabled,
      "a resolved Stage 5 checklist item must stop its reminders",
    );

    await markPhysicalSampleRoundReceived(recipient, {
      projectId: ids.project,
      productionUnitId: ids.unitB,
      sampleRoundId: stageSevenInternal.id,
    });
    await decidePhysicalSampleRound(recipient, {
      projectId: ids.project,
      productionUnitId: ids.unitB,
      sampleRoundId: stageSevenInternal.id,
      decision: PhysicalSampleDecision.REJECTED,
      decisionNote: "Integration rejection",
    });
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { stageSevenSampleRoundId: stageSevenInternal.id },
      })).enabled,
      "a terminal Stage 7 internal round must stop its reminder",
    );
    await markPhysicalSampleRoundReceived(owner, {
      projectId: ids.project,
      productionUnitId: ids.unitA,
      sampleRoundId: stageSevenExternal.id,
    });
    await decidePhysicalSampleRound(owner, {
      projectId: ids.project,
      productionUnitId: ids.unitA,
      sampleRoundId: stageSevenExternal.id,
      decision: PhysicalSampleDecision.REJECTED,
      decisionNote: "Integration rejection",
    });
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { stageSevenSampleRoundId: stageSevenExternal.id },
      })).enabled,
      "a terminal Stage 7 external round must stop its reminder",
    );

    const oldRound = await createProductionSampleRound(
      owner,
      {
        projectId: ids.project,
        productionUnitId: ids.unitA,
        clientRequestId: `s7-old-${runId}`,
        name: "Older unresolved round",
        type: ProductionSampleRoundType.PRODUCTION_SAMPLE,
        deadline: deadlineDate(),
        recipientRoute: ProductionHandoverRoute.DIRECT_VENDOR,
        recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
        recipientName: "Old Supplier",
        recipientEmail: `old-${runId}@example.test`,
        recipientCompany: "Old Supplier",
        recipientPhone: "+971501234568",
        reminderIntervalHours: 24,
      },
      { sendEmail: sendInitial },
    );
    await createProductionSampleRound(
      owner,
      {
        projectId: ids.project,
        productionUnitId: ids.unitA,
        clientRequestId: `s7-new-${runId}`,
        name: "Newest active round",
        type: ProductionSampleRoundType.PRODUCTION_SAMPLE,
        deadline: deadlineDate(),
        recipientRoute: ProductionHandoverRoute.DIRECT_VENDOR,
        recipientType: ProductionApprovalRecipientType.EXTERNAL_EMAIL,
        recipientName: "New Supplier",
        recipientEmail: `new-${runId}@example.test`,
        recipientCompany: "New Supplier",
        recipientPhone: "+971501234569",
        reminderIntervalHours: 48,
      },
      { sendEmail: sendInitial },
    );
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { stageSevenSampleRoundId: oldRound.id },
      })).enabled,
      "creating a newer Stage 7 round must disable an unresolved older round reminder",
    );
    await expectRejected(
      configureStageSevenSampleRequestReminder(owner, {
        projectId: ids.project,
        productionUnitId: ids.unitA,
        sampleRoundId: oldRound.id,
        intervalHours: 24,
      }),
      "a superseded Stage 7 round must not be re-enabled",
    );

    const newestReminder = await prisma.requestReminder.findFirstOrThrow({
      where: {
        projectId: ids.project,
        enabled: true,
        stageSevenSampleRoundId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    await prisma.$transaction([
      prisma.projectWorkflowStage.updateMany({
        where: {
          projectId: ids.project,
          stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
        },
        data: { status: ProjectWorkflowStageStatus.COMPLETED, completedAt: new Date() },
      }),
      prisma.requestReminder.update({
        where: { id: newestReminder.id },
        data: { nextReminderAt: new Date(Date.now() - 1_000) },
      }),
    ]);
    await processDueRequestReminders(new Date(), {
      sendEmail: async () => {
        throw new Error("a completed stage must not send reminders");
      },
    });
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { id: newestReminder.id },
      })).enabled,
      "completed workflow stages must be defensively removed from reminder scheduling",
    );
    await prisma.$transaction([
      prisma.projectWorkflowStage.updateMany({
        where: {
          projectId: ids.project,
          stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
        },
        data: { status: ProjectWorkflowStageStatus.AVAILABLE, completedAt: null },
      }),
      prisma.project.update({
        where: { id: ids.project },
        data: { completedAt: new Date() },
      }),
      prisma.requestReminder.update({
        where: { id: newestReminder.id },
        data: {
          enabled: true,
          stoppedAt: null,
          nextReminderAt: new Date(Date.now() - 1_000),
        },
      }),
    ]);
    await processDueRequestReminders(new Date(), {
      sendEmail: async () => {
        throw new Error("a completed project must not send reminders");
      },
    });
    check(
      !(await prisma.requestReminder.findUniqueOrThrow({
        where: { id: newestReminder.id },
      })).enabled,
      "completed projects must be defensively removed from reminder scheduling",
    );

    console.log(
      "Request reminder Stage 5/7 recipients, authorization, concurrency, lifecycle, failure, no-catch-up, and superseded-round checks passed.",
    );
  } finally {
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import { richTextToPlainText } from "../src/lib/rich-text";
import type { SendEmailInput } from "../src/lib/email/resend";
import {
  configureMarketingDirector, sendProductionApprovalRequest, resendRejectedProductionApproval,
  decideProductionApproval, retryProductionApprovalDispatch, getExternalProductionApprovalData,
  getAuthenticatedProductionApprovalData, getProductionApprovalFileUrl, addProductionApprover,
  getStageSixWorkspaceData, addProductionUnitFile, completeStageSix,
  type ResendProductionApprovalInput,
} from "../src/lib/stage-six";

const prefix = `resend-${randomUUID()}`;
const actor = (name: string, role: UserRole) => ({ id: `${prefix}-${name}`, name, role, email: `${prefix}-${name}@example.test` });
const owner = actor("Owner", UserRole.ADMIN), approver = actor("Approver", UserRole.USER), outsider = actor("Outsider", UserRole.USER);
const users = [owner, approver, outsider];
const projectId = `${prefix}-project`;
const originalEmail = process.env.SLAVOMIR_APPROVAL_EMAIL;
const emails: SendEmailInput[] = [];
const sendEmail = async (email: SendEmailInput) => { emails.push(email); return { ok: true as const, id: randomUUID() }; };
const token = (email = emails.at(-1)!) => {
  const value = email.text.match(/\/external\/production-approval\/([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(value); return value;
};

async function file(name: string) {
  return prisma.projectAttachment.create({ data: {
    projectId, uploadedById: owner.id, fileName: name, originalFileName: name, mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${prefix}/${name}`, assetType: "GENERAL_PROJECT_ASSET", status: "READY",
  } });
}

async function main() {
  process.env.SLAVOMIR_APPROVAL_EMAIL = "initial@example.test";
  await prisma.user.createMany({ data: users.map((user) => ({ ...user, passwordHash: "test" })) });
  await prisma.project.create({ data: {
    id: projectId, name: "Resend approval checks", ownerId: owner.id, createdById: owner.id,
    collaborators: { create: { userId: approver.id, canInteract: true } },
    workflowStages: { create: getInitialProjectWorkflowStageData().map((stage, index) => ({
      ...stage, status: index < 5 ? "COMPLETED" as const : index === 5 ? "AVAILABLE" as const : "LOCKED" as const,
      unlockedAt: index <= 5 ? new Date() : null, completedAt: index < 5 ? new Date() : null,
    })) },
  } });
  const source = await file("source.pdf");
  const handoff = await prisma.projectStageFileHandoff.create({ data: {
    projectId, sourceAttachmentId: source.id, sourceWorkflowStageKey: "PROJECT_DEVELOPMENT", targetWorkflowStageKey: "FINAL_LAYOUT", handedOffById: owner.id,
  } });
  const checklist = await prisma.projectFileChecklist.create({ data: { projectId, handoffId: handoff.id, sourceAttachmentId: source.id } });
  const unit = await prisma.projectProductionUnit.create({ data: {
    projectId, createdById: owner.id, sourceHandoffId: handoff.id, sourceChecklistId: checklist.id, sourceAttachmentId: source.id,
    approvalSteps: { create: { sequence: 1, isMarketingDirectorRequired: true } },
  } });
  const configured = await configureMarketingDirector(owner, {
    clientRequestId: randomUUID(), projectId, productionUnitId: unit.id, recipientType: "EXTERNAL_EMAIL",
    sharedFieldKeys: [], selectedFileIds: [source.id], message: "Original package",
  }, { sendEmail });
  assert.ok(!("error" in configured) && "step" in configured);
  const stepId = configured.step.id;
  const next = await addProductionApprover(owner, {
    clientRequestId: randomUUID(), projectId, productionUnitId: unit.id, recipientType: "EXISTING_COLLABORATOR",
    recipientUserId: approver.id, sharedFieldKeys: [], selectedFileIds: [source.id],
  });
  assert.ok(!("error" in next));
  const last = await addProductionApprover(owner, {
    clientRequestId: randomUUID(), projectId, productionUnitId: unit.id, recipientType: "EXTERNAL_EMAIL",
    recipientName: "Final Reviewer", recipientEmail: "final@example.test", sharedFieldKeys: [], selectedFileIds: [source.id],
  });
  assert.ok(!("error" in last));
  const sendInput = { projectId, productionUnitId: unit.id, stepId };
  assert.ok(!("error" in await sendProductionApprovalRequest(owner, sendInput, { sendEmail })));
  const originalToken = token();
  assert.ok(!("error" in await decideProductionApproval({ kind: "external", token: originalToken }, { decision: "REJECT", confirmed: true, comment: "Please correct the layout." })));
  const originalStep = await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } });
  const revised = await file("revised.pdf");
  assert.ok(!("error" in await addProductionUnitFile(owner, { projectId, productionUnitId: unit.id, attachmentId: revised.id })));
  const input: ResendProductionApprovalInput = {
    ...sendInput, expectedDecidedAt: originalStep.decidedAt!.toISOString(), sharedFieldKeys: [], selectedFileIds: [revised.id], message: "Corrected layout",
  };
  for (const user of [approver, outsider]) assert.ok("error" in await resendRejectedProductionApproval(user, input, { sendEmail }));
  for (const change of [{ projectId: "wrong-project" }, { productionUnitId: "wrong-unit" }, { stepId: next.step.id },
    { expectedDecidedAt: "" }, { selectedFileIds: [] }, { selectedFileIds: ["foreign-file"] }]) {
    assert.ok("error" in await resendRejectedProductionApproval(owner, { ...input, ...change }, { sendEmail }));
  }
  for (const value of [undefined, "invalid-email"]) {
    if (value === undefined) delete process.env.SLAVOMIR_APPROVAL_EMAIL;
    else process.env.SLAVOMIR_APPROVAL_EMAIL = value;
    assert.ok("error" in await resendRejectedProductionApproval(owner, input, { sendEmail }));
  }
  process.env.SLAVOMIR_APPROVAL_EMAIL = "dev-test@example.test";
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: projectId }, data: { [field]: new Date() } });
    assert.ok("error" in await resendRejectedProductionApproval(owner, input, { sendEmail }));
    await prisma.project.update({ where: { id: projectId }, data: { [field]: null } });
  }
  for (const status of ["LOCKED", "COMPLETED"] as const) {
    await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey: "PRODUCTION_AND_HANDOVER" }, data: { status } });
    assert.ok("error" in await resendRejectedProductionApproval(owner, input, { sendEmail }));
  }
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey: "PRODUCTION_AND_HANDOVER" }, data: { status: "AVAILABLE" } });
  await prisma.projectProductionUnit.update({ where: { id: unit.id }, data: { handedOverAt: new Date() } });
  assert.ok("error" in await resendRejectedProductionApproval(owner, input, { sendEmail }));
  await prisma.projectProductionUnit.update({ where: { id: unit.id }, data: { handedOverAt: null } });
  assert.deepEqual(await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } }), originalStep, "Blocked attempts must preserve the rejection");
  assert.equal(emails.length, 1);

  const concurrent = await Promise.all([resendRejectedProductionApproval(owner, input, { sendEmail }), resendRejectedProductionApproval(owner, input, { sendEmail })]);
  assert.ok(concurrent.every((result) => !("error" in result)), JSON.stringify(concurrent));
  assert.equal(concurrent.filter((result) => "sent" in result && result.sent).length, 1);
  assert.equal(emails.length, 2, "Simultaneous resend clicks dispatch once");
  assert.equal(emails.at(-1)!.to, "dev-test@example.test");
  const newToken = token();
  assert.notEqual(newToken, originalToken);
  assert.equal((await getExternalProductionApprovalData(originalToken)).state, "invalid");
  assert.ok("error" in await decideProductionApproval({ kind: "external", token: originalToken }, { decision: "APPROVE", confirmed: true }));
  await assert.rejects(() => getProductionApprovalFileUrl({ kind: "external", token: originalToken }, source.id, "download"));
  const active = await getExternalProductionApprovalData(newToken);
  assert.ok(active.state === "active");
  assert.deepEqual(active.snapshot.files.map((entry) => entry.id), [revised.id]);
  assert.equal(richTextToPlainText(active.message), "Corrected layout");
  const resent = await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } });
  assert.equal(resent.decidedAt, null); assert.equal(resent.decisionComment, null);
  assert.ok(Array.isArray(resent.rejectionHistory) && resent.rejectionHistory.length === 1);
  const savedRejection = resent.rejectionHistory[0] as Record<string, unknown>;
  assert.equal(savedRejection.decisionComment, originalStep.decisionComment);
  assert.deepEqual(savedRejection.sharedSnapshot, originalStep.sharedSnapshot);
  assert.equal((await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: next.step.id } })).status, "WAITING");
  assert.equal(await prisma.notification.count({ where: { entityId: next.step.id, type: "PRODUCTION_APPROVAL_REQUESTED" } }), 0);
  assert.ok("error" in await completeStageSix(owner, { projectId }));
  const workspace = await getStageSixWorkspaceData(owner, projectId);
  assert.equal(workspace?.units[0].approvalSteps[0].rejectionHistory[0].decisionComment, "Please correct the layout.");

  // Another rejection keeps both decisions and supports email delivery failure recovery.
  assert.ok(!("error" in await decideProductionApproval({ kind: "external", token: newToken }, { decision: "REJECT", confirmed: true, comment: "One more correction" })));
  const secondRejection = await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } });
  const countBeforeStale = emails.length;
  const stale = await resendRejectedProductionApproval(owner, input, { sendEmail });
  assert.ok(!("error" in stale) && !stale.sent);
  assert.equal(emails.length, countBeforeStale, "A stale form cannot resend a later rejection");
  const secondInput = { ...input, expectedDecidedAt: secondRejection.decidedAt!.toISOString() };
  const failedEmails: SendEmailInput[] = [];
  assert.ok("error" in await resendRejectedProductionApproval(owner, secondInput, { sendEmail: async (email) => {
    failedEmails.push(email); return { ok: false, error: "Mock delivery failure" };
  } }));
  const failed = await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } });
  assert.equal(failed.status, "ACTIVE"); assert.equal(failed.dispatchStatus, "FAILED");
  assert.ok(Array.isArray(failed.rejectionHistory) && failed.rejectionHistory.length === 2);
  assert.ok("error" in await resendRejectedProductionApproval(owner, secondInput, { sendEmail }));
  process.env.SLAVOMIR_APPROVAL_EMAIL = "retry-test@example.test";
  assert.ok(!("error" in await retryProductionApprovalDispatch(owner, { projectId, stepId }, { sendEmail })));
  assert.equal(emails.at(-1)!.to, "retry-test@example.test");
  assert.notEqual((await getExternalProductionApprovalData(token(failedEmails[0]))).state, "active");
  assert.ok(!("error" in await decideProductionApproval({ kind: "external", token: token() }, { decision: "APPROVE", confirmed: true })));
  const approvedDirector = await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } });

  // Internal approvers receive a new notification and must review the current attempt.
  assert.equal((await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: next.step.id } })).status, "WAITING");
  assert.ok(!("error" in await sendProductionApprovalRequest(owner, { ...sendInput, stepId: next.step.id }, { sendEmail })));
  const oldInternal = await getAuthenticatedProductionApprovalData(approver, next.step.id);
  assert.ok(oldInternal.state === "active");
  assert.ok(!("error" in await decideProductionApproval({ kind: "authenticated", user: approver, stepId: next.step.id }, { decision: "REJECT", confirmed: true })));
  const internalRejected = await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: next.step.id } });
  const beforeInternalResend = emails.length;
  assert.ok(!("error" in await resendRejectedProductionApproval(owner, { ...input, stepId: next.step.id, expectedDecidedAt: internalRejected.decidedAt!.toISOString() }, { sendEmail })));
  assert.equal(emails.length, beforeInternalResend, "Internal requests use in-app notifications");
  assert.equal(await prisma.notification.count({ where: { entityId: next.step.id, type: "PRODUCTION_APPROVAL_REQUESTED" } }), 2);
  assert.deepEqual(await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: stepId } }), approvedDirector, "Earlier approvals and their snapshots stay intact");
  for (const requestVersion of [undefined, oldInternal.requestVersion ?? undefined]) {
    assert.ok("error" in await decideProductionApproval({ kind: "authenticated", user: approver, stepId: next.step.id }, { decision: "APPROVE", confirmed: true, requestVersion }));
  }
  const currentInternal = await getAuthenticatedProductionApprovalData(approver, next.step.id);
  assert.ok(currentInternal.state === "active");
  assert.ok(!("error" in await decideProductionApproval({ kind: "authenticated", user: approver, stepId: next.step.id }, { decision: "APPROVE", confirmed: true, requestVersion: currentInternal.requestVersion! })));
  assert.equal((await prisma.productionApprovalStep.findUniqueOrThrow({ where: { id: last.step.id } })).status, "WAITING");
  assert.equal(emails.length, beforeInternalResend, "Later approvers still require a separate send click");
  console.log("Stage 6 rejected approval resend passed: manual dispatch, current environment email, revised files, audit history, stale links/forms, permissions, workflow locks, delivery failures and concurrent clicks.");
}

main().finally(async () => {
  if (originalEmail === undefined) delete process.env.SLAVOMIR_APPROVAL_EMAIL;
  else process.env.SLAVOMIR_APPROVAL_EMAIL = originalEmail;
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

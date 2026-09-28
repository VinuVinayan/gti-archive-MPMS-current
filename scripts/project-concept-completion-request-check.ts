import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import {
  completeProjectConceptTaskWithoutFile, completeStageThreeConcepts, completeStageFourConcepts, createProjectConceptFolder,
  getProjectConceptFolders, getProjectConceptChatContext, requestProjectConceptTaskCompletion, requestStageThreeTaskCompletion,
  markProjectConceptApprovedAttachment, markStageFourFinalApprovedAttachment, type ConceptWorkflowStageKey,
} from "../src/lib/project-concepts";
import { createStageRevision, startProjectStageWork } from "../src/lib/project-history";
import { getUserProjectWorkspace } from "../src/lib/user-project-workspace";
import { getUserTasksPageData } from "../src/lib/user-tasks";
import { getUserProjectsList } from "../src/lib/user-projects";
import { notifyConceptTaskCompletion } from "../src/lib/notification-center/triggers";

const prefix = `completion-request-${randomUUID()}`;
const user = (name: string, role: UserRole = UserRole.USER) => ({ id: `${prefix}-${name}`, email: `${prefix}-${name}@example.test`, name, role });
const owner = user("Project Owner"), executor = user("Task Executor"), coOwner = user("Co Owner"), otherExecutor = user("Other Executor"), outsider = user("Outsider"), admin = user("Administrator", UserRole.ADMIN);
const users = [owner, executor, coOwner, otherExecutor, outsider, admin];
const projectIds = [`${prefix}-3`, `${prefix}-4`, `${prefix}-fileless`];

async function task(name: string, projectId: string, stageKey: ConceptWorkflowStageKey) {
  const result = await createProjectConceptFolder(owner, {
    projectId, stageKey, name, assignedExecutorId: executor.id,
    deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>Research and save the materials in Tech.</p>",
  });
  assert.ok("folder" in result && result.folder, JSON.stringify(result));
  return result.folder;
}

async function runStage(stageKey: ConceptWorkflowStageKey) {
  const stageNumber = stageKey === "CONCEPT_CREATION" ? 3 : 4;
  const projectId = `${prefix}-${stageNumber}`;
  const completeStage = stageNumber === 3 ? completeStageThreeConcepts : completeStageFourConcepts;
  const approveFile = stageNumber === 3 ? markProjectConceptApprovedAttachment : markStageFourFinalApprovedAttachment;
  await prisma.project.create({ data: {
    id: projectId, name: "Research requests", ownerId: owner.id, createdById: owner.id,
    executors: { create: [executor, otherExecutor].map((record) => ({ userId: record.id })) },
    coOwners: { create: { userId: coOwner.id } },
    workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage, index) => ({
      ...stage, status: index < stageNumber - 1 ? "COMPLETED" as const : index === stageNumber - 1 ? "AVAILABLE" as const : "LOCKED" as const,
      unlockedAt: index <= stageNumber - 1 ? new Date() : null, completedAt: index < stageNumber - 1 ? new Date() : null,
    })) } },
  } });
  const research = await task("Conduct research", projectId, stageKey), input = { projectId, folderId: research.id, stageKey };
  assert.equal((await getProjectConceptChatContext(executor, { ...input, stageKey }))?.chatMode.canRequestCompletion, false);
  assert.ok("error" in await requestProjectConceptTaskCompletion(executor, input), "Accepting the brief is still required");
  await startProjectStageWork(executor, { projectId, stageId: research.taskerStageId });
  assert.equal((await getProjectConceptChatContext(executor, { ...input, stageKey }))?.chatMode.canRequestCompletion, true);
  for (const actor of [owner, coOwner, otherExecutor, outsider, admin]) {
    assert.ok("error" in await requestProjectConceptTaskCompletion(actor, input), "Only the assigned executor can request completion");
    assert.notEqual((await getProjectConceptChatContext(actor, { ...input, stageKey }))?.chatMode.canRequestCompletion, true);
  }
  assert.ok("error" in await requestProjectConceptTaskCompletion(executor, { ...input, projectId: "wrong-project" }));
  assert.ok("error" in await requestProjectConceptTaskCompletion(executor, { ...input, note: "x".repeat(2001) }));
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: projectId }, data: { [field]: new Date() } });
    assert.ok("error" in await requestProjectConceptTaskCompletion(executor, input));
    await prisma.project.update({ where: { id: projectId }, data: { [field]: null } });
  }
  for (const status of ["LOCKED", "COMPLETED"] as const) {
    await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status } });
    assert.ok("error" in await requestProjectConceptTaskCompletion(executor, input));
  }
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status: "AVAILABLE" } });

  const note = "Research is complete. Materials are in Tech → Research.\nCompare A < B & C.";
  const results = await Promise.all([requestProjectConceptTaskCompletion(executor, { ...input, note }), requestProjectConceptTaskCompletion(executor, { ...input, note })]);
  assert.ok(results.every((result) => !("error" in result)), JSON.stringify(results));
  assert.equal(results.filter((result) => "changed" in result && result.changed).length, 1);
  const pending = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: research.id }, include: { taskerStage: true } });
  assert.ok(pending.completionRequestedAt);
  assert.equal(pending.completionRequestNote, note);
  assert.equal(pending.taskerStage.status, "ONGOING");
  assert.equal(pending.taskerStage.completedAt, null);
  assert.equal(await prisma.projectAttachment.count({ where: { stageId: research.taskerStageId } }), 0);
  assert.equal(await prisma.projectRevision.count({ where: { stageId: research.taskerStageId } }), 0);
  assert.equal(await prisma.projectComment.count({ where: { stageId: research.taskerStageId, body: { contains: "Task completion requested" } } }), 1);
  const requestComment = await prisma.projectComment.findFirstOrThrow({ where: { stageId: research.taskerStageId, body: { contains: "Task completion requested" } } });
  assert.ok(requestComment.body.includes("A &lt; B &amp; C."));
  const ownerView = await getProjectConceptChatContext(owner, { ...input, stageKey });
  assert.equal(ownerView?.chatMode.completionRequest?.note, note);
  assert.equal(ownerView?.chatMode.canCompleteWithoutFile, true);
  assert.equal((await getProjectConceptChatContext(executor, { ...input, stageKey }))?.chatMode.canRequestCompletion, false);
  assert.equal((await getProjectConceptFolders(owner, projectId, stageKey))?.folders[0].completionRequest?.note, note);
  assert.equal((await getUserProjectWorkspace(projectId, executor))?.assignedConcepts[0].display.status, "WAITING_FOR_REVIEW");
  assert.equal((await getUserTasksPageData(executor)).projects.find((project) => project.id === projectId)?.tasks[0].display.status, "WAITING_FOR_REVIEW");
  assert.equal((await getUserProjectsList({ filter: "ALL", query: "", sort: "updated", page: 1 }, executor)).projects.find((project) => project.id === projectId)?.tasks[0].display.status, "WAITING_FOR_REVIEW");
  assert.ok("error" in await completeStage(owner, { projectId }), "A request alone must not allow stage completion");
  await notifyConceptTaskCompletion({ ...input, actorId: executor.id, event: "requested" });
  const notification = await prisma.notification.findFirstOrThrow({ where: { projectId, title: "Task completion requested" } });
  assert.equal(notification.userId, owner.id);
  assert.ok(notification.message.includes(executor.name));
  assert.equal(notification.url, `/projects/${projectId}/stages/${stageNumber}/concepts/${research.id}`);
  assert.equal(await prisma.notification.count({ where: { projectId, userId: coOwner.id } }), 0);
  assert.ok("error" in await completeProjectConceptTaskWithoutFile(executor, input));
  assert.ok("error" in await completeProjectConceptTaskWithoutFile(coOwner, input));
  assert.ok(!("error" in await completeProjectConceptTaskWithoutFile(owner, input)));
  const completed = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: research.id }, include: { taskerStage: true } });
  assert.equal(completed.completionRequestedAt, null);
  assert.equal(completed.completionRequestNote, null);
  assert.equal(completed.taskerStage.status, "COMPLETED");
  assert.ok(completed.completedWithoutFileAt);
  assert.equal((await getUserProjectWorkspace(projectId, executor))?.assignedConcepts[0].display.status, "COMPLETED");
  assert.equal((await getProjectConceptChatContext(owner, { ...input, stageKey }))?.chatMode.completionRequest, null);
  assert.ok("error" in await requestProjectConceptTaskCompletion(executor, input));
  await notifyConceptTaskCompletion({ ...input, actorId: owner.id, event: "completed" });
  assert.equal((await prisma.notification.findFirstOrThrow({ where: { projectId, title: "Task completed" } })).userId, executor.id);

  // A later file submission replaces the earlier request to complete without a file.
  const drawing = await task("Supplemental drawing", projectId, stageKey), drawingInput = { projectId, folderId: drawing.id, stageKey };
  await startProjectStageWork(executor, { projectId, stageId: drawing.taskerStageId });
  assert.ok(!("error" in await requestProjectConceptTaskCompletion(executor, drawingInput)), "The note is optional");
  const attachment = await prisma.projectAttachment.create({ data: {
    projectId, stageId: drawing.taskerStageId, uploadedById: executor.id,
    fileName: "drawing.pdf", originalFileName: "drawing.pdf", mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${projectId}/drawing.pdf`, assetType: "REVISION_ORIGINAL", status: "UPLOADING",
  } });
  assert.ok("error" in await requestProjectConceptTaskCompletion(executor, drawingInput));
  assert.ok("error" in await completeProjectConceptTaskWithoutFile(owner, drawingInput));
  await prisma.projectAttachment.update({ where: { id: attachment.id }, data: { status: "READY" } });
  await createStageRevision(executor, { projectId, stageId: drawing.taskerStageId, attachmentIds: [attachment.id] });
  assert.equal((await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: drawing.id } })).completionRequestedAt, null);
  assert.equal((await getProjectConceptChatContext(owner, { ...drawingInput, stageKey }))?.chatMode.completionRequest, null);
  const approval = await approveFile(owner, { ...drawingInput, attachmentId: attachment.id });
  assert.ok(!("error" in approval), JSON.stringify(approval));
  assert.equal(approval.allConceptsApproved, true, "File approval includes tasks already completed without a file");
  assert.equal((await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: drawing.id } })).completionRequestedAt, null);
  const folders = await getProjectConceptFolders(owner, projectId, stageKey);
  assert.ok(folders?.completionConcepts.every((folder) => folder.isApproved || folder.completedWithoutFile));
  const finish = await completeStage(owner, { projectId });
  assert.ok(!("error" in finish), JSON.stringify(finish));
  if (stageNumber === 3) {
    const stageFour = await task("Stage 4", projectId, "PROJECT_DEVELOPMENT");
    assert.ok("error" in await requestStageThreeTaskCompletion(executor, { projectId, folderId: stageFour.id }));
  } else {
    const handoffs = await prisma.projectStageFileHandoff.findMany({ where: { projectId } });
    assert.equal(handoffs.length, 1, "Only the submitted and approved file is handed to Stage 5");
    assert.equal(handoffs[0].sourceAttachmentId, attachment.id);
    assert.equal((await prisma.projectWorkflowStage.findUniqueOrThrow({ where: { projectId_stageKey: { projectId, stageKey: "FINAL_LAYOUT" } } })).status, "AVAILABLE");
  }
  console.log(`Stage ${stageNumber} completion requests passed: assignment, acceptance, locks, concurrency, notes, review states, notifications and mixed file/no-file completion.`);
}

async function runStageFourWithoutFiles() {
  const projectId = `${prefix}-fileless`, stageKey = "PROJECT_DEVELOPMENT" as const;
  await prisma.project.create({ data: {
    id: projectId, name: "Stage 4 without task submissions", ownerId: owner.id, createdById: owner.id,
    executors: { create: { userId: executor.id } }, coOwners: { create: { userId: coOwner.id } },
    workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage, index) => ({
      ...stage, status: index < 3 ? "COMPLETED" as const : index === 3 ? "AVAILABLE" as const : "LOCKED" as const,
      unlockedAt: index <= 3 ? new Date() : null, completedAt: index < 3 ? new Date() : null,
    })) } },
  } });
  const research = await task("Research in project Files", projectId, stageKey);
  const input = { projectId, folderId: research.id, stageKey };
  const supportingFile = await prisma.projectAttachment.create({ data: {
    projectId, uploadedById: executor.id, fileName: "research.pdf", originalFileName: "research.pdf",
    mimeType: "application/pdf", fileSize: 128, bucket: "test", storageKey: `${projectId}/research.pdf`,
    assetType: "GENERAL_PROJECT_ASSET", status: "READY",
  } });
  for (const actor of [executor, coOwner, outsider]) {
    assert.ok("error" in await completeProjectConceptTaskWithoutFile(actor, input));
    assert.notEqual((await getProjectConceptChatContext(actor, input))?.chatMode.canCompleteWithoutFile, true);
    assert.ok("error" in await completeStageFourConcepts(actor, { projectId }));
  }
  assert.ok("error" in await completeProjectConceptTaskWithoutFile(owner, { ...input, stageKey: "CONCEPT_CREATION" }));
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: projectId }, data: { [field]: new Date() } });
    assert.ok("error" in await completeProjectConceptTaskWithoutFile(owner, input));
    assert.ok("error" in await completeStageFourConcepts(owner, { projectId }));
    await prisma.project.update({ where: { id: projectId }, data: { [field]: null } });
  }
  for (const status of ["LOCKED", "COMPLETED"] as const) {
    await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status } });
    assert.ok("error" in await completeProjectConceptTaskWithoutFile(owner, input));
  }
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status: "AVAILABLE" } });
  assert.equal((await getProjectConceptChatContext(owner, input))?.chatMode.canCompleteWithoutFile, true);
  const results = await Promise.all([completeProjectConceptTaskWithoutFile(owner, input), completeProjectConceptTaskWithoutFile(owner, input)]);
  assert.ok(results.every((result) => !("error" in result)), JSON.stringify(results));
  assert.equal(results.filter((result) => "changed" in result && result.changed).length, 1);
  const stored = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: research.id }, include: { taskerStage: true } });
  assert.equal(stored.taskerStage.actualStartedAt, null, "The owner can directly complete a task without executor acceptance");
  assert.equal(stored.taskerStage.status, "COMPLETED");
  assert.ok(stored.completedWithoutFileAt);
  assert.equal(await prisma.projectComment.count({ where: { stageId: research.taskerStageId, body: "Task completed without a file submission." } }), 1);
  assert.equal(await prisma.projectAttachment.count({ where: { projectId } }), 1);
  assert.equal((await prisma.projectAttachment.findUniqueOrThrow({ where: { id: supportingFile.id } })).stageId, null, "Supporting files remain in Files");
  assert.equal(await prisma.projectRevision.count({ where: { projectId } }), 0);
  assert.equal((await getProjectConceptChatContext(executor, input))?.chatMode.completedWithoutFile, true);
  const finish = await completeStageFourConcepts(owner, { projectId });
  assert.ok(!("error" in finish), JSON.stringify(finish));
  assert.equal(finish.skipped, false, "Completing fileless work is different from skipping an empty stage");
  assert.equal(finish.finalApprovedCount, 0);
  assert.equal(finish.handoffs.length, 0);
  assert.equal(await prisma.projectFileChecklist.count({ where: { projectId } }), 0);
  assert.equal((await prisma.projectWorkflowStage.findUniqueOrThrow({ where: { projectId_stageKey: { projectId, stageKey } } })).status, "COMPLETED");
  assert.equal((await prisma.projectWorkflowStage.findUniqueOrThrow({ where: { projectId_stageKey: { projectId, stageKey: "FINAL_LAYOUT" } } })).status, "AVAILABLE");
  console.log("Stage 4 manual completion passed: authority, locks, concurrent completion, supporting files and progression with no task submissions.");
}

async function main() {
  await prisma.user.createMany({ data: users.map((record) => ({ ...record, passwordHash: "test" })) });
  await runStage("CONCEPT_CREATION");
  await runStage("PROJECT_DEVELOPMENT");
  await runStageFourWithoutFiles();
}

main().finally(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((record) => record.id) } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

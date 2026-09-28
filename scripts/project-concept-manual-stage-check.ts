import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import {
  completeStageThreeConcepts, completeStageFourConcepts, completeStageThreeTaskWithoutFile,
  createProjectConceptFolder, getProjectConceptFolders, getProjectConceptChatContext,
  markProjectConceptApprovedAttachment, requestStageThreeTaskCompletion,
} from "../src/lib/project-concepts";
import { startProjectStageWork } from "../src/lib/project-history";
import { getUserProjectWorkspace } from "../src/lib/user-project-workspace";

const prefix = `manual-stage-${randomUUID()}`;
const makeUser = (name: string, role: UserRole = UserRole.USER) => ({ id: `${prefix}-${name}`, name, email: `${prefix}-${name}@example.test`, role });
const owner = makeUser("Owner"), executor = makeUser("Executor"), executorTwo = makeUser("ExecutorTwo"), coOwner = makeUser("CoOwner"), outsider = makeUser("Outsider"), admin = makeUser("Admin", UserRole.ADMIN);
const users = [owner, executor, executorTwo, coOwner, outsider, admin];
const projectId = `${prefix}-mixed`, filelessId = `${prefix}-fileless`, emptyId = `${prefix}-empty`;
const projectIds = [projectId, filelessId, emptyId];
const stageKey = "CONCEPT_CREATION" as const;

async function task(name: string, id = projectId, assignedExecutorId = executor.id) {
  const result = await createProjectConceptFolder(owner, {
    projectId: id, stageKey, name, assignedExecutorId,
    deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>Confirm the research findings.</p>",
  });
  assert.ok("folder" in result && result.folder, JSON.stringify(result));
  return result.folder;
}

async function main() {
  await prisma.user.createMany({ data: users.map((user) => ({ ...user, passwordHash: "test" })) });
  for (const id of projectIds) await prisma.project.create({ data: {
    id, name: "Manual Stage 3 completion", ownerId: owner.id, createdById: owner.id,
    executors: { create: [executor, executorTwo].map((user) => ({ userId: user.id })) },
    coOwners: { create: { userId: coOwner.id } },
    workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage, index) => ({
      ...stage, status: index < 2 ? "COMPLETED" as const : index === 2 ? "AVAILABLE" as const : "LOCKED" as const,
      unlockedAt: index <= 2 ? new Date() : null, completedAt: index < 2 ? new Date() : null,
    })) } },
  } });
  const unstarted = await task("Confirm findings"), requested = await task("Research review", projectId, executorTwo.id);
  const originalUnstarted = await prisma.projectStage.findUniqueOrThrow({ where: { id: unstarted.taskerStageId } });
  const done = await task("Already done"), design = await task("Design drawing");
  await completeStageThreeTaskWithoutFile(owner, { projectId, folderId: done.id });
  const originalDone = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: done.id } });
  await startProjectStageWork(executorTwo, { projectId, stageId: requested.taskerStageId });
  await requestStageThreeTaskCompletion(executorTwo, { projectId, folderId: requested.id, note: "See Tech for the research." });
  const manual = { projectId, completeOpenTasks: true };
  for (const actor of [executor, executorTwo, coOwner, outsider]) {
    assert.ok("error" in await completeStageThreeConcepts(actor, manual));
    assert.notEqual((await getProjectConceptFolders(actor, projectId, stageKey))?.canCompleteStage, true);
  }
  assert.ok("error" in await completeStageThreeConcepts(owner, { projectId }), "Normal completion still requires finished tasks");
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: projectId }, data: { [field]: new Date() } });
    assert.ok("error" in await completeStageThreeConcepts(owner, manual));
    assert.equal((await getProjectConceptFolders(owner, projectId, stageKey))?.canCompleteStage, false);
    await prisma.project.update({ where: { id: projectId }, data: { [field]: null } });
  }
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status: "LOCKED" } });
  assert.ok("error" in await completeStageThreeConcepts(owner, manual));
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status: "AVAILABLE" } });

  // Reference attachments are allowed; pending formal submissions still need review.
  await prisma.projectAttachment.create({ data: {
    projectId, stageId: unstarted.taskerStageId, uploadedById: owner.id,
    fileName: "brief.pdf", originalFileName: "brief.pdf", mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${prefix}/brief.pdf`, assetType: "GENERAL_PROJECT_ASSET", status: "READY",
  } });
  const revision = await prisma.projectRevision.create({ data: {
    projectId, stageId: design.taskerStageId, createdById: executor.id, revisionNumber: 1, title: "Drawing", status: "PENDING_REVIEW",
  } });
  const attachment = await prisma.projectAttachment.create({ data: {
    projectId, stageId: design.taskerStageId, revisionId: revision.id, uploadedById: executor.id,
    fileName: "design.pdf", originalFileName: "design.pdf", mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${prefix}/design.pdf`, assetType: "REVISION_ORIGINAL", status: "UPLOADING",
  } });
  for (const status of ["UPLOADING", "READY"] as const) {
    await prisma.projectAttachment.update({ where: { id: attachment.id }, data: { status } });
    assert.ok("error" in await completeStageThreeConcepts(owner, manual));
    assert.equal((await prisma.projectStage.findUniqueOrThrow({ where: { id: unstarted.taskerStageId } })).status, originalUnstarted.status, "Validation failures must not partially complete tasks");
  }
  assert.ok(!("error" in await markProjectConceptApprovedAttachment(owner, { projectId, folderId: design.id, attachmentId: attachment.id })));
  await prisma.projectAttachment.update({ where: { id: attachment.id }, data: { status: "DELETED" } });
  assert.ok("error" in await completeStageThreeConcepts(owner, manual), "Invalid approved files must not be carried forward");
  assert.equal((await prisma.projectStage.findUniqueOrThrow({ where: { id: unstarted.taskerStageId } })).status, originalUnstarted.status);
  await prisma.projectAttachment.update({ where: { id: attachment.id }, data: { status: "READY" } });

  const filtered = await getProjectConceptFolders(owner, projectId, stageKey, { executorId: executor.id });
  assert.equal(filtered?.folders.some((folder) => folder.id === requested.id), false);
  assert.equal(filtered?.completionConcepts.some((folder) => folder.id === requested.id && folder.canCompleteWithoutFile), true, "Stage completion covers tasks outside the current executor filter");
  const results = await Promise.all([completeStageThreeConcepts(owner, manual), completeStageThreeConcepts(owner, manual)]);
  assert.ok(results.every((result) => !("error" in result)), JSON.stringify(results));
  const changed = results.filter((result) => "transitioned" in result && result.transitioned);
  assert.equal(changed.length, 1);
  assert.ok("completedTaskIds" in changed[0]);
  assert.deepEqual([...changed[0].completedTaskIds].sort(), [unstarted.id, requested.id].sort());
  const stored = await prisma.projectConceptFolder.findMany({ where: { projectId }, include: { taskerStage: true } });
  assert.ok(stored.every((folder) => folder.taskerStage.status === "COMPLETED"));
  for (const id of [unstarted.id, requested.id]) {
    const folder = stored.find((folder) => folder.id === id)!;
    assert.ok(folder.completedWithoutFileAt);
    assert.equal(folder.completionRequestedAt, null);
    assert.equal(folder.completionRequestNote, null);
    assert.equal(folder.taskerStage.completedAt?.toISOString(), folder.completedWithoutFileAt.toISOString());
    assert.equal(await prisma.projectComment.count({ where: { stageId: folder.taskerStageId, authorId: owner.id, body: { contains: "manual Stage 3 completion" } } }), 1);
  }
  assert.equal(stored.find((folder) => folder.id === unstarted.id)?.taskerStage.actualStartedAt, null);
  assert.equal(stored.find((folder) => folder.id === done.id)?.completedWithoutFileAt?.toISOString(), originalDone.completedWithoutFileAt?.toISOString());
  assert.equal(stored.find((folder) => folder.id === design.id)?.approvedAttachmentId, attachment.id);
  assert.equal(await prisma.projectAttachment.count({ where: { projectId } }), 2);
  assert.equal(await prisma.projectRevision.count({ where: { projectId } }), 1);
  const stages = await prisma.projectWorkflowStage.findMany({ where: { projectId } });
  assert.equal(stages.find((stage) => stage.stageKey === stageKey)?.status, "COMPLETED");
  assert.equal(stages.find((stage) => stage.stageKey === "PROJECT_DEVELOPMENT")?.status, "AVAILABLE");
  assert.ok((await getUserProjectWorkspace(projectId, executor))?.assignedConcepts.every((task) => task.display.status === "COMPLETED"));
  assert.equal((await getProjectConceptChatContext(owner, { projectId, folderId: requested.id, stageKey }))?.chatMode.completedWithoutFile, true);
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId })));
  assert.equal(await prisma.projectStageFileHandoff.count({ where: { projectId } }), 1, "Only the real approved drawing is handed off");

  await task("Meeting", filelessId);
  await task("Research", filelessId);
  assert.ok(!("error" in await completeStageThreeConcepts(admin, { projectId: filelessId, completeOpenTasks: true })));
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId: filelessId })));
  assert.equal(await prisma.projectAttachment.count({ where: { projectId: filelessId } }), 0);
  assert.equal(await prisma.projectStageFileHandoff.count({ where: { projectId: filelessId } }), 0);
  assert.ok(!("error" in await completeStageThreeConcepts(owner, { projectId: emptyId, completeOpenTasks: true })));
  console.log("Manual Stage 3 completion passed: owner access, closed-project and stage locks, all-task scope, atomic validation, concurrency, history, requests, task states and Stage 4/5 progression.");
}

main().finally(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

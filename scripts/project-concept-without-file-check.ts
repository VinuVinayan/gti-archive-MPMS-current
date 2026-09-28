import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import {
  completeStageThreeTaskWithoutFile, completeStageThreeConcepts, completeStageFourConcepts,
  createProjectConceptFolder, getProjectConceptFolders, getProjectConceptChatContext,
  markProjectConceptApprovedAttachment,
} from "../src/lib/project-concepts";
import { completeAttachmentUpload, createStageRevision, requestAttachmentUpload } from "../src/lib/project-history";
import { getUserProjectWorkspace } from "../src/lib/user-project-workspace";

const prefix = `no-file-${randomUUID()}`;
const user = (name: string, role: UserRole = UserRole.USER) => ({ id: `${prefix}-${name}`, email: `${prefix}-${name}@example.test`, name, role });
const owner = user("Project Owner"), executor = user("Task Executor"), coOwner = user("Co Owner"), outsider = user("Outsider"), admin = user("Administrator", UserRole.ADMIN);
const projectId = `${prefix}-mixed`, filelessProjectId = `${prefix}-fileless`;
const stageKey = "CONCEPT_CREATION" as const;

async function task(name: string, id = projectId) {
  const result = await createProjectConceptFolder(owner, {
    projectId: id, stageKey, name, assignedExecutorId: executor.id,
    deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>Discuss and confirm requirements.</p>",
  });
  assert.ok("folder" in result && result.folder, JSON.stringify(result));
  return result.folder;
}

async function main() {
  await prisma.user.createMany({ data: [owner, executor, coOwner, outsider, admin].map((record) => ({ ...record, passwordHash: "test" })) });
  for (const id of [projectId, filelessProjectId]) await prisma.project.create({ data: {
    id, name: "Tasks without submissions", ownerId: owner.id, createdById: owner.id,
    executors: { create: { userId: executor.id } }, coOwners: { create: { userId: coOwner.id } },
    workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage, index) => ({
      ...stage, status: index < 2 ? "COMPLETED" as const : index === 2 ? "AVAILABLE" as const : "LOCKED" as const,
      unlockedAt: index <= 2 ? new Date() : null,
      completedAt: index < 2 ? new Date() : null,
    })) } },
  } });
  const discussion = await task("Review requirements");
  const design = await task("Create drawing");
  const input = { projectId, folderId: discussion.id };
  assert.equal((await getProjectConceptChatContext(owner, { ...input, stageKey }))?.chatMode.canCompleteWithoutFile, true);
  assert.equal((await getProjectConceptFolders(owner, projectId, stageKey))?.folders.find((folder) => folder.id === discussion.id)?.canCompleteWithoutFile, true);
  for (const actor of [executor, coOwner, outsider]) {
    assert.ok("error" in await completeStageThreeTaskWithoutFile(actor, input), "Only the project owner or a business administrator may close a task without a file");
  }
  assert.ok("error" in await completeStageThreeTaskWithoutFile(owner, { ...input, projectId: filelessProjectId }));

  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status: "LOCKED" } });
  assert.ok("error" in await completeStageThreeTaskWithoutFile(owner, input));
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey }, data: { status: "AVAILABLE" } });
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: projectId }, data: { [field]: new Date() } });
    assert.ok("error" in await completeStageThreeTaskWithoutFile(owner, input));
    await prisma.project.update({ where: { id: projectId }, data: { [field]: null } });
  }

  // Brief/reference attachments are allowed; they are not formal task submissions.
  await prisma.projectAttachment.create({ data: {
    projectId, stageId: discussion.taskerStageId, uploadedById: owner.id,
    fileName: "brief.pdf", originalFileName: "brief.pdf", mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${prefix}/brief.pdf`, assetType: "GENERAL_PROJECT_ASSET", status: "READY",
  } });
  const results = await Promise.all([completeStageThreeTaskWithoutFile(owner, input), completeStageThreeTaskWithoutFile(owner, input)]);
  assert.ok(results.every((result) => !("error" in result)), JSON.stringify(results));
  assert.equal(results.filter((result) => "changed" in result && result.changed).length, 1, "Concurrent requests complete once");
  const stored = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: discussion.id }, include: { taskerStage: true } });
  assert.ok(stored.completedWithoutFileAt);
  assert.equal(stored.taskerStage.status, "COMPLETED");
  assert.equal(stored.taskerStage.completedAt?.toISOString(), stored.completedWithoutFileAt.toISOString());
  assert.equal(stored.taskerStage.actualStartedAt, null, "Completion must not invent executor acceptance");
  assert.equal(stored.approvedAttachmentId, null);
  assert.equal(await prisma.projectRevision.count({ where: { stageId: discussion.taskerStageId } }), 0);
  assert.equal(await prisma.projectAttachment.count({ where: { stageId: discussion.taskerStageId } }), 1, "Completion does not create a placeholder file");
  assert.equal(await prisma.projectComment.count({ where: { stageId: discussion.taskerStageId, authorId: owner.id, body: "Task completed without a file submission." } }), 1);
  const context = await getProjectConceptChatContext(executor, { ...input, stageKey });
  assert.equal(context?.chatMode.completedWithoutFile, true);
  assert.equal(context?.chatMode.canCompleteWithoutFile, false);
  const workspace = await getUserProjectWorkspace(projectId, executor);
  assert.equal(workspace?.assignedConcepts.find((concept) => concept.id === discussion.id)?.display.status, "COMPLETED");
  const revisions = await requestAttachmentUpload(executor, {
    projectId, stageId: discussion.taskerStageId, originalFileName: "late.pdf", mimeType: "application/pdf", fileSize: 128, assetType: "REVISION_ORIGINAL",
  });
  assert.ok("error" in revisions, "Completed tasks cannot accept new submissions");
  await assert.rejects(() => createStageRevision(executor, { projectId, stageId: discussion.taskerStageId, summary: "Late revision", attachmentIds: [] }));
  assert.equal((await prisma.projectWorkflowStage.findUniqueOrThrow({ where: { projectId_stageKey: { projectId, stageKey } } })).status, "AVAILABLE", "Completing a task does not finish Stage 3 automatically");
  assert.ok("error" in await completeStageThreeConcepts(owner, { projectId }), "Other unfinished tasks still block Stage 3");

  const revision = await prisma.projectRevision.create({ data: {
    projectId, stageId: design.taskerStageId, createdById: executor.id, revisionNumber: 1, title: "Design", status: "PENDING_REVIEW",
  } });
  const attachment = await prisma.projectAttachment.create({ data: {
    projectId, stageId: design.taskerStageId, revisionId: revision.id, uploadedById: executor.id,
    fileName: "design.pdf", originalFileName: "design.pdf", mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${prefix}/design.pdf`, assetType: "REVISION_ORIGINAL", status: "UPLOADING",
  } });
  assert.ok("error" in await completeStageThreeTaskWithoutFile(owner, { projectId, folderId: design.id }), "Uploads in progress must finish or fail first");
  await prisma.projectAttachment.update({ where: { id: attachment.id }, data: { status: "READY" } });
  assert.ok("error" in await completeStageThreeTaskWithoutFile(owner, { projectId, folderId: design.id }), "Submitted files must use the review flow");
  assert.ok(!("error" in await markProjectConceptApprovedAttachment(owner, { projectId, folderId: design.id, attachmentId: attachment.id })));
  const mixed = await getProjectConceptFolders(owner, projectId, stageKey);
  assert.ok(mixed?.completionConcepts.every((concept) => concept.isApproved || concept.completedWithoutFile));
  const completion = await completeStageThreeConcepts(owner, { projectId });
  assert.ok(!("error" in completion), JSON.stringify(completion));
  assert.equal(completion.approvedCount, 1);
  const skip = await completeStageFourConcepts(owner, { projectId });
  assert.ok(!("error" in skip), JSON.stringify(skip));
  assert.equal(await prisma.projectStageFileHandoff.count({ where: { projectId } }), 1, "Only the actual approved file is handed to Stage 5");
  assert.deepEqual(await completeStageThreeTaskWithoutFile(owner, input), { changed: false, taskerStageId: discussion.taskerStageId });

  const meeting = await task("Confirm requirements", filelessProjectId);
  assert.ok(!("error" in await completeStageThreeTaskWithoutFile(admin, { projectId: filelessProjectId, folderId: meeting.id })), "Existing business-administrator authority is retained");
  assert.ok(!("error" in await completeStageThreeConcepts(owner, { projectId: filelessProjectId })));
  const stageFourTask = await createProjectConceptFolder(owner, { projectId: filelessProjectId, stageKey: "PROJECT_DEVELOPMENT", name: "Stage 4 task", assignedExecutorId: executor.id, deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>Final layout</p>" });
  assert.ok("folder" in stageFourTask && stageFourTask.folder);
  assert.ok("error" in await completeStageThreeTaskWithoutFile(owner, { projectId: filelessProjectId, folderId: stageFourTask.folder.id }), "This action applies only to Stage 3");
  await prisma.projectConceptFolder.delete({ where: { id: stageFourTask.folder.id } });
  await prisma.projectStage.delete({ where: { id: stageFourTask.folder.taskerStageId } });
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId: filelessProjectId })), "Projects with only fileless tasks can continue past an empty Stage 4");
  assert.equal(await prisma.projectStageFileHandoff.count({ where: { projectId: filelessProjectId } }), 0);

  // A late upload prepared before the completion must not become a submitted file afterwards.
  const late = await prisma.projectAttachment.create({ data: {
    projectId, stageId: discussion.taskerStageId, uploadedById: executor.id,
    fileName: "late.pdf", originalFileName: "late.pdf", mimeType: "application/pdf", fileSize: 128,
    bucket: "test", storageKey: `${prefix}/late.pdf`, assetType: "REVISION_ORIGINAL", status: "UPLOADING",
  } });
  await assert.rejects(() => completeAttachmentUpload(executor, late.id));
  console.log("Stage 3 completion without files passed: owner access, persistence, concurrency, task status, history, upload locks, mixed tasks and Stage 4/5 progression.");
}

main().finally(async () => {
  await prisma.project.deleteMany({ where: { id: { in: [projectId, filelessProjectId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, executor.id, coOwner.id, outsider.id, admin.id] } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

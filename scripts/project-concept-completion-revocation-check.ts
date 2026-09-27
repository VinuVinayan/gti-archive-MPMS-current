import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import {
  completeProjectConceptTaskWithoutFile, completeStageThreeConcepts, completeStageFourConcepts,
  createProjectConceptFolder, getProjectConceptChatContext, requestProjectConceptTaskCompletion,
  markStageFourFinalApprovedAttachment,
} from "../src/lib/project-concepts";
import { startProjectStageWork, createStageRevision } from "../src/lib/project-history";
import { getTaskCompletionRevocationEligibility, revokeConceptTaskCompletion } from "../src/lib/project-stage-skip-revocation";

const prefix = `revoke-completion-${randomUUID()}`;
const user = (name: string, role: UserRole = UserRole.USER) => ({ id: `${prefix}-${name}`, name, email: `${prefix}-${name}@example.test`, role });
const owner = user("Owner"), executor = user("Executor"), coOwner = user("CoOwner"), outsider = user("Outsider"), admin = user("Admin", UserRole.ADMIN);
const users = [owner, executor, coOwner, outsider, admin];
const projects: string[] = [];
type StageKey = "CONCEPT_CREATION" | "PROJECT_DEVELOPMENT";
type Input = { projectId: string; folderId: string; stageKey: StageKey };

async function task(projectId: string, stageKey: StageKey, name = "Research") {
  const result = await createProjectConceptFolder(owner, {
    projectId, stageKey, name, assignedExecutorId: executor.id,
    deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>Review the supporting materials in Tech.</p>",
  });
  assert.ok("folder" in result && result.folder, JSON.stringify(result));
  return result.folder;
}

async function fixture(stageKey: StageKey = "PROJECT_DEVELOPMENT", accepted = false) {
  const projectId = `${prefix}-${projects.length}`;
  projects.push(projectId);
  const index = stageKey === "CONCEPT_CREATION" ? 2 : 3;
  await prisma.project.create({ data: {
    id: projectId, name: "Revoke completion checks", ownerId: owner.id, createdById: owner.id,
    executors: { create: { userId: executor.id } }, coOwners: { create: { userId: coOwner.id } },
    workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage, i) => ({
      ...stage, status: i < index ? "COMPLETED" as const : i === index ? "AVAILABLE" as const : "LOCKED" as const,
      completedAt: i < index ? new Date() : null, unlockedAt: i <= index ? new Date() : null,
    })) } },
  } });
  const folder = await task(projectId, stageKey);
  const input = { projectId, folderId: folder.id, stageKey };
  if (accepted) {
    await startProjectStageWork(executor, { projectId, stageId: folder.taskerStageId });
    assert.ok(!("error" in await requestProjectConceptTaskCompletion(executor, { ...input, note: "Supporting files are in Tech." })));
  }
  assert.ok(!("error" in await completeProjectConceptTaskWithoutFile(owner, input)));
  return { input, folder };
}

async function states(projectId: string) {
  return prisma.projectWorkflowStage.findMany({ where: { projectId }, orderBy: { stageKey: "asc" } });
}

async function blocked(input: Input, pattern?: RegExp) {
  const before = await states(input.projectId);
  const folderBefore = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: input.folderId }, include: { taskerStage: true } });
  const eligibility = await getTaskCompletionRevocationEligibility(owner, input);
  assert.equal(eligibility.visible, true);
  assert.equal(eligibility.canRevoke, false);
  if (pattern) assert.match(eligibility.reason ?? "", pattern);
  assert.ok("error" in await revokeConceptTaskCompletion(owner, input));
  assert.deepEqual(await states(input.projectId), before);
  assert.deepEqual(await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: input.folderId }, include: { taskerStage: true } }), folderBefore);
}

async function attachment(projectId: string, stageId: string | null, assetType: "GENERAL_PROJECT_ASSET" | "REVISION_ORIGINAL" = "GENERAL_PROJECT_ASSET") {
  return prisma.projectAttachment.create({ data: {
    projectId, stageId, uploadedById: executor.id, fileName: "research.pdf", originalFileName: "research.pdf",
    mimeType: "application/pdf", fileSize: 100, bucket: "test", storageKey: `${prefix}/${randomUUID()}`,
    assetType, status: "READY",
  } });
}

async function main() {
  await prisma.user.createMany({ data: users.map((record) => ({ ...record, passwordHash: "test" })) });
  for (const stageKey of ["CONCEPT_CREATION", "PROJECT_DEVELOPMENT"] as const) {
    const { input, folder } = await fixture(stageKey);
    const view = await getProjectConceptChatContext(owner, input);
    assert.equal(view?.chatMode.completedWithoutFile, true);
    assert.equal(view?.chatMode.approvalRevocationEligibility.canRevoke, false, "No file approval is needed for Revoke Completion");
    assert.equal(view?.chatMode.completionRevocationEligibility?.canRevoke, true);
    assert.equal(view?.chatMode.completionRevocationEligibility?.reopensStage, false);
    assert.equal((await getTaskCompletionRevocationEligibility(admin, input)).canRevoke, true);
    for (const actor of [executor, coOwner, outsider]) {
      assert.equal((await getTaskCompletionRevocationEligibility(actor, input)).visible, false);
      assert.ok("error" in await revokeConceptTaskCompletion(actor, input));
    }
    assert.ok("error" in await revokeConceptTaskCompletion(owner, { ...input, folderId: "" }));
    assert.ok("error" in await revokeConceptTaskCompletion(owner, { ...input, projectId: "another-project" }));
    assert.ok("error" in await revokeConceptTaskCompletion(owner, { ...input, stageKey: stageKey === "CONCEPT_CREATION" ? "PROJECT_DEVELOPMENT" : "CONCEPT_CREATION" }));
    assert.ok("error" in await revokeConceptTaskCompletion(owner, { ...input, executorId: outsider.id }), "Existing assignment cannot be replaced through this action");
    const workflowBefore = await states(input.projectId);
    const together = await Promise.all([revokeConceptTaskCompletion(owner, input), revokeConceptTaskCompletion(owner, input)]);
    assert.equal(together.filter((result) => "changed" in result).length, 1);
    assert.deepEqual(await states(input.projectId), workflowBefore, "Task-only reopening leaves the workflow unchanged");
    const reopened = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: folder.id }, include: { taskerStage: true } });
    assert.equal(reopened.completedWithoutFileAt, null);
    assert.equal(reopened.taskerStage.completedAt, null);
    assert.equal(reopened.taskerStage.status, "ONGOING");
    assert.equal(reopened.taskerStage.actualStartedAt, null, "An unaccepted task stays unaccepted");
    assert.equal(await prisma.projectComment.count({ where: { stageId: folder.taskerStageId, body: { startsWith: "Task completion revoked." } } }), 1);
    assert.equal(await prisma.projectComment.count({ where: { stageId: folder.taskerStageId, body: "Task completed without a file submission." } }), 1, "Completion history remains visible");
    assert.equal((await getProjectConceptChatContext(owner, input))?.chatMode.completionRevocationEligibility, null);
    await startProjectStageWork(executor, { projectId: input.projectId, stageId: folder.taskerStageId });
    const file = await attachment(input.projectId, folder.taskerStageId, "REVISION_ORIGINAL");
    await createStageRevision(executor, { projectId: input.projectId, stageId: folder.taskerStageId, attachmentIds: [file.id] });
    assert.equal(await prisma.projectRevision.count({ where: { stageId: folder.taskerStageId } }), 1, "Reopened tasks can submit files normally");
  }

  // Preserve executor acceptance and supporting material after workflow progression.
  const { input, folder } = await fixture("PROJECT_DEVELOPMENT", true);
  const acceptedAt = (await prisma.projectStage.findUniqueOrThrow({ where: { id: folder.taskerStageId } })).actualStartedAt;
  const workspace = await prisma.projectResearchWorkspace.create({ data: { projectId: input.projectId, ownerUserId: owner.id } });
  const tech = await prisma.projectResearchFolder.create({ data: {
    workspaceId: workspace.id, name: "Tech", normalizedName: "tech", createdById: owner.id,
  } });
  const supporting = await attachment(input.projectId, null);
  await prisma.projectResearchFolderFile.create({ data: { folderId: tech.id, attachmentId: supporting.id, addedById: executor.id } });
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId: input.projectId })));
  assert.equal((await getTaskCompletionRevocationEligibility(owner, input)).reopensStage, true);
  const reopened = await revokeConceptTaskCompletion(owner, input);
  assert.ok("changed" in reopened, JSON.stringify(reopened));
  const after = await states(input.projectId);
  assert.equal(after.find((stage) => stage.stageKey === "PROJECT_DEVELOPMENT")?.status, "AVAILABLE");
  for (const key of ["FINAL_LAYOUT", "PRODUCTION_AND_HANDOVER", "IMPLEMENTATION_AND_SUPERVISION"]) {
    const stage = after.find((record) => record.stageKey === key)!;
    assert.equal(stage.status, "LOCKED"); assert.equal(stage.completedAt, null); assert.equal(stage.unlockedAt, null);
  }
  assert.equal((await prisma.projectStage.findUniqueOrThrow({ where: { id: folder.taskerStageId } })).actualStartedAt?.getTime(), acceptedAt?.getTime());
  assert.equal((await prisma.projectAttachment.findUniqueOrThrow({ where: { id: supporting.id } })).status, "READY");
  assert.equal((await getProjectConceptChatContext(executor, input))?.chatMode.canRequestCompletion, true);
  assert.ok("error" in await completeStageFourConcepts(owner, { projectId: input.projectId }), "Reopened task must be completed again");
  assert.ok(!("error" in await requestProjectConceptTaskCompletion(executor, input)));
  assert.ok(!("error" in await completeProjectConceptTaskWithoutFile(owner, input)));
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId: input.projectId })));

  // Missing executors must be explicitly selected and validated again on the server.
  const missing = await fixture("PROJECT_DEVELOPMENT", true);
  await completeStageFourConcepts(owner, { projectId: missing.input.projectId });
  await prisma.projectConceptFolder.update({ where: { id: missing.folder.id }, data: { assignedExecutorId: null } });
  await prisma.projectExecutor.deleteMany({ where: { projectId: missing.input.projectId } });
  await blocked(missing.input, /Add an executor/);
  assert.equal((await getTaskCompletionRevocationEligibility(owner, missing.input)).executorOptions.length, 0);
  await prisma.projectExecutor.create({ data: { projectId: missing.input.projectId, userId: executor.id } });
  await blocked(missing.input, /Choose a project executor/);
  assert.equal((await getTaskCompletionRevocationEligibility(owner, missing.input)).executorOptions[0].id, executor.id);
  assert.ok("error" in await revokeConceptTaskCompletion(owner, { ...missing.input, executorId: outsider.id }));
  await prisma.user.update({ where: { id: executor.id }, data: { role: "ADMIN" } });
  assert.ok("error" in await revokeConceptTaskCompletion(owner, { ...missing.input, executorId: executor.id }));
  await prisma.user.update({ where: { id: executor.id }, data: { role: "USER" } });
  assert.ok("changed" in await revokeConceptTaskCompletion(owner, { ...missing.input, executorId: executor.id }));
  const reassigned = await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: missing.folder.id }, include: { taskerStage: true } });
  assert.equal(reassigned.assignedExecutorId, executor.id);
  assert.equal(reassigned.taskerStage.actualStartedAt, null);
  assert.equal(reassigned.taskerStage.startedById, null);

  // Reopening Stage 3 relocks an empty Stage 4, but cannot disrupt Stage 4 tasks.
  const three = await fixture("CONCEPT_CREATION");
  await completeStageThreeConcepts(owner, { projectId: three.input.projectId });
  await completeStageFourConcepts(owner, { projectId: three.input.projectId });
  assert.ok("changed" in await revokeConceptTaskCompletion(owner, three.input));
  assert.equal((await states(three.input.projectId)).find((stage) => stage.stageKey === "PROJECT_DEVELOPMENT")?.status, "LOCKED");
  await completeProjectConceptTaskWithoutFile(owner, three.input);
  await completeStageThreeConcepts(owner, { projectId: three.input.projectId });
  await task(three.input.projectId, "PROJECT_DEVELOPMENT");
  await blocked(three.input, /Stage 4 already has tasks/);

  // Later files, drafts, closed projects and production prevent reopening.
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: input.projectId }, data: { [field]: new Date() } });
    await blocked(input, /archived projects/);
    await prisma.project.update({ where: { id: input.projectId }, data: { [field]: null } });
  }
  const laterFile = await attachment(input.projectId, null);
  await blocked(input, /later-stage files/);
  await prisma.projectAttachment.update({ where: { id: laterFile.id }, data: { status: "DELETED" } });
  const draft = await prisma.projectFormDraft.create({ data: {
    projectId: input.projectId, userId: owner.id, formKey: "stage-five-file-checklist", clientId: randomUUID(), payload: { text: "Keep this work" },
  } });
  await blocked(input, /saved drafts/);
  await prisma.projectFormDraft.delete({ where: { id: draft.id } });
  await prisma.projectWorkflowStage.updateMany({ where: { projectId: input.projectId, stageKey: "FINAL_LAYOUT" }, data: { status: "COMPLETED", completedAt: new Date() } });
  await prisma.projectWorkflowStage.updateMany({ where: { projectId: input.projectId, stageKey: "PRODUCTION_AND_HANDOVER" }, data: { status: "AVAILABLE", unlockedAt: new Date() } });
  await blocked(input, /Stage 5 is completed/);

  // Keep sibling approved files, and reset only untouched derived checklists.
  const mixed = await fixture();
  const sibling = await task(mixed.input.projectId, "PROJECT_DEVELOPMENT", "Final drawing");
  await startProjectStageWork(executor, { projectId: mixed.input.projectId, stageId: sibling.taskerStageId });
  const file = await attachment(mixed.input.projectId, sibling.taskerStageId, "REVISION_ORIGINAL");
  await createStageRevision(executor, { projectId: mixed.input.projectId, stageId: sibling.taskerStageId, attachmentIds: [file.id] });
  assert.ok(!("error" in await markStageFourFinalApprovedAttachment(owner, { projectId: mixed.input.projectId, folderId: sibling.id, attachmentId: file.id })));
  await completeStageFourConcepts(owner, { projectId: mixed.input.projectId });
  const checklist = await prisma.projectFileChecklist.findFirstOrThrow({ where: { projectId: mixed.input.projectId } });
  const item = await prisma.projectFileChecklistItem.create({ data: { checklistId: checklist.id, fieldKey: "OUTPUT_NAME", value: { text: "Saved work" } } });
  await blocked(mixed.input, /checklist work/);
  assert.deepEqual((await prisma.projectFileChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).value, { text: "Saved work" });
  await prisma.projectFileChecklistItem.update({ where: { id: item.id }, data: { value: Prisma.DbNull } });
  const request = await prisma.projectFileChecklistRequest.create({ data: {
    clientRequestId: randomUUID(), projectId: mixed.input.projectId, checklistId: checklist.id, checklistItemId: item.id,
    fieldKey: "OUTPUT_NAME", requestedById: owner.id, channel: "IN_APP", recipientUserId: executor.id,
  } });
  await blocked(mixed.input, /information requests/);
  await prisma.projectFileChecklistRequest.delete({ where: { id: request.id } });
  assert.equal((await getTaskCompletionRevocationEligibility(owner, mixed.input)).emptyChecklistCount, 1);
  assert.ok("changed" in await revokeConceptTaskCompletion(owner, mixed.input));
  assert.equal(await prisma.projectFileChecklist.count({ where: { projectId: mixed.input.projectId } }), 0);
  assert.equal((await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: sibling.id } })).approvedAttachmentId, file.id);
  assert.equal((await prisma.projectAttachment.findUniqueOrThrow({ where: { id: file.id } })).status, "READY");
  await completeProjectConceptTaskWithoutFile(owner, mixed.input);
  await completeStageFourConcepts(owner, { projectId: mixed.input.projectId });
  assert.equal(await prisma.projectStageFileHandoff.count({ where: { projectId: mixed.input.projectId, sourceAttachmentId: file.id } }), 1);

  // A concurrent stage-completion click must not leave Stage 5 open behind an open task.
  const race = await fixture();
  await Promise.all([revokeConceptTaskCompletion(owner, race.input), completeStageFourConcepts(owner, { projectId: race.input.projectId })]);
  const raceTask = await prisma.projectStage.findUniqueOrThrow({ where: { id: race.folder.taskerStageId } });
  const raceWorkflow = await states(race.input.projectId);
  assert.equal(raceTask.status, "ONGOING");
  assert.equal(raceWorkflow.find((stage) => stage.stageKey === "PROJECT_DEVELOPMENT")?.status, "AVAILABLE");
  assert.equal(raceWorkflow.find((stage) => stage.stageKey === "FINAL_LAYOUT")?.status, "LOCKED");
  console.log("Task completion revocation passed: Stage 3/4 task headers, permissions, acceptance, files, executor recovery, workflow progression, downstream preservation and concurrent requests.");
}

main().finally(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projects } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((record) => record.id) } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

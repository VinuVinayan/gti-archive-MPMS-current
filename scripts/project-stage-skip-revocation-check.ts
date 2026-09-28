import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import { completeProjectResearchStage } from "../src/lib/project-research";
import {
  completeStageThreeConcepts, completeStageFourConcepts, createProjectConceptFolder,
  markProjectConceptApprovedAttachment, markStageFourFinalApprovedAttachment,
} from "../src/lib/project-concepts";
import { getStageSkipRevocationEligibility, revokeSkippedConceptStage } from "../src/lib/project-stage-skip-revocation";

const prefix = `undo-skip-${randomUUID()}`;
const makeUser = (name: string, role: UserRole = UserRole.USER) => ({ id: `${prefix}-${name}`, name, email: `${prefix}-${name}@example.test`, role });
const owner = makeUser("Owner"), executor = makeUser("Executor"), coOwner = makeUser("CoOwner"), outsider = makeUser("Outsider"), admin = makeUser("Admin", UserRole.ADMIN);
const users = [owner, executor, coOwner, outsider, admin];
const projectIds: string[] = [];
type StageKey = "CONCEPT_CREATION" | "PROJECT_DEVELOPMENT";

async function project(withExecutor = true, stageTwo = false) {
  const id = `${prefix}-${projectIds.length}`;
  projectIds.push(id);
  const activeIndex = stageTwo ? 1 : 2;
  await prisma.project.create({ data: {
    id, name: "Undo skip checks", ownerId: owner.id, createdById: owner.id,
    coOwners: { create: { userId: coOwner.id } },
    ...(withExecutor ? { executors: { create: { userId: executor.id } } } : {}),
    workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage, index) => ({
      ...stage, status: index < activeIndex ? "COMPLETED" as const : index === activeIndex ? "AVAILABLE" as const : "LOCKED" as const,
      completedAt: index < activeIndex ? new Date() : null,
      unlockedAt: index <= activeIndex ? new Date() : null,
    })) } },
  } });
  return id;
}

async function states(projectId: string) {
  return prisma.projectWorkflowStage.findMany({ where: { projectId }, orderBy: { stageKey: "asc" } });
}

async function blocked(projectId: string, stageKey: StageKey, pattern?: RegExp) {
  const input = { projectId, stageKey };
  const before = await states(projectId);
  const eligibility = await getStageSkipRevocationEligibility(owner, input);
  assert.equal(eligibility.canRevoke, false);
  if (pattern) assert.match(eligibility.reason ?? "", pattern);
  const result = await revokeSkippedConceptStage(owner, input);
  assert.ok("error" in result, JSON.stringify(result));
  assert.deepEqual(await states(projectId), before, "Blocked revocation must not change workflow state");
}

async function emptySkipped() {
  const id = await project();
  assert.ok(!("error" in await completeStageThreeConcepts(owner, { projectId: id })));
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId: id })));
  return id;
}

async function approvedTask(projectId: string, stageKey: StageKey) {
  const created = await createProjectConceptFolder(owner, {
    projectId, stageKey, name: `Design ${stageKey}`, assignedExecutorId: executor.id,
    deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>Create the layout.</p>",
  });
  assert.ok("folder" in created && created.folder, JSON.stringify(created));
  const revision = await prisma.projectRevision.create({ data: {
    projectId, stageId: created.folder.taskerStageId, createdById: executor.id,
    revisionNumber: 1, title: "Design", status: "PENDING_REVIEW",
  } });
  const attachment = await prisma.projectAttachment.create({ data: {
    projectId, stageId: created.folder.taskerStageId, revisionId: revision.id, uploadedById: executor.id,
    fileName: "design.png", originalFileName: "design.png", mimeType: "image/png", fileSize: 100,
    bucket: "test", storageKey: `${prefix}/${randomUUID()}`, assetType: "REVISION_ORIGINAL", status: "READY",
  } });
  const approve = stageKey === "CONCEPT_CREATION" ? markProjectConceptApprovedAttachment : markStageFourFinalApprovedAttachment;
  const result = await approve(owner, { projectId, folderId: created.folder.id, attachmentId: attachment.id });
  assert.ok(!("error" in result), JSON.stringify(result));
  return { folderId: created.folder.id, attachmentId: attachment.id };
}

async function main() {
  await prisma.user.createMany({ data: users.map((user) => ({ ...user, passwordHash: "test", projectCreationAccessGranted: user.id === owner.id })) });

  // Automatic skips in a self-managed project require an executor before reopening.
  const selfManaged = await project(false, true);
  const completedResearch = await completeProjectResearchStage(admin, selfManaged);
  assert.ok("skippedConceptStages" in completedResearch && completedResearch.skippedConceptStages, JSON.stringify(completedResearch));
  for (const stageKey of ["CONCEPT_CREATION", "PROJECT_DEVELOPMENT"] as const) {
    await blocked(selfManaged, stageKey, /executor/i);
    assert.equal((await getStageSkipRevocationEligibility(owner, { projectId: selfManaged, stageKey })).requiresExecutor, true);
  }
  await prisma.projectExecutor.create({ data: { projectId: selfManaged, userId: executor.id } });
  const input = { projectId: selfManaged, stageKey: "CONCEPT_CREATION" as const };
  for (const actor of [executor, coOwner, outsider]) {
    assert.equal((await getStageSkipRevocationEligibility(actor, input)).visible, false);
    assert.ok("error" in await revokeSkippedConceptStage(actor, input));
  }
  assert.equal((await getStageSkipRevocationEligibility(admin, input)).canRevoke, true);
  // A stale UI must not bypass an executor removed after the eligibility check.
  assert.equal((await getStageSkipRevocationEligibility(owner, input)).canRevoke, true);
  await prisma.projectExecutor.deleteMany({ where: { projectId: selfManaged } });
  await blocked(selfManaged, "CONCEPT_CREATION", /executor/i);
  await prisma.projectExecutor.create({ data: { projectId: selfManaged, userId: executor.id } });
  const together = await Promise.all([revokeSkippedConceptStage(owner, input), revokeSkippedConceptStage(owner, input)]);
  assert.equal(together.filter((result) => "changed" in result).length, 1, "Concurrent clicks must reopen once");
  const reopened = await states(selfManaged);
  assert.equal(reopened.find((stage) => stage.stageKey === "CONCEPT_CREATION")?.status, "AVAILABLE");
  for (const key of ["PROJECT_DEVELOPMENT", "FINAL_LAYOUT", "PRODUCTION_AND_HANDOVER", "IMPLEMENTATION_AND_SUPERVISION"]) {
    const stage = reopened.find((entry) => entry.stageKey === key)!;
    assert.equal(stage.status, "LOCKED"); assert.equal(stage.completedAt, null); assert.equal(stage.unlockedAt, null);
  }
  assert.equal(await prisma.projectActivityLog.count({ where: { projectId: selfManaged, action: "STAGE_SKIP_REVOKED" } }), 1);
  assert.equal((await getStageSkipRevocationEligibility(owner, input)).visible, false);
  await approvedTask(selfManaged, "CONCEPT_CREATION");
  assert.ok(!("error" in await completeStageThreeConcepts(owner, { projectId: selfManaged })));
  await blocked(selfManaged, "CONCEPT_CREATION", /not skipped/i);

  // Undo Stage 4 only when its automatically carried-forward checklist is untouched.
  const carried = await project();
  const original = await approvedTask(carried, "CONCEPT_CREATION");
  await completeStageThreeConcepts(owner, { projectId: carried });
  await completeStageFourConcepts(owner, { projectId: carried });
  const handoff = await prisma.projectStageFileHandoff.findFirstOrThrow({ where: { projectId: carried }, include: { checklist: true } });
  assert.ok(handoff.checklist);
  const item = await prisma.projectFileChecklistItem.create({ data: { checklistId: handoff.checklist.id, fieldKey: "OUTPUT_NAME" } });
  const reopenFour = { projectId: carried, stageKey: "PROJECT_DEVELOPMENT" as const };
  assert.equal((await getStageSkipRevocationEligibility(owner, reopenFour)).emptyChecklistCount, 1);
  await prisma.projectFileChecklistItem.update({ where: { id: item.id }, data: { value: { text: "Saved layout details" } } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /checklist work/i);
  await prisma.projectFileChecklistItem.update({ where: { id: item.id }, data: { value: Prisma.DbNull, updatedById: owner.id } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /checklist work/i);
  await prisma.projectFileChecklistItem.update({ where: { id: item.id }, data: { updatedById: null } });
  const request = await prisma.projectFileChecklistRequest.create({ data: {
    clientRequestId: randomUUID(), projectId: carried, checklistId: handoff.checklist.id, checklistItemId: item.id,
    fieldKey: "OUTPUT_NAME", requestedById: owner.id, channel: "IN_APP", recipientUserId: executor.id,
  } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /requests/i);
  assert.equal(await prisma.projectFileChecklistRequest.count({ where: { id: request.id } }), 1);
  await prisma.projectFileChecklistRequest.delete({ where: { id: request.id } });
  const draft = await prisma.projectFormDraft.create({ data: {
    projectId: carried, userId: owner.id, formKey: `stage-five-checklist:${handoff.id}`, payload: { text: "Unsaved details" }, clientId: randomUUID(),
  } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /drafts/i);
  assert.equal(await prisma.projectFormDraft.count({ where: { id: draft.id } }), 1);
  await prisma.projectFormDraft.delete({ where: { id: draft.id } });
  // In-flight uploads cannot be silently orphaned by an Undo Skip click.
  const pendingFile = await prisma.projectAttachment.create({ data: {
    projectId: carried, uploadedById: owner.id, fileName: "pending.pdf", originalFileName: "pending.pdf", mimeType: "application/pdf",
    fileSize: 100, bucket: "test", storageKey: `${prefix}/pending`, assetType: "FILE_CHECKLIST_ATTACHMENT", status: "UPLOADING",
  } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /upload/i);
  await prisma.projectAttachment.update({ where: { id: pendingFile.id }, data: { status: "READY" } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /files/i);
  await prisma.projectAttachment.delete({ where: { id: pendingFile.id } });
  const unit = await prisma.projectProductionUnit.create({ data: {
    projectId: carried, sourceHandoffId: handoff.id, sourceChecklistId: handoff.checklist.id,
    sourceAttachmentId: original.attachmentId, createdById: owner.id,
  } });
  await blocked(carried, "PROJECT_DEVELOPMENT", /production work/i);
  assert.equal(await prisma.projectProductionUnit.count({ where: { id: unit.id } }), 1);
  await prisma.projectProductionUnit.delete({ where: { id: unit.id } });
  // Pause deletion after eligibility was checked, then create a request from
  // another connection. The serializable revoke must retry and preserve it.
  let releaseHandoff!: () => void;
  let reportLocked!: () => void;
  const hold = new Promise<void>((resolve) => { releaseHandoff = resolve; });
  const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProjectStageFileHandoff" WHERE "id" = ${handoff.id} FOR UPDATE`;
    reportLocked();
    await hold;
  }, { timeout: 15_000 });
  await locked;
  const concurrentRevoke = revokeSkippedConceptStage(owner, reopenFour);
  let concurrentRequestId: string | undefined;
  try {
    const until = Date.now() + 5_000;
    let waiting = false;
    while (Date.now() < until) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%DELETE%ProjectStageFileHandoff%'`;
      if (Number(rows[0].count) > 0) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "The concurrent revoke must reach its deletion before the new request is saved");
    const concurrentRequest = await prisma.projectFileChecklistRequest.create({ data: {
      clientRequestId: randomUUID(), projectId: carried, checklistId: handoff.checklist.id, checklistItemId: item.id,
      fieldKey: "OUTPUT_NAME", requestedById: owner.id, channel: "IN_APP", recipientUserId: executor.id,
    } });
    concurrentRequestId = concurrentRequest.id;
  } finally {
    releaseHandoff();
    await holder;
  }
  assert.ok("error" in await concurrentRevoke, "A concurrently created request must block reopening");
  assert.equal(await prisma.projectFileChecklistRequest.count({ where: { id: concurrentRequestId! } }), 1, "Concurrent request data must remain intact");
  await prisma.projectFileChecklistRequest.delete({ where: { id: concurrentRequestId! } });
  assert.ok("changed" in await revokeSkippedConceptStage(owner, reopenFour));
  assert.equal(await prisma.projectStageFileHandoff.count({ where: { projectId: carried } }), 0);
  assert.equal(await prisma.projectFileChecklist.count({ where: { projectId: carried } }), 0);
  assert.equal((await prisma.projectAttachment.findUniqueOrThrow({ where: { id: original.attachmentId } })).status, "READY");
  assert.equal((await prisma.projectConceptFolder.findUniqueOrThrow({ where: { id: original.folderId } })).approvedAttachmentId, original.attachmentId);
  const final = await approvedTask(carried, "PROJECT_DEVELOPMENT");
  assert.ok(!("error" in await completeStageFourConcepts(owner, { projectId: carried })));
  const nextHandoffs = await prisma.projectStageFileHandoff.findMany({ where: { projectId: carried } });
  assert.equal(nextHandoffs.length, 1);
  assert.equal(nextHandoffs[0].sourceAttachmentId, final.attachmentId, "Recompletion must use the new Stage 4 file without restoring the old Stage 3 handoff");

  const laterWork = await emptySkipped();
  for (const key of ["FINAL_LAYOUT", "PRODUCTION_AND_HANDOVER", "IMPLEMENTATION_AND_SUPERVISION"] as const) {
    const before = await prisma.projectWorkflowStage.findUniqueOrThrow({ where: { projectId_stageKey: { projectId: laterWork, stageKey: key } } });
    await prisma.projectWorkflowStage.update({ where: { id: before.id }, data: { status: key === "FINAL_LAYOUT" ? "COMPLETED" : "AVAILABLE" } });
    await blocked(laterWork, "CONCEPT_CREATION", /production work|Stage 5 is completed/i);
    await blocked(laterWork, "PROJECT_DEVELOPMENT");
    await prisma.projectWorkflowStage.update({ where: { id: before.id }, data: { status: before.status } });
  }
  for (const field of ["completedAt", "archivedAt"] as const) {
    await prisma.project.update({ where: { id: laterWork }, data: { [field]: new Date() } });
    await blocked(laterWork, "CONCEPT_CREATION", /archived|completed/i);
    await prisma.project.update({ where: { id: laterWork }, data: { [field]: null } });
  }
  const direct = await prisma.projectAttachment.create({ data: {
    projectId: laterWork, uploadedById: owner.id, fileName: "direct.pdf", originalFileName: "direct.pdf", mimeType: "application/pdf",
    fileSize: 100, bucket: "test", storageKey: `${prefix}/direct`, assetType: "GENERAL_PROJECT_ASSET", status: "READY",
  } });
  await prisma.projectStageFileHandoff.create({ data: {
    projectId: laterWork, sourceWorkflowStageKey: "FINAL_LAYOUT", targetWorkflowStageKey: "FINAL_LAYOUT", sourceAttachmentId: direct.id, handedOffById: owner.id,
    checklist: { create: { projectId: laterWork, sourceAttachmentId: direct.id } },
  } });
  await blocked(laterWork, "CONCEPT_CREATION", /uploaded files/i);
  await blocked(laterWork, "PROJECT_DEVELOPMENT", /uploaded files/i);
  assert.equal(await prisma.projectAttachment.count({ where: { id: direct.id } }), 1);

  const withStageFour = await project();
  await completeStageThreeConcepts(owner, { projectId: withStageFour });
  await approvedTask(withStageFour, "PROJECT_DEVELOPMENT");
  await blocked(withStageFour, "CONCEPT_CREATION", /Stage 4 already has tasks/i);

  const racing = await project();
  await completeStageThreeConcepts(owner, { projectId: racing });
  await Promise.all([
    completeStageFourConcepts(owner, { projectId: racing }),
    revokeSkippedConceptStage(owner, { projectId: racing, stageKey: "CONCEPT_CREATION" }),
  ]);
  const raceStates = await states(racing);
  if (raceStates.find((stage) => stage.stageKey === "CONCEPT_CREATION")?.status === "AVAILABLE") {
    assert.equal(raceStates.find((stage) => stage.stageKey === "PROJECT_DEVELOPMENT")?.status, "LOCKED");
    assert.equal(raceStates.find((stage) => stage.stageKey === "FINAL_LAYOUT")?.status, "LOCKED");
  }
  const racingTask = await project();
  await completeStageThreeConcepts(owner, { projectId: racingTask });
  await Promise.all([
    createProjectConceptFolder(owner, { projectId: racingTask, stageKey: "PROJECT_DEVELOPMENT", name: "Concurrent task", assignedExecutorId: executor.id, deadline: new Date(Date.now() + 86_400_000).toISOString(), brief: "<p>New work</p>" }),
    revokeSkippedConceptStage(owner, { projectId: racingTask, stageKey: "CONCEPT_CREATION" }),
  ]);
  if ((await states(racingTask)).find((stage) => stage.stageKey === "PROJECT_DEVELOPMENT")?.status === "LOCKED") {
    assert.equal(await prisma.projectConceptFolder.count({ where: { projectId: racingTask, workflowStageKey: "PROJECT_DEVELOPMENT" } }), 0, "A task created concurrently must not end up in a relocked stage");
  }
  console.log("Undo stage skip checks passed: executor requirements, authorization, data preservation, workflow progression, and concurrent changes.");
}

main().finally(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

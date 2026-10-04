import { canManageStageFive } from "../src/lib/stage-five";
import { canManageStageSix } from "../src/lib/stage-six";
import { getProjectStageAccessRecordById } from "../src/lib/project-stage-data";
import { canManageStageSeven, closeStageSevenProject } from "../src/lib/stage-seven";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { UserRole } from "@prisma/client";
import { createProjectV2 } from "../src/lib/project-creation";
import { prisma } from "../src/lib/prisma";
import {
  canManageProjectStages,
  canManageProjectTemplates,
  listProjectTemplates,
  publishProjectTemplate,
  updateCustomProjectStructure,
  approveCustomProjectStructure,
  saveGenericStageContent,
  completeGenericProjectStage,
  templateProjectInclude,
} from "../src/lib/project-templates";
import {
  newStageDefinition,
  validateStageDefinitions,
  type TemplateKey,
} from "../src/lib/project-template-definitions";
import {
  deriveProjectListWorkflowState,
  buildProjectListStatusWhere,
} from "../src/lib/project-list-workflow";
import { hasProjectPermission } from "../src/lib/permissions/resolver";

const run = randomUUID();
const owner = { id: `template-owner-${run}`, role: UserRole.USER };
const coOwner = { id: `template-co-owner-${run}`, role: UserRole.ADMIN };
const executor = { id: `template-executor-${run}`, role: UserRole.USER };
const director = { id: `template-director-${run}`, role: UserRole.ADMIN };
const created: string[] = [];
async function create(
  key: TemplateKey,
  stages?: ReturnType<typeof newStageDefinition>[],
) {
  const result = await createProjectV2(owner, {
    name: `Template ${key} ${run}`,
    ownerId: owner.id,
    coOwnerIds: [coOwner.id],
    executorIds: [executor.id],
    templateKey: key,
    customStages: stages,
  });
  assert("projectId" in result, JSON.stringify(result));
  created.push(result.projectId);
  return prisma.project.findUniqueOrThrow({
    where: { id: result.projectId },
    include: templateProjectInclude,
  });
}
async function main() {
  await prisma.user.createMany({
    data: [owner, coOwner, executor, director].map((user) => ({
      ...user,
      email: `${user.id}@example.test`,
      passwordHash: "isolated-test-only",
      projectCreationAccessGranted: user.id === owner.id,
      templateManagementAccessGranted: user.id === director.id,
    })),
  });
  const legacy = await prisma.project.findUnique({
    where: { id: "template-migration-fixture" },
    include: {
      stageInstances: { orderBy: { order: "asc" } },
      workflowStages: true,
      attachments: true,
      revisions: true,
      stages: true,
    },
  });
  if (process.env.TEMPLATE_MIGRATION_FIXTURE === "1") {
    assert(legacy);
    const closedLegacy = await prisma.project.findUniqueOrThrow({where: {id: "template-migration-closed"}, include: {stageInstances: true}});
    assert.equal(closedLegacy.stageInstances.length, 7);
    assert(closedLegacy.stageInstances.every(stage => stage.status === "COMPLETED"));
    assert.equal(closedLegacy.completedAt?.toISOString(), "2026-02-01T00:00:00.000Z");
    assert.equal(legacy.templateVersionId, "template-packaging-legacy");
    assert.equal(legacy.stageInstances.length, 7);
    assert.equal(legacy.workflowStages[0].id, "template-migration-workflow");
    assert.equal(legacy.stageInstances[0].status, "COMPLETED");
    assert.equal(
      legacy.stageInstances[0].completedAt?.toISOString(),
      "2026-01-02T00:00:00.000Z",
    );
    assert.equal(legacy.stageInstances[1].status, "AVAILABLE");
    assert.equal(legacy.stages[0].id, "template-migration-task");
    assert.equal(legacy.revisions[0].id, "template-migration-revision");
    assert.equal(
      legacy.attachments[0].storageKey,
      "preserved/migration-fixture.pdf",
    );
    assert.equal(
      legacy.attachments[0].revisionId,
      "template-migration-revision",
    );
  }
  const templates = await listProjectTemplates();
  assert.deepEqual(
    templates.map((t) => t.key),
    ["PACKAGING", "POSM", "RETAIL", "EXHIBITION", "DIGITAL", "CUSTOM"],
  );
  const projects = new Map<TemplateKey, Awaited<ReturnType<typeof create>>>();
  for (const [key, count] of [
    ["PACKAGING", 8],
    ["POSM", 6],
    ["RETAIL", 7],
    ["EXHIBITION", 8],
    ["DIGITAL", 8],
  ] as const) {
    const project = await create(key);
    projects.set(key, project);
    assert.equal(project.stageInstances.length, count, key);
    assert.deepEqual(
      project.stageInstances.map((s) => s.order),
      Array.from({ length: count }, (_, i) => i + 1),
    );
    assert.equal(project.stageInstances[0].status, "AVAILABLE");
    assert(project.stageInstances.slice(1).every((s) => s.status === "LOCKED"));
    assert.equal(
      deriveProjectListWorkflowState({ ...project, workflowStages: [] })
        .businessStatus,
      "ACTIVE",
    );
    assert(
      await prisma.project.findFirst({
        where: {
          AND: [{ id: project.id }, buildProjectListStatusWhere("ACTIVE")],
        },
      }),
    );
    assert.equal(
      await prisma.projectWorkflowStage.count({
        where: { projectId: project.id },
      }),
      key === "PACKAGING" ? 7 : 0,
    );
  }
  const packaging = projects.get("PACKAGING")!;
  assert.equal(packaging.stageInstances[7].name, "Commercialisation");
  assert(
    packaging.stageInstances
      .slice(0, 7)
      .every((s) => s.workspace.startsWith("PACKAGING_") && s.legacyStageKey),
  );
  const access = {
    ownerId: owner.id,
    coOwners: [{ userId: coOwner.id }],
    executors: [{ userId: executor.id }],
  };
  const packagingAccess = await getProjectStageAccessRecordById(packaging.id);
  assert(packagingAccess);
  for (const canManage of [canManageStageFive, canManageStageSix, canManageStageSeven]) {
    assert(canManage(owner, packagingAccess), "Owner manages Packaging workspace");
    assert(canManage({ ...coOwner, role: UserRole.USER }, packagingAccess), "Co-owner manages Packaging workspace");
    assert(!canManage(executor, packagingAccess), "Executor cannot manage Packaging workspace");
  }
  assert(canManageProjectStages(owner, access));
  assert(canManageProjectStages(coOwner, access));
  assert(!canManageProjectStages(executor, access));
  assert(hasProjectPermission(owner, access, "stage.markStageComplete"));
  assert(!hasProjectPermission(executor, access, "stage.markStageComplete"));
  assert(!(await canManageProjectTemplates(owner)));
  assert(await canManageProjectTemplates(director));
  assert(!(await canManageProjectTemplates(coOwner)));
  const custom = await create("CUSTOM", [
    newStageDefinition("One"),
    {
      ...newStageDefinition("Optional review"),
      required: false,
      skippable: true,
    },
    newStageDefinition("Three"),
  ]);
  assert.equal(custom.structureApproval, "DRAFT");
  assert(custom.stageInstances.every((s) => s.status === "LOCKED"));
  await assert.rejects(
    () =>
      saveGenericStageContent(owner, {
        projectId: custom.id,
        stageId: custom.stageInstances[0].id,
        content: "Blocked",
        expectedRevision: 1,
      }),
    /approval/,
  );
  await assert.rejects(
    () => approveCustomProjectStructure(owner, custom.id, 1),
    /Director/,
  );
  const reversed = validateStageDefinitions(custom.stageInstances).reverse();
  await updateCustomProjectStructure(owner, {
    projectId: custom.id,
    expectedRevision: 1,
    stages: reversed,
    reason: "Reorder before starting",
  });
  let revised = await prisma.project.findUniqueOrThrow({
    where: { id: custom.id },
    include: templateProjectInclude,
  });
  assert.deepEqual(
    revised.stageInstances.map((s) => s.id),
    custom.stageInstances.map((s) => s.id).reverse(),
  );
  await assert.rejects(
    () =>
      updateCustomProjectStructure(owner, {
        projectId: custom.id,
        expectedRevision: 1,
        stages: reversed,
        reason: "Stale edit",
      }),
    /changed/,
  );
  await approveCustomProjectStructure(director, custom.id, 2);
  await updateCustomProjectStructure(owner, {
    projectId: custom.id,
    expectedRevision: 2,
    stages: [reversed[0], reversed[1]],
    reason: "Remove an unused draft stage",
  });
  revised = await prisma.project.findUniqueOrThrow({
    where: { id: custom.id },
    include: templateProjectInclude,
  });
  assert.equal(revised.structureApproval, "DRAFT");
  assert.equal(revised.stageInstances.length, 2);
  assert.equal(
    await prisma.projectStageInstance.count({
      where: { projectId: custom.id, retiredAt: { not: null } },
    }),
    1,
  );
  await approveCustomProjectStructure(director, custom.id, 3);
  revised = await prisma.project.findUniqueOrThrow({
    where: { id: custom.id },
    include: templateProjectInclude,
  });
  const first = revised.stageInstances[0];
  await assert.rejects(
    () =>
      saveGenericStageContent(executor, {
        projectId: custom.id,
        stageId: first.id,
        content: "Forbidden",
        expectedRevision: first.revision,
      }),
    /access/,
  );
  await assert.rejects(
    () =>
      completeGenericProjectStage(owner, {
        projectId: custom.id,
        stageId: revised.stageInstances[1].id,
        expectedRevision: revised.stageInstances[1].revision,
      }),
    /locked/,
  );
  const revision = await saveGenericStageContent(owner, {
    projectId: custom.id,
    stageId: first.id,
    content: "Working notes",
    expectedRevision: first.revision,
  });
  await assert.rejects(
    () =>
      saveGenericStageContent(owner, {
        projectId: custom.id,
        stageId: first.id,
        content: "Lost update",
        expectedRevision: first.revision,
      }),
    /changed/,
  );
  await assert.rejects(
    () =>
      updateCustomProjectStructure(owner, {
        projectId: custom.id,
        expectedRevision: 3,
        stages: reversed,
        reason: "After work",
      }),
    /begun/,
  );
  await completeGenericProjectStage(coOwner, {
    projectId: custom.id,
    stageId: first.id,
    expectedRevision: revision,
  });
  const optional = await prisma.projectStageInstance.findUniqueOrThrow({
    where: { id: revised.stageInstances[1].id },
  });
  await completeGenericProjectStage(owner, {
    projectId: custom.id,
    stageId: optional.id,
    expectedRevision: optional.revision,
    skip: true,
    reason: "Not needed for this project",
  });
  assert(
    (await prisma.project.findUniqueOrThrow({ where: { id: custom.id } }))
      .completedAt,
  );
  assert(
    (
      await prisma.projectStageInstance.findUniqueOrThrow({
        where: { id: optional.id },
      })
    ).skippedAt,
  );
  assert(
    (await prisma.projectStructureEvent.count({
      where: { projectId: custom.id },
    })) >= 8,
  );
  // Existing snapshot and source version remain unchanged after publication.
  const posm = projects.get("POSM")!;
  const master = templates.find((t) => t.key === "POSM")!;
  const edits = validateStageDefinitions(master.version.stages);
  edits[0].name = "Brief for future projects";
  await assert.rejects(
    () =>
      publishProjectTemplate(owner, {
        key: "POSM",
        expectedVersion: master.currentVersion,
        stages: edits,
        reason: "Unauthorized",
      }),
    /Director/,
  );
  await publishProjectTemplate(director, {
    key: "POSM",
    expectedVersion: master.currentVersion,
    stages: edits,
    reason: "Test immutable versions",
  });
  const unchanged = await prisma.project.findUniqueOrThrow({
    where: { id: posm.id },
    include: templateProjectInclude,
  });
  assert.equal(unchanged.stageInstances[0].name, "Brief");
  assert.equal(unchanged.templateVersionId, posm.templateVersionId);
  const future = await create("POSM");
  assert.equal(future.stageInstances[0].name, edits[0].name);
  await publishProjectTemplate(director, {
    key: "POSM",
    expectedVersion: master.currentVersion + 1,
    stages: validateStageDefinitions(master.version.stages),
    reason: "Restore fixture master names",
  });
  // Packaging services write only legacy rows; trigger mirrors the same states.
  for (const stage of packaging.stageInstances.slice(0, 6)) {
    await prisma.projectWorkflowStage.update({
      where: {
        projectId_stageKey: {
          projectId: packaging.id,
          stageKey: stage.legacyStageKey!,
        },
      },
      data: {
        status: "COMPLETED",
        unlockedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }
  await prisma.projectWorkflowStage.update({
    where: {
      projectId_stageKey: {
        projectId: packaging.id,
        stageKey: "IMPLEMENTATION_AND_SUPERVISION",
      },
    },
    data: { status: "AVAILABLE", unlockedAt: new Date() },
  });
  const source = await prisma.projectAttachment.create({
    data: {
      projectId: packaging.id,
      uploadedById: owner.id,
      fileName: "accepted.pdf",
      originalFileName: "accepted.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      bucket: "isolated.invalid",
      storageKey: `template-test/${run}/accepted.pdf`,
      assetType: "STAGE_SUBMISSION",
      status: "READY",
    },
  });
  const handoff = await prisma.projectStageFileHandoff.create({
    data: {
      projectId: packaging.id,
      sourceWorkflowStageKey: "PROJECT_DEVELOPMENT",
      targetWorkflowStageKey: "FINAL_LAYOUT",
      sourceAttachmentId: source.id,
      handedOffById: owner.id,
    },
  });
  const checklist = await prisma.projectFileChecklist.create({
    data: {
      projectId: packaging.id,
      handoffId: handoff.id,
      sourceAttachmentId: source.id,
    },
  });
  await prisma.projectProductionUnit.create({
    data: {
      projectId: packaging.id,
      sourceHandoffId: handoff.id,
      sourceChecklistId: checklist.id,
      sourceAttachmentId: source.id,
      status: "HANDED_OVER",
      createdById: owner.id,
      supervision: {
        create: {
          projectId: packaging.id,
          status: "SIGNED_OFF",
          signedOffById: owner.id,
          signedOffAt: new Date(),
        },
      },
    },
  });
  assert.equal(
    (await closeStageSevenProject(owner, { projectId: packaging.id }))
      .duplicate,
    false,
  );
  assert.equal(
    (await closeStageSevenProject(owner, { projectId: packaging.id }))
      .duplicate,
    true,
  );
  assert.equal(
    await prisma.projectClosure.count({ where: { projectId: packaging.id } }),
    0,
  );
  const commercial = await prisma.projectStageInstance.findUniqueOrThrow({
    where: { id: packaging.stageInstances[7].id },
  });
  assert.equal(commercial.status, "AVAILABLE");
  assert(
    !(await prisma.project.findUniqueOrThrow({ where: { id: packaging.id } }))
      .completedAt,
  );
  assert.equal(
    deriveProjectListWorkflowState({
      ...packaging,
      stageInstances: await prisma.projectStageInstance.findMany({
        where: { projectId: packaging.id },
      }),
      workflowStages: [],
    }).businessStatus,
    "ACTIVE",
  );
  await completeGenericProjectStage(owner, {
    projectId: packaging.id,
    stageId: commercial.id,
    expectedRevision: commercial.revision,
  });
  assert(
    (await prisma.project.findUniqueOrThrow({ where: { id: packaging.id } }))
      .completedAt,
  );
  const digital = projects.get("DIGITAL")!;
  for (const stage of digital.stageInstances.slice(0, -1))
    await completeGenericProjectStage(owner, {
      projectId: digital.id,
      stageId: stage.id,
      expectedRevision: stage.revision,
    });
  const maintenance = await prisma.projectStageInstance.findUniqueOrThrow({
    where: { id: digital.stageInstances[7].id },
  });
  assert.equal(maintenance.stageType, "MAINTENANCE");
  assert.equal(maintenance.status, "AVAILABLE");
  await assert.rejects(
    () =>
      completeGenericProjectStage(owner, {
        projectId: digital.id,
        stageId: maintenance.id,
        expectedRevision: maintenance.revision,
      }),
    /stays open/,
  );
  const open = await prisma.project.findUniqueOrThrow({
    where: { id: digital.id },
  });
  assert.equal(open.completedAt, null);
  assert.equal(open.endDate, null);
  const overview = readFileSync(
    "src/components/projects/project-overview-workspace.tsx",
    "utf8",
  );
  assert(overview.includes("project.stageInstances ?? []"));
  assert(overview.includes("line-clamp-2"));
  assert(overview.includes("h-[260px]"));
  assert(!overview.includes("PROJECT_WORKFLOW_STAGE_DEFINITIONS"));
  // Wide structure proves no 7/8-stage domain cap.
  const many = await create(
    "CUSTOM",
    Array.from({ length: 12 }, (_, i) =>
      newStageDefinition(
        `Stage ${i + 1} with a long descriptive title that wraps naturally without changing card height`,
      ),
    ),
  );
  assert.equal(many.stageInstances.length, 12);
  assert.throws(
    () =>
      validateStageDefinitions([
        { ...newStageDefinition(), required: true, skippable: true },
      ]),
    /optional/,
  );
  console.log(
    "Template engine: migration preservation, all templates, snapshots, governance, Custom editing, locking, permissions, arbitrary counts, and Maintenance passed.",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.project.deleteMany({ where: { id: { in: created } } });
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, coOwner.id, executor.id, director.id] } },
    });
    await prisma.$disconnect();
  });

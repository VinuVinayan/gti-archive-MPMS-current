import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { UserRole } from "@prisma/client";
import fixtures from "./fixtures.json";
import { prisma } from "../../src/lib/prisma";
import {
  hashAuthPassword,
  verifyAuthPassword,
} from "../../src/lib/auth-password";
import { syncPermissionDefinitions } from "../../src/lib/permissions/profiles";
import { createProjectV2 } from "../../src/lib/project-creation";
import { createProjectConceptFolder } from "../../src/lib/project-concepts";
import {
  newStageDefinition,
  type TemplateKey,
  type StageDefinitionInput,
} from "../../src/lib/project-template-definitions";
import {
  approveCustomProjectStructure,
  completeGenericProjectStage,
  saveGenericStageContent,
  canManageProjectStages,
  canManageProjectTemplates,
  templateProjectInclude,
} from "../../src/lib/project-templates";

const owner = { id: "demo-owner", role: UserRole.USER };
const director = { id: "demo-director", role: UserRole.USER };
type DemoProject = {
  id: string;
  name: string;
  template: TemplateKey;
  scenario: string;
};
const manifest: DemoProject[] = [];

async function guard() {
  assert.equal(
    process.env.FLUX_DEMO_MODE,
    "local",
    "Use pnpm demo; standalone seeding is refused.",
  );
  const url = new URL(process.env.DATABASE_URL ?? "file:///missing");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55439");
  assert.equal(url.username, "flux_demo");
  assert.equal(url.pathname, "/flux_demo");
  const [row] = await prisma.$queryRaw<
    Array<{ data_directory: string }>
  >`SHOW data_directory`;
  assert.equal(
    realpathSync(row.data_directory),
    realpathSync(process.env.FLUX_DEMO_DATA_DIRECTORY!),
  );
}

async function create(
  template: TemplateKey,
  name: string,
  scenario: string,
  customStages?: StageDefinitionInput[],
) {
  const result = await createProjectV2(owner, {
    name: `[DEMO] ${name}`,
    ownerId: owner.id,
    coOwnerIds: ["demo-co-owner"],
    executorIds: ["demo-executor"],
    collaboratorIds: ["demo-collaborator"],
    templateKey: template,
    customStages,
  });
  assert("projectId" in result, JSON.stringify(result));
  const id = result.projectId;
  await prisma.project.update({
    where: { id },
    data: { description: `FAKE QA DATA ONLY. ${scenario}`, priority: "MEDIUM" },
  });
  manifest.push({ id, name: `[DEMO] ${name}`, template, scenario });
  return prisma.project.findUniqueOrThrow({
    where: { id },
    include: templateProjectInclude,
  });
}

async function progress(projectId: string, completedCount: number) {
  const stages = await prisma.projectStageInstance.findMany({
    where: { projectId, retiredAt: null },
    orderBy: { order: "asc" },
  });
  for (const stage of stages.slice(0, completedCount)) {
    const revision = await saveGenericStageContent(owner, {
      projectId,
      stageId: stage.id,
      expectedRevision: stage.revision,
      content:
        "DEMO ONLY: Example work recorded so the next stage can be inspected. No real approval or delivery occurred.",
    });
    await completeGenericProjectStage(owner, {
      projectId,
      stageId: stage.id,
      expectedRevision: revision,
    });
  }
}

async function seed() {
  const existing = await prisma.$queryRaw<
    Array<{ value: string }>
  >`SELECT value FROM flux_demo_meta.state WHERE key='seed-version'`;
  if (existing.length) {
    console.log(
      `Existing demo fixtures v${existing[0].value} retained. Your QA changes were not reseeded.`,
    );
    return;
  }
  assert.equal(
    await prisma.user.count(),
    0,
    "Unrecognized or partially seeded demo database. Run pnpm demo:reset explicitly.",
  );
  for (const user of fixtures.users)
    await prisma.user.create({
      data: {
        ...user,
        role: user.role as UserRole,
        passwordHash: hashAuthPassword(fixtures.password),
        projectCreationAccessGranted: user.id === owner.id,
        templateManagementAccessGranted: user.id === director.id,
        department: "Fictional QA Department",
        bio: "Public fake demo account. Never use for real work.",
      },
    });

  const inquiry = await create(
    "PACKAGING",
    "Paper Moon carton — inquiry",
    "Stage 1 active; try autosave and inspect locked stages.",
  );
  const concepts = await create(
    "PACKAGING",
    "Paper Moon carton — concept tasks",
    "Stages 1–2 completed by the demo fixture; Stage 3 active with an assigned Executor task.",
  );
  for (const project of [inquiry, concepts])
    await prisma.projectInquiry.create({
      data: {
        projectId: project.id,
        initialBrief:
          "<p>DEMO ONLY: Explore a fictional Paper Moon carton. This is not a production brief.</p>",
        businessObjectives:
          "<p>Practice inquiry editing, task ownership and stage progression.</p>",
        legalNotes:
          "Fictional scenario. No regulatory or legal requirements are represented.",
        inquiryDate: new Date(),
        priority: "MEDIUM",
        deliverables: {
          create: {
            label: "Fictional carton concept",
            normalizedLabel: "fictional carton concept",
          },
        },
      },
    });
  // Fixture-only staging, explicitly audited. Existing Packaging services and
  // their transactional snapshot trigger are left unchanged.
  const completedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.projectWorkflowStage.updateMany({
      where: {
        projectId: concepts.id,
        stageKey: { in: ["PROJECT_INQUIRY", "PROJECT_RESEARCH_AND_PLANNING"] },
      },
      data: { status: "COMPLETED", unlockedAt: completedAt, completedAt },
    });
    await tx.projectWorkflowStage.updateMany({
      where: { projectId: concepts.id, stageKey: "CONCEPT_CREATION" },
      data: { status: "AVAILABLE", unlockedAt: completedAt },
    });
    await tx.projectStructureEvent.create({
      data: {
        projectId: concepts.id,
        actorId: owner.id,
        action: "DEMO_FIXTURE_SETUP",
        reason: "Seeded fake Stage 3 scenario; no real business approvals",
        details: { completedStages: [1, 2] },
      },
    });
  });
  const task = await createProjectConceptFolder(owner, {
    projectId: concepts.id,
    stageKey: "CONCEPT_CREATION",
    name: "DEMO — Explore two carton directions",
    assignedExecutorId: "demo-executor",
    deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
    brief:
      "<p>FAKE QA TASK: Propose two imaginary carton directions. Try Tasker comments and completion without a file. Cloud uploads are disabled in Demo Mode.</p>",
  });
  assert("folder" in task, JSON.stringify(task));

  const posm = await create(
    "POSM",
    "Moonlight counter cards — research",
    "Stage 2 active after Brief completion.",
  );
  await progress(posm.id, 1);
  const retail = await create(
    "RETAIL",
    "Imaginary shop display — technical design",
    "Stage 4 active; earlier notes and later locked stages can be inspected.",
  );
  await progress(retail.id, 3);
  const exhibition = await create(
    "EXHIBITION",
    "Fictional Expo stand — event",
    "Stage 7 Event active; final wrap-up report remains locked.",
  );
  await progress(exhibition.id, 6);
  const digital = await create(
    "DIGITAL",
    "Paper Moon microsite — maintenance",
    "Maintenance Mode active; project stays open without a fixed end date.",
  );
  await progress(digital.id, 7);
  await saveGenericStageContent(owner, {
    projectId: digital.id,
    stageId: digital.stageInstances[7].id,
    expectedRevision: 1,
    content:
      "DEMO ONLY: The imaginary site is in Maintenance Mode. Future task handling is outside this phase.",
  });
  const finished = await create(
    "POSM",
    "Fictional launch cards — completed",
    "All six stages completed; inspect read-only notes and completed-project filters.",
  );
  await progress(finished.id, 6);

  const customStages = [
    {
      ...newStageDefinition("Agree the fictional brief"),
      stageType: "BRIEF" as const,
      goal: "DEMO: Agree the purpose of an imaginary campaign.",
      guidance: "DEMO: Add a short note describing the idea.",
      definitionOfDone: "DEMO: The owner is ready to proceed.",
    },
    {
      ...newStageDefinition("Optional peer review"),
      required: false,
      skippable: true,
    },
    newStageDefinition("Prepare the imaginary campaign"),
    { ...newStageDefinition("Wrap-up notes"), stageType: "REPORT" as const },
  ];
  await create(
    "CUSTOM",
    "Custom campaign — awaiting Director",
    "Draft structure: reorder, duplicate or remove stages; Director must approve before work begins.",
    customStages.slice(0, 3),
  );
  const custom = await create(
    "CUSTOM",
    "Custom campaign — approved and active",
    "Director-approved, Stage 2 optional/skippable; structural edits are locked after work begins.",
    customStages,
  );
  await approveCustomProjectStructure(director, custom.id, 1);
  await progress(custom.id, 1);

  await prisma.flexibleProject.create({
    data: {
      id: "demo-private-project",
      slug: "demo-private-planning",
      name: "[DEMO] Private planning notes",
      description:
        "Fictional private project for checking that separate milestones still work.",
      ownerId: owner.id,
      createdById: owner.id,
      collaborators: {
        create: { userId: "demo-collaborator", addedById: owner.id },
      },
      milestones: {
        create: [
          {
            name: "Draft a fake launch idea",
            sortOrder: 1,
            status: "COMPLETED",
            completedAt,
            completedById: owner.id,
            notes: {
              create: {
                authorId: owner.id,
                content: "DEMO ONLY: Initial imaginary idea captured.",
              },
            },
          },
          { name: "Review with the demo collaborator", sortOrder: 2 },
        ],
      },
    },
  });
  await prisma.$executeRaw`INSERT INTO flux_demo_meta.state (key,value) VALUES ('manifest',${JSON.stringify(manifest)})`;
  await prisma.$executeRaw`INSERT INTO flux_demo_meta.state (key,value) VALUES ('seed-version',${String(fixtures.version)})`;
  console.log(
    `Created ${fixtures.users.length} persistent demo users, ${manifest.length} structured projects and one Private Project.`,
  );
}

async function verify() {
  for (const fixture of fixtures.users) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.id },
    });
    assert(
      verifyAuthPassword(fixtures.password, user.passwordHash),
      `Demo login changed: ${fixture.email}`,
    );
    assert.equal(user.role, fixture.role);
  }
  assert(await canManageProjectTemplates(director));
  assert(!(await canManageProjectTemplates(owner)));
  const rows = await prisma.$queryRaw<
    Array<{ value: string }>
  >`SELECT value FROM flux_demo_meta.state WHERE key='manifest'`;
  const projects: DemoProject[] = JSON.parse(rows[0].value);
  assert.equal(projects.length, 9);
  for (const fixture of projects) {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: fixture.id },
      include: templateProjectInclude,
    });
    assert(canManageProjectStages(owner, project));
    assert(
      canManageProjectStages({ id: "demo-co-owner", role: "ADMIN" }, project),
    );
    assert(
      !canManageProjectStages({ id: "demo-executor", role: "USER" }, project),
    );
    assert(
      !canManageProjectStages(
        { id: "demo-collaborator", role: "USER" },
        project,
      ),
    );
    assert.equal(
      project.stageInstances.length,
      {
        PACKAGING: 8,
        POSM: 6,
        RETAIL: 7,
        EXHIBITION: 8,
        DIGITAL: 8,
        CUSTOM: fixture.name.includes("awaiting") ? 3 : 4,
      }[fixture.template],
    );
    if (fixture.template === "DIGITAL") {
      assert.equal(project.stageInstances.at(-1)?.status, "AVAILABLE");
      assert.equal(project.completedAt, null);
      assert.equal(project.endDate, null);
    }
  }
  assert.equal(
    await prisma.projectConceptFolder.count({
      where: { assignedExecutorId: "demo-executor" },
    }),
    1,
  );
  assert.equal(await prisma.flexibleProject.count(), 1);
  console.log(
    "Demo fixture verification passed: six logins, nine template projects, permissions, Tasker assignment, Maintenance and Private Project.",
  );
}

async function main() {
  await guard();
  await syncPermissionDefinitions();
  if (process.argv[2] === "verify") await verify();
  else await seed();
  const rows = await prisma.$queryRaw<
    Array<{ value: string }>
  >`SELECT value FROM flux_demo_meta.state WHERE key='manifest'`;
  if (rows.length) {
    const projects: DemoProject[] = JSON.parse(rows[0].value);
    writeFileSync(
      resolve(".demo/projects.json"),
      JSON.stringify(projects, null, 2),
    );
    for (const project of projects)
      console.log(
        `  ${project.name}: ${process.env.APP_URL}/projects/${project.id}`,
      );
  }
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Demo seeding failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

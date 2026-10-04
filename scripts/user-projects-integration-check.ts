import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectRevisionStatus,
  ProjectPriority,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import {
  createProjectConceptFolder,
  type ConceptWorkflowStageKey,
} from "../src/lib/project-concepts";
import { createProjectV2 } from "../src/lib/project-creation";
import { getDashboardSnapshot } from "../src/lib/dashboard";
import { prisma } from "../src/lib/prisma";
import { getProjectTypeSwitcherVisibility } from "../src/lib/projects";
import { getUserProjectWorkspace } from "../src/lib/user-project-workspace";
import { getUserProjectsList } from "../src/lib/user-projects";
import {
  getUserTasksPageData,
} from "../src/lib/user-tasks";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`USER Projects integration failed: ${message}`);
}

function isError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

async function unlockConceptWork(projectId: string) {
  const now = new Date();
  await prisma.projectWorkflowStage.updateMany({
    where: {
      projectId,
      stageKey: {
        in: [
          ProjectWorkflowStageKey.PROJECT_INQUIRY,
          ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
        ],
      },
    },
    data: {
      status: ProjectWorkflowStageStatus.COMPLETED,
      unlockedAt: now,
      completedAt: now,
    },
  });
  await prisma.projectWorkflowStage.update({
    where: {
      projectId_stageKey: {
        projectId,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      },
    },
    data: {
      status: ProjectWorkflowStageStatus.AVAILABLE,
      unlockedAt: now,
    },
  });
}

async function unlockFinalConceptWork(projectId: string) {
  const now = new Date();
  await prisma.projectWorkflowStage.update({
    where: {
      projectId_stageKey: {
        projectId,
        stageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      },
    },
    data: {
      status: ProjectWorkflowStageStatus.COMPLETED,
      unlockedAt: now,
      completedAt: now,
    },
  });
  await prisma.projectWorkflowStage.update({
    where: {
      projectId_stageKey: {
        projectId,
        stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
      },
    },
    data: {
      status: ProjectWorkflowStageStatus.AVAILABLE,
      unlockedAt: now,
    },
  });
}

async function createProject(input: {
  ownerId: string;
  name: string;
  executorIds: string[];
  collaboratorIds?: string[];
  description?: string;
  priority?: ProjectPriority;
}) {
  const result = await createProjectV2(
    { id: input.ownerId },
    {
      name: input.name,
      ownerId: input.ownerId,
      coOwnerIds: [],
      executorIds: input.executorIds,
      collaboratorIds: input.collaboratorIds ?? [],
    },
  );
  check(!isError(result), `project creation failed for ${input.name}`);
  await prisma.project.update({
    where: { id: result.projectId },
    data: {
      description: input.description ?? null,
      priority: input.priority ?? ProjectPriority.MEDIUM,
    },
  });
  await unlockConceptWork(result.projectId);
  return result.projectId;
}

async function createConcept(input: {
  owner: { id: string; role: UserRole };
  projectId: string;
  executorId: string;
  name: string;
  dueInDays: number;
  stageKey?: ConceptWorkflowStageKey;
}) {
  const attachmentId = randomUUID();
  await prisma.projectAttachment.create({
    data: {
      id: attachmentId,
      projectId: input.projectId,
      uploadedById: input.owner.id,
      fileName: `${attachmentId}.pdf`,
      originalFileName: `${input.name}-brief.pdf`,
      mimeType: "application/pdf",
      fileSize: 128,
      bucket: "user-projects-integration",
      storageKey: `user-projects/${attachmentId}.pdf`,
      assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
      status: AttachmentStatus.READY,
    },
  });

  const deadline = new Date(Date.now() + input.dueInDays * 24 * 60 * 60 * 1_000);
  const result = await createProjectConceptFolder(input.owner, {
    projectId: input.projectId,
    stageKey: input.stageKey ?? ProjectWorkflowStageKey.CONCEPT_CREATION,
    name: input.name,
    assignedExecutorId: input.executorId,
    deadline: deadline.toISOString(),
    brief: `${input.name} fixture brief`,
    briefAttachmentIds: [attachmentId],
  });
  check(!isError(result), `concept creation failed for ${input.name}`);
  return { ...result.folder, deadline };
}

async function setTaskState(input: {
  projectId: string;
  taskerStageId: string;
  executorId: string;
  state: "IN_PROGRESS" | "CHANGES_REQUESTED" | "WAITING_FOR_REVIEW" | "COMPLETED";
}) {
  const startedAt = new Date();
  await prisma.projectStage.update({
    where: { id: input.taskerStageId },
    data: {
      status:
        input.state === "COMPLETED" ? StageStatus.COMPLETED : StageStatus.ONGOING,
      actualStartedAt: startedAt,
      startedById: input.executorId,
      completedAt: input.state === "COMPLETED" ? startedAt : null,
    },
  });

  if (
    input.state === "CHANGES_REQUESTED" ||
    input.state === "WAITING_FOR_REVIEW"
  ) {
    await prisma.projectRevision.create({
      data: {
        projectId: input.projectId,
        stageId: input.taskerStageId,
        createdById: input.executorId,
        revisionNumber: 1,
        title: "Fixture revision 1",
        status:
          input.state === "CHANGES_REQUESTED"
            ? ProjectRevisionStatus.REJECTED
            : ProjectRevisionStatus.PENDING_REVIEW,
        rejectionReason:
          input.state === "CHANGES_REQUESTED"
            ? "<p>Please revise this task.</p>"
            : null,
      },
    });
  }
}

async function main() {
  const runId = randomUUID();
  const ids = {
    owner: `user-projects-owner-${runId}`,
    secondOwner: `user-projects-owner-two-${runId}`,
    userOne: `user-projects-user-one-${runId}`,
    userTwo: `user-projects-user-two-${runId}`,
    unrelated: `user-projects-unrelated-${runId}`,
  };
  const userIds = Object.values(ids);
  const projectIds: string[] = [];

  try {
    await prisma.user.createMany({
      data: [
        { id: ids.owner, email: `${ids.owner}@example.test`, passwordHash: "x", role: UserRole.ADMIN },
        { id: ids.secondOwner, email: `${ids.secondOwner}@example.test`, passwordHash: "x", role: UserRole.ADMIN },
        { id: ids.userOne, email: `${ids.userOne}@example.test`, passwordHash: "x", role: UserRole.USER },
        { id: ids.userTwo, email: `${ids.userTwo}@example.test`, passwordHash: "x", role: UserRole.USER },
        { id: ids.unrelated, email: `${ids.unrelated}@example.test`, passwordHash: "x", role: UserRole.USER },
      ],
    });

    const owner = { id: ids.owner, role: UserRole.ADMIN };
    const userOne = { id: ids.userOne, role: UserRole.USER };
    const userTwo = { id: ids.userTwo, role: UserRole.USER };

    const mixedProjectId = await createProject({
      ownerId: ids.owner,
      name: "USER Portfolio Alpha",
      description: "Assigned packaging concepts for USER 1.",
      priority: ProjectPriority.HIGH,
      executorIds: [ids.userOne, ids.userTwo],
    });
    projectIds.push(mixedProjectId);

    const conceptA = await createConcept({ owner, projectId: mixedProjectId, executorId: ids.userOne, name: "Concept A", dueInDays: 7 });
    const conceptB = await createConcept({ owner, projectId: mixedProjectId, executorId: ids.userOne, name: "Concept B", dueInDays: 3 });
    const conceptC = await createConcept({ owner, projectId: mixedProjectId, executorId: ids.userOne, name: "Concept C", dueInDays: 5 });
    const conceptD = await createConcept({ owner, projectId: mixedProjectId, executorId: ids.userTwo, name: "Concept D", dueInDays: 2 });

    await setTaskState({ projectId: mixedProjectId, taskerStageId: conceptA.taskerStageId, executorId: ids.userOne, state: "IN_PROGRESS" });
    await setTaskState({ projectId: mixedProjectId, taskerStageId: conceptB.taskerStageId, executorId: ids.userOne, state: "CHANGES_REQUESTED" });
    await setTaskState({ projectId: mixedProjectId, taskerStageId: conceptC.taskerStageId, executorId: ids.userOne, state: "WAITING_FOR_REVIEW" });
    await setTaskState({ projectId: mixedProjectId, taskerStageId: conceptD.taskerStageId, executorId: ids.userTwo, state: "COMPLETED" });

    const zeroTaskProjectId = await createProject({
      ownerId: ids.owner,
      name: "USER Zero Tasks",
      priority: ProjectPriority.LOW,
      executorIds: [ids.userTwo],
      collaboratorIds: [ids.userOne],
    });
    projectIds.push(zeroTaskProjectId);

    const completedProjectId = await createProject({
      ownerId: ids.owner,
      name: "USER Completed Work",
      priority: ProjectPriority.URGENT,
      executorIds: [ids.userOne],
    });
    projectIds.push(completedProjectId);
    const completedConcept = await createConcept({ owner, projectId: completedProjectId, executorId: ids.userOne, name: "Completed USER Task", dueInDays: 4 });
    await setTaskState({ projectId: completedProjectId, taskerStageId: completedConcept.taskerStageId, executorId: ids.userOne, state: "COMPLETED" });
    const completedAt = new Date();
    await prisma.projectWorkflowStage.updateMany({
      where: { projectId: completedProjectId },
      data: {
        status: ProjectWorkflowStageStatus.COMPLETED,
        unlockedAt: completedAt,
        completedAt,
      },
    });
    await prisma.projectStageInstance.updateMany({ where: { projectId: completedProjectId, retiredAt: null }, data: { status: "COMPLETED", unlockedAt: completedAt, completedAt } });
    await prisma.project.update({
      where: { id: completedProjectId },
      data: { completedAt },
    });

    const activeProjectId = await createProject({
      ownerId: ids.owner,
      name: "USER Active Work",
      priority: ProjectPriority.MEDIUM,
      executorIds: [ids.userOne],
    });
    projectIds.push(activeProjectId);
    await unlockFinalConceptWork(activeProjectId);
    const activeConcept = await createConcept({
      owner,
      projectId: activeProjectId,
      executorId: ids.userOne,
      name: "Active USER Task",
      dueInDays: 6,
      stageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
    });
    await setTaskState({ projectId: activeProjectId, taskerStageId: activeConcept.taskerStageId, executorId: ids.userOne, state: "IN_PROGRESS" });

    const unrelatedProjectId = await createProject({
      ownerId: ids.secondOwner,
      name: "UNRELATED USER Project",
      executorIds: [ids.userTwo],
    });
    projectIds.push(unrelatedProjectId);

    const all = await getUserProjectsList(
      { filter: "ALL", query: "", sort: "name-asc", page: 1 },
      userOne,
    );
    check(all.total === 4, "USER 1 must receive exactly four related projects");
    check(!all.projects.some((project) => project.id === unrelatedProjectId), "unrelated project leaked to USER 1");

    const prioritySorted = await getUserProjectsList(
      { filter: "ALL", query: "", sort: "priority", page: 1 },
      userOne,
    );
    check(
      prioritySorted.projects.map(({ id }) => id).join(",") ===
        [mixedProjectId, activeProjectId, zeroTaskProjectId, completedProjectId].join(","),
      "Priority sort must rank active High, Medium, and Low work before a completed Urgent project",
    );

    const userTasks = await getUserTasksPageData(userOne);
    const userDashboard = await getDashboardSnapshot(userOne);
    check(userTasks.summary.total === 5, "USER task page must include all five assigned concept taskers");
    check(userTasks.summary.open === 4, "USER task page open count is incorrect");
    check(userTasks.summary.needsAttention === 1, "USER task page attention count is incorrect");
    check(userTasks.summary.waitingForReview === 1, "USER task page review count is incorrect");
    check(userTasks.summary.completed === 1, "USER task page completed count is incorrect");
    check(
      userTasks.summary.needsAttention === userDashboard.attentionCount,
      "Dashboard and Tasks Needs Attention counts must match",
    );
    check(
      userTasks.attentionItems.map(({ id }) => id).join(",") ===
        userDashboard.attention.map(({ id }) => id).join(","),
      "Dashboard and Tasks must expose the same Needs Attention items",
    );
    check(userTasks.projects.length === 3, "USER task page must group assignments into three project folders");
    check(userTasks.projects[0]?.id === mixedProjectId, "project folder with changes requested must sort first");
    check(userTasks.projects.at(-1)?.id === completedProjectId, "completed project folder must sort last");
    const stageFourTask = userTasks.projects
      .flatMap(({ tasks }) => tasks)
      .find(({ id }) => id === activeConcept.id);
    check(stageFourTask?.stageNumber === 4, "Stage 4 executor task was not identified correctly");
    check(
      stageFourTask?.href.includes(`/stages/4/concepts/${activeConcept.id}?returnTo=%2Ftasks`),
      "Stage 4 task does not link directly to its workspace and back to Tasks",
    );
    const userTwoTasks = await getUserTasksPageData(userTwo);
    check(userTwoTasks.summary.total === 1, "USER task page leaked another executor's assignments");
    check((await getUserTasksPageData(owner)).summary.total === 0, "ADMIN accounts received the executor Tasks page data");

    const mixed = all.projects.find((project) => project.id === mixedProjectId);
    check(mixed, "mixed assignment project is missing");
    check(mixed.tasks.length === 3, "USER 1 task count must include exactly three assigned taskers");
    check(mixed.tasks.map((task) => task.name).join(",") === "Concept A,Concept B,Concept C", "USER 2 Concept D leaked into USER 1 task data");
    check(mixed.status === "NEEDS_ATTENTION", "changes requested must win project aggregation priority");
    check(mixed.tasks[0].display.status === "IN_PROGRESS", "in-progress task mapping is incorrect");
    check(mixed.tasks[1].display.status === "NEEDS_ATTENTION", "changes-requested task mapping is incorrect");
    check(mixed.tasks[2].display.status === "WAITING_FOR_REVIEW", "waiting-for-review task mapping is incorrect");
    check(mixed.dueAt === conceptB.deadline.toISOString(), "nearest active USER task deadline must be selected");

    const userTwoResult = await getUserProjectsList(
      { filter: "ALL", query: "USER Portfolio Alpha", sort: "updated", page: 1 },
      userTwo,
    );
    check(userTwoResult.projects[0]?.tasks.length === 1 && userTwoResult.projects[0]?.tasks[0]?.name === "Concept D", "USER 2 must receive only Concept D");
    check(userTwoResult.projects[0]?.tasks[0]?.display.status === "COMPLETED", "USER 2's completed assignment must remain completed");
    check(userTwoResult.projects[0]?.status === "IN_PROGRESS", "an active project must not be labeled completed when all of the USER's assignments are completed");

    const zeroTask = all.projects.find((project) => project.id === zeroTaskProjectId);
    check(zeroTask?.status === "NO_ASSIGNED_TASKS" && zeroTask.tasks.length === 0, "related zero-task project must remain neutral");

    const completed = await getUserProjectsList(
      { filter: "COMPLETED", query: "", sort: "updated", page: 1 },
      userOne,
    );
    check(completed.total === 1 && completed.projects[0]?.id === completedProjectId, "Completed filter must match the dashboard's completed project lifecycle");
    const finalWorkflow = await prisma.projectWorkflowStage.findUniqueOrThrow({
      where: {
        projectId_stageKey: {
          projectId: completedProjectId,
          stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
        },
      },
      select: { status: true },
    });
    check(finalWorkflow.status === ProjectWorkflowStageStatus.COMPLETED, "USER completed results must use the completed project workflow");

    const active = await getUserProjectsList(
      { filter: "ACTIVE", query: "", sort: "updated", page: 1 },
      userOne,
    );
    check(active.total === 3, "Active filter must return the same three active projects counted by the dashboard");
    check(active.projects.some((project) => project.id === activeProjectId), "Active filter must include unfinished non-urgent work");
    check(active.projects.some((project) => project.id === mixedProjectId), "Active filter must retain active projects that also need attention");
    check(active.projects.some((project) => project.id === zeroTaskProjectId), "Active filter must retain related active projects with no assigned concept task");
    check(!active.projects.some((project) => project.id === completedProjectId), "Active filter must exclude workflow-completed projects");

    const zeroTaskWorkspace = await getUserProjectWorkspace(zeroTaskProjectId, userOne);
    check(zeroTaskWorkspace?.project.id === zeroTaskProjectId, "a USER must be able to open an active related project even when it has no assigned concept task");

    const attention = await getUserProjectsList(
      { filter: "NEEDS_ATTENTION", query: "", sort: "updated", page: 1 },
      userOne,
    );
    check(attention.total === 1 && attention.projects[0]?.id === mixedProjectId, "Needs Attention filter is incorrect");

    const searched = await getUserProjectsList(
      { filter: "ALL", query: "packaging concepts", sort: "updated", page: 1 },
      userOne,
    );
    check(searched.total === 1 && searched.projects[0]?.id === mixedProjectId, "description search is incorrect");

    const descending = await getUserProjectsList(
      { filter: "ALL", query: "", sort: "name-desc", page: 1 },
      userOne,
    );
    check(descending.projects[0]?.title === "USER Zero Tasks", "Name Z–A sort is incorrect");

    const deniedAdminResult = await getUserProjectsList(
      { filter: "ALL", query: "", sort: "updated", page: 1 },
      owner,
    );
    check(deniedAdminResult.total === 0, "USER query helper must not serve the ADMIN management path");

    check(
      await getProjectTypeSwitcherVisibility(owner),
      "ADMIN must see the artwork/flexible project switcher",
    );
    check(
      !(await getProjectTypeSwitcherVisibility(userOne)),
      "an executor/collaborator must not see the artwork/flexible project switcher",
    );
    await prisma.projectCoOwner.create({
      data: {
        projectId: zeroTaskProjectId,
        userId: userOne.id,
        addedById: owner.id,
      },
    });
    check(
      await getProjectTypeSwitcherVisibility(userOne),
      "a project co-owner must see the artwork/flexible project switcher",
    );

    console.log("USER My Projects relationship, task-scope, filter, and status integration checks passed.");
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

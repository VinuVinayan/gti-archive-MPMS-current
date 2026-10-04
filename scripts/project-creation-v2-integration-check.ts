import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  UserRole,
} from "@prisma/client";

import { createProjectV2 } from "../src/lib/project-creation";
import { getNotificationsForUser } from "../src/lib/notification-center";
import { deriveProjectListWorkflowState } from "../src/lib/project-list-workflow";
import { hasProjectPermission } from "../src/lib/permissions/resolver";
import { prisma as servicePrisma } from "../src/lib/prisma";
import { updateManagedUserPermissions } from "../src/lib/user-permissions";

const prisma = new PrismaClient();
const runId = randomUUID();
const ids = {
  creator: `creator-sa-${runId}`,
  owner: `owner-admin-${runId}`,
  coOwner: `co-owner-${runId}`,
  executorA: `executor-a-${runId}`,
  executorB: `executor-b-${runId}`,
  collaboratorA: `collaborator-a-${runId}`,
  collaboratorB: `collaborator-b-${runId}`,
  otherSuperAdmin: `other-sa-${runId}`,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertValidationError(
  result: Awaited<ReturnType<typeof createProjectV2>>,
  field: "ownerId" | "coOwnerIds" | "executorIds" | "collaboratorIds",
) {
  assert("error" in result, `Expected ${field} validation to fail.`);
  assert(result.fieldErrors?.[field], `Expected a ${field} field error.`);
}

async function main() {
  await prisma.user.createMany({
    data: [
      {
        id: ids.creator,
        email: `${ids.creator}@example.test`,
        passwordHash: "x",
        role: UserRole.SUPER_ADMIN,
      },
      {
        id: ids.owner,
        email: `${ids.owner}@example.test`,
        passwordHash: "x",
        role: UserRole.ADMIN,
      },
      {
        id: ids.coOwner,
        email: `${ids.coOwner}@example.test`,
        passwordHash: "x",
        role: UserRole.ADMIN,
      },
      {
        id: ids.executorA,
        email: `${ids.executorA}@example.test`,
        passwordHash: "x",
        role: UserRole.USER,
      },
      {
        id: ids.executorB,
        email: `${ids.executorB}@example.test`,
        passwordHash: "x",
        role: UserRole.USER,
      },
      {
        id: ids.collaboratorA,
        email: `${ids.collaboratorA}@example.test`,
        passwordHash: "x",
        role: UserRole.USER,
      },
      {
        id: ids.collaboratorB,
        email: `${ids.collaboratorB}@example.test`,
        passwordHash: "x",
        role: UserRole.USER,
      },
      {
        id: ids.otherSuperAdmin,
        email: `${ids.otherSuperAdmin}@example.test`,
        passwordHash: "x",
        role: UserRole.SUPER_ADMIN,
      },
    ],
  });

  const success = await createProjectV2(
    { id: ids.creator },
    {
      name: "V2 collaborator integration success",
      ownerId: ids.owner,
      coOwnerIds: [ids.coOwner],
      executorIds: [ids.executorA, ids.executorB],
      collaboratorIds: [ids.collaboratorA, ids.collaboratorB, ids.collaboratorA],
    },
  );
  assert("projectId" in success, "Valid V2 creation must succeed.");

  const projectCountBeforeForgedUserCreate = await prisma.project.count();
  const forgedUserCreate = await createProjectV2(
    { id: ids.executorA },
    {
      name: "Forged USER project creation",
      ownerId: ids.creator,
      coOwnerIds: [],
      executorIds: [ids.executorB],
      collaboratorIds: [],
    },
  );
  assert(
    "error" in forgedUserCreate,
    "A USER must not create a project by calling the service directly.",
  );
  assert(
    (await prisma.project.count()) === projectCountBeforeForgedUserCreate,
    "A forged USER project creation attempt must not persist a project.",
  );

  const selectedProjectCreator = await updateManagedUserPermissions({
    userId: ids.executorA,
    role: UserRole.USER,
    projectCreationAccessGranted: true,
    archiveAccessLevel: "NONE",
    updatedById: ids.creator,
  });
  assert(
    selectedProjectCreator.projectCreationAccessGranted,
    "User Management must persist the selected USER Create Project grant.",
  );
  const selectedUserCreate = await createProjectV2(
    { id: ids.executorA },
    {
      name: "Selected USER project creation",
      ownerId: ids.creator,
      coOwnerIds: [],
      executorIds: [ids.executorB],
      collaboratorIds: [],
    },
  );
  assert(
    "projectId" in selectedUserCreate,
    "A USER explicitly granted Create Project access must create successfully.",
  );
  if ("projectId" in selectedUserCreate) {
    const selectedUserProject = await prisma.project.findUniqueOrThrow({
      where: { id: selectedUserCreate.projectId },
      select: { ownerId: true, createdById: true },
    });
    assert(
      selectedUserProject.ownerId === ids.executorA &&
        selectedUserProject.createdById === ids.executorA,
      "The selected USER must become the owner and creator of their project.",
    );
  }

  const created = await prisma.project.findUnique({
    where: { id: success.projectId },
    include: {
      coOwners: true,
      executors: true,
      collaborators: true,
      workflowStages: true,
      stages: true,
      researchWorkspaces: { include: { folders: true } },
      privateFolders: true,
    },
  });
  assert(created, "Created project must be persisted.");
  assert(
    created.createdById === ids.creator,
    "Creator audit identity must remain separate.",
  );
  assert(created.ownerId === ids.creator, "The project creator must be the fixed owner.");
  assert(
    !created.coOwners.some((item) => item.userId === ids.creator),
    "SUPER_ADMIN creator must not be a co-owner.",
  );
  assert(created.executors.length === 2, "Every executor assignment must persist.");
  assert(
    created.collaborators.length === 4,
    "Executors and additional collaborators must share one membership table.",
  );
  assert(
    new Set(created.collaborators.map((item) => item.userId)).size === 4,
    "Duplicate collaborator IDs must be normalized to one membership row.",
  );
  assert(
    !created.collaborators.some(
      (item) => item.userId === ids.creator || item.userId === ids.coOwner,
    ),
    "Owner and co-owner access must not require duplicate collaborator membership.",
  );
  const firstCollaborator = created.collaborators.find(
    (item) => item.userId === ids.collaboratorA,
  );
  const secondCollaborator = created.collaborators.find(
    (item) => item.userId === ids.collaboratorB,
  );
  assert(firstCollaborator, "First collaborator membership must exist.");
  assert(secondCollaborator, "Second collaborator membership must exist.");
  assert(
    firstCollaborator.canInteract &&
      !firstCollaborator.canAddCaptions &&
      !firstCollaborator.canDownloadFiles &&
      !firstCollaborator.canViewBudget &&
      !firstCollaborator.canViewVendorInfo &&
      !firstCollaborator.canAccessProjectArchives,
    "Project participants must receive the uniform explicit default grants.",
  );
  assert(
    secondCollaborator.canInteract &&
      !secondCollaborator.canViewBudget &&
      !secondCollaborator.canViewVendorInfo,
    "Every project participant must receive the same defaults.",
  );
  assert(
    !hasProjectPermission(
      {
        id: ids.collaboratorA,
        role: UserRole.USER,
      },
      created,
      "project.manageCollaborators",
    ),
    "Additional collaborator membership must not grant owner-level permissions.",
  );

  assert(created.stages.length === 0, "V2 creation must not create dynamic stages.");
  assert(
    created.workflowStages.length === 7,
    "V2 creation must create exactly seven fixed workflow rows.",
  );
  assert(
    created.workflowStages.find((stage) => stage.stageKey === "PROJECT_INQUIRY")
      ?.status === "AVAILABLE",
    "Stage 1 must start AVAILABLE.",
  );
  assert(
    created.workflowStages
      .filter((stage) => stage.stageKey !== "PROJECT_INQUIRY")
      .every((stage) => stage.status === "LOCKED"),
    "Stages 2-7 must start LOCKED.",
  );
  const createdWorkflowState = deriveProjectListWorkflowState(created);
  assert(
    createdWorkflowState.businessStatus === "ACTIVE" &&
      createdWorkflowState.workflowHealth === "VALID" &&
      createdWorkflowState.currentStageNumber === 1 &&
      createdWorkflowState.currentStageName === "Project Inquiry",
    "A newly created V2 project must immediately be Active at Stage 1.",
  );

  for (let currentStageNumber = 2; currentStageNumber <= 7; currentStageNumber += 1) {
    const activeWorkflowState = deriveProjectListWorkflowState({
      ...created,
      workflowStages: created.workflowStages.map((stage, index) => ({
        ...stage,
        status:
          index + 1 < currentStageNumber
            ? ProjectWorkflowStageStatus.COMPLETED
            : index + 1 === currentStageNumber
              ? ProjectWorkflowStageStatus.AVAILABLE
              : ProjectWorkflowStageStatus.LOCKED,
        unlockedAt: index + 1 <= currentStageNumber ? new Date() : null,
        completedAt: index + 1 < currentStageNumber ? new Date() : null,
      })),
    });
    assert(
      activeWorkflowState.businessStatus === "ACTIVE" &&
        activeWorkflowState.workflowHealth === "VALID" &&
        activeWorkflowState.currentStageNumber === currentStageNumber,
      `A valid Stage ${currentStageNumber} project must remain Active.`,
    );
  }

  const completedWorkflowState = deriveProjectListWorkflowState({
    ...created,
    completedAt: new Date(),
    workflowStages: created.workflowStages.map((stage) => ({
      ...stage,
      status: ProjectWorkflowStageStatus.COMPLETED,
      unlockedAt: new Date(),
      completedAt: new Date(),
    })),
  });
  assert(
    completedWorkflowState.businessStatus === "COMPLETED" &&
      completedWorkflowState.statusLabel === "Completed",
    "A completed V2 project must appear as Completed.",
  );

  const missingWorkflowState = deriveProjectListWorkflowState({
    ...created,
    workflowStages: [],
  });
  assert(
    missingWorkflowState.businessStatus === null &&
      missingWorkflowState.workflowHealth === "MISSING" &&
      missingWorkflowState.currentStageNumber === null,
    "A malformed legacy project must return a diagnostic instead of a business status.",
  );
  assert(
    created.researchWorkspaces.length === 1 &&
      created.researchWorkspaces[0].ownerUserId === created.ownerId,
    "A new project must create only the owner's canonical shared Stage 2 workspace.",
  );
  assert(
    created.researchWorkspaces.every(
      (workspace) =>
        workspace.folders.length === 7 &&
        new Set(workspace.folders.map((folder) => folder.systemKey)).size === 7,
    ),
    "The canonical Stage 2 workspace needs exactly seven unique predefined folders.",
  );
  assert(
    created.privateFolders.length === 6 &&
      new Set(created.privateFolders.map((folder) => folder.ownerUserId)).size === 6,
    "Every owner, co-owner, executor, and collaborator needs one private folder.",
  );
  assert(
    created.category === null &&
      created.description === null &&
      created.executionType === null &&
      created.budgetRequired === null &&
      created.currency === null &&
      created.priority === null &&
      created.startDate === null &&
      created.endDate === null &&
      created.stageCount === 8,
    "V2 creation must use its template count without fabricating business data.",
  );

  const notifications = await prisma.notification.findMany({
    where: { projectId: created.id },
  });
  assert(
    notifications.length === 5,
    "The non-creator co-owner, executors, and additional collaborators must each be notified once.",
  );
  assert(
    notifications.filter((item) => item.type === "COLLABORATOR_ADDED").length ===
      2,
    "Additional collaborators must receive COLLABORATOR_ADDED notifications.",
  );
  assert(
    notifications.every((item) => item.url === `/projects/${created.id}`),
    "Assignment notifications must use the role-aware project landing route.",
  );

  const legacyAssignmentNotifications = notifications.filter(
    (item) =>
      item.type === "PROJECT_ASSIGNED" ||
      item.type === "COLLABORATOR_ADDED" ||
      (item.type === "PROJECT_CREATED" && item.title === "Project assigned to you"),
  );
  const stageTwoActivatedAt = new Date();
  await prisma.projectWorkflowStage.update({
    where: {
      projectId_stageKey: {
        projectId: created.id,
        stageKey: ProjectWorkflowStageKey.PROJECT_INQUIRY,
      },
    },
    data: {
      status: ProjectWorkflowStageStatus.COMPLETED,
      completedAt: stageTwoActivatedAt,
    },
  });
  await prisma.projectWorkflowStage.update({
    where: {
      projectId_stageKey: {
        projectId: created.id,
        stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
      },
    },
    data: {
      status: ProjectWorkflowStageStatus.AVAILABLE,
      unlockedAt: stageTwoActivatedAt,
    },
  });
  await prisma.notification.updateMany({
    where: { id: { in: legacyAssignmentNotifications.map((item) => item.id) } },
    data: { url: `/projects/${created.id}/chat` },
  });
  for (const legacyNotification of legacyAssignmentNotifications) {
    const resolved = await getNotificationsForUser({
      userId: legacyNotification.userId,
      pageSize: 50,
    });
    assert(
      resolved.notifications.find((item) => item.id === legacyNotification.id)
        ?.targetHref === `/projects/${created.id}/stages/2`,
      "Existing project assignment notifications must resolve to active Stage 2 instead of Stage 3 chat.",
    );
  }

  const overlap = await createProjectV2(
    { id: ids.creator },
    {
      name: "V2 executor collaborator overlap",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [ids.executorA],
      collaboratorIds: [ids.executorA, ids.collaboratorA],
    },
  );
  assert("projectId" in overlap, "Executor/collaborator overlap must be accepted.");
  assert(
    (await prisma.projectCollaborator.count({
      where: { projectId: overlap.projectId },
    })) === 2,
    "Executor overlap must create one unified membership row per user.",
  );
  assert(
    (await prisma.notification.count({
      where: {
        projectId: overlap.projectId,
        userId: ids.executorA,
      },
    })) === 1,
    "An executor/collaborator overlap must receive only one assignment notification.",
  );
  assert(
    (await prisma.notification.count({
      where: {
        projectId: overlap.projectId,
        userId: ids.executorA,
        type: "COLLABORATOR_ADDED",
      },
    })) === 0,
    "Executor precedence must suppress a duplicate collaborator notification.",
  );

  const zeroCollaborators = await createProjectV2(
    { id: ids.creator },
    {
      name: "V2 zero collaborators",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [ids.executorB],
      collaboratorIds: [],
    },
  );
  assert("projectId" in zeroCollaborators, "Zero additional collaborators must work.");
  assert(
    (await prisma.projectCollaborator.count({
      where: { projectId: zeroCollaborators.projectId },
    })) === 1,
    "Zero additional collaborators must retain the executor membership behavior.",
  );

  const legacyFourFieldInput = await createProjectV2(
    { id: ids.creator },
    {
      name: "V2 omitted collaborators",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [ids.executorA],
    },
  );
  assert(
    "projectId" in legacyFourFieldInput,
    "Omitting the optional collaboratorIds field must preserve existing behavior.",
  );

  const projectCountBeforeValidation = await prisma.project.count();

  const duplicateExecutors = await createProjectV2(
    { id: ids.creator },
    {
      name: "Duplicate executors",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [ids.executorA, ids.executorA],
    },
  );
  assertValidationError(duplicateExecutors, "executorIds");

  const invalidUsers = await createProjectV2(
    { id: ids.creator },
    {
      name: "Invalid users",
      ownerId: "missing-owner",
      coOwnerIds: [],
      executorIds: ["missing-executor"],
      collaboratorIds: ["missing-collaborator"],
    },
  );
  assert("error" in invalidUsers, "Invalid user IDs must fail.");
  assert(
    invalidUsers.fieldErrors?.executorIds &&
      invalidUsers.fieldErrors?.collaboratorIds,
    "Invalid executor and collaborator IDs must be identified while submitted ownerId is ignored.",
  );

  const ineligibleCollaborator = await createProjectV2(
    { id: ids.creator },
    {
      name: "Ineligible collaborator role",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [ids.executorA],
      collaboratorIds: [ids.otherSuperAdmin],
    },
  );
  assertValidationError(ineligibleCollaborator, "collaboratorIds");

  const malformedCollaborator = await createProjectV2(
    { id: ids.creator },
    {
      name: "Malformed collaborator ID",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [ids.executorA],
      collaboratorIds: [42] as unknown as string[],
    },
  );
  assertValidationError(malformedCollaborator, "collaboratorIds");

  const ownerAsCoOwner = await createProjectV2(
    { id: ids.creator },
    {
      name: "Owner overlap",
      ownerId: ids.owner,
      coOwnerIds: [ids.creator],
      executorIds: [ids.executorA],
    },
  );
  assertValidationError(ownerAsCoOwner, "coOwnerIds");

  const noExecutors = await createProjectV2(
    { id: ids.creator },
    {
      name: "No executors",
      ownerId: ids.owner,
      coOwnerIds: [],
      executorIds: [],
    },
  );
  assert(
    "projectId" in noExecutors,
    "A self-managed project must be creatable without executors.",
  );
  if ("projectId" in noExecutors) {
    const selfManagedProject = await prisma.project.findUniqueOrThrow({
      where: { id: noExecutors.projectId },
      select: {
        executors: { select: { userId: true } },
        collaborators: { select: { userId: true } },
        workflowStages: { select: { stageKey: true, status: true } },
      },
    });
    assert(
      selfManagedProject.executors.length === 0 &&
        selfManagedProject.collaborators.length === 0,
      "A self-managed project must not fabricate executor or collaborator membership.",
    );
    assert(
      selfManagedProject.workflowStages.find(
        (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY,
      )?.status === ProjectWorkflowStageStatus.AVAILABLE,
      "A self-managed project must still begin at Stage 1.",
    );
  }

  const superAdminCoOwner = await createProjectV2(
    { id: ids.creator },
    {
      name: "SA co-owner",
      ownerId: ids.owner,
      coOwnerIds: [ids.otherSuperAdmin],
      executorIds: [ids.executorA],
    },
  );
  assertValidationError(superAdminCoOwner, "coOwnerIds");

  assert(
    (await prisma.project.count()) === projectCountBeforeValidation + 1,
    "Validation failures must not create partial projects beyond the valid self-managed project.",
  );

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_v2_notification_insert() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'forced notification failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_v2_notification_insert
    BEFORE INSERT ON "Notification"
    FOR EACH ROW EXECUTE FUNCTION fail_v2_notification_insert()
  `);

  let rollbackFailed = false;
  try {
    await createProjectV2(
      { id: ids.creator },
      {
        name: "Must roll back",
        ownerId: ids.owner,
        coOwnerIds: [ids.coOwner],
        executorIds: [ids.executorA],
        collaboratorIds: [ids.collaboratorA],
      },
    );
  } catch {
    rollbackFailed = true;
  }
  assert(rollbackFailed, "Forced notification failure must reach the transaction boundary.");
  assert(
    (await prisma.project.count({ where: { name: "Must roll back" } })) === 0,
    "A late transaction failure must roll back project, memberships, workflow, workspaces, and notifications.",
  );

  await prisma.$executeRawUnsafe(
    `DROP TRIGGER fail_v2_notification_insert ON "Notification"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION fail_v2_notification_insert()`);

  console.log("Project creation V2 final-role integration checks passed.");
}

main()
  .finally(async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_v2_notification_insert ON "Notification"`,
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS fail_v2_notification_insert()`,
    ).catch(() => undefined);
    await prisma.project.deleteMany({
      where: { createdById: { in: [ids.creator, ids.executorA] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
    await servicePrisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

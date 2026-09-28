import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import {
  createProjectV2,
  updateProjectV2,
} from "../src/lib/project-creation";
import {
  assertProjectPrivateAttachmentAccess,
  completeProjectPrivateFileUpload,
  deleteProjectPrivateFile,
  ensureProjectPrivateFoldersForProject,
  getProjectPrivateFileDownloadUrl,
  getProjectPrivateFilePreviewUrl,
  getProjectPrivateFolderPageData,
  requestProjectPrivateFileUpload,
} from "../src/lib/project-private-folders";
import {
  deleteAttachmentForUser,
  getAttachmentDownloadUrlForUser,
  getAttachmentPreviewUrlForUser,
  requestAttachmentUpload,
} from "../src/lib/project-history";
import {
  createProjectResearchFolder,
  getProjectResearchFolderPageData,
  getProjectResearchPageData,
} from "../src/lib/project-research";
import { completeProjectResearchFileUpload, requestProjectResearchFileUpload } from "../src/lib/project-research-files";
import { prisma } from "../src/lib/prisma";
import type { PermissionKey } from "../src/lib/permissions/definitions";
import { getUserProjectWorkspace } from "../src/lib/user-project-workspace";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`USER workspace integration failed: ${message}`);
  }
}

function isError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

async function expectDenied(operation: () => Promise<unknown>, message: string) {
  let denied = false;
  try {
    await operation();
  } catch (error) {
    denied = /permission|access|not found|read-only/i.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  check(denied, message);
}

async function unlockReferenceAndConceptWork(projectId: string) {
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

async function createConcept(input: {
  projectId: string;
  executorId: string;
  name: string;
  state: "IN_PROGRESS" | "CHANGES_REQUESTED" | "WAITING_FOR_REVIEW" | "COMPLETED";
}) {
  const stage = await prisma.projectStage.create({
    data: {
      projectId: input.projectId,
      name: `${input.name} tasker`,
      order: 1,
      isTasker: true,
      status:
        input.state === "COMPLETED" ? StageStatus.COMPLETED : StageStatus.ONGOING,
      actualStartedAt: new Date(),
      completedAt: input.state === "COMPLETED" ? new Date() : null,
      plannedDueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000),
      startedById: input.executorId,
    },
  });
  const folder = await prisma.projectConceptFolder.create({
    data: {
      projectId: input.projectId,
      workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
      taskerStageId: stage.id,
      assignedExecutorId: input.executorId,
      name: input.name,
      normalizedName: input.name.toLocaleLowerCase("en-US"),
      sortOrder: 1,
    },
  });

  if (
    input.state === "CHANGES_REQUESTED" ||
    input.state === "WAITING_FOR_REVIEW"
  ) {
    await prisma.projectRevision.create({
      data: {
        projectId: input.projectId,
        stageId: stage.id,
        createdById: input.executorId,
        revisionNumber: 1,
        title: `${input.name} revision`,
        status:
          input.state === "CHANGES_REQUESTED"
            ? ProjectRevisionStatus.REJECTED
            : ProjectRevisionStatus.PENDING_REVIEW,
        rejectionReason:
          input.state === "CHANGES_REQUESTED" ? "Please revise." : null,
      },
    });
  }

  return folder;
}

async function main() {
  process.env.AWS_REGION ||= "us-east-1";
  process.env.AWS_ACCESS_KEY_ID ||= "user-workspace-test";
  process.env.AWS_SECRET_ACCESS_KEY ||= "user-workspace-test-secret";
  process.env.AWS_S3_BUCKET ||= "user-workspace-integration";
  process.env.S3_USE_ACCELERATE_ENDPOINT ||= "false";

  const runId = randomUUID();
  const users = {
    owner: {
      id: `workspace-owner-${runId}`,
      email: `workspace-owner-${runId}@example.test`,
      name: "Workspace Owner",
      role: UserRole.ADMIN,
    },
    coOwner: {
      id: `workspace-co-owner-${runId}`,
      email: `workspace-co-owner-${runId}@example.test`,
      name: "Workspace Co Owner",
      role: UserRole.ADMIN,
    },
    userOne: {
      id: `workspace-user-one-${runId}`,
      email: `workspace-user-one-${runId}@example.test`,
      name: "Workspace User One",
      role: UserRole.USER,
    },
    userTwo: {
      id: `workspace-user-two-${runId}`,
      email: `workspace-user-two-${runId}@example.test`,
      name: "Workspace User Two",
      role: UserRole.USER,
    },
    collaborator: {
      id: `workspace-collaborator-${runId}`,
      email: `workspace-collaborator-${runId}@example.test`,
      name: "Workspace Collaborator",
      role: UserRole.USER,
    },
    superAdmin: {
      id: `workspace-super-${runId}`,
      email: `workspace-super-${runId}@example.test`,
      name: "Workspace Super Admin",
      role: UserRole.SUPER_ADMIN,
    },
  };
  const userIds = Object.values(users).map((user) => user.id);
  const projectIds: string[] = [];

  try {
    await prisma.user.createMany({
      data: Object.values(users).map((user) => ({
        ...user,
        passwordHash: "x",
      })),
    });

    const created = await createProjectV2(
      { id: users.owner.id },
      {
        name: "USER Stage Neutral Workspace",
        ownerId: users.owner.id,
        coOwnerIds: [users.coOwner.id],
        executorIds: [users.userOne.id, users.userTwo.id],
        collaboratorIds: [users.collaborator.id],
      },
    );
    check(!isError(created), "project creation must succeed");
    const projectId = created.projectId;
    projectIds.push(projectId);
    await unlockReferenceAndConceptWork(projectId);

    const privateFolders = await prisma.projectPrivateFolder.findMany({
      where: { projectId },
      orderBy: { ownerUserId: "asc" },
    });
    check(privateFolders.length === 5, "every distinct participant must get one private folder");
    check(privateFolders.some((folder) => folder.ownerUserId === users.owner.id), "owner ADMIN private folder is missing");
    check(privateFolders.some((folder) => folder.ownerUserId === users.coOwner.id), "co-owner ADMIN private folder is missing");
    check(privateFolders.some((folder) => folder.ownerUserId === users.userOne.id), "executor USER private folder is missing");
    check(privateFolders.some((folder) => folder.ownerUserId === users.userTwo.id), "second executor USER private folder is missing");
    check(privateFolders.some((folder) => folder.ownerUserId === users.collaborator.id), "project collaborator USER private folder is missing");
    await ensureProjectPrivateFoldersForProject(projectId);
    await ensureProjectPrivateFoldersForProject(projectId);
    check(
      (await prisma.projectPrivateFolder.count({ where: { projectId } })) === 5,
      "idempotent synchronization must not create duplicate private folders",
    );

    const ownerWorkspace = await prisma.projectResearchWorkspace.findUniqueOrThrow({
      where: {
        projectId_ownerUserId: { projectId, ownerUserId: users.owner.id },
      },
      include: { folders: true },
    });
    const ownerBrief = ownerWorkspace.folders.find(
      (folder) => folder.systemKey === "BRIEF",
    );
    const ownerTech = ownerWorkspace.folders.find(
      (folder) => folder.systemKey === "TECH",
    );
    const ownerMarket = ownerWorkspace.folders.find(
      (folder) => folder.systemKey === "MARKET_COMPETITION",
    );
    check(ownerBrief && ownerTech && ownerMarket, "canonical owner research folders are missing");

    const sharedAttachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        uploadedById: users.owner.id,
        fileName: "canonical-brief.pdf",
        originalFileName: "canonical-brief.pdf",
        mimeType: "application/pdf",
        fileSize: 256,
        bucket: "workspace-integration",
        storageKey: `workspace-integration/${runId}/brief.pdf`,
        assetType: AttachmentAssetType.PROJECT_RESEARCH_FILE,
        status: AttachmentStatus.READY,
      },
    });
    await prisma.projectResearchFolderFile.create({
      data: {
        folderId: ownerBrief.id,
        attachmentId: sharedAttachment.id,
        addedById: users.owner.id,
      },
    });

    const sharedBriefPage = await getProjectResearchFolderPageData(users.userOne, {
      projectId,
      folderId: ownerBrief.id,
    });
    const sharedTechPage = await getProjectResearchFolderPageData(users.userOne, {
      projectId,
      folderId: ownerTech.id,
    });
    check(sharedBriefPage?.files.length === 1 && sharedBriefPage.canUpload && sharedBriefPage.canWrite === false, "USER must be able to upload into Brief while management stays restricted");
    check(sharedTechPage?.canUpload && sharedTechPage.canWrite === false, "USER must be able to upload into Tech while management stays restricted");
    check(
      (await getProjectResearchFolderPageData(users.userOne, {
        projectId,
        folderId: ownerMarket.id,
      })) === null,
      "USER must not read canonical owner Market folder",
    );
    check(
      (await getProjectResearchPageData(users.userOne, projectId)) === null,
      "USER must not regain the editable participant research workspace",
    );
    check(
      Boolean(await getProjectResearchPageData(users.owner, projectId)),
      "ADMIN research workspace must remain available",
    );
    const sharedUpload = await requestProjectResearchFileUpload(users.userOne, {
      projectId, folderId: ownerTech.id, originalFileName: "shared.pdf", mimeType: "application/pdf", fileSize: 128,
    });
    check(!isError(sharedUpload), "USER must prepare a shared Tech upload");
    const sharedFile = await completeProjectResearchFileUpload(users.userOne, { projectId, folderId: ownerTech.id, attachmentId: sharedUpload.attachmentId });
    check(sharedFile?.uploadedBy === users.userOne.name, "Shared upload response must show the user's full name");
    check((await getProjectResearchFolderPageData(users.userTwo, { projectId, folderId: ownerTech.id }))?.files[0].uploadedBy === users.userOne.name, "Other participants must see the full uploader name");
    const forbiddenFolder = await createProjectResearchFolder(users.userOne, {
      projectId,
      name: "Forbidden USER Folder",
    });
    check(isError(forbiddenFolder), "USER folder creation in research must be denied");

    const conceptA = await createConcept({
      projectId,
      executorId: users.userOne.id,
      name: "Concept A",
      state: "IN_PROGRESS",
    });
    await createConcept({
      projectId,
      executorId: users.userOne.id,
      name: "Concept B",
      state: "CHANGES_REQUESTED",
    });
    await createConcept({
      projectId,
      executorId: users.userOne.id,
      name: "Concept C",
      state: "WAITING_FOR_REVIEW",
    });
    await createConcept({
      projectId,
      executorId: users.userTwo.id,
      name: "Concept D",
      state: "COMPLETED",
    });

    const workflowBefore = await prisma.projectWorkflowStage.findMany({
      where: { projectId },
      orderBy: { stageKey: "asc" },
      select: { stageKey: true, status: true, completedAt: true, unlockedAt: true },
    });
    const workspace = await getUserProjectWorkspace(projectId, users.userOne);
    check(workspace, "related USER must receive the stage-neutral workspace");
    const listOnlyPermissions = new Set<PermissionKey>(["project.list"]);
    check(
      (await getUserProjectWorkspace(projectId, {
        ...users.userOne,
        permissionProfileSnapshot: {
          effectivePermissions: listOnlyPermissions,
          rolePermissions: listOnlyPermissions,
          archiveAccessGranted: false,
          archiveAccessLevel: "NONE",
        },
      })) === null,
      "project.list must not expose the USER project workspace when project.view is disabled",
    );
    check(workspace.sharedFolders.map((folder) => folder.name).join(",") === "Brief,Tech", "workspace must expose exactly Brief and Tech");
    check(workspace.sharedFolders.every((folder) => folder.canUpload), "USER workspace cards must advertise upload access");
    check(workspace.sharedFolders[0]?.fileCount === 1, "canonical Brief file count is incorrect");
    check(workspace.assignedConcepts.length === 3, "only USER One assigned concepts must be returned");
    check(!workspace.assignedConcepts.some((concept) => concept.name === "Concept D"), "another USER's concept leaked");
    check(workspace.assignedConcepts[0]?.display.status === "NEEDS_ATTENTION", "Needs Attention concepts must sort first");
    check(workspace.assignedConcepts.some((concept) => concept.id === conceptA.id && concept.display.status === "IN_PROGRESS"), "In Progress status must reuse the USER task helper");
    check(
      workspace.classifiedFolders.length === 0 &&
        !workspace.canViewClassifiedFolders,
      "an executor must receive only their own private folder",
    );
    check(workspace.myPrivateFolder, "current USER private folder must be available");
    const collaboratorWorkspace = await getUserProjectWorkspace(
      projectId,
      users.collaborator,
    );
    check(
      collaboratorWorkspace?.myPrivateFolder &&
        collaboratorWorkspace.classifiedFolders.length === 0 &&
        !collaboratorWorkspace.canViewClassifiedFolders,
      "a collaborator must receive their own private folder without other participant placeholders",
    );
    const userRoleOwnerWorkspace = await getUserProjectWorkspace(projectId, {
      ...users.owner,
      role: UserRole.USER,
    });
    const userRoleCoOwnerWorkspace = await getUserProjectWorkspace(projectId, {
      ...users.coOwner,
      role: UserRole.USER,
    });
    check(
      userRoleOwnerWorkspace?.canViewClassifiedFolders &&
        userRoleOwnerWorkspace.classifiedFolders.length === 4,
      "a project owner must retain the classified private-folder directory",
    );
    check(
      userRoleCoOwnerWorkspace?.canViewClassifiedFolders &&
        userRoleCoOwnerWorkspace.classifiedFolders.length === 4,
      "a project co-owner must retain the classified private-folder directory",
    );
    const workflowAfter = await prisma.projectWorkflowStage.findMany({
      where: { projectId },
      orderBy: { stageKey: "asc" },
      select: { stageKey: true, status: true, completedAt: true, unlockedAt: true },
    });
    check(JSON.stringify(workflowAfter) === JSON.stringify(workflowBefore), "loading the USER workspace must not change workflow locks");

    const ownFolder = privateFolders.find(
      (folder) => folder.ownerUserId === users.userOne.id,
    );
    const ownerPrivateFolder = privateFolders.find(
      (folder) => folder.ownerUserId === users.owner.id,
    );
    check(ownFolder && ownerPrivateFolder, "private folder fixtures are missing");

    const prepared = await requestProjectPrivateFileUpload(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      originalFileName: "private-notes.pdf",
      mimeType: "application/pdf",
      fileSize: 512,
    });
    check(!isError(prepared), "private-folder owner must prepare an upload");
    const completedPrivate = await completeProjectPrivateFileUpload(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      attachmentId: prepared.attachmentId,
    });
    check(completedPrivate?.name === "private-notes.pdf", "private upload must complete in the exact folder");
    const rejectedUnmarkedTextFile = await requestProjectPrivateFileUpload(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      originalFileName: "private-notes.txt",
      mimeType: "text/plain",
      fileSize: 24,
    });
    check(isError(rejectedUnmarkedTextFile), "ordinary private uploads must not bypass the asset allowlist by using .txt");
    const preparedTextFile = await requestProjectPrivateFileUpload(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      originalFileName: "private-notes.txt",
      mimeType: "text/plain",
      fileSize: 24,
      createdTextFile: true,
    });
    check(!isError(preparedTextFile), "New Text File must prepare a validated private .txt upload");
    const completedTextFile = await completeProjectPrivateFileUpload(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      attachmentId: preparedTextFile.attachmentId,
    });
    check(completedTextFile?.name === "private-notes.txt", "New Text File must complete in the exact private folder");
    check((await getProjectPrivateFolderPageData(users.userOne, { projectId, folderId: ownFolder.id })).files.length === 2, "private uploads and created text files must appear in the file browser dataset");
    check((await getProjectPrivateFilePreviewUrl(users.userOne, { projectId, folderId: ownFolder.id, fileId: prepared.attachmentId })).length > 0, "own private preview must be authorized");
    check((await getProjectPrivateFileDownloadUrl(users.userOne, { projectId, folderId: ownFolder.id, fileId: prepared.attachmentId })).length > 0, "own private download must be authorized");
    check((await getAttachmentPreviewUrlForUser(users.userOne, prepared.attachmentId)).length > 0, "generic attachment preview must honor private ownership");
    check((await getAttachmentDownloadUrlForUser(users.userOne, prepared.attachmentId)).length > 0, "generic attachment download must honor private ownership");

    await expectDenied(
      () => assertProjectPrivateAttachmentAccess(users.userTwo, prepared.attachmentId),
      "another USER must not read a private attachment",
    );
    await expectDenied(
      () => assertProjectPrivateAttachmentAccess(users.owner, prepared.attachmentId),
      "ADMIN must not override USER private ownership",
    );
    await expectDenied(
      () => assertProjectPrivateAttachmentAccess(users.superAdmin, prepared.attachmentId),
      "SUPER_ADMIN must not override private ownership",
    );
    await expectDenied(
      () => getAttachmentPreviewUrlForUser(users.owner, prepared.attachmentId),
      "attachment-ID preview manipulation by ADMIN must be denied",
    );
    await expectDenied(
      () => deleteAttachmentForUser(users.owner, prepared.attachmentId),
      "attachment-ID deletion manipulation by ADMIN must be denied",
    );

    const adminPrivateAttachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        privateFolderId: ownerPrivateFolder.id,
        uploadedById: users.owner.id,
        fileName: "owner-private.pdf",
        originalFileName: "owner-private.pdf",
        mimeType: "application/pdf",
        fileSize: 128,
        bucket: "workspace-integration",
        storageKey: `projects/${projectId}/private/${ownerPrivateFolder.id}/owner-private.pdf`,
        assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
        status: AttachmentStatus.READY,
      },
    });
    await expectDenied(
      () => assertProjectPrivateAttachmentAccess(users.userOne, adminPrivateAttachment.id),
      "USER must not read ADMIN private files",
    );
    check(
      Boolean(
        await assertProjectPrivateAttachmentAccess(
          users.owner,
          adminPrivateAttachment.id,
        ),
      ),
      "ADMIN must retain access to their own private file",
    );

    const secondCreated = await createProjectV2(
      { id: users.owner.id },
      {
        name: "USER Workspace Cross Project",
        ownerId: users.owner.id,
        coOwnerIds: [],
        executorIds: [users.userOne.id],
        collaboratorIds: [],
      },
    );
    check(!isError(secondCreated), "cross-project fixture creation must succeed");
    projectIds.push(secondCreated.projectId);
    await expectDenied(
      () =>
        getProjectPrivateFolderPageData(users.userOne, {
          projectId: secondCreated.projectId,
          folderId: ownFolder.id,
        }),
      "cross-project private folder substitution must be denied",
    );

    const genericPrivateUpload = await requestAttachmentUpload(users.userOne, {
      projectId,
      originalFileName: "orphan.pdf",
      mimeType: "application/pdf",
      fileSize: 64,
      assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
    });
    check(isError(genericPrivateUpload), "generic upload endpoint must reject private assets");

    await deleteProjectPrivateFile(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      fileId: prepared.attachmentId,
    });
    await deleteProjectPrivateFile(users.userOne, {
      projectId,
      folderId: ownFolder.id,
      fileId: preparedTextFile.attachmentId,
    });
    check(
      (await prisma.projectAttachment.findUniqueOrThrow({
        where: { id: prepared.attachmentId },
      })).status === AttachmentStatus.DELETED,
      "private owner delete must mark the attachment deleted",
    );

    const removedUserFolder = privateFolders.find(
      (folder) => folder.ownerUserId === users.collaborator.id,
    );
    check(removedUserFolder, "collaborator private folder is missing");
    const removedUserAttachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        privateFolderId: removedUserFolder.id,
        uploadedById: users.collaborator.id,
        fileName: "preserved-private.pdf",
        originalFileName: "preserved-private.pdf",
        mimeType: "application/pdf",
        fileSize: 64,
        bucket: "workspace-integration",
        storageKey: `projects/${projectId}/private/${removedUserFolder.id}/preserved-private.pdf`,
        assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
        status: AttachmentStatus.READY,
      },
    });

    const updated = await updateProjectV2(users.owner, projectId, {
      name: "USER Stage Neutral Workspace",
      ownerId: users.owner.id,
      coOwnerIds: [users.coOwner.id],
      executorIds: [users.userOne.id, users.userTwo.id],
      collaboratorIds: [],
    });
    check(!isError(updated), "membership removal update must succeed");
    check(
      Boolean(
        await prisma.projectPrivateFolder.findFirst({
          where: { projectId, ownerUserId: users.collaborator.id, parentFolderId: null },
        }),
      ),
      "member removal must preserve the historical private folder",
    );
    check(
      Boolean(
        await prisma.projectAttachment.findUnique({
          where: { id: removedUserAttachment.id },
        }),
      ),
      "membership changes must not silently delete private data",
    );
    await expectDenied(
      () =>
        getProjectPrivateFolderPageData(users.collaborator, {
          projectId,
          folderId: removedUserFolder.id,
        }),
      "removed participant must lose normal private-folder access",
    );

    console.log(
      "USER workspace shared-folder, private ownership, lifecycle, concept isolation, and workflow-lock integration checks passed.",
    );
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

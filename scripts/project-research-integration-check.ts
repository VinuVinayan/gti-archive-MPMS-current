import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  UserRole,
} from "@prisma/client";

import { createProjectV2 } from "../src/lib/project-creation";
import { getProjectPrivateFolderPageData } from "../src/lib/project-private-folders";
import {
  completeProjectResearchStage,
  createProjectResearchFolder,
  ensureCanonicalProjectResearchWorkspace,
  getProjectResearchFolderPageData,
  getProjectResearchPageData,
  PROJECT_RESEARCH_SYSTEM_FOLDERS,
} from "../src/lib/project-research";
import {
  completeProjectResearchFileUpload,
  deleteProjectResearchFile,
  deleteProjectResearchFolder,
  getProjectResearchFileDownloadUrl,
  requestProjectResearchFileUpload,
} from "../src/lib/project-research-files";
import {
  normalizeProjectResearchTextFileName,
  validatePreparedProjectResearchTextFile,
  validateProjectResearchTextContent,
} from "../src/lib/project-research-text-file";
import { prisma } from "../src/lib/prisma";
import { completeAttachmentUpload, deleteAttachmentForUser } from "../src/lib/project-history";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import { updateProjectCollaborators } from "../src/lib/projects";

let checkNumber = 0;

function check(condition: unknown, message: string): asserts condition {
  checkNumber += 1;
  if (!condition) throw new Error(`Check ${checkNumber} failed: ${message}`);
}

function expectError(result: unknown) {
  return Boolean(result && typeof result === "object" && "error" in result);
}

async function expectRejected(run: () => Promise<unknown>, message: string) {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  check(rejected, message);
}

const users = {
  superAdmin: {
    id: "research-super-admin",
    email: "research-super-admin@example.test",
    name: "Research Super Admin",
    role: UserRole.SUPER_ADMIN,
  },
  owner: {
    id: "research-owner",
    email: "research-owner@example.test",
    name: "Research Owner",
    role: UserRole.ADMIN,
  },
  coOwner: {
    id: "research-co-owner",
    email: "research-co-owner@example.test",
    name: "Research Co-owner",
    role: UserRole.ADMIN,
  },
  executor: {
    id: "research-executor",
    email: "research-executor@example.test",
    name: "Research Executor",
    role: UserRole.USER,
  },
  collaborator: {
    id: "research-collaborator",
    email: "research-collaborator@example.test",
    name: "Research Collaborator",
    role: UserRole.USER,
  },
  lateCollaborator: {
    id: "research-late-collaborator",
    email: "research-late@example.test",
    name: "Late Collaborator",
    role: UserRole.USER,
  },
  outsider: {
    id: "research-outsider",
    email: "research-outsider@example.test",
    name: "Research Outsider",
    role: UserRole.USER,
  },
  adminOutsider: {
    id: "research-admin-outsider",
    email: "research-admin-outsider@example.test",
    name: "Research Admin Outsider",
    role: UserRole.ADMIN,
  },
};

async function cleanupIntegrationFixtures() {
  const userIds = Object.values(users).map((user) => user.id);

  await prisma.project.deleteMany({
    where: {
      OR: [{ ownerId: { in: userIds } }, { createdById: { in: userIds } }],
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: userIds }, email: { endsWith: "@example.test" } },
  });
}

async function unlockStageTwo(projectId: string) {
  await prisma.projectWorkflowStage.updateMany({
    where: { projectId, stageKey: ProjectWorkflowStageKey.PROJECT_INQUIRY },
    data: { status: ProjectWorkflowStageStatus.COMPLETED, completedAt: new Date() },
  });
  await prisma.projectWorkflowStage.updateMany({
    where: {
      projectId,
      stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
    },
    data: { status: ProjectWorkflowStageStatus.AVAILABLE, unlockedAt: new Date() },
  });
}

async function mustCreateProject(name: string) {
  const result = await createProjectV2(
    { id: users.owner.id },
    {
      name,
      ownerId: users.owner.id,
      coOwnerIds: [users.coOwner.id],
      executorIds: [users.executor.id],
      collaboratorIds: [users.collaborator.id],
    },
  );
  check("projectId" in result, "new V2 project creation must succeed");
  await unlockStageTwo(result.projectId);
  return result.projectId;
}

async function mustCreateSelfManagedProject(name: string) {
  const result = await createProjectV2(
    { id: users.owner.id },
    {
      name,
      ownerId: users.owner.id,
      coOwnerIds: [],
      executorIds: [],
      collaboratorIds: [],
    },
  );
  check("projectId" in result, "self-managed V2 project creation must succeed");
  await unlockStageTwo(result.projectId);
  return result.projectId;
}

async function main() {
  process.env.AWS_REGION ||= "us-east-1";
  process.env.AWS_ACCESS_KEY_ID ||= "stage-two-test";
  process.env.AWS_SECRET_ACCESS_KEY ||= "stage-two-test-secret";
  process.env.AWS_S3_BUCKET ||= "stage-two-integration";
  process.env.S3_USE_ACCELERATE_ENDPOINT ||= "false";

  check("error" in normalizeProjectResearchTextFileName("   "), "empty text file names must fail");
  const textName = normalizeProjectResearchTextFileName("  Market research notes  ");
  check("fileName" in textName && textName.fileName === "Market research notes.txt", "text file names must be normalized");
  const multilineValidation = validateProjectResearchTextContent("Market findings\n\nUTF-8 café notes.");
  check("byteLength" in multilineValidation, "multiline UTF-8 text must validate");
  check(
    "error" in validatePreparedProjectResearchTextFile({ fileName: "unsafe", mimeType: "text/plain", fileSize: 10 }),
    "prepared text uploads must require a normalized .txt name",
  );

  await prisma.user.createMany({
    data: Object.values(users).map((user) => ({ ...user, passwordHash: "x" })),
  });

  const projectId = await mustCreateProject("Stage 2 canonical integration project");
  const initialWorkspaces = await prisma.projectResearchWorkspace.findMany({
    where: { projectId },
    include: { folders: { orderBy: { sortOrder: "asc" } } },
  });
  check(initialWorkspaces.length === 1, "new projects must create one research workspace");
  const canonicalWorkspace = initialWorkspaces[0];
  check(canonicalWorkspace.ownerUserId === users.owner.id, "the project owner's workspace must be canonical");
  check(canonicalWorkspace.folders.length === 7, "the canonical workspace must contain seven system folders");
  check(
    canonicalWorkspace.folders.map((folder) => folder.systemKey).join("|") ===
      PROJECT_RESEARCH_SYSTEM_FOLDERS.map((folder) => folder.key).join("|"),
    "canonical system folders must retain business order",
  );
  check(
    (await prisma.projectPrivateFolder.count({ where: { projectId } })) === 4,
    "project creation must provision private folders for every initial participant",
  );

  await ensureCanonicalProjectResearchWorkspace(projectId);
  check(
    (await prisma.projectResearchWorkspace.count({ where: { projectId } })) === 1 &&
      (await prisma.projectResearchFolder.count({ where: { workspaceId: canonicalWorkspace.id } })) === 7,
    "ensuring the canonical workspace must be idempotent",
  );

  await updateProjectCollaborators(
    projectId,
    [
      { id: users.executor.id },
      { id: users.collaborator.id },
      { id: users.lateCollaborator.id },
    ],
    users.owner,
  );
  check(
    Boolean(
      await prisma.projectPrivateFolder.findFirst({
        where: { projectId, ownerUserId: users.lateCollaborator.id, parentFolderId: null },
      }),
    ),
    "adding a project collaborator must provision their private folder",
  );
  check(
    !(await prisma.projectResearchWorkspace.findUnique({
      where: {
        projectId_ownerUserId: { projectId, ownerUserId: users.lateCollaborator.id },
      },
    })),
    "adding a project collaborator must not create another research workspace",
  );

  const historicalWorkspace = await prisma.projectResearchWorkspace.create({
    data: {
      projectId,
      ownerUserId: users.executor.id,
      folders: {
        create: {
          name: "Historical Participant Research",
          normalizedName: "historical participant research",
          isSystem: false,
          createdById: users.executor.id,
        },
      },
    },
    include: { folders: true },
  });
  const historicalFolder = historicalWorkspace.folders[0];
  const historicalAttachment = await prisma.projectAttachment.create({
    data: {
      projectId,
      uploadedById: users.executor.id,
      fileName: "historical-private-notes.txt",
      originalFileName: "historical-private-notes.txt",
      mimeType: "text/plain",
      fileSize: 19,
      bucket: "stage-two-integration",
      storageKey: `historical/${projectId}/participant-notes.txt`,
      assetType: AttachmentAssetType.PROJECT_RESEARCH_FILE,
      status: AttachmentStatus.READY,
    },
  });
  const historicalFile = await prisma.projectResearchFolderFile.create({
    data: {
      folderId: historicalFolder.id,
      attachmentId: historicalAttachment.id,
      addedById: users.executor.id,
    },
  });

  const ownerPage = await getProjectResearchPageData(users.owner, projectId);
  const coOwnerPage = await getProjectResearchPageData(users.coOwner, projectId);
  const superAdminPage = await getProjectResearchPageData(users.superAdmin, projectId);
  const outsideAdminPage = await getProjectResearchPageData(users.adminOutsider, projectId);
  check(
    [ownerPage, coOwnerPage, superAdminPage, outsideAdminPage].every(
      (page) => page?.sharedWorkspace.id === canonicalWorkspace.id,
    ),
    "ADMIN, co-owner ADMIN, and SUPER_ADMIN must all load the same canonical workspace",
  );
  check(
    [ownerPage, coOwnerPage, superAdminPage, outsideAdminPage].every(
      (page) => page?.sharedWorkspace.canWrite,
    ),
    "business administrators must retain canonical shared-workspace management",
  );
  check(
    (await getProjectResearchPageData(users.executor, projectId)) === null &&
      (await getProjectResearchPageData(users.collaborator, projectId)) === null,
    "USER accounts must not receive editable Stage 2 landing data",
  );
  check(
    ownerPage?.myPrivateFolder?.href.includes("/workspace/private/") &&
      ownerPage.classifiedFolders.length === 4,
    "a participant ADMIN must receive their own private-folder link and classified placeholders",
  );
  check(
    superAdminPage?.myPrivateFolder === null && superAdminPage?.classifiedFolders.length === 5,
    "a non-participant SUPER_ADMIN must not receive a private folder",
  );
  check(
    ownerPage?.classifiedFolders.every(
      (folder) => Object.keys(folder).sort().join("|") === "key|ownerName|role",
    ),
    "classified placeholders must not expose folder or file metadata",
  );

  check(
    (await getProjectResearchFolderPageData(users.superAdmin, {
      projectId,
      folderId: historicalFolder.id,
    })) === null,
    "SUPER_ADMIN must not inspect a historical participant research folder",
  );
  check(
    (await getProjectResearchFolderPageData(users.executor, {
      projectId,
      folderId: historicalFolder.id,
    })) === null,
    "a historical workspace owner must not reopen it through normal routes",
  );
  await expectRejected(
    () =>
      getProjectResearchFileDownloadUrl(users.superAdmin, {
        projectId,
        folderId: historicalFolder.id,
        fileId: historicalFile.id,
      }),
    "historical participant research files must not be downloadable",
  );
  await expectRejected(
    () =>
      requestProjectResearchFileUpload(users.superAdmin, {
        projectId,
        folderId: historicalFolder.id,
        originalFileName: "blocked.txt",
        mimeType: "text/plain",
        fileSize: 1,
      }),
    "historical participant research folders must not accept uploads",
  );

  const ownerPrivateFolder = await prisma.projectPrivateFolder.findFirstOrThrow({
    where: { projectId, ownerUserId: users.owner.id, parentFolderId: null },
  });
  const coOwnerPrivateFolder = await prisma.projectPrivateFolder.findFirstOrThrow({
    where: { projectId, ownerUserId: users.coOwner.id, parentFolderId: null },
  });
  check(
    (await getProjectPrivateFolderPageData(users.owner, {
      projectId,
      folderId: ownerPrivateFolder.id,
    })).canWrite,
    "a participant ADMIN must manage their own private folder",
  );
  await expectRejected(
    () =>
      getProjectPrivateFolderPageData(users.owner, {
        projectId,
        folderId: coOwnerPrivateFolder.id,
      }),
    "an ADMIN must not inspect another participant's private folder",
  );
  await expectRejected(
    () =>
      getProjectPrivateFolderPageData(users.superAdmin, {
        projectId,
        folderId: ownerPrivateFolder.id,
      }),
    "SUPER_ADMIN must not inspect another participant's private folder",
  );

  const canonicalBrief = canonicalWorkspace.folders.find((folder) => folder.systemKey === "BRIEF")!;
  const canonicalTech = canonicalWorkspace.folders.find((folder) => folder.systemKey === "TECH")!;
  const canonicalMarket = canonicalWorkspace.folders.find((folder) => folder.systemKey === "MARKET_COMPETITION")!;
  const custom = await createProjectResearchFolder(users.adminOutsider, {
    projectId,
    name: "  Customer   Interviews ",
  });
  const customFolder = "folder" in custom ? custom.folder : null;
  check(customFolder?.name === "Customer Interviews", "custom shared folders must persist normalized names");
  check(
    expectError(await createProjectResearchFolder(users.owner, { projectId, name: "customer interviews" })),
    "custom shared folders must remain case-insensitively unique",
  );

  const briefUpload = await requestProjectResearchFileUpload(users.owner, {
    projectId,
    folderId: canonicalBrief.id,
    originalFileName: "brief.pdf",
    mimeType: "application/pdf",
    fileSize: 512,
  });
  check(!("error" in briefUpload), "ADMIN Brief upload must be prepared");
  if ("error" in briefUpload) throw new Error(String(briefUpload.error));
  const briefFile = await completeProjectResearchFileUpload(users.owner, {
    projectId,
    folderId: canonicalBrief.id,
    attachmentId: briefUpload.attachmentId,
  });
  check(briefFile?.name === "brief.pdf", "ADMIN Brief upload must complete");

  const techUpload = await requestProjectResearchFileUpload(users.adminOutsider, {
    projectId,
    folderId: canonicalTech.id,
    originalFileName: "technical-notes.txt",
    mimeType: "text/plain",
    fileSize: 256,
  });
  check(!("error" in techUpload), "ADMIN Tech upload must be prepared");
  if ("error" in techUpload) throw new Error(String(techUpload.error));
  const techFile = await completeProjectResearchFileUpload(users.adminOutsider, {
    projectId,
    folderId: canonicalTech.id,
    attachmentId: techUpload.attachmentId,
  });
  check(techFile?.name === "technical-notes.txt", "ADMIN Tech upload must complete");

  const briefPage = await getProjectResearchFolderPageData(users.owner, {
    projectId,
    folderId: canonicalBrief.id,
  });
  const userBriefPage = await getProjectResearchFolderPageData(users.executor, {
    projectId,
    folderId: canonicalBrief.id,
  });
  const userTechPage = await getProjectResearchFolderPageData(users.executor, {
    projectId,
    folderId: canonicalTech.id,
  });
  check(briefPage?.files.length === 1 && briefPage.canWrite, "canonical shared folders must remain manager-editable");
  check(
    userBriefPage?.files.length === 1 &&
      !userBriefPage.canWrite &&
      userBriefPage.canUpload &&
      userTechPage?.files.length === 1 &&
      !userTechPage.canWrite &&
      userTechPage.canUpload,
    "USER Brief and Tech allow uploads while folder management remains restricted",
  );
  const participantUploadInput = {
    projectId, folderId: canonicalBrief.id,
    originalFileName: "participant-reference.txt", mimeType: "text/plain", fileSize: 16,
  };
  for (const participant of [users.executor, users.collaborator]) {
    for (const folder of [canonicalBrief, canonicalTech]) {
      const prepared = await requestProjectResearchFileUpload(participant, { ...participantUploadInput, folderId: folder.id });
      check(!("error" in prepared), "Executors and collaborators must prepare uploads into both Brief and Tech");
      const completed = await completeProjectResearchFileUpload(participant, { projectId, folderId: folder.id, attachmentId: prepared.attachmentId });
      check(completed?.uploadedBy === participant.name, "Upload completion must return the uploader's full name");
      const reloaded = await getProjectResearchFolderPageData(users.owner, { projectId, folderId: folder.id });
      check(reloaded?.files.find((file) => file.id === completed.id)?.uploadedBy === participant.name, "Other users must see the uploader's full name after reloading");
      await expectRejected(() => deleteProjectResearchFile(participant, { projectId, folderId: folder.id, fileId: completed.id }), "Uploading must not grant file-deletion permission");
      await expectRejected(() => deleteAttachmentForUser(participant, completed.attachmentId), "The generic delete endpoint must retain management permissions");
    }
  }
  const techChild = await createProjectResearchFolder(users.owner, { projectId, parentFolderId: canonicalTech.id, name: "Technical References" });
  check("folder" in techChild && techChild.folder, "A manager must be able to create a Tech subfolder");
  const nestedUpload = await requestProjectResearchFileUpload(users.executor, { ...participantUploadInput, folderId: techChild.folder.id });
  check(!("error" in nestedUpload), "Tech subfolders inherit participant upload permission");
  check((await completeProjectResearchFileUpload(users.executor, { projectId, folderId: techChild.folder.id, attachmentId: nestedUpload.attachmentId }))?.uploadedBy === users.executor.name, "Nested uploads preserve the full uploader name");
  for (const folder of [canonicalMarket, customFolder]) {
    if (folder) await expectRejected(() => requestProjectResearchFileUpload(users.executor, { ...participantUploadInput, folderId: folder.id }), "Participant uploads must stay inside Brief and Tech");
  }
  await expectRejected(() => requestProjectResearchFileUpload(users.outsider, participantUploadInput), "Users outside the project must not upload into shared folders");
  const pendingParticipantUpload = await requestProjectResearchFileUpload(users.executor, participantUploadInput);
  check(!("error" in pendingParticipantUpload), "Participant upload must prepare before completion checks");
  await expectRejected(() => completeAttachmentUpload(users.collaborator, pendingParticipantUpload.attachmentId, false, undefined, { researchFolderId: canonicalBrief.id }), "Only the original uploader may complete a shared upload");
  await expectRejected(() => completeProjectResearchFileUpload(users.executor, { projectId, folderId: canonicalTech.id, attachmentId: pendingParticipantUpload.attachmentId }), "Uploads cannot be completed in a different folder");
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING }, data: { status: "LOCKED" } });
  check((await getProjectResearchFolderPageData(users.executor, { projectId, folderId: canonicalBrief.id }))?.canUpload === false, "Locked shared folders remain viewable with uploads disabled");
  await expectRejected(() => requestProjectResearchFileUpload(users.executor, participantUploadInput), "Locked stages must reject new participant uploads");
  await expectRejected(() => completeProjectResearchFileUpload(users.executor, { projectId, folderId: canonicalBrief.id, attachmentId: pendingParticipantUpload.attachmentId }), "Locking a stage must prevent completion of pending uploads");
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING }, data: { status: "AVAILABLE" } });
  const originalExecutor = await prisma.projectExecutor.findFirstOrThrow({ where: { projectId, userId: users.executor.id } });
  const originalCollaborator = await prisma.projectCollaborator.findFirstOrThrow({ where: { projectId, userId: users.executor.id } });
  await prisma.projectExecutor.delete({ where: { projectId_userId: { projectId, userId: users.executor.id } } });
  check((await getProjectResearchFolderPageData(users.executor, { projectId, folderId: canonicalBrief.id }))?.canUpload, "A remaining collaborator assignment must preserve upload access");
  await prisma.projectCollaborator.delete({ where: { projectId_userId: { projectId, userId: users.executor.id } } });
  await expectRejected(() => completeProjectResearchFileUpload(users.executor, { projectId, folderId: canonicalBrief.id, attachmentId: pendingParticipantUpload.attachmentId }), "Removed participants cannot complete pending uploads");
  await prisma.projectExecutor.create({ data: originalExecutor });
  await prisma.projectCollaborator.create({ data: originalCollaborator });
  check(
    expectError(await createProjectResearchFolder(users.executor, { projectId, name: "Forbidden USER Folder" })),
    "USER accounts must not create shared folders",
  );
  check(
    (await getProjectResearchFileDownloadUrl(users.executor, {
      projectId,
      folderId: canonicalBrief.id,
      fileId: briefFile!.id,
    })).length > 0,
    "USER accounts must retain secure download access to canonical Brief files",
  );
  await deleteProjectResearchFile(users.superAdmin, {
    projectId,
    folderId: canonicalTech.id,
    fileId: techFile!.id,
  });
  check(
    !(await prisma.projectResearchFolderFile.findUnique({ where: { id: techFile!.id } })),
    "SUPER_ADMIN must manage files in the canonical shared workspace",
  );

  if (customFolder) {
    const deletedCustom = await deleteProjectResearchFolder(users.superAdmin, {
      projectId,
      folderId: customFolder.id,
    });
    check("folder" in deletedCustom, "SUPER_ADMIN must delete allowed canonical shared folders");
  }
  await expectRejected(
    () =>
      deleteProjectResearchFolder(users.superAdmin, {
        projectId,
        folderId: historicalFolder.id,
      }),
    "managers must not delete folders from historical participant workspaces",
  );

  const historicalAudit = await prisma.projectResearchWorkspace.findMany({
    where: { projectId, ownerUserId: { not: users.owner.id } },
    select: {
      folders: { select: { _count: { select: { files: true } } } },
    },
  });
  check(
    historicalAudit.length === 1 &&
      historicalAudit.reduce(
        (total, workspace) =>
          total + workspace.folders.reduce((files, folder) => files + folder._count.files, 0),
        0,
      ) === 1,
    "historical non-canonical workspace data must remain stored while hidden",
  );

  await prisma.project.update({
    where: { id: projectId },
    data: { completedAt: new Date() },
  });
  check((await getProjectResearchFolderPageData(users.executor, { projectId, folderId: canonicalBrief.id }))?.canUpload === false, "Completed projects disable participant upload controls");
  await expectRejected(() => requestProjectResearchFileUpload(users.executor, participantUploadInput), "Completed projects must reject participant uploads");
  await expectRejected(() => completeProjectResearchFileUpload(users.executor, { projectId, folderId: canonicalBrief.id, attachmentId: pendingParticipantUpload.attachmentId }), "Completed projects must reject pending upload completion");
  const completedProjectWorkspace = await getProjectResearchPageData(
    users.owner,
    projectId,
  );
  const completedProjectFolder = await getProjectResearchFolderPageData(
    users.owner,
    { projectId, folderId: canonicalBrief.id },
  );
  check(
    completedProjectWorkspace?.sharedWorkspace.isProjectCompleted === true &&
      completedProjectWorkspace.sharedWorkspace.canWrite === false &&
      completedProjectWorkspace.sharedWorkspace.canDeleteFolders === false &&
      completedProjectFolder?.canWrite === false,
    "completed projects must keep Stage 2 readable while making its workspace and folders read-only",
  );
  await expectRejected(
    () =>
      requestProjectResearchFileUpload(users.owner, {
        projectId,
        folderId: canonicalBrief.id,
        originalFileName: "blocked-after-completion.txt",
        mimeType: "text/plain",
        fileSize: 1,
      }),
    "completed projects must reject Stage 2 uploads server-side",
  );
  check(
    expectError(
      await createProjectResearchFolder(users.owner, {
        projectId,
        name: "Blocked After Completion",
      }),
    ),
    "completed projects must reject new Stage 2 folders server-side",
  );
  await expectRejected(
    () =>
      deleteProjectResearchFile(users.owner, {
        projectId,
        folderId: canonicalBrief.id,
        fileId: briefFile!.id,
      }),
    "completed projects must reject Stage 2 file deletion server-side",
  );
  check(
    (await getProjectResearchFileDownloadUrl(users.owner, {
      projectId,
      folderId: canonicalBrief.id,
      fileId: briefFile!.id,
    })).length > 0,
    "completed projects must keep existing Stage 2 files readable",
  );

  const zeroFileProjectId = await mustCreateProject("Stage 2 zero-file completion");
  const zeroCompletion = await completeProjectResearchStage(users.superAdmin, zeroFileProjectId);
  check("success" in zeroCompletion && !zeroCompletion.alreadyCompleted, "Stage 2 must complete with zero files");
  const zeroStages = await prisma.projectWorkflowStage.findMany({ where: { projectId: zeroFileProjectId } });
  check(
    zeroStages.find((stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING)?.status === ProjectWorkflowStageStatus.COMPLETED,
    "completion must mark Stage 2 completed",
  );
  check(
    zeroStages.find((stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION)?.status === ProjectWorkflowStageStatus.AVAILABLE,
    "completion must unlock Stage 3",
  );
  check(
    zeroStages
      .filter((stage) => {
        const completedThroughStageThree = new Set<ProjectWorkflowStageKey>([
          ProjectWorkflowStageKey.PROJECT_INQUIRY,
          ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
          ProjectWorkflowStageKey.CONCEPT_CREATION,
        ]);
        return !completedThroughStageThree.has(stage.stageKey);
      })
      .every((stage) => stage.status === ProjectWorkflowStageStatus.LOCKED),
    "Stage 4-7 must remain locked after Stage 2 completion",
  );
  const repeatedCompletion = await completeProjectResearchStage(users.superAdmin, zeroFileProjectId);
  check("success" in repeatedCompletion && repeatedCompletion.alreadyCompleted, "repeated Stage 2 completion must be idempotent");
  check(Boolean(await getProjectResearchPageData(users.owner, zeroFileProjectId)), "completed Stage 2 must remain openable");

  const selfManagedProjectId = await mustCreateSelfManagedProject(
    "Stage 2 self-managed completion",
  );
  const selfManagedCompletion = await completeProjectResearchStage(
    users.owner,
    selfManagedProjectId,
  );
  check(
    "success" in selfManagedCompletion &&
      selfManagedCompletion.nextStage === 5 &&
      selfManagedCompletion.skippedConceptStages &&
      !selfManagedCompletion.alreadyCompleted,
    "self-managed Stage 2 completion must skip directly to Stage 5",
  );
  const selfManagedStages = await prisma.projectWorkflowStage.findMany({
    where: { projectId: selfManagedProjectId },
  });
  const selfManagedStatus = new Map(
    selfManagedStages.map((stage) => [stage.stageKey, stage.status] as const),
  );
  check(
    selfManagedStatus.get(ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING) ===
      ProjectWorkflowStageStatus.COMPLETED &&
      selfManagedStatus.get(ProjectWorkflowStageKey.CONCEPT_CREATION) ===
        ProjectWorkflowStageStatus.COMPLETED &&
      selfManagedStatus.get(ProjectWorkflowStageKey.PROJECT_DEVELOPMENT) ===
        ProjectWorkflowStageStatus.COMPLETED &&
      selfManagedStatus.get(ProjectWorkflowStageKey.FINAL_LAYOUT) ===
        ProjectWorkflowStageStatus.AVAILABLE,
    "self-managed completion must atomically complete Stages 2-4 and unlock Stage 5",
  );
  check(
    (await prisma.projectActivityLog.count({
      where: {
        projectId: selfManagedProjectId,
        action: "STAGE_SKIPPED",
      },
    })) === 2,
    "automatic Stage 3 and Stage 4 skips must each be audited",
  );
  const selfManagedPage = await getProjectResearchPageData(
    users.owner,
    selfManagedProjectId,
  );
  check(
    selfManagedPage?.nextStage === 5,
    "reopening completed Stage 2 for a self-managed project must continue to Stage 5",
  );
  const repeatedSelfManagedCompletion = await completeProjectResearchStage(
    users.owner,
    selfManagedProjectId,
  );
  check(
    "success" in repeatedSelfManagedCompletion &&
      repeatedSelfManagedCompletion.nextStage === 5 &&
      repeatedSelfManagedCompletion.skippedConceptStages &&
      repeatedSelfManagedCompletion.alreadyCompleted &&
      (await prisma.projectActivityLog.count({
        where: {
          projectId: selfManagedProjectId,
          action: "STAGE_SKIPPED",
        },
      })) === 2,
    "repeated self-managed completion must be idempotent and keep Stage 5 as next",
  );

  const lockedProject = await prisma.project.create({
    data: {
      name: "Locked Stage 2",
      ownerId: users.owner.id,
      createdById: users.superAdmin.id,
      workflowStages: { createMany: { data: getInitialProjectWorkflowStageData() } },
    },
  });
  const lockedResult = await completeProjectResearchStage(users.superAdmin, lockedProject.id);
  check(expectError(lockedResult), "locked Stage 2 completion must fail without changing workflow");

  console.log(`Stage 2 canonical workspace integration checks ${checkNumber}/${checkNumber} passed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupIntegrationFixtures();
    await prisma.$disconnect();
  });

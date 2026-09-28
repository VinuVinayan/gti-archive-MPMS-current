import {
  ActivityLogAction,
  AttachmentAssetType,
  AttachmentStatus,
  Prisma,
  ProjectResearchFolderSystemKey,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
} from "@prisma/client";

import {
  hasProjectPermission,
  isGlobalProjectAdministrator,
  type PermissionUser,
} from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { getWorkflowStageCompletionMode } from "@/lib/project-workflow";
import { getProjectStageAccessRecordById } from "@/lib/project-stage-data";
import {
  getProjectResearchAccess,
  getResearchFolderAccess,
} from "@/lib/project-research-access";

export const PROJECT_RESEARCH_SYSTEM_FOLDERS = [
  { key: ProjectResearchFolderSystemKey.BRIEF, name: "Brief", sortOrder: 1 },
  {
    key: ProjectResearchFolderSystemKey.MARKET_COMPETITION,
    name: "Market & Competition",
    sortOrder: 2,
  },
  { key: ProjectResearchFolderSystemKey.TECH, name: "Tech", sortOrder: 3 },
  { key: ProjectResearchFolderSystemKey.VENDORS, name: "Vendors", sortOrder: 4 },
  { key: ProjectResearchFolderSystemKey.FINANCE, name: "Finance", sortOrder: 5 },
  { key: ProjectResearchFolderSystemKey.LEGAL, name: "Legal", sortOrder: 6 },
  { key: ProjectResearchFolderSystemKey.PITCH, name: "Pitch", sortOrder: 7 },
] as const;

export const PROJECT_RESEARCH_CUSTOM_FOLDER_NAME_MAX_LENGTH = 120;

type ResearchUser = Pick<PermissionUser, "id" | "role">;

export function normalizeProjectResearchFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function cleanProjectResearchFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export async function ensureCanonicalProjectResearchWorkspaceTx(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  if (!project.ownerId) {
    throw new Error("Project owner is required for the shared research workspace.");
  }

  const ownerUserId = project.ownerId;
  const existingWorkspace = await tx.projectResearchWorkspace.findUnique({
    where: { projectId_ownerUserId: { projectId, ownerUserId } },
    select: { id: true },
  });

  if (existingWorkspace) {
    return existingWorkspace;
  }

  return tx.projectResearchWorkspace.create({
    data: {
      projectId,
      ownerUserId,
      folders: {
        create: PROJECT_RESEARCH_SYSTEM_FOLDERS.map((folder) => ({
          name: folder.name,
          normalizedName: normalizeProjectResearchFolderName(folder.name),
          systemKey: folder.key,
          isSystem: true,
          sortOrder: folder.sortOrder,
        })),
      },
    },
    select: { id: true },
  });
}

export async function ensureCanonicalProjectResearchWorkspace(projectId: string) {
  return withPrismaRetry(() =>
    prisma.$transaction((tx) =>
      ensureCanonicalProjectResearchWorkspaceTx(tx, projectId),
    ),
  );
}

const researchProjectSelect = {
  id: true,
  name: true,
  ownerId: true,
  owner: { select: { id: true, name: true, email: true } },
  coOwners: {
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  },
  executors: {
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  },
  collaborators: {
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  },
  workflowStages: {
    where: { stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING },
    select: { stageKey: true, status: true },
    take: 1,
  },
} satisfies Prisma.ProjectSelect;

function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email;
}

function assertStageTwoAvailable(status: ProjectWorkflowStageStatus | undefined) {
  if (
    status !== ProjectWorkflowStageStatus.AVAILABLE &&
    status !== ProjectWorkflowStageStatus.COMPLETED
  ) {
    throw new Error("Project Research and Planning is not available yet.");
  }
}

export type ProjectResearchPageData = Awaited<
  ReturnType<typeof getProjectResearchPageData>
>;

export async function getProjectResearchPageData(
  user: ResearchUser,
  projectId: string,
) {
  const project = await getProjectStageAccessRecordById(projectId);

  if (!project) {
    return null;
  }

  assertStageTwoAvailable(
    project.workflowStages.find(
      (stage) =>
        stage.stageKey === ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
    )?.status,
  );

  const participantIds = new Set([
    ...(project.ownerId ? [project.ownerId] : []),
    ...project.coOwners.map((record) => record.userId),
    ...project.executors.map((record) => record.userId),
    ...project.collaborators.map((record) => record.userId),
  ]);

  if (!project.ownerId || (!isGlobalProjectAdministrator(user) && project.ownerId !== user.id && !project.coOwners.some((record) => record.userId === user.id))) {
    return null;
  }
  const ownerUserId = project.ownerId;

  const sharedWorkspace = await withPrismaRetry(() =>
    prisma.projectResearchWorkspace.findUnique({
      where: {
        projectId_ownerUserId: { projectId, ownerUserId },
      },
      select: {
        id: true,
        ownerUserId: true,
      },
    }),
  );

  if (!sharedWorkspace) {
    return null;
  }

  const access = getProjectResearchAccess(user, {
    projectId,
    workspaceId: sharedWorkspace.id,
    workspaceOwnerUserId: sharedWorkspace.ownerUserId,
    project,
  });

  if (!access.canRead) {
    return null;
  }

  const [folders, ownPrivateFolder] = await Promise.all([
    withPrismaRetry(() =>
      prisma.projectResearchFolder.findMany({
        where: { workspaceId: sharedWorkspace.id, parentFolderId: null },
        relationLoadStrategy: "join",
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          isSystem: true,
          systemKey: true,
          sortOrder: true,
          pinnedAt: true, colorLabel: true,
          _count: {
            select: {
              children: true,
              files: { where: { attachment: { status: AttachmentStatus.READY } } },
            },
          },
        },
      }),
    ),
    participantIds.has(user.id)
      ? withPrismaRetry(() =>
          prisma.projectPrivateFolder.findFirst({
            where: { projectId, ownerUserId: user.id, parentFolderId: null },
            select: { id: true, colorLabel: true },
          }),
        )
      : Promise.resolve(null),
  ]);

  const participantRole = new Map<string, string>();
  if (project.owner) participantRole.set(project.owner.id, "Project Owner");
  for (const record of project.coOwners) {
    if (!participantRole.has(record.userId)) participantRole.set(record.userId, "Project Co-Owner");
  }
  for (const record of project.executors) {
    if (!participantRole.has(record.userId)) participantRole.set(record.userId, "Project Executor");
  }
  for (const record of project.collaborators) {
    if (!participantRole.has(record.userId)) participantRole.set(record.userId, "Collaborator");
  }

  const stageThreeStatus = project.workflowStages.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
  )?.status;
  const stageFourStatus = project.workflowStages.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
  )?.status;
  const nextStage =
    project.executors.length === 0 &&
    stageThreeStatus === ProjectWorkflowStageStatus.COMPLETED &&
    stageFourStatus === ProjectWorkflowStageStatus.COMPLETED
      ? 5
      : 3;

  return {
    project: {
      id: project.id,
      name: project.name,
    },
    workflowStatus:
      project.workflowStages.find(
        (stage) =>
          stage.stageKey === ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
      )?.status ?? ProjectWorkflowStageStatus.LOCKED,
    nextStage,
    sharedWorkspace: {
      id: sharedWorkspace.id,
      canWrite: access.canWrite,
      canDeleteFolders: access.canWrite,
      isProjectCompleted: access.isProjectCompleted,
    },
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      isSystem: folder.isSystem,
      systemKey: folder.systemKey,
      sortOrder: folder.sortOrder,
      pinnedAt: folder.pinnedAt?.toISOString() ?? null,
      colorLabel: folder.colorLabel,
      fileCount: folder._count.files,
      folderCount: folder._count.children,
    })),
    myPrivateFolder: ownPrivateFolder
      ? {
          href: `/projects/${projectId}/workspace/private/${ownPrivateFolder.id}`,
          colorLabel: ownPrivateFolder.colorLabel,
        }
      : null,
    classifiedFolders: [...participantIds]
      .filter((participantId) => participantId !== user.id)
      .map((participantId) => {
        const participant =
          project.owner?.id === participantId
            ? project.owner
            : project.coOwners.find((record) => record.userId === participantId)?.user ??
              project.executors.find((record) => record.userId === participantId)?.user ??
              project.collaborators.find((record) => record.userId === participantId)?.user;

        return participant
          ? {
              ownerName: displayName(participant),
              role: participantRole.get(participantId) ?? "Project Participant",
            }
          : null;
      })
      .filter((folder): folder is { ownerName: string; role: string } => Boolean(folder))
      .sort((left, right) => left.ownerName.localeCompare(right.ownerName))
      .map((folder, index) => ({ key: `classified-${index + 1}`, ...folder })),
  };
}

export async function createProjectResearchFolder(
  user: ResearchUser,
  input: { projectId: string; name: string; parentFolderId?: string },
) {
  const name = cleanProjectResearchFolderName(input.name);

  if (!name) {
    return { error: "Folder name is required." } as const;
  }

  if (name.length > PROJECT_RESEARCH_CUSTOM_FOLDER_NAME_MAX_LENGTH) {
    return {
      error: `Folder names can be up to ${PROJECT_RESEARCH_CUSTOM_FOLDER_NAME_MAX_LENGTH} characters.`,
    } as const;
  }

  const project = await getProjectStageAccessRecordById(input.projectId);

  if (!project?.ownerId) {
    return { error: "Shared research workspace not found." } as const;
  }
  const ownerUserId = project.ownerId;

  const workspace = await withPrismaRetry(() =>
    prisma.projectResearchWorkspace.findUnique({
      where: {
        projectId_ownerUserId: {
          projectId: input.projectId,
          ownerUserId,
        },
      },
      select: {
        id: true,
        ownerUserId: true,
      },
    }),
  );

  if (!workspace) {
    return { error: "Folder set not found." } as const;
  }

  const access = getProjectResearchAccess(user, {
    projectId: input.projectId,
    workspaceId: workspace.id,
    workspaceOwnerUserId: workspace.ownerUserId,
    project,
  });

  if (!access.canWrite) {
    return { error: "This folder set is read-only for your account." } as const;
  }

  if (input.parentFolderId) {
    const parent = await prisma.projectResearchFolder.findFirst({
      where: { id: input.parentFolderId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!parent) return { error: "Parent folder not found." } as const;
  }

  try {
    const folder = await withPrismaRetry(() =>
      prisma.projectResearchFolder.create({
        data: {
          workspaceId: workspace.id,
          parentFolderId: input.parentFolderId || null,
          name,
          normalizedName: normalizeProjectResearchFolderName(name),
          isSystem: false,
          sortOrder: 1000,
          createdById: user.id,
        },
        select: { id: true, name: true },
      }),
    );

    return { folder } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A folder with this name already exists in this location." } as const;
    }
    throw error;
  }
}

export async function getProjectResearchFolderPageData(
  user: ResearchUser,
  input: { projectId: string; folderId: string },
) {
  const { access, path } = await getResearchFolderAccess(user, input).catch(() => ({
    access: null,
    path: [],
  }));

  if (!access?.canRead) {
    return null;
  }

  const folder = await withPrismaRetry(() =>
    prisma.projectResearchFolder.findFirst({
      where: {
        id: input.folderId,
        workspaceId: access.workspaceId,
      },
      relationLoadStrategy: "join",
      select: {
        id: true,
        name: true,
        isSystem: true,
        systemKey: true,
        colorLabel: true,
        children: {
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: {
            id: true, name: true, createdAt: true, pinnedAt: true, colorLabel: true,
            _count: { select: { children: true, files: { where: { attachment: { status: AttachmentStatus.READY } } } } },
          },
        },
        workspace: {
          select: {
            id: true,
            ownerUserId: true,
            owner: { select: { name: true, email: true } },
            project: { select: researchProjectSelect },
          },
        },
        files: {
          where: { attachment: { status: AttachmentStatus.READY } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            pinnedAt: true, colorLabel: true,
            attachment: {
              select: {
                id: true,
                originalFileName: true,
                mimeType: true,
                fileSize: true,
                createdAt: true,
                uploadedBy: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
    }),
  );

  if (!folder) {
    return null;
  }

  return {
    project: {
      id: folder.workspace.project.id,
      name: folder.workspace.project.name,
    },
    workspace: {
      id: folder.workspace.id,
      ownerUserId: folder.workspace.ownerUserId,
      ownerName: displayName(folder.workspace.owner),
    },
    folder: { id: folder.id, name: folder.name, isSystem: folder.isSystem, colorLabel: folder.colorLabel },
    ancestors: path.slice(0, -1).map(({ id, name }) => ({ id, name })),
    folders: folder.children.map((child) => ({
      id: child.id, name: child.name, createdAt: child.createdAt.toISOString(),
      pinnedAt: child.pinnedAt?.toISOString() ?? null,
      colorLabel: child.colorLabel,
      fileCount: child._count.files, folderCount: child._count.children,
    })),
    canWrite: access.canWrite,
    canUpload: access.canUpload,
    files: folder.files.map((record) => ({
      id: record.id,
      pinnedAt: record.pinnedAt?.toISOString() ?? null,
      colorLabel: record.colorLabel,
      attachmentId: record.attachment.id,
      name: record.attachment.originalFileName,
      mimeType: record.attachment.mimeType,
      size: record.attachment.fileSize,
      uploadedAt: record.attachment.createdAt.toISOString(),
      uploadedBy: displayName(record.attachment.uploadedBy),
    })),
  };
}

export async function completeProjectResearchStage(
  user: ResearchUser,
  projectId: string,
) {
  const project = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        ownerId: true,
        coOwners: { select: { userId: true } },
        executors: { select: { userId: true } },
        collaborators: { select: { userId: true } },
      },
    }),
  );

  if (!project) {
    return { error: "Project not found." } as const;
  }

  if (!hasProjectPermission(user, project, "project.update")) {
    return { error: "You do not have permission to complete this stage." } as const;
  }

  return withPrismaRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const workflowStages = await tx.projectWorkflowStage.findMany({
          where: { projectId },
          select: {
            id: true,
            stageKey: true,
            status: true,
            unlockedAt: true,
            completedAt: true,
          },
        });
        const stageTwo = workflowStages.find(
          (stage) =>
            stage.stageKey ===
            ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
        );
        const stageThree = workflowStages.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.CONCEPT_CREATION,
        );
        const stageFour = workflowStages.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
        );
        const stageFive = workflowStages.find(
          (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
        );
        const completionMode = getWorkflowStageCompletionMode(
          workflowStages,
          ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
        );

        if (
          !stageTwo ||
          !stageThree ||
          !stageFour ||
          !stageFive ||
          completionMode === "UNAVAILABLE"
        ) {
          return { error: "Project Research and Planning is not available yet." } as const;
        }

        const alreadyCompleted = completionMode === "RETRY";
        const selfManaged = project.executors.length === 0;
        let skippedConceptStages =
          selfManaged &&
          stageThree.status === ProjectWorkflowStageStatus.COMPLETED &&
          stageFour.status === ProjectWorkflowStageStatus.COMPLETED &&
          stageFive.status !== ProjectWorkflowStageStatus.LOCKED;

        if (completionMode === "TRANSITION") {
          const now = new Date();
          const completed = await tx.projectWorkflowStage.updateMany({
            where: {
              id: stageTwo.id,
              status: ProjectWorkflowStageStatus.AVAILABLE,
            },
            data: {
              status: ProjectWorkflowStageStatus.COMPLETED,
              completedAt: now,
            },
          });

          if (completed.count !== 1) {
            return { error: "Stage 2 changed before it could be completed." } as const;
          }

          if (selfManaged) {
            const skippedStageThree = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageThree.id,
                status: ProjectWorkflowStageStatus.LOCKED,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                unlockedAt: now,
                completedAt: now,
              },
            });

            const skippedStageFour = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageFour.id,
                status: ProjectWorkflowStageStatus.LOCKED,
              },
              data: {
                status: ProjectWorkflowStageStatus.COMPLETED,
                unlockedAt: now,
                completedAt: now,
              },
            });

            const unlockedStageFive = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageFive.id,
                status: ProjectWorkflowStageStatus.LOCKED,
              },
              data: {
                status: ProjectWorkflowStageStatus.AVAILABLE,
                unlockedAt: now,
              },
            });

            if (
              skippedStageThree.count !== 1 ||
              skippedStageFour.count !== 1 ||
              unlockedStageFive.count !== 1
            ) {
              throw new Error(
                "The self-managed workflow changed before Stages 3 and 4 could be skipped.",
              );
            }

            await tx.projectActivityLog.createMany({
              data: [
                {
                  projectId,
                  actorId: user.id,
                  action: ActivityLogAction.STAGE_SKIPPED,
                  metadata: {
                    stageNumber: 3,
                    workflowStageKey: ProjectWorkflowStageKey.CONCEPT_CREATION,
                    nextWorkflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                    reason: "SELF_MANAGED_PROJECT",
                  },
                },
                {
                  projectId,
                  actorId: user.id,
                  action: ActivityLogAction.STAGE_SKIPPED,
                  metadata: {
                    stageNumber: 4,
                    workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                    nextWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
                    reason: "SELF_MANAGED_PROJECT",
                  },
                },
              ],
            });
            skippedConceptStages = true;
          } else {
            const unlockedStageThree = await tx.projectWorkflowStage.updateMany({
              where: {
                id: stageThree.id,
                status: ProjectWorkflowStageStatus.LOCKED,
              },
              data: {
                status: ProjectWorkflowStageStatus.AVAILABLE,
                unlockedAt: now,
              },
            });

            if (unlockedStageThree.count !== 1) {
              throw new Error("Stage 3 changed before it could be unlocked.");
            }
          }
        }

        return {
          success: true,
          nextStage: skippedConceptStages ? 5 : 3,
          skippedConceptStages,
          alreadyCompleted,
        } as const;
      },
      { timeout: 30_000 },
    ),
  );
}

export function isProjectResearchAttachmentType(assetType: AttachmentAssetType) {
  return assetType === AttachmentAssetType.PROJECT_RESEARCH_FILE;
}

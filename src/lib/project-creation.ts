import { UserRole, type User } from "@prisma/client";

import { normalizeProjectCollaboratorPermissions } from "./project-collaborator-permissions";
import { prisma, withPrismaRetry } from "./prisma";
import { ensureCanonicalProjectResearchWorkspaceTx } from "./project-research";
import { ensureProjectPrivateFolderTx } from "./project-private-folders";
import { getInitialProjectWorkflowStageData } from "./project-workflow";
import { isBusinessAdministratorRole } from "./user-role-compatibility";

import { createProjectTemplateSnapshotTx, type TemplateSelection } from "./project-templates";

export type CreateProjectV2Input = TemplateSelection & {
  name: string;
  ownerId: string;
  coOwnerIds: string[];
  executorIds: string[];
  collaboratorIds?: string[];
};

export type CreateProjectV2FieldErrors = {
  name?: string;
  ownerId?: string;
  coOwnerIds?: string;
  executorIds?: string;
  collaboratorIds?: string;
  templateKey?: string;
};

export type CreateProjectV2Result =
  | {
      projectId: string;
    }
  | {
      error: string;
      fieldErrors?: CreateProjectV2FieldErrors;
    };

type ProjectCreator = Pick<User, "id">;

export type UpdateProjectV2Result = CreateProjectV2Result;

function normalizeIdList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

function hasMalformedIds(values: unknown) {
  return (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || !value.trim())
  );
}

function isValidIdList(values: unknown): values is string[] {
  return !hasMalformedIds(values);
}

export async function createProjectV2(
  creator: ProjectCreator,
  input: CreateProjectV2Input,
): Promise<CreateProjectV2Result> {
  const name = input.name.trim();
  const ownerId = creator.id;
  const coOwnerIds = normalizeIdList(input.coOwnerIds);
  const executorIds = normalizeIdList(input.executorIds);
  const rawCollaboratorIds: unknown = input.collaboratorIds ?? [];
  const collaboratorIds = isValidIdList(rawCollaboratorIds)
    ? [...new Set(normalizeIdList(rawCollaboratorIds))]
    : [];
  const fieldErrors: CreateProjectV2FieldErrors = {};

  if (!name) {
    fieldErrors.name = "Project name is required.";
  }

  if (hasDuplicates(coOwnerIds)) {
    fieldErrors.coOwnerIds = "A co-owner can only be selected once.";
  }

  if (ownerId && coOwnerIds.includes(ownerId)) {
    fieldErrors.coOwnerIds = "The project owner cannot also be a co-owner.";
  }

  if (hasDuplicates(executorIds)) {
    fieldErrors.executorIds = "An executor can only be selected once.";
  }

  if (hasMalformedIds(rawCollaboratorIds)) {
    fieldErrors.collaboratorIds =
      "Every collaborator selection must contain a valid user ID.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      error: "Review the highlighted fields.",
      fieldErrors,
    };
  }

  const participantIds = [
    ...new Set([ownerId, ...coOwnerIds, ...executorIds, ...collaboratorIds]),
  ];
  const users = await withPrismaRetry(() =>
    prisma.user.findMany({
      where: {
        id: {
          in: participantIds,
        },
      },
      select: {
        id: true,
        role: true,
        projectCreationAccessGranted: true,
      },
    }),
  );
  const userById = new Map(users.map((user) => [user.id, user] as const));
  const owner = userById.get(ownerId);

  if (!owner) {
    fieldErrors.ownerId = "The selected project owner no longer exists.";
  } else if (
    !isBusinessAdministratorRole(owner.role) &&
    !owner.projectCreationAccessGranted
  ) {
    fieldErrors.ownerId =
      "Only an Admin or a user granted Create Project access can own a new project.";
  }

  const invalidCoOwner = coOwnerIds.find((userId) => {
    const user = userById.get(userId);
    return !user || user.role !== UserRole.ADMIN;
  });

  if (invalidCoOwner) {
    fieldErrors.coOwnerIds =
      "Every co-owner must be an existing Admin user.";
  }

  const invalidExecutor = executorIds.find(
    (userId) => userById.get(userId)?.role !== UserRole.USER,
  );

  if (invalidExecutor) {
    fieldErrors.executorIds =
      "Every executor must be an existing User account.";
  }

  const invalidCollaborator = collaboratorIds.find(
    (userId) => userById.get(userId)?.role !== UserRole.USER,
  );

  if (invalidCollaborator) {
    fieldErrors.collaboratorIds =
      "Every project collaborator must be an existing eligible collaborator.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      error: "One or more selected users are no longer eligible.",
      fieldErrors,
    };
  }

  const additionalCollaboratorIds = collaboratorIds.filter(
    (userId) => userId !== ownerId && !coOwnerIds.includes(userId),
  );
  const executorIdSet = new Set(executorIds);
  const membershipIds = [
    ...new Set([...executorIds, ...additionalCollaboratorIds]),
  ];
  const membershipUsers = membershipIds
    .map((userId) => userById.get(userId))
    .filter((user): user is NonNullable<typeof user> => Boolean(user));

  const createdProject = await withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name,
          ownerId,
          createdById: creator.id,
          coOwners:
            coOwnerIds.length > 0
              ? {
                  createMany: {
                    data: coOwnerIds.map((userId) => ({
                      userId,
                      addedById: creator.id,
                    })),
                  },
                }
              : undefined,
          executors: {
            createMany: {
              data: executorIds.map((userId) => ({
                userId,
                addedById: creator.id,
              })),
            },
          },
          collaborators: {
            createMany: {
              data: membershipUsers.map((participant) => {
                return {
                  userId: participant.id,
                  addedById: creator.id,
                  ...normalizeProjectCollaboratorPermissions(null, {
                    isExecutor: executorIdSet.has(participant.id),
                  }),
                };
              }),
              skipDuplicates: true,
            },
          },
          workflowStages: {
            createMany: {
              data: (input.templateKey ?? "PACKAGING") === "PACKAGING" ? getInitialProjectWorkflowStageData() : [],
            },
          },
        },
        select: {
          id: true,
          name: true,
        },
      });

      await createProjectTemplateSnapshotTx(tx, project.id, creator.id, input);
      if ((input.templateKey ?? "PACKAGING") === "PACKAGING") await ensureCanonicalProjectResearchWorkspaceTx(tx, project.id);
      for (const participantId of participantIds) {
        await ensureProjectPrivateFolderTx(tx, project.id, participantId);
      }

      const ownerRecipientIds = [ownerId].filter((userId) => userId !== creator.id);
      const coOwnerRecipientIds = coOwnerIds.filter(
        (userId) => userId !== creator.id && !ownerRecipientIds.includes(userId),
      );
      const executorRecipientIds = executorIds.filter(
        (userId) =>
          userId !== creator.id &&
          !ownerRecipientIds.includes(userId) &&
          !coOwnerRecipientIds.includes(userId),
      );
      const collaboratorRecipientIds = additionalCollaboratorIds.filter(
        (userId) =>
          userId !== creator.id &&
          !ownerRecipientIds.includes(userId) &&
          !coOwnerRecipientIds.includes(userId) &&
          !executorRecipientIds.includes(userId),
      );
      const notificationUrl = `/projects/${project.id}`;
      const createdAt = new Date();

      if (ownerRecipientIds.length > 0) {
        await tx.notification.createMany({
          data: ownerRecipientIds.map((userId) => ({
            userId,
            type: "PROJECT_CREATED",
            title: "Project assigned to you",
            message: `You are the project owner for ${project.name}.`,
            entityType: "PROJECT",
            entityId: project.id,
            projectId: project.id,
            url: notificationUrl,
            createdAt,
            updatedAt: createdAt,
          })),
        });
      }

      if (coOwnerRecipientIds.length > 0) {
        await tx.notification.createMany({
          data: coOwnerRecipientIds.map((userId) => ({
            userId,
            type: "PROJECT_CREATED",
            title: "Project assigned to you",
            message: `You are a co-owner for ${project.name}.`,
            entityType: "PROJECT",
            entityId: project.id,
            projectId: project.id,
            url: notificationUrl,
            createdAt,
            updatedAt: createdAt,
          })),
        });
      }

      if (executorRecipientIds.length > 0) {
        await tx.notification.createMany({
          data: executorRecipientIds.map((userId) => ({
            userId,
            type: "PROJECT_ASSIGNED",
            title: "Project assigned to you",
            message: `You have been assigned as an executor for ${project.name}.`,
            entityType: "PROJECT",
            entityId: project.id,
            projectId: project.id,
            url: notificationUrl,
            createdAt,
            updatedAt: createdAt,
          })),
        });
      }

      if (collaboratorRecipientIds.length > 0) {
        await tx.notification.createMany({
          data: collaboratorRecipientIds.map((userId) => ({
            userId,
            type: "COLLABORATOR_ADDED",
            title: "Added to project",
            message: `You have been added to ${project.name}.`,
            entityType: "PROJECT",
            entityId: project.id,
            projectId: project.id,
            url: notificationUrl,
            createdAt,
            updatedAt: createdAt,
          })),
        });
      }

      return project;
    }, { timeout: 30_000 }),
  );

  return {
    projectId: createdProject.id,
  };
}

export async function updateProjectV2(
  actor: ProjectCreator,
  projectId: string,
  input: CreateProjectV2Input,
): Promise<UpdateProjectV2Result> {
  const name = input.name.trim();

  if (!projectId.trim()) {
    return { error: "Project not found." };
  }

  const existingProject = await withPrismaRetry(() =>
    prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    }),
  );

  if (!existingProject) {
    return { error: "Project not found." };
  }

  const ownerId = existingProject.ownerId;

  if (!ownerId) {
    return {
      error: "This project has no owner and cannot be edited until its ownership is repaired.",
      fieldErrors: { ownerId: "Project owner is missing." },
    };
  }

  const coOwnerIds = normalizeIdList(input.coOwnerIds);
  const executorIds = normalizeIdList(input.executorIds);
  const rawCollaboratorIds: unknown = input.collaboratorIds ?? [];
  const collaboratorIds = isValidIdList(rawCollaboratorIds)
    ? [...new Set(normalizeIdList(rawCollaboratorIds))]
    : [];
  const fieldErrors: CreateProjectV2FieldErrors = {};

  if (!name) fieldErrors.name = "Project name is required.";
  if (hasDuplicates(coOwnerIds)) {
    fieldErrors.coOwnerIds = "A co-owner can only be selected once.";
  } else if (ownerId && coOwnerIds.includes(ownerId)) {
    fieldErrors.coOwnerIds = "The project owner cannot also be a co-owner.";
  }

  if (hasDuplicates(executorIds)) {
    fieldErrors.executorIds = "An executor can only be selected once.";
  }

  if (hasMalformedIds(rawCollaboratorIds)) {
    fieldErrors.collaboratorIds =
      "Every collaborator selection must contain a valid user ID.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Review the highlighted fields.", fieldErrors };
  }

  const participantIds = [
    ...new Set([ownerId, ...coOwnerIds, ...executorIds, ...collaboratorIds]),
  ];
  const users = await withPrismaRetry(() =>
    prisma.user.findMany({
      where: { id: { in: participantIds } },
      select: { id: true, role: true },
    }),
  );
  const userById = new Map(users.map((user) => [user.id, user] as const));
  const owner = userById.get(ownerId);

  if (!owner) {
    fieldErrors.ownerId = "The selected project owner no longer exists.";
  }

  if (
    coOwnerIds.some((userId) => {
      const user = userById.get(userId);
      return !user || user.role !== UserRole.ADMIN;
    })
  ) {
    fieldErrors.coOwnerIds =
      "Every co-owner must be an existing Admin user.";
  }

  if (
    executorIds.some(
      (userId) => userById.get(userId)?.role !== UserRole.USER,
    )
  ) {
    fieldErrors.executorIds =
      "Every executor must be an existing User account.";
  }

  if (
    collaboratorIds.some(
      (userId) => userById.get(userId)?.role !== UserRole.USER,
    )
  ) {
    fieldErrors.collaboratorIds =
      "Every project collaborator must be an existing eligible collaborator.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      error: "One or more selected users are no longer eligible.",
      fieldErrors,
    };
  }

  const additionalCollaboratorIds = collaboratorIds.filter(
    (userId) => userId !== ownerId && !coOwnerIds.includes(userId),
  );
  const executorIdSet = new Set(executorIds);
  const membershipIds = [
    ...new Set([...executorIds, ...additionalCollaboratorIds]),
  ];

  await withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          executors: { select: { userId: true } },
          collaborators: {
            select: {
              userId: true,
              canInteract: true,
              canAddCaptions: true,
              canDownloadFiles: true,
              canViewBudget: true,
              canViewVendorInfo: true,
              canAccessProjectArchives: true,
            },
          },
        },
      });

      if (!project) throw new Error("Project not found.");

      const existingExecutorIds = new Set(
        project.executors.map((executor) => executor.userId),
      );
      const existingCollaboratorById = new Map(
        project.collaborators.map(
          (collaborator) => [collaborator.userId, collaborator] as const,
        ),
      );
      const removedExecutorIds = project.executors
        .map((executor) => executor.userId)
        .filter((userId) => !executorIdSet.has(userId));

      if (removedExecutorIds.length > 0) {
        await tx.projectConceptFolder.updateMany({
          where: {
            projectId,
            assignedExecutorId: { in: removedExecutorIds },
          },
          data: { assignedExecutorId: null },
        });
      }

      await tx.project.update({
        where: { id: projectId },
        data: { name },
      });
      await tx.projectCoOwner.deleteMany({
        where: {
          projectId,
          ...(coOwnerIds.length > 0 ? { userId: { notIn: coOwnerIds } } : {}),
        },
      });
      await tx.projectCoOwner.createMany({
        data: coOwnerIds.map((userId) => ({ projectId, userId, addedById: actor.id })),
        skipDuplicates: true,
      });
      await tx.projectExecutor.deleteMany({
        where: {
          projectId,
          ...(executorIds.length > 0 ? { userId: { notIn: executorIds } } : {}),
        },
      });
      await tx.projectExecutor.createMany({
        data: executorIds
          .filter((userId) => !existingExecutorIds.has(userId))
          .map((userId) => ({ projectId, userId, addedById: actor.id })),
        skipDuplicates: true,
      });
      await tx.projectCollaborator.deleteMany({
        where: {
          projectId,
          ...(membershipIds.length > 0 ? { userId: { notIn: membershipIds } } : {}),
        },
      });

      for (const userId of membershipIds) {
        const existing = existingCollaboratorById.get(userId);
        const data = {
          ...normalizeProjectCollaboratorPermissions(existing, {
            isExecutor: executorIdSet.has(userId),
          }),
        };

        await tx.projectCollaborator.upsert({
          where: { projectId_userId: { projectId, userId } },
          create: { projectId, userId, addedById: actor.id, ...data },
          update: data,
        });
      }

      await ensureCanonicalProjectResearchWorkspaceTx(tx, projectId);
      for (const participantId of participantIds) {
        await ensureProjectPrivateFolderTx(tx, projectId, participantId);
      }
    }, { timeout: 30_000 }),
  );

  return { projectId };
}

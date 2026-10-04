"use server";

import { ProjectTemplateError } from "@/lib/project-template-definitions";
import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  createProjectV2,
  type CreateProjectV2Input,
  type CreateProjectV2Result,
  updateProjectV2,
} from "@/lib/project-creation";
import { notifyProjectAssignmentChanges, runNotificationTask } from "@/lib/notification-center";
import {
  canCreateProjects,
  hasProjectPermission,
} from "@/lib/permissions/resolver";
import { prisma } from "@/lib/prisma";
import { PROJECTS_CACHE_TAG } from "@/lib/projects";
import { isProjectStatusCompleted } from "@/lib/project-statuses";
import {
  publishProjectAccessRevoked,
  runStageChatRealtimeTaskAfterResponse,
} from "@/lib/realtime/server";

export async function createProjectV2Action(
  input: CreateProjectV2Input,
): Promise<CreateProjectV2Result> {
  const user = await requireUser();

  if (!canCreateProjects(user)) {
    return {
      error: "You are not allowed to create projects.",
    };
  }

  try {
    const result = await createProjectV2(user, input);

    if ("error" in result) {
      return result;
    }

    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath("/notifications");
    revalidateTag(PROJECTS_CACHE_TAG, "max");

    return result;
  } catch (error) {
    if (error instanceof ProjectTemplateError) return { error: error.message, fieldErrors: { templateKey: error.message } };
    console.error("[projects] V2 project creation failed", error);

    return {
      error: "Unable to create the project right now. Please try again.",
    };
  }
}

export async function updateProjectV2Action(
  projectId: string,
  input: CreateProjectV2Input,
): Promise<CreateProjectV2Result> {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      completedAt: true,
      archivedAt: true,
      status: {
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
          group: {
            select: {
              id: true,
              name: true,
              slug: true,
              color: true,
              isActive: true,
            },
          },
        },
      },
      ownerId: true,
      coOwners: { select: { userId: true } },
      executors: { select: { userId: true } },
      collaborators: { select: { userId: true } },
    },
  });

  if (!project) return { error: "Project not found." };

  if (
    !hasProjectPermission(user, project, "project.update") ||
    !hasProjectPermission(user, project, "project.manageCollaborators")
  ) {
    return { error: "You are not allowed to edit this project." };
  }

  if (
    project.completedAt ||
    project.archivedAt ||
    isProjectStatusCompleted(project.status)
  ) {
    return { error: "Completed projects cannot be edited." };
  }

  try {
    const previousParticipantIds = project.collaborators.map(
      (collaborator) => collaborator.userId,
    );
    const previousExecutorIds = project.executors.map((executor) => executor.userId);
    const previousAccessIds = [
      project.ownerId,
      ...project.coOwners.map((coOwner) => coOwner.userId),
      ...previousExecutorIds,
      ...previousParticipantIds,
    ].filter((participantId): participantId is string => Boolean(participantId));
    const result = await updateProjectV2(user, projectId, input);

    if ("error" in result) return result;

    const updatedProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { collaborators: { select: { userId: true } } },
    });
    const nextParticipantIds =
      updatedProject?.collaborators.map((collaborator) => collaborator.userId) ?? [];

    await runNotificationTask("project-edited-assignments", () =>
      notifyProjectAssignmentChanges({
        projectId,
        actorId: user.id,
        previousExecutorUserIds: previousExecutorIds,
        nextExecutorUserIds: input.executorIds,
        addedCollaboratorIds: nextParticipantIds.filter(
          (participantId) => !previousParticipantIds.includes(participantId),
        ),
        removedCollaboratorIds: previousParticipantIds.filter(
          (participantId) => !nextParticipantIds.includes(participantId),
        ),
      }),
    );

    const nextAccessIds = new Set([
      input.ownerId,
      ...input.coOwnerIds,
      ...input.executorIds,
      ...(input.collaboratorIds ?? []),
    ]);
    const removedAccessIds = [
      ...new Set(
        previousAccessIds.filter((participantId) => !nextAccessIds.has(participantId)),
      ),
    ];

    if (removedAccessIds.length > 0) {
      runStageChatRealtimeTaskAfterResponse("project-access.revoked:project-edit", () =>
        publishProjectAccessRevoked({
          eventId: randomUUID(),
          projectId,
          targetUserIds: removedAccessIds,
          actorId: user.id,
          revokedAt: new Date().toISOString(),
          reason: "collaborator_removed",
        }),
      );
    }

    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);
    revalidatePath("/notifications");
    revalidateTag(PROJECTS_CACHE_TAG, "max");

    return result;
  } catch (error) {
    console.error("[projects] V2 project update failed", error);

    return {
      error: "Unable to update the project right now. Please try again.",
    };
  }
}

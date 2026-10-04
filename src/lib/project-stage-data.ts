import { cache } from "react";
import { Prisma } from "@prisma/client";

import { prisma, withPrismaRetry } from "@/lib/prisma";

const stageParticipantSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const projectStageAccessSelect = {
  id: true,
  name: true,
  templateVersionId: true,
  templateName: true,
  templateKey: true,
  structureApproval: true,
  stageInstances: { where: { retiredAt: null }, orderBy: { order: "asc" }, select: {
    id: true, order: true, name: true, stageType: true, workspace: true,
    description: true, goal: true, guidance: true, definitionOfDone: true,
    required: true, skippable: true, status: true, skippedAt: true,
  } },
  ownerId: true,
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
  owner: { select: stageParticipantSelect },
  coOwners: {
    orderBy: { createdAt: "asc" },
    select: {
      projectId: true,
      userId: true,
      addedById: true,
      createdAt: true,
      user: { select: stageParticipantSelect },
    },
  },
  executors: {
    orderBy: { createdAt: "asc" },
    select: {
      projectId: true,
      userId: true,
      addedById: true,
      createdAt: true,
      updatedAt: true,
      user: { select: stageParticipantSelect },
    },
  },
  collaborators: {
    orderBy: { createdAt: "asc" },
    select: {
      projectId: true,
      userId: true,
      canInteract: true,
      canAddCaptions: true,
      canDownloadFiles: true,
      canViewBudget: true,
      canViewVendorInfo: true,
      canAccessProjectArchives: true,
      chatVisibilityPaused: true,
      addedById: true,
      createdAt: true,
      user: { select: stageParticipantSelect },
    },
  },
  workflowStages: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      stageKey: true,
      status: true,
      unlockedAt: true,
      completedAt: true,
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectStageAccessRecord = Prisma.ProjectGetPayload<{
  select: typeof projectStageAccessSelect;
}>;

// React cache is request-local for Server Component renders. It deduplicates the
// shared project/access read without making authorization data globally stale.
export const getProjectStageAccessRecordById = cache(
  async (projectId: string): Promise<ProjectStageAccessRecord | null> =>
    withPrismaRetry(() =>
      prisma.project.findUnique({
        where: { id: projectId },
        relationLoadStrategy: "join",
        select: projectStageAccessSelect,
      }),
    ),
);

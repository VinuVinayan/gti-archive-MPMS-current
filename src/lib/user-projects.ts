import {
  Prisma,
  ProjectRevisionStatus,
  StageStatus,
  UserRole,
} from "@prisma/client";

import { canUseProjects } from "@/lib/permissions/resolver";
import {
  buildProjectListStatusWhere,
  deriveProjectListWorkflowState,
  type ProjectBusinessStatus,
} from "@/lib/project-list-workflow";
import {
  compareProjectsByPriority,
  normalizeProjectPriority,
  type ProjectPriorityValue,
} from "@/lib/project-priority";
import {
  buildAccessibleProjectsWhere,
  type ProjectAccessUser,
} from "@/lib/projects";
import { prisma, withPrismaRetry } from "@/lib/prisma";

export const USER_PROJECT_FILTERS = [
  "ALL",
  "ACTIVE",
  "NEEDS_ATTENTION",
  "COMPLETED",
] as const;

export type UserProjectFilter = (typeof USER_PROJECT_FILTERS)[number];

export const USER_PROJECT_SORTS = [
  "priority",
  "updated",
  "name-asc",
  "name-desc",
] as const;

export type UserProjectSort = (typeof USER_PROJECT_SORTS)[number];

export type UserTaskDisplayStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "NEEDS_ATTENTION"
  | "WAITING_FOR_REVIEW"
  | "COMPLETED";

export type UserTaskDotTone =
  | "gray"
  | "blue"
  | "orange"
  | "purple"
  | "green";

export type UserTaskDisplayState = {
  status: UserTaskDisplayStatus;
  label: string;
  dotTone: UserTaskDotTone;
};

export type UserProjectDisplayStatus =
  | "NO_ASSIGNED_TASKS"
  | "IN_PROGRESS"
  | "NEEDS_ATTENTION"
  | "WAITING_FOR_REVIEW"
  | "COMPLETED";

export type UserProjectListItem = {
  id: string;
  title: string;
  description: string | null;
  owner: {
    id: string;
    name: string;
  } | null;
  status: UserProjectDisplayStatus;
  statusLabel: string;
  priority: ProjectPriorityValue;
  tasks: Array<{
    key: string;
    name: string;
    display: UserTaskDisplayState;
  }>;
  dueAt: string | null;
  updatedAt: string;
};

type UserTaskStateInput = {
  completionRequestedAt?: Date | null;
  approvedAttachmentId: string | null;
  taskerStage: {
    status: StageStatus;
    actualStartedAt: Date | null;
    completedAt: Date | null;
    revisions: Array<{
      status: ProjectRevisionStatus;
      updatedAt: Date;
    }>;
  };
};

const USER_PROJECT_PAGE_SIZE = 18;

export function deriveUserTaskDisplayState(
  task: UserTaskStateInput,
): UserTaskDisplayState {
  if (
    task.approvedAttachmentId ||
    task.taskerStage.status === StageStatus.COMPLETED ||
    task.taskerStage.completedAt
  ) {
    return {
      status: "COMPLETED",
      label: "Completed",
      dotTone: "green",
    };
  }

  if (task.completionRequestedAt) {
    return { status: "WAITING_FOR_REVIEW", label: "Waiting for Review", dotTone: "purple" };
  }

  const latestRevision = task.taskerStage.revisions[0];

  if (latestRevision?.status === ProjectRevisionStatus.REJECTED) {
    return {
      status: "NEEDS_ATTENTION",
      label: "Changes Requested",
      dotTone: "orange",
    };
  }

  if (
    latestRevision?.status === ProjectRevisionStatus.PENDING_REVIEW ||
    latestRevision?.status === ProjectRevisionStatus.APPROVED
  ) {
    return {
      status: "WAITING_FOR_REVIEW",
      label: "Waiting for Review",
      dotTone: "purple",
    };
  }

  if (
    task.taskerStage.status === StageStatus.PENDING ||
    !task.taskerStage.actualStartedAt
  ) {
    return {
      status: "NOT_STARTED",
      label: "Not Started",
      dotTone: "gray",
    };
  }

  return {
    status: "IN_PROGRESS",
    label: "In Progress",
    dotTone: "blue",
  };
}

export function deriveUserProjectDisplayStatus(
  taskStates: readonly UserTaskDisplayState[],
  businessStatus: ProjectBusinessStatus | null,
): UserProjectDisplayStatus {
  if (businessStatus === "COMPLETED") return "COMPLETED";

  if (taskStates.length === 0) return "NO_ASSIGNED_TASKS";

  if (
    taskStates.some(
      (task) =>
        task.status === "NEEDS_ATTENTION" || task.status === "NOT_STARTED",
    )
  ) {
    return "NEEDS_ATTENTION";
  }

  if (taskStates.some((task) => task.status === "WAITING_FOR_REVIEW")) {
    return "WAITING_FOR_REVIEW";
  }

  if (taskStates.some((task) => task.status === "IN_PROGRESS")) {
    return "IN_PROGRESS";
  }

  // Completing the current user's assignments does not complete the project.
  return "IN_PROGRESS";
}

function getUserProjectStatusLabel(status: UserProjectDisplayStatus) {
  switch (status) {
    case "NEEDS_ATTENTION":
      return "Needs Attention";
    case "WAITING_FOR_REVIEW":
      return "Waiting for Review";
    case "IN_PROGRESS":
      return "In Progress";
    case "COMPLETED":
      return "Completed";
    default:
      return "No Assigned Tasks";
  }
}

function projectMatchesFilter(
  status: UserProjectDisplayStatus,
  filter: UserProjectFilter,
) {
  if (filter === "NEEDS_ATTENTION") return status === "NEEDS_ATTENTION";
  return true;
}

function latestDate(values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value || Number.isNaN(value.getTime())) return latest;
    return !latest || value > latest ? value : latest;
  }, null);
}

function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email;
}

export async function getUserProjectsList(
  input: {
    filter: UserProjectFilter;
    query: string;
    sort: UserProjectSort;
    page: number;
  },
  currentUser: ProjectAccessUser,
) {
  if (
    currentUser.role !== UserRole.USER ||
    !canUseProjects(currentUser)
  ) {
    return { projects: [], total: 0, hasAnyProjects: false, pageSize: USER_PROJECT_PAGE_SIZE };
  }

  const accessibleWhere = buildAccessibleProjectsWhere(currentUser);
  const query = input.query.trim();
  const searchedWhere = query
    ? {
        AND: [
          accessibleWhere,
          {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { description: { contains: query, mode: "insensitive" as const } },
              {
                owner: {
                  is: {
                    OR: [
                      { name: { contains: query, mode: "insensitive" as const } },
                      { email: { contains: query, mode: "insensitive" as const } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      }
    : accessibleWhere;
  const lifecycleWhere: Prisma.ProjectWhereInput =
    input.filter === "ACTIVE"
      ? {
          AND: [
            buildProjectListStatusWhere("ACTIVE"),
            { archivedAt: null },
          ],
        }
      : input.filter === "COMPLETED"
        ? buildProjectListStatusWhere("COMPLETED")
        : {};
  const listWhere: Prisma.ProjectWhereInput = {
    AND: [searchedWhere, lifecycleWhere],
  };

  const [records, accessibleProjectCount] = await withPrismaRetry(() =>
    Promise.all([
      prisma.project.findMany({
        where: listWhere,
        select: {
          id: true,
          name: true,
          description: true,
          priority: true,
          updatedAt: true,
          owner: {
            select: { id: true, name: true, email: true },
          },
          workflowStages: {
            select: {
              stageKey: true,
              status: true,
              unlockedAt: true,
              completedAt: true,
            },
          },
          conceptFolders: {
            where: { assignedExecutorId: currentUser.id },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: {
              name: true,
              approvedAttachmentId: true,
              completionRequestedAt: true,
              updatedAt: true,
              taskerStage: {
                select: {
                  status: true,
                  actualStartedAt: true,
                  completedAt: true,
                  plannedDueAt: true,
                  updatedAt: true,
                  revisions: {
                    orderBy: [{ updatedAt: "desc" }, { revisionNumber: "desc" }],
                    take: 1,
                    select: {
                      status: true,
                      updatedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.project.count({ where: accessibleWhere }),
    ]),
  );

  const mapped = records.map<UserProjectListItem>((project) => {
    const taskStates = project.conceptFolders.map(deriveUserTaskDisplayState);
    const workflow = deriveProjectListWorkflowState(project);
    const status = deriveUserProjectDisplayStatus(
      taskStates,
      workflow.businessStatus,
    );
    const activeDueDates = project.conceptFolders
      .filter((_, index) => taskStates[index]?.status !== "COMPLETED")
      .map((task) => task.taskerStage.plannedDueAt)
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime());
    const userRelevantUpdatedAt = latestDate([
      project.updatedAt,
      ...project.conceptFolders.flatMap((task) => [
        task.updatedAt,
        task.taskerStage.updatedAt,
        task.taskerStage.revisions[0]?.updatedAt,
      ]),
    ]) ?? project.updatedAt;

    return {
      id: project.id,
      title: project.name,
      description: project.description?.trim() || null,
      owner: project.owner
        ? {
            id: project.owner.id,
            name: displayName(project.owner),
          }
        : null,
      status,
      statusLabel: getUserProjectStatusLabel(status),
      priority: normalizeProjectPriority(project.priority),
      tasks: project.conceptFolders.map((task, index) => ({
        key: `${project.id}-task-${index + 1}`,
        name: task.name,
        display: taskStates[index],
      })),
      dueAt: activeDueDates[0]?.toISOString() ?? null,
      updatedAt: userRelevantUpdatedAt.toISOString(),
    };
  });

  const filtered = mapped.filter((project) =>
    projectMatchesFilter(project.status, input.filter),
  );

  filtered.sort((left, right) => {
    if (input.sort === "priority") {
      return compareProjectsByPriority(
        {
          id: left.id,
          name: left.title,
          priority: left.priority,
          isCompleted: left.status === "COMPLETED",
          updatedAt: left.updatedAt,
        },
        {
          id: right.id,
          name: right.title,
          priority: right.priority,
          isCompleted: right.status === "COMPLETED",
          updatedAt: right.updatedAt,
        },
      );
    }
    if (input.sort === "name-asc") {
      return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    }
    if (input.sort === "name-desc") {
      return right.title.localeCompare(left.title, undefined, { sensitivity: "base" });
    }
    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
    );
  });

  const page = Math.max(1, Math.floor(input.page));
  const skip = (page - 1) * USER_PROJECT_PAGE_SIZE;

  return {
    projects: filtered.slice(skip, skip + USER_PROJECT_PAGE_SIZE),
    total: filtered.length,
    hasAnyProjects: accessibleProjectCount > 0,
    pageSize: USER_PROJECT_PAGE_SIZE,
  };
}

import {
  ProjectWorkflowStageKey,
  UserRole,
} from "@prisma/client";
import { unstable_cache } from "next/cache";

import {
  getNeedsAttentionItems,
  type DashboardAttentionItem,
} from "@/lib/dashboard";
import { canUseProjects, type PermissionUser } from "@/lib/permissions/resolver";
import {
  compareProjectsByPriority,
  normalizeProjectPriority,
  type ProjectPriorityValue,
} from "@/lib/project-priority";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import {
  deriveUserTaskDisplayState,
  type UserTaskDisplayState,
} from "@/lib/user-projects";

const USER_TASKS_CACHE_TAG = "projects";
const conceptTaskStageKeys = [
  ProjectWorkflowStageKey.CONCEPT_CREATION,
  ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
] as const;

export type UserTaskListItem = {
  id: string;
  name: string;
  stageNumber: 3 | 4;
  stageLabel: "Initial Concept" | "Final Concept";
  href: string;
  dueAt: string | null;
  isOverdue: boolean;
  updatedAt: string;
  display: UserTaskDisplayState;
};

export type UserTaskProjectGroup = {
  id: string;
  name: string;
  priority: ProjectPriorityValue;
  ownerName: string | null;
  openTaskCount: number;
  tasks: UserTaskListItem[];
};

export type UserTasksPageData = {
  projects: UserTaskProjectGroup[];
  attentionItems: DashboardAttentionItem[];
  summary: {
    total: number;
    open: number;
    needsAttention: number;
    waitingForReview: number;
    completed: number;
  };
};

const taskStatusOrder: Record<UserTaskDisplayState["status"], number> = {
  NEEDS_ATTENTION: 0,
  IN_PROGRESS: 1,
  NOT_STARTED: 2,
  WAITING_FOR_REVIEW: 3,
  COMPLETED: 4,
};

function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email;
}

function canListExecutorTasks(user: PermissionUser) {
  return user.role === UserRole.USER && canUseProjects(user);
}

export async function getUserTaskSidebarCount(user: PermissionUser) {
  if (!canListExecutorTasks(user)) return 0;

  return unstable_cache(
    async () =>
      withPrismaRetry(async () => {
        const projectAssignments = await prisma.projectExecutor.findMany({
          where: { userId: user.id },
          select: {
            _count: {
              select: {
                assignedConceptFolders: {
                  where: {
                    workflowStageKey: { in: [...conceptTaskStageKeys] },
                  },
                },
              },
            },
          },
        });

        return projectAssignments.reduce(
          (total, assignment) =>
            total + assignment._count.assignedConceptFolders,
          0,
        );
      }),
    ["user-task-sidebar-count-v1", user.id],
    { revalidate: 20, tags: [USER_TASKS_CACHE_TAG] },
  )();
}

export async function getUserTasksPageData(
  user: PermissionUser,
): Promise<UserTasksPageData> {
  if (!canListExecutorTasks(user)) {
    return {
      projects: [],
      attentionItems: [],
      summary: {
        total: 0,
        open: 0,
        needsAttention: 0,
        waitingForReview: 0,
        completed: 0,
      },
    };
  }

  const [records, attentionItems] = await Promise.all([
    withPrismaRetry(() =>
      prisma.projectConceptFolder.findMany({
        where: {
          assignedExecutorId: user.id,
          workflowStageKey: { in: [...conceptTaskStageKeys] },
        },
        select: {
          id: true,
          name: true,
          workflowStageKey: true,
          approvedAttachmentId: true,
          completionRequestedAt: true,
          updatedAt: true,
          project: {
            select: {
              id: true,
              name: true,
              priority: true,
              owner: {
                select: { name: true, email: true },
              },
            },
          },
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
      }),
    ),
    getNeedsAttentionItems(user),
  ]);

  const projectGroupById = new Map<
    string,
    UserTaskProjectGroup & { updatedAt: string }
  >();
  const now = Date.now();

  for (const record of records) {
    const display = deriveUserTaskDisplayState(record);
    const stageNumber =
      record.workflowStageKey === ProjectWorkflowStageKey.CONCEPT_CREATION
        ? 3
        : 4;
    const latestUpdatedAt = [
      record.updatedAt,
      record.taskerStage.updatedAt,
      record.taskerStage.revisions[0]?.updatedAt,
    ].reduce<Date>(
      (latest, value) => (value && value > latest ? value : latest),
      record.updatedAt,
    );
    const task: UserTaskListItem = {
      id: record.id,
      name: record.name,
      stageNumber,
      stageLabel: stageNumber === 3 ? "Initial Concept" : "Final Concept",
      href: `/projects/${encodeURIComponent(record.project.id)}/stages/${stageNumber}/concepts/${encodeURIComponent(record.id)}?returnTo=%2Ftasks`,
      dueAt:
        display.status === "COMPLETED"
          ? null
          : record.taskerStage.plannedDueAt?.toISOString() ?? null,
      isOverdue: Boolean(
        display.status !== "COMPLETED" &&
          record.taskerStage.plannedDueAt &&
          record.taskerStage.plannedDueAt.getTime() < now,
      ),
      updatedAt: latestUpdatedAt.toISOString(),
      display,
    };
    const existingGroup = projectGroupById.get(record.project.id);

    if (existingGroup) {
      existingGroup.tasks.push(task);
      existingGroup.openTaskCount += Number(display.status !== "COMPLETED");
      if (latestUpdatedAt > new Date(existingGroup.updatedAt)) {
        existingGroup.updatedAt = latestUpdatedAt.toISOString();
      }
      continue;
    }

    projectGroupById.set(record.project.id, {
      id: record.project.id,
      name: record.project.name,
      priority: normalizeProjectPriority(record.project.priority),
      ownerName: record.project.owner ? displayName(record.project.owner) : null,
      openTaskCount: Number(display.status !== "COMPLETED"),
      tasks: [task],
      updatedAt: latestUpdatedAt.toISOString(),
    });
  }

  const projects = [...projectGroupById.values()]
    .map((project) => ({
      ...project,
      tasks: project.tasks.sort((left, right) => {
        const statusOrder =
          taskStatusOrder[left.display.status] -
          taskStatusOrder[right.display.status];
        const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Infinity;
        const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Infinity;

        return (
          statusOrder ||
          leftDueAt - rightDueAt ||
          new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime() ||
          left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
        );
      }),
    }))
    .sort((left, right) => {
      const attentionOrder =
        Number(!left.tasks.some((task) => task.display.status === "NEEDS_ATTENTION")) -
        Number(!right.tasks.some((task) => task.display.status === "NEEDS_ATTENTION"));

      return (
        attentionOrder ||
        compareProjectsByPriority(
          {
            id: left.id,
            name: left.name,
            priority: left.priority,
            isCompleted: left.openTaskCount === 0,
            updatedAt: left.updatedAt,
          },
          {
            id: right.id,
            name: right.name,
            priority: right.priority,
            isCompleted: right.openTaskCount === 0,
            updatedAt: right.updatedAt,
          },
        )
      );
    })
    .map((project) => ({
      id: project.id,
      name: project.name,
      priority: project.priority,
      ownerName: project.ownerName,
      openTaskCount: project.openTaskCount,
      tasks: project.tasks,
    }));
  const tasks = projects.flatMap((project) => project.tasks);

  return {
    projects,
    attentionItems,
    summary: {
      total: tasks.length,
      open: tasks.filter((task) => task.display.status !== "COMPLETED").length,
      needsAttention: attentionItems.length,
      waitingForReview: tasks.filter(
        (task) => task.display.status === "WAITING_FOR_REVIEW",
      ).length,
      completed: tasks.filter((task) => task.display.status === "COMPLETED").length,
    },
  };
}

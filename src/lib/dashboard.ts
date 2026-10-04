import {
  FlexibleMilestoneStatus,
  FlexibleProjectStatus,
  ProductionApprovalStepStatus,
  ProductionDispatchStatus,
  ProductionHandoverDeliveryStatus,
  ProjectFileChecklistRequestChannel,
  ProjectFileChecklistRequestWorkflowStatus,
  ProjectProductionUnitStatus,
  ProjectRevisionStatus,
  ProjectWorkflowStageKey,
  StageStatus,
  UserRole,
  type Prisma,
  type ProjectExecutionType,
  type ProjectPriority,
  type User,
} from "@prisma/client";

import {
  calculateFlexibleProjectProgress,
  canManageFlexibleMilestones,
  canManageFlexibleProject,
  getFlexibleProjectAccessWhere,
} from "@/lib/flexible-projects";
import {
  deriveProjectListWorkflowState,
  type ProjectListWorkflowState,
} from "@/lib/project-list-workflow";
import {
  canUseProjects,
  hasPermission,
  hasProjectPermission,
  isGlobalProjectAdministrator,
  type PermissionUser,
} from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { STAGE_FIVE_FIELD_LABELS } from "@/lib/stage-five-fields";

type DashboardUser = Pick<User, "id" | "role"> &
  PermissionUser;

export type DashboardKpiIcon =
  | "projects"
  | "active"
  | "attention"
  | "completed";

export type DashboardKpi = {
  label: string;
  value: number;
  note: string;
  href: string;
  icon: DashboardKpiIcon;
  tone: "green" | "amber";
};

export type DashboardAttentionItem = {
  id: string;
  severity: "critical" | "warning" | "info";
  kind:
    | "deadline"
    | "review"
    | "revision"
    | "request"
    | "approval";
  title: string;
  detail: string;
  projectName: string;
  href: string;
  actionLabel: string;
  sortAt: string;
};

export type DashboardDeadlineItem = {
  id: string;
  projectName: string;
  detail: string;
  stageLabel: string;
  dateLabel: string;
  statusLabel: string;
  tone: "critical" | "warning" | "standard";
  href: string;
  dueAt: string;
};

export type DashboardStageSummary = {
  number: number;
  name: string;
  count: number;
  href: string;
};

export type DashboardWorkSummaryItem = {
  id: string;
  label: string;
  count: number;
  href: string;
  tone: "blue" | "amber" | "red" | "green";
};

export type DashboardRecentProject = {
  id: string;
  name: string;
  href: string;
  stageNumber: number | null;
  stageName: string | null;
  businessStatus: ProjectListWorkflowState["businessStatus"];
  workflowDiagnosticLabel: ProjectListWorkflowState["workflowDiagnosticLabel"];
  ownerName: string;
  ownerInitials: string;
  updatedLabel: string;
};

export type DashboardFlexibleProject = {
  id: string;
  name: string;
  href: string;
  status: FlexibleProjectStatus;
  priority: ProjectPriority;
  scope: ProjectExecutionType;
  progress: number;
  completedMilestones: number;
  totalMilestones: number;
  ownerName: string;
  ownerInitials: string;
  deadlineLabel: string;
  deadlineStatusLabel: string | null;
  deadlineTone: "critical" | "warning" | "standard" | "muted";
};

export type DashboardSnapshot = {
  kpis: DashboardKpi[];
  attention: DashboardAttentionItem[];
  attentionCount: number;
  deadlines: DashboardDeadlineItem[];
  stages: DashboardStageSummary[];
  myWork: DashboardWorkSummaryItem[];
  flexibleProjects: DashboardFlexibleProject[];
  flexibleProjectCount: number;
  flexibleActiveCount: number;
  flexibleCompletedCount: number;
  canViewFlexibleProjects: boolean;
  recentProjects: DashboardRecentProject[];
  canViewRecentProjects: boolean;
  scopeLabel: string;
};

const projectSelect = {
  id: true,
  name: true,
  ownerId: true,
  completedAt: true,
  archivedAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  closure: { select: { id: true } },
  inquiry: { select: { deadline: true } },
  coOwners: { select: { userId: true } },
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
  stageInstances: { where: { retiredAt: null }, orderBy: { order: "asc" }, select: { order: true, name: true, status: true } },
  workflowStages: {
    select: {
      stageKey: true,
      status: true,
      unlockedAt: true,
      completedAt: true,
    },
  },
} satisfies Prisma.ProjectSelect;

type DashboardProject = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

const flexibleProjectSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  priority: true,
  scope: true,
  deadline: true,
  ownerId: true,
  updatedAt: true,
  owner: { select: { name: true, email: true } },
  collaborators: { select: { userId: true } },
  milestones: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      deadline: true,
      responsibleUserId: true,
    },
  },
} satisfies Prisma.FlexibleProjectSelect;

type DashboardFlexibleProjectRecord = Prisma.FlexibleProjectGetPayload<{
  select: typeof flexibleProjectSelect;
}>;

type ProjectSummary = {
  project: DashboardProject;
  workflow: ProjectListWorkflowState;
};

type DeadlineCandidate = Omit<DashboardDeadlineItem, "dateLabel" | "statusLabel" | "tone"> & {
  dueAtDate: Date;
};

type WorkCounter = {
  id: string;
  label: string;
  count: number;
  href: string;
  tone: DashboardWorkSummaryItem["tone"];
};

type AttentionCandidate = {
  dedupeKey: string;
  priority: number;
  item: DashboardAttentionItem;
};

const attentionRank: Record<DashboardAttentionItem["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function dashboardProjectWhere(user: DashboardUser): Prisma.ProjectWhereInput {
  if (!hasPermission(user, "project.view")) {
    return { id: "__dashboard_permission_denied__" };
  }

  if (isGlobalProjectAdministrator(user)) return {};

  return {
    OR: [
      { ownerId: user.id },
      { coOwners: { some: { userId: user.id } } },
      { executors: { some: { userId: user.id } } },
      { collaborators: { some: { userId: user.id } } },
    ],
  };
}

function toDate(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dayDifference(from: Date, to: Date) {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

function formatDeadline(dueAt: Date, now: Date) {
  const days = dayDifference(now, dueAt);
  const dateLabel =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : dueAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            ...(dueAt.getFullYear() !== now.getFullYear()
              ? { year: "numeric" as const }
              : {}),
          });

  if (days < 0) {
    const overdueDays = Math.abs(days);
    return {
      dateLabel,
      statusLabel: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}`,
      tone: "critical" as const,
    };
  }

  if (days === 0) {
    return { dateLabel, statusLabel: "Due today", tone: "critical" as const };
  }

  if (days === 1) {
    return { dateLabel, statusLabel: "Due tomorrow", tone: "warning" as const };
  }

  return {
    dateLabel,
    statusLabel: `Due in ${days} days`,
    tone: "standard" as const,
  };
}

function formatRecentTime(value: Date | string | number, now: Date) {
  const date = toDate(value);
  const days = dayDifference(now, date);
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (days === 0) return `Today, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFlexibleProjectDeadline(value: Date | null, now: Date) {
  if (!value) {
    return {
      deadlineLabel: "No deadline",
      deadlineStatusLabel: null,
      deadlineTone: "muted" as const,
    };
  }

  const formatted = formatDeadline(value, now);
  return {
    deadlineLabel: value.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    deadlineStatusLabel: formatted.statusLabel,
    deadlineTone: formatted.tone,
  };
}

function displayName(person: { name: string | null; email: string } | null) {
  return person?.name?.trim() || person?.email || "Unassigned";
}

function initials(name: string) {
  const value = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return value || "—";
}

function stageNumberForConcept(key: ProjectWorkflowStageKey) {
  return key === ProjectWorkflowStageKey.PROJECT_DEVELOPMENT ? 4 : 3;
}

function sampleRoundLabel(round: {
  sequence: number;
  name: string;
}) {
  return `${round.name} · Round ${round.sequence}`;
}

function addWork(counter: Map<string, WorkCounter>, item: WorkCounter) {
  const existing = counter.get(item.id);
  counter.set(item.id, {
    ...item,
    count: (existing?.count ?? 0) + item.count,
    href: existing?.href ?? item.href,
  });
}

function addAttention(
  items: AttentionCandidate[],
  item: DashboardAttentionItem,
  options?: {
    dedupeKey?: string;
    priority?: number;
  },
) {
  const dedupeKey = options?.dedupeKey ?? item.id;
  const priority = options?.priority ?? 0;
  const existingIndex = items.findIndex(
    (candidate) => candidate.dedupeKey === dedupeKey,
  );

  if (existingIndex === -1) {
    items.push({ dedupeKey, priority, item });
    return;
  }

  if (priority > items[existingIndex].priority) {
    items[existingIndex] = { dedupeKey, priority, item };
  }
}

function buildKpis(input: {
  user: DashboardUser;
  summaries: ProjectSummary[];
  flexibleProjects: DashboardFlexibleProjectRecord[];
  attentionCount: number;
  assignedConceptCount: number;
  openRequestCount: number;
  completedRequestCount: number;
}) {
  const { user, summaries, flexibleProjects } = input;
  const activeArtwork = summaries.filter(
    (item) =>
      item.workflow.businessStatus === "ACTIVE" && !item.project.archivedAt,
  ).length;
  const completedArtwork = summaries.filter(
    (item) => item.workflow.businessStatus === "COMPLETED",
  ).length;
  const activeFlexible = flexibleProjects.filter(
    (project) => project.status === FlexibleProjectStatus.ACTIVE,
  ).length;
  const completedFlexible = flexibleProjects.filter(
    (project) => project.status === FlexibleProjectStatus.COMPLETED,
  ).length;
  const active = activeArtwork + activeFlexible;
  const completed = completedArtwork + completedFlexible;
  const isGlobalAdministrator = isGlobalProjectAdministrator(user);
  const isManager = summaries.some(
    ({ project }) =>
      project.ownerId === user.id ||
      project.coOwners.some((coOwner) => coOwner.userId === user.id),
  ) || flexibleProjects.some((project) => project.ownerId === user.id);
  const isExecutor = summaries.some(({ project }) =>
    project.executors.some((executor) => executor.userId === user.id),
  );
  const isCollaborator = summaries.some(({ project }) =>
    project.collaborators.some((collaborator) => collaborator.userId === user.id),
  ) || flexibleProjects.some((project) =>
    project.collaborators.some((collaborator) => collaborator.userId === user.id),
  );
  const relationshipCount = [isManager, isExecutor, isCollaborator].filter(Boolean).length;

  let totalLabel = "Accessible Projects";
  let activeLabel = "Active Work";
  let activeValue = active;
  let activeNote = "Across your project relationships";
  let completedLabel = "Completed Work";
  let completedValue = completed;
  let completedNote = "Finished accessible projects";

  if (isGlobalAdministrator) {
    totalLabel = "Total Projects";
    activeLabel = "Active Projects";
    activeNote = "Currently in progress";
    completedLabel = "Completed";
    completedNote = "Finished projects";
  } else if (relationshipCount === 1 && isManager) {
    totalLabel = "My Projects";
    activeLabel = "Active Projects";
    activeNote = "You own or co-own";
    completedLabel = "Completed";
    completedNote = "Delivered projects";
  } else if (
    relationshipCount === 1 &&
    isExecutor &&
    flexibleProjects.length === 0
  ) {
    activeLabel = "Active Assignments";
    activeValue = input.assignedConceptCount;
    activeNote = "Concept briefs and revisions";
    completedNote = "Finished project assignments";
  } else if (
    relationshipCount === 1 &&
    isCollaborator &&
    flexibleProjects.length === 0
  ) {
    activeLabel = "Open Requests";
    activeValue = input.openRequestCount;
    activeNote = "Waiting for your response";
    completedLabel = "Completed Requests";
    completedValue = input.completedRequestCount;
    completedNote = "Requests you have finished";
  }

  return [
    {
      label: totalLabel,
      value: summaries.length + flexibleProjects.length,
      note: isGlobalAdministrator
        ? "Artwork + flexible portfolio"
        : "Based on your project relationships",
      href: "/projects",
      icon: "projects" as const,
      tone: "green" as const,
    },
    {
      label: activeLabel,
      value: activeValue,
      note: activeNote,
      href:
        flexibleProjects.length > 0
          ? "/projects"
          : "/projects?status=ACTIVE",
      icon: "active" as const,
      tone: "green" as const,
    },
    {
      label: "Needs Attention",
      value: input.attentionCount,
      note:
        input.attentionCount === 0
          ? "Nothing waiting on you"
          : "Actionable by you now",
      href: "#needs-attention",
      icon: "attention" as const,
      tone: "amber" as const,
    },
    {
      label: completedLabel,
      value: completedValue,
      note: completedNote,
      href:
        flexibleProjects.length > 0
          ? "/projects"
          : "/projects?status=COMPLETED",
      icon: "completed" as const,
      tone: "green" as const,
    },
  ];
}

/**
 * Builds the operational dashboard from the fixed artwork workflow and the
 * milestone-based flexible workflow. Business administrators receive a global
 * portfolio; standard users remain relationship-scoped in both project types.
 */
async function buildDashboardSnapshot(
  user: DashboardUser,
  now = new Date(),
) {
  const canViewRecentProjects = hasPermission(
    user,
    "dashboard.viewRecentProjects",
  );
  const canViewFlexibleProjects = canUseProjects(user);
  const [projects, flexibleProjects] = await Promise.all([
    withPrismaRetry(() =>
      prisma.project.findMany({
        where: dashboardProjectWhere(user),
        select: projectSelect,
        orderBy: { updatedAt: "desc" },
      }),
    ),
    withPrismaRetry(() =>
      prisma.flexibleProject.findMany({
        where: getFlexibleProjectAccessWhere(user),
        select: flexibleProjectSelect,
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      }),
    ),
  ]);
  const summaries: ProjectSummary[] = projects.map((project) => ({
    project,
    workflow: deriveProjectListWorkflowState(project),
  }));
  const projectById = new Map(summaries.map((item) => [item.project.id, item]));
  const activeProjectIds = summaries
    .filter(
      (item) =>
        item.workflow.businessStatus === "ACTIVE" && !item.project.archivedAt,
    )
    .map((item) => item.project.id);

  const [conceptFolders, checklistRequests, productionUnits, sampleRounds] =
    activeProjectIds.length === 0
      ? [[], [], [], []] as const
      : await Promise.all([
          withPrismaRetry(() =>
            prisma.projectConceptFolder.findMany({
              where: {
                projectId: { in: activeProjectIds },
                workflowStageKey: {
                  in: [
                    ProjectWorkflowStageKey.CONCEPT_CREATION,
                    ProjectWorkflowStageKey.PROJECT_DEVELOPMENT,
                  ],
                },
              },
              select: {
                id: true,
                projectId: true,
                name: true,
                workflowStageKey: true,
                assignedExecutorId: true,
                approvedAt: true,
                taskerStage: {
                  select: {
                    actualStartedAt: true,
                    plannedDueAt: true,
                    status: true,
                    revisions: {
                      orderBy: { revisionNumber: "desc" },
                      take: 1,
                      select: {
                        id: true,
                        revisionNumber: true,
                        status: true,
                        rejectionReason: true,
                        createdAt: true,
                        updatedAt: true,
                        createdBy: { select: { name: true, email: true } },
                      },
                    },
                  },
                },
              },
            }),
          ),
          withPrismaRetry(() =>
            prisma.projectFileChecklistRequest.findMany({
              where: { projectId: { in: activeProjectIds } },
              select: {
                id: true,
                projectId: true,
                fieldKey: true,
                channel: true,
                recipientUserId: true,
                workflowStatus: true,
                requestedAt: true,
                completedAt: true,
                updatedAt: true,
                checklist: {
                  select: {
                    handoffId: true,
                    sourceAttachment: { select: { originalFileName: true } },
                  },
                },
              },
            }),
          ),
          withPrismaRetry(() =>
            prisma.projectProductionUnit.findMany({
              where: { projectId: { in: activeProjectIds } },
              select: {
                id: true,
                projectId: true,
                status: true,
                updatedAt: true,
                sourceAttachment: { select: { originalFileName: true } },
                approvalSteps: {
                  where: { removedAt: null },
                  select: {
                    id: true,
                    status: true,
                    dispatchStatus: true,
                    recipientUserId: true,
                    updatedAt: true,
                    failureMessage: true,
                  },
                  orderBy: { sequence: "asc" },
                },
                handover: {
                  select: {
                    deliveryStatus: true,
                    failedAt: true,
                    failureMessage: true,
                    updatedAt: true,
                  },
                },
              },
            }),
          ),
          withPrismaRetry(() =>
            prisma.productionSampleRound.findMany({
              where: {
                projectId: { in: activeProjectIds },
                decision: null,
              },
              select: {
                id: true,
                projectId: true,
                sequence: true,
                name: true,
                deadline: true,
                updatedAt: true,
                supervision: { select: { productionUnitId: true } },
              },
            }),
          ),
        ]);

  const attention: AttentionCandidate[] = [];
  const deadlineCandidates: DeadlineCandidate[] = [];
  const work = new Map<string, WorkCounter>();
  let assignedConceptCount = 0;
  let openRequestCount = 0;
  let completedRequestCount = 0;

  for (const project of flexibleProjects) {
    if (project.status !== FlexibleProjectStatus.ACTIVE) continue;

    const projectHref = `/projects/flexible/${project.slug}`;
    const accessContext = {
      ownerId: project.ownerId,
      collaborators: project.collaborators,
    };
    const canManageProject = canManageFlexibleProject(user, accessContext);
    const canManageMilestones = canManageFlexibleMilestones(user, accessContext);

    if (project.deadline) {
      const dueAt = toDate(project.deadline);
      deadlineCandidates.push({
        id: `flexible-project:${project.id}:deadline`,
        projectName: project.name,
        detail: "Project deadline",
        stageLabel: "Private project",
        href: projectHref,
        dueAt: dueAt.toISOString(),
        dueAtDate: dueAt,
      });

      if (
        canManageProject &&
        dueAt.getTime() < startOfDay(now).getTime()
      ) {
        addAttention(attention, {
          id: `flexible-project-overdue:${project.id}`,
          severity: "critical",
          kind: "deadline",
          title: "Private project deadline overdue",
          detail: "Review the milestone timeline and project deadline.",
          projectName: project.name,
          href: projectHref,
          actionLabel: "Open timeline",
          sortAt: dueAt.toISOString(),
        });
        addWork(work, {
          id: "overdue",
          label: "Overdue deadlines",
          count: 1,
          href: projectHref,
          tone: "red",
        });
      }
    }

    for (const milestone of project.milestones) {
      if (milestone.status === FlexibleMilestoneStatus.COMPLETED) continue;

      const milestoneHref = `${projectHref}/milestones/${milestone.id}`;
      const isAssigned = milestone.responsibleUserId === user.id;

      if (isAssigned) {
        addWork(work, {
          id: "flexible-milestones",
          label: "Flexible milestones assigned",
          count: 1,
          href: milestoneHref,
          tone: "green",
        });
      }

      if (!milestone.deadline) continue;
      const dueAt = toDate(milestone.deadline);
      deadlineCandidates.push({
        id: `flexible-milestone:${milestone.id}:deadline`,
        projectName: project.name,
        detail: milestone.name,
        stageLabel: "Flexible milestone",
        href: milestoneHref,
        dueAt: dueAt.toISOString(),
        dueAtDate: dueAt,
      });

      if (
        (isAssigned || canManageMilestones) &&
        dueAt.getTime() < startOfDay(now).getTime()
      ) {
        addAttention(attention, {
          id: `flexible-milestone-overdue:${milestone.id}`,
          severity: "critical",
          kind: "deadline",
          title: "Flexible milestone overdue",
          detail: milestone.name,
          projectName: project.name,
          href: milestoneHref,
          actionLabel: isAssigned ? "Open milestone" : "Review timeline",
          sortAt: dueAt.toISOString(),
        });
        addWork(work, {
          id: "overdue",
          label: "Overdue deadlines",
          count: 1,
          href: milestoneHref,
          tone: "red",
        });
      }
    }
  }

  for (const { project, workflow } of summaries) {
    if (
      workflow.businessStatus !== "ACTIVE" ||
      !project.inquiry?.deadline
    ) {
      continue;
    }
    if (!hasProjectPermission(user, project, "stage.updateTimeline")) continue;

    const dueAt = toDate(project.inquiry.deadline);
    const href = `/projects/${project.id}/stages/1`;
    deadlineCandidates.push({
      id: `inquiry:${project.id}`,
      projectName: project.name,
      detail: "Project inquiry deadline",
      stageLabel: "Stage 1",
      href,
      dueAt: dueAt.toISOString(),
      dueAtDate: dueAt,
    });

    if (dueAt.getTime() < startOfDay(now).getTime()) {
      addAttention(attention, {
        id: `inquiry-overdue:${project.id}`,
        severity: "critical",
        kind: "deadline",
        title: "Project inquiry deadline overdue",
        detail: "Review the inquiry timeline and update the deadline.",
        projectName: project.name,
        href,
        actionLabel: "Open stage",
        sortAt: dueAt.toISOString(),
      });
      addWork(work, {
        id: "overdue",
        label: "Overdue deadlines",
        count: 1,
        href,
        tone: "red",
      });
    }
  }

  for (const folder of conceptFolders) {
    const summary = projectById.get(folder.projectId);
    if (!summary) continue;
    const { project } = summary;
    const stageNumber = stageNumberForConcept(folder.workflowStageKey);
    const href = `/projects/${project.id}/stages/${stageNumber}/concepts/${folder.id}`;
    const latestRevision = folder.taskerStage.revisions[0] ?? null;
    const isAssigned = folder.assignedExecutorId === user.id;
    const canReview = hasProjectPermission(user, project, "stage.reviewSubmission");
    const isOpen =
      !folder.approvedAt && folder.taskerStage.status !== StageStatus.COMPLETED;

    if (isAssigned && isOpen) assignedConceptCount += 1;

    if (isAssigned && isOpen) {
      addWork(work, {
        id: "assigned-concepts",
        label: "Assigned concepts",
        count: 1,
        href,
        tone: "blue",
      });
    }

    if (
      isAssigned &&
      isOpen &&
      !folder.taskerStage.actualStartedAt &&
      !latestRevision
    ) {
      addAttention(
        attention,
        {
          id: `brief:${folder.id}`,
          severity: "info",
          kind: "request",
          title: "Brief waiting to be accepted",
          detail: `${folder.name} · Stage ${stageNumber}`,
          projectName: project.name,
          href,
          actionLabel: "Review brief",
          sortAt: project.updatedAt.toISOString(),
        },
        { dedupeKey: `concept:${folder.id}`, priority: 300 },
      );
      addWork(work, {
        id: "briefs",
        label: "Briefs to accept",
        count: 1,
        href,
        tone: "amber",
      });
    }

    if (
      isAssigned &&
      isOpen &&
      latestRevision?.status === ProjectRevisionStatus.REJECTED
    ) {
      addAttention(
        attention,
        {
          id: `revision:${latestRevision.id}`,
          severity: "warning",
          kind: "revision",
          title: "Changes requested",
          detail:
            latestRevision.rejectionReason?.trim() ||
            `${folder.name} · Revision ${latestRevision.revisionNumber}`,
          projectName: project.name,
          href,
          actionLabel: "Open revision",
          sortAt: latestRevision.updatedAt.toISOString(),
        },
        { dedupeKey: `concept:${folder.id}`, priority: 400 },
      );
      addWork(work, {
        id: "changes",
        label: "Changes requested",
        count: 1,
        href,
        tone: "red",
      });
    }

    if (
      canReview &&
      isOpen &&
      latestRevision?.status === ProjectRevisionStatus.PENDING_REVIEW
    ) {
      addAttention(
        attention,
        {
          id: `review:${latestRevision.id}`,
          severity: "info",
          kind: "review",
          title: "Revision awaiting review",
          detail: `${folder.name} · Revision ${latestRevision.revisionNumber} by ${displayName(latestRevision.createdBy)}`,
          projectName: project.name,
          href,
          actionLabel: "Review",
          sortAt: latestRevision.createdAt.toISOString(),
        },
        { dedupeKey: `concept:${folder.id}`, priority: 350 },
      );
      addWork(work, {
        id: "reviews",
        label: "Revisions awaiting review",
        count: 1,
        href,
        tone: "blue",
      });
    }

    if (
      isAssigned &&
      latestRevision?.status === ProjectRevisionStatus.PENDING_REVIEW
    ) {
      addWork(work, {
        id: "submitted",
        label: "Submissions in review",
        count: 1,
        href,
        tone: "blue",
      });
    }

    if (
      isOpen &&
      folder.taskerStage.plannedDueAt &&
      (isAssigned || hasProjectPermission(user, project, "stage.updateTimeline"))
    ) {
      const dueAt = toDate(folder.taskerStage.plannedDueAt);
      deadlineCandidates.push({
        id: `concept:${folder.id}`,
        projectName: project.name,
        detail: folder.name,
        stageLabel: `Stage ${stageNumber}`,
        href,
        dueAt: dueAt.toISOString(),
        dueAtDate: dueAt,
      });

      const executorIsWaitingForReview =
        isAssigned &&
        (latestRevision?.status === ProjectRevisionStatus.PENDING_REVIEW ||
          latestRevision?.status === ProjectRevisionStatus.APPROVED);

      if (
        dueAt.getTime() < startOfDay(now).getTime() &&
        !executorIsWaitingForReview
      ) {
        addAttention(
          attention,
          {
            id: `concept-overdue:${folder.id}`,
            severity: "critical",
            kind: "deadline",
            title: `Stage ${stageNumber} deadline overdue`,
            detail: folder.name,
            projectName: project.name,
            href,
            actionLabel: isAssigned ? "Open work" : "Review timeline",
            sortAt: dueAt.toISOString(),
          },
          { dedupeKey: `concept:${folder.id}`, priority: 200 },
        );
        addWork(work, {
          id: "overdue",
          label: "Overdue deadlines",
          count: 1,
          href,
          tone: "red",
        });
      }
    }
  }

  for (const request of checklistRequests) {
    const summary = projectById.get(request.projectId);
    if (!summary) continue;
    const { project, workflow } = summary;
    const fieldLabel = STAGE_FIVE_FIELD_LABELS[request.fieldKey];
    const fileName = request.checklist.sourceAttachment.originalFileName;
    const personalRequest =
      request.channel === ProjectFileChecklistRequestChannel.IN_APP &&
      request.recipientUserId === user.id;
    const isOpen =
      request.workflowStatus ===
        ProjectFileChecklistRequestWorkflowStatus.REQUESTED ||
      request.workflowStatus ===
        ProjectFileChecklistRequestWorkflowStatus.ACCEPTED;

    if (personalRequest && isOpen) {
      const href = `/requests/checklist/${request.id}`;
      openRequestCount += 1;
      addAttention(attention, {
        id: `checklist:${request.id}`,
        severity: "warning",
        kind: "request",
        title: "Information requested",
        detail: `${fieldLabel} · ${fileName}`,
        projectName: project.name,
        href,
        actionLabel: "Respond",
        sortAt: request.requestedAt.toISOString(),
      });
      addWork(work, {
        id: "checklist",
        label: "Checklist requests pending",
        count: 1,
        href,
        tone: "green",
      });
    }

    if (
      personalRequest &&
      request.workflowStatus ===
        ProjectFileChecklistRequestWorkflowStatus.COMPLETED
    ) {
      completedRequestCount += 1;
      addWork(work, {
        id: "responses-submitted",
        label: "Responses submitted",
        count: 1,
        href: `/requests/checklist/${request.id}`,
        tone: "green",
      });
    }

    if (
      workflow.currentStageNumber === 5 &&
      request.workflowStatus ===
        ProjectFileChecklistRequestWorkflowStatus.COMPLETED &&
      hasProjectPermission(user, project, "stage.markStageComplete")
    ) {
      const href = `/projects/${project.id}/stages/5?file=${encodeURIComponent(request.checklist.handoffId)}&field=${encodeURIComponent(request.fieldKey)}&mode=view`;
      addAttention(attention, {
        id: `checklist-response:${request.id}`,
        severity: "info",
        kind: "request",
        title: "Requested information received",
        detail: `${fieldLabel} · ${fileName}`,
        projectName: project.name,
        href,
        actionLabel: "Review response",
        sortAt: (request.completedAt ?? request.updatedAt).toISOString(),
      });
      addWork(work, {
        id: "responses",
        label: "Checklist responses to review",
        count: 1,
        href,
        tone: "green",
      });
    }
  }

  for (const unit of productionUnits) {
    const summary = projectById.get(unit.projectId);
    if (!summary) continue;
    const { project } = summary;
    const unitHref = `/projects/${project.id}/stages/6?unit=${encodeURIComponent(unit.id)}`;
    const fileName = unit.sourceAttachment.originalFileName;
    const canManage = hasProjectPermission(
      user,
      project,
      "stage.markStageComplete",
    );

    for (const step of unit.approvalSteps) {
      const personal = step.recipientUserId === user.id;
      if (
        personal &&
        step.status === ProductionApprovalStepStatus.ACTIVE &&
        step.dispatchStatus === ProductionDispatchStatus.SENT
      ) {
        const href = `/production-approvals/${step.id}`;
        openRequestCount += 1;
        addAttention(attention, {
          id: `approval:${step.id}`,
          severity: "warning",
          kind: "approval",
          title: "Approval waiting for your decision",
          detail: fileName,
          projectName: project.name,
          href,
          actionLabel: "Review approval",
          sortAt: step.updatedAt.toISOString(),
        });
        addWork(work, {
          id: "approvals",
          label: "Approvals to decide",
          count: 1,
          href,
          tone: "amber",
        });
      }

      if (
        personal &&
        (step.status === ProductionApprovalStepStatus.APPROVED ||
          step.status === ProductionApprovalStepStatus.REJECTED)
      ) {
        completedRequestCount += 1;
      }

      if (
        canManage &&
        step.dispatchStatus === ProductionDispatchStatus.FAILED
      ) {
        addAttention(attention, {
          id: `approval-failed:${step.id}`,
          severity: "critical",
          kind: "approval",
          title: "Approval delivery failed",
          detail: step.failureMessage?.trim() || fileName,
          projectName: project.name,
          href: unitHref,
          actionLabel: "Resolve",
          sortAt: step.updatedAt.toISOString(),
        });
      }
    }

    if (canManage && unit.status === ProjectProductionUnitStatus.REJECTED) {
      addAttention(attention, {
        id: `unit-rejected:${unit.id}`,
        severity: "warning",
        kind: "revision",
        title: "Production approval rejected",
        detail: fileName,
        projectName: project.name,
        href: unitHref,
        actionLabel: "Review decision",
        sortAt: unit.updatedAt.toISOString(),
      });
    }

    if (
      canManage &&
      unit.handover?.deliveryStatus ===
        ProductionHandoverDeliveryStatus.FAILED
    ) {
      addAttention(attention, {
        id: `handover-failed:${unit.id}`,
        severity: "critical",
        kind: "approval",
        title: "Production handover failed",
        detail: unit.handover.failureMessage?.trim() || fileName,
        projectName: project.name,
        href: unitHref,
        actionLabel: "Resolve",
        sortAt: (unit.handover.failedAt ?? unit.handover.updatedAt).toISOString(),
      });
    }

    if (canManage && unit.status === ProjectProductionUnitStatus.APPROVAL_PENDING) {
      addWork(work, {
        id: "approval-progress",
        label: "Approvals in progress",
        count: 1,
        href: unitHref,
        tone: "amber",
      });
    }
  }

  for (const round of sampleRounds) {
    const summary = projectById.get(round.projectId);
    if (!summary) continue;
    const { project } = summary;
    const canManage = hasProjectPermission(
      user,
      project,
      "stage.markStageComplete",
    );
    if (!canManage) continue;

    const href = `/projects/${project.id}/stages/7?unit=${encodeURIComponent(round.supervision.productionUnitId)}&round=${encodeURIComponent(round.id)}`;
    const roundLabel = sampleRoundLabel(round);
    const dueAt = toDate(round.deadline);
    deadlineCandidates.push({
      id: `sample:${round.id}:deadline`,
      projectName: project.name,
      detail: roundLabel,
      stageLabel: "Stage 7",
      href,
      dueAt: dueAt.toISOString(),
      dueAtDate: dueAt,
    });

    if (canManage && dueAt.getTime() < startOfDay(now).getTime()) {
      addAttention(attention, {
        id: `sample-overdue:${round.id}:deadline`,
        severity: "critical",
        kind: "deadline",
        title: "Physical sample request overdue",
        detail: roundLabel,
        projectName: project.name,
        href,
        actionLabel: "Open request",
        sortAt: dueAt.toISOString(),
      });
      addWork(work, {
        id: "overdue",
        label: "Overdue deadlines",
        count: 1,
        href,
        tone: "red",
      });
    }
  }

  attention.sort((left, right) => {
    const severity =
      attentionRank[left.item.severity] - attentionRank[right.item.severity];
    if (severity !== 0) return severity;
    return (
      toDate(left.item.sortAt).getTime() - toDate(right.item.sortAt).getTime()
    );
  });
  const attentionItems = attention.map((candidate) => candidate.item);

  const deadlines = deadlineCandidates
    .sort((left, right) => left.dueAtDate.getTime() - right.dueAtDate.getTime())
    .slice(0, 5)
    .map(({ dueAtDate, ...candidate }) => ({
      ...candidate,
      ...formatDeadline(dueAtDate, now),
    }));

  const activeSummaries = summaries.filter(({project,workflow}) => workflow.businessStatus === "ACTIVE" && !project.archivedAt);
  const stageNumbers = [...new Set(activeSummaries.map(({workflow})=>workflow.currentStageNumber).filter((number):number is number=>number!==null))].sort((a,b)=>a-b);
  const stages = stageNumbers.map(number => {
    const matching = activeSummaries.filter(({workflow})=>workflow.currentStageNumber===number);
    const names = [...new Set(matching.map(({workflow})=>workflow.currentStageName))];
    return { number, name: names.length===1 ? names[0]! : "Across project templates", count: matching.length, href: `/projects?status=ACTIVE&stage=${number}` };
  });

  const flexibleProjectCards = flexibleProjects.slice(0, 3).map((project) => {
    const totalMilestones = project.milestones.length;
    const completedMilestones = project.milestones.filter(
      (milestone) => milestone.status === FlexibleMilestoneStatus.COMPLETED,
    ).length;
    const ownerName = displayName(project.owner);
    const deadline = formatFlexibleProjectDeadline(project.deadline, now);
    return {
      id: project.id,
      name: project.name,
      href: `/projects/flexible/${project.slug}`,
      status: project.status,
      priority: project.priority,
      scope: project.scope,
      progress: calculateFlexibleProjectProgress(
        completedMilestones,
        totalMilestones,
      ),
      completedMilestones,
      totalMilestones,
      ownerName,
      ownerInitials: initials(ownerName),
      ...deadline,
      ...(project.status === FlexibleProjectStatus.COMPLETED
        ? { deadlineStatusLabel: null, deadlineTone: "muted" as const }
        : {}),
    };
  });

  const recentProjects = canViewRecentProjects
    ? summaries
        .filter(
          ({ project, workflow }) =>
            !project.archivedAt &&
            (workflow.businessStatus !== null ||
              isGlobalProjectAdministrator(user)),
        )
        .slice(0, 6)
        .map(({ project, workflow }) => {
          const ownerName = displayName(project.owner);
          return {
            id: project.id,
            name: project.name,
            href: `/projects/${project.id}`,
            stageNumber: workflow.currentStageNumber,
            stageName: workflow.currentStageName,
            businessStatus: workflow.businessStatus,
            workflowDiagnosticLabel:
              user.role === UserRole.SUPER_ADMIN
                ? workflow.workflowDiagnosticLabel
                : null,
            ownerName,
            ownerInitials: initials(ownerName),
            updatedLabel: formatRecentTime(project.updatedAt, now),
          };
        })
    : [];

  return {
    snapshot: {
      kpis: buildKpis({
        user,
        summaries,
        flexibleProjects,
        attentionCount: attentionItems.length,
        assignedConceptCount,
        openRequestCount,
        completedRequestCount,
      }),
      attention: attentionItems.slice(0, 6),
      attentionCount: attentionItems.length,
      deadlines,
      stages,
      myWork: Array.from(work.values())
        .filter((item) => item.count > 0)
        .slice(0, 5),
      flexibleProjects: flexibleProjectCards,
      flexibleProjectCount: flexibleProjects.length,
      flexibleActiveCount: flexibleProjects.filter(
        (project) => project.status === FlexibleProjectStatus.ACTIVE,
      ).length,
      flexibleCompletedCount: flexibleProjects.filter(
        (project) => project.status === FlexibleProjectStatus.COMPLETED,
      ).length,
      canViewFlexibleProjects,
      recentProjects,
      canViewRecentProjects,
      scopeLabel:
        isGlobalProjectAdministrator(user)
          ? "Global portfolio"
          : "Projects connected to you",
    } satisfies DashboardSnapshot,
    attentionItems,
  };
}

export async function getDashboardSnapshot(
  user: DashboardUser,
  now = new Date(),
): Promise<DashboardSnapshot> {
  return (await buildDashboardSnapshot(user, now)).snapshot;
}

export async function getNeedsAttentionItems(
  user: DashboardUser,
  now = new Date(),
): Promise<DashboardAttentionItem[]> {
  return (await buildDashboardSnapshot(user, now)).attentionItems;
}

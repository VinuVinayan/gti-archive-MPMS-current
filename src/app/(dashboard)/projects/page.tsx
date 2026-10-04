import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectsBrowser } from "@/components/projects/projects-browser";
import { FlexibleProjectsRouteWorkspace } from "@/components/projects/flexible-projects-route-workspace";
import { UserProjectsBrowser } from "@/components/projects/user-projects-browser";
import { requireUser } from "@/lib/auth";
import {
  getFlexibleProjectsList,
  getFlexibleProjectUserOptions,
} from "@/lib/flexible-projects";
import {
  PROJECT_LIST_ROLES,
  PROJECT_LIST_STATUSES,
  type ProjectListRole,
  type ProjectListStatus,
} from "@/lib/project-list-workflow";
import {
  getDashboardProjectCounts,
  getProjectListFilterOptions,
  getProjectsList,
  getProjectTypeSwitcherVisibility,
} from "@/lib/projects";
import { canCreateProjects, canUseProjects } from "@/lib/permissions/resolver";
import {
  getUserProjectsList,
  USER_PROJECT_FILTERS,
  USER_PROJECT_SORTS,
  type UserProjectFilter,
  type UserProjectSort,
} from "@/lib/user-projects";

type ProjectSortValue =
  | "priority"
  | "updated"
  | "newest"
  | "oldest"
  | "name-asc"
  | "name-desc";

const projectFilters: Array<{ label: string; value: ProjectListStatus }> = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Completed", value: "COMPLETED" },
];

function logProjectsPageTiming(label: string, startedAt: number) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[projects:list] ${label}`, {
      ms: Math.round(performance.now() - startedAt),
    });
  }
}

function normalizeStatus(value: string | undefined): ProjectListStatus {
  return PROJECT_LIST_STATUSES.includes(value as ProjectListStatus)
    ? (value as ProjectListStatus)
    : "ALL";
}

function normalizeRole(value: string | undefined): ProjectListRole {
  return PROJECT_LIST_ROLES.includes(value as ProjectListRole)
    ? (value as ProjectListRole)
    : "ALL";
}

function normalizeStage(value: string | undefined) {
  const stage = Number.parseInt(value ?? "", 10);
  return stage >= 1 && Number.isSafeInteger(stage)
    ? stage
    : null;
}

function normalizeSort(value: string | undefined): ProjectSortValue {
  return value === "priority" ||
    value === "updated" ||
    value === "newest" ||
    value === "oldest" ||
    value === "name-asc" ||
    value === "name-desc"
    ? value
    : "priority";
}

function normalizeUserFilter(value: string | undefined): UserProjectFilter {
  return USER_PROJECT_FILTERS.includes(value as UserProjectFilter)
    ? (value as UserProjectFilter)
    : "ALL";
}

function normalizeUserSort(value: string | undefined): UserProjectSort {
  return USER_PROJECT_SORTS.includes(value as UserProjectSort)
    ? (value as UserProjectSort)
    : "priority";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<ProjectSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const user = await requireUser();

  if (!canUseProjects(user)) {
    redirect("/no-access");
  }

  const showProjectTypeSwitcher = await getProjectTypeSwitcherVisibility(user);

  if (resolvedSearchParams.view === "flexible") {
    const canCreateProject = canCreateProjects(user);
    const [flexibleProjects, flexibleUsers] = await Promise.all([
      getFlexibleProjectsList(user),
      canCreateProject ? getFlexibleProjectUserOptions() : Promise.resolve([]),
    ]);

    return (
      <DashboardLayout>
        <FlexibleProjectsRouteWorkspace
          projects={flexibleProjects}
          users={flexibleUsers}
          currentUserId={user.id}
          canCreateProject={canCreateProject}
          showProjectTypeSwitcher={showProjectTypeSwitcher}
        />
      </DashboardLayout>
    );
  }

  if (user.role === UserRole.USER) {
    const activeFilter = normalizeUserFilter(resolvedSearchParams.status);
    const activeSort = normalizeUserSort(resolvedSearchParams.sort);
    const query = resolvedSearchParams.q?.trim() ?? "";
    const currentPage = Math.max(
      1,
      Number.parseInt(resolvedSearchParams.page ?? "1", 10) || 1,
    );
    const result = await getUserProjectsList(
      {
        filter: activeFilter,
        query,
        sort: activeSort,
        page: currentPage,
      },
      user,
    );

    return (
      <DashboardLayout>
        <UserProjectsBrowser
          projects={result.projects}
          projectCount={result.total}
          currentPage={currentPage}
          pageSize={result.pageSize}
          hasAnyProjects={result.hasAnyProjects}
          activeFilter={activeFilter}
          activeSort={activeSort}
          query={query}
          showProjectTypeSwitcher={showProjectTypeSwitcher}
        />
      </DashboardLayout>
    );
  }

  const data = await loadManagementProjectsPageData(
    resolvedSearchParams,
    user,
  );

  return (
    <DashboardLayout>
      <ProjectsBrowser
        projects={data.projects}
        projectCount={data.projectCount}
        currentPage={data.currentPage}
        hasAnyProjects={data.hasAnyProjects}
        canCreateProject={data.canCreateProject}
        showProjectTypeSwitcher={showProjectTypeSwitcher}
        activeStatus={data.activeStatus}
        activeSort={data.activeSort}
        activeStage={data.activeStage}
        activeOwnerId={data.activeOwnerId}
        activeExecutorId={data.activeExecutorId}
        activeMyRole={data.activeMyRole}
        query={data.query}
        ownerOptions={data.filterOptions.owners}
        executorOptions={data.filterOptions.executors}
        stageOptions={data.filterOptions.stages}
        filters={projectFilters}
      />
    </DashboardLayout>
  );
}

type ProjectSearchParams = {
  view?: string;
  status?: string;
  q?: string;
  sort?: string;
  stage?: string;
  ownerId?: string;
  executorId?: string;
  myRole?: string;
  page?: string;
};

async function loadManagementProjectsPageData(
  resolvedSearchParams: ProjectSearchParams,
  user: Awaited<ReturnType<typeof requireUser>>,
) {
  const pageStartedAt = performance.now();
  const activeStatus = normalizeStatus(resolvedSearchParams.status);
  const activeSort = normalizeSort(resolvedSearchParams.sort);
  const activeStage = normalizeStage(resolvedSearchParams.stage);
  const activeMyRole = normalizeRole(resolvedSearchParams.myRole);
  const activeOwnerId = resolvedSearchParams.ownerId?.trim() ?? "";
  const activeExecutorId = resolvedSearchParams.executorId?.trim() ?? "";
  const query = resolvedSearchParams.q?.trim() ?? "";
  const activePage = Math.max(
    1,
    Number.parseInt(resolvedSearchParams.page ?? "1", 10) || 1,
  );
  const [projectResult, projectCounts, filterOptions] = await Promise.all([
    getProjectsList(
      {
        status: activeStatus,
        query,
        sort: activeSort,
        stage: activeStage ?? undefined,
        ownerId: activeOwnerId,
        executorId: activeExecutorId,
        myRole: activeMyRole,
        page: activePage,
      },
      user,
    ),
    getDashboardProjectCounts(user),
    getProjectListFilterOptions(user),
  ]);

  logProjectsPageTiming("page total", pageStartedAt);

  return {
    projects: projectResult.projects,
    projectCount: projectResult.total,
    hasAnyProjects: projectCounts.total > 0,
    canCreateProject: canCreateProjects(user),
    activeStatus,
    activeSort,
    activeStage,
    activeOwnerId,
    activeExecutorId,
    activeMyRole,
    query,
    currentPage: activePage,
    filterOptions,
  };
}

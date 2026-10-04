import { canManageProjectStages } from "@/lib/project-templates";
import { getProjectStageAccessRecordById } from "@/lib/project-stage-data";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectBackButton } from "@/components/projects/project-back-button";
import {
  ProjectOverviewLoadingShell,
  ProjectOverviewWorkspace,
} from "@/components/projects/project-overview-workspace";
import { UserProjectWorkspace } from "@/components/projects/user-project-workspace";
import {
  ProjectAccessUnavailableState,
  ProjectNotFoundState,
} from "@/components/projects/project-route-state";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions/resolver";
import {
  getProjectRouteAvailability,
  getProjectStageShellById,
} from "@/lib/projects";
import { getUserProjectWorkspace } from "@/lib/user-project-workspace";

type ProjectPageUser = Awaited<ReturnType<typeof requireUser>>;

async function ProjectUnavailableContent({
  slug,
  user,
}: {
  slug: string;
  user: ProjectPageUser;
}) {
  const availability = await getProjectRouteAvailability(slug, user);

  if (availability === "access-unavailable") {
    return <ProjectAccessUnavailableState />;
  }

  return <ProjectNotFoundState />;
}

async function ProjectOverviewContent({
  slug,
  userPromise,
}: {
  slug: string;
  userPromise: Promise<ProjectPageUser>;
}) {
  const user = await userPromise;
  const project = await getProjectStageShellById(slug, user);

  if (!project) {
    return <ProjectUnavailableContent slug={slug} user={user} />;
  }

  return (
    <ProjectOverviewWorkspace
      project={project}
      currentUserId={user.id}
    />
  );
}

async function UserProjectWorkspaceContent({
  slug,
  user,
}: {
  slug: string;
  user: ProjectPageUser;
}) {
  const data = await getUserProjectWorkspace(slug, user);

  if (!data) {
    return <ProjectUnavailableContent slug={slug} user={user} />;
  }

  return <UserProjectWorkspace data={data} currentUserId={user.id} />;
}

function UserProjectWorkspaceLoadingShell() {
  return (
    <div className="mx-auto w-full max-w-[1420px] animate-pulse space-y-6 pb-8">
      <div className="h-5 w-28 rounded bg-[#e5ebe6]" />
      <div className="h-12 w-2/3 rounded-[14px] bg-[#e5ebe6]" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-36 rounded-[20px] bg-[#edf1ed]" />
        <div className="h-36 rounded-[20px] bg-[#edf1ed]" />
      </div>
    </div>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();

  if (!hasPermission(user, "project.view")) {
    redirect("/no-access");
  }

  const accessRecord = await getProjectStageAccessRecordById(slug);
  if (user.role === UserRole.USER && (!accessRecord || !canManageProjectStages(user, accessRecord))) {
    return (
      <DashboardLayout
        topbarProps={{
          searchPlaceholder: "Search your workspace...",
          leadingContent: <ProjectBackButton href="/projects" />,
        }}
      >
        <Suspense fallback={<UserProjectWorkspaceLoadingShell />}>
          <UserProjectWorkspaceContent slug={slug} user={user} />
        </Suspense>
      </DashboardLayout>
    );
  }

  const userPromise = Promise.resolve(user);

  return (
    <DashboardLayout
      topbarProps={{
        searchPlaceholder: "Search for Projects...",
        leadingContent: <ProjectBackButton />,
      }}
    >
      <Suspense fallback={<ProjectOverviewLoadingShell />}>
        <ProjectOverviewContent slug={slug} userPromise={userPromise} />
      </Suspense>
    </DashboardLayout>
  );
}

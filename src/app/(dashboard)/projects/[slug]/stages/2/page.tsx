import { requirePackagingStageRoute } from "@/lib/project-template-route-access";
import { Suspense } from "react";
import { ProjectWorkflowStageKey } from "@prisma/client";
import { FolderKanban } from "lucide-react";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectBackButton } from "@/components/projects/project-back-button";
import {
  ProjectAccessUnavailableState,
  ProjectNotFoundState,
  StageLockedState,
} from "@/components/projects/project-route-state";
import {
  StageTwoWorkspace,
} from "@/components/projects/stage-two-workspace";
import {
  StageRouteInitialShell,
  StageRouteShell,
  StageSectionLoadingShell,
} from "@/components/projects/stage-route-shell";
import { requireUser } from "@/lib/auth";
import {
  getProjectRouteAvailability,
  getProjectStageShellById,
} from "@/lib/projects";
import { getProjectResearchPageData } from "@/lib/project-research";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";

type StageTwoPageUser = Awaited<ReturnType<typeof requireUser>>;

async function StageTwoUnavailableContent({
  slug,
  user,
}: {
  slug: string;
  user: StageTwoPageUser;
}) {
  const availability = await getProjectRouteAvailability(slug, user);

  if (availability === "access-unavailable") {
    return <ProjectAccessUnavailableState />;
  }

  return <ProjectNotFoundState />;
}

async function StageTwoContent({
  slug,
  userPromise,
}: {
  slug: string;
  userPromise: Promise<StageTwoPageUser>;
}) {
  const user = await userPromise;
  await requirePackagingStageRoute(slug, user, 2);
  const project = await getProjectStageShellById(slug, user);

  if (!project) {
    return <StageTwoUnavailableContent slug={slug} user={user} />;
  }

  const workflowStage = project.workflowStages.find(
    (stage) =>
      stage.stageKey ===
      ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
  );

  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
      status: workflowStage?.status,
    })
  ) {
    return (
      <StageLockedState
        projectHref={`/projects/${slug}`}
        message="Stage 2 - Project Research and Planning is locked. Complete Project Inquiry before opening it."
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <StageRouteShell
        project={project}
        currentUserId={user.id}
        eyebrow="Shared research workspace"
        title="Stage 2 - Project Research and Planning"
        icon={<FolderKanban className="h-4 w-4" />}
      />
      <Suspense fallback={<StageSectionLoadingShell rows={4} />}>
        <StageTwoDataContent
          slug={slug}
          user={user}
        />
      </Suspense>
    </section>
  );
}

async function StageTwoDataContent({
  slug,
  user,
}: {
  slug: string;
  user: StageTwoPageUser;
}) {
  let data = null;

  try {
    data = await getProjectResearchPageData(user, slug);
  } catch {
    data = null;
  }

  if (!data) {
    return <ProjectAccessUnavailableState />;
  }

  return (
    <StageTwoWorkspace
      key={data.sharedWorkspace.id}
      data={data}
      currentUserId={user.id}
    />
  );
}

export default async function StageTwoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();

  await requirePackagingStageRoute(slug, user, 2);

  const userPromise = Promise.resolve(user);

  return (
    <DashboardLayout
      topbarProps={{
        searchPlaceholder: "Search for projects, folders, files...",
        leadingContent: <ProjectBackButton href={`/projects/${slug}`} />,
      }}
    >
      <Suspense fallback={<StageRouteInitialShell />}>
        <StageTwoContent slug={slug} userPromise={userPromise} />
      </Suspense>
    </DashboardLayout>
  );
}

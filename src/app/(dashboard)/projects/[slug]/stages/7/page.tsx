import { requirePackagingStageRoute } from "@/lib/project-template-route-access";
import { Suspense } from "react";
import { ProjectWorkflowStageKey } from "@prisma/client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectBackButton } from "@/components/projects/project-back-button";
import {
  ProjectAccessUnavailableState,
  ProjectNotFoundState,
  StageLockedState,
} from "@/components/projects/project-route-state";
import {
  StageSevenLoadingShell,
  StageSevenWorkspace,
} from "@/components/projects/stage-seven-workspace";
import { requireUser } from "@/lib/auth";
import { getProjectRouteAvailability, getProjectStageShellById } from "@/lib/projects";
import { decodeRouteParam } from "@/lib/route-params";
import { getStageSevenWorkspaceData } from "@/lib/stage-seven";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";

type StageSevenUser = Awaited<ReturnType<typeof requireUser>>;

async function StageSevenUnavailableContent({
  slug,
  user,
}: {
  slug: string;
  user: StageSevenUser;
}) {
  const availability = await getProjectRouteAvailability(slug, user);

  return availability === "access-unavailable" ? (
    <ProjectAccessUnavailableState />
  ) : (
    <ProjectNotFoundState />
  );
}

async function StageSevenContent({
  slug,
  userPromise,
  selectedUnitId,
  selectedRoundId,
}: {
  slug: string;
  userPromise: Promise<StageSevenUser>;
  selectedUnitId?: string;
  selectedRoundId?: string;
}) {
  const user = await userPromise;
  await requirePackagingStageRoute(slug, user, 7);

  const project = await getProjectStageShellById(slug, user);

  if (!project) {
    return <StageSevenUnavailableContent slug={slug} user={user} />;
  }

  const workflowStage = project.workflowStages.find(
    (stage) =>
      stage.stageKey === ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
  );

  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION,
      status: workflowStage?.status,
    })
  ) {
    return (
      <StageLockedState
        projectHref={`/projects/${slug}`}
        message="Stage 7 - Implementation & Supervision is locked. Complete the preceding workflow stage before opening it."
      />
    );
  }

  const data = await getStageSevenWorkspaceData(
    user,
    project.id,
    selectedUnitId,
    selectedRoundId,
  );

  if (!data) {
    return <ProjectAccessUnavailableState />;
  }

  return (
    <StageSevenWorkspace
      project={project}
      currentUserId={user.id}
      data={data}
    />
  );
}

export default async function StageSevenPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ unit?: string; round?: string }>;
}) {
  const { slug: rawSlug } = await params;
  const { unit, round } = await searchParams;
  const slug = decodeRouteParam(rawSlug);
  const userPromise = requireUser();

  return (
    <DashboardLayout
      topbarProps={{
        showSearch: false,
        leadingContent: (
          <ProjectBackButton
            href={`/projects/${slug}`}
            label="Back to Project Overview"
          />
        ),
      }}
    >
      <Suspense fallback={<StageSevenLoadingShell />}>
        <StageSevenContent
          slug={slug}
          userPromise={userPromise}
          selectedUnitId={unit}
          selectedRoundId={round}
        />
      </Suspense>
    </DashboardLayout>
  );
}

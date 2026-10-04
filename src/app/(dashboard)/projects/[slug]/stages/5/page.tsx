import { requirePackagingStageRoute } from "@/lib/project-template-route-access";
import { Suspense } from "react";
import {
  ProjectFileChecklistField,
  ProjectWorkflowStageKey,
} from "@prisma/client";
import { FileCheck2 } from "lucide-react";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectBackButton } from "@/components/projects/project-back-button";
import {
  ProjectAccessUnavailableState,
  ProjectNotFoundState,
  StageLockedState,
} from "@/components/projects/project-route-state";
import {
  StageFiveWorkspace,
} from "@/components/projects/stage-five-workspace";
import {
  StageRouteInitialShell,
  StageRouteShell,
  StageSectionLoadingShell,
} from "@/components/projects/stage-route-shell";
import { requireUser } from "@/lib/auth";
import { getProjectRouteAvailability, getProjectStageShellById } from "@/lib/projects";
import { decodeRouteParam } from "@/lib/route-params";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";
import { getStageFiveWorkspaceData } from "@/lib/stage-five";

type StageFiveUser = Awaited<ReturnType<typeof requireUser>>;

async function StageFiveUnavailableContent({
  slug,
  user,
}: {
  slug: string;
  user: StageFiveUser;
}) {
  const availability = await getProjectRouteAvailability(slug, user);

  return availability === "access-unavailable" ? (
    <ProjectAccessUnavailableState />
  ) : (
    <ProjectNotFoundState />
  );
}

async function StageFiveContent({
  slug,
  userPromise,
  initialHandoffId,
  initialMode,
  initialField,
}: {
  slug: string;
  userPromise: Promise<StageFiveUser>;
  initialHandoffId?: string;
  initialMode?: "edit" | "view";
  initialField?: ProjectFileChecklistField;
}) {
  const user = await userPromise;
  await requirePackagingStageRoute(slug, user, 5);


  const project = await getProjectStageShellById(slug, user);

  if (!project) {
    return <StageFiveUnavailableContent slug={slug} user={user} />;
  }

  const workflowStage = project.workflowStages.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.FINAL_LAYOUT,
  );

  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.FINAL_LAYOUT,
      status: workflowStage?.status,
    })
  ) {
    return (
      <StageLockedState
        projectHref={`/projects/${slug}`}
        message="Stage 5 - File Checklist is locked. Complete the preceding workflow stage before opening it."
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <StageRouteShell
        project={project}
        currentUserId={user.id}
        eyebrow="File Checklist"
        title="Stage 5 - File Checklist"
        description="Complete or request the required project information and files."
        icon={<FileCheck2 className="h-4 w-4" />}
      />
      <Suspense fallback={<StageSectionLoadingShell rows={6} />}>
        <StageFiveDataContent
          slug={slug}
          user={user}
          project={project}
          initialHandoffId={initialHandoffId}
          initialMode={initialMode}
          initialField={initialField}
        />
      </Suspense>
    </section>
  );
}

async function StageFiveDataContent({
  slug,
  user,
  project,
  initialHandoffId,
  initialMode,
  initialField,
}: {
  slug: string;
  user: StageFiveUser;
  project: NonNullable<Awaited<ReturnType<typeof getProjectStageShellById>>>;
  initialHandoffId?: string;
  initialMode?: "edit" | "view";
  initialField?: ProjectFileChecklistField;
}) {
  const pageData = await getStageFiveWorkspaceData(
    user,
    slug,
    initialHandoffId,
  );

  if (!pageData) {
    return <ProjectAccessUnavailableState />;
  }

  return (
    <StageFiveWorkspace
      key={initialHandoffId ?? pageData.files[0]?.handoffId ?? "no-file"}
      project={project}
      currentUserId={user.id}
      pageData={pageData}
      initialHandoffId={initialHandoffId}
      initialMode={initialMode}
      initialField={initialField}
      showChrome={false}
    />
  );
}

export default async function StageFivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ file?: string; mode?: string; field?: string }>;
}) {
  const { slug: rawSlug } = await params;
  const query = await searchParams;
  const slug = decodeRouteParam(rawSlug);
  const initialField = Object.values(ProjectFileChecklistField).includes(
    query.field as ProjectFileChecklistField,
  )
    ? (query.field as ProjectFileChecklistField)
    : undefined;
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
      <Suspense fallback={<StageRouteInitialShell />}>
        <StageFiveContent
          slug={slug}
          userPromise={userPromise}
          initialHandoffId={query.file}
          initialMode={query.mode === "view" ? "view" : "edit"}
          initialField={initialField}
        />
      </Suspense>
    </DashboardLayout>
  );
}

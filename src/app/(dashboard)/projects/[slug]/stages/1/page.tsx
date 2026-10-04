import { requirePackagingStageRoute } from "@/lib/project-template-route-access";
import { Suspense } from "react";
import { ProjectWorkflowStageKey } from "@prisma/client";
import { FileText } from "lucide-react";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectBackButton } from "@/components/projects/project-back-button";
import {
  ProjectAccessUnavailableState,
  ProjectNotFoundState,
  StageLockedState,
} from "@/components/projects/project-route-state";
import {
  StageOneWorkspace,
} from "@/components/projects/stage-one-workspace";
import {
  StageRouteInitialShell,
  StageRouteShell,
  StageSectionLoadingShell,
} from "@/components/projects/stage-route-shell";
import { requireUser } from "@/lib/auth";
import { getProjectInquiryPageData } from "@/lib/project-inquiry";
import {
  getProjectRouteAvailability,
  getProjectStageShellById,
} from "@/lib/projects";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";

type StageOnePageUser = Awaited<ReturnType<typeof requireUser>>;

async function StageOneUnavailableContent({
  slug,
  user,
}: {
  slug: string;
  user: StageOnePageUser;
}) {
  const availability = await getProjectRouteAvailability(slug, user);

  if (availability === "access-unavailable") {
    return <ProjectAccessUnavailableState />;
  }

  return <ProjectNotFoundState />;
}

async function StageOneContent({
  slug,
  userPromise,
}: {
  slug: string;
  userPromise: Promise<StageOnePageUser>;
}) {
  const user = await userPromise;
  await requirePackagingStageRoute(slug, user, 1);


  const project = await getProjectStageShellById(slug, user);

  if (!project) {
    return <StageOneUnavailableContent slug={slug} user={user} />;
  }

  const workflowStage = project.workflowStages.find(
    (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY,
  );

  if (
    !canOpenImplementedWorkflowStage({
      stageKey: ProjectWorkflowStageKey.PROJECT_INQUIRY,
      status: workflowStage?.status,
    })
  ) {
    return (
      <StageLockedState
        projectHref={`/projects/${slug}`}
        message="Stage 1 - Project Inquiry is locked because this project's workflow state is unavailable."
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <StageRouteShell
        project={project}
        currentUserId={user.id}
        eyebrow="Project Inquiry"
        title="Stage 1 - Project Inquiry"
        icon={<FileText className="h-4 w-4" />}
      />
      <Suspense fallback={<StageSectionLoadingShell rows={6} />}>
        <StageOneDataContent slug={slug} user={user} project={project} />
      </Suspense>
    </section>
  );
}

async function StageOneDataContent({
  slug,
  user,
  project,
}: {
  slug: string;
  user: StageOnePageUser;
  project: NonNullable<Awaited<ReturnType<typeof getProjectStageShellById>>>;
}) {
  const pageData = await getProjectInquiryPageData(user, slug);

  return (
    <StageOneWorkspace
      project={project}
      currentUserId={user.id}
      pageData={pageData}
      showChrome={false}
    />
  );
}

export default async function StageOnePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userPromise = requireUser();

  return (
    <DashboardLayout
      topbarProps={{
        showSearch: false,
        leadingContent: <ProjectBackButton href={`/projects/${slug}`} />,
      }}
    >
      <Suspense fallback={<StageRouteInitialShell />}>
        <StageOneContent slug={slug} userPromise={userPromise} />
      </Suspense>
    </DashboardLayout>
  );
}

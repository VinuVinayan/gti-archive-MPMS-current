import { requirePackagingStageRoute } from "@/lib/project-template-route-access";
import { Suspense } from "react";
import { ListTodo } from "lucide-react";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import {
  ConceptStageWorkspace,
} from "@/components/projects/concept-stage-workspace";
import {
  StageRouteInitialShell,
  StageRouteShell,
  StageSectionLoadingShell,
} from "@/components/projects/stage-route-shell";
import {
  ProjectAccessUnavailableState,
  ProjectNotFoundState,
  StageLockedState,
} from "@/components/projects/project-route-state";
import { requireUser } from "@/lib/auth";
import {
  getProjectConceptFolders,
  type ConceptWorkflowStageKey,
} from "@/lib/project-concepts";
import { getProjectRouteAvailability, getProjectStageShellById } from "@/lib/projects";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";

type ConceptStageRouteUser = Awaited<ReturnType<typeof requireUser>>;

async function ConceptStageUnavailableContent({
  slug,
  user,
}: {
  slug: string;
  user: ConceptStageRouteUser;
}) {
  const availability = await getProjectRouteAvailability(slug, user);

  return availability === "access-unavailable" ? (
    <ProjectAccessUnavailableState />
  ) : (
    <ProjectNotFoundState />
  );
}

async function ConceptStageContent({
  slug,
  stageNumber,
  stageTitle,
  stageKey,
  userPromise,
  executorFilter,
  foldersOnly,
}: {
  slug: string;
  stageNumber: 3 | 4;
  stageTitle: string;
  stageKey: ConceptWorkflowStageKey;
  userPromise: Promise<ConceptStageRouteUser>;
  executorFilter?: string;
  foldersOnly: boolean;
}) {
  const user = await userPromise;
  await requirePackagingStageRoute(slug, user, stageNumber);
  const project = await getProjectStageShellById(slug, user);

  if (!project) {
    return <ConceptStageUnavailableContent slug={slug} user={user} />;
  }

  const workflowStage = project.workflowStages.find(
    (stage) => stage.stageKey === stageKey,
  );
  const stageAvailable = canOpenImplementedWorkflowStage({
    stageKey,
    status: workflowStage?.status,
  });

  if (!stageAvailable) {
    return (
      <StageLockedState
        projectHref={`/projects/${slug}`}
        message={`Stage ${stageNumber} - ${stageTitle} is locked. Complete the preceding workflow stage before opening it.`}
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-8">
      <StageRouteShell
        project={project}
        currentUserId={user.id}
        eyebrow={foldersOnly ? `Stage ${stageNumber} - ${stageTitle}` : "Concept Workspace"}
        title={foldersOnly ? "Concept Folders" : `Stage ${stageNumber} - ${stageTitle}`}
        description={
          foldersOnly
            ? `Browse and manage Stage ${stageNumber} concept folders.`
            : "Create and manage concept taskers."
        }
        icon={<ListTodo className="h-4 w-4" />}
      />
      <Suspense fallback={<StageSectionLoadingShell rows={3} />}>
        <ConceptStageDataContent
          slug={slug}
          stageNumber={stageNumber}
          stageTitle={stageTitle}
          stageKey={stageKey}
          user={user}
          project={project}
          executorFilter={executorFilter}
        />
      </Suspense>
    </section>
  );
}

async function ConceptStageDataContent({
  slug,
  stageNumber,
  stageTitle,
  stageKey,
  user,
  project,
  executorFilter,
}: {
  slug: string;
  stageNumber: 3 | 4;
  stageTitle: string;
  stageKey: ConceptWorkflowStageKey;
  user: ConceptStageRouteUser;
  project: NonNullable<Awaited<ReturnType<typeof getProjectStageShellById>>>;
  executorFilter?: string;
}) {
  const folders = await getProjectConceptFolders(user, slug, stageKey, {
    executorId: executorFilter,
  });

  if (!folders) {
    return <ProjectAccessUnavailableState />;
  }

  const folderVersion = folders.folders
    .map(
      (folder) =>
        `${folder.id}:${folder.assignedExecutorId ?? "unassigned"}:${folder.latestRevisionStatus ?? "none"}:${folder.approvedAttachment?.id ?? "none"}:${folder.completedWithoutFileAt?.toISOString() ?? "none"}:${folder.canCompleteWithoutFile}:${folder.completionRequest?.requestedAt ?? "none"}:${folder.canRequestCompletion}`,
    )
    .join("|");

  return (
    <ConceptStageWorkspace
      key={`${stageNumber}:${folders.selectedExecutorId ?? "all"}:${folderVersion}`}
      stageNumber={stageNumber}
      stageTitle={stageTitle}
      stageKey={stageKey}
      project={project}
      currentUserId={user.id}
      initialFolders={folders.folders}
      canManageConcepts={folders.canManage}
      canCompleteStage={folders.canCompleteStage}
      skipRevocation={folders.skipRevocation}
      stageWorkflowStatus={folders.workflowStatus}
      completionConcepts={folders.completionConcepts}
      executors={folders.executors}
      selectedExecutorId={folders.selectedExecutorId}
      showChrome={false}
    />
  );
}

export function ConceptStageRoute({
  slug,
  stageNumber,
  stageTitle,
  stageKey,
  executorFilter,
  foldersOnly = false,
}: {
  slug: string;
  stageNumber: 3 | 4;
  stageTitle: string;
  stageKey: ConceptWorkflowStageKey;
  executorFilter?: string;
  foldersOnly?: boolean;
}) {
  const userPromise = requireUser();

  return (
    <DashboardLayout>
      <Suspense fallback={<StageRouteInitialShell />}>
        <ConceptStageContent
          slug={slug}
          stageNumber={stageNumber}
          stageTitle={stageTitle}
          stageKey={stageKey}
          userPromise={userPromise}
          executorFilter={executorFilter}
          foldersOnly={foldersOnly}
        />
      </Suspense>
    </DashboardLayout>
  );
}

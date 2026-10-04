import Link from "next/link";
import { StageGuidance } from "./stage-guidance";
import { stageInstanceHref } from "@/lib/project-template-definitions";
import type { ReactNode } from "react";

import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import { ProjectFlowSummaryStrip } from "@/components/projects/project-summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectStageShellRecord } from "@/lib/projects";

export function StageRouteShell({
  project,
  currentUserId,
  eyebrow,
  title,
  description,
  icon,
}: {
  project: ProjectStageShellRecord;
  currentUserId: string;
  eyebrow: string;
  title: string;
  description?: string;
  icon: ReactNode;
}) {
  const activeStage = project.stageInstances?.find(stage => title.startsWith(`Stage ${stage.order} -`) || eyebrow.startsWith(`Stage ${stage.order} -`) || stage.name === eyebrow);
  return (
    <div>
      <ProjectAccessRealtimeGuard
        projectId={project.id}
        currentUserId={currentUserId}
      />
      <header>
        <div className="flex items-center gap-2 text-[11px] font-[780] uppercase tracking-[0.12em] text-[#2f8057]">
          {icon}
          {eyebrow}
        </div>
        <h1 className="mt-3 text-[30px] font-[790] leading-[1.12] tracking-[-0.045em] text-[#111713] sm:text-[38px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-[13px] leading-5 text-[#68736b]">
            {description}
          </p>
        ) : null}
      </header>
      <ProjectFlowSummaryStrip project={project} className="mt-5" />
      {project.canManageStages && <nav aria-label="Project stages" className="mt-4 flex flex-wrap gap-2">{project.stageInstances?.map(stage => stage.status === "LOCKED" ? <span key={stage.id} className="max-w-60 rounded-lg border p-2 text-xs text-gray-400">{stage.order}. {stage.name}</span> : <Link key={stage.id} className="max-w-60 rounded-lg border p-2 text-xs text-[#226742]" href={stageInstanceHref(project.id, stage)}>{stage.order}. {stage.name}</Link>)}</nav>}
      {activeStage && <StageGuidance stage={activeStage} />}
    </div>
  );
}

export function StageRouteInitialShell() {
  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <Skeleton className="h-4 w-40 rounded-full" />
      <Skeleton className="mt-3 h-10 w-full max-w-[520px] rounded-[12px]" />
      <Skeleton className="mt-5 h-[96px] w-full rounded-[18px]" />
    </section>
  );
}

export function StageSectionLoadingShell({
  rows = 4,
}: {
  rows?: number;
}) {
  return (
    <div className="mt-6 rounded-[22px] border border-[#dfe6df] bg-white p-5 shadow-[0_14px_34px_rgba(23,39,28,0.04)] sm:p-7">
      <Skeleton className="h-5 w-44 rounded-full" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-[15px]" />
        ))}
      </div>
    </div>
  );
}

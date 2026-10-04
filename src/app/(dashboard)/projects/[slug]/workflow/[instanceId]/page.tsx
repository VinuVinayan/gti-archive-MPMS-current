import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { StageRouteShell } from "@/components/projects/stage-route-shell";
import { StageGuidance } from "@/components/projects/stage-guidance";
import { GenericStageWorkspace } from "@/components/projects/generic-stage-workspace";
import { StageLockedState } from "@/components/projects/project-route-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectStageShellById } from "@/lib/projects";
import { canManageProjectStages, templateProjectInclude } from "@/lib/project-templates";
import { stageInstanceHref } from "@/lib/project-template-definitions";

export default async function TemplateStagePage({params}:{params:Promise<{slug:string;instanceId:string}>}) {
  const {slug,instanceId}=await params;
  const user=await requireUser();
  const project=await prisma.project.findUnique({where:{id:slug},include:templateProjectInclude});
  if (!project) notFound();
  if (!canManageProjectStages(user,project)) redirect(`/projects/${slug}`);
  const stage=project.stageInstances.find(s=>s.id===instanceId);
  if (!stage) notFound();
  if (stage.workspace!=="GENERAL") redirect(stageInstanceHref(slug,stage));
  const shell=await getProjectStageShellById(slug,user);
  if (!shell) notFound();
  return <DashboardLayout><div className="mx-auto max-w-[1420px]">
    <Link className="text-sm text-[#226742]" href={`/projects/${slug}`}>← Project overview</Link>
    {stage.status === "LOCKED" || project.structureApproval === "DRAFT" ? <StageLockedState projectHref={`/projects/${slug}`} message={project.structureApproval === "DRAFT" ? "Director approval is required before this project can begin." : "Complete the preceding stages to open this stage."} /> : <>
      <StageRouteShell project={shell} currentUserId={user.id} eyebrow={stage.name} title={`Stage ${stage.order} - ${stage.name}`} description={stage.description} icon={<FileText className="size-4" />} />
      {!shell.stageInstances?.length && <StageGuidance stage={stage} />}
      <GenericStageWorkspace key={`${stage.id}:${stage.revision}`} projectId={slug} stage={{id:stage.id,content:stage.content,revision:stage.revision,status:project.archivedAt || project.completedAt ? "COMPLETED" : stage.status,stageType:stage.stageType,required:stage.required,skippable:stage.skippable}} />
    </>}
  </div></DashboardLayout>;
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageProjectStages, canManageProjectTemplates } from "@/lib/project-templates";
export default async function StageHistoryPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;const user=await requireUser();
  const project=await prisma.project.findUnique({where:{id:slug},include:{coOwners:true,templateVersion:true}});
  if (!project) notFound();
  if (!canManageProjectStages(user,project) && !await canManageProjectTemplates(user)) redirect("/no-access");
  const events=await prisma.projectStructureEvent.findMany({where:{projectId:slug},orderBy:{createdAt:"desc"},take:200});
  return <DashboardLayout><div className="mx-auto max-w-4xl space-y-5"><Link className="text-sm underline" href={`/projects/${slug}`}>Project overview</Link><h1 className="text-3xl font-bold">Stage history · {project.name}</h1><p className="text-sm">Source: {project.templateName || "Legacy"} · Version {project.templateVersion?.version ?? "not recorded"} · {project.templateVersionId}</p><p className="text-sm text-gray-500">Most recent 200 stage engine events. Existing Packaging activity remains in its original workspaces.</p>{events.map(event=><details key={event.id} className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">{event.action.replaceAll("_"," ")} · {event.createdAt.toISOString()}</summary><p className="my-2 text-sm">{event.reason} · Actor: {event.actorId || "System migration"}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(event.details,null,2)}</pre></details>)}</div></DashboardLayout>;
}

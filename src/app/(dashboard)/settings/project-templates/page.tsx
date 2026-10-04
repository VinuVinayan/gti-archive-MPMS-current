import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectStructureEditor } from "@/components/projects/project-structure-editor";
import { TemplateDirectorGrants } from "@/components/projects/template-director-grants";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageProjectTemplates, listProjectTemplates } from "@/lib/project-templates";
import { validateStageDefinitions } from "@/lib/project-template-definitions";

export default async function TemplateSettingsPage() {
  const user=await requireUser();
  if (!await canManageProjectTemplates(user)) redirect("/no-access");
  const [templates,pending,versions,users]=await Promise.all([
    listProjectTemplates(),
    prisma.project.findMany({where:{templateKey:"CUSTOM",structureApproval:"DRAFT",archivedAt:null,completedAt:null},select:{id:true,name:true},orderBy:{createdAt:"asc"}}),
    prisma.projectTemplateVersion.findMany({orderBy:{createdAt:"desc"},take:100,select:{id:true,name:true,version:true,changeReason:true,createdById:true,createdAt:true}}),
    user.role==="SUPER_ADMIN" ? prisma.user.findMany({where:{role:{not:"SUPER_ADMIN"}},select:{id:true,name:true,email:true,templateManagementAccessGranted:true},orderBy:{name:"asc"}}) : Promise.resolve([]),
  ]);
  return <DashboardLayout><div className="mx-auto max-w-4xl space-y-6 pb-8">
    <h1 className="text-3xl font-bold">Project templates</h1>
    <p className="text-sm text-[#68736b]">Publishing creates a new version for future projects. Running projects keep their own stage snapshots. Stage types describe the work; specialized tools are currently available for Packaging.</p>
    {pending.length>0 && <section className="rounded-xl border bg-amber-50 p-4"><h2 className="font-semibold">Custom projects awaiting approval</h2><ul className="mt-3 space-y-2">{pending.map(project=><li key={project.id}><Link className="text-sm underline" href={`/projects/${project.id}/structure`}>{project.name}</Link></li>)}</ul></section>}
    {templates.filter(template=>template.key!=="CUSTOM").map(template=><details key={template.version.id} className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer font-bold">{template.name} · Version {template.version.version}</summary><div className="mt-5"><ProjectStructureEditor templateKey={template.key} revision={template.version.version} initialStages={validateStageDefinitions(template.version.stages)} /></div></details>)}
    {user.role==="SUPER_ADMIN" && <TemplateDirectorGrants users={users} />}
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Template version history</summary><ul className="mt-3 space-y-3 text-sm">{versions.map(version=><li key={version.id}><strong>{version.name} v{version.version}</strong> · {version.createdAt.toISOString()}<p>{version.changeReason}</p><span className="text-xs text-gray-500">Actor: {version.createdById || "System migration"}</span></li>)}</ul></details>
  </div></DashboardLayout>;
}

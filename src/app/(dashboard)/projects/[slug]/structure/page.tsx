import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProjectStructureEditor } from "@/components/projects/project-structure-editor";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canManageProjectStages,
  canManageProjectTemplates,
  templateProjectInclude,
} from "@/lib/project-templates";
import { validateStageDefinitions } from "@/lib/project-template-definitions";
export default async function ProjectStructurePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: slug },
    include: templateProjectInclude,
  });
  if (!project || project.templateKey !== "CUSTOM") notFound();
  const director = await canManageProjectTemplates(user);
  const manager = canManageProjectStages(user, project);
  if (!manager && !director) redirect("/no-access");
  const begun =
    !!project.workflowStartedAt ||
    !!project.completedAt ||
    !!project.archivedAt;
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-5 pb-8">
        <Link className="text-sm underline" href={`/projects/${slug}`}>
          Project overview
        </Link>
        <h1 className="text-3xl font-bold">{project.name} · Stage structure</h1>
        <p className="text-sm">
          Revision {project.structureRevision} ·{" "}
          {project.structureApproval === "APPROVED"
            ? "Approved"
            : "Awaiting Director approval"}
        </p>
        <p className="text-sm text-[#68736b]">
          {begun
            ? "This project has begun. Its structure is locked to preserve historical work."
            : "Structure edits reset Director approval. Deleted draft stages are retained in history."}
        </p>
        <ProjectStructureEditor
          key={project.structureRevision + project.structureApproval}
          projectId={slug}
          revision={project.structureRevision}
          initialStages={validateStageDefinitions(project.stageInstances)}
          editable={manager && !begun}
          canApprove={director && !begun}
          awaitingApproval={project.structureApproval === "DRAFT"}
        />
        <Link
          className="block text-sm underline"
          href={`/projects/${slug}/structure/history`}
        >
          View stage history
        </Link>
      </div>
    </DashboardLayout>
  );
}

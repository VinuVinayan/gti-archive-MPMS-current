import { redirect } from "next/navigation";
import type { PermissionUser } from "./permissions/resolver";
import { getProjectStageAccessRecordById } from "./project-stage-data";
import { canManageProjectStages } from "./project-templates";
import { PACKAGING_WORKSPACES } from "./project-template-definitions";

export async function requirePackagingStageRoute(
  projectId: string,
  user: PermissionUser,
  number: number,
) {
  const project = await getProjectStageAccessRecordById(projectId);
  if (!project) return;
  if (!canManageProjectStages(user, project))
    redirect(`/projects/${projectId}`);
  if (
    project.templateVersionId &&
    !project.stageInstances.some(
      (stage) => stage.workspace === PACKAGING_WORKSPACES[number - 1],
    )
  )
    redirect(`/projects/${projectId}`);
}

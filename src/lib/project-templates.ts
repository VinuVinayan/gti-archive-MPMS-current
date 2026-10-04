import { Prisma, type ProjectStageInstance } from "@prisma/client";
import { prisma } from "./prisma";
import {
  hasPermission,
  isProjectCoOwner,
  isProjectOwner,
  type PermissionUser,
  type ProjectPermissionContext,
} from "./permissions/resolver";
import { isBusinessAdministratorRole } from "./user-role-compatibility";
import {
  ProjectTemplateError,
  TEMPLATE_KEYS,
  validateStageDefinitions,
  type StageDefinitionInput,
  type TemplateKey,
} from "./project-template-definitions";

export function canManageProjectStages(
  user: PermissionUser,
  project: ProjectPermissionContext,
) {
  return (
    isProjectOwner(user, project) ||
    isProjectCoOwner(user, project) ||
    (isBusinessAdministratorRole(user.role) &&
      hasPermission(user, "stage.manageDefinitions"))
  );
}
export async function canManageProjectTemplates(
  user: Pick<PermissionUser, "id">,
) {
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true, templateManagementAccessGranted: true },
  });
  return (
    !!actor &&
    (actor.role === "SUPER_ADMIN" || actor.templateManagementAccessGranted)
  );
}
export async function setTemplateDirectorGrant(
  actor: PermissionUser,
  userId: string,
  granted: boolean,
) {
  const root = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { role: true },
  });
  if (root?.role !== "SUPER_ADMIN")
    throw new ProjectTemplateError(
      "Only Super Admin can assign Director template permissions.",
    );
  if (typeof granted !== "boolean")
    throw new ProjectTemplateError("Invalid permission value.");
  await prisma.user.update({
    where: { id: userId },
    data: { templateManagementAccessGranted: granted },
  });
}

export async function listProjectTemplates() {
  const templates = await prisma.projectTemplate.findMany({
    where: { isActive: true },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { stages: { orderBy: { order: "asc" } } },
      },
    },
  });
  return templates
    .sort(
      (a, b) =>
        TEMPLATE_KEYS.indexOf(a.key as TemplateKey) -
        TEMPLATE_KEYS.indexOf(b.key as TemplateKey),
    )
    .map(({ versions, ...template }) => ({
      ...template,
      version: versions[0],
    }));
}
export type ProjectTemplateOption = Awaited<
  ReturnType<typeof listProjectTemplates>
>[number];
export type TemplateSelection = {
  templateKey?: TemplateKey;
  templateVersionId?: string;
  customStages?: StageDefinitionInput[];
};

export async function createProjectTemplateSnapshotTx(
  tx: Prisma.TransactionClient,
  projectId: string,
  actorId: string,
  input: TemplateSelection,
) {
  const key = input.templateKey ?? "PACKAGING";
  if (!(TEMPLATE_KEYS as readonly string[]).includes(key))
    throw new ProjectTemplateError("Choose a valid project template.");
  const template = await tx.projectTemplate.findUnique({
    where: { key },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { stages: { orderBy: { order: "asc" } } },
      },
    },
  });
  const version = template?.versions[0];
  if (!template?.isActive || !version)
    throw new ProjectTemplateError("This project template is not available.");
  if (input.templateVersionId && input.templateVersionId !== version.id)
    throw new ProjectTemplateError(
      "The template has changed. Reload its preview before creating the project.",
    );
  const custom = key === "CUSTOM";
  const definitions = custom
    ? validateStageDefinitions(input.customStages).map((stage) => ({
        ...stage,
        id: undefined,
        workspace: "GENERAL",
        legacyStageKey: null,
        configuration: {},
      }))
    : version.stages;
  const now = new Date();
  await tx.project.update({
    where: { id: projectId },
    data: {
      templateKey: key,
      templateName: version.name,
      templateVersionId: version.id,
      structureApproval: custom ? "DRAFT" : "NOT_REQUIRED",
      stageCount: definitions.length,
      stageInstances: {
        create: definitions.map((stage, index) => ({
          sourceDefinitionId: custom ? null : stage.id,
          order: index + 1,
          name: stage.name,
          stageType: stage.stageType,
          description: stage.description,
          goal: stage.goal,
          guidance: stage.guidance,
          definitionOfDone: stage.definitionOfDone,
          workspace: stage.workspace,
          legacyStageKey: stage.legacyStageKey,
          required: stage.required,
          skippable: stage.skippable,
          configuration: stage.configuration as Prisma.InputJsonValue,
          status: index === 0 && !custom ? "AVAILABLE" : "LOCKED",
          unlockedAt: index === 0 && !custom ? now : null,
        })),
      },
      structureEvents: {
        create: {
          actorId,
          action: "SNAPSHOT_CREATED",
          reason: "Project created from template",
          details: {
            templateKey: key,
            versionId: version.id,
            version: version.version,
            stageCount: definitions.length,
          },
        },
      },
    },
  });
}

async function serializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
}
export async function publishProjectTemplate(
  user: PermissionUser,
  input: {
    key: string;
    expectedVersion: number;
    stages: unknown;
    reason: string;
  },
) {
  if (!(await canManageProjectTemplates(user)))
    throw new ProjectTemplateError("Director template permission is required.");
  const stages = validateStageDefinitions(input.stages);
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 2000
  )
    throw new ProjectTemplateError(
      "Enter a change reason (up to 2,000 characters).",
    );
  if (input.key === "CUSTOM")
    throw new ProjectTemplateError(
      "Custom stages are defined by each project owner.",
    );
  return serializable(async (tx) => {
    const template = await tx.projectTemplate.findUnique({
      where: { key: input.key },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: { stages: { orderBy: { order: "asc" } } },
        },
      },
    });
    if (!template || template.currentVersion !== input.expectedVersion)
      throw new ProjectTemplateError(
        "The template changed. Reload before publishing.",
      );
    const previous = template.versions[0];
    // Specialized Packaging engines depend on a fixed relative order. Preserve
    // those bindings; metadata/guidance edits still publish immutable versions.
    if (
      input.key === "PACKAGING" &&
      (stages.length !== previous.stages.length ||
        stages.some(
          (s, i) =>
            s.id !== previous.stages[i].id ||
            s.stageType !== previous.stages[i].stageType ||
            !s.required ||
            s.skippable,
        ))
    ) {
      throw new ProjectTemplateError(
        "Packaging engine stages must retain their order, types and required state. Names and guidance can be edited.",
      );
    }
    if (input.key === "DIGITAL" && stages.at(-1)?.stageType !== "MAINTENANCE")
      throw new ProjectTemplateError("Digital must end in Maintenance Mode.");
    const version = await tx.projectTemplateVersion.create({
      data: {
        templateId: template.id,
        version: template.currentVersion + 1,
        name: template.name,
        createdById: user.id,
        changeReason: input.reason.trim(),
        stages: {
          create: stages.map((stage, index) => {
            const prior = previous.stages.find((s) => s.id === stage.id);
            return {
              ...stage,
              id: undefined,
              order: index + 1,
              workspace:
                input.key === "PACKAGING"
                  ? previous.stages[index].workspace
                  : "GENERAL",
              legacyStageKey:
                input.key === "PACKAGING"
                  ? previous.stages[index].legacyStageKey
                  : null,
              configuration: (prior?.configuration ??
                {}) as Prisma.InputJsonValue,
            };
          }),
        },
      },
    });
    await tx.projectTemplate.update({
      where: { id: template.id },
      data: { currentVersion: version.version },
    });
    return version;
  });
}

export const templateProjectInclude = {
  coOwners: true,
  executors: true,
  stageInstances: {
    where: { retiredAt: null },
    orderBy: { order: "asc" as const },
  },
  templateVersion: true,
} satisfies Prisma.ProjectInclude;
async function managedProject(
  tx: Prisma.TransactionClient,
  user: PermissionUser,
  projectId: string,
) {
  // Serialize edits, approval, saves and transitions for the same project.
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id"=${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: templateProjectInclude,
  });
  if (!project || !canManageProjectStages(user, project))
    throw new ProjectTemplateError(
      "Project stage management access is required.",
    );
  if (project.archivedAt || project.completedAt)
    throw new ProjectTemplateError(
      "Completed or archived projects are read-only.",
    );
  return project;
}
export async function updateCustomProjectStructure(
  user: PermissionUser,
  input: {
    projectId: string;
    expectedRevision: number;
    stages: unknown;
    reason: string;
  },
) {
  const definitions = validateStageDefinitions(input.stages);
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 2000
  )
    throw new ProjectTemplateError("Enter a reason for the structure change.");
  return serializable(async (tx) => {
    const project = await managedProject(tx, user, input.projectId);
    if (project.templateKey !== "CUSTOM")
      throw new ProjectTemplateError(
        "Only Custom project structures can be edited here.",
      );
    if (project.structureRevision !== input.expectedRevision)
      throw new ProjectTemplateError(
        "The structure changed. Reload before saving.",
      );
    if (
      project.workflowStartedAt ||
      project.stageInstances.some(
        (s) => s.content || s.completedAt || s.skippedAt,
      )
    )
      throw new ProjectTemplateError(
        "This project has begun. Its structure is locked to preserve history.",
      );
    const prior = new Map(
      project.stageInstances.map((stage) => [stage.id, stage]),
    );
    for (const stage of definitions)
      if (stage.id && !prior.has(stage.id))
        throw new ProjectTemplateError(
          "An existing stage does not belong to this project.",
        );
    // Temporarily move retained stages out of the order range; retired rows keep
    // unique negative orders and their IDs/content remain available to history.
    const retired = await tx.projectStageInstance.aggregate({
      where: { projectId: project.id },
      _min: { order: true },
    });
    let order = Math.min(0, retired._min.order ?? 0) - 1;
    for (const stage of project.stageInstances)
      await tx.projectStageInstance.update({
        where: { id: stage.id },
        data: {
          order: order--,
          retiredAt: new Date(),
          status: "LOCKED",
          unlockedAt: null,
        },
      });
    for (const [index, stage] of definitions.entries()) {
      const { id, ...data } = stage;
      if (id)
        await tx.projectStageInstance.update({
          where: { id },
          data: {
            ...data,
            order: index + 1,
            retiredAt: null,
            revision: { increment: 1 },
          },
        });
      else
        await tx.projectStageInstance.create({
          data: { ...data, projectId: project.id, order: index + 1 },
        });
    }
    await tx.project.update({
      where: { id: project.id },
      data: {
        structureRevision: { increment: 1 },
        structureApproval: "DRAFT",
        structureApprovedAt: null,
        structureApprovedById: null,
        stageCount: definitions.length,
      },
    });
    await tx.projectStructureEvent.create({
      data: {
        projectId: project.id,
        actorId: user.id,
        action: "STRUCTURE_EDITED",
        reason: input.reason.trim(),
        details: {
          before: JSON.parse(JSON.stringify(project.stageInstances)),
          after: definitions,
        } as Prisma.InputJsonValue,
      },
    });
  });
}
export async function approveCustomProjectStructure(
  user: PermissionUser,
  projectId: string,
  expectedRevision: number,
) {
  if (!(await canManageProjectTemplates(user)))
    throw new ProjectTemplateError("Director template permission is required.");
  return serializable(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id"=${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: templateProjectInclude,
    });
    if (
      !project ||
      project.templateKey !== "CUSTOM" ||
      project.archivedAt ||
      project.completedAt ||
      project.workflowStartedAt
    )
      throw new ProjectTemplateError("This project is not awaiting approval.");
    if (project.structureRevision !== expectedRevision)
      throw new ProjectTemplateError(
        "The structure changed. Review the latest revision.",
      );
    if (project.structureApproval === "APPROVED") return;
    if (!project.stageInstances.length)
      throw new ProjectTemplateError("Define at least one stage.");
    const now = new Date();
    await tx.project.update({
      where: { id: projectId },
      data: {
        structureApproval: "APPROVED",
        structureApprovedById: user.id,
        structureApprovedAt: now,
      },
    });
    await tx.projectStageInstance.update({
      where: { id: project.stageInstances[0].id },
      data: { status: "AVAILABLE", unlockedAt: now },
    });
    await tx.projectStructureEvent.create({
      data: {
        projectId,
        actorId: user.id,
        action: "STRUCTURE_APPROVED",
        reason: "Director approved project structure",
        details: {
          revision: expectedRevision,
          stages: JSON.parse(JSON.stringify(project.stageInstances)),
        },
      },
    });
  });
}

function assertGenericStage(
  project: {
    structureApproval: string;
    stageInstances: ProjectStageInstance[];
  },
  stageId: string,
) {
  if (project.structureApproval === "DRAFT")
    throw new ProjectTemplateError(
      "Director approval is required before this Custom project can begin.",
    );
  const stage = project.stageInstances.find((s) => s.id === stageId);
  if (!stage || stage.legacyStageKey || stage.workspace !== "GENERAL")
    throw new ProjectTemplateError(
      "Use the specialized workspace for this stage.",
    );
  if (stage.status !== "AVAILABLE")
    throw new ProjectTemplateError("This stage is locked or completed.");
  if (
    project.stageInstances.some(
      (s) => s.order < stage.order && s.status !== "COMPLETED",
    )
  )
    throw new ProjectTemplateError("Complete the preceding stages first.");
  return stage;
}
export async function saveGenericStageContent(
  user: PermissionUser,
  input: {
    projectId: string;
    stageId: string;
    content: string;
    expectedRevision: number;
  },
) {
  if (typeof input.content !== "string" || input.content.length > 100000)
    throw new ProjectTemplateError(
      "Stage notes must be at most 100,000 characters.",
    );
  return serializable(async (tx) => {
    const project = await managedProject(tx, user, input.projectId);
    const stage = assertGenericStage(project, input.stageId);
    if (stage.revision !== input.expectedRevision)
      throw new ProjectTemplateError(
        "Stage notes changed. Reload before saving to avoid overwriting another edit.",
      );
    if (stage.content === input.content) return stage.revision;
    const result = await tx.projectStageInstance.update({
      where: { id: stage.id },
      data: { content: input.content, revision: { increment: 1 } },
    });
    await tx.project.update({
      where: { id: project.id },
      data: { workflowStartedAt: project.workflowStartedAt ?? new Date() },
    });
    await tx.projectStructureEvent.create({
      data: {
        projectId: project.id,
        actorId: user.id,
        action: "STAGE_CONTENT_SAVED",
        reason: "Stage notes saved",
        details: {
          stageId: stage.id,
          before: stage.content,
          after: input.content,
          revision: result.revision,
        },
      },
    });
    return result.revision;
  });
}
export async function completeGenericProjectStage(
  user: PermissionUser,
  input: {
    projectId: string;
    stageId: string;
    expectedRevision: number;
    skip?: boolean;
    reason?: string;
  },
) {
  if (input.skip !== undefined && typeof input.skip !== "boolean")
    throw new ProjectTemplateError("Invalid skip selection.");
  if (
    input.reason !== undefined &&
    (typeof input.reason !== "string" || input.reason.length > 2000)
  )
    throw new ProjectTemplateError(
      "Enter a reason of at most 2,000 characters.",
    );
  return serializable(async (tx) => {
    const project = await managedProject(tx, user, input.projectId);
    const stage = assertGenericStage(project, input.stageId);
    if (stage.revision !== input.expectedRevision)
      throw new ProjectTemplateError(
        "Stage changed. Reload before completing it.",
      );
    if (stage.stageType === "MAINTENANCE")
      throw new ProjectTemplateError(
        "Maintenance stays open and has no fixed end date.",
      );
    if (
      input.skip &&
      (stage.required || !stage.skippable || !input.reason?.trim())
    )
      throw new ProjectTemplateError(
        "Only skippable optional stages may be skipped, with a reason.",
      );
    const now = new Date();
    await tx.projectStageInstance.update({
      where: { id: stage.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        skippedAt: input.skip ? now : null,
        revision: { increment: 1 },
      },
    });
    const next = project.stageInstances.find((s) => s.order > stage.order);
    if (next)
      await tx.projectStageInstance.update({
        where: { id: next.id },
        data: { status: "AVAILABLE", unlockedAt: now },
      });
    await tx.project.update({
      where: { id: project.id },
      data: {
        workflowStartedAt: project.workflowStartedAt ?? now,
        ...(!next ? { completedAt: now } : {}),
      },
    });
    if (!next)
      await tx.projectClosure.upsert({
        where: { projectId: project.id },
        create: { projectId: project.id, closedById: user.id, closedAt: now },
        update: {},
      });
    await tx.projectStructureEvent.create({
      data: {
        projectId: project.id,
        actorId: user.id,
        action: input.skip ? "STAGE_SKIPPED" : "STAGE_COMPLETED",
        reason: input.reason?.trim() || "Stage completed",
        details: { stageId: stage.id, nextStageId: next?.id ?? null },
      },
    });
  });
}

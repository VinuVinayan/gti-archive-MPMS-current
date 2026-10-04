import {
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  type Prisma,
} from "@prisma/client";

import {
  getProjectWorkflowSequenceState,
  PROJECT_WORKFLOW_STAGE_DEFINITIONS,
} from "@/lib/project-workflow";

export const PROJECT_LIST_STATUSES = [
  "ALL",
  "ACTIVE",
  "COMPLETED",
] as const;

export type ProjectListStatus = (typeof PROJECT_LIST_STATUSES)[number];

export const PROJECT_LIST_ROLES = [
  "ALL",
  "OWNER",
  "CO_OWNER",
  "EXECUTOR",
  "COLLABORATOR",
] as const;

export type ProjectListRole = (typeof PROJECT_LIST_ROLES)[number];

export type ProjectBusinessStatus = Exclude<ProjectListStatus, "ALL">;
export type ProjectWorkflowHealth = "VALID" | "MISSING" | "INVALID";

export type ProjectListWorkflowState = {
  businessStatus: ProjectBusinessStatus | null;
  statusLabel: "Active" | "Completed" | null;
  workflowHealth: ProjectWorkflowHealth;
  workflowDiagnosticLabel: "Workflow Missing" | "Legacy Project" | null;
  currentStageNumber: number | null;
  currentStageName: string | null;
  stageStatuses: ProjectWorkflowStageStatus[];
};

type ProjectListWorkflowInput = {
  structureApproval?: string;
  stageInstances?: Array<{ id?: string; order: number; name: string; status: ProjectWorkflowStageStatus; retiredAt?: Date | null }>;
  id?: string;
  completedAt?: Date | null;
  closure?: { id: string } | null;
  workflowStages: Array<{
    stageKey: ProjectWorkflowStageKey;
    status: ProjectWorkflowStageStatus;
    unlockedAt?: Date | null;
    completedAt?: Date | null;
  }>;
};

const stageKeys = PROJECT_WORKFLOW_STAGE_DEFINITIONS.map((stage) => stage.key);

function buildCompletedWhere(): Prisma.ProjectWhereInput {
  return {
    AND: stageKeys.map((stageKey) => ({
      workflowStages: {
        some: {
          stageKey,
          status: ProjectWorkflowStageStatus.COMPLETED,
          unlockedAt: { not: null },
          completedAt: { not: null },
        },
      },
    })),
  };
}

function buildInitializedWorkflowWhere(): Prisma.ProjectWhereInput {
  return {
    AND: stageKeys.map((stageKey) => ({
      workflowStages: { some: { stageKey } },
    })),
  };
}

function buildValidActiveWorkflowWhere(): Prisma.ProjectWhereInput {
  const completedWhere = buildCompletedWhere();

  return {
    AND: [
      { NOT: completedWhere },
      buildInitializedWorkflowWhere(),
      {
        OR: stageKeys.map((availableStageKey, availableIndex) => ({
          AND: [
            {
              workflowStages: {
                some: {
                  stageKey: availableStageKey,
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                  unlockedAt: { not: null },
                  completedAt: null,
                },
              },
            },
            ...stageKeys.slice(0, availableIndex).map((stageKey) => ({
              workflowStages: {
                some: {
                  stageKey,
                  status: ProjectWorkflowStageStatus.COMPLETED,
                  unlockedAt: { not: null },
                  completedAt: { not: null },
                },
              },
            })),
            ...stageKeys.slice(availableIndex + 1).map((stageKey) => ({
                workflowStages: {
                  some: {
                    stageKey,
                    status: ProjectWorkflowStageStatus.LOCKED,
                    unlockedAt: null,
                    completedAt: null,
                  },
                },
              })),
          ],
        })),
      },
    ],
  };
}

/**
 * Builds the server-side predicate from the same V2 workflow rules used by the
 * card mapper below. Listing projects never repairs or advances workflow rows.
 */
export function buildProjectListStatusWhere(
  status: ProjectListStatus,
): Prisma.ProjectWhereInput {
  if (status === "ALL") return {};

  const completedWhere = buildCompletedWhere();

  const hasSnapshot: Prisma.ProjectWhereInput = { stageInstances: { some: { retiredAt: null } } };
  const snapshotCompleted: Prisma.ProjectWhereInput = { AND: [hasSnapshot, { stageInstances: { none: { retiredAt: null, status: { not: "COMPLETED" } } } }] };
  return { OR: [
    status === "COMPLETED" ? snapshotCompleted : { AND: [hasSnapshot, { NOT: snapshotCompleted }] },
    { AND: [{ stageInstances: { none: {} } }, status === "COMPLETED" ? completedWhere : buildValidActiveWorkflowWhere()] },
  ] };
}

function buildLegacyProjectListStageWhere(
  stageNumber: number | null,
): Prisma.ProjectWhereInput {
  if (!stageNumber) return {};

  const definition = PROJECT_WORKFLOW_STAGE_DEFINITIONS.find(
    (stage) => stage.number === stageNumber,
  );

  if (!definition) return {};

  if (stageNumber === PROJECT_WORKFLOW_STAGE_DEFINITIONS.length) {
    return {
      OR: [
        buildCompletedWhere(),
        {
          AND: [
            buildValidActiveWorkflowWhere(),
            {
              workflowStages: {
                some: {
                  stageKey: definition.key,
                  status: ProjectWorkflowStageStatus.AVAILABLE,
                  unlockedAt: { not: null },
                  completedAt: null,
                },
              },
            },
          ],
        },
      ],
    };
  }

  return {
    AND: [
      buildValidActiveWorkflowWhere(),
      {
        workflowStages: {
          some: {
            stageKey: definition.key,
            status: ProjectWorkflowStageStatus.AVAILABLE,
            unlockedAt: { not: null },
            completedAt: null,
          },
        },
      },
    ],
  };
}

export function deriveProjectListWorkflowState(
  project: ProjectListWorkflowInput,
): ProjectListWorkflowState {
  const instances = project.stageInstances?.filter(stage => !stage.retiredAt).sort((a,b)=>a.order-b.order);
  if (instances?.length) {
    const completed = instances.every(stage => stage.status === "COMPLETED");
    const current = instances.find(stage => stage.status !== "COMPLETED") ?? instances.at(-1)!;
    return {
      businessStatus: completed ? "COMPLETED" : "ACTIVE", statusLabel: completed ? "Completed" : "Active",
      workflowHealth: "VALID", workflowDiagnosticLabel: null,
      currentStageNumber: current.order, currentStageName: current.name,
      stageStatuses: instances.map(stage => stage.status),
    };
  }
  const stageByKey = new Map(
    project.workflowStages.map((stage) => [stage.stageKey, stage] as const),
  );
  const stageStatuses = stageKeys.map(
    (stageKey) =>
      stageByKey.get(stageKey)?.status ?? ProjectWorkflowStageStatus.LOCKED,
  );
  const sequence = getProjectWorkflowSequenceState(project.workflowStages);
  const isCompleted = sequence.kind === "COMPLETED";

  const hasCompleteStageSet =
    project.workflowStages.length === stageKeys.length &&
    stageKeys.every((stageKey) => stageByKey.has(stageKey));
  const availableStages = PROJECT_WORKFLOW_STAGE_DEFINITIONS.filter(
    (definition) =>
      stageByKey.get(definition.key)?.status ===
      ProjectWorkflowStageStatus.AVAILABLE,
  );
  const workflowHealth: ProjectWorkflowHealth =
    sequence.kind === "MISSING"
      ? "MISSING"
      : !hasCompleteStageSet || sequence.kind === "INVALID"
        ? "INVALID"
        : "VALID";
  const workflowDiagnosticLabel =
    workflowHealth === "MISSING"
      ? "Workflow Missing"
      : workflowHealth === "INVALID"
        ? "Legacy Project"
        : null;

  if (isCompleted && workflowHealth === "VALID") {
    return {
      businessStatus: "COMPLETED",
      statusLabel: "Completed",
      workflowHealth,
      workflowDiagnosticLabel,
      currentStageNumber: PROJECT_WORKFLOW_STAGE_DEFINITIONS.length,
      currentStageName:
        PROJECT_WORKFLOW_STAGE_DEFINITIONS[
          PROJECT_WORKFLOW_STAGE_DEFINITIONS.length - 1
        ].name,
      stageStatuses,
    };
  }

  if (workflowHealth !== "VALID") {
    console.warn("[projects:list] Invalid or missing V2 workflow", {
      projectId: project.id,
      workflowHealth,
      stageKeys: availableStages.map((stage) => stage.key),
    });

    return {
      businessStatus: null,
      statusLabel: null,
      workflowHealth,
      workflowDiagnosticLabel,
      currentStageNumber: null,
      currentStageName: null,
      stageStatuses,
    };
  }

  const currentStage =
    sequence.kind === "ACTIVE" ? sequence.currentStage : availableStages[0];

  return {
    businessStatus: "ACTIVE",
    statusLabel: "Active",
    workflowHealth,
    workflowDiagnosticLabel,
    currentStageNumber: currentStage.number,
    currentStageName: currentStage.name,
    stageStatuses,
  };
}

export function buildProjectListStageWhere(stageNumber: number | null): Prisma.ProjectWhereInput {
  if (!stageNumber) return {};
  return { OR: [
    { stageInstances: { some: { order: stageNumber, retiredAt: null, status: "AVAILABLE" } } },
    { AND: [{ stageInstances: { none: {} } }, buildLegacyProjectListStageWhere(stageNumber)] },
  ] };
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ProjectWorkflowStageStatus,
} from "@prisma/client";

import {
  canOpenImplementedWorkflowStage,
  getProjectWorkflowStageAccess,
} from "../src/lib/workflow-stage-access";
import {
  getInitialProjectWorkflowStageData,
  getProjectWorkflowSequenceState,
  getWorkflowStageCompletionMode,
  PROJECT_WORKFLOW_STAGE_DEFINITIONS,
} from "../src/lib/project-workflow";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const initial = getInitialProjectWorkflowStageData(
  new Date("2026-08-10T00:00:00.000Z"),
);
assert.equal(initial.length, 7, "A new project must have exactly seven workflow rows.");
assert.equal(initial[0].status, ProjectWorkflowStageStatus.AVAILABLE);
assert(initial[0].unlockedAt, "Stage 1 must have its initial unlock timestamp.");
assert.equal("completedAt" in initial[0], false);
for (const stage of initial.slice(1)) {
  assert.equal(stage.status, ProjectWorkflowStageStatus.LOCKED);
  assert.equal(stage.unlockedAt, null);
  assert.equal("completedAt" in stage, false);
}

function stateAt(currentStageNumber: number) {
  const timestamp = new Date("2026-08-10T00:00:00.000Z");
  return PROJECT_WORKFLOW_STAGE_DEFINITIONS.map((definition) => ({
    stageKey: definition.key,
    status:
      definition.number < currentStageNumber
        ? ProjectWorkflowStageStatus.COMPLETED
        : definition.number === currentStageNumber
          ? ProjectWorkflowStageStatus.AVAILABLE
          : ProjectWorkflowStageStatus.LOCKED,
    unlockedAt:
      definition.number <= currentStageNumber ? timestamp : null,
    completedAt:
      definition.number < currentStageNumber ? timestamp : null,
  }));
}

for (let currentStageNumber = 1; currentStageNumber <= 7; currentStageNumber += 1) {
  const stages = stateAt(currentStageNumber);
  const sequence = getProjectWorkflowSequenceState(stages);
  assert.equal(sequence.kind, "ACTIVE");
  assert.equal(
    sequence.kind === "ACTIVE" ? sequence.currentStage.number : null,
    currentStageNumber,
  );

  for (const definition of PROJECT_WORKFLOW_STAGE_DEFINITIONS) {
    const persisted = stages.find((stage) => stage.stageKey === definition.key)!;
    const expectedOpen = definition.number <= currentStageNumber;
    assert.equal(
      canOpenImplementedWorkflowStage({
        stageKey: definition.key,
        status: persisted.status,
      }),
      expectedOpen,
      `Stage ${definition.number} access must follow only persisted workflow status.`,
    );
  }

  assert.equal(
    getWorkflowStageCompletionMode(
      stages,
      PROJECT_WORKFLOW_STAGE_DEFINITIONS[currentStageNumber - 1].key,
    ),
    "TRANSITION",
  );
  for (let index = 0; index < currentStageNumber - 1; index += 1) {
    assert.equal(
      getWorkflowStageCompletionMode(stages, PROJECT_WORKFLOW_STAGE_DEFINITIONS[index].key),
      "RETRY",
    );
  }
  for (let index = currentStageNumber; index < 7; index += 1) {
    assert.equal(
      getWorkflowStageCompletionMode(stages, PROJECT_WORKFLOW_STAGE_DEFINITIONS[index].key),
      "UNAVAILABLE",
    );
  }
}

const completed = PROJECT_WORKFLOW_STAGE_DEFINITIONS.map((definition) => ({
  stageKey: definition.key,
  status: ProjectWorkflowStageStatus.COMPLETED,
  unlockedAt: new Date("2026-08-10T00:00:00.000Z"),
  completedAt: new Date("2026-08-10T01:00:00.000Z"),
}));
assert.equal(getProjectWorkflowSequenceState(completed).kind, "COMPLETED");
for (const definition of PROJECT_WORKFLOW_STAGE_DEFINITIONS) {
  assert.equal(getWorkflowStageCompletionMode(completed, definition.key), "RETRY");
}

assert.deepEqual(getProjectWorkflowStageAccess(ProjectWorkflowStageStatus.LOCKED), {
  allowed: false,
  code: "STAGE_LOCKED",
  status: ProjectWorkflowStageStatus.LOCKED,
});
assert.equal(getProjectWorkflowStageAccess(undefined).code, "STAGE_LOCKED");
assert.equal(
  getProjectWorkflowStageAccess(ProjectWorkflowStageStatus.AVAILABLE).allowed,
  true,
);
assert.equal(
  getProjectWorkflowStageAccess(ProjectWorkflowStageStatus.COMPLETED).allowed,
  true,
);

const skipped = stateAt(2);
skipped[0].status = ProjectWorkflowStageStatus.LOCKED;
skipped[0].unlockedAt = null;
skipped[0].completedAt = null;
assert.equal(getProjectWorkflowSequenceState(skipped).kind, "INVALID");
const multipleAvailable = stateAt(2);
multipleAvailable[2].status = ProjectWorkflowStageStatus.AVAILABLE;
multipleAvailable[2].unlockedAt = new Date();
assert.equal(getProjectWorkflowSequenceState(multipleAvailable).kind, "INVALID");
const invalidTimestamp = stateAt(3);
invalidTimestamp[1].unlockedAt = null;
assert.equal(getProjectWorkflowSequenceState(invalidTimestamp).kind, "INVALID");
assert.equal(getProjectWorkflowSequenceState([]).kind, "MISSING");
assert.equal(
  getWorkflowStageCompletionMode(
    multipleAvailable,
    PROJECT_WORKFLOW_STAGE_DEFINITIONS[1].key,
  ),
  "UNAVAILABLE",
);

const accessPolicy = source("src/lib/workflow-stage-access.ts");
assert(!accessPolicy.includes("UserRole"), "Workflow access must not depend on a role.");
assert(!/role\s*===/.test(accessPolicy), "Workflow access must not contain a role bypass.");
assert(!accessPolicy.includes("NODE_ENV"), "Workflow locks must be environment-independent.");
assert(!accessPolicy.includes("searchParams"), "Workflow locks must not have a query bypass.");

const overview = source("src/components/projects/project-overview-workspace.tsx");
assert(overview.includes("const stageOpenable = !locked"));
assert(overview.includes("Complete Stage ${stage.order - 1} to unlock Stage ${stage.order}."));
assert(!overview.includes("canBypassLocked"));
assert(!overview.includes("canBypassLockedStage"));
assert.equal(
  overview.match(/href=\{stageInstanceHref\(projectId, stage\)\}/g)?.length,
  1,
  "A stage card may expose only the guarded Open Stage href.",
);

const routeFiles = [
  "src/app/(dashboard)/projects/[slug]/stages/1/page.tsx",
  "src/app/(dashboard)/projects/[slug]/stages/2/page.tsx",
  "src/components/projects/concept-stage-route.tsx",
  "src/app/(dashboard)/projects/[slug]/stages/5/page.tsx",
  "src/app/(dashboard)/projects/[slug]/stages/6/page.tsx",
  "src/app/(dashboard)/projects/[slug]/stages/7/page.tsx",
];
for (const path of routeFiles) {
  const contents = source(path);
  assert(contents.includes("canOpenImplementedWorkflowStage"), `${path} lacks a server lock guard.`);
  assert(contents.includes("StageLockedState"), `${path} lacks a clean locked view.`);
}

const conceptAccess = source("src/lib/project-concept-access.ts");
assert(conceptAccess.includes("isProjectConceptWorkflowAccessible"));
assert(conceptAccess.includes('throw new Error("This workflow stage is locked.")'));
const history = source("src/lib/project-history.ts");
assert(history.includes("isProjectConceptWorkflowAccessible(sourceConcept)"));
assert(history.includes("canOpenProjectStageChatContainer"));
const realtime = source("src/app/api/realtime/ably/token/route.ts");
assert(realtime.includes("canOpenProjectStageChatContainer"));

const stageFive = source("src/lib/stage-five.ts");
assert(stageFive.includes("accessibleStageFiveProjectWhere"));
for (const operation of [
  "getStageFiveChecklistRequestData",
  "getStageFiveChecklistRequestSourceFileUrl",
  "getStageFiveChecklistRequestUploadContext",
  "acceptStageFiveChecklistRequest",
  "declineStageFiveChecklistRequest",
  "submitStageFiveChecklistResponse",
]) {
  assert(stageFive.includes(operation), `Missing protected Stage 5 operation ${operation}.`);
}

const stageSix = source("src/lib/stage-six.ts");
assert(stageSix.includes("accessibleStageSixProjectWhere"));
assert(stageSix.includes('return { state: "locked" } as const'));
assert(stageSix.includes("scope.kind === \"authenticated\""));
assert(stageSix.includes("scope.kind === \"external\""));

for (const path of [
  "src/lib/project-inquiry.ts",
  "src/lib/project-research.ts",
  "src/lib/project-concepts.ts",
  "src/lib/stage-six.ts",
  "src/lib/stage-seven.ts",
]) {
  assert(
    source(path).includes("getWorkflowStageCompletionMode"),
    `${path} must validate the strict sequence before completion.`,
  );
}

const schema = source("prisma/schema.prisma");
assert(schema.includes("@@unique([projectId, stageKey])"));
const creation = source("src/lib/project-creation.ts");
assert(creation.includes("getInitialProjectWorkflowStageData()"));
assert(!source("src/lib/project-inquiry.ts").includes("getInitialProjectWorkflowStageData"));

const allRuntimeSources = [
  accessPolicy,
  overview,
  source("src/app/(dashboard)/projects/[slug]/page.tsx"),
].join("\n");
for (const forbidden of [
  "canBypassImplementedWorkflowStageLock",
  "allowLockedStage",
  "canAccessLockedStage",
  "forceUnlock",
]) {
  assert(!allRuntimeSources.includes(forbidden), `Runtime bypass remains: ${forbidden}`);
}

console.log("Workflow lock, sequential state, nested-route, and bypass regression checks passed.");

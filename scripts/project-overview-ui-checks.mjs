import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [overview, summary, workflow, projectPage, createForm, projectQuery] = await Promise.all([
  readFile("src/components/projects/project-overview-workspace.tsx", "utf8"),
  readFile("src/components/projects/project-summary-strip.tsx", "utf8"),
  readFile("src/lib/project-workflow.ts", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/page.tsx", "utf8"),
  readFile("src/components/projects/create-project-form.tsx", "utf8"),
  readFile("src/lib/projects.ts", "utf8"),
]);

const stageNames = [
  "Project Inquiry",
  "Project Research and Planning",
  "Initial Concept",
  "Final Concept",
  "Final Layout",
  "Production and Handover",
  "Implementation and Supervision",
];

for (const [index, stageName] of stageNames.entries()) {
  assert.match(workflow, new RegExp(`number: ${index + 1},`));
  assert(workflow.includes(`name: "${stageName}"`), `Missing predefined stage: ${stageName}`);
}

for (const label of [
  "Project Name",
  "Project Owner",
  "Project Co-Owners",
  "Project Executors",
]) {
  assert(summary.includes(`label="${label}"`), `Missing project summary item: ${label}`);
}

assert(
  overview.includes("ProjectFlowSummaryStrip") &&
    !overview.includes("ProjectSummaryItem"),
  "Project Overview must reuse the compact shared summary instead of a vertical local design.",
);
assert(
  summary.includes("people.slice(0, visibleCount)") &&
    summary.includes("visibleCount = 1") &&
    /people=\{executors\}[\s\S]*?visibleCount=\{3\}/.test(summary) &&
    summary.includes("people.length - visiblePeople.length") &&
    summary.includes("+{remainingCount}"),
  "Shared people summaries must display three executor names, default to one for other groups, and show +N for additional people.",
);
assert(
  summary.includes("DropdownMenuTrigger asChild") &&
    summary.includes('<button') &&
    summary.includes("aria-label={`View ${remainingCount} more") &&
    summary.includes("people.map((person)"),
  "+N must be a real accessible button that opens the complete participant list.",
);
assert(
  summary.includes("person.email") &&
    summary.includes("title={person.name}") &&
    summary.includes("min-w-0") &&
    summary.includes("truncate"),
  "The participant menu must expose names/emails while compact labels truncate safely.",
);
assert(
  summary.includes('"sm:grid-cols-2 xl:grid-cols-4"'),
  "The shared summary must adapt from stacked/two-column layouts to four desktop columns.",
);
assert(
  summary.includes('text-[16px] font-[700] leading-6'),
  "Project summary values must remain visually prominent beneath their compact labels.",
);
assert(
  overview.includes("min-h-[210px]") &&
    overview.includes("line-clamp-2") &&
    overview.includes('className="h-10') &&
    overview.includes('className="mt-4 grid gap-3'),
  "Overview stage cards must use the compact height, two-line copy, controls, and grid gaps.",
);

assert(
  overview.includes("const stageOpenable = !locked"),
  "All seven stages must be openable only when persisted status permits.",
);
assert(overview.includes("Open Stage"), "Implemented stages should show the Open Stage CTA.");
assert(
  overview.includes("href={`/projects/${projectId}/stages/${stage.number}`}"),
  "Implemented stages should open their dedicated UI route.",
);
assert(overview.includes("status === \"AVAILABLE\""), "Available state must come from persisted workflow status.");
assert(overview.includes("status === \"COMPLETED\""), "Completed state must come from persisted workflow status.");
assert(
  !overview.includes("Available · Stage UI coming next"),
  "All seven implemented stages must use their real route when available.",
);
assert(overview.includes("disabled"), "Unavailable stage controls should be disabled.");
assert(overview.includes("Locked"), "Locked workflow stages should show their real state.");
assert(
  overview.includes("Complete Stage ${stage.number - 1} to unlock Stage ${stage.number}.") &&
    !overview.includes("canBypassLocked"),
  "Locked cards must explain progression and must not expose a runtime bypass.",
);
assert(
  projectQuery.includes("workflowStages:") && projectQuery.includes("stageKey: stage.stageKey"),
  "The project query must return persisted workflow stage state.",
);
assert(
  projectQuery.includes("toProjectIsoString(stage.unlockedAt)") &&
    projectQuery.includes("toProjectIsoString(stage.completedAt)"),
  "Cached workflow dates must accept both Prisma Date values and serialized strings.",
);
assert(
  projectPage.includes("ProjectOverviewWorkspace") &&
    projectPage.includes("getProjectStageShellById"),
  "The project landing route should render the overview from the lightweight stage shell query.",
);
assert(
  createForm.includes("router.push(`/projects/${result.projectId}`)"),
  "Successful project creation should open the project overview.",
);

console.log("Project overview UI checks passed.");

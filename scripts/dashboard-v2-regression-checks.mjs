import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  page,
  workspace,
  service,
  stats,
  projectWorkflow,
  flexibleProjectsService,
  schema,
] =
  await Promise.all([
    readFile("src/app/(dashboard)/page.tsx", "utf8"),
    readFile("src/components/dashboard/dashboard-workspace.tsx", "utf8"),
    readFile("src/lib/dashboard.ts", "utf8"),
    readFile("src/components/dashboard/stat-card.tsx", "utf8"),
    readFile("src/lib/project-list-workflow.ts", "utf8"),
    readFile("src/lib/flexible-projects.ts", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
  ]);

for (const removed of [
  "Pending Projects",
  "On Hold Projects",
  "ProjectProgressCard",
  "CollaborationCard",
  "ReminderCard",
  "ArchiveUploadButton",
  "No status",
]) {
  assert(!page.includes(removed), `Legacy dashboard content remains: ${removed}`);
}

assert(page.includes("snapshot.kpis.map"), "Dashboard KPI cards must share one snapshot.");
assert(
  service.match(/label:/g)?.length && service.includes('label: "Needs Attention"'),
  "Dashboard KPI definitions are missing.",
);
assert(
  /return \[\s*[\s\S]*?icon: "projects"[\s\S]*?icon: "active"[\s\S]*?icon: "attention"[\s\S]*?icon: "completed"[\s\S]*?\];/.test(
    service,
  ),
  "Dashboard must return exactly the four primary KPI definitions.",
);
assert(stats.includes("KPI_ICONS"), "KPI cards must use the shared visual component.");

for (const panel of [
  "Needs Attention",
  "Upcoming Deadlines",
  "Projects by Stage",
  "My Work",
  "Private Projects",
  "Recent Projects",
]) {
  assert(workspace.includes(panel), `Dashboard panel is missing: ${panel}`);
}

assert(
  /function ProjectsByStage[\s\S]*?<Panel className="self-start xl:col-span-3">/.test(
    workspace,
  ),
  "Projects by Stage must keep its natural height instead of stretching to the My Work panel.",
);

assert(
  service.includes("deriveProjectListWorkflowState(project)"),
  "Dashboard must reuse centralized V2 project state derivation.",
);
for (const state of ["ACTIVE", "COMPLETED"]) {
  assert(projectWorkflow.includes(`"${state}"`), `Shared V2 state is missing: ${state}`);
}
assert(
  !service.includes("SETUP_NEEDED") &&
    !workspace.includes("SETUP_NEEDED") &&
    !workspace.includes("Setup Needed"),
  "Dashboard must not expose Setup Needed as a business status.",
);
assert(
  service.includes("workflow.businessStatus") &&
    service.includes("workflow.workflowDiagnosticLabel"),
  "Dashboard must keep business state separate from SUPER_ADMIN workflow diagnostics.",
);

assert(
  service.includes("if (isGlobalProjectAdministrator(user)) return {};") &&
    service.includes("{ ownerId: user.id }") &&
    service.includes("coOwners: { some: { userId: user.id } }") &&
    service.includes("executors: { some: { userId: user.id } }") &&
    service.includes("collaborators: { some: { userId: user.id } }") &&
    service.includes("const isGlobalAdministrator = isGlobalProjectAdministrator(user)"),
  "Dashboard scope must be global for business administrators and relationship-based for standard users.",
);
assert(
  flexibleProjectsService.includes("export function getFlexibleProjectAccessWhere") &&
    flexibleProjectsService.includes("if (isGlobalProjectAdministrator(user)) return {};") &&
    flexibleProjectsService.includes("{ ownerId: user.id }") &&
    flexibleProjectsService.includes("collaborators: { some: { userId: user.id } }") &&
    service.includes("where: getFlexibleProjectAccessWhere(user)"),
  "Flexible dashboard projects must reuse the global-admin and owner/collaborator access scope.",
);
assert(
  service.includes("projectId: { in: activeProjectIds }"),
  "Operational dashboard queries must begin from authorized active project IDs.",
);

for (const actionType of [
  "Brief waiting to be accepted",
  "Changes requested",
  "Revision awaiting review",
  "Information requested",
  "Requested information received",
  "Approval waiting for your decision",
  "Production approval rejected",
  "Production handover failed",
  "Physical sample request overdue",
]) {
  assert(service.includes(actionType), `Attention source is missing: ${actionType}`);
}
assert(
  service.includes("attentionCount: attentionItems.length") &&
    service.includes("attention: attentionItems.slice(0, 6)"),
  "Needs Attention KPI and panel must share the same normalized feed.",
);
assert(
  service.includes("export async function getNeedsAttentionItems") &&
    service.includes("dedupeKey: `concept:${folder.id}`") &&
    service.includes("executorIsWaitingForReview"),
  "Needs Attention must be reusable, deduplicated by work item, and limited to the next actor.",
);

for (const deepLink of [
  "/concepts/${folder.id}",
  "/requests/checklist/${request.id}",
  "/production-approvals/${step.id}",
  "stages/6?unit=",
  "stages/7?unit=",
]) {
  assert(service.includes(deepLink), `Action deep link is missing: ${deepLink}`);
}
assert(
  service.includes("/projects?status=ACTIVE&stage=${number}") &&
    service.includes("workflow.currentStageNumber"),
  "Stage distribution must use the Projects V2 stage filter convention.",
);
assert(
  !service.includes("sort=updated"),
  "Dashboard project links must preserve the default priority ordering.",
);
assert(
  service.includes("summaries.length + flexibleProjects.length") &&
    service.includes("activeArtwork + activeFlexible") &&
    service.includes("completedArtwork + completedFlexible"),
  "Portfolio KPIs must include both artwork and flexible projects.",
);
assert(
  service.includes('stageLabel: "Flexible milestone"') &&
    service.includes('title: "Flexible milestone overdue"') &&
    service.includes('label: "Flexible milestones assigned"'),
  "Flexible milestones must participate in dashboard deadlines, attention, and assigned work.",
);
assert(
  workspace.includes("snapshot.canViewFlexibleProjects ?") &&
    workspace.includes("snapshot.flexibleProjects") &&
    workspace.includes('href="/projects?view=flexible"') &&
    workspace.includes("project.progress") &&
    workspace.includes("project.deadlineLabel"),
  "The Private Projects panel must be permission-bounded and expose milestone progress and deadlines.",
);

assert(
  workspace.includes("No actions currently require your attention.") &&
    workspace.includes("No upcoming deadlines") &&
    workspace.includes("No open work assigned to you.") &&
    workspace.includes("No projects available."),
  "Dashboard empty states are incomplete.",
);
assert(
  service.includes('hasPermission(\n    user,\n    "dashboard.viewRecentProjects"') &&
    service.includes("const recentProjects = canViewRecentProjects") &&
    service.includes(": [];") &&
    service.includes(".slice(0, 6)") &&
    service.includes("updatedAt") &&
    workspace.includes("snapshot.canViewRecentProjects ?") &&
    workspace.includes("<RecentProjects projects={snapshot.recentProjects} />"),
  "Recent Projects must require its effective permission at the data and UI boundaries, remain bounded, and use Project.updatedAt recency.",
);
assert(
  page.includes("canCreateProjects(user)"),
  "New Project visibility must combine the ADMIN role boundary with the existing create permission.",
);
assert(
  !schema.includes("DashboardAttentionItem") &&
    !schema.includes("DashboardWorkSummaryItem"),
  "Dashboard derived state must not add Prisma persistence models.",
);

console.log("Dashboard V2 regression checks passed.");

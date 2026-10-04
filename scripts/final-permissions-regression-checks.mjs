import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFileSync(join(rootDir, relativePath), "utf8");
const check = (condition, message) => {
  if (!condition) throw new Error(`Final permissions check failed: ${message}`);
};
const includes = (source, fragment, message) =>
  check(source.includes(fragment), message);

const resolver = read("src/lib/permissions/resolver.ts");
const dashboard = read("src/lib/dashboard.ts");
const dashboardWorkspace = read(
  "src/components/dashboard/dashboard-workspace.tsx",
);
const archives = read("src/lib/archives.ts");
const projects = read("src/lib/projects.ts");
const projectsPage = read("src/app/(dashboard)/projects/page.tsx");
const projectDetailPage = read(
  "src/app/(dashboard)/projects/[slug]/page.tsx",
);
const projectDetailLayout = read(
  "src/app/(dashboard)/projects/[slug]/layout.tsx",
);
const userProjects = read("src/lib/user-projects.ts");
const userProjectWorkspace = read("src/lib/user-project-workspace.ts");
includes(
  resolver,
  "if (!hasProjectPermissionGrant(user, permissionKey))",
  "effective profiles must gate project-scoped permissions before relationship scope",
);
includes(
  resolver,
  'return hasPermission(user, "project.create")',
  "administrator project creation must honor the saved role permission",
);
includes(
  resolver,
  "user.projectCreationAccessGranted === true",
  "USER project creation must require an explicit per-user grant",
);
includes(
  resolver,
  'return hasPermission(user, "archive.view");',
  "archive.view must independently grant Archives module access",
);
includes(
  archives,
  "function hasExplicitArchiveAssetAccess",
  "per-user Archive levels must constrain asset scope rather than module entry",
);
includes(
  archives,
  'return { id: "__no_access__" };',
  "users without explicit Archive asset scope must not receive manual archive files",
);
includes(
  resolver,
  "export function canUseProjects",
  "Projects module access must have a centralized permission gate",
);
includes(
  resolver,
  'hasPermission(user, "project.list") &&',
  "Projects module access must require project.list",
);
includes(
  resolver,
  'hasPermission(user, "project.view")',
  "Projects module access and sidebar must require project.view",
);
includes(
  projects,
  '!currentUser || !hasPermission(currentUser, "project.view")',
  "project queries must return the denied scope without project.view",
);
includes(projectsPage, "!canUseProjects(user)", "Projects list route gate");
includes(
  projectDetailPage,
  '!hasPermission(user, "project.view")',
  "project detail route gate",
);
includes(
  projectDetailLayout,
  '!hasPermission(user, "project.view")',
  "nested project route gate",
);
includes(userProjects, "!canUseProjects(currentUser)", "USER project list data gate");
includes(
  userProjectWorkspace,
  "!canUseProjects(currentUser)",
  "USER project detail data gate",
);
includes(
  dashboard,
  '"dashboard.viewRecentProjects"',
  "dashboard snapshot must enforce recent-project visibility",
);
includes(
  dashboard,
  "const recentProjects = canViewRecentProjects",
  "dashboard snapshot must omit denied recent-project data",
);
includes(
  dashboardWorkspace,
  "snapshot.canViewRecentProjects ?",
  "dashboard UI must hide the denied Recent Projects panel",
);

for (const stageNumber of [1, 2, 5, 6]) {
  const page = read(
    `src/app/(dashboard)/projects/[slug]/stages/${stageNumber}/page.tsx`,
  );
  includes(
    page,
    "requirePackagingStageRoute",
    `Stage ${stageNumber} USER route gate`,
  );
  includes(
    page,
    "requirePackagingStageRoute(slug, user,",
    `Stage ${stageNumber} USER workspace redirect`,
  );
}

const stageFive = read("src/lib/stage-five.ts");
includes(stageFive, "canManageStageFive(user, project)", "Stage 5 manager service gate");
includes(
  stageFive,
  "isGlobalProjectAdministrator(user)",
  "Stage 5 must not infer management from USER project membership",
);

for (const [stage, helper] of [
  ["six", "canManageStageSix(user, project)"],
  ["seven", "canManageStageSeven(user, project)"],
]) {
  const source = read(`src/lib/stage-${stage}.ts`);
  includes(source, helper, `Stage ${stage} manager service gate`);
  includes(
    source,
    'hasProjectPermission(user, project, "stage.view")',
    `Stage ${stage} effective stage permission gate`,
  );
}

const calendarPage = read("src/app/(dashboard)/calendar/page.tsx");
includes(
  calendarPage,
  "access.canManageCollaborators ? getCollaborators() : Promise.resolve([])",
  "Calendar must not serialize the global USER directory to view-only users",
);

const assetTagRoute = read("src/app/api/asset-tags/route.ts");
includes(assetTagRoute, "canUseAssetTags", "asset-tag API authorization");
includes(assetTagRoute, 'status: 403', "asset-tag API forbidden response");

const library = read("src/lib/library.ts");
includes(library, "input.assetTagId", "asset-tag filtering permission enforcement");
includes(
  library,
  '!hasPermission(user, "file.download")',
  "manual Library download permission enforcement",
);
const libraryWorkspace = read("src/components/library/library-workspace.tsx");
includes(libraryWorkspace, "item.canDownload ?", "Library download UI gate");
includes(libraryWorkspace, "item.canFavorite ?", "Library favorite UI gate");
includes(libraryWorkspace, "canFilterAssets ?", "Library filter UI gate");

const conceptCompareRoute = read("src/components/projects/concept-compare-route.tsx");
includes(
  conceptCompareRoute,
  'hasPermission(user, "compare.view")',
  "assigned concept comparison view permission gate",
);
const comparison = read("src/lib/comparison.ts");
includes(
  comparison,
  "canViewProjectConcept(user, concept)",
  "assigned executor read-only concept comparison access",
);
includes(
  comparison,
  'hasPermission(user, "compare.createComment")',
  "concept comparison marker mutation permission gate",
);

console.log("Final ADMIN/USER cross-layer permission regression checks passed.");

includes(read("src/app/(dashboard)/projects/[slug]/stages/7/page.tsx"), "getStageSevenWorkspaceData", "Stage 7 must use its scoped service authorization");
includes(read("src/lib/stage-seven.ts"), "getAuthorizedStageSevenProject", "Stage 7 data must enforce project authorization");

includes(read("src/lib/project-template-route-access.ts"), "canManageProjectStages(user, project)", "Packaging routes must require management authority independently from executor membership");

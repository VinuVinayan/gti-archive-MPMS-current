import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const detailPage = read("src/app/(dashboard)/projects/[slug]/page.tsx");
const workspace = read("src/components/projects/user-project-workspace.tsx");
const workspaceQuery = read("src/lib/user-project-workspace.ts");
const privateFolders = read("src/lib/project-private-folders.ts");
const privateUploadRoute = read(
  "src/app/api/projects/[projectId]/private-folders/[folderId]/upload-url/route.ts",
);
const researchAccess = read("src/lib/project-research-access.ts");
const stageTwoPage = read("src/app/(dashboard)/projects/[slug]/stages/2/page.tsx");
const stageTwoFolderPage = read(
  "src/app/(dashboard)/projects/[slug]/stages/2/folders/[folderId]/page.tsx",
);
const history = read("src/lib/project-history.ts");
const conceptRoute = read("src/components/projects/concept-chat-route.tsx");
const chatWorkspace = read("src/components/projects/project-chat-workspace.tsx");
const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260816213000_project_private_folders/migration.sql",
);

assert.match(detailPage, /user\.role === UserRole\.USER/);
assert.match(detailPage, /<UserProjectWorkspace/);
assert.match(detailPage, /<ProjectOverviewWorkspace/);
assert.doesNotMatch(detailPage, /searchParams.*admin|searchParams.*manager/i);

for (const copy of [
  "Project Workspace",
  "Shared Folders",
  "Upload files",
  "Read only",
  "Private Folders",
  "My Private Folder",
  "Classified",
  "My Assigned Tasks",
  "Shared project references and your assigned work.",
]) {
  assert.ok(workspace.includes(copy), `USER workspace is missing: ${copy}`);
}

for (const forbidden of [
  "Stage 1",
  "Stage 2",
  "Stage 3",
  "Stage 4",
  "Stage 5",
  "Stage 6",
  "Stage 7",
  "Research & Planning",
  "Initial Concept",
  "Final Concept",
  "Current Stage",
  "Workflow",
  "Complete Stage",
  "Add Concept",
  "Create Concept",
]) {
  assert.ok(!workspace.includes(forbidden), `USER workspace leaked: ${forbidden}`);
}

const classifiedSection = workspace.slice(
  workspace.indexOf("data.classifiedFolders.map"),
  workspace.indexOf("My Assigned Tasks"),
);
assert.ok(classifiedSection.includes("LockKeyhole"));
assert.ok(!classifiedSection.includes("Read only"));
assert.ok(!classifiedSection.includes("<Link"));
assert.ok(!classifiedSection.includes("fileCount"));

assert.match(workspaceQuery, /assignedExecutorId: currentUser\.id/);
assert.match(workspaceQuery, /ProjectResearchFolderSystemKey\.BRIEF/);
assert.match(workspaceQuery, /ProjectResearchFolderSystemKey\.TECH/);
assert.doesNotMatch(workspaceQuery, /MARKET_COMPETITION|VENDORS|FINANCE|LEGAL|PITCH/);
assert.match(workspaceQuery, /deriveUserTaskDisplayState/);
assert.match(workspaceQuery, /buildAccessibleProjectsWhere\(currentUser\)/);
assert.match(workspaceQuery, /where: \{ ownerUserId: currentUser\.id, parentFolderId: null \}/);
assert.match(workspaceQuery, /isGlobalProjectAdministrator\(currentUser\)/);
assert.match(workspaceQuery, /isProjectOwner\(currentUser, project\)/);
assert.match(workspaceQuery, /isProjectCoOwner\(currentUser, project\)/);
assert.match(workspaceQuery, /const classifiedFolders = canViewClassifiedFolders/);
assert.match(workspaceQuery, /: \[\];/);
assert.match(workspace, /Only your private folder is visible to you\./);
assert.match(workspace, /data\.canViewClassifiedFolders/);
assert.match(workspace, /folder\.canUpload/);
assert.match(workspaceQuery, /getProjectResearchAccess/);

assert.match(privateFolders, /ownerUserId: user\.id/);
assert.match(privateFolders, /activeParticipantWhere\(user\.id\)/);
assert.doesNotMatch(privateFolders, /isGlobalProjectAdministrator|SUPER_ADMIN/);
assert.match(privateFolders, /if \(input\.createdTextFile\)/);
assert.match(privateFolders, /validatePreparedProjectResearchTextFile/);
assert.match(privateUploadRoute, /createdTextFile: payload\.createdTextFile === true/);
assert.match(history, /assertProjectPrivateAttachmentAccess/);
assert.match(history, /Use the private folder upload endpoint/);

assert.match(researchAccess, /ProjectResearchFolderSystemKey\.BRIEF/);
assert.match(researchAccess, /ProjectResearchFolderSystemKey\.TECH/);
assert.match(
  researchAccess,
  /canWrite:\s*isCanonicalWorkspace &&\s*stageAvailable &&\s*canManageWorkspace/,
);
assert.match(researchAccess, /canManageWorkspace = isGlobalAdministrator \|\| isProjectOwner \|\| isProjectCoOwner/);
assert.match(researchAccess, /canUpload:\s*isCanonicalWorkspace &&\s*stageAvailable &&\s*\(canManageWorkspace \|\| isCanonicalSharedFolder\) &&\s*!isProjectCompleted/);
assert.match(stageTwoPage, /!isBusinessAdministratorRole\(user\.role\)/);
assert.match(stageTwoPage, /redirect\(`\/projects\/\$\{slug\}`\)/);
assert.match(stageTwoFolderPage, /getProjectResearchFolderPageData\(user,/);
assert.match(conceptRoute, /user\.role === UserRole\.USER/);
assert.match(conceptRoute, /stageNeutral: true/);
assert.match(conceptRoute, /backHref: backHref \?\? `\/projects\/\$\{encodeURIComponent\(projectId\)\}`/);
assert.match(conceptRoute, /backHref === "\/tasks" \? "Back to Tasks" : "Back to Workspace"/);
assert.match(chatWorkspace, /isStageNeutralConceptMode/);
assert.match(chatWorkspace, /Back to Workspace/);
assert.match(chatWorkspace, /Concept Activity/);
assert.match(chatWorkspace, /stageNeutral: conceptMode\.stageNeutral/);
assert.match(chatWorkspace, /Read-only approved concept reference/);

assert.match(schema, /model ProjectPrivateFolder/);
assert.match(schema, /@@unique\(\[projectId, ownerUserId\]\)/);
assert.match(schema, /PROJECT_PRIVATE_FILE/);
assert.match(migration, /INSERT INTO "ProjectPrivateFolder"/);
assert.match(migration, /ON CONFLICT \("projectId", "ownerUserId"\) DO NOTHING/);

console.log("USER stage-neutral project workspace isolation checks passed.");

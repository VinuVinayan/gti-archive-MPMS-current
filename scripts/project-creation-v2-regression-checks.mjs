import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(join(rootDir, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, value, label) {
  assert(source.includes(value), `${label} is missing.`);
}

const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260807120000_project_creation_v2/migration.sql",
);
const creation = read("src/lib/project-creation.ts");
const action = read("src/app/(dashboard)/projects/new/v2-actions.ts");
const form = read("src/components/projects/create-project-form.tsx");
const userSelector = read("src/components/projects/project-user-selector.tsx");
const candidates = read("src/lib/project-owner-candidates.ts");
const resolver = read("src/lib/permissions/resolver.ts");

for (const snippet of [
  'ownerId                String?',
  '@relation("ProjectOwner"',
  "model ProjectCoOwner",
  "coOwners               ProjectCoOwner[]",
  "model ProjectCollaborator",
  "@@id([projectId, userId])",
]) {
  assertIncludes(schema, snippet, `Schema ownership contract ${snippet}`);
}

assert(!schema.includes("enum ProjectExecutorRole"), "Executor role enum must be removed.");
const executorModel = schema.match(/model ProjectExecutor \{[\s\S]*?\n\}/)?.[0] ?? "";
assert(executorModel, "ProjectExecutor model is missing.");
assert(!/\n\s+role\s/.test(executorModel), "Executor rows must not have a role column.");

for (const snippet of [
  'creator."role" <> \'SUPER_ADMIN\'::"UserRole"',
  'CREATE TABLE "ProjectCoOwner"',
  'ALTER TABLE "ProjectExecutor" DROP COLUMN "role"',
  'ALTER TABLE "Project" ALTER COLUMN "category" DROP NOT NULL',
]) {
  assertIncludes(migration, snippet, `Migration contract ${snippet}`);
}
assert(!/DELETE\s+FROM\s+"ProjectExecutor"/i.test(migration), "Migration must preserve every executor row.");

for (const snippet of [
  "hasDuplicates(coOwnerIds)",
  "coOwnerIds.includes(ownerId)",
  "hasDuplicates(executorIds)",
  "input.collaboratorIds ?? []",
  "hasMalformedIds(rawCollaboratorIds)",
  "new Set(normalizeIdList(rawCollaboratorIds))",
  "const ownerId = creator.id",
  "user.role !== UserRole.ADMIN",
  "UserRole.USER",
  "invalidCollaborator",
  "prisma.$transaction",
  "coOwners:",
  "executors:",
  "collaborators:",
  "membershipIds",
  "isExecutor: executorIdSet.has(participant.id)",
  "skipDuplicates: true",
  "ensureCanonicalProjectResearchWorkspaceTx",
  'type: "COLLABORATOR_ADDED"',
  'const notificationUrl = `/projects/${project.id}`',
  "tx.notification.createMany",
]) {
  assertIncludes(creation, snippet, `Creation service guard ${snippet}`);
}

assert(
  !creation.includes('fieldErrors.executorIds = "Select at least one project executor."'),
  "Project creation and editing must allow a self-managed project without executors.",
);

const projectCreateBlock = creation.slice(
  creation.indexOf("const project = await tx.project.create"),
  creation.indexOf("const ownerRecipientIds"),
);
for (const legacyField of [
  "category,",
  "description,",
  "executionType,",
  "budgetRequired,",
  "currency,",
  "stageCount,",
  "stages:",
]) {
  assert(!projectCreateBlock.includes(legacyField), `V2 creation must not fabricate ${legacyField}`);
}

assertIncludes(candidates, "role: UserRole.ADMIN", "ADMIN-only co-owner candidates");
assert(!/email|name/.test(candidates.slice(candidates.indexOf("where:"), candidates.indexOf("orderBy:"))), "Owner eligibility must not infer role from name or email.");

for (const snippet of [
  "createProjectV2(user, input)",
  'revalidatePath("/projects")',
  "isCreating",
  "collaboratorIds,",
  "router.push(`/projects/${result.projectId}`)",
  "fieldErrors",
]) {
  assertIncludes(`${action}\n${form}`, snippet, `Create UI submission behavior ${snippet}`);
}

for (const snippet of [
  "Manage this project myself",
  "Empty Stages 3 and 4 can be skipped",
  "executorIds: selfManaged ? [] : executorIds",
]) {
  assertIncludes(form, snippet, `Self-managed project behavior ${snippet}`);
}

for (const snippet of [
  "const ownerId = initialProject?.ownerId ?? currentUser.id",
  "The project owner is fixed when the project is created.",
]) {
  assertIncludes(form, snippet, `Fixed project owner behavior ${snippet}`);
}

for (const snippet of [
  'mode?: "create" | "edit"',
  "updateProjectV2Action",
  'isEditing ? "Edit Project" : "Create Project"',
  '"Save Changes"',
]) {
  assertIncludes(form, snippet, `Shared create/edit project form ${snippet}`);
}

for (const snippet of [
  "export async function updateProjectV2",
  "tx.project.update",
  "tx.projectCoOwner.deleteMany",
  "tx.projectExecutor.deleteMany",
  "tx.projectCollaborator.deleteMany",
  "tx.projectCollaborator.upsert",
]) {
  assertIncludes(creation, snippet, `Project edit persistence ${snippet}`);
}

for (const snippet of [
  "Project Collaborators",
  "Add people who will participate in or access this project.",
  'ariaLabel="Project collaborators"',
  "CollaboratorDialog",
  "Invite collaborator",
]) {
  assertIncludes(form, snippet, `Project collaborator UI ${snippet}`);
}

const executorFieldIndex = form.indexOf("Project Executors");
const collaboratorFieldIndex = form.indexOf("Project Collaborators");
const inviteCollaboratorIndex = form.indexOf("Invite collaborator");
assert(
  executorFieldIndex >= 0 && collaboratorFieldIndex > executorFieldIndex,
  "Project Collaborators must appear after Project Executors.",
);
assert(
  inviteCollaboratorIndex > collaboratorFieldIndex,
  "Invite collaborator must appear under the Project Collaborators field.",
);
assert(
  !form.includes("Add collaborator"),
  "The redundant Add collaborator button must not be rendered.",
);
assertIncludes(
  userSelector,
  "onClick={toggleSelector}",
  "Create Project selector close toggle",
);
assertIncludes(
  userSelector,
  'document.addEventListener("pointerdown", handlePointerDown)',
  "Create Project selector outside-click handling",
);
assert(
  /event\.stopPropagation\(\);\s*removeUser\(user\.id\);/.test(userSelector),
  "Removing a selected project user must not bubble to the selector trigger.",
);
assert(
  !/removeUser\(user\.id\);\s*openSelector\(\);/.test(userSelector),
  "Removing a co-owner, executor, or collaborator must not open the user list.",
);
assert(
  /\{showSearchInput \? \(\s*<Search/.test(userSelector),
  "A selected single owner must not retain an unnecessary search icon.",
);
assert(
  userSelector.includes('className="flex min-w-0 flex-1 flex-wrap items-center gap-2"') &&
    userSelector.includes('className="flex h-8 min-w-[180px] flex-1 items-center gap-2 px-1"') &&
    userSelector.includes('className="h-8 min-w-0 flex-1 bg-transparent'),
  "Selected collaborators and the search control must share a responsive wrapping layout.",
);

for (const snippet of [
  "isProjectOwnerOrCoOwner",
  "isProjectExecutor",
  "isGlobalProjectAdministrator",
  "ownerId: user.id",
  "coOwners:",
  "collaborators:",
]) {
  assertIncludes(resolver, snippet, `Access resolver rule ${snippet}`);
}

console.log("Project creation V2 regression checks passed.");

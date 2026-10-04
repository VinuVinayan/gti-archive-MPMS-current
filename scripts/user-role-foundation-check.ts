import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UserRole } from "@prisma/client";

import {
  defaultRolePermissions,
  editablePermissionRoleValues,
  permissionRoleValues,
  type PermissionKey,
} from "../src/lib/permissions/definitions";
import { resolveEffectivePermissionSet } from "../src/lib/permissions/effective";
import { getAuthenticatedDefaultRoute } from "../src/lib/permissions/fallback-route";
import {
  canCreateProjects,
  canUseArchives,
  canUseProjects,
  canViewProjectTypeSwitcher,
  getSidebarVisibility,
  hasPermission,
  hasProjectPermission,
} from "../src/lib/permissions/resolver";
import {
  getUserRoleLabel,
  isBusinessAdministratorRole,
  isKnownUserRole,
  isProtectedRootRole,
  isStandardUserRole,
} from "../src/lib/user-role-compatibility";

function read(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const expectedRoles = ["SUPER_ADMIN", "ADMIN", "USER"];
const expectedEditableRoles = ["ADMIN", "USER"];
const expectedUserPermissions: PermissionKey[] = [
  "dashboard.view",
  "dashboard.viewProjectCounts",
  "dashboard.viewRecentProjects",
  "project.list",
  "project.view",
  "project.viewParticipants",
  "stage.view",
  "stage.acceptBrief",
  "stage.submitWork",
  "chat.view",
  "chat.createComment",
  "chat.uploadAttachment",
  "chat.mentionUser",
  "file.view",
  "file.download",
  "file.favorite",
  "file.uploadAttachment",
  "file.uploadSubmission",
  "library.view",
  "library.filter",
  "archive.uploadFile",
  "completion.viewChecklist",
  "completion.uploadInvoice",
  "calendar.view",
  "notification.view",
  "notification.markRead",
  "settings.viewOwnProfile",
  "settings.updateOwnProfile",
  "settings.changeOwnPassword",
  "compare.view",
  "compare.createComment",
  "help.view",
];

assert.deepEqual(Object.values(UserRole), expectedRoles);
assert.deepEqual([...permissionRoleValues], expectedRoles);
assert.deepEqual([...editablePermissionRoleValues], expectedEditableRoles);
for (const role of expectedRoles) assert.equal(isKnownUserRole(role), true);
assert.equal(isKnownUserRole("NOT_A_ROLE"), false);
assert.equal(isBusinessAdministratorRole(UserRole.SUPER_ADMIN), true);
assert.equal(isBusinessAdministratorRole(UserRole.ADMIN), true);
assert.equal(isBusinessAdministratorRole(UserRole.USER), false);
assert.equal(isProtectedRootRole(UserRole.SUPER_ADMIN), true);
assert.equal(isStandardUserRole(UserRole.USER), true);
assert.equal(isStandardUserRole(UserRole.ADMIN), false);
assert.equal(getUserRoleLabel(UserRole.USER), "User");

assert.equal(
  canViewProjectTypeSwitcher(
    { role: UserRole.ADMIN },
    { isProjectOwner: false, isProjectCoOwner: false },
  ),
  true,
);
assert.equal(
  canViewProjectTypeSwitcher(
    { role: UserRole.USER },
    { isProjectOwner: false, isProjectCoOwner: false },
  ),
  false,
);
assert.equal(
  canViewProjectTypeSwitcher(
    { role: UserRole.USER },
    { isProjectOwner: true, isProjectCoOwner: false },
  ),
  true,
);
assert.equal(
  canViewProjectTypeSwitcher(
    { role: UserRole.USER },
    { isProjectOwner: false, isProjectCoOwner: true },
  ),
  true,
);

assert.deepEqual(defaultRolePermissions.USER, expectedUserPermissions);
assert.equal(defaultRolePermissions.USER.includes("project.create"), false);
assert.deepEqual(
  [...resolveEffectivePermissionSet({
    user: { role: UserRole.USER },
    rolePermissions: new Set(defaultRolePermissions.USER),
  })],
  expectedUserPermissions,
);
assert.equal(
  hasPermission({ id: "user", role: UserRole.USER }, "dashboard.view"),
  true,
);
assert.equal(
  hasPermission({ id: "user", role: UserRole.USER }, "project.create"),
  false,
);

function userWithProjectPermissions(permissionKeys: PermissionKey[]) {
  const permissions = new Set(permissionKeys);
  return {
    id: "project-permission-user",
    role: UserRole.USER,
    permissionProfileSnapshot: {
      effectivePermissions: permissions,
      rolePermissions: permissions,
      archiveAccessGranted: false,
      archiveAccessLevel: "NONE" as const,
    },
  };
}

const userWithProjectListOnly = userWithProjectPermissions(["project.list"]);
assert.equal(canUseProjects(userWithProjectListOnly), false);
assert.equal(getSidebarVisibility(userWithProjectListOnly).projects, false);
assert.equal(getAuthenticatedDefaultRoute(userWithProjectListOnly), "/no-access");

const userWithProjectViewOnly = userWithProjectPermissions(["project.view"]);
assert.equal(canUseProjects(userWithProjectViewOnly), false);
assert.equal(getSidebarVisibility(userWithProjectViewOnly).projects, false);

const userWithProjectModuleAccess = userWithProjectPermissions([
  "project.list",
  "project.view",
]);
assert.equal(canUseProjects(userWithProjectModuleAccess), true);
assert.equal(getSidebarVisibility(userWithProjectModuleAccess).projects, true);
assert.equal(getAuthenticatedDefaultRoute(userWithProjectModuleAccess), "/projects");

const userWithForgedCreatePermission = {
  id: "user",
  role: UserRole.USER,
  permissionProfileSnapshot: {
    effectivePermissions: new Set<PermissionKey>(["project.create"]),
    rolePermissions: new Set<PermissionKey>(["project.create"]),
    archiveAccessGranted: false,
    archiveAccessLevel: "NONE" as const,
  },
};
assert.equal(
  canCreateProjects(userWithForgedCreatePermission),
  false,
  "USER must not create projects even if project.create is mistakenly enabled.",
);
assert.equal(
  canCreateProjects({
    id: "selected-project-creator",
    role: UserRole.USER,
    projectCreationAccessGranted: true,
  }),
  true,
  "A USER explicitly selected for Create Project access must be allowed.",
);
assert.equal(
  canCreateProjects({
    id: "unselected-project-creator",
    role: UserRole.USER,
    projectCreationAccessGranted: false,
  }),
  false,
  "An unselected USER must not be allowed to create projects.",
);

const userWithViewModules = {
  id: "user",
  role: UserRole.USER,
  permissionProfileSnapshot: {
    effectivePermissions: new Set<PermissionKey>([
      "calendar.view",
      "library.view",
      "notification.view",
      "help.view",
      "fluxAi.view",
      "archive.view",
    ]),
    rolePermissions: new Set<PermissionKey>([
      "calendar.view",
      "library.view",
      "notification.view",
      "help.view",
      "fluxAi.view",
      "archive.view",
    ]),
    archiveAccessGranted: false,
    archiveAccessLevel: "NONE" as const,
  },
};
assert.deepEqual(
  getSidebarVisibility(userWithViewModules),
  {
    dashboard: false,
    fluxAi: true,
    projects: false,
    projectTracker: false,
    tasks: false,
    projectCounts: false,
    calendar: true,
    collaboration: false,
    users: false,
    notifications: true,
    library: true,
    archives: true,
    settings: false,
    help: true,
  },
  "USER module toggles must drive navigation while Archive asset scope remains independently constrained.",
);
assert.equal(
  getAuthenticatedDefaultRoute(userWithViewModules),
  "/flux-ai",
  "A USER whose first available module is Flux AI must receive its accessible route.",
);

const archivePermissionOnlyUser = {
  id: "archive-permission-user",
  role: UserRole.USER,
  permissionProfileSnapshot: {
    effectivePermissions: new Set<PermissionKey>(["archive.view"]),
    rolePermissions: new Set<PermissionKey>(["archive.view"]),
    archiveAccessGranted: false,
    archiveAccessLevel: "NONE" as const,
  },
};
assert.equal(
  canUseArchives(archivePermissionOnlyUser),
  true,
  "archive.view must grant module access without a separate per-user entitlement.",
);
assert.equal(getSidebarVisibility(archivePermissionOnlyUser).archives, true);
assert.equal(getAuthenticatedDefaultRoute(archivePermissionOnlyUser), "/archives");

const archiveScopeWithoutPermissionUser = {
  ...archivePermissionOnlyUser,
  id: "archive-scope-only-user",
  permissionProfileSnapshot: {
    effectivePermissions: new Set<PermissionKey>(),
    rolePermissions: new Set<PermissionKey>(),
    archiveAccessGranted: true,
    archiveAccessLevel: "FULL" as const,
  },
};
assert.equal(
  canUseArchives(archiveScopeWithoutPermissionUser),
  false,
  "A per-user archive asset scope must not bypass a disabled archive.view permission.",
);
assert.equal(getSidebarVisibility(archiveScopeWithoutPermissionUser).archives, false);

const restrictedAdmin = {
  id: "admin",
  role: UserRole.ADMIN,
  permissionProfileSnapshot: {
    effectivePermissions: new Set<PermissionKey>(["project.view"]),
    rolePermissions: new Set<PermissionKey>(["project.view"]),
    archiveAccessGranted: true,
    archiveAccessLevel: "FULL" as const,
  },
};
assert.equal(
  hasProjectPermission(
    restrictedAdmin,
    { ownerId: "another-admin", coOwners: [], executors: [], collaborators: [] },
    "project.update",
  ),
  false,
  "A disabled ADMIN project permission must not be restored by global scope.",
);

const schema = read("prisma/schema.prisma");
assert.match(schema, /enum UserRole \{\s+SUPER_ADMIN\s+ADMIN\s+USER\s+\}/);
assert.match(schema, /role\s+UserRole\s+@default\(USER\)/);
assert.doesNotMatch(schema, /enum CollaboratorType \{/);
assert.doesNotMatch(schema, /enum ProjectCollaboratorParticipantType \{/);
assert.doesNotMatch(schema, /collaboratorType\s+CollaboratorType/);
assert.doesNotMatch(schema, /participantType\s+ProjectCollaboratorParticipantType/);
assert.doesNotMatch(schema, /model CollaboratorTypePermission \{/);

const migration = read(
  "prisma/migrations/20260816193000_remove_legacy_collaborator_architecture/migration.sql",
);
for (const requiredFragment of [
  "Migration blocked: User rows still use role COLLABORATOR",
  "Migration blocked: Project rows exist",
  "Migration blocked: ProjectCollaborator rows exist",
  'DROP TABLE "CollaboratorTypePermission"',
  'DROP COLUMN "collaboratorType"',
  'DROP COLUMN "participantType"',
  'CREATE TYPE "UserRole" AS ENUM (\'SUPER_ADMIN\', \'ADMIN\', \'USER\')',
]) {
  assert.equal(migration.includes(requiredFragment), true, requiredFragment);
}

const profiles = read("src/lib/permissions/profiles.ts");
assert.doesNotMatch(profiles, /CollaboratorTypePermission/);
assert.doesNotMatch(profiles, /profileType:\s*"collaboratorType"/);
assert.match(profiles, /editablePermissionRoleValues\.flatMap/);

const usersWorkspace = read("src/components/users/users-workspace.tsx");
assert.match(usersWorkspace, /editablePermissionRoleValues\.map/);
assert.doesNotMatch(usersWorkspace, /Collaborator Type/);

const projectCreation = read("src/lib/project-creation.ts");
assert.match(projectCreation, /const ownerId = creator\.id/);
assert.match(projectCreation, /user\.role !== UserRole\.ADMIN/);
assert.match(projectCreation, /UserRole\.USER/);
assert.doesNotMatch(projectCreation, /UserRole\.COLLABORATOR/);

const collaboration = read("src/lib/collaboration.ts");
assert.match(collaboration, /role: UserRole\.USER/);
assert.doesNotMatch(collaboration, /collaboratorType/);

console.log("Final ADMIN/USER role architecture checks passed.");

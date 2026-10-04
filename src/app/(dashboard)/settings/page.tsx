import Link from "next/link";
import { canManageProjectTemplates } from "@/lib/project-templates";
import { redirect } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { getUserDisplayName, requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions/resolver";
import { isBusinessAdministratorRole } from "@/lib/user-role-compatibility";

function formatRole(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMemberSince(date: Date | string | number | null | undefined) {
  if (!date) {
    return "—";
  }

  const normalizedDate = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(normalizedDate.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(normalizedDate);
}

function formatPasswordChangedAt(date: Date | string | number | null | undefined) {
  if (!date) {
    return "—";
  }

  const normalizedDate = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(normalizedDate.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(normalizedDate);
}

export default async function SettingsPage() {
  const user = await requireUser();

  if (!hasPermission(user, "settings.viewOwnProfile")) {
    redirect("/");
  }

  const canViewMasterData = hasPermission(user, "settings.viewMasterData");
  const canUpdateProfile = hasPermission(user, "settings.updateOwnProfile");
  const canChangePassword = hasPermission(user, "settings.changeOwnPassword");
  const canViewUsers =
    isBusinessAdministratorRole(user.role) && hasPermission(user, "users.view");

  const canManageTemplates = await canManageProjectTemplates(user);
  return (
    <DashboardLayout>
      {canManageTemplates && <Link className="mb-5 inline-block rounded-xl border bg-white p-4 text-sm font-semibold text-[#226742]" href="/settings/project-templates">Manage project templates &amp; Custom approvals</Link>}
      <SettingsWorkspace
        user={{
          name: getUserDisplayName(user),
          email: user.email,
          role: formatRole(user.role),
          memberSince: formatMemberSince(user.createdAt),
          passwordChangedAt: formatPasswordChangedAt(user.passwordChangedAt),
          avatarSrc: user.avatarUrl
            ? `/api/profile/avatar?v=${encodeURIComponent(user.avatarUrl)}`
            : null,
          department: user.department?.trim() || "",
          phoneNumber: user.phoneNumber?.trim() || "",
          jobTitle: user.jobTitle?.trim() || "",
          bio: user.bio?.trim() || "",
        }}
        canUpdateProfile={canUpdateProfile}
        canChangePassword={canChangePassword}
        canViewMasterData={canViewMasterData}
        canViewUsers={canViewUsers}
      />
    </DashboardLayout>
  );
}

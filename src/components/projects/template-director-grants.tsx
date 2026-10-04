"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDirectorGrantAction } from "@/app/(dashboard)/projects/template-actions";
import { showErrorToast } from "@/lib/toast";
export function TemplateDirectorGrants({
  users,
}: {
  users: Array<{
    id: string;
    name: string | null;
    email: string;
    templateManagementAccessGranted: boolean;
  }>;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <details className="mt-6 rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        Director template permissions
      </summary>
      <p className="my-3 text-sm">
        Assign the capability to publish master templates and approve Custom
        project structures.
      </p>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {users.map((user) => (
          <label key={user.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              disabled={pending}
              checked={user.templateManagementAccessGranted}
              onChange={(e) => {
                const checked = e.target.checked;
                start(async () => {
                  const result = await setDirectorGrantAction(user.id, checked);
                  if ("error" in result) showErrorToast(result.error);
                  else router.refresh();
                });
              }}
            />
            {user.name || user.email}
          </label>
        ))}
      </div>
    </details>
  );
}

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createProjectPrivateSubfolder, deleteProjectPrivateSubfolder } from "@/lib/project-private-folders";

export async function createProjectPrivateSubfolderAction(input: { projectId: string; parentFolderId: string; name: string }) {
  const user = await requireUser();
  try {
    const result = await createProjectPrivateSubfolder(user, input);
    if (!("error" in result)) revalidatePath(`/projects/${input.projectId}/workspace/private/${input.parentFolderId}`);
    return result;
  } catch (error) {
    console.error("[private-folder] creation failed", error);
    return { error: "Unable to create folder. Please try again." };
  }
}

export async function deleteProjectPrivateSubfolderAction(input: { projectId: string; folderId: string }) {
  const user = await requireUser();
  try {
    const result = await deleteProjectPrivateSubfolder(user, input);
    if (!("error" in result)) revalidatePath(`/projects/${input.projectId}/workspace/private`, "layout");
    return result;
  } catch (error) {
    console.error("[private-folder] deletion failed", error);
    return { error: "Unable to delete folder. Please reload and try again." };
  }
}

"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  completeProjectResearchStage,
  createProjectResearchFolder,
} from "@/lib/project-research";
import { deleteProjectResearchFolder } from "@/lib/project-research-files";
import { getProjectResearchImportFolders, getProjectResearchImportOptions, importProjectInquiryContent } from "@/lib/project-research-import";
import { PROJECTS_CACHE_TAG } from "@/lib/projects";
import { setProjectFolderItemPin } from "@/lib/project-folder-pins";
import type { FolderItemPinInput } from "@/lib/project-folder-pins-shared";
import { setProjectFolderItemColor } from "@/lib/project-folder-colors";
import type { FolderItemColorInput } from "@/lib/project-folder-colors-shared";

export async function setProjectFolderItemColorAction(input: FolderItemColorInput) {
  const user = await requireUser();
  try {
    const result = await setProjectFolderItemColor(user, input);
    revalidatePath(`/projects/${input.projectId}/stages/2`);
    for (const folderId of new Set([input.folderId, result.parentFolderId].filter(Boolean))) {
      revalidatePath(`/projects/${input.projectId}/stages/2/folders/${folderId}`);
      revalidatePath(`/projects/${input.projectId}/workspace/shared/${folderId}`);
      revalidatePath(`/projects/${input.projectId}/workspace/private/${folderId}`);
    }
    return result;
  } catch (error) {
    console.error("[folder-colour] update failed", error);
    return { error: "Unable to update this colour label. Please reload and try again." };
  }
}

export async function setProjectFolderItemPinAction(input: FolderItemPinInput) {
  const user = await requireUser();
  try {
    const result = await setProjectFolderItemPin(user, input);
    revalidatePath(`/projects/${input.projectId}/stages/2`);
    for (const folderId of new Set([input.folderId, result.parentFolderId].filter(Boolean))) {
      revalidatePath(`/projects/${input.projectId}/stages/2/folders/${folderId}`);
      revalidatePath(`/projects/${input.projectId}/workspace/shared/${folderId}`);
      revalidatePath(`/projects/${input.projectId}/workspace/private/${folderId}`);
    }
    return result;
  } catch (error) {
    console.error("[folder-pin] update failed", error);
    return { error: "Unable to update this pin. Please reload and try again." };
  }
}

function importErrorMessage(error: unknown, fallback: string) {
  const userMessages = new Set([
    "Research folder not found.",
    "This folder set is read-only for your account.",
    "Select between 1 and 100 Stage 1 items to import.",
    "Some selected Stage 1 content has changed or is unavailable. Reopen Import and select it again.",
  ]);
  return error instanceof Error && userMessages.has(error.message) ? error.message : fallback;
}

export async function getProjectResearchImportOptionsAction(input: { projectId: string; folderId: string }) {
  const user = await requireUser();
  try {
    const [items, folders] = await Promise.all([
      getProjectResearchImportOptions(user, input),
      getProjectResearchImportFolders(user, input),
    ]);
    return { items, folders };
  } catch (error) {
    console.error("[research-import] loading content failed", error);
    return { error: importErrorMessage(error, "Unable to load Stage 1 content. Please try again.") };
  }
}

export async function importProjectInquiryContentAction(input: {
  projectId: string;
  folderId: string;
  itemIds: string[];
}) {
  const user = await requireUser();
  try {
    const result = await importProjectInquiryContent(user, input);
    revalidatePath(`/projects/${input.projectId}/stages/2`);
    revalidatePath(`/projects/${input.projectId}/stages/2/folders/${input.folderId}`);
    revalidatePath(`/projects/${input.projectId}/workspace/shared/${input.folderId}`);
    revalidateTag(PROJECTS_CACHE_TAG, "max");
    return result;
  } catch (error) {
    console.error("[research-import] import failed", error);
    return { error: importErrorMessage(error, "Unable to import Stage 1 content. Please try again.") };
  }
}

export async function createProjectResearchFolderAction(input: {
  projectId: string;
  name: string;
  parentFolderId?: string;
}) {
  const user = await requireUser();
  try {
    const result = await createProjectResearchFolder(user, input);
    if (!("error" in result)) {
      revalidatePath(`/projects/${input.projectId}/stages/2`);
      if (input.parentFolderId) {
        revalidatePath(`/projects/${input.projectId}/stages/2/folders/${input.parentFolderId}`);
        revalidatePath(`/projects/${input.projectId}/workspace/shared/${input.parentFolderId}`);
      }
      revalidateTag(PROJECTS_CACHE_TAG, "max");
    }
    return result;
  } catch (error) {
    console.error("[project-research] folder creation failed", error);
    return { error: "Unable to create folder. Please try again." };
  }
}

export async function deleteProjectResearchFolderAction(input: {
  projectId: string;
  folderId: string;
}) {
  const user = await requireUser();
  try {
    const result = await deleteProjectResearchFolder(user, input);
    if (!("error" in result)) {
      revalidatePath(`/projects/${input.projectId}/stages/2`);
      revalidatePath(`/projects/${input.projectId}/stages/2/folders`, "layout");
      revalidatePath(`/projects/${input.projectId}/workspace/shared`, "layout");
      revalidateTag(PROJECTS_CACHE_TAG, "max");
    }
    return result;
  } catch (error) {
    console.error("[project-research] folder deletion failed", error);
    return {
      error: "Unable to delete folder. Please reload and try again.",
    };
  }
}

export async function completeProjectResearchStageAction(projectId: string) {
  const user = await requireUser();
  try {
    const result = await completeProjectResearchStage(user, projectId);
    if (!("error" in result)) {
      revalidatePath(`/projects/${projectId}`);
      revalidatePath(`/projects/${projectId}/stages/2`);
      revalidatePath(`/projects/${projectId}/stages/3`);
      revalidatePath(`/projects/${projectId}/stages/4`);
      revalidatePath(`/projects/${projectId}/stages/5`);
      revalidateTag(PROJECTS_CACHE_TAG, "max");
    }
    return result;
  } catch (error) {
    console.error("[project-research] completion failed", error);
    return { error: "Unable to complete Project Research and Planning right now." };
  }
}

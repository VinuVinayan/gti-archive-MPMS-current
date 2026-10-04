"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { PROJECTS_CACHE_TAG } from "@/lib/projects";
import { approveCustomProjectStructure, completeGenericProjectStage, publishProjectTemplate, saveGenericStageContent, setTemplateDirectorGrant, updateCustomProjectStructure } from "@/lib/project-templates";

async function perform<T>(action: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<T>, projectId?: string): Promise<{ ok: true; data: T } | { error: string }> {
  const user = await requireUser();
  try {
    const data = await action(user);
    revalidateTag(PROJECTS_CACHE_TAG, "max");
    revalidatePath("/projects"); revalidatePath("/"); revalidatePath("/project-tracker");
    revalidatePath("/settings/project-templates");
    if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true as const, data };
  } catch (error) {
    return { error: error instanceof Error && !(error instanceof Prisma.PrismaClientKnownRequestError) && !(error instanceof Prisma.PrismaClientValidationError) ? error.message : "Unable to save. Reload and try again." };
  }
}
export async function saveStageNotesAction(input: Parameters<typeof saveGenericStageContent>[1]) { return perform(user=>saveGenericStageContent(user,input),input.projectId); }
export async function completeTemplateStageAction(input: Parameters<typeof completeGenericProjectStage>[1]) { return perform(user=>completeGenericProjectStage(user,input),input.projectId); }
export async function saveCustomStructureAction(input: Parameters<typeof updateCustomProjectStructure>[1]) { return perform(user=>updateCustomProjectStructure(user,input),input.projectId); }
export async function approveCustomStructureAction(projectId: string, revision: number) { return perform(user=>approveCustomProjectStructure(user,projectId,revision),projectId); }
export async function publishTemplateAction(input: Parameters<typeof publishProjectTemplate>[1]) { return perform(user=>publishProjectTemplate(user,input)); }
export async function setDirectorGrantAction(userId: string, granted: boolean) { return perform(user=>setTemplateDirectorGrant(user,userId,granted)); }

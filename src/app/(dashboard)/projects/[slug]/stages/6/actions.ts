"use server";

import { revalidatePath } from "next/cache";
import type {
  ProductionApprovalRecipientType,
  ProductionHandoverRoute,
  ProjectFileChecklistField,
} from "@prisma/client";

import { requireUser } from "@/lib/auth";
import {
  getStageSixArchivePreparation,
  saveStageSixArchiveSnapshot,
  type ArchiveArtworkMetadataDraft,
} from "@/lib/archives";
import {
  addProductionApprover,
  addProductionUnitFile,
  completeStageSix,
  configureMarketingDirector,
  handoverProductionUnit,
  removeProductionApprover,
  removeProductionUnitFile,
  reorderProductionApprover,
  retryProductionApprovalDispatch,
  sendProductionApprovalRequest,
} from "@/lib/stage-six";
import { publishProjectActivityUpdatedAfterResponse } from "@/lib/realtime/server";

function revalidateStageSix(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/stages/5`);
  revalidatePath(`/projects/${projectId}/stages/6`);
  revalidatePath(`/projects/${projectId}/stages/7`);
}

function revalidateStageSixArchive(
  projectId: string,
  archiveCategorySlugs: Array<string | null | undefined>,
) {
  revalidateStageSix(projectId);
  revalidatePath("/archives");
  for (const archiveCategorySlug of new Set(archiveCategorySlugs.filter(Boolean))) {
    revalidatePath(`/archives/${archiveCategorySlug}`);
  }
}

function publishStageSixChange(input: {
  projectId: string;
  actorId: string;
  changedEntityId?: string | null;
}) {
  publishProjectActivityUpdatedAfterResponse({
    projectId: input.projectId,
    stageId: null,
    eventType: "timeline_updated",
    changedEntityId: input.changedEntityId ?? null,
    actorId: input.actorId,
  });
}

type ApproverInput = {
  clientRequestId: string;
  projectId: string;
  productionUnitId: string;
  recipientType: ProductionApprovalRecipientType;
  recipientUserId?: string;
  recipientName?: string;
  recipientEmail?: string;
  sharedFieldKeys: ProjectFileChecklistField[];
  selectedFileIds: string[];
  message?: string;
};

export async function configureMarketingDirectorAction(input: ApproverInput) {
  const user = await requireUser();
  const result = await configureMarketingDirector(user, input);
  revalidateStageSix(input.projectId);
  if (!("error" in result)) {
    publishStageSixChange({
      projectId: input.projectId,
      actorId: user.id,
      changedEntityId: input.productionUnitId,
    });
  }
  return result;
}

export async function addProductionApproverAction(input: ApproverInput) {
  const user = await requireUser();
  const result = await addProductionApprover(user, input);
  revalidateStageSix(input.projectId);
  if (!("error" in result)) {
    publishStageSixChange({
      projectId: input.projectId,
      actorId: user.id,
      changedEntityId: input.productionUnitId,
    });
  }
  return result;
}

export async function removeProductionApproverAction(input: {
  projectId: string;
  productionUnitId: string;
  stepId: string;
}) {
  const user = await requireUser();
  const result = await removeProductionApprover(user, input);
  revalidateStageSix(input.projectId);
  if (!("error" in result)) {
    publishStageSixChange({
      projectId: input.projectId,
      actorId: user.id,
      changedEntityId: input.productionUnitId,
    });
  }
  return result;
}

export async function reorderProductionApproverAction(input: {
  projectId: string;
  productionUnitId: string;
  stepId: string;
  direction: "UP" | "DOWN";
}) {
  const user = await requireUser();
  const result = await reorderProductionApprover(user, input);
  revalidateStageSix(input.projectId);
  if (!("error" in result)) {
    publishStageSixChange({
      projectId: input.projectId,
      actorId: user.id,
      changedEntityId: input.productionUnitId,
    });
  }
  return result;
}

export async function sendProductionApprovalRequestAction(input: {
  projectId: string;
  productionUnitId: string;
  stepId: string;
}) {
  const user = await requireUser();
  const result = await sendProductionApprovalRequest(user, input);
  revalidateStageSix(input.projectId);
  if (!("error" in result) && result.sent) {
    publishStageSixChange({
      projectId: input.projectId,
      actorId: user.id,
      changedEntityId: input.productionUnitId,
    });
  }
  return result;
}

export async function retryProductionApprovalDispatchAction(input: {
  projectId: string;
  stepId: string;
}) {
  const user = await requireUser();
  const result = await retryProductionApprovalDispatch(user, input);
  revalidateStageSix(input.projectId);
  return result;
}

export async function addProductionUnitFileAction(input: {
  projectId: string;
  productionUnitId: string;
  attachmentId: string;
}) {
  const user = await requireUser();
  const result = await addProductionUnitFile(user, input);
  revalidateStageSix(input.projectId);
  return result;
}

export async function removeProductionUnitFileAction(input: {
  projectId: string;
  productionUnitId: string;
  attachmentId: string;
}) {
  const user = await requireUser();
  const result = await removeProductionUnitFile(user, input);
  revalidateStageSix(input.projectId);
  return result;
}

export async function handoverProductionUnitAction(input: {
  clientRequestId: string;
  projectId: string;
  productionUnitId: string;
  route: ProductionHandoverRoute;
  recipientType: ProductionApprovalRecipientType;
  recipientUserId?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientCompany?: string;
  recipientPhone?: string;
  sharedFieldKeys: ProjectFileChecklistField[];
  selectedFileIds: string[];
  note?: string;
}) {
  const user = await requireUser();
  const result = await handoverProductionUnit(user, input);
  revalidateStageSix(input.projectId);
  return result;
}

export async function completeStageSixAction(input: { projectId: string }) {
  const user = await requireUser();
  try {
    const result = await completeStageSix(user, input);
    revalidateStageSix(input.projectId);
    if (!("error" in result)) {
      publishStageSixChange({
        projectId: input.projectId,
        actorId: user.id,
        changedEntityId: input.projectId,
      });
    }
    return result;
  } catch (error) {
    console.error("[stage-six] completion failed", error);
    return { error: "Unable to complete Stage 6 right now." } as const;
  }
}

export async function prepareStageSixArchiveAction(input: { projectId: string }) {
  const user = await requireUser();

  try {
    return {
      preparation: await getStageSixArchivePreparation(user, input),
    } as const;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to prepare the Stage 6 archive.",
    } as const;
  }
}

export async function saveStageSixArchiveAction(input: {
  projectId: string;
  archiveCategoryId?: string;
  files: Array<{
    sourceAttachmentId: string;
    finalArchiveFileName: string;
    artworkMetadata: ArchiveArtworkMetadataDraft;
  }>;
}) {
  const user = await requireUser();

  try {
    const archive = await saveStageSixArchiveSnapshot(user, input);
    revalidateStageSixArchive(input.projectId, [
      archive.previousArchiveCategorySlug,
      archive.archiveCategorySlug,
    ]);
    publishStageSixChange({
      projectId: input.projectId,
      actorId: user.id,
      changedEntityId: archive.archiveId,
    });
    return { archive } as const;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the Stage 6 archive.",
    } as const;
  }
}

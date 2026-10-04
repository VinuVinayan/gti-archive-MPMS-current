"use server";

import { revalidatePath } from "next/cache";
import type {
  PhysicalSampleDecision,
  ProductionApprovalRecipientType,
  ProductionHandoverRoute,
  ProductionSampleRoundType,
} from "@prisma/client";

import { requireUser } from "@/lib/auth";
import { publishProjectActivityUpdatedAfterResponse } from "@/lib/realtime/server";
import {
  closeStageSevenProject,
  configureStageSevenSampleRequestReminder,
  createProductionSampleRound,
  deleteProductionSampleRound,
  decidePhysicalSampleRound,
  markPhysicalSampleRoundReceived,
  retryProductionSampleRequestEmail,
  StageSevenWorkflowError,
} from "@/lib/stage-seven";

function revalidateStageSeven(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/stages/7`);
  revalidatePath("/tasks", "layout");
}

function publishStageSevenChange(input: {
  projectId: string;
  changedEntityId: string | null;
  actorId: string;
}) {
  publishProjectActivityUpdatedAfterResponse({
    projectId: input.projectId,
    stageId: null,
    eventType: "timeline_updated",
    changedEntityId: input.changedEntityId,
    actorId: input.actorId,
  });
}

async function stageSevenAction<T>(
  projectId: string,
  actorId: string,
  changedEntityId: string | null,
  operation: () => Promise<T>,
) {
  try {
    const result = await operation();
    revalidateStageSeven(projectId);
    publishStageSevenChange({ projectId, actorId, changedEntityId });
    return result;
  } catch (error) {
    if (error instanceof StageSevenWorkflowError) {
      return { error: error.message } as const;
    }
    console.error("[stage-seven] action failed", error);
    return { error: "Unable to save the Stage 7 change right now." } as const;
  }
}

export async function createProductionSampleRoundAction(input: {
  projectId: string;
  productionUnitId: string;
  clientRequestId: string;
  name: string;
  type: ProductionSampleRoundType;
  customTypeName?: string | null;
  deadline: string;
  recipientRoute: ProductionHandoverRoute;
  recipientType: ProductionApprovalRecipientType;
  recipientUserId?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientCompany?: string | null;
  recipientPhone?: string | null;
  requestNote?: string | null;
  reminderIntervalHours?: number | null;
}) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, input.productionUnitId, () =>
    createProductionSampleRound(user, input),
  );
}

export async function configureStageSevenSampleRequestReminderAction(input: {
  projectId: string;
  productionUnitId: string;
  sampleRoundId: string;
  intervalHours: 24 | 48 | 72 | null;
}) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, input.sampleRoundId, () =>
    configureStageSevenSampleRequestReminder(user, input),
  );
}

export async function retryProductionSampleRequestEmailAction(input: {
  projectId: string;
  productionUnitId: string;
  sampleRoundId: string;
}) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, input.sampleRoundId, () =>
    retryProductionSampleRequestEmail(user, input),
  );
}

export async function deleteProductionSampleRoundAction(input: {
  projectId: string;
  productionUnitId: string;
  sampleRoundId: string;
}) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, input.sampleRoundId, () =>
    deleteProductionSampleRound(user, input),
  );
}

export async function decidePhysicalSampleRoundAction(input: {
  projectId: string;
  productionUnitId: string;
  sampleRoundId: string;
  decision: PhysicalSampleDecision;
  decisionNote?: string | null;
}) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, input.sampleRoundId, () =>
    decidePhysicalSampleRound(user, input),
  );
}

export async function markPhysicalSampleRoundReceivedAction(input: {
  projectId: string;
  productionUnitId: string;
  sampleRoundId: string;
}) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, input.sampleRoundId, () =>
    markPhysicalSampleRoundReceived(user, input),
  );
}

export async function closeStageSevenProjectAction(input: { projectId: string }) {
  const user = await requireUser();
  return stageSevenAction(input.projectId, user.id, null, () =>
    closeStageSevenProject(user, input),
  );
}

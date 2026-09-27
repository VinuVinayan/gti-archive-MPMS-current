"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { publishProjectActivityUpdatedAfterResponse } from "@/lib/realtime/server";
import { decideProductionApproval } from "@/lib/stage-six";

export async function decideAuthenticatedProductionApprovalAction(input: {
  stepId: string;
  decision: "APPROVE" | "REJECT";
  comment?: string;
  confirmed?: boolean;
  requestVersion?: string;
}) {
  const user = await requireUser(`/production-approvals/${input.stepId}`);
  const result = await decideProductionApproval(
    { kind: "authenticated", user, stepId: input.stepId },
    {
      decision: input.decision,
      comment: input.comment,
      confirmed: input.confirmed,
      requestVersion: input.requestVersion,
    },
  );
  revalidatePath(`/production-approvals/${input.stepId}`);
  if (!("error" in result)) {
    revalidatePath(`/projects/${result.projectId}/stages/6`);
    publishProjectActivityUpdatedAfterResponse({
      projectId: result.projectId,
      stageId: null,
      eventType: "timeline_updated",
      changedEntityId: result.productionUnitId,
      actorId: user.id,
    });
  }
  return result;
}

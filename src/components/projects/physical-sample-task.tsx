"use client";
import { useRouter } from "next/navigation";
import { SampleRequestDetails } from "./stage-seven-workspace";
import type { StageSevenWorkspaceData } from "@/lib/stage-seven";
export function PhysicalSampleTask({
  projectId,
  unit,
  roundId,
  completed,
}: {
  projectId: string;
  unit: StageSevenWorkspaceData["units"][number];
  roundId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const round = unit.rounds.find((round) => round.id === roundId) ?? null;
  return (
    <SampleRequestDetails
      projectId={projectId}
      unit={unit}
      round={round}
      canManage={false}
      canReview={!!round?.canReview}
      stageCompleted={completed}
      onRefresh={() => router.refresh()}
      onRequestAnother={() => {}}
    />
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { revokeSkippedConceptStageAction } from "@/app/(dashboard)/projects/[slug]/stages/concept-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ConceptWorkflowStageKey } from "@/lib/project-concepts";
import type { StageSkipRevocationEligibility } from "@/lib/project-stage-skip-revocation";
import { showSuccessToast } from "@/lib/toast";

export function RevokeStageSkipButton({ projectId, stageKey, eligibility }: {
  projectId: string;
  stageKey: ConceptWorkflowStageKey;
  eligibility: StageSkipRevocationEligibility;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const stageNumber = stageKey === "CONCEPT_CREATION" ? 3 : 4;
  if (!eligibility.visible) return null;

  function revoke() {
    startTransition(async () => {
      try {
        const result = await revokeSkippedConceptStageAction({ projectId, stageKey });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setOpen(false);
        showSuccessToast(`Stage ${stageNumber} reopened. Create a task and assign its executor to continue.`);
        router.refresh();
      } catch {
        setError("Unable to undo this skip right now. Refresh and try again.");
      }
    });
  }

  return (
    <div className="mt-5 rounded-[14px] border border-[#dce5dd] bg-[#f7faf7] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-[720] text-[#2b3d30]">Stage {stageNumber} was skipped</p>
          <p className="mt-1 text-[11px] leading-5 text-[#68766c]">
            {eligibility.reason || "Undo the skip to create tasks here. Later stages will be locked until this stage is completed again."}
          </p>
        </div>
        {eligibility.requiresExecutor ? (
          <Button asChild variant="outline" size="sm"><Link href={`/projects/${projectId}/edit?returnTo=${encodeURIComponent(`/projects/${projectId}/stages/${stageNumber}`)}`}>Add Executor</Link></Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={!eligibility.canRevoke || pending} onClick={() => { setError(undefined); setOpen(true); }}>
          <RotateCcw className="h-3.5 w-3.5" /> Undo Skip
        </Button>
      </div>
      <ConfirmationDialog
        isOpen={open}
        title={`Reopen Stage ${stageNumber}?`}
        description={`Stage ${stageNumber} will reopen so you can create tasks and assign an executor. Later stages will be locked until the preceding work is completed again.${eligibility.emptyChecklistCount ? " Empty Stage 5 checklist entries created by the skip will be reset; their original Stage 3 files will remain available." : ""}`}
        confirmLabel="Undo Skip"
        pending={pending}
        error={error}
        onConfirm={revoke}
        onClose={() => { if (!pending) setOpen(false); }}
      />
    </div>
  );
}

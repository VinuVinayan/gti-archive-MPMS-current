"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { revokeConceptTaskCompletionAction } from "@/app/(dashboard)/projects/[slug]/stages/concept-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ConceptWorkflowStageKey } from "@/lib/project-concepts";
import type { TaskCompletionRevocationEligibility } from "@/lib/project-stage-skip-revocation";
import { showSuccessToast } from "@/lib/toast";

export function RevokeTaskCompletionButton({ projectId, folderId, stageKey, name, eligibility, onReopened }: {
  projectId: string;
  folderId: string;
  stageKey: ConceptWorkflowStageKey;
  name: string;
  eligibility: TaskCompletionRevocationEligibility | null;
  onReopened?: () => void;
}) {
  const router = useRouter();
  const executorFieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [executorId, setExecutorId] = useState("");
  if (!eligibility?.visible) return null;
  const stageNumber = stageKey === "CONCEPT_CREATION" ? 3 : 4;
  const canChooseExecutor = eligibility.requiresExecutor && eligibility.executorOptions.length > 0;

  function revoke() {
    if (eligibility?.requiresExecutor && !executorId) {
      setError("Choose an executor to reopen this task.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await revokeConceptTaskCompletionAction({ projectId, folderId, stageKey,
          ...(eligibility?.requiresExecutor ? { executorId } : {}),
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setOpen(false);
        onReopened?.();
        showSuccessToast("Task completion revoked. The task is open for further work.");
        router.refresh();
      } catch {
        setError("Unable to revoke completion right now. Refresh and try again.");
      }
    });
  }

  return (
    <div className="flex max-w-sm flex-col gap-2">
      <Button type="button" variant="outline" size="sm" className="w-fit rounded-full"
        disabled={pending || (!eligibility.canRevoke && !canChooseExecutor)}
        onClick={() => { setError(undefined); setExecutorId(""); setOpen(true); }}>
        <RotateCcw className="h-3.5 w-3.5" /> Revoke Completion
      </Button>
      {eligibility.reason ? <p className="text-xs leading-5 text-muted">{eligibility.reason}</p> : null}
      {eligibility.requiresExecutor && !eligibility.executorOptions.length ? (
        <Button asChild variant="outline" size="sm" className="w-fit"><Link href={`/projects/${projectId}/edit?returnTo=${encodeURIComponent(`/projects/${projectId}/stages/${stageNumber}/concepts/${folderId}`)}`}>Add Executor</Link></Button>
      ) : null}
      <ConfirmationDialog
        isOpen={open}
        title="Revoke task completion?"
        description={`“${name}” will reopen for further work.${eligibility.reopensStage ? ` Stage ${stageNumber} will reopen and later stages will be locked until it is completed again.` : ""}${eligibility.emptyChecklistCount ? " Untouched Stage 5 checklists will be rebuilt when the stage is completed again. Original files and approvals will be kept." : ""}`}
        confirmLabel="Revoke Completion" pending={pending} error={error}
        confirmDisabled={eligibility.requiresExecutor && !executorId}
        onConfirm={revoke} onClose={() => { if (!pending) setOpen(false); }}>
        {canChooseExecutor ? (
          <div className="mb-5">
            <label htmlFor={executorFieldId} className="mb-2 block text-sm font-semibold">Assigned Executor</label>
            <select id={executorFieldId} value={executorId} disabled={pending} onChange={(event) => setExecutorId(event.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm">
              <option value="">Choose an executor</option>
              {eligibility.executorOptions.map((executor) => <option key={executor.id} value={executor.id}>{executor.name}</option>)}
            </select>
            <p className="mt-2 text-xs text-muted">The selected executor will need to accept the brief before submitting work.</p>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}

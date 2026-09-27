"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { completeProjectConceptTaskWithoutFileAction } from "@/app/(dashboard)/projects/[slug]/stages/concept-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { showSuccessToast } from "@/lib/toast";
import type { ConceptCompletionRequest, ConceptWorkflowStageKey } from "@/lib/project-concepts";

export function CompleteConceptTaskButton({ projectId, folderId, stageKey, name, completionRequest, onCompleted }: {
  projectId: string; folderId: string; stageKey: ConceptWorkflowStageKey; name: string; onCompleted?: () => void;
  completionRequest?: ConceptCompletionRequest | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  function complete() {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await completeProjectConceptTaskWithoutFileAction({ projectId, folderId, stageKey });
        if ("error" in result) { setError(result.error); return; }
        setOpen(false);
        onCompleted?.();
        showSuccessToast("Task marked as complete.");
        router.refresh();
      } catch { setError("Unable to complete this task. Please try again."); }
    });
  }
  return <>
    <Button type="button" size="sm" className="relative z-10 min-h-10 rounded-xl whitespace-normal px-4 text-xs" disabled={pending} onClick={() => { setError(undefined); setOpen(true); }}>
      <CheckCircle2 className="size-4 shrink-0" />Mark as Complete
    </Button>
    <ConfirmationDialog isOpen={open} title={completionRequest ? "Review completion request" : "Mark task as complete?"} description={completionRequest ? `The assigned executor has requested completion of “${name}”. Review their work before marking the task completed.` : `Mark “${name}” as completed? Supporting files can stay in the project’s Files section. No task attachment is required.`} confirmLabel="Mark as Complete" pending={pending} error={error} onConfirm={complete} onClose={() => { if (!pending) setOpen(false); }}>
      {completionRequest ? <div className="mb-5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-[#f7faf6] p-4 text-sm">{completionRequest.note || "No additional note provided. Review the work in the project folders or task discussion."}</div> : null}
    </ConfirmationDialog>
  </>;
}

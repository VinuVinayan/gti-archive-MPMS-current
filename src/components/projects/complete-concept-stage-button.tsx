"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { completeStageThreeConceptsAction } from "@/app/(dashboard)/projects/[slug]/stages/concept-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { showSuccessToast } from "@/lib/toast";

export function CompleteConceptStageButton({ projectId, tasks }: {
  projectId: string;
  tasks: Array<{ id: string; name: string; canCompleteWithoutFile: boolean }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const canComplete = tasks.every((task) => task.canCompleteWithoutFile);

  function complete() {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await completeStageThreeConceptsAction({ projectId, completeOpenTasks: true });
        if ("error" in result) { setError(result.error); return; }
        setOpen(false);
        showSuccessToast("Stage 3 completed. Stage 4 is now available.");
        router.push(`/projects/${projectId}/stages/4`);
        router.refresh();
      } catch { setError("Unable to complete Stage 3. Please try again."); }
    });
  }

  return <>
    <Button type="button" className="h-11 rounded-[12px] px-5 font-[720]" disabled={pending} onClick={() => { setError(undefined); setOpen(true); }}>
      <CheckCircle2 className="h-4 w-4" />Complete Stage 3
    </Button>
    <ConfirmationDialog
      isOpen={open}
      title="Complete Stage 3?"
      description={`This completes all ${tasks.length} remaining task${tasks.length === 1 ? "" : "s"} listed below without a file submission or executor request. Stage 3 will close and Stage 4 will open.`}
      confirmLabel="Complete Stage 3"
      pending={pending}
      confirmDisabled={!canComplete}
      error={error}
      onConfirm={complete}
      onClose={() => { if (!pending) setOpen(false); }}
    >
      <ul className="mb-4 max-h-48 list-disc space-y-2 overflow-y-auto rounded-xl border border-line bg-[#f7faf6] py-3 pl-8 pr-4 text-sm">
        {tasks.map((task) => <li key={task.id} className="break-words">
          {task.name}{!task.canCompleteWithoutFile ? <span className="block text-xs text-[#ad4039]">Needs review before completing the stage</span> : null}
        </li>)}
      </ul>
      {!canComplete ? <p className="mb-5 text-sm text-[#ad4039]">Review submitted files and finish any uploads in the marked tasks first. No additional file is required for tasks without a submission.</p> : null}
    </ConfirmationDialog>
  </>;
}

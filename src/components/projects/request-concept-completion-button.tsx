"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { requestProjectConceptTaskCompletionAction } from "@/app/(dashboard)/projects/[slug]/stages/concept-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { showSuccessToast } from "@/lib/toast";
import type { ConceptWorkflowStageKey } from "@/lib/project-concepts";

export function RequestConceptCompletionButton({ projectId, folderId, stageKey, name }: {
  projectId: string; folderId: string; stageKey: ConceptWorkflowStageKey; name: string;
}) {
  const router = useRouter();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function request() {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await requestProjectConceptTaskCompletionAction({ projectId, folderId, stageKey, note });
        if ("error" in result) { setError(result.error); return; }
        setOpen(false);
        setSubmitted(true);
        showSuccessToast("Completion requested. The project owner can now review your work.");
        router.refresh();
      } catch { setError("Unable to request completion. Please try again."); }
    });
  }

  return <>
    <Button type="button" variant="outline" size="sm" className="relative z-10 min-h-10 rounded-xl whitespace-normal px-4 text-xs" disabled={pending || submitted} onClick={() => { setError(undefined); setOpen(true); }}>
      <Send className="size-4 shrink-0" />{submitted ? "Waiting for review" : "Request completion"}
    </Button>
    <ConfirmationDialog isOpen={open} title="Request task completion" description={`Ask the project owner to review “${name}”. Supporting files can stay in the project’s Files section; no task attachment is required. The task stays open until the owner completes it.`} confirmLabel="Send request" pendingLabel="Sending…" pending={pending} error={error} onConfirm={request} onClose={() => { if (!pending) setOpen(false); }}>
      <div className="mb-5">
        <label htmlFor={noteId} className="mb-2 block text-sm font-semibold">Note for the project owner (optional)</label>
        <textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} disabled={pending} placeholder="For example: Research is complete. The materials are in Files → Tech → Research."
          className="w-full resize-y rounded-xl border border-[#c9d5cc] bg-white px-3 py-2 text-sm outline-none focus:border-[#2f8057] focus:ring-2 focus:ring-[#2f8057]/20" />
      </div>
    </ConfirmationDialog>
  </>;
}

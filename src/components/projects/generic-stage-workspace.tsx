"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  completeTemplateStageAction,
  saveStageNotesAction,
} from "@/app/(dashboard)/projects/template-actions";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

export function GenericStageWorkspace({
  projectId,
  stage,
}: {
  projectId: string;
  stage: {
    id: string;
    content: string;
    revision: number;
    status: string;
    stageType: string;
    required: boolean;
    skippable: boolean;
  };
}) {
  const [content, setContent] = useState(stage.content);
  const [saved, setSaved] = useState(stage.content);
  const [revision, setRevision] = useState(stage.revision);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const editable = stage.status === "AVAILABLE";
  function save() {
    start(async () => {
      const result = await saveStageNotesAction({
        projectId,
        stageId: stage.id,
        content,
        expectedRevision: revision,
      });
      if ("error" in result) {
        showErrorToast(result.error);
        return;
      }
      setRevision(result.data);
      setSaved(content);
      showSuccessToast("Stage notes saved.");
    });
  }
  function complete(skip = false) {
    start(async () => {
      const result = await completeTemplateStageAction({
        projectId,
        stageId: stage.id,
        expectedRevision: revision,
        skip,
        reason,
      });
      if ("error" in result) {
        showErrorToast(result.error);
        return;
      }
      showSuccessToast(skip ? "Stage skipped." : "Stage completed.");
      router.push(`/projects/${projectId}`);
      router.refresh();
    });
  }
  return (
    <section className="mt-5 space-y-4 rounded-2xl border bg-white p-6">
      {stage.stageType === "MAINTENANCE" && (
        <p className="rounded-lg bg-[#eff9f2] p-3 text-sm">
          Maintenance Mode keeps this project open. No fixed end date is
          required. Future changes and fixes will be handled through Tasker.
        </p>
      )}
      <label className="block font-semibold" htmlFor="stage-notes">
        Stage notes
      </label>
      <textarea
        id="stage-notes"
        className="min-h-64 w-full rounded-xl border p-4"
        value={content}
        disabled={!editable || pending}
        maxLength={100000}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add the context and working notes for this stage."
      />
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || content === saved} onClick={save}>
            Save notes
          </Button>
          {stage.stageType !== "MAINTENANCE" && (
            <Button
              variant="outline"
              disabled={pending || content !== saved}
              onClick={() => complete()}
            >
              Complete stage
            </Button>
          )}
          {content !== saved && (
            <span className="text-sm text-amber-700">
              Save your notes before completing this stage.
            </span>
          )}
          {!stage.required &&
            stage.skippable &&
            stage.stageType !== "MAINTENANCE" && (
              <div className="flex w-full flex-wrap gap-2">
                <input
                  aria-label="Reason for skipping"
                  className="rounded-lg border p-2 text-sm"
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for skipping"
                />
                <Button
                  variant="outline"
                  disabled={pending || !reason.trim() || content !== saved}
                  onClick={() => complete(true)}
                >
                  Skip stage
                </Button>
              </div>
            )}
        </div>
      )}
    </section>
  );
}

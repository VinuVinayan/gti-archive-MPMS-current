"use client";

import { FileThumbnail } from "@/components/projects/file-thumbnail";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  createFlexibleMilestoneNoteAction,
  deleteFlexibleMilestoneNoteAction,
  setFlexibleMilestoneCompletedAction,
  updateFlexibleMilestoneAction,
} from "@/app/(dashboard)/projects/flexible/actions";
import { MotionItem, MotionSection } from "@/components/motion/motion-primitives";
import { FlexibleMilestoneDialog, type FlexibleMilestoneFormValue } from "@/components/projects/flexible-milestone-dialog";
import { FlexibleMilestoneNoteDialog } from "@/components/projects/flexible-milestone-note-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { RichTextContent } from "@/components/ui/rich-text-editor";
import { uploadFlexibleMilestoneAttachments } from "@/lib/flexible-milestone-upload-client";
import type {
  FlexibleMilestoneNoteRecord,
  FlexibleMilestoneRecord,
  FlexibleProjectDetailRecord,
} from "@/lib/flexible-projects";
import { showErrorToast, showSuccessToast, showWarningToast } from "@/lib/toast";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatNoteDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FlexibleMilestoneWorkspace({
  project,
  milestone,
}: {
  project: FlexibleProjectDetailRecord;
  milestone: FlexibleMilestoneRecord;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState<FlexibleMilestoneNoteRecord | null>(null);
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<string | null>(null);

  function toggleCompleted() {
    startTransition(async () => {
      const completed = milestone.status !== "COMPLETED";
      const result = await setFlexibleMilestoneCompletedAction(project.id, milestone.id, completed);
      if ("error" in result) {
        showErrorToast(result.error);
        return;
      }
      showSuccessToast(completed ? "Milestone completed." : "Milestone reopened.");
      router.refresh();
    });
  }

  async function save(value: FlexibleMilestoneFormValue) {
    const { files, ...input } = value;
    const result = await updateFlexibleMilestoneAction(project.id, milestone.id, input);
    if ("error" in result) return result;
    if (files.length) {
      try {
        await uploadFlexibleMilestoneAttachments(project.id, milestone.id, files);
      } catch (error) {
        showWarningToast(
          "Milestone saved, but an attachment could not be uploaded.",
          error instanceof Error ? error.message : "The milestone was saved without that file.",
        );
      }
    }
    setEditOpen(false);
    showSuccessToast("Milestone updated.");
    router.refresh();
    return {};
  }

  function confirmAttachmentDelete() {
    if (!deleteAttachmentId) return;
    startTransition(async () => {
      const response = await fetch(
        `/api/flexible-project-attachments/${encodeURIComponent(deleteAttachmentId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        showErrorToast(payload.error || "Unable to delete the attachment.");
        return;
      }
      setDeleteAttachmentId(null);
      showSuccessToast("Attachment deleted.");
      router.refresh();
    });
  }

  async function saveNote(content: string) {
    const result = await createFlexibleMilestoneNoteAction(
      project.id,
      milestone.id,
      { content },
    );
    if ("error" in result) return result;
    setNoteDialogOpen(false);
    showSuccessToast("Note added.");
    router.refresh();
    return {};
  }

  function confirmNoteDelete() {
    if (!deleteNote) return;
    startTransition(async () => {
      const result = await deleteFlexibleMilestoneNoteAction(
        project.id,
        milestone.id,
        deleteNote.id,
      );
      if ("error" in result) {
        showErrorToast(result.error);
        return;
      }
      setDeleteNote(null);
      showSuccessToast("Note deleted.");
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-[1180px] space-y-5 pb-4">
      <MotionSection>
        <Button asChild variant="ghost" className="h-10 rounded-[12px] px-2.5 text-[13px] text-[#3e4941]">
          <Link href={`/projects/flexible/${project.slug}`}><ArrowLeft className="size-4" /> Project Timeline</Link>
        </Button>
      </MotionSection>

      <MotionItem y={8}>
        <Card className="overflow-hidden rounded-[26px] border border-[#dce4dc] bg-white shadow-[0_18px_50px_rgba(23,39,28,0.06)]">
          <CardContent className="p-5 sm:p-7 lg:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-[800] uppercase tracking-[0.15em] text-[#2d7b52]">{String(milestone.order).padStart(2, "0")} · {milestone.category}</p>
                <h1 className="mt-2 text-[30px] font-[800] leading-[1.08] tracking-[-0.045em] text-[#0f1411] sm:text-[39px]">{milestone.name}</h1>
                {milestone.description ? <RichTextContent value={milestone.description} className="mt-3 max-w-3xl text-[13px] leading-6 text-[#68716a] sm:text-[14px]" /> : <p className="mt-3 text-[13px] text-[#8b948d]">No milestone description added.</p>}
              </div>
              <Badge className={`self-start px-4 py-2 text-[11px] ${milestone.status === "COMPLETED" ? "border-[#cce5d3] bg-[#edf8f0] text-[#23744a]" : "border-[#dfe4df] bg-[#f7f8f7] text-[#606a62]"}`} variant="outline">
                <span className="mr-2 size-1.5 rounded-full bg-current" />{milestone.status === "COMPLETED" ? "Completed" : "Pending"}
              </Badge>
            </div>

            <div className="mt-7 grid gap-3 md:grid-cols-3">
              <div className="rounded-[17px] border border-[#e0e6e0] bg-[#fafcf9] p-4"><p className="flex items-center gap-2 text-[10px] font-[750] uppercase tracking-[0.1em] text-[#7b847d]"><UserRound className="size-3.5 text-[#397b57]" /> Responsible</p><p className="mt-2 text-[14px] font-[750] text-[#28322b]">{milestone.responsibleUser?.name ?? "Not assigned"}</p></div>
              <div className="rounded-[17px] border border-[#e0e6e0] bg-[#fafcf9] p-4"><p className="flex items-center gap-2 text-[10px] font-[750] uppercase tracking-[0.1em] text-[#7b847d]"><CalendarDays className="size-3.5 text-[#397b57]" /> Deadline</p><p className="mt-2 text-[14px] font-[750] text-[#28322b]">{formatDate(milestone.deadline)}</p></div>
              <div className="rounded-[17px] border border-[#e0e6e0] bg-[#fafcf9] p-4"><p className="text-[10px] font-[750] uppercase tracking-[0.1em] text-[#7b847d]">Project progress</p><p className="mt-2 text-[14px] font-[750] text-[#28322b]">{project.progress}% complete</p></div>
            </div>

            {project.canManageMilestones ? (
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#e8ece8] pt-5">
                <Button type="button" onClick={toggleCompleted} disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : milestone.status === "COMPLETED" ? <RotateCcw className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {milestone.status === "COMPLETED" ? "Reopen Milestone" : "Mark as Completed"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditOpen(true)} disabled={pending}><Pencil className="size-4" /> Edit Milestone</Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </MotionItem>

      <MotionItem y={8}>
        <Card className="rounded-[26px] border border-[#dce4dc] bg-white shadow-[0_18px_50px_rgba(23,39,28,0.055)]">
          <CardContent className="p-5 sm:p-7 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[23px] font-[780] tracking-[-0.035em] text-[#111712] sm:text-[27px]">Notes</h2>
                <p className="mt-1 text-[13px] text-[#6e7770]">Reminders, tasks, and updates for this milestone.</p>
              </div>
              {project.canManageMilestones ? (
                <Button type="button" onClick={() => setNoteDialogOpen(true)} disabled={pending} className="shrink-0">
                  <Plus className="size-4" /> Add Note
                </Button>
              ) : null}
            </div>

            {milestone.notes.length ? (
              <div className="mt-5 space-y-3">
                {milestone.notes.map((note) => (
                  <div key={note.id} className="flex items-start gap-3 rounded-[17px] border border-[#e0e6e0] bg-[#fafcf9] px-4 py-4 sm:px-5">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#eaf4ed] text-[#28784f]">
                      <NotebookPen className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[#303a33]">{note.content}</p>
                      <p className="mt-2 text-[10px] text-[#7a837c]">Added by {note.author.name} · {formatNoteDate(note.createdAt)}</p>
                    </div>
                    {note.canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteNote(note)}
                        disabled={pending}
                        aria-label="Delete note"
                        className="size-9 shrink-0 text-[#b54e46]"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[17px] border border-dashed border-[#cdd6ce] bg-[#fafcf9] px-5 py-9 text-center">
                <NotebookPen className="mx-auto size-6 text-[#80a18c]" />
                <p className="mt-2 text-[12px] text-[#7a837c]">No notes added to this milestone.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </MotionItem>

      <MotionItem y={8}>
        <Card className="rounded-[26px] border border-[#dce4dc] bg-white shadow-[0_18px_50px_rgba(23,39,28,0.055)]">
          <CardContent className="p-5 sm:p-7 lg:p-8">
            <div>
              <h2 className="text-[23px] font-[780] tracking-[-0.035em] text-[#111712] sm:text-[27px]">Attachments</h2>
              <p className="mt-1 text-[13px] text-[#6e7770]">Files attached to this milestone brief.</p>
            </div>
            {milestone.attachments.length ? (
              <div className="mt-5 divide-y divide-[#e8ece8] rounded-[18px] border border-[#e0e6e0]">
                {milestone.attachments.map((attachment) => (
                  <div key={attachment.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                    <FileThumbnail fileName={attachment.originalFileName} mimeType={attachment.mimeType} previewPath={`/api/flexible-project-attachments/${attachment.id}/preview`} className="size-10 rounded-[12px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-[700] text-[#303a33]">{attachment.originalFileName}</p>
                      <p className="mt-0.5 text-[10px] text-[#7a837c]">{formatBytes(attachment.fileSize)} · Added by {attachment.uploadedBy.name}</p>
                    </div>
                    <Button asChild variant="ghost" size="icon" aria-label={`Preview ${attachment.originalFileName}`}>
                      <a href={`/api/flexible-project-attachments/${attachment.id}/preview`} target="_blank" rel="noreferrer"><Eye className="size-4" /></a>
                    </Button>
                    <Button asChild variant="ghost" size="icon" aria-label={`Download ${attachment.originalFileName}`}>
                      <a href={`/api/flexible-project-attachments/${attachment.id}/download`}><Download className="size-4" /></a>
                    </Button>
                    {project.canDeleteAttachments ? (
                      <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteAttachmentId(attachment.id)} aria-label={`Delete ${attachment.originalFileName}`} className="text-[#b54e46]">
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[17px] border border-dashed border-[#cdd6ce] bg-[#fafcf9] px-5 py-9 text-center text-[12px] text-[#7a837c]">
                No attachments added to this milestone.
              </div>
            )}
          </CardContent>
        </Card>
      </MotionItem>

      {editOpen ? <FlexibleMilestoneDialog mode="edit" users={project.participantOptions} canUploadAttachments={project.canUploadAttachments} initialMilestone={milestone} onClose={() => setEditOpen(false)} onSave={save} /> : null}
      {noteDialogOpen ? <FlexibleMilestoneNoteDialog onClose={() => setNoteDialogOpen(false)} onSave={saveNote} /> : null}
      <ConfirmationDialog
        isOpen={Boolean(deleteNote)}
        title="Delete note?"
        description="This note will be permanently removed from the milestone."
        confirmLabel="Delete Note"
        pending={pending}
        tone="destructive"
        onClose={() => setDeleteNote(null)}
        onConfirm={confirmNoteDelete}
      />
      <ConfirmationDialog
        isOpen={Boolean(deleteAttachmentId)}
        title="Delete attachment?"
        description="This file will be removed from the milestone brief and its stored object will be cleaned up."
        confirmLabel="Delete Attachment"
        pending={pending}
        tone="destructive"
        onClose={() => setDeleteAttachmentId(null)}
        onConfirm={confirmAttachmentDelete}
      />
    </section>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { FileThumbnail } from "@/components/projects/file-thumbnail";

import { AppDatePicker } from "@/components/calendar/app-date-picker";
import { FlexibleDialog } from "@/components/projects/flexible-dialog";
import { ProjectUserSelector } from "@/components/projects/project-user-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import type {
  FlexibleMilestoneFieldErrors,
  FlexibleMilestoneRecord,
  FlexibleProjectUserOption,
} from "@/lib/flexible-projects";

export type FlexibleMilestoneFormValue = {
  name: string;
  category: string;
  responsibleUserId: string;
  deadline: string;
  description: string;
  files: File[];
};

type SaveResult = {
  error?: string;
  fieldErrors?: FlexibleMilestoneFieldErrors;
};

type FlexibleMilestoneDialogProps = {
  mode: "add" | "edit";
  users: FlexibleProjectUserOption[];
  canUploadAttachments: boolean;
  initialMilestone?: FlexibleMilestoneRecord;
  onClose: () => void;
  onSave: (value: FlexibleMilestoneFormValue) => Promise<SaveResult>;
};

const inputClassName = "h-11 rounded-[14px] border border-[#d9e1d9] bg-white shadow-none";

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <span className="mb-2 block text-[12px] font-[700] text-[#3c4740]">{children} {required ? <span className="text-[#b5483f]">*</span> : null}</span>;
}

function FieldError({ children }: { children?: string }) {
  return children ? <p className="mt-1.5 text-[11px] text-[#b5483f]">{children}</p> : null;
}

export function FlexibleMilestoneDialog({
  mode,
  users,
  canUploadAttachments,
  initialMilestone,
  onClose,
  onSave,
}: FlexibleMilestoneDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialMilestone?.name ?? "");
  const [category, setCategory] = useState(initialMilestone?.category ?? "Standard");
  const [responsibleIds, setResponsibleIds] = useState<string[]>(
    initialMilestone?.responsibleUser ? [initialMilestone.responsibleUser.id] : [],
  );
  const [deadline, setDeadline] = useState(initialMilestone?.deadline?.slice(0, 10) ?? "");
  const [description, setDescription] = useState(initialMilestone?.description ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FlexibleMilestoneFieldErrors>({});
  const [formError, setFormError] = useState("");

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    setFiles((current) => {
      const byKey = new Map(
        current.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]),
      );
      for (const file of Array.from(nextFiles)) {
        byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file);
      }
      return [...byKey.values()];
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      setErrors({ name: "Milestone name is required." });
      return;
    }
    startTransition(async () => {
      const result = await onSave({
        name,
        category,
        responsibleUserId: responsibleIds[0] ?? "",
        deadline,
        description,
        files,
      });
      if (result.error) {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <FlexibleDialog
      open
      title={mode === "add" ? "Add Milestone" : "Edit Milestone"}
      description="Keep the milestone focused on one clear outcome."
      onClose={pending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" form="flexible-milestone-form" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pending ? "Saving..." : mode === "add" ? "Add Milestone" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="flexible-milestone-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        {formError ? <div className="sm:col-span-2 rounded-[14px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#a9423d]">{formError}</div> : null}
        <label className="sm:col-span-2">
          <Label required>Milestone Name</Label>
          <Input required maxLength={160} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} placeholder="e.g. Production Readiness" className={inputClassName} />
          <FieldError>{errors.name}</FieldError>
        </label>
        <label>
          <Label>Category</Label>
          <Input maxLength={80} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. Review" className={inputClassName} />
          <FieldError>{errors.category}</FieldError>
        </label>
        <div>
          <Label>Responsible Person</Label>
          <ProjectUserSelector users={users} selectedIds={responsibleIds} onChange={setResponsibleIds} mode="single" placeholder="Search project users..." ariaLabel="Responsible person" error={errors.responsibleUserId} />
          <FieldError>{errors.responsibleUserId}</FieldError>
        </div>
        <div>
          <Label>Deadline</Label>
          <AppDatePicker value={deadline} onChange={setDeadline} placeholder="Select deadline" triggerClassName={`${inputClassName} w-full justify-between px-4 font-normal shadow-none hover:bg-white`} />
          <FieldError>{errors.deadline}</FieldError>
        </div>
        <div className="sm:col-span-2">
          <Label>Description / Notes</Label>
          <RichTextEditor value={description} onChange={setDescription} placeholder="Add context, expected outcomes, or handover notes." minHeightClassName="min-h-28" ariaLabel="Milestone description and notes" />
          <FieldError>{errors.description}</FieldError>
        </div>
        {canUploadAttachments ? (
          <div className="sm:col-span-2">
            <Label>Attachments</Label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-20 w-full items-center justify-center gap-3 rounded-[16px] border border-dashed border-[#bfcfc3] bg-white px-4 text-[13px] font-[650] text-[#47715a] transition hover:border-[#72a484] hover:bg-[#f7fbf7]"
            >
              <Paperclip className="size-4" /> Attach files to this milestone
            </button>
            {files.length ? (
              <div className="mt-3 space-y-2">
                {files.map((file) => {
                  const key = `${file.name}:${file.size}:${file.lastModified}`;
                  return (
                    <div key={key} className="flex items-center gap-3 rounded-[13px] border border-[#e1e7e1] bg-white px-3 py-2.5">
                      <FileThumbnail fileName={file.name} mimeType={file.type} file={file} className="h-8 w-10" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-[650] text-[#344039]">{file.name}</span>
                      <span className="text-[10px] text-[#7b857e]">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((item) => `${item.name}:${item.size}:${item.lastModified}` !== key))}
                        aria-label={`Remove ${file.name}`}
                        className="grid size-7 place-items-center rounded-full text-[#7a847c] hover:bg-[#f1f4f1]"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {mode === "edit" && initialMilestone?.attachments.length ? (
              <p className="mt-2 text-[11px] text-[#788179]">
                Existing files remain available in the milestone brief.
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </FlexibleDialog>
  );
}

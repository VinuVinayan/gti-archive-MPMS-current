"use client";

import { FileThumbnail } from "@/components/projects/file-thumbnail";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Download, Loader2, Plus, Send, X } from "lucide-react";

import { AssetPreviewButton } from "@/components/projects/asset-preview-button";
import {
  ChecklistFilePicker,
  type ChecklistFileRecord,
} from "@/components/projects/checklist-file-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@/components/ui/rich-text-editor";
import type { StageFiveChecklistValue } from "@/lib/stage-five";
import type { ExternalChecklistRequestData } from "@/lib/stage-five-external";
import { uploadExternalStageFiveAttachment } from "@/lib/stage-five-external-upload-client";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ActiveExternalRequestData = Extract<ExternalChecklistRequestData, { state: "active" }>;

const CONTROL_CLASS =
  "min-h-12 rounded-[14px] border-[#dce5dd] bg-white shadow-none focus-visible:border-[#82aa90]";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function MultiValueInput({
  label,
  values,
  suggestions,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  suggestions?: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function addValue() {
    const value = draft.trim().replace(/\s+/g, " ");
    if (value && !values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      onChange([...values, value]);
    }
    setDraft("");
  }
  return (
    <div className="space-y-3">
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <span key={value} className="inline-flex items-center gap-2 rounded-full bg-[#edf5ee] px-3 py-2 text-[12px] font-[680] text-[#355b43]">
              {value}
              <button type="button" disabled={disabled} aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={draft}
          list={`external-values-${label.replace(/\W+/g, "-").toLocaleLowerCase()}`}
          disabled={disabled}
          className={CONTROL_CLASS}
          placeholder={`Enter ${label.toLocaleLowerCase()}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
        />
        <datalist id={`external-values-${label.replace(/\W+/g, "-").toLocaleLowerCase()}`}>
          {suggestions?.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <Button type="button" variant="secondary" disabled={disabled || !draft.trim()} className="shrink-0 rounded-[13px]" onClick={addValue}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}

export function StageFiveExternalRequestWorkspace({
  token,
  data,
}: {
  token: string;
  data: ActiveExternalRequestData;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [included, setIncluded] = useState(false);
  const [files, setFiles] = useState<ChecklistFileRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const sourceBasePath = `/api/external/checklist-request/${encodeURIComponent(token)}/source`;

  function renderControl() {
    const { control } = data.field;
    if (control === "text") {
      return <Input value={text} disabled={isSubmitting} className={CONTROL_CLASS} placeholder={data.field.placeholder} onChange={(event) => setText(event.target.value)} />;
    }
    if (control === "textarea") {
      return <RichTextEditor value={text} disabled={isSubmitting} minHeightClassName="min-h-[140px]" ariaLabel={data.field.title} placeholder={data.field.placeholder} onChange={setText} />;
    }
    if (control === "file" || control === "multi-file") {
      return <ChecklistFilePicker fieldLabel={data.field.title} files={files} multiple={control === "multi-file"} disabled={isSubmitting} onChange={setFiles} />;
    }
    if (control === "multi-value") {
      return <MultiValueInput label={data.field.title} values={values} suggestions={data.field.suggestions} disabled={isSubmitting} onChange={setValues} />;
    }
    if (control === "finishes") {
      return (
        <div className="space-y-4">
          <MultiValueInput label={data.field.title} values={values} suggestions={data.field.suggestions} disabled={isSubmitting} onChange={setValues} />
          <ChecklistFilePicker fieldLabel={`${data.field.title} reference`} files={files} multiple disabled={isSubmitting} onChange={setFiles} />
        </div>
      );
    }
    if (control === "text-attachment") {
      return (
        <div className="space-y-4">
          <RichTextEditor value={text} disabled={isSubmitting} minHeightClassName="min-h-[120px]" ariaLabel={data.field.title} placeholder={data.field.placeholder} onChange={setText} />
          <ChecklistFilePicker fieldLabel={`${data.field.title} reference`} files={files} multiple disabled={isSubmitting} onChange={setFiles} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <RichTextEditor value={text} disabled={isSubmitting} minHeightClassName="min-h-[120px]" ariaLabel={data.field.title} placeholder={data.field.placeholder} onChange={setText} />
        <ChecklistFilePicker fieldLabel={`${data.field.title} reference`} files={files} multiple disabled={isSubmitting} onChange={setFiles} />
        <button
          type="button"
          role="switch"
          aria-checked={included}
          disabled={isSubmitting}
          className={cn(
            "inline-flex min-h-11 items-center gap-3 rounded-[13px] border px-4 text-[13px] font-[700]",
            included ? "border-[#a9cdb3] bg-[#eaf5ec] text-[#2f744e]" : "border-[#dce5dd] bg-white text-[#68746c]",
          )}
          onClick={() => setIncluded((current) => !current)}
        >
          <span className={cn("grid size-5 place-items-center rounded-full", included ? "bg-[#3d8a5d] text-white" : "bg-[#e7ece8]")}>
            {included ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          Health warning included
        </button>
      </div>
    );
  }

  async function submitResponse() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (record) => {
          if (!record.file) return record;
          const attachment = await uploadExternalStageFiveAttachment(token, record.file);
          return { ...record, id: attachment.id, attachmentId: attachment.id };
        }),
      );
      const value: StageFiveChecklistValue = {
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(values.length ? { values } : {}),
        ...(data.field.control === "health-warning" ? { included } : {}),
      };
      const response = await fetch(`/api/external/checklist-request/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          value,
          attachmentIds: uploaded.map((file) => file.attachmentId ?? file.id),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to submit the response.");
      setFiles(uploaded);
      showSuccessToast("Your information has been submitted.");
      router.refresh();
    } catch (error) {
      showErrorToast("Unable to submit response.", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function declineRequest() {
    if (isSubmitting || richTextToPlainText(declineReason).length < 3) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/external/checklist-request/${encodeURIComponent(token)}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ reason: declineReason }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to decline the request.");
      router.refresh();
    } catch (error) {
      showErrorToast("Unable to decline request.", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ["Project", data.projectName],
          ["Requested information", data.field.title],
          ["Requested by", data.requestedBy],
          ["Requested on", formatDate(data.requestedAt)],
          ["Expires", formatDate(data.expiresAt)],
          ["Recipient", data.recipientName],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[15px] border border-[#e1e8e2] bg-[#fbfcfb] px-4 py-3.5">
            <dt className="text-[10px] font-[760] uppercase tracking-[0.09em] text-[#7a867e]">{label}</dt>
            <dd className="mt-1.5 break-words text-[13px] font-[700] text-[#28342c]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-hidden rounded-[18px] border border-[#e1e8e2] bg-white">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-[760] uppercase tracking-[0.09em] text-[#7a867e]">Project file</p>
            <div className="mt-1.5 flex min-w-0 items-center gap-2">
              <FileThumbnail fileName={data.file.name} mimeType={data.file.mimeType} previewPath={`${sourceBasePath}/preview`} />
              <p className="truncate text-[14px] font-[700] text-[#28342c]">{data.file.name}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <AssetPreviewButton fileName={data.file.name} mimeType={data.file.mimeType} previewPath={`${sourceBasePath}/preview`} downloadPath={`${sourceBasePath}/download`} iconOnly={false} label="View file" triggerClassName="rounded-[12px] border border-[#dce5dd]" />
            <Button asChild type="button" variant="secondary" className="rounded-[12px]">
              <a href={`${sourceBasePath}/download`} aria-label={`Download ${data.file.name}`}><Download className="h-4 w-4" /> Download</a>
            </Button>
          </div>
        </div>
        {data.file.mimeType.startsWith("image/") ? (
          <div className="border-t border-[#e5ebe6] bg-[#f5f8f5] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${sourceBasePath}/preview`} alt={`Project file ${data.file.name}`} className="mx-auto max-h-[320px] w-full rounded-[12px] object-contain" />
          </div>
        ) : null}
      </div>

      <div className="rounded-[18px] border border-[#e1e8e2] bg-white p-5">
        <p className="text-[10px] font-[760] uppercase tracking-[0.09em] text-[#7a867e]">Message</p>
        <RichTextContent value={data.message || `Please provide the ${data.field.title.toLocaleLowerCase()} for this project file.`} className="mt-2 text-[14px] leading-6 text-[#344038]" />
      </div>

      <div className="space-y-5 rounded-[20px] border border-[#dfe8e1] bg-[#fbfcfb] p-5 sm:p-6">
        <div>
          <h2 className="text-[19px] font-[760] text-[#1d2821]">Provide {data.field.title}</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#748078]">{data.field.helper}</p>
        </div>
        {renderControl()}
        <div className="flex flex-col-reverse gap-3 border-t border-[#e4eae5] pt-5 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => setShowDecline((current) => !current)}>
            Cannot provide this information
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={submitResponse}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSubmitting ? "Submitting..." : "Submit Response"}
          </Button>
        </div>
      </div>

      {showDecline ? (
        <div className="rounded-[18px] border border-[#ecd9d5] bg-[#fffafa] p-5">
          <div className="block">
            <span className="text-[13px] font-[720] text-[#493632]">Reason</span>
            <RichTextEditor value={declineReason} disabled={isSubmitting} className="mt-2 border-[#e5cfcb]" minHeightClassName="min-h-[100px]" ariaLabel="Decline reason" placeholder="Briefly explain why you cannot provide this information." onChange={setDeclineReason} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="destructive" disabled={isSubmitting || richTextToPlainText(declineReason).length < 3} onClick={declineRequest}>
              Confirm
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

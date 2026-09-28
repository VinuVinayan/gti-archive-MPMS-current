"use client";

import { FileThumbnail } from "@/components/projects/file-thumbnail";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProjectFileChecklistRequestWorkflowStatus } from "@prisma/client";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  Loader2,
  Plus,
  Send,
  X,
} from "lucide-react";

import {
  acceptStageFiveChecklistRequestAction,
  declineStageFiveChecklistRequestAction,
  submitStageFiveChecklistResponseAction,
} from "@/app/requests/checklist/[requestId]/actions";
import {
  ChecklistFilePicker,
  type ChecklistFileRecord,
} from "@/components/projects/checklist-file-picker";
import { AssetPreviewButton } from "@/components/projects/asset-preview-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@/components/ui/rich-text-editor";
import type {
  StageFiveChecklistRequestData,
  StageFiveChecklistValue,
} from "@/lib/stage-five";
import { uploadStageFiveChecklistAttachment } from "@/lib/stage-five-upload-client";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const CONTROL_CLASS =
  "min-h-12 rounded-[14px] border-[#dce5dd] bg-white shadow-none focus-visible:border-[#82aa90]";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function statusLabel(status: ProjectFileChecklistRequestWorkflowStatus) {
  return status.charAt(0) + status.slice(1).toLocaleLowerCase();
}

function MultiValueResponseInput({
  label,
  values,
  suggestions = [],
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
    if (!value) return;
    if (!values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      onChange([...values, value]);
    }
    setDraft("");
  }

  return (
    <div className="space-y-3">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-2 rounded-full bg-[#edf5ee] px-3 py-2 text-[12px] font-[680] text-[#355b43]"
            >
              {value}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={draft}
          list={`request-values-${label.replace(/\W+/g, "-").toLocaleLowerCase()}`}
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
        <datalist id={`request-values-${label.replace(/\W+/g, "-").toLocaleLowerCase()}`}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || !draft.trim()}
          className="shrink-0 rounded-[13px] shadow-none"
          onClick={addValue}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}

function ResponseSummary({ data }: { data: StageFiveChecklistRequestData }) {
  const { value, attachments } = data.response;
  const hasResponse = Boolean(
    value.text || value.values?.length || value.included || attachments.length,
  );

  return (
    <div className="space-y-3 rounded-[18px] border border-[#dce7de] bg-[#f8fbf8] p-5">
      <p className="text-[11px] font-[760] uppercase tracking-[0.1em] text-[#587363]">Response</p>
      {value.text ? (
        <RichTextContent value={value.text} className="text-[14px] leading-6 text-[#26332b]" />
      ) : null}
      {value.values?.length ? (
        <div className="flex flex-wrap gap-2">
          {value.values.map((valueItem) => (
            <span key={valueItem} className="rounded-full bg-white px-3 py-2 text-[12px] font-[680] text-[#355b43]">
              {valueItem}
            </span>
          ))}
        </div>
      ) : null}
      {value.included ? (
        <span className="inline-flex items-center gap-2 rounded-full bg-[#e3f2e6] px-3 py-2 text-[12px] font-[700] text-[#2e744e]">
          <Check className="h-3.5 w-3.5" /> Included
        </span>
      ) : null}
      {attachments.length ? (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-3 rounded-[13px] border border-[#e0e8e1] bg-white px-4 py-3">
              <FileThumbnail fileName={attachment.name} mimeType={attachment.mimeType} previewPath={`/api/project-assets/${attachment.id}/preview`} />
              <span className="min-w-0 truncate text-[13px] font-[680] text-[#2b372f]">
                {attachment.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {!hasResponse ? <p className="text-[13px] italic text-[#7c8780]">No response content.</p> : null}
    </div>
  );
}

export function StageFiveRequestWorkspace({ data }: { data: StageFiveChecklistRequestData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [text, setText] = useState(data.response.value.text ?? "");
  const [values, setValues] = useState(data.response.value.values ?? []);
  const [included, setIncluded] = useState(Boolean(data.response.value.included));
  const [files, setFiles] = useState<ChecklistFileRecord[]>([]);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const accepted = data.status === ProjectFileChecklistRequestWorkflowStatus.ACCEPTED;
  const requested = data.status === ProjectFileChecklistRequestWorkflowStatus.REQUESTED;
  const completed = data.status === ProjectFileChecklistRequestWorkflowStatus.COMPLETED;
  const declined = data.status === ProjectFileChecklistRequestWorkflowStatus.DECLINED;
  const disabled = isPending || isUploading;
  const sourcePreviewPath = `/api/requests/checklist/${data.id}/source/preview`;
  const sourceDownloadPath = `/api/requests/checklist/${data.id}/source/download`;

  function acceptRequest() {
    startTransition(async () => {
      const result = await acceptStageFiveChecklistRequestAction(data.id);
      if ("error" in result) {
        showErrorToast("Unable to accept request.", result.error);
        return;
      }
      showSuccessToast("Information request accepted.");
      router.refresh();
    });
  }

  function declineRequest() {
    if (!richTextToPlainText(declineReason)) return;
    startTransition(async () => {
      const result = await declineStageFiveChecklistRequestAction({
        requestId: data.id,
        reason: declineReason,
      });
      if ("error" in result) {
        showErrorToast("Unable to decline request.", result.error);
        return;
      }
      showSuccessToast("Information request declined.");
      router.refresh();
    });
  }

  async function submitResponse() {
    if (disabled) return;
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (record) => {
          if (!record.file) return record;
          const attachment = await uploadStageFiveChecklistAttachment(
            data.project.id,
            record.file,
            data.id,
          );
          return { ...record, id: attachment.id, attachmentId: attachment.id };
        }),
      );
      const value: StageFiveChecklistValue = {
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(values.length ? { values } : {}),
        ...(data.field.control === "health-warning" ? { included } : {}),
      };
      const result = await submitStageFiveChecklistResponseAction({
        requestId: data.id,
        value,
        attachmentIds: uploaded.map((file) => file.attachmentId ?? file.id),
      });
      if ("error" in result) {
        showErrorToast("Unable to submit response.", result.error);
        return;
      }
      setFiles(uploaded);
      showSuccessToast("Requested information submitted.");
      router.refresh();
    } catch (error) {
      showErrorToast(
        "Unable to submit response.",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  function renderResponseControl() {
    const control = data.field.control;
    if (control === "text") {
      return (
        <Input
          value={text}
          disabled={disabled}
          className={CONTROL_CLASS}
          placeholder={data.field.placeholder}
          onChange={(event) => setText(event.target.value)}
        />
      );
    }
    if (control === "textarea") {
      return (
        <RichTextEditor
          value={text}
          disabled={disabled}
          minHeightClassName="min-h-[140px]"
          placeholder={data.field.placeholder}
          ariaLabel={data.field.title}
          onChange={setText}
        />
      );
    }
    if (control === "file" || control === "multi-file") {
      return (
        <ChecklistFilePicker
          fieldLabel={data.field.title}
          files={files}
          multiple={control === "multi-file"}
          disabled={disabled}
          onChange={setFiles}
        />
      );
    }
    if (control === "multi-value") {
      return (
        <MultiValueResponseInput
          label={data.field.title}
          values={values}
          suggestions={data.field.suggestions}
          disabled={disabled}
          onChange={setValues}
        />
      );
    }
    if (control === "finishes") {
      return (
        <div className="space-y-4">
          <MultiValueResponseInput
            label={data.field.title}
            values={values}
            suggestions={data.field.suggestions}
            disabled={disabled}
            onChange={setValues}
          />
          <ChecklistFilePicker
            fieldLabel={`${data.field.title} reference`}
            files={files}
            multiple
            disabled={disabled}
            onChange={setFiles}
          />
        </div>
      );
    }
    if (control === "text-attachment") {
      return (
        <div className="space-y-4">
          <RichTextEditor
            value={text}
            disabled={disabled}
            minHeightClassName="min-h-[120px]"
            placeholder={data.field.placeholder}
            ariaLabel={data.field.title}
            onChange={setText}
          />
          <ChecklistFilePicker
            fieldLabel={`${data.field.title} reference`}
            files={files}
            multiple
            disabled={disabled}
            onChange={setFiles}
          />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <RichTextEditor
          value={text}
          disabled={disabled}
          minHeightClassName="min-h-[120px]"
          placeholder={data.field.placeholder}
          ariaLabel={data.field.title}
          onChange={setText}
        />
        <ChecklistFilePicker
          fieldLabel={`${data.field.title} reference`}
          files={files}
          multiple
          disabled={disabled}
          onChange={setFiles}
        />
        <button
          type="button"
          role="switch"
          aria-checked={included}
          disabled={disabled}
          className={cn(
            "inline-flex min-h-11 items-center gap-3 rounded-[13px] border px-4 text-[13px] font-[700]",
            included
              ? "border-[#a9cdb3] bg-[#eaf5ec] text-[#2f744e]"
              : "border-[#dce5dd] bg-white text-[#68746c]",
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

  return (
    <section className="mx-auto w-full max-w-[980px] pb-8">
      <nav
        aria-label="Information request context"
        className="mb-4 flex min-w-0 items-center"
      >
        <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-[680] text-[#718078]">
          <li className="max-w-[220px] truncate text-[#344d3d]" title={data.project.name}>
            {data.project.name}
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li>Stage 5 · File Checklist</li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li className="max-w-[220px] truncate" title={data.file.name}>
            {data.file.name}
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li className="text-[#344d3d]">{data.field.title}</li>
        </ol>
      </nav>
      <div className="overflow-hidden rounded-[28px] border border-[#dfe7df] bg-white shadow-[0_24px_70px_rgba(18,35,23,0.08)]">
        <header className="border-b border-[#e4ebe5] bg-[linear-gradient(135deg,#f8fbf8,#eef6f0)] px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-[780] uppercase tracking-[0.13em] text-[#4b765b]">Stage 5</p>
              <h1 className="mt-2 text-[30px] font-[780] tracking-[-0.04em] text-[#172019] sm:text-[38px]">
                Information Request
              </h1>
              <p className="mt-2 max-w-[620px] text-[14px] leading-6 text-[#68746c]">
                Review the requested checklist item and provide the information directly to the project.
              </p>
            </div>
            <span className={cn(
              "inline-flex w-fit rounded-full px-4 py-2 text-[12px] font-[760]",
              completed
                ? "bg-[#dff1e4] text-[#2d744d]"
                : declined
                  ? "bg-[#fff0ee] text-[#b54d43]"
                  : accepted
                    ? "bg-[#eaf2ff] text-[#3569bd]"
                    : "bg-[#fff2dc] text-[#94651f]",
            )}>
              {statusLabel(data.status)}
            </span>
          </div>
        </header>

        <div className="space-y-7 px-6 py-7 sm:px-9 sm:py-9">
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ["Project", data.project.name],
              ["Workflow context", "Stage 5 · File Checklist"],
              ["Requested information", data.field.title],
              ["Requested by", data.requestedBy.name],
              ["Requested on", formatDate(data.requestedAt)],
              ["Recipient", data.recipient.name],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[16px] border border-[#e3eae4] bg-[#fbfcfb] px-4 py-4">
                <dt className="text-[10px] font-[760] uppercase tracking-[0.09em] text-[#7a867e]">{label}</dt>
                <dd className="mt-1.5 break-words text-[14px] font-[700] text-[#28342c]">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="overflow-hidden rounded-[18px] border border-[#e1e8e2] bg-white">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-[760] uppercase tracking-[0.09em] text-[#7a867e]">
                  Requested file
                </p>
                <div className="mt-1.5 flex min-w-0 items-center gap-2">
                  <FileThumbnail fileName={data.file.name} mimeType={data.file.mimeType} previewPath={sourcePreviewPath} />
                  <p className="truncate text-[14px] font-[700] text-[#28342c]">{data.file.name}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <AssetPreviewButton
                  fileName={data.file.name}
                  mimeType={data.file.mimeType}
                  previewPath={sourcePreviewPath}
                  downloadPath={sourceDownloadPath}
                  iconOnly={false}
                  label="View file"
                  triggerClassName="rounded-[12px] border border-[#dce5dd] bg-white shadow-none"
                />
                <Button asChild type="button" variant="secondary" className="rounded-[12px] shadow-none">
                  <a href={sourceDownloadPath} aria-label={`Download ${data.file.name}`}>
                    <Download className="h-4 w-4" /> Download
                  </a>
                </Button>
              </div>
            </div>
            {data.file.mimeType.startsWith("image/") ? (
              <div className="border-t border-[#e5ebe6] bg-[#f5f8f5] p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sourcePreviewPath}
                  alt={`Requested file ${data.file.name}`}
                  className="mx-auto max-h-[360px] w-full rounded-[12px] object-contain"
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-[18px] border border-[#e1e8e2] bg-white p-5">
            <p className="text-[11px] font-[760] uppercase tracking-[0.09em] text-[#7a867e]">Message</p>
            <RichTextContent value={data.message || `Please provide the ${data.field.title.toLocaleLowerCase()} for this project.`} className="mt-2 text-[14px] leading-6 text-[#344038]" />
          </div>

          {completed ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-[16px] bg-[#eaf5ec] px-5 py-4 text-[#2f744e]">
                <CheckCircle2 className="h-5 w-5" />
                <div>
                  <p className="text-[13px] font-[760]">Response completed</p>
                  <p className="mt-0.5 text-[11px]">Submitted {formatDate(data.completedAt)}</p>
                </div>
              </div>
              <ResponseSummary data={data} />
            </div>
          ) : declined ? (
            <div className="rounded-[18px] border border-[#f0d6d2] bg-[#fff7f6] p-5">
              <div className="flex items-center gap-2 text-[#ad4c43]">
                <CircleAlert className="h-5 w-5" />
                <p className="text-[14px] font-[760]">Request declined</p>
              </div>
              <RichTextContent value={data.declineReason} className="mt-3 text-[13px] leading-6 text-[#6e514d]" />
              <p className="mt-2 text-[11px] text-[#92736e]">Declined {formatDate(data.declinedAt)}</p>
            </div>
          ) : requested ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" disabled={disabled || !data.canRespond} onClick={acceptRequest}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Accept Request
              </Button>
              <Button type="button" variant="ghost" disabled={disabled} onClick={() => setShowDecline(true)}>
                Decline Request
              </Button>
            </div>
          ) : accepted ? (
            <div className="space-y-5 rounded-[20px] border border-[#dfe8e1] bg-[#fbfcfb] p-5 sm:p-6">
              <div>
                <h2 className="text-[19px] font-[760] text-[#1d2821]">Provide {data.field.title}</h2>
                <p className="mt-1 text-[12px] leading-5 text-[#748078]">{data.field.helper}</p>
              </div>
              {renderResponseControl()}
              <div className="flex flex-col-reverse gap-3 border-t border-[#e4eae5] pt-5 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => setShowDecline(true)}>
                  Decline Request
                </Button>
                <Button type="button" disabled={disabled} onClick={submitResponse}>
                  {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {isUploading ? "Uploading..." : "Submit Response"}
                </Button>
              </div>
            </div>
          ) : null}

          {showDecline && !completed && !declined ? (
            <div className="rounded-[18px] border border-[#ecd9d5] bg-[#fffafa] p-5">
              <div className="block">
                <span className="text-[13px] font-[720] text-[#493632]">Reason for declining</span>
                <RichTextEditor
                  value={declineReason}
                  disabled={disabled}
                  className="mt-2 border-[#e5cfcb]"
                  minHeightClassName="min-h-[100px]"
                  placeholder="Briefly explain why you cannot provide this information."
                  ariaLabel="Reason for declining"
                  onChange={setDeclineReason}
                />
              </div>
              <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => setShowDecline(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={disabled || richTextToPlainText(declineReason).length < 3}
                  onClick={declineRequest}
                >
                  Confirm Decline
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

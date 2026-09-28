"use client";

import { FileThumbnail } from "@/components/projects/file-thumbnail";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  ProjectFileChecklistField,
  ProjectFileChecklistItemStatus,
  ProjectFileChecklistRequestChannel,
  ProjectFileChecklistRequestWorkflowStatus,
} from "@prisma/client";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Barcode,
  Box,
  Check,
  FileCheck2,
  FileOutput,
  FileText,
  Hash,
  HeartPulse,
  ImagePlus,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  Palette,
  Plus,
  QrCode,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  Stamp,
  ToggleLeft,
  Upload,
  X,
  Download,
  Trash2,
} from "lucide-react";

import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import {
  AssetPreviewButton,
} from "@/components/projects/asset-preview-button";
import {
  completeStageFiveAction,
  configureStageFiveChecklistRequestReminderAction,
  deleteStageFiveSourceFileAction,
  requestStageFiveChecklistInformationAction,
  resendStageFiveExternalChecklistRequestAction,
  saveStageFiveChecklistAction,
} from "@/app/(dashboard)/projects/[slug]/stages/5/actions";
import { ProjectStageSummary } from "@/components/projects/project-stage-summary";
import {
  ChecklistFilePicker,
  type ChecklistFileRecord,
} from "@/components/projects/checklist-file-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import {
  ProjectFormAutosaveStatus,
  useProjectFormAutosave,
} from "@/components/ui/project-form-autosave";
import { RichTextContent, RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectStageShellRecord } from "@/lib/projects";
import type {
  StageFiveChecklistValue,
  StageFiveChecklistItemRecord,
  StageFiveFileRecord,
  StageFiveParticipantRecord,
  StageFiveWorkspaceData,
} from "@/lib/stage-five";
import {
  STAGE_FIVE_FIELD_DEFINITIONS,
  STAGE_FIVE_FIELD_KEYS,
  type StageFiveFieldDefinition,
} from "@/lib/stage-five-fields";
import {
  uploadStageFiveChecklistAttachment,
  uploadStageFiveDirectSource,
} from "@/lib/stage-five-upload-client";
import { showErrorToast, showSuccessToast, showWarningToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  REQUEST_REMINDER_INTERVAL_HOURS,
  formatRequestReminderInterval,
  type RequestReminderIntervalHours,
} from "@/lib/request-reminder-shared";

type ChecklistFieldKey = ProjectFileChecklistField;

type ChecklistDefinition = StageFiveFieldDefinition & {
  icon: LucideIcon;
};

type LocalFileRecord = ChecklistFileRecord;

type StageFiveDraft = {
  textValues: Partial<Record<ChecklistFieldKey, string>>;
  files: Partial<Record<ChecklistFieldKey, LocalFileRecord[]>>;
  multiValues: Partial<Record<ChecklistFieldKey, string[]>>;
  healthWarningIncluded: boolean;
  statuses: Partial<Record<ChecklistFieldKey, ProjectFileChecklistItemStatus>>;
};

type StageFiveAutosaveValue = {
  draft: Omit<StageFiveDraft, "files" | "statuses"> & {
    files: Partial<Record<ChecklistFieldKey, LocalFileRecord[]>>;
  };
};

const STAGE_FIVE_SESSION_DRAFT_PREFIX = "gti:stage-five-checklist-draft";

type ChecklistSaveProgress = {
  percent: number;
  label: string;
  completedUploads: number;
  totalUploads: number;
};

const CHECKLIST_ITEM_ICONS: Record<ProjectFileChecklistField, LucideIcon> = {
  OUTPUT_NAME: FileOutput,
  TECHNICAL_DRAWING: FileText,
  HEALTH_WARNING: HeartPulse,
  TAR: Hash,
  NICOTINE: Hash,
  TAR_NICOTINE: Hash,
  COMPULSORY_TEXT: ShieldCheck,
  MARKETING_COPY: Palette,
  RELATED_GRAPHICS: ImagePlus,
  PRINTING_TECHNOLOGY: Sparkles,
  FINISHES: ToggleLeft,
  BARCODE: Barcode,
  TRACK_TRACE: MapPin,
  THREEDS: Box,
  TAX_STAMP: Stamp,
  QR_CODE: QrCode,
  INVOICE: ReceiptText,
};

const CHECKLIST_ITEMS: ChecklistDefinition[] = STAGE_FIVE_FIELD_DEFINITIONS.map(
  (field) => ({ ...field, icon: CHECKLIST_ITEM_ICONS[field.key] }),
);

const CHECKLIST_ITEM_BY_KEY = new Map(
  CHECKLIST_ITEMS.map((item) => [item.key, item]),
);

function buildStageFiveDrafts(files: StageFiveWorkspaceData["files"]) {
  return Object.fromEntries(
    files.map((file) => {
      const textValues: StageFiveDraft["textValues"] = {};
      const selectedFiles: StageFiveDraft["files"] = {};
      const multiValues: StageFiveDraft["multiValues"] = {};
      const statuses: StageFiveDraft["statuses"] = {};
      let healthWarningIncluded = false;

      for (const item of file.items) {
        const definition = CHECKLIST_ITEM_BY_KEY.get(item.fieldKey);
        const usesMultipleValues = definition?.control === "multi-value";
        if (item.value.text && !usesMultipleValues) {
          textValues[item.fieldKey] = item.value.text;
        }
        const normalizedValues = item.value.values?.length
          ? item.value.values
          : usesMultipleValues && item.value.text?.trim()
            ? [item.value.text.trim()]
            : [];
        if (normalizedValues.length) multiValues[item.fieldKey] = normalizedValues;
        if (item.fieldKey === ProjectFileChecklistField.HEALTH_WARNING) {
          healthWarningIncluded = Boolean(item.value.included);
        }
        if (item.attachments.length) {
          selectedFiles[item.fieldKey] = item.attachments.map((attachment) => ({
            id: attachment.id,
            attachmentId: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
          }));
        }
        statuses[item.fieldKey] = item.status;
      }

      return [
        file.handoffId,
        {
          textValues,
          files: selectedFiles,
          multiValues,
          healthWarningIncluded,
          statuses,
        } satisfies StageFiveDraft,
      ];
    }),
  ) as Record<string, StageFiveDraft>;
}

function buildStageFiveAutosaveValue(draft: StageFiveDraft): StageFiveAutosaveValue {
  return {
    draft: {
      textValues: draft.textValues,
      multiValues: draft.multiValues,
      healthWarningIncluded: draft.healthWarningIncluded,
      files: Object.fromEntries(
        Object.entries(draft.files).map(([fieldKey, files]) => [
          fieldKey,
          (files ?? [])
            .filter((file) => Boolean(file.attachmentId) && !file.file)
            .map((file) => ({
              id: file.id,
              attachmentId: file.attachmentId,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
            })),
        ]),
      ),
    },
  };
}

function parseStageFiveAutosaveValue(value: string): StageFiveAutosaveValue | null {
  try {
    const parsed = JSON.parse(value) as {
      draft?: {
        textValues?: unknown;
        files?: unknown;
        multiValues?: unknown;
        healthWarningIncluded?: unknown;
      };
    };
    if (!parsed?.draft || typeof parsed.draft !== "object") return null;

    const textSource = parsed.draft.textValues;
    const fileSource = parsed.draft.files;
    const multiSource = parsed.draft.multiValues;
    const textValues: StageFiveDraft["textValues"] = {};
    const files: StageFiveDraft["files"] = {};
    const multiValues: StageFiveDraft["multiValues"] = {};

    for (const fieldKey of STAGE_FIVE_FIELD_KEYS) {
      if (textSource && typeof textSource === "object") {
        const textValue = (textSource as Record<string, unknown>)[fieldKey];
        if (typeof textValue === "string") textValues[fieldKey] = textValue;
      }

      if (multiSource && typeof multiSource === "object") {
        const values = (multiSource as Record<string, unknown>)[fieldKey];
        if (Array.isArray(values)) {
          multiValues[fieldKey] = values.filter(
            (item): item is string => typeof item === "string",
          );
        }
      }

      if (fileSource && typeof fileSource === "object") {
        const records = (fileSource as Record<string, unknown>)[fieldKey];
        if (Array.isArray(records)) {
          files[fieldKey] = records.flatMap((record) => {
            if (!record || typeof record !== "object") return [];
            const candidate = record as Record<string, unknown>;
            if (
              typeof candidate.id !== "string" ||
              typeof candidate.attachmentId !== "string" ||
              typeof candidate.name !== "string" ||
              typeof candidate.mimeType !== "string" ||
              typeof candidate.size !== "number"
            ) {
              return [];
            }
            return [{
              id: candidate.id,
              attachmentId: candidate.attachmentId,
              name: candidate.name,
              mimeType: candidate.mimeType,
              size: candidate.size,
            } satisfies LocalFileRecord];
          });
        }
      }
    }

    return {
      draft: {
        textValues,
        files,
        multiValues,
        healthWarningIncluded: parsed.draft.healthWarningIncluded === true,
      },
    };
  } catch {
    return null;
  }
}

function readStageFiveSessionDraft(key: string) {
  try {
    return parseStageFiveAutosaveValue(window.sessionStorage.getItem(key) ?? "");
  } catch {
    return null;
  }
}

function writeStageFiveSessionDraft(key: string, value: StageFiveAutosaveValue) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Server autosave remains available when browser storage is disabled or full.
  }
}

function clearStageFiveSessionDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Browser storage is only the synchronous refresh fallback.
  }
}

function stageFiveDraftFingerprint(
  draft: Pick<
    StageFiveDraft,
    "textValues" | "files" | "multiValues" | "healthWarningIncluded"
  >,
) {
  return JSON.stringify({
    textValues: STAGE_FIVE_FIELD_KEYS.map((fieldKey) => [
      fieldKey,
      draft.textValues[fieldKey] ?? "",
    ]),
    files: STAGE_FIVE_FIELD_KEYS.map((fieldKey) => [
      fieldKey,
      (draft.files[fieldKey] ?? [])
        .map((file) => [
          file.attachmentId ?? "",
          file.name,
          file.mimeType,
          file.size,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ]),
    multiValues: STAGE_FIVE_FIELD_KEYS.map((fieldKey) => [
      fieldKey,
      draft.multiValues[fieldKey] ?? [],
    ]),
    healthWarningIncluded: draft.healthWarningIncluded,
  });
}

function mergeResolvedRequestFields(
  current: StageFiveDraft,
  server: StageFiveDraft,
) {
  const next: StageFiveDraft = {
    ...current,
    textValues: { ...current.textValues },
    files: { ...current.files },
    multiValues: { ...current.multiValues },
    statuses: { ...current.statuses },
  };

  for (const fieldKey of STAGE_FIVE_FIELD_KEYS) {
    if (
      current.statuses[fieldKey] !== ProjectFileChecklistItemStatus.REQUESTED ||
      server.statuses[fieldKey] === ProjectFileChecklistItemStatus.REQUESTED
    ) {
      continue;
    }

    next.textValues[fieldKey] = server.textValues[fieldKey] ?? "";
    next.files[fieldKey] = server.files[fieldKey] ?? [];
    next.multiValues[fieldKey] = server.multiValues[fieldKey] ?? [];
    next.statuses[fieldKey] = server.statuses[fieldKey];
    if (fieldKey === ProjectFileChecklistField.HEALTH_WARNING) {
      next.healthWarningIncluded = server.healthWarningIncluded;
    }
  }

  return next;
}

const CONTROL_CLASS =
  "min-h-11 rounded-[12px] border-[#dfe6df] bg-white shadow-none focus-visible:border-[#8db49a]";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatReminderDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function FileChecklistSwitcher({
  files,
  activeHandoffId,
  disabled,
  onSelect,
}: {
  files: StageFiveFileRecord[];
  activeHandoffId: string;
  disabled: boolean;
  onSelect: (handoffId: string) => void;
}) {
  return (
    <section aria-label="Final file checklists" className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 lg:min-w-0 lg:flex-wrap">
        {files.map((file, index) => {
          const selected = file.handoffId === activeHandoffId;
          return (
            <button
              key={file.handoffId}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(file.handoffId)}
              title={file.sourceAttachment.name}
              className={cn(
                "flex w-[230px] cursor-pointer items-center gap-3 rounded-[16px] border bg-white p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72a184] focus-visible:ring-offset-2 disabled:cursor-wait",
                selected
                  ? "border-[#72a184] shadow-[0_10px_26px_rgba(35,93,59,.12)] ring-2 ring-[#dfeee4]"
                  : "border-[#dfe6df] hover:border-[#b9cbbd]",
              )}
            >
              <FileThumbnail
                fileName={file.sourceAttachment.name}
                mimeType={file.sourceAttachment.mimeType}
                previewPath={`/api/project-assets/${file.sourceAttachment.id}/preview`}
                className="size-11 rounded-[12px]"
              />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12px] font-[720] text-[#27322b]">
                  {file.sourceAttachment.name}
                </strong>
                <span className={cn(
                  "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-[740]",
                  selected ? "bg-[#e4f2e7] text-[#2e744e]" : "bg-[#f0f3ef] text-[#6f7a72]",
                )}>
                  {selected ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                  File {index + 1} of {files.length}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChecklistStatusBadge({ status }: { status: ProjectFileChecklistItemStatus }) {
  const filled = status === ProjectFileChecklistItemStatus.FILLED;
  const requested = status === ProjectFileChecklistItemStatus.REQUESTED;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-[750]",
        filled
          ? "bg-[#e4f2e7] text-[#2e744e]"
          : requested
            ? "bg-[#eaf2ff] text-[#3569bd]"
            : "bg-[#fff3df] text-[#9a6a22]",
      )}
    >
      {filled ? <Check className="h-3 w-3" /> : null}
      {filled ? "Filled" : requested ? "Requested" : "Pending"}
    </span>
  );
}

function MultiValueChecklistInput({
  label,
  values,
  suggestions = [],
  disabled = false,
  onChange,
}: {
  label: string;
  values: string[];
  suggestions?: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  function addValue() {
    const value = draft.trim().replace(/\s+/g, " ");
    if (!value) return;
    if (!values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      onChange([...values, value]);
    }
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-2 rounded-[10px] bg-[#edf3ee] px-3 py-2 text-[11px] font-[650] text-[#405047]"
          >
            {value}
            <button
              type="button"
              disabled={disabled}
              className="text-[#748078] hover:text-[#29352d]"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex min-w-0 gap-2">
        <Input
          list={listId}
          value={draft}
          disabled={disabled}
          className={CONTROL_CLASS}
          placeholder={`Select or enter ${label.toLocaleLowerCase()}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
        />
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 shrink-0 rounded-[11px] shadow-none"
          disabled={disabled || !draft.trim()}
          onClick={addValue}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

function ChecklistItemRow({
  item,
  status,
  latestRequest,
  children,
  onRequest,
  onResend,
  onReminderChange,
  isResending,
}: {
  item: ChecklistDefinition;
  status: ProjectFileChecklistItemStatus;
  latestRequest: StageFiveChecklistItemRecord["latestRequest"];
  children: React.ReactNode;
  onRequest: () => void;
  onResend?: () => void;
  onReminderChange?: (intervalHours: RequestReminderIntervalHours | null) => void;
  isResending?: boolean;
}) {
  const Icon = item.icon;

  return (
    <div
      id={`stage-five-field-${item.key}`}
      className="grid scroll-mt-6 gap-4 border-t border-[#e8ede8] px-4 py-5 first:border-t-0 sm:px-5 lg:px-6 xl:grid-cols-[230px_minmax(0,1fr)_86px_108px] xl:items-start xl:gap-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#eef5ef] text-[#3a7556]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-[740] text-[#253029]">{item.title}</h3>
          <p className="mt-1 text-[11px] leading-4 text-[#7b857e]">{item.helper}</p>
          {latestRequest &&
          (latestRequest.workflowStatus === ProjectFileChecklistRequestWorkflowStatus.REQUESTED ||
            latestRequest.workflowStatus === ProjectFileChecklistRequestWorkflowStatus.ACCEPTED) ? (
            <div className="mt-2 text-[10px] leading-4 text-[#47745a]">
              <p>
                Requested from <span className="font-[720]">{latestRequest.recipient}</span>
                <br />
                {new Intl.DateTimeFormat("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                }).format(new Date(latestRequest.requestedAt))}
              </p>
              {latestRequest.channel === ProjectFileChecklistRequestChannel.EMAIL && onResend ? (
                <button
                  type="button"
                  disabled={isResending}
                  className="mt-1 font-[740] underline underline-offset-2 disabled:opacity-50"
                  onClick={onResend}
                >
                  {isResending ? "Resending..." : "Resend email"}
                </button>
              ) : null}
              {latestRequest.reminder?.enabled && onReminderChange ? (
                <div className="mt-2 rounded-[10px] border border-[#cfe0d3] bg-[#f4faf5] p-2">
                  <p className="font-[740] text-[#32684a]">
                    Reminder: {formatRequestReminderInterval(latestRequest.reminder.intervalHours)}
                  </p>
                  {latestRequest.reminder.nextReminderAt ? (
                    <p className="mt-0.5 text-[#6f7c73]">
                      Next: {formatReminderDate(latestRequest.reminder.nextReminderAt)}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2">
                    <Select
                      value={String(latestRequest.reminder.intervalHours)}
                      onValueChange={(value) =>
                        onReminderChange(Number(value) as RequestReminderIntervalHours)
                      }
                    >
                      <SelectTrigger className="h-8 min-w-0 flex-1 rounded-[9px] border-[#c8d8cc] bg-white px-2 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REQUEST_REMINDER_INTERVAL_HOURS.map((hours) => (
                          <SelectItem key={hours} value={String(hours)}>
                            {formatRequestReminderInterval(hours)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      disabled={isResending}
                      className="shrink-0 font-[740] text-[#a34a43] underline underline-offset-2 disabled:opacity-50"
                      onClick={() => onReminderChange(null)}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              ) : null}
              {!latestRequest.reminder?.enabled && onReminderChange ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="font-[700] text-[#6f7c73]">Enable reminder:</span>
                  {REQUEST_REMINDER_INTERVAL_HOURS.map((hours) => (
                    <button
                      key={hours}
                      type="button"
                      disabled={isResending}
                      className="rounded-full border border-[#cbd9ce] bg-white px-2 py-0.5 font-[740] text-[#32684a] disabled:opacity-50"
                      onClick={() => onReminderChange(hours)}
                    >
                      {hours}h
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
      <div className="flex items-center xl:min-h-11">
        <ChecklistStatusBadge status={status} />
      </div>
      <div className="flex items-center xl:min-h-11 xl:justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-[102px] rounded-[11px] shadow-none"
          onClick={onRequest}
        >
          <Send className="h-3.5 w-3.5" />
          Request
        </Button>
      </div>
    </div>
  );
}

function StageFiveReadOnlyView({
  textValues,
  files,
  multiValues,
  healthWarningIncluded,
  getStatus,
}: {
  textValues: Partial<Record<ChecklistFieldKey, string>>;
  files: Partial<Record<ChecklistFieldKey, LocalFileRecord[]>>;
  multiValues: Partial<Record<ChecklistFieldKey, string[]>>;
  healthWarningIncluded: boolean;
  getStatus: (item: ChecklistDefinition) => ProjectFileChecklistItemStatus;
}) {
  return (
    <section
      id="stage-five-view-panel"
      role="tabpanel"
      aria-label="View File Checklist"
      className="border-t border-[#e7ece7] bg-[#fbfcfb]"
    >
      <div className="px-4 py-5 sm:px-5 lg:px-6">
        <h2 className="text-[18px] font-[750] text-[#1b261f]">
          Required information and files
        </h2>
        <p className="mt-1 text-[11px] leading-4 text-[#77827a]">
          Read-only checklist summary.
        </p>
      </div>
      <div className="bg-white">
        {CHECKLIST_ITEMS.map((item) => {
          const Icon = item.icon;
          const value = textValues[item.key]?.trim() ?? "";
          const selectedFiles = files[item.key] ?? [];
          const values = multiValues[item.key] ?? [];
          const status = getStatus(item);
          const showIncluded = item.control === "health-warning" && healthWarningIncluded;
          const hasContent = Boolean(value || selectedFiles.length || values.length || showIncluded);

          return (
            <article
              key={item.key}
              id={`stage-five-field-${item.key}`}
              className="grid gap-4 border-t border-[#e8ede8] px-4 py-5 first:border-t-0 sm:px-5 lg:grid-cols-[230px_minmax(0,1fr)_86px] lg:px-6 lg:gap-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#eef5ef] text-[#3a7556]">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-[740] text-[#253029]">{item.title}</h3>
                  <p className="mt-1 text-[11px] leading-4 text-[#7b857e]">{item.helper}</p>
                </div>
              </div>

              <div className="min-w-0 space-y-3 text-[13px] leading-5 text-[#344038]">
                {value ? <RichTextContent value={value} className="break-words" /> : null}
                {values.length > 0 ? (
                  <div className="flex flex-wrap gap-2" aria-label={`${item.title} values`}>
                    {values.map((itemValue) => (
                      <span
                        key={itemValue}
                        className="inline-flex rounded-full bg-[#edf3ee] px-3 py-1.5 text-[11px] font-[650] text-[#405047]"
                      >
                        {itemValue}
                      </span>
                    ))}
                  </div>
                ) : null}
                {selectedFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-2" aria-label={`${item.title} selected files`}>
                    {selectedFiles.map((file) => (
                      <span
                        key={file.id}
                        className="inline-flex max-w-full items-center gap-2 rounded-[10px] border border-[#dfe6df] bg-[#f7faf7] px-3 py-2 text-[11px]"
                      >
                        <FileThumbnail
                          fileName={file.name}
                          mimeType={file.mimeType}
                          file={file.file}
                          previewPath={file.attachmentId ? `/api/project-assets/${file.attachmentId}/preview` : undefined}
                          className="h-8 w-10"
                        />
                        <span className="max-w-[320px] truncate font-[650]">{file.name}</span>
                        <span className="shrink-0 text-[#7c867f]">{formatFileSize(file.size)}</span>
                        {file.attachmentId ? (
                          <span className="ml-1 inline-flex items-center gap-1 border-l border-[#dfe6df] pl-2">
                            <AssetPreviewButton
                              fileName={file.name}
                              mimeType={file.mimeType}
                              previewPath={`/api/project-assets/${file.attachmentId}/preview`}
                              downloadPath={`/api/project-assets/${file.attachmentId}/download`}
                              triggerClassName="size-7 rounded p-1 text-[#438060] hover:bg-[#e8f1ea]"
                            />
                            <a
                              href={`/api/project-assets/${file.attachmentId}/download`}
                              className="rounded p-1 text-[#438060] hover:bg-[#e8f1ea]"
                              aria-label={`Download ${file.name}`}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : null}
                {showIncluded ? (
                  <span className="inline-flex rounded-full bg-[#e4f2e7] px-3 py-1.5 text-[11px] font-[650] text-[#2e744e]">
                    Included
                  </span>
                ) : null}
                {!hasContent ? (
                  <p className="italic text-[#89938c]">Not provided</p>
                ) : null}
              </div>

              <div className="flex items-start lg:justify-end">
                <ChecklistStatusBadge status={status} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RequestInformationDialog({
  field,
  participants,
  projectId,
  handoffId,
  onClose,
  onRequested,
}: {
  field: ChecklistDefinition;
  participants: StageFiveParticipantRecord[];
  projectId: string;
  handoffId: string;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [isSending, startSending] = useTransition();
  const requestId = useRef<string | null>(null);
  const [recipientMode, setRecipientMode] = useState<"existing" | "email">("existing");
  const [participantId, setParticipantId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderIntervalHours, setReminderIntervalHours] =
    useState<RequestReminderIntervalHours>(24);
  const autosave = useProjectFormAutosave({
    projectId,
    formKey: `stage-five-information-request:${handoffId}:${field.key}`,
    value: {
      recipientMode,
      participantId,
      recipientName,
      email,
      message,
      reminderEnabled,
      reminderIntervalHours,
    },
    onRestore: (draft) => {
      setRecipientMode(draft.recipientMode);
      setParticipantId(draft.participantId);
      setRecipientName(draft.recipientName);
      setEmail(draft.email);
      setMessage(draft.message);
      setReminderEnabled(draft.reminderEnabled ?? false);
      setReminderIntervalHours(
        REQUEST_REMINDER_INTERVAL_HOURS.includes(draft.reminderIntervalHours)
          ? draft.reminderIntervalHours
          : 24,
      );
    },
  });
  const canPrepare =
    recipientMode === "existing" ? Boolean(participantId) : /^\S+@\S+\.\S+$/.test(email.trim());
  const closeWithAutosave = () => {
    void autosave.flush().finally(onClose);
  };

  function sendRequest() {
    if (!canPrepare || isSending) return;
    requestId.current ??= crypto.randomUUID();
    startSending(async () => {
      const result = await requestStageFiveChecklistInformationAction({
        clientRequestId: requestId.current ?? crypto.randomUUID(),
        projectId,
        handoffId,
        fieldKey: field.key,
        channel:
          recipientMode === "existing"
            ? ProjectFileChecklistRequestChannel.IN_APP
            : ProjectFileChecklistRequestChannel.EMAIL,
        ...(recipientMode === "existing"
          ? { recipientUserId: participantId }
          : { recipientName, recipientEmail: email }),
        message,
        reminderIntervalHours: reminderEnabled
          ? reminderIntervalHours
          : null,
      });
      if ("error" in result) {
        showErrorToast("Unable to send request.", result.error);
        if (result.request?.status === "FAILED") requestId.current = null;
        return;
      }
      await autosave.clearDraft().catch(() => undefined);
      onRequested();
      onClose();
      showSuccessToast(
        recipientMode === "existing"
          ? "In-app request sent."
          : "Request email sent.",
      );
    });
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center overflow-hidden bg-[#112118]/40 p-3 backdrop-blur-[2px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-information-title"
    >
      <Card className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] border-[#dfe6df] shadow-[0_32px_80px_rgba(14,31,20,0.22)] sm:max-h-[calc(100dvh-2.5rem)]">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e7ece8] px-5 py-4 sm:px-6 sm:py-5">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-[760] uppercase tracking-[0.12em] text-[#4c795e]">
                <Mail className="h-3.5 w-3.5" /> Request information
              </div>
              <h2
                id="request-information-title"
                className="mt-2 text-[22px] font-[760] tracking-[-0.03em] text-[#162019]"
              >
                Request {field.title}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-[#6f7a72]">
                Choose who should provide this checklist item and add an optional note.
              </p>
            </div>
            <Button type="button" variant="secondary" size="icon" onClick={closeWithAutosave}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close request dialog</span>
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
            <div className="rounded-[14px] border border-[#e1e8e2] bg-[#f7faf7] px-4 py-3">
              <span className="text-[10px] font-[720] uppercase tracking-[0.08em] text-[#818b84]">Field</span>
              <p className="mt-1 text-[13px] font-[700] text-[#28342c]">{field.title}</p>
            </div>

            <fieldset className="mt-5">
              <legend className="text-[12px] font-[700] text-[#2d372f]">Request from</legend>
              <div className="mt-2 inline-flex w-full rounded-[12px] border border-[#dce4dd] bg-[#f4f7f4] p-1 sm:w-auto">
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-[9px] px-4 py-2 text-[11px] font-[700] transition sm:flex-none",
                    recipientMode === "existing"
                      ? "bg-white text-[#276c4a] shadow-sm"
                      : "text-[#69746d]",
                  )}
                  aria-pressed={recipientMode === "existing"}
                  onClick={() => setRecipientMode("existing")}
                >
                  Project participant
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-[9px] px-4 py-2 text-[11px] font-[700] transition sm:flex-none",
                    recipientMode === "email"
                      ? "bg-white text-[#276c4a] shadow-sm"
                      : "text-[#69746d]",
                  )}
                  aria-pressed={recipientMode === "email"}
                  onClick={() => setRecipientMode("email")}
                >
                  Manual email
                </button>
              </div>

              {recipientMode === "existing" ? (
                <Select
                  value={participantId}
                  onValueChange={setParticipantId}
                >
                  <SelectTrigger
                    className="mt-3 h-11 w-full rounded-[12px] border border-[#dfe6df] bg-white px-4 text-[13px] text-[#344038] shadow-none"
                    aria-label="Select a project participant"
                  >
                    <SelectValue placeholder="Select a collaborator" />
                  </SelectTrigger>
                  <SelectContent className="z-[190]">
                    {participants.map((participant) => (
                      <SelectItem key={participant.id} value={participant.id}>
                        {participant.name} — {participant.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="mt-3 space-y-3">
                  <Input
                    value={recipientName}
                    className={CONTROL_CLASS}
                    placeholder="Recipient name (optional)"
                    aria-label="Manual recipient name"
                    onChange={(event) => setRecipientName(event.target.value)}
                  />
                  <Input
                    type="email"
                    value={email}
                    className={CONTROL_CLASS}
                    placeholder="name@example.com"
                    aria-label="Manual recipient email"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              )}
            </fieldset>

            <div className="mt-5 block space-y-2">
              <span className="text-[12px] font-[700] text-[#2d372f]">Message (optional)</span>
              <RichTextEditor
                value={message}
                placeholder={`Please provide the ${field.title.toLocaleLowerCase()} for this project.`}
                ariaLabel="Request message"
                minHeightClassName="min-h-[96px]"
                onChange={setMessage}
              />
            </div>

            <div className="mt-5 rounded-[14px] border border-[#dce5dd] bg-[#f8fbf8] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[12px] font-[720] text-[#2d372f]">Reminder</p>
                  <p className="mt-1 text-[10px] leading-4 text-[#748078]">
                    Repeat while this specific request is still pending.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reminderEnabled}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition",
                    reminderEnabled ? "bg-[#2f8057]" : "bg-[#cdd6cf]",
                  )}
                  onClick={() => setReminderEnabled((value) => !value)}
                >
                  <span
                    className={cn(
                      "absolute top-1 size-5 rounded-full bg-white shadow-sm transition",
                      reminderEnabled ? "left-6" : "left-1",
                    )}
                  />
                  <span className="sr-only">Enable recurring reminder</span>
                </button>
              </div>
              {reminderEnabled ? (
                <label className="mt-4 block space-y-2">
                  <span className="text-[11px] font-[700] text-[#455148]">
                    Reminder interval
                  </span>
                  <Select
                    value={String(reminderIntervalHours)}
                    onValueChange={(value) =>
                      setReminderIntervalHours(
                        Number(value) as RequestReminderIntervalHours,
                      )
                    }
                  >
                    <SelectTrigger className="h-11 rounded-[12px] border-[#c8d5cb] bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[190]">
                      {REQUEST_REMINDER_INTERVAL_HOURS.map((hours) => (
                        <SelectItem key={hours} value={String(hours)}>
                          {formatRequestReminderInterval(hours)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
            </div>

            <p className="mt-4 rounded-[12px] bg-[#f4f7f4] px-3 py-2 text-[10px] leading-4 text-[#748078]">
              Manual recipients receive a secure email link to provide the requested information without a GTI account.
            </p>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#e7ece8] bg-white px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <Button type="button" className="w-full sm:w-auto" variant="secondary" onClick={closeWithAutosave}>
              Cancel
            </Button>
            <ProjectFormAutosaveStatus status={autosave.status} savedAt={autosave.savedAt} restoredAt={autosave.restoredAt} onRetry={() => void autosave.retry()} className="sm:mr-auto" />
            <Button type="button" className="w-full sm:w-auto" disabled={!canPrepare || isSending} onClick={sendRequest}>
              <Send className="h-4 w-4" /> {isSending ? "Sending..." : "Send Request"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function StageFiveWorkspace({
  project,
  currentUserId,
  pageData,
  initialHandoffId,
  initialMode,
  initialField,
  showChrome = true,
}: {
  project: ProjectStageShellRecord;
  currentUserId: string;
  pageData: StageFiveWorkspaceData;
  initialHandoffId?: string;
  initialMode?: "edit" | "view";
  initialField?: ProjectFileChecklistField;
  showChrome?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"edit" | "view">(
    pageData.canEdit && initialMode !== "view" ? "edit" : "view",
  );
  const firstHandoffId = pageData.files[0]?.handoffId ?? "";
  const [selectedHandoffId] = useState(
    pageData.files.some((file) => file.handoffId === initialHandoffId)
      ? initialHandoffId ?? firstHandoffId
      : firstHandoffId,
  );
  const committedDrafts = useMemo(
    () => buildStageFiveDrafts(pageData.files),
    [pageData.files],
  );
  const [drafts, setDrafts] = useState(() => committedDrafts);
  const [dirtyHandoffIds, setDirtyHandoffIds] = useState<Set<string>>(() => new Set());
  const dirtyHandoffIdsRef = useRef(dirtyHandoffIds);
  const stageFiveSessionDraftKey = useMemo(
    () =>
      `${STAGE_FIVE_SESSION_DRAFT_PREFIX}:${currentUserId}:${project.id}:${selectedHandoffId || "none"}`,
    [currentUserId, project.id, selectedHandoffId],
  );
  const [hydratedSessionDraftKey, setHydratedSessionDraftKey] = useState<string | null>(
    null,
  );
  const [isSaving, startSaving] = useTransition();
  const [isSwitchingFile, startFileSwitch] = useTransition();
  const [saveProgress, setSaveProgress] = useState<ChecklistSaveProgress | null>(null);
  const [isRequestActionPending, startRequestAction] = useTransition();
  const [isCompleting, startCompleting] = useTransition();
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [completionError, setCompletionError] = useState("");
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [sourceUploadProgress, setSourceUploadProgress] = useState(0);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const [requestField, setRequestField] = useState<ChecklistDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StageFiveFileRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, startDeleting] = useTransition();
  const activeFile = pageData.files.find((file) => file.handoffId === selectedHandoffId);
  const activeDraft = drafts[selectedHandoffId];
  const unsavedHandoffIds = useMemo(() => {
    const next = new Set<string>();
    for (const file of pageData.files) {
      const draft = drafts[file.handoffId];
      const committedDraft = committedDrafts[file.handoffId];
      if (
        draft &&
        committedDraft &&
        stageFiveDraftFingerprint(draft) !== stageFiveDraftFingerprint(committedDraft)
      ) {
        next.add(file.handoffId);
      }
    }
    return next;
  }, [committedDrafts, drafts, pageData.files]);
  const hasUnsavedChecklistChanges = unsavedHandoffIds.size > 0;
  const autosaveValue = useMemo(
    () => buildStageFiveAutosaveValue(activeDraft ?? {
      textValues: {},
      files: {},
      multiValues: {},
      healthWarningIncluded: false,
      statuses: {},
    }),
    [activeDraft],
  );
  const autosave = useProjectFormAutosave({
    projectId: project.id,
    formKey: `stage-five-checklist:${selectedHandoffId || "none"}`,
    value: autosaveValue,
    enabled: Boolean(pageData.canEdit && !pageData.stageCompleted && activeDraft),
    onRestore: ({ draft }) => {
      if (!selectedHandoffId) return;
      if (
        activeDraft &&
        stageFiveDraftFingerprint(activeDraft) === stageFiveDraftFingerprint(draft)
      ) {
        updateDirtyHandoffIds((current) => {
          const next = new Set(current);
          next.delete(selectedHandoffId);
          return next;
        });
        return;
      }
      setDrafts((current) => ({
        ...current,
        [selectedHandoffId]: {
          ...current[selectedHandoffId],
          textValues: draft.textValues,
          multiValues: draft.multiValues,
          healthWarningIncluded: draft.healthWarningIncluded,
          files: draft.files,
        },
      }));
      updateDirtyHandoffIds((current) => new Set(current).add(selectedHandoffId));
    },
  });

  useEffect(() => {
    if (!initialField) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`stage-five-field-${initialField}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialField, selectedHandoffId, mode]);

  useEffect(() => {
    const dirtyIds = dirtyHandoffIdsRef.current;
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(committedDrafts).map(([handoffId, serverDraft]) => [
          handoffId,
          dirtyIds.has(handoffId) && current[handoffId]
            ? mergeResolvedRequestFields(current[handoffId], serverDraft)
            : serverDraft,
        ]),
      ),
    );
  }, [committedDrafts]);

  useEffect(() => {
    setHydratedSessionDraftKey(null);
    if (!pageData.canEdit || pageData.stageCompleted || !selectedHandoffId) {
      setHydratedSessionDraftKey(stageFiveSessionDraftKey);
      return;
    }

    const committedDraft = committedDrafts[selectedHandoffId];
    const storedDraft = readStageFiveSessionDraft(stageFiveSessionDraftKey)?.draft;

    if (committedDraft && storedDraft) {
      if (
        stageFiveDraftFingerprint(committedDraft) ===
        stageFiveDraftFingerprint(storedDraft)
      ) {
        clearStageFiveSessionDraft(stageFiveSessionDraftKey);
      } else if (!dirtyHandoffIdsRef.current.has(selectedHandoffId)) {
        setDrafts((current) => ({
          ...current,
          [selectedHandoffId]: {
            ...current[selectedHandoffId],
            textValues: storedDraft.textValues,
            files: storedDraft.files,
            multiValues: storedDraft.multiValues,
            healthWarningIncluded: storedDraft.healthWarningIncluded,
          },
        }));
        updateDirtyHandoffIds((current) => new Set(current).add(selectedHandoffId));
      }
    }

    setHydratedSessionDraftKey(stageFiveSessionDraftKey);
  }, [
    committedDrafts,
    pageData.canEdit,
    pageData.stageCompleted,
    selectedHandoffId,
    stageFiveSessionDraftKey,
  ]);

  useEffect(() => {
    if (
      hydratedSessionDraftKey !== stageFiveSessionDraftKey ||
      !pageData.canEdit ||
      pageData.stageCompleted ||
      !selectedHandoffId ||
      !activeDraft
    ) {
      return;
    }

    if (unsavedHandoffIds.has(selectedHandoffId)) {
      writeStageFiveSessionDraft(
        stageFiveSessionDraftKey,
        buildStageFiveAutosaveValue(activeDraft),
      );
    } else {
      clearStageFiveSessionDraft(stageFiveSessionDraftKey);
    }
  }, [
    activeDraft,
    hydratedSessionDraftKey,
    pageData.canEdit,
    pageData.stageCompleted,
    selectedHandoffId,
    stageFiveSessionDraftKey,
    unsavedHandoffIds,
  ]);

  useEffect(() => {
    if (!pageData.canEdit || pageData.stageCompleted || !hasUnsavedChecklistChanges) {
      return;
    }

    const warnBeforeDiscardingDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeDiscardingDraft);
    return () => window.removeEventListener("beforeunload", warnBeforeDiscardingDraft);
  }, [hasUnsavedChecklistChanges, pageData.canEdit, pageData.stageCompleted]);

  function updateDirtyHandoffIds(updater: (current: Set<string>) => Set<string>) {
    setDirtyHandoffIds((current) => {
      const next = updater(current);
      dirtyHandoffIdsRef.current = next;
      return next;
    });
  }

  function updateSelectedFile(handoffId: string) {
    if (handoffId === selectedHandoffId || isSwitchingFile || isSaving || isDeleting || isUploadingSource || isCompleting) return;
    const hasPendingUploads = Object.values(activeDraft?.files ?? {}).some(
      (files) => files?.some((file) => Boolean(file.file) && !file.attachmentId),
    );
    if (hasPendingUploads) {
      showWarningToast("Save Changes before switching files.", "Your selected attachments still need to be uploaded.");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("file", handoffId);
    params.set("mode", mode);
    startFileSwitch(() => {
      router.replace(`/projects/${project.id}/stages/5?${params.toString()}`, { scroll: false });
    });
  }

  function deleteSourceFile() {
    if (!deleteTarget || isDeleting) return;
    const target = deleteTarget;
    const nextFile = pageData.files.find(
      (file) => file.handoffId !== target.handoffId,
    );
    setDeleteError("");
    startDeleting(async () => {
      const result = await deleteStageFiveSourceFileAction({
        projectId: project.id,
        handoffId: target.handoffId,
      });
      if (!("success" in result)) {
        setDeleteError(result.error ?? "Unable to delete the Stage 5 file.");
        return;
      }

      if (target.handoffId === selectedHandoffId) {
        clearStageFiveSessionDraft(stageFiveSessionDraftKey);
      }
      setDeleteTarget(null);
      showSuccessToast(
        "Stage 5 file deleted.",
        result.sourceRemovedOnly
          ? "The Stage 5 checklist was removed; the approved source remains in its original stage."
          : `${result.fileName} was removed.`,
      );
      const params = new URLSearchParams({ mode });
      if (nextFile) params.set("file", nextFile.handoffId);
      router.replace(`/projects/${project.id}/stages/5?${params.toString()}`);
      router.refresh();
    });
  }

  function completeStage() {
    if (isCompleting || hasUnsavedChecklistChanges) return;
    setCompletionError("");
    startCompleting(async () => {
      const result = await completeStageFiveAction({ projectId: project.id });
      if ("error" in result) {
        setCompletionError(result.error ?? "Unable to complete Stage 5.");
        return;
      }
      setShowCompletionDialog(false);
      showSuccessToast(
        `Stage 5 completed. ${result.productionUnitCount} Production Unit${result.productionUnitCount === 1 ? " was" : "s were"} created.`,
      );
      router.push(`/projects/${project.id}/stages/6`);
      router.refresh();
    });
  }

  function updateMode(nextMode: "edit" | "view") {
    if (nextMode === "edit" && !pageData.canEdit) return;
    setMode(nextMode);
    const params = new URLSearchParams(window.location.search);
    params.set("mode", nextMode);
    if (selectedHandoffId) params.set("file", selectedHandoffId);
    router.replace(`/projects/${project.id}/stages/5?${params.toString()}`, { scroll: false });
  }

  async function uploadDirectSource(file: File) {
    if (!pageData.canUploadSource || isUploadingSource) return;
    setIsUploadingSource(true);
    setSourceUploadProgress(0);
    try {
      const uploaded = await uploadStageFiveDirectSource(
        project.id,
        file,
        setSourceUploadProgress,
      );
      showSuccessToast("Final file uploaded. Its File Checklist is ready.");
      router.replace(
        `/projects/${project.id}/stages/5?file=${encodeURIComponent(uploaded.handoffId)}&mode=edit`,
      );
      router.refresh();
    } catch (error) {
      showErrorToast(
        "Unable to upload the final file.",
        error instanceof Error ? error.message : "Please try again.",
      );
      router.refresh();
    } finally {
      setIsUploadingSource(false);
      setSourceUploadProgress(0);
      if (sourceFileInputRef.current) {
        sourceFileInputRef.current.value = "";
      }
    }
  }

  function updateActiveDraft(
    updater: (current: NonNullable<typeof activeDraft>) => NonNullable<typeof activeDraft>,
  ) {
    if (!selectedHandoffId || !activeDraft) return;
    setDrafts((current) => ({
      ...current,
      [selectedHandoffId]: updater(current[selectedHandoffId]),
    }));
    updateDirtyHandoffIds((current) => new Set(current).add(selectedHandoffId));
  }

  function updateText(key: ChecklistFieldKey, value: string) {
    updateActiveDraft((current) => ({
      ...current,
      textValues: { ...current.textValues, [key]: value },
    }));
  }

  function updateFiles(key: ChecklistFieldKey, value: LocalFileRecord[]) {
    updateActiveDraft((current) => ({
      ...current,
      files: { ...current.files, [key]: value },
    }));
  }

  function updateMultiValues(key: ChecklistFieldKey, value: string[]) {
    updateActiveDraft((current) => ({
      ...current,
      multiValues: { ...current.multiValues, [key]: value },
    }));
  }

  function isFilled(item: ChecklistDefinition) {
    if (!activeDraft) return false;
    const hasText = Boolean(activeDraft.textValues[item.key]?.trim());
    const hasFiles = Boolean(
      activeDraft.files[item.key]?.some((file) => file.uploadState !== "failed"),
    );
    const hasMultiValues = Boolean(activeDraft.multiValues[item.key]?.length);

    if (item.control === "health-warning") {
      return activeDraft.healthWarningIncluded || hasText || hasFiles;
    }
    if (item.control === "multi-value") return hasMultiValues;
    if (item.control === "finishes") return hasMultiValues || hasFiles;
    if (item.control === "file" || item.control === "multi-file") return hasFiles;
    if (item.control === "text-attachment") return hasText || hasFiles;
    return hasText;
  }

  function getItemStatus(item: ChecklistDefinition) {
    if (isFilled(item)) return ProjectFileChecklistItemStatus.FILLED;
    return activeDraft?.statuses[item.key] === ProjectFileChecklistItemStatus.REQUESTED
      ? ProjectFileChecklistItemStatus.REQUESTED
      : ProjectFileChecklistItemStatus.PENDING;
  }

  function saveChecklist() {
    if (!activeFile || !activeDraft || isSaving) return;
    const submittedHandoffId = activeFile.handoffId;
    startSaving(async () => {
      const resolvedFiles = Object.fromEntries(
        CHECKLIST_ITEMS.map((item) => [item.key, [...(activeDraft.files[item.key] ?? [])]]),
      ) as Partial<Record<ChecklistFieldKey, LocalFileRecord[]>>;
      const uploadTasks = CHECKLIST_ITEMS.flatMap((item) =>
        (resolvedFiles[item.key] ?? [])
          .filter((record): record is LocalFileRecord & { file: File } => Boolean(record.file))
          .map((record) => ({ fieldKey: item.key, record })),
      );
      const progressByRecord = new Map(uploadTasks.map(({ record }) => [record.id, 0]));
      let completedUploads = 0;
      let failedUploads = 0;

      const publishFiles = () => {
        setDrafts((current) => ({
          ...current,
          [submittedHandoffId]: {
            ...current[submittedHandoffId],
            files: { ...resolvedFiles },
          },
        }));
      };

      const replaceFile = (
        fieldKey: ChecklistFieldKey,
        recordId: string,
        updater: (record: LocalFileRecord) => LocalFileRecord,
      ) => {
        resolvedFiles[fieldKey] = (resolvedFiles[fieldKey] ?? []).map((record) =>
          record.id === recordId ? updater(record) : record,
        );
      };

      const updateOverallProgress = (label: string) => {
        const uploadProgress = Array.from(progressByRecord.values()).reduce(
          (total, progress) => total + progress,
          0,
        );
        const totalSteps = uploadTasks.length + 1;
        setSaveProgress({
          percent: Math.min(99, Math.round((uploadProgress / totalSteps) * 100)),
          label,
          completedUploads,
          totalUploads: uploadTasks.length,
        });
      };

      setSaveProgress({
        percent: 0,
        label: uploadTasks.length ? "Preparing file uploads" : "Saving checklist information",
        completedUploads: 0,
        totalUploads: uploadTasks.length,
      });

      try {
        let nextUploadIndex = 0;
        async function uploadWorker() {
          while (nextUploadIndex < uploadTasks.length) {
            const task = uploadTasks[nextUploadIndex];
            nextUploadIndex += 1;
            replaceFile(task.fieldKey, task.record.id, (record) => ({
              ...record,
              uploadState: "uploading",
              uploadProgress: 0,
              uploadError: undefined,
            }));
            publishFiles();

            try {
              const uploaded = await uploadStageFiveChecklistAttachment(
                project.id,
                task.record.file,
                undefined,
                (progress) => {
                  progressByRecord.set(task.record.id, progress);
                  replaceFile(task.fieldKey, task.record.id, (record) => ({
                    ...record,
                    uploadState: "uploading",
                    uploadProgress: progress,
                  }));
                  publishFiles();
                  updateOverallProgress(`Uploading ${task.record.name}`);
                },
              );
              progressByRecord.set(task.record.id, 1);
              completedUploads += 1;
              replaceFile(task.fieldKey, task.record.id, () => ({
                id: uploaded.id,
                attachmentId: uploaded.id,
                name: uploaded.name,
                mimeType: uploaded.mimeType,
                size: uploaded.size,
              }));
              publishFiles();
              updateOverallProgress(`Uploaded ${completedUploads} of ${uploadTasks.length} files`);
            } catch (error) {
              progressByRecord.set(task.record.id, 1);
              completedUploads += 1;
              failedUploads += 1;
              replaceFile(task.fieldKey, task.record.id, (record) => ({
                ...record,
                uploadState: "failed",
                uploadProgress: 0,
                uploadError: error instanceof Error ? error.message : "Upload failed. Please retry.",
              }));
              publishFiles();
              updateOverallProgress(`Could not upload ${task.record.name}`);
            }
          }
        }

        await Promise.all(
          Array.from(
            { length: Math.min(3, uploadTasks.length) },
            () => uploadWorker(),
          ),
        );

        setSaveProgress({
          percent: uploadTasks.length
            ? Math.round((uploadTasks.length / (uploadTasks.length + 1)) * 100)
            : 50,
          label: failedUploads
            ? "Saving successful uploads and checklist information"
            : "Saving checklist information",
          completedUploads,
          totalUploads: uploadTasks.length,
        });

        const result = await saveStageFiveChecklistAction({
          projectId: project.id,
          handoffId: submittedHandoffId,
          items: CHECKLIST_ITEMS.map((item) => ({
            fieldKey: item.key,
            value: {
              ...(activeDraft.textValues[item.key]?.trim()
                ? { text: activeDraft.textValues[item.key]?.trim() }
                : {}),
              ...(activeDraft.multiValues[item.key]?.length
                ? { values: activeDraft.multiValues[item.key] }
                : {}),
              ...(item.key === ProjectFileChecklistField.HEALTH_WARNING
                ? { included: activeDraft.healthWarningIncluded }
                : {}),
            } satisfies StageFiveChecklistValue,
            attachmentIds: (resolvedFiles[item.key] ?? []).flatMap((file) =>
              file.attachmentId ? [file.attachmentId] : [],
            ),
          })),
        });
        if ("error" in result) {
          showErrorToast("Unable to save checklist.", result.error);
          return;
        }
        const statusByField = new Map(result.items.map((item) => [item.fieldKey, item.status]));
        setDrafts((current) => ({
          ...current,
          [submittedHandoffId]: {
            ...current[submittedHandoffId],
            files: resolvedFiles,
            statuses: {
              ...current[submittedHandoffId].statuses,
              ...Object.fromEntries(statusByField),
            },
          },
        }));
        setSaveProgress({
          percent: 100,
          label: failedUploads ? "Saved with upload issues" : "Save complete",
          completedUploads,
          totalUploads: uploadTasks.length,
        });
        if (failedUploads === 0) {
          updateDirtyHandoffIds((current) => {
            const next = new Set(current);
            next.delete(submittedHandoffId);
            return next;
          });
          await autosave.clearDraft({
            resume: true,
            baseline: buildStageFiveAutosaveValue({
              ...activeDraft,
              files: resolvedFiles,
            }),
          }).catch(() => undefined);
          clearStageFiveSessionDraft(stageFiveSessionDraftKey);
          showSuccessToast("File checklist saved.");
          router.refresh();
        } else {
          showWarningToast(
            "Checklist saved with upload issues.",
            `${failedUploads} ${failedUploads === 1 ? "file was" : "files were"} not uploaded. Successful files were saved; use Retry and save again.`,
          );
        }
      } catch (error) {
        publishFiles();
        showErrorToast(
          "Unable to save checklist.",
          error instanceof Error ? error.message : "Please try again.",
        );
      } finally {
        setSaveProgress(null);
      }
    });
  }

  function resendExternalRequest(requestId: string) {
    startRequestAction(async () => {
      const result = await resendStageFiveExternalChecklistRequestAction({
        projectId: project.id,
        requestId,
      });
      if ("error" in result) {
        showErrorToast("Unable to resend request.", result.error);
        return;
      }
      showSuccessToast("A new secure request link was emailed.");
      router.refresh();
    });
  }

  function changeRequestReminder(
    requestId: string,
    intervalHours: RequestReminderIntervalHours | null,
  ) {
    startRequestAction(async () => {
      const result = await configureStageFiveChecklistRequestReminderAction({
        projectId: project.id,
        requestId,
        intervalHours,
      });
      if ("error" in result) {
        showErrorToast("Unable to update reminder.", result.error);
        return;
      }
      showSuccessToast(
        intervalHours
          ? `Reminder changed to every ${intervalHours} hours.`
          : "Reminder stopped.",
      );
      router.refresh();
    });
  }

  function renderControl(item: ChecklistDefinition) {
    const value = activeDraft?.textValues[item.key] ?? "";
    const selectedFiles = activeDraft?.files[item.key] ?? [];
    const values = activeDraft?.multiValues[item.key] ?? [];

    if (item.control === "text") {
      return (
        <Input
          value={value}
          disabled={isSaving}
          className={CONTROL_CLASS}
          placeholder={item.placeholder}
          aria-label={item.title}
          onChange={(event) => updateText(item.key, event.target.value)}
        />
      );
    }

    if (item.control === "textarea") {
      return (
        <RichTextEditor
          value={value}
          disabled={isSaving}
          minHeightClassName="min-h-[96px]"
          placeholder={item.placeholder}
          ariaLabel={item.title}
          onChange={(nextValue) => updateText(item.key, nextValue)}
        />
      );
    }

    if (item.control === "file" || item.control === "multi-file") {
      return (
        <ChecklistFilePicker
          fieldLabel={item.title}
          files={selectedFiles}
          multiple={item.control === "multi-file"}
          disabled={isSaving}
          onChange={(nextFiles) => updateFiles(item.key, nextFiles)}
        />
      );
    }

    if (item.control === "multi-value") {
      return (
        <MultiValueChecklistInput
          label={item.title}
          values={values}
          suggestions={item.suggestions}
          disabled={isSaving}
          onChange={(nextValues) => updateMultiValues(item.key, nextValues)}
        />
      );
    }

    if (item.control === "finishes") {
      return (
        <div className="space-y-3">
          <MultiValueChecklistInput
            label={item.title}
            values={values}
            suggestions={item.suggestions}
            disabled={isSaving}
            onChange={(nextValues) => updateMultiValues(item.key, nextValues)}
          />
          <ChecklistFilePicker
            fieldLabel={`${item.title} reference`}
            files={selectedFiles}
            multiple
            compact
            disabled={isSaving}
            onChange={(nextFiles) => updateFiles(item.key, nextFiles)}
          />
        </div>
      );
    }

    if (item.control === "text-attachment") {
      return (
        <div className="space-y-3">
          <RichTextEditor
            value={value}
            disabled={isSaving}
            minHeightClassName="min-h-[96px]"
            placeholder={item.placeholder}
            ariaLabel={item.title}
            onChange={(nextValue) => updateText(item.key, nextValue)}
          />
          <ChecklistFilePicker
            fieldLabel={`${item.title} reference`}
            files={selectedFiles}
            multiple
            compact
            disabled={isSaving}
            onChange={(nextFiles) => updateFiles(item.key, nextFiles)}
          />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <RichTextEditor
          value={value}
          disabled={isSaving}
          minHeightClassName="min-h-[96px]"
          placeholder={item.placeholder}
          ariaLabel={item.title}
          onChange={(nextValue) => updateText(item.key, nextValue)}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <ChecklistFilePicker
            fieldLabel={`${item.title} reference`}
            files={selectedFiles}
            multiple
            compact
            disabled={isSaving}
            onChange={(nextFiles) => updateFiles(item.key, nextFiles)}
          />
          <button
            type="button"
            role="switch"
            aria-checked={activeDraft?.healthWarningIncluded ?? false}
            disabled={isSaving}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[11px] border border-[#dfe6df] bg-white px-3 text-[11px] font-[680] text-[#58645c]"
            onClick={() =>
              updateActiveDraft((current) => ({
                ...current,
                healthWarningIncluded: !current.healthWarningIncluded,
              }))
            }
          >
            <span
              className={cn(
                "relative h-5 w-9 rounded-full transition",
                activeDraft?.healthWarningIncluded ? "bg-[#39845d]" : "bg-[#d5dcd6]",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition",
                  activeDraft?.healthWarningIncluded ? "left-[18px]" : "left-0.5",
                )}
              />
            </span>
            {activeDraft?.healthWarningIncluded ? "Included" : "Not included"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <input
        ref={sourceFileInputRef}
        type="file"
        className="hidden"
        aria-label="Upload Stage 5 final file"
        disabled={!pageData.canUploadSource || isUploadingSource}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadDirectSource(file);
        }}
      />
      {showChrome ? (
        <ProjectAccessRealtimeGuard projectId={project.id} currentUserId={currentUserId} />
      ) : null}
      <Card className="overflow-hidden rounded-[26px] border-[#dfe6df] shadow-[0_20px_54px_rgba(23,39,28,0.055)]">
        <CardContent className="p-0">
          <div className="px-5 py-6 sm:px-7 sm:py-8 lg:px-9">
            {showChrome ? <div className="flex items-center gap-2 text-[11px] font-[760] uppercase tracking-[0.13em] text-[#4d765d]">
              <FileCheck2 className="h-4 w-4" /> File Checklist
            </div> : null}
            <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", showChrome && "mt-3")}>
              {showChrome ? <h1 className="text-[28px] font-[780] tracking-[-0.04em] text-[#111713] sm:text-[34px]">
                Stage 5 - File Checklist
              </h1> : <span />}
              <div
                role="tablist"
                aria-label="File Checklist presentation mode"
                className="inline-grid w-fit grid-cols-2 rounded-[12px] border border-[#dce4dd] bg-white p-1 shadow-[0_8px_20px_rgba(23,39,28,0.04)]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "edit"}
                  aria-controls="stage-five-edit-panel"
                  disabled={!pageData.canEdit}
                  onClick={() => updateMode("edit")}
                  className={cn(
                    "min-w-[72px] rounded-[9px] px-3 py-2 text-[12px] font-[700] transition",
                    mode === "edit"
                      ? "bg-[#eaf4ec] text-[#236945]"
                      : "text-[#6f7a72] hover:bg-[#f4f7f4]",
                    !pageData.canEdit && "cursor-not-allowed opacity-40",
                  )}
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "view"}
                  aria-controls="stage-five-view-panel"
                  onClick={() => updateMode("view")}
                  className={cn(
                    "min-w-[72px] rounded-[9px] px-3 py-2 text-[12px] font-[700] transition",
                    mode === "view"
                      ? "bg-[#eaf4ec] text-[#236945]"
                      : "text-[#6f7a72] hover:bg-[#f4f7f4]",
                  )}
                >
                  View
                </button>
              </div>
            </div>
            {showChrome ? <p className="mt-2 text-[13px] leading-5 text-[#6f7a72]">
              Complete or request the required project information and files.
            </p> : null}
            {showChrome ? <ProjectStageSummary project={project} className="mt-7" /> : null}

            {activeFile ? (
              <div className="mt-5 space-y-3" aria-busy={isSwitchingFile}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[12px] font-[740] text-[#27322b]">File checklist for</h2>
                    <p className="mt-1 text-[11px] text-[#77827a]">Select a file to open its checklist.</p>
                  </div>
                  {pageData.canUploadSource ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="rounded-[12px] shadow-none"
                      disabled={isUploadingSource || isSwitchingFile || isSaving}
                      onClick={() => sourceFileInputRef.current?.click()}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isUploadingSource
                        ? `Uploading ${Math.round(sourceUploadProgress * 100)}%`
                        : "Add Another Final File"}
                    </Button>
                  ) : null}
                </div>
                <FileChecklistSwitcher
                  files={pageData.files}
                  activeHandoffId={selectedHandoffId}
                  disabled={isSwitchingFile || isSaving || isDeleting || isUploadingSource || isCompleting}
                  onSelect={updateSelectedFile}
                />
                {isSwitchingFile ? (
                  <p role="status" className="flex items-center gap-2 text-[11px] text-[#4d765d]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Loading checklist…
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 rounded-[16px] border border-[#dfe6df] bg-[#f8faf8] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <a
                      href={`/api/project-assets/${activeFile.sourceAttachment.id}/preview`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Preview ${activeFile.sourceAttachment.name}`}
                      className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-[#d9e2da] bg-white text-[#438060] shadow-[0_6px_16px_rgba(28,50,35,0.07)]"
                    >
                      <FileThumbnail
                        fileName={activeFile.sourceAttachment.name}
                        mimeType={activeFile.sourceAttachment.mimeType}
                        previewPath={`/api/project-assets/${activeFile.sourceAttachment.id}/preview`}
                        className="size-full rounded-none border-0 bg-transparent"
                      />
                    </a>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-[700] text-[#27322b]" title={activeFile.sourceAttachment.name}>
                        {activeFile.sourceAttachment.name}
                      </p>
                      <p className="mt-1 text-[12px] font-[700] text-[#2f6548]">
                        {CHECKLIST_ITEMS.filter((item) => getItemStatus(item) === ProjectFileChecklistItemStatus.FILLED).length} / {CHECKLIST_ITEMS.length} filled
                      </p>
                      {activeFile.sourceOrigin === "DIRECT_STAGE_FIVE" ? (
                        <p className="mt-1 text-[10px] font-[650] text-[#4d765d]">
                          Uploaded directly in Stage 5
                        </p>
                      ) : activeFile.sourceOrigin === "STAGE_THREE" ? (
                        <p className="mt-1 text-[10px] font-[650] text-[#4d765d]">
                          Carried forward from Stage 3
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {pageData.canEdit && !pageData.stageCompleted ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 rounded-[10px] border-[#efc8c4] px-3 text-[11px] font-[700] text-[#aa4740] hover:bg-[#fff3f2] hover:text-[#923b35]"
                      disabled={isDeleting || isSwitchingFile || isSaving}
                      onClick={() => {
                        setDeleteError("");
                        setDeleteTarget(activeFile);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete File
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {!activeFile || !activeDraft ? (
            <section className="border-t border-[#e7ece7] bg-[#fbfcfb] px-6 py-16 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#eaf4ed] text-[#2f8057]">
                <FileCheck2 className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-[18px] font-[750] text-[#1b261f]">No final file available</h2>
              <p className="mx-auto mt-2 max-w-[520px] text-[12px] leading-5 text-[#77827a]">
                Stage 4 was skipped or no final file was handed over. Upload the final file here to start the File Checklist.
              </p>
              {pageData.canUploadSource ? (
                <div className="mt-5">
                  <Button
                    type="button"
                    className="min-w-[180px] rounded-[12px]"
                    disabled={isUploadingSource}
                    onClick={() => sourceFileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    {isUploadingSource
                      ? `Uploading ${Math.round(sourceUploadProgress * 100)}%`
                      : "Upload Final File"}
                  </Button>
                  {isUploadingSource ? (
                    <div
                      role="progressbar"
                      aria-label="Final file upload progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(sourceUploadProgress * 100)}
                      className="mx-auto mt-3 h-1.5 max-w-[260px] overflow-hidden rounded-full bg-[#e2e9e3]"
                    >
                      <div
                        className="h-full rounded-full bg-[#2f8057] transition-[width]"
                        style={{ width: `${Math.round(sourceUploadProgress * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : pageData.stageCompleted ? null : (
                <p className="mt-4 text-[11px] font-[650] text-[#77827a]">
                  An authorized Stage 5 manager must upload the final file.
                </p>
              )}
            </section>
          ) : mode === "view" ? (
            <StageFiveReadOnlyView
              textValues={activeDraft.textValues}
              files={activeDraft.files}
              multiValues={activeDraft.multiValues}
              healthWarningIncluded={activeDraft.healthWarningIncluded}
              getStatus={getItemStatus}
            />
          ) : (
          <section
            id="stage-five-edit-panel"
            role="tabpanel"
            aria-label="Edit File Checklist"
            className="border-t border-[#e7ece7] bg-[#fbfcfb]"
            aria-labelledby="file-checklist-heading"
          >
            <div className="px-4 py-5 sm:px-5 lg:px-6">
              <div>
                <h2 id="file-checklist-heading" className="text-[18px] font-[750] text-[#1b261f]">
                  Required information and files
                </h2>
                <p className="mt-1 text-[11px] leading-4 text-[#77827a]">
                  Values and selected files are saved independently for this final file.
                </p>
              </div>
            </div>
            <div className="hidden border-t border-[#e8ede8] bg-white px-6 py-3 text-[10px] font-[740] uppercase tracking-[0.08em] text-[#7c867f] xl:grid xl:grid-cols-[230px_minmax(0,1fr)_86px_108px] xl:gap-5">
              <span>Field</span>
              <span>Information / Upload</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            <div className="bg-white">
              {CHECKLIST_ITEMS.map((item) => (
                <ChecklistItemRow
                  key={item.key}
                  item={item}
                  status={getItemStatus(item)}
                  latestRequest={
                    activeFile.items.find((activeItem) => activeItem.fieldKey === item.key)
                      ?.latestRequest ?? null
                  }
                  onRequest={() => setRequestField(item)}
                  onResend={(() => {
                    const latestRequest = activeFile.items.find(
                      (activeItem) => activeItem.fieldKey === item.key,
                    )?.latestRequest;
                    return latestRequest?.channel === ProjectFileChecklistRequestChannel.EMAIL
                      ? () => resendExternalRequest(latestRequest.id)
                      : undefined;
                  })()}
                  onReminderChange={(() => {
                    const latestRequest = activeFile.items.find(
                      (activeItem) => activeItem.fieldKey === item.key,
                    )?.latestRequest;
                    return latestRequest
                      ? (intervalHours) =>
                          changeRequestReminder(latestRequest.id, intervalHours)
                      : undefined;
                  })()}
                  isResending={isRequestActionPending}
                >
                  {renderControl(item)}
                </ChecklistItemRow>
              ))}
            </div>
            <div className="flex justify-end border-t border-[#e7ece7] bg-[#fbfcfb] px-4 py-5 sm:px-5 lg:px-6">
              <div className="w-full space-y-2 sm:w-[250px]">
                <Button
                  type="button"
                  className="w-full"
                  disabled={isSaving || !unsavedHandoffIds.has(selectedHandoffId)}
                  onClick={saveChecklist}
                >
                  <FileCheck2 className="h-4 w-4" />
                  {isSaving ? `Saving ${saveProgress?.percent ?? 0}%` : "Save Changes"}
                </Button>
                <ProjectFormAutosaveStatus
                  status={autosave.status}
                  savedAt={autosave.savedAt}
                  restoredAt={autosave.restoredAt}
                  onRetry={() => void autosave.retry()}
                  className="justify-center"
                />
                {isSaving && saveProgress ? (
                  <div
                    role="progressbar"
                    aria-label="Checklist save progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={saveProgress.percent}
                    className="space-y-1"
                  >
                    <div className="flex items-center justify-between gap-3 text-[9px] font-[650] text-[#748078]">
                      <span className="min-w-0 truncate" title={saveProgress.label}>
                        {saveProgress.label}
                      </span>
                      <span className="shrink-0">{saveProgress.percent}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#e2e9e3]">
                      <div
                        className="h-full rounded-full bg-[#2f8057] transition-[width] duration-200"
                        style={{ width: `${saveProgress.percent}%` }}
                      />
                    </div>
                    {saveProgress.totalUploads > 0 ? (
                      <p className="text-right text-[9px] text-[#8a948d]">
                        {saveProgress.completedUploads} / {saveProgress.totalUploads} file uploads processed
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-[#e7ece7] bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-9">
            <Button asChild type="button" variant="outline" className="min-w-[160px] rounded-[13px] shadow-none">
              <Link href={`/projects/${project.id}`}>
                <ListChecks className="h-4 w-4" /> All Stages
              </Link>
            </Button>
            {pageData.stageCompleted ? (
              <Button asChild type="button" className="min-w-[180px] rounded-[13px]">
                <Link href={`/projects/${project.id}/stages/6`}>
                  Next Stage <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : pageData.canComplete ? (
              <div className="text-right">
                {hasUnsavedChecklistChanges ? (
                  <p className="mb-2 text-[10px] font-[650] text-[#9a6a22]">Save checklist changes before completion.</p>
                ) : null}
                <Button
                  type="button"
                  className="min-w-[180px] rounded-[13px]"
                  disabled={
                    isSaving ||
                    isCompleting ||
                    hasUnsavedChecklistChanges ||
                    pageData.files.length === 0
                  }
                  onClick={() => {
                    setCompletionError("");
                    setShowCompletionDialog(true);
                  }}
                >
                  <Check className="h-4 w-4" /> Complete Stage 5
                </Button>
              </div>
            ) : (
              <p className="text-[11px] font-[650] text-[#77827a]">Owner or Co-Owner completion required.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {requestField ? (
        <RequestInformationDialog
          key={requestField.key}
          field={requestField}
          participants={pageData.participants}
          projectId={project.id}
          handoffId={selectedHandoffId}
          onClose={() => setRequestField(null)}
          onRequested={() => {
            const nextStatus = isFilled(requestField)
              ? ProjectFileChecklistItemStatus.FILLED
              : ProjectFileChecklistItemStatus.REQUESTED;
            setDrafts((current) => ({
              ...current,
              [selectedHandoffId]: {
                ...current[selectedHandoffId],
                statuses: {
                  ...current[selectedHandoffId].statuses,
                  [requestField.key]: nextStatus,
                },
              },
            }));
          }}
        />
      ) : null}
      <ConfirmationDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Stage 5 file?"
        description={
          deleteTarget?.sourceOrigin === "DIRECT_STAGE_FIVE"
            ? "This permanently removes the uploaded final file, its checklist, and any related information requests."
            : "This removes the file and its checklist from Stage 5, including related information requests. The approved source file remains available in its original stage."
        }
        confirmLabel="Delete File"
        cancelLabel="Cancel"
        tone="destructive"
        pending={isDeleting}
        error={deleteError || undefined}
        onConfirm={deleteSourceFile}
        onClose={() => {
          if (isDeleting) return;
          setDeleteTarget(null);
          setDeleteError("");
        }}
      />
      <ConfirmationDialog
        isOpen={showCompletionDialog}
        title="Complete Stage 5"
        description={
          pageData.pendingRequestCount > 0
            ? "Some checklist information requests are still pending. Continue and create one Production Unit for every Stage 5 final file?"
            : "Create one Production Unit for every Stage 5 final file and unlock Stage 6?"
        }
        confirmLabel="Complete Stage 5"
        pending={isCompleting}
        error={completionError || undefined}
        onConfirm={completeStage}
        onClose={() => {
          if (!isCompleting) setShowCompletionDialog(false);
        }}
      />
    </section>
  );
}

export function StageFiveLoadingShell() {
  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <Card className="overflow-hidden rounded-[26px] border-[#dfe6df] shadow-none">
        <CardContent className="p-0">
          <div className="p-7 lg:p-9">
            <Skeleton className="h-4 w-32 rounded-full" />
            <Skeleton className="mt-4 h-10 w-full max-w-[460px] rounded-[12px]" />
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-[82px] rounded-[16px]" />
              ))}
            </div>
          </div>
          <div className="border-t border-[#e7ece7] bg-[#fbfcfb] p-6">
            <div className="space-y-3">
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-[82px] rounded-[16px]" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

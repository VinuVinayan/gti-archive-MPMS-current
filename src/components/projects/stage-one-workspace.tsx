"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  ProjectInquiryAttachmentField,
  ProjectInquiryPriority,
} from "@prisma/client";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  ListChecks,
  Loader2,
  Paperclip,
  Search,
  X,
} from "lucide-react";

import {
  completeProjectInquiryAction,
  createContactDirectoryEntryAction,
  searchProjectInquiryHistorySuggestionsAction,
  searchProjectInquiryPartyOptionsAction,
} from "@/app/(dashboard)/projects/[slug]/stages/1/actions";
import { AppDatePicker } from "@/components/calendar/app-date-picker";
import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import { ProjectFlowSummaryStrip } from "@/components/projects/project-summary-strip";
import { StageOneReadOnlyView } from "@/components/projects/stage-one-read-only-view";
import {
  ProjectContactDialog,
  type ProjectContactForm,
} from "@/components/projects/project-contact-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  ProjectFormAutosaveStatus,
  useProjectFormAutosave,
} from "@/components/ui/project-form-autosave";
import { validateProjectContactInput } from "@/lib/project-contact-validation";
import type {
  CompleteProjectInquiryInput,
  ProjectInquiryAttachmentRecord,
  ProjectInquiryFieldErrors,
  ProjectInquiryPageData,
  ProjectInquiryPartyOption,
  ProjectInquiryPartySelection,
  ProjectInquiryRecord,
} from "@/lib/project-inquiry";
import type { ProjectStageShellRecord } from "@/lib/projects";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type StageOneWorkspaceProps = {
  project: ProjectStageShellRecord;
  currentUserId: string;
  pageData: ProjectInquiryPageData;
  showChrome?: boolean;
};

type PartyField = "client" | "finalBeneficiary";

const attachmentFields = {
  initialBrief: "INITIAL_BRIEF",
  businessObjectives: "BUSINESS_OBJECTIVES",
  legalNotes: "LEGAL_NOTES",
} as const satisfies Record<string, ProjectInquiryAttachmentField>;

function getTodayDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, "0");
  const day = `${today.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultContactForm(entityType: ProjectContactForm["entityType"] = "PERSON"): ProjectContactForm {
  return { entityType, name: "", company: "", companyEmail: "", companyPhone: "", companyWebsite: "", position: "", email: "", phone: "" };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StageOneFormField({
  label,
  required = false,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="mb-2 block text-[13px] font-[720] text-[#202923]">
        {label}
        {required ? <span className="ml-1 text-[#bd4d48]">*</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1.5 text-[12px] text-[#b84e48]">{error}</p> : null}
    </div>
  );
}

function PartySelector({
  ariaLabel,
  placeholder,
  options,
  values,
  multiple = false,
  companyFirst = false,
  showPersonName = false,
  disabled,
  error,
  onChange,
  onSearch,
}: {
  ariaLabel: string;
  placeholder: string;
  options: ProjectInquiryPartyOption[];
  values: ProjectInquiryPartySelection[];
  multiple?: boolean;
  companyFirst?: boolean;
  showPersonName?: boolean;
  disabled: boolean;
  error?: string;
  onChange: (values: ProjectInquiryPartySelection[]) => void;
  onSearch: (query: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedKeys = useMemo(
    () => new Set(values.map((value) => `${value.source}:${value.id}`)),
    [values],
  );
  const singleValue = multiple ? null : values[0] ?? null;
  function partyLabel(party: ProjectInquiryPartySelection) {
    return party.entityType === "COMPANY" ? party.company || party.name : party.name;
  }
  function partyDescription(party: ProjectInquiryPartySelection) {
    return party.entityType === "COMPANY"
      ? [party.name, party.position, party.companyEmail || party.email].filter(Boolean).join(" · ")
      : [party.company, party.position, party.email].filter(Boolean).join(" · ");
  }
  const showSearchInput = multiple || !singleValue || open;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    const matches = options.filter((option) => {
      if (multiple && selectedKeys.has(`${option.source}:${option.id}`)) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [option.name, option.company, option.position, option.email, option.companyEmail, option.companyPhone, option.companyWebsite]
        .filter(Boolean)
        .some((part) => part!.toLocaleLowerCase("en").includes(normalizedQuery));
    });
    if (companyFirst) {
      matches.sort((left, right) =>
        Number(right.entityType === "COMPANY") -
        Number(left.entityType === "COMPANY"),
      );
    }
    return matches;
  }, [companyFirst, multiple, options, query, selectedKeys]);

  function selectOption(option: ProjectInquiryPartyOption) {
    onChange(multiple ? [...values, option] : [option]);
    setQuery("");
    setOpen(multiple);
  }

  function removeOption(option: ProjectInquiryPartySelection) {
    onChange(
      values.filter(
        (value) => value.id !== option.id || value.source !== option.source,
      ),
    );
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setSearching(true);
      void onSearch(query).finally(() => {
        if (!cancelled) setSearching(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [disabled, onSearch, open, query]);

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex min-h-12 flex-wrap items-center gap-2 rounded-[14px] border bg-white px-3 py-1 transition",
          open ? "border-brand ring-3 ring-brand/10" : "border-[#dce3dc]",
          error && "border-[#c85c54]",
          disabled && "bg-[#f6f8f6] opacity-70",
        )}
      >
        {multiple
          ? values.map((value) => (
              <span
                key={`${value.source}:${value.id}`}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-[#edf4ee] py-1 pl-2.5 pr-1 text-[12px] font-[650] text-[#285f43]"
              >
                <span className="max-w-[180px] min-w-0 whitespace-normal break-words">{partyLabel(value)}</span>
                {!disabled ? (
                  <button
                    type="button"
                    aria-label={`Remove ${partyLabel(value)}`}
                    onClick={() => removeOption(value)}
                    className="grid size-5 place-items-center rounded-full hover:bg-[#dce9df]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            ))
          : null}
        {showSearchInput ? (
          <Search className="h-4 w-4 shrink-0 text-[#859087]" />
        ) : null}
        {singleValue && !open ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block min-w-0 whitespace-normal break-words text-[13px] font-[650] text-[#263029]">
              {partyLabel(singleValue)}
            </span>
            {partyDescription(singleValue) ? (
              <span className="block whitespace-normal break-words text-[11px] text-[#7d8780]">
                {partyDescription(singleValue)}
              </span>
            ) : null}
          </button>
        ) : (
          <input
            aria-label={ariaLabel}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            disabled={disabled}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter" && filteredOptions[0]) {
                event.preventDefault();
                selectOption(filteredOptions[0]);
              }
            }}
            placeholder={placeholder}
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#9aa39b]"
          />
        )}
        {singleValue && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel}`}
            onClick={() => {
              onChange([]);
              setQuery("");
              setOpen(true);
            }}
            className="grid size-7 place-items-center rounded-full text-[#7d8780] hover:bg-[#edf2ed]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          aria-label={`Open ${ariaLabel}`}
          onClick={() => setOpen((current) => !current)}
          className="grid size-7 place-items-center rounded-full text-[#59645d]"
        >
          <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
        </button>
      </div>

      {open && !disabled ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 max-h-[290px] overflow-y-auto rounded-[18px] border border-[#dce3dc] bg-white p-1.5 shadow-[0_20px_50px_rgba(17,33,23,0.14)]"
        >
          {searching && filteredOptions.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[#7b847d]">
              Searching...
            </p>
          ) : filteredOptions.length ? (
            filteredOptions.map((option) => {
              const selected = selectedKeys.has(`${option.source}:${option.id}`);
              const optionName = showPersonName ? option.name.trim() || partyLabel(option) : partyLabel(option);
              const companyName = option.source === "MANUAL_CONTACT" ? option.company?.trim() : null;
              const optionDetails = showPersonName
                ? companyName || "Company name not available."
                : [option.entityType === "COMPANY" ? "Company" : "Person", partyDescription(option)].filter(Boolean).join(" · ");
              return (
                <button
                  key={`${option.source}:${option.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    selectOption(option);
                  }}
                  className="flex w-full items-center gap-3 rounded-[13px] px-3 py-2.5 text-left hover:bg-[#f3f7f3]"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#edf4ee] text-[11px] font-[750] text-[#2d704b]">
                    {optionName
                      .split(/\s+/)
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block min-w-0 whitespace-normal break-words font-[650] text-[#202923]", showPersonName ? "text-[15px]" : "text-[13px]")}>
                      {optionName}
                    </span>
                    <span className="block whitespace-normal break-words text-[11px] text-[#7d8780]">
                      {optionDetails}
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4 text-brand" /> : null}
                </button>
              );
            })
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-[#7b847d]">
              {companyFirst ? "No matching companies or contacts." : "No matching people or contacts."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MultiEntryInput({
  ariaLabel,
  values,
  suggestions,
  placeholder,
  disabled,
  error,
  onChange,
  onSearchSuggestions,
}: {
  ariaLabel: string;
  values: string[];
  suggestions: string[];
  placeholder: string;
  disabled: boolean;
  error?: string;
  onChange: (values: string[]) => void;
  onSearchSuggestions?: (query: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(
    suggestions.length > 0 || !onSearchSuggestions,
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedValues = useMemo(
    () => new Set(values.map((value) => value.trim().toLocaleLowerCase("en"))),
    [values],
  );
  const filteredSuggestions = useMemo(() => {
    const query = draft.trim().toLocaleLowerCase("en");
    return suggestions
      .filter((suggestion) => !normalizedValues.has(suggestion.toLocaleLowerCase("en")))
      .filter((suggestion) => !query || suggestion.toLocaleLowerCase("en").includes(query));
  }, [draft, normalizedValues, suggestions]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearching(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || disabled || !onSearchSuggestions) return;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void onSearchSuggestions(draft).finally(() => {
        if (!cancelled) {
          setSearching(false);
          setSuggestionsLoaded(true);
        }
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [disabled, draft, onSearchSuggestions, open]);

  function openSuggestions() {
    setOpen(true);
    if (onSearchSuggestions) {
      setSearching(true);
      setSuggestionsLoaded(false);
    }
  }

  function toggleSuggestions() {
    if (open) {
      setOpen(false);
      setSearching(false);
      return;
    }

    openSuggestions();
  }

  function add(value: string) {
    const normalized = value.trim();
    if (!normalized || normalizedValues.has(normalized.toLocaleLowerCase("en"))) {
      setDraft("");
      return;
    }
    onChange([...values, normalized]);
    setDraft("");
    setOpen(false);
    setSearching(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex min-h-12 flex-wrap items-center gap-2 rounded-[14px] border bg-white px-2.5 py-2 focus-within:ring-3 focus-within:ring-brand/15",
          error ? "border-[#c85c54]" : "border-[#dce3dc]",
          disabled && "bg-[#f6f8f6] opacity-70",
        )}
      >
        {values.map((value) => (
          <span
            key={value.toLocaleLowerCase("en")}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#f0f4f0] px-2.5 py-1.5 text-[11px] font-[650] text-[#38443c]"
          >
            {value}
            {!disabled ? (
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
                className="rounded-full text-[#7d8880] hover:text-[#2d6949]"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        <input
          aria-label={ariaLabel}
          disabled={disabled}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            openSuggestions();
          }}
          onFocus={openSuggestions}
          onBlur={() => {
            window.setTimeout(() => {
              if (draft.trim()) add(draft);
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            }
            if (event.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          placeholder={placeholder}
          className="h-7 min-w-[150px] flex-1 bg-transparent px-1 text-[13px] text-[#29322c] outline-none placeholder:text-[#9aa39b]"
        />
        {!disabled &&
        (filteredSuggestions.length > 0 || searching || !suggestionsLoaded) ? (
          <button
            type="button"
            aria-label={`${open ? "Close" : "Open"} ${ariaLabel} suggestions`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleSuggestions}
            className="grid size-7 shrink-0 place-items-center rounded-full text-[#59645d] transition hover:bg-[#eef3ef]"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </div>
      {open && !disabled && (searching || filteredSuggestions.length > 0) ? (
        <div
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[250px] touch-pan-y overflow-y-auto overscroll-contain rounded-[16px] border border-[#dce3dc] bg-white p-1.5 [scrollbar-gutter:stable] shadow-[0_18px_44px_rgba(17,33,23,0.13)]"
        >
          {searching ? (
            <p className="px-3 py-5 text-center text-[12px] text-[#7b857e]">
              Loading suggestions...
            </p>
          ) : (
            filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion.toLocaleLowerCase("en")}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(suggestion)}
                className="block w-full rounded-[11px] px-3 py-2 text-left text-[13px] text-[#2d372f] hover:bg-[#f2f6f2]"
              >
                {suggestion}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentTextarea({
  projectId,
  field,
  ariaLabel,
  placeholder,
  value,
  attachments,
  disabled,
  error,
  onValueChange,
  onAttachmentsChange,
}: {
  projectId: string;
  field: ProjectInquiryAttachmentField;
  ariaLabel: string;
  placeholder: string;
  value: string;
  attachments: ProjectInquiryAttachmentRecord[];
  disabled: boolean;
  error?: string;
  onValueChange: (value: string) => void;
  onAttachmentsChange: (files: ProjectInquiryAttachmentRecord[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();

  async function uploadFile(file: File) {
    const requestResponse = await fetch("/api/project-assets/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        assetType: "GENERAL_PROJECT_ASSET",
      }),
    });
    const requestResult = (await requestResponse.json()) as {
      attachmentId?: string;
      uploadUrl?: string;
      uploadExpectedHeaders?: Record<string, string>;
      error?: string;
    };
    if (!requestResponse.ok || !requestResult.attachmentId || !requestResult.uploadUrl) {
      throw new Error(requestResult.error || `Unable to prepare ${file.name}.`);
    }

    try {
      const uploadResponse = await fetch(requestResult.uploadUrl, {
        method: "PUT",
        headers: requestResult.uploadExpectedHeaders ?? {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error(`Unable to upload ${file.name}.`);
    } catch (uploadFailure) {
      await fetch("/api/project-assets/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId: requestResult.attachmentId, failed: true }),
      }).catch(() => undefined);
      throw uploadFailure;
    }

    const completionResponse = await fetch("/api/project-assets/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId: requestResult.attachmentId }),
    });
    const completionResult = (await completionResponse.json()) as { error?: string };
    if (!completionResponse.ok) {
      throw new Error(completionResult.error || `Unable to finish ${file.name}.`);
    }

    return {
      id: requestResult.attachmentId,
      originalFileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
    } satisfies ProjectInquiryAttachmentRecord;
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length || disabled || uploading) return;
    setUploading(true);
    setUploadError(undefined);
    const uploaded: ProjectInquiryAttachmentRecord[] = [];
    try {
      for (const file of Array.from(files)) uploaded.push(await uploadFile(file));
      onAttachmentsChange([...attachments, ...uploaded]);
    } catch (uploadFailure) {
      if (uploaded.length) onAttachmentsChange([...attachments, ...uploaded]);
      const message =
        uploadFailure instanceof Error ? uploadFailure.message : "Unable to upload the file.";
      setUploadError(message);
      showErrorToast("Attachment upload failed.", message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="relative">
        <RichTextEditor
          ariaLabel={ariaLabel}
          value={value}
          disabled={disabled}
          onChange={onValueChange}
          placeholder={placeholder}
          error={error}
          minHeightClassName="min-h-[112px]"
          className="[&_.rich-text-prose]:pb-12 [&_.rich-text-prose]:pr-14"
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <button
          type="button"
          disabled={disabled || uploading}
          aria-label={`Attach a file to ${ariaLabel}`}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "absolute bottom-3 grid size-8 place-items-center rounded-full text-[#6f7b73] hover:bg-[#eef5ef] hover:text-brand disabled:opacity-50",
            "right-3",
          )}
        >
          {uploading ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <Paperclip className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>
      {attachments.length ? (
        <div className="mt-2 flex flex-wrap gap-2" data-attachment-field={field}>
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-2 rounded-[10px] border border-[#dfe6df] bg-[#f7f9f7] px-2.5 py-1.5 text-[11px] text-[#465149]"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-[#377253]" />
              <span className="max-w-[220px] truncate">{attachment.originalFileName}</span>
              <span className="text-[#8b948d]">{formatBytes(attachment.fileSize)}</span>
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${attachment.originalFileName}`}
                  onClick={() =>
                    onAttachmentsChange(
                      attachments.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {uploadError ? <p className="mt-1.5 text-[12px] text-[#b84e48]">{uploadError}</p> : null}
    </div>
  );
}

export function StageOneWorkspace({
  project,
  currentUserId,
  pageData,
  showChrome = true,
}: StageOneWorkspaceProps) {
  const router = useRouter();
  const saved = pageData.inquiry;
  const [mode, setMode] = useState<"edit" | "view">(
    pageData.canEdit ? "edit" : "view",
  );
  const [submitting, startSubmitting] = useTransition();
  const [partyOptions, setPartyOptions] = useState(() => {
    const options = [...pageData.partyOptions];
    for (const savedParty of [
      saved?.client,
      ...(saved?.finalBeneficiaries ?? []),
    ]) {
      if (
        savedParty &&
        !options.some(
          (option) => option.id === savedParty.id && option.source === savedParty.source,
        )
      ) {
        options.push(savedParty);
      }
    }
    return options;
  });
  const [client, setClient] = useState(saved?.client ?? null);
  const [finalBeneficiaries, setFinalBeneficiaries] = useState(
    saved?.finalBeneficiaries ?? [],
  );
  const [clientOrigin, setClientOrigin] = useState<"EXTERNAL" | "INTERNAL">(
    saved?.clientOrigin ?? "EXTERNAL",
  );
  const [targetMarkets, setTargetMarkets] = useState(
    saved?.targetMarkets.map((market) => market.label) ?? [],
  );
  const [targetMarketHistory, setTargetMarketHistory] = useState(
    pageData.targetMarketSuggestions.map((market) => market.label),
  );
  const [initialBrief, setInitialBrief] = useState(saved?.initialBrief ?? "");
  const [businessObjectives, setBusinessObjectives] = useState(
    saved?.businessObjectives ?? "",
  );
  const [deliverables, setDeliverables] = useState(saved?.deliverables ?? []);
  const [deliverableHistory, setDeliverableHistory] = useState(
    pageData.deliverableSuggestions,
  );
  const [inquiryDate, setInquiryDate] = useState(saved?.inquiryDate || getTodayDateValue());
  const [deadline, setDeadline] = useState(saved?.deadline ?? "");
  const [legalNotes, setLegalNotes] = useState(saved?.legalNotes ?? "");
  const [priority, setPriority] = useState<ProjectInquiryPriority | "">(
    saved?.priority ?? "",
  );
  const [attachments, setAttachments] = useState(() =>
    saved?.attachments ?? {
      INITIAL_BRIEF: [],
      BUSINESS_OBJECTIVES: [],
      LEGAL_NOTES: [],
    },
  );
  const [fieldErrors, setFieldErrors] = useState<ProjectInquiryFieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [contactTarget, setContactTarget] = useState<PartyField | null>(null);
  const [contactForm, setContactForm] = useState<ProjectContactForm>(getDefaultContactForm);
  const [contactErrors, setContactErrors] = useState<Partial<Record<keyof ProjectContactForm, string>>>({});
  const [contactError, setContactError] = useState<string>();
  const [contactSaving, setContactSaving] = useState(false);
  const draftInquiry = useMemo<ProjectInquiryRecord>(
    () => ({
      client,
      finalBeneficiaries,
      clientOrigin,
      targetMarkets: targetMarkets.map((label) => ({ label })),
      initialBrief,
      businessObjectives,
      deliverables,
      inquiryDate,
      deadline,
      legalNotes,
      priority: priority || null,
      attachments,
    }),
    [
      attachments,
      businessObjectives,
      client,
      clientOrigin,
      deadline,
      deliverables,
      finalBeneficiaries,
      initialBrief,
      inquiryDate,
      legalNotes,
      priority,
      targetMarkets,
    ],
  );
  const autosave = useProjectFormAutosave({
    projectId: project.id,
    formKey: "stage-one-project-inquiry",
    value: draftInquiry,
    enabled: pageData.canEdit,
    onRestore: (draft) => {
      setClient(draft.client ?? null);
      setFinalBeneficiaries(draft.finalBeneficiaries ?? []);
      setClientOrigin(draft.clientOrigin ?? "EXTERNAL");
      setTargetMarkets((draft.targetMarkets ?? []).map((market) => market.label));
      setInitialBrief(draft.initialBrief ?? "");
      setBusinessObjectives(draft.businessObjectives ?? "");
      setDeliverables(draft.deliverables ?? []);
      setInquiryDate(draft.inquiryDate || getTodayDateValue());
      setDeadline(draft.deadline ?? "");
      setLegalNotes(draft.legalNotes ?? "");
      setPriority(draft.priority ?? "");
      setAttachments(
        draft.attachments ?? {
          INITIAL_BRIEF: [],
          BUSINESS_OBJECTIVES: [],
          LEGAL_NOTES: [],
        },
      );
      setPartyOptions((current) => {
        const merged = new Map(
          current.map((option) => [`${option.source}:${option.id}`, option]),
        );
        for (const option of [draft.client, ...(draft.finalBeneficiaries ?? [])]) {
          if (option) merged.set(`${option.source}:${option.id}`, option);
        }
        return [...merged.values()];
      });
    },
  });
  const viewInquiry = pageData.canEdit ? draftInquiry : saved;
  const targetMarketSuggestions = useMemo(
    () =>
      Array.from(
        new Set([
          ...pageData.countryOptions,
          ...targetMarketHistory,
        ]),
      ),
    [pageData.countryOptions, targetMarketHistory],
  );
  const loadPartyOptions = useCallback(
    async (query: string) => {
      try {
        const options = await searchProjectInquiryPartyOptionsAction(
          project.id,
          query,
        );
        setPartyOptions((current) => {
          const merged = new Map(
            current.map((option) => [`${option.source}:${option.id}`, option]),
          );
          for (const option of options) {
            merged.set(`${option.source}:${option.id}`, option);
          }
          return [...merged.values()];
        });
      } catch {
        showErrorToast("Unable to load directory results.");
      }
    },
    [project.id],
  );
  const loadTargetMarketHistory = useCallback(
    async (query: string) => {
      try {
        const suggestions = await searchProjectInquiryHistorySuggestionsAction(
          project.id,
          "target-market",
          query,
        );
        setTargetMarketHistory(suggestions);
      } catch {
        showErrorToast("Unable to load target-market history.");
      }
    },
    [project.id],
  );
  const loadDeliverableHistory = useCallback(
    async (query: string) => {
      try {
        const suggestions = await searchProjectInquiryHistorySuggestionsAction(
          project.id,
          "deliverable",
          query,
        );
        setDeliverableHistory(suggestions);
      } catch {
        showErrorToast("Unable to load deliverable history.");
      }
    },
    [project.id],
  );

  function clearFieldError(field: keyof ProjectInquiryFieldErrors) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(undefined);
  }

  function openContactDialog(target: PartyField) {
    if (!pageData.canEdit) return;
    setContactTarget(target);
    setContactForm(getDefaultContactForm(target === "client" ? "COMPANY" : "PERSON"));
    setContactErrors({});
    setContactError(undefined);
  }

  async function handleCreateContact() {
    if (!contactTarget) return;
    const validation = validateProjectContactInput({ ...contactForm, kind: contactTarget === "client" ? "CLIENT" : "CONTACT" });

    if (Object.keys(validation.fieldErrors).length > 0) {
      setContactErrors(validation.fieldErrors);
      setContactError("Review the highlighted details.");
      return;
    }

    setContactSaving(true);
    setContactError(undefined);
    setContactErrors({});
    try {
      const result = await createContactDirectoryEntryAction(project.id, validation.data);
      if ("error" in result) {
        setContactError(result.error);
        setContactErrors(result.fieldErrors ?? {});
        return;
      }
      setPartyOptions((current) => [...current, result.contact]);
      if (contactTarget === "client") {
        setClient(result.contact);
        clearFieldError("client");
      } else {
        setFinalBeneficiaries((current) => [...current, result.contact]);
        clearFieldError("finalBeneficiaries");
      }
      setContactTarget(null);
      showSuccessToast(
        contactTarget === "client"
          ? "Client added."
          : "Beneficiary added.",
      );
    } catch {
      setContactError(
        `Unable to add the ${contactTarget === "client" ? "client" : "beneficiary"} right now. Please try again.`,
      );
    } finally {
      setContactSaving(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stageTwoHref = `/projects/${project.id}/stages/2`;
    if (!pageData.canEdit || submitting) return;
    const nextErrors: ProjectInquiryFieldErrors = {};
    if (!client) nextErrors.client = "Select a client.";
    if (finalBeneficiaries.length === 0) {
      nextErrors.finalBeneficiaries = "Select at least one final beneficiary.";
    }
    setFieldErrors(nextErrors);
    setFormError(undefined);
    if (Object.keys(nextErrors).length) {
      showErrorToast("Review the highlighted fields.");
      return;
    }

    const input: CompleteProjectInquiryInput = {
      projectId: project.id,
      client: client ? { source: client.source, id: client.id } : null,
      finalBeneficiaries: finalBeneficiaries.map((beneficiary) => ({
        source: beneficiary.source,
        id: beneficiary.id,
      })),
      clientOrigin,
      targetMarkets: targetMarkets.map((label) => ({ label })),
      initialBrief,
      businessObjectives,
      deliverables,
      inquiryDate,
      deadline,
      legalNotes,
      priority: priority || null,
      attachmentIds: {
        INITIAL_BRIEF: attachments.INITIAL_BRIEF.map((attachment) => attachment.id),
        BUSINESS_OBJECTIVES: attachments.BUSINESS_OBJECTIVES.map((attachment) => attachment.id),
        LEGAL_NOTES: attachments.LEGAL_NOTES.map((attachment) => attachment.id),
      },
    };

    startSubmitting(async () => {
      const result = await completeProjectInquiryAction(input);
      if ("error" in result) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        showErrorToast(
          pageData.workflowStatus === "COMPLETED"
            ? "Unable to update Project Inquiry."
            : "Unable to complete Project Inquiry.",
          result.error,
        );
        return;
      }
      await autosave.clearDraft().catch(() => undefined);
      if (result.alreadyCompleted) {
        showSuccessToast("Project Inquiry updated.");
        setMode("view");
        router.refresh();
        return;
      }
      showSuccessToast("Project Inquiry completed.", "Stage 2 is now available.");
      router.push(stageTwoHref);
      router.refresh();
    });
  }

  const readOnly = !pageData.canEdit;

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      {showChrome ? (
        <ProjectAccessRealtimeGuard projectId={project.id} currentUserId={currentUserId} />
      ) : null}

      {showChrome ? (
        <div className="flex items-center gap-2 text-[12px] font-[750] uppercase tracking-[0.12em] text-[#4d765d]">
          <FileText className="h-4 w-4" />
          Project Inquiry
        </div>
      ) : null}
      <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center", showChrome ? "mt-3 sm:justify-between" : "mt-5 sm:justify-end")}>
        {showChrome ? (
          <h1 className="text-[30px] font-[780] tracking-[-0.04em] text-[#111713] sm:text-[36px]">
            Stage 1 - Project Inquiry
          </h1>
        ) : null}
        <div
          role="tablist"
          aria-label="Project Inquiry presentation mode"
          className="inline-grid w-fit grid-cols-2 rounded-[12px] border border-[#dce4dd] bg-white p-1 shadow-[0_8px_20px_rgba(23,39,28,0.04)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            aria-controls="stage-one-edit-panel"
            disabled={!pageData.canEdit}
            onClick={() => setMode("edit")}
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
            aria-controls="stage-one-view-panel"
            onClick={() => setMode("view")}
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
      {showChrome ? (
        <ProjectFlowSummaryStrip project={project} className="mt-5" />
      ) : null}

      {mode === "view" ? (
        <StageOneReadOnlyView
          projectId={project.id}
          inquiry={viewInquiry}
          canEdit={pageData.canEdit}
        />
      ) : (
        <Card
          id="stage-one-edit-panel"
          role="tabpanel"
          aria-label="Edit Project Inquiry"
          className="mt-6 rounded-[22px] border-[#dde5de] shadow-[0_18px_44px_rgba(23,39,28,0.055)]"
        >
        <CardContent className="px-5 py-6 sm:px-7 sm:py-7 lg:px-8">
          {!pageData.canEdit ? (
            <div className="mb-6 rounded-[15px] border border-[#dce4dd] bg-[#f4f7f4] px-4 py-3 text-[13px] text-[#536057]">
              You can view this inquiry, but you do not have permission to change it.
            </div>
          ) : null}
          {formError ? (
            <div className="mb-6 rounded-[15px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#ae4742]">
              {formError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
              <StageOneFormField label="Client" required error={fieldErrors.client}>
                <PartySelector
                  ariaLabel="Client"
                  companyFirst
                  showPersonName
                  placeholder="Search or select a person or company"
                  options={partyOptions}
                  values={client ? [client] : []}
                  disabled={readOnly || submitting}
                  error={fieldErrors.client}
                  onSearch={loadPartyOptions}
                  onChange={(values) => {
                    setClient(values[0] ?? null);
                    clearFieldError("client");
                  }}
                />
                {!readOnly ? (
                  <button type="button" onClick={() => openContactDialog("client")} className="-ml-1 mt-1.5 cursor-pointer rounded-[6px] px-1 py-0.5 text-[12px] font-[650] text-[#2d7b51] transition-colors hover:bg-[#eaf4ed] hover:text-[#185d3a] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8057] focus-visible:ring-offset-2">
                    Add manually
                  </button>
                ) : null}
              </StageOneFormField>

              <StageOneFormField label="External / Internal - for execution" error={fieldErrors.clientOrigin}>
                <div role="group" aria-label="External or internal project" className="grid h-12 grid-cols-2 overflow-hidden rounded-[14px] border border-[#dce3dc] bg-white p-1">
                  {(["EXTERNAL", "INTERNAL"] as const).map((option) => {
                    const selected = clientOrigin === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={readOnly || submitting}
                        aria-pressed={selected}
                        onClick={() => {
                          setClientOrigin(option);
                          clearFieldError("clientOrigin");
                        }}
                        className={cn(
                          "rounded-[10px] text-[13px] font-[680] capitalize transition disabled:cursor-not-allowed",
                          selected
                            ? "bg-[linear-gradient(90deg,#2f8d5d,#1a6341)] text-white shadow-[0_8px_18px_rgba(35,113,73,0.16)]"
                            : "text-[#5e6961] hover:bg-[#f3f7f3]",
                        )}
                      >
                        {option.toLocaleLowerCase("en")}
                      </button>
                    );
                  })}
                </div>
              </StageOneFormField>

              <StageOneFormField
                label="Final Beneficiaries"
                required
                error={fieldErrors.finalBeneficiaries}
              >
                <PartySelector
                  ariaLabel="Final beneficiaries"
                  placeholder="Search or select beneficiaries"
                  options={partyOptions}
                  values={finalBeneficiaries}
                  multiple
                  disabled={readOnly || submitting}
                  error={fieldErrors.finalBeneficiaries}
                  onSearch={loadPartyOptions}
                  onChange={(values) => {
                    setFinalBeneficiaries(values);
                    clearFieldError("finalBeneficiaries");
                  }}
                />
                {!readOnly ? (
                  <button type="button" onClick={() => openContactDialog("finalBeneficiary")} className="-ml-1 mt-1.5 cursor-pointer rounded-[6px] px-1 py-0.5 text-[12px] font-[650] text-[#2d7b51] transition-colors hover:bg-[#eaf4ed] hover:text-[#185d3a] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8057] focus-visible:ring-offset-2">
                    Add manually
                  </button>
                ) : null}
              </StageOneFormField>

              <StageOneFormField label="Target Market" error={fieldErrors.targetMarkets}>
                <MultiEntryInput
                  ariaLabel="Add target market"
                  values={targetMarkets}
                  suggestions={targetMarketSuggestions}
                  placeholder="Countries or regions"
                  disabled={readOnly || submitting}
                  error={fieldErrors.targetMarkets}
                  onSearchSuggestions={loadTargetMarketHistory}
                  onChange={(values) => {
                    setTargetMarkets(values);
                    clearFieldError("targetMarkets");
                  }}
                />
                {!readOnly ? <p className="mt-2 text-[11px] text-[#718078]">Choose a country or type a custom region.</p> : null}
              </StageOneFormField>

              <StageOneFormField label="Initial Brief" error={fieldErrors.initialBrief || fieldErrors.attachments}>
                <AttachmentTextarea
                  projectId={project.id}
                  field={attachmentFields.initialBrief}
                  ariaLabel="Initial brief"
                  placeholder="Provide an overview or background of the project"
                  value={initialBrief}
                  attachments={attachments.INITIAL_BRIEF}
                  disabled={readOnly || submitting}
                  error={fieldErrors.initialBrief || fieldErrors.attachments}
                  onValueChange={(value) => {
                    setInitialBrief(value);
                    clearFieldError("initialBrief");
                  }}
                  onAttachmentsChange={(files) => setAttachments((current) => ({ ...current, INITIAL_BRIEF: files }))}
                />
              </StageOneFormField>

              <StageOneFormField label="Key Business Objectives" error={fieldErrors.businessObjectives || fieldErrors.attachments}>
                <AttachmentTextarea
                  projectId={project.id}
                  field={attachmentFields.businessObjectives}
                  ariaLabel="Key business objectives"
                  placeholder="Outline the key goals and objectives of this project"
                  value={businessObjectives}
                  attachments={attachments.BUSINESS_OBJECTIVES}
                  disabled={readOnly || submitting}
                  error={fieldErrors.businessObjectives || fieldErrors.attachments}
                  onValueChange={(value) => {
                    setBusinessObjectives(value);
                    clearFieldError("businessObjectives");
                  }}
                  onAttachmentsChange={(files) => setAttachments((current) => ({ ...current, BUSINESS_OBJECTIVES: files }))}
                />
              </StageOneFormField>

              <StageOneFormField label="Deliverables" error={fieldErrors.deliverables}>
                <MultiEntryInput
                  ariaLabel="Add deliverable"
                  values={deliverables}
                  suggestions={deliverableHistory}
                  placeholder="Add deliverables"
                  disabled={readOnly || submitting}
                  error={fieldErrors.deliverables}
                  onSearchSuggestions={loadDeliverableHistory}
                  onChange={(values) => {
                    setDeliverables(values);
                    clearFieldError("deliverables");
                  }}
                />
                {!readOnly ? (
                  <p className="mt-2 text-[11px] text-[#718078]">
                    Select a previous value, or type a new deliverable and press Enter to add it.
                  </p>
                ) : null}
              </StageOneFormField>

              <StageOneFormField label="Date" error={fieldErrors.inquiryDate}>
                <AppDatePicker value={inquiryDate} onChange={(value) => { setInquiryDate(value); clearFieldError("inquiryDate"); }} disabled={readOnly || submitting} placeholder="Select date" triggerClassName="h-12 w-full justify-between rounded-[14px] border border-[#dce3dc] bg-white px-4 text-left text-[13px] font-normal text-[#263029] shadow-none hover:bg-white" />
              </StageOneFormField>

              <StageOneFormField label="Deadline" error={fieldErrors.deadline}>
                <AppDatePicker value={deadline} onChange={(value) => { setDeadline(value); clearFieldError("deadline"); }} disabled={readOnly || submitting} placeholder="Select deadline" triggerClassName="h-12 w-full justify-between rounded-[14px] border border-[#dce3dc] bg-white px-4 text-left text-[13px] font-normal text-[#263029] shadow-none hover:bg-white" />
              </StageOneFormField>

              <StageOneFormField
                label="Legal Notes"
                error={fieldErrors.legalNotes || fieldErrors.attachments}
                className="lg:row-span-2"
              >
                <AttachmentTextarea
                  projectId={project.id}
                  field={attachmentFields.legalNotes}
                  ariaLabel="Legal notes"
                  placeholder="Add any legal requirements or special considerations"
                  value={legalNotes}
                  attachments={attachments.LEGAL_NOTES}
                  disabled={readOnly || submitting}
                  error={fieldErrors.legalNotes || fieldErrors.attachments}
                  onValueChange={(value) => { setLegalNotes(value); clearFieldError("legalNotes"); }}
                  onAttachmentsChange={(files) => setAttachments((current) => ({ ...current, LEGAL_NOTES: files }))}
                />
              </StageOneFormField>

              <StageOneFormField label="Priority" error={fieldErrors.priority}>
                <Select disabled={readOnly || submitting} value={priority} onValueChange={(value) => { setPriority(value as ProjectInquiryPriority); clearFieldError("priority"); }}>
                  <SelectTrigger className="h-12 rounded-[14px] border-[#dce3dc] bg-white px-4 shadow-none">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                  </SelectContent>
                </Select>
              </StageOneFormField>
            </div>

            <div className="mt-8 flex flex-col gap-3 border-t border-[#edf1ed] pt-6 sm:flex-row sm:items-center">
              {pageData.canEdit ? (
                <Button type="submit" disabled={submitting} className="min-w-[170px] rounded-[13px]">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {submitting
                    ? pageData.workflowStatus === "COMPLETED"
                      ? "Saving..."
                      : "Completing..."
                    : pageData.workflowStatus === "COMPLETED"
                      ? "Save Changes"
                      : "Next Stage"}
                  {!submitting && pageData.workflowStatus !== "COMPLETED" ? (
                    <ArrowRight className="h-4 w-4" />
                  ) : null}
                </Button>
              ) : null}
              {pageData.workflowStatus === "COMPLETED" ? (
                <Button asChild type="button" variant="secondary" className="min-w-[170px] rounded-[13px] shadow-none">
                  <Link href={`/projects/${project.id}/stages/2`}>
                    Next Stage
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
              <Button asChild type="button" variant="outline" className="min-w-[150px] rounded-[13px] shadow-none">
                <Link href={`/projects/${project.id}`}>
                  <ListChecks className="h-4 w-4" />
                  All Stages
                </Link>
              </Button>
              {pageData.canEdit ? (
                <ProjectFormAutosaveStatus
                  status={autosave.status}
                  savedAt={autosave.savedAt}
                  restoredAt={autosave.restoredAt}
                  onRetry={() => void autosave.retry()}
                  className="sm:ml-auto"
                />
              ) : null}
            </div>
          </form>
        </CardContent>
        </Card>
      )}

      <ProjectContactDialog
        kind={contactTarget === "client" ? "CLIENT" : "CONTACT"}
        isOpen={contactTarget !== null}
        title={contactTarget === "client" ? "Add Client" : "Add Beneficiary"}
        description={
          contactTarget === "client"
            ? "Choose a person or company and enter the client details. This client will be available for future projects."
            : "Choose a person or company and enter the beneficiary details. This beneficiary will be available for future projects."
        }
        submitLabel={contactTarget === "client" ? "Add Client" : "Add Beneficiary"}
        form={contactForm}
        fieldErrors={contactErrors}
        error={contactError}
        saving={contactSaving}
        onClose={() => { if (!contactSaving) setContactTarget(null); }}
        onSubmit={() => void handleCreateContact()}
        onChange={(field, value) => {
          setContactForm((current) => ({ ...current, [field]: value }));
          setContactErrors((current) => field === "entityType" ? {} : { ...current, [field]: undefined });
          setContactError(undefined);
        }}
      />

    </section>
  );
}

export function StageOneLoadingShell() {
  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <Skeleton className="h-4 w-32 rounded-full" />
      <Skeleton className="mt-4 h-10 w-full max-w-[460px] rounded-[12px]" />
      <Skeleton className="mt-6 h-[96px] w-full rounded-[20px]" />
      <Card className="mt-6 rounded-[22px] border-[#dde5de] shadow-none">
        <CardContent className="grid gap-x-10 gap-y-6 px-5 py-6 sm:px-7 lg:grid-cols-2 lg:px-8">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index}>
              <Skeleton className="h-3.5 w-32 rounded-full" />
              <Skeleton className={cn("mt-2 w-full rounded-[14px]", index === 4 || index === 5 || index === 10 ? "h-[104px]" : "h-12")} />
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

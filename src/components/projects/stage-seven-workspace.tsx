"use client";
import { StageGuidance } from "./stage-guidance";
import Link from "next/link";
import { stageInstanceHref } from "@/lib/project-template-definitions";

import { FileThumbnail } from "@/components/projects/file-thumbnail";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  PhysicalSampleDecision,
  ProductionApprovalRecipientType,
  ProductionDispatchStatus,
  ProductionHandoverRoute,
  ProductionSampleRoundStatus,
  ProductionSampleRoundType,
  ProductionSupervisionStatus,
} from "@prisma/client";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Download,
  FileStack,
  Info,
  Mail,
  PackageCheck,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import {
  closeStageSevenProjectAction,
  configureStageSevenSampleRequestReminderAction,
  createProductionSampleRoundAction,
  deleteProductionSampleRoundAction,
  decidePhysicalSampleRoundAction,
  markPhysicalSampleRoundReceivedAction,
  retryProductionSampleRequestEmailAction,
} from "@/app/(dashboard)/projects/[slug]/stages/7/actions";
import { AppDatePicker } from "@/components/calendar/app-date-picker";
import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import { ProjectStageSummary } from "@/components/projects/project-stage-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import {
  ProjectFormAutosaveStatus,
  useProjectFormAutosave,
} from "@/components/ui/project-form-autosave";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@/components/ui/rich-text-editor";
import {
  isValidProjectContactEmail,
  normalizeInternationalPhone,
} from "@/lib/project-contact-validation";
import type { ProjectStageShellRecord } from "@/lib/projects";
import type { StageSevenWorkspaceData } from "@/lib/stage-seven";
import { getPhysicalSampleRequestActionState } from "@/lib/stage-seven-sample-actions";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  REQUEST_REMINDER_INTERVAL_HOURS,
  formatRequestReminderInterval,
  type RequestReminderIntervalHours,
} from "@/lib/request-reminder-shared";

type Unit = StageSevenWorkspaceData["units"][number];
type Round = Unit["rounds"][number];

const ROUND_TYPE_LABELS: Record<ProductionSampleRoundType, string> = {
  PRE_PRODUCTION_SAMPLE: "Pre-Production Sample",
  PRODUCTION_SAMPLE: "Production Sample",
  FINAL_MASS_PRODUCTION_SIGN_OFF: "Final Mass-Production Sample",
  CUSTOM: "Custom",
};

const UNIT_STATUS_LABELS: Record<ProductionSupervisionStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_REVIEW: "Waiting for Sample",
  REVISIONS_NEEDED: "Rejected",
  SIGNED_OFF: "Accepted",
};

const UNIT_STATUS_STYLES: Record<ProductionSupervisionStatus, string> = {
  NOT_STARTED: "border-[#dfe5df] bg-[#f5f7f5] text-[#68736b]",
  IN_REVIEW: "border-[#d6e3f3] bg-[#eef5ff] text-[#456e9f]",
  REVISIONS_NEEDED: "border-[#f2cbc6] bg-[#fff0ee] text-[#b44338]",
  SIGNED_OFF: "border-[#cde3d3] bg-[#e9f6ed] text-[#257049]",
};

const EMAIL_STATUS_LABELS: Record<ProductionDispatchStatus, string> = {
  NOT_SENT: "Not Sent",
  PENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function overdueLabel(deadline: string) {
  const due = new Date(deadline);
  const now = new Date();
  const current = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(1, Math.floor((current - due.getTime()) / 86_400_000));
  return `Overdue by ${days} ${days === 1 ? "day" : "days"}`;
}

function UnitStatusBadge({ status }: { status: ProductionSupervisionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit rounded-full border px-2.5 py-1 text-[9px] font-[780] tracking-[0.03em]",
        UNIT_STATUS_STYLES[status],
      )}
    >
      {UNIT_STATUS_LABELS[status]}
    </span>
  );
}

function ReceiptStatusBadge({ round }: { round: Round }) {
  return round.status !== ProductionSampleRoundStatus.PENDING ? (
    <Badge className="whitespace-nowrap border-[#cde3d3] bg-[#e9f6ed] text-[#257049]">Received</Badge>
  ) : (
    <Badge className="whitespace-nowrap border-[#dfe5df] bg-[#f5f7f5] text-[#68736b]">Not Received</Badge>
  );
}

function DecisionBadge({ decision }: { decision: PhysicalSampleDecision }) {
  return decision === PhysicalSampleDecision.ACCEPTED ? (
    <Badge className="border-[#cde3d3] bg-[#e9f6ed] text-[#257049]">Accepted</Badge>
  ) : (
    <Badge className="border-[#f2cbc6] bg-[#fff0ee] text-[#b44338]">Rejected</Badge>
  );
}

function ModalShell({
  title,
  eyebrow,
  children,
  footer,
  onClose,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center overflow-hidden bg-[#112118]/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <Card className="flex h-[calc(100dvh-1.5rem)] max-h-[900px] w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border-[#dfe6df] shadow-[0_32px_80px_rgba(14,31,20,.22)] sm:h-[calc(100dvh-3rem)] sm:rounded-[28px]">
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="flex shrink-0 items-start justify-between gap-5 border-b border-[#e4eae5] px-5 py-5 sm:px-8 sm:py-7">
            <div>
              <p className="text-[10px] font-[760] uppercase tracking-[.12em] text-[#4c795e]">{eyebrow}</p>
              <h2 className="mt-2 text-[22px] font-[760] text-[#162019]">{title}</h2>
              <p className="mt-2 max-w-[520px] text-[11px] leading-5 text-[#748078]">Sending this request emails the selected provider to prepare and courier a physical production sample.</p>
            </div>
            <Button type="button" variant="secondary" size="icon" onClick={onClose} aria-label="Close dialog">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="dashboard-scroll-thin min-h-0 min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-6 [scrollbar-gutter:stable] sm:px-8 sm:py-8">
            {children}
          </div>
          {footer ? (
            <div className="relative z-10 shrink-0 border-t border-[#e4eae5] bg-[#fbfcfb] px-4 py-4 shadow-[0_-12px_30px_rgba(23,39,28,0.045)] sm:px-8 sm:py-5">
              {footer}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function NewSampleRequestDialog({
  projectId,
  unit,
  participants,
  onClose,
  onCreated,
}: {
  projectId: string;
  unit: Unit;
  participants: StageSevenWorkspaceData["participants"];
  onClose: () => void;
  onCreated: (roundId: string) => void;
}) {
  const [pending, startPending] = useTransition();
  const requestId = useRef(crypto.randomUUID());
  const previous = unit.rounds.at(-1);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProductionSampleRoundType>(
    ProductionSampleRoundType.PRE_PRODUCTION_SAMPLE,
  );
  const [customTypeName, setCustomTypeName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [recipientRoute, setRecipientRoute] = useState<ProductionHandoverRoute>(
    previous?.recipientRoute ?? ProductionHandoverRoute.PURCHASE_DEPARTMENT,
  );
  const [recipientUserId, setRecipientUserId] = useState(
    previous?.recipientUserId ?? "",
  );
  const [recipientCompany, setRecipientCompany] = useState(
    previous?.recipientCompany ?? "",
  );
  const [recipientName, setRecipientName] = useState(previous?.recipientName ?? "");
  const [recipientEmail, setRecipientEmail] = useState(previous?.recipientEmail ?? "");
  const [recipientPhone, setRecipientPhone] = useState(previous?.recipientPhone ?? "");
  const [requestNote, setRequestNote] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderIntervalHours, setReminderIntervalHours] =
    useState<RequestReminderIntervalHours>(24);
  const autosave = useProjectFormAutosave({
    projectId,
    formKey: `stage-seven-sample-request:${unit.id}`,
    value: {
      name,
      type,
      customTypeName,
      deadline,
      recipientRoute,
      recipientUserId,
      recipientCompany,
      recipientName,
      recipientEmail,
      recipientPhone,
      requestNote,
      reminderEnabled,
      reminderIntervalHours,
    },
    onRestore: (draft) => {
      setName(draft.name);
      setType(draft.type);
      setCustomTypeName(draft.customTypeName);
      setDeadline(draft.deadline);
      setRecipientRoute(draft.recipientRoute);
      setRecipientUserId(draft.recipientUserId);
      setRecipientCompany(draft.recipientCompany);
      setRecipientName(draft.recipientName);
      setRecipientEmail(draft.recipientEmail);
      setRecipientPhone(draft.recipientPhone);
      setRequestNote(draft.requestNote);
      setReminderEnabled(draft.reminderEnabled ?? false);
      setReminderIntervalHours(
        REQUEST_REMINDER_INTERVAL_HOURS.includes(draft.reminderIntervalHours)
          ? draft.reminderIntervalHours
          : 24,
      );
    },
  });
  const isInternal = recipientRoute === ProductionHandoverRoute.PURCHASE_DEPARTMENT;
  const recipientEmailIsValid = isValidProjectContactEmail(recipientEmail);
  const normalizedRecipientPhone = normalizeInternationalPhone(recipientPhone);
  const recipientReady = isInternal
    ? Boolean(recipientUserId)
    : Boolean(
        recipientCompany.trim() &&
          recipientName.trim() &&
          recipientEmailIsValid &&
          normalizedRecipientPhone,
      );
  const ready = Boolean(
    name.trim() &&
      deadline &&
      recipientReady &&
      (type !== ProductionSampleRoundType.CUSTOM || customTypeName.trim()),
  );
  const closeWithAutosave = () => {
    void autosave.flush().finally(onClose);
  };

  function sendRequest() {
    if (!ready || pending) return;
    startPending(async () => {
      const result = await createProductionSampleRoundAction({
        projectId,
        productionUnitId: unit.id,
        clientRequestId: requestId.current,
        name,
        type,
        customTypeName,
        deadline,
        recipientRoute,
        recipientType: isInternal
          ? ProductionApprovalRecipientType.EXISTING_COLLABORATOR
          : ProductionApprovalRecipientType.EXTERNAL_EMAIL,
        ...(isInternal
          ? { recipientUserId }
          : {
              recipientCompany,
              recipientName,
              recipientEmail,
              recipientPhone,
            }),
        requestNote,
        reminderIntervalHours: reminderEnabled
          ? reminderIntervalHours
          : null,
      });
      if ("error" in result) {
        showErrorToast("Unable to send the physical sample request.", result.error);
        return;
      }
      if (result.emailStatus === ProductionDispatchStatus.SENT) {
        showSuccessToast("Physical sample request sent.");
      } else {
        showErrorToast(
          "Sample request saved, but the email failed.",
          result.emailError || "Open the request and retry the email.",
        );
      }
      await autosave.clearDraft().catch(() => undefined);
      onCreated(result.id);
      onClose();
    });
  }

  return (
    <ModalShell
      title="Request Physical Sample"
      eyebrow={unit.name}
      onClose={closeWithAutosave}
      footer={(
        <div className="flex w-full flex-col-reverse gap-4 sm:flex-row sm:items-center">
          <Button type="button" variant="secondary" disabled={pending} onClick={closeWithAutosave} className="min-h-11 w-full rounded-[12px] px-5 sm:w-auto">Cancel</Button>
          <ProjectFormAutosaveStatus status={autosave.status} savedAt={autosave.savedAt} restoredAt={autosave.restoredAt} onRetry={() => void autosave.retry()} className="w-full sm:mr-auto sm:w-auto" />
          <Button type="button" disabled={!ready || pending} onClick={sendRequest} className="min-h-11 w-full rounded-[12px] px-5 sm:w-auto"><Send className="h-4 w-4" /> {pending ? "Sending..." : "Send Sample Request"}</Button>
        </div>
      )}
    >
      <div className="grid min-w-0 gap-6 sm:gap-7">
        <section
          aria-labelledby="sample-details-heading"
          className="rounded-[18px] border border-[#dfe7e0] bg-white p-5 shadow-[0_8px_22px_rgba(23,39,28,0.025)] sm:p-6"
        >
          <div className="mb-5 border-b border-[#edf1ed] pb-4">
            <h3 id="sample-details-heading" className="text-[13px] font-[760] text-[#253028]">
              Sample details
            </h3>
            <p className="mt-1 text-[10px] leading-4 text-[#748078]">
              Name the sample round, choose its type, and set the delivery deadline.
            </p>
          </div>
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <label className="space-y-2 sm:col-span-2">
              <span className="text-[12px] font-[720] text-[#2d372f]">Round Name *</span>
              <Input value={name} maxLength={160} autoFocus placeholder="First Physical Packaging Sample" className="rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] shadow-none focus-visible:border-[#46906a] focus-visible:ring-[#46906a]/15" onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="space-y-2">
              <span className="text-[12px] font-[720] text-[#2d372f]">Sample Type *</span>
              <Select value={type} onValueChange={(value) => setType(value as ProductionSampleRoundType)}>
                <SelectTrigger className="h-11 rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] focus:border-[#46906a] focus:ring-[#46906a]/15"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[190]">
                  {Object.values(ProductionSampleRoundType).map((value) => <SelectItem key={value} value={value}>{ROUND_TYPE_LABELS[value]}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2">
              <span className="text-[12px] font-[720] text-[#2d372f]">Deadline *</span>
              <AppDatePicker value={deadline} onChange={setDeadline} required clearable={false} placeholder="Select deadline" popoverZIndex={200} triggerClassName="h-11 w-full justify-between rounded-[12px] border border-[#c8d5cb] bg-[#fbfdfb] px-4 text-left text-[14px] font-normal text-[#18211a] shadow-none hover:bg-white focus-visible:border-[#46906a] focus-visible:ring-3 focus-visible:ring-[#46906a]/15" />
            </label>
            {type === ProductionSampleRoundType.CUSTOM ? (
              <label className="space-y-2 sm:col-span-2">
                <span className="text-[12px] font-[720] text-[#2d372f]">Custom Sample Type *</span>
                <Input value={customTypeName} maxLength={120} placeholder="Enter custom sample type" className="rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] shadow-none focus-visible:border-[#46906a] focus-visible:ring-[#46906a]/15" onChange={(event) => setCustomTypeName(event.target.value)} />
              </label>
            ) : null}
          </div>
        </section>
        <section
          aria-labelledby="sample-provider-heading"
          className="space-y-5 rounded-[18px] border border-[#dfe7e0] bg-[#fafcfa] p-5 sm:p-6"
        >
          <div className="border-b border-[#e6ece7] pb-4">
            <h3 id="sample-provider-heading" className="text-[13px] font-[760] text-[#253028]">
              Sample provider
            </h3>
            <p className="mt-1 text-[10px] leading-4 text-[#748078]">
              Choose the assigned internal reviewer or enter the external supplier details.
            </p>
          </div>
          <div>
            <span className="text-[12px] font-[720] text-[#2d372f]">Who will provide this sample? *</span>
            <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setRecipientRoute(ProductionHandoverRoute.PURCHASE_DEPARTMENT)} className={cn("min-w-0 rounded-[14px] border p-4 text-left", isInternal ? "border-[#72a184] bg-[#f1f8f3]" : "border-[#dfe6df]")}><strong className="block text-[12px] font-[740]">Internal</strong><span className="mt-1 block text-[10px] leading-4 text-[#6f7a72]">Select an existing project participant, such as Purchasing.</span></button>
              <button type="button" onClick={() => setRecipientRoute(ProductionHandoverRoute.DIRECT_VENDOR)} className={cn("min-w-0 rounded-[14px] border p-4 text-left", !isInternal ? "border-[#72a184] bg-[#f1f8f3]" : "border-[#dfe6df]")}><strong className="block text-[12px] font-[740]">External</strong><span className="mt-1 block text-[10px] leading-4 text-[#6f7a72]">Send the request to a vendor or other external company.</span></button>
            </div>
          </div>
          {isInternal ? (
            <label className="space-y-2">
              <span className="text-[12px] font-[720] text-[#2d372f]">Internal Provider *</span>
              <Select value={recipientUserId} onValueChange={setRecipientUserId}>
                <SelectTrigger className="h-11 rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] focus:border-[#46906a] focus:ring-[#46906a]/15"><SelectValue placeholder="Select internal provider" /></SelectTrigger>
                <SelectContent className="z-[190]">{participants.map((participant) => <SelectItem key={participant.id} value={participant.id}>{participant.name} — {participant.role}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          ) : (
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <label className="min-w-0 space-y-2"><span className="text-[12px] font-[720] text-[#2d372f]">Company Name *</span><Input value={recipientCompany} maxLength={160} placeholder="Enter company name" className="rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] shadow-none focus-visible:border-[#46906a] focus-visible:ring-[#46906a]/15" onChange={(event) => setRecipientCompany(event.target.value)} /></label>
              <label className="min-w-0 space-y-2"><span className="text-[12px] font-[720] text-[#2d372f]">Contact Name *</span><Input value={recipientName} maxLength={160} placeholder="Enter contact name" className="rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] shadow-none focus-visible:border-[#46906a] focus-visible:ring-[#46906a]/15" onChange={(event) => setRecipientName(event.target.value)} /></label>
              <label className="min-w-0 space-y-2"><span className="text-[12px] font-[720] text-[#2d372f]">Email *</span><Input type="email" value={recipientEmail} maxLength={320} placeholder="contact@company.com" aria-invalid={Boolean(recipientEmail) && !recipientEmailIsValid} className="rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] shadow-none focus-visible:border-[#46906a] focus-visible:ring-[#46906a]/15" onChange={(event) => setRecipientEmail(event.target.value)} />{recipientEmail && !recipientEmailIsValid ? <span className="block text-[9px] font-[600] text-[#b84e48]">Enter a valid email address.</span> : null}</label>
              <label className="min-w-0 space-y-2"><span className="text-[12px] font-[720] text-[#2d372f]">Phone *</span><Input type="tel" value={recipientPhone} maxLength={50} placeholder="e.g. +971 50 123 4567" aria-invalid={Boolean(recipientPhone) && !normalizedRecipientPhone} className="rounded-[12px] border-[#c8d5cb] bg-[#fbfdfb] shadow-none focus-visible:border-[#46906a] focus-visible:ring-[#46906a]/15" onChange={(event) => setRecipientPhone(event.target.value)} />{recipientPhone && !normalizedRecipientPhone ? <span className="block text-[9px] font-[600] text-[#b84e48]">Enter an international number including country code.</span> : <span className="block text-[9px] text-[#77827a]">Include the international country code; the + is optional.</span>}</label>
            </div>
          )}
        </section>
        <section
          aria-labelledby="sample-instructions-heading"
          className="rounded-[18px] border border-[#dfe7e0] bg-white p-5 sm:p-6"
        >
          <div className="mb-4">
            <h3 id="sample-instructions-heading" className="text-[13px] font-[760] text-[#253028]">
              Request instructions
            </h3>
            <p className="mt-1 text-[10px] leading-4 text-[#748078]">
              Add any production, packaging, or courier guidance for the recipient.
            </p>
          </div>
          <p className="mb-2 text-[11px] font-[700] text-[#455148]">Request note</p>
          <RichTextEditor value={requestNote} maxLength={8000} minHeightClassName="min-h-[110px]" ariaLabel="Request note" placeholder="Please produce and courier one physical sample using the approved packaging artwork. Please ensure it reaches GTI before the deadline." onChange={setRequestNote} />
        </section>
        <section
          aria-labelledby="sample-reminder-heading"
          className="rounded-[18px] border border-[#d6e4d9] bg-[#f4f9f5] p-5 sm:p-6"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
              <h3 id="sample-reminder-heading" className="text-[13px] font-[760] text-[#253028]">Reminder</h3>
              <p className="mt-1.5 max-w-[470px] text-[10px] leading-4 text-[#66736a]">Repeat the notification while this sample round remains unresolved.</p>
            </div>
            <button type="button" role="switch" aria-checked={reminderEnabled} className={cn("relative h-7 w-12 shrink-0 rounded-full transition", reminderEnabled ? "bg-[#2f8057]" : "bg-[#cdd6cf]")} onClick={() => setReminderEnabled((value) => !value)}>
              <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow-sm transition", reminderEnabled ? "left-6" : "left-1")} />
              <span className="sr-only">Enable recurring reminder</span>
            </button>
          </div>
          {reminderEnabled ? (
            <label className="mt-5 block space-y-2 border-t border-[#dce7de] pt-5">
              <span className="text-[11px] font-[700] text-[#455148]">Reminder interval</span>
              <Select value={String(reminderIntervalHours)} onValueChange={(value) => setReminderIntervalHours(Number(value) as RequestReminderIntervalHours)}>
                <SelectTrigger className="h-11 rounded-[12px] border-[#c8d5cb] bg-white"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[190]">
                  {REQUEST_REMINDER_INTERVAL_HOURS.map((hours) => <SelectItem key={hours} value={String(hours)}>{formatRequestReminderInterval(hours)}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          ) : null}
        </section>
      </div>
    </ModalShell>
  );
}

function ProductionUnitSwitcher({
  units,
  selectedUnitId,
  onSelect,
}: {
  units: Unit[];
  selectedUnitId: string;
  onSelect: (unitId: string) => void;
}) {
  return (
    <section aria-labelledby="stage-seven-units-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="stage-seven-units-heading" className="text-[11px] font-[780] uppercase tracking-[0.11em] text-[#657168]">Production Units</h2>
        <Info className="h-3.5 w-3.5 text-[#96a098]" aria-label="Each Production Unit is supervised independently." />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {units.map((unit) => {
          const selected = unit.id === selectedUnitId;
          return (
            <button key={unit.id} type="button" aria-pressed={selected} className={cn("flex min-w-[220px] items-center gap-3 rounded-[16px] border bg-white p-3 text-left shadow-[0_8px_22px_rgba(23,39,28,0.035)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4b9068]/40 lg:min-w-0", selected ? "border-[#70a383] bg-[#f3faf5] shadow-[0_12px_26px_rgba(42,112,73,0.09)]" : "border-[#dfe6df] hover:border-[#b7cbbd] hover:bg-[#fbfdfb]")} onClick={() => onSelect(unit.id)}>
              <FileThumbnail fileName={unit.rawFileName} mimeType={unit.sourceMimeType} previewPath={`/api/project-assets/${unit.sourceAttachmentId}/preview`} className="size-11 rounded-[12px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-[740] text-[#253028]" title={unit.name}>{unit.name}</span>
                {unit.rawFileName !== unit.name ? <span className="mt-0.5 block truncate text-[8px] text-[#8a948d]" title={unit.rawFileName}>{unit.rawFileName}</span> : null}
                <span className="mt-1.5 block"><UnitStatusBadge status={unit.status} /></span>
              </span>
              {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2f8057]" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StageSevenSummary({ data }: { data: StageSevenWorkspaceData }) {
  const metrics = [
    { label: "Production Units", value: data.summary.totalUnits, icon: Boxes, tone: "bg-[#edf5ef] text-[#347153]" },
    { label: "Waiting for Sample", value: data.summary.waitingUnits, icon: Mail, tone: "bg-[#eef5ff] text-[#456e9f]" },
    { label: "Overdue", value: data.summary.overdueRounds, icon: CalendarClock, tone: "bg-[#fff0ee] text-[#b9473d]" },
    { label: "Accepted", value: data.summary.acceptedUnits, icon: CheckCircle2, tone: "bg-[#e9f6ed] text-[#257049]" },
  ];
  return (
    <section aria-label="Stage 7 status summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, value, icon: Icon, tone }) => <article key={label} className="flex items-center gap-3 rounded-[15px] border border-[#e0e7e0] bg-white px-4 py-3 shadow-[0_8px_22px_rgba(23,39,28,0.03)]"><span className={cn("grid size-9 shrink-0 place-items-center rounded-[11px]", tone)}><Icon className="h-4 w-4" /></span><span><strong className="block text-[19px] font-[780] leading-none text-[#1d2821]">{value}</strong><span className="mt-1 block text-[10px] font-[650] text-[#748078]">{label}</span></span></article>)}
    </section>
  );
}

function SampleRoundsList({
  unit,
  selectedRoundId,
  canRequest,
  canManage,
  stageCompleted,
  onSelectRound,
  onDeleteRound,
  onRequest,
}: {
  unit: Unit;
  selectedRoundId: string | null;
  canRequest: boolean;
  canManage: boolean;
  stageCompleted: boolean;
  onSelectRound: (roundId: string) => void;
  onDeleteRound: (round: Round) => void;
  onRequest: () => void;
}) {
  const latest = unit.rounds.at(-1);
  return (
    <section className="min-w-0 rounded-[18px] border border-[#dfe6df] bg-white shadow-[0_10px_28px_rgba(23,39,28,0.035)]" aria-labelledby="sample-rounds-heading">
      <div className="flex flex-col gap-3 border-b border-[#e6ebe6] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div><h2 id="sample-rounds-heading" className="text-[15px] font-[760] text-[#1f2a22]">Physical Sample Requests — {unit.name}</h2><p className="mt-1 text-[10px] text-[#7c867f]">Request a physical sample, then let the assigned reviewer record the final outcome.</p></div>
        {canRequest ? <Button type="button" size="sm" className="self-start rounded-[11px]" onClick={onRequest}><Plus className="h-3.5 w-3.5" /> {latest?.decision === PhysicalSampleDecision.REJECTED ? "Request Another Sample" : "Request New Sample"}</Button> : null}
      </div>
      {unit.rounds.length ? (
        <div>
          <div className="hidden grid-cols-[50px_minmax(0,1.25fr)_minmax(0,1fr)_100px_128px_210px] gap-3 border-b border-[#edf0ed] bg-[#fafbfa] px-5 py-2.5 text-[8px] font-[760] uppercase tracking-[0.065em] text-[#7d8780] lg:grid"><span>Round</span><span>Name / Type</span><span>Provider</span><span>Deadline</span><span className="w-full">Status</span><span className="w-full text-right">Actions</span></div>
          <div className="divide-y divide-[#e9ede9]">
            {unit.rounds.map((round) => {
              const selected = round.id === selectedRoundId;
              const actions = getPhysicalSampleRequestActionState({
                selected,
                canManage,
                canReview: round.canReview,
                stageCompleted,
                hasDecision: Boolean(round.decision),
                unitStatus: unit.status,
                roundStatus: round.status,
              });
              return (
                <article key={round.id} className={cn("grid gap-4 px-4 py-4 transition lg:grid-cols-[50px_minmax(0,1.25fr)_minmax(0,1fr)_100px_128px_210px] lg:items-center lg:gap-3 lg:px-5", selected ? "bg-[#f4faf5]" : "hover:bg-[#fbfcfb]")}>
                  <div><span className="mb-1 block text-[8px] font-[760] uppercase text-[#8a948d] lg:hidden">Round</span><span className={cn("grid size-8 shrink-0 place-items-center rounded-full border text-[11px] font-[780]", selected ? "border-[#86b395] bg-[#e7f4ea] text-[#2d744d]" : "border-[#dce4dd] bg-[#f7f9f7] text-[#68746b]")}>{round.sequence}</span></div>
                  <div className="min-w-0"><span className="mb-1 block text-[8px] font-[760] uppercase text-[#8a948d] lg:hidden">Name / Type</span><h3 className="truncate text-[11px] font-[700] leading-4 text-[#29342c]">{round.name}</h3><p className="mt-0.5 truncate text-[9px] text-[#758078]">{round.type === ProductionSampleRoundType.CUSTOM ? round.customTypeName : ROUND_TYPE_LABELS[round.type]}</p></div>
                  <div className="min-w-0"><span className="mb-1 block text-[8px] font-[760] uppercase text-[#8a948d] lg:hidden">Provider</span><p className="min-w-0 whitespace-normal break-words text-[10px] font-[680] text-[#39443c]">{round.recipientCompany || round.recipientName || "Legacy request"}</p>{round.recipientEmail ? <p className="mt-0.5 truncate text-[8px] text-[#849087]">{round.recipientEmail}</p> : null}</div>
                  <div><span className="mb-1 block text-[8px] font-[760] uppercase text-[#8a948d] lg:hidden">Deadline</span><p className="text-[10px] font-[680] text-[#39443c]">{formatDate(round.deadline)}</p>{round.overdue ? <p className="mt-0.5 text-[8px] font-[700] text-[#bd473d]">{overdueLabel(round.deadline)}</p> : null}</div>
                  <div className="w-full min-w-0"><span className="mb-1 block text-[8px] font-[760] uppercase text-[#8a948d] lg:hidden">Status</span><ReceiptStatusBadge round={round} /></div>
                  <div className="w-full min-w-0">
                    <span className="mb-1 block text-[8px] font-[760] uppercase text-[#8a948d] lg:hidden">
                      Actions
                    </span>
                    <div className="flex min-w-0 flex-wrap justify-start gap-2 lg:justify-end">
                      {round.decision ? (
                        <button
                          type="button"
                          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4b9068]/40"
                          aria-label={`View ${round.decision === PhysicalSampleDecision.ACCEPTED ? "accepted" : "rejected"} sample request`}
                          onClick={() => onSelectRound(round.id)}
                        >
                          <DecisionBadge decision={round.decision} />
                        </button>
                      ) : actions.showReviewAction ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={selected ? "secondary" : "outline"}
                          className="min-h-8 shrink-0 rounded-[10px] px-3 text-[10px]"
                          onClick={() => onSelectRound(round.id)}
                        >
                          Accept / Reject
                        </Button>
                      ) : null}
                      {actions.showRowDelete ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="min-h-8 shrink-0 rounded-[10px] px-3 text-[10px]"
                          onClick={() => onDeleteRound(round)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete Request
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid min-h-[250px] place-items-center px-6 py-12 text-center"><div><CircleDot className="mx-auto h-8 w-8 text-[#aab3ac]" /><h3 className="mt-3 text-[13px] font-[720] text-[#344038]">No physical samples requested yet.</h3><p className="mt-1 text-[10px] text-[#849087]">Send the first physical sample request for {unit.name}.</p></div></div>
      )}
    </section>
  );
}

function SampleRequestDetails({
  projectId,
  unit,
  round,
  canManage,
  canReview,
  stageCompleted,
  onRefresh,
  onRequestAnother,
}: {
  projectId: string;
  unit: Unit;
  round: Round | null;
  canManage: boolean;
  canReview: boolean;
  stageCompleted: boolean;
  onRefresh: () => void;
  onRequestAnother: () => void;
}) {
  const [pending, startPending] = useTransition();
  const [reviewNote, setReviewNote] = useState(round?.decisionNote ?? "");
  const [confirm, setConfirm] = useState<PhysicalSampleDecision | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [reminderIntervalHours, setReminderIntervalHours] =
    useState<RequestReminderIntervalHours>(round?.reminder?.intervalHours ?? 24);
  const actions = round
    ? getPhysicalSampleRequestActionState({
        selected: true,
        canManage,
        canReview,
        stageCompleted,
        hasDecision: Boolean(round.decision),
        unitStatus: unit.status,
        roundStatus: round.status,
      })
    : null;
  const canDelete = actions?.showDetailsDelete ?? false;
  const mutable = actions?.requestMutable ?? false;
  const reviewable = actions?.reviewable ?? false;
  const received = actions?.received ?? false;
  const hasRejectionNote = Boolean(richTextToPlainText(reviewNote));
  const reviewAutosave = useProjectFormAutosave({
    projectId,
    formKey: `stage-seven-sample-review:${round?.id ?? "none"}`,
    value: { reviewNote },
    enabled: reviewable,
    onRestore: (draft) => setReviewNote(draft.reviewNote),
  });

  if (!round) {
    return <aside className="grid min-h-[350px] place-items-center rounded-[18px] border border-[#dfe6df] bg-white px-6 py-12 text-center shadow-[0_10px_28px_rgba(23,39,28,0.035)]"><div><FileStack className="mx-auto h-9 w-9 text-[#a8b1aa]" /><h2 className="mt-3 text-[14px] font-[740] text-[#303b33]">No sample request selected</h2><p className="mt-1 max-w-[300px] text-[10px] leading-4 text-[#849087]">Request a physical sample for {unit.name} to see its delivery and review details here.</p></div></aside>;
  }

  const roundId = round.id;
  const reviewDescription = round.decision
    ? "This sample request has a final decision."
    : reviewable
      ? received
        ? "Record the note and outcome for this sample request."
        : "Mark the physical sample as received before accepting or rejecting it."
      : round.recipientUserId
        ? "The assigned internal recipient is responsible for reviewing this sample."
        : "You are not assigned to review this sample request.";

  function resendEmail() {
    if (pending) return;
    startPending(async () => {
      const result = await retryProductionSampleRequestEmailAction({ projectId, productionUnitId: unit.id, sampleRoundId: roundId });
      if ("error" in result) {
        showErrorToast("Unable to resend the sample request email.", result.error);
        return;
      }
      if (result.emailStatus === ProductionDispatchStatus.SENT) showSuccessToast("Physical sample request email sent.");
      else showErrorToast("The sample request email failed again.", result.emailError || "Please retry later.");
      onRefresh();
    });
  }

  function deleteRequest() {
    if (pending) return;
    startPending(async () => {
      const result = await deleteProductionSampleRoundAction({
        projectId,
        productionUnitId: unit.id,
        sampleRoundId: roundId,
      });
      if ("error" in result) {
        showErrorToast("Unable to delete the physical sample request.", result.error);
        return;
      }
      await reviewAutosave.clearDraft().catch(() => undefined);
      setDeleteConfirm(false);
      showSuccessToast("Physical sample request deleted.");
      onRefresh();
    });
  }

  function markReceived() {
    if (pending || received) return;
    startPending(async () => {
      const result = await markPhysicalSampleRoundReceivedAction({
        projectId,
        productionUnitId: unit.id,
        sampleRoundId: roundId,
      });
      if ("error" in result) {
        showErrorToast("Unable to mark the physical sample as received.", result.error);
        return;
      }
      showSuccessToast("Physical sample marked as received.");
      onRefresh();
    });
  }

  function requestRejection() {
    if (!received || !hasRejectionNote) return;
    setConfirm(PhysicalSampleDecision.REJECTED);
  }

  function changeReminder(intervalHours: RequestReminderIntervalHours | null) {
    if (pending) return;
    startPending(async () => {
      const result = await configureStageSevenSampleRequestReminderAction({
        projectId,
        productionUnitId: unit.id,
        sampleRoundId: roundId,
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
      onRefresh();
    });
  }

  function decide() {
    if (!confirm || pending || !received) return;
    startPending(async () => {
      const result = await decidePhysicalSampleRoundAction({ projectId, productionUnitId: unit.id, sampleRoundId: roundId, decision: confirm, decisionNote: reviewNote });
      if ("error" in result) {
        showErrorToast(confirm === PhysicalSampleDecision.ACCEPTED ? "Unable to accept the physical sample." : "Unable to reject the physical sample.", result.error);
        return;
      }
      await reviewAutosave.clearDraft().catch(() => undefined);
      showSuccessToast(confirm === PhysicalSampleDecision.ACCEPTED ? "Physical sample accepted." : "Physical sample rejected. You can request another sample.");
      setConfirm(null);
      onRefresh();
    });
  }

  return (
    <aside className="min-w-0 rounded-[18px] border border-[#dfe6df] bg-white shadow-[0_10px_28px_rgba(23,39,28,0.035)]" aria-labelledby="selected-round-heading">
      <div className="border-b border-[#e5ebe5] px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-[760] uppercase tracking-[0.08em] text-[#7d8780]">Selected Sample Request</p><h2 id="selected-round-heading" className="mt-1.5 text-[15px] font-[760] leading-5 text-[#1f2a22]">Round {round.sequence} — {round.name}</h2><p className="mt-1 text-[9px] text-[#758078]">{round.type === ProductionSampleRoundType.CUSTOM ? round.customTypeName : ROUND_TYPE_LABELS[round.type]}</p></div><ReceiptStatusBadge round={round} /></div>
        {canDelete || (reviewable && !received) ? <div className="mt-3 flex flex-wrap justify-end gap-2">{mutable && !received ? <Button type="button" size="sm" variant="outline" className="rounded-[10px]" disabled={pending || round.emailStatus === ProductionDispatchStatus.PENDING} onClick={resendEmail}><RefreshCw className="h-3.5 w-3.5" /> {round.emailStatus === ProductionDispatchStatus.SENT ? "Resend Request" : round.emailStatus === ProductionDispatchStatus.FAILED ? "Retry Send" : "Send Request"}</Button> : null}{reviewable && !received ? <Button type="button" size="sm" className="rounded-[10px]" disabled={pending} onClick={markReceived}><PackageCheck className="h-3.5 w-3.5" /> Mark as Received</Button> : null}{canDelete ? <Button type="button" size="sm" variant="destructive" className="rounded-[10px]" disabled={pending} onClick={() => setDeleteConfirm(true)}><Trash2 className="h-3.5 w-3.5" /> Delete Request</Button> : null}</div> : null}
      </div>
      <div className="space-y-5 px-4 py-4 sm:px-5">
        {mutable && round.emailStatus === ProductionDispatchStatus.FAILED ? <div className="rounded-[12px] border border-[#f1dbb2] bg-[#fff9ed] p-3"><p className="text-[10px] leading-4 text-[#795c2b]">The request is saved, but the provider email was not delivered. Use Retry Send above to try again.</p></div> : null}
        <section className="rounded-[14px] border border-[#dfe6df] bg-[#fafcfa] p-3.5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-[10px] font-[760] uppercase tracking-[0.075em] text-[#657168]">Physical Sample Review</h3><p className="mt-1 text-[9px] text-[#7c867f]">{reviewDescription}</p></div>{round.decision ? <DecisionBadge decision={round.decision} /> : reviewable ? <div className="grid shrink-0 grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" className="border-[#d96a60] text-[#b9433a] hover:bg-[#fff3f1]" disabled={!actions?.reviewActionsEnabled || !hasRejectionNote} aria-describedby="sample-rejection-note-requirement" onClick={requestRejection}><XCircle className="h-4 w-4" /> Reject Sample</Button><Button type="button" size="sm" disabled={!actions?.reviewActionsEnabled} onClick={() => setConfirm(PhysicalSampleDecision.ACCEPTED)}><CheckCircle2 className="h-4 w-4" /> Accept Sample</Button></div> : <Badge variant="secondary" className="w-fit">Assigned recipient review</Badge>}</div>
          {round.decision ? <div className="mt-3 border-t border-[#e0e7e0] pt-3"><RichTextContent value={round.decisionNote} fallback={<p className="text-[10px] leading-4 text-[#465149]">No review note was added.</p>} className="text-[10px] leading-4 text-[#465149]" /><p className="mt-2 text-[8px] text-[#849087]">Decided by {round.decidedBy || "Unknown"}{round.decidedAt ? ` · ${formatDateTime(round.decidedAt)}` : ""}</p>{round.decision === PhysicalSampleDecision.REJECTED && canManage && !stageCompleted ? <Button type="button" size="sm" className="mt-3 rounded-[10px]" onClick={onRequestAnother}><Plus className="h-3.5 w-3.5" /> Request Another Sample</Button> : null}</div> : reviewable ? <div className="mt-3 block space-y-2 border-t border-[#e0e7e0] pt-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-[700] text-[#59655d]">Review Note</span><span className="rounded-full bg-[#fff0ee] px-2 py-1 text-[9px] font-[700] text-[#a8443d]">Required to reject</span></div><RichTextEditor value={reviewNote} maxLength={8000} minHeightClassName="min-h-[90px]" ariaLabel="Physical sample review note. Required to reject; optional to accept." placeholder="Enter the reason for rejection, or optionally add an acceptance note." onChange={setReviewNote} /><p id="sample-rejection-note-requirement" className="text-[9px] leading-4 text-[#68746b]">Enter a review note to enable Reject Sample. A review note is optional when accepting.</p><ProjectFormAutosaveStatus status={reviewAutosave.status} savedAt={reviewAutosave.savedAt} restoredAt={reviewAutosave.restoredAt} onRetry={() => void reviewAutosave.retry()} /></div> : <div className="mt-3 border-t border-[#e0e7e0] pt-3 text-[10px] leading-4 text-[#68746b]">You can view and manage the request, but only its assigned internal recipient can mark it received or record the final decision.</div>}
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[11px] border border-[#e2e8e2] bg-[#fafcfa] px-3 py-2.5"><p className="text-[8px] font-[760] uppercase tracking-[0.06em] text-[#7f8a82]">Provider</p><p className="mt-1 text-[10px] font-[700] text-[#39443c]">{round.recipientRoute === ProductionHandoverRoute.PURCHASE_DEPARTMENT ? "Internal" : round.recipientRoute === ProductionHandoverRoute.DIRECT_VENDOR ? "External" : "Legacy request"}{round.recipientCompany ? ` · ${round.recipientCompany}` : ""}</p><p className="mt-0.5 text-[9px] text-[#758078]">{round.recipientName || "Not provided"}</p><p className="mt-0.5 break-all text-[9px] text-[#758078]">{round.recipientEmail || "Legacy request"}{round.recipientPhone ? ` · ${round.recipientPhone}` : ""}</p></div>
          <div className={cn("rounded-[11px] border px-3 py-2.5", round.overdue ? "border-[#efcbc5] bg-[#fff6f4]" : "border-[#e2e8e2] bg-[#fafcfa]")}><p className="text-[8px] font-[760] uppercase tracking-[0.06em] text-[#7f8a82]">Deadline</p><p className={cn("mt-1 text-[10px] font-[700]", round.overdue ? "text-[#b8473e]" : "text-[#39443c]")}>{formatDate(round.deadline)}</p>{round.overdue ? <p className="mt-0.5 text-[9px] font-[700] text-[#b8473e]">{overdueLabel(round.deadline)}</p> : null}</div>
          <div className="rounded-[11px] border border-[#e2e8e2] bg-[#fafcfa] px-3 py-2.5"><p className="text-[8px] font-[760] uppercase tracking-[0.06em] text-[#7f8a82]">Email Status</p><p className="mt-1 text-[10px] font-[700] text-[#39443c]">{EMAIL_STATUS_LABELS[round.emailStatus]}</p><p className="mt-0.5 text-[9px] text-[#758078]">{round.emailStatus === ProductionDispatchStatus.FAILED ? round.emailError || "Not delivered" : round.emailSentAt ? `Sent ${formatDateTime(round.emailSentAt)}` : "Not delivered"}</p></div>
          <div className="rounded-[11px] border border-[#e2e8e2] bg-[#fafcfa] px-3 py-2.5"><p className="text-[8px] font-[760] uppercase tracking-[0.06em] text-[#7f8a82]">Request Created</p><p className="mt-1 text-[10px] font-[700] text-[#39443c]">{formatDateTime(round.createdAt)}</p></div>
        </section>
        {round.reminderManageable ? (
          <section className="rounded-[14px] border border-[#dce5dd] bg-[#f8fbf8] p-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-[10px] font-[760] uppercase tracking-[0.075em] text-[#657168]">Reminder</h3>
                <p className="mt-1 text-[10px] text-[#59665d]">
                  {round.reminder?.enabled
                    ? formatRequestReminderInterval(round.reminder.intervalHours)
                    : "Reminder is off"}
                </p>
                {round.reminder?.enabled && round.reminder.nextReminderAt ? (
                  <p className="mt-0.5 text-[9px] text-[#7c867f]">Next reminder: {formatDateTime(round.reminder.nextReminderAt)}</p>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Select value={String(reminderIntervalHours)} onValueChange={(value) => {
                  const hours = Number(value) as RequestReminderIntervalHours;
                  setReminderIntervalHours(hours);
                  if (round.reminder?.enabled) changeReminder(hours);
                }}>
                  <SelectTrigger className="h-9 min-w-[160px] rounded-[10px] border-[#c8d5cb] bg-white text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{REQUEST_REMINDER_INTERVAL_HOURS.map((hours) => <SelectItem key={hours} value={String(hours)}>{formatRequestReminderInterval(hours)}</SelectItem>)}</SelectContent>
                </Select>
                {round.reminder?.enabled ? (
                  <Button type="button" size="sm" variant="outline" disabled={pending} className="rounded-[10px] text-[#a34a43]" onClick={() => changeReminder(null)}>Stop</Button>
                ) : (
                  <Button type="button" size="sm" disabled={pending} className="rounded-[10px]" onClick={() => changeReminder(reminderIntervalHours)}>Enable</Button>
                )}
              </div>
            </div>
          </section>
        ) : null}
        <section><h3 className="text-[10px] font-[760] uppercase tracking-[0.075em] text-[#657168]">Request Note</h3><div className="mt-2 rounded-[11px] border border-[#e2e8e2] bg-[#fafcfa] px-3 py-2.5"><RichTextContent value={round.requestNote} fallback={<p className="text-[10px] leading-4 text-[#4c584f]">No request note was added.</p>} className="text-[10px] leading-4 text-[#4c584f]" /></div></section>
        <section><h3 className="text-[10px] font-[760] uppercase tracking-[0.075em] text-[#657168]">Production Files / References</h3><div className="mt-2 grid gap-2">{round.referenceFiles.length ? round.referenceFiles.map((file) => <a key={file.id} href={file.downloadPath} className="flex min-w-0 items-center gap-3 rounded-[11px] border border-[#e0e7e0] bg-[#fafcfa] px-3 py-2.5 text-[10px] text-[#354139] hover:bg-[#f3f8f4]"><FileThumbnail fileName={file.name} mimeType={file.mimeType} previewPath={`/api/project-assets/${file.id}/preview`} className="h-8 w-10" /><span className="min-w-0 flex-1 truncate font-[680]">{file.name}</span><Download className="h-3.5 w-3.5 shrink-0" /></a>) : <p className="text-[10px] text-[#8a948d]">No reference files are available for this legacy request.</p>}</div></section>
      </div>
      <ConfirmationDialog isOpen={confirm === PhysicalSampleDecision.ACCEPTED} title="Accept this physical sample?" description={`This will mark ${unit.name} as accepted for Stage 7 and lock further sample requests.`} confirmLabel="Accept Sample" pending={pending} onConfirm={decide} onClose={() => setConfirm(null)} />
      <ConfirmationDialog isOpen={confirm === PhysicalSampleDecision.REJECTED} title="Reject this physical sample?" description="The rejection and review note will remain as permanent history. You may then request another physical sample." confirmLabel="Reject Sample" tone="destructive" pending={pending} onConfirm={decide} onClose={() => setConfirm(null)} />
      <ConfirmationDialog isOpen={deleteConfirm} title="Delete physical sample request?" description={`This permanently removes Round ${round.sequence} — ${round.name}. The recipient will no longer be able to open this request.`} confirmLabel="Delete Request" tone="destructive" pending={pending} onConfirm={deleteRequest} onClose={() => setDeleteConfirm(false)} />
    </aside>
  );
}

export function StageSevenWorkspace({
  project,
  currentUserId,
  data,
}: {
  project: ProjectStageShellRecord;
  currentUserId: string;
  data: StageSevenWorkspaceData;
}) {
  const router = useRouter();
  const [pending, startPending] = useTransition();
  const [requestOpen, setRequestOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ unitId: string; round: Round } | null>(null);
  const selectedUnit = data.units.find((unit) => unit.id === data.selectedUnitId) ?? data.units[0] ?? null;
  const selectedRound = selectedUnit?.rounds.find((round) => round.id === data.selectedRoundId) ?? selectedUnit?.rounds.at(-1) ?? null;
  const canRequest = Boolean(selectedUnit && data.canManage && !data.stageCompleted && selectedUnit.status !== ProductionSupervisionStatus.SIGNED_OFF);
  const remainingUnits = data.units.filter((unit) => unit.status !== ProductionSupervisionStatus.SIGNED_OFF);
  const canClose = data.canManage && !data.stageCompleted && data.units.length > 0 && !remainingUnits.length;
  const headerStatus = data.stageCompleted ? "COMPLETED" : data.units.some((unit) => unit.rounds.length) ? "IN PROGRESS" : "AVAILABLE";

  function select(unitId: string, roundId?: string | null) {
    const params = new URLSearchParams({ unit: unitId });
    if (roundId) params.set("round", roundId);
    router.push(`/projects/${project.id}/stages/7?${params.toString()}`, { scroll: false });
  }

  const snapshot = project.stageInstances?.find(stage => stage.workspace === "PACKAGING_ACCEPTANCE");
  const followingStage = snapshot && project.stageInstances?.find(stage => stage.order > snapshot.order);
  const completionLabel = followingStage ? "Complete stage" : "Mark Project as Completed";
  function markProjectCompleted() {
    startPending(async () => {
      const result = await closeStageSevenProjectAction({ projectId: project.id });
      if ("error" in result) {
        showErrorToast("Unable to mark the project as completed.", result.error);
        return;
      }
      showSuccessToast(followingStage ? "Stage completed. The next stage is now available." : result.duplicate ? "Project was already completed." : "Project marked as completed. Archiving remains separate.");
      setCloseConfirm(false);
      router.refresh();
    });
  }

  function deleteSampleRequest() {
    if (!deleteTarget || pending) return;
    const target = deleteTarget;
    startPending(async () => {
      const result = await deleteProductionSampleRoundAction({
        projectId: project.id,
        productionUnitId: target.unitId,
        sampleRoundId: target.round.id,
      });
      if ("error" in result) {
        showErrorToast("Unable to delete the physical sample request.", result.error);
        return;
      }
      setDeleteTarget(null);
      showSuccessToast("Physical sample request deleted.");
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-[1420px] pb-6">
      <ProjectAccessRealtimeGuard
        projectId={project.id}
        currentUserId={currentUserId}
        fallbackRefreshIntervalMs={10_000}
      />
      {snapshot && <StageGuidance stage={snapshot} />}
      {data.stageCompleted && followingStage && <Link className="mb-4 block text-sm underline" href={stageInstanceHref(project.id, followingStage)}>Continue to {followingStage.name}</Link>}
      <Card className="overflow-hidden rounded-[26px] border-[#dfe6df] shadow-[0_20px_54px_rgba(23,39,28,0.055)]">
        <CardContent className="p-0">
          <div className="px-5 py-6 sm:px-7 sm:py-8 lg:px-9">
            <div className="flex items-center gap-2 text-[11px] font-[760] uppercase tracking-[0.13em] text-[#4d765d]"><PackageCheck className="h-4 w-4" /> Implementation &amp; Supervision</div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h1 className="text-[28px] font-[780] tracking-[-0.04em] text-[#111713] sm:text-[34px]">Stage 7 – Implementation &amp; Supervision</h1><Badge variant="secondary" className="w-fit border-[#cfe0d3] bg-[#eaf4ed] px-3 py-1.5 text-[10px] text-[#2f7751]">{headerStatus}</Badge></div>
            <p className="mt-2 text-[13px] leading-5 text-[#6f7a72]">Request, track, and accept physical production samples for each approved Production Unit.</p>
            <ProjectStageSummary project={project} />
          </div>
          <div className="space-y-5 border-t border-[#e7ece7] bg-[#fbfcfb] px-5 py-6 sm:px-7 lg:px-9 lg:py-7">
            {!data.units.length ? <div className="grid min-h-[360px] place-items-center rounded-[18px] border border-[#dfe6df] bg-white p-8 text-center"><div><PackageCheck className="mx-auto h-9 w-9 text-[#a7b2a9]" /><h2 className="mt-3 text-[15px] font-[740] text-[#303b33]">No approved Production Units are available.</h2><p className="mt-1 text-[10px] text-[#849087]">Stage 7 uses approved Stage 6 Production Units; the optional handover is not required.</p></div></div> : selectedUnit ? <><ProductionUnitSwitcher units={data.units} selectedUnitId={selectedUnit.id} onSelect={(unitId) => select(unitId)} /><StageSevenSummary data={data} />{selectedUnit.status === ProductionSupervisionStatus.SIGNED_OFF ? <div className="flex flex-wrap items-center gap-3 rounded-[13px] border border-[#cde3d3] bg-[#eff9f2] px-4 py-3 text-[10px] text-[#2d6f4a]"><CheckCircle2 className="h-4 w-4" /><strong>Physical Sample Accepted</strong><span>Accepted by {selectedUnit.acceptedBy || "manager"}{selectedUnit.signedOffAt ? ` on ${formatDateTime(selectedUnit.signedOffAt)}` : ""}.</span></div> : null}<div className="grid min-w-0 gap-5 min-[1360px]:grid-cols-[minmax(0,1.65fr)_minmax(380px,0.95fr)] min-[1360px]:items-start"><SampleRoundsList unit={selectedUnit} selectedRoundId={selectedRound?.id ?? null} canRequest={canRequest} canManage={data.canManage} stageCompleted={data.stageCompleted} onRequest={() => setRequestOpen(true)} onSelectRound={(roundId) => select(selectedUnit.id, roundId)} onDeleteRound={(round) => setDeleteTarget({ unitId: selectedUnit.id, round })} /><SampleRequestDetails key={selectedRound?.id ?? "none"} projectId={project.id} unit={selectedUnit} round={selectedRound} canManage={data.canManage} canReview={Boolean(selectedRound?.canReview)} stageCompleted={data.stageCompleted} onRefresh={() => router.refresh()} onRequestAnother={() => setRequestOpen(true)} /></div>{data.summary.overdueRounds ? <div className="flex items-start gap-2 rounded-[13px] border border-[#ead6ae] bg-[#fff9ed] px-4 py-3 text-[10px] leading-4 text-[#795c2b]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#b37a21]" /><span><strong>{data.summary.overdueRounds} physical sample {data.summary.overdueRounds === 1 ? "request is" : "requests are"} overdue.</strong> Project Owner and Co-Owners receive one deduplicated alert per overdue request.</span></div> : null}</> : null}
          </div>
          <div className="flex flex-col gap-4 border-t border-[#e7ece7] bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-9">
            <div className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#4f8062]" /><div><p className="text-[11px] font-[720] text-[#354138]">{followingStage ? "Complete this stage once every physical Production Unit sample is accepted." : "Project completion is manual once every physical Production Unit sample is accepted."}</p><p className="mt-0.5 text-[9px] text-[#849087]">{followingStage ? `Next: ${followingStage.name}. The project remains open.` : "Completing the project finishes Stage 7. Archiving remains a separate action."}</p></div></div>
            {data.stageCompleted ? <Badge className="bg-[#e4f2e7] text-[#2e744e]">{followingStage ? "Stage Completed" : "Project Completed"}</Badge> : data.canManage ? <Button type="button" className="rounded-[12px]" disabled={!canClose || pending} onClick={() => { if (!canClose) { showErrorToast("All physical Production Unit samples must be accepted before the project can be completed.", remainingUnits.length ? `Remaining: ${remainingUnits.map((unit) => unit.name).join(", ")}.` : undefined); return; } setCloseConfirm(true); }}><CheckCircle2 className="h-4 w-4" /> {completionLabel}</Button> : null}
          </div>
        </CardContent>
      </Card>
      {requestOpen && selectedUnit ? <NewSampleRequestDialog projectId={project.id} unit={selectedUnit} participants={data.participants} onClose={() => setRequestOpen(false)} onCreated={(roundId) => select(selectedUnit.id, roundId)} /> : null}
      <ConfirmationDialog isOpen={Boolean(deleteTarget)} title="Delete physical sample request?" description={deleteTarget ? `This permanently removes Round ${deleteTarget.round.sequence} — ${deleteTarget.round.name}. The recipient will no longer be able to open this request.` : "This permanently removes the selected physical sample request."} confirmLabel="Delete Request" tone="destructive" pending={pending} onConfirm={deleteSampleRequest} onClose={() => setDeleteTarget(null)} />
      <ConfirmationDialog isOpen={closeConfirm} title={`${completionLabel}?`} description={followingStage ? `Every physical Production Unit sample has been accepted. Complete this stage to continue to ${followingStage.name}.` : "Every physical Production Unit sample has been accepted. Completing the project finishes Stage 7; Archive remains separate."} confirmLabel={completionLabel} pending={pending} onConfirm={markProjectCompleted} onClose={() => setCloseConfirm(false)} />
    </section>
  );
}

export function StageSevenLoadingShell() {
  return <section className="mx-auto w-full max-w-[1420px] pb-6"><Card className="overflow-hidden rounded-[26px] border-[#dfe6df] shadow-none"><CardContent className="p-0"><div className="p-7 lg:p-9"><Skeleton className="h-4 w-48 rounded-full" /><Skeleton className="mt-4 h-10 w-full max-w-[680px] rounded-[12px]" /><Skeleton className="mt-6 h-[86px] rounded-[18px]" /></div><div className="space-y-5 border-t border-[#e7ece7] bg-[#fbfcfb] p-6 lg:p-9"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[76px] rounded-[16px]" />)}</div><div className="grid gap-5 min-[1360px]:grid-cols-[minmax(0,1.65fr)_minmax(380px,0.95fr)]"><Skeleton className="h-[520px] rounded-[18px]" /><Skeleton className="h-[620px] rounded-[18px]" /></div></div></CardContent></Card></section>;
}

import Link from "next/link";
import {
  CalendarDays,
  Download,
  FileText,
  ListChecks,
  Mail,
  Phone,
} from "lucide-react";

import {
  AssetImageThumbnail,
  AssetPreviewButton,
} from "@/components/projects/asset-preview-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-editor";
import type {
  ProjectInquiryAttachmentRecord,
  ProjectInquiryPartySelection,
  ProjectInquiryRecord,
} from "@/lib/project-inquiry";
import { cn } from "@/lib/utils";

type StageOneReadOnlyViewProps = {
  projectId: string;
  inquiry: ProjectInquiryRecord | null;
  canEdit: boolean;
};

function NotProvided({ className }: { className?: string }) {
  return (
    <span className={cn("text-[13px] italic text-[#89928b]", className)}>
      Not provided
    </span>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function StageOneViewSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-[20px] border-[#dfe6df] shadow-[0_12px_32px_rgba(23,39,28,0.04)]">
      <CardContent className="px-5 py-5 sm:px-6 sm:py-6">
        <div className="border-b border-[#edf1ed] pb-4">
          <h2 className="text-[16px] font-[760] tracking-[-0.02em] text-[#1d271f]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[12px] text-[#768078]">{description}</p>
          ) : null}
        </div>
        <div className="pt-5">{children}</div>
      </CardContent>
    </Card>
  );
}

function ReadOnlyValue({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-[700] uppercase tracking-[0.08em] text-[#7b857e]">
        {label}
      </p>
      <div className="mt-2 text-[14px] leading-6 text-[#273129]">
        {value || <NotProvided />}
      </div>
    </div>
  );
}

function PartyDetails({
  label,
  party,
}: {
  label: string;
  party: ProjectInquiryPartySelection | null | undefined;
}) {
  const displayName = party?.entityType === "COMPANY"
    ? party.company || party.name
    : party?.name ?? "";
  const details = party?.entityType === "COMPANY"
    ? [
        { label: "Company Name", value: party.company },
        { label: "Company Email ID", value: party.companyEmail, icon: Mail },
        { label: "Company Contact Number", value: party.companyPhone, icon: Phone },
        { label: "Company Website", value: party.companyWebsite },
        { label: "Contact Person / Representative", value: party.name },
        { label: "Representative Email", value: party.email, icon: Mail },
        { label: "Representative Contact Number", value: party.phone, icon: Phone },
        { label: "Representative Designation", value: party.position },
      ]
    : party ? [
        { label: "Company Name (if applicable)", value: party.company },
        { label: "Email", value: party.email, icon: Mail },
        { label: "Contact Number", value: party.phone, icon: Phone },
        { label: "Designation", value: party.position },
      ]
    : [];

  return (
    <div className="rounded-[16px] border border-[#e3e9e3] bg-[#fbfcfb] p-4 sm:p-5">
      <p className="text-[11px] font-[700] uppercase tracking-[0.08em] text-[#7b857e]">
        {label}
      </p>
      {party ? (
        <>
          <div className="mt-3 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eaf3ec] text-[12px] font-[760] text-[#2f7450]">
              {getInitials(displayName)}
            </span>
            <div className="min-w-0">
              <p className="whitespace-normal break-words text-[15px] font-[720] text-[#202a22]">{displayName}</p>
              <p className="mt-0.5 text-[11px] text-[#7b857e]">{party.entityType === "COMPANY" ? "Company" : "Person"}</p>
            </div>
          </div>
          {details.length ? (
            <dl className="mt-4 grid gap-3 text-[12px] sm:grid-cols-2">
              {details.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[#849087]">{item.label}</dt>
                    <dd className="mt-0.5 flex min-w-0 items-center gap-1.5 font-[620] text-[#3b473e]">
                      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-[#5f7969]" /> : null}
                      <span className="min-w-0 whitespace-normal break-words">{item.value || <NotProvided />}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
        </>
      ) : (
        <NotProvided className="mt-3 block" />
      )}
    </div>
  );
}

function ChipList({ values }: { values: string[] }) {
  if (!values.length) return <NotProvided />;

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value.toLocaleLowerCase("en")}
          className="rounded-full border border-[#dbe7dd] bg-[#f0f6f1] px-3 py-1.5 text-[12px] font-[650] text-[#35684d]"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function ReadOnlyTextBlock({
  label,
  value,
  attachments,
}: {
  label: string;
  value: string;
  attachments: ProjectInquiryAttachmentRecord[];
}) {
  return (
    <div className="rounded-[16px] border border-[#e4e9e4] bg-[#fcfdfc] p-4 sm:p-5">
      <p className="text-[13px] font-[720] text-[#253028]">{label}</p>
      <RichTextContent
        value={value}
        fallback={<NotProvided className="mt-3 block" />}
        className="mt-3 text-[14px] leading-7 text-[#465149]"
      />
      <div className="mt-5 border-t border-[#edf1ed] pt-4">
        <p className="text-[11px] font-[700] uppercase tracking-[0.08em] text-[#7b857e]">
          Attachments
        </p>
        <ReadOnlyAttachmentList attachments={attachments} />
      </div>
    </div>
  );
}

function ReadOnlyAttachmentList({
  attachments,
}: {
  attachments: ProjectInquiryAttachmentRecord[];
}) {
  if (!attachments.length) return <NotProvided className="mt-2 block" />;

  return (
    <div className="mt-3 grid gap-2">
      {attachments.map((attachment) => {
        const fileType =
          attachment.mimeType.split("/").pop()?.toLocaleUpperCase("en") || "FILE";

        return (
          <div
            key={attachment.id}
            className="flex min-w-0 flex-col gap-3 rounded-[13px] border border-[#e1e7e1] bg-white px-3.5 py-3 sm:flex-row sm:items-center"
          >
            {attachment.mimeType.startsWith("image/") ? (
              <AssetImageThumbnail
                fileName={attachment.originalFileName}
                mimeType={attachment.mimeType}
                previewPath={`/api/project-assets/${attachment.id}/preview`}
                downloadPath={`/api/project-assets/${attachment.id}/download`}
              />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#edf5ef] text-[#367252]">
                <FileText className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-[680] text-[#2a352d]">
                {attachment.originalFileName}
              </p>
              <p className="mt-0.5 text-[11px] text-[#849087]">
                {fileType} · {formatBytes(attachment.fileSize)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AssetPreviewButton
                fileName={attachment.originalFileName}
                mimeType={attachment.mimeType}
                previewPath={`/api/project-assets/${attachment.id}/preview`}
                downloadPath={`/api/project-assets/${attachment.id}/download`}
                iconOnly={false}
                label="Preview"
                triggerClassName="h-9 rounded-[10px] border border-[#dce4dd] px-3 text-[12px] font-[650] text-[#3d5546] hover:bg-[#f3f7f3]"
              />
              <a
                href={`/api/project-assets/${attachment.id}/download`}
                className="grid size-9 place-items-center rounded-[10px] border border-[#dce4dd] text-[#3d5546] transition hover:bg-[#f3f7f3]"
                aria-label={`Download ${attachment.originalFileName}`}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StageOneReadOnlyView({
  projectId,
  inquiry,
  canEdit,
}: StageOneReadOnlyViewProps) {
  const targetMarkets = inquiry?.targetMarkets.map((market) => market.label) ?? [];
  const priority = inquiry?.priority
    ? inquiry.priority.charAt(0) + inquiry.priority.slice(1).toLocaleLowerCase("en")
    : null;

  return (
    <div id="stage-one-view-panel" role="tabpanel" aria-label="View Project Inquiry" className="mt-6 space-y-5">
      {!canEdit ? (
        <div className="rounded-[15px] border border-[#dce4dd] bg-[#f4f7f4] px-4 py-3 text-[13px] text-[#536057]">
          You can view this inquiry, but you do not have permission to change it.
        </div>
      ) : null}

      <StageOneViewSection title="Client Information">
        <div className="grid gap-4 lg:grid-cols-2">
          <PartyDetails label="Client" party={inquiry?.client} />
          <div className="grid gap-4">
            {inquiry?.finalBeneficiaries.length ? (
              inquiry.finalBeneficiaries.map((beneficiary, index) => (
                <PartyDetails
                  key={`${beneficiary.source}:${beneficiary.id}`}
                  label={
                    inquiry.finalBeneficiaries.length > 1
                      ? `Final Beneficiary ${index + 1}`
                      : "Final Beneficiary"
                  }
                  party={beneficiary}
                />
              ))
            ) : (
              <PartyDetails label="Final Beneficiary" party={null} />
            )}
          </div>
        </div>
        <div className="mt-5 grid gap-5 border-t border-[#edf1ed] pt-5 sm:grid-cols-2">
          <ReadOnlyValue
            label="Client Type"
            value={
              inquiry?.clientOrigin
                ? inquiry.clientOrigin.charAt(0) +
                  inquiry.clientOrigin.slice(1).toLocaleLowerCase("en")
                : null
            }
          />
          <ReadOnlyValue label="Target Market" value={<ChipList values={targetMarkets} />} />
        </div>
      </StageOneViewSection>

      <StageOneViewSection title="Project Brief">
        <div className="grid gap-4 xl:grid-cols-2">
          <ReadOnlyTextBlock
            label="Initial Brief"
            value={inquiry?.initialBrief ?? ""}
            attachments={inquiry?.attachments.INITIAL_BRIEF ?? []}
          />
          <ReadOnlyTextBlock
            label="Key Business Objectives"
            value={inquiry?.businessObjectives ?? ""}
            attachments={inquiry?.attachments.BUSINESS_OBJECTIVES ?? []}
          />
        </div>
      </StageOneViewSection>

      <StageOneViewSection title="Project Deliverables">
        <ReadOnlyValue
          label="Deliverables"
          value={<ChipList values={inquiry?.deliverables ?? []} />}
        />
      </StageOneViewSection>

      <StageOneViewSection title="Project Details">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <ReadOnlyValue
            label="Date"
            value={
              formatDate(inquiry?.inquiryDate ?? "") ? (
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[#4f765f]" />
                  {formatDate(inquiry?.inquiryDate ?? "")}
                </span>
              ) : null
            }
          />
          <ReadOnlyValue
            label="Deadline"
            value={
              formatDate(inquiry?.deadline ?? "") ? (
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[#4f765f]" />
                  {formatDate(inquiry?.deadline ?? "")}
                </span>
              ) : null
            }
          />
          <ReadOnlyValue
            label="Priority"
            value={
              priority ? (
                <span
                  className={cn(
                    "inline-flex rounded-full border px-3 py-1 text-[12px] font-[680]",
                    inquiry?.priority === "HIGH" &&
                      "border-[#f0d3cf] bg-[#fff3f1] text-[#a64c45]",
                    inquiry?.priority === "MEDIUM" &&
                      "border-[#eadfbf] bg-[#fff9e9] text-[#8a6a24]",
                    inquiry?.priority === "LOW" &&
                      "border-[#d9e6dc] bg-[#f1f7f2] text-[#467057]",
                  )}
                >
                  {priority}
                </span>
              ) : null
            }
          />
        </div>
      </StageOneViewSection>

      <StageOneViewSection title="Legal Notes">
        <ReadOnlyTextBlock
          label="Legal Notes"
          value={inquiry?.legalNotes ?? ""}
          attachments={inquiry?.attachments.LEGAL_NOTES ?? []}
        />
      </StageOneViewSection>

      <div className="flex border-t border-[#e7ece7] pt-5">
        <Button asChild type="button" variant="outline" className="min-w-[150px] rounded-[13px] shadow-none">
          <Link href={`/projects/${projectId}`}>
            <ListChecks className="h-4 w-4" />
            All Stages
          </Link>
        </Button>
      </div>
    </div>
  );
}

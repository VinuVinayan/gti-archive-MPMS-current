import Link from "next/link";
import type { ReactNode } from "react";
import {
  BadgeDollarSign,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  FolderKanban,
  Leaf,
  UserRound,
  WalletCards,
} from "lucide-react";

import {
  AssetImageThumbnail,
  AssetPreviewButton,
} from "@/components/projects/asset-preview-button";
import { AttachmentFavoriteButton } from "@/components/projects/attachment-favorite-button";
import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import {
  ProjectExecutorsPanel,
} from "@/components/projects/project-collaborators-panel";
import { ProjectDetailCollaboratorsPanel } from "@/components/projects/project-detail-collaborators-panel";
import {
  CompletedProjectArchiveSummaryCard,
  ProjectCompletionChecklist,
} from "@/components/projects/project-completion-checklist";
import { StageActivitySummary } from "@/components/projects/stage-activity-summary";
import type { ProjectFlowRecord, ProjectStageRecord } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MotionItem,
  MotionStaggerGroup,
} from "@/components/motion/motion-primitives";
import type { ProjectCompletionSummary } from "@/lib/archives";
import type { ProjectCompletionWorkflowRecord } from "@/lib/project-completion";
import { getStageActivityFallback } from "@/lib/project-stage-summary";

type ProjectDetailWorkspaceProps = {
  project: ProjectFlowRecord;
  currentUserId: string;
  completionSummary?: ProjectCompletionSummary | null;
  completionWorkflow: ProjectCompletionWorkflowRecord | null;
  assetsLoading?: boolean;
  completionLoading?: boolean;
};

function DetailAssetsSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[18px] border border-[#e2e8e1] bg-[#fbfcfa] px-3.5 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-10/12 rounded-full" />
              <Skeleton className="h-2.5 w-8/12 rounded-full" />
            </div>
            <div className="flex shrink-0 gap-1">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-7 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompletionLoadingCard() {
  return (
    <Card className="rounded-[24px] border border-[#dfe9df] bg-[#f7fbf6] shadow-none">
      <CardContent className="space-y-3 px-6 py-6">
        <Skeleton className="h-5 w-48 rounded-full" />
        <Skeleton className="h-3.5 w-10/12 rounded-full" />
        <Skeleton className="h-3.5 w-7/12 rounded-full" />
      </CardContent>
    </Card>
  );
}

function formatStageNumber(order: number) {
  return String(order).padStart(2, "0");
}

function getStageStatusMeta(stage: ProjectStageRecord) {
  switch (stage.status) {
    case "completed":
      return {
        label: "Completed",
        accent: "border-l-[#2f8d5d]",
        statusPill: "border-[#cdebd5] bg-[#edf9f0] text-[#25764b]",
        number: "bg-[#e5f4e9] text-[#176d42]",
        dot: "bg-[#2f8d5d]",
        button:
          "bg-[linear-gradient(90deg,#2f8d5d,#145232)] text-white shadow-[0_14px_28px_rgba(24,92,56,0.18)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(24,92,56,0.24)]",
      };
    case "pending":
      return {
        label: "Pending",
        accent: "border-l-[#9aa49d]",
        statusPill: "border-[#dfe5de] bg-[#f3f5f2] text-[#5b655f]",
        number: "bg-[#eef2ef] text-[#3d4841]",
        dot: "bg-[#8e9992]",
        button:
          "bg-[linear-gradient(90deg,#9fa8a3,#87918b)] text-white shadow-none",
      };
    case "on-hold":
      return {
        label: "On Hold",
        accent: "border-l-[#b38c37]",
        statusPill: "border-[#eadfbd] bg-[#fbf6e8] text-[#7d6124]",
        number: "bg-[#f7f1df] text-[#76591f]",
        dot: "bg-[#b38c37]",
        button:
          "bg-[linear-gradient(90deg,#aeb6b0,#8e9891)] text-white shadow-none",
      };
    default:
      return {
        label: "Ongoing",
        accent: "border-l-[#168456]",
        statusPill: "border-[#c9ead5] bg-[#edf9f0] text-[#1f7549]",
        number: "bg-[#e5f4e9] text-[#176d42]",
        dot: "bg-[#2f8d5d]",
        button:
          "bg-[linear-gradient(90deg,#2f8d5d,#123f2d)] text-white shadow-[0_14px_28px_rgba(24,92,56,0.18)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(24,92,56,0.24)]",
      };
  }
}

function OverviewRow({
  label,
  value,
  priority,
}: {
  label: string;
  value: ReactNode;
  priority?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(112px,0.78fr)_minmax(0,1fr)] items-center gap-3 border-b border-[#e4e9e3] py-2.5 last:border-b-0">
      <dt className="text-[12px] font-[800] leading-5 text-[#4f5a53]">
        {label}
      </dt>
      <dd className="min-w-0 text-[12px] font-[500] leading-5 text-[#303a33]">
        {priority ? (
          <span className="inline-flex max-w-full items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f8d5d]" />
            <span className="truncate">{value}</span>
          </span>
        ) : (
          <span className="block truncate">{value}</span>
        )}
      </dd>
    </div>
  );
}

function ProjectTagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="block truncate">—</span>;
  }

  return (
    <span className="flex min-w-0 flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="max-w-full truncate rounded-full bg-[#edf7ef] px-2.5 py-1 text-[11px] font-[800] leading-4 text-[#2d8055]"
          title={tag}
        >
          {tag}
        </span>
      ))}
    </span>
  );
}

function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#eef8ef] text-brand">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-[20px] font-[800] leading-tight text-[#111712]">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[13px] font-[500] leading-5 text-[#5d6860]">
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectDetailWorkspace({
  project,
  currentUserId,
  completionSummary,
  completionWorkflow,
  assetsLoading = false,
  completionLoading = false,
}: ProjectDetailWorkspaceProps) {
  const allProjectStagesCompleted =
    project.stageCards.length > 0 &&
    project.stageCards.every((stage) => stage.status === "completed");
  const shouldExpectCompletionWorkflow =
    Boolean(completionSummary?.isCompleted) ||
    Boolean(completionSummary?.allStagesCompleted);
  const shouldShowCompletionChecklist =
    Boolean(completionWorkflow) && shouldExpectCompletionWorkflow;
  const shouldShowCompletionLoading =
    completionLoading &&
    (project.statusLabel.toLowerCase() === "completed" || allProjectStagesCompleted);
  const finalStageArchiveHref = completionSummary?.finalStageId
    ? `/projects/${project.id}/chat?stage=${completionSummary.finalStageId}`
    : `/projects/${project.id}/chat`;

  return (
    <section className="mx-auto w-full max-w-[1420px]">
      <ProjectAccessRealtimeGuard projectId={project.id} currentUserId={currentUserId} />
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_410px]">
        <MotionItem y={10} className="min-w-0 space-y-5">
          <div className="relative isolate overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#123f2d_0%,#19553a_56%,#1a6845_100%)] px-5 py-5 text-white shadow-[0_22px_52px_rgba(16,49,31,0.18)] sm:px-7 sm:py-6">
            <div className="pointer-events-none absolute -right-10 -top-12 h-56 w-56 rounded-full border border-white/10" />
            <div className="pointer-events-none absolute -right-4 bottom-[-76px] text-white/8">
              <Leaf className="h-72 w-72 rotate-[-22deg]" strokeWidth={1.1} />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(123,214,105,0.18),transparent_30%),radial-gradient(circle_at_100%_100%,rgba(255,255,255,0.09),transparent_34%)]" />

            <div className="relative flex min-w-0 flex-col gap-6 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
                <div className="grid size-[86px] shrink-0 place-items-center rounded-[22px] bg-white text-brand shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
                  <FolderKanban className="h-11 w-11" strokeWidth={1.8} />
                </div>

                <div className="min-w-0">
                  <h1 className="line-clamp-2 text-[26px] font-[800] leading-[1.08] sm:text-[30px]">
                    {project.title}
                  </h1>
                  <p className="mt-2 text-[18px] font-[800] leading-tight text-[#83db71]">
                    {project.category}
                  </p>

                  <div className="mt-6 flex min-w-0 items-center gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-white/20 bg-white/10">
                      <UserRound className="h-4 w-4 text-white/90" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-[600] leading-4 text-white/62">
                        Project Owner
                      </p>
                      <p className="min-w-0 whitespace-normal break-words text-[13px] font-[800] leading-5 text-white">
                        {project.createdBy}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-3 2xl:w-auto 2xl:shrink-0 2xl:justify-end">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[#78d47d]/55 bg-white/12 px-4 py-2 text-[13px] font-[800] leading-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur">
                  <span className="min-w-0 truncate">{project.currentStageName}</span>
                  <span className="shrink-0 text-[#83db71]">· {project.statusLabel}</span>
                </span>
                {project.isCompleted ? (
                  <span className="inline-flex rounded-full border border-white/18 bg-white/10 px-3.5 py-2 text-[12px] font-[800] leading-5 text-white/78 backdrop-blur">
                    Completed project · editing locked
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#dfe7de] bg-white px-5 py-5 shadow-[0_18px_45px_rgba(23,39,28,0.06)] sm:px-6 sm:py-6">
            <SectionHeading
              icon={<ClipboardList className="h-5 w-5" />}
              title="Project Stages"
              subtitle="Open a stage to continue discussion and revision work. Use compare from the stage flow."
            />

            {project.stageCards.length > 0 ? (
              <MotionStaggerGroup
                className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2"
                stagger={0.045}
              >
                {project.stageCards.map((stage) => {
                  const statusMeta = getStageStatusMeta(stage);
                  const stageOpenable = stage.status === "in-progress";
                  const stageCompleted = stage.status === "completed";
                  const stageDisabledTitle =
                    stage.status === "on-hold"
                      ? "This stage is on hold."
                      : "This stage is not active yet.";
                  const stageButtonLabel = stageCompleted ? "View Stage" : "Open Stage";
                  const disabledStageButtonLabel =
                    stage.status === "on-hold" ? "On Hold" : "Pending";

                  return (
                    <MotionItem key={stage.id} y={10} className="min-w-0">
                      <div
                        className={`flex min-h-[286px] min-w-0 flex-col rounded-[16px] border border-[#dfe6df] border-l-[4px] ${statusMeta.accent} bg-[linear-gradient(135deg,#ffffff,#fbfdfb)] px-5 py-5 shadow-[0_14px_34px_rgba(18,35,23,0.045)]`}
                      >
                        <div className="space-y-3">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <span
                              className={`grid size-10 shrink-0 place-items-center rounded-[12px] text-[15px] font-[800] ${statusMeta.number}`}
                            >
                              {formatStageNumber(stage.order)}
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-[800] leading-4 ${statusMeta.statusPill}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                              {statusMeta.label}
                            </span>
                          </div>
                          <h3 className="w-full whitespace-normal break-words text-[16px] font-[800] leading-6 text-[#111712]">
                            {stage.name}
                          </h3>
                        </div>

                        <div className="mt-5">
                          <StageActivitySummary
                            projectId={project.id}
                            stageId={stage.id}
                            fallbackSummary={getStageActivityFallback(stage)}
                          />
                        </div>

                        <div className="my-5 border-t border-dashed border-[#d5ddd4]" />

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                            <div className="min-w-0">
                              <p className="text-[10px] font-[800] leading-4 text-[#6a746d]">
                                Created on
                              </p>
                              <p className="truncate text-[12px] font-[800] leading-5 text-[#18211a]">
                                {stage.createdOn}
                              </p>
                            </div>
                          </div>
                          <div className="flex min-w-0 items-start gap-2.5">
                            <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                            <div className="min-w-0">
                              <p className="text-[10px] font-[800] leading-4 text-[#6a746d]">
                                Stage Budget
                              </p>
                              <p className="truncate text-[12px] font-[800] leading-5 text-[#18211a]">
                                {stage.budget}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-auto pt-5">
                          {stageOpenable || stageCompleted ? (
                            <Button
                              asChild
                              className={`relative h-[48px] w-full justify-center rounded-full px-5 text-[13px] font-[800] ${statusMeta.button}`}
                            >
                              <Link href={`/projects/${project.id}/chat?stage=${stage.id}`}>
                                {stageButtonLabel}
                                <ChevronRight className="absolute right-4 h-4 w-4" />
                              </Link>
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              disabled
                              title={stageDisabledTitle}
                              className={`relative h-[48px] w-full cursor-not-allowed justify-center rounded-full px-5 text-[13px] font-[800] disabled:opacity-100 ${statusMeta.button}`}
                            >
                              {disabledStageButtonLabel}
                              <ChevronRight className="absolute right-4 h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </MotionItem>
                  );
                })}
              </MotionStaggerGroup>
            ) : (
              <div className="mt-6 rounded-[18px] border border-dashed border-[#d7ded7] bg-[#fbfcfa] px-5 py-9 text-center text-[14px] font-[600] text-[#6e776f]">
                No stages are attached to this project yet.
              </div>
            )}
          </div>

          {completionSummary?.canCompleteProject ? (
            <Card className="rounded-[24px] border border-[#bddfc7] bg-[linear-gradient(135deg,#f6fff7,#eaf8ee)] shadow-[0_18px_45px_rgba(23,39,28,0.06)]">
              <CardContent className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <p className="text-[12px] font-[800] uppercase tracking-[0.08em] text-[#2f8d5d]">
                    Ready for archive
                  </p>
                  <h2 className="mt-1 text-[20px] font-[800] leading-tight text-[#111712]">
                    Archive final project files
                  </h2>
                  <p className="mt-2 text-[13px] font-[500] leading-6 text-[#536158]">
                    All stages are completed. {completionSummary.approvedFileCount} final file
                    {completionSummary.approvedFileCount === 1 ? "" : "s"} ready for archive.
                  </p>
                </div>
                <Button asChild className="min-h-[46px] shrink-0 rounded-full px-6 text-[13px] font-[800]">
                  <Link href={finalStageArchiveHref}>Archive Final Files</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {completionSummary?.isFinalCompletionPending ? (
            <Card className="rounded-[24px] border border-[#efd9af] bg-[#fffaf0] shadow-none">
              <CardContent className="px-5 py-5 sm:px-6">
                <p className="text-[14px] font-[800] text-[#8a5718]">
                  Final completion requirements must be resolved before archive.
                </p>
                {completionSummary.finalCompletionBlockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[12px] leading-5 text-[#5d4a2f]">
                    {completionSummary.finalCompletionBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {shouldShowCompletionLoading ? (
            <CompletionLoadingCard />
          ) : completionSummary?.isCompleted || shouldShowCompletionChecklist ? (
            <MotionStaggerGroup className="space-y-4" stagger={0.04}>
              {completionSummary?.isCompleted ? (
                <MotionItem y={10}>
                  <CompletedProjectArchiveSummaryCard completionSummary={completionSummary} />
                </MotionItem>
              ) : null}
              {shouldShowCompletionChecklist ? (
                <MotionItem y={10}>
                  <ProjectCompletionChecklist
                    projectId={project.id}
                    workflow={completionWorkflow}
                  />
                </MotionItem>
              ) : null}
            </MotionStaggerGroup>
          ) : null}

          <div className="grid gap-4 rounded-[24px] border border-[#dfe7de] bg-white px-5 py-5 shadow-[0_18px_45px_rgba(23,39,28,0.05)] sm:grid-cols-[64px_minmax(0,1fr)] sm:px-6 sm:py-6">
            <div className="grid size-16 place-items-center rounded-[18px] bg-[#eaf6ee] text-brand">
              <FileText className="h-8 w-8" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[20px] font-[800] leading-tight text-[#111712]">
                Project Brief
              </h2>
              <div className="dashboard-scroll-thin mt-2 max-h-[18rem] overflow-y-auto break-words pr-3 text-left text-[14px] font-[500] leading-6 text-[#303a33]">
                <RichTextContent value={project.description} fallback="Project brief is not available." />
              </div>
            </div>
          </div>
        </MotionItem>

        <aside className="dashboard-scroll-thin min-w-0 space-y-5 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-12rem)] xl:overflow-y-auto xl:pr-1">
          <Card className="rounded-[24px] border border-[#e0e7df] bg-white shadow-[0_18px_45px_rgba(23,39,28,0.055)]">
            <CardContent className="px-5 py-5">
              <SectionHeading
                icon={<ClipboardList className="h-5 w-5" />}
                title="Project Overview"
              />
              <dl className="mt-4">
                <OverviewRow label="Execution Type" value={project.executionTypeLabel} />
                <OverviewRow label="Budget" value={project.budget} />
                <OverviewRow label="Stages" value={project.stageCount} />
                <OverviewRow label="Project Started" value={project.startDate} />
                <OverviewRow label="Project Deadline" value={project.endDate} />
                <OverviewRow label="Executor" value={project.executorDisplayName} />
                <OverviewRow label="Project Tags" value={<ProjectTagChips tags={project.tags} />} />
                <OverviewRow label="Priority" value={project.priority} priority />
              </dl>
            </CardContent>
          </Card>

          {project.canViewParticipants ? (
            <>
              <ProjectExecutorsPanel executors={project.executors} />

              <ProjectDetailCollaboratorsPanel
                projectId={project.id}
                collaborators={project.collaborators}
                canRemoveCollaborators={
                  project.canRemoveCollaborators && !project.isCompleted
                }
              />
            </>
          ) : null}

          <Card className="rounded-[24px] border border-[#e0e7df] bg-white shadow-[0_18px_45px_rgba(23,39,28,0.055)]">
            <CardHeader className="px-5 pb-3 pt-5">
              <SectionHeading
                icon={<BadgeDollarSign className="h-5 w-5" />}
                title="Project Assets"
              />
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-0">
              {assetsLoading ? (
                <DetailAssetsSkeleton />
              ) : project.attachments.length > 0 ? (
                <div className="space-y-2.5">
                  {project.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-start justify-between gap-3 rounded-[18px] border border-[#e2e8e1] bg-[#fbfcfa] px-3.5 py-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <AssetImageThumbnail
                          fileName={attachment.originalFileName}
                          mimeType={attachment.mimeType}
                          previewPath={attachment.previewPath}
                          downloadPath={attachment.downloadPath}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-[800] leading-5 text-[#243028]">
                            {attachment.originalFileName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] font-[600] leading-4 text-[#7a837b]">
                            <span>{attachment.fileSizeLabel}</span>
                            <span>·</span>
                            <span>{attachment.uploadedBy}</span>
                            <span>·</span>
                            <span>{attachment.uploadedAt}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <AssetPreviewButton
                          fileName={attachment.originalFileName}
                          mimeType={attachment.mimeType}
                          previewPath={attachment.previewPath}
                          downloadPath={attachment.downloadPath}
                          triggerClassName="size-8 text-brand"
                        />
                        <AttachmentFavoriteButton
                          attachmentId={attachment.id}
                          initialIsFavorited={attachment.isFavoritedByCurrentUser}
                          className="size-8 text-[#7a847d] hover:bg-[#fff4f5]"
                        />
                        <Button
                          asChild
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-brand"
                        >
                          <a
                            href={attachment.downloadPath}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Download ${attachment.originalFileName}`}
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-[#d7ded7] bg-[#fbfcfa] px-4 py-7 text-center text-[13px] font-[600] text-[#6e776f]">
                  No project-level attachments uploaded yet.
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </section>
  );
}

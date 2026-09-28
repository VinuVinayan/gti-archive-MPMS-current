"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowRight,
  Clock3,
  Ellipsis,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import {
  deleteProjectAction,
  toggleProjectPinAction,
} from "@/app/(dashboard)/projects/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ProjectCardPerson = {
  id: string;
  name: string;
  email: string;
};

export type ProjectCardItem = {
  id: string;
  title: string;
  businessStatus: "ACTIVE" | "COMPLETED" | null;
  statusLabel: "Active" | "Completed" | null;
  workflowHealth: "VALID" | "MISSING" | "INVALID";
  workflowDiagnosticLabel: "Workflow Missing" | "Legacy Project" | null;
  showWorkflowDiagnostic: boolean;
  currentStageNumber: number | null;
  currentStageName: string | null;
  stageStatuses: Array<"LOCKED" | "AVAILABLE" | "COMPLETED">;
  owner: ProjectCardPerson | null;
  executors: ProjectCardPerson[];
  updatedLabel: string;
  updatedAt: string;
  isPinned: boolean;
  canPin: boolean;
  canDelete: boolean;
  canEdit: boolean;
};

type ProjectCardProps = {
  project: ProjectCardItem;
  returnHref?: string;
};

const avatarColors = [
  "bg-[#27905b]",
  "bg-[#55708b]",
  "bg-[#825f83]",
  "bg-[#8a674b]",
] as const;

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}

function avatarColor(id: string) {
  const sum = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return avatarColors[sum % avatarColors.length];
}

function PersonAvatar({ person, size = "md" }: { person: ProjectCardPerson; size?: "sm" | "md" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-[700] text-white ${
        size === "sm" ? "size-7 text-[9px]" : "size-8 text-[10px]"
      } ${avatarColor(person.id)}`}
      title={`${person.name} · ${person.email}`}
      aria-label={person.name}
    >
      {initials(person.name)}
    </span>
  );
}

function WorkflowProgress({ project }: { project: ProjectCardItem }) {
  return (
    <div className="relative mt-4 grid grid-cols-7 items-center" aria-label={`Stage ${project.currentStageNumber} of 7`}>
      <span className="absolute left-[7%] right-[7%] top-[13px] h-px bg-[#dce3dc]" aria-hidden="true" />
      {project.stageStatuses.map((stageStatus, index) => {
        const stageNumber = index + 1;
        const completed = stageStatus === "COMPLETED";
        const current = project.currentStageNumber === stageNumber;
        const reached = completed || current;

        return (
          <div key={stageNumber} className="relative z-[1] flex flex-col items-center gap-1.5">
            <span
              className={`grid size-[27px] place-items-center rounded-full border text-[10px] font-[700] transition-colors ${
                current
                  ? "border-[#177143] bg-[#207d4d] text-white ring-2 ring-white outline outline-1 outline-[#177143]"
                  : reached
                    ? "border-[#2a9259] bg-[#2a9259] text-white"
                    : "border-[#d7ddd7] bg-[#f1f3f1] text-[#737a74]"
              }`}
            >
              {stageNumber}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectCard({ project, returnHref }: ProjectCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [pinError, setPinError] = useState<string>();
  const projectHref = returnHref
    ? `/projects/${project.id}?returnTo=${encodeURIComponent(returnHref)}`
    : `/projects/${project.id}`;
  const editProjectHref = returnHref
    ? `/projects/${project.id}/edit?returnTo=${encodeURIComponent(returnHref)}`
    : `/projects/${project.id}/edit`;
  const visibleExecutors = project.executors.slice(0, 3);
  const hiddenExecutorCount = Math.max(0, project.executors.length - visibleExecutors.length);
  const statusClass = "border-[#d1ead9] bg-[#eaf7ee] text-[#197143]";

  function handleTogglePin() {
    setPinError(undefined);
    startTransition(async () => {
      try {
        await toggleProjectPinAction(project.id);
        router.refresh();
      } catch {
        setPinError("Unable to update the pin right now.");
      }
    });
  }

  function handleDelete() {
    setDeleteError(undefined);
    startTransition(async () => {
      try {
        await deleteProjectAction(project.id);
        setConfirmOpen(false);
        router.refresh();
      } catch {
        setDeleteError("Unable to delete the project right now. Please try again.");
      }
    });
  }

  return (
    <>
      <Card className="h-full rounded-[22px] border border-[#e1e7e0] bg-white p-5 shadow-[0_14px_36px_rgba(23,39,28,0.045)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,39,28,0.07)]">
        <CardContent className="flex h-full flex-col p-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {project.statusLabel ? (
                <span className={`rounded-full border px-3 py-1 text-[11px] font-[700] ${statusClass}`}>
                  {project.statusLabel}
                </span>
              ) : null}
              {project.showWorkflowDiagnostic && project.workflowDiagnosticLabel ? (
                <span
                  className="rounded-full border border-[#ded9c9] bg-[#f7f5ed] px-3 py-1 text-[11px] font-[700] text-[#736748]"
                  title="This project was created before the current workflow or has incomplete workflow data."
                >
                  {project.workflowDiagnosticLabel}
                </span>
              ) : null}
              {project.isPinned ? <Pin className="size-3.5 text-[#267c4f]" aria-label="Pinned" /> : null}
            </div>

            {project.canPin || project.canDelete || project.canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    className="size-8 rounded-[10px] text-[#4f5951] hover:bg-[#f2f6f2]"
                    aria-label={`Project actions for ${project.title}`}
                  >
                    <Ellipsis className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[190px] rounded-[16px]">
                  {project.canEdit ? (
                    <DropdownMenuItem asChild>
                      <Link href={editProjectHref}>
                        <Pencil className="size-4" /> Edit project
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {project.canPin ? (
                    <DropdownMenuItem onSelect={handleTogglePin}>
                      {project.isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                      {project.isPinned ? "Unpin project" : "Pin project"}
                    </DropdownMenuItem>
                  ) : null}
                  {project.canDelete ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setDeleteError(undefined);
                        setConfirmOpen(true);
                      }}
                    >
                      <Trash2 className="size-4" /> Delete project
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          <h2 className="mt-3 line-clamp-2 min-h-[30px] text-[20px] font-[700] leading-[1.25] tracking-[-0.025em] text-[#111612]">
            {project.title}
          </h2>
          {project.currentStageNumber && project.currentStageName ? (
            <p className="mt-1 text-[12px] text-[#6c746d]">
              Stage {project.currentStageNumber} of 7 · {project.currentStageName}
            </p>
          ) : null}

          {project.workflowHealth === "VALID" && project.currentStageNumber ? (
            <WorkflowProgress project={project} />
          ) : null}

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 border-t border-[#edf0ed] pt-3.5">
            <div className="min-w-0">
              <p className="text-[10px] font-[600] text-[#747c75]">Owner</p>
              {project.owner ? (
                <div className="mt-1.5 flex min-w-0 items-center gap-2">
                  <PersonAvatar person={project.owner} />
                  <span className="min-w-0 whitespace-normal break-words text-[12px] font-[500] text-[#303831]">{project.owner.name}</span>
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-[#9a6a24]">Unassigned</p>
              )}
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-[600] text-[#747c75]">Executors ({project.executors.length})</p>
              <div className="mt-1.5 flex min-h-8 items-center">
                {visibleExecutors.length > 0 ? (
                  <>
                    {visibleExecutors.map((executor, index) => (
                      <span key={executor.id} className={index > 0 ? "-ml-1" : ""}>
                        <PersonAvatar person={executor} size="sm" />
                      </span>
                    ))}
                    {hiddenExecutorCount > 0 ? (
                      <span className="-ml-1 grid size-7 place-items-center rounded-full border border-[#cfd6cf] bg-[#f2f4f2] text-[9px] font-[700] text-[#566057]">
                        +{hiddenExecutorCount}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[12px] text-[#397653]">Self-managed</span>
                )}
              </div>
            </div>
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[#7a827b]" title={project.updatedAt}>
            <Clock3 className="size-3.5" /> {project.updatedLabel}
          </p>

          <Button asChild variant="outline" className="mt-3 h-10 w-full rounded-[10px] border-[#c7d9cd] bg-white text-[12px] font-[700] text-[#16653d] hover:bg-[#f3faf5]">
            <Link href={projectHref}>
              View Project <ArrowRight className="ml-auto size-3.5" />
            </Link>
          </Button>

          {pinError ? <p className="mt-2 text-[11px] font-[600] text-[#b44d45]">{pinError}</p> : null}
        </CardContent>
      </Card>

      <ConfirmationDialog
        isOpen={confirmOpen}
        title="Delete Project"
        description={`Delete project “${project.title}”? This action cannot be undone.`}
        confirmLabel="Delete Project"
        cancelLabel="Keep Project"
        tone="destructive"
        pending={isPending}
        error={deleteError}
        onConfirm={handleDelete}
        onClose={() => {
          if (!isPending) {
            setConfirmOpen(false);
            setDeleteError(undefined);
          }
        }}
      />
    </>
  );
}

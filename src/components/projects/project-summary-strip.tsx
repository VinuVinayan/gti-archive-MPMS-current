"use client";

import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  Building2,
  UserRound,
  Users,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectStageShellRecord } from "@/lib/projects";
import { cn } from "@/lib/utils";

export type ProjectSummaryPerson = {
  id: string;
  name: string;
  email?: string | null;
};

type ProjectSummaryStripProps = {
  projectName: string;
  owner: ProjectSummaryPerson | null;
  coOwners: ProjectSummaryPerson[];
  executors: ProjectSummaryPerson[];
  emptyPeopleLabel?: string;
  executorEmptyLabel?: string;
  ownerEmptyLabel?: string;
  columns?: "responsive" | "two";
  className?: string;
};

function getInitials(name: string) {
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

function ProjectSummaryItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#edf5ef] text-[#32704e]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-[720] uppercase tracking-[0.075em] text-[#7b857e]">
          {label}
        </dt>
        <dd className="mt-1 min-w-0 text-[16px] font-[700] leading-6 text-[#253028]">
          {children}
        </dd>
      </div>
    </div>
  );
}

export function ProjectPeopleSummary({
  people,
  groupLabel,
  emptyLabel = "None",
  visibleCount = 1,
}: {
  people: ProjectSummaryPerson[];
  groupLabel: string;
  emptyLabel?: string;
  visibleCount?: number;
}) {
  if (!people.length) {
    return <span className="text-[#89928b]">{emptyLabel}</span>;
  }

  const visiblePeople = people.slice(0, visibleCount);
  const remainingCount = people.length - visiblePeople.length;
  const visibleNames = visiblePeople.map((person) => person.name).join(", ");

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 whitespace-normal break-words" title={visibleNames}>
        {visibleNames}
      </span>
      {remainingCount > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`View ${remainingCount} more ${groupLabel.toLocaleLowerCase("en")}`}
              className="inline-flex h-6 shrink-0 items-center rounded-full border border-[#cfe0d3] bg-[#edf6ef] px-2 text-[10px] font-[760] text-[#2d704b] transition hover:border-[#a9cab3] hover:bg-[#e3f1e7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8057] focus-visible:ring-offset-1"
            >
              +{remainingCount}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(320px,calc(100vw-32px))] p-2">
            <DropdownMenuLabel className="px-2 pb-2 pt-1">
              {groupLabel}
            </DropdownMenuLabel>
            <div className="max-h-[300px] overflow-y-auto">
              {people.map((person) => (
                <DropdownMenuItem
                  key={person.id}
                  onSelect={(event) => event.preventDefault()}
                  className="gap-3 px-2.5 py-2.5"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#eaf3ec] text-[10px] font-[760] text-[#2f7450]">
                    {getInitials(person.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 whitespace-normal break-words text-[12px] font-[680] text-[#28332b]" title={person.name}>
                      {person.name}
                    </span>
                    {person.email ? (
                      <span className="mt-0.5 block truncate text-[10px] font-[500] text-[#849087]">
                        {person.email}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function ProjectSummaryStrip({
  projectName,
  owner,
  coOwners,
  executors,
  emptyPeopleLabel = "None",
  executorEmptyLabel = emptyPeopleLabel,
  ownerEmptyLabel = "Not assigned",
  columns = "responsive",
  className,
}: ProjectSummaryStripProps) {
  return (
    <Card
      className={cn(
        "rounded-[18px] border-[#dfe6df] shadow-[0_10px_28px_rgba(23,39,28,0.04)]",
        className,
      )}
    >
      <CardContent className="px-4 py-4 sm:px-5">
        <dl
          className={cn(
            "grid min-w-0 gap-x-6 gap-y-4",
            columns === "two"
              ? "sm:grid-cols-2"
              : "sm:grid-cols-2 xl:grid-cols-4",
          )}
        >
          <ProjectSummaryItem
            icon={<Building2 className="h-[16px] w-[16px]" />}
            label="Project Name"
          >
            <span className="block truncate" title={projectName}>
              {projectName}
            </span>
          </ProjectSummaryItem>
          <ProjectSummaryItem
            icon={<UserRound className="h-[16px] w-[16px]" />}
            label="Project Owner"
          >
            <span className="block min-w-0 whitespace-normal break-words" title={owner?.name ?? ownerEmptyLabel}>
              {owner?.name ?? ownerEmptyLabel}
            </span>
          </ProjectSummaryItem>
          <ProjectSummaryItem
            icon={<Users className="h-[16px] w-[16px]" />}
            label="Project Co-Owners"
          >
            <ProjectPeopleSummary
              people={coOwners}
              groupLabel="Project Co-Owners"
              emptyLabel={emptyPeopleLabel}
            />
          </ProjectSummaryItem>
          <ProjectSummaryItem
            icon={<BriefcaseBusiness className="h-[16px] w-[16px]" />}
            label="Project Executors"
          >
            <ProjectPeopleSummary
              people={executors}
              groupLabel="Project Executors"
              emptyLabel={executorEmptyLabel}
              visibleCount={3}
            />
          </ProjectSummaryItem>
        </dl>
      </CardContent>
    </Card>
  );
}

export function ProjectFlowSummaryStrip({
  project,
  className,
  columns,
}: {
  project: ProjectStageShellRecord;
  className?: string;
  columns?: ProjectSummaryStripProps["columns"];
}) {
  const owner = project.collaborators.find(
    (collaborator) => collaborator.role === "Project Owner",
  );
  const coOwners = project.collaborators.filter(
    (collaborator) => collaborator.role === "Project Co-Owner",
  );
  const emptyPeopleLabel = project.canViewParticipants ? "None" : "Restricted";

  return (
    <ProjectSummaryStrip
      projectName={project.title}
      owner={owner ?? null}
      coOwners={coOwners}
      executors={project.executors}
      emptyPeopleLabel={emptyPeopleLabel}
      executorEmptyLabel={project.canViewParticipants ? "Self-managed" : "Restricted"}
      ownerEmptyLabel={project.ownerId ? "Restricted" : "Not assigned"}
      columns={columns}
      className={cn("mt-5", className)}
    />
  );
}

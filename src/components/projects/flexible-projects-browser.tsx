"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarDays, Milestone, PanelsTopLeft, Plus } from "lucide-react";

import { MotionItem, MotionSection, MotionStaggerGroup } from "@/components/motion/motion-primitives";
import { FlexibleProjectDialog } from "@/components/projects/flexible-project-dialog";
import { ProjectPageHeader } from "@/components/projects/project-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-editor";
import type { FlexibleProjectListItem, FlexibleProjectUserOption } from "@/lib/flexible-projects";
import { formatProjectPriority } from "@/lib/project-priority";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function FlexibleProjectCard({ project }: { project: FlexibleProjectListItem }) {
  return (
    <Card className="h-full overflow-hidden rounded-[22px] border border-[#dfe6df] bg-white shadow-[0_14px_36px_rgba(23,39,28,0.045)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,39,28,0.08)]">
      <CardContent className="flex h-full flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="border-[#d8e9dc] bg-[#f0f8f2] text-[#277a50]">
            {project.scope === "INTERNAL" ? "Internal" : "External"}
          </Badge>
          <Badge variant="muted" className="border-[#dfe5df] bg-[#f7f8f7] text-[#4e5851]">
            <span className={`mr-1.5 size-1.5 rounded-full ${project.status === "COMPLETED" ? "bg-[#708078]" : "bg-[#2f8d5d]"}`} />
            {project.status === "COMPLETED" ? "Completed" : "Active"}
          </Badge>
          <span className="ml-auto text-[11px] font-[700] text-[#768078]">
            {formatProjectPriority(project.priority)} priority
          </span>
        </div>

        <h2 className="mt-5 text-[21px] font-[750] leading-[1.2] tracking-[-0.03em] text-[#111712]">{project.name}</h2>
        {project.description ? (
          <RichTextContent value={project.description} className="mt-2 line-clamp-3 min-h-[63px] text-[13px] leading-[21px] text-[#6d756f]" />
        ) : (
          <p className="mt-2 min-h-[63px] text-[13px] leading-[21px] text-[#929a94]">No description added.</p>
        )}

        <div className="mt-5 rounded-[17px] border border-[#e4e9e3] bg-[#fafcf9] p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12px] font-[700] text-[#39433c]">Progress</span>
            <span className="text-[19px] font-[750] tracking-[-0.03em] text-[#176d42]">{project.progress}%</span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#e7ece7]">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#329462,#176b43)]" style={{ width: `${project.progress}%` }} />
          </div>
          <p className="mt-2.5 flex items-center gap-2 text-[11px] text-[#6e776f]">
            <Milestone className="size-3.5 text-[#38865c]" />
            {project.completedMilestones} of {project.totalMilestones} milestones complete
          </p>
        </div>

        <div className="mt-5 grid gap-3 border-t border-[#edf0ed] pt-4 sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#287e53] text-[9px] font-[750] text-white">{initials(project.owner.name)}</span>
            <div className="min-w-0">
              <p className="text-[10px] font-[600] text-[#838b85]">Owner</p>
              <p className="min-w-0 whitespace-normal break-words text-[12px] font-[650] text-[#333d36]">{project.owner.name}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f0f4f0] text-[#427058]"><CalendarDays className="size-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-[600] text-[#838b85]">Deadline</p>
              <p className="truncate text-[12px] font-[650] text-[#333d36]">{formatDate(project.deadline)}</p>
            </div>
          </div>
        </div>

        <Button asChild variant="outline" className="mt-5 h-11 w-full rounded-[12px] border-[#c6d9cc] bg-white text-[12px] font-[750] text-[#176b43] hover:bg-[#f3faf5]">
          <Link href={`/projects/flexible/${project.slug}`}>View Project <ArrowRight className="ml-auto size-4" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function FlexibleProjectsBrowser({
  canCreateProject,
  projects,
  users,
  currentUserId,
}: {
  canCreateProject: boolean;
  projects: FlexibleProjectListItem[];
  users: FlexibleProjectUserOption[];
  currentUserId: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="space-y-5">
      <MotionSection>
        <ProjectPageHeader
          title="Private Projects"
          description="Custom work organized with user-defined milestones rather than the fixed artwork stages."
          actions={canCreateProject ? (
            <Button type="button" onClick={() => setCreateOpen(true)} className="h-12 self-start rounded-full px-6 text-[14px] lg:self-auto">
              <Plus className="size-4" /> New Private Project
            </Button>
          ) : null}
        />
      </MotionSection>

      {projects.length ? (
        <MotionStaggerGroup className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3" stagger={0.05}>
          {projects.map((project) => (
            <MotionItem key={project.id} y={8} layout><FlexibleProjectCard project={project} /></MotionItem>
          ))}
        </MotionStaggerGroup>
      ) : (
        <MotionSection>
          <div className="rounded-[24px] border border-dashed border-[#cbd6cc] bg-white px-6 py-16 text-center shadow-[0_12px_34px_rgba(23,39,28,0.03)]">
            <PanelsTopLeft className="mx-auto size-9 text-[#75a086]" />
            <h3 className="mt-4 text-[18px] font-[750] text-[#202a23]">No private projects yet</h3>
            <p className="mt-1 text-[13px] text-[#717a73]">Projects you own or collaborate on will appear here.</p>
            {canCreateProject ? <Button type="button" onClick={() => setCreateOpen(true)} className="mt-5"><Plus className="size-4" /> New Private Project</Button> : null}
          </div>
        </MotionSection>
      )}

      {createOpen ? <FlexibleProjectDialog mode="create" users={users} currentUserId={currentUserId} onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

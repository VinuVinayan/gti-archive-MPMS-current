import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  File,
  Folder,
  FolderKey,
  ListTodo,
  LockKeyhole,
  ShieldCheck,
  UserRound,
  Upload,
} from "lucide-react";

import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import { Card, CardContent } from "@/components/ui/card";
import type { UserProjectWorkspaceData } from "@/lib/user-project-workspace";
import type {
  UserTaskDisplayStatus,
  UserTaskDotTone,
} from "@/lib/user-projects";

const taskBadgeClasses: Record<UserTaskDisplayStatus, string> = {
  NOT_STARTED: "bg-[#f0f2f0] text-[#667068]",
  IN_PROGRESS: "bg-[#eaf4ff] text-[#276fa8]",
  NEEDS_ATTENTION: "bg-[#fff0e8] text-[#c75a29]",
  WAITING_FOR_REVIEW: "bg-[#f3edff] text-[#7554b3]",
  COMPLETED: "bg-[#e8f6ec] text-[#28764c]",
};

const taskDotClasses: Record<UserTaskDotTone, string> = {
  gray: "bg-[#9ca39e]",
  blue: "bg-[#4b9ce8]",
  orange: "bg-[#ef6a43]",
  purple: "bg-[#8b68d6]",
  green: "bg-[#28a066]",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

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

function FolderArtwork({ privateFolder = false }: { privateFolder?: boolean }) {
  return (
    <span
      className={`relative grid size-12 shrink-0 place-items-center rounded-[14px] ${
        privateFolder
          ? "bg-[linear-gradient(145deg,#edf2ff,#e3eafb)] text-[#526aa0]"
          : "bg-[linear-gradient(145deg,#eaf5ed,#dceee2)] text-[#31805a]"
      }`}
    >
      {privateFolder ? (
        <FolderKey className="h-7 w-7" />
      ) : (
        <Folder className="h-7 w-7 fill-current opacity-90" />
      )}
    </span>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#eaf4ed] text-[#2e8057]">
        {icon}
      </span>
      <div>
        <h2 className="text-[20px] font-[760] tracking-[-0.025em] text-[#18211b]">
          {title}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-[#707a73]">
          {description}
        </p>
      </div>
    </div>
  );
}

export function UserProjectWorkspace({
  data,
  currentUserId,
}: {
  data: UserProjectWorkspaceData;
  currentUserId: string;
}) {
  return (
    <section className="mx-auto w-full max-w-[1420px] pb-8">
      <ProjectAccessRealtimeGuard
        projectId={data.project.id}
        currentUserId={currentUserId}
      />

      <header>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 text-[12px] font-[720] text-[#357653] transition hover:text-[#1c5d3c]"
        >
          <ArrowLeft className="h-4 w-4" /> My Projects
        </Link>
        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-[780] uppercase tracking-[0.13em] text-[#2f8057]">
              Project Workspace
            </p>
            <h1 className="mt-2 text-[32px] font-[790] leading-[1.08] tracking-[-0.045em] text-[#111713] sm:text-[42px]">
              {data.project.name}
            </h1>
            <p className="mt-3 max-w-[720px] text-[14px] leading-6 text-[#68736b]">
              Shared project references and your assigned work.
            </p>
          </div>
          {data.project.owner ? (
            <div className="flex w-fit items-center gap-3 rounded-[15px] border border-[#dfe6df] bg-white px-4 py-3 shadow-[0_10px_26px_rgba(23,39,28,0.04)]">
              <span className="grid size-9 place-items-center rounded-full bg-[#2d8057] text-[11px] font-[780] text-white">
                {initials(data.project.owner.name)}
              </span>
              <span>
                <span className="block text-[10px] font-[700] text-[#7a857d]">
                  Project Owner
                </span>
                <span className="mt-0.5 block text-[12px] font-[680] text-[#29342c]">
                  {data.project.owner.name}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="mt-8 border-t border-[#dfe6df] pt-6">
        <SectionHeading
          icon={<Folder className="h-5 w-5" />}
          title="Shared Folders"
          description="Share project files with your team in Brief and Tech."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:max-w-[920px]">
          {data.sharedFolders.map((folder) => {
            const content = (
              <CardContent className="flex min-h-[148px] items-center gap-4 p-5">
                <FolderArtwork />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-[740] text-[#202a23]">
                    {folder.name}
                  </span>
                  <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#edf3ef] px-2.5 py-1 text-[10px] font-[720] text-[#597065]">
                    {folder.canUpload ? <><Upload className="h-3.5 w-3.5" /> Upload files</> : <><ShieldCheck className="h-3.5 w-3.5" /> Read only</>}
                  </span>
                  <span className="mt-3 flex items-center gap-1.5 text-[11px] text-[#707b73]">
                    <File className="h-3.5 w-3.5" />
                    {folder.fileCount} {folder.fileCount === 1 ? "file" : "files"}
                  </span>
                </span>
                {folder.href ? (
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#77847b]" />
                ) : (
                  <span className="text-[10px] font-[700] text-[#929b94]">
                    Unavailable
                  </span>
                )}
              </CardContent>
            );

            return folder.href ? (
              <Card
                key={folder.key}
                className="rounded-[20px] border-[#dfe6df] shadow-[0_12px_30px_rgba(23,39,28,0.05)] transition hover:-translate-y-0.5 hover:border-[#bdd4c4] hover:shadow-[0_18px_38px_rgba(28,75,48,0.08)]"
              >
                <Link
                  href={folder.href}
                  className="block rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8057] focus-visible:ring-offset-2"
                >
                  {content}
                </Link>
              </Card>
            ) : (
              <Card
                key={folder.key}
                className="rounded-[20px] border-[#e3e7e3] bg-[#fbfcfb] opacity-80 shadow-none"
              >
                {content}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mt-8 border-t border-[#dfe6df] pt-6">
        <SectionHeading
          icon={<FolderKey className="h-5 w-5" />}
          title="Private Folders"
          description={
            data.canViewClassifiedFolders
              ? "Your files are yours alone. Other member folders are classified."
              : "Only your private folder is visible to you."
          }
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.myPrivateFolder ? (
            <Card className="rounded-[20px] border-[#cfdbea] shadow-[0_12px_30px_rgba(38,58,92,0.06)] transition hover:-translate-y-0.5 hover:border-[#aebfd8] hover:shadow-[0_18px_38px_rgba(38,58,92,0.1)]">
              <Link
                href={data.myPrivateFolder.href}
                className="block rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#526aa0] focus-visible:ring-offset-2"
              >
                <CardContent className="flex min-h-[148px] items-center gap-4 p-5">
                  <FolderArtwork privateFolder />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-[740] text-[#202a23]">
                      My Private Folder
                    </span>
                    <span className="mt-2 inline-flex rounded-full bg-[#edf1fb] px-2.5 py-1 text-[10px] font-[720] text-[#52688f]">
                      Owner only
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#71809e]" />
                </CardContent>
              </Link>
            </Card>
          ) : (
            <Card className="rounded-[20px] border-[#e3e7e3] bg-[#fbfcfb] shadow-none">
              <CardContent className="flex min-h-[148px] items-center gap-4 p-5">
                <FolderArtwork privateFolder />
                <span>
                  <span className="block text-[15px] font-[740] text-[#202a23]">
                    My Private Folder
                  </span>
                  <span className="mt-2 block text-[11px] text-[#8b948d]">
                    Temporarily unavailable
                  </span>
                </span>
              </CardContent>
            </Card>
          )}

          {data.canViewClassifiedFolders
            ? data.classifiedFolders.map((folder) => (
                <Card
                  key={folder.key}
                  title={`Classified — only ${folder.ownerName} can access this folder.`}
                  className="cursor-default rounded-[20px] border-[#e0e3e0] bg-[#f8f9f8] shadow-none"
                >
                  <CardContent className="flex min-h-[148px] items-center gap-4 p-5">
                    <span className="grid size-14 shrink-0 place-items-center rounded-[16px] bg-[#e8ebe9] text-[#69736c]">
                      <LockKeyhole className="h-8 w-8" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block min-w-0 whitespace-normal break-words text-[14px] font-[740] text-[#353d37]">
                        {folder.ownerName}&apos;s Folder
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-[#858e87]">
                        {folder.role}
                      </span>
                      <span className="mt-2 inline-flex rounded-full bg-[#e4e7e5] px-2.5 py-1 text-[10px] font-[800] uppercase tracking-[0.08em] text-[#59625c]">
                        Classified
                      </span>
                    </span>
                  </CardContent>
                </Card>
              ))
            : null}
        </div>
      </section>

      <section className="mt-8 border-t border-[#dfe6df] pt-6">
        <SectionHeading
          icon={<UserRound className="h-5 w-5" />}
          title="My Assigned Tasks"
          description="Tasks assigned directly to you."
        />

        {data.assignedConcepts.length > 0 ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.assignedConcepts.map((concept) => (
              <Card
                key={concept.id}
                className="relative min-w-0 rounded-[20px] border-[#dfe6df] shadow-[0_12px_30px_rgba(23,39,28,0.05)] transition hover:-translate-y-0.5 hover:border-[#bdd4c4] hover:shadow-[0_18px_38px_rgba(28,75,48,0.08)]"
              >
                <Link
                  href={concept.href}
                  className="absolute inset-0 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8057] focus-visible:ring-offset-2"
                  aria-label={`Open ${concept.name}`}
                />
                <CardContent className="flex min-h-[136px] items-center gap-4 p-5">
                  <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[#e7f2ea] text-[#30845a]">
                    <ListTodo className="h-7 w-7" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-[740] text-[#202a23]">
                      {concept.name}
                    </span>
                    <span
                      className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-[760] ${taskBadgeClasses[concept.display.status]}`}
                    >
                      <span
                        className={`size-2 rounded-full ${taskDotClasses[concept.display.dotTone]}`}
                      />
                      {concept.display.label}
                    </span>
                    {concept.dueAt ? (
                      <span className="mt-2 flex items-center gap-1.5 text-[10px] font-[680] text-[#657168]">
                        <CalendarClock className="h-3.5 w-3.5 text-[#2f8057]" />
                        Due {formatDate(concept.dueAt)}
                      </span>
                    ) : null}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#7b867e]" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-[20px] border border-dashed border-[#cfdacf] bg-[#f8faf8] px-6 py-10 text-center">
            <p className="text-[16px] font-[740] text-[#273129]">
              No concepts are assigned to you yet.
            </p>
            <p className="mt-1 text-[12px] text-[#748078]">
              Assigned concept work will appear here when it is ready.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}

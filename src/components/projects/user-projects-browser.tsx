"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useRef, useSyncExternalStore, useTransition } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import {
  MotionItem,
  MotionSection,
  MotionStaggerGroup,
} from "@/components/motion/motion-primitives";
import { ProjectPageHeader } from "@/components/projects/project-page-header";
import { ProjectTypeSwitcher } from "@/components/projects/project-type-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  UserProjectDisplayStatus,
  UserProjectFilter,
  UserProjectListItem,
  UserProjectSort,
  UserTaskDotTone,
} from "@/lib/user-projects";

type UserProjectsBrowserProps = {
  projects: UserProjectListItem[];
  projectCount: number;
  currentPage: number;
  pageSize: number;
  hasAnyProjects: boolean;
  activeFilter: UserProjectFilter;
  activeSort: UserProjectSort;
  query: string;
  showProjectTypeSwitcher: boolean;
};

type UserProjectsView = "grid" | "list";

const USER_PROJECTS_VIEW_STORAGE_KEY = "gti:user-projects:view";
const USER_PROJECTS_VIEW_EVENT = "gti:user-projects:view-change";

const filters: Array<{ label: string; value: UserProjectFilter }> = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Needs Attention", value: "NEEDS_ATTENTION" },
  { label: "Completed", value: "COMPLETED" },
];

const sortOptions: Array<{ label: string; value: UserProjectSort }> = [
  { label: "Priority", value: "priority" },
  { label: "Recently Updated", value: "updated" },
  { label: "Name A–Z", value: "name-asc" },
  { label: "Name Z–A", value: "name-desc" },
];

const taskDotClasses: Record<UserTaskDotTone, string> = {
  gray: "bg-[#9ca39e]",
  blue: "bg-[#4b9ce8]",
  orange: "bg-[#ef6a43]",
  purple: "bg-[#8b68d6]",
  green: "bg-[#28a066]",
};

const projectStatusClasses: Record<UserProjectDisplayStatus, string> = {
  NO_ASSIGNED_TASKS: "border-[#dce1dd] bg-[#f3f5f3] text-[#69716b]",
  IN_PROGRESS: "border-[#cfe4f8] bg-[#edf6ff] text-[#2370ad]",
  NEEDS_ATTENTION: "border-[#f5d8c3] bg-[#fff4e9] text-[#d85b22]",
  WAITING_FOR_REVIEW: "border-[#e3d9f5] bg-[#f5f0ff] text-[#7651b6]",
  COMPLETED: "border-[#cfe9da] bg-[#edf8f1] text-[#24784c]",
};

const avatarColors = [
  "bg-[#27905b]",
  "bg-[#55708b]",
  "bg-[#825f83]",
  "bg-[#b26c4b]",
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
  const sum = [...id].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return avatarColors[sum % avatarColors.length];
}

function OwnerAvatar({ owner }: { owner: NonNullable<UserProjectListItem["owner"]> }) {
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full text-[9px] font-[800] text-white ${avatarColor(owner.id)}`}
      aria-hidden="true"
    >
      {initials(owner.name)}
    </span>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(date);
}

function taskCountLabel(count: number) {
  return `${count} assigned ${count === 1 ? "task" : "tasks"}`;
}

function subscribeToViewPreference(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(USER_PROJECTS_VIEW_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(USER_PROJECTS_VIEW_EVENT, onStoreChange);
  };
}

function getViewPreferenceSnapshot(): UserProjectsView {
  return window.localStorage.getItem(USER_PROJECTS_VIEW_STORAGE_KEY) === "list"
    ? "list"
    : "grid";
}

function getServerViewPreferenceSnapshot(): UserProjectsView {
  return "grid";
}

function ProjectStatusBadge({ project }: { project: UserProjectListItem }) {
  return (
    <span
      className={`inline-flex w-fit rounded-full border px-3 py-1 text-[11px] font-[750] ${projectStatusClasses[project.status]}`}
    >
      {project.statusLabel}
    </span>
  );
}

function TaskDots({ project }: { project: UserProjectListItem }) {
  const visibleTasks = project.tasks.slice(0, 5);
  const hiddenCount = Math.max(0, project.tasks.length - visibleTasks.length);

  if (project.tasks.length === 0) {
    return <span className="text-[11px] text-[#8a928b]">No task activity</span>;
  }

  return (
    <div className="flex min-h-6 items-center gap-2" aria-label="Assigned task statuses">
      {visibleTasks.map((task, index) => {
        const tooltipId = `${task.key}-tooltip`;
        return (
          <button
            key={task.key}
            type="button"
            aria-describedby={tooltipId}
            aria-label={`${task.name}: ${task.display.label}`}
            className="group relative grid size-5 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#247c4e] focus-visible:ring-offset-2"
          >
            <span
              className={`size-3.5 rounded-full ring-2 ring-white ${taskDotClasses[task.display.dotTone]}`}
              aria-hidden="true"
            />
            <span
              id={tooltipId}
              role="tooltip"
              className={`pointer-events-none absolute bottom-[calc(100%+9px)] z-30 w-max max-w-[220px] rounded-[10px] bg-[#17251d] px-3 py-2 text-left text-[11px] leading-4 text-white opacity-0 shadow-[0_12px_28px_rgba(12,28,18,0.22)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                index === 0 ? "left-0" : "left-1/2 -translate-x-1/2"
              }`}
            >
              <strong className="block font-[750]">{task.name}</strong>
              <span className="text-white/75">{task.display.label}</span>
            </span>
          </button>
        );
      })}
      {hiddenCount > 0 ? (
        <span className="text-[11px] font-[750] text-[#6d756f]">+{hiddenCount}</span>
      ) : null}
    </div>
  );
}

function UserProjectGridCard({
  project,
  returnHref,
}: {
  project: UserProjectListItem;
  returnHref: string;
}) {
  const projectHref = `/projects/${project.id}?returnTo=${encodeURIComponent(returnHref)}`;

  return (
    <Card className="h-full rounded-[20px] border border-[#dde4dd] bg-white p-5 shadow-[0_14px_36px_rgba(23,39,28,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(23,39,28,0.07)]">
      <CardContent className="flex h-full flex-col p-0">
        <ProjectStatusBadge project={project} />

        <h2 className="mt-3 line-clamp-2 text-[18px] font-[750] leading-[1.25] tracking-[-0.025em] text-[#111612]">
          {project.title}
        </h2>
        {project.description ? (
          <p className="mt-1.5 line-clamp-2 min-h-10 text-[12px] leading-5 text-[#6e766f]">
            {project.description}
          </p>
        ) : (
          <div className="min-h-10" aria-hidden="true" />
        )}

        <div className={`mt-4 grid gap-4 ${project.dueAt ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="min-w-0">
            <p className="text-[10px] font-[650] text-[#7b837c]">Owner</p>
            {project.owner ? (
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <OwnerAvatar owner={project.owner} />
                <span className="min-w-0 whitespace-normal break-words text-[12px] font-[550] text-[#303831]">
                  {project.owner.name}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-[#8a928b]">Not assigned</p>
            )}
          </div>

          {project.dueAt ? (
            <div className="min-w-0">
              <p className="text-[10px] font-[650] text-[#7b837c]">Due date</p>
              <p className="mt-2 flex items-center gap-1.5 text-[12px] font-[550] text-[#303831]">
                <CalendarDays className="size-3.5 text-[#687269]" />
                <time dateTime={project.dueAt}>{formatDate(project.dueAt)}</time>
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-4 border-t border-[#edf0ed] pt-3">
          <p className="text-[12px] font-[550] text-[#59625b]">
            {taskCountLabel(project.tasks.length)}
          </p>
          <div className="mt-2">
            <TaskDots project={project} />
          </div>
        </div>

        <Button
          asChild
          variant="outline"
          className="mt-4 h-10 w-full rounded-[11px] border-[#c7d9cd] bg-white text-[12px] font-[750] text-[#16653d] hover:bg-[#f3faf5]"
        >
          <Link href={projectHref}>
            Open Workspace <ArrowRight className="ml-auto size-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function UserProjectListRow({
  project,
  returnHref,
}: {
  project: UserProjectListItem;
  returnHref: string;
}) {
  const projectHref = `/projects/${project.id}?returnTo=${encodeURIComponent(returnHref)}`;

  return (
    <Card className="rounded-[20px] border border-[#dde4dd] bg-white shadow-[0_12px_30px_rgba(23,39,28,0.035)] transition hover:shadow-[0_16px_36px_rgba(23,39,28,0.06)]">
      <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(120px,0.7fr)_minmax(240px,2fr)_minmax(160px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)_40px] lg:items-center">
        <ProjectStatusBadge project={project} />

        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-[750] tracking-[-0.02em] text-[#111612]">
            {project.title}
          </h2>
          {project.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#6e766f]">
              {project.description}
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-[650] text-[#7b837c]">Owner</p>
          {project.owner ? (
            <div className="mt-1.5 flex min-w-0 items-center gap-2">
              <OwnerAvatar owner={project.owner} />
              <span className="min-w-0 whitespace-normal break-words text-[12px] font-[550] text-[#303831]">
                {project.owner.name}
              </span>
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] text-[#8a928b]">Not assigned</p>
          )}
        </div>

        <div>
          <p className="text-[10px] font-[650] text-[#7b837c]">Last updated</p>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-[550] text-[#303831]">
            <Clock3 className="size-3.5 text-[#687269]" />
            <time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
          </p>
        </div>

        <div>
          <p className="text-[10px] font-[650] text-[#7b837c]">My Tasks</p>
          <p className="mt-1 text-[12px] font-[550] text-[#4c554e]">
            {taskCountLabel(project.tasks.length)}
          </p>
          <div className="mt-1.5">
            <TaskDots project={project} />
          </div>
        </div>

        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-10 justify-self-end rounded-full text-[#17633d] hover:bg-[#edf6f0]"
        >
          <Link href={projectHref} aria-label={`Open workspace for ${project.title}`}>
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function UserProjectsSkeleton({ view }: { view: UserProjectsView }) {
  if (view === "list") {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[126px] rounded-[20px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-[330px] rounded-[20px]" />
      ))}
    </div>
  );
}

export function UserProjectsBrowser({
  projects,
  projectCount,
  currentPage,
  pageSize,
  hasAnyProjects,
  activeFilter,
  activeSort,
  query,
  showProjectTypeSwitcher,
}: UserProjectsBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const view = useSyncExternalStore(
    subscribeToViewPreference,
    getViewPreferenceSnapshot,
    getServerViewPreferenceSnapshot,
  );
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.toString();
  const currentProjectsHref = currentSearch ? `${pathname}?${currentSearch}` : pathname;
  const hasActiveFilters = Boolean(query || activeFilter !== "ALL");
  const totalPages = Math.max(1, Math.ceil(projectCount / pageSize));

  function changeView(nextView: UserProjectsView) {
    window.localStorage.setItem(USER_PROJECTS_VIEW_STORAGE_KEY, nextView);
    window.dispatchEvent(new Event(USER_PROJECTS_VIEW_EVENT));
  }

  function navigate(next: {
    filter?: UserProjectFilter;
    sort?: UserProjectSort;
    query?: string;
    page?: number;
  }) {
    const filter = next.filter ?? activeFilter;
    const sort = next.sort ?? activeSort;
    const searchQuery = (
      next.query ?? searchInputRef.current?.value ?? query
    ).trim();
    const page = next.page ?? 1;
    const params = new URLSearchParams();

    if (searchQuery) params.set("q", searchQuery);
    if (filter !== "ALL") params.set("status", filter);
    if (sort !== "priority") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    const href = params.size > 0 ? `${pathname}?${params}` : pathname;
    startTransition(() => router.push(href, { scroll: false }));
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ query: searchInputRef.current?.value ?? "" });
  }

  function clearFilters() {
    if (searchInputRef.current) searchInputRef.current.value = "";
    startTransition(() => router.push(pathname, { scroll: false }));
  }

  return (
    <div className="space-y-6">
      {showProjectTypeSwitcher ? (
        <ProjectTypeSwitcher activeView="collaborative" />
      ) : null}
      <MotionSection>
        <header className="space-y-5">
          <ProjectPageHeader
            title="My Projects"
            description="Your workspace for assigned work and deliverables."
            actions={
              <div
                role="group"
                aria-label="Project layout"
                className="inline-flex w-fit rounded-[14px] border border-[#d6ded7] bg-white p-1 shadow-[0_8px_22px_rgba(18,34,25,0.035)]"
              >
                {(["grid", "list"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    onClick={() => changeView(option)}
                    className={`flex h-10 items-center gap-2 rounded-[10px] px-4 text-[13px] font-[700] capitalize transition ${
                      view === option
                        ? "bg-[linear-gradient(90deg,#2f8d5d,#123f2d)] text-white shadow-[0_8px_18px_rgba(31,112,70,0.2)]"
                        : "text-[#445047] hover:bg-[#f1f5f1]"
                    }`}
                  >
                    {option === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
                    {option}
                  </button>
                ))}
              </div>
            }
          />

          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-[14px] border border-[#d5ded6] bg-white p-1 shadow-[0_8px_22px_rgba(18,34,25,0.035)]">
              {filters.map((filter) => (
                <Button
                  key={filter.value}
                  type="button"
                  variant={activeFilter === filter.value ? "default" : "ghost"}
                  onClick={() => navigate({ filter: filter.value })}
                  className={`h-10 shrink-0 rounded-[10px] px-5 text-[13px] ${
                    activeFilter === filter.value
                      ? "shadow-[0_8px_18px_rgba(31,112,70,0.2)]"
                      : "text-[#303a32]"
                  }`}
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
              <form onSubmit={handleSearchSubmit} className="w-full sm:min-w-[300px] xl:w-[360px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#8b958e]" />
                  <Input
                    key={query}
                    ref={searchInputRef}
                    type="search"
                    defaultValue={query}
                    placeholder="Search projects..."
                    className="h-12 rounded-[14px] border-[#dce3dc] bg-white pl-11 pr-4 text-[13px] shadow-[0_8px_22px_rgba(18,34,25,0.03)]"
                  />
                  <button type="submit" className="sr-only">Search</button>
                </label>
              </form>

              <Select
                value={activeSort}
                onValueChange={(value) => navigate({ sort: value as UserProjectSort })}
              >
                <SelectTrigger className="h-12 w-full rounded-[14px] border border-[#d8e0d8] px-4 sm:w-[215px]">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      Sort: {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>
      </MotionSection>

      {isPending ? (
        <UserProjectsSkeleton view={view} />
      ) : projects.length > 0 ? (
        view === "grid" ? (
          <MotionStaggerGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" stagger={0.04}>
            {projects.map((project) => (
              <MotionItem key={project.id} y={8} layout>
                <UserProjectGridCard project={project} returnHref={currentProjectsHref} />
              </MotionItem>
            ))}
          </MotionStaggerGroup>
        ) : (
          <MotionStaggerGroup className="space-y-3" stagger={0.035}>
            {projects.map((project) => (
              <MotionItem key={project.id} y={6} layout>
                <UserProjectListRow project={project} returnHref={currentProjectsHref} />
              </MotionItem>
            ))}
          </MotionStaggerGroup>
        )
      ) : (
        <MotionItem y={8}>
          <Card className="min-h-[260px] rounded-[22px] border-[#e1e7e0] bg-white text-center shadow-[0_14px_36px_rgba(23,39,28,0.04)]">
            <CardContent className="flex min-h-[260px] flex-col items-center justify-center p-8">
              <h2 className="text-[23px] font-[700] tracking-[-0.025em] text-[#111712]">
                {hasAnyProjects ? "No projects match these filters." : "No projects are assigned to you yet."}
              </h2>
              {hasActiveFilters ? (
                <Button type="button" variant="outline" className="mt-5" onClick={clearFilters}>
                  <SlidersHorizontal className="size-4" /> Clear filters
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </MotionItem>
      )}

      {!isPending && projects.length > 0 && totalPages > 1 ? (
        <nav className="flex items-center justify-end gap-2" aria-label="My Projects pagination">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-[11px]"
            disabled={currentPage <= 1}
            onClick={() => navigate({ page: currentPage - 1 })}
            aria-label="Previous projects page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-2 text-[12px] font-[600] text-[#687169]">
            Page {Math.min(currentPage, totalPages)} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-[11px]"
            disabled={currentPage >= totalPages}
            onClick={() => navigate({ page: currentPage + 1 })}
            aria-label="Next projects page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

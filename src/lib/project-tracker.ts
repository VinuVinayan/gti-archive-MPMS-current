import "server-only";

import {
  FlexibleMilestoneStatus,
  Prisma,
  ProjectTrackerColumnType,
} from "@prisma/client";

import { getFlexibleProjectAccessWhere } from "@/lib/flexible-projects";
import {
  canUseProjects,
  getAccessibleProjectsWhere,
  hasPermission,
  hasProjectPermission,
  type PermissionUser,
} from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";

export const PROJECT_TRACKER_NAME = "Marketing Project Tracker";
const MAX_IMPORT_COLUMNS = 100;
const MAX_IMPORT_ROWS = 2_000;

export type TrackerCellValue = string | number | boolean | string[] | null;
export type TrackerProjectKind = "structured" | "flexible";
export type TrackerSyncState =
  | "custom"
  | "synced"
  | "update-available"
  | "local-override"
  | "unavailable";

export type ProjectTrackerField = {
  key: string;
  label: string;
  type: ProjectTrackerColumnType;
  aliases: string[];
  description: string;
};

export type ProjectTrackerProjectOption = {
  id: string;
  kind: TrackerProjectKind;
  name: string;
  href: string;
  subtitle: string;
  fields: Record<string, TrackerCellValue>;
};

export type ProjectTrackerColumnRecord = {
  id: string;
  name: string;
  type: ProjectTrackerColumnType;
  sourceFieldKey: string | null;
  options: string[];
  sortOrder: number;
  width: number;
  hidden: boolean;
  frozen: boolean;
};

export type ProjectTrackerCellRecord = {
  id: string | null;
  value: TrackerCellValue;
  sourceValue: TrackerCellValue;
  syncState: TrackerSyncState;
  lastSyncedAt: string | null;
};

export type ProjectTrackerRowRecord = {
  id: string;
  sortOrder: number;
  project: ProjectTrackerProjectOption | null;
  cells: Record<string, ProjectTrackerCellRecord>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTrackerActivityRecord = {
  id: string;
  rowId: string | null;
  columnId: string | null;
  action: string;
  summary: string;
  importRowCount: number | null;
  actorName: string;
  createdAt: string;
};

export type ProjectTrackerTrashItemRecord = {
  id: string;
  kind: "row" | "column";
  name: string;
  detail: string;
  deletedAt: string;
};

export type ProjectTrackerWorkspaceRecord = {
  id: string;
  name: string;
  canEdit: boolean;
  isInitialized: boolean;
  columns: ProjectTrackerColumnRecord[];
  rows: ProjectTrackerRowRecord[];
  projectOptions: ProjectTrackerProjectOption[];
  availableFields: ProjectTrackerField[];
  activities: ProjectTrackerActivityRecord[];
  updateCount: number;
  /** Versioned custom workbook, or legacy sheet data until the first safe save migrates it. */
  spreadsheetState: unknown;
};

type FieldContext = {
  canViewBudget: boolean;
  canViewParticipants: boolean;
};

type StructuredSource = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  executionType: string | null;
  budgetRequired: boolean | null;
  budget: number | null;
  currency: string | null;
  priority: string | null;
  startDate: Date | null;
  endDate: Date | null;
  updatedAt: Date;
  ownerId: string | null;
  owner: { name: string | null; email: string } | null;
  status: { name: string } | null;
  inquiry: {
    deadline: Date | null;
    parties: Array<{ snapshotEntityType: string; snapshotName: string; snapshotCompany: string | null }>;
    deliverables: Array<{ label: string }>;
    targetMarkets: Array<{ label: string }>;
  } | null;
  tags: Array<{ tag: { name: string } }>;
  workflowStages: Array<{ status: string }>;
  coOwners: Array<{ userId: string }>;
  executors: Array<{ userId: string; user: { name: string | null; email: string } }>;
  collaborators: Array<{
    userId: string;
    canViewBudget: boolean;
    canViewVendorInfo: boolean;
    user: { name: string | null; email: string };
  }>;
};

type FlexibleSource = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  scope: string;
  deadline: Date | null;
  updatedAt: Date;
  owner: { name: string | null; email: string };
  collaborators: Array<{ user: { name: string | null; email: string } }>;
  milestones: Array<{ name: string; category: string | null; status: string }>;
};

type FieldDefinition = ProjectTrackerField & {
  structured: (project: StructuredSource, context: FieldContext) => TrackerCellValue;
  flexible: (project: FlexibleSource) => TrackerCellValue;
};

function personName(person: { name: string | null; email: string } | null | undefined) {
  return person?.name?.trim() || person?.email || null;
}

function compactValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function formatBudget(project: StructuredSource, canViewBudget: boolean) {
  if (!canViewBudget) return null;
  if (project.budgetRequired === false) return "No budget required";
  if (project.budget === null) return null;
  const currency = project.currency?.trim() || "AED";
  return `${currency} ${project.budget.toLocaleString("en-US")}`;
}

export const PROJECT_TRACKER_FIELD_REGISTRY: readonly FieldDefinition[] = [
  {
    key: "project.name",
    label: "Project",
    type: ProjectTrackerColumnType.PROJECT,
    aliases: ["project", "project name", "job", "job name", "campaign", "initiative"],
    description: "The linked Flux project.",
    structured: (project) => project.name,
    flexible: (project) => project.name,
  },
  {
    key: "project.owner",
    label: "Project Owner",
    type: ProjectTrackerColumnType.PERSON,
    aliases: ["project owner", "owner", "project leader", "leader", "pic", "responsible person", "project lead"],
    description: "The person who owns the project in Flux.",
    structured: (project) => personName(project.owner),
    flexible: (project) => personName(project.owner),
  },
  {
    key: "project.deadline",
    label: "Deadline",
    type: ProjectTrackerColumnType.DATE,
    aliases: ["deadline", "due date", "project deadline", "end date", "delivery date"],
    description: "The current project deadline.",
    structured: (project) =>
      (project.inquiry?.deadline ?? project.endDate)?.toISOString() ?? null,
    flexible: (project) => project.deadline?.toISOString() ?? null,
  },
  {
    key: "project.startDate",
    label: "Start Date",
    type: ProjectTrackerColumnType.DATE,
    aliases: ["start date", "project start", "kickoff", "kick off"],
    description: "The planned start date when available.",
    structured: (project) => project.startDate?.toISOString() ?? null,
    flexible: () => null,
  },
  {
    key: "project.status",
    label: "Status",
    type: ProjectTrackerColumnType.STATUS,
    aliases: ["status", "project status", "current stage", "stage"],
    description: "The current Flux project status.",
    structured: (project) => project.status?.name ?? null,
    flexible: (project) =>
      project.status === "COMPLETED" ? "Completed" : "Active",
  },
  {
    key: "project.priority",
    label: "Priority",
    type: ProjectTrackerColumnType.PRIORITY,
    aliases: ["priority", "project priority", "importance"],
    description: "The project priority in Flux.",
    structured: (project) => project.priority,
    flexible: (project) => project.priority,
  },
  {
    key: "project.category",
    label: "Category",
    type: ProjectTrackerColumnType.TEXT,
    aliases: ["category", "project category", "project type", "format"],
    description: "The structured project category.",
    structured: (project) => project.category,
    flexible: (project) => compactValues(project.milestones.map((milestone) => milestone.category)),
  },
  {
    key: "project.client",
    label: "Client",
    type: ProjectTrackerColumnType.CLIENT,
    aliases: ["client", "customer", "internal client", "beneficiary"],
    description: "Client names captured in the project inquiry.",
    structured: (project) => compactValues(project.inquiry?.parties.map((party) => party.snapshotEntityType === "COMPANY" ? party.snapshotCompany || party.snapshotName : party.snapshotName) ?? []),
    flexible: () => null,
  },
  {
    key: "project.vendor",
    label: "Vendor",
    type: ProjectTrackerColumnType.VENDOR,
    aliases: ["vendor", "vendors", "supplier", "suppliers", "executor"],
    description: "Project executors visible to the current user.",
    structured: (project, context) =>
      context.canViewParticipants
        ? compactValues(project.executors.map((assignment) => personName(assignment.user)))
        : null,
    flexible: () => null,
  },
  {
    key: "project.deliverables",
    label: "Deliverables",
    type: ProjectTrackerColumnType.MULTI_SELECT,
    aliases: ["deliverables", "deliverable", "outputs", "output", "scope"],
    description: "A concise list of project deliverables or milestones.",
    structured: (project) => compactValues(project.inquiry?.deliverables.map((item) => item.label) ?? []),
    flexible: (project) => compactValues(project.milestones.map((milestone) => milestone.name)),
  },
  {
    key: "project.collaborators",
    label: "Collaborators",
    type: ProjectTrackerColumnType.MULTI_SELECT,
    aliases: ["collaborators", "team", "project team", "participants"],
    description: "People collaborating on the project.",
    structured: (project, context) =>
      context.canViewParticipants
        ? compactValues(project.collaborators.map((assignment) => personName(assignment.user)))
        : null,
    flexible: (project) => compactValues(project.collaborators.map((assignment) => personName(assignment.user))),
  },
  {
    key: "project.market",
    label: "Market",
    type: ProjectTrackerColumnType.MULTI_SELECT,
    aliases: ["market", "markets", "target market", "target markets", "country", "region"],
    description: "Target markets from the project inquiry.",
    structured: (project) => compactValues(project.inquiry?.targetMarkets.map((item) => item.label) ?? []),
    flexible: () => null,
  },
  {
    key: "project.budget",
    label: "Budget",
    type: ProjectTrackerColumnType.CURRENCY,
    aliases: ["budget", "project budget", "cost", "estimated cost"],
    description: "Budget, only when the current user may view it.",
    structured: (project, context) => formatBudget(project, context.canViewBudget),
    flexible: () => null,
  },
  {
    key: "project.progress",
    label: "Progress",
    type: ProjectTrackerColumnType.PERCENTAGE,
    aliases: ["progress", "completion", "percent complete", "% complete"],
    description: "High-level completion across stages or milestones.",
    structured: (project) => {
      const total = project.workflowStages.length;
      if (!total) return null;
      const complete = project.workflowStages.filter((stage) => stage.status === "COMPLETED").length;
      return Math.round((complete / total) * 100);
    },
    flexible: (project) => {
      const total = project.milestones.length;
      if (!total) return 0;
      const complete = project.milestones.filter(
        (milestone) => milestone.status === FlexibleMilestoneStatus.COMPLETED,
      ).length;
      return Math.round((complete / total) * 100);
    },
  },
  {
    key: "project.tags",
    label: "Tags",
    type: ProjectTrackerColumnType.TAGS,
    aliases: ["tags", "labels", "project tags"],
    description: "Tags assigned to the structured project.",
    structured: (project) => compactValues(project.tags.map((assignment) => assignment.tag.name)),
    flexible: () => null,
  },
  {
    key: "project.description",
    label: "Description",
    type: ProjectTrackerColumnType.LONG_TEXT,
    aliases: ["description", "project description", "brief", "summary"],
    description: "The project description.",
    structured: (project) => project.description,
    flexible: (project) => project.description,
  },
  {
    key: "project.executionType",
    label: "Execution Type",
    type: ProjectTrackerColumnType.DROPDOWN,
    aliases: ["execution type", "scope type", "internal or external"],
    description: "Whether execution is internal or external.",
    structured: (project) => project.executionType,
    flexible: (project) => project.scope,
  },
  {
    key: "project.updatedAt",
    label: "Last Updated",
    type: ProjectTrackerColumnType.DATETIME,
    aliases: ["last updated", "updated", "modified", "last modified"],
    description: "When the source project last changed.",
    structured: (project) => project.updatedAt.toISOString(),
    flexible: (project) => project.updatedAt.toISOString(),
  },
] as const;

export function normalizeTrackerLabel(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchProjectTrackerField(name: string) {
  const normalizedName = normalizeTrackerLabel(name);
  if (!normalizedName) return null;

  return (
    PROJECT_TRACKER_FIELD_REGISTRY.find((field) =>
      [field.label, ...field.aliases].some(
        (alias) => normalizeTrackerLabel(alias) === normalizedName,
      ),
    ) ?? null
  );
}

export function normalizeTrackerCellValue(value: unknown): TrackerCellValue {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return null;
}

const normalizeValue = normalizeTrackerCellValue;

function valueIsEmpty(value: TrackerCellValue) {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function valuesEqual(left: TrackerCellValue, right: TrackerCellValue) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inputJson(value: Exclude<TrackerCellValue, null>) {
  return value as Prisma.InputJsonValue;
}

function parseColumnOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function ensureTracker(user: PermissionUser) {
  const existing = await withPrismaRetry(() =>
    prisma.projectTracker.findFirst({ orderBy: { createdAt: "asc" } }),
  );

  if (existing) return existing;

  return withPrismaRetry(() =>
    prisma.projectTracker.create({
      data: {
        name: PROJECT_TRACKER_NAME,
        createdById: user.id,
        activities: {
          create: {
            actorId: user.id,
            action: "TRACKER_CREATED",
            details: { summary: "Created Project Tracker" },
          },
        },
      },
    }),
  );
}

const structuredProjectTrackerSelect = {
  id: true,
  name: true,
  category: true,
  description: true,
  executionType: true,
  budgetRequired: true,
  budget: true,
  currency: true,
  priority: true,
  startDate: true,
  endDate: true,
  updatedAt: true,
  ownerId: true,
  owner: { select: { name: true, email: true } },
  status: { select: { name: true } },
  inquiry: {
    select: {
      deadline: true,
      parties: {
        where: { role: "CLIENT" as const },
        orderBy: { sequence: "asc" as const },
        select: { snapshotEntityType: true, snapshotName: true, snapshotCompany: true },
      },
      deliverables: { orderBy: { createdAt: "asc" as const }, select: { label: true } },
      targetMarkets: { orderBy: { createdAt: "asc" as const }, select: { label: true } },
    },
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    select: { tag: { select: { name: true } } },
  },
  workflowStages: { select: { status: true } },
  coOwners: { select: { userId: true } },
  executors: {
    orderBy: { createdAt: "asc" as const },
    select: { userId: true, user: { select: { name: true, email: true } } },
  },
  collaborators: {
    orderBy: { createdAt: "asc" as const },
    select: {
      userId: true,
      canViewBudget: true,
      canViewVendorInfo: true,
      user: { select: { name: true, email: true } },
    },
  },
} satisfies Prisma.ProjectSelect;

const flexibleProjectTrackerSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  status: true,
  priority: true,
  scope: true,
  deadline: true,
  updatedAt: true,
  owner: { select: { name: true, email: true } },
  collaborators: {
    orderBy: { createdAt: "asc" as const },
    select: { user: { select: { name: true, email: true } } },
  },
  milestones: {
    orderBy: { sortOrder: "asc" as const },
    select: { name: true, category: true, status: true },
  },
} satisfies Prisma.FlexibleProjectSelect;

function mapStructuredProjectOption(
  project: Prisma.ProjectGetPayload<{ select: typeof structuredProjectTrackerSelect }>,
  user: PermissionUser,
): ProjectTrackerProjectOption {
  const context = {
    canViewBudget: hasProjectPermission(user, project, "project.viewBudget"),
    canViewParticipants: hasProjectPermission(user, project, "project.viewParticipants"),
  };
  return {
    id: project.id,
    kind: "structured",
    name: project.name,
    href: `/projects/${encodeURIComponent(project.id)}?returnTo=${encodeURIComponent("/project-tracker")}`,
    subtitle: ["Collaborative project", project.status?.name].filter(Boolean).join(" · "),
    fields: Object.fromEntries(
      PROJECT_TRACKER_FIELD_REGISTRY.map((field) => [
        field.key,
        normalizeValue(field.structured(project, context)),
      ]),
    ),
  };
}

function mapFlexibleProjectOption(
  project: Prisma.FlexibleProjectGetPayload<{ select: typeof flexibleProjectTrackerSelect }>,
): ProjectTrackerProjectOption {
  return {
    id: project.id,
    kind: "flexible",
    name: project.name,
    href: `/projects/flexible/${encodeURIComponent(project.slug)}?returnTo=${encodeURIComponent("/project-tracker")}`,
    subtitle: ["Private project", project.status === "COMPLETED" ? "Completed" : "Active"]
      .filter(Boolean)
      .join(" · "),
    fields: Object.fromEntries(
      PROJECT_TRACKER_FIELD_REGISTRY.map((field) => [
        field.key,
        normalizeValue(field.flexible(project)),
      ]),
    ),
  };
}

async function getAccessibleProjectOptions(user: PermissionUser) {
  const [structuredProjects, flexibleProjects] = await Promise.all([
    withPrismaRetry(() =>
      prisma.project.findMany({
        where: getAccessibleProjectsWhere(user),
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        select: structuredProjectTrackerSelect,
      }),
    ),
    withPrismaRetry(() =>
      prisma.flexibleProject.findMany({
        where: getFlexibleProjectAccessWhere(user),
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        select: flexibleProjectTrackerSelect,
      }),
    ),
  ]);

  return [
    ...structuredProjects.map((project) => mapStructuredProjectOption(project, user)),
    ...flexibleProjects.map(mapFlexibleProjectOption),
  ].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

async function loadTracker(trackerId: string) {
  return withPrismaRetry(() =>
    prisma.projectTracker.findUniqueOrThrow({
      where: { id: trackerId },
      include: {
        columns: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        rows: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { cells: true },
        },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 365,
          include: { actor: { select: { name: true, email: true } } },
        },
      },
    }),
  );
}

function getProjectForRow(
  row: { structuredProjectId: string | null; flexibleProjectId: string | null },
  projectMap: Map<string, ProjectTrackerProjectOption>,
) {
  if (row.structuredProjectId) return projectMap.get(`structured:${row.structuredProjectId}`) ?? null;
  if (row.flexibleProjectId) return projectMap.get(`flexible:${row.flexibleProjectId}`) ?? null;
  return null;
}

async function reconcileSafeValues(
  tracker: Awaited<ReturnType<typeof loadTracker>>,
  projectMap: Map<string, ProjectTrackerProjectOption>,
) {
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const row of tracker.rows) {
    const project = getProjectForRow(row, projectMap);
    if (!project) continue;
    const cells = new Map(row.cells.map((cell) => [cell.columnId, cell]));

    for (const column of tracker.columns) {
      if (!column.sourceFieldKey) continue;
      const sourceValue = normalizeValue(project.fields[column.sourceFieldKey]);
      if (valueIsEmpty(sourceValue)) continue;
      const cell = cells.get(column.id);
      const cellValue = normalizeValue(cell?.value);
      const lastSyncedValue = normalizeValue(cell?.lastSyncedValue);
      const canSafelyUseSource =
        !cell ||
        (!cell.isLocalOverride &&
          (valuesEqual(cellValue, sourceValue) ||
            (!valueIsEmpty(lastSyncedValue) && valuesEqual(cellValue, lastSyncedValue))));

      if (!canSafelyUseSource) continue;
      if (
        cell &&
        valuesEqual(cellValue, sourceValue) &&
        valuesEqual(lastSyncedValue, sourceValue)
      ) {
        continue;
      }

      operations.push(
        prisma.projectTrackerCell.upsert({
          where: { rowId_columnId: { rowId: row.id, columnId: column.id } },
          create: {
            rowId: row.id,
            columnId: column.id,
            value: inputJson(sourceValue as Exclude<TrackerCellValue, null>),
            lastSyncedValue: inputJson(sourceValue as Exclude<TrackerCellValue, null>),
            lastSyncedAt: new Date(),
          },
          update: {
            value: inputJson(sourceValue as Exclude<TrackerCellValue, null>),
            lastSyncedValue: inputJson(sourceValue as Exclude<TrackerCellValue, null>),
            lastSyncedAt: new Date(),
            isLocalOverride: false,
          },
        }),
      );
    }
  }

  if (operations.length) await withPrismaRetry(() => prisma.$transaction(operations));
  return operations.length > 0;
}

function activitySummary(action: string, details: unknown) {
  const explicit =
    details && typeof details === "object" && "summary" in details
      ? (details as { summary?: unknown }).summary
      : null;
  if (typeof explicit === "string") return explicit;

  const fallbacks: Record<string, string> = {
    TRACKER_CREATED: "Created Project Tracker",
    TRACKER_INITIALIZED: "Started the tracker",
    COLUMN_ADDED: "Added a column",
    COLUMN_UPDATED: "Updated a column",
    COLUMN_DELETED: "Deleted a column",
    COLUMN_RESTORED: "Restored a column from Bin",
    ROW_ADDED: "Added a row",
    ROW_DUPLICATED: "Duplicated a row",
    ROW_DELETED: "Deleted a row",
    ROW_RESTORED: "Restored a row from Bin",
    PROJECT_LINKED: "Linked a Flux project",
    PROJECT_UNLINKED: "Disconnected a Flux project",
    CELL_UPDATED: "Updated a tracker value",
    CELLS_UPDATED: "Updated tracker values",
    ROWS_SORTED: "Sorted tracker rows",
    SOURCE_VALUE_ACCEPTED: "Accepted a Flux value",
    LOCAL_VALUE_KEPT: "Kept a local tracker value",
    IMPORT_COMPLETED: "Imported spreadsheet data",
  };
  return fallbacks[action] ?? "Updated Project Tracker";
}

function activityImportRowCount(action: string, details: unknown) {
  if (action !== "IMPORT_COMPLETED" || !details || typeof details !== "object") return null;
  const rowCount = "rowCount" in details ? (details as { rowCount?: unknown }).rowCount : null;
  return typeof rowCount === "number" && Number.isInteger(rowCount) && rowCount > 0
    ? rowCount
    : null;
}

function isRowLinked(row: { structuredProjectId: string | null; flexibleProjectId: string | null }) {
  return Boolean(row.structuredProjectId || row.flexibleProjectId);
}

function spreadsheetStateFromSettings(settings: Prisma.JsonValue | null): unknown {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  const spreadsheet = (settings as Prisma.JsonObject).spreadsheet;
  if (spreadsheet && typeof spreadsheet === "object" && !Array.isArray(spreadsheet)) {
    const workbook = (spreadsheet as Prisma.JsonObject).workbook;
    if (workbook && typeof workbook === "object" && !Array.isArray(workbook)) return workbook;
  }

  // One-way compatibility bridge for workbook metadata saved by the retired
  // editor. The client normalizes this data into the v2 sparse model and the
  // first autosave removes the legacy key.
  const fortuneSheet = (settings as Prisma.JsonObject).fortuneSheet;
  if (!fortuneSheet || typeof fortuneSheet !== "object" || Array.isArray(fortuneSheet)) return [];
  const sheets = (fortuneSheet as Prisma.JsonObject).sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets
    .filter((sheet) => Boolean(sheet) && typeof sheet === "object" && !Array.isArray(sheet))
    .map((sheet) => ({ ...(sheet as Prisma.JsonObject) }));
}

export async function getProjectTrackerWorkspace(
  user: PermissionUser,
): Promise<ProjectTrackerWorkspaceRecord> {
  if (!canUseProjects(user)) throw new Error("You do not have permission to view Project Tracker.");

  const trackerRecord = await ensureTracker(user);
  const [initialTracker, projectOptions] = await Promise.all([
    loadTracker(trackerRecord.id),
    getAccessibleProjectOptions(user),
  ]);
  const projectMap = new Map(
    projectOptions.map((project) => [`${project.kind}:${project.id}`, project]),
  );
  const reconciled = await reconcileSafeValues(initialTracker, projectMap);
  const tracker = reconciled ? await loadTracker(trackerRecord.id) : initialTracker;
  let updateCount = 0;

  const rows = tracker.rows
    .filter((row) => !isRowLinked(row) || getProjectForRow(row, projectMap))
    .map((row) => {
      const project = getProjectForRow(row, projectMap);
      const cellMap = new Map(row.cells.map((cell) => [cell.columnId, cell]));
      const cells = Object.fromEntries(
        tracker.columns.map((column) => {
          const cell = cellMap.get(column.id);
          const value = normalizeValue(cell?.value);
          const sourceValue = column.sourceFieldKey && project
            ? normalizeValue(project.fields[column.sourceFieldKey])
            : null;
          let syncState: TrackerSyncState = "custom";

          if (column.sourceFieldKey) {
            if (!project || valueIsEmpty(sourceValue)) syncState = "unavailable";
            else if (cell?.isLocalOverride && !valuesEqual(value, sourceValue)) syncState = "local-override";
            else if (!valuesEqual(value, sourceValue)) {
              syncState = "update-available";
              updateCount += 1;
            } else syncState = "synced";
          }

          return [
            column.id,
            {
              id: cell?.id ?? null,
              value,
              sourceValue,
              syncState,
              lastSyncedAt: cell?.lastSyncedAt?.toISOString() ?? null,
            },
          ];
        }),
      );

      return {
        id: row.id,
        sortOrder: row.sortOrder,
        project,
        cells,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });

  return {
    id: tracker.id,
    name: tracker.name,
    canEdit: hasPermission(user, "project.update"),
    isInitialized: tracker.columns.length > 0,
    columns: tracker.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
      sourceFieldKey: column.sourceFieldKey,
      options: parseColumnOptions(column.options),
      sortOrder: column.sortOrder,
      width: column.width,
      hidden: column.hidden,
      frozen: column.frozen,
    })),
    rows,
    projectOptions,
    availableFields: PROJECT_TRACKER_FIELD_REGISTRY.map(
      ({ key, label, type, aliases, description }) => ({ key, label, type, aliases, description }),
    ),
    activities: tracker.activities.map((activity) => ({
      id: activity.id,
      rowId: activity.rowId,
      columnId: activity.columnId,
      action: activity.action,
      summary: activitySummary(activity.action, activity.details),
      importRowCount: activityImportRowCount(activity.action, activity.details),
      actorName: personName(activity.actor) ?? "Flux user",
      createdAt: activity.createdAt.toISOString(),
    })),
    updateCount,
    spreadsheetState: spreadsheetStateFromSettings(tracker.settings),
  };
}

export async function getProjectTrackerTrash(
  user: PermissionUser,
): Promise<ProjectTrackerTrashItemRecord[]> {
  const tracker = await requireEditableTracker(user);
  const [columns, rows] = await Promise.all([
    withPrismaRetry(() =>
      prisma.projectTrackerColumn.findMany({
        where: { trackerId: tracker.id, deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          name: true,
          type: true,
          deletedAt: true,
          _count: { select: { cells: true } },
        },
      }),
    ),
    withPrismaRetry(() =>
      prisma.projectTrackerRow.findMany({
        where: { trackerId: tracker.id, deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          deletedAt: true,
          structuredProjectId: true,
          flexibleProjectId: true,
          cells: {
            where: {
              column: {
                OR: [
                  { sourceFieldKey: "project.name" },
                  { type: ProjectTrackerColumnType.PROJECT },
                ],
              },
            },
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { value: true },
          },
          _count: { select: { cells: true } },
        },
      }),
    ),
  ]);

  return [
    ...columns.map((column) => ({
      id: column.id,
      kind: "column" as const,
      name: column.name,
      detail: `${column._count.cells} saved ${column._count.cells === 1 ? "value" : "values"} · ${column.type.toLowerCase().replaceAll("_", " ")}`,
      deletedAt: column.deletedAt!.toISOString(),
    })),
    ...rows.map((row) => {
      const projectValue = normalizeValue(row.cells[0]?.value);
      const name = typeof projectValue === "string" && projectValue.trim()
        ? projectValue.trim()
        : "Tracker row";
      const linked = Boolean(row.structuredProjectId || row.flexibleProjectId);
      return {
        id: row.id,
        kind: "row" as const,
        name,
        detail: `${row._count.cells} saved ${row._count.cells === 1 ? "value" : "values"}${linked ? " · linked project" : ""}`,
        deletedAt: row.deletedAt!.toISOString(),
      };
    }),
  ].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

export function canEditProjectTracker(user: PermissionUser) {
  return canUseProjects(user) && hasPermission(user, "project.update");
}

export async function requireEditableTracker(user: PermissionUser) {
  if (!canEditProjectTracker(user)) {
    throw new Error("You do not have permission to edit Project Tracker.");
  }
  return ensureTracker(user);
}

export async function recordTrackerActivity(input: {
  trackerId: string;
  actorId: string;
  action: string;
  summary: string;
  rowId?: string;
  columnId?: string;
  details?: Record<string, Prisma.InputJsonValue>;
}) {
  return prisma.projectTrackerActivity.create({
    data: {
      trackerId: input.trackerId,
      actorId: input.actorId,
      action: input.action,
      rowId: input.rowId,
      columnId: input.columnId,
      details: { summary: input.summary, ...input.details },
    },
  });
}

export async function assertProjectOptionAccessible(
  user: PermissionUser,
  kind: TrackerProjectKind,
  projectId: string,
) {
  const project =
    kind === "structured"
      ? await withPrismaRetry(() =>
          prisma.project.findFirst({
            where: {
              AND: [{ id: projectId }, getAccessibleProjectsWhere(user)],
            },
            select: structuredProjectTrackerSelect,
          }),
        ).then((record) => record ? mapStructuredProjectOption(record, user) : null)
      : await withPrismaRetry(() =>
          prisma.flexibleProject.findFirst({
            where: {
              AND: [{ id: projectId }, getFlexibleProjectAccessWhere(user)],
            },
            select: flexibleProjectTrackerSelect,
          }),
        ).then((record) => record ? mapFlexibleProjectOption(record) : null);
  if (!project) throw new Error("That project is not available to you.");
  return project;
}

export async function getTrackerColumnAndRow(trackerId: string, rowId: string, columnId: string) {
  const [row, column] = await Promise.all([
    prisma.projectTrackerRow.findFirst({
      where: { id: rowId, trackerId, deletedAt: null },
      select: {
        id: true,
        structuredProjectId: true,
        flexibleProjectId: true,
        cells: { where: { columnId }, take: 1 },
      },
    }),
    prisma.projectTrackerColumn.findFirst({
      where: { id: columnId, trackerId, deletedAt: null },
    }),
  ]);
  if (!row || !column) throw new Error("That tracker cell no longer exists.");
  return { row, column };
}

export async function getSourceValueForCell(
  user: PermissionUser,
  row: { structuredProjectId: string | null; flexibleProjectId: string | null },
  sourceFieldKey: string,
) {
  const projectId = row.structuredProjectId ?? row.flexibleProjectId;
  const kind = row.structuredProjectId ? "structured" : "flexible";
  if (!projectId) return null;
  const project = await assertProjectOptionAccessible(user, kind, projectId);
  return normalizeValue(project.fields[sourceFieldKey]);
}

export type TrackerImportColumn = {
  name: string;
  type?: ProjectTrackerColumnType;
  values?: TrackerCellValue[];
};

export function validateTrackerImport(columns: TrackerImportColumn[], rows: TrackerCellValue[][]) {
  if (!columns.length) throw new Error("The file does not contain any columns.");
  if (columns.length > MAX_IMPORT_COLUMNS) {
    throw new Error(`Import up to ${MAX_IMPORT_COLUMNS} columns at a time.`);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
  }
  const normalizedRows = rows
    .map((row) => row.slice(0, columns.length).map(normalizeValue))
    .filter((row) => row.some((value) => !valueIsEmpty(value)));
  return {
    columns: columns.map((column, index) => {
      const name = column.name.trim() || `Column ${index + 1}`;
      const match = matchProjectTrackerField(name);
      return {
        name: name.slice(0, 120),
        type: column.type ?? match?.type ?? ProjectTrackerColumnType.TEXT,
        sourceFieldKey: match?.key ?? null,
      };
    }),
    rows: normalizedRows,
  };
}

export { ProjectTrackerColumnType };

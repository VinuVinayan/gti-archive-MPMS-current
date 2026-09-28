import {
  AttachmentAssetType,
  AttachmentStatus,
  Prisma,
  ProjectInquiryAttachmentField,
  ProjectInquiryClientOrigin,
  ProjectInquiryPartyRole,
  ProjectInquiryPartySource,
  ProjectInquiryPriority,
  ProjectInquiryTargetMarketKind,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
} from "@prisma/client";

import { getUserDisplayName } from "@/lib/auth";
import {
  type ProjectContactInput,
  type ProjectContactEntityType,
  validateProjectContactInput,
} from "@/lib/project-contact-validation";
import {
  isProjectInquiryCountryLabel,
  PROJECT_INQUIRY_COUNTRY_OPTIONS,
  PROJECT_INQUIRY_GLOBAL_MARKET_LABEL,
} from "@/lib/project-inquiry-countries";
import {
  hasProjectPermission,
  type ProjectPermissionContext,
} from "@/lib/permissions/resolver";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { richTextToPlainText, sanitizeRichText } from "@/lib/rich-text";
import {
  getProjectStageAccessRecordById,
} from "@/lib/project-stage-data";
import type { ProjectAccessUser } from "@/lib/projects";
import {
  getWorkflowStageCompletionMode,
  PROJECT_WORKFLOW_STAGE_DEFINITIONS,
} from "@/lib/project-workflow";
import { canOpenImplementedWorkflowStage } from "@/lib/workflow-stage-access";

const MAX_TEXT_LENGTH = 10_000;
const MAX_LABEL_LENGTH = 160;
const MAX_SELECTION_COUNT = 50;
const MAX_ATTACHMENT_COUNT = 60;

const projectAccessSelect = {
  id: true,
  name: true,
  createdAt: true,
  ownerId: true,
  coOwners: {
    select: {
      userId: true,
    },
  },
  executors: {
    select: {
      userId: true,
    },
  },
  collaborators: {
    select: {
      userId: true,
      canInteract: true,
      canAddCaptions: true,
      canDownloadFiles: true,
      canViewBudget: true,
      canViewVendorInfo: true,
      canAccessProjectArchives: true,
    },
  },
  workflowStages: {
    select: {
      stageKey: true,
      status: true,
      unlockedAt: true,
      completedAt: true,
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectInquiryPartyOption = {
  source: ProjectInquiryPartySource;
  entityType: ProjectContactEntityType;
  id: string;
  name: string;
  company: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
};

export type ProjectInquiryPartySelection = Pick<
  ProjectInquiryPartyOption,
  "source" | "entityType" | "id" | "name" | "company" | "companyEmail" | "companyPhone" | "companyWebsite" | "position" | "email" | "phone"
>;

export type ProjectInquiryTargetMarketInput = {
  label: string;
  kind?: ProjectInquiryTargetMarketKind | null;
};

export type ProjectInquiryAttachmentRecord = {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
};

export type ProjectInquiryRecord = {
  client: ProjectInquiryPartySelection | null;
  finalBeneficiaries: ProjectInquiryPartySelection[];
  clientOrigin: ProjectInquiryClientOrigin | null;
  targetMarkets: ProjectInquiryTargetMarketInput[];
  initialBrief: string;
  businessObjectives: string;
  deliverables: string[];
  inquiryDate: string;
  deadline: string;
  legalNotes: string;
  priority: ProjectInquiryPriority | null;
  attachments: Record<
    ProjectInquiryAttachmentField,
    ProjectInquiryAttachmentRecord[]
  >;
};

export type ProjectInquiryPageData = {
  inquiry: ProjectInquiryRecord | null;
  partyOptions: ProjectInquiryPartyOption[];
  targetMarketSuggestions: ProjectInquiryTargetMarketInput[];
  countryOptions: string[];
  deliverableSuggestions: string[];
  canEdit: boolean;
  workflowStatus: ProjectWorkflowStageStatus;
};

export type CompleteProjectInquiryInput = {
  projectId: string;
  client: Pick<ProjectInquiryPartySelection, "source" | "id"> | null;
  finalBeneficiaries: Array<
    Pick<ProjectInquiryPartySelection, "source" | "id">
  >;
  clientOrigin?: ProjectInquiryClientOrigin | null;
  targetMarkets?: ProjectInquiryTargetMarketInput[];
  initialBrief?: string;
  businessObjectives?: string;
  deliverables?: string[];
  inquiryDate?: string;
  deadline?: string;
  legalNotes?: string;
  priority?: ProjectInquiryPriority | null;
  attachmentIds?: Partial<Record<ProjectInquiryAttachmentField, string[]>>;
};

export type ProjectInquiryFieldErrors = Partial<
  Record<
    | "client"
    | "finalBeneficiaries"
    | "clientOrigin"
    | "targetMarkets"
    | "initialBrief"
    | "businessObjectives"
    | "deliverables"
    | "inquiryDate"
    | "deadline"
    | "legalNotes"
    | "priority"
    | "attachments",
    string
  >
>;

export type CompleteProjectInquiryResult =
  | { success: true; alreadyCompleted: boolean }
  | { error: string; fieldErrors?: ProjectInquiryFieldErrors };

export type CreateContactDirectoryEntryInput = ProjectContactInput;

export type CreateContactDirectoryEntryResult =
  | { contact: ProjectInquiryPartyOption }
  | { error: string; fieldErrors?: Partial<Record<keyof CreateContactDirectoryEntryInput, string>> };

function toPermissionContext(project: ProjectPermissionContext): ProjectPermissionContext {
  return {
    ownerId: project.ownerId,
    coOwners: project.coOwners,
    executors: project.executors,
    collaborators: project.collaborators,
  };
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeProjectInquiryLabel(value: string) {
  return normalizeWhitespace(value).toLocaleLowerCase("en");
}

function normalizeOptionalText(
  value: string | undefined,
  field: keyof ProjectInquiryFieldErrors,
  fieldErrors: ProjectInquiryFieldErrors,
) {
  const normalized = sanitizeRichText(value);

  if (richTextToPlainText(normalized).length > MAX_TEXT_LENGTH) {
    fieldErrors[field] = `Keep this field under ${MAX_TEXT_LENGTH.toLocaleString()} characters.`;
  }

  return normalized || null;
}

function parseDateOnly(
  value: string | undefined,
  field: "inquiryDate" | "deadline",
  fieldErrors: ProjectInquiryFieldErrors,
) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fieldErrors[field] = "Enter a valid calendar date.";
    return null;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    fieldErrors[field] = "Enter a valid calendar date.";
    return null;
  }

  return date;
}

function formatDateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function emptyAttachmentRecord(): ProjectInquiryRecord["attachments"] {
  return {
    INITIAL_BRIEF: [],
    BUSINESS_OBJECTIVES: [],
    LEGAL_NOTES: [],
  };
}

function mapPartyOptionFromUser(user: {
  id: string;
  name: string | null;
  email: string;
  department: string | null;
  jobTitle: string | null;
  phoneNumber: string | null;
}): ProjectInquiryPartyOption {
  return {
    source: ProjectInquiryPartySource.USER,
    entityType: "PERSON",
    id: user.id,
    name: getUserDisplayName(user),
    company: user.department,
    companyEmail: null,
    companyPhone: null,
    companyWebsite: null,
    position: user.jobTitle,
    email: user.email,
    phone: user.phoneNumber,
  };
}

function mapPartyOptionFromContact(contact: {
  entityType: ProjectContactEntityType;
  id: string;
  name: string;
  company: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
}): ProjectInquiryPartyOption {
  return {
    source: ProjectInquiryPartySource.MANUAL_CONTACT,
    entityType: contact.entityType,
    id: contact.id,
    name: contact.name,
    company: contact.company,
    companyEmail: contact.companyEmail,
    companyPhone: contact.companyPhone,
    companyWebsite: contact.companyWebsite,
    position: contact.position,
    email: contact.email,
    phone: contact.phone,
  };
}

function mapSavedParty(party: {
  source: ProjectInquiryPartySource;
  userId: string | null;
  contactId: string | null;
  snapshotEntityType: ProjectContactEntityType;
  snapshotName: string;
  snapshotCompany: string | null;
  snapshotCompanyEmail: string | null;
  snapshotCompanyPhone: string | null;
  snapshotCompanyWebsite: string | null;
  snapshotPosition: string | null;
  snapshotEmail: string | null;
  snapshotPhone: string | null;
}): ProjectInquiryPartySelection {
  return {
    source: party.source,
    entityType: party.snapshotEntityType,
    id:
      party.source === ProjectInquiryPartySource.USER
        ? party.userId ?? ""
        : party.contactId ?? "",
    name: party.snapshotName,
    company: party.snapshotCompany,
    companyEmail: party.snapshotCompanyEmail,
    companyPhone: party.snapshotCompanyPhone,
    companyWebsite: party.snapshotCompanyWebsite,
    position: party.snapshotPosition,
    email: party.snapshotEmail,
    phone: party.snapshotPhone,
  };
}

async function getProjectAccessRecord(projectId: string) {
  return getProjectStageAccessRecordById(projectId);
}

function canOpenProjectInquiry(project: {
  workflowStages: Array<{
    stageKey: ProjectWorkflowStageKey;
    status: ProjectWorkflowStageStatus;
  }>;
}) {
  return canOpenImplementedWorkflowStage({
    stageKey: ProjectWorkflowStageKey.PROJECT_INQUIRY,
    status: project.workflowStages.find(
      (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY,
    )?.status,
  });
}

export async function createContactDirectoryEntry(
  user: ProjectAccessUser,
  projectId: string,
  input: CreateContactDirectoryEntryInput,
): Promise<CreateContactDirectoryEntryResult> {
  const project = await getProjectAccessRecord(projectId);

  if (!project) {
    return { error: "Project not found." };
  }

  if (!canOpenProjectInquiry(project)) {
    return { error: "Project Inquiry is locked." };
  }

  if (!hasProjectPermission(user, toPermissionContext(project), "project.update")) {
    return { error: "You do not have permission to edit Project Inquiry." };
  }

  const validation = validateProjectContactInput(input);

  if (Object.keys(validation.fieldErrors).length > 0) {
    return {
      error: "Review the highlighted contact fields.",
      fieldErrors: validation.fieldErrors,
    };
  }

  const contact = await withPrismaRetry(() =>
    prisma.contactDirectoryEntry.create({
      data: {
        entityType: validation.data.entityType,
        name: validation.data.name,
        company: validation.data.company || null,
        companyEmail: validation.data.companyEmail || null,
        companyPhone: validation.data.companyPhone || null,
        companyWebsite: validation.data.companyWebsite || null,
        position: validation.data.position || null,
        email: validation.data.email || null,
        phone: validation.data.phone || null,
        createdById: user.id,
      },
      select: {
        id: true,
        name: true,
        entityType: true,
        company: true,
        companyEmail: true,
        companyPhone: true,
        companyWebsite: true,
        position: true,
        email: true,
        phone: true,
      },
    }),
  );

  return {
    contact: mapPartyOptionFromContact(contact),
  };
}

export async function getProjectInquiryPageData(
  user: ProjectAccessUser,
  projectId: string,
): Promise<ProjectInquiryPageData> {
  const project = await getProjectAccessRecord(projectId);

  if (
    !project ||
    !canOpenProjectInquiry(project) ||
    !hasProjectPermission(user, toPermissionContext(project), "stage.view") ||
    !hasProjectPermission(user, toPermissionContext(project), "project.update")
  ) {
    throw new Error("Project Inquiry is unavailable.");
  }

  const inquiry = await withPrismaRetry(() =>
    prisma.projectInquiry.findUnique({
      where: { projectId },
      relationLoadStrategy: "join",
      include: {
        parties: {
          orderBy: [{ role: "asc" }, { sequence: "asc" }, { createdAt: "asc" }],
        },
        targetMarkets: {
          orderBy: { createdAt: "asc" },
        },
        deliverables: {
          orderBy: { createdAt: "asc" },
        },
        attachments: {
          orderBy: { createdAt: "asc" },
          include: {
            attachment: {
              select: {
                id: true,
                originalFileName: true,
                mimeType: true,
                fileSize: true,
                status: true,
              },
            },
          },
        },
      },
    }),
  );

  let mappedInquiry: ProjectInquiryRecord | null = null;

  if (inquiry) {
    const client = inquiry.parties.find(
      (party) => party.role === ProjectInquiryPartyRole.CLIENT,
    );
    const finalBeneficiaries = inquiry.parties.filter(
      (party) => party.role === ProjectInquiryPartyRole.FINAL_BENEFICIARY,
    );
    const attachments = emptyAttachmentRecord();

    for (const association of inquiry.attachments) {
      if (association.attachment.status !== AttachmentStatus.READY) {
        continue;
      }

      attachments[association.field].push({
        id: association.attachment.id,
        originalFileName: association.attachment.originalFileName,
        mimeType: association.attachment.mimeType,
        fileSize: association.attachment.fileSize,
      });
    }

    mappedInquiry = {
      client: client ? mapSavedParty(client) : null,
      finalBeneficiaries: finalBeneficiaries.map(mapSavedParty),
      clientOrigin: inquiry.clientOrigin,
      targetMarkets: inquiry.targetMarkets.map((market) => ({
        label: market.label,
        kind: market.kind,
      })),
      initialBrief: inquiry.initialBrief ?? "",
      businessObjectives: inquiry.businessObjectives ?? "",
      deliverables: inquiry.deliverables.map((deliverable) => deliverable.label),
      inquiryDate: formatDateOnly(inquiry.inquiryDate),
      deadline: formatDateOnly(inquiry.deadline),
      legalNotes: inquiry.legalNotes ?? "",
      priority: inquiry.priority,
      attachments,
    };
  }

  return {
    inquiry: mappedInquiry,
    partyOptions: [],
    targetMarketSuggestions: [],
    countryOptions: [
      PROJECT_INQUIRY_GLOBAL_MARKET_LABEL,
      ...PROJECT_INQUIRY_COUNTRY_OPTIONS,
    ],
    deliverableSuggestions: [],
    canEdit: true,
    workflowStatus:
      project.workflowStages.find(
        (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY,
      )?.status ?? ProjectWorkflowStageStatus.LOCKED,
  };
}

async function assertProjectInquiryOptionsAccess(
  user: ProjectAccessUser,
  projectId: string,
) {
  const project = await getProjectAccessRecord(projectId);

  if (
    !project ||
    !canOpenProjectInquiry(project) ||
    !hasProjectPermission(user, toPermissionContext(project), "stage.view") ||
    !hasProjectPermission(user, toPermissionContext(project), "project.update")
  ) {
    throw new Error("Project Inquiry is unavailable.");
  }
}

export async function searchProjectInquiryPartyOptions(
  user: ProjectAccessUser,
  projectId: string,
  query: string,
) {
  await assertProjectInquiryOptionsAccess(user, projectId);
  const search = query.trim().slice(0, MAX_LABEL_LENGTH);
  const userWhere = search
    ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { department: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { jobTitle: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : undefined;
  const contactWhere = search
    ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { company: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { companyEmail: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { companyPhone: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { companyWebsite: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { position: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : undefined;
  const [users, contacts] = await Promise.all([
    withPrismaRetry(() =>
      prisma.user.findMany({
        where: userWhere,
        orderBy: [{ name: "asc" }, { email: "asc" }],
        take: 30,
        select: {
          id: true,
          name: true,
          email: true,
          department: true,
          jobTitle: true,
          phoneNumber: true,
        },
      }),
    ),
    withPrismaRetry(() =>
      prisma.contactDirectoryEntry.findMany({
        where: contactWhere,
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        take: 30,
        select: {
          id: true,
          name: true,
          entityType: true,
          company: true,
          companyEmail: true,
          companyPhone: true,
          companyWebsite: true,
          position: true,
          email: true,
          phone: true,
        },
      }),
    ),
  ]);

  return [...users.map(mapPartyOptionFromUser), ...contacts.map(mapPartyOptionFromContact)];
}

export async function searchProjectInquiryHistorySuggestions(
  user: ProjectAccessUser,
  projectId: string,
  kind: "target-market" | "deliverable",
  query: string,
) {
  await assertProjectInquiryOptionsAccess(user, projectId);
  const normalizedQuery = normalizeProjectInquiryLabel(query).slice(
    0,
    MAX_LABEL_LENGTH,
  );

  if (kind === "target-market") {
    const markets = await withPrismaRetry(() =>
      prisma.projectInquiryTargetMarket.findMany({
        where: normalizedQuery
          ? { normalizedLabel: { contains: normalizedQuery } }
          : undefined,
        distinct: ["normalizedLabel"],
        orderBy: [{ normalizedLabel: "asc" }, { createdAt: "desc" }],
        take: 30,
        select: { label: true },
      }),
    );
    return markets.map((market) => market.label);
  }

  const deliverables = await withPrismaRetry(() =>
    prisma.projectInquiryDeliverable.findMany({
      where: normalizedQuery
        ? { normalizedLabel: { contains: normalizedQuery } }
        : undefined,
      distinct: ["normalizedLabel"],
      orderBy: [{ normalizedLabel: "asc" }, { createdAt: "desc" }],
      take: 30,
      select: { label: true },
    }),
  );
  return deliverables.map((deliverable) => deliverable.label);
}

function validatePartyInput(
  value: CompleteProjectInquiryInput["client"],
  field: "client" | "finalBeneficiaries",
  fieldErrors: ProjectInquiryFieldErrors,
) {
  if (!value?.id?.trim()) {
    fieldErrors[field] =
      field === "client" ? "Select a client." : "Select at least one final beneficiary.";
    return null;
  }

  if (!Object.values(ProjectInquiryPartySource).includes(value.source)) {
    fieldErrors[field] = "Select a valid saved party.";
    return null;
  }

  return {
    source: value.source,
    id: value.id.trim(),
  };
}

function validateFinalBeneficiaries(
  values: CompleteProjectInquiryInput["finalBeneficiaries"],
  fieldErrors: ProjectInquiryFieldErrors,
) {
  if (!Array.isArray(values) || values.length === 0) {
    fieldErrors.finalBeneficiaries = "Select at least one final beneficiary.";
    return [];
  }

  if (values.length > MAX_SELECTION_COUNT) {
    fieldErrors.finalBeneficiaries = `Select no more than ${MAX_SELECTION_COUNT} final beneficiaries.`;
    return [];
  }

  const validated = values
    .map((value) =>
      validatePartyInput(value, "finalBeneficiaries", fieldErrors),
    )
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const uniqueKeys = new Set(
    validated.map((value) => `${value.source}:${value.id}`),
  );

  if (uniqueKeys.size !== validated.length) {
    fieldErrors.finalBeneficiaries =
      "A final beneficiary can only be selected once.";
    return [];
  }

  return validated;
}

function normalizeTargetMarkets(
  values: ProjectInquiryTargetMarketInput[] | undefined,
  fieldErrors: ProjectInquiryFieldErrors,
) {
  const requestedValues = values ?? [];

  if (requestedValues.length > MAX_SELECTION_COUNT) {
    fieldErrors.targetMarkets = `Select no more than ${MAX_SELECTION_COUNT} target markets.`;
    return [];
  }

  const normalizedValues = requestedValues
    .map((value) => {
      const label = normalizeWhitespace(value.label);

      if (!label || label.length > MAX_LABEL_LENGTH) {
        return null;
      }

      const normalizedLabel = normalizeProjectInquiryLabel(label);
      const kind =
        normalizedLabel ===
        normalizeProjectInquiryLabel(PROJECT_INQUIRY_GLOBAL_MARKET_LABEL)
          ? ProjectInquiryTargetMarketKind.GLOBAL
          : isProjectInquiryCountryLabel(label)
            ? ProjectInquiryTargetMarketKind.COUNTRY
            : ProjectInquiryTargetMarketKind.REGION;

      return { label, normalizedLabel, kind };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (normalizedValues.length !== requestedValues.length) {
    fieldErrors.targetMarkets = `Every target market must be between 1 and ${MAX_LABEL_LENGTH} characters.`;
  }

  if (new Set(normalizedValues.map((value) => value.normalizedLabel)).size !== normalizedValues.length) {
    fieldErrors.targetMarkets = "Target markets cannot contain duplicates.";
  }

  return normalizedValues;
}

function normalizeDeliverables(
  values: string[] | undefined,
  fieldErrors: ProjectInquiryFieldErrors,
) {
  const requestedValues = values ?? [];

  if (requestedValues.length > MAX_SELECTION_COUNT) {
    fieldErrors.deliverables = `Add no more than ${MAX_SELECTION_COUNT} deliverables.`;
    return [];
  }

  const normalizedValues = requestedValues
    .map((value) => {
      const label = normalizeWhitespace(value);
      return label && label.length <= MAX_LABEL_LENGTH
        ? { label, normalizedLabel: normalizeProjectInquiryLabel(label) }
        : null;
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (normalizedValues.length !== requestedValues.length) {
    fieldErrors.deliverables = `Every deliverable must be between 1 and ${MAX_LABEL_LENGTH} characters.`;
  }

  if (new Set(normalizedValues.map((value) => value.normalizedLabel)).size !== normalizedValues.length) {
    fieldErrors.deliverables = "Deliverables cannot contain duplicates.";
  }

  return normalizedValues;
}

function normalizeIds(
  values: string[] | undefined,
  maxCount: number,
  field: "attachments",
  fieldErrors: ProjectInquiryFieldErrors,
) {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);

  if (normalized.length > maxCount) {
    fieldErrors[field] = `Select no more than ${maxCount} items.`;
  } else if (new Set(normalized).size !== normalized.length) {
    fieldErrors[field] = "Duplicate selections are not allowed.";
  }

  return normalized;
}

async function resolvePartySnapshot(
  tx: Prisma.TransactionClient,
  value: NonNullable<ReturnType<typeof validatePartyInput>>,
) {
  if (value.source === ProjectInquiryPartySource.USER) {
    const selectedUser = await tx.user.findUnique({
      where: { id: value.id },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        jobTitle: true,
        phoneNumber: true,
      },
    });

    if (!selectedUser) {
      return null;
    }

    return {
      source: ProjectInquiryPartySource.USER,
      userId: selectedUser.id,
      contactId: null,
      snapshotEntityType: "PERSON" as const,
      snapshotName: getUserDisplayName(selectedUser),
      snapshotCompany: selectedUser.department,
      snapshotCompanyEmail: null,
      snapshotCompanyPhone: null,
      snapshotCompanyWebsite: null,
      snapshotPosition: selectedUser.jobTitle,
      snapshotEmail: selectedUser.email,
      snapshotPhone: selectedUser.phoneNumber,
    };
  }

  const contact = await tx.contactDirectoryEntry.findUnique({
    where: { id: value.id },
    select: {
      id: true,
      name: true,
      entityType: true,
      company: true,
      companyEmail: true,
      companyPhone: true,
      companyWebsite: true,
      position: true,
      email: true,
      phone: true,
    },
  });

  if (!contact) {
    return null;
  }

  return {
    source: ProjectInquiryPartySource.MANUAL_CONTACT,
    userId: null,
    contactId: contact.id,
    snapshotEntityType: contact.entityType,
    snapshotName: contact.name,
    snapshotCompany: contact.company,
    snapshotCompanyEmail: contact.companyEmail,
    snapshotCompanyPhone: contact.companyPhone,
    snapshotCompanyWebsite: contact.companyWebsite,
    snapshotPosition: contact.position,
    snapshotEmail: contact.email,
    snapshotPhone: contact.phone,
  };
}

export async function completeProjectInquiry(
  user: ProjectAccessUser,
  input: CompleteProjectInquiryInput,
): Promise<CompleteProjectInquiryResult> {
  const projectId = input.projectId.trim();
  const fieldErrors: ProjectInquiryFieldErrors = {};
  const client = validatePartyInput(input.client, "client", fieldErrors);
  const finalBeneficiaries = validateFinalBeneficiaries(
    input.finalBeneficiaries,
    fieldErrors,
  );
  const initialBrief = normalizeOptionalText(input.initialBrief, "initialBrief", fieldErrors);
  const businessObjectives = normalizeOptionalText(
    input.businessObjectives,
    "businessObjectives",
    fieldErrors,
  );
  const legalNotes = normalizeOptionalText(input.legalNotes, "legalNotes", fieldErrors);
  const inquiryDate = parseDateOnly(input.inquiryDate, "inquiryDate", fieldErrors);
  const deadline = parseDateOnly(input.deadline, "deadline", fieldErrors);
  const targetMarkets = normalizeTargetMarkets(input.targetMarkets, fieldErrors);
  const deliverables = normalizeDeliverables(input.deliverables, fieldErrors);
  const attachmentSelections = Object.values(ProjectInquiryAttachmentField).flatMap(
    (field) =>
      normalizeIds(
        input.attachmentIds?.[field],
        MAX_ATTACHMENT_COUNT,
        "attachments",
        fieldErrors,
      ).map((attachmentId) => ({ attachmentId, field })),
  );

  if (!projectId) {
    return { error: "Project not found." };
  }

  if (
    input.clientOrigin != null &&
    !Object.values(ProjectInquiryClientOrigin).includes(input.clientOrigin)
  ) {
    fieldErrors.clientOrigin = "Select a valid client origin.";
  }

  if (
    input.priority != null &&
    !Object.values(ProjectInquiryPriority).includes(input.priority)
  ) {
    fieldErrors.priority = "Select a valid priority.";
  }

  if (
    Object.keys(fieldErrors).length > 0 ||
    !client ||
    finalBeneficiaries.length === 0
  ) {
    return {
      error: "Review the highlighted Stage 1 fields.",
      fieldErrors,
    };
  }

  return withPrismaRetry(() =>
    prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: projectAccessSelect,
      });

      if (!project) {
        return { error: "Project not found." } as const;
      }

      if (!hasProjectPermission(user, toPermissionContext(project), "project.update")) {
        return {
          error: "You do not have permission to complete Project Inquiry.",
        } as const;
      }

      const stageOne = project.workflowStages.find(
        (stage) => stage.stageKey === ProjectWorkflowStageKey.PROJECT_INQUIRY,
      );
      const stageTwo = project.workflowStages.find(
        (stage) =>
          stage.stageKey === ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
      );

      if (!stageOne || !stageTwo) {
        return { error: "The fixed project workflow is unavailable." } as const;
      }

      const completionMode = getWorkflowStageCompletionMode(
        project.workflowStages,
        ProjectWorkflowStageKey.PROJECT_INQUIRY,
      );
      const isFirstCompletion = completionMode === "TRANSITION";

      if (completionMode === "UNAVAILABLE") {
        return {
          error: "Project Inquiry cannot be completed from the current workflow state.",
        } as const;
      }

      const clientSnapshot = await resolvePartySnapshot(tx, client);
      const finalBeneficiarySnapshots = await Promise.all(
        finalBeneficiaries.map((beneficiary) =>
          resolvePartySnapshot(tx, beneficiary),
        ),
      );

      if (
        !clientSnapshot ||
        finalBeneficiarySnapshots.some((snapshot) => !snapshot)
      ) {
        return {
          error: "One or more selected parties are no longer available.",
          fieldErrors: {
            ...(!clientSnapshot ? { client: "Select a valid client." } : {}),
            ...(finalBeneficiarySnapshots.some((snapshot) => !snapshot)
              ? { finalBeneficiaries: "Select only valid final beneficiaries." }
              : {}),
          },
        } as const;
      }

      const uniqueAttachmentIds = [
        ...new Set(attachmentSelections.map((selection) => selection.attachmentId)),
      ];

      if (uniqueAttachmentIds.length !== attachmentSelections.length) {
        return {
          error: "An attachment can only be assigned to one Stage 1 field.",
          fieldErrors: { attachments: "Remove duplicate attachment selections." },
        } as const;
      }

      const attachments = uniqueAttachmentIds.length
        ? await tx.projectAttachment.findMany({
            where: {
              id: { in: uniqueAttachmentIds },
              projectId,
              status: AttachmentStatus.READY,
              assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
              stageId: null,
              revisionId: null,
              commentId: null,
            },
            select: { id: true },
          })
        : [];

      if (attachments.length !== uniqueAttachmentIds.length) {
        return {
          error: "One or more Stage 1 attachments are invalid.",
          fieldErrors: {
            attachments: "Use only ready attachments uploaded to this project.",
          },
        } as const;
      }

      const inquiry = await tx.projectInquiry.upsert({
        where: { projectId },
        create: {
          projectId,
          clientOrigin: input.clientOrigin ?? null,
          initialBrief,
          businessObjectives,
          inquiryDate,
          deadline,
          legalNotes,
          priority: input.priority ?? null,
        },
        update: {
          clientOrigin: input.clientOrigin ?? null,
          initialBrief,
          businessObjectives,
          inquiryDate,
          deadline,
          legalNotes,
          priority: input.priority ?? null,
        },
        select: { id: true },
      });

      await tx.projectInquiryParty.deleteMany({
        where: { inquiryId: inquiry.id },
      });
      await tx.projectInquiryParty.createMany({
        data: [
          {
            inquiryId: inquiry.id,
            role: ProjectInquiryPartyRole.CLIENT,
            sequence: 0,
            ...clientSnapshot,
          },
          ...finalBeneficiarySnapshots.map((snapshot, sequence) => ({
            inquiryId: inquiry.id,
            role: ProjectInquiryPartyRole.FINAL_BENEFICIARY,
            sequence,
            ...snapshot!,
          })),
        ],
      });

      await tx.projectInquiryTargetMarket.deleteMany({
        where: { inquiryId: inquiry.id },
      });
      if (targetMarkets.length > 0) {
        await tx.projectInquiryTargetMarket.createMany({
          data: targetMarkets.map((market) => ({
            inquiryId: inquiry.id,
            ...market,
          })),
        });
      }

      await tx.projectInquiryDeliverable.deleteMany({
        where: { inquiryId: inquiry.id },
      });
      if (deliverables.length > 0) {
        await tx.projectInquiryDeliverable.createMany({
          data: deliverables.map((deliverable) => ({
            inquiryId: inquiry.id,
            ...deliverable,
          })),
        });
      }

      await tx.projectInquiryAttachment.deleteMany({
        where: { inquiryId: inquiry.id },
      });
      if (attachmentSelections.length > 0) {
        await tx.projectInquiryAttachment.createMany({
          data: attachmentSelections.map((selection) => ({
            inquiryId: inquiry.id,
            ...selection,
          })),
        });
      }

      if (isFirstCompletion) {
        const completedAt = new Date();
        const completed = await tx.projectWorkflowStage.updateMany({
          where: {
            projectId,
            stageKey: ProjectWorkflowStageKey.PROJECT_INQUIRY,
            status: ProjectWorkflowStageStatus.AVAILABLE,
          },
          data: {
            status: ProjectWorkflowStageStatus.COMPLETED,
            completedAt,
          },
        });

        if (completed.count === 1) {
          await tx.projectWorkflowStage.updateMany({
            where: {
              projectId,
              stageKey: ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
              status: ProjectWorkflowStageStatus.LOCKED,
            },
            data: {
              status: ProjectWorkflowStageStatus.AVAILABLE,
              unlockedAt: completedAt,
            },
          });
        }
      }

      return { success: true, alreadyCompleted: !isFirstCompletion } as const;
    }, {
      maxWait: 10_000,
      timeout: 30_000,
    }),
  );
}

export function getProjectWorkflowStageKeys() {
  return PROJECT_WORKFLOW_STAGE_DEFINITIONS.map((stage) => stage.key);
}

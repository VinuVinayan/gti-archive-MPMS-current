export class ProjectTemplateError extends Error {}

/** Stage type describes intent; workspace selects a implemented engine. */
export const STAGE_TYPES = {
  BRIEF: "Form / Brief",
  RESEARCH: "Research / Folders",
  CREATIVE: "Creative / Concept Tasks",
  SPECIFICATION: "Checklist / Specification",
  APPROVAL: "Approval Chain",
  PRODUCTION: "Production / Handover",
  ACCEPTANCE: "Sample / Acceptance",
  EVENT: "Event",
  TESTING: "Testing",
  REPORT: "Final Report",
  MAINTENANCE: "Maintenance",
  GENERAL: "General / Custom",
} as const;
export type StageType = keyof typeof STAGE_TYPES;
export type StageDefinitionInput = {
  id?: string;
  name: string;
  stageType: StageType;
  description: string;
  goal: string;
  guidance: string;
  definitionOfDone: string;
  required: boolean;
  skippable: boolean;
};
export const TEMPLATE_KEYS = [
  "PACKAGING",
  "POSM",
  "RETAIL",
  "EXHIBITION",
  "DIGITAL",
  "CUSTOM",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const PACKAGING_WORKSPACES = [
  "PACKAGING_INQUIRY",
  "PACKAGING_RESEARCH",
  "PACKAGING_INITIAL_CONCEPT",
  "PACKAGING_FINAL_CONCEPT",
  "PACKAGING_CHECKLIST",
  "PACKAGING_PRODUCTION",
  "PACKAGING_ACCEPTANCE",
] as const;
export function packagingWorkspaceNumber(workspace: string) {
  const index = (PACKAGING_WORKSPACES as readonly string[]).indexOf(workspace);
  return index < 0 ? null : index + 1;
}
export function stageInstanceHref(
  projectId: string,
  stage: { id: string; workspace: string },
) {
  const legacyNumber = packagingWorkspaceNumber(stage.workspace);
  return legacyNumber
    ? `/projects/${projectId}/stages/${legacyNumber}`
    : `/projects/${projectId}/workflow/${stage.id}`;
}
export function newStageDefinition(name = "New stage"): StageDefinitionInput {
  return {
    name,
    stageType: "GENERAL",
    description: "",
    goal: "",
    guidance: "",
    definitionOfDone: "",
    required: true,
    skippable: false,
  };
}
export function validateStageDefinitions(
  value: unknown,
): StageDefinitionInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new ProjectTemplateError("Define between 1 and 100 stages.");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object")
      throw new ProjectTemplateError(`Stage ${index + 1} is invalid.`);
    const result = newStageDefinition();
    for (const field of [
      "name",
      "description",
      "goal",
      "guidance",
      "definitionOfDone",
    ] as const) {
      if (
        typeof entry[field] !== "string" ||
        entry[field].length > (field === "name" ? 160 : 10000)
      )
        throw new ProjectTemplateError(
          `Stage ${index + 1}: ${field} is invalid or too long.`,
        );
      result[field] = entry[field].trim();
    }
    if (!result.name)
      throw new ProjectTemplateError(`Stage ${index + 1} needs a name.`);
    if (!Object.hasOwn(STAGE_TYPES, entry.stageType))
      throw new ProjectTemplateError(
        `Stage ${index + 1} has an unsupported type.`,
      );
    result.stageType = entry.stageType;
    if (
      typeof entry.required !== "boolean" ||
      typeof entry.skippable !== "boolean"
    )
      throw new ProjectTemplateError("Stage options must be boolean values.");
    if (entry.required && entry.skippable)
      throw new ProjectTemplateError("Only optional stages may be skipped.");
    result.required = entry.required;
    result.skippable = entry.skippable;
    if (entry.id !== undefined) {
      if (typeof entry.id !== "string" || !entry.id || ids.has(entry.id))
        throw new ProjectTemplateError("Stage IDs must be unique.");
      result.id = entry.id;
      ids.add(entry.id);
    }
    if (result.stageType === "MAINTENANCE" && index !== value.length - 1)
      throw new ProjectTemplateError("Maintenance must be the final stage.");
    return result;
  });
}

export type StageInstanceView = {
  id: string;
  order: number;
  name: string;
  stageType: string;
  workspace: string;
  description: string;
  goal: string;
  guidance: string;
  definitionOfDone: string;
  required: boolean;
  skippable: boolean;
  status: "LOCKED" | "AVAILABLE" | "COMPLETED";
  skippedAt: string | null;
};

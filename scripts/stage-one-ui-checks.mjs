import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspace, calendarMonthGrid, contactDialog, contactValidation, readOnlyView, summary, stagePage, stageActions, service, schema, overview] = await Promise.all([
  readFile("src/components/projects/stage-one-workspace.tsx", "utf8"),
  readFile("src/components/calendar/calendar-month-grid.tsx", "utf8"),
  readFile("src/components/projects/project-contact-dialog.tsx", "utf8"),
  readFile("src/lib/project-contact-validation.ts", "utf8"),
  readFile("src/components/projects/stage-one-read-only-view.tsx", "utf8"),
  readFile("src/components/projects/project-summary-strip.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/1/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/1/actions.ts", "utf8"),
  readFile("src/lib/project-inquiry.ts", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile("src/components/projects/project-overview-workspace.tsx", "utf8"),
]);

assert(
  calendarMonthGrid.includes('cn(compactSelectClassName, "w-[96px] flex-none")') &&
    calendarMonthGrid.includes('"z-[160]"') &&
    calendarMonthGrid.includes('compact && "max-h-[260px] rounded-[14px] p-1"') &&
    !calendarMonthGrid.includes('className="z-[120]"'),
  "The compact calendar month/year menus must remain readable and above the picker panel.",
);

assert.equal(
  workspace.match(/hover:bg-\[#eaf4ed\][^"]*hover:underline[^"]*focus-visible:ring-2/g)?.length,
  2,
  "Both Add manually actions must expose matching hover and keyboard-focus treatment.",
);
assert(
  workspace.indexOf("const validation = validateProjectContactInput(") <
    workspace.indexOf("createContactDirectoryEntryAction(project.id, validation.data)"),
  "Client validation must run before the Stage 1 contact server action.",
);
assert(
  service.includes("validateProjectContactInput(input)") &&
    contactValidation.includes('fieldErrors.email = "Enter a valid email address."') &&
    contactValidation.includes('fieldErrors.phone =') &&
    contactValidation.includes("E164_PHONE_PATTERN"),
  "Server contact creation must enforce shared email and international-phone validation.",
);
assert(
  contactDialog.includes("inputRefs.current[firstInvalidField]?.focus()") &&
    contactDialog.includes('role="alert"') &&
    contactDialog.includes("Include country code, e.g. +971, +91, +44."),
  "Contact validation errors must be inline, focused, and explain the international phone format.",
);
assert(
  !workspace.includes(".slice(0, 30)") &&
    workspace.includes('role="listbox"') &&
    workspace.includes("max-h-[250px]") &&
    workspace.includes("overflow-y-auto") &&
    workspace.includes("overscroll-contain"),
  "Multi-entry suggestions must expose the complete list inside a bounded scroll container.",
);
assert(
  workspace.includes(
    "Select a previous value, or type a new deliverable and press Enter to add it.",
  ),
  "Deliverables must clearly explain how to commit a typed value.",
);
assert(
  workspace.includes('import { RichTextEditor } from "@/components/ui/rich-text-editor"') &&
    workspace.includes('<RichTextEditor') &&
    workspace.includes('minHeightClassName="min-h-[112px]"') &&
    workspace.includes('[&_.rich-text-prose]:pb-12'),
  "Stage 1 description fields must use the shared rich-text editor while preserving attachment space.",
);
assert(
  workspace.includes('label="Legal Notes"') &&
    workspace.includes('className="lg:row-span-2"') &&
    workspace.includes('className={cn("min-w-0", className)}'),
  "Legal Notes must span the Deadline and Priority rows so its growth does not leave an empty left column.",
);
assert(
  workspace.includes('ariaLabel="Key business objectives"') &&
    !workspace.includes("BusinessObjectiveTagsInput") &&
    readOnlyView.includes("RichTextContent"),
  "Key Business Objectives must use the shared rich-text editor and formatted read-only renderer.",
);
assert(
  workspace.includes("onClick={toggleSuggestions}") &&
    workspace.includes("Loading suggestions...") &&
    workspace.includes("!suggestionsLoaded") &&
    workspace.includes("filteredSuggestions.length > 0"),
  "Deliverable and target-market chevrons must open real suggestions and disappear after an empty result.",
);
assert(
  workspace.includes('title={contactTarget === "client" ? "Add Client" : "Add Beneficiary"}') &&
    workspace.includes('submitLabel={contactTarget === "client" ? "Add Client" : "Add Beneficiary"}') &&
    !workspace.includes("Save contact"),
  "Manual client and beneficiary dialogs must use contextual headings and add actions.",
);
assert(
  workspace.includes('const stageTwoHref = `/projects/${project.id}/stages/2`') &&
    workspace.includes("router.push(stageTwoHref)") &&
    !workspace.includes('router.push(`/projects/${project.id}`)'),
  "Completing Stage 1 must open Stage 2 directly instead of the project overview.",
);
assert(
  workspace.includes('pageData.workflowStatus === "COMPLETED"') &&
    workspace.includes('href={`/projects/${project.id}/stages/2`}') &&
    workspace.includes('enabled: pageData.canEdit') &&
    workspace.includes('"Save Changes"') &&
    workspace.includes('"Project Inquiry updated."') &&
    workspace.includes("if (result.alreadyCompleted)") &&
    !workspace.includes('if (pageData.workflowStatus === "COMPLETED") {\n      router.push(stageTwoHref)') &&
    service.includes("alreadyCompleted: !isFirstCompletion"),
  "Authorized users must be able to save completed Stage 1 changes while Next Stage remains a separate navigation action.",
);

assert(
  workspace.includes("ProjectFlowSummaryStrip") &&
    summary.includes("people.slice(0, visibleCount)") &&
    /people=\{executors\}[\s\S]*?visibleCount=\{3\}/.test(summary) &&
    summary.includes("+{remainingCount}") &&
    summary.includes("DropdownMenuTrigger asChild"),
  "Stage 1 must reuse the shared participant summary with three visible executor names and +N overflow.",
);

for (const field of [
  "Client",
  "External / Internal - for execution",
  "Final Beneficiaries",
  "Target Market",
  "Initial Brief",
  "Key Business Objectives",
  "Deliverables",
  "Date",
  "Deadline",
  "Legal Notes",
  "Priority",
]) {
  assert(workspace.includes(`label="${field}"`), `Missing Stage 1 field: ${field}`);
}

assert(
  workspace.includes('<StageOneFormField label="Client" required') &&
    workspace.includes('label="Final Beneficiaries"') &&
    workspace.includes("multiple"),
  "Client and the multi-select Final Beneficiaries field must be required.",
);
assert.equal(
  workspace
    .match(/<StageOneFormField[\s\S]*?>/g)
    ?.filter((tag) => /\brequired\b/.test(tag)).length,
  2,
  "Exactly two Stage 1 fields should visibly show required markers.",
);

for (const snippet of [
  "Stage 1 - Project Inquiry",
  "Project Name",
  "Project Owner",
  "Project Co-Owners",
  "Open Stage",
  "Next Stage",
  "All Stages",
  "AppDatePicker",
  "AttachmentTextarea",
  "MultiEntryInput",
  "createContactDirectoryEntryAction",
  "completeProjectInquiryAction",
  'assetType: "GENERAL_PROJECT_ASSET"',
]) {
  assert(
    workspace.includes(snippet) || overview.includes(snippet) || summary.includes(snippet),
    `Missing UI behavior: ${snippet}`,
  );
}

for (const snippet of [
  'useState<"edit" | "view">',
  'pageData.canEdit ? "edit" : "view"',
  'role="tablist"',
  'aria-selected={mode === "edit"}',
  'aria-selected={mode === "view"}',
  'onClick={() => setMode("edit")}',
  'onClick={() => setMode("view")}',
  'mode === "view"',
  "StageOneReadOnlyView",
  "inquiry={viewInquiry}",
]) {
  assert(workspace.includes(snippet), `Missing Stage 1 mode behavior: ${snippet}`);
}

assert(
  workspace.includes("const draftInquiry = useMemo<ProjectInquiryRecord>") &&
    workspace.includes("targetMarkets: targetMarkets.map((label) => ({ label }))") &&
    workspace.includes("priority: priority || null") &&
    workspace.includes("const viewInquiry = pageData.canEdit ? draftInquiry : saved") &&
    workspace.includes("inquiry={viewInquiry}"),
  "Stage 1 View mode must render the current edit draft without completing the stage.",
);

assert(
  stagePage.includes("ProjectBackButton") &&
    stagePage.includes('href={`/projects/${slug}`}'),
  "Stage 1 must retain its safe Back navigation.",
);

for (const label of [
  "Client Information",
  "Client",
  "Client Type",
  "Final Beneficiary",
  "Target Market",
  "Project Brief",
  "Initial Brief",
  "Key Business Objectives",
  "Project Deliverables",
  "Deliverables",
  "Project Details",
  "Date",
  "Deadline",
  "Priority",
  "Legal Notes",
  "Attachments",
  "Not provided",
]) {
  assert(readOnlyView.includes(label), `Missing Stage 1 read-only content: ${label}`);
}

assert(
  !readOnlyView.includes("<input") &&
    !readOnlyView.includes("<select") &&
    !readOnlyView.includes("<textarea"),
  "Stage 1 View mode must not render editable form controls.",
);
assert(
  workspace.includes("finalBeneficiaries.map((beneficiary)") &&
    workspace.includes("setFinalBeneficiaries") &&
    readOnlyView.includes("inquiry.finalBeneficiaries.map") &&
    service.includes("finalBeneficiarySnapshots.map"),
  "Stage 1 must accept, persist, and display multiple final beneficiaries.",
);
assert(
  !workspace.includes('label="Collaborators"') &&
    !workspace.includes("saveCollaboratorAction") &&
    !workspace.includes("ProjectUserSelector") &&
    !readOnlyView.includes('label="Collaborators"') &&
    !service.includes("requestedCollaboratorIds"),
  "Stage 1 must not duplicate or mutate collaborator selection from project creation.",
);
assert(
  !readOnlyView.includes("completeProjectInquiryAction") &&
    !readOnlyView.includes("createContactDirectoryEntryAction") &&
    !readOnlyView.includes("saveCollaboratorAction"),
  "Opening or rendering View mode must not perform Stage 1 mutations.",
);
assert(
  readOnlyView.includes('className="mt-3 text-[14px] leading-7') &&
    readOnlyView.includes("RichTextContent") &&
    readOnlyView.includes("inquiry?.initialBrief") &&
    readOnlyView.includes("inquiry?.businessObjectives") &&
    readOnlyView.includes("inquiry?.legalNotes"),
  "Read-only narrative fields must preserve persisted rich-text formatting.",
);
assert(
  readOnlyView.includes("party.company") &&
    readOnlyView.includes("party.position") &&
    readOnlyView.includes("party.email") &&
    readOnlyView.includes("party.phone"),
  "Read-only parties must render available snapshot details.",
);
assert(
  readOnlyView.includes("/api/project-assets/${attachment.id}/preview") &&
    readOnlyView.includes("/api/project-assets/${attachment.id}/download") &&
    !readOnlyView.includes("upload-url"),
  "View mode attachments must reuse safe preview/download routes without upload controls.",
);
assert(
  readOnlyView.includes("formatDate") &&
    readOnlyView.includes('new Intl.DateTimeFormat("en-GB"'),
  "View mode must format date-only values for people to read.",
);

assert(
  overview.includes("href={`/projects/${projectId}/stages/${stage.number}`}") &&
    overview.includes("const stageOpenable = !locked"),
  "The overview CTA should open the dedicated implemented stage route.",
);
assert(
  stagePage.includes("canOpenImplementedWorkflowStage") &&
    stagePage.includes("StageLockedState"),
  "The Stage 1 route must reject a missing or locked workflow row.",
);
assert(
  stagePage.includes("getProjectStageShellById") &&
    stagePage.includes("getProjectInquiryPageData") &&
    stagePage.includes("StageOneWorkspace"),
  "The Stage 1 route should load the project shell and persisted inquiry data.",
);
assert(stageActions.includes('"use server"'), "Stage 1 mutations must use authenticated server actions.");
assert(service.includes('"project.update"'), "Stage 1 mutation must enforce project update permission.");
assert(
  service.match(/hasProjectPermission\(user, toPermissionContext\(project\), "project\.update"\)/g)?.length >= 2,
  "Stage 1 manager reads and option queries must enforce project update permission.",
);
assert(
  service.match(/hasProjectPermission\(user, toPermissionContext\(project\), "stage\.view"\)/g)?.length >= 2,
  "Stage 1 manager reads and option queries must enforce effective stage visibility.",
);
assert(
  stagePage.includes("!isBusinessAdministratorRole(user.role)") &&
    stagePage.includes("redirect(`/projects/${slug}`)"),
  "Related USERS must be redirected from the Stage 1 manager route.",
);
assert(service.includes("prisma.$transaction"), "Stage 1 completion must be transactional.");
assert(
  service.includes("timeout: 30_000") && service.includes("maxWait: 10_000"),
  "The multi-step Stage 1 transaction must allow bounded time for a remote database.",
);
assert(
  workspace.includes("value={priority}") &&
    !workspace.includes("value={priority || undefined}"),
  "Priority must remain a controlled Select for the component lifetime.",
);
assert(schema.includes("model ProjectInquiry"), "Stage 1 must persist its own domain record.");
assert(
  schema.includes("@@index([inquiryId, role, sequence])") &&
    !schema.includes("@@unique([inquiryId, role])"),
  "The inquiry party schema must allow multiple final beneficiaries.",
);
assert(
  schema.includes("inquiryDate        DateTime?                    @db.Date") &&
    schema.includes("deadline           DateTime?                    @db.Date"),
  "Stage 1 dates must use date-only database semantics.",
);

console.log("Stage 1 end-to-end static checks passed.");

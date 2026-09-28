import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  workspace,
  route,
  actions,
  concepts,
  access,
  history,
  realtime,
  recipients,
  notificationTriggers,
  chatPage,
  chatWorkspace,
  stageThreePage,
  stageFourPage,
  stageThreeFoldersPage,
  stageFourFoldersPage,
  schema,
  migration,
  notificationMigration,
] = await Promise.all([
  readFile("src/components/projects/concept-stage-workspace.tsx", "utf8"),
  readFile("src/components/projects/concept-stage-route.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/concept-actions.ts", "utf8"),
  readFile("src/lib/project-concepts.ts", "utf8"),
  readFile("src/lib/project-concept-access.ts", "utf8"),
  readFile("src/lib/project-history.ts", "utf8"),
  readFile("src/app/api/realtime/ably/token/route.ts", "utf8"),
  readFile("src/lib/notification-center/recipients.ts", "utf8"),
  readFile("src/lib/notification-center/triggers.ts", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/chat/page.tsx", "utf8"),
  readFile("src/components/projects/project-chat-workspace.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/3/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/4/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/3/concepts/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/4/concepts/page.tsx", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile(
    "prisma/migrations/20260809120000_concept_executor_assignment_round_one/migration.sql",
    "utf8",
  ),
  readFile(
    "prisma/migrations/20260817110000_concept_brief_assignment_notification/migration.sql",
    "utf8",
  ),
]);

for (const label of [
  "Create Task",
  "Concept Taskers",
  "Concept Name *",
  "Assigned Executor *",
  "Concept Brief",
  "Brief Attachments",
  "Viewing Executor",
  "All Executors",
  "No taskers yet",
  "Concept 1",
  "Edit Task",
  "Delete Task",
]) {
  assert(workspace.includes(label), `Missing Round 1 concept UI: ${label}`);
}

assert(
  route.includes('"Create and manage concept taskers."') &&
    workspace.includes("Manage your concept taskers.") &&
    route.includes('import { ListTodo } from "lucide-react"') &&
    workspace.includes('<ListTodo className="h-7 w-7" />') &&
    !workspace.includes('<Folder className="h-7 w-7 fill-current" />') &&
    !workspace.includes("Create Concept") &&
    !workspace.includes("Concept Folders"),
  "Stage 3/4 must present concept containers as taskers with task icons and label creation as Create Task.",
);
assert(
  concepts.includes("createdById: true") &&
    concepts.includes("folder.createdById === currentUserId") &&
    concepts.includes("!folder.promotedStage4Concept") &&
    concepts.includes("export async function deleteProjectConceptFolder") &&
    concepts.includes("Only the person who created this task can delete it.") &&
    concepts.includes("tx.projectConceptFolder.delete") &&
    concepts.includes("tx.projectStage.delete") &&
    actions.includes("deleteProjectConceptFolderAction") &&
    workspace.includes("folder.canDelete") &&
    workspace.includes('tone="destructive"') &&
    workspace.includes("all of its chat, captions, submissions, and attachments"),
  "Task deletion must be creator-only, dependency-aware, server-enforced, and explicitly confirmed in Stage 3/4.",
);
assert(
  workspace.includes("SelectTrigger") && workspace.includes("SelectContent"),
  "Executor controls must use the themed select component rather than a native select.",
);
assert(
  workspace.includes("max-h-[calc(100dvh-1.5rem)]") &&
    workspace.includes("min-h-0 min-w-0 flex-1") &&
    workspace.includes("overflow-x-hidden overflow-y-auto overscroll-contain") &&
    workspace.includes("shrink-0 flex-col-reverse gap-3 border-t"),
  "The concept details dialog must fit the viewport, scroll its fields, and keep actions accessible.",
);
assert(
  workspace.includes("max-w-[680px]") &&
    workspace.includes("touch-pan-y overflow-x-hidden overflow-y-auto") &&
    workspace.includes("[scroll-padding-block:1.25rem]") &&
    workspace.includes("[scrollbar-gutter:stable]") &&
    workspace.includes("grid w-full min-w-0 gap-5") &&
    workspace.includes('className="box-border w-full min-w-0 max-w-full"'),
  "The Create Task dialog must contain wide editor controls without shifting or horizontally scrolling the form.",
);
assert(
  workspace.includes('role="alert"') &&
    workspace.includes("block min-h-4 w-full break-words") &&
    workspace.includes("relative z-10 flex shrink-0 flex-col-reverse"),
  "Concept Brief validation must remain fully visible above the isolated dialog action bar.",
);
assert(
  workspace.includes('aria-busy={pending}') &&
    workspace.includes('disabled={!canSubmit || pending}') &&
    workspace.includes('"Creating…"') &&
    workspace.includes('"Saving…"') &&
    workspace.includes('animate-spin'),
  "Create/Edit Task must show a pending spinner and status label while preventing duplicate submissions.",
);
assert(
  workspace.includes("border-[#cfdad1] bg-[#fbfdfb]") &&
    workspace.includes('minHeightClassName="min-h-[112px]"') &&
    workspace.includes('ariaLabel="Concept brief"') &&
    workspace.includes("border border-dashed border-[#b9c9bc]") &&
    workspace.includes('className="sr-only"') &&
    workspace.includes("Selected brief attachments"),
  "Concept fields and brief attachments must use clearly bordered, aligned containers.",
);
assert(
  !workspace.includes("AssetImageThumbnail") &&
    workspace.includes("Approved Concept File") &&
    workspace.includes("stageNumber === 3 && folder.approvedAttachment") &&
    workspace.includes("folder.approvedAttachment.previewPath") &&
    workspace.includes("folder.approvedAttachment.downloadPath") &&
    workspace.includes("folder.startingReference.previewPath") &&
    workspace.includes("AssetPreviewButton"),
  "Stage 3 and Stage 4 tasker cards must stay compact without image thumbnails while retaining file preview and download actions.",
);
assert(
  workspace.includes("Deadline *") &&
    workspace.includes("DateTimePicker") &&
    !workspace.includes('type="datetime-local"') &&
    workspace.includes('popoverZIndex={190}') &&
    workspace.includes("deadline: parsedDeadline?.toISOString()") &&
    workspace.includes("value: { name, assignedExecutorId, deadline, brief }") &&
    workspace.includes("formatConceptDeadline(folder.deadline)") &&
    actions.includes("deadline: string") &&
    concepts.includes("plannedDueAt: deadline") &&
    concepts.includes("plannedDueAt: requestedDeadline") &&
    concepts.includes('error: "Deadline must be in the future."'),
  "Every new concept task must require, autosave, persist, validate, display, and allow editing its own deadline.",
);
assert(
  workspace.includes('assetType: "GENERAL_PROJECT_ASSET"') &&
    workspace.includes("/api/project-assets/upload-url") &&
    workspace.includes("/api/project-assets/complete") &&
    workspace.includes("Promise.allSettled"),
  "Brief files must reuse the existing attachment upload pipeline and preserve partial successes.",
);
assert(
  workspace.includes("Concept Brief *") &&
    workspace.includes(">Brief Attachments</span>") &&
    workspace.includes("Concept Brief is required.") &&
    !workspace.includes("At least one Brief Attachment is required.") &&
    workspace.includes("disabled={!canSubmit || pending}"),
  "Concept creation must require a brief while keeping brief attachments optional.",
);
assert(
  workspace.includes("taskerStageId: null") &&
    workspace.includes("briefAttachmentIds") &&
    workspace.includes("discardConceptBriefAttachments") &&
    concepts.includes('error: "Concept Brief is required."') &&
    !concepts.includes('error: "At least one Brief Attachment is required."') &&
    concepts.includes("INVALID_CONCEPT_BRIEF_ATTACHMENTS") &&
    concepts.includes("data: { stageId: taskerStage.id }") &&
    actions.includes("briefAttachmentIds?: string[]"),
  "Concept creation must accept no attachment and atomically validate/associate any provided brief attachments.",
);
assert(
  stageThreePage.includes("searchParams") &&
    stageThreePage.includes("executorFilter={executor}") &&
    stageFourPage.includes("searchParams") &&
    stageFourPage.includes("executorFilter={executor}") &&
    route.includes("executorId: executorFilter") &&
    workspace.includes("/stages/${stageNumber}${query}"),
  "Stage 3/4 executor filtering must be URL-backed.",
);
assert(
  workspace.includes("defaultAssignedExecutorId") &&
    workspace.includes("executors.length === 1 ? executors[0]?.id") &&
    workspace.includes("Automatically assigned because this project has one executor") &&
    workspace.includes("Choose the project executor responsible for this concept"),
  "Single-executor concepts must auto-assign while multi-executor projects retain an explicit owner choice.",
);
assert(
  route.includes("folders.canManage") &&
    route.includes("folders.canCompleteStage") &&
    route.includes("folders.selectedExecutorId") &&
    concepts.includes("requestedExecutorId") &&
    concepts.includes(": user.id"),
  "Only concept managers may use the switcher; executor views must remain self-scoped.",
);
assert(
  concepts.includes("actualStartedAt: null") &&
    concepts.includes("startedById: null") &&
    concepts.includes("invoiceRequired: false") &&
    concepts.includes("status: StageStatus.ONGOING"),
  "New concept taskers must be ongoing but not accepted or started.",
);
assert(
  !concepts.includes("ensureDefaultProjectConceptFolder") &&
    !concepts.includes("getDefaultTaskerStageId") &&
    stageFourPage.includes("ConceptStageRoute"),
  "Stage 3/4 reads must never manufacture Concept 1.",
);
assert(
  concepts.includes("Assigned Executor must be a current project executor") &&
    concepts.includes("project.executors.some") &&
    concepts.includes("Assigned Executor is required"),
  "Concept mutations must require a current ProjectExecutor.",
);
assert(
  concepts.includes("locked after work starts") &&
    concepts.includes("taskerStage.actualStartedAt") &&
    concepts.includes("taskerStageId: folder.taskerStageId"),
  "Accepted concepts must lock assignment/brief while retaining tasker identity.",
);

for (const helper of [
  "canViewProjectConcept",
  "canManageProjectConcept",
  "canCompleteProjectConceptStage",
  "canReviewProjectConcept",
  "canWorkOnProjectConcept",
  "assertConceptTaskerAccessIfNeeded",
  "getProjectConceptParticipantUserIds",
]) {
  assert(access.includes(helper), `Missing centralized concept policy helper: ${helper}`);
}
assert(
  access.includes("isGlobalProjectAdministrator(user)"),
  "Business administrators must receive implicit global concept authority.",
);
assert(
  workspace.includes("canCompleteStage && !managementLocked && stageCompletionReady") &&
    workspace.includes("canCompleteStage &&") &&
    workspace.includes("completionDialogOpen &&") &&
    workspace.includes("const stageCompletionReady =") &&
    workspace.includes("disabled={isCompleting}") &&
    workspace.includes("completionDialogOpen &&\n          stageCompletionReady") &&
    concepts.includes("canCompleteProjectConceptStage(user, managerContext)") &&
    concepts.includes("unapprovedConcepts.length > 0") &&
    concepts.includes("Every Stage 3 task must have an approved file or be completed without a file") &&
    workspace.includes("isEmptyStageThree || isEmptyStageFour || allConceptsComplete") &&
    concepts.includes("Only the project owner or an administrator can complete Stage 3."),
  "Normal stage completion must wait for finished tasks and remain owner-authorized.",
);
assert(
  workspace.includes("No Stage 3 concepts have been created") &&
    workspace.includes("Stage 4 will open without automatically creating any taskers") &&
    workspace.includes('"Continue to Stage 4"') &&
    workspace.includes("Go to Stage 4") &&
    workspace.includes('href={`/projects/${project.id}/stages/4`}') &&
    workspace.includes("stageNumber === 3 && managementLocked") &&
    workspace.includes('"Continue to Stage 5"') &&
    workspace.includes("Go to Stage 5") &&
    workspace.includes('href={`/projects/${project.id}/stages/5`}') &&
    workspace.includes("stageNumber === 4 && managementLocked") &&
    workspace.includes('cancelLabel="Cancel"') &&
    !concepts.includes("const stageTransition = await completeStageThreeConcepts") &&
    !concepts.includes("const stageTransition = await completeStageFourConcepts"),
  "Stages 3 and 4 must advance only through their explicit manual continue/skip actions, then retain direct navigation to the unlocked next stage.",
);
assert(
  concepts.includes("const isProjectExecutor = project.executors.some") &&
    concepts.includes("!canManage && !isProjectExecutor && visibleFolders.length === 0"),
  "Project executors must be able to open an unlocked empty concept-stage workspace without gaining access to unassigned concept folders.",
);
assert(
  route.includes("const folderVersion = folders.folders") &&
    route.includes('key={`${stageNumber}:${folders.selectedExecutorId ?? "all"}:${folderVersion}`}') &&
    route.includes("StageRouteShell") &&
    actions.includes("publishProjectActivityUpdatedAfterResponse") &&
    actions.includes('eventType: "participant_access_changed"') &&
    actions.includes("changedEntityId: folder.id"),
  "Concept creation and assignment changes must broadcast a project refresh, and refreshed server folders must remount stale client state.",
);
assert(
  route.includes('title={foldersOnly ? "Concept Folders"') &&
    route.includes("Browse and manage Stage ${stageNumber} concept folders.") &&
    stageThreeFoldersPage.includes("foldersOnly") &&
    stageFourFoldersPage.includes("foldersOnly") &&
    concepts.includes('backHref: `/projects/${encodeURIComponent(input.projectId)}/stages/${stageNumber}`'),
  "Concept Folders must have a dedicated listing route while Back to Stage remains a direct stage destination.",
);
assert(
  schema.includes("BRIEF_ACCEPTANCE_REQUIRED") &&
    notificationMigration.includes("BRIEF_ACCEPTANCE_REQUIRED") &&
    notificationTriggers.includes("notifyConceptBriefAssigned") &&
    notificationTriggers.includes('type: "BRIEF_ACCEPTANCE_REQUIRED"') &&
    notificationTriggers.includes("Review and accept the brief to begin work.") &&
    actions.includes('runNotificationTask("concept-brief-assigned"') &&
    actions.includes('runNotificationTask("concept-brief-reassigned"') &&
    actions.includes("if (folder.assignmentChanged)") &&
    actions.includes("notifyConceptBriefAssigned") &&
    concepts.includes("assignmentChanged,"),
  "Creating or reassigning a concept must notify only the assigned executor to accept the brief in that concept chat.",
);
assert(
  history.includes('mode: "work"') &&
    access.includes("Only the assigned concept executor") &&
    history.includes("Concept taskers cannot use the legacy approve/complete action"),
  "Accept Brief must be assigned-executor-only and legacy tasker approval must be blocked.",
);
assert(
  chatWorkspace.includes("!activeStage?.isTasker") &&
    chatWorkspace.includes("Request Revision"),
  "Concept mode must hide only legacy approval and retain Request Changes/Revision.",
);
assert(
  chatWorkspace.includes('"flex h-full flex-col overflow-hidden"') &&
    chatWorkspace.includes('? "min-h-0 flex-1"') &&
    chatWorkspace.includes('isConceptMode ? "" : "sticky bottom-1"') &&
    chatWorkspace.includes('"flex-row items-end gap-1.5') &&
    chatWorkspace.includes('"max-h-[96px] min-h-10') &&
    chatWorkspace.includes('max-w-[1280px]'),
  "Concept chat must reserve layout space for the composer instead of overlaying timeline content.",
);
assert(
  realtime.includes("assertConceptTaskerAccessIfNeeded") &&
    realtime.includes("Concept participant access denied"),
  "Ably capability issuance must enforce concept participation.",
);
assert(
  recipients.includes("getProjectConceptParticipantUserIds") &&
    recipients.includes("stageId?: string | null") &&
    chatPage.includes("conceptParticipantIds") &&
    chatPage.includes("mentionParticipants.filter"),
  "Notifications and mention suggestions must use the concept participant set.",
);
assert(
  notificationTriggers.includes("buildProjectStageNotificationUrl") &&
    notificationTriggers.includes("/stages/${stageNumber}/concepts/") &&
    notificationTriggers.includes("getProjectConceptAccessContext"),
  "Concept notifications must deep-link to the secured concept route.",
);
assert(
  /assignedExecutorId\s+String\?/.test(schema) &&
    schema.includes("ProjectConceptFolderAssignedExecutor") &&
    schema.includes("references: [projectId, userId]") &&
    migration.includes('REFERENCES "ProjectExecutor"("projectId", "userId")'),
  "Concept assignment must use the ProjectExecutor composite database relationship.",
);
assert(
  migration.includes('stage."startedById"') &&
    migration.includes("HAVING COUNT(*) = 1") &&
    !migration.includes("ORDER BY"),
  "Legacy assignment backfill must use only a valid starter or exactly one executor.",
);
assert(
  !concepts.includes("completeProjectStage") &&
    !concepts.includes("ProjectStageFileHandoff") &&
    !concepts.includes("ComparisonComment"),
  "Round 1 must not add completion, handoff, or a replacement comparison system.",
);
assert(actions.includes('"use server"') && actions.includes("editProjectConceptFolder"));

console.log("Stage 3/4 Round 1 concept UI/security checks passed.");

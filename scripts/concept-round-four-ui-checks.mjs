import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const [
  workspace,
  chat,
  concepts,
  actions,
  stageFive,
  stageFiveActions,
  notifications,
  history,
  schema,
  singleApprovalMigration,
] =
  await Promise.all([
    readFile("src/components/projects/concept-stage-workspace.tsx", "utf8"),
    readFile("src/components/projects/project-chat-workspace.tsx", "utf8"),
    readFile("src/lib/project-concepts.ts", "utf8"),
    readFile(
      "src/app/(dashboard)/projects/[slug]/stages/concept-actions.ts",
      "utf8",
    ),
    readFile("src/lib/stage-five.ts", "utf8"),
    readFile(
      "src/app/(dashboard)/projects/[slug]/stages/5/actions.ts",
      "utf8",
    ),
    readFile("src/lib/notification-center/triggers.ts", "utf8"),
    readFile("src/lib/project-history.ts", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
    readFile(
      "prisma/migrations/20260818160000_concept_single_approved_attachment/migration.sql",
      "utf8",
    ),
  ]);
const migrationDirectories = await readdir("prisma/migrations");

assert(
  schema.includes("approvedAttachmentId") &&
    schema.includes("approvedById") &&
    schema.includes("approvedAt") &&
    schema.includes("model ProjectStageFileHandoff") &&
    schema.includes("model ProjectFileChecklist") &&
    !schema.includes("stage4FinalAttachmentId") &&
    !migrationDirectories.some((name) => /round[_-]?four/i.test(name)),
  "Round 4 must reuse the existing approval, handoff, checklist, and workflow schema without a migration.",
);

assert(
  concepts.includes("markStageFourFinalApprovedAttachment") &&
    concepts.includes("workflowStageKey: ProjectWorkflowStageKey.PROJECT_DEVELOPMENT") &&
    concepts.includes("formalConceptAttachmentTypes") &&
    concepts.includes("AttachmentStatus.READY") &&
    concepts.includes("attachment.revision.stageId !== input.taskerStageId") &&
    concepts.includes("Only a ready formal revision file from this exact Stage 4 concept") &&
    concepts.includes("canReviewProjectConcept(user, accessContext)"),
  "Final designation must be concept-scoped, formal-revision-only, READY, and server-authorized.",
);

assert(
  concepts.includes("Final Approved File selection is locked because Stage 4 is completed") &&
    concepts.includes("hasStageFiveDownstreamActivityForAttachment") &&
    concepts.includes("This final file already has Stage 5 activity and cannot be replaced directly.") &&
    concepts.includes("projectStageFileHandoff.delete") &&
    concepts.includes("removedUnusedHandoff"),
  "Replacement must lock after completion, protect meaningful Stage 5 work, and remove only an unused initialized handoff.",
);
assert(
  concepts.includes("approveConceptRevision") &&
    concepts.includes("approvedAttachmentId: attachment.id") &&
    concepts.includes("id: { not: input.approvedAttachmentId }") &&
    concepts.includes("status: ProjectRevisionStatus.APPROVED") &&
    concepts.includes("submissionReviewStatus: SubmissionReviewStatus.APPROVED") &&
    concepts.includes("status: StageStatus.COMPLETED") &&
    concepts.includes("allConceptsApproved: conceptsWithoutFinalFile === 0") &&
    !concepts.includes("const stageTransition = await completeStageFourConcepts"),
  "Final-file approval must approve its revision and only the selected file, then complete the concept tasker without bypassing explicit Stage 4 confirmation.",
);
assert(
  singleApprovalMigration.includes('attachment."id" <> concept."approvedAttachmentId"') &&
    singleApprovalMigration.includes('"submissionReviewStatus" = \'PENDING_REVIEW\'') &&
    singleApprovalMigration.includes('revision."id" <> approved_attachment."revisionId"'),
  "The single-file approval migration must repair non-designated approved files and superseded approved revisions.",
);
assert(
  concepts.includes("revokeStageFourFinalApprovedAttachment") &&
    concepts.includes("getConceptApprovalRevocationEligibility") &&
    concepts.includes("resolveConceptApprovalRevocationEligibility") &&
    concepts.includes('"STAGE5_DEPENDENCY_EXISTS"') &&
    concepts.includes("reopensWorkflowStage") &&
    concepts.includes("Stage 5 is already completed") &&
    !concepts.includes("Stage 5 already contains checklist activity") &&
    !concepts.includes("This Final Approved File already has Stage 5 activity") &&
    concepts.includes("projectStageFileHandoff.delete") &&
    concepts.includes("approvedAttachmentId: null") &&
    concepts.includes("submissionReviewStatus: SubmissionReviewStatus.PENDING_REVIEW") &&
    concepts.includes("status: StageStatus.ONGOING"),
  "Stage 4 revocation must remain available through active Stage 5 and stop after Stage 5 completion.",
);

assert(
  stageFive.includes("hasStageFiveDownstreamActivityForAttachment") &&
    stageFive.includes("hasMeaningfulChecklistValue") &&
    stageFive.includes("item.status !== ProjectFileChecklistItemStatus.PENDING") &&
    stageFive.includes("item._count.attachments > 0") &&
    stageFive.includes("checklist._count.requests > 0"),
  "Stage 5 downstream activity must be defined once from values, statuses, attachments, and requests.",
);

const stageFourCompletionSource = concepts.slice(
  concepts.indexOf("export async function completeStageFourConcepts"),
  concepts.indexOf("export async function getProjectConceptChatContext"),
);

assert(
  concepts.includes("completeStageFourConcepts") &&
    concepts.includes("canCompleteProjectConceptStage(user, managerContext)") &&
    concepts.includes("Only the project owner or an administrator can complete Stage 4.") &&
    concepts.includes("Every Stage 4 task must have a Final Approved File or be marked as complete before Stage 4 can be completed.") &&
    concepts.includes("projectStageFileHandoff.upsert") &&
    concepts.includes("projectFileChecklist.upsert") &&
    concepts.includes("TransactionIsolationLevel.Serializable") &&
    concepts.includes("getWorkflowStageCompletionMode") &&
    concepts.includes("ProjectWorkflowStageStatus.COMPLETED") &&
    concepts.includes("ProjectWorkflowStageStatus.AVAILABLE") &&
    concepts.includes("id: stageFiveWorkflow.id") &&
    concepts.includes("status: ProjectWorkflowStageStatus.LOCKED") &&
    !stageFourCompletionSource.includes("PRODUCTION_AND_HANDOVER"),
  "Owner/administrator Stage 4 completion must atomically hand off final files, unlock Stage 5, and leave Stage 6 untouched.",
);

assert(
  workspace.includes('const isEmptyStageFour = stageNumber === 4 && completionConcepts.length === 0') &&
    workspace.includes('"Skip Stage 4"') &&
    workspace.includes('"Skip Stage 4?"') &&
    workspace.includes("A final file will need to be uploaded directly in Stage 5.") &&
    concepts.includes("const skipped = stageFourConcepts.length === 0") &&
    concepts.includes("Stage 4 can be skipped only while it is available and Stage 5 is still locked.") &&
    concepts.includes("action: ActivityLogAction.STAGE_SKIPPED") &&
    concepts.includes("skipped: true") &&
    concepts.includes("for (const concept of approvedStageThreeConcepts)"),
  "An empty available Stage 4 must expose a confirmed, audited skip that unlocks Stage 5 without fake source data.",
);

for (const label of [
  "Final Approved",
  "In Progress",
  "Changes Requested",
  "Continue to Stage 5",
  "Stage 4 Completed",
  "Final Approved File",
  "will continue to Stage 5",
  "Every Stage 4 task must have a Final Approved File or be marked as complete",
]) {
  assert(workspace.includes(label), `Missing Round 4 Stage 4 UI label: ${label}`);
}
assert(
  workspace.includes("completeStageFourConceptsAction") &&
    workspace.includes("allConceptsComplete") &&
    workspace.includes("isEmptyStageFour || allConceptsComplete") &&
    workspace.includes("canCompleteStage && !managementLocked && stageCompletionReady") &&
    workspace.includes("confirmDisabled={!stageCompletionReady}") &&
    concepts.includes("conceptsWithoutFinalFile.length > 0") &&
    concepts.includes("Every Stage 4 task must have a Final Approved File or be marked as complete") &&
    !workspace.includes("Final files for Stage 5") &&
    !workspace.includes("Send to Stage 5"),
  "Stage 4 completion must require every task to be approved or marked as complete while allowing an empty stage to skip.",
);
assert(
  workspace.includes("stageNumber === 4 && folder.approvedAttachment") &&
    workspace.includes("folder.approvedAttachment.previewPath") &&
    workspace.includes("folder.approvedAttachment.downloadPath") &&
    workspace.includes("!folder.approvedAttachment &&") &&
    workspace.includes("folder.startingReference ?") &&
    workspace.includes("Starting Reference · Stage 3"),
  "Stage 4 cards must preview their own final approved file and use the Stage 3 file only as a clearly labelled pre-approval reference.",
);

for (const label of [
  "Mark Final Approved File",
  "Final Approved File",
  "Replace the currently approved final file?",
  "Replace Final Approved File",
]) {
  assert(chat.includes(label), `Missing Round 4 chat designation UI: ${label}`);
}
assert(
  chat.includes("Select exactly one submitted file below") &&
    chat.includes('"Select this file"') &&
    chat.includes("conceptMode?.stageNumber === 4") &&
    chat.includes('role={singleApprovalSelection ? "group" : undefined}') &&
    chat.includes('type="checkbox"') &&
    chat.includes('name="stage-four-final-approved-file"') &&
    chat.includes("checked={isApprovalSelectionSelected}") &&
    chat.includes("if (isApprovalSelectionSelected)") &&
    chat.includes("onClearApprovalSelection?.();") &&
    chat.includes("onSelectApprovalAttachment?.(attachment);") &&
    chat.includes("onClearApprovalSelection={clearConceptApprovalSelection}") &&
    chat.includes("Clear selection") &&
    chat.includes("singleApprovalSelection={canSelectStageFourFinalApprovedFile}") &&
    chat.includes("selectedApprovalAttachmentId={selectedConceptApprovalCandidateId}") &&
    chat.includes("setSelectedConceptApprovalCandidateId(attachment.id)") &&
    chat.includes('"No file selected yet."') &&
    !chat.includes('type="radio"') &&
    chat.includes("openConceptApprovalConfirmation(selectedConceptApprovalCandidate)") &&
    chat.includes("!selectedConceptApprovalCandidate"),
  "Stage 4 review must present submitted files as one mutually exclusive, toggleable selection followed by one approval action.",
);
assert(
  chat.includes("markStageFourFinalApprovedAttachmentAction") &&
    chat.includes("revokeStageFourFinalApprovedAttachmentAction") &&
    chat.includes("const canRevokeConceptApproval = Boolean(") &&
    chat.includes("{canRevokeConceptApproval ? (") &&
    chat.includes(
      "isOpen={revokeConceptApprovalOpen && canRevokeConceptApproval}",
    ) &&
    chat.includes("Revoke Final Approved File?") &&
    chat.includes("Revoke Approval") &&
    chat.includes("Stage 5 will be relocked") &&
    chat.includes("Revocation is unavailable after Stage 5 is completed") &&
    chat.includes("work tied to the revoked final file was reset") &&
    chat.includes("conceptMode.canReview") &&
    chat.includes("conceptMode.isWorkflowCompleted") &&
    chat.includes("!activeStage?.isTasker"),
  "Stage 4 final-file UI must use concept reviewer policy while legacy tasker approval stays blocked.",
);

assert(
  stageFiveActions.includes(
    'revalidatePath(`/projects/${input.projectId}/stages/4`, "layout")',
  ) &&
    stageFiveActions.includes("publishProjectActivityUpdatedAfterResponse") &&
    stageFiveActions.includes('eventType: "timeline_updated"') &&
    chat.includes(
      "fallbackRefreshIntervalMs={isConceptMode ? 10_000 : undefined}",
    ),
  "Stage 5 completion must invalidate and refresh open Stage 4 concept chats before they can offer a stale revoke action.",
);

assert(
    actions.includes("markStageFourFinalApprovedAttachmentAction") &&
    actions.includes("revokeStageFourFinalApprovedAttachmentAction") &&
    actions.includes("completeStageFourConceptsAction") &&
    actions.includes("result.changed") &&
    actions.includes("result.transitioned") &&
    notifications.includes("notifyStageFourFinalFileApproved") &&
    notifications.includes("notifyStageFiveActivated") &&
    notifications.includes('title: "Final concept file approved"') &&
    notifications.includes('title: "Stage 5 available"'),
  "Round 4 approval and explicit completion actions must revalidate and emit scoped state-change-only notifications.",
);

assert(
  !stageFive.includes("handoffStageFourFiles") &&
    !stageFive.includes("getStageFourFinalFileHandoffData") &&
    stageFive.includes("getStageFiveWorkspaceData") &&
    stageFive.includes("saveStageFiveChecklist") &&
    stageFive.includes("requestStageFiveChecklistInformation"),
  "Only the temporary handoff helper may be retired; the Stage 5 selector, checklist, and request architecture must remain.",
);

assert(
  history.includes(
    "Concept taskers cannot use the legacy approve/complete action. Request changes remains available.",
  ) &&
    !/\bcompleteProject(?:Stage|Archive)?\s*\(/.test(concepts) &&
    !concepts.includes("ProjectCompletionWorkflow"),
  "Round 4 must not revive legacy tasker approval or trigger project completion/archive logic.",
);

console.log("Stage 3/4 Round 4 final-file, handoff, workflow, and security checks passed.");

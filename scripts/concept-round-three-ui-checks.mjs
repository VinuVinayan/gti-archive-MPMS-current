import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  workspace,
  chatWorkspace,
  concepts,
  actions,
  history,
  notifications,
  access,
  schema,
  migration,
  referenceTimelineMigration,
] = await Promise.all([
  readFile("src/components/projects/concept-stage-workspace.tsx", "utf8"),
  readFile("src/components/projects/project-chat-workspace.tsx", "utf8"),
  readFile("src/lib/project-concepts.ts", "utf8"),
  readFile(
    "src/app/(dashboard)/projects/[slug]/stages/concept-actions.ts",
    "utf8",
  ),
  readFile("src/lib/project-history.ts", "utf8"),
  readFile("src/lib/notification-center/triggers.ts", "utf8"),
  readFile("src/lib/project-concept-access.ts", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile(
    "prisma/migrations/20260809150000_concept_approval_round_three/migration.sql",
    "utf8",
  ),
  readFile(
    "prisma/migrations/20260817130000_concept_reference_import_timeline/migration.sql",
    "utf8",
  ),
]);

for (const field of [
  "approvedAttachmentId",
  "approvedById",
  "approvedAt",
  "sourceStage3ConceptId",
  "sourceStage3ApprovedAttachmentId",
]) {
  assert(schema.includes(field), `Missing Round 3 schema field: ${field}`);
  assert(migration.includes(`"${field}"`), `Missing Round 3 migration field: ${field}`);
}
assert(
  schema.includes('relation("ProjectConceptApprovedAttachment"') &&
    schema.includes('relation("ProjectConceptPromotion"') &&
    schema.includes('relation("ProjectConceptStartingReference"') &&
    migration.includes("ProjectConceptFolder_approval_audit_check") &&
    migration.includes("ProjectConceptFolder_source_pair_check"),
  "Approval audit and Stage 3→4 lineage must be explicit database relationships.",
);
assert(
  schema.includes("sourceStage3ImportedAt") &&
    schema.includes("sourceStage3ImportedById") &&
    schema.includes('relation("ProjectConceptFolderStageThreeReferenceImporter"') &&
    referenceTimelineMigration.includes('"sourceStage3ImportedAt"') &&
    referenceTimelineMigration.includes('"sourceStage3ImportedById"'),
  "Stage 3 reference imports must persist their timestamp and importing user for chronological chat rendering.",
);

assert(
  concepts.includes("markProjectConceptApprovedAttachment") &&
    concepts.includes("formalConceptAttachmentTypes") &&
    concepts.includes("AttachmentStatus.READY") &&
    concepts.includes("attachment.revision.projectId !== input.projectId") &&
    concepts.includes("attachment.revision.stageId !== input.taskerStageId") &&
    concepts.includes("canReviewProjectConcept(user, accessContext)"),
  "Approved Concept designation must validate a same-project/tasker READY formal revision file through centralized reviewer policy.",
);
assert(
  access.includes("isGlobalProjectAdministrator(user)") &&
    access.includes("context.ownerId === user.id") &&
    access.includes("context.coOwnerIds.includes(user.id)"),
  "Owner, co-owner, and global administrators may manage concept approval.",
);
assert(
  concepts.includes("const changed = folder.approvedAttachmentId !== attachment.id") &&
    concepts.includes("approvedById: user.id") &&
    concepts.includes("approvedAt") &&
    concepts.includes("Approved Concept selection is locked because Stage 3 is completed"),
  "Designation must be idempotent, audited, replaceable before completion, and locked afterward.",
);
assert(
    concepts.includes("approveConceptRevision") &&
    concepts.includes("approvedAttachmentId: attachment.id") &&
    concepts.includes("id: { not: input.approvedAttachmentId }") &&
    concepts.includes("status: ProjectRevisionStatus.APPROVED") &&
    concepts.includes("submissionReviewStatus: SubmissionReviewStatus.APPROVED") &&
    concepts.includes("status: StageStatus.COMPLETED") &&
    concepts.includes("allConceptsApproved: unapprovedConceptCount === 0") &&
    !concepts.includes("const stageTransition = await completeStageThreeConcepts"),
  "Designating the approved file must approve its revision and only the selected file, then complete the concept tasker without bypassing explicit Stage 3 confirmation.",
);
assert(
  concepts.includes("revokeProjectConceptApprovedAttachment") &&
    concepts.includes("getConceptApprovalRevocationEligibility") &&
    concepts.includes("resolveConceptApprovalRevocationEligibility") &&
    concepts.includes('"STAGE6_PRODUCTION_STARTED"') &&
    concepts.includes("canReviewProjectConcept(user, accessContext)") &&
    concepts.includes("reopensWorkflowStage") &&
    concepts.includes("Stage 6 production work has already started") &&
    concepts.includes("projectProductionUnit.findMany") &&
    concepts.includes("cascadedStageFourApproval") &&
    concepts.includes("removedStageFiveHandoff") &&
    concepts.includes("sourceStage3ApprovedAttachmentId: attachment.id") &&
    concepts.includes("status: ProjectWorkflowStageStatus.AVAILABLE") &&
    concepts.includes("status: ProjectWorkflowStageStatus.LOCKED") &&
    concepts.includes("approvedAttachmentId: null") &&
    concepts.includes("approvedById: null") &&
    concepts.includes("approvedAt: null") &&
    concepts.includes("status: ProjectRevisionStatus.PENDING_REVIEW") &&
    concepts.includes("submissionReviewStatus: SubmissionReviewStatus.PENDING_REVIEW") &&
    concepts.includes("status: StageStatus.ONGOING") &&
    concepts.includes("completedAt: null"),
  "Stage 3 revocation must be reviewer-authorized, cascade through dependent Stage 4/5 records, stop at active Stage 6 work, relink reapproved references, and restore Pending Review.",
);

assert(
  concepts.includes("completeStageThreeConcepts") &&
    concepts.includes("canCompleteProjectConceptStage(user, managerContext)") &&
    concepts.includes("Only the project owner or an administrator can complete Stage 3.") &&
    concepts.includes("TransactionIsolationLevel.Serializable") &&
    concepts.includes("unapprovedConcepts.length > 0") &&
    concepts.includes("Every Stage 3 task must have an approved file or be completed without a file") &&
    concepts.includes("skipped: project.conceptFolders.length === 0") &&
    concepts.includes("ProjectWorkflowStageStatus.COMPLETED") &&
    concepts.includes("ProjectWorkflowStageStatus.AVAILABLE") &&
    !concepts.includes("ProjectStageFileHandoff"),
  "Owner/administrator Stage 3 completion must permit an empty optional stage, validate created concepts, and unlock Stage 4 without automatic promotion.",
);
assert(
  concepts.includes("importStageThreeConceptReference") &&
    concepts.includes("Choose a Stage 3 concept that has an Approved Concept file") &&
    concepts.includes("sourceStage3ConceptId: sourceConcept.id") &&
    concepts.includes("sourceStage3ApprovedAttachmentId: sourceConcept.approvedAttachmentId") &&
    concepts.includes("sourceStage3ImportedAt: new Date()") &&
    concepts.includes("sourceStage3ImportedById: user.id") &&
    concepts.includes("availableStageThreeReferences"),
  "Approved Stage 3 references must be explicitly imported into a Stage 4 chat through a server-authorized action.",
);

for (const label of [
  "Approved Concept",
  "Approved Concept File",
  "Not Approved",
  "Changes Requested",
  "Skip Stage 3",
  "Continue to Stage 4",
  "Starting Reference",
  "Stage 3 Completed",
]) {
  assert(workspace.includes(label), `Missing Round 3 workspace UI: ${label}`);
}
assert(
  workspace.includes("pendingConcepts.map") &&
    workspace.includes("completeStageThreeConceptsAction") &&
    workspace.includes("stageNumber === 3") &&
    workspace.includes("stageNumber === 3 && folder.approvedAttachment") &&
    workspace.includes("folder.approvedAttachment.previewPath") &&
    workspace.includes("folder.approvedAttachment.downloadPath") &&
    workspace.includes("isEmptyStageThree") &&
    workspace.includes("canCompleteStage && !managementLocked && stageCompletionReady") &&
    workspace.includes("folder.startingReference.previewPath") &&
    workspace.includes("folder.startingReference.downloadPath"),
  "Completion must stay hidden while concepts are unapproved, and Stage 4 references must preview/download.",
);

assert(
    chatWorkspace.includes("Mark as Approved Concept") &&
    chatWorkspace.includes("Replace the currently approved concept file?") &&
    chatWorkspace.includes("markProjectConceptApprovedAttachmentAction") &&
    chatWorkspace.includes("approvedConceptAttachmentId") &&
    chatWorkspace.includes("getEffectiveRevisionStatus") &&
    chatWorkspace.includes("approvedConceptRevisionNeedingRepair") &&
    chatWorkspace.includes("legacyConceptApprovalRepairRef") &&
    chatWorkspace.includes('status: "APPROVED"') &&
    chatWorkspace.includes("revokeProjectConceptApprovedAttachmentAction") &&
    chatWorkspace.includes("canRevokeConceptApproval") &&
    chatWorkspace.includes("Revoke Approved Concept?") &&
    chatWorkspace.includes("Revoke Approval") &&
    chatWorkspace.includes("Rework is allowed through completed Stage 5") &&
    chatWorkspace.includes("conceptMode.isWorkflowCompleted") &&
    chatWorkspace.includes("Read-only approved Stage 3 reference") &&
    chatWorkspace.includes('kind: "reference"') &&
    chatWorkspace.includes("startingReferenceTimelineEntry") &&
    chatWorkspace.includes("getTimelineEntryCreatedAtMs") &&
    chatWorkspace.includes("ConceptReferenceTimelineCard") &&
    !chatWorkspace.includes("startingReference={conceptMode.startingReference}") &&
    chatWorkspace.includes("!activeStage?.isTasker"),
  "Concept chat must immediately show designated submissions as approved while the legacy tasker approval remains hidden.",
);

assert(
  history.includes("sourceStage3ApprovedAttachmentId: attachment.id") &&
    history.includes("canViewProjectConcept(user, startingReferenceContext)") &&
    history.includes("approvedConceptFolder") &&
    history.includes("conceptStartingReference") &&
    history.includes("Concept files are locked because this workflow stage is completed") &&
    !history.includes("This workflow stage is completed. Chat is read-only"),
  "Starting-reference access and explicit management/deletion locks must be enforced without inventing a completed-stage chat lock.",
);

assert(
  actions.includes("importStageThreeConceptReferenceAction") &&
    actions.includes("publishProjectActivityUpdatedAfterResponse") &&
    actions.includes('eventType: "timeline_updated"') &&
    actions.includes("changedEntityId: input.folderId"),
  "A newly imported Stage 3 reference must refresh every open Stage 4 participant view in real time.",
);

assert(
    actions.includes("markProjectConceptApprovedAttachmentAction") &&
    actions.includes("revokeProjectConceptApprovedAttachmentAction") &&
    actions.includes("completeStageThreeConceptsAction") &&
    actions.includes("result.changed") &&
    !actions.includes('"stageTransition" in result') &&
    notifications.includes("notifyConceptFileApproved") &&
    notifications.includes("notifyStageFourConceptsActivated") &&
    notifications.includes('title: "Concept file approved"') &&
    notifications.includes('title: "Stage 4 activated"'),
  "Round 3 approval and explicit completion actions must revalidate and send scoped, state-change-only notifications.",
);

console.log("Stage 3/4 optional flow and explicit reference-import UI/security checks passed.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  workspace,
  service,
  page,
  schema,
  approvalWorkspace,
  externalPage,
  authenticatedPage,
  actions,
  authenticatedActions,
  externalDecisionRoute,
  approvalEmail,
  migration,
  removalMigration,
  stageSevenService,
  stageSevenWorkspace,
] = await Promise.all([
  readFile("src/components/projects/stage-six-workspace.tsx", "utf8"),
  readFile("src/lib/stage-six.ts", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/6/page.tsx", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile("src/components/projects/production-approval-workspace.tsx", "utf8"),
  readFile("src/app/external/production-approval/[token]/page.tsx", "utf8"),
  readFile("src/app/production-approvals/[stepId]/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/6/actions.ts", "utf8"),
  readFile("src/app/production-approvals/[stepId]/actions.ts", "utf8"),
  readFile("src/app/api/external/production-approval/[token]/decision/route.ts", "utf8"),
  readFile("src/lib/email/production-workflow.ts", "utf8"),
  readFile("prisma/migrations/20260812090000_stage_six_optional_handover_contacts/migration.sql", "utf8"),
  readFile("prisma/migrations/20260816230000_stage_six_approval_step_removal_audit/migration.sql", "utf8"),
  readFile("src/lib/stage-seven.ts", "utf8"),
  readFile("src/components/projects/stage-seven-workspace.tsx", "utf8"),
]);
const [
  archivesService,
  savedArchiveMigration,
  optionalLegacyStageMigration,
  assetPreview,
  archiveMetadataForm,
  handoverWorkspace,
  authenticatedHandoverPage,
  authenticatedHandoverPreviewRoute,
  authenticatedHandoverDownloadRoute,
  notificationService,
  sharedFieldValue,
  confirmationDialog,
] = await Promise.all([
    readFile("src/lib/archives.ts", "utf8"),
    readFile(
      "prisma/migrations/20260812190000_stage_six_saved_archive_snapshot/migration.sql",
      "utf8",
    ),
    readFile(
      "prisma/migrations/20260812203000_saved_archive_optional_legacy_stage/migration.sql",
      "utf8",
    ),
    readFile("src/components/projects/asset-preview-button.tsx", "utf8"),
    readFile("src/components/archives/archive-artwork-metadata-form.tsx", "utf8"),
    readFile("src/components/projects/production-handover-workspace.tsx", "utf8"),
    readFile("src/app/production-handovers/[handoverId]/page.tsx", "utf8"),
    readFile(
      "src/app/api/production-handovers/[handoverId]/files/[attachmentId]/preview/route.ts",
      "utf8",
    ),
    readFile(
      "src/app/api/production-handovers/[handoverId]/files/[attachmentId]/download/route.ts",
      "utf8",
    ),
    readFile("src/lib/notification-center/service.ts", "utf8"),
    readFile("src/components/projects/production-shared-field-value.tsx", "utf8"),
    readFile("src/components/ui/confirmation-dialog.tsx", "utf8"),
  ]);

for (const content of [
  "Stage 6 - Production &amp; Handover",
  "Production Units",
  "Pending Approval",
  "Production Files",
  "Production Details",
  "Approval Chain",
  "Marketing Director",
  "Add Approver",
  "Information to share",
  "Select All",
  "Project Participant",
  "External Email",
  "Internal",
  "External",
  "Company name",
  "Contact name",
  "e.g. +971 50 123 4567",
  "Optional",
  "Complete Stage 6",
]) {
  assert(workspace.includes(content), `Missing Stage 6 UI content: ${content}`);
}

assert(!workspace.includes("Department / Role"), "The generic Department approval column must be removed.");
assert(!workspace.includes("INITIAL_APPROVAL_STEPS"), "Stage 6 must not use mock approval steps.");
assert(workspace.includes("UnitSwitcher") && workspace.includes("overflow-x-auto"), "Stage 6 must use the file-card switcher instead of a primary dropdown.");
assert(workspace.includes("pageData.summary") && workspace.includes("unit.approvalSteps"), "Stage 6 summaries must use real server data.");
assert(
  workspace.includes("const [productionFiles, setProductionFiles] = useState(unit.productionFiles)") &&
    workspace.includes("{ ...uploaded, isSource: false }") &&
    workspace.includes("[unit.sourceFile, ...productionFiles]") &&
    workspace.includes("current.filter((item) => item.id !== file.id)") &&
    workspace.includes("disabled={removingFileId === file.id}") &&
    workspace.includes("canManage && mutable && !file.isSource"),
  "Files added in Stage 6 must immediately expose a working Remove action while the Stage 5 source reference stays protected.",
);
assert(
  workspace.includes('className="flex min-w-0 flex-col overflow-hidden rounded-[14px]') &&
    workspace.includes("mt-2 min-h-5 whitespace-pre-wrap") &&
    workspace.includes("[overflow-wrap:anywhere]") &&
    workspace.includes('title={file.name}') &&
    workspace.includes("block w-fit min-w-0 max-w-full overflow-hidden") &&
    workspace.includes('className="block min-w-0 max-w-full truncate">{file.name}</span>'),
  "Production Details must align values consistently and contain long attachment names within their field cards.",
);
assert(workspace.includes("step.reviewHref") && workspace.includes("Review Approval"), "An assigned approver must have a direct review action on Stage 6.");
assert(workspace.includes("max-h-[calc(100dvh-1.5rem)]") && workspace.includes("overflow-y-auto overscroll-contain"), "The approval request dialog must remain bounded by the viewport and scroll its form content.");
assert(workspace.includes("shrink-0 flex-col-reverse") && workspace.includes("border-t border-[#e7ece8] bg-white"), "The approval request actions must remain in a persistent modal footer.");
assert(
  workspace.includes('aria-labelledby="production-handover-dialog-title"') &&
    (workspace.match(/max-h-\[calc\(100dvh-1\.5rem\)\]/g)?.length ?? 0) >= 2 &&
    (workspace.match(/overflow-y-auto overscroll-contain/g)?.length ?? 0) >= 2 &&
    workspace.includes("items-start justify-center overflow-y-auto") &&
    workspace.includes('className="shrink-0 flex-col items-stretch border-t border-[#e7ece8] bg-white px-6 py-4 sm:px-7"') &&
    workspace.includes('className="w-full sm:w-auto"'),
  "The Production Handover dialog must remain viewport-bounded with a scrollable form and persistent footer.",
);
assert(
  workspace.includes('ariaLabel="Optional approval message"') &&
    workspace.includes('minHeightClassName="min-h-[96px]"') &&
    workspace.includes("Add context or instructions for the approver (optional)."),
  "The optional approval message must use the shared rich-text editor with a controlled minimum height.",
);
assert(
  workspace.match(/border-\[#c8d5cb\]/g)?.length >= 7 &&
    workspace.includes("Enter recipient name") &&
    workspace.includes("Enter company name") &&
    workspace.includes("Enter contact name"),
  "External approval and handover recipient fields must have labels and visible resting/focus borders.",
);
assert(page.includes("getStageSixWorkspaceData") && page.includes("ProjectWorkflowStageKey.PRODUCTION_AND_HANDOVER"), "The route must load persisted Stage 6 data through workflow access.");

for (const model of [
  "ProjectProductionUnit",
  "ProjectProductionUnitFile",
  "ProductionApprovalStep",
  "ProjectProductionHandover",
]) {
  assert(schema.includes(`model ${model}`), `Missing Stage 6 model: ${model}`);
}
assert(schema.includes("sourceHandoffId") && schema.includes("sourceChecklistId") && schema.includes("sourceAttachmentId"), "Production Unit lineage must remain explicit.");
assert(schema.includes("isMarketingDirectorRequired") && schema.includes("@@unique([productionUnitId, sequence])"), "The historical Marketing Director flag and per-unit sequence must be persisted.");
assert(schema.includes("sharedFieldKeys") && schema.includes("selectedFileIds") && schema.includes("sharedSnapshot"), "Selective sharing and stable snapshots must be persisted.");
assert(
  schema.includes("removedAt") &&
    schema.includes("removedByUserId") &&
    schema.includes("statusAtRemoval") &&
    removalMigration.includes('ADD COLUMN "removedAt"') &&
    removalMigration.includes('ADD COLUMN "statusAtRemoval"'),
  "Approval removal must be represented by additive audit fields and a forward migration.",
);
assert(schema.includes("externalTokenHash") && !schema.includes("externalToken        String"), "Only external token hashes may be stored.");
assert(
  schema.includes("recipientCompany") &&
    schema.includes("recipientPhone") &&
    migration.includes('ADD COLUMN "recipientCompany"') &&
    migration.includes('ADD COLUMN "recipientPhone"'),
  "External handover company and phone details must be persisted through a migration.",
);

for (const content of ["Approve", "Reject", "Shared Information", "Optional comment", "requestedBy"]) {
  assert(approvalWorkspace.includes(content), `Missing approval experience content: ${content}`);
}
assert(
  approvalEmail.includes('["Status", "Action required"]') &&
    approvalWorkspace.includes("decisionToConfirm") &&
    approvalWorkspace.includes("ConfirmationDialog") &&
    approvalWorkspace.includes("Confirm Approval") &&
    approvalWorkspace.includes("Confirm Rejection") &&
    approvalWorkspace.includes("confirmed: true") &&
    authenticatedActions.includes("confirmed: input.confirmed") &&
    externalDecisionRoute.includes("payload.confirmed !== true") &&
    service.includes("input.confirmed !== true") &&
    service.includes("step.status === ProductionApprovalStepStatus.APPROVED && step.decidedAt") &&
    service.includes("step.status === ProductionApprovalStepStatus.REJECTED && step.decidedAt"),
  "Approval emails and pages must remain pending until an approver explicitly confirms a decision, backed by an auditable decision timestamp.",
);
assert(
  authenticatedPage.includes('href={`/projects/${data.project.id}/stages/6`}') &&
    authenticatedPage.includes("Back to Stage 6") &&
    authenticatedPage.includes("ArrowLeft") &&
    !externalPage.includes("Back to Stage 6"),
  "Authenticated production approvals must provide a prominent page-level return to Stage 6 without exposing project navigation on external links.",
);
assert(externalPage.includes('dynamic = "force-dynamic"') && externalPage.includes("noStore()"), "The external approval route must be dynamic and no-store.");
assert(authenticatedPage.includes("getAuthenticatedProductionApprovalData"), "The direct Stage 6 review action must land on the authenticated approval route.");
assert(service.includes("ProductionApprovalStepStatus.ACTIVE") && service.includes("ProductionApprovalStepStatus.WAITING"), "Sequential activation must be server-enforced.");
assert(service.includes("recipientUserId === user.id") && service.includes("reviewHref:"), "Stage 6 must derive the direct review action from the authenticated assigned approver.");
assert(
  service.includes("to: step.recipientEmail") &&
    service.includes("to: recipient.recipientEmail") &&
    !service.includes("STAGE_SIX_EMAIL_DELIVERY_ADDRESS") &&
    !workspace.includes("STAGE_SIX_FIRST_APPROVER") &&
    workspace.includes("Send Approval Request") &&
    actions.includes("sendProductionApprovalRequestAction"),
  "Stage 6 must send only through an explicit request to the selected recipient.",
);
assert(
  workspace.includes("!step.isConfigured") &&
    service.includes("isConfigured: Boolean(clientRequestId)"),
  "The first-step Assign action must be driven by persisted configuration state; a configured environment recipient does not send automatically.",
);
assert(
  actions.includes("reorderProductionApproverAction") &&
    service.includes("reorderProductionApprover") &&
    workspace.includes("Move approval step") &&
    workspace.includes("Remove approval step"),
  "Waiting approval steps must expose manager-only reorder and delete controls backed by server validation.",
);
assert(
  !workspace.includes("window.confirm") &&
    workspace.includes('title="Remove approver?"') &&
    workspace.includes('confirmLabel="Remove"') &&
    workspace.includes('tone="destructive"'),
  "Stage 6 approver deletion must use the custom destructive confirmation dialog.",
);
assert(
  service.includes("statusAtRemoval: step.status") &&
    service.includes("removedByUserId: user.id") &&
    service.includes("externalTokenRevokedAt: removedAt") &&
    service.includes("removedAt: null") &&
    workspace.includes("Removed approval history"),
  "Removal must preserve the prior status and decision audit while excluding the step from live paths.",
);
assert(
  workspace.includes("unit.status !== ProjectProductionUnitStatus.HANDED_OVER") &&
    service.includes("ProjectProductionUnitStatus.REJECTED") &&
    service.includes("ProjectProductionUnitStatus.HANDOVER_READY") &&
    service.includes("This approval chain is locked after handover or Stage 6 completion."),
  "Managers must retain Add/Remove configuration through pending, rejected, and approved states until the permanent lock.",
);
assert(
  authenticatedActions.includes("publishProjectActivityUpdatedAfterResponse") &&
    externalDecisionRoute.includes("publishProjectActivityUpdatedAfterResponse") &&
    workspace.includes("window.setInterval(refreshVisiblePage, 15_000)"),
  "Authenticated and external decisions must refresh open Stage 6 pages in realtime with a polling fallback.",
);
assert(
  service.includes('? ("NOT_REQUIRED" as const)') &&
    service.includes('approvalState === "NOT_REQUIRED" || approvalState === "APPROVED"') &&
    service.includes("unit.approvalSteps.length > 0") &&
    service.includes("approvedAt: null") &&
    workspace.includes("Approval not required") &&
    workspace.includes("0 active approvers") &&
    workspace.includes("unit.handoverBlocker") &&
    workspace.includes("pageData.summary.ready") &&
    workspace.includes("Approval is optional when no active approvers exist") &&
    service.includes("ProjectWorkflowStageKey.IMPLEMENTATION_AND_SUPERVISION"),
  "Stage 6 must derive Approval Not Required for zero live approvers, preserve other handover blockers, and unlock only Stage 7 when every unit is ready.",
);
assert(
  service.includes("Internal handover requires an existing project participant.") &&
    service.includes("External handover requires external recipient details.") &&
    service.includes("Enter the external recipient company name.") &&
    service.includes("Enter a valid external phone number including country code."),
  "The backend must enforce distinct internal and external handover recipient rules.",
);
assert(
  service.includes("function getHandoverRecipients(project: StageProject)") &&
    service.includes("participant.id !== project.ownerId") &&
    service.includes("handoverRecipients: getHandoverRecipients(project)") &&
    service.includes("input.recipientUserId?.trim() === project.ownerId") &&
    service.includes("The Project Owner cannot receive an internal production handover.") &&
    workspace.includes('recipients: StageSixWorkspaceData["handoverRecipients"]') &&
    workspace.includes("recipients.some((recipient) => recipient.id === recipientUserId)") &&
    workspace.includes("recipients={pageData.handoverRecipients}"),
  "Internal production handover must omit the Project Owner in the UI and reject forged owner recipients server-side.",
);
assert(
  service.includes("getAuthenticatedProductionHandoverData") &&
    service.includes("getAuthenticatedProductionHandoverFileUrl") &&
    service.includes("canAccessAuthenticatedProductionHandover") &&
    service.includes('url: `/production-handovers/${prepared.handover.id}`') &&
    authenticatedHandoverPage.includes("requireUser") &&
    authenticatedHandoverPage.includes("getAuthenticatedProductionHandoverData") &&
    authenticatedHandoverPage.includes('kind: "authenticated"') &&
    authenticatedHandoverPreviewRoute.includes("getCurrentUser") &&
    authenticatedHandoverPreviewRoute.includes("getAuthenticatedProductionHandoverFileUrl") &&
    authenticatedHandoverDownloadRoute.includes("getCurrentUser") &&
    authenticatedHandoverDownloadRoute.includes("getAuthenticatedProductionHandoverFileUrl") &&
    handoverWorkspace.includes("/api/production-handovers/") &&
    notificationService.includes("handoverRouteByProductionUnitId"),
  "Internal handover notifications must open a recipient-scoped package whose selected files have authenticated preview and download access.",
);
assert(
  handoverWorkspace.includes("ProductionSharedFieldValue") &&
    approvalWorkspace.includes("ProductionSharedFieldValue") &&
    handoverWorkspace.includes("<RichTextContent value={data.note}") &&
    approvalWorkspace.includes("<RichTextContent value={data.message}") &&
    sharedFieldValue.includes("<RichTextContent value={text}") &&
    sharedFieldValue.includes("isRichTextEmpty(record.text)") &&
    !handoverWorkspace.includes("valueText(field.value)") &&
    !approvalWorkspace.includes("valueText(field.value)"),
  "Production approval and handover views must safely render stored rich text instead of exposing HTML tags.",
);
assert(
  stageSevenService.includes("ProjectProductionUnitStatus.HANDOVER_READY") &&
    stageSevenService.includes("ProjectProductionUnitStatus.HANDED_OVER") &&
    stageSevenWorkspace.includes("the optional handover is not required"),
  "Stage 7 must accept approved units even when the optional Stage 6 handover is skipped.",
);
assert(service.includes("isGlobalProjectAdministrator(user)"), "Stage 6 management must grant business administrators global authority.");
assert(actions.includes("completeStageSixAction") && actions.includes("handoverProductionUnitAction"), "Stage 6 server actions must expose real workflow mutations.");
assert(
  workspace.includes("const [completing, setCompleting] = useState(false)") &&
    workspace.includes("const [completionSucceeded, setCompletionSucceeded] = useState(false)") &&
    workspace.includes("pageData.stageCompleted || completionSucceeded") &&
    workspace.includes("setCompletionSucceeded(true)") &&
    workspace.includes("Stage 6 completed. Stage 7 is now available.") &&
    workspace.includes('aria-live="polite"') &&
    workspace.includes('pendingLabel="Completing Stage 6..."') &&
    confirmationDialog.includes("<Loader2") &&
    confirmationDialog.includes("animate-spin") &&
    confirmationDialog.includes("aria-busy={pending}") &&
    actions.includes("publishStageSixChange({") &&
    actions.includes("changedEntityId: input.projectId"),
  "Stage 6 completion must expose immediate progress, optimistically show the completed state, and reconcile other open project views.",
);
assert(
  workspace.includes("StageSixArchiveDialog") &&
    workspace.includes("Save to Archives") &&
    workspace.includes("Update Saved Archive") &&
    workspace.includes("Open Saved Archive") &&
    workspace.includes("Stage 7 remains active") &&
    workspace.includes("max-h-[calc(100dvh-2rem)]") &&
    workspace.includes("min-h-0 flex-1 overflow-y-auto overscroll-contain") &&
    !workspace.includes("router.push"),
  "Completed Stage 6 must offer a viewport-bounded archive wizard without redirecting away.",
);
assert(
  workspace.includes('<SelectContent className="z-[230]">') &&
    assetPreview.includes("fixed inset-0 z-[260]") &&
    archiveMetadataForm.includes('<SelectContent className="z-[230]">') &&
    archiveMetadataForm.includes("popoverZIndex={230}") &&
    workspace.includes(
      "bg-[linear-gradient(120deg,#f8fcf8_0%,#eef7f0_58%,#e3f1e7_100%)]",
    ),
  "The Stage 6 archive menus, metadata date picker, and file preview must render above the visually structured archive dialog.",
);
assert(
  actions.includes("prepareStageSixArchiveAction") &&
    actions.includes("saveStageSixArchiveAction") &&
    actions.includes("archive.previousArchiveCategorySlug") &&
    archivesService.includes("getStageSixArchivePreparation") &&
    archivesService.includes("saveStageSixArchiveSnapshot") &&
    archivesService.includes("ArchiveRecordStatus.SAVED") &&
    archivesService.includes("projectRemainsActive: true") &&
    archivesService.includes("uniqueSubmittedSourceIds.size") &&
    archivesService.includes("expectedSourceIds.has(sourceId)"),
  "Stage 6 archive actions must save an exact, non-terminal server-validated source snapshot and invalidate moved categories.",
);
assert(
  archivesService.includes("latestProject.archive.status !== ArchiveRecordStatus.SAVED") &&
    archivesService.includes("status: ArchiveRecordStatus.ARCHIVED") &&
    archivesService.includes("await tx.projectArchive.update({") &&
    archivesService.includes("reserveExistingArchiveFileNames") &&
    archivesService.includes("tx.archiveArtworkMetadata.upsert"),
  "Final completion must safely upgrade the saved archive in place.",
);
assert(
  schema.includes("SAVED") &&
    schema.includes("ARCHIVE_SNAPSHOT_SAVED") &&
    savedArchiveMigration.includes("'SAVED'") &&
    savedArchiveMigration.includes("'ARCHIVE_SNAPSHOT_SAVED'") &&
    optionalLegacyStageMigration.includes(
      'ALTER COLUMN "finalStageId" DROP NOT NULL',
    ),
  "The schema must distinguish a saved snapshot and allow its legacy stage to be absent.",
);

console.log("Stage 6 production and handover UI/security checks passed.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fileThumbnail = await readFile("src/components/projects/file-thumbnail.tsx", "utf8");

const [workspace, fieldDefinitions, filePicker, requestWorkspace, requestPage, requestActions, summaryAlias, summary, page, workflowAccess, overview, schema, chatWorkspace, service, actions, uploadClient, requestUploadRoute, requestCompleteRoute, requestSourcePreviewRoute, requestSourceDownloadRoute, stageFourWorkspace, conceptActions, emailTemplate, migration, integrityMigration, responseMigration, attachmentScopeMigration, auth, signInPage, signInActions, confirmationDialog] =
  await Promise.all([
    readFile("src/components/projects/stage-five-workspace.tsx", "utf8"),
    readFile("src/lib/stage-five-fields.ts", "utf8"),
    readFile("src/components/projects/checklist-file-picker.tsx", "utf8"),
    readFile("src/components/projects/stage-five-request-workspace.tsx", "utf8"),
    readFile("src/app/requests/checklist/[requestId]/page.tsx", "utf8"),
    readFile("src/app/requests/checklist/[requestId]/actions.ts", "utf8"),
    readFile("src/components/projects/project-stage-summary.tsx", "utf8"),
    readFile("src/components/projects/project-summary-strip.tsx", "utf8"),
    readFile("src/app/(dashboard)/projects/[slug]/stages/5/page.tsx", "utf8"),
    readFile("src/lib/workflow-stage-access.ts", "utf8"),
    readFile("src/components/projects/project-overview-workspace.tsx", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
    readFile("src/components/projects/project-chat-workspace.tsx", "utf8"),
    readFile("src/lib/stage-five.ts", "utf8"),
    readFile("src/app/(dashboard)/projects/[slug]/stages/5/actions.ts", "utf8"),
    readFile("src/lib/stage-five-upload-client.ts", "utf8"),
    readFile("src/app/api/requests/checklist/[requestId]/upload-url/route.ts", "utf8"),
    readFile("src/app/api/requests/checklist/[requestId]/complete/route.ts", "utf8"),
    readFile("src/app/api/requests/checklist/[requestId]/source/preview/route.ts", "utf8"),
    readFile("src/app/api/requests/checklist/[requestId]/source/download/route.ts", "utf8"),
    readFile("src/components/projects/concept-stage-workspace.tsx", "utf8"),
    readFile("src/app/(dashboard)/projects/[slug]/stages/concept-actions.ts", "utf8"),
    readFile("src/lib/email/checklist-information-request.ts", "utf8"),
    readFile("prisma/migrations/20260808160000_stage_five_file_checklists/migration.sql", "utf8"),
    readFile("prisma/migrations/20260808170000_stage_five_attachment_delete_integrity/migration.sql", "utf8"),
    readFile("prisma/migrations/20260808180000_stage_five_collaborator_responses/migration.sql", "utf8"),
    readFile("prisma/migrations/20260808190000_stage_five_request_attachment_scope/migration.sql", "utf8"),
    readFile("src/lib/auth.ts", "utf8"),
    readFile("src/app/sign-in/page.tsx", "utf8"),
    readFile("src/app/sign-in/actions.ts", "utf8"),
    readFile("src/components/ui/confirmation-dialog.tsx", "utf8"),
  ]);

const [externalPage, externalWorkspace, externalService, externalToken, secureToken, externalUploadClient, externalUploadRoute, externalSubmitRoute, externalDeclineRoute, externalMigration, rateLimit, nextConfig] =
  await Promise.all([
    readFile("src/app/external/checklist-request/[token]/page.tsx", "utf8"),
    readFile("src/components/projects/stage-five-external-request-workspace.tsx", "utf8"),
    readFile("src/lib/stage-five-external.ts", "utf8"),
    readFile("src/lib/checklist-external-token.ts", "utf8"),
    readFile("src/lib/secure-external-token.ts", "utf8"),
    readFile("src/lib/stage-five-external-upload-client.ts", "utf8"),
    readFile("src/app/api/external/checklist-request/[token]/upload-url/route.ts", "utf8"),
    readFile("src/app/api/external/checklist-request/[token]/submit/route.ts", "utf8"),
    readFile("src/app/api/external/checklist-request/[token]/decline/route.ts", "utf8"),
    readFile("prisma/migrations/20260808200000_stage_five_external_checklist_requests/migration.sql", "utf8"),
    readFile("src/lib/external-request-rate-limit.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
  ]);

const [projectHistory, stageSix, lineage, directMigration, stageThreeFallbackMigration, projectConcepts, projectAssetCompleteRoute] =
  await Promise.all([
    readFile("src/lib/project-history.ts", "utf8"),
    readFile("src/lib/stage-six.ts", "utf8"),
    readFile("src/lib/stage-five-lineage.ts", "utf8"),
    readFile(
      "prisma/migrations/20260824190000_stage_four_skip_and_direct_stage_five_source/migration.sql",
      "utf8",
    ),
    readFile(
      "prisma/migrations/20260920144500_stage_three_stage_five_fallback/migration.sql",
      "utf8",
    ),
    readFile("src/lib/project-concepts.ts", "utf8"),
    readFile("src/app/api/project-assets/complete/route.ts", "utf8"),
  ]);

const checklistItems = [
  "Output Name",
  "Technical Drawing",
  "Health Warning",
  "Tar (mg)",
  "Nicotine (mg)",
  "Compulsory Text",
  "Marketing Copy",
  "Related Graphics",
  "Printing Technology",
  "Finishes",
  "Barcode",
  "Track & Trace",
  "3D's",
  "Tax Stamp",
  "QR Code",
  "Invoice",
];

let lastPosition = -1;
for (const item of checklistItems) {
  const position = fieldDefinitions.indexOf(`title: "${item}"`);
  assert(position > lastPosition, `Missing or out-of-order Stage 5 checklist item: ${item}`);
  lastPosition = position;
}

for (const content of [
  "Stage 5 - File Checklist",
  "Complete or request the required project information and files.",
  "Pending",
  "Filled",
  "Requested",
  "Request",
  "Project participant",
  "Manual email",
  "All Stages",
  "Next Stage",
]) {
  assert(workspace.includes(content), `Missing Stage 5 UI content: ${content}`);
}
for (const label of ["Project Name", "Project Owner", "Project Co-Owners", "Project Executors"]) {
  assert(summary.includes(label), `Missing shared project summary label: ${label}`);
}
assert(
  workspace.includes("ProjectStageSummary") &&
    workspace.includes('from "@/components/projects/project-stage-summary"') &&
    summaryAlias.includes("ProjectFlowSummaryStrip"),
  "Stage 5 must use the shared real-data project summary.",
);

assert(
  workspace.includes("CHECKLIST_ITEMS.map") &&
    workspace.includes("onRequest={() => setRequestField(item)}"),
  "Every checklist definition must render the shared Request action.",
);
assert(
  workspace.includes('const [mode, setMode] = useState<"edit" | "view">(') &&
    workspace.includes('updateMode("edit")') &&
    workspace.includes('updateMode("view")') &&
    workspace.includes('aria-label="File Checklist presentation mode"'),
  "Stage 5 must default to Edit and provide the Stage 1-style Edit/View control.",
);
assert(
  workspace.includes("StageFiveReadOnlyView") &&
    workspace.includes('aria-label="View File Checklist"') &&
    workspace.includes("Not provided") &&
    workspace.includes("Read-only checklist summary."),
  "Stage 5 View mode must render a dedicated readable checklist with explicit empty values.",
);
assert(
  workspace.includes("textValues={activeDraft.textValues}") &&
    workspace.includes("files={activeDraft.files}") &&
    workspace.includes("multiValues={activeDraft.multiValues}") &&
    workspace.includes("healthWarningIncluded={activeDraft.healthWarningIncluded}"),
  "Stage 5 View mode must read the same per-file draft state used by Edit mode.",
);
assert(
  workspace.includes("selectedFiles.map") &&
    workspace.includes("formatFileSize(file.size)") &&
    workspace.includes("values.map"),
  "Stage 5 View mode must show selected file metadata and repeatable values.",
);
assert(
  fieldDefinitions.includes("ProjectFileChecklistField.TAR") &&
    fieldDefinitions.includes("ProjectFileChecklistField.NICOTINE") &&
    !fieldDefinitions.includes('title: "Tar / Nicotine"'),
  "Stage 5 must collect Tar and Nicotine as separate active fields.",
);
assert(
  fieldDefinitions.includes('title: "Tar (mg)"') &&
    fieldDefinitions.includes('placeholder: "Enter tar value (mg)"') &&
    fieldDefinitions.includes('title: "Nicotine (mg)"') &&
    fieldDefinitions.includes('placeholder: "Enter nicotine value (mg)"') &&
    !fieldDefinitions.includes("Required —"),
  "Tar and Nicotine must communicate their mg unit without implying that either field is required.",
);
assert(
  fieldDefinitions.includes('title: "Compulsory Text"') &&
    fieldDefinitions.includes('title: "Marketing Copy"') &&
    fieldDefinitions.match(/control: "multi-value"/g)?.length >= 3,
  "Compulsory Text and Marketing Copy must use repeatable Add controls.",
);
assert(
  workspace.includes("mimeType={activeFile.sourceAttachment.mimeType}") &&
    fileThumbnail.includes("object-contain") &&
    workspace.includes("truncate") &&
    workspace.includes("<FileThumbnail") && workspace.includes("previewPath={`/api/project-assets/${activeFile.sourceAttachment.id}/preview`}"),
  "The selected Stage 5 final file must show a compact image preview beside a truncated name.",
);
assert(
  fieldDefinitions.includes('key: ProjectFileChecklistField.TECHNICAL_DRAWING') &&
    fieldDefinitions.includes('key: ProjectFileChecklistField.QR_CODE') &&
    workspace.includes('fieldLabel={`${item.title} reference`}') &&
    requestWorkspace.includes("multiple"),
  "Image/file-bearing checklist controls must support multiple files across manager and request flows.",
);
assert(
  workspace.includes("<FileChecklistSwitcher") &&
    workspace.includes('aria-label="Final file checklists"') &&
    workspace.includes("aria-pressed={selected}") &&
    workspace.includes("onSelect={updateSelectedFile}") &&
    !workspace.includes("onValueChange={updateSelectedFile}"),
  "Stage 5 file switching must expose selectable file tiles like Stage 6.",
);
const readOnlyView = workspace.slice(
  workspace.indexOf("function StageFiveReadOnlyView"),
  workspace.indexOf("function RequestInformationDialog"),
);
assert(
  !readOnlyView.includes("<Input") &&
    !readOnlyView.includes("<Textarea") &&
    !readOnlyView.includes("<button") &&
    !readOnlyView.includes("ChecklistFilePicker") &&
    !readOnlyView.includes("Request"),
  "Stage 5 View mode must not render editing, upload, removal, Add, or Request controls.",
);
const checklistFilePicker = filePicker.slice(
  filePicker.indexOf("function ChecklistFilePicker"),
  filePicker.length,
);
assert(
  checklistFilePicker.includes("useRef<HTMLInputElement>(null)") &&
    checklistFilePicker.includes('type="file"') &&
    checklistFilePicker.includes("multiple={multiple}") &&
    checklistFilePicker.includes("hidden") &&
    checklistFilePicker.includes("fileInputRef.current?.click()") &&
    checklistFilePicker.includes("<Button") &&
    !checklistFilePicker.includes("htmlFor") &&
    !checklistFilePicker.includes("sr-only"),
  "Stage 5 must trigger single and multiple hidden file inputs through the shared GTI Button/ref picker.",
);
assert(
  workspace.includes("STAGE_FIVE_FIELD_DEFINITIONS.map") &&
    requestWorkspace.includes("data.field.control") &&
    requestWorkspace.includes("data.field.suggestions"),
  "The owner checklist and collaborator response page must share one Stage 5 field definition source.",
);
assert(
  workspace.includes("uploadStageFiveChecklistAttachment") &&
    uploadClient.includes('assetType: "FILE_CHECKLIST_ATTACHMENT"') &&
    uploadClient.includes("/api/project-assets/upload-url") &&
    uploadClient.includes("/api/project-assets/complete"),
  "Stage 5 attachments must reuse authenticated ProjectAttachment upload infrastructure.",
);
assert(
  uploadClient.includes("request.upload.onprogress") &&
    workspace.includes('role="progressbar"') &&
    workspace.includes("saveProgress.percent") &&
    workspace.includes("completedUploads") &&
    workspace.includes("totalUploads"),
  "Stage 5 saves must show real upload and overall completion progress.",
);
assert(
  workspace.includes("No final file available") &&
    workspace.includes("Upload Final File") &&
    workspace.includes("Add Another Final File") &&
    workspace.includes("Uploaded directly in Stage 5") &&
    workspace.includes("pageData.canUploadSource") &&
    workspace.includes("pageData.files.length === 0") &&
    uploadClient.includes("uploadStageFiveDirectSource") &&
    uploadClient.includes('assetType: "GENERAL_PROJECT_ASSET"') &&
    uploadClient.includes("stageFiveDirectSource: true") &&
    projectAssetCompleteRoute.includes("stageFiveSource"),
  "An empty active Stage 5 must upload a primary final file through the existing project-asset pipeline and disable zero-file completion.",
);
assert(
  workspace.includes("Delete File") &&
    workspace.includes('title="Delete Stage 5 file?"') &&
    workspace.includes("deleteStageFiveSourceFileAction") &&
    actions.includes("deleteStageFiveSourceFile") &&
    service.includes("export async function deleteStageFiveSourceFile") &&
    service.includes("projectStageFileHandoff.delete") &&
    service.includes("AttachmentStatus.DELETED") &&
    service.includes("Stage 6 production has started"),
  "Every active Stage 5 source must expose a confirmed delete path that removes its checklist, deletes direct uploads, preserves carried originals, and blocks downstream deletion.",
);
assert(
  lineage.includes("ProjectWorkflowStageKey.CONCEPT_CREATION") &&
    lineage.includes("ProjectWorkflowStageKey.PROJECT_DEVELOPMENT") &&
    lineage.includes("ProjectWorkflowStageKey.FINAL_LAYOUT") &&
    service.includes("STAGE_FIVE_SOURCE_WORKFLOW_STAGE_KEYS") &&
    service.includes('"STAGE_THREE"') &&
    workspace.includes("Carried forward from Stage 3") &&
    stageSix.includes("STAGE_FIVE_SOURCE_WORKFLOW_STAGE_KEYS") &&
    stageSix.includes("isStageFiveSourceWorkflowStageKey") &&
    stageSix.includes("A direct Stage 5 source has invalid provenance."),
  "Stage 5 loading and Stage 5-to-6 completion must recognize Stage 3 fallback, Stage 4, and direct Stage 5 sources through one lineage policy.",
);
assert(
  projectConcepts.includes("approvedStageThreeConcepts") &&
    projectConcepts.includes(
      "sourceWorkflowStageKey:\n                    ProjectWorkflowStageKey.CONCEPT_CREATION",
    ) &&
    projectConcepts.includes("stageThreeFallbackHandoff") &&
    stageThreeFallbackMigration.includes(
      '"sourceWorkflowStageKey" = \'CONCEPT_CREATION\'',
    ) &&
    stageThreeFallbackMigration.includes('WITH "EligibleProjects" AS') &&
    stageThreeFallbackMigration.includes(
      'INSERT INTO "ProjectFileChecklist"',
    ),
  "Skipping Stage 4 must hand approved Stage 3 files to Stage 5, clean them up during Stage 3 rework, and backfill eligible existing projects.",
);
assert(
  projectHistory.includes("completeDirectStageFiveSourceUpload") &&
    projectHistory.includes("TransactionIsolationLevel.Serializable") &&
    projectHistory.includes("sourceWorkflowStageKey: ProjectWorkflowStageKey.FINAL_LAYOUT") &&
    projectHistory.includes("projectStageFileHandoff.upsert") &&
    projectHistory.includes("projectFileChecklist.upsert") &&
    projectHistory.includes('source: "stage_five_direct_upload"') &&
    directMigration.includes("'PROJECT_DEVELOPMENT'") &&
    directMigration.includes("'FINAL_LAYOUT'") &&
    directMigration.includes("ProjectStageFileHandoff_stage_pair_check"),
  "Direct finalization must atomically create idempotent checklist lineage with honest, database-constrained Stage 5 provenance.",
);
assert(
  workspace.includes("failedUploads += 1") &&
    workspace.includes('uploadState: "failed"') &&
    workspace.includes("Saving successful uploads and checklist information") &&
    workspace.includes("showWarningToast") &&
    filePicker.includes('file.uploadState === "failed"') &&
    filePicker.includes("Not uploaded") &&
    filePicker.includes("Retry"),
  "A failed Stage 5 upload must remain retryable while successful files and checklist data are saved.",
);
assert(
  workspace.includes("file.attachmentId ? [file.attachmentId] : []"),
  "Stage 5 must never send a failed local file identifier as a checklist attachment reference.",
);
assert(
  workspace.includes("requestStageFiveChecklistInformationAction") &&
    workspace.includes("Project participant") &&
    workspace.includes("Manual email") &&
    workspace.includes("Send Request") &&
    !workspace.includes("Request functionality will be connected"),
  "The Request dialog must dispatch real collaborator and manual-email requests.",
);
assert(
  workspace.includes('<SelectContent className="z-[190]">'),
  "The collaborator selector options must render above the request dialog backdrop.",
);
assert(
  workspace.includes("max-h-[calc(100dvh-1.5rem)]") &&
    workspace.includes("min-h-0 flex-1 overflow-y-auto overscroll-contain") &&
    workspace.includes("shrink-0 flex-col-reverse") &&
    workspace.includes("border-t border-[#e7ece8] bg-white") &&
    workspace.includes('ariaLabel="Request message"') &&
    workspace.includes('minHeightClassName="min-h-[96px]"'),
  "The Request Information dialog must fit the viewport, scroll its body, and keep its actions visible.",
);
assert(
  workspace.includes('href={`/projects/${project.id}/stages/6`}') &&
    !workspace.includes("completeProject") &&
    !workspace.includes("completeProjectStage"),
  "Next Stage must open Stage 6 directly without mutating Stage 5 workflow state.",
);
assert(
  workspace.includes("href={`/projects/${project.id}`}") && workspace.includes("All Stages"),
  "All Stages must return to the project overview.",
);

assert(
  page.includes("DashboardLayout") &&
    page.includes("getProjectStageShellById") &&
    page.includes("requireUser") &&
    page.includes("StageFiveWorkspace") &&
    page.includes("getStageFiveWorkspaceData") &&
    page.includes("searchParams"),
  "The Stage 5 route must use the existing shell and real authenticated project data.",
);
assert(
  page.includes("ProjectWorkflowStageKey.FINAL_LAYOUT") &&
    page.includes("canOpenImplementedWorkflowStage") &&
    page.includes("StageLockedState"),
  "Stage 5 must reuse centralized persisted workflow access.",
);
assert(
  workflowAccess.includes('code: "STAGE_LOCKED"') &&
    !workflowAccess.includes("UserRole") &&
    overview.includes("const stageOpenable = !locked") &&
    !overview.includes("canBypassLocked"),
  "The centralized workflow policy and overview must enforce Stage 5 without a role bypass.",
);
assert(
  service.includes("accessibleStageFiveProjectWhere") &&
    service.includes("ACCESSIBLE_WORKFLOW_STAGE_STATUSES"),
  "Authenticated Stage 5 request pages, files, uploads, and mutations must inherit the Stage 5 lock.",
);

assert(
  schema.includes("model ProjectStageFileHandoff") &&
    schema.includes("model ProjectFileChecklist") &&
    schema.includes("model ProjectFileChecklistItem") &&
    schema.includes("model ProjectFileChecklistItemAttachment") &&
    schema.includes("model ProjectFileChecklistRequest") &&
    schema.includes("enum ProjectFileChecklistField"),
  "Stage 5 must use typed per-file checklist, attachment association, handoff, and request models.",
);
assert(
  migration.includes("ProjectStageFileHandoff_stage_pair_check") &&
    migration.includes("ProjectFileChecklistRequest_recipient_check") &&
    migration.includes("ProjectFileChecklist_projectId_sourceAttachmentId_key"),
  "The additive migration must enforce the Stage 4/5 pair, recipient channel shape, and per-file uniqueness.",
);
assert(
  integrityMigration.includes("ProjectStageFileHandoff_sourceAttachmentId_fkey") &&
    integrityMigration.includes("ProjectFileChecklist_sourceAttachmentId_fkey") &&
    integrityMigration.includes("ProjectFileChecklistItemAttachment_attachmentId_fkey") &&
    (integrityMigration.match(/ON DELETE CASCADE/g)?.length ?? 0) === 3,
  "Stage 5 attachment relations must preserve project deletion integrity.",
);
assert(
  !stageFourWorkspace.includes("Final files for Stage 5") &&
    !stageFourWorkspace.includes("Send to Stage 5") &&
    !conceptActions.includes("handoffStageFourFiles") &&
    !service.includes("handoffStageFourFiles") &&
    conceptActions.includes("completeStageFourConceptsAction"),
  "The temporary manual Stage 4 handoff product surface must be retired in favor of real Stage 4 completion.",
);
assert(
  workspace.includes("selectedHandoffId") &&
    workspace.includes("dirtyHandoffIds") &&
    workspace.includes("Save Changes") &&
    service.includes("saveStageFiveChecklist") &&
    actions.includes("saveStageFiveChecklistAction"),
  "Stage 5 must keep independent per-file drafts and persist them explicitly.",
);
assert(
  workspace.includes("stageFiveDraftFingerprint(activeDraft) === stageFiveDraftFingerprint(draft)") &&
    workspace.includes("const dirtyIds = dirtyHandoffIdsRef.current") &&
    workspace.includes("const hasUnsavedChecklistChanges = unsavedHandoffIds.size > 0") &&
    workspace.includes("}, [committedDrafts]);") &&
    !workspace.includes("}, [pageData.files, dirtyHandoffIds]);"),
  "Stage 5 completion must use real draft differences and avoid stale server-prop synchronization.",
);
assert(
  workspace.includes("STAGE_FIVE_SESSION_DRAFT_PREFIX") &&
    workspace.includes("currentUserId}:${project.id}:${selectedHandoffId") &&
    workspace.includes("readStageFiveSessionDraft(stageFiveSessionDraftKey)") &&
    workspace.includes("window.sessionStorage.setItem(") &&
    workspace.includes("parseStageFiveAutosaveValue") &&
    workspace.includes("clearStageFiveSessionDraft(stageFiveSessionDraftKey)") &&
    workspace.includes('window.addEventListener("beforeunload", warnBeforeDiscardingDraft)') &&
    workspace.includes("event.returnValue = \"\""),
  "Stage 5 must synchronously preserve each user's unsaved checklist draft, warn before discarding non-restorable input, and clear the backup after save.",
);
assert(
  confirmationDialog.includes('createPortal(') &&
    confirmationDialog.includes('document.body') &&
    confirmationDialog.includes('role="dialog"') &&
    confirmationDialog.includes('aria-modal="true"'),
  "The Stage 5 confirmation must escape the animated dashboard container through the shared dialog portal.",
);
assert(
  workspace.indexOf("CHECKLIST_ITEMS.map") < workspace.indexOf('border-t border-[#e7ece7] bg-[#fbfcfb] px-4 py-5') &&
    workspace.indexOf('border-t border-[#e7ece7] bg-[#fbfcfb] px-4 py-5') < workspace.indexOf('"Save Changes"'),
  "Save Changes must render in a checklist footer after every required information and file row.",
);
assert(
  service.includes("CHECKLIST_INFORMATION_REQUESTED") &&
    service.includes("clientRequestId") &&
    service.includes("recipientUserId") &&
    service.includes("ProjectFileChecklistRequestStatus.FAILED") &&
    emailTemplate.includes("Provide Information") &&
    emailTemplate.includes("input.responseUrl"),
  "Checklist requests must persist, notify project participants, and send the secure response-link email template.",
);
assert(
  !service.includes("ProjectWorkflowStageStatus.COMPLETED") &&
    !service.includes("PRODUCTION_AND_HANDOVER") &&
    !actions.includes("completeProject") &&
    !externalService.includes("PRODUCTION_AND_HANDOVER"),
  "Checklist responses must not complete Stage 5 or unlock Stage 6.",
);
assert(
  chatWorkspace.includes("ProjectChatWorkspace") && !workspace.includes("ProjectChatWorkspace"),
  "Stage 5 must not modify or embed the existing project chat workspace.",
);

assert(
  schema.includes("enum ProjectFileChecklistRequestWorkflowStatus") &&
    schema.includes("workflowStatus") &&
    schema.includes("acceptedAt") &&
    schema.includes("completedAt") &&
    schema.includes("declinedAt") &&
    schema.includes("declineReason") &&
    schema.includes("respondedByUserId"),
  "Existing Stage 5 requests must retain a separate authenticated response lifecycle and audit timestamps.",
);
assert(
  responseMigration.includes("ProjectFileChecklistRequest_active_recipient_key") &&
    responseMigration.includes("WHERE \"channel\" = 'IN_APP'") &&
    responseMigration.includes("'REQUESTED', 'ACCEPTED'") &&
    responseMigration.includes("ProjectFileChecklistRequest_respondedByUserId_fkey"),
  "The response migration must enforce active-request idempotency and responder integrity.",
);
assert(
  service.includes("getStageFiveChecklistRequestData") &&
    service.includes("acceptStageFiveChecklistRequest") &&
    service.includes("declineStageFiveChecklistRequest") &&
    service.includes("submitStageFiveChecklistResponse") &&
    service.includes("canRespondToChecklistRequest") &&
    service.includes("ProjectFileChecklistItemStatus.FILLED") &&
    service.includes("CHECKLIST_INFORMATION_COMPLETED") &&
    service.includes("CHECKLIST_INFORMATION_DECLINED"),
  "The Stage 5 service must authorize and persist accept, decline, completion, checklist updates, and requester notifications.",
);
assert(
  service.includes('url: `/requests/checklist/${created.id}`') &&
    requestPage.includes("requireUser(returnTo)") &&
    requestPage.includes("getStageFiveChecklistRequestData") &&
    requestWorkspace.includes("Accept Request") &&
    requestWorkspace.includes("Submit Response") &&
    requestWorkspace.includes("Decline Request") &&
    requestWorkspace.includes("Response completed") &&
    requestWorkspace.includes("Request declined"),
  "Authenticated collaborator notifications must open a focused, terminal-state-aware response page.",
);
assert(
  requestWorkspace.includes('aria-label="Information request context"') &&
    requestPage.includes("checklistContextHref") &&
    requestPage.includes("encodeURIComponent(data.handoffId)") &&
    requestPage.includes("encodeURIComponent(data.field.key)") &&
    requestPage.includes('label: "Stage 5 Checklist"') &&
    requestPage.includes("backNavigation={{") &&
    requestWorkspace.includes("Stage 5 · File Checklist") &&
    requestWorkspace.includes("{data.project.name}") &&
    requestWorkspace.includes("{data.file.name}") &&
    requestWorkspace.includes("{data.field.title}"),
  "An information-request page must show a topbar Back button to its authoritative project, Stage 5 checklist file, and field context.",
);
assert(
  requestWorkspace.includes("Requested file") &&
    requestWorkspace.includes("sourcePreviewPath") &&
    requestWorkspace.includes("sourceDownloadPath") &&
    requestWorkspace.includes("AssetPreviewButton") &&
    requestSourcePreviewRoute.includes("getStageFiveChecklistRequestSourceFileUrl") &&
    requestSourceDownloadRoute.includes("getStageFiveChecklistRequestSourceFileUrl") &&
    service.includes("getStageFiveChecklistRequestSourceFileUrl") &&
    service.includes("recipientUserId: user.id"),
  "The exact request recipient must be able to preview and download the requested source file.",
);
assert(
  requestActions.includes("revalidatePath") &&
    requestActions.includes("publishProjectActivityUpdatedAfterResponse") &&
    requestActions.includes('eventType: "timeline_updated"') &&
    requestActions.includes("changedEntityId: input.requestId") &&
    requestActions.includes("acceptStageFiveChecklistRequest") &&
    requestActions.includes("declineStageFiveChecklistRequest") &&
    requestActions.includes("submitStageFiveChecklistResponse"),
  "Dedicated request actions must reauthorize, mutate, revalidate Stage 5, and refresh open project pages in realtime after terminal response changes.",
);
assert(
  uploadClient.includes("checklistRequestId") &&
    requestUploadRoute.includes("getStageFiveChecklistRequestUploadContext") &&
    requestCompleteRoute.includes("getStageFiveChecklistRequestUploadContext") &&
    service.includes("uploadedById: user.id") &&
    service.includes("checklistResponseRequestId: request.id") &&
    service.includes("fileChecklistItems: { none: {} }") &&
    service.includes("status: AttachmentStatus.READY") &&
    attachmentScopeMigration.includes("ProjectAttachment_checklistResponseRequestId_fkey"),
  "Response attachments must reuse ProjectAttachment while enforcing recipient, project, READY, and one-field association constraints.",
);
assert(
  auth.includes("returnTo") &&
    signInPage.includes("getSafeReturnUrl") &&
    signInActions.includes("getSafeReturnUrl") &&
    signInActions.includes("redirect(returnTo ?? \"/\")"),
  "Signed-out collaborators must return safely to the authenticated request after normal sign-in.",
);
assert(
  workspace.includes("latestRequest.workflowStatus") &&
    workspace.includes("Requested from") &&
    page.includes("initialField") &&
    workspace.includes("scrollIntoView"),
  "The owner UI must show active request context and notification deep-links must focus the exact field.",
);

assert(
  schema.includes("externalTokenHash") &&
    schema.includes("externalTokenExpiresAt") &&
    schema.includes("externalTokenRevokedAt") &&
    schema.includes("externalResponderEmail") &&
    schema.includes("ProjectFileChecklistResponseSource") &&
    schema.includes("ProjectAttachmentUploadSource") &&
    externalMigration.includes("ProjectFileChecklistRequest_active_email_recipient_key"),
  "The existing checklist request and attachment models must store hashed-token lifecycle and external provenance.",
);
assert(
  secureToken.includes("randomBytes(EXTERNAL_TOKEN_BYTES)") &&
    secureToken.includes('createHash("sha256")') &&
    externalToken.includes("CHECKLIST_EXTERNAL_REQUEST_EXPIRY_DAYS") &&
    externalToken.includes("DEFAULT_EXPIRY_DAYS = 7") &&
    !schema.includes("externalToken String"),
  "External access must use a 32-byte random token, store only SHA-256 hash state, and default to seven-day expiry.",
);
assert(
  service.includes("createExternalChecklistToken") &&
    service.includes("buildExternalChecklistRequestUrl") &&
    service.includes("resendStageFiveExternalChecklistRequest") &&
    service.includes("externalTokenHash: access.tokenHash") &&
    service.includes("externalTokenRevokedAt: new Date()") &&
    workspace.includes("Resend email"),
  "Manual dispatch and resend must generate fresh secure links, revoke failed links, and expose a safe internal resend action.",
);
assert(
  externalPage.includes('dynamic = "force-dynamic"') &&
    externalPage.includes("noStore()") &&
    externalPage.includes("StageFiveExternalRequestWorkspace") &&
    !externalPage.includes("requireUser") &&
    !externalPage.includes("DashboardAppFrame") &&
    !externalPage.includes("Sign In") &&
    !externalWorkspace.includes("Dashboard") &&
    nextConfig.includes('source: "/external/checklist-request/:token"') &&
    nextConfig.includes('value: "private, no-store, max-age=0"'),
  "The exact external route must be standalone, unauthenticated, request-scoped, and explicitly non-cacheable.",
);
assert(
  externalWorkspace.includes("data.field.control") &&
    externalWorkspace.includes("data.field.suggestions") &&
    externalWorkspace.includes("Submit Response") &&
    externalWorkspace.includes("Cannot provide this information") &&
    externalService.includes("getStageFiveFieldDefinition") &&
    externalService.includes("validateStageFiveChecklistResponse"),
  "The external page must use the shared Stage 5 field definition and server response validator.",
);
assert(
  externalUploadRoute.includes("prepareExternalChecklistAttachment") &&
    externalUploadClient.includes("uploadExternalStageFiveAttachment") &&
    externalService.includes("EXTERNAL_CHECKLIST_REQUEST") &&
    externalService.includes("externalUploaderEmail") &&
    externalService.includes("checklistResponseRequestId: request.id") &&
    externalService.includes("fileChecklistItems: { none: {} }") &&
    externalService.includes("projectId: request.projectId"),
  "External uploads must derive scope from the token and retain explicit recipient/request provenance.",
);
assert(
  externalSubmitRoute.includes("submitExternalChecklistResponse") &&
    externalDeclineRoute.includes("declineExternalChecklistRequest") &&
    externalSubmitRoute.includes("publishProjectActivityUpdatedAfterResponse") &&
    externalDeclineRoute.includes("publishProjectActivityUpdatedAfterResponse") &&
    externalSubmitRoute.includes('eventType: "timeline_updated"') &&
    externalDeclineRoute.includes('eventType: "timeline_updated"') &&
    externalService.includes("ProjectFileChecklistItemStatus.FILLED") &&
    externalService.includes("ProjectFileChecklistRequestWorkflowStatus.COMPLETED") &&
    externalService.includes("ProjectFileChecklistResponseSource.EXTERNAL_EMAIL") &&
    externalService.includes("CHECKLIST_INFORMATION_COMPLETED") &&
    externalService.includes("CHECKLIST_INFORMATION_DECLINED"),
  "External completion/decline must update the real checklist lifecycle, notify the requester, and refresh open project pages.",
);
assert(
  workspace.includes("buildStageFiveDrafts(pageData.files)") &&
    workspace.includes("mergeResolvedRequestFields") &&
    workspace.includes("current.statuses[fieldKey] !== ProjectFileChecklistItemStatus.REQUESTED"),
  "Stage 5 must reconcile refreshed server responses into the visible form without discarding unrelated unsaved edits.",
);
assert(
  rateLimit.includes("checkRateLimit") &&
    externalUploadRoute.includes('scope: "upload"') &&
    externalSubmitRoute.includes('scope: "submit"') &&
    externalPage.includes('scope: "verify"'),
  "Public token verification, upload, and submit surfaces must reuse bounded rate limiting.",
);

console.log("Stage 5 persistent per-file checklist UI checks passed.");

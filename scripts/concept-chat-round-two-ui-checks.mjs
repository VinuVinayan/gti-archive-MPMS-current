import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fileThumbnail = await readFile("src/components/projects/file-thumbnail.tsx", "utf8");

const [
  workspace,
  chatRoute,
  concepts,
  history,
  actions,
  comparison,
  compareWorkspace,
  compareRoute,
  stageThreeCompare,
  stageFourCompare,
  access,
  notifications,
  projects,
  assetPreview,
  deadlineTimer,
  dashboardAppFrame,
] = await Promise.all([
  readFile("src/components/projects/project-chat-workspace.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/chat/page.tsx", "utf8"),
  readFile("src/lib/project-concepts.ts", "utf8"),
  readFile("src/lib/project-history.ts", "utf8"),
  readFile("src/app/(dashboard)/projects/actions.ts", "utf8"),
  readFile("src/lib/comparison.ts", "utf8"),
  readFile("src/components/projects/project-compare-workspace.tsx", "utf8"),
  readFile("src/components/projects/concept-compare-route.tsx", "utf8"),
  readFile(
    "src/app/(dashboard)/projects/[slug]/stages/3/concepts/[folderId]/compare/page.tsx",
    "utf8",
  ),
  readFile(
    "src/app/(dashboard)/projects/[slug]/stages/4/concepts/[folderId]/compare/page.tsx",
    "utf8",
  ),
  readFile("src/lib/project-concept-access.ts", "utf8"),
  readFile("src/lib/notification-center/triggers.ts", "utf8"),
  readFile("src/lib/projects.ts", "utf8"),
  readFile("src/components/projects/asset-preview-button.tsx", "utf8"),
  readFile("src/components/projects/concept-deadline-timer.tsx", "utf8"),
  readFile("src/components/layout/dashboard-app-frame.tsx", "utf8"),
]);

assert(
  concepts.includes('type: "concept"') &&
    concepts.includes('"Stage 3 - Initial Concept"') &&
    concepts.includes('"Stage 4 - Final Concept"') &&
    chatRoute.includes("conceptMode={conceptMode}"),
  "Stage 3/4 must share an explicit server-derived concept chat mode.",
);

for (const label of ["Project", "Stage", "Concept", "Assigned Executor"]) {
  assert(workspace.includes(`"${label}"`), `Missing compact concept context: ${label}`);
}
assert(
  workspace.includes("conceptMode.backHref") &&
    concepts.includes("backHref:") &&
    concepts.includes("compareHref:"),
  "Concept navigation must preserve the stage and folder identity.",
);

assert(
  workspace.includes("!isConceptMode ? (") &&
    workspace.includes("Translate All") &&
    workspace.includes("handleMicrophoneToggle") &&
    workspace.includes("ChatLanguagePicker"),
  "Translation, language, and microphone controls must remain normal-chat-only.",
);
assert(
  workspace.includes("ConceptBriefContextCard") &&
    workspace.includes("Concept Brief") &&
    workspace.includes("Brief Attachments") &&
    workspace.includes("hasAcceptedBrief"),
  "Concept Brief text, attachments, and compact acceptance state must be present.",
);
assert(
  workspace.includes("AssetImageThumbnail") &&
    workspace.includes("AssetPreviewButton") &&
    workspace.includes("interactive={!canShowFileActions}") &&
    assetPreview.includes("export function AssetImageThumbnail") &&
    assetPreview.includes("interactive = true") &&
    assetPreview.includes("if (!interactive ||") &&
    assetPreview.includes('aria-label={`Preview image ${fileName}`}') &&
    fileThumbnail.includes('loading="lazy"') &&
    assetPreview.includes("<FileThumbnail") && fileThumbnail.includes("h-full w-full object-contain"),
  "Stage 3/4 chat image documents must keep an uncropped visual thumbnail without duplicating the dedicated preview action.",
);
assert(
  workspace.includes("Concept Status") &&
    workspace.includes("StageTimeRemainingCard") &&
    workspace.includes("min-width:1680px") &&
    workspace.includes("Stage Overview"),
  "Concept mode needs a lightweight collapsible panel while normal Stage Overview remains intact.",
);
assert(
  workspace.includes("ConceptDeadlineTimer") &&
    workspace.includes("activeStage?.plannedDueAtValue") &&
    deadlineTimer.includes("Concept deadline") &&
    deadlineTimer.includes("Overdue by") &&
    deadlineTimer.includes("remaining") &&
    deadlineTimer.includes("window.setInterval(updateNow, 1_000)"),
  "Concept chat must keep a live, responsive deadline countdown visible independently of the large-screen sidebar.",
);
assert(
    workspace.includes("Revoke Approval") &&
    workspace.includes("confirmConceptApprovalRevocation") &&
    workspace.includes("conceptMode.canReview") &&
    workspace.includes("canRevokeConceptApproval ?") &&
    workspace.includes('tone="destructive"') &&
    workspace.includes('status: "PENDING_REVIEW"'),
  "Authorized Stage 3/4 reviewers must receive a confirmed, responsive approval-revocation action that restores Pending Review.",
);
assert(
  workspace.includes("Back to Concept Taskers") &&
    workspace.includes("href={conceptMode.backHref}") &&
    workspace.indexOf("Back to Concept Taskers") >
      workspace.indexOf("Latest revision actions"),
  "Concept chat must repeat its tasker navigation in the lower action area.",
);
const conceptStatusBlock = workspace.slice(
  workspace.indexOf("Concept Status"),
  workspace.indexOf("<StageTimeRemainingCard", workspace.indexOf("Concept Status")),
);
assert(
  workspace.includes("{isConceptMode &&\n          showSubmitWorkAction &&\n          hasAcceptedBrief &&\n          (canSubmitNewRevision || isUploadingRevision) ? (") &&
    workspace.includes("{!isConceptMode &&\n              showSubmitWorkAction &&") &&
    !conceptStatusBlock.includes("Submit Work"),
  "Concept mode must expose one canonical Submit Work action and exclude generic/sidebar duplicates.",
);
const conceptBottomActionIndex = workspace.indexOf(
  "{isConceptMode && canAcceptCurrentStageBrief ? (",
);
const conceptLatestActionIndex = workspace.indexOf(
  "{showLatestRevisionActionBar && latestRevisionMessage ? (",
);
assert(
  conceptBottomActionIndex > workspace.indexOf('<div ref={chatBottomRef} />') &&
    conceptBottomActionIndex < conceptLatestActionIndex &&
    !workspace
      .slice(conceptBottomActionIndex, conceptLatestActionIndex)
      .includes("sticky top-[56px]"),
  "Concept workflow actions must sit in normal layout directly above the composer instead of floating over history.",
);
const latestRevisionActionBlock = workspace.slice(
  conceptLatestActionIndex,
  workspace.indexOf("{isChatReadOnly ? (", conceptLatestActionIndex),
);
assert(
  latestRevisionActionBlock.includes("canCompareSubmissions && conceptMode") &&
    latestRevisionActionBlock.includes("conceptMode.compareHref") &&
    latestRevisionActionBlock.includes("Compare Submissions") &&
    latestRevisionActionBlock.match(/href=\{conceptMode\.compareHref\}/g)?.length === 1,
  "Concept comparison must expose exactly one canonical route-backed action in the latest-revision bar.",
);
assert(
  !workspace
    .slice(conceptBottomActionIndex, conceptLatestActionIndex)
    .includes("conceptMode.compareHref") &&
    !conceptStatusBlock.includes("conceptMode.compareHref"),
  "Assigned USER submit-work controls and the wide concept sidebar must not duplicate the canonical comparison action.",
);
assert(
  workspace.includes(
    "(!isStageCompleted && !isProjectCompleted) ||\n      (isConceptMode && canCompareSubmissions)",
  ),
  "Completed/read-only concept stages must keep the comparison action bar visible when at least two submissions can be compared.",
);
assert(
  workspace.includes("ProjectExecutorsPanel") &&
    workspace.includes("ProjectCollaboratorsPanel") &&
    workspace.includes("{conceptMode ? (") &&
    workspace.includes(") : (\n            <>"),
  "Generic executor/collaborator panels must remain in the normal-chat branch only.",
);
assert(
  workspace.includes("isConceptIrrelevantSystemEntry") &&
    workspace.includes("displayedMessages") &&
    workspace.includes("archive"),
  "Concept-irrelevant system history must be presentation-filtered without deleting records.",
);

assert(
  workspace.includes("useState(deferCompletionData)") &&
    workspace.includes("if (!deferCompletionData)") &&
    workspace.includes("void loadCompletionData({") &&
    !workspace.includes("Reload Checklist") &&
    !workspace.includes("Project completion checklist is not available yet.") &&
    chatRoute.includes("completionWorkflow={null}") &&
    projects.includes("includeStageInvoiceData?: boolean") &&
    projects.includes("participantUserIds") &&
    projects.includes("without-stage-invoices"),
  "Concept chat must load deferred completion data automatically without the legacy manual reload prompt.",
);

assert(
  history.includes("Concept revisions require at least one submitted file") &&
    history.includes("status: AttachmentStatus.READY") &&
    history.includes("stagedAttachmentCount !== stagedAttachmentIds.length") &&
    history.includes("data: { revisionId: revision.id }") &&
    history.includes("ActivityLogAction.REVISION_CREATED"),
  "A concept revision must atomically bind one or more READY files before review.",
);
assert(
  workspace.indexOf("const uploadResults = await uploadRevisionFiles();") <
      workspace.indexOf("attachmentIds: successfulUploads.map") &&
    actions.indexOf("const revision = await createStageRevision") <
      actions.indexOf('runNotificationTask("revision-submitted"'),
  "Concept files must finish before revision creation and notification.",
);
assert(
  history.includes('mode: "work"') &&
    history.includes("Please accept the brief before submitting work") &&
    history.includes("cancelStagedConceptRevisionAttachments"),
  "Concept submission must be assigned-executor-only, accepted, and safely cleanable.",
);

assert(
  concepts.includes("const canReview = canReviewProjectConcept") &&
    chatRoute.includes("? conceptMode.canReview") &&
    access.includes("context.coOwnerIds.includes(user.id)") &&
    access.includes("isGlobalProjectAdministrator(user)") &&
    access.includes("context.assignedExecutorId !== user.id") &&
    workspace.includes("conceptMode.canReview && !conceptMode.isAssignedExecutor") &&
    workspace.includes("latestRevisionMessage?.authorId !== currentUserId") &&
    history.includes("You cannot review your own submission.") &&
    workspace.includes('isConceptMode ? "Request Changes"') &&
    workspace.includes("!activeStage?.isTasker"),
  "Owner/co-owner/global administrator review and Request Changes must not restore tasker approval.",
);
assert(
  compareRoute.includes('!context || !hasPermission(user, "compare.view")') &&
    comparison.includes("canViewProjectConcept(user, concept)") &&
    comparison.includes('hasPermission(user, "compare.createComment")') &&
    history.includes('mode: "view"') &&
    workspace.includes('isConceptMode ? "hidden" : ""') &&
    workspace.includes("!isConceptMode &&\n              canReviewLatestRevision") &&
    workspace.includes("showLatestRevisionActionBar && latestRevisionMessage"),
  "Assigned executors must receive read-only comparison access while review mutations remain reviewer-only.",
);
assert(
    history.includes("Concept taskers cannot use the legacy approve/complete action") &&
    history.includes("rejectionReason") &&
    history.includes('input.status === "REJECTED"'),
  "Legacy approval must remain blocked while rejection details persist.",
);

assert(
  compareRoute.includes("getProjectConceptChatContext") &&
    compareRoute.includes("context.folder.taskerStageId") &&
    compareRoute.includes("getComparisonCommentsForPair") &&
    compareRoute.includes("conceptMode={chatMode}") &&
    stageThreeCompare.includes("ProjectWorkflowStageKey.CONCEPT_CREATION") &&
    stageFourCompare.includes("ProjectWorkflowStageKey.PROJECT_DEVELOPMENT"),
  "Stage 3/4 comparison routes must resolve the concept tasker server-side.",
);
assert(
  !/(?:revision|comment|comparison)\.createdAt\.toISOString\(\)/.test(history) &&
    history.includes("createdAtValue: toHistoryDate(revision.createdAt).toISOString()") &&
    history.includes("createdAtValue: toHistoryDate(comment.createdAt).toISOString()") &&
    history.includes("createdAtValue: toHistoryDate(comparison.createdAt).toISOString()"),
  "Cached stage-history timestamps must be rehydrated before concept comparison entries are mapped.",
);
assert(
  compareWorkspace.includes("conceptMode?.compareHref") &&
    compareWorkspace.includes("conceptMode.conceptName") &&
    compareWorkspace.includes("!conceptMode ?"),
  "Concept comparison must retain exact routing and hide generic comparison context.",
);
assert(
  compareWorkspace.includes("mx-auto w-full min-w-0 max-w-[1600px]") &&
    compareWorkspace.includes("sm:grid-cols-2") &&
    compareWorkspace.includes("xl:grid-cols-[minmax(0,1fr)_300px]") &&
    compareWorkspace.includes("min-h-0 min-w-0 max-w-full") &&
    compareWorkspace.includes("[&>span]:min-w-0"),
  "Compact concept selectors and the overlay workspace must remain aligned within the available viewport.",
);
assert(
  dashboardAppFrame.includes("isCompareWorkspace") &&
    dashboardAppFrame.includes("Compare Submissions") &&
    compareWorkspace.includes("md:h-[calc(100dvh-180px)]") &&
    compareWorkspace.includes("md:h-auto md:flex-1") &&
    compareWorkspace.includes("fitPadding = fullscreenMode ? 12 : 20") &&
    compareWorkspace.includes("useState(initialComments.length > 0)") &&
    compareWorkspace.includes("captionsPanelOpen ?") &&
    compareWorkspace.includes("Captions {comments.length}") &&
    compareWorkspace.includes('bg-[#f3f5f1]') &&
    compareWorkspace.includes("Add Caption") &&
    compareWorkspace.includes("Available Submissions") &&
    !compareWorkspace.includes("bg-[linear-gradient(135deg,#2f8d5d,#46a470)]") &&
    !compareWorkspace.includes('fixed inset-0 z-[100] bg-[#0f1311]'),
  "Comparison must use compact topbar context, viewport-height artwork, collapsible captions, and a light maximize workspace.",
);
for (const { viewportHeight, expectedCardHeight, minimumArtworkHeight } of [
  { viewportHeight: 768, expectedCardHeight: 588, minimumArtworkHeight: 470 },
  { viewportHeight: 800, expectedCardHeight: 620, minimumArtworkHeight: 500 },
  { viewportHeight: 900, expectedCardHeight: 720, minimumArtworkHeight: 600 },
]) {
  const calculatedCardHeight = Math.min(760, Math.max(500, viewportHeight - 180));
  const calculatedArtworkHeight = calculatedCardHeight - 112;
  assert.equal(
    calculatedCardHeight,
    expectedCardHeight,
    `Comparison card height must remain viewport-derived at ${viewportHeight}px.`,
  );
  assert(
    calculatedArtworkHeight >= minimumArtworkHeight,
    `Artwork must remain substantial without scrolling at ${viewportHeight}px.`,
  );
}
const primaryComparisonIndex = compareWorkspace.indexOf(
  "{hasEnoughSubmissions && baseSubmission && compareSubmission ? (",
);
const availableSubmissionsIndex = compareWorkspace.indexOf(
  "{submissions.length > 0 ? (",
  primaryComparisonIndex,
);
assert(
  primaryComparisonIndex >= 0 && availableSubmissionsIndex > primaryComparisonIndex,
  "Available Submissions must remain after the primary first-viewport comparison workspace.",
);
const comparisonFrameIndex = compareWorkspace.indexOf("ref={frameRef}");
const pendingCaptionMarkerIndex = compareWorkspace.indexOf(
  'data-caption-marker="pending"',
  comparisonFrameIndex,
);
const pendingCaptionEditorIndex = compareWorkspace.indexOf(
  'data-caption-editor="true"',
  pendingCaptionMarkerIndex,
);
assert(
  compareWorkspace.includes("relative min-h-0 border p-2.5") &&
    pendingCaptionMarkerIndex > comparisonFrameIndex &&
    pendingCaptionEditorIndex > pendingCaptionMarkerIndex &&
    compareWorkspace.includes('data-caption-overlay-layer="true"') &&
    compareWorkspace.includes("max-h-[calc(100%-1.5rem)]") &&
    compareWorkspace.includes("overflow-y-auto"),
  "Caption markers must remain image-anchored while caption controls stay inside a scroll-safe viewer overlay.",
);
assert(
  comparison.includes("getProjectConceptAccessContext") &&
    comparison.includes("canReviewProjectConcept") &&
    comparison.includes("canCreateComparisonMarker") &&
    compareRoute.includes("canAddCaptions={chatMode.canReview}"),
  "Only centralized concept reviewers may create comparison markers.",
);
assert(
  comparison.includes("baseAttachmentId") &&
    comparison.includes("compareAttachmentId") &&
    comparison.includes("projectId: input.projectId") &&
    comparison.includes("stageId: input.stageId"),
  "Comparison file pairs must remain project- and tasker-scoped.",
);
assert(
  notifications.includes("buildProjectStageNotificationUrl") &&
    notifications.includes("/stages/${stageNumber}/concepts/"),
  "Concept revision/caption notification links must preserve the concept route.",
);

for (const retained of [
  "ProjectAccessRealtimeGuard",
  "Load earlier messages",
  "mentionSuggestions",
  "deleteMessageTarget",
  "AttachmentHistoryList",
  "Project Completion",
  "Stage Invoice",
]) {
  assert(workspace.includes(retained), `Normal/core chat regression: missing ${retained}`);
}

assert(
  !concepts.includes("ProjectStageFileHandoff") &&
    !history.includes("Mark as Approved Concept") &&
    !compareRoute.includes("completeProjectStage"),
  "Round 2 must not implement final approval, completion, or handoff.",
);

console.log("Stage 3/4 Round 2 concept chat/revision/comparison UI checks passed.");

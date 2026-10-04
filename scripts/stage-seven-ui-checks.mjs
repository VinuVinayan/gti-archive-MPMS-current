import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspace, sampleActions, realtimeGuard, page, actions, service, dashboard, schema, baseMigration, correctionMigration, physicalMigration, recipientMigration, notificationMigration, notificationPresenter, cronRoute, datePicker] =
  await Promise.all([
    readFile("src/components/projects/stage-seven-workspace.tsx", "utf8"),
    readFile("src/lib/stage-seven-sample-actions.ts", "utf8"),
    readFile("src/components/projects/project-access-realtime-guard.tsx", "utf8"),
    readFile("src/app/(dashboard)/projects/[slug]/stages/7/page.tsx", "utf8"),
    readFile("src/app/(dashboard)/projects/[slug]/stages/7/actions.ts", "utf8"),
    readFile("src/lib/stage-seven.ts", "utf8"),
    readFile("src/lib/dashboard.ts", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
    readFile("prisma/migrations/20260809210000_stage_seven_production_supervision/migration.sql", "utf8"),
    readFile("prisma/migrations/20260809233000_correct_stage_seven_sample_round/migration.sql", "utf8"),
    readFile("prisma/migrations/20260809235900_stage_seven_physical_sample_requests/migration.sql", "utf8"),
    readFile("prisma/migrations/20260812130000_stage_seven_sample_request_recipients/migration.sql", "utf8"),
    readFile("prisma/migrations/20260817100000_add_production_sample_requested_notification/migration.sql", "utf8"),
    readFile("src/lib/notification-center/presenter.ts", "utf8"),
    readFile("src/app/api/internal/stage-seven/overdue/route.ts", "utf8"),
    readFile("src/components/calendar/app-date-picker.tsx", "utf8"),
  ]);

for (const content of [
  "Stage ${snapshot.order} – ${snapshot.name}",
  "Request, track, and accept physical production samples",
  "Production Units",
  "Waiting for Sample",
  "Overdue",
  "Accepted",
  "Physical Sample Requests —",
  "<span>Round</span><span>Name / Type</span><span>Provider</span><span>Deadline</span>",
  "Request New Sample",
  "Round Name *",
  "Sample Type *",
  "Deadline *",
  "Who will provide this sample? *",
  "Internal Provider *",
  "Company Name *",
  "Contact Name *",
  "Email *",
  "Phone *",
  "Request Note",
  "Send Sample Request",
  "Physical Sample Review",
  "Accept Sample",
  "Reject Sample",
  "Resend Request",
  "Delete Request",
  "Received",
  "Not Received",
  "Accept / Reject",
  "Mark Project as Completed",
]) {
  assert(workspace.includes(content), `Missing final Stage 7 UI content: ${content}`);
}

for (const removed of [
  "Evaluation Criteria",
  "Overall Decision",
  "Participants in Review",
  "Evidence",
  "Generate Feedback Email",
  "Mark Round Complete",
  "Sign Off Production Unit",
  "Save Progress",
  "Review Progress",
  "Submission deadline",
  "Review deadline",
  "Revision / Sign-off",
  "Delivery deadline",
  "Approval Chain",
  "Stage 8",
]) {
  assert(!workspace.includes(removed), `Retired Stage 7 product UI remains: ${removed}`);
}

assert(
  page.includes("getStageSevenWorkspaceData") &&
    page.includes("selectedUnitId={unit}") &&
    page.includes("selectedRoundId={round}") &&
    workspace.includes("URLSearchParams") &&
    workspace.includes('params.set("round", roundId)'),
  "Stage 7 must load persisted data and keep unit/round selection URL-backed.",
);
assert(
  workspace.includes("ProductionHandoverRoute.PURCHASE_DEPARTMENT") &&
    workspace.includes("ProductionHandoverRoute.DIRECT_VENDOR") &&
    workspace.includes("normalizeInternationalPhone(recipientPhone)") &&
    workspace.includes("the + is optional") &&
    workspace.includes("border-[#c8d5cb]") &&
    workspace.includes("focus-visible:border-[#46906a]") &&
    service.includes("Internal sample requests require an existing project participant.") &&
    service.includes("External sample requests require external recipient details.") &&
    recipientMigration.includes('ADD COLUMN "recipientRoute"') &&
    recipientMigration.includes('ADD COLUMN "recipientCompany"') &&
    recipientMigration.includes('ADD COLUMN "recipientPhone"'),
  "Sample requests must validate external recipient details consistently and accept international phones with an optional + prefix.",
);
assert(
  workspace.includes("unit.rawFileName !== unit.name") &&
    service.includes("ProjectFileChecklistField.OUTPUT_NAME") &&
    service.includes("outputNameFromChecklist(output?.value)"),
  "OUTPUT_NAME must be the Production Unit title with the raw filename retained as secondary context.",
);
assert(
  workspace.includes("AppDatePicker") &&
    workspace.includes("popoverZIndex={200}") &&
    datePicker.includes('event.key === "Escape"') &&
    !workspace.includes('type="date"') &&
    !workspace.includes('type="datetime-local"'),
  "The request must use the reusable date-only AppDatePicker.",
);
assert(
  workspace.includes("h-[calc(100dvh-1.5rem)] max-h-[900px]") &&
    workspace.includes("sm:h-[calc(100dvh-3rem)]") &&
    workspace.includes("flex min-h-0 flex-1 flex-col overflow-hidden p-0") &&
    workspace.includes("dashboard-scroll-thin min-h-0 min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain") &&
    workspace.includes("[scrollbar-gutter:stable]") &&
    workspace.includes("relative z-10 shrink-0 border-t border-[#e4eae5] bg-[#fbfcfb]") &&
    workspace.includes('className="grid min-w-0 gap-6 sm:gap-7"') &&
    workspace.includes('className="grid min-w-0 gap-5 sm:grid-cols-2"') &&
    workspace.includes('aria-labelledby="sample-details-heading"') &&
    workspace.includes('aria-labelledby="sample-provider-heading"') &&
    workspace.includes('aria-labelledby="sample-instructions-heading"') &&
    workspace.includes('aria-labelledby="sample-reminder-heading"') &&
    workspace.includes("border-t border-[#dce7de] pt-5") &&
    workspace.includes("footer={(") &&
    workspace.indexOf("footer={(") < workspace.indexOf('Round Name *'),
  "The Request New Sample dialog must have a definite viewport-bounded height, contain horizontal overflow, scroll fields internally, and keep its action footer separate and accessible.",
);
assert(
  (workspace.match(/grid-cols-\[50px_minmax\(0,1\.25fr\)_minmax\(0,1fr\)_100px_128px_210px\]/g)?.length ?? 0) === 2 &&
    workspace.includes('<span className="w-full">Status</span>') &&
    workspace.includes('<span className="w-full text-right">Actions</span>') &&
    workspace.includes('className="w-full min-w-0"') &&
    workspace.includes("whitespace-nowrap border-[#dfe5df]") &&
    workspace.includes("<ReceiptStatusBadge round={round} />") &&
    workspace.includes("<DecisionBadge decision={round.decision} />") &&
    !workspace.includes('{selected ? "Selected" : "View"}'),
  "Physical Sample Request Status and Action headers and cells must use matching, non-overlapping column widths and alignment.",
);
assert(
  workspace.indexOf("Physical Sample Review") < workspace.lastIndexOf("Request Note") &&
    workspace.indexOf("Reject Sample") < workspace.indexOf("Review Note") &&
    workspace.includes("provider email was not delivered") &&
    workspace.indexOf("Resend Request") < workspace.indexOf("Request Created") &&
    workspace.indexOf("Delete Request") < workspace.indexOf("Request Created"),
  "Review decisions, resend, and delete actions must stay at the top of the selected request panel.",
);
assert(
  workspace.includes("const canRequest = Boolean(selectedUnit && data.canManage") &&
    workspace.includes("getPhysicalSampleRequestActionState") &&
    workspace.includes("actions.showRowDelete") &&
    workspace.includes("actions?.showDetailsDelete") &&
    sampleActions.includes("showRowDelete: canDelete") &&
    !sampleActions.includes("showRowDelete: canDelete && !input.selected") &&
    sampleActions.includes("showDetailsDelete: canDelete && input.selected") &&
    workspace.includes("onDeleteRound(round)") &&
    workspace.includes("sampleRoundId: target.round.id") &&
    !workspace.includes("!latestRound || latestRound.decision") &&
    !workspace.includes("round.sequence === unit.rounds.at(-1)") &&
    !service.includes("The latest physical sample request is still awaiting a decision") &&
    !service.includes("Previous sample rounds are read-only history.") &&
    !service.includes("The physical sample request email must be sent before recording a decision."),
  "Managers must be able to create, inspect, and delete each physical sample request independently.",
);
assert(
  workspace.includes("const hasRejectionNote = Boolean(richTextToPlainText(reviewNote))") &&
    workspace.includes('disabled={!actions?.reviewActionsEnabled || !hasRejectionNote}') &&
    workspace.includes('aria-describedby="sample-rejection-note-requirement"') &&
    sampleActions.includes("reviewActionsEnabled: reviewable && received") &&
    workspace.includes("Mark the physical sample as received before accepting or rejecting it.") &&
    workspace.includes("Required to reject") &&
    workspace.includes("Enter a review note to enable Reject Sample.") &&
    workspace.includes("A review note is optional when accepting.") &&
    workspace.includes("if (!received || !hasRejectionNote) return") &&
    !workspace.includes('"Review note required."') &&
    !workspace.includes('"Enter a review note before rejecting the physical sample."'),
  "Assigned internal recipients must record receipt before deciding, while empty-note rejection remains prevented and clearly explained.",
);

for (const action of [
  "createProductionSampleRoundAction",
  "retryProductionSampleRequestEmailAction",
  "deleteProductionSampleRoundAction",
  "markPhysicalSampleRoundReceivedAction",
  "decidePhysicalSampleRoundAction",
  "closeStageSevenProjectAction",
]) {
  assert(workspace.includes(action) && actions.includes(action), `Final Stage 7 action is not wired: ${action}`);
}
assert(
  actions.includes("publishProjectActivityUpdatedAfterResponse") &&
    actions.includes("function publishStageSevenChange") &&
    actions.includes('eventType: "timeline_updated"') &&
    actions.includes("publishStageSevenChange({ projectId, actorId, changedEntityId })") &&
    workspace.includes("ProjectAccessRealtimeGuard") &&
    workspace.includes("fallbackRefreshIntervalMs={10_000}") &&
    realtimeGuard.includes('window.addEventListener("focus", refreshVisibleProject)') &&
    realtimeGuard.includes('window.addEventListener("online", refreshVisibleProject)') &&
    realtimeGuard.includes('document.addEventListener("visibilitychange", handleVisibilityChange)') &&
    realtimeGuard.includes("window.setInterval(") &&
    realtimeGuard.includes("refreshProject();"),
  "Every successful Stage 7 mutation must invalidate open project views through realtime with focus, reconnect, and polling reconciliation.",
);
for (const removedAction of [
  "updateProductionSampleEvaluationAction",
  "addProductionSampleParticipantAction",
  "addProductionSampleEvidenceAction",
  "sendStageSevenFeedbackAction",
  "completeProductionSampleRoundAction",
  "signOffProductionUnitAction",
]) {
  assert(!workspace.includes(removedAction) && !actions.includes(removedAction), `Retired Stage 7 action remains wired: ${removedAction}`);
}

for (const model of ["ProjectProductionSupervision", "ProductionSampleRound", "ProjectClosure"]) {
  assert(schema.includes(`model ${model}`), `Missing Stage 7 persistence: ${model}`);
  assert(baseMigration.includes(`CREATE TABLE "${model}"`), `Missing original Stage 7 table migration: ${model}`);
}
assert(
  correctionMigration.includes('ADD COLUMN "name" TEXT') &&
    correctionMigration.includes('ADD COLUMN "deadline" DATE') &&
    !correctionMigration.includes("DROP COLUMN") &&
    physicalMigration.includes('CREATE TYPE "PhysicalSampleDecision"') &&
    physicalMigration.includes('ADD COLUMN "recipientEmail" TEXT') &&
    physicalMigration.includes('ADD COLUMN "requestReferenceFileIds" TEXT[]') &&
    physicalMigration.includes('ADD COLUMN "emailStatus" "ProductionDispatchStatus"') &&
    physicalMigration.includes('ADD COLUMN "decision" "PhysicalSampleDecision"') &&
    !physicalMigration.includes("DROP COLUMN") &&
    !physicalMigration.includes("DROP TABLE"),
  "The final change must be additive and preserve earlier Stage 7 records.",
);

assert(
  service.includes("isGlobalProjectAdministrator(user)") &&
    service.includes('hasProjectPermission(user, project, "stage.view")'),
  "Only business administrators with effective Stage access may manage Stage 7.",
);
assert(
  schema.includes("PRODUCTION_SAMPLE_REQUESTED") &&
    notificationMigration.includes("PRODUCTION_SAMPLE_REQUESTED") &&
    service.includes("NotificationType.PRODUCTION_SAMPLE_REQUESTED") &&
    service.includes("publishNotificationChanges") &&
    service.includes("ensureInternalSampleRequestNotification") &&
    service.includes("tx.notification.upsert") &&
    service.includes("stage7-physical-sample-requested:${input.roundId}:${input.recipientUserId}") &&
    service.includes("if (prepared.duplicate) return prepared") &&
    notificationPresenter.includes('"PRODUCTION_SAMPLE_REQUESTED"') &&
    service.includes("const assignedRecipientId = canManage ? null : user.id") &&
    service.includes("some: { recipientUserId: assignedRecipientId }") &&
    service.includes("participants: canManage ? getParticipants(project) : []") &&
    !page.includes("isBusinessAdministratorRole(user.role)"),
  "Internal sample recipients must receive a repairable realtime notification and a request-scoped read-only Stage 7 view.",
);
assert(
  service.includes("requestReferenceFileIds") &&
    service.includes("uniqueReferenceAttachments(unit)") &&
    service.includes("attachment.projectId === unit.projectId") &&
    service.includes("expiresInSeconds: 60 * 60 * 24 * 7") &&
    service.includes("sendResendEmail"),
  "Supplier email must use only this Production Unit's Stage 6 reference files through expiring links.",
);
assert(
  service.includes("emailStatus: ProductionDispatchStatus.PENDING") &&
    service.includes("emailStatus: ProductionDispatchStatus.FAILED") &&
    service.includes("emailStatus: ProductionDispatchStatus.SENT") &&
    service.includes("emailAttemptCount: { increment: 1 }") &&
    service.includes("return { duplicate: true }") &&
    workspace.includes("The request is saved, but the provider email was not delivered."),
  "Sample requests must persist before delivery and support audited, idempotent retry.",
);
assert(
  service.includes("export async function deleteProductionSampleRound") &&
    service.includes("Accepted or rejected sample requests cannot be deleted.") &&
    service.includes("tx.notification.deleteMany") &&
    service.includes("tx.productionSampleRound.deleteMany") &&
    service.includes("refreshProductionSupervisionStatus") &&
    service.includes('reason: "deleted"') &&
    service.includes("ProductionDispatchStatus.SENT") &&
    workspace.includes('title="Delete physical sample request?"') &&
    workspace.includes('confirmLabel="Delete Request"') &&
    workspace.includes('tone="destructive"'),
  "Managers must be able to resend or delete undecided requests with a destructive custom confirmation while decided history remains immutable.",
);
assert(
  service.includes("PhysicalSampleDecision.ACCEPTED") &&
    service.includes("PhysicalSampleDecision.REJECTED") &&
    service.includes("Enter a review note before rejecting the sample.") &&
    service.includes("undecidedRoundCount === 0") &&
    service.includes("where: { enabled: true, stageSevenSampleRoundId: round.id }") &&
    service.includes("ProductionSupervisionStatus.SIGNED_OFF") &&
    service.includes("ProductionSupervisionStatus.REVISIONS_NEEDED"),
  "Acceptance and rejection must be final, audited, round-scoped decisions, and a unit may be accepted only after every active request is resolved.",
);
assert(
  workspace.includes("ProductionSampleRoundStatus.PENDING") &&
    workspace.includes("Mark as Received") &&
    workspace.includes("actions.showReviewAction") &&
    !workspace.includes('"View Request"') &&
    sampleActions.includes("showReviewAction: reviewable") &&
    workspace.includes("Assigned recipient review") &&
    workspace.includes("only its assigned internal recipient can mark it received") &&
    workspace.includes("canReview={Boolean(selectedRound?.canReview)}") &&
    service.includes("markPhysicalSampleRoundReceived") &&
    service.includes("canReviewPhysicalSampleRound") &&
    service.includes("input.recipientUserId === input.userId") &&
    service.includes("Only the assigned internal recipient can review this sample request.") &&
    service.includes("!round.deliveredAt") &&
    service.includes("deliveredAt: { not: null }") &&
    service.includes("status: ProductionSampleRoundStatus.UNDER_REVIEW") &&
    service.includes("deliveredAt: receivedAt") &&
    service.includes("Mark the physical sample as received before accepting or rejecting it."),
  "Internal sample review must belong only to the assigned recipient, while external requests retain manager review and the same rule is enforced server-side.",
);
assert(
  service.includes("decision: null") &&
    service.includes("deadline: { lt: currentDate }") &&
    service.includes("stage7-physical-sample-overdue:${round.id}:${userId}") &&
    service.includes("skipDuplicates: true") &&
    dashboard.includes("decision: null") &&
    cronRoute.includes("CRON_SECRET") &&
    cronRoute.includes("timingSafeEqual"),
  "Pending past-deadline requests must be surfaced and centrally deduplicated.",
);
assert(
  service.includes("unit.supervision?.status !== ProductionSupervisionStatus.SIGNED_OFF") &&
    service.includes("projectClosure.create") &&
    service.includes("ProjectWorkflowStageStatus.COMPLETED") &&
    !service.includes("projectArchive.create") &&
    workspace.includes("const remainingUnits = data.units.filter") &&
    workspace.includes("const canClose = data.canManage") &&
    workspace.includes("disabled={!canClose || pending}") &&
    workspace.includes("Archiving remains a separate action."),
  "Manual project completion must stay disabled until every unit is accepted, remain server-enforced, and stay separate from archive.",
);
assert(
  workspace.includes("overflow-x-auto") &&
    workspace.includes("min-[1360px]:grid-cols-[minmax(0,1.65fr)_minmax(380px,0.95fr)]") &&
    !workspace.includes("ProjectBackButton"),
  "The responsive switcher/two-column workspace and single route-level back control must remain.",
);

console.log("Stage 7 physical-sample request UI, persistence, email, decision, and closure wiring checks passed.");

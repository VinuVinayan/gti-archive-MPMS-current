import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fileThumbnail = await readFile("src/components/projects/file-thumbnail.tsx", "utf8");

const [workspace, folderWorkspace, dashboardShell, privateFolderPage, sharedFolderPage, assetPreview, page, folderPage, actions, service, access, files, storage, uploadClient, textFile, migration, schema, overview, uploadRoute, completeRoute, deleteRoute, downloadRoute] = await Promise.all([
  readFile("src/components/projects/stage-two-workspace.tsx", "utf8"),
  readFile("src/components/projects/stage-two-folder-workspace.tsx", "utf8"),
  readFile("src/components/layout/dashboard-shell.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/workspace/private/[folderId]/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/workspace/shared/[folderId]/page.tsx", "utf8"),
  readFile("src/components/projects/asset-preview-button.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/2/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/2/folders/[folderId]/page.tsx", "utf8"),
  readFile("src/app/(dashboard)/projects/[slug]/stages/2/actions.ts", "utf8"),
  readFile("src/lib/project-research.ts", "utf8"),
  readFile("src/lib/project-research-access.ts", "utf8"),
  readFile("src/lib/project-research-files.ts", "utf8"),
  readFile("src/lib/storage/s3.ts", "utf8"),
  readFile("src/lib/project-research-upload-client.ts", "utf8"),
  readFile("src/lib/project-research-text-file.ts", "utf8"),
  readFile("prisma/migrations/20260807210000_project_research_workspaces/migration.sql", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile("src/components/projects/project-overview-workspace.tsx", "utf8"),
  readFile("src/app/api/projects/[projectId]/research/folders/[folderId]/upload-url/route.ts", "utf8"),
  readFile("src/app/api/projects/[projectId]/research/folders/[folderId]/complete/route.ts", "utf8"),
  readFile("src/app/api/projects/[projectId]/research/folders/[folderId]/files/[fileId]/route.ts", "utf8"),
  readFile("src/app/api/projects/[projectId]/research/folders/[folderId]/files/[fileId]/download/route.ts", "utf8"),
]);

assert(
  workspace.includes("gap-4 xl:flex-row xl:items-center xl:justify-between") &&
    workspace.includes("flex w-full min-w-0 items-center gap-2 sm:w-auto") &&
    workspace.includes("min-w-0 flex-1 justify-between rounded-[12px]") &&
    workspace.includes('<span className="truncate">{sortLabels[sort]}</span>'),
  "The workspace, view, and sort controls must form a responsive toolbar without stranding the sort control on its own row.",
);

for (const folderName of ["Brief", "Market & Competition", "Tech", "Vendors", "Finance", "Legal", "Pitch"]) {
  assert(service.includes(`name: "${folderName}"`), `Missing predefined Stage 2 folder: ${folderName}`);
}
for (const text of ["Shared folders", "Shared project research files and folders.", "Private Folders", "My Private Folder", "Classified", "New Folder", "Next Stage", "All Stages", "Default order", "Name (A–Z)"]) {
  assert(`${workspace}\n${page}`.includes(text), `Missing connected Stage 2 UI content: ${text}`);
}
assert(
  !workspace.includes("WorkspaceSwitch") &&
    !workspace.includes("workspaceOptions") &&
    !workspace.includes("Viewing folder set") &&
    !workspace.includes("workspace=") &&
    !page.includes("searchParams") &&
    !folderPage.includes("searchParams") &&
    !folderWorkspace.includes("workspace="),
  "Stage 2 must not expose or honor participant-workspace switching state.",
);
assert(
  service.includes("projectId_ownerUserId") &&
    service.includes("ownerUserId") &&
    service.includes("sharedWorkspace") &&
    !service.includes("requestedWorkspaceId") &&
    !service.includes("workspaceOptions") &&
    !service.includes("projectResearchWorkspace.findMany"),
  "Stage 2 landing data must resolve only the project owner's canonical shared workspace.",
);
assert(
  workspace.includes("data.myPrivateFolder.href") &&
    workspace.includes("data.classifiedFolders.map") &&
    workspace.includes('LockKeyhole className="h-8 w-8"') &&
    service.includes("projectPrivateFolder.findFirst") &&
    !service.includes("projectPrivateFolder.findMany"),
  "Stage 2 private-folder cards must expose only the current participant's folder and classified placeholders.",
);
assert(
  workspace.includes('const nextStageHref = `/projects/${data.project.id}/stages/${data.nextStage}`') &&
    workspace.includes("router.push(nextStageHref)") &&
    workspace.includes("result.nextStage") &&
    !workspace.includes('router.push(`/projects/${data.project.id}`)'),
  "Completing Stage 2 must open the next applicable stage instead of the project overview.",
);
assert(workspace.includes("createProjectResearchFolderAction") && actions.includes("createProjectResearchFolder"), "New Folder must call the persisted server action.");
assert(
  workspace.includes("deleteProjectResearchFolderAction") &&
    workspace.includes("canDelete={data.sharedWorkspace.canDeleteFolders}") &&
    workspace.includes('title="Delete folder?"') &&
    actions.includes("deleteProjectResearchFolder") &&
    files.includes("if (!access.canWrite)") &&
    files.includes("deleteAttachmentForUser(user, file.attachmentId)"),
  "Folder deletion must be confirmed, remove contained files, and require shared-workspace manager access.",
);
assert(
  service.includes("if (existingWorkspace)") &&
    service.includes("folders: {") &&
    service.includes("create: PROJECT_RESEARCH_SYSTEM_FOLDERS.map"),
  "Deleted predefined folders must not be silently recreated when an existing workspace is ensured.",
);
assert(workspace.includes("completeProjectResearchStageAction") && actions.includes("completeProjectResearchStage"), "Next Stage must call the real completion action.");
assert(
  workspace.includes('data.workflowStatus === "COMPLETED"') &&
    workspace.includes("router.push(nextStageHref)") &&
    workspace.includes("if (!result.alreadyCompleted)") &&
    service.includes("const alreadyCompleted =") &&
    service.includes("nextStage: skippedConceptStages ? 5 : 3") &&
    service.includes("reason: \"SELF_MANAGED_PROJECT\""),
  "Next Stage must navigate directly from completed Stage 2 and suppress repeated completion notifications for stale pages.",
);
assert(!workspace.includes("predefinedFolders") && !workspace.includes("setCustomFolders"), "Folder cards must not use mock/local folder state.");
assert(
  workspace.includes("<FolderArtwork colorLabel={folder.colorLabel} />") &&
    workspace.includes("<FolderArtwork action") &&
    !workspace.includes("custom={!folder.isSystem}"),
  "Persisted system and custom folders must share one folder treatment while New Folder remains distinct.",
);
assert(
  workspace.includes("compareBusinessOrder") &&
    workspace.includes("right.fileCount - left.fileCount || compareBusinessOrder(left, right)") &&
    workspace.includes("nameOrder || compareBusinessOrder(left, right)"),
  "Folder sorting must preserve business order whenever the selected sort values are tied.",
);

assert(
  workspace.includes("onDropFiles(folder, Array.from(event.dataTransfer.files))") &&
    workspace.includes("Drop to upload") &&
    workspace.includes("dragDepth.current") &&
    workspace.includes("if (!canWrite || !isFileDrag(event)) return"),
  "Writable folder cards must be stable, exact drag/drop targets while read-only cards remain inactive.",
);
assert(
  workspace.includes("Promise.allSettled") &&
    workspace.includes("fileCount: record.fileCount + uploadedCount") &&
    workspace.includes("Uploading ${upload.fileCount}"),
  "Folder-card multi-file uploads must progress independently and update the real displayed count.",
);
assert(
  workspace.includes("uploadProjectResearchFile") &&
    folderWorkspace.includes("uploadProjectResearchFile") &&
    uploadClient.includes("XMLHttpRequest") &&
    uploadClient.includes("/upload-url") &&
    uploadClient.includes("/complete"),
  "Folder overview and opened folders must share the existing upload-url/completion implementation.",
);
assert(
  folderWorkspace.includes('type="file"') &&
    folderWorkspace.includes("multiple") &&
    folderWorkspace.includes("Promise.allSettled") &&
    folderWorkspace.includes("Drop files to upload to {data.folder.name}"),
  "Opened folders must support progress-aware independent multi-file button and content-area drops.",
);
assert(
  !folderWorkspace.includes("accept=") &&
    uploadClient.includes('file.type || "application/octet-stream"'),
  "Folder upload must continue accepting arbitrary file types without a client MIME allowlist.",
);
assert(
  folderWorkspace.includes("useSyncExternalStore") &&
    folderWorkspace.includes("gti-stage-two-file-view") &&
    folderWorkspace.includes('() => "grid"') &&
    folderWorkspace.includes('view === "grid"'),
  "Opened folders must default to Grid and persist the Grid/List preference locally.",
);
assert(
  folderWorkspace.includes("<FileThumbnail") &&
    folderWorkspace.includes("/api/project-assets/${file.attachmentId}/preview") &&
    folderWorkspace.includes("visualStyles") &&
    folderWorkspace.includes("getExtension(file.name)"),
  "The gallery must show real image thumbnails and polished type-specific fallback cards.",
);
assert(
  assetPreview.includes("export function AssetImageThumbnail") &&
    fileThumbnail.includes('mimeType.startsWith("image/")') &&
    fileThumbnail.includes("src={source}") &&
    fileThumbnail.includes('loading="lazy"') &&
    assetPreview.includes('aria-label={`Preview image ${fileName}`}') &&
    assetPreview.includes("onClick={() => setOpen(true)}") &&
    assetPreview.includes("h-10 w-14 shrink-0 overflow-hidden") &&
    assetPreview.includes("<FileThumbnail") && fileThumbnail.includes("h-full w-full object-contain"),
  "The shared project preview control must provide a small, uncropped, clickable image thumbnail for document visual areas.",
);
assert(
  folderWorkspace.includes("TextFileVisual") &&
    folderWorkspace.includes("?excerpt=1") &&
    folderWorkspace.includes("This text file is empty.") &&
    !folderWorkspace.includes('text: "bg-[#f1f4f2] text-[#5a6b60]"'),
  "Text-file cards must show readable content excerpts instead of a generic TXT icon.",
);
assert(
  folderWorkspace.includes("grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))]") &&
    folderWorkspace.includes("truncate") &&
    folderWorkspace.includes("Search folders and files") &&
    ["Newest", "Oldest", "Name (A–Z)", "Name (Z–A)"].every((label) =>
      folderWorkspace.includes(label),
    ),
  "The file gallery must be responsive, truncate safely, search, and support all required sorts.",
);
assert(
  folderWorkspace.includes("data-folder-toolbar") &&
    folderWorkspace.includes("relative z-10 min-w-0 shrink-0 isolate bg-white") &&
    folderWorkspace.includes("h-full min-h-0 min-w-0 w-full") &&
    folderWorkspace.includes("data-folder-file-scroll") &&
    folderWorkspace.includes("min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto") &&
    folderWorkspace.includes("[scrollbar-gutter:stable]") &&
    dashboardShell.includes("stages\\/2\\/folders") &&
    dashboardShell.includes("workspace\\/(?:private|shared)") &&
    privateFolderPage.includes("<StageTwoFolderWorkspace") &&
    privateFolderPage.includes('context="private"') &&
    sharedFolderPage.includes("<StageTwoFolderWorkspace") &&
    sharedFolderPage.includes('context="user-shared"') &&
    folderWorkspace.includes('aria-label="Folder navigation"') &&
    !folderWorkspace.includes("bg-white/95") &&
    !folderWorkspace.includes("backdrop-blur-sm") &&
    folderWorkspace.includes("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[26px]") &&
    folderWorkspace.includes('ariaLabel="Back to Stage 2 Research Workspace"'),
  "The folder toolbar must remain outside a bounded file scroller so cards cannot move behind or overlap it.",
);
assert(
  folderWorkspace.includes("FileActionMenu") &&
    folderWorkspace.includes("Preview / Open") &&
    folderWorkspace.includes("Download") &&
    folderWorkspace.includes("{canWrite ? (") &&
    folderWorkspace.includes("Delete"),
  "Grid cards and list rows must reuse Preview, Download, and permission-gated Delete actions.",
);
assert(
  folderWorkspace.includes("AssetPreviewDialog") &&
    folderWorkspace.includes("setPreviewFile(file)") &&
    folderWorkspace.includes("onPreview={onPreview}") &&
    !folderWorkspace.includes('target="_blank"') &&
    assetPreview.includes("export function AssetPreviewDialog") &&
    assetPreview.includes('role="dialog"'),
  "Preview actions and file cards must open the shared in-app preview dialog instead of a new tab.",
);
assert(
  folderWorkspace.includes("textContentPath=") &&
    assetPreview.includes("Text document · Readable preview") &&
    assetPreview.includes("whitespace-pre-wrap break-words text-[15px] leading-7") &&
    assetPreview.includes("rounded-[18px] border border-[#dfe5df] bg-white") &&
    !assetPreview.includes("font-mono"),
  "Full text previews must use a clean document presentation rather than a code-editor treatment.",
);
assert(
  folderWorkspace.includes("ConfirmationDialog") &&
    folderWorkspace.includes('title="Delete file?"') &&
    folderWorkspace.includes('tone="destructive"') &&
    folderWorkspace.includes("setFileToDelete(file)") &&
    !folderWorkspace.includes("window.confirm"),
  "Delete must use the custom destructive confirmation dialog instead of the browser prompt.",
);
assert(
  folderWorkspace.includes("> New <") &&
    folderWorkspace.includes("Upload Files") &&
    folderWorkspace.includes("New Text File") &&
    folderWorkspace.includes("Add to folder"),
  "Writable opened folders must expose a compact New menu for uploads and text files.",
);
assert(
  folderWorkspace.includes('new window.File([input.content], input.fileName') &&
    folderWorkspace.includes('type: "text/plain"') &&
    folderWorkspace.includes("createdTextFile: true") &&
    folderWorkspace.includes("setFiles((current) => [uploadedFile as FolderFile, ...current])"),
  "New text files must reuse the real upload pipeline and appear immediately.",
);
assert(
  folderWorkspace.includes("max-h-[calc(100dvh-2rem)]") &&
    folderWorkspace.includes("min-h-0 flex-1 overflow-y-auto") &&
    folderWorkspace.includes("flex shrink-0 justify-end gap-3 border-t"),
  "The New Text File dialog must scroll only its content and keep Save/Cancel visible.",
);
assert(
  folderWorkspace.includes("normalizeProjectResearchTextFileName") &&
    folderWorkspace.includes("validateProjectResearchTextContent") &&
    folderWorkspace.includes("Plain UTF-8 text only. Line breaks are preserved.") &&
    textFile.includes('endsWith(".txt")') &&
    textFile.includes("invalidFileNameCharacters") &&
    textFile.includes("new TextEncoder().encode(value).byteLength"),
  "Text-file creation must validate safe .txt names and byte-limited multiline UTF-8 content.",
);
assert(
  folderWorkspace.includes("!data.canWrite") &&
    uploadRoute.includes("validatePreparedProjectResearchTextFile") &&
    uploadClient.includes("createdTextFile") &&
    access.includes("assertResearchFolderWriteAccess"),
  "Text-file creation must retain both UI and server-side Stage 2 write authorization.",
);
assert(
  folderWorkspace.includes("This folder is empty") &&
    folderWorkspace.includes("Drag files here or use New") &&
    folderWorkspace.includes("setFiles((current) => [uploadedFile as FolderFile, ...current])") &&
    !folderWorkspace.includes("router.refresh"),
  "Empty folders must guide upload and successful uploads must appear without a full refresh.",
);
assert(folderWorkspace.includes("/download") && folderWorkspace.includes('method: "DELETE"'), "Folder file actions must include download and delete.");
assert(
  deleteRoute.includes("export async function GET") &&
    deleteRoute.includes("getProjectResearchTextFileContent") &&
    files.includes("assertResearchFolderReadAccess") &&
    files.includes("TEXT_FILE_EXCERPT_MAX_BYTES") &&
    storage.includes("readTextObject"),
  "Text excerpts and full previews must load through an authenticated, byte-bounded server path.",
);
assert(page.includes("getProjectResearchPageData") && folderPage.includes("getProjectResearchFolderPageData") && page.includes("requireUser"), "Stage 2 routes must load authenticated persisted data.");
assert(
  [folderPage, uploadRoute, completeRoute, deleteRoute, downloadRoute].every((source) =>
    source.includes("decodeRouteParam"),
  ),
  "Encoded research folder ids must be decoded at every dynamic route boundary.",
);
assert(
  access.includes("isGlobalProjectAdministrator") &&
    access.includes("isCanonicalWorkspace") &&
    access.includes("context.workspaceOwnerUserId === context.project.ownerId") &&
    access.includes("isProjectCoOwner") &&
    access.includes("isProjectStatusCompleted(context.project.status)") &&
    access.includes("context.project.completedAt") &&
    access.includes("context.project.archivedAt") &&
    access.includes("!isProjectCompleted") &&
    service.includes("isProjectCompleted: access.isProjectCompleted") &&
    workspace.includes("This project is completed. Stage 2 research is read-only.") &&
    workspace.includes("Project completed · Read-only"),
  "Workspace access must enforce global administrator authority and canonical owner-workspace identity.",
);
assert(files.includes("assertResearchFolderWriteAccess") && files.includes("getAttachmentDownloadUrlForUser") && files.includes("deleteAttachmentForUser"), "Research files must reuse secured attachment infrastructure.");
assert(
  files.includes("projectResearchFolderFile.findUnique") &&
    files.includes("uploadedAt: file.attachment.createdAt.toISOString()") &&
    completeRoute.includes("{ success: true, file }") &&
    uploadClient.includes("return complete.file"),
  "Upload completion must return the real persisted file so the gallery can update without refreshing.",
);
assert(schema.includes("model ProjectResearchWorkspace") && schema.includes("model ProjectResearchFolder") && schema.includes("model ProjectResearchFolderFile"), "Stage 2 Prisma models are missing.");
assert(migration.includes("ON CONFLICT") && migration.includes('FROM "ProjectCollaborator"'), "Migration participant backfill must be idempotent and include ProjectCollaborator.");
assert(migration.includes("'workflow:' || project.\"id\"") && migration.includes('ON CONFLICT ("projectId", "stageKey") DO NOTHING'), "Stage 2 migration must reconcile missing fixed-workflow rows idempotently.");
assert(schema.includes("parentFolderId") && folderWorkspace.includes("data.ancestors.map") && folderWorkspace.includes("New Folder") && !migration.includes('ALTER TABLE "ProjectStage"'), "Stage 2 must support nested folders and breadcrumb navigation without changing legacy ProjectStage.");
assert(
  !schema.includes("model TextDocument") && !schema.includes("model Note"),
  "Plain-text files must not introduce a separate note or document model.",
);
assert(
  overview.includes("const stageOpenable = !locked") &&
    !overview.includes("Available · Stage UI coming next") &&
    overview.includes("Complete Stage ${stage.order - 1} to unlock Stage ${stage.order}."),
  "Overview must expose all configured stage routes only for available/completed cards and explain locked progression.",
);

console.log("Stage 2 connected UI and architecture checks passed.");

"use client";

import { FileThumbnail } from "@/components/projects/file-thumbnail";
import Link from "next/link";
import {
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  File,
  FileDown,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  List,
  Loader2,
  LockKeyhole,
  MoreVertical,
  Plus,
  Pin,
  PinOff,
  Presentation,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";

import { StageTwoImportDialog } from "@/components/projects/stage-two-import-dialog";
import { FolderColorBadge, FolderColorFilterControl, FolderColorMenu } from "@/components/projects/folder-color-label";
import { compareFolderColors, getFolderColor, matchesFolderColor, type FolderColor, type FolderColorFilter } from "@/lib/project-folder-colors-shared";
import { NewFolderDialog } from "@/components/projects/new-folder-dialog";
import { comparePinnedItems } from "@/lib/project-folder-pins-shared";
import { createProjectResearchFolderAction, deleteProjectResearchFolderAction, setProjectFolderItemPinAction, setProjectFolderItemColorAction } from "@/app/(dashboard)/projects/[slug]/stages/2/actions";
import { createProjectPrivateSubfolderAction, deleteProjectPrivateSubfolderAction } from "@/app/(dashboard)/projects/[slug]/workspace/private/actions";
import { AssetPreviewDialog } from "@/components/projects/asset-preview-button";
import { ProjectBackButton } from "@/components/projects/project-back-button";
import { ProjectAccessRealtimeGuard } from "@/components/projects/project-access-realtime-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ProjectFormAutosaveStatus,
  useProjectFormAutosave,
} from "@/components/ui/project-form-autosave";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeProjectResearchTextFileName,
  PROJECT_RESEARCH_TEXT_FILE_MAX_BYTES,
  validateProjectResearchTextContent,
} from "@/lib/project-research-text-file";
import {
  uploadProjectPrivateFile,
  uploadProjectResearchFile,
} from "@/lib/project-research-upload-client";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type FolderData = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/project-research").getProjectResearchFolderPageData>>
>;
type FolderFile = FolderData["files"][number];
type ChildFolder = FolderData["folders"][number];
type FileView = "grid" | "list";
type FileSort = "newest" | "oldest" | "name-asc" | "name-desc" | "colour";

type PendingUpload = {
  key: string;
  name: string;
  progress: number;
  status: "preparing" | "uploading" | "failed";
  error?: string;
};

const FILE_VIEW_STORAGE_KEY = "gti-stage-two-file-view";
const FILE_VIEW_CHANGE_EVENT = "gti-stage-two-file-view-change";
const sortLabels: Record<FileSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  "name-asc": "Name (A–Z)",
  "name-desc": "Name (Z–A)",
  colour: "Colour label",
};

function subscribeToFileView(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(FILE_VIEW_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(FILE_VIEW_CHANGE_EVENT, onStoreChange);
  };
}

function getStoredFileView(): FileView {
  const savedView = window.localStorage.getItem(FILE_VIEW_STORAGE_KEY);
  return savedView === "list" ? "list" : "grid";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUploadedDate(value: string, detailed = false) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    ...(detailed ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

function getExtension(name: string) {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toLocaleUpperCase("en") : "FILE";
}

function getFileKind(file: Pick<FolderFile, "name" | "mimeType">) {
  const extension = getExtension(file.name).toLocaleLowerCase("en");
  const mimeType = file.mimeType.toLocaleLowerCase("en");

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("pdf") || extension === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf"].includes(extension)) return "document";
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) return "spreadsheet";
  if (["ppt", "pptx", "odp"].includes(extension)) return "presentation";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "archive";
  if (["psd", "ai", "eps", "dwg", "dxf", "cad"].includes(extension)) return "design";
  if (mimeType.startsWith("text/") || ["md", "json", "xml"].includes(extension)) {
    return "text";
  }
  return "generic";
}

function isBrowserPreviewable(file: Pick<FolderFile, "name" | "mimeType">) {
  const kind = getFileKind(file);
  return ["image", "video", "pdf", "text"].includes(kind);
}

function FileKindIcon({ file, className }: { file: FolderFile; className?: string }) {
  const kind = getFileKind(file);
  const iconClassName = cn("h-5 w-5", className);

  if (kind === "image") return <FileImage className={iconClassName} />;
  if (kind === "video") return <FileVideo className={iconClassName} />;
  if (kind === "archive") return <FileArchive className={iconClassName} />;
  if (kind === "spreadsheet") return <FileSpreadsheet className={iconClassName} />;
  if (kind === "presentation") return <Presentation className={iconClassName} />;
  if (kind === "design") return <FileCode2 className={iconClassName} />;
  if (kind === "document" || kind === "pdf" || kind === "text") {
    return <FileText className={iconClassName} />;
  }
  return <File className={iconClassName} />;
}

function TextFileVisual({ contentPath }: { contentPath: string }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`${contentPath}?excerpt=1`, { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as {
          content?: string;
          error?: string;
        };
        if (!response.ok || typeof result.content !== "string") {
          throw new Error(result.error || "Preview unavailable.");
        }
        setContent(result.content);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [contentPath]);

  return (
    <span className="relative block h-full w-full overflow-hidden bg-[#eef2ed] px-3 py-3">
      <span className="block h-full overflow-hidden rounded-[8px] border border-[#dfe5df] bg-white px-3 py-3 shadow-[0_5px_14px_rgba(31,51,38,0.08)]">
        <span className="mb-2 block h-1 w-10 rounded-full bg-[#dce9df]" />
        {loading ? (
          <span className="block space-y-1.5" aria-label="Loading text preview">
            {["w-full", "w-[92%]", "w-[96%]", "w-[78%]", "w-[88%]"].map(
              (width, index) => (
                <span
                  key={`${width}-${index}`}
                  className={cn("block h-1.5 animate-pulse rounded-full bg-[#e7ece8]", width)}
                />
              ),
            )}
          </span>
        ) : failed ? (
          <span className="block pt-6 text-center text-[10px] font-[650] text-[#869188]">
            Text preview unavailable
          </span>
        ) : (
          <span className="block max-h-[92px] overflow-hidden whitespace-pre-wrap break-words text-[10px] leading-[15px] text-[#4b574f]">
            {content || "This text file is empty."}
          </span>
        )}
      </span>
      <span className="pointer-events-none absolute inset-x-3 bottom-3 h-9 bg-gradient-to-t from-white to-transparent" />
    </span>
  );
}

function FileVisual({
  file,
  textContentPath,
}: {
  file: FolderFile;
  textContentPath?: string;
}) {
  const kind = getFileKind(file);
  const previewHref = `/api/project-assets/${file.attachmentId}/preview`;

  if (kind === "image") {
    return (
      <FileThumbnail
        fileName={file.name}
        mimeType={file.mimeType}
        previewPath={previewHref}
        className="h-full w-full rounded-none border-0 bg-[#edf2ee]"
        imageClassName="object-cover transition duration-300 group-hover:scale-[1.02]"
        fallback={<FileKindIcon file={file} className="h-12 w-12" />}
      />
    );
  }

  if (kind === "text" && textContentPath) {
    return <TextFileVisual contentPath={textContentPath} />;
  }

  const visualStyles: Record<string, string> = {
    video: "bg-[#eef2f8] text-[#4d6486]",
    pdf: "bg-[#fff0ef] text-[#b84e48]",
    document: "bg-[#edf3fb] text-[#426ea7]",
    spreadsheet: "bg-[#ebf6ef] text-[#2d7d51]",
    presentation: "bg-[#fff3e9] text-[#b66c32]",
    archive: "bg-[#f4effa] text-[#7758a2]",
    design: "bg-[#f0eff9] text-[#5e589c]",
    generic: "bg-[#f1f4f2] text-[#66736a]",
  };

  return (
    <span className={cn("flex h-full w-full flex-col items-center justify-center", visualStyles[kind])}>
      <FileKindIcon file={file} className="h-12 w-12" />
      <span className="mt-3 rounded-full bg-white/70 px-3 py-1 text-[10px] font-[780] tracking-[0.08em]">
        {getExtension(file.name)}
      </span>
    </span>
  );
}

function FileActionMenu({
  file,
  baseApi,
  canWrite,
  deleting,
  onPreview,
  onDelete,
  onPin,
  pinPending,
  onColor,
  colorPending,
}: {
  file: FolderFile;
  baseApi: string;
  canWrite: boolean;
  deleting: boolean;
  onPreview: () => void;
  onDelete: () => void;
  onPin: () => void;
  pinPending: boolean;
  onColor: (color: FolderColor | null) => void;
  colorPending: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-[9px]"
          aria-label={`Actions for ${file.name}`}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[190px]">
        {isBrowserPreviewable(file) ? (
          <DropdownMenuItem onSelect={onPreview}>
            <Eye className="h-4 w-4" /> Preview / Open
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href={`${baseApi}/files/${file.id}/download`}>
            <Download className="h-4 w-4" /> Download
          </a>
        </DropdownMenuItem>
        {canWrite ? <FolderColorMenu value={file.colorLabel} pending={colorPending || deleting} onChange={onColor} /> : null}
        {canWrite ? (
          <DropdownMenuItem disabled={pinPending || deleting} onSelect={onPin}>
            {pinPending ? <Loader2 className="size-4 animate-spin" /> : file.pinnedAt ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {file.pinnedAt ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
        ) : null}
        {canWrite ? (
          <DropdownMenuItem
            disabled={deleting}
            onSelect={onDelete}
            className="text-[#a64b45] focus:text-[#a64b45]"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FileGalleryCard({
  file,
  baseApi,
  canWrite,
  deleting,
  onPreview,
  onDelete,
  onPin,
  pinPending,
  onColor,
  colorPending,
}: {
  file: FolderFile;
  baseApi: string;
  canWrite: boolean;
  deleting: boolean;
  onPreview: () => void;
  onDelete: () => void;
  onPin: () => void;
  pinPending: boolean;
  onColor: (color: FolderColor | null) => void;
  colorPending: boolean;
}) {
  const previewable = isBrowserPreviewable(file);
  const textContentPath = `${baseApi}/files/${file.id}`;
  const openHref = previewable
    ? `/api/project-assets/${file.attachmentId}/preview`
    : `${baseApi}/files/${file.id}/download`;

  return (
    <article className="group min-w-0 overflow-hidden rounded-[18px] border border-[#dfe6df] bg-white shadow-[0_9px_24px_rgba(23,39,28,0.045)] transition hover:-translate-y-0.5 hover:border-[#bcd4c3] hover:shadow-[0_16px_34px_rgba(28,75,48,0.09)]">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[#edf5ef] text-[#397655]">
          <FileKindIcon file={file} className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] font-[700] text-[#273129]" title={file.name}>
          {file.name}
        </p>
        {file.pinnedAt ? <Pin className="size-3.5 shrink-0 text-[#24764e]" aria-label="Pinned" /> : null}
        <FileActionMenu
          file={file}
          baseApi={baseApi}
          canWrite={canWrite}
          deleting={deleting}
          onPreview={onPreview}
          onDelete={onDelete}
          onPin={onPin}
          pinPending={pinPending}
          onColor={onColor}
          colorPending={colorPending}
        />
      </div>
      {previewable ? (
        <button
          type="button"
          onClick={onPreview}
          className="block h-[148px] w-full border-y border-[#edf1ed] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          aria-label={`Preview ${file.name}`}
        >
          <FileVisual file={file} textContentPath={textContentPath} />
        </button>
      ) : (
        <a
          href={openHref}
          className="block h-[148px] border-y border-[#edf1ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          aria-label={`Download ${file.name}`}
        >
          <FileVisual file={file} textContentPath={textContentPath} />
        </a>
      )}
      <div className="min-w-0 px-3 py-3">
        <FolderColorBadge value={file.colorLabel} className="mb-1.5" />
        <p className="min-w-0 whitespace-normal break-words text-[11px] text-[#657169]" title={file.uploadedBy}>
          Uploaded by {file.uploadedBy}
        </p>
        <p className="mt-1 text-[10px] text-[#8a948d]">
          Uploaded {formatUploadedDate(file.uploadedAt)} · {formatBytes(file.size)}
        </p>
      </div>
    </article>
  );
}

function NewTextFileDialog({
  projectId,
  folderId,
  pending,
  progress,
  submitError,
  onSave,
  onClose,
}: {
  projectId: string;
  folderId: string;
  pending: boolean;
  progress: number;
  submitError?: string;
  onSave: (
    input: { fileName: string; content: string },
    clearDraft: () => Promise<void>,
  ) => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [fileNameError, setFileNameError] = useState<string>();
  const [contentError, setContentError] = useState<string>();
  const autosave = useProjectFormAutosave({
    projectId,
    formKey: `stage-two-text-file:${folderId}`,
    value: { fileName, content },
    onRestore: (draft) => {
      setFileName(draft.fileName);
      setContent(draft.content);
    },
  });
  const closeWithAutosave = () => {
    void autosave.flush().finally(onClose);
  };

  function save() {
    const normalizedName = normalizeProjectResearchTextFileName(fileName);
    const validatedContent = validateProjectResearchTextContent(content);
    setFileNameError("error" in normalizedName ? normalizedName.error : undefined);
    setContentError("error" in validatedContent ? validatedContent.error : undefined);

    if ("error" in normalizedName || "error" in validatedContent) return;
    onSave({ fileName: normalizedName.fileName, content }, autosave.clearDraft);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[#112118]/45 px-4 py-4 backdrop-blur-[2px] sm:items-center sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-text-file-title"
    >
      <Card className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)] sm:max-h-[90dvh]">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-[#eaf4ec] text-[#2e754f]">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <h2
                id="new-text-file-title"
                className="text-[22px] font-[760] tracking-[-0.03em] text-[#162019]"
              >
                New Text File
              </h2>
              <p className="mt-1 text-[12px] text-[#738078]">
                Create a simple plain-text file in this folder.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <label className="block space-y-2">
              <span className="text-[12px] font-[700] text-[#2d372f]">File Name</span>
              <Input
                autoFocus
                value={fileName}
                onChange={(event) => {
                  setFileName(event.target.value);
                  setFileNameError(undefined);
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") save();
                }}
                placeholder="e.g., Market research notes"
                maxLength={180}
                aria-invalid={Boolean(fileNameError)}
                className={cn("h-11 rounded-[12px]", fileNameError && "border-[#c85c54]")}
              />
              <p className={cn("text-[11px]", fileNameError ? "text-[#b84e48]" : "text-[#7b867e]") }>
                {fileNameError ?? "The .txt extension is added automatically."}
              </p>
            </label>

            <label className="block space-y-2">
              <span className="text-[12px] font-[700] text-[#2d372f]">Content</span>
              <Textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setContentError(undefined);
                }}
                placeholder="Type or paste plain text here..."
                maxLength={PROJECT_RESEARCH_TEXT_FILE_MAX_BYTES}
                aria-invalid={Boolean(contentError)}
                className={cn(
                  "min-h-[280px] resize-y rounded-[16px] border-[#dce3dc] font-mono text-[13px] leading-6",
                  contentError && "border-[#c85c54]",
                )}
              />
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className={contentError ? "text-[#b84e48]" : "text-[#7b867e]"}>
                  {contentError ?? "Plain UTF-8 text only. Line breaks are preserved."}
                </span>
                <span className="shrink-0 text-[#8a948d]">Maximum 1 MB</span>
              </div>
            </label>
          </div>

          {submitError ? (
            <div className="mt-5 rounded-[14px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[12px] text-[#bb4d49]">
              {submitError}
            </div>
          ) : null}

          {pending ? (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#657169]">
                <span>Saving text file...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#e4eae5]">
                <div
                  className="h-full rounded-full bg-[#2b8056] transition-all"
                  style={{ width: `${Math.max(5, progress)}%` }}
                />
              </div>
            </div>
          ) : null}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-[#e3e9e4] bg-white px-6 py-4 shadow-[0_-10px_24px_rgba(20,36,25,0.045)] sm:items-center sm:px-7">
            <Button type="button" variant="secondary" onClick={closeWithAutosave} disabled={pending}>
              Cancel
            </Button>
            <ProjectFormAutosaveStatus status={autosave.status} savedAt={autosave.savedAt} restoredAt={autosave.restoredAt} onRetry={() => void autosave.retry()} className="mr-auto" />
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}

export function StageTwoFolderWorkspace({
  data,
  currentUserId,
  context = "research",
}: {
  data: FolderData;
  currentUserId: string;
  context?: "research" | "user-shared" | "private";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const view = useSyncExternalStore(
    subscribeToFileView,
    getStoredFileView,
    () => "grid",
  );
  const [sort, setSort] = useState<FileSort>("newest");
  const [colorFilter, setColorFilter] = useState<FolderColorFilter>("ALL");
  const [currentFolderColor, setCurrentFolderColor] = useState(data.folder.colorLabel);
  const [colorPendingIds, setColorPendingIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FolderFile[]>(data.files);
  const [folders, setFolders] = useState(data.folders);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderPending, setFolderPending] = useState(false);
  const [pinPendingIds, setPinPendingIds] = useState<Set<string>>(new Set());
  const [folderError, setFolderError] = useState<string>();
  const [folderToDelete, setFolderToDelete] = useState<FolderData["folders"][number]>();
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [deletingId, setDeletingId] = useState<string>();
  const [previewFile, setPreviewFile] = useState<FolderFile>();
  const [fileToDelete, setFileToDelete] = useState<FolderFile>();
  const [deleteError, setDeleteError] = useState<string>();
  const [textFileDialogOpen, setTextFileDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [textFilePending, setTextFilePending] = useState(false);
  const [textFileProgress, setTextFileProgress] = useState(0);
  const [textFileError, setTextFileError] = useState<string>();
  const isPrivateFolder = context === "private";
  const baseApi = isPrivateFolder
    ? `/api/projects/${data.project.id}/private-folders/${data.folder.id}`
    : `/api/projects/${data.project.id}/research/folders/${data.folder.id}`;
  const uploadFolderFile = isPrivateFolder
    ? uploadProjectPrivateFile
    : uploadProjectResearchFile;
  const projectWorkspaceHref = `/projects/${data.project.id}`;
  const folderHref = (id: string) => context === "research"
    ? `/projects/${data.project.id}/stages/2/folders/${id}`
    : `/projects/${data.project.id}/workspace/${isPrivateFolder ? "private" : "shared"}/${id}`;
  const visibleFolders = useMemo(() => folders.filter((folder) => matchesFolderColor(folder.colorLabel, colorFilter) && folder.name.toLocaleLowerCase("en").includes(query.trim().toLocaleLowerCase("en"))).sort((left, right) => {
    if (sort === "colour") return compareFolderColors(left, right) || left.name.localeCompare(right.name);
    if (sort === "name-asc") return left.name.localeCompare(right.name);
    if (sort === "name-desc") return right.name.localeCompare(left.name);
    const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return sort === "oldest" ? difference : -difference;
  }), [folders, query, sort, colorFilter]);

  async function colorItem(kind: "folder" | "file", item: { id: string }, colorLabel: FolderColor | null) {
    const key = `${kind}:${item.id}`;
    if (!data.canWrite || colorPendingIds.has(key)) return;
    setColorPendingIds((current) => new Set(current).add(key));
    try {
      const result = await setProjectFolderItemColorAction({
        projectId: data.project.id, context: isPrivateFolder ? "private" : "research", kind,
        folderId: kind === "folder" ? item.id : data.folder.id,
        fileId: kind === "file" ? item.id : undefined, colorLabel,
      });
      if ("error" in result) { showErrorToast(result.error); return; }
      if (kind === "folder" && item.id === data.folder.id) setCurrentFolderColor(result.colorLabel);
      else if (kind === "folder") setFolders((current) => current.map((folder) => folder.id === item.id ? { ...folder, colorLabel: result.colorLabel } : folder));
      else setFiles((current) => current.map((file) => file.id === item.id ? { ...file, colorLabel: result.colorLabel } : file));
      showSuccessToast(result.colorLabel ? "Colour label updated." : "Colour label removed.");
    } catch { showErrorToast("Unable to update this colour label. Please try again."); }
    finally { setColorPendingIds((current) => { const next = new Set(current); next.delete(key); return next; }); }
  }

  async function pinItem(kind: "folder" | "file", item: ChildFolder | FolderFile) {
    const key = `${kind}:${item.id}`;
    if (!data.canWrite || pinPendingIds.has(key)) return;
    setPinPendingIds((current) => new Set(current).add(key));
    try {
      const result = await setProjectFolderItemPinAction({
        projectId: data.project.id, context: isPrivateFolder ? "private" : "research", kind,
        folderId: kind === "folder" ? item.id : data.folder.id,
        fileId: kind === "file" ? item.id : undefined, pinned: !item.pinnedAt,
      });
      if ("error" in result) { showErrorToast(result.error); return; }
      if (kind === "folder") setFolders((current) => current.map((folder) => folder.id === item.id ? { ...folder, pinnedAt: result.pinnedAt } : folder));
      else setFiles((current) => current.map((file) => file.id === item.id ? { ...file, pinnedAt: result.pinnedAt } : file));
      showSuccessToast(result.pinnedAt ? "Pinned to top." : "Item unpinned.");
    } catch { showErrorToast("Unable to update this pin. Please try again."); }
    finally { setPinPendingIds((current) => { const next = new Set(current); next.delete(key); return next; }); }
  }

  async function createFolder(name: string) {
    if (!data.canWrite || folderPending) return;
    setFolderPending(true);
    setFolderError(undefined);
    try {
      const input = { projectId: data.project.id, parentFolderId: data.folder.id, name };
      const result = await (isPrivateFolder ? createProjectPrivateSubfolderAction(input) : createProjectResearchFolderAction(input));
      if ("error" in result) { setFolderError(result.error); return; }
      setFolders((current) => [...current, { ...result.folder, fileCount: 0, folderCount: 0, pinnedAt: null, colorLabel: null, createdAt: new Date().toISOString() }]);
      setFolderDialogOpen(false);
      setColorFilter("ALL");
      setQuery("");
      showSuccessToast("Folder created.");
    } catch { setFolderError("Unable to create folder. Please try again."); }
    finally { setFolderPending(false); }
  }

  async function deleteFolder() {
    if (!folderToDelete || !data.canWrite || folderPending) return;
    setFolderPending(true);
    setFolderError(undefined);
    try {
      const input = { projectId: data.project.id, folderId: folderToDelete.id };
      const result = await (isPrivateFolder ? deleteProjectPrivateSubfolderAction(input) : deleteProjectResearchFolderAction(input));
      if ("error" in result) { setFolderError(result.error); return; }
      setFolders((current) => current.filter((folder) => folder.id !== input.folderId));
      setFolderToDelete(undefined);
      showSuccessToast("Folder deleted.");
    } catch { setFolderError("Unable to delete folder. Please try again."); }
    finally { setFolderPending(false); }
  }

  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    const next = files.filter((file) =>
      matchesFolderColor(file.colorLabel, colorFilter) && (!normalizedQuery || file.name.toLocaleLowerCase("en").includes(normalizedQuery)),
    );

    return next.sort((left, right) => {
      if (sort === "colour") return compareFolderColors(left, right) || left.name.localeCompare(right.name);
      if (sort === "name-asc") return left.name.localeCompare(right.name);
      if (sort === "name-desc") return right.name.localeCompare(left.name);
      const dateDifference = new Date(left.uploadedAt).getTime() - new Date(right.uploadedAt).getTime();
      return sort === "oldest" ? dateDifference : -dateDifference;
    });
  }, [files, query, sort, colorFilter]);

  function updateUpload(key: string, patch: Partial<PendingUpload>) {
    setUploads((current) =>
      current.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)),
    );
  }

  async function uploadFiles(fileList: FileList | File[]) {
    if (!data.canUpload) return;
    const selectedFiles = Array.from(fileList);
    if (selectedFiles.length === 0) return;

    const pending = selectedFiles.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: "preparing" as const,
    }));
    setUploads((current) => [...pending, ...current]);

    const results = await Promise.allSettled(
      selectedFiles.map(async (file, index) => {
        const key = pending[index].key;
        updateUpload(key, { status: "uploading", progress: 0 });
        try {
          const uploadedFile = await uploadFolderFile({
            projectId: data.project.id,
            folderId: data.folder.id,
            file,
            onProgress: (progress) => updateUpload(key, { progress }),
          });
          setFiles((current) => [uploadedFile as FolderFile, ...current]);
          return uploadedFile;
        } catch (error) {
          updateUpload(key, {
            status: "failed",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
          throw error;
        }
      }),
    );
    const uploadedCount = results.filter((result) => result.status === "fulfilled").length;
    const failedCount = results.length - uploadedCount;

    const failedUploadKeys = new Set(
      results.flatMap((result, index) =>
        result.status === "rejected" ? [pending[index].key] : [],
      ),
    );
    setUploads((current) =>
      current.filter((upload) => failedUploadKeys.has(upload.key)),
    );
    if (uploadedCount > 0) {
      setQuery("");
      setColorFilter("ALL");
      showSuccessToast(`${uploadedCount} ${uploadedCount === 1 ? "file" : "files"} uploaded.`);
    }
    if (failedCount > 0) {
      showErrorToast(`${failedCount} ${failedCount === 1 ? "file could" : "files could"} not be uploaded.`);
    }
  }

  async function deleteFile(file: FolderFile) {
    setDeletingId(file.id);
    setDeleteError(undefined);
    try {
      const response = await fetch(`${baseApi}/files/${file.id}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to delete file.");
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setFileToDelete(undefined);
      showSuccessToast("File deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete file.";
      setDeleteError(message);
      showErrorToast(message);
    } finally {
      setDeletingId(undefined);
    }
  }

  async function createTextFile(
    input: { fileName: string; content: string },
    clearDraft: () => Promise<void>,
  ) {
    if (!data.canWrite) return;
    setTextFilePending(true);
    setTextFileProgress(0);
    setTextFileError(undefined);

    try {
      const textFile = new window.File([input.content], input.fileName, {
        type: "text/plain",
      });
      const uploadedFile = await uploadFolderFile({
        projectId: data.project.id,
        folderId: data.folder.id,
        file: textFile,
        createdTextFile: true,
        onProgress: setTextFileProgress,
      });
      setFiles((current) => [uploadedFile as FolderFile, ...current]);
      await clearDraft().catch(() => undefined);
      setTextFileDialogOpen(false);
      showSuccessToast("Text file created.", `${uploadedFile.name} was saved to this folder.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create text file.";
      setTextFileError(message);
      showErrorToast(message);
    } finally {
      setTextFilePending(false);
    }
  }

  function isFileDrag(event: DragEvent<HTMLElement>) {
    return event.dataTransfer.types.includes("Files");
  }

  function changeView(nextView: FileView) {
    window.localStorage.setItem(FILE_VIEW_STORAGE_KEY, nextView);
    window.dispatchEvent(new Event(FILE_VIEW_CHANGE_EVENT));
  }

  const unpinnedFolders = visibleFolders.filter((folder) => !folder.pinnedAt);
  const unpinnedFiles = visibleFiles.filter((file) => !file.pinnedAt);
  const pinnedItems = [
    ...visibleFolders.filter((folder) => folder.pinnedAt).map((item) => ({ kind: "folder" as const, item })),
    ...visibleFiles.filter((file) => file.pinnedAt).map((item) => ({ kind: "file" as const, item })),
  ].sort((left, right) => (sort === "colour" ? compareFolderColors(left.item, right.item) : 0) || comparePinnedItems(left.item, right.item) || left.item.id.localeCompare(right.item.id));

  function renderFolder(folder: ChildFolder) {
    return (
      <div key={folder.id} className="relative flex self-start items-center rounded-[16px] border border-[#dfe6df] bg-white shadow-sm">
        <Link href={folderHref(folder.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[16px] p-4 hover:bg-[#f1f7f2]">
          <span className="relative shrink-0"><FolderOpen className="size-9 text-[#397655]" style={{ color: getFolderColor(folder.colorLabel)?.hex }} />{folder.pinnedAt ? <Pin className="absolute -bottom-1 -right-1 size-3.5 rounded bg-white text-[#24764e]" aria-label="Pinned" /> : null}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-[700] text-[#263129]" title={folder.name}>{folder.name}</span>
            <FolderColorBadge value={folder.colorLabel} className="mt-1" />
            <span className="mt-1 block text-[11px] text-[#758078]">{folder.folderCount} {folder.folderCount === 1 ? "folder" : "folders"} · {folder.fileCount} {folder.fileCount === 1 ? "file" : "files"}</span>
          </span>
        </Link>
        {data.canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="mr-2 shrink-0" aria-label={`Actions for folder ${folder.name}`}><MoreVertical className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <FolderColorMenu value={folder.colorLabel} pending={colorPendingIds.has(`folder:${folder.id}`)} onChange={(color) => void colorItem("folder", folder, color)} />
              <DropdownMenuItem disabled={pinPendingIds.has(`folder:${folder.id}`)} onSelect={() => void pinItem("folder", folder)}>
                {folder.pinnedAt ? <PinOff className="size-4" /> : <Pin className="size-4" />}{folder.pinnedAt ? "Unpin" : "Pin to top"}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[#ad514b] focus:text-[#ad514b]" onSelect={() => { setFolderError(undefined); setFolderToDelete(folder); }}>
                <Trash2 className="size-4" />Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  function renderFile(file: FolderFile) {
    return view === "grid" ? (
      <FileGalleryCard
        key={file.id}
        file={file}
        onPin={() => void pinItem("file", file)}
        pinPending={pinPendingIds.has(`file:${file.id}`)}
        onColor={(color) => void colorItem("file", file, color)}
        colorPending={colorPendingIds.has(`file:${file.id}`)}
        baseApi={baseApi}
        canWrite={data.canWrite}
        deleting={deletingId === file.id}
        onPreview={() => setPreviewFile(file)}
        onDelete={() => {
          setDeleteError(undefined);
          setFileToDelete(file);
        }}
      />
    ) : (
      <div key={file.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] items-center gap-3 border-b border-[#edf1ee] px-4 py-3.5 last:border-0 md:grid-cols-[minmax(0,1fr)_120px_160px_110px_52px] md:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <FileThumbnail fileName={file.name} mimeType={file.mimeType} previewPath={`/api/project-assets/${file.attachmentId}/preview`} className="size-9 rounded-[10px]" fallback={<FileKindIcon file={file} />} />
          {file.pinnedAt ? <Pin className="size-3.5 shrink-0 text-[#24764e]" aria-label="Pinned" /> : null}
          <div className="min-w-0">
            {isBrowserPreviewable(file) ? (
              <button
                type="button"
                onClick={() => setPreviewFile(file)}
                className="block max-w-full truncate text-left text-[13px] font-[680] text-[#253028] hover:text-brand hover:underline"
                title={file.name}
              >
                {file.name}
              </button>
            ) : (
              <a
                href={`${baseApi}/files/${file.id}/download`}
                className="block truncate text-[13px] font-[680] text-[#253028] hover:text-brand hover:underline"
                title={file.name}
              >
                {file.name}
              </a>
            )}
            <FolderColorBadge value={file.colorLabel} className="mt-1" />
            <p className="min-w-0 whitespace-normal break-words text-[10px] text-[#879188] md:hidden">Uploaded by {file.uploadedBy} · {formatBytes(file.size)}</p>
          </div>
        </div>
        <span className="hidden text-[11px] text-[#6f7b72] md:block">{getExtension(file.name)}</span>
        <span className="hidden text-[11px] leading-4 text-[#6f7b72] md:block">{formatUploadedDate(file.uploadedAt, true)}<span className="block min-w-0 whitespace-normal break-words text-[10px] text-[#8b958e]" title={file.uploadedBy}>Uploaded by {file.uploadedBy}</span></span>
        <span className="hidden text-[11px] text-[#6f7b72] md:block">{formatBytes(file.size)}</span>
        <FileActionMenu
          onPin={() => void pinItem("file", file)}
          pinPending={pinPendingIds.has(`file:${file.id}`)}
          onColor={(color) => void colorItem("file", file, color)}
          colorPending={colorPendingIds.has(`file:${file.id}`)}
          file={file}
          baseApi={baseApi}
          canWrite={data.canWrite}
          deleting={deletingId === file.id}
          onPreview={() => setPreviewFile(file)}
          onDelete={() => {
            setDeleteError(undefined);
            setFileToDelete(file);
          }}
        />
      </div>
    );
  }


  return (
    <section className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-[1420px] overflow-hidden">
      <ProjectAccessRealtimeGuard projectId={data.project.id} currentUserId={currentUserId} />
      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[26px] border-[#dfe6df] shadow-[0_20px_54px_rgba(23,39,28,0.055)]">
        <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-0">
          <div
            data-folder-toolbar
            className="relative z-10 min-w-0 shrink-0 isolate bg-white shadow-[0_10px_24px_rgba(23,39,28,0.06)]"
          >
            <nav
              aria-label="Folder navigation"
              className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[#e6ece7] bg-white px-5 py-3 sm:px-8"
            >
              {context === "research" ? (
                <ProjectBackButton
                  href={`/projects/${data.project.id}/stages/2`}
                  label="Research workspace"
                  ariaLabel="Back to Stage 2 Research Workspace"
                />
              ) : (
                <ProjectBackButton
                  href={projectWorkspaceHref}
                  label="Workspace"
                  ariaLabel="Back to project workspace"
                />
              )}
              {data.ancestors.map((ancestor) => <span key={ancestor.id} className="contents">
                <span className="text-[#a0aaa2]">/</span>
                <Link href={folderHref(ancestor.id)} title={ancestor.name} className="max-w-[180px] truncate text-[12px] font-[650] text-[#2d7952] hover:underline">{ancestor.name}</Link>
              </span>)}
              <span className="text-[#a0aaa2]">/</span>
              <span aria-current="page" className="max-w-[220px] truncate text-[12px] font-[700] text-[#536158]">
                {data.folder.name}
              </span>
            </nav>
            <header className="border-b border-[#e6ece7] bg-white px-5 py-5 sm:px-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-[#e7f3ea] text-[#2d7952]">
                    <FolderOpen className="h-5 w-5" style={{ color: getFolderColor(currentFolderColor)?.hex }} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="truncate text-[26px] font-[780] tracking-[-0.04em] text-[#151c17] sm:text-[30px]">
                      {data.folder.name}
                    </h1>
                    <FolderColorBadge value={currentFolderColor} className="mt-1" />
                    <p className="mt-0.5 text-[11px] text-[#77827a]">
                      {context === "private"
                        ? `Only you can access this folder · ${files.length} ${files.length === 1 ? "file" : "files"}`
                        : context === "user-shared"
                          ? `Shared project reference · ${files.length} ${files.length === 1 ? "file" : "files"}`
                          : `Shared project research · ${files.length} ${files.length === 1 ? "file" : "files"}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {data.canWrite ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button type="button" variant="secondary" size="icon" aria-label={`Actions for folder ${data.folder.name}`}><MoreVertical className="size-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end"><FolderColorMenu value={currentFolderColor} pending={colorPendingIds.has(`folder:${data.folder.id}`)} onChange={(color) => void colorItem("folder", data.folder, color)} /></DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  {data.canWrite && !isPrivateFolder ? (
                    <Button type="button" variant="secondary" onClick={() => setImportOpen(true)} className="h-10 rounded-[11px]">
                      <FileDown className="h-4 w-4" /> Import
                    </Button>
                  ) : null}
                  {!data.canUpload ? (
                    <span className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-[#e9eeea] px-3 text-[11px] font-[700] text-[#627067]">
                      <LockKeyhole className="h-3.5 w-3.5" />
                      {context === "user-shared"
                        ? "Read-only folder"
                        : "Read-only workspace"}
                    </span>
                  ) : !data.canWrite ? (
                    <Button type="button" className="h-10 rounded-[11px]" onClick={() => inputRef.current?.click()}>
                      <Upload className="h-4 w-4" /> Upload Files
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" className="h-10 rounded-[11px]">
                          <Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[200px]">
                        <DropdownMenuLabel>Add to folder</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => { setFolderError(undefined); setFolderDialogOpen(true); }}>
                          <FolderPlus className="h-4 w-4" /> New Folder
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
                          <Upload className="h-4 w-4" /> Upload Files
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setTextFileError(undefined);
                            setTextFileDialogOpen(true);
                          }}
                        >
                          <FileText className="h-4 w-4" /> New Text File
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <div className="inline-flex rounded-[11px] border border-[#dce3dc] bg-white p-1">
                    {(["grid", "list"] as FileView[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-label={`${option} view`}
                        aria-pressed={view === option}
                        onClick={() => changeView(option)}
                        className={cn(
                          "grid size-8 place-items-center rounded-[8px]",
                          view === option ? "bg-[#24764e] text-white" : "text-[#68736b] hover:bg-[#f1f5f2]",
                        )}
                      >
                        {option === "grid" ? <Grid2X2 className="h-4 w-4" /> : <List className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="secondary" className="h-10 min-w-[145px] justify-between rounded-[11px] shadow-none">
                        <SlidersHorizontal className="h-4 w-4" /> {sortLabels[sort]} <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Sort files</DropdownMenuLabel>
                      {(Object.keys(sortLabels) as FileSort[]).map((option) => (
                        <DropdownMenuItem key={option} onSelect={() => setSort(option)}>
                          <span className="flex-1">{sortLabels[option]}</span>
                          {sort === option ? <Check className="h-4 w-4 text-brand" /> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </header>

            <input
              ref={inputRef}
              type="file"
              multiple
              disabled={!data.canUpload}
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void uploadFiles(event.target.files);
                event.target.value = "";
              }}
            />

            <div className="flex flex-wrap items-center gap-3 border-b border-[#e9eee9] bg-[#fbfcfb] px-5 py-3 sm:px-8">
              <div className="relative min-w-[180px] max-w-[420px] flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829087]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search folders and files..."
                  aria-label="Search folders and files"
                  className="h-10 rounded-[11px] border-[#dce3dc] bg-white pl-10 shadow-none"
                />
              </div>
              <FolderColorFilterControl value={colorFilter} onChange={setColorFilter} />
            </div>
          </div>

          <div
            data-folder-file-scroll
            className="dashboard-scroll-thin relative min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-[#fbfcfb] px-5 py-6 [scrollbar-gutter:stable] sm:px-8"
            onDragEnter={(event) => {
              if (!isFileDrag(event)) return;
              event.preventDefault();
              dragDepth.current += 1;
              if (data.canUpload) setDragging(true);
            }}
            onDragOver={(event) => {
              if (!isFileDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = data.canUpload ? "copy" : "none";
            }}
            onDragLeave={(event) => {
              if (!isFileDrag(event)) return;
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              if (!isFileDrag(event)) return;
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (data.canUpload) void uploadFiles(event.dataTransfer.files);
            }}
          >
            {dragging && data.canUpload ? (
              <div className="absolute inset-3 z-30 flex flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-[#2b8056] bg-[#eaf5ed]/95 text-center text-[#216643] shadow-[0_18px_44px_rgba(25,103,67,0.12)]">
                <UploadCloud className="h-10 w-10" />
                <p className="mt-3 text-[17px] font-[760]">Drop files to upload to {data.folder.name}</p>
                <p className="mt-1 text-[12px] text-[#5c7968]">Multiple files are supported.</p>
              </div>
            ) : null}

            {uploads.length > 0 ? (
              <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {uploads.map((upload) => (
                  <div key={upload.key} className="rounded-[13px] border border-[#e2e8e3] bg-white px-3.5 py-3 shadow-sm">
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="min-w-0 flex-1 truncate font-[680] text-[#29332c]">{upload.name}</span>
                      <span className={upload.status === "failed" ? "text-[#b84e48]" : "text-[#5f6d63]"}>
                        {upload.status === "uploading" ? `${upload.progress}%` : upload.status}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4eae5]">
                      <div
                        className={cn("h-full rounded-full transition-all", upload.status === "failed" ? "bg-[#bd5b53]" : "bg-[#2b8056]")}
                        style={{ width: `${upload.status === "preparing" ? 5 : upload.progress}%` }}
                      />
                    </div>
                    {upload.error ? <p className="mt-1 text-[10px] text-[#b84e48]">{upload.error}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {pinnedItems.length > 0 ? (
              <section aria-label="Pinned items" className="mb-6">
                <h2 className="mb-3 flex items-center gap-2 text-[12px] font-[750] uppercase tracking-wide text-[#24764e]"><Pin className="size-4" /> Pinned <span className="text-[#758078]">({pinnedItems.length})</span></h2>
                <div className={cn(view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] items-start gap-4" : "overflow-hidden rounded-[18px] border border-[#e0e6e1] bg-white")}>
                  {pinnedItems.map((entry) => entry.kind === "folder" ? renderFolder(entry.item) : renderFile(entry.item))}
                </div>
              </section>
            ) : null}

            {unpinnedFolders.length > 0 ? (
              <section aria-label="Subfolders" className="mb-6">
                <h2 className="mb-3 text-[12px] font-[750] uppercase tracking-wide text-[#758078]">Folders</h2>
                <div className={cn(view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-4" : "space-y-2")}>
                  {unpinnedFolders.map(renderFolder)}
                </div>
              </section>
            ) : null}

            {visibleFiles.length === 0 && visibleFolders.length === 0 ? (
              <div className="flex min-h-[310px] flex-col items-center justify-center rounded-[20px] border border-dashed border-[#d7e0d8] bg-white/70 px-6 text-center">
                <span className="grid size-14 place-items-center rounded-[17px] bg-[#edf5ef] text-[#397655]">
                  <FolderOpen className="h-7 w-7" />
                </span>
                <p className="mt-4 text-[15px] font-[720] text-[#364239]">
                  {query || colorFilter !== "ALL" ? "No matching folders or files" : "This folder is empty"}
                </p>
                <p className="mt-1 max-w-[360px] text-[12px] leading-5 text-[#77827a]">
                  {query || colorFilter !== "ALL"
                    ? "Try another name or colour filter."
                    : data.canWrite
                      ? `Drag files here or use New to add a folder or files to ${data.folder.name}.`
                      : data.canUpload
                        ? `Drag files here or choose Upload Files to add files to ${data.folder.name}.`
                        : "This folder does not contain any folders or files yet."}
                </p>
                {colorFilter !== "ALL" || query ? <Button variant="secondary" className="mt-3" onClick={() => { setColorFilter("ALL"); setQuery(""); }}>Clear filters</Button> : null}
              </div>
            ) : unpinnedFiles.length === 0 ? null : view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-4">
                {unpinnedFiles.map(renderFile)}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[18px] border border-[#e0e6e1] bg-white">
                <div className="hidden grid-cols-[minmax(0,1fr)_120px_160px_110px_52px] gap-4 border-b border-[#e7ece8] bg-[#f8faf8] px-4 py-3 text-[10px] font-[750] uppercase tracking-[0.09em] text-[#778179] md:grid">
                  <span>Name</span><span>Type</span><span>Uploaded</span><span>Size</span><span />
                </div>
                {unpinnedFiles.map(renderFile)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {folderDialogOpen ? <NewFolderDialog open pending={folderPending} error={folderError} parentName={data.folder.name} onClose={() => setFolderDialogOpen(false)} onCreate={(name) => void createFolder(name)} /> : null}
      <ConfirmationDialog
        isOpen={Boolean(folderToDelete)} title="Delete folder?"
        description={folderToDelete ? `Delete “${folderToDelete.name}” and all subfolders and files inside it? This cannot be undone.` : ""}
        confirmLabel="Delete folder" tone="destructive" pending={folderPending} error={folderError}
        onConfirm={() => void deleteFolder()} onClose={() => { if (!folderPending) setFolderToDelete(undefined); }}
      />

      {importOpen ? (
        <StageTwoImportDialog
          projectId={data.project.id}
          folders={[data.folder]}
          initialFolderId={data.folder.id}
          onClose={() => setImportOpen(false)}
          onImported={(folderId, importedFiles) => {
            if (folderId === data.folder.id) setFiles(importedFiles);
            else setFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, fileCount: importedFiles.length } : folder));
          }}
        />
      ) : null}
      {previewFile ? (
        <AssetPreviewDialog
          key={previewFile.attachmentId}
          isOpen
          fileName={previewFile.name}
          mimeType={previewFile.mimeType}
          previewPath={`/api/project-assets/${previewFile.attachmentId}/preview`}
          textContentPath={
            getFileKind(previewFile) === "text"
              ? `${baseApi}/files/${previewFile.id}`
              : null
          }
          downloadPath={`${baseApi}/files/${previewFile.id}/download`}
          onClose={() => setPreviewFile(undefined)}
        />
      ) : null}

      {textFileDialogOpen ? (
        <NewTextFileDialog
          projectId={data.project.id}
          folderId={data.folder.id}
          pending={textFilePending}
          progress={textFileProgress}
          submitError={textFileError}
          onSave={(input, clearDraft) => void createTextFile(input, clearDraft)}
          onClose={() => {
            if (textFilePending) return;
            setTextFileDialogOpen(false);
            setTextFileError(undefined);
          }}
        />
      ) : null}

      <ConfirmationDialog
        isOpen={Boolean(fileToDelete)}
        title="Delete file?"
        description={
          fileToDelete
            ? `Delete “${fileToDelete.name}”? This permanently removes the stored file and cannot be undone.`
            : ""
        }
        confirmLabel="Delete file"
        tone="destructive"
        pending={Boolean(fileToDelete && deletingId === fileToDelete.id)}
        error={deleteError}
        onConfirm={() => {
          if (fileToDelete) void deleteFile(fileToDelete);
        }}
        onClose={() => {
          setFileToDelete(undefined);
          setDeleteError(undefined);
        }}
      />
    </section>
  );
}

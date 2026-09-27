"use client";

import { FileThumbnail } from "@/components/projects/file-thumbnail";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, FileText, Loader2, X } from "lucide-react";
import {
  getProjectResearchImportOptionsAction,
  importProjectInquiryContentAction,
} from "@/app/(dashboard)/projects/[slug]/stages/2/actions";
import { Button } from "@/components/ui/button";
import type { InquiryImportItem, importProjectInquiryContent } from "@/lib/project-research-import";
import { showSuccessToast } from "@/lib/toast";

type ImportResult = Awaited<ReturnType<typeof importProjectInquiryContent>>;

export function StageTwoImportDialog({ projectId, folders, initialFolderId, onClose, onImported }: {
  projectId: string;
  folders: Array<{ id: string; name: string }>;
  initialFolderId?: string;
  onClose: () => void;
  onImported: (folderId: string, files: ImportResult["files"]) => void;
}) {
  const [folderId, setFolderId] = useState(initialFolderId ?? folders[0]?.id ?? "");
  const [destinationFolders, setDestinationFolders] = useState(folders);
  const [items, setItems] = useState<InquiryImportItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(Boolean(folderId));
  const dialogRef = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!folderId) return;
    void getProjectResearchImportOptionsAction({ projectId, folderId }).then((result) => {
      if (cancelled) return;
      if ("error" in result) setError(result.error);
      else {
        setItems(result.items);
        setDestinationFolders(result.folders);
      }
    }).catch(() => {
      if (!cancelled) setError("Unable to load Stage 1 content. Please try again.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, folderId, attempt]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  async function importSelected() {
    if (pending || !selected.size) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await importProjectInquiryContentAction({ projectId, folderId, itemIds: [...selected] });
      if ("error" in result) { setError(result.error); return; }
      onImported(folderId, result.folderFiles);
      const failedIds = new Set(result.failures.map((item) => item.id));
      setItems((current) => current.map((item) => ({
        ...item, alreadyImported: item.alreadyImported || (selected.has(item.id) && !failedIds.has(item.id)),
      })));
      setSelected(failedIds);
      if (result.files.length) showSuccessToast(`Imported ${result.files.length} ${result.files.length === 1 ? "item" : "items"} into ${destinationFolders.find((folder) => folder.id === folderId)?.name ?? "the selected folder"}.`);
      if (result.failures.length) {
        setError(`Unable to import: ${result.failures.map((item) => item.title).join(", ")}. These items remain selected so you can retry.`);
      } else {
        if (!result.files.length && result.skipped) showSuccessToast("Selected items are already in this folder.");
        onClose();
      }
    } catch {
      setError("The import could not finish. Please try again; items already imported will be skipped.");
    } finally { setPending(false); }
  }

  function resetOptions() {
    setLoading(true);
    setItems([]);
    setSelected(new Set());
    setError(undefined);
  }
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, []);

  const available = items.filter((item) => !item.alreadyImported);
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#112118]/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary'));
        if (!controls.length) { event.preventDefault(); return; }
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} role="dialog" aria-modal="true" aria-labelledby="stage-two-import-title" aria-busy={pending} className="flex max-h-[90vh] w-full min-w-0 max-w-[720px] flex-col overflow-hidden rounded-[24px] border border-[#dfe6df] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e7ece7] p-5 sm:p-6">
          <div>
            <h2 id="stage-two-import-title" className="text-[21px] font-[750] text-[#1b261f]">Import from Stage 1</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#758078]">Choose files and information to add to Stage 2. Text is saved as .txt files you can preview and download.</p>
          </div>
          <Button type="button" variant="secondary" size="icon" aria-label="Close import" disabled={pending} onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-5 sm:p-6">
          <label className="block text-[13px] font-[650] text-[#2d372f]">
            Import into folder
            <select value={folderId} onChange={(event) => { resetOptions(); setFolderId(event.target.value); }} disabled={pending || loading} className="mt-2 block h-11 w-full cursor-pointer rounded-[12px] border border-[#dce3dc] bg-white px-3 font-normal disabled:cursor-wait disabled:bg-[#f5f7f5]">
              {destinationFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          {error ? <div role="alert" className="mt-4 break-words rounded-[12px] bg-[#fff2f1] p-3 text-[13px] text-[#ae4742] [overflow-wrap:anywhere]">{error}<button type="button" className="ml-2 underline" disabled={pending} onClick={() => { resetOptions(); setAttempt((value) => value + 1); }}>Reload content</button></div> : null}
          {loading ? <p role="status" className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#758078]"><Loader2 className="h-4 w-4 animate-spin" /> Loading Stage 1 content...</p> : !items.length ? (error ? null : <p className="py-10 text-center text-[13px] text-[#758078]">No saved Stage 1 files or information are available to import.</p>) : (
            <>
              <label className="mt-5 flex items-center gap-2 text-[13px] font-[650] text-[#2d704b]">
                <input type="checkbox" checked={available.length > 0 && selected.size === Math.min(100, available.length)} disabled={pending || !available.length} onChange={(event) => setSelected(event.target.checked ? new Set(available.slice(0, 100).map((item) => item.id)) : new Set())} className="size-4 accent-[#24764e]" /> {available.length > 100 ? "Select first 100 available items" : "Select all available items"}
              </label>
              {(["file", "text"] as const).map((kind) => {
                const group = items.filter((item) => item.kind === kind);
                if (!group.length) return null;
                return <fieldset key={kind} className="mt-5 space-y-2">
                  <legend className="mb-2 text-[12px] font-[750] uppercase tracking-wide text-[#758078]">{kind === "file" ? "Uploaded files" : "Text and information"}</legend>
                  {group.map((item) => <div key={item.id} className="rounded-[13px] border border-[#dfe6df] p-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" checked={selected.has(item.id)} disabled={pending || item.alreadyImported || (selected.size >= 100 && !selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} className="mt-1 size-4 shrink-0 accent-[#24764e]" />
                      {kind === "text" ? <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[#508364]" /> : <FileThumbnail fileName={item.fileName} mimeType={item.mimeType} previewPath={item.previewPath} className="h-10 w-12" />}
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[14px] font-[650] text-[#263129]">{item.title}</span>
                        <span className="mt-0.5 block text-[11px] text-[#758078]">{item.section} · {kind === "text" ? ".txt file" : item.mimeType} · {item.size < 1024 ? `${item.size} B` : `${Math.ceil(item.size / 1024)} KB`}</span>
                        {item.alreadyImported ? <span className="mt-1 block text-[11px] font-[650] text-[#2d704b]">Already imported into this folder</span> : null}
                      </span>
                    </label>
                    {item.text ? <details className="ml-7 mt-2 text-[12px] text-[#68756d]"><summary className="cursor-pointer">Preview text</summary><pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-[8px] bg-[#f5f8f5] p-3 font-sans leading-5">{item.text}</pre></details> : null}
                  </div>)}
                </fieldset>;
              })}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-[#e7ece7] p-5">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={pending || loading || !selected.size || selected.size > 100} onClick={() => void importSelected()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {pending ? "Importing..." : `Import${selected.size ? ` (${selected.size})` : ""}`}
          </Button>
        </div>
      </section>
    </div>, document.body,
  );
}

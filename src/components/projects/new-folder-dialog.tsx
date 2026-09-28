"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewFolderDialog({ open, pending, error, parentName, onClose, onCreate }: {
  open: boolean;
  pending: boolean;
  error?: string;
  parentName?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-[#112118]/40 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-folder-title" aria-busy={pending}
        className="w-full max-w-[500px] rounded-[24px] border border-[#dfe6df] bg-white p-6 shadow-2xl sm:p-7"
        onSubmit={(event) => { event.preventDefault(); if (!pending && name.trim()) onCreate(name); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) onClose();
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
          if (!controls.length) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
          if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="new-folder-title" className="text-[22px] font-[760] text-[#162019]">Create a folder</h2>
            <p className="mt-1 break-words text-[13px] text-[#6f7a72]">{parentName ? `Add a subfolder inside “${parentName}”.` : "Add a folder to the shared project workspace."}</p>
          </div>
          <Button type="button" variant="secondary" size="icon" onClick={onClose} disabled={pending} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <label className="mt-6 block space-y-2">
          <span className="text-[13px] font-[680] text-[#2d372f]">Folder name</span>
          <Input
            ref={inputRef}
            value={name}
            maxLength={120}
            required
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g., References"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "new-folder-error" : undefined}
            className="h-12 rounded-[14px] border-[#c5d0c7] bg-white shadow-none focus-visible:border-[#24764e] aria-invalid:border-[#b84e48]"
          />
        </label>
        {error ? <p id="new-folder-error" role="alert" className="mt-2 text-[12px] text-[#b84e48]">{error}</p> : null}
        <div className="mt-7 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending || !name.trim()}><FolderPlus className="h-4 w-4" />{pending ? "Creating..." : "Create folder"}</Button>
        </div>
      </form>
    </div>, document.body,
  );
}

"use client";

import { Loader2, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function FolderPinButton({ name, pinned, pending, onClick, className }: {
  name: string;
  pinned: boolean;
  pending?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const label = `${pinned ? "Unpin" : "Pin to top:"} ${name}`;
  return <button type="button" title={label} aria-label={label} aria-pressed={pinned} disabled={pending} onClick={onClick}
    className={cn("grid size-9 shrink-0 place-items-center rounded-[10px] border bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-wait disabled:opacity-50", pinned ? "border-[#a9c6b2] text-[#24764e] hover:bg-[#edf5ef]" : "border-[#dfe6df] text-[#718079] hover:bg-[#f1f5f2]", className)}>
    {pending ? <Loader2 className="size-4 animate-spin" /> : pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
  </button>;
}

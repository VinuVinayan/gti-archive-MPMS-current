"use client";

import { Portal, Sub } from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FOLDER_COLORS, getFolderColor, type FolderColor, type FolderColorFilter } from "@/lib/project-folder-colors-shared";
import { cn } from "@/lib/utils";

function ColorDot({ value }: { value: FolderColor }) {
  return <span aria-hidden="true" className="inline-block size-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: getFolderColor(value)?.hex }} />;
}

export function FolderColorBadge({ value, className }: { value: FolderColor | null; className?: string }) {
  const color = getFolderColor(value);
  if (!color) return null;
  return <span title={`${color.label} colour label`} data-color-label={value} className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-[650] text-[#35423a]", className)} style={{ backgroundColor: color.background }}>
    <ColorDot value={color.value} />{color.label}
  </span>;
}

export function FolderColorMenu({ value, pending, onChange }: { value: FolderColor | null; pending: boolean; onChange: (color: FolderColor | null) => void }) {
  return <Sub>
    <DropdownMenuSubTrigger disabled={pending} className="gap-2"><Palette className="size-4" />Colour label</DropdownMenuSubTrigger>
    <Portal>
      <DropdownMenuSubContent className="max-h-[min(460px,80vh)] overflow-y-auto">
        <DropdownMenuLabel>Colour label</DropdownMenuLabel>
        {FOLDER_COLORS.map((color) => <DropdownMenuItem key={color.value} onSelect={() => onChange(color.value)} disabled={pending} aria-label={`${color.label}${value === color.value ? ", selected" : ""}`}>
          <ColorDot value={color.value} /><span className="flex-1">{color.label}</span>{value === color.value ? <Check className="size-4" /> : null}
        </DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(null)} disabled={pending}><X className="size-4" /><span className="flex-1">No colour</span>{value === null ? <Check className="size-4" /> : null}</DropdownMenuItem>
      </DropdownMenuSubContent>
    </Portal>
  </Sub>;
}

export function FolderColorFilterControl({ value, onChange }: { value: FolderColorFilter; onChange: (color: FolderColorFilter) => void }) {
  const label = value === "ALL" ? "All colours" : value === "NONE" ? "No colour" : getFolderColor(value)?.label;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="secondary" aria-label={`Filter by colour: ${label}`} className="h-10 shrink-0 rounded-[11px] shadow-none">
      {value !== "ALL" && value !== "NONE" ? <ColorDot value={value} /> : <Palette className="size-4" />}{label}<ChevronDown className="size-3.5" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-[min(500px,80vh)] overflow-y-auto">
      <DropdownMenuLabel>Filter by colour</DropdownMenuLabel>
      {[{ value: "ALL", label: "All colours" }, ...FOLDER_COLORS, { value: "NONE", label: "No colour" }].map((option) => <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value as FolderColorFilter)}>
        {option.value !== "ALL" && option.value !== "NONE" ? <ColorDot value={option.value as FolderColor} /> : <span className="size-3" />}
        <span className="flex-1">{option.label}</span>{value === option.value ? <Check className="size-4" /> : null}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

import type { FolderItemTarget } from "@/lib/project-folder-pins-shared";

export const FOLDER_COLORS = [
  { value: "RED", label: "Red", hex: "#c94c4c", background: "#fff0ef" },
  { value: "ORANGE", label: "Orange", hex: "#c76b27", background: "#fff2e6" },
  { value: "YELLOW", label: "Yellow", hex: "#a17c0c", background: "#fff8d8" },
  { value: "GREEN", label: "Green", hex: "#298454", background: "#eaf6ee" },
  { value: "BLUE", label: "Blue", hex: "#3c78c8", background: "#edf4ff" },
  { value: "PURPLE", label: "Purple", hex: "#8b5cbb", background: "#f5edfc" },
  { value: "GREY", label: "Grey", hex: "#737b84", background: "#f0f2f4" },
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number]["value"];
export type FolderColorFilter = FolderColor | "ALL" | "NONE";
export type FolderItemColorInput = FolderItemTarget & { colorLabel: FolderColor | null };

export function isFolderColor(value: unknown): value is FolderColor {
  return FOLDER_COLORS.some((color) => color.value === value);
}

export function getFolderColor(value: FolderColor | null) {
  return FOLDER_COLORS.find((color) => color.value === value);
}

export function matchesFolderColor(value: FolderColor | null, filter: FolderColorFilter) {
  return filter === "ALL" || (filter === "NONE" ? value === null : value === filter);
}

export function compareFolderColors(left: { colorLabel: FolderColor | null }, right: { colorLabel: FolderColor | null }) {
  const order = (value: FolderColor | null) => value ? FOLDER_COLORS.findIndex((color) => color.value === value) : FOLDER_COLORS.length;
  return order(left.colorLabel) - order(right.colorLabel);
}

export type FolderItemTarget = {
  projectId: string;
  context: "research" | "private";
  kind: "folder" | "file";
  folderId: string;
  fileId?: string;
};

export type FolderItemPinInput = FolderItemTarget & { pinned: boolean };

export function comparePinnedItems(
  left: { pinnedAt: string | null },
  right: { pinnedAt: string | null },
) {
  if (!left.pinnedAt && !right.pinnedAt) return 0;
  if (!left.pinnedAt) return 1;
  if (!right.pinnedAt) return -1;
  return new Date(right.pinnedAt).getTime() - new Date(left.pinnedAt).getTime();
}

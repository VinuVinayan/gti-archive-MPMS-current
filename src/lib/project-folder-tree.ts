export type FolderTreeEntry = { id: string; name: string; parentFolderId: string | null };

export function getFolderAncestors<T extends FolderTreeEntry>(folders: T[], folderId: string): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: T[] = [];
  const visited = new Set<string>();
  let id: string | null = folderId;
  while (id) {
    const folder = byId.get(id);
    if (!folder || visited.has(id)) throw new Error("Folder hierarchy is unavailable.");
    visited.add(id);
    path.unshift(folder);
    id = folder.parentFolderId;
  }
  return path;
}

// Parents precede children so callers can delete in reverse order.
export function getFolderSubtree<T extends FolderTreeEntry>(folders: T[], folderId: string): T[] {
  const root = folders.find((folder) => folder.id === folderId);
  if (!root) return [];
  const children = new Map<string, T[]>();
  for (const folder of folders) {
    if (!folder.parentFolderId) continue;
    const siblings = children.get(folder.parentFolderId) ?? [];
    siblings.push(folder);
    children.set(folder.parentFolderId, siblings);
  }
  const result = [root];
  const visited = new Set([root.id]);
  for (let index = 0; index < result.length; index += 1) {
    for (const child of children.get(result[index].id) ?? []) {
      if (visited.has(child.id)) throw new Error("Folder hierarchy is unavailable.");
      visited.add(child.id);
      result.push(child);
    }
  }
  return result;
}

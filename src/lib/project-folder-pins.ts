import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertResearchFolderWriteAccess } from "@/lib/project-research-access";
import { setProjectPrivateItemPin } from "@/lib/project-private-folders";
import type { FolderItemPinInput } from "@/lib/project-folder-pins-shared";

export async function setProjectFolderItemPin(user: Pick<User, "id" | "name" | "email" | "role">, input: FolderItemPinInput) {
  if (typeof input.pinned !== "boolean" || !["folder", "file"].includes(input.kind) || !["research", "private"].includes(input.context) || !input.folderId || !input.projectId || (input.kind === "file" && !input.fileId)) {
    throw new Error("Invalid pin request.");
  }
  if (input.context === "private") return setProjectPrivateItemPin(user, input);
  await assertResearchFolderWriteAccess(user, input);
  if (input.kind === "folder") {
    const folder = await prisma.projectResearchFolder.findUniqueOrThrow({ where: { id: input.folderId }, select: { pinnedAt: true, parentFolderId: true } });
    const pinnedAt = input.pinned ? folder.pinnedAt ?? new Date() : null;
    await prisma.projectResearchFolder.update({ where: { id: input.folderId }, data: { pinnedAt } });
    return { pinnedAt: pinnedAt?.toISOString() ?? null, parentFolderId: folder.parentFolderId };
  }
  const file = await prisma.projectResearchFolderFile.findFirst({
    where: { id: input.fileId, folderId: input.folderId, attachment: { status: "READY" } },
    select: { id: true, pinnedAt: true },
  });
  if (!file) throw new Error("File not found.");
  const pinnedAt = input.pinned ? file.pinnedAt ?? new Date() : null;
  const changed = await prisma.projectResearchFolderFile.updateMany({
    where: { id: file.id, folderId: input.folderId, attachment: { status: "READY" } }, data: { pinnedAt },
  });
  if (changed.count !== 1) throw new Error("File not found.");
  return { pinnedAt: pinnedAt?.toISOString() ?? null, parentFolderId: input.folderId };
}

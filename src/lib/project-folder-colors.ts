import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertResearchFolderWriteAccess } from "@/lib/project-research-access";
import { setProjectPrivateItemColor } from "@/lib/project-private-folders";
import { isFolderColor, type FolderItemColorInput } from "@/lib/project-folder-colors-shared";

export async function setProjectFolderItemColor(user: Pick<User, "id" | "name" | "email" | "role">, input: FolderItemColorInput) {
  if ((input.colorLabel !== null && !isFolderColor(input.colorLabel)) || !["folder", "file"].includes(input.kind) || !["research", "private"].includes(input.context) || !input.folderId || !input.projectId || (input.kind === "file" && !input.fileId)) {
    throw new Error("Invalid colour label request.");
  }
  if (input.context === "private") return setProjectPrivateItemColor(user, input);
  await assertResearchFolderWriteAccess(user, input);
  if (input.kind === "folder") {
    const folder = await prisma.projectResearchFolder.update({
      where: { id: input.folderId }, data: { colorLabel: input.colorLabel },
      select: { colorLabel: true, parentFolderId: true },
    });
    return folder;
  }
  const changed = await prisma.projectResearchFolderFile.updateMany({
    where: { id: input.fileId, folderId: input.folderId, attachment: { status: "READY" } },
    data: { colorLabel: input.colorLabel },
  });
  if (changed.count !== 1) throw new Error("File not found.");
  return { colorLabel: input.colorLabel, parentFolderId: input.folderId };
}

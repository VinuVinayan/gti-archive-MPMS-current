import { AttachmentAssetType, Prisma } from "@prisma/client";

import {
  completeAttachmentUpload,
  deleteAttachmentForUser,
  getAttachmentDownloadUrlForUser,
  requestAttachmentUpload,
  type ProjectHistoryAccessUser,
  type RequestUploadInput,
} from "@/lib/project-history";
import {
  assertResearchFolderReadAccess,
  assertResearchFolderUploadAccess,
  assertResearchFolderWriteAccess,
  getResearchFolderAccess,
} from "@/lib/project-research-access";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { readTextObject } from "@/lib/storage/s3";
import { getFolderSubtree } from "@/lib/project-folder-tree";

const TEXT_FILE_PREVIEW_MAX_BYTES = 1024 * 1024;
const TEXT_FILE_EXCERPT_MAX_BYTES = 6 * 1024;

export async function requestProjectResearchFileUpload(
  user: ProjectHistoryAccessUser,
  input: {
    projectId: string;
    folderId: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    uploadEndpointMode?: RequestUploadInput["uploadEndpointMode"];
  },
) {
  await assertResearchFolderUploadAccess(user, {
    projectId: input.projectId,
    folderId: input.folderId,
  });

  return requestAttachmentUpload(user, {
    projectId: input.projectId,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType.trim() || "application/octet-stream",
    fileSize: input.fileSize,
    assetType: AttachmentAssetType.PROJECT_RESEARCH_FILE,
    uploadEndpointMode: input.uploadEndpointMode,
    researchFolderId: input.folderId,
  });
}

export async function completeProjectResearchFileUpload(
  user: ProjectHistoryAccessUser,
  input: {
    projectId: string;
    folderId: string;
    attachmentId: string;
    failed?: boolean;
  },
) {
  await assertResearchFolderUploadAccess(user, {
    projectId: input.projectId,
    folderId: input.folderId,
  });

  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        id: input.attachmentId,
        projectId: input.projectId,
        uploadedById: user.id,
        assetType: AttachmentAssetType.PROJECT_RESEARCH_FILE,
      },
      select: { id: true },
    }),
  );

  if (!attachment) {
    throw new Error("Research upload not found.");
  }

  await completeAttachmentUpload(
    user,
    attachment.id,
    Boolean(input.failed),
    undefined,
    { researchFolderId: input.folderId },
  );

  if (input.failed) {
    return null;
  }

  const file = await withPrismaRetry(() =>
    prisma.projectResearchFolderFile.findUnique({
      where: { attachmentId: attachment.id },
      select: {
        id: true,
        attachmentId: true,
        pinnedAt: true, colorLabel: true,
        attachment: {
          select: {
            originalFileName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
            uploadedBy: { select: { name: true, email: true } },
          },
        },
      },
    }),
  );

  if (!file) {
    throw new Error("Research file association was not created.");
  }

  return {
    id: file.id,
    pinnedAt: file.pinnedAt?.toISOString() ?? null,
    colorLabel: file.colorLabel,
    attachmentId: file.attachmentId,
    name: file.attachment.originalFileName,
    mimeType: file.attachment.mimeType,
    size: file.attachment.fileSize,
    uploadedAt: file.attachment.createdAt.toISOString(),
    uploadedBy:
      file.attachment.uploadedBy.name?.trim() || file.attachment.uploadedBy.email,
  };
}

async function getExactResearchFile(
  input: { projectId: string; folderId: string; fileId: string },
) {
  return withPrismaRetry(() =>
    prisma.projectResearchFolderFile.findFirst({
      where: {
        id: input.fileId,
        folderId: input.folderId,
        folder: { workspace: { projectId: input.projectId } },
      },
      select: { id: true, attachmentId: true },
    }),
  );
}

export async function getProjectResearchTextFileContent(
  user: ProjectHistoryAccessUser,
  input: {
    projectId: string;
    folderId: string;
    fileId: string;
    excerpt?: boolean;
  },
) {
  await assertResearchFolderReadAccess(user, input);
  const file = await withPrismaRetry(() =>
    prisma.projectResearchFolderFile.findFirst({
      where: {
        id: input.fileId,
        folderId: input.folderId,
        folder: { workspace: { projectId: input.projectId } },
      },
      select: {
        attachment: {
          select: {
            bucket: true,
            storageKey: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
          },
        },
      },
    }),
  );

  if (!file) {
    throw new Error("Research file not found.");
  }

  const extension = file.attachment.originalFileName
    .split(".")
    .pop()
    ?.toLocaleLowerCase("en");
  const isTextFile =
    file.attachment.mimeType.toLocaleLowerCase("en").startsWith("text/") ||
    ["txt", "md", "json", "xml"].includes(extension ?? "");

  if (!isTextFile) {
    throw new Error("This file does not contain previewable text.");
  }

  const maxBytes = input.excerpt
    ? TEXT_FILE_EXCERPT_MAX_BYTES
    : TEXT_FILE_PREVIEW_MAX_BYTES;
  const content = await readTextObject({
    bucket: file.attachment.bucket,
    storageKey: file.attachment.storageKey,
    maxBytes,
  });

  return {
    content,
    truncated: file.attachment.fileSize > maxBytes,
  };
}

export async function getProjectResearchFileDownloadUrl(
  user: ProjectHistoryAccessUser,
  input: { projectId: string; folderId: string; fileId: string },
) {
  await assertResearchFolderReadAccess(user, input);
  const file = await getExactResearchFile(input);

  if (!file) {
    throw new Error("Research file not found.");
  }

  return getAttachmentDownloadUrlForUser(user, file.attachmentId);
}

export async function deleteProjectResearchFile(
  user: ProjectHistoryAccessUser,
  input: { projectId: string; folderId: string; fileId: string },
) {
  await assertResearchFolderWriteAccess(user, input);
  const file = await getExactResearchFile(input);

  if (!file) {
    throw new Error("Research file not found.");
  }

  await deleteAttachmentForUser(user, file.attachmentId);
}

export async function deleteProjectResearchFolder(
  user: ProjectHistoryAccessUser,
  input: { projectId: string; folderId: string },
) {
  const { access } = await getResearchFolderAccess(user, {
    projectId: input.projectId,
    folderId: input.folderId,
  });

  if (!access.canWrite) {
    return {
      error: "You do not have permission to delete this shared folder.",
    } as const;
  }

  const folder = await withPrismaRetry(() =>
    prisma.projectResearchFolder.findFirst({
      where: { id: input.folderId, workspaceId: access.workspaceId },
      select: {
        id: true,
        name: true,
        workspaceId: true,
      },
    }),
  );

  if (!folder) {
    return { error: "Folder not found." } as const;
  }

  const hierarchy = await prisma.projectResearchFolder.findMany({
    where: { workspaceId: access.workspaceId },
    select: { id: true, name: true, parentFolderId: true },
  });
  const subtree = getFolderSubtree(hierarchy, folder.id);
  const files = await prisma.projectResearchFolderFile.findMany({
    where: { folderId: { in: subtree.map((child) => child.id) }, attachment: { status: { not: "DELETED" } } },
    select: { attachmentId: true },
  });
  for (const file of files) {
    await deleteAttachmentForUser(user, file.attachmentId);
  }

  await assertResearchFolderWriteAccess(user, input);
  await prisma.$transaction(async (tx) => {
    const ids = subtree.map((child) => child.id);
    await tx.$queryRaw`SELECT "id" FROM "ProjectResearchFolder" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
    const activeFiles = await tx.projectResearchFolderFile.count({ where: { folderId: { in: ids }, attachment: { status: { not: "DELETED" } } } });
    if (activeFiles) throw new Error("Folder contents changed. Please reload and try again.");
    for (const child of [...subtree].reverse()) {
      await tx.projectResearchFolder.delete({ where: { id: child.id, workspaceId: access.workspaceId } });
    }
  });

  return { folder: { id: folder.id, name: folder.name } } as const;
}

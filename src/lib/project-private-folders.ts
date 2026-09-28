import { randomUUID } from "node:crypto";

import {
  AttachmentAssetType,
  AttachmentStatus,
  Prisma,
  type User,
} from "@prisma/client";

import { prisma, withPrismaRetry } from "@/lib/prisma";
import { getFolderAncestors, getFolderSubtree } from "@/lib/project-folder-tree";
import type { FolderItemPinInput } from "@/lib/project-folder-pins-shared";
import type { FolderItemColorInput } from "@/lib/project-folder-colors-shared";
import { validatePreparedProjectResearchTextFile } from "@/lib/project-research-text-file";
import {
  buildProjectAssetKey,
  createPresignedDownloadUrl,
  createPresignedPreviewUrl,
  createPresignedUploadTarget,
  deleteObjectIfNeeded,
  getDefaultS3UploadEndpointMode,
  getMaxAssetUploadBytes,
  getS3BucketName,
  isAllowedAssetFile,
  readTextObject,
  sanitizeFileName,
  type S3UploadEndpointMode,
} from "@/lib/storage/s3";
import {
  PROJECT_ASSET_ALLOWED_EXTENSIONS,
  buildFileTypeNotAllowedPayload,
} from "@/lib/upload-validation";

type PrivateFolderUser = Pick<User, "id" | "email" | "name" | "role">;

const PRIVATE_TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const PRIVATE_TEXT_EXCERPT_MAX_BYTES = 6 * 1024;

function displayName(user: Pick<User, "name" | "email">) {
  return user.name?.trim() || user.email;
}

function activeParticipantWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      { coOwners: { some: { userId } } },
      { executors: { some: { userId } } },
      { collaborators: { some: { userId } } },
    ],
  } satisfies Prisma.ProjectWhereInput;
}

export async function ensureProjectPrivateFolderTx(
  tx: Prisma.TransactionClient,
  projectId: string,
  ownerUserId: string,
) {
  const [folder] = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "ProjectPrivateFolder" ("id", "projectId", "ownerUserId", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${projectId}, ${ownerUserId}, NOW(), NOW())
    ON CONFLICT ("projectId", "ownerUserId") WHERE "parentFolderId" IS NULL
    DO UPDATE SET "ownerUserId" = EXCLUDED."ownerUserId"
    RETURNING "id"
  `;
  return folder;
}

export async function ensureProjectPrivateFolder(
  projectId: string,
  ownerUserId: string,
) {
  return withPrismaRetry(() =>
    prisma.$transaction((tx) =>
      ensureProjectPrivateFolderTx(tx, projectId, ownerUserId),
    ),
  );
}

export async function ensureProjectPrivateFoldersForProjectTx(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      coOwners: { select: { userId: true } },
      executors: { select: { userId: true } },
      collaborators: { select: { userId: true } },
    },
  });

  if (!project) throw new Error("Project not found.");

  const participantIds = [
    ...new Set([
      ...(project.ownerId ? [project.ownerId] : []),
      ...project.coOwners.map((record) => record.userId),
      ...project.executors.map((record) => record.userId),
      ...project.collaborators.map((record) => record.userId),
    ]),
  ];

  for (const participantId of participantIds) {
    await ensureProjectPrivateFolderTx(tx, projectId, participantId);
  }

  return participantIds;
}

export async function ensureProjectPrivateFoldersForProject(projectId: string) {
  return withPrismaRetry(() =>
    prisma.$transaction(
      (tx) => ensureProjectPrivateFoldersForProjectTx(tx, projectId),
      { timeout: 30_000 },
    ),
  );
}

async function getOwnedPrivateFolder(
  user: PrivateFolderUser,
  input: { projectId: string; folderId: string },
) {
  const folder = await withPrismaRetry(() =>
    prisma.projectPrivateFolder.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
        ownerUserId: user.id,
        project: activeParticipantWhere(user.id),
      },
      select: {
        id: true,
        projectId: true,
        ownerUserId: true,
        name: true,
        parentFolderId: true,
        pinnedAt: true, colorLabel: true,
        owner: { select: { name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    }),
  );

  if (!folder) {
    throw new Error("You do not have access to this private folder.");
  }

  return folder;
}

export async function assertProjectPrivateAttachmentAccess(
  user: PrivateFolderUser,
  attachmentId: string,
) {
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.findFirst({
      where: {
        id: attachmentId,
        assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
        privateFolder: {
          ownerUserId: user.id,
          project: activeParticipantWhere(user.id),
        },
      },
      select: {
        id: true,
        projectId: true,
        privateFolderId: true,
        pinnedAt: true, colorLabel: true,
        bucket: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        uploadedById: true,
        createdAt: true,
        uploadedBy: { select: { name: true, email: true } },
        privateFolder: { select: { projectId: true, ownerUserId: true } },
      },
    }),
  );

  if (
    !attachment ||
    !attachment.privateFolder ||
    attachment.privateFolder.projectId !== attachment.projectId
  ) {
    throw new Error("You do not have access to this private file.");
  }

  return attachment;
}

function mapPrivateFile(
  attachment: Awaited<ReturnType<typeof assertProjectPrivateAttachmentAccess>>,
) {
  return {
    id: attachment.id,
    pinnedAt: attachment.pinnedAt?.toISOString() ?? null,
    colorLabel: attachment.colorLabel,
    attachmentId: attachment.id,
    name: attachment.originalFileName,
    mimeType: attachment.mimeType,
    size: attachment.fileSize,
    uploadedAt: attachment.createdAt.toISOString(),
    uploadedBy: displayName(attachment.uploadedBy),
  };
}

export async function getProjectPrivateFolderPageData(
  user: PrivateFolderUser,
  input: { projectId: string; folderId: string },
) {
  const folder = await getOwnedPrivateFolder(user, input);
  const hierarchy = await prisma.projectPrivateFolder.findMany({
    where: { projectId: input.projectId, ownerUserId: user.id },
    select: {
      id: true, name: true, parentFolderId: true, createdAt: true, pinnedAt: true, colorLabel: true,
      _count: { select: { children: true, files: { where: { status: AttachmentStatus.READY } } } },
    },
  });
  const path = getFolderAncestors(hierarchy, folder.id);
  const files = await withPrismaRetry(() =>
    prisma.projectAttachment.findMany({
      where: {
        projectId: input.projectId,
        privateFolderId: folder.id,
        assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
        status: AttachmentStatus.READY,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        projectId: true,
        privateFolderId: true,
        pinnedAt: true, colorLabel: true,
        bucket: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        uploadedById: true,
        createdAt: true,
        uploadedBy: { select: { name: true, email: true } },
        privateFolder: { select: { projectId: true, ownerUserId: true } },
      },
    }),
  );

  return {
    project: folder.project,
    workspace: {
      id: folder.id,
      ownerUserId: folder.ownerUserId,
      ownerName: displayName(folder.owner),
    },
    folder: { id: folder.id, name: folder.name, isSystem: !folder.parentFolderId, colorLabel: folder.colorLabel },
    ancestors: path.slice(0, -1).map(({ id, name }) => ({ id, name })),
    folders: hierarchy.filter((child) => child.parentFolderId === folder.id).map((child) => ({
      id: child.id, name: child.name, createdAt: child.createdAt.toISOString(),
      pinnedAt: child.pinnedAt?.toISOString() ?? null,
      colorLabel: child.colorLabel,
      fileCount: child._count.files, folderCount: child._count.children,
    })),
    canWrite: true,
    canUpload: true,
    files: files.map(mapPrivateFile),
  };
}

export async function createProjectPrivateSubfolder(
  user: PrivateFolderUser,
  input: { projectId: string; parentFolderId: string; name: string },
) {
  await getOwnedPrivateFolder(user, { projectId: input.projectId, folderId: input.parentFolderId });
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) return { error: "Enter a folder name of up to 120 characters." } as const;
  try {
    const folder = await prisma.projectPrivateFolder.create({
      data: { projectId: input.projectId, ownerUserId: user.id, parentFolderId: input.parentFolderId, name, normalizedName: name.toLocaleLowerCase("en-US") },
      select: { id: true, name: true },
    });
    return { folder } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A folder with this name already exists in this location." } as const;
    }
    throw error;
  }
}

export async function setProjectPrivateItemPin(user: PrivateFolderUser, input: FolderItemPinInput) {
  const folder = await getOwnedPrivateFolder(user, input);
  if (input.kind === "folder") {
    if (!folder.parentFolderId) throw new Error("The main private folder is already shown in the workspace.");
    const pinnedAt = input.pinned ? folder.pinnedAt ?? new Date() : null;
    await prisma.projectPrivateFolder.update({ where: { id: folder.id }, data: { pinnedAt } });
    return { pinnedAt: pinnedAt?.toISOString() ?? null, parentFolderId: folder.parentFolderId };
  }
  const file = await getExactPrivateFile(user, { projectId: input.projectId, folderId: input.folderId, fileId: input.fileId! });
  const pinnedAt = input.pinned ? file.pinnedAt ?? new Date() : null;
  const changed = await prisma.projectAttachment.updateMany({
    where: { id: file.id, privateFolderId: folder.id, status: AttachmentStatus.READY }, data: { pinnedAt },
  });
  if (changed.count !== 1) throw new Error("File not found.");
  return { pinnedAt: pinnedAt?.toISOString() ?? null, parentFolderId: folder.id };
}

export async function setProjectPrivateItemColor(user: PrivateFolderUser, input: FolderItemColorInput) {
  const folder = await getOwnedPrivateFolder(user, input);
  if (input.kind === "folder") {
    return prisma.projectPrivateFolder.update({
      where: { id: folder.id }, data: { colorLabel: input.colorLabel },
      select: { colorLabel: true, parentFolderId: true },
    });
  }
  const file = await getExactPrivateFile(user, { projectId: input.projectId, folderId: input.folderId, fileId: input.fileId! });
  const changed = await prisma.projectAttachment.updateMany({
    where: { id: file.id, privateFolderId: folder.id, status: AttachmentStatus.READY }, data: { colorLabel: input.colorLabel },
  });
  if (changed.count !== 1) throw new Error("File not found.");
  return { colorLabel: input.colorLabel, parentFolderId: folder.id };
}

export async function deleteProjectPrivateSubfolder(user: PrivateFolderUser, input: { projectId: string; folderId: string }) {
  const folder = await getOwnedPrivateFolder(user, input);
  if (!folder.parentFolderId) return { error: "The main private folder cannot be deleted." } as const;
  const hierarchy = await prisma.projectPrivateFolder.findMany({
    where: { projectId: input.projectId, ownerUserId: user.id },
    select: { id: true, name: true, parentFolderId: true },
  });
  const subtree = getFolderSubtree(hierarchy, folder.id);
  const files = await prisma.projectAttachment.findMany({
    where: { privateFolderId: { in: subtree.map((child) => child.id) }, status: { not: AttachmentStatus.DELETED } },
    select: { id: true, storageKey: true, bucket: true },
  });
  for (const file of files) {
    await assertProjectPrivateAttachmentAccess(user, file.id);
    await deleteObjectIfNeeded(file.storageKey, file.bucket).catch(() => undefined);
    await prisma.projectAttachment.update({ where: { id: file.id }, data: { status: AttachmentStatus.DELETED } });
  }
  await getOwnedPrivateFolder(user, input);
  await prisma.$transaction(async (tx) => {
    const ids = subtree.map((child) => child.id);
    await tx.$queryRaw`SELECT "id" FROM "ProjectPrivateFolder" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
    const activeFiles = await tx.projectAttachment.count({ where: { privateFolderId: { in: ids }, status: { not: AttachmentStatus.DELETED } } });
    if (activeFiles) throw new Error("Folder contents changed. Please reload and try again.");
    for (const child of [...subtree].reverse()) await tx.projectPrivateFolder.delete({ where: { id: child.id } });
  });
  return { folder: { id: folder.id, name: folder.name } } as const;
}

export async function requestProjectPrivateFileUpload(
  user: PrivateFolderUser,
  input: {
    projectId: string;
    folderId: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    createdTextFile?: boolean;
    uploadEndpointMode?: S3UploadEndpointMode;
  },
) {
  await getOwnedPrivateFolder(user, input);

  if (!input.originalFileName.trim()) {
    return { error: "Choose a file to upload." } as const;
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { error: "File size is invalid." } as const;
  }
  if (input.fileSize > getMaxAssetUploadBytes()) {
    return { error: "This file exceeds the allowed size limit." } as const;
  }
  if (input.createdTextFile) {
    const validation = validatePreparedProjectResearchTextFile({
      fileName: input.originalFileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
    });
    if ("error" in validation) {
      return {
        error: validation.error ?? "Text file metadata is invalid.",
      } as const;
    }
  } else if (!isAllowedAssetFile(input.originalFileName)) {
    return buildFileTypeNotAllowedPayload({
      fileName: input.originalFileName,
      mimeType: input.mimeType,
      allowedExtensions: PROJECT_ASSET_ALLOWED_EXTENSIONS,
    });
  }

  const uniqueFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFileName(
    input.originalFileName,
  )}`;
  const storageKey = buildProjectAssetKey({
    projectId: input.projectId,
    privateFolderId: input.folderId,
    assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
    safeFileName: uniqueFileName,
  });
  const attachment = await withPrismaRetry(() =>
    prisma.projectAttachment.create({
      data: {
        projectId: input.projectId,
        privateFolderId: input.folderId,
        uploadedById: user.id,
        fileName: uniqueFileName,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType.trim() || "application/octet-stream",
        fileSize: input.fileSize,
        bucket: getS3BucketName(),
        storageKey,
        assetType: AttachmentAssetType.PROJECT_PRIVATE_FILE,
        status: AttachmentStatus.UPLOADING,
      },
      select: { id: true, fileName: true, storageKey: true },
    }),
  );
  const uploadTarget = await createPresignedUploadTarget({
    storageKey: attachment.storageKey,
    mimeType: input.mimeType.trim() || "application/octet-stream",
    endpointMode:
      input.uploadEndpointMode ?? getDefaultS3UploadEndpointMode(),
  });

  return {
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    uploadUrl: uploadTarget.uploadUrl,
    uploadHost: uploadTarget.uploadHost,
    uploadEndpointMode: uploadTarget.endpointMode,
    uploadRegion: uploadTarget.region,
    uploadExpiresInSeconds: uploadTarget.expiresInSeconds,
    uploadExpectedHeaders: uploadTarget.expectedHeaders,
    storageKey: attachment.storageKey,
  } as const;
}

export async function completeProjectPrivateFileUpload(
  user: PrivateFolderUser,
  input: {
    projectId: string;
    folderId: string;
    attachmentId: string;
    failed?: boolean;
  },
) {
  await getOwnedPrivateFolder(user, input);
  const attachment = await assertProjectPrivateAttachmentAccess(
    user,
    input.attachmentId,
  );

  if (
    attachment.projectId !== input.projectId ||
    attachment.privateFolderId !== input.folderId ||
    attachment.uploadedById !== user.id
  ) {
    throw new Error("Private upload context is invalid.");
  }
  const expectedPrefix = `projects/${input.projectId}/private/${input.folderId}/`;
  if (!attachment.storageKey.startsWith(expectedPrefix)) {
    throw new Error("Private upload context is invalid.");
  }
  if (attachment.status === AttachmentStatus.READY) {
    return mapPrivateFile(attachment);
  }
  if (attachment.status !== AttachmentStatus.UPLOADING) {
    throw new Error("Attachment cannot be completed.");
  }
  if (input.failed) {
    await withPrismaRetry(() =>
      prisma.projectAttachment.update({
        where: { id: attachment.id },
        data: { status: AttachmentStatus.FAILED },
      }),
    );
    return null;
  }

  const ready = await withPrismaRetry(() =>
    prisma.projectAttachment.update({
      where: { id: attachment.id },
      data: { status: AttachmentStatus.READY },
      select: {
        id: true,
        pinnedAt: true, colorLabel: true,
        projectId: true,
        privateFolderId: true,
        bucket: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        uploadedById: true,
        createdAt: true,
        uploadedBy: { select: { name: true, email: true } },
        privateFolder: { select: { projectId: true, ownerUserId: true } },
      },
    }),
  );
  return mapPrivateFile(ready);
}

async function getExactPrivateFile(
  user: PrivateFolderUser,
  input: { projectId: string; folderId: string; fileId: string },
) {
  await getOwnedPrivateFolder(user, input);
  const attachment = await assertProjectPrivateAttachmentAccess(
    user,
    input.fileId,
  );
  if (
    attachment.projectId !== input.projectId ||
    attachment.privateFolderId !== input.folderId ||
    attachment.status !== AttachmentStatus.READY
  ) {
    throw new Error("Private file not found.");
  }
  return attachment;
}

export async function getProjectPrivateFilePreviewUrl(
  user: PrivateFolderUser,
  input: { projectId: string; folderId: string; fileId: string },
) {
  const attachment = await getExactPrivateFile(user, input);
  return createPresignedPreviewUrl({
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
  });
}

export async function getProjectPrivateFileDownloadUrl(
  user: PrivateFolderUser,
  input: { projectId: string; folderId: string; fileId: string },
) {
  const attachment = await getExactPrivateFile(user, input);
  return createPresignedDownloadUrl({
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
  });
}

export async function getProjectPrivateTextFileContent(
  user: PrivateFolderUser,
  input: {
    projectId: string;
    folderId: string;
    fileId: string;
    excerpt?: boolean;
  },
) {
  const attachment = await getExactPrivateFile(user, input);
  const extension = attachment.originalFileName
    .split(".")
    .pop()
    ?.toLocaleLowerCase("en");
  const isTextFile =
    attachment.mimeType.toLocaleLowerCase("en").startsWith("text/") ||
    ["txt", "md", "json", "xml"].includes(extension ?? "");
  if (!isTextFile) {
    throw new Error("This file does not contain previewable text.");
  }

  const maxBytes = input.excerpt
    ? PRIVATE_TEXT_EXCERPT_MAX_BYTES
    : PRIVATE_TEXT_PREVIEW_MAX_BYTES;
  const content = await readTextObject({
    bucket: attachment.bucket,
    storageKey: attachment.storageKey,
    maxBytes,
  });
  return { content, truncated: attachment.fileSize > maxBytes };
}

export async function deleteProjectPrivateFile(
  user: PrivateFolderUser,
  input: { projectId: string; folderId: string; fileId: string },
) {
  const attachment = await getExactPrivateFile(user, input);
  await deleteObjectIfNeeded(attachment.storageKey, attachment.bucket).catch(
    () => undefined,
  );
  await withPrismaRetry(() =>
    prisma.projectAttachment.update({
      where: { id: attachment.id },
      data: { status: AttachmentStatus.DELETED },
    }),
  );
}

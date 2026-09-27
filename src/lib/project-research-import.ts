import { createHash, randomUUID } from "node:crypto";
import { ActivityLogAction, AttachmentAssetType, AttachmentStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { assertResearchFolderWriteAccess } from "@/lib/project-research-access";
import { richTextToPlainText } from "@/lib/rich-text";
import { getFolderAncestors } from "@/lib/project-folder-tree";
import {
  buildProjectAssetKey,
  copyStoredObject,
  deleteObjectIfNeeded,
  getS3BucketName,
  sanitizeFileName,
  writeTextObject,
} from "@/lib/storage/s3";

type ImportUser = Parameters<typeof assertResearchFolderWriteAccess>[0];
type ImportTarget = { projectId: string; folderId: string };
export type InquiryImportItem = {
  id: string;
  kind: "file" | "text";
  title: string;
  section: string;
  fileName: string;
  mimeType: string;
  size: number;
  text?: string;
  previewPath?: string;
  alreadyImported: boolean;
};
type ImportSource = Omit<InquiryImportItem, "alreadyImported"> & {
  sourceBucket?: string;
  sourceKey?: string;
};

const sectionLabels: Record<string, string> = {
  INITIAL_BRIEF: "Initial Brief",
  BUSINESS_OBJECTIVES: "Business Objectives",
  LEGAL_NOTES: "Legal Notes",
};

async function getImportSources(projectId: string): Promise<ImportSource[]> {
  const inquiry = await prisma.projectInquiry.findUnique({
    where: { projectId },
    include: {
      parties: { orderBy: [{ role: "asc" }, { sequence: "asc" }] },
      deliverables: { orderBy: { createdAt: "asc" } },
      targetMarkets: { orderBy: { createdAt: "asc" } },
      attachments: {
        where: { attachment: { projectId, status: AttachmentStatus.READY } },
        orderBy: { createdAt: "asc" },
        include: { attachment: true },
      },
    },
  });
  if (!inquiry) return [];

  const items: ImportSource[] = inquiry.attachments.map(({ field, attachment }) => ({
    id: `file:${attachment.id}`,
    kind: "file",
    title: attachment.originalFileName,
    section: sectionLabels[field],
    fileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
    size: attachment.fileSize,
    previewPath: `/api/project-assets/${attachment.id}/preview`,
    sourceBucket: attachment.bucket,
    sourceKey: attachment.storageKey,
  }));
  const addText = (key: string, title: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    const version = createHash("sha256").update(text).digest("hex");
    items.push({
      id: `text:${key}:${version}`, kind: "text", title, section: "Stage 1 information",
      fileName: `Stage 1 - ${title}.txt`, mimeType: "text/plain", size: Buffer.byteLength(text), text,
    });
  };
  const plainText = (value: string | null) => richTextToPlainText(value)
    .replace(/&(amp|lt|gt);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">" })[entity]!);
  addText("initialBrief", "Initial Brief", plainText(inquiry.initialBrief));
  addText("businessObjectives", "Business Objectives", plainText(inquiry.businessObjectives));
  addText("legalNotes", "Legal Notes", plainText(inquiry.legalNotes));
  addText("deliverables", "Deliverables", inquiry.deliverables.map(({ label }) => `• ${label}`).join("\n"));
  addText("targetMarkets", "Target Markets", inquiry.targetMarkets.map(({ label }) => `• ${label}`).join("\n"));
  for (const party of inquiry.parties) {
    const label = party.role === "CLIENT" ? "Client" : `Final Beneficiary ${party.sequence + 1}`;
    const company = party.snapshotEntityType === "COMPANY";
    const details = [
      `Type: ${company ? "Company" : "Person"}`,
      party.snapshotCompany && `Company: ${party.snapshotCompany}`,
      company && party.snapshotCompanyEmail && `Company Email: ${party.snapshotCompanyEmail}`,
      company && party.snapshotCompanyPhone && `Company Contact Number: ${party.snapshotCompanyPhone}`,
      company && party.snapshotCompanyWebsite && `Company Website: ${party.snapshotCompanyWebsite}`,
      `${company ? "Representative" : "Name"}: ${party.snapshotName}`,
      party.snapshotEmail && `Email: ${party.snapshotEmail}`,
      party.snapshotPhone && `Contact Number: ${party.snapshotPhone}`,
      party.snapshotPosition && `Designation: ${party.snapshotPosition}`,
    ].filter(Boolean).join("\n");
    addText(`party:${party.role}:${party.sequence}`, label, details);
  }
  addText("projectDetails", "Project Details", [
    inquiry.clientOrigin && `Execution: ${inquiry.clientOrigin === "INTERNAL" ? "Internal" : "External"}`,
    inquiry.inquiryDate && `Inquiry Date: ${inquiry.inquiryDate.toISOString().slice(0, 10)}`,
    inquiry.deadline && `Deadline: ${inquiry.deadline.toISOString().slice(0, 10)}`,
    inquiry.priority && `Priority: ${inquiry.priority}`,
  ].filter(Boolean).join("\n"));
  return items;
}

export async function getProjectResearchImportFolders(user: ImportUser, input: ImportTarget) {
  const { access } = await assertResearchFolderWriteAccess(user, input);
  const folders = await prisma.projectResearchFolder.findMany({
    where: { workspaceId: access.workspaceId },
    select: { id: true, name: true, parentFolderId: true },
  });
  return folders.map((folder) => ({
    id: folder.id,
    name: getFolderAncestors(folders, folder.id).map((ancestor) => ancestor.name).join(" / "),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getProjectResearchImportOptions(user: ImportUser, input: ImportTarget) {
  await assertResearchFolderWriteAccess(user, input);
  const [sources, imported] = await Promise.all([
    getImportSources(input.projectId),
    prisma.projectResearchFolderFile.findMany({
      where: { folderId: input.folderId, inquiryImportKey: { not: null } },
      select: { inquiryImportKey: true },
    }),
  ]);
  const existing = new Set(imported.map((file) => file.inquiryImportKey));
  return sources.map((item): InquiryImportItem => ({
    id: item.id, kind: item.kind, title: item.title, section: item.section,
    fileName: item.fileName, mimeType: item.mimeType, size: item.size, text: item.text,
    previewPath: item.previewPath,
    alreadyImported: existing.has(item.id),
  }));
}

const importedFileSelect = {
  id: true,
  pinnedAt: true, colorLabel: true,
  attachmentId: true,
  attachment: { select: {
    storageKey: true, originalFileName: true, mimeType: true, fileSize: true, createdAt: true,
    uploadedBy: { select: { name: true, email: true } },
  } },
} satisfies Prisma.ProjectResearchFolderFileSelect;

type ImportedRecord = Prisma.ProjectResearchFolderFileGetPayload<{ select: typeof importedFileSelect }>;
function fileRecord(file: ImportedRecord) {
  return {
    id: file.id, attachmentId: file.attachmentId, name: file.attachment.originalFileName,
    pinnedAt: file.pinnedAt?.toISOString() ?? null,
    colorLabel: file.colorLabel,
    mimeType: file.attachment.mimeType, size: file.attachment.fileSize,
    uploadedAt: file.attachment.createdAt.toISOString(),
    uploadedBy: file.attachment.uploadedBy.name?.trim() || file.attachment.uploadedBy.email,
  };
}

const defaultStorage = {
  bucket: getS3BucketName, copy: copyStoredObject, write: writeTextObject, remove: deleteObjectIfNeeded,
};

export async function importProjectInquiryContent(
  user: ImportUser,
  input: ImportTarget & { itemIds: string[] },
  storage = defaultStorage,
) {
  await assertResearchFolderWriteAccess(user, input);
  if (!Array.isArray(input.itemIds) || input.itemIds.length < 1 || input.itemIds.length > 100 ||
      input.itemIds.some((id) => typeof id !== "string" || id.length > 200)) {
    throw new Error("Select between 1 and 100 Stage 1 items to import.");
  }
  const sources = await getImportSources(input.projectId);
  const sourceById = new Map(sources.map((item) => [item.id, item]));
  const ids = [...new Set(input.itemIds)];
  if (ids.some((id) => !sourceById.has(id))) {
    throw new Error("Some selected Stage 1 content has changed or is unavailable. Reopen Import and select it again.");
  }
  const files: ReturnType<typeof fileRecord>[] = [];
  const failures: Array<{ id: string; title: string; error: string }> = [];
  let skipped = 0;
  const bucket = storage.bucket();
  for (const id of ids) {
    const source = sourceById.get(id)!;
    const where = { folderId_inquiryImportKey: { folderId: input.folderId, inquiryImportKey: id } };
    const existing = await prisma.projectResearchFolderFile.findUnique({ where, select: importedFileSelect });
    if (existing) { skipped += 1; continue; }
    const fileName = `${randomUUID()}-${sanitizeFileName(source.fileName)}`;
    const storageKey = buildProjectAssetKey({
      projectId: input.projectId, researchFolderId: input.folderId,
      assetType: AttachmentAssetType.PROJECT_RESEARCH_FILE, safeFileName: fileName,
    });
    try {
      if (source.kind === "file") {
        await storage.copy({ sourceBucket: source.sourceBucket!, sourceKey: source.sourceKey!, bucket, storageKey });
      } else {
        await storage.write({ bucket, storageKey, content: source.text! });
      }
      // Recheck write access after storage work before publishing the imported file.
      await assertResearchFolderWriteAccess(user, input);
      const file = await prisma.$transaction(async (tx) => {
        const created = await tx.projectResearchFolderFile.create({
          data: {
            folder: { connect: { id: input.folderId } },
            addedBy: { connect: { id: user.id } },
            inquiryImportKey: id,
            attachment: { create: {
              projectId: input.projectId, uploadedById: user.id, fileName,
              originalFileName: source.fileName, mimeType: source.mimeType, fileSize: source.size,
              bucket, storageKey, assetType: AttachmentAssetType.PROJECT_RESEARCH_FILE, status: AttachmentStatus.READY,
            } },
          },
          select: importedFileSelect,
        });
        await tx.projectActivityLog.create({ data: {
          projectId: input.projectId, actorId: user.id, action: ActivityLogAction.ASSET_UPLOADED,
          metadata: { attachmentId: created.attachmentId, source: "STAGE_ONE_IMPORT", inquiryImportKey: id, folderId: input.folderId, fileName: source.fileName },
        } });
        return created;
      });
      files.push(fileRecord(file));
    } catch (error) {
      // A retry or concurrent request may already have committed this item.
      const committed = await prisma.projectResearchFolderFile.findUnique({ where, select: importedFileSelect });
      if (committed?.attachment.storageKey !== storageKey) {
        await storage.remove(storageKey, bucket).catch((cleanupError) => console.error("[research-import] cleanup failed", cleanupError));
      }
      if (committed) {
        if (committed.attachment.storageKey === storageKey) files.push(fileRecord(committed));
        else skipped += 1;
      } else {
        console.error("[research-import] item failed", { id, error });
        failures.push({ id, title: source.title, error: "Unable to import this item. Please try again." });
      }
    }
  }
  const folderFiles = await prisma.projectResearchFolderFile.findMany({
    where: { folderId: input.folderId, attachment: { status: AttachmentStatus.READY } },
    orderBy: { createdAt: "desc" },
    select: importedFileSelect,
  });
  return { files, skipped, failures, folderFiles: folderFiles.map(fileRecord) };
}

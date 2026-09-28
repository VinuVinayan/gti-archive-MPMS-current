import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { ensureCanonicalProjectResearchWorkspace } from "../src/lib/project-research";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";
import { getProjectResearchImportFolders, getProjectResearchImportOptions, importProjectInquiryContent } from "../src/lib/project-research-import";

const prefix = `research-import-${randomUUID()}`;
const owner = { id: `${prefix}-owner`, role: UserRole.ADMIN };
const reader = { id: `${prefix}-reader`, role: UserRole.USER };
const projectId = `${prefix}-project`;
const foreignProjectId = `${prefix}-foreign`;
const objects = new Map<string, string>();
let storageCalls = 0;
let failText = false;
const storage = {
  bucket: () => "test-destination",
  copy: async (input: { sourceBucket: string; sourceKey: string; bucket: string; storageKey: string }) => {
    storageCalls += 1;
    const content = objects.get(`${input.sourceBucket}/${input.sourceKey}`);
    if (!content) throw new Error("Missing source file");
    objects.set(`${input.bucket}/${input.storageKey}`, content);
  },
  write: async (input: { bucket: string; storageKey: string; content: string }) => {
    storageCalls += 1;
    if (failText && input.content === "Legal text") throw new Error("Simulated storage failure");
    objects.set(`${input.bucket}/${input.storageKey}`, input.content);
  },
  remove: async (key: string, bucket = "test-destination") => { objects.delete(`${bucket}/${key}`); },
};

async function main() {
  for (const user of [owner, reader]) {
    await prisma.user.create({ data: { ...user, email: `${user.id}@example.test`, passwordHash: "test", name: user.id } });
  }
  for (const id of [projectId, foreignProjectId]) {
    await prisma.project.create({ data: {
      id, name: "Import test", ownerId: owner.id, createdById: owner.id,
      executors: { create: { userId: reader.id } },
      workflowStages: { createMany: { data: getInitialProjectWorkflowStageData(new Date()).map((stage) => ({
        ...stage, status: stage.stageKey === "PROJECT_INQUIRY" ? "COMPLETED" as const : stage.stageKey === "PROJECT_RESEARCH_AND_PLANNING" ? "AVAILABLE" as const : stage.status,
      })) } },
      inquiry: { create: { initialBrief: "<p>Brief &amp; reference &lt;A&gt;</p><p>Café launch</p>", businessObjectives: "<p>Reach a new market.</p>", legalNotes: "<p>Legal text</p>", deliverables: { create: { label: "Design", normalizedLabel: "design" } } } },
    } });
    await ensureCanonicalProjectResearchWorkspace(id);
  }
  const folder = await prisma.projectResearchFolder.findFirstOrThrow({ where: { workspace: { projectId }, systemKey: "BRIEF" } });
  const otherFolder = await prisma.projectResearchFolder.findFirstOrThrow({ where: { workspace: { projectId: foreignProjectId }, systemKey: "BRIEF" } });
  const sourceIds: string[] = [];
  for (const [index, sourceProjectId, status] of [[0, projectId, "READY"], [1, projectId, "FAILED"], [2, foreignProjectId, "READY"]] as const) {
    const inquiry = await prisma.projectInquiry.findUniqueOrThrow({ where: { projectId: sourceProjectId } });
    const storageKey = `${prefix}/source-${index}.png`;
    const attachment = await prisma.projectAttachment.create({ data: {
      projectId: sourceProjectId, uploadedById: owner.id, fileName: `source-${index}.png`, originalFileName: `Reference ${index}.png`,
      mimeType: "image/png", fileSize: 5, bucket: "source-bucket", storageKey, assetType: "GENERAL_PROJECT_ASSET", status,
      inquiryAssociations: { create: { inquiryId: inquiry.id, field: "INITIAL_BRIEF" } },
    } });
    sourceIds.push(attachment.id);
    objects.set(`source-bucket/${storageKey}`, "image");
  }
  const target = { projectId, folderId: folder.id };
  const tech = await prisma.projectResearchFolder.findFirstOrThrow({ where: { workspace: { projectId }, systemKey: "TECH" } });
  const briefReferences = await prisma.projectResearchFolder.create({ data: {
    workspaceId: folder.workspaceId, parentFolderId: folder.id, name: "References", normalizedName: "references",
  } });
  const techReferences = await prisma.projectResearchFolder.create({ data: {
    workspaceId: folder.workspaceId, parentFolderId: tech.id, name: "References", normalizedName: "references",
  } });
  const destinations = await getProjectResearchImportFolders(owner, target);
  assert.ok(destinations.some((item) => item.id === folder.id && item.name === "Brief"));
  assert.ok(destinations.some((item) => item.id === tech.id && item.name === "Tech"));
  assert.ok(destinations.some((item) => item.id === briefReferences.id && item.name === "Brief / References"));
  assert.ok(destinations.some((item) => item.id === techReferences.id && item.name === "Tech / References"));
  assert.equal(destinations.some((item) => item.id === otherFolder.id), false, "Only folders from the authorized workspace are offered");
  await assert.rejects(() => getProjectResearchImportFolders(reader, target));
  await assert.rejects(() => getProjectResearchImportFolders(owner, { ...target, folderId: otherFolder.id }));
  const items = await getProjectResearchImportOptions(owner, target);
  const file = items.find((item) => item.kind === "file")!;
  const brief = items.find((item) => item.title === "Initial Brief")!;
  const objectives = items.find((item) => item.title === "Business Objectives")!;
  const legal = items.find((item) => item.title === "Legal Notes")!;
  assert.equal(items.filter((item) => item.kind === "file").length, 1, "Only ready files from this project's Stage 1 are offered");
  assert.equal(brief.text, "Brief & reference <A>\nCafé launch");
  assert.equal("sourceKey" in file, false, "Storage keys must stay server-side");
  await assert.rejects(() => getProjectResearchImportOptions(reader, target));
  await assert.rejects(() => importProjectInquiryContent(reader, { ...target, itemIds: [file.id] }, storage));
  await assert.rejects(() => importProjectInquiryContent(owner, { ...target, folderId: otherFolder.id, itemIds: [file.id] }, storage));
  await assert.rejects(() => importProjectInquiryContent(owner, { ...target, itemIds: [file.id, `file:${sourceIds[2]}`] }, storage));
  await assert.rejects(() => importProjectInquiryContent(owner, { ...target, itemIds: [] }, storage));
  assert.equal(storageCalls, 0, "Unauthorized or invalid selections must not copy anything");

  const first = await importProjectInquiryContent(owner, { ...target, itemIds: [file.id, brief.id] }, storage);
  assert.equal(first.files.length, 2);
  assert.equal(first.folderFiles.length, 2);
  assert.equal(first.failures.length, 0);
  const copies = await prisma.projectAttachment.findMany({ where: { projectId, assetType: "PROJECT_RESEARCH_FILE" } });
  const image = copies.find((item) => item.mimeType === "image/png")!;
  const text = copies.find((item) => item.mimeType === "text/plain")!;
  assert.equal(objects.get(`${image.bucket}/${image.storageKey}`), "image");
  assert.equal(objects.get(`${text.bucket}/${text.storageKey}`), brief.text);
  assert.equal(text.fileSize, Buffer.byteLength(brief.text!));
  assert.notEqual(image.id, sourceIds[0]);
  assert.notEqual(image.storageKey, `${prefix}/source-0.png`);
  const repeated = await importProjectInquiryContent(owner, { ...target, itemIds: [file.id, brief.id] }, storage);
  assert.equal(repeated.skipped, 2);
  assert.equal(repeated.files.length, 0);
  assert.equal(storageCalls, 2, "Repeated imports must not recopy content");
  assert.equal((await getProjectResearchImportOptions(owner, target)).filter((item) => item.alreadyImported).length, 2);

  failText = true;
  const failed = await importProjectInquiryContent(owner, { ...target, itemIds: [objectives.id, legal.id] }, storage);
  assert.equal(failed.failures.length, 1);
  assert.equal(failed.files.length, 1, "Successful selections must be retained when another item fails");
  assert.equal(failed.folderFiles.length, 3);
  failText = false;
  const concurrent = await Promise.all([
    importProjectInquiryContent(owner, { ...target, itemIds: [legal.id] }, storage),
    importProjectInquiryContent(owner, { ...target, itemIds: [legal.id] }, storage),
  ]);
  assert.equal(concurrent.reduce((sum, result) => sum + result.files.length, 0), 1);
  assert.equal(await prisma.projectResearchFolderFile.count({ where: { folderId: folder.id } }), 4);
  assert.equal([...objects.keys()].filter((key) => key.startsWith("test-destination/")).length, 4, "Duplicate copy objects must be cleaned up");

  await prisma.projectInquiry.update({ where: { projectId }, data: { initialBrief: "<p>Updated brief</p>" } });
  await assert.rejects(() => importProjectInquiryContent(owner, { ...target, itemIds: [brief.id] }, storage));
  const newBrief = (await getProjectResearchImportOptions(owner, target)).find((item) => item.title === "Initial Brief")!;
  assert.equal(newBrief.alreadyImported, false);
  assert.equal((await importProjectInquiryContent(owner, { ...target, itemIds: [newBrief.id] }, storage)).files.length, 1);
  assert.equal(objects.get(`${text.bucket}/${text.storageKey}`), brief.text, "Earlier imports must preserve their original text");

  const secondFolder = await prisma.projectResearchFolder.findFirstOrThrow({ where: { workspace: { projectId }, systemKey: "TECH" } });
  const secondTarget = { projectId, folderId: secondFolder.id };
  assert.equal((await getProjectResearchImportOptions(owner, secondTarget)).find((item) => item.id === file.id)?.alreadyImported, false);
  assert.equal((await importProjectInquiryContent(owner, { ...secondTarget, itemIds: [file.id] }, storage)).files.length, 1,
    "The same source may be imported independently into a different destination folder");
  const nestedTarget = { projectId, folderId: techReferences.id };
  assert.equal((await getProjectResearchImportOptions(owner, nestedTarget)).find((item) => item.id === file.id)?.alreadyImported, false);
  assert.equal((await importProjectInquiryContent(owner, { ...nestedTarget, itemIds: [file.id] }, storage)).files.length, 1);
  assert.equal(await prisma.projectResearchFolderFile.count({ where: { folderId: techReferences.id } }), 1);
  assert.equal(await prisma.projectResearchFolderFile.count({ where: { folderId: briefReferences.id } }), 0, "Imports use the selected subfolder, including when names match");
  await prisma.projectAttachment.delete({ where: { id: sourceIds[0] } });
  objects.delete(`source-bucket/${prefix}/source-0.png`);
  assert.ok(await prisma.projectAttachment.findUnique({ where: { id: image.id } }));
  assert.equal(objects.get(`${image.bucket}/${image.storageKey}`), "image", "Removing Stage 1 data must not remove the Stage 2 copy");

  await prisma.project.update({ where: { id: projectId }, data: { completedAt: new Date() } });
  await assert.rejects(() => getProjectResearchImportFolders(owner, target));
  await assert.rejects(() => getProjectResearchImportOptions(owner, target));
  await assert.rejects(() => importProjectInquiryContent(owner, { ...target, itemIds: [legal.id] }, storage));
  await prisma.project.update({ where: { id: projectId }, data: { completedAt: null } });
  await prisma.projectWorkflowStage.updateMany({ where: { projectId, stageKey: "PROJECT_RESEARCH_AND_PLANNING" }, data: { status: "LOCKED" } });
  await assert.rejects(() => getProjectResearchImportOptions(owner, target));
  console.log("Stage 1 to Stage 2 import integration checks passed.");
}

main().finally(async () => {
  await prisma.project.deleteMany({ where: { id: { in: [projectId, foreignProjectId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, reader.id] } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });

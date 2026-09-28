ALTER TABLE "ProjectResearchFolder" ADD COLUMN "parentFolderId" TEXT;
DROP INDEX "ProjectResearchFolder_workspaceId_normalizedName_key";
CREATE UNIQUE INDEX "ProjectResearchFolder_workspaceId_id_key" ON "ProjectResearchFolder"("workspaceId", "id");
CREATE UNIQUE INDEX "ProjectResearchFolder_workspaceId_parentFolderId_normalized_key" ON "ProjectResearchFolder"("workspaceId", "parentFolderId", "normalizedName");
-- PostgreSQL treats NULLs as distinct; root folders still need unique names.
CREATE UNIQUE INDEX "ProjectResearchFolder_root_name_key" ON "ProjectResearchFolder"("workspaceId", "normalizedName") WHERE "parentFolderId" IS NULL;
ALTER TABLE "ProjectResearchFolder" ADD CONSTRAINT "ProjectResearchFolder_workspaceId_parentFolderId_fkey" FOREIGN KEY ("workspaceId", "parentFolderId") REFERENCES "ProjectResearchFolder"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectResearchFolder" ADD CONSTRAINT "ProjectResearchFolder_valid_parent_check" CHECK ("parentFolderId" IS NULL OR ("parentFolderId" <> "id" AND "systemKey" IS NULL AND NOT "isSystem"));

ALTER TABLE "ProjectPrivateFolder" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'My Private Folder', ADD COLUMN "normalizedName" TEXT NOT NULL DEFAULT 'my private folder', ADD COLUMN "parentFolderId" TEXT;
DROP INDEX "ProjectPrivateFolder_projectId_ownerUserId_key";
CREATE UNIQUE INDEX "ProjectPrivateFolder_projectId_ownerUserId_id_key" ON "ProjectPrivateFolder"("projectId", "ownerUserId", "id");
CREATE UNIQUE INDEX "ProjectPrivateFolder_parentFolderId_normalizedName_key" ON "ProjectPrivateFolder"("parentFolderId", "normalizedName");
CREATE UNIQUE INDEX "ProjectPrivateFolder_root_owner_key" ON "ProjectPrivateFolder"("projectId", "ownerUserId") WHERE "parentFolderId" IS NULL;
ALTER TABLE "ProjectPrivateFolder" ADD CONSTRAINT "ProjectPrivateFolder_projectId_ownerUserId_parentFolderId_fkey" FOREIGN KEY ("projectId", "ownerUserId", "parentFolderId") REFERENCES "ProjectPrivateFolder"("projectId", "ownerUserId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectPrivateFolder" ADD CONSTRAINT "ProjectPrivateFolder_valid_parent_check" CHECK ("parentFolderId" IS NULL OR "parentFolderId" <> "id");

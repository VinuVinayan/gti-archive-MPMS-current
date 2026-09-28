ALTER TABLE "ProjectResearchFolderFile" ADD COLUMN "inquiryImportKey" TEXT;
CREATE UNIQUE INDEX "ProjectResearchFolderFile_folderId_inquiryImportKey_key"
  ON "ProjectResearchFolderFile"("folderId", "inquiryImportKey");

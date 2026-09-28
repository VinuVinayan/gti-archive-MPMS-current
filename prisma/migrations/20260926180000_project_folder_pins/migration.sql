ALTER TABLE "ProjectResearchFolder" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ProjectResearchFolderFile" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ProjectPrivateFolder" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ProjectAttachment" ADD COLUMN "pinnedAt" TIMESTAMP(3);

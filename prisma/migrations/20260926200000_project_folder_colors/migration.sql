CREATE TYPE "ProjectItemColor" AS ENUM ('RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'GREY');
ALTER TABLE "ProjectResearchFolder" ADD COLUMN "colorLabel" "ProjectItemColor";
ALTER TABLE "ProjectResearchFolderFile" ADD COLUMN "colorLabel" "ProjectItemColor";
ALTER TABLE "ProjectPrivateFolder" ADD COLUMN "colorLabel" "ProjectItemColor";
ALTER TABLE "ProjectAttachment" ADD COLUMN "colorLabel" "ProjectItemColor";

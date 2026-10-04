BEGIN;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "structureApproval" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "structureApprovedAt" TIMESTAMP(3),
ADD COLUMN     "structureApprovedById" TEXT,
ADD COLUMN     "structureRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "templateName" TEXT,
ADD COLUMN     "templateVersionId" TEXT,
ADD COLUMN     "workflowStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "templateManagementAccessGranted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "changeReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateStageDefinition" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "workspace" TEXT NOT NULL DEFAULT 'GENERAL',
    "legacyStageKey" "ProjectWorkflowStageKey",
    "description" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "guidance" TEXT NOT NULL DEFAULT '',
    "definitionOfDone" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TemplateStageDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStageInstance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceDefinitionId" TEXT,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "workspace" TEXT NOT NULL DEFAULT 'GENERAL',
    "legacyStageKey" "ProjectWorkflowStageKey",
    "description" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "guidance" TEXT NOT NULL DEFAULT '',
    "definitionOfDone" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "status" "ProjectWorkflowStageStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "content" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStageInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStructureEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStructureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplate_key_key" ON "ProjectTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplateVersion_templateId_version_key" ON "ProjectTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateStageDefinition_versionId_order_key" ON "TemplateStageDefinition"("versionId", "order");

-- CreateIndex
CREATE INDEX "ProjectStageInstance_projectId_retiredAt_status_idx" ON "ProjectStageInstance"("projectId", "retiredAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStageInstance_projectId_order_key" ON "ProjectStageInstance"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStageInstance_projectId_legacyStageKey_key" ON "ProjectStageInstance"("projectId", "legacyStageKey");

-- CreateIndex
CREATE INDEX "ProjectStructureEvent_projectId_createdAt_idx" ON "ProjectStructureEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ProjectTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTemplateVersion" ADD CONSTRAINT "ProjectTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateStageDefinition" ADD CONSTRAINT "TemplateStageDefinition_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStageInstance" ADD CONSTRAINT "ProjectStageInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStageInstance" ADD CONSTRAINT "ProjectStageInstance_sourceDefinitionId_fkey" FOREIGN KEY ("sourceDefinitionId") REFERENCES "TemplateStageDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStructureEvent" ADD CONSTRAINT "ProjectStructureEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed immutable version 1 definitions. Guidance stays empty until specified.
INSERT INTO "ProjectTemplate" ("id","key","name") VALUES ('template-packaging','PACKAGING','Packaging');
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-packaging-v1','template-packaging',1,'Packaging','Initial template definition');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-1','template-packaging-v1',1,'Project Inquiry','BRIEF','PACKAGING_INQUIRY','PROJECT_INQUIRY');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-2','template-packaging-v1',2,'Research & Planning','RESEARCH','PACKAGING_RESEARCH','PROJECT_RESEARCH_AND_PLANNING');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-3','template-packaging-v1',3,'Initial Concept','CREATIVE','PACKAGING_INITIAL_CONCEPT','CONCEPT_CREATION');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-4','template-packaging-v1',4,'Final Concept','CREATIVE','PACKAGING_FINAL_CONCEPT','PROJECT_DEVELOPMENT');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-5','template-packaging-v1',5,'File Checklist','SPECIFICATION','PACKAGING_CHECKLIST','FINAL_LAYOUT');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-6','template-packaging-v1',6,'Production & Handover','PRODUCTION','PACKAGING_PRODUCTION','PRODUCTION_AND_HANDOVER');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-7','template-packaging-v1',7,'Implementation & Supervision','ACCEPTANCE','PACKAGING_ACCEPTANCE','IMPLEMENTATION_AND_SUPERVISION');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-v1-stage-8','template-packaging-v1',8,'Commercialisation','GENERAL','GENERAL',NULL);
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-packaging-legacy','template-packaging',0,'Legacy Packaging','Initial template definition');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-1','template-packaging-legacy',1,'Project Inquiry','BRIEF','PACKAGING_INQUIRY','PROJECT_INQUIRY');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-2','template-packaging-legacy',2,'Research & Planning','RESEARCH','PACKAGING_RESEARCH','PROJECT_RESEARCH_AND_PLANNING');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-3','template-packaging-legacy',3,'Initial Concept','CREATIVE','PACKAGING_INITIAL_CONCEPT','CONCEPT_CREATION');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-4','template-packaging-legacy',4,'Final Concept','CREATIVE','PACKAGING_FINAL_CONCEPT','PROJECT_DEVELOPMENT');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-5','template-packaging-legacy',5,'File Checklist','SPECIFICATION','PACKAGING_CHECKLIST','FINAL_LAYOUT');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-6','template-packaging-legacy',6,'Production & Handover','PRODUCTION','PACKAGING_PRODUCTION','PRODUCTION_AND_HANDOVER');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-packaging-legacy-stage-7','template-packaging-legacy',7,'Implementation & Supervision','ACCEPTANCE','PACKAGING_ACCEPTANCE','IMPLEMENTATION_AND_SUPERVISION');
INSERT INTO "ProjectTemplate" ("id","key","name") VALUES ('template-posm','POSM','POSM & Promotional Materials');
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-posm-v1','template-posm',1,'POSM & Promotional Materials','Initial template definition');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-posm-v1-stage-1','template-posm-v1',1,'Brief','BRIEF','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-posm-v1-stage-2','template-posm-v1',2,'Research / Sourcing','RESEARCH','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-posm-v1-stage-3','template-posm-v1',3,'Concept & Design','CREATIVE','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-posm-v1-stage-4','template-posm-v1',4,'Specification','SPECIFICATION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-posm-v1-stage-5','template-posm-v1',5,'Production & Approval','PRODUCTION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-posm-v1-stage-6','template-posm-v1',6,'Delivery & Execution','GENERAL','GENERAL',NULL);
INSERT INTO "ProjectTemplate" ("id","key","name") VALUES ('template-retail','RETAIL','Retail Display');
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-retail-v1','template-retail',1,'Retail Display','Initial template definition');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-1','template-retail-v1',1,'Brief','BRIEF','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-2','template-retail-v1',2,'Site Survey','RESEARCH','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-3','template-retail-v1',3,'Concept','CREATIVE','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-4','template-retail-v1',4,'Technical Design','CREATIVE','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-5','template-retail-v1',5,'Specification & Graphics per Component','SPECIFICATION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-6','template-retail-v1',6,'Prototype & Production','PRODUCTION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-retail-v1-stage-7','template-retail-v1',7,'Logistics & Installation','GENERAL','GENERAL',NULL);
INSERT INTO "ProjectTemplate" ("id","key","name") VALUES ('template-exhibition','EXHIBITION','Exhibition Stand');
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-exhibition-v1','template-exhibition',1,'Exhibition Stand','Initial template definition');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-1','template-exhibition-v1',1,'Brief','BRIEF','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-2','template-exhibition-v1',2,'Planning & Organiser Manual','RESEARCH','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-3','template-exhibition-v1',3,'Contractor Selection','GENERAL','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-4','template-exhibition-v1',4,'Concept & Design','CREATIVE','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-5','template-exhibition-v1',5,'Graphics, Content & Linked Projects','SPECIFICATION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-6','template-exhibition-v1',6,'Build-up','PRODUCTION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-7','template-exhibition-v1',7,'Event','EVENT','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-exhibition-v1-stage-8','template-exhibition-v1',8,'Dismantling & Wrap-up Report','REPORT','GENERAL',NULL);
INSERT INTO "ProjectTemplate" ("id","key","name") VALUES ('template-digital','DIGITAL','Digital');
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-digital-v1','template-digital',1,'Digital','Initial template definition');
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-1','template-digital-v1',1,'Brief','BRIEF','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-2','template-digital-v1',2,'Discovery','RESEARCH','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-3','template-digital-v1',3,'UX Concept','CREATIVE','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-4','template-digital-v1',4,'UI Design','CREATIVE','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-5','template-digital-v1',5,'Specification & Content','SPECIFICATION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-6','template-digital-v1',6,'Build & Testing','TESTING','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-7','template-digital-v1',7,'Launch & Handover','PRODUCTION','GENERAL',NULL);
INSERT INTO "TemplateStageDefinition" ("id","versionId","order","name","stageType","workspace","legacyStageKey") VALUES ('template-digital-v1-stage-8','template-digital-v1',8,'Maintenance Mode','MAINTENANCE','GENERAL',NULL);
INSERT INTO "ProjectTemplate" ("id","key","name") VALUES ('template-custom','CUSTOM','Custom');
INSERT INTO "ProjectTemplateVersion" ("id","templateId","version","name","changeReason") VALUES ('template-custom-v1','template-custom',1,'Custom','Initial template definition');

-- Preserve every legacy business record and workflow timestamp. Projects without
-- a persisted fixed workflow remain unclassified rather than guessing progress.
UPDATE "Project" SET "templateVersionId" = 'template-packaging-legacy',
 "templateKey" = 'PACKAGING', "templateName" = 'Legacy Packaging'
WHERE EXISTS (SELECT 1 FROM "ProjectWorkflowStage" w WHERE w."projectId" = "Project"."id");
INSERT INTO "ProjectStageInstance" ("id","projectId","sourceDefinitionId","order","name","stageType","workspace","legacyStageKey","status","unlockedAt","completedAt","createdAt","updatedAt")
SELECT 'legacy-instance-' || p."id" || '-' || d."order",p."id",d."id",d."order",d."name",d."stageType",d."workspace",d."legacyStageKey",
 COALESCE(w."status", 'LOCKED'::"ProjectWorkflowStageStatus"),w."unlockedAt",w."completedAt",COALESCE(w."createdAt",p."createdAt"),COALESCE(w."updatedAt",p."updatedAt")
FROM "Project" p CROSS JOIN "TemplateStageDefinition" d
LEFT JOIN "ProjectWorkflowStage" w ON w."projectId" = p."id" AND w."stageKey" = d."legacyStageKey"
WHERE p."templateVersionId" = 'template-packaging-legacy' AND d."versionId" = 'template-packaging-legacy';
INSERT INTO "ProjectStructureEvent" ("id","projectId","action","reason","details")
SELECT 'legacy-snapshot-' || "id", "id", 'LEGACY_BACKFILL', 'Preserved existing Packaging workflow in place',
 jsonb_build_object('templateVersionId',"templateVersionId",'stageCount',7)
FROM "Project" WHERE "templateVersionId" = 'template-packaging-legacy';

-- Compatibility bridge: mature Packaging services remain authoritative for their
-- specialized workflow states. Mirror changes in the same transaction, including
-- undo-skip/reopen operations. Generic workspaces never write legacy state.
CREATE FUNCTION sync_packaging_stage_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_order integer;
BEGIN
 UPDATE "ProjectStageInstance" SET "status"=NEW."status", "unlockedAt"=NEW."unlockedAt",
 "completedAt"=NEW."completedAt", "updatedAt"=NEW."updatedAt", "revision"="revision"+1
 WHERE "projectId"=NEW."projectId" AND "legacyStageKey"=NEW."stageKey" AND "retiredAt" IS NULL
 RETURNING "order" INTO current_order;
 IF current_order IS NOT NULL AND NEW."status"='COMPLETED' THEN
  UPDATE "ProjectStageInstance" s SET "status"='AVAILABLE', "unlockedAt"=COALESCE(NEW."completedAt",CURRENT_TIMESTAMP), "updatedAt"=CURRENT_TIMESTAMP
  WHERE s."projectId"=NEW."projectId" AND s."order"=current_order+1 AND s."legacyStageKey" IS NULL
   AND s."retiredAt" IS NULL AND s."status"='LOCKED';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER packaging_stage_snapshot_sync AFTER INSERT OR UPDATE OF "status", "unlockedAt", "completedAt"
ON "ProjectWorkflowStage" FOR EACH ROW EXECUTE FUNCTION sync_packaging_stage_snapshot();
COMMIT;

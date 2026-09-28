ALTER TABLE "ProductionApprovalStep"
ADD COLUMN "rejectionHistory" JSONB NOT NULL DEFAULT '[]';

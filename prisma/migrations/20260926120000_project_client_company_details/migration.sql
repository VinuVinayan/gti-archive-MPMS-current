ALTER TABLE "ContactDirectoryEntry"
  ADD COLUMN "companyEmail" TEXT,
  ADD COLUMN "companyPhone" TEXT,
  ADD COLUMN "companyWebsite" TEXT;

ALTER TABLE "ProjectInquiryParty"
  ADD COLUMN "snapshotCompanyEmail" TEXT,
  ADD COLUMN "snapshotCompanyPhone" TEXT,
  ADD COLUMN "snapshotCompanyWebsite" TEXT;

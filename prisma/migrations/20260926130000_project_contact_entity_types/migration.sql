CREATE TYPE "ProjectContactEntityType" AS ENUM ('PERSON', 'COMPANY');

ALTER TABLE "ContactDirectoryEntry"
  ADD COLUMN "entityType" "ProjectContactEntityType" NOT NULL DEFAULT 'PERSON';

ALTER TABLE "ProjectInquiryParty"
  ADD COLUMN "snapshotEntityType" "ProjectContactEntityType" NOT NULL DEFAULT 'PERSON';

-- Preserve the company-first presentation of existing company clients.
UPDATE "ProjectInquiryParty"
SET "snapshotEntityType" = 'COMPANY'
WHERE "source" = 'MANUAL_CONTACT'
  AND (
    ("role" = 'CLIENT' AND NULLIF(BTRIM("snapshotCompany"), '') IS NOT NULL)
    OR "snapshotCompanyEmail" IS NOT NULL
    OR "snapshotCompanyPhone" IS NOT NULL
    OR "snapshotCompanyWebsite" IS NOT NULL
  );

UPDATE "ContactDirectoryEntry" AS contact
SET "entityType" = 'COMPANY'
WHERE contact."companyEmail" IS NOT NULL
   OR contact."companyPhone" IS NOT NULL
   OR contact."companyWebsite" IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM "ProjectInquiryParty" AS party
     WHERE party."contactId" = contact."id"
       AND party."snapshotEntityType" = 'COMPANY'
   );

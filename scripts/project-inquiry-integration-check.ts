import {
  AttachmentAssetType,
  AttachmentStatus,
  ProjectInquiryAttachmentField,
  ProjectInquiryClientOrigin,
  ProjectInquiryPartySource,
  ProjectInquiryPriority,
  ProjectWorkflowStageKey,
  ProjectWorkflowStageStatus,
  UserRole,
} from "@prisma/client";

import {
  completeProjectInquiry,
  createContactDirectoryEntry,
  getProjectInquiryPageData,
  searchProjectInquiryHistorySuggestions,
  searchProjectInquiryPartyOptions,
  type CompleteProjectInquiryInput,
} from "../src/lib/project-inquiry";
import { prisma } from "../src/lib/prisma";
import { getInitialProjectWorkflowStageData } from "../src/lib/project-workflow";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertError(
  result: Awaited<ReturnType<typeof completeProjectInquiry>>,
  field?: string,
) {
  assert("error" in result, "Expected Stage 1 completion to fail.");
  if (field) {
    assert(
      result.fieldErrors?.[field as keyof typeof result.fieldErrors],
      `Expected ${field} validation error.`,
    );
  }
}

async function assertRejected(task: Promise<unknown>, message: string) {
  try {
    await task;
  } catch {
    return;
  }
  throw new Error(message);
}

const superAdmin = {
  id: "inquiry-super-admin",
  role: UserRole.SUPER_ADMIN,
};
const outsider = {
  id: "inquiry-outsider",
  role: UserRole.USER,
};

async function createProject(id: string, name: string) {
  return prisma.project.create({
    data: {
      id,
      name,
      createdById: superAdmin.id,
      ownerId: "inquiry-owner",
      workflowStages: {
        createMany: {
          data: getInitialProjectWorkflowStageData(new Date("2026-08-01T00:00:00.000Z")),
        },
      },
    },
  });
}

function requiredParties(projectId: string): CompleteProjectInquiryInput {
  return {
    projectId,
    client: {
      source: ProjectInquiryPartySource.USER,
      id: "inquiry-client-user",
    },
    finalBeneficiaries: [
      {
        source: ProjectInquiryPartySource.USER,
        id: "inquiry-beneficiary-user",
      },
    ],
  };
}

async function stageStatus(projectId: string, stageKey: ProjectWorkflowStageKey) {
  return prisma.projectWorkflowStage.findUniqueOrThrow({
    where: { projectId_stageKey: { projectId, stageKey } },
  });
}

async function main() {
  await prisma.user.createMany({
    data: [
      {
        id: superAdmin.id,
        email: "inquiry-super-admin@example.test",
        name: "Inquiry Super Admin",
        passwordHash: "x",
        role: UserRole.SUPER_ADMIN,
      },
      {
        id: "inquiry-owner",
        email: "inquiry-owner@example.test",
        name: "Operational Owner",
        passwordHash: "x",
        role: UserRole.ADMIN,
      },
      {
        id: "inquiry-client-user",
        email: "inquiry-client@example.test",
        name: "Existing Client",
        department: "Client Company",
        passwordHash: "x",
        role: UserRole.ADMIN,
      },
      {
        id: "inquiry-beneficiary-user",
        email: "inquiry-beneficiary@example.test",
        name: "Existing Beneficiary",
        passwordHash: "x",
        role: UserRole.ADMIN,
      },
      {
        id: "inquiry-collaborator-a",
        email: "inquiry-collaborator-a@example.test",
        name: "Collaborator A",
        passwordHash: "x",
        role: UserRole.USER,
      },
      {
        id: "inquiry-collaborator-b",
        email: "inquiry-collaborator-b@example.test",
        name: "Collaborator B",
        passwordHash: "x",
        role: UserRole.USER,
      },
      {
        id: outsider.id,
        email: "inquiry-outsider@example.test",
        name: "Outsider",
        passwordHash: "x",
        role: UserRole.USER,
      },
    ],
  });

  const mainProject = await createProject("inquiry-main-project", "Rich Inquiry");
  const minimalProject = await createProject("inquiry-minimal-project", "Minimal Inquiry");
  const companyOnlyProject = await createProject("inquiry-company-only-project", "Company Only Inquiry");
  const failureProject = await createProject("inquiry-failure-project", "Failure Inquiry");
  const foreignProject = await createProject("inquiry-foreign-project", "Foreign Asset");
  const relatedUser = {
    id: "inquiry-collaborator-a",
    role: UserRole.USER,
  };
  await prisma.projectExecutor.create({
    data: {
      projectId: mainProject.id,
      userId: relatedUser.id,
      addedById: "inquiry-owner",
    },
  });
  await assertRejected(
    getProjectInquiryPageData(relatedUser, mainProject.id),
    "A related USER must not load Stage 1 manager data.",
  );
  await assertRejected(
    searchProjectInquiryHistorySuggestions(
      relatedUser,
      mainProject.id,
      "target-market",
      "",
    ),
    "A related USER must not query Stage 1 manager suggestions.",
  );

  const missingClient = await completeProjectInquiry(superAdmin, {
    ...requiredParties(failureProject.id),
    client: null,
  });
  assertError(missingClient, "client");

  const missingBeneficiary = await completeProjectInquiry(superAdmin, {
    ...requiredParties(failureProject.id),
    finalBeneficiaries: [],
  });
  assertError(missingBeneficiary, "finalBeneficiaries");

  const duplicateDeliverables = await completeProjectInquiry(superAdmin, {
    ...requiredParties(failureProject.id),
    deliverables: ["Packaging Artwork", "  packaging   artwork "],
  });
  assertError(duplicateDeliverables, "deliverables");
  assert(
    (await stageStatus(
      failureProject.id,
      ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
    )).status === ProjectWorkflowStageStatus.LOCKED,
    "A failed validation must not unlock Stage 2.",
  );

  const minimal = await completeProjectInquiry(
    superAdmin,
    requiredParties(minimalProject.id),
  );
  assert("success" in minimal, "Only Client and Final Beneficiary must be required.");
  const minimalInquiry = await prisma.projectInquiry.findUniqueOrThrow({
    where: { projectId: minimalProject.id },
    include: { parties: true, targetMarkets: true, deliverables: true },
  });
  assert(minimalInquiry.parties.length === 2, "Both required user parties must persist.");
  assert(
    minimalInquiry.clientOrigin === null &&
      minimalInquiry.initialBrief === null &&
      minimalInquiry.businessObjectives === null &&
      minimalInquiry.inquiryDate === null &&
      minimalInquiry.deadline === null &&
      minimalInquiry.legalNotes === null &&
      minimalInquiry.priority === null &&
      minimalInquiry.targetMarkets.length === 0 &&
      minimalInquiry.deliverables.length === 0,
    "All non-party Stage 1 fields must remain optional.",
  );

  const userCountBeforeContacts = await prisma.user.count();
  const contactCountBeforeInvalidAttempts = await prisma.contactDirectoryEntry.count();
  const invalidEmailContact = await createContactDirectoryEntry(
    superAdmin,
    mainProject.id,
    { name: "Invalid Email Contact", email: "abc@" },
  );
  assert(
    "error" in invalidEmailContact && Boolean(invalidEmailContact.fieldErrors?.email),
    "Server-side contact creation must reject an invalid optional email.",
  );
  const invalidPhoneContact = await createContactDirectoryEntry(
    superAdmin,
    mainProject.id,
    { name: "Invalid Phone Contact", phone: "0501234567" },
  );
  assert(
    "error" in invalidPhoneContact && Boolean(invalidPhoneContact.fieldErrors?.phone),
    "Server-side contact creation must reject a phone without an international country code.",
  );
  assert(
    (await prisma.contactDirectoryEntry.count()) === contactCountBeforeInvalidAttempts,
    "Invalid server-side contact submissions must not persist rows.",
  );
  const clientContactResult = await createContactDirectoryEntry(
    superAdmin,
    mainProject.id,
    {
      kind: "CLIENT",
      name: "Manual Client Entity",
      company: "Manual Client Company",
      companyEmail: " COMPANY@Example.Test ",
      companyPhone: "+1 (202) 555-0123",
      companyWebsite: "client.example.test",
      position: "Account Manager",
      phone: "+971 50 123 4567",
      email: " CLIENT-CONTACT@Example.Test ",
    },
  );
  assert("contact" in clientContactResult, "Manual client contact must be created.");
  assert(
    clientContactResult.contact.companyEmail === "company@example.test" &&
      clientContactResult.contact.companyPhone === "+12025550123" &&
      clientContactResult.contact.companyWebsite === "https://client.example.test/" &&
      clientContactResult.contact.phone === "+971501234567",
    "Company details must persist separately from representative details.",
  );
  const companySearch = await searchProjectInquiryPartyOptions(superAdmin, mainProject.id, "company@example.test");
  assert(companySearch.some((contact) => contact.id === clientContactResult.contact.id), "Clients must be searchable by company email.");
  const missingCompany = await createContactDirectoryEntry(superAdmin, mainProject.id, {
    kind: "CLIENT", name: "Representative", email: "rep@example.test", phone: "+971501234567", position: "Manager",
  });
  assert("error" in missingCompany && missingCompany.fieldErrors?.company, "New clients must require a company on the server.");
  const companyOnlyClient = await createContactDirectoryEntry(superAdmin, mainProject.id, {
    kind: "CLIENT", company: "Company Only Client",
  });
  assert("contact" in companyOnlyClient && companyOnlyClient.contact.name === "" &&
    companyOnlyClient.contact.email === null && companyOnlyClient.contact.phone === null && companyOnlyClient.contact.position === null,
    "A company client must save with only the company name and no invented representative.");
  assert((await searchProjectInquiryPartyOptions(superAdmin, mainProject.id, "Company Only Client")).some((contact) => contact.id === companyOnlyClient.contact.id), "Company-only clients remain searchable.");
  const companyBeneficiary = await createContactDirectoryEntry(superAdmin, mainProject.id, {
    kind: "CONTACT", entityType: "COMPANY", company: "Beneficiary Company",
    name: "Beneficiary Representative", email: "representative@example.test",
    phone: "+971501234567", position: "Director",
    companyEmail: "beneficiary@example.test", companyPhone: "+12025550123", companyWebsite: "beneficiary.example.test",
  });
  assert("contact" in companyBeneficiary && companyBeneficiary.contact.entityType === "COMPANY", "Beneficiaries must support company records.");
  const personClient = await createContactDirectoryEntry(superAdmin, mainProject.id, {
    kind: "CLIENT", entityType: "PERSON", name: "Individual Client", company: "Client Employer",
    companyEmail: "old-company@example.test", companyPhone: "not a phone", companyWebsite: "not a website",
  });
  assert("contact" in personClient && personClient.contact.entityType === "PERSON" &&
    personClient.contact.company === "Client Employer" && personClient.contact.companyEmail === null &&
    personClient.contact.companyPhone === null && personClient.contact.companyWebsite === null &&
    personClient.contact.email === null && personClient.contact.phone === null && personClient.contact.position === null,
    "Person clients must save with name and company alone and discard hidden company contact fields.");
  const personWithoutCompany = await createContactDirectoryEntry(superAdmin, mainProject.id, { kind: "CLIENT", entityType: "PERSON", name: "Individual Client" });
  assert("error" in personWithoutCompany && personWithoutCompany.fieldErrors?.company, "A person client's company is required.");
  const companyOnlyResult = await completeProjectInquiry(superAdmin, {
    projectId: companyOnlyProject.id,
    client: { source: ProjectInquiryPartySource.MANUAL_CONTACT, id: companyOnlyClient.contact.id },
    finalBeneficiaries: [{ source: ProjectInquiryPartySource.MANUAL_CONTACT, id: companyBeneficiary.contact.id }],
  });
  assert("success" in companyOnlyResult, "Stage 1 must accept a company-only client.");
  const savedCompanyOnly = (await getProjectInquiryPageData(superAdmin, companyOnlyProject.id)).inquiry?.client;
  assert(savedCompanyOnly?.entityType === "COMPANY" && savedCompanyOnly.company === "Company Only Client" && savedCompanyOnly.name === "", "Company-only clients must survive saving and reloading the inquiry.");
  const personCompanyResult = await completeProjectInquiry(superAdmin, {
    projectId: minimalProject.id,
    client: { source: ProjectInquiryPartySource.MANUAL_CONTACT, id: personClient.contact.id },
    finalBeneficiaries: [{ source: ProjectInquiryPartySource.MANUAL_CONTACT, id: companyBeneficiary.contact.id }],
  });
  assert("success" in personCompanyResult, "A person client and company beneficiary must save together.");
  const typedParties = (await getProjectInquiryPageData(superAdmin, minimalProject.id)).inquiry;
  assert(typedParties?.client?.entityType === "PERSON" && typedParties.client.name === "Individual Client" &&
    typedParties.finalBeneficiaries[0]?.entityType === "COMPANY" &&
    typedParties.finalBeneficiaries[0].company === "Beneficiary Company" &&
    typedParties.finalBeneficiaries[0].companyEmail === "beneficiary@example.test" &&
    typedParties.finalBeneficiaries[0].companyPhone === "+12025550123" &&
    typedParties.finalBeneficiaries[0].companyWebsite === "https://beneficiary.example.test/" &&
    typedParties.finalBeneficiaries[0].name === "Beneficiary Representative",
    "Reloaded clients and beneficiaries must preserve their type and separate company/individual fields.");
  await prisma.contactDirectoryEntry.update({ where: { id: companyBeneficiary.contact.id }, data: { entityType: "PERSON" } });
  assert((await getProjectInquiryPageData(superAdmin, minimalProject.id)).inquiry?.finalBeneficiaries[0].entityType === "COMPANY",
    "A saved beneficiary's type must remain snapshotted after directory changes.");
  const beneficiaryContactResult = await createContactDirectoryEntry(
    superAdmin,
    mainProject.id,
    {
      name: "Manual Beneficiary",
      position: "Stakeholder",
      phone: "+971 50 000 0000",
    },
  );
  assert("contact" in beneficiaryContactResult, "Manual beneficiary contact must be created.");
  assert(
    clientContactResult.contact.email === "client-contact@example.test" &&
      beneficiaryContactResult.contact.phone === "+971500000000",
    "Manual contacts must persist normalized lowercase email and E.164-style phone values.",
  );
  assert(
    (await prisma.user.count()) === userCountBeforeContacts,
    "Manual contacts must not create authentication users.",
  );

  const attachments = await Promise.all([
    prisma.projectAttachment.create({
      data: {
        projectId: mainProject.id,
        uploadedById: superAdmin.id,
        fileName: "brief.pdf",
        originalFileName: "brief.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
        bucket: "integration",
        storageKey: "integration/inquiry/brief.pdf",
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
        status: AttachmentStatus.READY,
      },
    }),
    prisma.projectAttachment.create({
      data: {
        projectId: mainProject.id,
        uploadedById: superAdmin.id,
        fileName: "objectives.txt",
        originalFileName: "objectives.txt",
        mimeType: "text/plain",
        fileSize: 50,
        bucket: "integration",
        storageKey: "integration/inquiry/objectives.txt",
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
        status: AttachmentStatus.READY,
      },
    }),
    prisma.projectAttachment.create({
      data: {
        projectId: mainProject.id,
        uploadedById: superAdmin.id,
        fileName: "legal.pdf",
        originalFileName: "legal.pdf",
        mimeType: "application/pdf",
        fileSize: 80,
        bucket: "integration",
        storageKey: "integration/inquiry/legal.pdf",
        assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
        status: AttachmentStatus.READY,
      },
    }),
  ]);
  const foreignAttachment = await prisma.projectAttachment.create({
    data: {
      projectId: foreignProject.id,
      uploadedById: superAdmin.id,
      fileName: "foreign.pdf",
      originalFileName: "foreign.pdf",
      mimeType: "application/pdf",
      fileSize: 80,
      bucket: "integration",
      storageKey: "integration/inquiry/foreign.pdf",
      assetType: AttachmentAssetType.GENERAL_PROJECT_ASSET,
      status: AttachmentStatus.READY,
    },
  });

  const richInput: CompleteProjectInquiryInput = {
    projectId: mainProject.id,
    client: {
      source: ProjectInquiryPartySource.MANUAL_CONTACT,
      id: clientContactResult.contact.id,
    },
    finalBeneficiaries: [
      {
        source: ProjectInquiryPartySource.MANUAL_CONTACT,
        id: beneficiaryContactResult.contact.id,
      },
      {
        source: ProjectInquiryPartySource.USER,
        id: "inquiry-beneficiary-user",
      },
    ],
    clientOrigin: ProjectInquiryClientOrigin.EXTERNAL,
    targetMarkets: [
      { label: "United Arab Emirates" },
      { label: "GCC" },
      { label: "All Countries" },
    ],
    initialBrief: "Persisted initial brief",
    businessObjectives: "Persisted business objectives",
    deliverables: ["Packaging Artwork", "Signature Artwork"],
    inquiryDate: "2026-08-07",
    deadline: "2026-09-21",
    legalNotes: "Persisted legal notes",
    priority: ProjectInquiryPriority.HIGH,
    attachmentIds: {
      INITIAL_BRIEF: [attachments[0].id],
      BUSINESS_OBJECTIVES: [attachments[1].id],
      LEGAL_NOTES: [attachments[2].id],
    },
  };

  const richResult = await completeProjectInquiry(superAdmin, richInput);
  assert("success" in richResult, "SUPER_ADMIN must be able to complete Stage 1.");
  const persisted = await prisma.projectInquiry.findUniqueOrThrow({
    where: { projectId: mainProject.id },
    include: {
      parties: true,
      targetMarkets: { orderBy: { createdAt: "asc" } },
      deliverables: { orderBy: { createdAt: "asc" } },
      attachments: true,
    },
  });
  const savedClient = persisted.parties.find((party) => party.role === "CLIENT");
  assert(savedClient?.snapshotEntityType === "COMPANY" && savedClient.snapshotCompany === "Manual Client Company" &&
    savedClient.snapshotCompanyEmail === "company@example.test" &&
    savedClient.snapshotCompanyPhone === "+12025550123" &&
    savedClient.snapshotCompanyWebsite === "https://client.example.test/" &&
    savedClient.snapshotName === "Manual Client Entity" &&
    savedClient.snapshotEmail === "client-contact@example.test" &&
    savedClient.snapshotPhone === "+971501234567" &&
    savedClient.snapshotPosition === "Account Manager", "All eight client fields must survive saving Stage 1.");
  await prisma.contactDirectoryEntry.update({ where: { id: clientContactResult.contact.id }, data: { companyEmail: "changed@example.test" } });
  const reloadedClient = (await getProjectInquiryPageData(superAdmin, mainProject.id)).inquiry?.client;
  assert(reloadedClient?.companyEmail === "company@example.test" && reloadedClient.companyPhone === "+12025550123" && reloadedClient.companyWebsite === "https://client.example.test/", "Saved projects must retain their own company contact snapshot after directory changes.");
  assert(
    persisted.initialBrief === "<p>Persisted initial brief</p>",
    "Initial Brief must persist.",
  );
  assert(
    persisted.businessObjectives === "<p>Persisted business objectives</p>",
    "Business Objectives must persist.",
  );
  assert(
    persisted.legalNotes === "<p>Persisted legal notes</p>",
    "Legal Notes must persist.",
  );
  assert(persisted.targetMarkets.length === 3, "Multiple target markets must persist.");
  assert(
    persisted.targetMarkets.some(
      (market) => market.label === "United Arab Emirates" && market.kind === "COUNTRY",
    ) &&
      persisted.targetMarkets.some(
        (market) => market.label === "GCC" && market.kind === "REGION",
      ) &&
      persisted.targetMarkets.some(
        (market) => market.label === "All Countries" && market.kind === "GLOBAL",
      ),
    "Countries, custom regions, and All Countries must be classified correctly.",
  );
  assert(persisted.deliverables.length === 2, "Multiple deliverables must persist.");
  assert(
    persisted.inquiryDate?.toISOString().slice(0, 10) === "2026-08-07",
    "Inquiry Date must persist without timezone-day shift.",
  );
  assert(
    persisted.deadline?.toISOString().slice(0, 10) === "2026-09-21",
    "Deadline must persist with DATE semantics.",
  );
  assert(persisted.priority === ProjectInquiryPriority.HIGH, "Priority must persist.");
  assert(
    persisted.attachments.length === 3 &&
      persisted.attachments.some(
        (item) =>
          item.attachmentId === attachments[0].id &&
          item.field === ProjectInquiryAttachmentField.INITIAL_BRIEF,
      ) &&
      persisted.attachments.some(
        (item) =>
          item.attachmentId === attachments[1].id &&
          item.field === ProjectInquiryAttachmentField.BUSINESS_OBJECTIVES,
      ) &&
      persisted.attachments.some(
        (item) =>
          item.attachmentId === attachments[2].id &&
          item.field === ProjectInquiryAttachmentField.LEGAL_NOTES,
      ),
    "Attachments must associate with their exact Stage 1 fields.",
  );
  assert(
    persisted.parties.filter(
      (party) => party.role === "FINAL_BENEFICIARY",
    ).length === 2,
    "Multiple final beneficiaries must persist.",
  );
  assert(
    (await prisma.projectCollaborator.count({ where: { projectId: mainProject.id } })) === 0,
    "Stage 1 must not change project collaborators selected during project creation.",
  );
  assert(
    (await prisma.notification.count({
      where: {
        projectId: mainProject.id,
        userId: { in: ["inquiry-client-user", "inquiry-beneficiary-user"] },
      },
    })) === 0,
    "Client and beneficiary selections must never create notifications.",
  );

  const stageOneAfterSuccess = await stageStatus(
    mainProject.id,
    ProjectWorkflowStageKey.PROJECT_INQUIRY,
  );
  const stageTwoAfterSuccess = await stageStatus(
    mainProject.id,
    ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
  );
  assert(
    stageOneAfterSuccess.status === ProjectWorkflowStageStatus.COMPLETED &&
      stageOneAfterSuccess.completedAt,
    "Successful completion must mark Stage 1 COMPLETED.",
  );
  assert(
    stageTwoAfterSuccess.status === ProjectWorkflowStageStatus.AVAILABLE &&
      stageTwoAfterSuccess.unlockedAt,
    "Successful completion must unlock Stage 2.",
  );
  const laterStages = await prisma.projectWorkflowStage.findMany({
    where: {
      projectId: mainProject.id,
      stageKey: {
        notIn: [
          ProjectWorkflowStageKey.PROJECT_INQUIRY,
          ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
        ],
      },
    },
  });
  assert(
    laterStages.length === 5 &&
      laterStages.every((stage) => stage.status === ProjectWorkflowStageStatus.LOCKED),
    "Stages 3-7 must remain LOCKED.",
  );

  const stageOneCompletionTime = stageOneAfterSuccess.completedAt?.getTime();
  const repeated = await completeProjectInquiry(superAdmin, {
    ...richInput,
    businessObjectives: "Updated after Stage 1 completion",
    deadline: "2026-10-01",
  });
  assert(
    "success" in repeated && repeated.alreadyCompleted,
    "Editing a completed Stage 1 must save without retriggering completion.",
  );
  const editedCompletedInquiry = await prisma.projectInquiry.findUniqueOrThrow({
    where: { projectId: mainProject.id },
  });
  assert(
    editedCompletedInquiry.businessObjectives ===
      "<p>Updated after Stage 1 completion</p>" &&
      editedCompletedInquiry.deadline?.toISOString().slice(0, 10) === "2026-10-01",
    "Authorized edits after Stage 1 completion must persist permitted inquiry fields.",
  );
  assert(
    (await prisma.projectInquiryTargetMarket.count({
      where: { inquiryId: persisted.id },
    })) === 3 &&
      (await prisma.projectInquiryDeliverable.count({
        where: { inquiryId: persisted.id },
      })) === 2 &&
      (await prisma.projectInquiryAttachment.count({
        where: { inquiryId: persisted.id },
      })) === 3,
    "Repeated completion must not duplicate child or attachment rows.",
  );
  assert(
    (await stageStatus(mainProject.id, ProjectWorkflowStageKey.PROJECT_INQUIRY)).completedAt?.getTime() ===
      stageOneCompletionTime,
    "Editing completed Stage 1 data must preserve the original completion time.",
  );

  const reopened = await getProjectInquiryPageData(superAdmin, mainProject.id);
  assert(
    reopened.inquiry?.client?.name === "Manual Client Entity" &&
      reopened.inquiry.finalBeneficiaries.length === 2 &&
      reopened.inquiry.finalBeneficiaries[0]?.name === "Manual Beneficiary" &&
      reopened.inquiry.targetMarkets.length === 3 &&
      reopened.inquiry.deliverables.length === 2 &&
      reopened.inquiry.attachments.INITIAL_BRIEF.length === 1,
    "Reopening Stage 1 must prefill all persisted values.",
  );
  const [marketSuggestions, deliverableSuggestions] = await Promise.all([
    searchProjectInquiryHistorySuggestions(
      superAdmin,
      mainProject.id,
      "target-market",
      "GCC",
    ),
    searchProjectInquiryHistorySuggestions(
      superAdmin,
      mainProject.id,
      "deliverable",
      "Packaging",
    ),
  ]);
  assert(
    marketSuggestions.includes("GCC") &&
      deliverableSuggestions.includes("Packaging Artwork"),
    "Persisted target-market and deliverable values must appear in history suggestions.",
  );

  const switchPartySources = await completeProjectInquiry(superAdmin, {
    ...richInput,
    client: {
      source: ProjectInquiryPartySource.USER,
      id: "inquiry-client-user",
    },
    finalBeneficiaries: [
      {
        source: ProjectInquiryPartySource.USER,
        id: "inquiry-beneficiary-user",
      },
    ],
  });
  assert("success" in switchPartySources, "Existing users must be valid parties.");
  const switchedParties = await prisma.projectInquiryParty.findMany({
    where: { inquiryId: persisted.id },
  });
  assert(
    switchedParties.length === 2 &&
      switchedParties.every(
        (party) => party.source === ProjectInquiryPartySource.USER && party.userId,
      ),
    "Existing user Client and Final Beneficiary selections must be explicit and snapshotted.",
  );
  assert(
    (await prisma.notification.count({
      where: {
        projectId: mainProject.id,
        userId: { in: ["inquiry-client-user", "inquiry-beneficiary-user"] },
      },
    })) === 0,
    "Selecting existing users as Client or Final Beneficiary must not notify them.",
  );

  const injectionResult = await completeProjectInquiry(superAdmin, {
    ...requiredParties(failureProject.id),
    attachmentIds: { INITIAL_BRIEF: [foreignAttachment.id] },
  });
  assertError(injectionResult, "attachments");
  assert(
    (await stageStatus(
      failureProject.id,
      ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
    )).status === ProjectWorkflowStageStatus.LOCKED,
    "Cross-project attachment injection must not unlock Stage 2.",
  );

  const unauthorized = await completeProjectInquiry(outsider, requiredParties(mainProject.id));
  assertError(unauthorized);

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_inquiry_market_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW."label" = 'Force rollback' THEN
        RAISE EXCEPTION 'forced inquiry transaction failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_inquiry_market_insert
    BEFORE INSERT ON "ProjectInquiryTargetMarket"
    FOR EACH ROW EXECUTE FUNCTION fail_inquiry_market_insert()
  `);
  let transactionFailed = false;
  try {
    await completeProjectInquiry(superAdmin, {
      ...requiredParties(failureProject.id),
      targetMarkets: [{ label: "Force rollback" }],
    });
  } catch {
    transactionFailed = true;
  }
  assert(transactionFailed, "A forced nested failure must reach the transaction boundary.");
  assert(
    (await prisma.projectInquiry.count({ where: { projectId: failureProject.id } })) === 0 &&
      (await prisma.projectCollaborator.count({ where: { projectId: failureProject.id } })) === 0 &&
      (await stageStatus(
        failureProject.id,
        ProjectWorkflowStageKey.PROJECT_INQUIRY,
      )).status === ProjectWorkflowStageStatus.AVAILABLE &&
      (await stageStatus(
        failureProject.id,
        ProjectWorkflowStageKey.PROJECT_RESEARCH_AND_PLANNING,
      )).status === ProjectWorkflowStageStatus.LOCKED,
    "A transaction failure must roll back inquiry, collaborator, and workflow mutations.",
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER fail_inquiry_market_insert ON "ProjectInquiryTargetMarket"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION fail_inquiry_market_insert()`);

  await prisma.projectCollaborator.create({
    data: {
      projectId: mainProject.id,
      userId: "inquiry-collaborator-a",
      addedById: superAdmin.id,
    },
  });
  const preserveProjectCollaborators = await completeProjectInquiry(
    superAdmin,
    richInput,
  );
  assert(
    "success" in preserveProjectCollaborators,
    "Stage 1 updates must preserve project collaborator assignments.",
  );
  assert(
    (await prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: {
          projectId: mainProject.id,
          userId: "inquiry-collaborator-a",
        },
      },
    })) !== null,
    "Stage 1 must not remove an existing project collaborator.",
  );

  assert(
    (await prisma.projectStage.count({
      where: { projectId: { in: [mainProject.id, minimalProject.id, failureProject.id] } },
    })) === 0,
    "V2 Stage 1 must not create legacy dynamic ProjectStage rows.",
  );

  console.log("Project Inquiry database integration checks passed (requirements 5-40). ");
}

main()
  .finally(async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_inquiry_market_insert ON "ProjectInquiryTargetMarket"`,
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS fail_inquiry_market_insert()`,
    ).catch(() => undefined);
    await prisma.project.deleteMany({
      where: {
        id: {
          in: [
            "inquiry-main-project",
            "inquiry-minimal-project",
            "inquiry-company-only-project",
            "inquiry-failure-project",
            "inquiry-foreign-project",
          ],
        },
      },
    });
    await prisma.contactDirectoryEntry.deleteMany({
      where: { createdById: superAdmin.id },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            superAdmin.id,
            "inquiry-owner",
            "inquiry-client-user",
            "inquiry-beneficiary-user",
            "inquiry-collaborator-a",
            "inquiry-collaborator-b",
            outsider.id,
          ],
        },
      },
    });
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

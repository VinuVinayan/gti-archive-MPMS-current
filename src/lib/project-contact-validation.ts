export type ProjectContactEntityType = "PERSON" | "COMPANY";

export type ProjectContactInput = {
  kind?: "CLIENT" | "CONTACT";
  entityType?: ProjectContactEntityType;
  name?: string;
  company?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyWebsite?: string;
  position?: string;
  email?: string;
  phone?: string;
};

export type ProjectContactField = Exclude<keyof ProjectContactInput, "kind">;
export type ProjectContactFieldErrors = Partial<Record<ProjectContactField, string>>;

export function getRequiredProjectContactFields(
  input: Pick<ProjectContactInput, "kind" | "entityType">,
): readonly ProjectContactField[] {
  if (input.kind === "CLIENT") {
    return input.entityType === "PERSON" ? ["name", "company"] : ["company"];
  }
  if (input.entityType === "COMPANY") return ["company", "name", "email", "phone", "position"];
  if (input.entityType === "PERSON") return ["name", "email", "phone", "position"];
  return ["name"];
}

const MAX_CONTACT_NAME_LENGTH = 160;
const MAX_CONTACT_COMPANY_LENGTH = 160;
const MAX_CONTACT_POSITION_LENGTH = 160;
const MAX_CONTACT_EMAIL_LENGTH = 254;
const MAX_CONTACT_PHONE_LENGTH = 50;
const EMAIL_LOCAL_PART_PATTERN = /^[^\s@]+$/;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const INTERNATIONAL_PHONE_INPUT_PATTERN = /^[+\d\s().-]+$/;
const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeProjectContactEmail(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

export function isValidProjectContactEmail(value: string) {
  const email = normalizeProjectContactEmail(value);

  if (!email || email.length > MAX_CONTACT_EMAIL_LENGTH) {
    return false;
  }

  const separatorIndex = email.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex !== email.indexOf("@")) {
    return false;
  }

  const localPart = email.slice(0, separatorIndex);
  const domain = email.slice(separatorIndex + 1);
  const domainLabels = domain.split(".");

  return (
    localPart.length <= 64 &&
    EMAIL_LOCAL_PART_PATTERN.test(localPart) &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    domainLabels.length >= 2 &&
    domainLabels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        EMAIL_DOMAIN_LABEL_PATTERN.test(label),
    )
  );
}

export function normalizeInternationalPhone(value: string) {
  const phone = value.trim();
  const hasLeadingPlus = phone.startsWith("+");

  if (
    !phone ||
    phone.length > MAX_CONTACT_PHONE_LENGTH ||
    (phone.match(/\+/g)?.length ?? 0) !== (hasLeadingPlus ? 1 : 0) ||
    !INTERNATIONAL_PHONE_INPUT_PATTERN.test(phone)
  ) {
    return null;
  }

  const normalized = `+${(hasLeadingPlus ? phone.slice(1) : phone).replace(/[^\d]/g, "")}`;
  return E164_PHONE_PATTERN.test(normalized) ? normalized : null;
}

export function validateProjectContactInput(input: ProjectContactInput) {
  const fieldErrors: ProjectContactFieldErrors = {};
  const requiredFields = getRequiredProjectContactFields(input);
  const entityType = input.entityType ?? (input.kind === "CLIENT" ? "COMPANY" : "PERSON");
  const isCompany = entityType === "COMPANY";
  if (entityType !== "PERSON" && entityType !== "COMPANY") {
    fieldErrors.entityType = "Select Person or Company.";
  }
  const name = normalizeWhitespace(input.name ?? "");
  const company = normalizeWhitespace(input.company ?? "");
  const position = normalizeWhitespace(input.position ?? "");
  const email = normalizeProjectContactEmail(input.email ?? "");
  const rawPhone = input.phone?.trim() ?? "";
  const phone = rawPhone ? normalizeInternationalPhone(rawPhone) : "";
  const companyEmail = isCompany ? normalizeProjectContactEmail(input.companyEmail ?? "") : "";
  const rawCompanyPhone = isCompany ? input.companyPhone?.trim() ?? "" : "";
  const companyPhone = rawCompanyPhone ? normalizeInternationalPhone(rawCompanyPhone) : "";
  const rawWebsite = isCompany ? input.companyWebsite?.trim() ?? "" : "";
  let companyWebsite = rawWebsite;

  if (rawWebsite) {
    try {
      const url = new URL(
        /^[a-z][a-z\d+.-]*:/i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`,
      );
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname.includes(".") ||
        !url.hostname.split(".").every((label) => EMAIL_DOMAIN_LABEL_PATTERN.test(label)) ||
        url.username || url.password ||
        rawWebsite.length > 2048 || /\s/.test(rawWebsite)
      ) {
        throw new Error("Invalid website");
      }
      companyWebsite = url.href;
    } catch {
      fieldErrors.companyWebsite = "Enter a valid company website, e.g. https://example.com.";
    }
  }

  if (requiredFields.includes("company") && !company) fieldErrors.company = "Company name is required.";
  if (requiredFields.includes("email") && !email) fieldErrors.email = isCompany ? "Representative email is required." : "Email is required.";
  if (requiredFields.includes("phone") && !rawPhone) fieldErrors.phone = isCompany ? "Representative contact number is required." : "Contact number is required.";
  if (requiredFields.includes("position") && !position) fieldErrors.position = isCompany ? "Representative designation is required." : "Designation is required.";

  if (requiredFields.includes("name") && !name) {
    fieldErrors.name = isCompany
      ? "Contact person / representative is required."
      : "Name is required.";
  } else if (name.length > MAX_CONTACT_NAME_LENGTH) {
    fieldErrors.name = `Keep the name under ${MAX_CONTACT_NAME_LENGTH} characters.`;
  }

  if (company.length > MAX_CONTACT_COMPANY_LENGTH) {
    fieldErrors.company = `Keep the company under ${MAX_CONTACT_COMPANY_LENGTH} characters.`;
  }

  if (position.length > MAX_CONTACT_POSITION_LENGTH) {
    fieldErrors.position = `Keep the position under ${MAX_CONTACT_POSITION_LENGTH} characters.`;
  }

  if (email && !isValidProjectContactEmail(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (rawPhone && !phone) {
    fieldErrors.phone =
      "Enter a valid international phone number including country code.";
  }

  if (companyEmail && !isValidProjectContactEmail(companyEmail)) {
    fieldErrors.companyEmail = "Enter a valid company email address.";
  }
  if (rawCompanyPhone && !companyPhone) {
    fieldErrors.companyPhone = "Enter a valid international phone number including country code.";
  }

  return {
    fieldErrors,
    data: {
      kind: input.kind ?? "CONTACT",
      entityType,
      name,
      company,
      companyEmail,
      companyPhone: companyPhone ?? "",
      companyWebsite,
      position,
      email,
      phone: phone ?? "",
    },
  };
}

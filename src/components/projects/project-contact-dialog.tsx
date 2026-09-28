"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CreateContactDirectoryEntryInput } from "@/lib/project-inquiry";
import { getRequiredProjectContactFields } from "@/lib/project-contact-validation";

export type ProjectContactForm = Required<Omit<CreateContactDirectoryEntryInput, "kind">>;

type ProjectContactDialogProps = {
  kind: "CLIENT" | "CONTACT";
  isOpen: boolean;
  title: string;
  description: string;
  submitLabel: string;
  form: ProjectContactForm;
  fieldErrors?: Partial<Record<keyof ProjectContactForm, string>>;
  error?: string;
  saving?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: <K extends keyof ProjectContactForm>(
    field: K,
    value: ProjectContactForm[K],
  ) => void;
};

type ContactField = Exclude<keyof ProjectContactForm, "entityType">;
const contactFields: Record<ProjectContactForm["entityType"], ReadonlyArray<readonly [ContactField, string, string]>> = {
  COMPANY: [
    ["company", "Company Name", "Company or organisation"],
    ["companyEmail", "Company Email ID", "company@example.com"],
    ["companyPhone", "Company Contact Number", "+971 ..."],
    ["companyWebsite", "Company Website", "https://example.com"],
    ["name", "Contact Person / Representative", "Representative full name"],
    ["email", "Representative Email", "name@example.com"],
    ["phone", "Representative Contact Number", "+971 ..."],
    ["position", "Representative Designation", "Role or position"],
  ],
  PERSON: [
    ["company", "Company Name (if applicable)", "Company or organisation"],
    ["name", "Full Name", "Individual / contact person’s full name"],
    ["email", "Email", "name@example.com"],
    ["phone", "Contact Number", "+971 ..."],
    ["position", "Designation", "Role or position"],
  ],
};

export function ProjectContactDialog({
  kind,
  isOpen,
  title,
  description,
  submitLabel,
  form,
  fieldErrors,
  error,
  saving = false,
  onClose,
  onSubmit,
  onChange,
}: ProjectContactDialogProps) {
  const inputRefs = useRef<
    Partial<Record<keyof ProjectContactForm, HTMLInputElement | null>>
  >({});

  const isCompany = form.entityType === "COMPANY";
  const requiredFields = getRequiredProjectContactFields({ kind, entityType: form.entityType });
  const fields = contactFields[form.entityType].map(([field, label, placeholder]) => [
    field,
    field === "company" && kind === "CLIENT" ? "Company Name" : label,
    placeholder,
    requiredFields.includes(field),
  ] as const);

  useEffect(() => {
    const firstInvalidField = contactFields[form.entityType]
      .map(([field]) => field)
      .find((field) => Boolean(fieldErrors?.[field]));

    if (firstInvalidField) {
      inputRefs.current[firstInvalidField]?.focus();
    }
  }, [fieldErrors, form.entityType]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-[#112118]/45 px-4 py-6 backdrop-blur-[2px] sm:items-center sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-contact-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <Card className="max-h-[calc(100vh-3rem)] w-full max-w-[660px] overflow-y-auto rounded-[26px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardContent className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="project-contact-dialog-title"
                className="text-[23px] font-[740] tracking-[-0.03em] text-[#111712]"
              >
                {title}
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-[#6a746d]">
                {description}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onClose}
              disabled={saving}
              className="shrink-0 border border-line shadow-none"
              aria-label="Close contact dialog"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {error ? (
            <div className="mt-5 rounded-[16px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#ae4742]">
              {error}
            </div>
          ) : null}

          <fieldset className="mt-6" disabled={saving}>
            <legend className="mb-2 text-[13px] font-[650] text-[#2d372f]">Type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["PERSON", "COMPANY"] as const).map((entityType) => (
                <label key={entityType} className="cursor-pointer">
                  <input
                    type="radio"
                    name="project-contact-entity-type"
                    value={entityType}
                    checked={form.entityType === entityType}
                    onChange={() => onChange("entityType", entityType)}
                    className="peer sr-only"
                    aria-describedby={fieldErrors?.entityType ? "project-contact-entityType-error" : undefined}
                  />
                  <span className="block rounded-[12px] border border-[#dce3dc] px-4 py-3 text-center text-[13px] font-[650] text-[#677269] peer-checked:border-[#2d7b51] peer-checked:bg-[#edf6ef] peer-checked:text-[#2d7b51] peer-focus-visible:ring-2 peer-focus-visible:ring-brand/35 peer-disabled:opacity-60">
                    {entityType === "PERSON" ? "Person" : "Company"}
                  </span>
                </label>
              ))}
            </div>
            {fieldErrors?.entityType ? (
              <p id="project-contact-entityType-error" role="alert" className="mt-2 text-[12px] text-[#b84e48]">{fieldErrors.entityType}</p>
            ) : null}
          </fieldset>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {fields.map(([field, label, placeholder, required]) => (
              <label
                key={field}
                className={!isCompany && field === "company" ? "space-y-2 sm:col-span-2" : "space-y-2"}
              >
                <span className="block text-[13px] font-[650] text-[#2d372f]">
                  {label}
                  {required ? <span className="ml-1 text-[#bd4d48]">*</span> : <span className="ml-1 font-normal text-[#7b857e]">(Optional)</span>}
                </span>
                <Input
                  ref={(element) => {
                    inputRefs.current[field] = element;
                  }}
                  type={field === "email" || field === "companyEmail" ? "email" : field === "phone" || field === "companyPhone" ? "tel" : field === "companyWebsite" ? "url" : "text"}
                  aria-required={required}
                  disabled={saving}
                  value={form[field]}
                  onChange={(event) => onChange(field, event.target.value)}
                  placeholder={placeholder}
                  aria-invalid={Boolean(fieldErrors?.[field])}
                  aria-describedby={
                    fieldErrors?.[field]
                      ? `project-contact-${field}-error`
                      : field === "phone" || field === "companyPhone"
                        ? `project-contact-${field}-help`
                        : undefined
                  }
                  className={`h-12 rounded-[14px] border bg-white shadow-none ${
                    fieldErrors?.[field] ? "border-[#c85c54]" : "border-[#dce3dc]"
                  }`}
                />
                {fieldErrors?.[field] ? (
                  <span
                    id={`project-contact-${field}-error`}
                    role="alert"
                    className="block text-[12px] text-[#b84e48]"
                  >
                    {fieldErrors[field]}
                  </span>
                ) : null}
                {field === "phone" || field === "companyPhone" ? (
                  <span
                    id={`project-contact-${field}-help`}
                    className="block text-[11px] text-[#78837b]"
                  >
                    Include country code, e.g. +971, +91, +44.
                  </span>
                ) : null}
              </label>
            ))}
          </div>

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
              className="rounded-[13px] shadow-none"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={saving}
              className="rounded-[13px]"
            >
              {saving ? "Adding..." : submitLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

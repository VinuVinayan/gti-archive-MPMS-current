"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  Archive,
  Check,
  FolderKanban,
  ImagePlus,
  Pencil,
  Plus,
  Tags,
  Trash2,
  X,
} from "lucide-react";

import {
  deleteAssetTagAction,
  deleteArchiveCategoryAction,
  deleteProjectStatusGroupAction,
  deleteProjectStatusAction,
  deleteProjectCategoryAction,
  deleteProjectTagAction,
  saveAssetTagAction,
  saveArchiveCategoryAction,
  saveProjectCategoryAction,
  saveProjectStatusGroupAction,
  saveProjectStatusAction,
  saveProjectTagAction,
} from "@/app/(dashboard)/settings/project-master-data/actions";
import {
  ArchiveCategoryIconGlyph,
  archiveCategoryIconOptions,
  getArchiveCategoryIconImageSrc,
} from "@/components/archives/archive-data";
import type {
  ArchiveCategoryMasterDataRecord,
  ProjectMasterDataItemRecord,
  ProjectMasterDataSummary,
  ProjectStatusGroupMasterDataRecord,
  ProjectStatusMasterDataRecord,
} from "@/lib/project-master-data";
import { PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH } from "@/lib/project-master-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showErrorToast, showSuccessToast } from "@/lib/toast";
import {
  PROFILE_IMAGE_ALLOWED_EXTENSIONS,
  PROFILE_IMAGE_ALLOWED_MIME_TYPES,
  buildFileTypeNotAllowedPayload,
  formatUploadFileTypeError,
  getUploadErrorMessage,
  type UploadFileTypeErrorPayload,
} from "@/lib/upload-validation";

type MasterDataTab =
  | "categories"
  | "projectStatusGroups"
  | "projectStatuses"
  | "tags"
  | "assetTags"
  | "archiveCategories";

type MasterDataFormState = {
  id?: string;
  name: string;
  description: string;
  color: string;
  slug: string;
  iconUrl: string;
  iconKey: string;
  parentId: string;
  groupId: string;
  sortOrder: string;
  isActive: boolean;
  allowedUserIds: string[];
};

type MasterDataFieldErrors = {
  name?: string;
  description?: string;
  slug?: string;
  groupId?: string;
  sortOrder?: string;
};

type ProjectMasterDataWorkspaceProps = {
  categories: ProjectMasterDataItemRecord[];
  projectStatusGroups: ProjectStatusGroupMasterDataRecord[];
  projectStatuses: ProjectStatusMasterDataRecord[];
  tags: ProjectMasterDataItemRecord[];
  assetTags: ProjectMasterDataItemRecord[];
  archiveCategories: ArchiveCategoryMasterDataRecord[];
  archiveCategoryAccessUsers: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  summary: ProjectMasterDataSummary;
  canManageItems: boolean;
  canDeleteItems: boolean;
};

type DeleteTarget = {
  tab: MasterDataTab;
  item:
    | ProjectMasterDataItemRecord
    | ProjectStatusGroupMasterDataRecord
    | ProjectStatusMasterDataRecord
    | ArchiveCategoryMasterDataRecord;
} | null;

type MasterDataTableItem =
  | ProjectMasterDataItemRecord
  | ProjectStatusGroupMasterDataRecord
  | ProjectStatusMasterDataRecord
  | ArchiveCategoryMasterDataRecord;

const colorOptions = [
  "#34a853",
  "#1f7ae0",
  "#8b5cf6",
  "#f59e0b",
  "#0f9ba8",
  "#ef4444",
  "#a1a1aa",
] as const;

const defaultFormState: MasterDataFormState = {
  name: "",
  description: "",
  color: "",
  slug: "",
  iconUrl: "",
  iconKey: "",
  parentId: "",
  groupId: "",
  sortOrder: "0",
  isActive: true,
  allowedUserIds: [],
};

const NO_PARENT_CATEGORY = "__no_parent_category__";
const NO_ICON_KEY = "__no_icon_key__";
const maxArchiveCategoryIconBytes = 2 * 1024 * 1024;
const allowedArchiveCategoryIconTypes = new Set<string>(PROFILE_IMAGE_ALLOWED_MIME_TYPES);
const archiveCategoryIconAccept = PROFILE_IMAGE_ALLOWED_MIME_TYPES.join(",");

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function validateArchiveCategoryIcon(file: File) {
  if (!allowedArchiveCategoryIconTypes.has(file.type.toLowerCase())) {
    return formatUploadFileTypeError(
      buildFileTypeNotAllowedPayload({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        allowedExtensions: PROFILE_IMAGE_ALLOWED_EXTENSIONS,
        error: "Archive category icon file type is not allowed.",
      }),
    );
  }

  if (file.size > maxArchiveCategoryIconBytes) {
    return "Archive category icon must be smaller than 2MB.";
  }

  return null;
}

async function uploadArchiveCategoryIcon(file: File) {
  const uploadRequest = await fetch("/api/archive-category-icons/upload-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
    }),
  });

  const uploadPayload = (await uploadRequest.json()) as {
    uploadUrl?: string;
    storageKey?: string;
    error?: string;
  } & Partial<UploadFileTypeErrorPayload>;

  if (!uploadRequest.ok || !uploadPayload.uploadUrl || !uploadPayload.storageKey) {
    throw new Error(
      getUploadErrorMessage(uploadPayload, "Unable to prepare the archive category icon upload."),
    );
  }

  const putResponse = await fetch(uploadPayload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!putResponse.ok) {
    throw new Error("Unable to upload the archive category icon right now.");
  }

  return uploadPayload.storageKey;
}

function getMasterDataLabel(tab: MasterDataTab) {
  switch (tab) {
    case "categories":
      return "Category";
    case "tags":
      return "Tag";
    case "projectStatusGroups":
      return "Project Status Group";
    case "projectStatuses":
      return "Project Status";
    case "assetTags":
      return "Asset Tag";
    case "archiveCategories":
      return "Archive Category";
    default:
      return "Category";
  }
}

function getMasterDataTitle(tab: MasterDataTab) {
  switch (tab) {
    case "categories":
      return "Categories";
    case "tags":
      return "Project Tags";
    case "projectStatusGroups":
      return "Project Status Groups";
    case "projectStatuses":
      return "Project Statuses";
    case "assetTags":
      return "Asset Tags";
    case "archiveCategories":
      return "Archive Categories";
    default:
      return "Categories";
  }
}

function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: typeof FolderKanban;
}) {
  return (
    <Card className="rounded-[26px] border border-[#ebefe8] bg-white shadow-[0_16px_40px_rgba(23,39,28,0.05)]">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#f4faf5] text-brand">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[30px] font-[700] leading-none tracking-[-0.04em] text-[#121813]">
            {value}
          </p>
          <p className="mt-2 text-[14px] font-[600] text-[#232a25]">{title}</p>
          <p className="text-[13px] text-[#718072]">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[12px] font-[700] ${
        active ? "bg-[#eef8f0] text-brand" : "bg-[#f4f4f5] text-[#666f68]"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ColorDot({ color }: { color: string }) {
  if (!color) {
    return <span className="text-[14px] text-[#90998f]">—</span>;
  }

  return (
    <span
      className="inline-block h-3.5 w-3.5 rounded-full border border-black/5"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function MasterDataTable({
  type,
  items,
  onAdd,
  onEdit,
  onDelete,
  canManage,
  canDelete,
  pending,
}: {
  type: MasterDataTab;
  items: MasterDataTableItem[];
  onAdd: () => void;
  onEdit: (item: MasterDataTableItem) => void;
  onDelete: (item: MasterDataTableItem) => void;
  canManage: boolean;
  canDelete: boolean;
  pending: boolean;
}) {
  const isArchiveCategory = type === "archiveCategories";
  const isProjectStatusGroup = type === "projectStatusGroups";
  const isProjectStatus = type === "projectStatuses";
  const canShowActions = canManage || canDelete;
  const emptyLabel =
    !canManage
      ? "No master data available."
      : type === "categories"
        ? "No categories added yet."
        : type === "projectStatusGroups"
          ? "No project status groups added yet."
          : type === "projectStatuses"
            ? "No project statuses added yet."
        : type === "tags"
          ? "No tags added yet."
          : type === "assetTags"
            ? "No asset tags added yet."
            : "No archive categories added yet.";
  const label = getMasterDataLabel(type);
  const title = getMasterDataTitle(type);

  return (
    <Card className="rounded-[28px] border border-[#ebefe8] bg-white shadow-[0_16px_40px_rgba(23,39,28,0.05)]">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[28px] font-[700] tracking-[-0.03em] text-[#131914]">
              {title}
            </h2>
            <p className="mt-1 text-[14px] text-[#738072]">
              {type === "categories"
                ? `${canManage ? "Manage" : "View"} project categories used across the system.`
                : type === "projectStatusGroups"
                  ? `${canManage ? "Manage" : "View"} project status groups used by dashboard and grouped filters.`
                  : type === "projectStatuses"
                    ? `${canManage ? "Manage" : "View"} project statuses available in project forms and filters.`
                : type === "tags"
                  ? `${canManage ? "Manage" : "View"} tags used to label and group projects.`
                  : type === "assetTags"
                    ? `${canManage ? "Manage" : "View"} asset tags used across library and archive assets.`
                    : `${canManage ? "Manage" : "View"} archive categories used across archive pages and uploads.`}
            </p>
          </div>
          {canManage ? (
            <Button type="button" onClick={onAdd} className="gap-2 self-start">
              <Plus className="h-4 w-4" />
              Add {label}
            </Button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="mt-6 rounded-[22px] border border-dashed border-[#dfe7df] bg-[#fbfdfb] px-6 py-16 text-center">
            <p className="text-[22px] font-[700] tracking-[-0.03em] text-[#162019]">
              {emptyLabel}
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left">
                  {(isArchiveCategory
                      ? [
                          "Name",
                          "Slug",
                          "Parent",
                          "Icon",
                          "Sort",
                          "Status",
                          ...(canShowActions ? ["Actions"] : []),
                        ]
                      : isProjectStatusGroup
                        ? [
                            "Name",
                            "Slug",
                            "Sort",
                            "Color",
                            "Status",
                            ...(canShowActions ? ["Actions"] : []),
                          ]
                      : isProjectStatus
                        ? [
                            "Name",
                            "Slug",
                            "Group",
                            "Sort",
                            "Color",
                            "Status",
                            ...(canShowActions ? ["Actions"] : []),
                          ]
                      : [
                        "Name",
                        "Description",
                        "Color",
                        "Status",
                        ...(canShowActions ? ["Actions"] : []),
                      ]
                  ).map((heading) => (
                    <th
                      key={heading}
                      className="border-b border-[#edf1ec] px-4 py-3 text-[12px] font-[700] uppercase tracking-[0.08em] text-[#7c867d]"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const generalItem = item as ProjectMasterDataItemRecord;
                  const archiveCategoryItem = item as ArchiveCategoryMasterDataRecord;
                  const projectStatusGroupItem = item as ProjectStatusGroupMasterDataRecord;
                  const projectStatusItem = item as ProjectStatusMasterDataRecord;

                  return (
                    <tr key={item.id}>
                      <td className="border-b border-[#f1f4f0] px-4 py-4 text-[15px] font-[700] text-[#172019]">
                        <div className="flex items-center gap-3">
                          {isArchiveCategory || isProjectStatusGroup || isProjectStatus ? (
                            <ColorDot
                              color={
                                isArchiveCategory
                                  ? archiveCategoryItem.color
                                  : isProjectStatusGroup
                                    ? projectStatusGroupItem.color
                                    : projectStatusItem.color
                              }
                            />
                          ) : null}
                          <div>
                            <p>{item.name}</p>
                            {(isArchiveCategory || isProjectStatusGroup || isProjectStatus) &&
                            "description" in item &&
                            item.description ? (
                              <RichTextContent value={item.description} className="mt-1 line-clamp-2 max-w-[300px] text-[13px] font-[500] text-[#667067]" />
                            ) : null}
                          </div>
                        </div>
                      </td>
                      {isArchiveCategory ? (
                        <>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-brand">
                            {archiveCategoryItem.slug}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] text-[#667067]">
                            {archiveCategoryItem.parentName || "—"}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] text-[#667067]">
                            {archiveCategoryItem.iconUrl
                              ? "Custom URL"
                              : archiveCategoryItem.iconKey || "—"}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-[#2b352d]">
                            {archiveCategoryItem.sortOrder}
                          </td>
                        </>
                      ) : isProjectStatusGroup ? (
                        <>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-brand">
                            {projectStatusGroupItem.slug}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-[#2b352d]">
                            {projectStatusGroupItem.sortOrder}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4">
                            <ColorDot color={projectStatusGroupItem.color} />
                          </td>
                        </>
                      ) : isProjectStatus ? (
                        <>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-brand">
                            {projectStatusItem.slug}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-[#2b352d]">
                            {projectStatusItem.groupName}
                            {!projectStatusItem.groupIsActive ? (
                              <span className="ml-2 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#666f68]">
                                Inactive
                              </span>
                            ) : null}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4 text-[14px] font-[700] text-[#2b352d]">
                            {projectStatusItem.sortOrder}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4">
                            <ColorDot color={projectStatusItem.color} />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="max-w-[320px] border-b border-[#f1f4f0] px-4 py-4 text-[14px] text-[#667067]">
                            {generalItem.description || "—"}
                          </td>
                          <td className="border-b border-[#f1f4f0] px-4 py-4">
                            <ColorDot color={generalItem.color} />
                          </td>
                        </>
                      )}
                      <td className="border-b border-[#f1f4f0] px-4 py-4">
                        <StatusPill active={item.isActive} />
                      </td>
                      {canShowActions ? (
                        <td className="border-b border-[#f1f4f0] px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {canManage ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onEdit(item)}
                                disabled={pending}
                                className="gap-2 rounded-full"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                onClick={() => onDelete(item)}
                                disabled={pending}
                                className="h-9 w-9 rounded-[12px] border border-[#f0d6d4] bg-white text-[#c5524d] hover:bg-[#fff6f5] hover:text-[#c5524d]"
                                aria-label={`Delete ${item.name}`}
                                title={`Delete ${item.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MasterDataDrawer({
  isOpen,
  tab,
  mode,
  form,
  archiveCategories,
  archiveCategoryAccessUsers,
  projectStatusGroups,
  iconPreviewSrc,
  iconUploadError,
  fieldErrors,
  error,
  saving,
  onClose,
  onSubmit,
  onChange,
  onIconFileChange,
  onRemoveIcon,
}: {
  isOpen: boolean;
  tab: MasterDataTab;
  mode: "add" | "edit";
  form: MasterDataFormState;
  archiveCategories: ArchiveCategoryMasterDataRecord[];
  archiveCategoryAccessUsers: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  projectStatusGroups: ProjectStatusGroupMasterDataRecord[];
  iconPreviewSrc: string;
  iconUploadError?: string;
  fieldErrors: MasterDataFieldErrors;
  error?: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: <K extends keyof MasterDataFormState>(
    field: K,
    value: MasterDataFormState[K],
  ) => void;
  onIconFileChange: (file: File) => void;
  onRemoveIcon: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  const label = getMasterDataLabel(tab);
  const isArchiveCategory = tab === "archiveCategories";
  const isProjectStatusGroup = tab === "projectStatusGroups";
  const isProjectStatus = tab === "projectStatuses";
  const descriptionLength = richTextToPlainText(form.description).length;
  const parentOptions = archiveCategories.filter((category) => category.id !== form.id);
  const selectedAccessUsers = archiveCategoryAccessUsers.filter((user) =>
    form.allowedUserIds.includes(user.id),
  );
  const currentProjectStatusGroup = projectStatusGroups.find((group) => group.id === form.groupId);
  const projectStatusGroupOptions = [
    ...projectStatusGroups.filter((group) => group.isActive),
    ...(currentProjectStatusGroup && !currentProjectStatusGroup.isActive
      ? [currentProjectStatusGroup]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#102116]/30 backdrop-blur-[2px]">
      <div className="absolute inset-y-0 right-0 w-full max-w-[560px] overflow-y-auto bg-white shadow-[-18px_0_60px_rgba(11,26,18,0.16)]">
        <div className="flex min-h-full flex-col px-6 py-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[34px] font-[700] leading-none tracking-[-0.05em] text-[#111712]">
                {mode === "add" ? `Add New ${label}` : `Edit ${label}`}
              </h2>
              <p className="mt-3 text-[15px] text-[#6d776e]">
                {mode === "add"
                  ? `Create a reusable ${label.toLowerCase()}.`
                  : `Update this ${label.toLowerCase()} value.`}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onClose}
              disabled={saving}
              className="shrink-0 border border-line"
              aria-label="Close master data drawer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {error ? (
            <div className="mt-6 rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
              {error}
            </div>
          ) : null}

          <div className="mt-8 space-y-6">
            <label className="space-y-2">
              <span className="block text-[13px] font-[700] text-[#2b352d]">
                Name <span className="text-[#c5524d]">*</span>
              </span>
              <Input
                value={form.name}
                onChange={(event) => onChange("name", event.target.value)}
                placeholder={`Enter ${label.toLowerCase()} name`}
                className={`h-12 rounded-2xl border ${
                  fieldErrors.name ? "border-[#e0a8a6]" : "border-line"
                }`}
              />
              {fieldErrors.name ? (
                <span className="text-[12px] font-[600] text-[#bb4d49]">
                  {fieldErrors.name}
                </span>
              ) : null}
            </label>

            <>
                {isArchiveCategory || isProjectStatusGroup || isProjectStatus ? (
                  <label className="space-y-2">
                    <span className="block text-[13px] font-[700] text-[#2b352d]">
                      Slug <span className="text-[#c5524d]">*</span>
                    </span>
                    <Input
                      value={form.slug}
                      onChange={(event) => onChange("slug", normalizeSlug(event.target.value))}
                      placeholder="archive-category-slug"
                      className={`h-12 rounded-2xl border ${
                        fieldErrors.slug ? "border-[#e0a8a6]" : "border-line"
                      }`}
                    />
                    {fieldErrors.slug ? (
                      <span className="text-[12px] font-[600] text-[#bb4d49]">
                        {fieldErrors.slug}
                      </span>
                    ) : (
                      <span className="text-[12px] text-[#6d776e]">
                        {isArchiveCategory
                          ? "Used in the archive URL, for example /archives/artworks."
                          : isProjectStatusGroup
                            ? "Used as the stable project status group key."
                            : "Used as the stable project status key."}
                      </span>
                    )}
                  </label>
                ) : null}

                {isProjectStatus ? (
                  <label className="space-y-2">
                    <span className="block text-[13px] font-[700] text-[#2b352d]">
                      Group <span className="text-[#c5524d]">*</span>
                    </span>
                    <Select
                      value={form.groupId}
                      onValueChange={(value) => onChange("groupId", value)}
                    >
                      <SelectTrigger
                        className={`h-12 rounded-2xl border bg-white ${
                          fieldErrors.groupId ? "border-[#e0a8a6]" : "border-line"
                        }`}
                      >
                        <SelectValue placeholder="Choose group" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectStatusGroupOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                            {!option.isActive ? " (Inactive)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldErrors.groupId ? (
                      <span className="text-[12px] font-[600] text-[#bb4d49]">
                        {fieldErrors.groupId}
                      </span>
                    ) : (
                      <span className="text-[12px] text-[#6d776e]">
                        Groups drive project list and dashboard status counts.
                      </span>
                    )}
                  </label>
                ) : null}

                <div className="space-y-2">
                  <span className="block text-[13px] font-[700] text-[#2b352d]">
                    Description
                  </span>
                  <RichTextEditor
                    value={form.description}
                    onChange={(value) => onChange("description", value)}
                    placeholder="Enter description (optional)"
                    maxLength={PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH}
                    minHeightClassName="min-h-[132px]"
                    ariaLabel={`${label} description`}
                    error={fieldErrors.description}
                  />
                  {fieldErrors.description ? (
                    <span className="text-[12px] font-[600] text-[#bb4d49]">
                      {fieldErrors.description}
                    </span>
                  ) : (
                    <span className="flex items-center justify-between gap-3 text-[12px] text-[#6d776e]">
                      <span>
                        Keep the {label.toLowerCase()} description concise and reusable.
                      </span>
                      <span>
                        {descriptionLength}/{PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH}
                      </span>
                    </span>
                  )}
                </div>

                {isArchiveCategory ? (
                  <>
                    <label className="space-y-2">
                      <span className="block text-[13px] font-[700] text-[#2b352d]">
                        Parent Category
                      </span>
                      <Select
                        value={form.parentId || NO_PARENT_CATEGORY}
                        onValueChange={(value) =>
                          onChange(
                            "parentId",
                            value === NO_PARENT_CATEGORY ? "" : value,
                          )
                        }
                      >
                        <SelectTrigger className="h-12 rounded-2xl border border-line bg-white">
                          <SelectValue placeholder="No parent category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_PARENT_CATEGORY}>
                            No parent category
                          </SelectItem>
                          {parentOptions.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.parentName
                                ? `${category.parentName} / ${category.name}`
                                : category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>

                    <div className="space-y-3 rounded-[22px] border border-line bg-[#fbfdfb] p-4">
                      <div>
                        <p className="text-[13px] font-[800] text-[#2b352d]">
                          Access Restriction
                        </p>
                        <p className="mt-1 text-[12px] leading-5 text-[#6d776e]">
                          If no users are selected, this category is visible to everyone with Archive access. If users are selected, only selected users and administrators with master-data access can access it.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={form.allowedUserIds.length === 0 ? "default" : "secondary"}
                          className="h-9 rounded-full text-[12px]"
                          onClick={() => onChange("allowedUserIds", [])}
                        >
                          Available to everyone
                        </Button>
                        <Button
                          type="button"
                          variant={form.allowedUserIds.length > 0 ? "default" : "secondary"}
                          className="h-9 rounded-full text-[12px]"
                          onClick={() => {
                            if (form.allowedUserIds.length === 0 && archiveCategoryAccessUsers[0]) {
                              onChange("allowedUserIds", [archiveCategoryAccessUsers[0].id]);
                            }
                          }}
                        >
                          Restricted to selected people
                        </Button>
                      </div>
                      {form.allowedUserIds.length > 0 ? (
                        <div className="space-y-3">
                          {selectedAccessUsers.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {selectedAccessUsers.map((user) => (
                                <span
                                  key={user.id}
                                  className="inline-flex items-center gap-2 rounded-full border border-[#dce7dd] bg-white px-3 py-1.5 text-[12px] font-[700] text-[#263529]"
                                >
                                  {user.name}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onChange(
                                        "allowedUserIds",
                                        form.allowedUserIds.filter((id) => id !== user.id),
                                      )
                                    }
                                    aria-label={`Remove ${user.name}`}
                                    className="text-[#748078] hover:text-[#bb4d49]"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="max-h-48 space-y-2 overflow-y-auto rounded-[16px] border border-[#e2e9e2] bg-white p-2">
                            {archiveCategoryAccessUsers.map((user) => {
                              const checked = form.allowedUserIds.includes(user.id);

                              return (
                                <label
                                  key={user.id}
                                  className="flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 hover:bg-[#f5faf6]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      onChange(
                                        "allowedUserIds",
                                        checked
                                          ? form.allowedUserIds.filter((id) => id !== user.id)
                                          : [...form.allowedUserIds, user.id],
                                      )
                                    }
                                  />
                                  <span className="min-w-0">
                                    <span className="block min-w-0 whitespace-normal break-words text-[13px] font-[700] text-[#223126]">
                                      {user.name}
                                    </span>
                                    <span className="block truncate text-[12px] text-[#6d776e]">
                                      {user.email}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                            {archiveCategoryAccessUsers.length === 0 ? (
                              <p className="px-3 py-2 text-[12px] text-[#6d776e]">
                                No users are available to select.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <label className="space-y-2">
                      <span className="block text-[13px] font-[700] text-[#2b352d]">
                        Icon
                      </span>
                      <Select
                        value={form.iconKey || NO_ICON_KEY}
                        onValueChange={(value) =>
                          onChange("iconKey", value === NO_ICON_KEY ? "" : value)
                        }
                      >
                        <SelectTrigger className="h-12 rounded-2xl border border-line bg-white">
                          <SelectValue placeholder="Choose icon" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ICON_KEY}>No icon</SelectItem>
                          {archiveCategoryIconOptions.map((option) => (
                            <SelectItem key={option.key} value={option.key}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>

                    <div className="space-y-3">
                      <span className="block text-[13px] font-[700] text-[#2b352d]">
                        Upload Icon
                      </span>
                      <div className="flex flex-col gap-3 rounded-[22px] border border-line bg-[#fbfdfb] p-4 sm:flex-row sm:items-center">
                        <div
                          className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[18px] border border-[#dde8de] bg-white text-brand"
                          style={form.color ? { color: form.color } : undefined}
                        >
                          {iconPreviewSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={iconPreviewSrc}
                              alt=""
                              className="h-full w-full object-contain p-2"
                            />
                          ) : (
                            <ArchiveCategoryIconGlyph
                              iconKey={form.iconKey}
                              className="h-8 w-8"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              asChild
                              type="button"
                              variant="outline"
                              className="h-10 rounded-full"
                            >
                              <label className="cursor-pointer">
                                <ImagePlus className="h-4 w-4" />
                                Upload icon
                                <input
                                  type="file"
                                  accept={archiveCategoryIconAccept}
                                  className="sr-only"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];

                                    if (file) {
                                      onIconFileChange(file);
                                    }

                                    event.target.value = "";
                                  }}
                                />
                              </label>
                            </Button>
                            {iconPreviewSrc ? (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={onRemoveIcon}
                                className="h-10 rounded-full"
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                          {iconUploadError ? (
                            <p className="mt-2 text-[12px] font-[600] text-[#bb4d49]">
                              {iconUploadError}
                            </p>
                          ) : (
                            <p className="mt-2 text-[12px] text-[#6d776e]">
                              Upload PNG, JPG, JPEG, GIF, or WebP. Uploaded icons take priority over the selected icon.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <label className="space-y-2">
                      <span className="block text-[13px] font-[700] text-[#2b352d]">
                        Sort Order
                      </span>
                      <Input
                        value={form.sortOrder}
                        onChange={(event) => onChange("sortOrder", event.target.value)}
                        type="number"
                        inputMode="numeric"
                        className={`h-12 rounded-2xl border ${
                          fieldErrors.sortOrder ? "border-[#e0a8a6]" : "border-line"
                        }`}
                      />
                      {fieldErrors.sortOrder ? (
                        <span className="text-[12px] font-[600] text-[#bb4d49]">
                          {fieldErrors.sortOrder}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#6d776e]">
                          Lower numbers appear first.
                        </span>
                      )}
                    </label>
                  </>
                ) : null}

                {isProjectStatusGroup || isProjectStatus ? (
                  <label className="space-y-2">
                    <span className="block text-[13px] font-[700] text-[#2b352d]">
                      Sort Order
                    </span>
                    <Input
                      value={form.sortOrder}
                      onChange={(event) => onChange("sortOrder", event.target.value)}
                      type="number"
                      inputMode="numeric"
                      className={`h-12 rounded-2xl border ${
                        fieldErrors.sortOrder ? "border-[#e0a8a6]" : "border-line"
                      }`}
                    />
                    {fieldErrors.sortOrder ? (
                      <span className="text-[12px] font-[600] text-[#bb4d49]">
                        {fieldErrors.sortOrder}
                      </span>
                    ) : (
                      <span className="text-[12px] text-[#6d776e]">
                        Lower numbers appear first.
                      </span>
                    )}
                  </label>
                ) : null}

                <div className="space-y-3">
                  <span className="block text-[13px] font-[700] text-[#2b352d]">
                    Color Label
                  </span>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => onChange("color", "")}
                      className={`rounded-full border px-3 py-2 text-[12px] font-[700] ${
                        !form.color
                          ? "border-brand bg-[#eef8f0] text-brand"
                          : "border-[#e4eae3] text-[#637064]"
                      }`}
                    >
                      No color
                    </button>
                    {colorOptions.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => onChange("color", color)}
                        className={`grid h-10 w-10 place-items-center rounded-full border-2 transition ${
                          form.color === color ? "border-[#183425]" : "border-transparent"
                        }`}
                        aria-label={`Select color ${color}`}
                      >
                        <span
                          className="grid h-8 w-8 place-items-center rounded-full"
                          style={{ backgroundColor: color }}
                        >
                          {form.color === color ? (
                            <Check className="h-4 w-4 text-white" />
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
            </>

            <div className="space-y-3">
              <span className="block text-[13px] font-[700] text-[#2b352d]">Status</span>
              <button
                type="button"
                onClick={() => onChange("isActive", !form.isActive)}
                className="inline-flex items-center gap-3"
              >
                <span
                  className={`relative h-8 w-14 rounded-full transition ${
                    form.isActive ? "bg-brand" : "bg-[#d3dad4]"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_4px_12px_rgba(18,34,25,0.18)] transition ${
                      form.isActive ? "left-7" : "left-1"
                    }`}
                  />
                </span>
                <span className="text-[15px] font-[700] text-[#1e271f]">
                  {form.isActive ? "Active" : "Inactive"}
                </span>
              </button>
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-3 pt-10">
            <Button type="button" onClick={onSubmit} disabled={saving} className="h-14 text-[16px]">
              {saving
                ? mode === "add"
                  ? `Saving ${label}...`
                  : `Updating ${label}...`
                : mode === "add"
                  ? `Save ${label}`
                  : `Update ${label}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
              className="h-12 rounded-full"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectMasterDataWorkspace({
  categories,
  projectStatusGroups,
  projectStatuses,
  tags,
  assetTags,
  archiveCategories,
  archiveCategoryAccessUsers,
  summary,
  canManageItems,
  canDeleteItems,
}: ProjectMasterDataWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MasterDataTab>("categories");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [form, setForm] = useState<MasterDataFormState>(defaultFormState);
  const [selectedIconFile, setSelectedIconFile] = useState<File | null>(null);
  const [selectedIconPreviewSrc, setSelectedIconPreviewSrc] = useState("");
  const [iconUploadError, setIconUploadError] = useState<string>();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<MasterDataFieldErrors>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const iconPreviewSrc =
    selectedIconPreviewSrc || getArchiveCategoryIconImageSrc(form.iconUrl);

  useEffect(() => {
    return () => {
      if (selectedIconPreviewSrc.startsWith("blob:")) {
        URL.revokeObjectURL(selectedIconPreviewSrc);
      }
    };
  }, [selectedIconPreviewSrc]);

  function openAddDrawer(tab: MasterDataTab) {
    if (!canManageItems) {
      return;
    }

    setActiveTab(tab);
    setDialogMode("add");
    setForm(defaultFormState);
    setSelectedIconFile(null);
    setSelectedIconPreviewSrc("");
    setIconUploadError(undefined);
    setError(undefined);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function openEditDrawer(
    tab: MasterDataTab,
    item: MasterDataTableItem,
  ) {
    if (!canManageItems) {
      return;
    }

    setActiveTab(tab);
    setDialogMode("edit");
    setForm({
      id: item.id,
      name: item.name,
      description: "description" in item ? item.description : "",
      color: "color" in item ? item.color : "",
      slug: "slug" in item ? item.slug : "",
      iconUrl: "iconUrl" in item ? item.iconUrl : "",
      iconKey: "iconKey" in item ? item.iconKey : "",
      parentId: "parentId" in item ? item.parentId ?? "" : "",
      groupId: "groupId" in item ? item.groupId ?? "" : "",
      sortOrder: "sortOrder" in item ? String(item.sortOrder) : "0",
      isActive: item.isActive,
      allowedUserIds:
        "allowedUsers" in item ? item.allowedUsers.map((user) => user.id) : [],
    });
    setSelectedIconFile(null);
    setSelectedIconPreviewSrc("");
    setIconUploadError(undefined);
    setError(undefined);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function handleArchiveCategoryIconFile(file: File) {
    const validationError = validateArchiveCategoryIcon(file);

    if (validationError) {
      setIconUploadError(validationError);
      showErrorToast("Unable to use icon.", validationError);
      return;
    }

    const nextPreviewSrc = URL.createObjectURL(file);

    setSelectedIconFile(file);
    setSelectedIconPreviewSrc((current) => {
      if (current.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }

      return nextPreviewSrc;
    });
    setIconUploadError(undefined);
  }

  function removeArchiveCategoryIcon() {
    setSelectedIconFile(null);
    setSelectedIconPreviewSrc((current) => {
      if (current.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }

      return "";
    });
    setIconUploadError(undefined);
    setForm((current) => ({
      ...current,
      iconUrl: "",
    }));
  }

  function handleSubmit() {
    const normalizedName = form.name.trim();
    const normalizedDescriptionLength = richTextToPlainText(form.description).length;
    const nextFieldErrors: MasterDataFieldErrors = {};

    if (!normalizedName) {
      nextFieldErrors.name = "Name is required.";
    }

    if (
      activeTab === "archiveCategories" ||
      activeTab === "projectStatusGroups" ||
      activeTab === "projectStatuses"
    ) {
      const normalizedSlug = normalizeSlug(form.slug || normalizedName);
      const sortOrderNumber = Number(form.sortOrder || "0");

      if (!normalizedSlug) {
        nextFieldErrors.slug = "Slug is required.";
      }

      if (activeTab === "projectStatuses" && !form.groupId) {
        nextFieldErrors.groupId = "Group is required.";
      }

      if (!Number.isFinite(sortOrderNumber) || !Number.isInteger(sortOrderNumber)) {
        nextFieldErrors.sortOrder = "Sort order must be a whole number.";
      }

      if (normalizedDescriptionLength > PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH) {
        nextFieldErrors.description = `${getMasterDataLabel(activeTab)} description must be ${PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
      }
    } else if (
      normalizedDescriptionLength > PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH
    ) {
      const label = getMasterDataLabel(activeTab);
      nextFieldErrors.description = `${label} description must be ${PROJECT_MASTER_DATA_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
    }

    if (
      nextFieldErrors.name ||
      nextFieldErrors.description ||
      nextFieldErrors.slug ||
      nextFieldErrors.groupId ||
      nextFieldErrors.sortOrder
    ) {
      setFieldErrors(nextFieldErrors);
      showErrorToast("Unable to save value.", "Please review the highlighted fields.");
      return;
    }

    setFieldErrors({});
    setError(undefined);

    startTransition(async () => {
      try {
        let archiveCategoryIconUrl = form.iconUrl;

        if (activeTab === "archiveCategories" && selectedIconFile) {
          archiveCategoryIconUrl = await uploadArchiveCategoryIcon(selectedIconFile);
        }

        const result =
          activeTab === "categories"
            ? await saveProjectCategoryAction({
                id: form.id,
                name: normalizedName,
                description: form.description,
                color: form.color,
                isActive: form.isActive,
              })
            : activeTab === "tags"
              ? await saveProjectTagAction({
                  id: form.id,
                  name: normalizedName,
                  description: form.description,
                  color: form.color,
                  isActive: form.isActive,
                })
              : activeTab === "projectStatuses"
                ? await saveProjectStatusAction({
                    id: form.id,
                    name: normalizedName,
                    description: form.description,
                    color: form.color,
                    slug: normalizeSlug(form.slug || normalizedName),
                    groupId: form.groupId,
                    sortOrder: Number(form.sortOrder || "0"),
                    isActive: form.isActive,
                  })
              : activeTab === "projectStatusGroups"
                ? await saveProjectStatusGroupAction({
                    id: form.id,
                    name: normalizedName,
                    description: form.description,
                    color: form.color,
                    slug: normalizeSlug(form.slug || normalizedName),
                    sortOrder: Number(form.sortOrder || "0"),
                    isActive: form.isActive,
                  })
              : activeTab === "assetTags"
                ? await saveAssetTagAction({
                    id: form.id,
                    name: normalizedName,
                    description: form.description,
                    color: form.color,
                    isActive: form.isActive,
                  })
                : await saveArchiveCategoryAction({
                    id: form.id,
                    name: normalizedName,
                    description: form.description,
                    color: form.color,
                    slug: normalizeSlug(form.slug || normalizedName),
                    iconUrl: archiveCategoryIconUrl,
                    iconKey: form.iconKey,
                    parentId: form.parentId || null,
                    sortOrder: Number(form.sortOrder || "0"),
                    isActive: form.isActive,
                    allowedUserIds: form.allowedUserIds,
                  });

        if (result.error) {
          setError(result.error);
          showErrorToast(
          activeTab === "projectStatuses"
              ? "Unable to save project status."
            : activeTab === "projectStatusGroups"
              ? "Unable to save project status group."
            : activeTab === "assetTags"
              ? "Unable to save asset tag."
              : activeTab === "archiveCategories"
                ? "Unable to save archive category."
                : activeTab === "tags"
                  ? "Unable to save tag."
                  : "Unable to save category.",
            result.error,
          );
          return;
        }

        setDrawerOpen(false);
        setSelectedIconFile(null);
        setSelectedIconPreviewSrc("");
        setIconUploadError(undefined);
        showSuccessToast(
          activeTab === "projectStatuses"
              ? dialogMode === "add"
                ? "Project status added successfully."
                : "Project status updated successfully."
            : activeTab === "projectStatusGroups"
              ? dialogMode === "add"
                ? "Project status group added successfully."
                : "Project status group updated successfully."
            : activeTab === "assetTags"
              ? dialogMode === "add"
                ? "Asset tag added successfully."
                : "Asset tag updated successfully."
              : activeTab === "archiveCategories"
                ? dialogMode === "add"
                  ? "Archive category added successfully."
                  : "Archive category updated successfully."
                : activeTab === "tags"
                  ? dialogMode === "add"
                    ? "Tag added successfully."
                    : "Tag updated successfully."
                  : dialogMode === "add"
                    ? "Category added successfully."
                    : "Category updated successfully.",
        );
        router.refresh();
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "Unable to save this value right now. Please try again.";

        if (activeTab === "archiveCategories" && selectedIconFile) {
          setIconUploadError(message);
        }

        setError(message);
        showErrorToast(
          "Unable to save value.",
          message,
        );
      }
    });
  }

  function handleDelete(
    tab: MasterDataTab,
    item: MasterDataTableItem,
  ) {
    if (!canDeleteItems) {
      return;
    }

    setError(undefined);
    setFieldErrors({});
    setDeleteError(undefined);
    setDeleteTarget({ tab, item });
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    setDeleteError(undefined);

    startTransition(async () => {
      try {
        const result =
          deleteTarget.tab === "categories"
            ? await deleteProjectCategoryAction(deleteTarget.item.id)
            : deleteTarget.tab === "tags"
              ? await deleteProjectTagAction(deleteTarget.item.id)
              : deleteTarget.tab === "projectStatusGroups"
                ? await deleteProjectStatusGroupAction(deleteTarget.item.id)
              : deleteTarget.tab === "projectStatuses"
                ? await deleteProjectStatusAction(deleteTarget.item.id)
              : deleteTarget.tab === "assetTags"
                ? await deleteAssetTagAction(deleteTarget.item.id)
                : await deleteArchiveCategoryAction(deleteTarget.item.id);

        if (result.error) {
          setDeleteError(result.error);
          showErrorToast("Unable to delete value.", result.error);
          return;
        }

        showSuccessToast(
          deleteTarget.tab === "projectStatusGroups"
              ? "Project status group deleted successfully."
            : deleteTarget.tab === "projectStatuses"
              ? "Project status deleted successfully."
            : deleteTarget.tab === "assetTags"
              ? "Asset tag deleted successfully."
              : deleteTarget.tab === "archiveCategories"
                ? "Archive category deleted successfully."
                : deleteTarget.tab === "tags"
                  ? "Tag deleted successfully."
                  : "Category deleted successfully.",
        );
        setDeleteTarget(null);
        router.refresh();
      } catch {
        setDeleteError("Unable to delete this item right now. Please try again.");
        showErrorToast(
          "Unable to delete value.",
          "Unable to delete this item right now. Please try again.",
        );
      }
    });
  }

  return (
    <>
      <section className="space-y-6">
        <header className="rounded-[30px] bg-white px-6 py-7 shadow-[0_18px_44px_rgba(23,39,28,0.05)] sm:px-8">
          <p className="text-[13px] font-[700] uppercase tracking-[0.18em] text-brand/75">
            Settings
          </p>
          <h1 className="mt-2 text-[44px] font-[700] leading-none tracking-[-0.05em] text-[#111712]">
            Project Master Data
          </h1>
          <p className="mt-3 max-w-[720px] text-[16px] leading-7 text-[#6f776f]">
            Manage reusable project categories, project statuses, project tags, asset tags, and archive categories.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            title="Total Categories"
            value={summary.totalCategories}
            subtitle="Saved values"
            icon={FolderKanban}
          />
          <SummaryCard
            title="Active Categories"
            value={summary.activeCategories}
            subtitle="Visible in project forms"
            icon={FolderKanban}
          />
          <SummaryCard
            title="Total Status Groups"
            value={summary.totalProjectStatusGroups}
            subtitle="Saved values"
            icon={FolderKanban}
          />
          <SummaryCard
            title="Active Status Groups"
            value={summary.activeProjectStatusGroups}
            subtitle="Used for grouping"
            icon={FolderKanban}
          />
          <SummaryCard
            title="Total Statuses"
            value={summary.totalProjectStatuses}
            subtitle="Saved values"
            icon={FolderKanban}
          />
          <SummaryCard
            title="Active Statuses"
            value={summary.activeProjectStatuses}
            subtitle="Visible in project forms"
            icon={FolderKanban}
          />
          <SummaryCard
            title="Total Tags"
            value={summary.totalTags}
            subtitle="Saved values"
            icon={Tags}
          />
          <SummaryCard
            title="Active Tags"
            value={summary.activeTags}
            subtitle="Visible in project filters"
            icon={Tags}
          />
          <SummaryCard
            title="Total Asset Tags"
            value={summary.totalAssetTags}
            subtitle="Saved values"
            icon={Tags}
          />
          <SummaryCard
            title="Active Asset Tags"
            value={summary.activeAssetTags}
            subtitle="Visible in asset uploads"
            icon={Tags}
          />
          <SummaryCard
            title="Total Archive Categories"
            value={summary.totalArchiveCategories}
            subtitle="Saved archive groups"
            icon={Archive}
          />
          <SummaryCard
            title="Active Archive Categories"
            value={summary.activeArchiveCategories}
            subtitle="Visible in archive flows"
            icon={Archive}
          />
        </div>

        {error && !drawerOpen ? (
          <div className="rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
            {error}
          </div>
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as MasterDataTab)}
          className="space-y-6"
        >
          <div className="rounded-[28px] border border-[#ebefe8] bg-white p-4 shadow-[0_16px_40px_rgba(23,39,28,0.05)]">
            <TabsList className="w-full justify-start sm:w-auto">
              <TabsTrigger value="categories" className="min-w-[140px] py-3 text-[15px]">
                Categories
              </TabsTrigger>
              <TabsTrigger value="projectStatuses" className="min-w-[160px] py-3 text-[15px]">
                Project Statuses
              </TabsTrigger>
              <TabsTrigger value="projectStatusGroups" className="min-w-[180px] py-3 text-[15px]">
                Status Groups
              </TabsTrigger>
              <TabsTrigger value="tags" className="min-w-[140px] py-3 text-[15px]">
                Project Tags
              </TabsTrigger>
              <TabsTrigger value="assetTags" className="min-w-[140px] py-3 text-[15px]">
                Asset Tags
              </TabsTrigger>
              <TabsTrigger value="archiveCategories" className="min-w-[160px] py-3 text-[15px]">
                Archive Categories
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="categories">
            <MasterDataTable
              type="categories"
              items={categories}
              onAdd={() => openAddDrawer("categories")}
              onEdit={(item) => openEditDrawer("categories", item)}
              onDelete={(item) => handleDelete("categories", item)}
              canManage={canManageItems}
              canDelete={canDeleteItems}
              pending={isPending}
            />
          </TabsContent>

          <TabsContent value="tags">
            <MasterDataTable
              type="tags"
              items={tags}
              onAdd={() => openAddDrawer("tags")}
              onEdit={(item) => openEditDrawer("tags", item)}
              onDelete={(item) => handleDelete("tags", item)}
              canManage={canManageItems}
              canDelete={canDeleteItems}
              pending={isPending}
            />
          </TabsContent>

          <TabsContent value="projectStatuses">
            <MasterDataTable
              type="projectStatuses"
              items={projectStatuses}
              onAdd={() => openAddDrawer("projectStatuses")}
              onEdit={(item) => openEditDrawer("projectStatuses", item)}
              onDelete={(item) => handleDelete("projectStatuses", item)}
              canManage={canManageItems}
              canDelete={canDeleteItems}
              pending={isPending}
            />
          </TabsContent>

          <TabsContent value="projectStatusGroups">
            <MasterDataTable
              type="projectStatusGroups"
              items={projectStatusGroups}
              onAdd={() => openAddDrawer("projectStatusGroups")}
              onEdit={(item) => openEditDrawer("projectStatusGroups", item)}
              onDelete={(item) => handleDelete("projectStatusGroups", item)}
              canManage={canManageItems}
              canDelete={canDeleteItems}
              pending={isPending}
            />
          </TabsContent>

          <TabsContent value="assetTags">
            <MasterDataTable
              type="assetTags"
              items={assetTags}
              onAdd={() => openAddDrawer("assetTags")}
              onEdit={(item) => openEditDrawer("assetTags", item)}
              onDelete={(item) => handleDelete("assetTags", item)}
              canManage={canManageItems}
              canDelete={canDeleteItems}
              pending={isPending}
            />
          </TabsContent>

          <TabsContent value="archiveCategories">
            <MasterDataTable
              type="archiveCategories"
              items={archiveCategories}
              onAdd={() => openAddDrawer("archiveCategories")}
              onEdit={(item) => openEditDrawer("archiveCategories", item)}
              onDelete={(item) => handleDelete("archiveCategories", item)}
              canManage={canManageItems}
              canDelete={canDeleteItems}
              pending={isPending}
            />
          </TabsContent>

        </Tabs>
      </section>

      <MasterDataDrawer
        isOpen={canManageItems && drawerOpen}
        tab={activeTab}
        mode={dialogMode}
        form={form}
        archiveCategories={archiveCategories}
        archiveCategoryAccessUsers={archiveCategoryAccessUsers}
        projectStatusGroups={projectStatusGroups}
        iconPreviewSrc={iconPreviewSrc}
        iconUploadError={iconUploadError}
        fieldErrors={fieldErrors}
        error={error}
        saving={isPending}
        onClose={() => {
          if (!isPending) {
            setDrawerOpen(false);
            setSelectedIconFile(null);
            setSelectedIconPreviewSrc("");
            setIconUploadError(undefined);
            setError(undefined);
            setFieldErrors({});
          }
        }}
        onSubmit={handleSubmit}
        onChange={(field, value) =>
          setForm((current) => {
            if (
              (activeTab === "archiveCategories" ||
                activeTab === "projectStatusGroups" ||
                activeTab === "projectStatuses") &&
              dialogMode === "add" &&
              field === "name" &&
              typeof value === "string" &&
              (!current.slug || current.slug === normalizeSlug(current.name))
            ) {
              return {
                ...current,
                name: value,
                slug: normalizeSlug(value),
              };
            }

            return {
              ...current,
              [field]: value,
            };
          })
        }
        onIconFileChange={handleArchiveCategoryIconFile}
        onRemoveIcon={removeArchiveCategoryIcon}
      />

      <ConfirmationDialog
        isOpen={deleteTarget !== null}
        title={
          deleteTarget?.tab === "categories"
            ? "Delete Category"
            : deleteTarget?.tab === "projectStatusGroups"
              ? "Delete Project Status Group"
            : deleteTarget?.tab === "projectStatuses"
              ? "Delete Project Status"
            : deleteTarget?.tab === "tags"
              ? "Delete Tag"
            : deleteTarget?.tab === "assetTags"
              ? "Delete Asset Tag"
              : "Delete Archive Category"
        }
        description={
          deleteTarget
            ? `Delete "${deleteTarget.item.name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="destructive"
        pending={isPending}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => {
          if (!isPending) {
            setDeleteTarget(null);
            setDeleteError(undefined);
          }
        }}
      />
    </>
  );
}

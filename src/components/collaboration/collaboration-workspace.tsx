"use client";

import Link from "next/link";
import { useState } from "react";
import {
  PenLine,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  deleteCollaboratorAction,
  saveCollaboratorAction,
} from "@/app/(dashboard)/collaboration/actions";
import {
  CollaboratorDialog,
  type CollaboratorForm,
} from "@/components/collaboration/collaborator-dialog";
import {
  MotionItem,
  MotionSection,
} from "@/components/motion/motion-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { CollaboratorRecord } from "@/lib/collaboration";
import { showErrorToast, showSuccessToast, showWarningToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function getDefaultForm(): CollaboratorForm {
  return {
    name: "",
    email: "",
  };
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type CollaborationWorkspaceProps = {
  initialCollaborators: CollaboratorRecord[];
  canSaveCollaborators: boolean;
  canDeleteCollaborators: boolean;
  canManagePermissions: boolean;
};

export function CollaborationWorkspace({
  initialCollaborators,
  canSaveCollaborators,
  canDeleteCollaborators,
  canManagePermissions,
}: CollaborationWorkspaceProps) {
  const [collaborators, setCollaborators] =
    useState<CollaboratorRecord[]>(initialCollaborators);
  const [dialogMode, setDialogMode] = useState<"invite" | "edit">("invite");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CollaboratorForm>(getDefaultForm());
  const [dialogError, setDialogError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [pageNotice, setPageNotice] = useState<string>();
  const [collaboratorPendingDelete, setCollaboratorPendingDelete] =
    useState<CollaboratorRecord | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const canShowActions = canSaveCollaborators || canDeleteCollaborators;

  function setFormValue<K extends keyof CollaboratorForm>(
    field: K,
    value: CollaboratorForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openInviteDialog() {
    setDialogMode("invite");
    setEditingId(null);
    setForm(getDefaultForm());
    setDialogError(undefined);
    setPageNotice(undefined);
    setDialogOpen(true);
  }

  function openEditDialog(collaborator: CollaboratorRecord) {
    setDialogMode("edit");
    setEditingId(collaborator.id);
    setForm({
      name: collaborator.name,
      email: collaborator.email,
    });
    setDialogError(undefined);
    setPageNotice(undefined);
    setDialogOpen(true);
  }

  async function handleSaveCollaborator() {
    if (!form.name.trim() || !form.email.trim()) {
      setDialogError("Enter both collaborator name and email.");
      showErrorToast("Unable to save collaborator.", "Enter both collaborator name and email.");
      return;
    }

    setSaving(true);
    setDialogError(undefined);

    try {
      const result = await saveCollaboratorAction({
        collaboratorId: editingId,
        ...form,
      });

      if ("error" in result) {
        setDialogError(result.error);
        showErrorToast("Unable to save collaborator.", result.error);
        return;
      }

      if (dialogMode === "invite") {
        setCollaborators((current) => [...current, result.collaborator]);
      } else if (editingId) {
        setCollaborators((current) =>
          current.map((collaborator) =>
            collaborator.id === editingId ? result.collaborator : collaborator,
          ),
        );
      }

      setPageNotice(result.warning);
      showSuccessToast(
        dialogMode === "invite"
          ? "Collaborator saved successfully."
          : "Collaborator updated successfully.",
      );

      if (result.warning) {
        showWarningToast("Collaborator saved with warning.", result.warning);
      }

      setDialogOpen(false);
    } catch {
      setDialogError("Unable to save the collaborator right now. Please try again.");
      showErrorToast(
        "Unable to save collaborator.",
        "Unable to save the collaborator right now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCollaborator() {
    if (!collaboratorPendingDelete) {
      return;
    }

    setDeletePending(true);
    setDeleteError(undefined);

    try {
      const result = await deleteCollaboratorAction(collaboratorPendingDelete.id);

      if ("error" in result) {
        setDeleteError(result.error);
        showErrorToast("Unable to delete collaborator.", result.error);
        return;
      }

      setCollaborators((current) =>
        current.filter((collaborator) => collaborator.id !== collaboratorPendingDelete.id),
      );
      setCollaboratorPendingDelete(null);
      setPageNotice("Collaborator deleted successfully.");
      showSuccessToast("Collaborator deleted successfully.");
    } catch {
      setDeleteError("Unable to delete the collaborator right now. Please try again.");
      showErrorToast(
        "Unable to delete collaborator.",
        "Unable to delete the collaborator right now. Please try again.",
      );
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <>
      <section className="space-y-6">
        <MotionSection>
          <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-[42px] font-[600] leading-none tracking-[-0.05em] text-[#0f1411] sm:text-[56px]">
                Collaboration
              </h1>
              <p className="mt-3 max-w-[760px] text-[15px] leading-6 text-[#6f7771]">
                Manage USER account contact records and invitation details here. Role permissions
                and per-user Archive access are managed from Users.
              </p>
            </div>

            {canManagePermissions ? (
              <Button asChild variant="outline" className="gap-2 rounded-[16px]">
                <Link href="/users">
                  <ShieldCheck className="h-4 w-4" />
                  Manage permission profiles
                </Link>
              </Button>
            ) : null}
          </header>
        </MotionSection>

        <MotionSection y={10}>
          <Card className="rounded-[24px] border border-[#dfe7df] bg-[#fbfcfa] shadow-none">
            <CardContent className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[18px] font-[700] text-[#18201a]">
                  Permission model
                </p>
                <p className="mt-1 text-[14px] leading-6 text-[#6f7771]">
                  Access is controlled by permission profiles and hard business rules.
                </p>
              </div>
              <Badge variant="outline" className="w-fit border-[#d8e6d7] bg-white text-[#4d6552]">
                Collaboration directory
              </Badge>
            </CardContent>
          </Card>
        </MotionSection>

        <MotionSection y={10}>
          <section className="rounded-[30px] bg-surface p-6 shadow-[0_22px_60px_rgba(23,39,28,0.06)]">
            {pageNotice ? (
              <div className="mb-5 rounded-[18px] border border-[#f7dfb6] bg-[#fff8eb] px-4 py-3 text-[13px] text-[#946113]">
                {pageNotice}
              </div>
            ) : null}

            <div className="flex flex-col gap-4 border-b border-[#e4e9e4] pb-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-[24px] font-[700] tracking-[-0.03em] text-[#434747]">
                  Collaborators
                </h2>
                <p className="mt-2 text-[14px] text-[#6f7771]">
                  Internal users available for project and calendar collaboration.
                </p>
              </div>

              {canSaveCollaborators ? (
                <Button type="button" onClick={openInviteDialog} className="self-start xl:self-auto">
                  Invite <Plus className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <Card className="mt-5 overflow-hidden rounded-[24px] border border-transparent bg-white">
              <CardContent className="p-0">
                <div
                  className={cn(
                    "hidden items-center gap-4 border-b border-[#e4e9e4] px-5 py-4 lg:grid",
                    canShowActions
                      ? "grid-cols-[minmax(220px,1.25fr)_minmax(220px,1fr)_96px]"
                      : "grid-cols-[minmax(220px,1.25fr)_minmax(220px,1fr)]",
                  )}
                >
                  <span className="text-[12px] font-[700] uppercase tracking-[0.18em] text-[#818982]">
                    Name
                  </span>
                  <span className="text-[12px] font-[700] uppercase tracking-[0.18em] text-[#818982]">
                    Email
                  </span>
                  {canShowActions ? (
                    <span className="text-right text-[12px] font-[700] uppercase tracking-[0.18em] text-[#818982]">
                      Actions
                    </span>
                  ) : null}
                </div>

                <div className="divide-y divide-[#edf1ed]">
                  {collaborators.length > 0 ? collaborators.map((collaborator) => (
                    <MotionItem
                      key={collaborator.id}
                      layout
                      className={cn(
                        "grid gap-4 px-5 py-4 lg:items-center",
                        canShowActions
                          ? "lg:grid-cols-[minmax(220px,1.25fr)_minmax(220px,1fr)_96px]"
                          : "lg:grid-cols-[minmax(220px,1.25fr)_minmax(220px,1fr)]",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#dff3e7] text-[12px] font-[700] text-brand">
                          {getInitials(collaborator.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="min-w-0 whitespace-normal break-words text-[15px] font-[600] text-[#1f2923]">
                            {collaborator.name}
                          </p>
                          <p className="truncate text-[11px] text-[#8b948d] lg:hidden">
                            {collaborator.email}
                          </p>
                        </div>
                      </div>

                      <p className="hidden truncate text-[14px] text-[#5f6b62] lg:block">
                        {collaborator.email}
                      </p>

                      {canShowActions ? (
                        <div className="flex justify-end gap-2">
                          {canSaveCollaborators ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              onClick={() => openEditDialog(collaborator)}
                              className="h-9 w-9 border border-[#d9dfda] shadow-none"
                              aria-label={`Edit ${collaborator.name}`}
                            >
                              <PenLine className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDeleteCollaborators ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              onClick={() => {
                                setDeleteError(undefined);
                                setCollaboratorPendingDelete(collaborator);
                              }}
                              className="h-9 w-9 border border-[#f0d7d5] text-[#c95955] shadow-none hover:bg-[#fff3f2] hover:text-[#b94844]"
                              aria-label={`Delete ${collaborator.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </MotionItem>
                  )) : (
                    <div className="px-5 py-12 text-center text-[14px] text-[#6f7771]">
                      No collaborators have been invited yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>
        </MotionSection>
      </section>

      <CollaboratorDialog
        isOpen={dialogOpen}
        mode={dialogMode}
        form={form}
        error={dialogError}
        saving={saving}
        onClose={() => {
          setDialogError(undefined);
          setDialogOpen(false);
        }}
        onSubmit={handleSaveCollaborator}
        onChange={setFormValue}
      />

      <ConfirmationDialog
        isOpen={Boolean(collaboratorPendingDelete)}
        title="Delete collaborator?"
        description="This will permanently delete this collaborator and remove their related access records. This action cannot be undone."
        confirmLabel="Delete Collaborator"
        cancelLabel="Cancel"
        tone="destructive"
        pending={deletePending}
        error={deleteError}
        onConfirm={handleDeleteCollaborator}
        onClose={() => {
          if (deletePending) {
            return;
          }

          setDeleteError(undefined);
          setCollaboratorPendingDelete(null);
        }}
      />
    </>
  );
}

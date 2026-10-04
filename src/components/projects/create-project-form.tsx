"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";

import { saveCollaboratorAction } from "@/app/(dashboard)/collaboration/actions";
import {
  createProjectV2Action,
  updateProjectV2Action,
} from "@/app/(dashboard)/projects/new/v2-actions";
import {
  CollaboratorDialog,
  type CollaboratorForm,
} from "@/components/collaboration/collaborator-dialog";
import {
  ProjectUserSelector,
  type ProjectUserOption,
} from "@/components/projects/project-user-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CollaboratorRecord } from "@/lib/collaboration";
import type { ProjectOwnerCandidate } from "@/lib/project-owner-candidates";
import { showErrorToast, showSuccessToast, showWarningToast } from "@/lib/toast";

import { StageDefinitionBuilder } from "./stage-definition-builder";
import { newStageDefinition, type StageDefinitionInput, type TemplateKey } from "@/lib/project-template-definitions";
import type { ProjectTemplateOption } from "@/lib/project-templates";

type CreateProjectFormProps = {
  templates?: ProjectTemplateOption[];
  currentUser: ProjectUserOption;
  eligibleOwnerCandidates: ProjectOwnerCandidate[];
  availableCollaborators: CollaboratorRecord[];
  canInviteCollaborator: boolean;
  mode?: "create" | "edit";
  initialProject?: {
    id: string;
    name: string;
    ownerId: string;
    coOwnerIds: string[];
    executorIds: string[];
    collaboratorIds: string[];
  };
};

type FormErrors = {
  template?: string;
  name?: string;
  owner?: string;
  coOwners?: string;
  executors?: string;
  collaborators?: string;
};

function getDefaultCollaboratorForm(): CollaboratorForm {
  return {
    name: "",
    email: "",
  };
}

function toUserOption(collaborator: CollaboratorRecord): ProjectUserOption {
  return {
    id: collaborator.id,
    name: collaborator.name,
    email: collaborator.email,
    role: "USER",
  };
}

function upsertCollaborator(
  collaborators: CollaboratorRecord[],
  nextCollaborator: CollaboratorRecord,
) {
  const existingIndex = collaborators.findIndex(
    (collaborator) => collaborator.id === nextCollaborator.id,
  );

  if (existingIndex < 0) {
    return [...collaborators, nextCollaborator];
  }

  return collaborators.map((collaborator, index) =>
    index === existingIndex ? nextCollaborator : collaborator,
  );
}

export function CreateProjectForm({
  currentUser,
  templates = [],
  eligibleOwnerCandidates,
  availableCollaborators,
  canInviteCollaborator,
  mode = "create",
  initialProject,
}: CreateProjectFormProps) {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState<TemplateKey | "">("");
  const [customStages, setCustomStages] = useState<StageDefinitionInput[]>([newStageDefinition("Brief")]);
  const selectedTemplate = templates.find(template => template.key === templateKey);
  const [isCreating, startCreating] = useTransition();
  const editingProjectId = mode === "edit" ? initialProject?.id : undefined;
  const isEditing = Boolean(editingProjectId);
  const [projectName, setProjectName] = useState(initialProject?.name ?? "");
  const [collaborators, setCollaborators] = useState(availableCollaborators);
  const ownerId = initialProject?.ownerId ?? currentUser.id;
  const [coOwnerIds, setCoOwnerIds] = useState<string[]>(
    initialProject?.coOwnerIds ?? [],
  );
  const [executorIds, setExecutorIds] = useState<string[]>(
    initialProject?.executorIds ?? [],
  );
  const [selfManaged, setSelfManaged] = useState(
    Boolean(initialProject && initialProject.executorIds.length === 0),
  );
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(
    initialProject?.collaboratorIds ?? [],
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<CollaboratorForm>(
    getDefaultCollaboratorForm,
  );
  const [inviteError, setInviteError] = useState<string>();
  const [inviteSaving, setInviteSaving] = useState(false);

  const collaboratorUserOptions = useMemo(() => {
    const options = collaborators.map(toUserOption);
    const uniqueOptions = new Map(options.map((user) => [user.id, user] as const));

    return [...uniqueOptions.values()];
  }, [collaborators]);
  const executorOptions = useMemo(
    () => collaboratorUserOptions.filter((user) => !collaboratorIds.includes(user.id)),
    [collaboratorIds, collaboratorUserOptions],
  );
  const coOwnerCandidateOptions = useMemo(() => {
    const options: ProjectUserOption[] = eligibleOwnerCandidates
      .filter((candidate) => candidate.role === "ADMIN")
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        role: candidate.role,
        avatarSrc: candidate.id === currentUser.id ? currentUser.avatarSrc : null,
      }));
    return [...new Map(options.map((user) => [user.id, user] as const)).values()];
  }, [currentUser, eligibleOwnerCandidates]);
  const projectOwner = useMemo(
    () =>
      currentUser.id === ownerId
        ? currentUser
        : eligibleOwnerCandidates.find((candidate) => candidate.id === ownerId),
    [currentUser, eligibleOwnerCandidates, ownerId],
  );
  const coOwnerOptions = useMemo(
    () =>
      coOwnerCandidateOptions.filter(
        (user) =>
          user.id !== ownerId && !collaboratorIds.includes(user.id),
      ),
    [coOwnerCandidateOptions, collaboratorIds, ownerId],
  );
  const projectCollaboratorOptions = useMemo(
    () =>
      collaboratorUserOptions.filter(
        (user) =>
          user.id !== ownerId &&
          !coOwnerIds.includes(user.id) &&
          !executorIds.includes(user.id),
      ),
    [coOwnerIds, collaboratorUserOptions, executorIds, ownerId],
  );

  function openInviteDialog() {
    if (!canInviteCollaborator) {
      showWarningToast(
        "Invitation unavailable.",
        "You do not have permission to invite collaborators.",
      );
      return;
    }

    setInviteForm(getDefaultCollaboratorForm());
    setInviteError(undefined);
    setInviteOpen(true);
  }

  async function handleInviteCollaborator() {
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) {
      const message = "Enter both collaborator name and email.";
      setInviteError(message);
      return;
    }

    setInviteSaving(true);
    setInviteError(undefined);

    try {
      const result = await saveCollaboratorAction({
        ...inviteForm,
        allowExistingUser: true,
      });

      if ("error" in result) {
        setInviteError(result.error);
        return;
      }

      setCollaborators((current) => upsertCollaborator(current, result.collaborator));
      setCollaboratorIds((current) =>
        current.includes(result.collaborator.id)
          ? current
          : [...current, result.collaborator.id],
      );
      setErrors((current) => ({ ...current, collaborators: undefined }));
      setInviteOpen(false);
      showSuccessToast("Collaborator invited and added to the project.");

      if (result.warning) {
        showWarningToast("Collaborator saved with a warning.", result.warning);
      }
    } catch {
      const message = "Unable to invite the collaborator right now. Please try again.";
      setInviteError(message);
      showErrorToast("Unable to invite collaborator.", message);
    } finally {
      setInviteSaving(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreating) {
      return;
    }

    if (!isEditing && !selectedTemplate) { showErrorToast("Choose a Project Type / Template."); return; }
    const nextErrors: FormErrors = {};

    if (!projectName.trim()) {
      nextErrors.name = "Project name is required.";
    }

    if (!selfManaged && executorIds.length === 0) {
      nextErrors.executors = "Select at least one project executor.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      showErrorToast("Review the highlighted fields.");
      return;
    }

    startCreating(async () => {
      const input = {
        templateKey: templateKey || undefined,
        templateVersionId: selectedTemplate?.version.id,
        customStages: templateKey === "CUSTOM" ? customStages : undefined,
        name: projectName,
        ownerId,
        coOwnerIds,
        executorIds: selfManaged ? [] : executorIds,
        collaboratorIds,
      };
      const result = isEditing
        ? await updateProjectV2Action(editingProjectId!, input)
        : await createProjectV2Action(input);

      if ("error" in result) {
        setErrors({
          template: result.fieldErrors?.templateKey,
          name: result.fieldErrors?.name,
          owner: result.fieldErrors?.ownerId,
          coOwners: result.fieldErrors?.coOwnerIds,
          executors: result.fieldErrors?.executorIds,
          collaborators: result.fieldErrors?.collaboratorIds,
        });
        showErrorToast(
          isEditing ? "Unable to update project." : "Unable to create project.",
          result.error,
        );
        return;
      }

      showSuccessToast(
        isEditing
          ? "Project updated successfully."
          : "Project created successfully.",
      );
      router.push(`/projects/${result.projectId}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] pb-4 sm:pb-8">
      <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-2 text-[13px] sm:text-[14px]">
        <Link href="/projects" className="font-[550] text-[#778079] transition hover:text-brand">
          Projects
        </Link>
        <span className="text-[#a0a7a1]" aria-hidden="true">
          /
        </span>
        <span className="font-[650] text-[#263029]">
          {isEditing ? "Edit Project" : "Create Project"}
        </span>
      </nav>

      <h1 className="text-[30px] font-[750] tracking-[-0.045em] text-[#111713] sm:text-[38px]">
        {isEditing ? "Edit Project" : "Create Project"}
      </h1>

      <form onSubmit={handleSubmit} noValidate className="mt-7 sm:mt-8">
        {!isEditing && <section className="mb-6 rounded-[22px] border border-[#d9e0d9] bg-white p-6">
          <label htmlFor="project-template" className="text-sm font-bold">Project Type / Template *</label>
          <select id="project-template" aria-invalid={Boolean(errors.template)} required value={templateKey} onChange={e=>setTemplateKey(e.target.value as TemplateKey)} className="mt-2 block w-full rounded-xl border p-3">
            <option value="">Choose a template</option>
            {templates.map(template=><option key={template.key} value={template.key}>{template.name}</option>)}
          </select>
          {errors.template && <p className="mt-2 text-sm text-red-700">{errors.template}</p>}
          {selectedTemplate && <div className="mt-5">
            <p className="mb-3 text-sm text-[#68736b]">{selectedTemplate.name} · Version {selectedTemplate.version.version}. This project keeps its own stage configuration.</p>
            {templateKey === "CUSTOM" ? <>
              <p className="mb-4 text-sm">Define your stages. Director approval is required before work begins.</p>
              <StageDefinitionBuilder stages={customStages} onChange={setCustomStages} disabled={isCreating} />
            </> : <ol className="grid gap-2 sm:grid-cols-2">{selectedTemplate.version.stages.map(stage=><li key={stage.id} className="rounded-lg bg-[#f3f7f3] p-3 text-sm"><span className="mr-2 font-bold">{stage.order}.</span>{stage.name}</li>)}</ol>}
          </div>}
        </section>}
        <div className="rounded-[22px] border border-[#d9e0d9] bg-white px-5 py-6 shadow-[0_12px_34px_rgba(20,36,25,0.035)] sm:px-8 sm:py-8 lg:px-10">
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-[190px_minmax(0,1fr)] md:items-start md:gap-y-7">
            <label htmlFor="project-name" className="pt-0 text-[14px] font-[700] text-[#18211b] md:pt-[16px]">
              Project Name
            </label>
            <div>
              <Input
                id="project-name"
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder="Enter project name"
                className={`h-[54px] rounded-[16px] border px-4 text-[14px] shadow-none ${
                  errors.name ? "border-[#c85c54]" : "border-[#d9e0d9]"
                }`}
                autoComplete="off"
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name ? (
                <p className="mt-1.5 text-[12px] text-[#b84e48]">{errors.name}</p>
              ) : null}
            </div>

            <div className="pt-0 text-[14px] font-[700] text-[#18211b] md:pt-[16px]">
              Project Owner
            </div>
            <div className="rounded-[16px] border border-[#d9e0d9] bg-[#f8faf8] px-4 py-3">
              <p className="text-[14px] font-[700] text-[#18211b]">
                {projectOwner?.name ?? "Project creator"}
              </p>
              <p className="mt-0.5 text-[12px] text-[#768078]">
                {projectOwner?.email ?? "The project owner is fixed when the project is created."}
              </p>
            </div>

            <div className="pt-0 text-[14px] font-[700] text-[#18211b] md:pt-[16px]">
              Project Co-Owners
            </div>
            <ProjectUserSelector
              users={coOwnerOptions}
              selectedIds={coOwnerIds}
              onChange={(nextIds) => {
                setCoOwnerIds(nextIds);
                setCollaboratorIds((current) =>
                  current.filter((id) => !nextIds.includes(id)),
                );
                setErrors((current) => ({ ...current, coOwners: undefined }));
              }}
              mode="multiple"
              placeholder="Search users..."
              ariaLabel="Project co-owners"
              error={errors.coOwners}
            />

            <div className="pt-0 text-[14px] font-[700] text-[#18211b] md:pt-[16px]">
              Project Executors
            </div>
            <div className="space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={selfManaged}
                onClick={() => {
                  const nextSelfManaged = !selfManaged;
                  setSelfManaged(nextSelfManaged);
                  if (nextSelfManaged) setExecutorIds([]);
                  setErrors((current) => ({ ...current, executors: undefined }));
                }}
                className={`flex w-full items-start gap-3 rounded-[16px] border px-4 py-3.5 text-left transition ${
                  selfManaged
                    ? "border-[#8fbea0] bg-[#f0f8f2]"
                    : "border-[#d9e0d9] bg-white hover:border-[#b9c9bc]"
                }`}
              >
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${
                    selfManaged
                      ? "border-[#36825a] bg-[#36825a] text-white"
                      : "border-[#cbd5cd] bg-white text-transparent"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[13px] font-[720] text-[#213027]">
                    Manage this project myself
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-[#6f7b72]">
                    {templateKey === "PACKAGING" ? "No executor will be assigned. Empty Stages 3 and 4 can be skipped, then the final file can be uploaded directly in Stage 5." : "You and the co-owners will manage the project stages. No executor will be assigned."}
                  </span>
                </span>
              </button>

              {!selfManaged ? (
                <ProjectUserSelector
                  users={executorOptions}
                  selectedIds={executorIds}
                  onChange={(nextIds) => {
                    setExecutorIds(nextIds);
                    setCollaboratorIds((current) =>
                      current.filter((id) => !nextIds.includes(id)),
                    );
                    setErrors((current) => ({ ...current, executors: undefined }));
                  }}
                  mode="multiple"
                  placeholder="Search users..."
                  ariaLabel="Project executors"
                  error={errors.executors}
                />
              ) : null}
            </div>

            <div className="pt-0 text-[14px] font-[700] text-[#18211b] md:pt-[16px]">
              Project Collaborators
            </div>
            <div>
              <ProjectUserSelector
                users={projectCollaboratorOptions}
                selectedIds={collaboratorIds}
                onChange={(nextIds) => {
                  setCollaboratorIds(nextIds);
                  setErrors((current) => ({ ...current, collaborators: undefined }));
                }}
                mode="multiple"
                placeholder="Search users..."
                ariaLabel="Project collaborators"
                error={errors.collaborators}
              />
              <p className="mt-2 text-[12px] text-[#768078]">
                Add people who will participate in or access this project.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <button
                  type="button"
                  onClick={openInviteDialog}
                  aria-disabled={!canInviteCollaborator}
                  title={
                    canInviteCollaborator
                      ? undefined
                      : "You do not have permission to invite collaborators."
                  }
                  className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] font-[650] text-brand transition hover:text-brand-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                >
                  <UserPlus className="h-4 w-4" />
                  Invite collaborator
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <Button
            type="submit"
            size="lg"
            disabled={isCreating}
            className="min-w-[170px] rounded-[14px]"
          >
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isCreating
              ? isEditing
                ? "Saving..."
                : "Creating..."
              : isEditing
                ? "Save Changes"
                : "Create Project"}
          </Button>
          <Button
            asChild
            type="button"
            size="lg"
            variant="secondary"
            className="min-w-[112px] rounded-[14px] shadow-none"
          >
            <Link href={isEditing ? `/projects/${editingProjectId}` : "/projects"}>
              Cancel
            </Link>
          </Button>
        </div>
      </form>

      <CollaboratorDialog
        isOpen={inviteOpen}
        mode="invite"
        form={inviteForm}
        error={inviteError}
        saving={inviteSaving}
        onClose={() => {
          if (!inviteSaving) {
            setInviteOpen(false);
          }
        }}
        onSubmit={handleInviteCollaborator}
        onChange={(field, value) => {
          setInviteForm((current) => ({ ...current, [field]: value }));
          setInviteError(undefined);
        }}
      />
    </div>
  );
}

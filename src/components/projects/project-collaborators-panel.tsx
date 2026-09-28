"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import type { ProjectCollaboratorRecord, ProjectExecutorRecord } from "@/lib/projects";

type ProjectCollaboratorsPanelProps = {
  collaborators: ProjectCollaboratorRecord[];
  currentUserId?: string;
  onRemove?: (id: string) => void | Promise<void>;
  onAdd?: () => void;
  addLabel?: string;
  onToggleChatVisibility?: (id: string, paused: boolean) => void | Promise<void>;
  saving?: boolean;
};

type ProjectExecutorsPanelProps = {
  executors: ProjectExecutorRecord[];
  currentUserId?: string;
  onToggleChatVisibility?: (id: string, paused: boolean) => void | Promise<void>;
  saving?: boolean;
};

type PendingCollaboratorAction =
  | {
      kind: "remove";
      collaborator: ProjectCollaboratorRecord;
    }
  | {
      kind: "pause";
      collaborator: ProjectCollaboratorRecord;
    }
  | {
      kind: "resume";
      collaborator: ProjectCollaboratorRecord;
    };

type PendingExecutorAction =
  | {
      kind: "pause";
      executor: ProjectExecutorRecord;
    }
  | {
      kind: "resume";
      executor: ProjectExecutorRecord;
    };

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getExecutorRoleBadgeClassName() {
  return "border border-[#dde7df] bg-[#f6f8f6] text-[#34614a]";
}

function getExecutorGroupBadgeClassName(executor: ProjectExecutorRecord) {
  return executor.group === "external"
    ? "border border-[#f1dfcf] bg-[#fff4ea] text-[#ca7b3b]"
    : "border border-[#d7ead7] bg-[#eef8ef] text-[#2f8d5d]";
}

function CollaboratorVisibilityButton({
  collaborator,
  disabled,
  onClick,
}: {
  collaborator: ProjectCollaboratorRecord;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isHidden = collaborator.chatVisibilityPaused;
  const Icon = isHidden ? EyeOff : Eye;
  const title = isHidden ? "Hidden from chat" : "Visible in chat";

  return (
    <Button
      type="button"
      onClick={onClick}
      variant="ghost"
      size="icon"
      className={`size-8 rounded-full border ${
        isHidden
          ? "border-[#f1cdca] bg-[#fff7f6] text-[#d86158] hover:bg-[#fff1f0] hover:text-[#c64f48]"
          : "border-[#cde8d4] bg-[#f7fcf8] text-[#2f8d5d] hover:bg-[#eef8ef] hover:text-[#238657]"
      }`}
      disabled={disabled}
      title={title}
      aria-label={`${isHidden ? "Restore" : "Hide"} chat access for ${collaborator.name}`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

function CollaboratorCompactRow({
  collaborator,
  actions,
  variant = "panel",
}: {
  collaborator: ProjectCollaboratorRecord;
  actions?: ReactNode;
  variant?: "panel" | "modal";
}) {
  const isModal = variant === "modal";

  return (
    <li
      className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border transition hover:border-brand/20 hover:bg-[#fbfdfb] ${
        isModal
          ? "rounded-[16px] border-[#e3e9e2] bg-white/90 px-4 py-3 shadow-[0_8px_22px_rgba(17,31,23,0.035)]"
          : "rounded-[14px] border-[#e5ebe5] bg-[#fbfcfa] px-2.5 py-2"
      }`}
    >
      <div
        className={`grid shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#f0dcc4,#b58257)] font-[700] text-white shadow-[0_8px_18px_rgba(181,130,87,0.18)] ${
          isModal ? "h-10 w-10 text-[12px]" : "h-8 w-8 text-[10px]"
        }`}
      >
        {getInitials(collaborator.name)}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className={`min-w-0 whitespace-normal break-words font-semibold leading-5 text-[#111712] ${isModal ? "text-[14px]" : "text-[12px]"}`}>
            {collaborator.name}
          </p>
        </div>
        <p className={`${isModal ? "text-[12px]" : "text-[10px]"} truncate leading-4 text-[#707b73]`}>
          {collaborator.email ?? collaborator.role}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 items-center justify-end gap-0.5">{actions}</div> : <span />}
    </li>
  );
}

function ExecutorCompactRow({
  executor,
  actions,
}: {
  executor: ProjectExecutorRecord;
  actions?: ReactNode;
}) {
  return (
    <li
      className="grid min-h-[62px] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[16px] border border-[#e1e8e1] bg-[#fbfcfa] px-3 py-3 shadow-[0_8px_20px_rgba(17,31,23,0.025)]"
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#d7efe0,#2f8d5d)] text-[11px] font-[800] text-white shadow-[0_10px_20px_rgba(47,141,93,0.16)]">
        {getInitials(executor.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 whitespace-normal break-words text-[13px] font-[800] leading-5 text-[#111712]">
            {executor.name}
          </p>
        </div>
        <p className="truncate text-[11px] font-[500] leading-4 text-[#747f78]">
          {executor.email ?? executor.roleLabel}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex max-w-[126px] flex-col items-end gap-1.5">
          <span
            className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[9px] font-[800] uppercase leading-4 ${getExecutorRoleBadgeClassName()}`}
          >
            <span className="truncate">{executor.roleLabel}</span>
          </span>
          <span
            className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[9px] font-[800] uppercase leading-4 ${getExecutorGroupBadgeClassName(
              executor,
            )}`}
          >
            <span className="truncate">
              {executor.group === "external" ? "External Collaborator" : "Internal Collaborator"}
            </span>
          </span>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
    </li>
  );
}

function ExecutorVisibilityButton({
  executor,
  disabled,
  onClick,
}: {
  executor: ProjectExecutorRecord;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isHidden = executor.chatVisibilityPaused;
  const Icon = isHidden ? EyeOff : Eye;
  const title = isHidden ? "Hidden from chat" : "Visible in chat";

  return (
    <Button
      type="button"
      onClick={onClick}
      variant="ghost"
      size="icon"
      className={`size-8 rounded-full border ${
        isHidden
          ? "border-[#f1cdca] bg-[#fff7f6] text-[#d86158] hover:bg-[#fff1f0] hover:text-[#c64f48]"
          : "border-[#cde8d4] bg-[#f7fcf8] text-[#2f8d5d] hover:bg-[#eef8ef] hover:text-[#238657]"
      }`}
      disabled={disabled}
      title={title}
      aria-label={`${isHidden ? "Restore" : "Hide"} chat access for ${executor.name}`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

function ProjectExecutorsModal({
  executors,
  currentUserId,
  saving,
  onRequestChatVisibilityAction,
  isOpen,
  onClose,
}: {
  executors: ProjectExecutorRecord[];
  currentUserId?: string;
  saving?: boolean;
  onRequestChatVisibilityAction?: (
    action: PendingExecutorAction,
  ) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredExecutors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return executors;
    }

    return executors.filter((executor) =>
      [
        executor.name,
        executor.email ?? "",
        executor.roleLabel,
        executor.group,
      ].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [executors, query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-[720px] rounded-[24px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-[#111712]">
                Project Executors
              </h2>
              <p className="mt-1 text-[12px] text-[#6f7a72]">
                {executors.length} total
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onClose}
              className="shrink-0 border border-line"
              aria-label="Close project executors"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e978f]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search executors..."
              className="h-10 rounded-[14px] border border-line pl-10 text-[13px]"
              autoFocus
            />
          </div>

          <div className="mt-4 max-h-[430px] overflow-y-auto pr-1">
            {filteredExecutors.length > 0 ? (
              <ul className="space-y-2">
                {filteredExecutors.map((executor) => {
                  const canToggle =
                    Boolean(onRequestChatVisibilityAction) &&
                    executor.id !== currentUserId;

                  return (
                    <ExecutorCompactRow
                      key={executor.id}
                      executor={executor}
                      actions={
                        canToggle ? (
                          <ExecutorVisibilityButton
                            executor={executor}
                            disabled={saving}
                            onClick={() =>
                              onRequestChatVisibilityAction?.({
                                kind: executor.chatVisibilityPaused ? "resume" : "pause",
                                executor,
                              })
                            }
                          />
                        ) : undefined
                      }
                    />
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[#d6ddd6] bg-[#fbfcfa] px-5 py-10 text-center">
                <p className="text-[14px] font-[700] text-[#2a332d]">
                  No executors found.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProjectExecutorsPanel({
  executors,
  currentUserId,
  onToggleChatVisibility,
  saving = false,
}: ProjectExecutorsPanelProps) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingExecutorAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sortedExecutors = useMemo(
    () =>
      [...executors].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      ),
    [executors],
  );
  const visibleExecutors = sortedExecutors.slice(0, 4);
  const hiddenExecutorCount = Math.max(sortedExecutors.length - visibleExecutors.length, 0);

  async function handleConfirmAction() {
    if (!pendingAction) {
      return;
    }

    setActionError(null);

    try {
      await Promise.resolve(
        onToggleChatVisibility?.(
          pendingAction.executor.id,
          pendingAction.kind === "pause",
        ),
      );
      setPendingAction(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Unable to update chat visibility right now.",
      );
    }
  }

  const confirmationTitle =
    pendingAction?.kind === "pause"
      ? "Hide executor from chat?"
      : "Restore chat access?";
  const confirmationDescription =
    pendingAction?.kind === "pause"
      ? "They will not see new chat messages or files until access is restored."
      : "They will see new messages and files from this point forward.";
  const confirmationLabel =
    pendingAction?.kind === "pause" ? "Hide from Chat" : "Restore Access";

  return (
    <>
      <Card className="rounded-[24px] border border-[#e0e7df] bg-white shadow-[0_18px_45px_rgba(23,39,28,0.055)]">
        <CardHeader className="flex-col items-start gap-2 px-5 pb-3 pt-5">
          <div className="flex w-full items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#eef8ef] text-brand">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-[20px] font-[800] leading-tight">
                  Project Executors
                </CardTitle>
                <p className="mt-1 text-[13px] font-[500] leading-5 text-[#7a837b]">
                  {sortedExecutors.length} {sortedExecutors.length === 1 ? "member" : "members"}
                </p>
              </div>
            </div>
            {hiddenExecutorCount > 0 ? (
              <button
                type="button"
                onClick={() => setViewAllOpen(true)}
                className="shrink-0 rounded-full bg-[#eef8ef] px-2.5 py-1 text-[11px] font-[800] text-brand"
              >
                +{hiddenExecutorCount} more
              </button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="px-5 pb-5 pt-0">
          {visibleExecutors.length > 0 ? (
            <ul className="space-y-2">
              {visibleExecutors.map((executor) => {
                const canToggle =
                  Boolean(onToggleChatVisibility) && executor.id !== currentUserId;

                return (
                  <ExecutorCompactRow
                    key={executor.id}
                    executor={executor}
                    actions={
                      canToggle ? (
                        <ExecutorVisibilityButton
                          executor={executor}
                          disabled={saving}
                          onClick={() => {
                            setActionError(null);
                            setPendingAction({
                              kind: executor.chatVisibilityPaused ? "resume" : "pause",
                              executor,
                            });
                          }}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          ) : (
            <p className="rounded-[14px] border border-dashed border-[#d6ddd6] bg-[#fbfcfa] px-4 py-5 text-[13px] text-[#7a837b]">
              Self-managed project — no executor assigned.
            </p>
          )}

          {hiddenExecutorCount > 0 ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setViewAllOpen(true)}
                className="h-9 w-full justify-between px-1 text-[12px] font-[800] text-brand hover:bg-transparent"
              >
                View all executors
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : sortedExecutors.length > 0 ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setViewAllOpen(true)}
                className="h-9 w-full justify-between px-1 text-[12px] font-[800] text-brand hover:bg-transparent"
              >
                View all executors
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ProjectExecutorsModal
        executors={sortedExecutors}
        currentUserId={currentUserId}
        saving={saving}
        onRequestChatVisibilityAction={
          onToggleChatVisibility
            ? (action) => {
                setActionError(null);
                setPendingAction(action);
              }
            : undefined
        }
        isOpen={viewAllOpen}
        onClose={() => setViewAllOpen(false)}
      />

      <ConfirmationDialog
        isOpen={pendingAction !== null}
        title={confirmationTitle}
        description={confirmationDescription}
        confirmLabel={confirmationLabel}
        cancelLabel="Cancel"
        tone="default"
        pending={saving}
        error={actionError ?? undefined}
        onClose={() => {
          if (saving) {
            return;
          }

          setActionError(null);
          setPendingAction(null);
        }}
        onConfirm={() => {
          void handleConfirmAction();
        }}
      />
    </>
  );
}

function ProjectCollaboratorsModal({
  collaborators,
  currentUserId,
  saving,
  onRequestRemoveAction,
  onRequestChatVisibilityAction,
  isOpen,
  onClose,
}: {
  collaborators: ProjectCollaboratorRecord[];
  currentUserId?: string;
  saving?: boolean;
  onRequestRemoveAction?: (
    action: Extract<PendingCollaboratorAction, { kind: "remove" }>,
  ) => void;
  onRequestChatVisibilityAction?: (
    action: Exclude<PendingCollaboratorAction, { kind: "remove" }>,
  ) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredCollaborators = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return collaborators;
    }

    return collaborators.filter((collaborator) =>
        collaborator.name.toLowerCase().includes(normalizedQuery) ||
        (collaborator.email ?? "").toLowerCase().includes(normalizedQuery) ||
        collaborator.group.toLowerCase().includes(normalizedQuery),
    );
  }, [collaborators, query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/50 px-4 py-8 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-[760px] overflow-hidden rounded-[28px] border border-[#dfe7df] bg-white shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardContent className="p-0">
          <div className="flex items-start justify-between gap-4 border-b border-[#eef2ee] px-5 py-5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#eef8f0] text-brand">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-[#111712]">
                  Project Collaborators
                </h2>
                <p className="mt-1 text-[12px] text-[#6f7a72]">
                  {collaborators.length} {collaborators.length === 1 ? "collaborator" : "collaborators"}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onClose}
              className="shrink-0 border border-line"
              aria-label="Close project collaborators"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="px-5 pt-5 sm:px-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e978f]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search collaborators..."
                className="h-11 rounded-[16px] border border-[#dce6de] bg-[#fbfdfb] pl-10 text-[13px] shadow-none focus-visible:ring-brand/20"
                autoFocus
              />
            </div>
          </div>

          <div className="no-scrollbar mx-5 mt-4 max-h-[58vh] overflow-y-auto sm:mx-6 sm:max-h-[520px]">
            {filteredCollaborators.length > 0 ? (
              <ul className="space-y-2 pb-1">
                {filteredCollaborators.map((collaborator) => {
                  const canToggleChatVisibility =
                    Boolean(onRequestChatVisibilityAction) &&
                    collaborator.access !== "owner" &&
                    collaborator.id !== currentUserId;
                  const canRemoveCollaborator =
                    Boolean(onRequestRemoveAction) && Boolean(collaborator.removable);

                  return (
                    <CollaboratorCompactRow
                      key={collaborator.id}
                      collaborator={collaborator}
                      variant="modal"
                      actions={
                        canToggleChatVisibility || canRemoveCollaborator ? (
                          <>
                            {canToggleChatVisibility ? (
                              <CollaboratorVisibilityButton
                                collaborator={collaborator}
                                disabled={saving}
                                onClick={() =>
                                  onRequestChatVisibilityAction?.({
                                    kind: collaborator.chatVisibilityPaused ? "resume" : "pause",
                                    collaborator,
                                  })
                                }
                              />
                            ) : null}
                            {canRemoveCollaborator ? (
                              <Button
                                type="button"
                                onClick={() =>
                                  onRequestRemoveAction?.({
                                    kind: "remove",
                                    collaborator,
                                  })
                                }
                                variant="ghost"
                                size="icon"
                                className="size-8 rounded-full text-[#ff6e68] hover:bg-[#fff1f0] hover:text-[#c64f48]"
                                disabled={saving}
                                title={`Remove ${collaborator.name}`}
                                aria-label={`Remove ${collaborator.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-[18px] border border-dashed border-[#d6ddd6] bg-[#fbfcfa] px-5 py-10 text-center">
                <p className="text-[14px] font-semibold text-[#2a332d]">
                  No collaborators found.
                </p>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center gap-2 border-t border-[#eef2ee] bg-[#fbfcfa] px-5 py-4 text-[12px] text-[#6f786f] sm:px-6">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand" />
            <p className="min-w-0">Only project collaborators can access this project.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProjectCollaboratorsSummary({
  collaborators,
  currentUserId,
  onRemove,
  onAdd,
  addLabel = "Add Collaborator",
  onToggleChatVisibility,
  saving = false,
}: ProjectCollaboratorsPanelProps) {
  const [pendingAction, setPendingAction] = useState<PendingCollaboratorAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const visibleCollaborators = collaborators.slice(0, 5);
  const hiddenCollaboratorCount = Math.max(collaborators.length - visibleCollaborators.length, 0);

  async function handleConfirmAction() {
    if (!pendingAction) {
      return;
    }

    setActionError(null);

    try {
      if (pendingAction.kind === "remove") {
        await Promise.resolve(onRemove?.(pendingAction.collaborator.id));
      } else {
        await Promise.resolve(
          onToggleChatVisibility?.(
            pendingAction.collaborator.id,
            pendingAction.kind === "pause",
          ),
        );
      }

      setPendingAction(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : pendingAction.kind === "remove"
            ? "Unable to remove the collaborator right now."
            : "Unable to update chat visibility right now.",
      );
    }
  }

  const confirmationTitle =
    pendingAction?.kind === "remove"
      ? "Remove collaborator?"
      : pendingAction?.kind === "pause"
        ? "Hide collaborator from chat?"
        : "Restore chat access?";
  const confirmationDescription =
    pendingAction?.kind === "remove"
      ? "This collaborator will be removed from the project and will no longer have access to project collaboration features."
      : pendingAction?.kind === "pause"
        ? "They will not see new chat messages or files until access is restored."
        : "They will see new messages and files from this point forward.";
  const confirmationLabel =
    pendingAction?.kind === "remove"
      ? "Remove Collaborator"
      : pendingAction?.kind === "pause"
        ? "Hide from Chat"
        : "Restore Access";

  return (
    <>
      <Card className="overflow-hidden rounded-[18px] border border-[#dfe8df] bg-white/95 shadow-[0_12px_28px_rgba(17,31,23,0.04)]">
        <CardHeader className="px-3.5 pb-3 pt-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef8f0] text-brand">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-[16px] font-semibold leading-[1.15] tracking-tight">
                  Project Collaborators
                </CardTitle>
                <p className="mt-1 text-[12px] font-[500] text-[#7a837b]">
                  {collaborators.length} {collaborators.length === 1 ? "member" : "members"}
                </p>
              </div>
            </div>
          </div>
          {onAdd ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onAdd}
              className="mt-3 h-8 min-h-8 w-full justify-center rounded-[13px] border border-[#dbe7dc] bg-[#f7fbf7] px-3 py-1.5 text-[12px] font-semibold text-brand hover:bg-[#eef8ef]"
            >
              <Plus className="h-4 w-4" />
              {addLabel}
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="px-3.5 pb-3.5 pt-0">
          {visibleCollaborators.length > 0 ? (
            <ul className="space-y-2">
              {visibleCollaborators.map((collaborator) => (
                <CollaboratorCompactRow
                  key={collaborator.id}
                  collaborator={collaborator}
                  actions={
                    (collaborator.removable && onRemove) ||
                    (onToggleChatVisibility &&
                      collaborator.access !== "owner" &&
                      collaborator.id !== currentUserId) ? (
                      <>
                        {onToggleChatVisibility &&
                        collaborator.access !== "owner" &&
                        collaborator.id !== currentUserId ? (
                          <CollaboratorVisibilityButton
                            collaborator={collaborator}
                            disabled={saving}
                            onClick={() => {
                              setActionError(null);
                              setPendingAction({
                                kind: collaborator.chatVisibilityPaused ? "resume" : "pause",
                                collaborator,
                              });
                            }}
                          />
                        ) : null}
                        {collaborator.removable && onRemove ? (
                          <Button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setPendingAction({
                                kind: "remove",
                                collaborator,
                              });
                            }}
                            variant="ghost"
                            size="icon"
                            className="size-8 text-[#ff6e68]"
                            disabled={saving}
                            aria-label={`Remove ${collaborator.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-[16px] border border-dashed border-[#d6ddd6] bg-[#fbfcfa] px-4 py-5 text-center text-[13px] text-[#7a837b]">
              No collaborators added yet.
            </p>
          )}

          {hiddenCollaboratorCount > 0 ? (
            <div className="mt-2.5 rounded-[14px] border border-[#dbe7dc] bg-[#f6fbf7] p-1">
              <button
                type="button"
                onClick={() => setViewAllOpen(true)}
                className="flex w-full items-center justify-between gap-2 rounded-[11px] px-2.5 py-2 text-left text-[12px] font-semibold text-brand transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
              >
                <span className="min-w-0 truncate">View all collaborators</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#2f8d5d] shadow-[0_6px_14px_rgba(17,31,23,0.05)]">
                    +{hiddenCollaboratorCount}
                  </span>
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ProjectCollaboratorsModal
        collaborators={collaborators}
        currentUserId={currentUserId}
        saving={saving}
        onRequestRemoveAction={
          onRemove
            ? (action) => {
                setActionError(null);
                setPendingAction(action);
              }
            : undefined
        }
        onRequestChatVisibilityAction={
          onToggleChatVisibility
            ? (action) => {
                setActionError(null);
                setPendingAction(action);
              }
            : undefined
        }
        isOpen={viewAllOpen}
        onClose={() => setViewAllOpen(false)}
      />

      <ConfirmationDialog
        isOpen={pendingAction !== null}
        title={confirmationTitle ?? "Update collaborator"}
        description={confirmationDescription ?? ""}
        confirmLabel={confirmationLabel ?? "Confirm"}
        cancelLabel="Cancel"
        tone={pendingAction?.kind === "remove" ? "destructive" : "default"}
        pending={saving}
        error={actionError ?? undefined}
        onClose={() => {
          if (saving) {
            return;
          }

          setActionError(null);
          setPendingAction(null);
        }}
        onConfirm={() => {
          void handleConfirmAction();
        }}
      />
    </>
  );
}

export function ProjectCollaboratorsPanel(props: ProjectCollaboratorsPanelProps) {
  return <ProjectCollaboratorsSummary {...props} />;
}

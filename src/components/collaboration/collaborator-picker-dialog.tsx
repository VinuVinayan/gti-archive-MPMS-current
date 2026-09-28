"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, UserPlus, X } from "lucide-react";

import type { CollaboratorRecord } from "@/lib/collaboration";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CollaboratorPickerDialogProps = {
  isOpen: boolean;
  title?: string;
  description?: string;
  collaborators: CollaboratorRecord[];
  selectedIds: string[];
  error?: string;
  saving?: boolean;
  onToggle: (collaboratorId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onInviteFallback?: () => void;
  confirmLabel?: string;
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CollaboratorPickerDialog({
  isOpen,
  title = "Add Collaborators",
  description = "Select existing collaborators from the workspace or invite a new one if not found.",
  collaborators,
  selectedIds,
  error,
  saving = false,
  onToggle,
  onClose,
  onConfirm,
  onInviteFallback,
  confirmLabel = "Add Collaborators",
}: CollaboratorPickerDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen || saving) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, saving]);

  const filteredCollaborators = useMemo(
    () =>
      collaborators.filter((collaborator) => {
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery = normalizedQuery
          ? collaborator.name.toLowerCase().includes(normalizedQuery) ||
            collaborator.email.toLowerCase().includes(normalizedQuery)
          : true;

        return matchesQuery;
      }),
    [collaborators, query],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-[760px] rounded-[28px] border border-[#e1e7e1] shadow-[0_35px_90px_rgba(11,26,18,0.22)]">
        <CardContent className="p-6 sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[24px] font-[700] tracking-[-0.03em] text-[#111712]">
                {title}
              </h2>
              <p className="mt-1 text-[14px] text-[#6a706b]">{description}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onClose}
              disabled={saving}
              className="shrink-0 border border-line"
              aria-label="Close collaborator picker"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {error ? (
            <div className="mb-5 rounded-[18px] border border-[#f0c9c7] bg-[#fff2f1] px-4 py-3 text-[13px] text-[#bb4d49]">
              {error}
            </div>
          ) : null}

          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e978f]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search collaborators..."
                className="rounded-2xl border border-line pl-11"
                disabled={saving}
              />
            </div>
          </div>

          <div className="mt-5 max-h-[380px] space-y-3 overflow-y-auto pr-1">
            {filteredCollaborators.length > 0 ? (
              filteredCollaborators.map((collaborator) => {
                const selected = selectedIds.includes(collaborator.id);

                return (
                  <button
                    key={collaborator.id}
                    type="button"
                    onClick={() => onToggle(collaborator.id)}
                    disabled={saving}
                    className={`flex w-full cursor-pointer items-center gap-4 rounded-[20px] border px-4 py-3 text-left transition-colors ${
                      selected
                        ? "border-brand bg-[#f4faf6]"
                        : "border-[#e3e8e2] bg-white hover:bg-[#fbfcfa]"
                    }`}
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#f0dcc4,#b58257)] text-[12px] font-[700] text-white">
                      {getInitials(collaborator.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="min-w-0 whitespace-normal break-words text-[15px] font-[600] text-[#1f2923]">
                        {collaborator.name}
                      </p>
                      <p className="truncate text-[12px] text-[#7f877f]">
                        {collaborator.email}
                      </p>
                    </div>
                    <div
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
                        selected
                          ? "border-brand bg-brand text-white"
                          : "border-[#d8ded9] bg-white text-transparent"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-[20px] border border-dashed border-[#d6ddd6] bg-[#fbfcfa] px-5 py-10 text-center">
                <p className="text-[15px] font-[600] text-[#2a332d]">
                  No collaborators found
                </p>
                <p className="mt-1 text-[13px] text-[#7a837b]">
                  Try a different search or invite a new collaborator.
                </p>
                {onInviteFallback ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onInviteFallback}
                    className="mt-4"
                    disabled={saving}
                  >
                    <UserPlus className="h-4 w-4" />
                    Invite New
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {onInviteFallback ? (
              <Button type="button" variant="ghost" onClick={onInviteFallback} disabled={saving}>
                <UserPlus className="h-4 w-4" />
                Invite New
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={onConfirm} disabled={saving}>
                {saving ? "Applying..." : confirmLabel}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

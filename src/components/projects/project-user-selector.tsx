"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { UserRole } from "@prisma/client";

import { cn } from "@/lib/utils";

export type ProjectUserOption = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarSrc?: string | null;
};

type ProjectUserSelectorProps = {
  users: ProjectUserOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  mode: "single" | "multiple";
  placeholder: string;
  ariaLabel: string;
  error?: string;
};

const avatarPalettes = [
  "bg-[#315f4b]",
  "bg-[#8a6649]",
  "bg-[#536b8c]",
  "bg-[#7b5b7d]",
] as const;

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}

function getAvatarPalette(userId: string) {
  const paletteIndex = [...userId].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return avatarPalettes[paletteIndex % avatarPalettes.length];
}

function UserAvatar({ user, size = "small" }: { user: ProjectUserOption; size?: "small" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClassName = size === "large" ? "size-9 text-[11px]" : "size-7 text-[10px]";

  if (user.avatarSrc && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarSrc}
        alt=""
        className={cn(sizeClassName, "shrink-0 rounded-full object-cover")}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={cn(
        sizeClassName,
        "grid shrink-0 place-items-center rounded-full font-[700] text-white",
        getAvatarPalette(user.id),
      )}
      aria-hidden="true"
    >
      {getInitials(user.name)}
    </span>
  );
}

export function ProjectUserSelector({
  users,
  selectedIds,
  onChange,
  mode,
  placeholder,
  ariaLabel,
  error,
}: ProjectUserSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedUsers = useMemo(
    () => selectedIds.map((id) => users.find((user) => user.id === id)).filter(
      (user): user is ProjectUserOption => Boolean(user),
    ),
    [selectedIds, users],
  );
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return users.filter((user) => {
      if (mode === "multiple" && selectedIdSet.has(user.id)) {
        return false;
      }

      return normalizedQuery
        ? user.name.toLowerCase().includes(normalizedQuery) ||
            user.email.toLowerCase().includes(normalizedQuery)
        : true;
    });
  }, [mode, query, selectedIdSet, users]);
  const showSearchInput = mode === "multiple" || selectedUsers.length === 0 || isOpen;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function openSelector() {
    setIsOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function toggleSelector() {
    if (isOpen) {
      setIsOpen(false);
      setQuery("");
      return;
    }

    openSelector();
  }

  function selectUser(userId: string) {
    if (mode === "single") {
      onChange([userId]);
      setIsOpen(false);
    } else {
      onChange([...selectedIds, userId]);
    }

    setQuery("");
  }

  function removeUser(userId: string) {
    onChange(selectedIds.filter((id) => id !== userId));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      setQuery("");
      return;
    }

    if (event.key === "Backspace" && !query && selectedIds.length > 0) {
      removeUser(selectedIds[selectedIds.length - 1]);
    }

    if (event.key === "Enter" && filteredUsers.length > 0) {
      event.preventDefault();
      selectUser(filteredUsers[0].id);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex min-h-[54px] w-full items-start rounded-[16px] border bg-white p-2 shadow-none transition",
          isOpen ? "border-brand ring-3 ring-brand/10" : "border-[#d9e0d9]",
          error && "border-[#c85c54]",
        )}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            openSelector();
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {selectedUsers.map((user) => (
            <span
              key={user.id}
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full bg-[#f1f4f0] py-1 pl-1 pr-2 text-[13px] font-[600] text-[#1c271f]"
            >
              <UserAvatar user={user} />
              <span className="max-w-[190px] min-w-0 whitespace-normal break-words">{user.name}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeUser(user.id);
                }}
                className="grid size-5 shrink-0 place-items-center rounded-full text-[#677169] transition hover:bg-[#dde3dd] hover:text-[#172019]"
                aria-label={`Remove ${user.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}

          <div className="flex h-8 min-w-[180px] flex-1 items-center gap-2 px-1">
            {showSearchInput ? (
              <Search
                className="h-[18px] w-[18px] shrink-0 text-[#818b83]"
                aria-hidden="true"
              />
            ) : null}
            {showSearchInput ? (
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleInputKeyDown}
                placeholder={selectedUsers.length > 0 ? "Search users..." : placeholder}
                aria-label={ariaLabel}
                aria-controls={listboxId}
                aria-expanded={isOpen}
                role="combobox"
                className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-[#253029] outline-none placeholder:text-[#8c948e]"
              />
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <button
              type="button"
              onClick={toggleSelector}
              className="grid size-8 shrink-0 place-items-center rounded-full text-[#657068] hover:bg-[#f0f3ef]"
              aria-label={`${isOpen ? "Close" : "Open"} ${ariaLabel}`}
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
              />
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="mt-1.5 text-[12px] text-[#b84e48]">{error}</p> : null}

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable={mode === "multiple"}
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[288px] overflow-y-auto rounded-[18px] border border-[#dce3dc] bg-white p-1.5 shadow-[0_20px_50px_rgba(17,33,23,0.14)]"
        >
          {filteredUsers.length > 0 ? (
            filteredUsers.map((user) => {
              const selected = selectedIdSet.has(user.id);

              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectUser(user.id)}
                  className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition hover:bg-[#f3f7f3]"
                >
                  <UserAvatar user={user} size="large" />
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 whitespace-normal break-words text-[14px] font-[650] text-[#172019]">
                      {user.name}
                    </span>
                    <span className="block truncate text-[12px] text-[#7a847c]">
                      {user.email}
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4 text-brand" /> : null}
                </button>
              );
            })
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-[#7b847d]">
              No users found.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

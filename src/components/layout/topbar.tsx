"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu } from "lucide-react";

import { NotificationDropdown } from "@/components/notifications/notification-dropdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type DashboardUserView = {
  id: string;
  name: string;
  email: string;
  initials: string;
  avatarSrc?: string | null;
};

export type DashboardTopbarProps = {
  user?: DashboardUserView;
  onOpenSidebar: () => void;
  leadingContent?: ReactNode;
  showNotifications?: boolean;
};

const defaultUser: DashboardUserView = {
  id: "",
  name: "Account",
  email: "User account",
  initials: "A",
  avatarSrc: null,
};

function UserAvatar({ user }: { user: DashboardUserView }) {
  if (user.avatarSrc) {
    return (
      <AvatarImage
        key={user.avatarSrc}
        src={user.avatarSrc}
        alt={`${user.name} avatar`}
        className="h-9 w-9 sm:h-10 sm:w-10"
        fallback={
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[radial-gradient(circle_at_top,#ffd7c5,#d88f6c_55%,#7c4a34)] text-[13px] font-bold text-white sm:h-10 sm:w-10 sm:text-[14px]">
            {user.initials}
          </div>
        }
      />
    );
  }

  return (
    <div className="grid h-9 w-9 place-items-center rounded-full bg-[radial-gradient(circle_at_top,#ffd7c5,#d88f6c_55%,#7c4a34)] text-[13px] font-bold text-white sm:h-10 sm:w-10 sm:text-[14px]">
      {user.initials}
    </div>
  );
}

function AvatarImage({
  src,
  alt,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className} rounded-full object-cover`}
      onError={() => setImageFailed(true)}
    />
  );
}

export function Topbar({
  user = defaultUser,
  onOpenSidebar,
  leadingContent,
  showNotifications = true,
}: DashboardTopbarProps) {
  const signOutFormRef = useRef<HTMLFormElement>(null);
  const [signOutPending, setSignOutPending] = useState(false);

  return (
    <header className="flex min-h-14 items-center rounded-[18px] bg-surface px-2.5 py-2 shadow-[0_12px_32px_rgba(23,39,28,0.045)] sm:min-h-16 sm:rounded-[22px] sm:px-4 lg:px-5">
      <form ref={signOutFormRef} action="/sign-out" method="post" className="hidden" />
      <div className="flex w-full items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenSidebar}
              className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-line bg-white text-[#263129] shadow-[0_8px_20px_rgba(15,26,20,0.05)] xl:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>

            {leadingContent}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          {showNotifications ? <NotificationDropdown /> : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-[14px] border border-[#e2e8e2] bg-white p-1.5 pr-2 shadow-[0_8px_20px_rgba(15,26,20,0.045)] outline-none transition-colors hover:bg-[#f9fbf9] focus-visible:ring-2 focus-visible:ring-brand/35 xl:max-w-[210px] xl:pr-3"
                aria-label="Open user menu"
              >
                <UserAvatar user={user} />
                <div className="hidden min-w-0 flex-1 text-left xl:block">
                  <p className="min-w-0 whitespace-normal break-words text-[13px] font-extrabold leading-tight text-[#18211a]">
                    {user.name}
                  </p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#7d877f]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[260px]">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <div className="px-3 pb-2">
                <p className="min-w-0 whitespace-normal break-words text-[15px] font-semibold text-[#18211a]">
                  {user.name}
                </p>
                <p className="truncate text-[13px] text-muted">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={signOutPending}
                className="cursor-pointer hover:bg-[#fff4f3] hover:text-[#ba3f31]"
                onSelect={(event) => {
                  event.preventDefault();

                  if (signOutPending) {
                    return;
                  }

                  setSignOutPending(true);
                  signOutFormRef.current?.requestSubmit();
                }}
              >
                <LogOut className="h-4 w-4" />
                {signOutPending ? "Signing out..." : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

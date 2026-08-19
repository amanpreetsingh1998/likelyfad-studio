"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

export function AccountButton() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const email = user.email ?? "";
  const avatar =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined);
  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    email;
  const initial = (name || email || "?").charAt(0).toUpperCase();

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-neutral-700 bg-neutral-800 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500"
        title={email}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatar ? (
          // Supabase avatar URLs are external; next/image would need the host
          // allow-listed, and this is a 28px chrome element.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
        >
          <div className="border-b border-neutral-800 px-3 py-2.5">
            <div className="truncate text-xs font-medium text-neutral-200">{name}</div>
            {email && email !== name && (
              <div className="truncate text-[11px] text-neutral-500">{email}</div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut()}
            className="w-full px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

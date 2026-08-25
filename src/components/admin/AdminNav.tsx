"use client";

/**
 * Top bar for the admin surface.
 *
 * Client-side only because it highlights the active tab from usePathname().
 * Nothing here is a security boundary — the links are ordinary hrefs, and each
 * destination is gated by proxy.ts on the way in.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/audit", label: "Audit" },
] as const;

function isActive(pathname: string, href: string): boolean {
  // Exact match for the index, prefix match for the rest — otherwise /admin
  // stays highlighted on every child route.
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <header className="h-12 bg-neutral-900 border-b border-neutral-800 flex items-center px-6 gap-6 sticky top-0 z-10">
      <Link
        href="/admin"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
      >
        <img src="/ls-icon.png" alt="" className="w-5 h-5" />
        <span className="text-sm font-semibold tracking-tight text-neutral-100">
          Admin
        </span>
      </Link>

      <nav className="flex items-center gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive(pathname, tab.href) ? "page" : undefined}
            className={
              isActive(pathname, tab.href)
                ? "px-3 py-1.5 text-sm rounded text-neutral-100 bg-neutral-800"
                : "px-3 py-1.5 text-sm rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 transition-colors"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Link
        href="/"
        className="ml-auto text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
      >
        Back to studio
      </Link>
    </header>
  );
}

/**
 * The admin shell.
 *
 * A server component with no gate of its own: reaching this file at all means
 * proxy.ts already matched /admin against the admins row and let the request
 * through. Repeating the check here would be a second source of truth for the
 * same question, and the one that runs later.
 *
 * Every /api/admin/* route still gates itself through requireAdmin() — the
 * proxy protects pages, not data.
 */

import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata: Metadata = {
  title: "Admin · Likelyfad Studio",
  // Belt and braces with the proxy: nothing here should ever be indexed, even
  // if a future route is accidentally made public.
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AdminNav />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}

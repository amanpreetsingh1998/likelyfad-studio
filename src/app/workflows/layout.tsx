/**
 * The workflows shell.
 *
 * No gate of its own: proxy.ts sends a signed-out visitor to /signin before
 * this ever routes. Same arrangement, and same reasoning, as the admin layout.
 *
 * Unlike /admin, this page is for EVERY signed-in user — it is where a
 * non-admin lands and the only surface they have. The studio at / and the
 * dashboard under /admin are both admin-only, so the links out of here are
 * rendered only for whoever can actually follow them: a link that bounces you
 * straight back is worse than no link, because it reads as a broken page
 * rather than a closed door.
 *
 * Narrower than /admin's max-w-7xl. The cards here are four figures and a
 * title; stretched to the admin width their columns drift far enough apart
 * that the eye stops associating a number with its label.
 */

import Link from "next/link";
import { getAuthedContext } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin/guard";

export default async function WorkflowsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuthedContext();
  // Fails closed: no session, or an unreadable admins table, renders the plain
  // header rather than offering a way into the studio.
  const admin = auth ? await isAdmin(auth.user.id) : false;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          {admin ? (
            <>
              <Link
                href="/"
                className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
              >
                ← Studio
              </Link>
              <span className="text-sm text-neutral-600">/</span>
            </>
          ) : null}
          <span className="text-sm text-neutral-200">Workflows</span>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

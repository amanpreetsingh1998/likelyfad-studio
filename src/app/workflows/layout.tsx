/**
 * The workflows shell.
 *
 * No gate of its own: proxy.ts sends a signed-out visitor to /signin before
 * this ever routes. Same arrangement, and same reasoning, as the admin layout.
 *
 * Unlike /admin, this page is for EVERY signed-in user — it is where a
 * non-admin lands and, apart from the run pages beneath it, the only surface
 * they have. So the account menu and the credit balance live here rather than
 * only in the studio header: this is the one place a user can sign out from,
 * and running a workflow spends their credits, so the balance has to be
 * visible where the spending happens.
 *
 * The links OUT of here are rendered only for whoever can follow them. The
 * studio is admin-only; a link that bounces you straight back reads as broken
 * software rather than a closed door.
 *
 * Narrower than /admin's max-w-7xl. The cards here are four figures and a
 * title; stretched to the admin width their columns drift far enough apart
 * that the eye stops associating a number with its label.
 */

import Link from "next/link";
import { getAuthedContext } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin/guard";
import { AccountButton } from "@/components/auth/AccountButton";
import { CreditBadge } from "@/components/credits/CreditBadge";
import { BuyCreditsModal } from "@/components/credits/BuyCreditsModal";

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
          {/* The brand mark points at /workflows, not at "/". The studio is
              admin-only, so a logo linking there would bounce a non-admin
              straight back — the same reason NON_ADMIN_HOME exists in
              proxy.ts. Admins still have the explicit "← Studio" link. */}
          <Link
            href="/workflows"
            className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ls-icon.png" alt="Likelyfad Studio" className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight text-neutral-100">
              Likelyfad Studio
            </span>
          </Link>

          <span className="text-sm text-neutral-600">/</span>

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

          <Link
            href="/workflows"
            className="text-sm text-neutral-200 transition-colors hover:text-neutral-100"
          >
            Workflows
          </Link>

          {admin && (
            <Link
              href="/admin"
              className="text-sm text-neutral-500 transition-colors hover:text-neutral-200"
            >
              Admin
            </Link>
          )}

          <div className="ml-auto flex items-center gap-3">
            {/* Running spends credits, so the balance belongs on the page
                where the running happens — and the badge is also the way into
                buying more. */}
            <CreditBadge />
            <AccountButton />
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>

      {/*
        A run refused for want of credits answers 402 and the executors open
        this modal. Without it mounted here, a user would hit the wall with
        nothing to do about it — the studio has always had one, and this page
        now spends money too.
      */}
      <BuyCreditsModal />
    </div>
  );
}

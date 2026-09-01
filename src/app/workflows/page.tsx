/**
 * /workflows — every workflow you own, and what running one costs.
 *
 * NO AUTH GATE HERE, AND THAT IS DELIBERATE. proxy.ts already redirects any
 * non-public path to /signin for a signed-out visitor, so reaching this file
 * means there is a session. Repeating the check would be a second source of
 * truth for the same question, and the one that runs later — the same
 * reasoning the admin layout records.
 *
 * The data still gates itself regardless: user_workflow_history scopes to
 * auth.uid() rather than taking a user id, so there is no id to forge even if
 * this page were somehow reached without a session.
 *
 * The first page is read here, on the server, so it paints with real numbers
 * instead of a skeleton. Search, sort and paging then go through
 * /api/workflows without a navigation.
 */

import type { Metadata } from "next";
import { getAuthedContext } from "@/lib/supabase/server";
import { listWorkflowHistory } from "@/lib/workflows/history";
import { isAdmin } from "@/lib/admin/guard";
import { HistoryList } from "@/components/workflows/HistoryList";

export const metadata: Metadata = {
  title: "Workflows · Likelyfad Studio",
};

// Costs and run counts must be current per request. A cached history page is a
// page that tells you a run you just made never happened.
export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const auth = await getAuthedContext();

  // Unreachable in practice, for the reason above. Kept because
  // "unreachable" is a property of today's proxy config, not of this file, and
  // the failure mode if that changes is an unhandled null.
  if (!auth) return null;

  const { q } = await searchParams;

  // The studio is admin-only, so "Open" is only offered to whoever can
  // actually reach it. Read here rather than in the card: the answer is the
  // same for every row, and asking per card would be one lookup per workflow
  // on screen.
  const [initial, canOpenStudio] = await Promise.all([
    listWorkflowHistory(auth.supabase, { q, limit: 20 }),
    isAdmin(auth.user.id),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-lg font-semibold text-neutral-100">Workflows</h1>
        <p className="mt-1 text-sm text-neutral-500">
          What each of your workflows costs to run, which models it uses, and
          how long it takes.
        </p>
      </header>

      {/*
        The coverage gap, stated rather than papered over — the same position
        the moderation feed takes about its own start date.

        Run history could not be backfilled: charges and generation events
        recorded before this shipped carry no run id, and there is no way to
        infer one from timestamps without guessing. A workflow you have run for
        months will still show "not run yet" until its next run.
      */}
      <p className="mb-6 rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500">
        Run history starts from when this feature shipped. Earlier runs could
        not be backfilled — they were never recorded against a workflow — so a
        workflow you have run before may show no runs until the next one.
      </p>

      <HistoryList
        initial={initial}
        initialSearch={q ?? ""}
        canOpenStudio={canOpenStudio}
      />
    </>
  );
}

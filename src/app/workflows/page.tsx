/**
 * /workflows — two views of the same account.
 *
 *   Workflows — every workflow you own or may run, and what running one costs.
 *   Runs      — every execution you have made, newest first.
 *
 * WHY THE SECOND TAB IS NOT DERIVABLE FROM THE FIRST. The workflow list is
 * keyed by workflow, so a run belonging to no workflow cannot appear on it —
 * and two ordinary things produce exactly that. A canvas that was never saved
 * has no `projects` row, so its runs carry a null `project_id`; and deleting a
 * workflow nulls that column rather than cascading, deliberately, so the
 * ledger keeps explaining money already spent. The Runs tab is the only place
 * either is visible.
 *
 * NO AUTH GATE HERE, AND THAT IS DELIBERATE. proxy.ts already redirects any
 * non-public path to /signin for a signed-out visitor, so reaching this file
 * means there is a session. Repeating the check would be a second source of
 * truth for the same question, and the one that runs later — the same
 * reasoning the admin layout records.
 *
 * The data still gates itself regardless: both SQL functions scope to
 * auth.uid() rather than taking a user id, so there is no id to forge even if
 * this page were somehow reached without a session.
 *
 * ONLY THE ACTIVE TAB IS READ. The other one's query aggregates over every run
 * the account has, and paying for it to render nothing would make each tab
 * switch cost both. The tabs are links, so the server reads exactly the one
 * being asked for.
 */

import type { Metadata } from "next";
import { getAuthedContext } from "@/lib/supabase/server";
import { listUserRunHistory, listWorkflowHistory } from "@/lib/workflows/history";
import { isAdmin } from "@/lib/admin/guard";
import { HistoryList } from "@/components/workflows/HistoryList";
import { RunsList } from "@/components/workflows/RunsList";
import { WorkflowTabs, normaliseTab } from "@/components/workflows/WorkflowTabs";

export const metadata: Metadata = {
  title: "Workflows · Likelyfad Studio",
};

// Costs and run counts must be current per request. A cached history page is a
// page that tells you a run you just made never happened.
export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>;
}) {
  const auth = await getAuthedContext();

  // Unreachable in practice, for the reason above. Kept because
  // "unreachable" is a property of today's proxy config, not of this file, and
  // the failure mode if that changes is an unhandled null.
  if (!auth) return null;

  const { q, tab } = await searchParams;
  const active = normaliseTab(tab);

  // The studio is admin-only, so "Open" is only offered to whoever can
  // actually reach it. Read here rather than in the card: the answer is the
  // same for every row, and asking per card would be one lookup per workflow
  // on screen.
  // Two slots rather than one union, so each list keeps its own type and the
  // unread tab resolves to null instead of needing a cast at the call site.
  const [runs, workflows, canOpenStudio] = await Promise.all([
    active === "runs" ? listUserRunHistory(auth.supabase, { limit: 25 }) : null,
    active === "runs" ? null : listWorkflowHistory(auth.supabase, { q, limit: 20 }),
    isAdmin(auth.user.id),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-lg font-semibold text-neutral-100">Workflows</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {active === "runs"
            ? "Every run you have made — what it cost, how long it took and which models it used."
            : "What each of your workflows costs to run, which models it uses, and how long it takes."}
        </p>
      </header>

      <WorkflowTabs active={active} />

      {/*
        The coverage gap, stated rather than papered over — the same position
        the moderation feed takes about its own start date.

        Run history could not be backfilled: charges and generation events
        recorded before this shipped carry no run id, and there is no way to
        infer one from timestamps without guessing. It is true of both tabs,
        so it sits above both.
      */}
      <p className="mb-6 rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500">
        {active === "runs"
          ? "Run history starts from when this feature shipped. Runs made before then were never recorded against a run id and cannot be shown here."
          : "Run history starts from when this feature shipped. Earlier runs could not be backfilled — they were never recorded against a workflow — so a workflow you have run before may show no runs until the next one."}
      </p>

      {runs && <RunsList initial={runs} canOpenStudio={canOpenStudio} />}

      {workflows && (
        <HistoryList
          initial={workflows}
          initialSearch={q ?? ""}
          canOpenStudio={canOpenStudio}
        />
      )}
    </>
  );
}

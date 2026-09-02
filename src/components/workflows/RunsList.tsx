"use client";

/**
 * The Runs tab — every execution this account has made, newest first.
 *
 * WHAT THIS SHOWS THAT THE WORKFLOWS TAB CANNOT
 *
 * The workflows tab is keyed by workflow, so a run that belongs to no
 * workflow is unreachable from it — and two ordinary things produce exactly
 * that. A canvas that was never saved has no `projects` row, so its runs
 * carry a null `project_id`. And deleting a workflow nulls the column rather
 * than cascading, precisely so the ledger keeps explaining money already
 * spent. Both spent real credits. This is the only page where that spend is
 * visible, which is most of the reason the tab exists.
 *
 * FOUR STATES THAT MUST NOT LOOK ALIKE — the same discipline as HistoryList:
 *
 *   never run anything   — a new account
 *   no rows for a filter — runs exist, this filter matched none
 *   the read failed      — we do not know what they have
 *   a page of results
 *
 * All three of the first render as "nothing here" if you let them, and the
 * third is the one that must never be mistaken for the first two. Telling
 * someone they have never run anything when the query broke is the most
 * alarming thing this page could say, so the reader returns a `failed` marker
 * rather than an empty array.
 *
 * NO SORT CONTROL, DELIBERATELY. A feed of moments has one useful order.
 * "Most expensive" and "longest" are questions about a workflow, not about a
 * run, and the tab next door already answers them — sorted, and per workflow,
 * which is the only scale at which those comparisons mean anything.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRunEntry, UserRunPage } from "@/lib/workflows/history";
import { RunStatusChip } from "./RunStatusChip";
import {
  formatDateTime,
  formatNumber,
  formatRunDuration,
  shortModelName,
} from "./format";

const PAGE_SIZE = 25;

/**
 * Every status `workflow_runs` can hold, and no others — the table's check
 * constraint lists exactly these. A filter is offered for each rather than
 * collapsing the three unhappy endings into one "did not finish", because
 * they are three different things that happened.
 */
const STATUSES = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "abandoned", label: "Abandoned" },
  { key: "running", label: "Running" },
] as const;

export function RunsList({
  initial,
  canOpenStudio,
}: {
  initial: UserRunPage;
  /**
   * The studio is admin-only. For everyone else a workflow link has to go to
   * the run page instead, or it navigates into a redirect straight back here
   * — which reads as broken software rather than as a closed door.
   */
  canOpenStudio: boolean;
}) {
  const router = useRouter();

  const [page, setPage] = useState<UserRunPage>(initial);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  // The server already read a page for the default query. Skipping the first
  // refetch keeps it on screen rather than flashing it away to fetch the same
  // rows back. Same guard as HistoryList.
  const seeded = useRef(true);

  const load = useCallback(
    async (next: { status: string; search: string; offset: number }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(next.offset),
          status: next.status,
        });
        if (next.search.trim()) params.set("q", next.search.trim());

        const response = await fetch(`/api/workflows/runs?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Could not load runs (${response.status})`);
        }
        setPage(await response.json());
      } catch (err) {
        // Reported through the same `failed` channel the server uses, so the
        // empty-state logic below has one thing to check rather than two.
        setPage({
          runs: [],
          total: 0,
          totalCredits: 0,
          failed: err instanceof Error ? err.message : "Could not load runs",
        });
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced: this fires per keystroke, and each one aggregates over every
  // run the account has.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void load({ status, search, offset });
    }, 250);
    return () => clearTimeout(timer);
  }, [status, search, offset, load]);

  const openWorkflow = useCallback(
    (projectId: string) => {
      router.push(
        canOpenStudio
          ? `/?project=${encodeURIComponent(projectId)}`
          : `/workflows/${encodeURIComponent(projectId)}/run`
      );
    },
    [router, canOpenStudio]
  );

  const showing = page.runs.length;
  const canPrev = offset > 0;
  const canNext = offset + showing < page.total;
  const filtered = status !== "all" || search.trim() !== "";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUSES.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={status === option.key}
            onClick={() => {
              setStatus(option.key);
              // Or page three of everything silently becomes page three of a
              // one-match filter.
              setOffset(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              status === option.key
                ? "border-neutral-600 bg-neutral-800 text-neutral-100"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
          placeholder="Search by workflow name"
          aria-label="Search runs by workflow name"
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />

        {/*
          Both figures cover the whole filtered set, not the rows on screen —
          they are computed in SQL as window functions for exactly that reason.
          Suppressed entirely on a failed read: a total is a claim about an
          account, and we have nothing to base one on.
        */}
        {!page.failed && showing > 0 && (
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-300">{formatNumber(page.total)}</span>{" "}
            {page.total === 1 ? "run" : "runs"}
            <span className="mx-1.5 text-neutral-700">·</span>
            <span
              className="text-neutral-300"
              title="Credits actually debited across these runs. A run still going, or one that never settled, contributes nothing rather than a zero."
            >
              {formatNumber(page.totalCredits)}
            </span>{" "}
            credits
          </p>
        )}
      </div>

      {/* A read that broke is a fact, and it is not "you have never run anything". */}
      {page.failed && (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Your runs could not be loaded. This is a fault on our side, not an
          empty history — nothing has been lost.
        </p>
      )}

      {!page.failed && showing === 0 && filtered && (
        <p className="py-12 text-center text-sm text-neutral-500">
          No run matches this filter.
        </p>
      )}

      {!page.failed && showing === 0 && !filtered && (
        <div className="py-12 text-center">
          <p className="text-sm text-neutral-400">You have not run anything yet.</p>
          <p className="mt-1 text-xs text-neutral-600">
            Every run you make will appear here with what it cost, how long it
            took and which models it used.
          </p>
        </div>
      )}

      {showing > 0 && (
        <div
          className={`overflow-x-auto transition-opacity ${
            loading ? "opacity-60" : ""
          }`}
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="py-2 pr-3 font-normal">Started</th>
                <th className="py-2 pr-3 font-normal">Workflow</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="py-2 pr-3 text-right font-normal">Credits</th>
                <th
                  className="cursor-help py-2 pr-3 text-right font-normal"
                  title="Wall clock, start to finish. Shorter than the sum of node times, because nodes run concurrently."
                >
                  Time
                </th>
                <th className="py-2 font-normal">Models</th>
              </tr>
            </thead>
            <tbody>
              {page.runs.map((run) => (
                <RunRow key={run.id} run={run} onOpen={openWorkflow} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(canPrev || canNext) && (
        <nav className="mt-5 flex items-center justify-between text-xs text-neutral-500">
          <span>
            {formatNumber(offset + 1)}–{formatNumber(offset + showing)} of{" "}
            {formatNumber(page.total)}
          </span>
          <div className="flex gap-2">
            <PageButton
              disabled={!canPrev || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </PageButton>
            <PageButton
              disabled={!canNext || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </PageButton>
          </div>
        </nav>
      )}
    </div>
  );
}

function RunRow({
  run,
  onOpen,
}: {
  run: UserRunEntry;
  onOpen: (projectId: string) => void;
}) {
  return (
    <tr className="border-b border-neutral-900 last:border-0">
      <td className="whitespace-nowrap py-2.5 pr-3 text-neutral-300">
        {formatDateTime(run.startedAt)}
      </td>

      <td className="max-w-[16rem] py-2.5 pr-3">
        <WorkflowCell run={run} onOpen={onOpen} />
      </td>

      <td className="py-2.5 pr-3">
        <RunStatusChip status={run.status} />
      </td>

      <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-200">
        {/* A run that never settled has no charge yet. That is not zero. */}
        {run.creditsCharged === null ? (
          <span
            className="text-neutral-600"
            title={
              run.status === "running"
                ? "This run has not settled yet."
                : "This run never settled. Its charges may still be waiting for the maintenance sweep."
            }
          >
            —
          </span>
        ) : (
          formatNumber(run.creditsCharged)
        )}
        {run.shortfall !== null && run.shortfall > 0 && (
          <span
            className="ml-1 text-[11px] text-amber-400"
            title={`${run.shortfall} credits could not be covered by the balance at settlement.`}
          >
            +{run.shortfall} owed
          </span>
        )}
      </td>

      <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-300">
        {run.durationMs === null ? (
          <span className="text-neutral-600">—</span>
        ) : (
          formatRunDuration(run.durationMs)
        )}
      </td>

      <td className="py-2.5 text-neutral-400">
        {run.models.length === 0 ? (
          <span
            className="text-neutral-600"
            title={
              run.eventsTotal > 0
                ? "This run's generation records have passed their retention window. Its cost and duration are kept on the run itself."
                : "No node in this run reached a provider."
            }
          >
            —
          </span>
        ) : (
          <span className="line-clamp-2 text-xs" title={run.models.join(", ")}>
            {run.models.map(shortModelName).join(", ")}
          </span>
        )}
        {run.eventsFailed > 0 && (
          <span className="ml-1 text-[11px] text-red-400">
            {run.eventsFailed} failed
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Which workflow this was, and whether there is still one to open.
 *
 * Three cases, and they are three different facts about a run:
 *
 *   a live workflow      — a link
 *   a name but no row    — the workflow was deleted since; name it, link
 *                          nowhere. A dead link on the very row documenting
 *                          the deletion is worse than no link, which is the
 *                          position the audit log's target_exists takes.
 *   no workflow at all    — the canvas was never saved. Say so plainly rather
 *                          than showing a blank cell that reads as missing
 *                          data.
 */
function WorkflowCell({
  run,
  onOpen,
}: {
  run: UserRunEntry;
  onOpen: (projectId: string) => void;
}) {
  if (run.projectId && run.projectExists) {
    return (
      <button
        type="button"
        onClick={() => onOpen(run.projectId as string)}
        className="truncate text-left text-neutral-200 underline decoration-neutral-700 underline-offset-2 transition-colors hover:text-neutral-50 hover:decoration-neutral-400"
        title={run.projectName ?? undefined}
      >
        {run.projectName ?? "Untitled workflow"}
      </button>
    );
  }

  if (run.projectName) {
    return (
      <span
        className="block truncate text-neutral-400"
        title="This workflow has since been deleted. The run is kept so the credits it spent stay explainable."
      >
        {run.projectName}
        <span className="ml-1 text-[11px] text-neutral-600">(deleted)</span>
      </span>
    );
  }

  return (
    <span
      className="text-neutral-500"
      title="This run was made on a canvas that had not been saved, so there is no workflow to open. The credits it spent were still charged."
    >
      Unsaved workflow
    </span>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-neutral-800 px-2.5 py-1 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

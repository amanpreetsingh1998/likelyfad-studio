"use client";

/**
 * Every run of one workflow, opened over the list.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The card shows one number for "cost of one run". That number is the last
 * successful run, not an average, because averaging blends a 4-credit run and
 * a 90-credit one into a figure that describes neither. But a single number
 * still *looks* like a claim about the workflow in general — and this drawer
 * is where that stops being true. Run by run, with dates and statuses, the
 * variance the headline hides becomes visible.
 *
 * A drawer rather than a route: the search and page you found the workflow on
 * are still behind it, and a navigation would throw them away.
 */

import { useCallback, useEffect, useState } from "react";
import type { WorkflowRunEntry } from "@/lib/workflows/history";
import {
  formatDateTime,
  formatNumber,
  formatRunDuration,
  shortModelName,
} from "./format";

type DrawerData = {
  title?: string;
  runs: WorkflowRunEntry[];
  total: number;
  failed: string | null;
};

export function RunDrawer({
  projectId,
  title,
  onClose,
}: {
  projectId: string;
  /** From the card, so the header names the workflow before the fetch lands. */
  title: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workflows/${encodeURIComponent(projectId)}/runs`
      );
      if (response.status === 404) {
        // Ownership is checked server-side. Reaching this from your own list
        // means the workflow was deleted in another tab.
        throw new Error("This workflow no longer exists.");
      }
      if (!response.ok) {
        throw new Error(`Could not load runs (${response.status})`);
      }
      setData(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load runs");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-neutral-950/70"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Runs of ${title}`}
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl"
      >
        <header className="flex items-start gap-4 border-b border-neutral-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-neutral-100">
              {data?.title ?? title}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {data ? `${formatNumber(data.total)} runs` : "Loading…"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <Failed>{error}</Failed>}

          {/* A failed read is stated, never rendered as "no runs". */}
          {data?.failed && (
            <Failed>The run history could not be read. Check the server log.</Failed>
          )}

          {!data && !error && (
            <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
          )}

          {data && !data.failed && data.runs.length === 0 && (
            <p className="py-10 text-center text-sm text-neutral-500">
              This workflow has not been run yet.
            </p>
          )}

          {data && data.runs.length > 0 && (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-3 font-normal">Started</th>
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
                  {data.runs.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>

              {data.total > data.runs.length && (
                <p className="mt-4 text-center text-xs text-neutral-500">
                  Showing the {data.runs.length} most recent of{" "}
                  {formatNumber(data.total)} runs.
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRunEntry }) {
  return (
    <tr className="border-b border-neutral-900 last:border-0">
      <td className="py-2.5 pr-3 text-neutral-300">
        <span title={formatDateTime(run.startedAt)}>
          {formatDateTime(run.startedAt)}
        </span>
      </td>

      <td className="py-2.5 pr-3">
        <StatusChip status={run.status} />
      </td>

      <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-200">
        {/* A run that never settled has no charge yet — that is not zero. */}
        {run.creditsCharged === null ? (
          <span className="text-neutral-600">—</span>
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
          <span
            className="line-clamp-2 text-xs"
            title={run.models.join(", ")}
          >
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
 * `abandoned` is deliberately distinguished from `cancelled`.
 *
 * Cancelled is a decision the user made. Abandoned is a tab that closed and
 * was later swept — we never found out how the run ended. Collapsing them into
 * one chip would tell a user they stopped something they did not.
 */
function StatusChip({ status }: { status: string }) {
  const style =
    status === "completed"
      ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
      : status === "running"
      ? "border-sky-900/60 bg-sky-950/40 text-sky-300"
      : status === "failed"
      ? "border-red-900/60 bg-red-950/40 text-red-300"
      : "border-neutral-700 bg-neutral-800/60 text-neutral-400";

  const title =
    status === "abandoned"
      ? "The browser never reported how this run ended — usually a closed tab. It was closed out by the maintenance sweep, and its charges were still settled."
      : status === "cancelled"
      ? "Stopped from the canvas. Nodes that had already reached a provider were still charged."
      : undefined;

  return (
    <span
      title={title}
      className={`rounded-full border px-2 py-0.5 text-[11px] ${style} ${
        title ? "cursor-help" : ""
      }`}
    >
      {status}
    </span>
  );
}

function Failed({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  );
}

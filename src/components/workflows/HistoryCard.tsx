"use client";

/**
 * One workflow, as a row of four figures.
 *
 * THIS FILE IS WHERE "NEVER INVENT A NUMBER" IS ENFORCED.
 *
 * Every figure on this card is one of three things, and the card must make
 * clear which:
 *
 *   measured — a run of this workflow completed and this is what it cost or
 *              how long it took. Shown plainly, with the date underneath.
 *   estimate — nothing has completed, so this is derived from the graph.
 *              Prefixed with ~ and labelled, because a prediction printed in
 *              the same style as a measurement is a lie of formatting.
 *   absent   — we have neither. Shown as an em dash and a phrase, never a 0.
 *              "0 credits" claims the workflow is free.
 *
 * The three states are deliberately not collapsible into two. "Never run" and
 * "run seven times, never succeeded" are different facts about a workflow, and
 * the second is the one worth acting on.
 */

import type { WorkflowHistoryEntry } from "@/lib/workflows/history";
import {
  formatNumber,
  formatRunDuration,
  formatShortDate,
  shortModelName,
} from "./format";

export function HistoryCard({
  entry,
  onOpenRuns,
  onOpen,
}: {
  entry: WorkflowHistoryEntry;
  /** Opens the run drawer. Disabled when there is nothing to show. */
  onOpenRuns: () => void;
  /** Loads this workflow onto the canvas. */
  onOpen: () => void;
}) {
  const { lastSuccess, estimate } = entry;
  const hasRuns = entry.runCount > 0;

  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900/40 transition-colors hover:border-neutral-700">
      <header className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-neutral-100">
            {entry.title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {describe(entry)}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
        >
          Open
        </button>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-neutral-800/70 px-4 py-3 sm:grid-cols-4">
        <Cost entry={entry} />
        <Time entry={entry} />
        <Models entry={entry} />

        <Figure label="Runs">
          {hasRuns ? (
            <button
              type="button"
              onClick={onOpenRuns}
              className="text-left text-sm text-neutral-100 underline decoration-neutral-700 underline-offset-4 transition-colors hover:decoration-neutral-400"
            >
              {formatNumber(entry.runCount)}
              <span className="ml-1 text-xs text-neutral-500">
                ({entry.successCount} ok)
              </span>
            </button>
          ) : (
            <Absent>Not run yet</Absent>
          )}
          {entry.lastRunAt && (
            <Sub>last {formatShortDate(entry.lastRunAt)}</Sub>
          )}
        </Figure>
      </div>
    </article>
  );
}

/**
 * Cost of one run.
 *
 * The measured figure wins whenever it exists — it is what this workflow
 * really charged, and the estimate is only ever a stand-in for not knowing.
 * When successful runs disagreed, the range goes underneath so the single
 * headline number stops implying it describes all of them.
 */
function Cost({ entry }: { entry: WorkflowHistoryEntry }) {
  const { lastSuccess, estimate, creditsRange } = entry;

  if (lastSuccess && lastSuccess.credits !== null) {
    return (
      <Figure label="Cost of one run">
        <Value>{formatNumber(lastSuccess.credits)} credits</Value>
        <Sub>last run {formatShortDate(lastSuccess.at)}</Sub>
        {creditsRange && (
          <Sub>
            ranged {formatNumber(creditsRange.min)}–
            {formatNumber(creditsRange.max)} across {entry.successCount} runs
          </Sub>
        )}
      </Figure>
    );
  }

  if (estimate.credits !== null && estimate.credits > 0) {
    return (
      <Figure label="Cost of one run">
        {/* The ~ and the word "estimate" both earn their place: one is
            scannable, the other is unambiguous. */}
        <Value muted>
          {estimate.partial ? "at least " : "~"}
          {formatNumber(estimate.credits)} credits
        </Value>
        <Sub>{estimate.partial ? "partial estimate" : "estimate"}</Sub>
        {estimate.partial && (
          <Sub
            title="At least one model in this workflow has no recorded price, so it is not counted in the total. The same models are refused at run time rather than billed at a guess."
          >
            some models unpriced
          </Sub>
        )}
      </Figure>
    );
  }

  return (
    <Figure label="Cost of one run">
      <Absent>{entry.runCount > 0 ? "No successful run" : "Not run yet"}</Absent>
      {entry.runCount > 0 && (
        <Sub>
          {formatNumber(entry.failedCount)} of {formatNumber(entry.runCount)}{" "}
          did not finish
        </Sub>
      )}
    </Figure>
  );
}

/**
 * How long a whole run takes.
 *
 * Wall clock, and the tooltip says so — a user who compares this against the
 * sum of their node timings will otherwise conclude it is wrong. It is not:
 * nodes run concurrently, so the sum is always the larger number.
 */
function Time({ entry }: { entry: WorkflowHistoryEntry }) {
  const { lastSuccess, estimate } = entry;
  const measured = lastSuccess?.durationMs ?? null;

  if (measured !== null) {
    return (
      <Figure
        label="Time"
        title="Wall clock from the start of the run to the end of it. Nodes run concurrently, so this is shorter than the sum of the individual node times."
      >
        <Value>{formatRunDuration(measured)}</Value>
        <Sub>wall clock</Sub>
      </Figure>
    );
  }

  if (estimate.durationMs !== null && estimate.durationMs > 0) {
    return (
      <Figure
        label="Time"
        title="Estimated by adding up how long each model in this workflow usually takes. Runs are normally faster, because nodes run concurrently."
      >
        <Value muted>~{formatRunDuration(estimate.durationMs)}</Value>
        <Sub>estimate</Sub>
      </Figure>
    );
  }

  return (
    <Figure label="Time">
      <Absent>—</Absent>
    </Figure>
  );
}

/**
 * Which models this workflow uses.
 *
 * The measured list is what the last successful run ACTUALLY called, which is
 * not necessarily what the graph says today — the graph can be edited after a
 * run, and the charge cannot. When there is no successful run the graph's own
 * list is shown instead, labelled, for the same reason the cost is.
 */
function Models({ entry }: { entry: WorkflowHistoryEntry }) {
  const measured = entry.lastSuccess?.models ?? [];
  const models = measured.length > 0 ? measured : entry.estimate.models;
  const isMeasured = measured.length > 0;

  if (models.length === 0) {
    return (
      <Figure label="Models">
        <Absent>None yet</Absent>
      </Figure>
    );
  }

  const shown = models.slice(0, 3);
  const rest = models.length - shown.length;

  return (
    <Figure
      label="Models"
      title={
        isMeasured
          ? `What the last successful run actually used: ${models.join(", ")}`
          : `From the current graph — this workflow has no successful run to read from: ${models.join(", ")}`
      }
    >
      <div className="flex flex-wrap gap-1">
        {shown.map((model) => (
          <span
            key={model}
            title={model}
            className="max-w-full truncate rounded border border-neutral-700 bg-neutral-800/60 px-1.5 py-0.5 text-[11px] text-neutral-300"
          >
            {shortModelName(model)}
          </span>
        ))}
        {rest > 0 && (
          <span
            title={models.join(", ")}
            className="rounded border border-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-500"
          >
            +{rest}
          </span>
        )}
      </div>
      {!isMeasured && <Sub>from the graph</Sub>}
    </Figure>
  );
}

/**
 * The line under the title.
 *
 * A user-written description wins. Otherwise a line derived on read — never
 * stored, so it cannot go stale against an edited graph.
 *
 * The derivation is deliberately shallow: node count and model names, not
 * "2 image generations, 1 LLM". The richer summary needs the graph itself, and
 * loading every workflow's graph to render a list is exactly the N+1 that
 * user_workflow_history exists to avoid. A slightly plainer subtitle is a
 * better trade than a page that slows down with every workflow you own.
 */
function describe(entry: WorkflowHistoryEntry): string {
  if (entry.description) return entry.description;

  const parts: string[] = [];
  if (entry.nodeCount) {
    parts.push(`${entry.nodeCount} node${entry.nodeCount === 1 ? "" : "s"}`);
  }

  const models = entry.lastSuccess?.models.length
    ? entry.lastSuccess.models
    : entry.estimate.models;
  if (models.length > 0) {
    parts.push(models.map(shortModelName).slice(0, 2).join(", "));
  }

  return parts.length > 0 ? parts.join(" · ") : "No description";
}

function Figure({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`text-[11px] uppercase tracking-wide text-neutral-500 ${
          title ? "cursor-help" : ""
        }`}
        title={title}
      >
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Value({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <p
      className={`truncate text-sm tabular-nums ${
        muted ? "text-neutral-400" : "text-neutral-100"
      }`}
    >
      {children}
    </p>
  );
}

/** Absent is a phrase, never a zero. */
function Absent({ children }: { children: React.ReactNode }) {
  return <p className="truncate text-sm text-neutral-600">{children}</p>;
}

function Sub({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <p
      className={`mt-0.5 truncate text-[11px] text-neutral-500 ${
        title ? "cursor-help underline decoration-dotted underline-offset-2" : ""
      }`}
      title={title}
    >
      {children}
    </p>
  );
}

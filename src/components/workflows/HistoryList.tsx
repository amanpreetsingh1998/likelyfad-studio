"use client";

/**
 * The workflow history list.
 *
 * Seeded with a page the server already read, so the first paint carries real
 * numbers rather than a skeleton that resolves a moment later. Search, sort
 * and paging then refetch through /api/workflows without a navigation — the
 * same shape as the admin dashboards, for the same reason.
 *
 * FOUR STATES THAT MUST NOT LOOK ALIKE
 *
 *   no workflows at all  — a new account; say how to make one
 *   no search matches    — their workflows exist, this filter found none
 *   the read failed      — we do not know what they have
 *   a page of results
 *
 * The first three all render "nothing here" if you let them, and the third is
 * the one that must never be mistaken for the first two. That is why the
 * reader returns a `failed` marker instead of an empty array.
 *
 * SORTING PICKS A COLUMN, NOT A DIRECTION. Each option has one useful order —
 * most recent, most expensive, most run — and offering the reverse doubles the
 * states to answer a question this page is not for.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkflowHistoryPage } from "@/lib/workflows/history";
import { HistoryCard } from "./HistoryCard";
import { RunDrawer } from "./RunDrawer";
import { formatNumber } from "./format";

const PAGE_SIZE = 20;

const SORTS = [
  { key: "updated", label: "Last edited" },
  { key: "lastrun", label: "Last run" },
  { key: "cost", label: "Most expensive" },
  { key: "runs", label: "Most run" },
  { key: "title", label: "Name" },
] as const;

export function HistoryList({
  initial,
  initialSearch,
  canOpenStudio,
}: {
  initial: WorkflowHistoryPage;
  initialSearch: string;
  /**
   * Whether this caller may reach the studio at all. The canvas is admin-only,
   * so for everyone else the card's Open button would navigate straight into a
   * redirect back to this page — which reads as a broken link rather than a
   * closed door. Decided on the server; the page gate is what enforces it.
   */
  canOpenStudio: boolean;
}) {
  const router = useRouter();

  const [page, setPage] = useState<WorkflowHistoryPage>(initial);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState<string>("updated");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState<{ id: string; title: string } | null>(null);
  /** The workflow whose publish state is currently in flight, if any. */
  const [publishing, setPublishing] = useState<string | null>(null);

  // The seeded page is only valid for the query it was read with. Skipping the
  // first refetch keeps that page on screen instead of flashing it away and
  // fetching the identical thing back.
  const seeded = useRef(true);

  const load = useCallback(
    async (next: { search: string; sort: string; offset: number }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(next.offset),
          sort: next.sort,
        });
        if (next.search.trim()) params.set("q", next.search.trim());

        const response = await fetch(`/api/workflows?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Could not load workflows (${response.status})`);
        }
        setPage(await response.json());
      } catch (err) {
        // Surfaced through the same `failed` channel the server uses, so the
        // empty-state logic below has one thing to check rather than two.
        setPage({
          entries: [],
          total: 0,
          failed: err instanceof Error ? err.message : "Could not load workflows",
        });
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced, because this fires per keystroke and each one is a round trip
  // that aggregates over every run the account has.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void load({ search, sort, offset });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, sort, offset, load]);

  const openWorkflow = useCallback(
    (projectId: string) => {
      // The canvas reads ?project= on mount and loads it. A full navigation
      // rather than a fetch: opening a workflow means leaving this page.
      router.push(`/?project=${encodeURIComponent(projectId)}`);
    },
    [router]
  );

  const runWorkflow = useCallback(
    (projectId: string) => {
      router.push(`/workflows/${encodeURIComponent(projectId)}/run`);
    },
    [router]
  );

  /**
   * Publish or withdraw, then re-read.
   *
   * The new state comes from the server's reply rather than from flipping the
   * value locally: the request can be refused — the row may have been deleted,
   * or never have been the caller's — and showing "Published" for a call that
   * did not publish anything is worse than showing nothing happened.
   */
  const togglePublished = useCallback(
    async (projectId: string, next: boolean) => {
      setPublishing(projectId);
      try {
        const response = await fetch(
          `/api/workflows/${encodeURIComponent(projectId)}/publish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ published: next }),
          }
        );
        if (!response.ok) return;

        const result = await response.json();
        setPage((current) => ({
          ...current,
          entries: current.entries.map((entry) =>
            entry.projectId === projectId
              ? { ...entry, isPublished: result.isPublished === true }
              : entry
          ),
        }));
      } catch {
        // Offline. The card keeps the state the server last confirmed.
      } finally {
        setPublishing(null);
      }
    },
    []
  );

  const showing = page.entries.length;
  const canPrev = offset > 0;
  const canNext = offset + showing < page.total;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
          placeholder="Search by name or description"
          aria-label="Search workflows"
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />

        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Sort
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setOffset(0);
            }}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 focus:border-neutral-600 focus:outline-none"
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* A read that broke is a fact, and it is not "you have no workflows". */}
      {page.failed && (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Your workflows could not be loaded. This is a fault on our side, not
          an empty account — nothing has been lost.
        </p>
      )}

      {!page.failed && showing === 0 && search.trim() && (
        <p className="py-12 text-center text-sm text-neutral-500">
          No workflow matches “{search.trim()}”.
        </p>
      )}

      {!page.failed && showing === 0 && !search.trim() && (
        <div className="py-12 text-center">
          <p className="text-sm text-neutral-400">You have no saved workflows yet.</p>
          {/*
            Advice only where it can be followed. Telling someone to build a
            workflow on a canvas they are not allowed to open is worse than
            saying nothing — it reads as a broken permission rather than an
            empty account.
          */}
          <p className="mt-1 text-xs text-neutral-600">
            {canOpenStudio
              ? "Build one on the canvas and save it — it will appear here with what it costs to run."
              : "Nothing has been shared with you yet. Published workflows will appear here, ready to run."}
          </p>
        </div>
      )}

      {showing > 0 && (
        <div
          className={`space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          {page.entries.map((entry) => (
            <HistoryCard
              key={entry.projectId}
              entry={entry}
              canOpen={canOpenStudio}
              busy={publishing === entry.projectId}
              onOpen={() => openWorkflow(entry.projectId)}
              onRun={() => runWorkflow(entry.projectId)}
              onTogglePublished={() =>
                togglePublished(entry.projectId, !entry.isPublished)
              }
              onOpenRuns={() =>
                setDrawer({ id: entry.projectId, title: entry.title })
              }
            />
          ))}
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

      {drawer && (
        <RunDrawer
          projectId={drawer.id}
          title={drawer.title}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
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

"use client";

/**
 * The moderation feed: generated output, newest first, with the decision
 * buttons next to it.
 *
 * ONE FILTER ROW, ABOVE EVERYTHING IT SCOPES — the Overview page's rule. The
 * state tabs, the type filter and the search box all describe the same set of
 * cards, so they sit together above them and never inside a card.
 *
 * THREE STATES, NOT TWO.
 *
 * Unreviewed, flagged and cleared are distinct on purpose: a queue that
 * collapses "looked at, fine" into "not looked at" hands the same picture back
 * to the moderator every morning. The tabs are the queue.
 *
 * A CARD SHOWS WHOSE IT IS, AND HOW OFTEN.
 *
 * The same prompt reads very differently on an account's first flag and its
 * fourth, so the flag count travels with every row rather than being something
 * you go and look up.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ModerationFeed,
  ModerationRow,
  ModerationState,
} from "@/lib/admin/moderation";
import { EMPTY_COUNTS } from "@/lib/admin/moderation";
import {
  formatAgo,
  formatDateTime,
  formatDuration,
  formatNumber,
} from "../charts/format";

/** The tabs, and the filter each one sends. `null` is "everything". */
const TABS: Array<{ label: string; state: ModerationState | null; count: keyof typeof EMPTY_COUNTS }> = [
  { label: "All", state: null, count: "total" },
  { label: "Unreviewed", state: "unreviewed", count: "unreviewed" },
  { label: "Flagged", state: "flagged", count: "flagged" },
  { label: "Cleared", state: "cleared", count: "cleared" },
];

/** Run kinds worth filtering by, in the order the stats board draws them. */
const KINDS = ["image", "video", "audio", "text", "3d"] as const;

const SEARCH_DEBOUNCE_MS = 250;

export function ContentFeed({ initial }: { initial: ModerationFeed }) {
  const [feed, setFeed] = useState(initial);
  const [state, setState] = useState<ModerationState | null>(initial.state);
  const [kind, setKind] = useState<string | null>(initial.kind);
  const [search, setSearch] = useState(initial.search ?? "");
  const [offset, setOffset] = useState(initial.offset);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  const limit = initial.limit;
  const hydrated = useRef(false);

  const load = useCallback(
    async (params: {
      state: ModerationState | null;
      kind: string | null;
      q: string;
      offset: number;
    }) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          limit: String(limit),
          offset: String(params.offset),
        });
        if (params.state) query.set("state", params.state);
        if (params.kind) query.set("kind", params.kind);
        if (params.q) query.set("q", params.q);

        const response = await fetch(`/api/admin/content?${query}`);
        if (!response.ok) throw new Error(String(response.status));
        setFeed(await response.json());
        setFetchFailed(false);
      } catch {
        // Keep the cards already on screen. A stale page with a warning beats
        // an empty feed, which reads as "nothing to review".
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [limit]
  );

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    const timer = setTimeout(
      () => void load({ state, kind, q: search, offset }),
      search ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [state, kind, search, offset, load]);

  const refresh = useCallback(
    () => load({ state, kind, q: search, offset }),
    [load, state, kind, search, offset]
  );

  const counts = feed.counts;
  const rows = feed.rows;
  const to = offset + rows.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Content</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Generated output, newest first, for review.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Review state"
          className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => {
                setState(tab.state);
                // A new filter invalidates the page number — page 3 of the old
                // set is not page 3 of this one.
                setOffset(0);
              }}
              aria-pressed={state === tab.state}
              className={
                state === tab.state
                  ? "rounded px-2.5 py-1 text-xs font-medium text-neutral-100 bg-neutral-800"
                  : "rounded px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              }
            >
              {tab.label}
              {/* No number at all when the counts failed — a zero here is a
                  claim about the queue, and a wrong one empties it. */}
              {counts && (
                <span className="ml-1.5 text-neutral-500">
                  {formatNumber(counts[tab.count])}
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          value={kind ?? ""}
          onChange={(event) => {
            setKind(event.target.value || null);
            setOffset(0);
          }}
          aria-label="Run type"
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-xs text-neutral-300 focus:border-neutral-600 focus:outline-none"
        >
          <option value="">All types</option>
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
          placeholder="Search prompts, emails or models"
          aria-label="Search generations"
          className="min-w-[220px] flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />

        <p className="text-xs text-neutral-500" aria-live="polite">
          {loading
            ? "Loading…"
            : feed.total > 0
              ? `${formatNumber(offset + 1)}–${formatNumber(to)} of ${formatNumber(feed.total)}`
              : "Nothing to show"}
        </p>
      </div>

      {fetchFailed && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Could not refresh — showing the last page that loaded.
        </p>
      )}

      {feed.failed ? (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-3 text-sm text-red-300">
          The feed could not be read. Check the server log — and run{" "}
          <code className="text-red-200">0009_moderation.sql</code> if you have
          not yet.
        </p>
      ) : rows.length === 0 ? (
        <EmptyFeed filtered={!!(state || kind || search)} />
      ) : (
        <div
          className={`grid gap-3 transition-opacity md:grid-cols-2 ${
            loading ? "opacity-60" : "opacity-100"
          }`}
        >
          {rows.map((row) => (
            <GenerationCard key={row.id} row={row} onChanged={refresh} />
          ))}
        </div>
      )}

      {feed.total > limit && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={to >= feed.total || loading}
            onClick={() => setOffset(offset + limit)}
            className="rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Empty says which kind of empty it is.
 *
 * An unfiltered empty feed on a new install is not a bug and not a clean
 * queue — the log simply has no history before the day it shipped, and it
 * cannot be backfilled.
 */
function EmptyFeed({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-10 text-center">
      <p className="text-sm text-neutral-400">
        {filtered ? "Nothing matches these filters." : "No generations recorded."}
      </p>
      {!filtered && (
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-neutral-500">
          The log holds runs made since it shipped. Nothing before that was ever
          stored — outputs lived inside project files that overwrote themselves,
          and prompts were not kept at all.
        </p>
      )}
    </div>
  );
}

function GenerationCard({
  row,
  onChanged,
}: {
  row: ModerationRow;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  const act = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? `Failed (${response.status})`);
        return;
      }
      // Re-read rather than patching the card: the state that matters is the
      // one in the database, and the counts above have moved too.
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const setState = (state: ModerationState, why?: string) =>
    act(`/api/admin/content/${row.id}`, "PATCH", { state, reason: why ?? null });

  const flagged = row.moderation_state === "flagged";

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border bg-neutral-900 p-3 ${
        flagged ? "border-red-900/60" : "border-neutral-800"
      }`}
    >
      <div className="flex gap-3">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-950 text-center text-[10px] uppercase tracking-wide text-neutral-600">
          {row.thumb_url ? (
            <img src={row.thumb_url} alt="" className="h-full w-full object-cover" />
          ) : row.content_removed_at ? (
            "Removed"
          ) : (
            // Video, audio and 3D never had one: a representative frame needs
            // a decoder that does not run server-side here, so these are
            // reviewed on their prompt alone. Say which it is.
            <span className="px-1">{row.output_kind ?? row.kind}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-sm leading-relaxed text-neutral-200">
            {row.prompt || row.output_text || "No prompt recorded"}
          </p>

          <p className="mt-1.5 text-xs text-neutral-500">
            <Link
              href={`/admin/users?q=${encodeURIComponent(row.email ?? row.user_id)}`}
              className="text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
            >
              {row.email ?? row.user_id}
            </Link>
            {" · "}
            {row.model_id ?? "unknown model"}
            {" · "}
            <span title={formatDateTime(row.created_at)}>
              {formatAgo(row.created_at)}
            </span>
            {row.duration_ms ? ` · ${formatDuration(row.duration_ms)}` : ""}
            {row.credits_charged ? ` · ${formatNumber(row.credits_charged)} cr` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StateBadge state={row.moderation_state} />
            {row.user_flags > 0 && (
              <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-[11px] text-amber-300">
                {formatNumber(row.user_flags)} flagged on this account
              </span>
            )}
            {row.status !== "succeeded" && (
              <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400">
                run {row.status}
              </span>
            )}
            {row.content_removed_at && (
              <span
                className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400"
                title={formatDateTime(row.content_removed_at)}
              >
                image removed
              </span>
            )}
          </div>

          {flagged && row.moderation_reason && (
            <p className="mt-2 text-xs text-red-300/90">{row.moderation_reason}</p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-2.5 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-800 pt-2.5">
        {!flagging && (
          <>
            {flagged ? (
              <Action busy={busy} onClick={() => void setState("cleared")}>
                Clear flag
              </Action>
            ) : (
              <Action busy={busy} danger onClick={() => setFlagging(true)}>
                Flag
              </Action>
            )}

            {row.moderation_state === "unreviewed" && (
              <Action busy={busy} onClick={() => void setState("cleared")}>
                Mark reviewed
              </Action>
            )}

            {!row.content_removed_at && row.thumb_url && (
              <Action busy={busy} onClick={() => setConfirmRemove(true)}>
                Remove image
              </Action>
            )}

            <Action busy={busy} onClick={() => setConfirmSuspend(true)}>
              Suspend account
            </Action>
          </>
        )}

        {flagging && (
          <div className="flex w-full flex-wrap gap-1.5">
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this a problem?"
              aria-label="Flag reason"
              className="min-w-[180px] flex-1 rounded border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
            <Action
              busy={busy}
              danger
              onClick={async () => {
                await setState("flagged", reason.trim() || undefined);
                setFlagging(false);
                setReason("");
              }}
            >
              Flag it
            </Action>
            <Action busy={busy} onClick={() => setFlagging(false)}>
              Cancel
            </Action>
          </div>
        )}
      </div>

      {confirmRemove && (
        <Confirm
          text="Delete the stored thumbnail. The prompt, model and account stay — that record is what moderation runs on."
          confirmLabel="Remove image"
          busy={busy}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            await act(`/api/admin/content/${row.id}`, "DELETE", { reason: null });
            setConfirmRemove(false);
          }}
        />
      )}

      {confirmSuspend && (
        <Confirm
          text="Block this account from signing in. A session already open keeps working until its token expires, up to an hour. Reversible from the Users page."
          confirmLabel="Suspend account"
          busy={busy}
          onCancel={() => setConfirmSuspend(false)}
          onConfirm={async () => {
            await act(`/api/admin/users/${row.user_id}`, "PATCH", {
              action: "suspend",
              reason: `Flagged content: ${row.id}`,
            });
            setConfirmSuspend(false);
          }}
        />
      )}
    </article>
  );
}

function StateBadge({ state }: { state: ModerationState }) {
  // Never colour alone — each badge says its word.
  if (state === "flagged") {
    return (
      <span className="rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300">
        Flagged
      </span>
    );
  }
  if (state === "cleared") {
    return (
      <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400">
        Cleared
      </span>
    );
  }
  return (
    <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-500">
      Unreviewed
    </span>
  );
}

function Action({
  children,
  onClick,
  busy,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
        danger
          ? "border-red-900/60 text-red-300 hover:bg-red-950/40"
          : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function Confirm({
  text,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded border border-neutral-700 bg-neutral-950 p-2.5">
      <p className="text-xs leading-relaxed text-neutral-400">{text}</p>
      <div className="mt-2 flex gap-1.5">
        <Action busy={busy} danger onClick={onConfirm}>
          {confirmLabel}
        </Action>
        <Action busy={busy} onClick={onCancel}>
          Cancel
        </Action>
      </div>
    </div>
  );
}

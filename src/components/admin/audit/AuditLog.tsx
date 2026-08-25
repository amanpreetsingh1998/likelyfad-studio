"use client";

/**
 * The admin action log.
 *
 * Written since Phase 3 by every route that changes something; this is the
 * first surface that reads it. A dense table rather than cards — this is
 * scanned to answer "what happened here", not browsed.
 *
 * ONE FILTER ROW ABOVE EVERYTHING IT SCOPES, as everywhere else on this
 * dashboard. The action chips carry their own counts so the shape of the log
 * is visible before anything is filtered.
 *
 * THE LOG OUTLIVES ITS SUBJECTS.
 *
 * Both emails were snapshot when the row was written, so a deleted account
 * still reads as an address. The link to that account is only offered when
 * there is still an account to open — a dead link on the one row that
 * documents a deletion would read as a bug in the log rather than as the
 * deletion it is recording.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AuditLogResult, AuditRow } from "@/lib/admin/audit";
import { actionLabel, describeDetail, isDestructive } from "@/lib/admin/audit";
import { formatAgo, formatDateTime, formatNumber } from "../charts/format";

const SEARCH_DEBOUNCE_MS = 250;

export function AuditLog({ initial }: { initial: AuditLogResult }) {
  const [log, setLog] = useState(initial);
  const [action, setAction] = useState<string | null>(initial.action);
  const [search, setSearch] = useState(initial.search ?? "");
  const [offset, setOffset] = useState(initial.offset);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  // The target filter arrives from a link (a drawer's "history" for one
  // account) and is not something the page offers a control for — clearing it
  // is what the "All actions" chip and the search box are for.
  const target = initial.target;
  const limit = initial.limit;
  const hydrated = useRef(false);

  const load = useCallback(
    async (params: { action: string | null; q: string; offset: number }) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          limit: String(limit),
          offset: String(params.offset),
        });
        if (params.action) query.set("action", params.action);
        if (params.q) query.set("q", params.q);
        if (target) query.set("target", target);

        const response = await fetch(`/api/admin/audit?${query}`);
        if (!response.ok) throw new Error(String(response.status));
        setLog(await response.json());
        setFetchFailed(false);
      } catch {
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [limit, target]
  );

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    const timer = setTimeout(
      () => void load({ action, q: search, offset }),
      search ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [action, search, offset, load]);

  const summary = log.summary;
  const rows = log.rows;
  const to = offset + rows.length;

  // Chips come from what the table actually holds, not from a list compiled at
  // build time: an action written by a later version still gets a chip here.
  const actions = Object.keys(summary?.by_action ?? {}).sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Audit log</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Every action taken from this dashboard — who, when, and what it said
          at the time.
        </p>
      </header>

      {target && (
        <p className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          Filtered to one account.{" "}
          <Link href="/admin/audit" className="text-neutral-200 underline-offset-2 hover:underline">
            Show the whole log
          </Link>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Action"
          className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1"
        >
          <Chip
            active={action === null}
            onClick={() => {
              setAction(null);
              setOffset(0);
            }}
            count={summary?.total}
          >
            All actions
          </Chip>

          {actions.map((name) => (
            <Chip
              key={name}
              active={action === name}
              onClick={() => {
                setAction(name);
                // A new filter invalidates the page number.
                setOffset(0);
              }}
              count={summary?.by_action[name]}
            >
              {actionLabel(name)}
            </Chip>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
          placeholder="Search emails, reasons or ids"
          aria-label="Search the log"
          className="min-w-[220px] flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />

        <p className="text-xs text-neutral-500" aria-live="polite">
          {loading
            ? "Loading…"
            : log.total > 0
              ? `${formatNumber(offset + 1)}–${formatNumber(to)} of ${formatNumber(log.total)}`
              : "Nothing to show"}
        </p>
      </div>

      {fetchFailed && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Could not refresh — showing the last page that loaded.
        </p>
      )}

      {log.failed ? (
        <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-3 text-sm text-red-300">
          The log could not be read. Check the server log — and run{" "}
          <code className="text-red-200">0010_admin_audit.sql</code> if you have
          not yet.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-10 text-center">
          <p className="text-sm text-neutral-400">
            {action || search || target
              ? "Nothing matches these filters."
              : "No admin actions recorded."}
          </p>
          {!action && !search && !target && (
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-neutral-500">
              Rows appear here the first time credits are granted, an account is
              suspended, or something is flagged. Nothing writes to this log
              except those actions, and nothing edits one afterwards.
            </p>
          )}
        </div>
      ) : (
        <div
          className={`overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 transition-opacity ${
            loading ? "opacity-60" : "opacity-100"
          }`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
                <th scope="col" className="px-3 py-2.5 font-medium">When</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Action</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Account</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Details</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium xl:table-cell">
                  By
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <LogRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary?.first_at && (
        <p className="text-xs text-neutral-600">
          The log begins {formatDateTime(summary.first_at)} — nothing before
          that was recorded, because there was nowhere to record it.
        </p>
      )}

      {log.total > limit && (
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
            disabled={to >= log.total || loading}
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

function Chip({
  children,
  active,
  count,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded px-2.5 py-1 text-xs font-medium text-neutral-100 bg-neutral-800"
          : "rounded px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
      }
    >
      {children}
      {/* No number when the summary failed — a zero next to "Deleted account"
          is a claim that no account has ever been deleted. */}
      {count !== undefined && (
        <span className="ml-1.5 text-neutral-500">{formatNumber(count)}</span>
      )}
    </button>
  );
}

function LogRow({ row }: { row: AuditRow }) {
  const details = Object.entries(row.details ?? {})
    .map(([key, value]) => describeDetail(key, value))
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="border-b border-neutral-800/60 last:border-0 align-top">
      <td
        className="whitespace-nowrap px-3 py-2.5 text-neutral-400"
        title={formatDateTime(row.created_at)}
      >
        {formatAgo(row.created_at)}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        <span
          className={
            isDestructive(row.action)
              ? "rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300"
              : "rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300"
          }
        >
          {actionLabel(row.action)}
        </span>
      </td>

      <td className="px-3 py-2.5">
        {row.target_exists && row.target_user_id ? (
          <Link
            href={`/admin/users?q=${encodeURIComponent(row.target_email ?? row.target_user_id)}`}
            className="text-neutral-200 underline-offset-2 hover:underline"
          >
            {row.target_email ?? row.target_user_id}
          </Link>
        ) : row.target_email || row.target_user_id ? (
          <>
            <span className="text-neutral-300">
              {row.target_email ?? row.target_user_id}
            </span>
            {/* Says why there is no link, rather than leaving a dead one. */}
            <span className="ml-1.5 text-xs text-neutral-600">(no account)</span>
          </>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>

      <td className="px-3 py-2.5 text-neutral-400">{details || "—"}</td>

      <td className="hidden whitespace-nowrap px-3 py-2.5 text-neutral-500 xl:table-cell">
        {row.actor_email ?? row.actor_id}
      </td>
    </tr>
  );
}

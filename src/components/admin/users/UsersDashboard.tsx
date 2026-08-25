"use client";

/**
 * The Users page's body: one page of accounts, and the drawer that opens on
 * any of them.
 *
 * Server-rendered with the first page already in hand, then refetched on
 * search, sort or paging — the Overview page's pattern, for the same reason.
 * A dashboard that opens on a skeleton is a dashboard you wait for.
 *
 * SORTING IS A CHOICE OF COLUMN, NOT A DIRECTION.
 *
 * Every sortable column has exactly one useful order: biggest balance,
 * biggest spend, most recent activity. Offering ascending as well would double
 * the states to reason about in order to answer "who spends the least", which
 * is not a question this page is for. The headers say so with aria-sort, and
 * clicking an active header does not flip it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminUserListResult, AdminUserRow, UserSort } from "@/lib/admin/users";
import { isSuspended } from "@/lib/admin/users";
import {
  formatAgo,
  formatDateTime,
  formatNumber,
  formatRupees,
} from "../charts/format";
import { UserDrawer } from "./UserDrawer";

/** Column → sort key. A column with no key is not sortable. */
const COLUMNS: Array<{
  key: string;
  label: string;
  sort?: UserSort;
  align?: "right";
  /** Hidden below xl, where the row would otherwise wrap into illegibility. */
  wide?: boolean;
}> = [
  { key: "account", label: "Account", sort: "email" },
  { key: "created", label: "Signed up", sort: "recent" },
  { key: "active", label: "Last active", sort: "active" },
  { key: "balance", label: "Balance", sort: "balance", align: "right" },
  { key: "revenue", label: "Lifetime", sort: "revenue", align: "right" },
  { key: "spent", label: "Spent", sort: "spent", align: "right" },
  { key: "projects", label: "Projects", align: "right", wide: true },
  { key: "generations", label: "Runs", sort: "generations", align: "right" },
  { key: "flags", label: "Flags", sort: "flags", align: "right" },
  { key: "status", label: "Status" },
];

const SEARCH_DEBOUNCE_MS = 250;

export function UsersDashboard({
  initial,
  adminId,
  initialSearch = "",
}: {
  initial: AdminUserListResult;
  adminId: string;
  /** Seeded from ?q=, so a link from the Content feed lands on that account. */
  initialSearch?: string;
}) {
  const [result, setResult] = useState(initial);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState<UserSort>(initial.sort);
  const [offset, setOffset] = useState(initial.offset);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const limit = initial.limit;
  // The first render already has its data; skip the effect that would refetch
  // the identical page a moment after paint.
  const hydrated = useRef(false);

  const load = useCallback(
    async (params: { q: string; sort: UserSort; offset: number }) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          sort: params.sort,
          limit: String(limit),
          offset: String(params.offset),
        });
        if (params.q) query.set("q", params.q);

        const response = await fetch(`/api/admin/users?${query}`);
        if (!response.ok) throw new Error(String(response.status));
        setResult(await response.json());
        setFetchFailed(false);
      } catch {
        // Keep the rows already on screen. A stale page with a warning above
        // it beats an empty table that reads as "no accounts".
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
      () => void load({ q: search, sort, offset }),
      // Only typing needs the debounce; a sort or a page change should feel
      // immediate.
      search ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [search, sort, offset, load]);

  /** Re-read the current page — after an action changed one of its rows. */
  const refresh = useCallback(
    () => load({ q: search, sort, offset }),
    [load, search, sort, offset]
  );

  const users = result.users;
  const total = result.total;
  const from = users.length ? offset + 1 : 0;
  const to = offset + users.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Users</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Every account, what they spend, and what they have made.
        </p>
      </header>

      {/* One filter row, above everything it scopes — the Overview page's rule.
          Search and sort both describe the same table, so they sit together
          and never inside it. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              // A new search invalidates the page number: page 3 of the old
              // result set is not page 3 of this one.
              setOffset(0);
            }}
            placeholder="Search email, name or user id"
            aria-label="Search accounts"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
        </div>

        <p className="text-xs text-neutral-500" aria-live="polite">
          {loading
            ? "Loading…"
            : total > 0
              ? `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`
              : "No accounts"}
        </p>
      </div>

      {fetchFailed && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Could not refresh — showing the last page that loaded.
        </p>
      )}

      {result.failed ? (
        // Distinct from "no accounts", and says which it is. Showing an empty
        // table for a failed query is showing a fact an admin would believe.
        <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-3 text-sm text-red-300">
          The account list could not be read. Check the server log — and run{" "}
          <code className="text-red-200">0008_admin_users.sql</code> if you have
          not yet.
        </p>
      ) : (
        <div
          className={`overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 transition-opacity ${
            loading ? "opacity-60" : "opacity-100"
          }`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left">
                {COLUMNS.map((column) => {
                  const active = column.sort === sort;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        active
                          ? column.sort === "email"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={`px-3 py-2.5 text-xs font-medium ${
                        column.align === "right" ? "text-right" : ""
                      } ${column.wide ? "hidden xl:table-cell" : ""} ${
                        active ? "text-neutral-200" : "text-neutral-500"
                      }`}
                    >
                      {column.sort ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSort(column.sort as UserSort);
                            setOffset(0);
                          }}
                          className="hover:text-neutral-200 transition-colors"
                        >
                          {column.label}
                          {active && <span aria-hidden> ↓</span>}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {users.map((user) => (
                <UserRow
                  key={user.user_id}
                  user={user}
                  isSelf={user.user_id === adminId}
                  onOpen={() => setSelected(user.user_id)}
                />
              ))}

              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className="px-3 py-10 text-center text-sm text-neutral-500"
                  >
                    {search
                      ? `Nothing matches “${search}”.`
                      : "No accounts yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > limit && (
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
            disabled={to >= total || loading}
            onClick={() => setOffset(offset + limit)}
            className="rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            Next
          </button>
        </div>
      )}

      {selected && (
        <UserDrawer
          userId={selected}
          isSelf={selected === adminId}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onOpen,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onOpen: () => void;
}) {
  const suspended = isSuspended(user.banned_until);

  return (
    <tr
      onClick={onOpen}
      className="border-b border-neutral-800/60 last:border-0 cursor-pointer hover:bg-neutral-800/40 transition-colors"
    >
      <td className="px-3 py-2.5">
        {/* The button carries the row's keyboard affordance; the row's own
            click handler is the mouse convenience on top of it. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="text-left"
        >
          <span className="block text-neutral-100">{user.email ?? "—"}</span>
          <span className="block text-xs text-neutral-500">
            {user.name ?? (isSelf ? "You" : "No name")}
          </span>
        </button>
      </td>

      <td
        className="px-3 py-2.5 text-neutral-400"
        title={formatDateTime(user.created_at)}
      >
        {formatAgo(user.created_at)}
      </td>

      <td
        className="px-3 py-2.5 text-neutral-400"
        title={
          user.last_active_at
            ? `Last generation: ${formatDateTime(user.last_active_at)}`
            : "Has never generated"
        }
      >
        {formatAgo(user.last_active_at)}
      </td>

      <td className="px-3 py-2.5 text-right text-neutral-200 tabular-nums">
        {formatNumber(user.balance)}
        {user.pending > 0 && (
          <span
            className="block text-xs text-amber-300/80"
            title="Dispatched but not yet settled"
          >
            −{formatNumber(user.pending)} pending
          </span>
        )}
      </td>

      <td className="px-3 py-2.5 text-right text-neutral-200 tabular-nums">
        {user.lifetime_paise > 0 ? formatRupees(user.lifetime_paise) : "—"}
      </td>

      <td className="px-3 py-2.5 text-right text-neutral-400 tabular-nums">
        {formatNumber(user.credits_spent)}
      </td>

      <td className="hidden px-3 py-2.5 text-right text-neutral-400 tabular-nums xl:table-cell">
        {formatNumber(user.projects)}
      </td>

      <td className="px-3 py-2.5 text-right text-neutral-400 tabular-nums">
        {formatNumber(user.generations)}
        {user.generations_failed > 0 && (
          <span className="block text-xs text-neutral-600">
            {formatNumber(user.generations_failed)} failed
          </span>
        )}
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums">
        {/* Zero is written as an em dash: a column of noughts reads as a
            measurement, and what it mostly means here is "nothing to see". */}
        {user.flags > 0 ? (
          <span className="text-amber-300">{formatNumber(user.flags)}</span>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>

      <td className="px-3 py-2.5">
        {/* Never colour alone — the badge says the word. */}
        {suspended ? (
          <span className="rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300">
            Suspended
          </span>
        ) : (
          <span className="text-xs text-neutral-500">Active</span>
        )}
      </td>
    </tr>
  );
}

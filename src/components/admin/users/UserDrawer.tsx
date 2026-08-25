"use client";

/**
 * One account, opened over the list.
 *
 * A drawer rather than a route: every action in here changes a row that is
 * still on screen behind it, and a navigation would throw away the search,
 * the sort and the page you found the account on.
 *
 * WHAT IS NOT HERE
 *
 * "View as user" was in the plan for this page and was left out. It means
 * minting a session as someone else — the admin could then spend their
 * credits, edit their projects, and nothing on the user's side would record
 * that it happened. The three read-only tabs below answer the question that
 * feature was for.
 *
 * EVERY ACTION RE-READS RATHER THAN PATCHING LOCAL STATE.
 *
 * A grant's true result is whatever grant_credits() returned, which is not
 * always balance + amount — a repeated ref is a no-op that returns the
 * unchanged balance. Optimistically adding the number on screen would show a
 * grant that did not happen.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  AdminGenerationRow,
  AdminLedgerRow,
  AdminProjectRow,
  AdminUserDetail,
} from "@/lib/admin/users";
import { isSuspended } from "@/lib/admin/users";
import {
  formatAgo,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRupees,
} from "../charts/format";

type DrawerData = {
  user: AdminUserDetail;
  projects: AdminProjectRow[];
  generations: AdminGenerationRow[];
  ledger: AdminLedgerRow[];
  ledgerTotal: number;
  failed: string[];
};

const TABS = ["Overview", "Projects", "Generations", "Ledger"] as const;
type Tab = (typeof TABS)[number];

export function UserDrawer({
  userId,
  isSelf,
  onClose,
  onChanged,
}: {
  userId: string;
  /** The admin's own row. Suspend and delete are refused server-side too. */
  isSelf: boolean;
  onClose: () => void;
  /** The list behind the drawer re-reads the page this row is on. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`);
      if (!response.ok) throw new Error(`Could not load account (${response.status})`);
      setData(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load account");
    }
  }, [userId]);

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

  /**
   * Run an action, then re-read both the drawer and the list.
   *
   * The message it returns is shown as-is: the server's refusals are written
   * to be read ("Type the account's email address to confirm"), and
   * paraphrasing them here would mean two places to keep in step.
   */
  const act = useCallback(
    async (
      request: { url: string; method: string; body: unknown },
      onDone?: () => void
    ) => {
      setBusy(true);
      setNotice(null);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setNotice(payload.error ?? `Failed (${response.status})`);
          return false;
        }

        await load();
        onChanged();
        onDone?.();
        return true;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Action failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged]
  );

  const user = data?.user;
  const suspended = isSuspended(user?.banned_until ?? null);

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
        aria-label={user?.email ?? "Account"}
        className="relative flex h-full w-full max-w-3xl flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl"
      >
        <header className="flex items-start gap-4 border-b border-neutral-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-neutral-100">
              {user?.email ?? "Loading…"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {user?.name ?? "No name"}
              {user && ` · joined ${formatDateTime(user.created_at)}`}
            </p>
          </div>

          {suspended && (
            <span className="shrink-0 rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300">
              Suspended
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            ✕
          </button>
        </header>

        <nav className="flex gap-1 border-b border-neutral-800 px-3 py-2">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              aria-current={tab === name ? "page" : undefined}
              className={
                tab === name
                  ? "rounded px-3 py-1.5 text-sm text-neutral-100 bg-neutral-800"
                  : "rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors"
              }
            >
              {name}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {notice && (
            <p className="mb-4 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200">
              {notice}
            </p>
          )}

          {!data && !error && (
            <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
          )}

          {data && tab === "Overview" && (
            <OverviewTab
              data={data}
              isSelf={isSelf}
              suspended={suspended}
              busy={busy}
              act={act}
              onDeleted={() => {
                onChanged();
                onClose();
              }}
            />
          )}

          {data && tab === "Projects" && <ProjectsTab data={data} />}
          {data && tab === "Generations" && <GenerationsTab data={data} />}
          {data && tab === "Ledger" && (
            <LedgerTab data={data} busy={busy} act={act} />
          )}
        </div>
      </aside>
    </div>
  );
}

type Act = (
  request: { url: string; method: string; body: unknown },
  onDone?: () => void
) => Promise<boolean>;

/** A tab whose read failed says so — it is not an account with nothing in it. */
function TabFailed({ name }: { name: string }) {
  return (
    <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
      The {name} could not be read. Check the server log.
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-neutral-500">{children}</p>;
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none text-neutral-100">
        {value}
      </p>
      {note && <p className="mt-1.5 text-xs text-neutral-500">{note}</p>}
    </div>
  );
}

function OverviewTab({
  data,
  isSelf,
  suspended,
  busy,
  act,
  onDeleted,
}: {
  data: DrawerData;
  isSelf: boolean;
  suspended: boolean;
  busy: boolean;
  act: Act;
  onDeleted: () => void;
}) {
  const { user } = data;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");

  const grant = async () => {
    const credits = Number(amount);
    if (!Number.isInteger(credits) || credits <= 0) return;
    const ok = await act({
      url: `/api/admin/users/${user.user_id}/credits`,
      method: "POST",
      body: {
        amount: credits,
        reason: reason || null,
        // Minted per submission, so a retry of THIS grant is a no-op while a
        // deliberate second grant of the same size still goes through.
        requestId: crypto.randomUUID(),
      },
    });
    if (ok) {
      setAmount("");
      setReason("");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Balance"
          value={formatNumber(user.balance)}
          note={user.pending > 0 ? `${formatNumber(user.pending)} unsettled` : undefined}
        />
        <Figure
          label="Paid"
          value={formatRupees(user.credits.lifetime_paise)}
          note={`${formatNumber(user.credits.purchases)} purchases`}
        />
        <Figure
          label="Credits spent"
          value={formatNumber(user.credits.spent)}
          note={`${formatNumber(user.credits.granted)} granted free`}
        />
        <Figure
          label="Runs"
          value={formatNumber(user.runs.total)}
          note={
            user.runs.total
              ? `${formatNumber(user.runs.failed)} failed · ${formatNumber(user.runs.pending)} pending`
              : "Never generated"
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
        <Row label="User id" value={user.user_id} mono />
        <Row label="Sign-in methods" value={user.providers.join(", ") || "—"} />
        <Row label="Last sign-in" value={formatDateTime(user.last_sign_in_at)} />
        {/* Labelled as generation, not as "activity": a token refresh moves
            last_sign_in_at, so the two answer different questions. */}
        <Row label="Last generation" value={formatDateTime(user.runs.last_at)} />
        <Row
          label="Email confirmed"
          value={user.email_confirmed_at ? formatDateTime(user.email_confirmed_at) : "No"}
        />
        <Row label="Projects" value={formatNumber(user.projects)} />
      </dl>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-medium text-neutral-200">Grant credits</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Recorded in the ledger as an admin grant, and in the admin log against
          your account. There is no undo — credits are compute already owed.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Credits"
            aria-label="Credits to grant"
            className="w-28 rounded border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
          />
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (shown in their ledger)"
            aria-label="Reason"
            className="min-w-[200px] flex-1 rounded border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || !amount}
            onClick={() => void grant()}
            className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40 transition-colors"
          >
            Grant
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-medium text-neutral-200">Account status</h3>

        {isSelf ? (
          <p className="mt-2 text-xs text-neutral-500">
            This is your own account. Suspending or deleting it would lock the
            only admin out, so both are refused here and on the server.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-neutral-500">
              {suspended
                ? "Suspended: they cannot sign in, and their session stops working at its next refresh."
                : "Suspending blocks sign-in and token refresh. An access token already issued keeps working until it expires — up to an hour."}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act({
                    url: `/api/admin/users/${user.user_id}`,
                    method: "PATCH",
                    body: { action: suspended ? "unsuspend" : "suspend" },
                  })
                }
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 transition-colors"
              >
                {suspended ? "Lift suspension" : "Suspend account"}
              </button>

              {!confirmDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  className="rounded border border-red-900/60 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-40 transition-colors"
                >
                  Delete account…
                </button>
              )}
            </div>

            {confirmDelete && (
              <div className="mt-3 rounded border border-red-900/60 bg-red-950/20 p-3">
                <p className="text-xs leading-relaxed text-red-200">
                  Deleting cascades: their projects, media, ledger and{" "}
                  <strong className="font-medium">
                    every generation_events row
                  </strong>{" "}
                  go with the account — including the record of whatever you are
                  deleting them for. Suspending keeps all of it. Only the entry
                  in the admin log survives.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={typedEmail}
                    onChange={(event) => setTypedEmail(event.target.value)}
                    placeholder={user.email ?? "email"}
                    aria-label="Type the account's email to confirm"
                    className="min-w-[220px] flex-1 rounded border border-red-900/60 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={
                      busy ||
                      typedEmail.trim().toLowerCase() !==
                        (user.email ?? "").toLowerCase()
                    }
                    onClick={() =>
                      void act(
                        {
                          url: `/api/admin/users/${user.user_id}`,
                          method: "DELETE",
                          body: { confirmEmail: typedEmail.trim() },
                        },
                        onDeleted
                      )
                    }
                    className="rounded bg-red-900 px-3 py-1.5 text-sm font-medium text-red-100 hover:bg-red-800 disabled:opacity-40 transition-colors"
                  >
                    Delete permanently
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      setTypedEmail("");
                    }}
                    className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd
        className={`truncate text-neutral-200 ${mono ? "font-mono text-xs" : "text-sm"}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function ProjectsTab({ data }: { data: DrawerData }) {
  if (data.failed.includes("projects")) return <TabFailed name="project list" />;
  if (!data.projects.length) return <Empty>No saved projects.</Empty>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
          <th scope="col" className="py-2 pr-3 font-medium">Project</th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">Nodes</th>
          <th scope="col" className="py-2 text-right font-medium">Updated</th>
        </tr>
      </thead>
      <tbody>
        {data.projects.map((project) => (
          <tr key={project.id} className="border-b border-neutral-800/60 last:border-0">
            <td className="py-2 pr-3 text-neutral-200">
              {project.name || "Untitled"}
            </td>
            <td className="py-2 pr-3 text-right text-neutral-400 tabular-nums">
              {formatNumber(project.node_count ?? 0)}
            </td>
            <td
              className="py-2 text-right text-neutral-400"
              title={formatDateTime(project.updated_at)}
            >
              {formatAgo(project.updated_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GenerationsTab({ data }: { data: DrawerData }) {
  if (data.failed.includes("generations")) {
    return <TabFailed name="generation log" />;
  }
  if (!data.generations.length) {
    return (
      <Empty>
        Nothing recorded. The log only holds runs made since it shipped — it
        cannot be backfilled.
      </Empty>
    );
  }

  return (
    <ul className="space-y-3">
      {data.generations.map((run) => (
        <li
          key={run.id}
          className="flex gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
        >
          {/* Video, audio and 3D runs carry no thumbnail — a frame needs a
              decoder that does not run server-side here — so the placeholder
              names the type rather than pretending the picture failed. */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-950 text-[10px] uppercase tracking-wide text-neutral-600">
            {run.thumb_url ? (
              <img
                src={run.thumb_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              run.output_kind ?? run.kind
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm text-neutral-200">
              {run.prompt || run.output_text || "No prompt recorded"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {run.model_id ?? "unknown model"} ·{" "}
              <span
                className={
                  run.status === "failed"
                    ? "text-red-300"
                    : run.status === "pending"
                      ? "text-amber-300"
                      : "text-neutral-400"
                }
              >
                {run.status}
              </span>
              {run.credits_charged ? ` · ${formatNumber(run.credits_charged)} cr` : ""}
              {run.duration_ms ? ` · ${formatDuration(run.duration_ms)}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-neutral-600" title={formatDateTime(run.created_at)}>
              {formatAgo(run.created_at)}
              {run.error ? ` · ${run.error}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LedgerTab({
  data,
  busy,
  act,
}: {
  data: DrawerData;
  busy: boolean;
  act: Act;
}) {
  if (data.failed.includes("ledger")) return <TabFailed name="ledger" />;
  if (!data.ledger.length) return <Empty>No transactions.</Empty>;

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
            <th scope="col" className="py-2 pr-3 font-medium">When</th>
            <th scope="col" className="py-2 pr-3 font-medium">Kind</th>
            <th scope="col" className="py-2 pr-3 font-medium">Reason</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Credits</th>
            <th scope="col" className="py-2 text-right font-medium">
              <span className="sr-only">Refund</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.ledger.map((entry) => (
            <tr key={entry.id} className="border-b border-neutral-800/60 last:border-0">
              <td
                className="py-2 pr-3 text-neutral-400"
                title={formatDateTime(entry.created_at)}
              >
                {formatAgo(entry.created_at)}
              </td>
              <td className="py-2 pr-3 text-neutral-300">{entry.kind}</td>
              <td className="max-w-[220px] truncate py-2 pr-3 text-neutral-500" title={entry.reason ?? ""}>
                {entry.reason ?? "—"}
              </td>
              <td
                className={`py-2 pr-3 text-right tabular-nums ${
                  entry.amount < 0 ? "text-neutral-400" : "text-emerald-300"
                }`}
              >
                {entry.amount > 0 ? "+" : ""}
                {formatNumber(entry.amount)}
              </td>
              <td className="py-2 text-right">
                {entry.kind === "spend" &&
                  (entry.refunded ? (
                    <span className="text-xs text-neutral-600">Refunded</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          url: `/api/admin/users/${data.user.user_id}/credits`,
                          method: "POST",
                          body: { transactionId: entry.id },
                        })
                      }
                      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 transition-colors"
                    >
                      Refund
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.ledgerTotal > data.ledger.length && (
        <p className="mt-3 text-xs text-neutral-500">
          Showing the {formatNumber(data.ledger.length)} most recent of{" "}
          {formatNumber(data.ledgerTotal)}.
        </p>
      )}
    </>
  );
}

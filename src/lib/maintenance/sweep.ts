/**
 * The two maintenance jobs this project wrote and never ran.
 *
 * Both were finished long ago as SQL and left uncalled for the same reason:
 * nothing here runs on a timer. `settle_pending_charges` (0004) closes the
 * closed-tab billing leak, `prune_generation_events` (0006) enforces
 * retention, and `sweep_stale_pending_charges` (0011) is the enumeration the
 * first one was missing. This module invokes them and does the part SQL
 * cannot: deleting storage objects.
 *
 * Nothing here throws for an ordinary failure. A maintenance run is
 * unattended, so a thrown error is a stack trace nobody reads at 3am. Each job
 * reports what it did and what broke, and the route returns both — a job that
 * fails is a fact in the response, not an exception that hides the job beside
 * it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MODERATION_BUCKET } from "@/lib/admin/thumbnails";

/**
 * How long a pending charge must sit before a sweep will settle it.
 *
 * Must exceed the longest workflow anyone runs, or the sweep bills a live one
 * mid-flight — see the argument in 0011. The longest single route timeout in
 * this app is 5 minutes, so an hour is generous on purpose.
 */
export const DEFAULT_STALE_MINUTES = 60;

/** Users settled per invocation. Bounds the first run after an outage. */
export const DEFAULT_SWEEP_LIMIT = 500;

/**
 * Retention window for generation_events.
 *
 * This is the moderation record and the entire input to the stats board, so
 * the default is long. Shortening it silently shortens the dashboard's memory.
 */
export const DEFAULT_RETENTION_DAYS = 180;

/** Supabase caps a single storage remove(); chunked well under it. */
const STORAGE_REMOVE_CHUNK = 100;

export type SweepResult = {
  /** Users whose charges were settled. */
  users: number;
  /** Credits actually debited across all of them. */
  charged: number;
  /** Node runs those credits paid for. */
  runs: number;
  /** Credits owed that no balance covered. */
  shortfall: number;
  failed: string | null;
};

export type PruneResult = {
  rowsDeleted: number;
  /** Storage objects removed — thumbnails and full media together. */
  thumbsDeleted: number;
  /** Storage keys the row delete orphaned because their removal failed. */
  thumbsOrphaned: number;
  failed: string | null;
};

export type AbandonedRunsResult = {
  /** Runs closed as abandoned. */
  runs: number;
  /** Credits those runs still owed when they were swept. */
  charged: number;
  /** Node runs those credits paid for. */
  nodeRuns: number;
  shortfall: number;
  failed: string | null;
};

export type MaintenanceResult = {
  settle: SweepResult;
  runs: AbandonedRunsResult;
  prune: PruneResult;
};

/** Clamp to [1, 10080] (a week). Rejects junk rather than passing it through. */
export function normalizeMinutes(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_STALE_MINUTES;
  return Math.min(10080, Math.max(1, Math.floor(n)));
}

/** Clamp to [1, 5000]. */
export function normalizeLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SWEEP_LIMIT;
  return Math.min(5000, Math.max(1, Math.floor(n)));
}

/**
 * Clamp to [7, 3650].
 *
 * The floor is not cosmetic. This deletes the only record of what users
 * generated, and it cannot be backfilled — a fat-fingered `days=0` would erase
 * the moderation log and every usage panel's history in one call.
 */
export function normalizeDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(3650, Math.max(7, Math.floor(n)));
}

/**
 * Settle every workflow the browser never settled.
 *
 * A shortfall means the affordability check in `withCredits()` let through
 * more than the balance covered. It is surfaced rather than swallowed because
 * it is likelier here than on the client path: a user can spend down to
 * nothing during the hour a stale row waits.
 */
export async function sweepPendingCharges(
  service: SupabaseClient,
  opts: { minutes?: number; limit?: number } = {}
): Promise<SweepResult> {
  const minutes = normalizeMinutes(opts.minutes ?? DEFAULT_STALE_MINUTES);
  const limit = normalizeLimit(opts.limit ?? DEFAULT_SWEEP_LIMIT);

  const empty: SweepResult = {
    users: 0,
    charged: 0,
    runs: 0,
    shortfall: 0,
    failed: null,
  };

  const { data, error } = await service.rpc("sweep_stale_pending_charges", {
    p_minutes: minutes,
    p_limit: limit,
  });

  if (error) {
    console.error("[maintenance] settle sweep failed:", error.message);
    return { ...empty, failed: error.message };
  }

  const rows = (data ?? []) as Array<{
    user_id: string;
    charged: number | null;
    runs: number | null;
    shortfall: number | null;
  }>;

  const result = rows.reduce<SweepResult>(
    (acc, row) => ({
      users: acc.users + 1,
      charged: acc.charged + (row.charged ?? 0),
      runs: acc.runs + (row.runs ?? 0),
      shortfall: acc.shortfall + (row.shortfall ?? 0),
      failed: null,
    }),
    empty
  );

  if (result.shortfall > 0) {
    console.warn("[maintenance] swept with a shortfall", {
      shortfall: result.shortfall,
      users: result.users,
    });
  }

  return result;
}

/**
 * Delete generation_events past the retention window, and their thumbnails.
 *
 * ORDER: rows first, then storage — the opposite of `removeContent()`, and
 * deliberately so. There, the row survives the removal, so a live thumbnail it
 * could no longer reach would be hidden evidence; storage has to go first.
 * Here the row is gone entirely, so there is nothing left to mislead anyone,
 * and the worst case is an orphaned object. Litter beats a dangling reference,
 * and SQL cannot do both halves in one transaction anyway.
 *
 * Orphans are counted and returned rather than retried. A repeat failure means
 * storage is broken, which is not something a retry loop inside a cron handler
 * is going to fix.
 */
export async function pruneGenerationEvents(
  service: SupabaseClient,
  opts: { days?: number } = {}
): Promise<PruneResult> {
  const days = normalizeDays(opts.days ?? DEFAULT_RETENTION_DAYS);

  const { data, error } = await service.rpc("prune_generation_events", {
    p_days: days,
  });

  if (error) {
    console.error("[maintenance] prune failed:", error.message);
    return {
      rowsDeleted: 0,
      thumbsDeleted: 0,
      thumbsOrphaned: 0,
      failed: error.message,
    };
  }

  const rows = (data ?? []) as Array<{
    deleted_thumb_path: string | null;
    deleted_media_path: string | null;
  }>;
  const rowsDeleted = rows.length;

  // BOTH objects, or retention leaks. The row that named the full-resolution
  // copy is now gone, so an unremoved one can never be found again — it would
  // sit in the bucket forever, which for full media is the difference between
  // litter and an unbounded bill.
  //
  // Most rows still carry no thumbnail (video, audio and 3D never get one), so
  // the key list stays much shorter than the row count.
  const keys = rows
    .flatMap((row) => [row.deleted_thumb_path, row.deleted_media_path])
    .filter((key): key is string => typeof key === "string" && key.length > 0);

  let thumbsDeleted = 0;
  let thumbsOrphaned = 0;

  for (let i = 0; i < keys.length; i += STORAGE_REMOVE_CHUNK) {
    const chunk = keys.slice(i, i + STORAGE_REMOVE_CHUNK);
    const { error: removeError } = await service.storage
      .from(MODERATION_BUCKET)
      .remove(chunk);

    if (removeError) {
      // Loudly, and with the keys: the rows are already gone, so this log line
      // is the only remaining record that these objects exist.
      console.error(
        "[maintenance] orphaned thumbnails, rows already deleted:",
        removeError.message,
        chunk
      );
      thumbsOrphaned += chunk.length;
    } else {
      thumbsDeleted += chunk.length;
    }
  }

  return { rowsDeleted, thumbsDeleted, thumbsOrphaned, failed: null };
}

/**
 * Close the runs a browser never closed.
 *
 * executeWorkflow closes its run on both exit paths, but neither runs if the
 * tab is closed or the machine sleeps mid-render. Those rows sit at 'running'
 * forever, permanently inflating the run counts on the history page with runs
 * that are neither successes nor failures.
 *
 * Ordered AFTER the user-wide settle sweep on purpose. That one bills every
 * unsettled row a user has, including rows belonging to an abandoned run — so
 * by the time this runs there is usually nothing left to charge and the job is
 * only closing the row. Reversing the order would work too, but this way the
 * money moves through one path in the common case rather than two.
 */
export async function sweepAbandonedRuns(
  service: SupabaseClient,
  opts: { minutes?: number; limit?: number } = {}
): Promise<AbandonedRunsResult> {
  const minutes = normalizeMinutes(opts.minutes ?? DEFAULT_STALE_MINUTES);
  const limit = normalizeLimit(opts.limit ?? DEFAULT_SWEEP_LIMIT);

  const empty: AbandonedRunsResult = {
    runs: 0,
    charged: 0,
    nodeRuns: 0,
    shortfall: 0,
    failed: null,
  };

  const { data, error } = await service.rpc("sweep_abandoned_runs", {
    p_minutes: minutes,
    p_limit: limit,
  });

  if (error) {
    console.error("[maintenance] abandoned-run sweep failed:", error.message);
    return { ...empty, failed: error.message };
  }

  const rows = (data ?? []) as Array<{
    charged: number | null;
    runs: number | null;
    shortfall: number | null;
  }>;

  return rows.reduce<AbandonedRunsResult>(
    (acc, row) => ({
      runs: acc.runs + 1,
      charged: acc.charged + (row.charged ?? 0),
      nodeRuns: acc.nodeRuns + (row.runs ?? 0),
      shortfall: acc.shortfall + (row.shortfall ?? 0),
      failed: null,
    }),
    empty
  );
}

/**
 * All three jobs. Sequential, so none of them contend for the same rows.
 *
 * Each reports its own failure and none aborts the others: a broken prune must
 * not stop settlement from running for a week, which is exactly what a single
 * shared failure path would cause.
 */
export async function runMaintenance(
  service: SupabaseClient,
  opts: { minutes?: number; limit?: number; days?: number } = {}
): Promise<MaintenanceResult> {
  const settle = await sweepPendingCharges(service, opts);
  const runs = await sweepAbandonedRuns(service, opts);
  const prune = await pruneGenerationEvents(service, opts);
  return { settle, runs, prune };
}

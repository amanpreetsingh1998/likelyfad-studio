/**
 * Reads the dashboard's numbers out of Postgres.
 *
 * Every aggregate is computed by the SQL functions in 0007_admin_stats.sql —
 * this module only calls them, shapes the result, and decides what a failure
 * looks like. See that file for why the counting happens down there.
 *
 * A panel that cannot be read comes back empty rather than taking the whole
 * page down with it. The dashboard is the thing you open when something is
 * already wrong; one broken query should cost you one panel, not the view.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Default reporting window, in days. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Bounds on the window a caller may ask for. */
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

export type StatsOverview = {
  users: {
    total: number;
    new_7d: number;
    new_30d: number;
    active_30d: number;
    paying: number;
  };
  revenue: { total_paise: number; paise_30d: number; purchases: number };
  credits: {
    outstanding: number;
    granted_total: number;
    purchased_total: number;
    spent_total: number;
    unsettled: number;
  };
  runs: {
    total: number;
    runs_30d: number;
    succeeded_30d: number;
    failed_30d: number;
    pending: number;
  };
};

export type DailyRow = {
  day: string;
  signups: number;
  revenue_paise: number;
  credits_purchased: number;
  credits_granted: number;
  credits_spent: number;
  runs: number;
  runs_failed: number;
};

export type RunsByKindRow = { day: string; kind: string; runs: number };

export type ModelRow = {
  model_id: string;
  kind: string | null;
  provider: string | null;
  runs: number;
  succeeded: number;
  failed: number;
  credits: number;
  avg_duration_ms: number;
};

export type AdminStats = {
  windowDays: number;
  overview: StatsOverview | null;
  daily: DailyRow[];
  runsByKind: RunsByKindRow[];
  models: ModelRow[];
  /** Panels that could not be read, by name. Surfaced in the UI, not hidden. */
  failed: string[];
};

/** An overview with every figure zeroed, for when the read fails. */
export const EMPTY_OVERVIEW: StatsOverview = {
  users: { total: 0, new_7d: 0, new_30d: 0, active_30d: 0, paying: 0 },
  revenue: { total_paise: 0, paise_30d: 0, purchases: 0 },
  credits: {
    outstanding: 0,
    granted_total: 0,
    purchased_total: 0,
    spent_total: 0,
    unsettled: 0,
  },
  runs: { total: 0, runs_30d: 0, succeeded_30d: 0, failed_30d: 0, pending: 0 },
};

/**
 * Clamp a caller-supplied window.
 *
 * The window reaches SQL as a parameter, so it is bounded rather than trusted:
 * `?days=100000` would otherwise generate a hundred thousand rows in the
 * date series before returning any of them.
 */
export function normalizeWindow(raw: unknown): number {
  // Absent is not zero. searchParams.get() returns null for a missing param,
  // and Number(null) is 0 — which is finite, so a naive check would sail past
  // the fallback and clamp every unparameterised request to a one-day window.
  if (raw === null || raw === undefined || raw === "") return DEFAULT_WINDOW_DAYS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.floor(parsed)));
}

async function callRpc<T>(
  service: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  failed: string[]
): Promise<T | null> {
  try {
    const { data, error } = await service.rpc(fn, args);
    if (error) {
      console.error(`[admin] ${fn} failed:`, error.message);
      failed.push(fn);
      return null;
    }
    return (data as T) ?? null;
  } catch (err) {
    console.error(
      `[admin] ${fn} threw:`,
      err instanceof Error ? err.message : err
    );
    failed.push(fn);
    return null;
  }
}

/**
 * Everything the Overview page draws, in one pass.
 *
 * The four calls run concurrently: they touch different tables and none feeds
 * another, so serialising them would just add three round trips to a page
 * whose whole job is to load fast enough to be worth opening.
 */
export async function getAdminStats(
  service: SupabaseClient,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<AdminStats> {
  const days = normalizeWindow(windowDays);
  const failed: string[] = [];

  const [overview, daily, runsByKind, models] = await Promise.all([
    callRpc<StatsOverview>(service, "admin_stats_overview", {}, failed),
    callRpc<DailyRow[]>(service, "admin_stats_daily", { p_days: days }, failed),
    callRpc<RunsByKindRow[]>(
      service,
      "admin_stats_runs_by_kind",
      { p_days: days },
      failed
    ),
    callRpc<ModelRow[]>(
      service,
      "admin_stats_models",
      { p_days: days, p_limit: 15 },
      failed
    ),
  ]);

  return {
    windowDays: days,
    overview,
    daily: daily ?? [],
    runsByKind: runsByKind ?? [],
    models: models ?? [],
    failed,
  };
}

/**
 * Pivot the per-kind rows into one record per day.
 *
 * SQL returns only the (day, kind) pairs that happened; a stacked chart needs
 * every series present on every day it draws, or the bands break where a kind
 * went unused. The day list comes from the daily series, which is already
 * gap-filled, so this fills the grid without inventing dates.
 */
export function pivotRunsByKind(
  rows: RunsByKindRow[],
  days: string[]
): { kinds: string[]; series: Array<Record<string, string | number>> } {
  const kinds = Array.from(new Set(rows.map((r) => r.kind))).sort();
  const byDay = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const bucket = byDay.get(row.day) ?? {};
    bucket[row.kind] = (bucket[row.kind] ?? 0) + row.runs;
    byDay.set(row.day, bucket);
  }

  const series = days.map((day) => {
    const bucket = byDay.get(day) ?? {};
    const record: Record<string, string | number> = { day };
    for (const kind of kinds) record[kind] = bucket[kind] ?? 0;
    return record;
  });

  return { kinds, series };
}

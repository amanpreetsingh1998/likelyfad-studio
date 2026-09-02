/**
 * Reading a user's workflow history.
 *
 * Everything here goes through the CALLER'S Supabase client, never the service
 * client. The two SQL functions are security definer and scope themselves with
 * `auth.uid()` rather than taking an id parameter, so calling them as the
 * service role would have no caller to scope to and return nothing. That is
 * the intended shape: there is no id to forge because there is no id to pass.
 *
 * TWO KINDS OF NUMBER, NEVER MIXED
 *
 * `lastSuccess` is measured — what a run of this workflow actually cost and
 * how long it actually took. `estimate` is derived from the graph at save
 * time. The UI shows the measured figure when there is one and the estimate
 * only when there is not, and it must label which it is showing. Presenting a
 * prediction in the same column as a measurement, unlabelled, makes a guess
 * look like a fact.
 *
 * A FAILED READ IS REPORTED, NOT RENDERED AS AN EMPTY LIST
 *
 * "You have no workflows" and "the query broke" look identical once an error
 * becomes an empty array, and the first is a fact a user would act on. Both
 * readers return a `failed` marker for the caller to render as "could not
 * load" rather than as an empty state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkflowEstimate = {
  credits: number | null;
  durationMs: number | null;
  /**
   * True when the graph contains a model with no recorded price, so the total
   * is a floor rather than a figure. Mirrors the 409 unpriced_model refusal:
   * we decline to guess the missing part rather than substituting an average.
   */
  partial: boolean;
  models: string[];
};

export type WorkflowLastSuccess = {
  at: string | null;
  credits: number | null;
  /** Wall clock, not the sum of node durations. Nodes run concurrently. */
  durationMs: number | null;
  models: string[];
};

export type WorkflowHistoryEntry = {
  projectId: string;
  title: string;
  description: string | null;
  nodeCount: number | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Whether the caller built this workflow, or is only allowed to run it.
   *
   * An owner gets Open and a publish toggle; everyone else gets Run. The
   * distinction is decided in SQL against auth.uid(), never inferred client
   * side from whose name is on the card.
   */
  isOwner: boolean;
  /** Available to every signed-in user. Only the owner can change this. */
  isPublished: boolean;
  runCount: number;
  successCount: number;
  failedCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  /** Null when no run of this workflow has ever completed. */
  lastSuccess: WorkflowLastSuccess | null;
  /** The range across successful runs, when there is more than one. */
  creditsRange: { min: number; max: number } | null;
  estimate: WorkflowEstimate;
};

export type WorkflowHistoryPage = {
  entries: WorkflowHistoryEntry[];
  total: number;
  /** Set when the read failed. The caller must not render this as "empty". */
  failed: string | null;
};

export type WorkflowHistoryQuery = {
  limit?: number;
  offset?: number;
  q?: string | null;
  sort?: string | null;
};

const MAX_LIMIT = 100;

export async function listWorkflowHistory(
  supabase: SupabaseClient,
  query: WorkflowHistoryQuery = {}
): Promise<WorkflowHistoryPage> {
  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));

  const { data, error } = await supabase.rpc("user_workflow_history", {
    p_limit: limit,
    p_offset: offset,
    p_q: query.q ?? null,
    p_sort: query.sort ?? "updated",
  });

  if (error) {
    console.error("[workflows] history read failed:", error.message);
    return { entries: [], total: 0, failed: error.message };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    entries: rows.map(toEntry),
    // Every row carries the same window-function count; an empty page is 0.
    total: rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0,
    failed: null,
  };
}

function toEntry(row: Record<string, unknown>): WorkflowHistoryEntry {
  const successAt = asString(row.last_success_at);
  const successCredits = asNumber(row.last_success_credits);

  // A run row exists and completed, so there is a measured figure to show.
  // Absent that, the caller falls back to the estimate — and says so.
  const lastSuccess: WorkflowLastSuccess | null = successAt
    ? {
        at: successAt,
        credits: successCredits,
        durationMs: asNumber(row.last_success_duration_ms),
        models: asStringArray(row.last_success_models),
      }
    : null;

  const min = asNumber(row.credits_min);
  const max = asNumber(row.credits_max);

  return {
    projectId: String(row.project_id),
    title: asString(row.title) ?? "Untitled workflow",
    description: asString(row.description),
    nodeCount: asNumber(row.node_count),
    createdAt: asString(row.created_at) ?? "",
    updatedAt: asString(row.updated_at) ?? "",
    // Defaults to "not mine": a row whose ownership we could not determine
    // must not hand out an edit affordance.
    isOwner: row.is_owner === true,
    isPublished: row.is_published === true,
    runCount: Number(row.run_count ?? 0),
    successCount: Number(row.success_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    lastRunAt: asString(row.last_run_at),
    lastRunStatus: asString(row.last_run_status),
    lastSuccess,
    // Only a real spread is a range. Showing "38–38" says nothing and invites
    // the reader to think two runs disagreed when they did not.
    creditsRange: min !== null && max !== null && max > min ? { min, max } : null,
    estimate: {
      credits: asNumber(row.est_credits),
      durationMs: asNumber(row.est_duration_ms),
      partial: row.est_partial === true,
      models: asStringArray(row.est_models),
    },
  };
}

export type WorkflowRunEntry = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  creditsCharged: number | null;
  shortfall: number | null;
  nodeCount: number | null;
  models: string[];
  eventsTotal: number;
  eventsFailed: number;
};

export type WorkflowRunPage = {
  runs: WorkflowRunEntry[];
  total: number;
  failed: string | null;
};

/**
 * Every run of one workflow — the detail drawer.
 *
 * The SQL scopes to `auth.uid()`, so a project id belonging to another account
 * returns an empty list rather than their runs. The route checks ownership of
 * the project as well: an empty list and "not yours" are different answers,
 * and only the route can tell them apart.
 */
export async function listWorkflowRuns(
  supabase: SupabaseClient,
  projectId: string,
  query: { limit?: number; offset?: number } = {}
): Promise<WorkflowRunPage> {
  const { data, error } = await supabase.rpc("workflow_run_history", {
    p_project_id: projectId,
    p_limit: clampLimit(query.limit, 50),
    p_offset: Math.max(0, Math.floor(query.offset ?? 0)),
  });

  if (error) {
    console.error("[workflows] run history read failed:", error.message);
    return { runs: [], total: 0, failed: error.message };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    runs: rows.map((row) => ({
      id: String(row.id),
      status: asString(row.status) ?? "unknown",
      startedAt: asString(row.started_at) ?? "",
      finishedAt: asString(row.finished_at),
      durationMs: asNumber(row.duration_ms),
      creditsCharged: asNumber(row.credits_charged),
      shortfall: asNumber(row.shortfall),
      nodeCount: asNumber(row.node_count),
      models: asStringArray(row.models),
      eventsTotal: Number(row.events_total ?? 0),
      eventsFailed: Number(row.events_failed ?? 0),
    })),
    total: rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0,
    failed: null,
  };
}

export type UserRunEntry = {
  id: string;
  /** The workflow this run belonged to. Null for a canvas never saved. */
  projectId: string | null;
  /**
   * Snapshot at run time, so a renamed workflow does not retitle its history.
   * Null only when a run predates the snapshot and its workflow is gone.
   */
  projectName: string | null;
  /**
   * Whether there is still a live workflow to open. A run outlives the
   * workflow it ran — `project_id` is `on delete set null` — so a set
   * `projectId` is not on its own a promise that the link goes anywhere.
   */
  projectExists: boolean;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  creditsCharged: number | null;
  shortfall: number | null;
  nodeCount: number | null;
  models: string[];
  eventsTotal: number;
  eventsFailed: number;
};

export type UserRunPage = {
  runs: UserRunEntry[];
  total: number;
  /** Credits charged across the whole filtered set, not this page. */
  totalCredits: number;
  failed: string | null;
};

export type UserRunQuery = {
  limit?: number;
  offset?: number;
  status?: string | null;
  q?: string | null;
};

/**
 * Every run the caller has made, newest first, across every workflow.
 *
 * The companion to `listWorkflowHistory`, and deliberately not derivable from
 * it: a run whose workflow was deleted, or which ran on a canvas that was
 * never saved, has no workflow to be listed under and appears only here. That
 * money is as real as any other, so there has to be somewhere it can be seen.
 *
 * `totalCredits` comes off the row rather than being summed here, for the same
 * reason every other figure on these pages does: summing the page would give a
 * number that describes the pagination while looking like a number that
 * describes the account.
 */
export async function listUserRunHistory(
  supabase: SupabaseClient,
  query: UserRunQuery = {}
): Promise<UserRunPage> {
  const { data, error } = await supabase.rpc("user_run_history", {
    p_limit: clampLimit(query.limit),
    p_offset: Math.max(0, Math.floor(query.offset ?? 0)),
    p_status: query.status ?? null,
    p_q: query.q ?? null,
  });

  if (error) {
    console.error("[workflows] run feed read failed:", error.message);
    return { runs: [], total: 0, totalCredits: 0, failed: error.message };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    runs: rows.map((row) => ({
      id: String(row.id),
      projectId: asString(row.project_id),
      projectName: asString(row.project_name),
      // Defaults to "no workflow to open", so a row we could not resolve
      // offers no link rather than a broken one.
      projectExists: row.project_exists === true,
      status: asString(row.status) ?? "unknown",
      startedAt: asString(row.started_at) ?? "",
      finishedAt: asString(row.finished_at),
      durationMs: asNumber(row.duration_ms),
      creditsCharged: asNumber(row.credits_charged),
      shortfall: asNumber(row.shortfall),
      nodeCount: asNumber(row.node_count),
      models: asStringArray(row.models),
      eventsTotal: Number(row.events_total ?? 0),
      eventsFailed: Number(row.events_failed ?? 0),
    })),
    total: rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0,
    totalCredits: rows.length > 0 ? Number(rows[0].total_credits ?? 0) : 0,
    failed: null,
  };
}

function clampLimit(value: number | undefined, fallback = 25): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

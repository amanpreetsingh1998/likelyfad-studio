/**
 * Reads (and writes) the account list behind /admin/users.
 *
 * The aggregates live in 0008_admin_users.sql for 0007's reason — they count
 * over tables that only grow, and auth.users is not reachable from the
 * application roles at all. This module calls those functions, clamps what a
 * caller may ask for, and shapes the result.
 *
 * FAILURE DISCIPLINE IS NOT THE SAME AS THE STATS BOARD'S.
 *
 * There, a failed panel costs one panel and the page still renders. Here the
 * list IS the page: an empty array from a failed query is indistinguishable
 * from "no accounts", which on an admin page is a number someone would
 * believe. So reads return an explicit `failed` flag and the UI says which of
 * the two it is looking at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { signThumbnails } from "./thumbnails";

/** Accounts per page. */
export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Rows in the drawer's tabs before "showing the first N" applies. */
export const TAB_PAGE_SIZE = 25;

/**
 * Sortable columns, mirroring the CASE list in 0008 §2.
 *
 * A value outside this set is not an error — SQL falls through to the
 * created_at tiebreak — but it is normalised here anyway so the UI's active
 * state and the actual ordering cannot disagree.
 */
export const USER_SORTS = [
  "recent",
  "active",
  "balance",
  "spent",
  "revenue",
  "generations",
  "flags",
  "email",
] as const;

export type UserSort = (typeof USER_SORTS)[number];

export type AdminUserRow = {
  user_id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Last generation, not last sign-in. See 0008 §2. */
  last_active_at: string | null;
  banned_until: string | null;
  balance: number;
  pending: number;
  lifetime_paise: number;
  credits_purchased: number;
  credits_spent: number;
  projects: number;
  generations: number;
  generations_failed: number;
  /** Runs a moderator has flagged. Added in 0009, with the Content tab. */
  flags: number;
  total_count: number;
};

export type AdminUserListResult = {
  users: AdminUserRow[];
  total: number;
  search: string | null;
  sort: UserSort;
  limit: number;
  offset: number;
  /** True when the read failed. An empty list means neither more nor less. */
  failed: boolean;
};

export type AdminUserDetail = {
  user_id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  providers: string[];
  balance: number;
  pending: number;
  credits: {
    granted: number;
    purchased: number;
    refunded: number;
    adjusted: number;
    spent: number;
    lifetime_paise: number;
    purchases: number;
  };
  runs: {
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
    first_at: string | null;
    last_at: string | null;
  };
  projects: number;
  media: number;
};

export type AdminLedgerRow = {
  id: string;
  amount: number;
  kind: string;
  reason: string | null;
  ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  /** A spend that has already been refunded — the button is not offered twice. */
  refunded: boolean;
  total_count: number;
};

export type AdminProjectRow = {
  id: string;
  name: string | null;
  node_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminGenerationRow = {
  id: string;
  kind: string;
  provider: string | null;
  model_id: string | null;
  prompt: string | null;
  output_kind: string | null;
  output_text: string | null;
  credits_charged: number | null;
  duration_ms: number | null;
  status: string;
  error: string | null;
  created_at: string;
  /** Signed, short-lived, and null whenever the run produced no thumbnail. */
  thumb_url: string | null;
};

/** Is this account suspended right now? */
export function isSuspended(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const until = new Date(bannedUntil).getTime();
  // GoTrue writes a far-future date for an indefinite ban rather than null-ing
  // the column when it lapses, so the comparison — not the presence of a
  // value — is what says whether the ban is in force.
  return Number.isFinite(until) && until > Date.now();
}

/** Clamp a caller-supplied page size. Same reasoning as normalizeWindow(). */
export function normalizePageSize(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_PAGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

/** Clamp an offset. Negative offsets are a Postgres error, not a first page. */
export function normalizeOffset(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function normalizeSort(raw: unknown): UserSort {
  return USER_SORTS.includes(raw as UserSort) ? (raw as UserSort) : "recent";
}

/**
 * Trim a search term, and treat blank as absent.
 *
 * Length-capped because the term reaches SQL as a parameter to position() over
 * every account — a pasted megabyte would be compared against every row.
 */
export function normalizeSearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

/** One page of accounts. */
export async function listUsers(
  service: SupabaseClient,
  params: {
    search?: unknown;
    sort?: unknown;
    limit?: unknown;
    offset?: unknown;
  } = {}
): Promise<AdminUserListResult> {
  const search = normalizeSearch(params.search);
  const sort = normalizeSort(params.sort);
  const limit = normalizePageSize(params.limit);
  const offset = normalizeOffset(params.offset);

  const base = { users: [], total: 0, search, sort, limit, offset };

  try {
    const { data, error } = await service.rpc("admin_users_list", {
      p_search: search,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error("[admin] admin_users_list failed:", error.message);
      return { ...base, failed: true };
    }

    const users = (data ?? []) as AdminUserRow[];
    return {
      ...base,
      users,
      // total_count arrives per row from the window function, so an empty page
      // carries no count at all. Zero is the honest answer for an empty first
      // page; for a page past the end it is a page the UI should not have
      // asked for, and showing zero sends it back to the start.
      total: users[0]?.total_count ?? 0,
      failed: false,
    };
  } catch (err) {
    console.error(
      "[admin] admin_users_list threw:",
      err instanceof Error ? err.message : err
    );
    return { ...base, failed: true };
  }
}

/** One account. Null means no such account — the route answers 404. */
export async function getUserDetail(
  service: SupabaseClient,
  userId: string
): Promise<AdminUserDetail | null> {
  const { data, error } = await service.rpc("admin_user_detail", {
    p_user_id: userId,
  });

  if (error) {
    console.error("[admin] admin_user_detail failed:", error.message);
    throw new Error(error.message);
  }
  return (data as AdminUserDetail | null) ?? null;
}

/** The Ledger tab. */
export async function getUserLedger(
  service: SupabaseClient,
  userId: string,
  limit = TAB_PAGE_SIZE,
  offset = 0
): Promise<{ rows: AdminLedgerRow[]; total: number }> {
  const { data, error } = await service.rpc("admin_user_ledger", {
    p_user_id: userId,
    p_limit: normalizePageSize(limit),
    p_offset: normalizeOffset(offset),
  });

  if (error) {
    console.error("[admin] admin_user_ledger failed:", error.message);
    throw new Error(error.message);
  }

  const rows = (data ?? []) as AdminLedgerRow[];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/**
 * The Projects tab.
 *
 * workflow_json is deliberately not selected. It holds every generated image
 * as base64 (see 0006's header note) — selecting it would move megabytes per
 * project to render a row that shows a name and a node count.
 */
export async function getUserProjects(
  service: SupabaseClient,
  userId: string,
  limit = TAB_PAGE_SIZE
): Promise<AdminProjectRow[]> {
  const { data, error } = await service
    .from("projects")
    .select("id, name, node_count, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(normalizePageSize(limit));

  if (error) {
    console.error("[admin] user projects failed:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as AdminProjectRow[];
}

/** The Generations tab, with signed thumbnails attached. */
export async function getUserGenerations(
  service: SupabaseClient,
  userId: string,
  limit = TAB_PAGE_SIZE
): Promise<AdminGenerationRow[]> {
  const { data, error } = await service
    .from("generation_events")
    .select(
      "id, kind, provider, model_id, prompt, output_kind, output_text, credits_charged, duration_ms, status, error, created_at, thumb_path"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(normalizePageSize(limit));

  if (error) {
    console.error("[admin] user generations failed:", error.message);
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<
    Omit<AdminGenerationRow, "thumb_url"> & { thumb_path: string | null }
  >;

  const signed = await signThumbnails(
    service,
    rows.map((row) => row.thumb_path).filter((path): path is string => !!path)
  );

  return rows.map(({ thumb_path, ...row }) => ({
    ...row,
    thumb_url: thumb_path ? signed.get(thumb_path) ?? null : null,
  }));
}

export type AdminActionName =
  | "grant_credits"
  | "refund"
  | "suspend"
  | "unsuspend"
  | "delete_user"
  // Content actions, added with the moderation feed in Phase 4.
  | "flag_content"
  | "clear_content"
  | "remove_content";

/**
 * Record an admin action.
 *
 * Never throws, on the 0006 principle: by the time this runs the action has
 * already happened, and a failed log entry must not be reported to the admin
 * as a failed suspension. The write is awaited rather than deferred — these
 * are rare, deliberate operations, and losing the record of one to a cold
 * lambda is worse than the few milliseconds it costs.
 */
export async function logAdminAction(
  service: SupabaseClient,
  entry: {
    actorId: string;
    actorEmail?: string | null;
    action: AdminActionName;
    targetUserId?: string | null;
    targetEmail?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await service.from("admin_actions").insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      target_email: entry.targetEmail ?? null,
      details: entry.details ?? {},
    });
    if (error) {
      console.error("[admin] action log failed:", error.message, entry.action);
    }
  } catch (err) {
    console.error(
      "[admin] action log threw:",
      err instanceof Error ? err.message : err
    );
  }
}

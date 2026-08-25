/**
 * Reads the admin action log.
 *
 * `admin_actions` has been written since Phase 3 — every grant, refund,
 * suspension, deletion, flag and content removal — and until now nothing read
 * it. This is that reader.
 *
 * WHAT THE LOG IS FOR
 *
 * Not "what does the system look like now" — the Users and Content pages
 * answer that. This answers "who did that, when, and what did it say at the
 * time", which is a different question and the only one still answerable
 * after the account in question has been deleted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminActionName } from "./users";
import { normalizeOffset, normalizeSearch } from "./users";

export const DEFAULT_LOG_SIZE = 50;
const MAX_LOG_SIZE = 200;

/**
 * The actions written today, for the filter chips.
 *
 * The summary is keyed by whatever is actually in the table, so an action
 * added later still appears in the counts and can still be filtered — this
 * list only decides what gets a chip of its own and a readable label.
 */
export const AUDIT_ACTIONS: AdminActionName[] = [
  "grant_credits",
  "refund",
  "suspend",
  "unsuspend",
  "delete_user",
  "flag_content",
  "clear_content",
  "remove_content",
];

const ACTION_LABELS: Record<string, string> = {
  grant_credits: "Granted credits",
  refund: "Refunded",
  suspend: "Suspended",
  unsuspend: "Unsuspended",
  delete_user: "Deleted account",
  flag_content: "Flagged content",
  clear_content: "Cleared content",
  remove_content: "Removed image",
};

/** Readable name for an action, falling back to the stored value. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Which actions are destructive enough to mark.
 *
 * Marked with a word as well as a colour — the log is read when something has
 * gone wrong, which is the worst moment to depend on hue alone.
 */
export function isDestructive(action: string): boolean {
  return action === "delete_user" || action === "remove_content";
}

export type AuditRow = {
  id: string;
  actor_id: string;
  actor_email: string | null;
  action: string;
  target_user_id: string | null;
  target_email: string | null;
  /** Whether the account is still there to open. False once deleted. */
  target_exists: boolean;
  details: Record<string, unknown>;
  created_at: string;
  total_count: number;
};

export type AuditSummary = {
  total: number;
  by_action: Record<string, number>;
  first_at: string | null;
  last_at: string | null;
};

export type AuditLogResult = {
  rows: AuditRow[];
  total: number;
  summary: AuditSummary | null;
  action: string | null;
  target: string | null;
  search: string | null;
  limit: number;
  offset: number;
  /** The read failed. An empty log means neither more nor less. */
  failed: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeLogSize(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_LOG_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LOG_SIZE;
  return Math.min(MAX_LOG_SIZE, Math.max(1, Math.floor(parsed)));
}

/**
 * An action filter.
 *
 * Length-capped and blank-checked rather than whitelisted against
 * AUDIT_ACTIONS: the column is free text, and a chip for an action this build
 * does not know about should still filter to it rather than silently showing
 * everything.
 */
export function normalizeAction(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 40);
}

export function normalizeTarget(raw: unknown): string | null {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw : null;
}

/** One page of the log, with the per-action counts beside it. */
export async function getAuditLog(
  service: SupabaseClient,
  params: {
    action?: unknown;
    target?: unknown;
    search?: unknown;
    limit?: unknown;
    offset?: unknown;
  } = {}
): Promise<AuditLogResult> {
  const action = normalizeAction(params.action);
  const target = normalizeTarget(params.target);
  const search = normalizeSearch(params.search);
  const limit = normalizeLogSize(params.limit);
  const offset = normalizeOffset(params.offset);

  const base = {
    rows: [],
    total: 0,
    summary: null,
    action,
    target,
    search,
    limit,
    offset,
  };

  try {
    const [log, summary] = await Promise.all([
      service.rpc("admin_actions_list", {
        p_action: action,
        p_target: target,
        p_search: search,
        p_limit: limit,
        p_offset: offset,
      }),
      service.rpc("admin_actions_summary"),
    ]);

    if (log.error) {
      console.error("[admin] admin_actions_list failed:", log.error.message);
      return { ...base, failed: true };
    }

    const rows = (log.data ?? []) as AuditRow[];

    return {
      ...base,
      rows,
      total: rows[0]?.total_count ?? 0,
      // Null rather than zeroed when the counts fail, for the moderation
      // feed's reason: a zero beside "Deleted account" is a claim that no
      // account has ever been deleted.
      summary: summary.error ? null : ((summary.data as AuditSummary) ?? null),
      failed: false,
    };
  } catch (err) {
    console.error(
      "[admin] audit log threw:",
      err instanceof Error ? err.message : err
    );
    return { ...base, failed: true };
  }
}

/**
 * Turn one details key into something readable.
 *
 * Deliberately not a fixed schema per action: details is jsonb precisely so a
 * new action can record what it needs without a migration, and a renderer
 * that only knows today's keys would silently drop tomorrow's. Known keys get
 * a label and a format; everything else is shown as it was stored.
 */
export function describeDetail(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";

  switch (key) {
    case "amount":
      return `${value} credits`;
    case "lifetime_paise":
      return `₹${(Number(value) / 100).toLocaleString("en-IN")} paid`;
    case "balance":
      return `${value} credits at deletion`;
    case "credits_spent":
      return `${value} credits spent`;
    case "generations":
      return `${value} generations`;
    case "projects":
      return `${value} projects`;
    case "thumbnails_removed":
      return `${value} thumbnails removed`;
    case "reason":
      return `“${value}”`;
    case "state":
      return `set to ${value}`;
    case "event_id":
      return `generation ${String(value).slice(0, 8)}`;
    case "transaction_id":
      return `transaction ${String(value).slice(0, 8)}`;
    // Idempotency handles and signup dates are recorded to make a row
    // reconstructable, not to be read in a list.
    case "request_id":
    case "signed_up_at":
      return "";
    default:
      return `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
  }
}

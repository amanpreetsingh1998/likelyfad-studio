/**
 * The moderation feed behind /admin/content.
 *
 * Reads `generation_events` through the SQL in 0009 and turns each row into
 * something a moderator can act on: a signed thumbnail, the prompt, whose
 * account it is, and how many flags that account already carries.
 *
 * WHAT THIS SURFACE CAN AND CANNOT SEE
 *
 * The log holds only runs made since 0006 shipped — it cannot be backfilled,
 * because outputs used to live as base64 inside a project file that was
 * overwritten on every autosave, and prompts were stored nowhere. And video,
 * audio and 3D runs carry no thumbnail at all: a representative frame needs a
 * decoder that does not run server-side here, so those are moderated on their
 * prompt alone. Both gaps are stated in the UI rather than papered over.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { signThumbnails, signMedia, MODERATION_BUCKET } from "./thumbnails";
import { normalizeOffset, normalizeSearch } from "./users";

/** Rows per page of the feed. Cards, not table rows — they are big. */
export const DEFAULT_FEED_SIZE = 40;
const MAX_FEED_SIZE = 100;

/**
 * The review states, mirroring the check constraint in 0009 §1.
 *
 * `cleared` is a decision, not the absence of one. Collapsing it into
 * `unreviewed` would put every already-judged picture back in the queue.
 */
export const MODERATION_STATES = ["unreviewed", "flagged", "cleared"] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export type ModerationRow = {
  id: string;
  user_id: string;
  email: string | null;
  kind: string;
  provider: string | null;
  model_id: string | null;
  prompt: string | null;
  output_kind: string | null;
  output_text: string | null;
  status: string;
  credits_charged: number | null;
  duration_ms: number | null;
  created_at: string;
  moderation_state: ModerationState;
  moderated_at: string | null;
  moderation_reason: string | null;
  content_removed_at: string | null;
  /** How many flagged runs this account has, including this one. */
  user_flags: number;
  total_count: number;
  /** Signed and short-lived. Null when there never was one, or it was removed. */
  thumb_url: string | null;
  /**
   * The output at full resolution, signed and short-lived.
   *
   * What a suspension decision actually rests on: a thumbnail settles whether
   * a run is worth a second look, not what it depicts. Null when the run
   * produced nothing storable, when the provider link had expired by the time
   * we fetched it, when it was over the size ceiling, or when the content has
   * been removed.
   */
  media_url: string | null;
  /** MIME type, so the viewer picks img / video / audio rather than guessing. */
  media_type: string | null;
  /** So a moderator knows what they are about to load before they load it. */
  media_bytes: number | null;
  /**
   * The provider's own link to the output.
   *
   * A FALLBACK, not evidence. It points at infrastructure we do not control
   * and it expires; the stored copy is the archive. Present with no media_url
   * means the copy was attempted and failed — which is the case a moderator
   * most needs told apart from "this run produced nothing".
   */
  media_source_url: string | null;
};

export type ModerationCounts = {
  total: number;
  unreviewed: number;
  flagged: number;
  cleared: number;
  removed: number;
  flagged_users: number;
};

export type ModerationFeed = {
  rows: ModerationRow[];
  total: number;
  counts: ModerationCounts | null;
  state: ModerationState | null;
  kind: string | null;
  userId: string | null;
  search: string | null;
  limit: number;
  offset: number;
  /** The read failed. An empty feed means neither more nor less. */
  failed: boolean;
};

export const EMPTY_COUNTS: ModerationCounts = {
  total: 0,
  unreviewed: 0,
  flagged: 0,
  cleared: 0,
  removed: 0,
  flagged_users: 0,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeFeedSize(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_FEED_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_FEED_SIZE;
  return Math.min(MAX_FEED_SIZE, Math.max(1, Math.floor(parsed)));
}

/** Null means "every state" — which is a filter the UI offers, not an error. */
export function normalizeState(raw: unknown): ModerationState | null {
  return MODERATION_STATES.includes(raw as ModerationState)
    ? (raw as ModerationState)
    : null;
}

/**
 * A run kind reaches SQL as an equality filter, so it needs no escaping — but
 * it is still capped and blank-checked, so an empty select box does not filter
 * the feed down to rows whose kind is the empty string.
 */
export function normalizeKind(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 40);
}

export function normalizeUserId(raw: unknown): string | null {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw : null;
}

/** One page of the feed, with thumbnails signed and counts attached. */
export async function getModerationFeed(
  service: SupabaseClient,
  params: {
    search?: unknown;
    state?: unknown;
    kind?: unknown;
    userId?: unknown;
    limit?: unknown;
    offset?: unknown;
  } = {}
): Promise<ModerationFeed> {
  const search = normalizeSearch(params.search);
  const state = normalizeState(params.state);
  const kind = normalizeKind(params.kind);
  const userId = normalizeUserId(params.userId);
  const limit = normalizeFeedSize(params.limit);
  const offset = normalizeOffset(params.offset);

  const base = {
    rows: [],
    total: 0,
    counts: null,
    state,
    kind,
    userId,
    search,
    limit,
    offset,
  };

  try {
    // The counts are read alongside rather than after: they label the filter
    // tabs above the feed, and a tab count that arrives a beat late is a
    // number that visibly changes under the cursor.
    const [feed, counts] = await Promise.all([
      service.rpc("admin_moderation_feed", {
        p_search: search,
        p_state: state,
        p_kind: kind,
        p_user: userId,
        p_limit: limit,
        p_offset: offset,
      }),
      service.rpc("admin_moderation_counts"),
    ]);

    if (feed.error) {
      console.error("[admin] admin_moderation_feed failed:", feed.error.message);
      return { ...base, failed: true };
    }

    const rows = (feed.data ?? []) as Array<
      Omit<ModerationRow, "thumb_url" | "media_url"> & {
        thumb_path: string | null;
        media_path: string | null;
        media_source_url: string | null;
      }
    >;

    // Two batches rather than one: the TTLs differ, and a moderator watching a
    // video needs longer than a grid of thumbnails does.
    const [signedThumbs, signedMedia] = await Promise.all([
      signThumbnails(
        service,
        rows.map((row) => row.thumb_path).filter((p): p is string => !!p)
      ),
      signMedia(
        service,
        rows.map((row) => row.media_path).filter((p): p is string => !!p)
      ),
    ]);

    return {
      ...base,
      rows: rows.map(({ thumb_path, media_path, ...row }) => ({
        ...row,
        thumb_url: thumb_path ? signedThumbs.get(thumb_path) ?? null : null,
        media_url: media_path ? signedMedia.get(media_path) ?? null : null,
      })),
      total: rows[0]?.total_count ?? 0,
      // A failed count costs the tab labels, not the feed — so it is null
      // rather than zeroed, and the UI shows no number instead of a wrong one.
      counts: counts.error ? null : ((counts.data as ModerationCounts) ?? null),
      failed: false,
    };
  } catch (err) {
    console.error(
      "[admin] moderation feed threw:",
      err instanceof Error ? err.message : err
    );
    return { ...base, failed: true };
  }
}

/**
 * Set a row's review state.
 *
 * Returns the row as it now stands, so the caller can log what actually
 * changed rather than what it asked for.
 */
export async function setModerationState(
  service: SupabaseClient,
  eventId: string,
  state: ModerationState,
  actorId: string,
  reason: string | null
): Promise<{ id: string; user_id: string; moderation_state: string } | null> {
  const { data, error } = await service
    .from("generation_events")
    .update({
      moderation_state: state,
      moderated_at: new Date().toISOString(),
      moderated_by: actorId,
      // Cleared rows keep no reason: the reason a thing was flagged does not
      // describe the decision that it was fine, and leaving the old text in
      // place makes a cleared row read as still flagged.
      moderation_reason: state === "flagged" ? reason : null,
    })
    .eq("id", eventId)
    .select("id, user_id, moderation_state")
    .maybeSingle();

  if (error) {
    console.error("[admin] moderation update failed:", error.message);
    throw new Error(error.message);
  }
  return data ?? null;
}

/**
 * Delete a run's media, keeping the row.
 *
 * BOTH objects go — the thumbnail and the full-resolution copy. Removing only
 * the thumbnail would take the picture out of the feed while leaving the
 * larger, more damaging copy sitting in the bucket, reachable by anyone who
 * could still sign its key. "Removed" has to mean removed.
 *
 * The pictures are what has to go; the prompt, the model and the account are
 * the record of what happened and stay. Both paths are cleared in the same
 * write, so nothing tries to sign a key that no longer resolves.
 *
 * Storage first, then the row: a failed delete that had already marked the
 * row removed would leave the picture live and invisible to the feed — the
 * one ordering that hides evidence instead of merely leaving litter.
 */
export async function removeContent(
  service: SupabaseClient,
  eventId: string
): Promise<{ id: string; user_id: string; removed: boolean } | null> {
  const { data: row, error: readError } = await service
    .from("generation_events")
    .select("id, user_id, thumb_path, media_path, content_removed_at")
    .eq("id", eventId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!row) return null;

  const keys = [row.thumb_path, row.media_path].filter(
    (key): key is string => typeof key === "string" && key.length > 0
  );

  if (keys.length > 0) {
    const { error } = await service.storage
      .from(MODERATION_BUCKET)
      .remove(keys);
    if (error) {
      console.error("[admin] media delete failed:", error.message);
      throw new Error(error.message);
    }
  }

  const { error: updateError } = await service
    .from("generation_events")
    .update({
      thumb_path: null,
      media_path: null,
      media_type: null,
      media_bytes: null,
      content_removed_at: row.content_removed_at ?? new Date().toISOString(),
    })
    .eq("id", eventId);

  if (updateError) throw new Error(updateError.message);

  return { id: row.id as string, user_id: row.user_id as string, removed: true };
}

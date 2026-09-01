/**
 * Signing moderation thumbnails for the admin surface.
 *
 * The `moderation` bucket is private and carries no storage policies at all
 * (0006 §4) — deliberately, so the subject of a record cannot delete the
 * evidence. That makes a signed URL minted here, after requireAdmin(), the
 * only way a browser can render one.
 *
 * Short TTL: these are links to evidence, and one pasted into a chat window
 * should stop working quickly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const MODERATION_BUCKET = "moderation";

const THUMB_TTL_SECONDS = 300;

/**
 * Longer than a thumbnail's, because a moderator opening a full video may
 * still be watching it five minutes later and a link that dies mid-playback is
 * a link that gets re-requested. Still short: this is evidence, and one pasted
 * into a chat window should stop working the same day.
 */
const MEDIA_TTL_SECONDS = 1800;

/**
 * Sign a batch of keys, returning path → URL.
 *
 * Never throws. A failure to sign costs the pictures, not the page — the
 * prompt, the model and the account are what a moderation row is mostly
 * there to show, and they are already in hand by the time this runs.
 */
export async function signThumbnails(
  service: SupabaseClient,
  paths: string[]
): Promise<Map<string, string>> {
  return signKeys(service, paths, THUMB_TTL_SECONDS);
}

/**
 * The same, for full-resolution outputs.
 *
 * Separate from signThumbnails only for the TTL — the bucket, the privacy and
 * the failure behaviour are identical.
 */
export async function signMedia(
  service: SupabaseClient,
  paths: string[]
): Promise<Map<string, string>> {
  return signKeys(service, paths, MEDIA_TTL_SECONDS);
}

async function signKeys(
  service: SupabaseClient,
  paths: string[],
  ttlSeconds: number
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();

  // De-duplicated: the same key twice makes the storage API answer with two
  // entries and one of them is wasted work.
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return signed;

  try {
    const { data, error } = await service.storage
      .from(MODERATION_BUCKET)
      .createSignedUrls(unique, ttlSeconds);

    if (error) {
      console.error("[admin] thumbnail signing failed:", error.message);
      return signed;
    }

    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
    }
  } catch (err) {
    console.error(
      "[admin] thumbnail signing threw:",
      err instanceof Error ? err.message : err
    );
  }

  return signed;
}

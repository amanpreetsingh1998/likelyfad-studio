/**
 * The generation log: what each user asked for, and what came back.
 *
 * Written from withCredits() and completed by /api/generate/poll. Feeds both
 * halves of the admin dashboard — the moderation feed reads prompts and
 * thumbnails, the stats read model, status, credits and duration.
 *
 * NOTHING HERE THROWS.
 *
 * Every function swallows its own failures and logs. By the time any of this
 * runs the user's generation has already succeeded and their credits are
 * already committed; a logging fault must not become their error. The cost of
 * that choice is that a broken log is silent, so the failures are logged
 * loudly enough to find.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { makeThumbnail } from "./thumbnail";
import { fetchMedia } from "./media";
import type { RunKind } from "@/lib/credits/pricing";

const TABLE = "generation_events";
const BUCKET = "moderation";

/**
 * Prompts are stored to be read by a human, not replayed. A pathological one
 * (a pasted document, a base64 blob someone typed into the box) would bloat
 * the table without telling a moderator anything the first 2000 characters
 * did not.
 */
const MAX_PROMPT_CHARS = 2000;

/** Same reasoning for LLM output, which has no length ceiling of its own. */
const MAX_OUTPUT_TEXT_CHARS = 2000;

export type GenerationOutcome = "succeeded" | "failed" | "pending";

export type RecordGenerationInput = {
  userId: string;
  kind: RunKind;
  provider?: string | null;
  modelId?: string | null;
  prompt?: string | null;
  creditsCharged?: number | null;
  durationMs?: number | null;
  status: GenerationOutcome;
  error?: string | null;
  /** Base64 data URL or provider URL. Only images produce a thumbnail. */
  output?: string | null;
  /** What the output field holds — image, video, audio, 3d, text. */
  outputKind?: string | null;
  /** LLM text output, stored truncated. */
  outputText?: string | null;
  /** Provider task id, for runs completed later by the poll route. */
  taskId?: string | null;
  /**
   * The workflow execution this run belongs to, when there is one.
   *
   * Verified against the caller in withCredits() before it reaches here, so
   * this is already known to be the user's own run. Null for anything that is
   * not a workflow execution — a single node fired from the canvas, the
   * quickstart proposer — and for every row written before this shipped.
   */
  runId?: string | null;
};

function clamp(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Write the thumbnail, returning its storage key.
 *
 * Keyed by event id alone. The user's id is deliberately NOT in the path:
 * these objects are not theirs, and a per-user prefix is exactly the shape
 * that invites a "users may touch their own prefix" policy to be added later
 * by analogy with project-media — which would hand the subject of a
 * moderation record the ability to delete it.
 */
async function storeThumbnail(
  eventId: string,
  output: string | null | undefined
): Promise<string | null> {
  const thumb = await makeThumbnail(output);
  if (!thumb) return null;

  const path = `${eventId}.webp`;
  const { error } = await getServiceClient()
    .storage.from(BUCKET)
    .upload(path, thumb.body, { contentType: thumb.contentType, upsert: true });

  if (error) {
    console.warn("[moderation] thumbnail upload failed:", error.message);
    return null;
  }
  return path;
}

/**
 * Keep the output itself, returning what was stored.
 *
 * Keyed `<eventId>-full.<ext>`, beside the thumbnail and under the same rules:
 * no user prefix, in a bucket with no storage policies, so the subject of the
 * record cannot delete the evidence.
 *
 * Null when there was nothing to keep, when the provider link had already
 * expired, or when the object was over the ceiling. All three are ordinary,
 * and none of them is worth failing a generation over.
 */
async function storeMedia(
  eventId: string,
  output: string | null | undefined,
  declaredType?: string | null
): Promise<{ path: string; type: string; bytes: number } | null> {
  const media = await fetchMedia(output, declaredType);
  if (!media) return null;

  const path = `${eventId}-full.${media.extension}`;
  const { error } = await getServiceClient()
    .storage.from(BUCKET)
    .upload(path, media.body, {
      contentType: media.contentType,
      upsert: true,
    });

  if (error) {
    console.warn("[moderation] media upload failed:", error.message);
    return null;
  }

  return { path, type: media.contentType, bytes: media.body.length };
}

/**
 * Log one run. Returns the event id, or null if nothing was written.
 *
 * The row lands first and the thumbnail follows in a second write, rather than
 * building the image and inserting once. A thumbnail that fails to encode or
 * upload then costs only the picture — the prompt, model and user still get
 * recorded, and those are what moderation actually turns on.
 */
export async function recordGenerationEvent(
  input: RecordGenerationInput
): Promise<string | null> {
  try {
    const { data, error } = await getServiceClient()
      .from(TABLE)
      .insert({
        user_id: input.userId,
        kind: input.kind,
        provider: input.provider ?? null,
        model_id: input.modelId ?? null,
        prompt: clamp(input.prompt, MAX_PROMPT_CHARS),
        output_kind: input.outputKind ?? null,
        output_text: clamp(input.outputText, MAX_OUTPUT_TEXT_CHARS),
        credits_charged: input.creditsCharged ?? null,
        duration_ms: input.durationMs ?? null,
        status: input.status,
        error: clamp(input.error, 500),
        task_id: input.taskId ?? null,
        run_id: input.runId ?? null,
        completed_at: input.status === "pending" ? null : new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      console.error(
        "[moderation] FAILED TO LOG GENERATION — unmoderated run:",
        error?.message ?? "no id returned",
        { userId: input.userId, modelId: input.modelId }
      );
      return null;
    }

    const eventId = data.id as string;

    // Both in parallel: they read the same provider URL and neither depends on
    // the other, so serialising them would double the wait for no benefit.
    // The row already exists, so either failing costs only what it stored.
    const [thumbPath, media] = await Promise.all([
      storeThumbnail(eventId, input.output),
      storeMedia(eventId, input.output, input.outputKind),
    ]);

    const updates: Record<string, unknown> = {};
    if (thumbPath) updates.thumb_path = thumbPath;
    if (media) {
      updates.media_path = media.path;
      updates.media_type = media.type;
      updates.media_bytes = media.bytes;
    }

    if (Object.keys(updates).length > 0) {
      await getServiceClient().from(TABLE).update(updates).eq("id", eventId);
    }

    return eventId;
  } catch (err) {
    console.error(
      "[moderation] FAILED TO LOG GENERATION — unmoderated run:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Fill in a run that was dispatched asynchronously and has now finished.
 *
 * Matched on (userId, taskId) together — never taskId alone. Task ids come
 * from the provider and are guessable enough that matching on one by itself
 * would let a user attach their own output to someone else's event, or read a
 * completion that is not theirs. The unique index in 0006 is on the pair for
 * the same reason.
 *
 * A miss is normal, not an error: it means the dispatch row was never written
 * (the log was down at the time), and there is nothing to complete.
 */
export async function completeGenerationEvent(params: {
  userId: string;
  taskId: string;
  status: Exclude<GenerationOutcome, "pending">;
  output?: string | null;
  outputKind?: string | null;
  error?: string | null;
}): Promise<void> {
  try {
    const { data, error } = await getServiceClient()
      .from(TABLE)
      .select("id")
      .eq("user_id", params.userId)
      .eq("task_id", params.taskId)
      .eq("status", "pending")
      .maybeSingle();

    if (error) {
      console.warn("[moderation] completion lookup failed:", error.message);
      return;
    }
    if (!data?.id) return;

    const eventId = data.id as string;

    // The asynchronous path is where video most often lands — Kie's long
    // running tasks answer here rather than inline — so it needs the full
    // media just as much as the direct path does.
    const [thumbPath, media] = await Promise.all([
      storeThumbnail(eventId, params.output),
      storeMedia(eventId, params.output, params.outputKind),
    ]);

    await getServiceClient()
      .from(TABLE)
      .update({
        status: params.status,
        output_kind: params.outputKind ?? null,
        error: clamp(params.error, 500),
        thumb_path: thumbPath,
        media_path: media?.path ?? null,
        media_type: media?.type ?? null,
        media_bytes: media?.bytes ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", eventId);
  } catch (err) {
    console.error(
      "[moderation] completion failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * The prompt a request was actually generated from.
 *
 * /api/generate accepts it two ways — a top-level `prompt`, or `prompt` inside
 * `dynamicInputs` for schema-driven models, where it may be an array. The
 * moderation log wants whichever one the provider saw, so all three shapes are
 * flattened here rather than at the call site.
 */
export function promptFromBody(body: Record<string, unknown>): string | null {
  const direct = body.prompt;
  if (typeof direct === "string" && direct.trim()) return direct;

  const dynamic = body.dynamicInputs as Record<string, unknown> | undefined;
  const nested = dynamic?.prompt;
  if (typeof nested === "string" && nested.trim()) return nested;
  if (Array.isArray(nested)) {
    const joined = nested.filter((p) => typeof p === "string").join(" ").trim();
    if (joined) return joined;
  }

  return null;
}

/**
 * The generated output and what type it is, from a /api/generate response.
 *
 * Only one of these fields is ever populated, but which one depends on the
 * model, so the payload is probed in the order the response type declares
 * them. Base64 and URL forms are treated alike — makeThumbnail() handles both.
 */
export function outputFromPayload(
  payload: Record<string, unknown> | null
): { output: string | null; outputKind: string | null } {
  if (!payload) return { output: null, outputKind: null };

  const candidates: Array<[string, string]> = [
    ["image", "image"],
    ["video", "video"],
    ["videoUrl", "video"],
    ["audio", "audio"],
    ["audioUrl", "audio"],
    ["model3dUrl", "3d"],
  ];

  for (const [field, kind] of candidates) {
    const value = payload[field];
    if (typeof value === "string" && value) return { output: value, outputKind: kind };
  }

  return { output: null, outputKind: null };
}

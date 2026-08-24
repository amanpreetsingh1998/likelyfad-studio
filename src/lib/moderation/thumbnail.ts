/**
 * Output → a small image an admin can triage at a glance.
 *
 * 256px webp, because NSFW triage is a shape-and-skin-tone judgement that
 * survives aggressive downscaling, and because the alternative — keeping
 * full-resolution copies of everything every user generates — is a storage
 * bill that grows linearly with usage and a much larger thing to hold on
 * someone else's behalf.
 *
 * Everything here returns null rather than throwing. A thumbnail is evidence,
 * not part of the product: failing to make one must never turn a successful
 * generation into an error for the user.
 */

import sharp from "sharp";

/** Longest edge, in pixels. */
const THUMB_SIZE = 256;

/** Refuse to decode anything larger than this, in bytes. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/** How long to wait on a remote output before giving up. */
const FETCH_TIMEOUT_MS = 10_000;

export type ThumbnailResult = {
  body: Buffer;
  contentType: "image/webp";
};

/**
 * Pull the bytes out of whatever the provider handed back.
 *
 * Providers are inconsistent: Gemini returns a base64 data URL inline, fal and
 * Kie return a CDN link. Both shapes arrive in the same response field, so the
 * distinction is made here rather than at every call site.
 */
async function sourceBytes(output: string): Promise<Buffer | null> {
  if (output.startsWith("data:")) {
    const match = output.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    if (!match[1].startsWith("image/")) return null;

    const buffer = Buffer.from(match[2], "base64");
    return buffer.length > MAX_SOURCE_BYTES ? null : buffer;
  }

  if (!output.startsWith("http://") && !output.startsWith("https://")) {
    return null;
  }

  // A provider URL, so a bounded fetch: this runs after the user already has
  // their response, but an unbounded one would still pin a serverless
  // invocation open until the platform killed it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(output, { signal: controller.signal });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > MAX_SOURCE_BYTES ? null : buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 256px webp of an image output, or null when there is nothing to make one
 * from.
 *
 * Null is the normal answer for video, audio and 3D: a representative frame
 * needs a decoder this project does not run server-side, so those runs are
 * moderated on their prompt alone. That is a real gap in visual coverage and
 * is recorded as such rather than papered over with a placeholder image.
 */
export async function makeThumbnail(
  output: string | null | undefined
): Promise<ThumbnailResult | null> {
  if (!output) return null;

  try {
    const source = await sourceBytes(output);
    if (!source) return null;

    const body = await sharp(source, { failOn: "none" })
      // `inside` preserves aspect ratio; withoutEnlargement keeps a 64px
      // output from being upscaled into a blurry 256px one.
      .resize(THUMB_SIZE, THUMB_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      // Animated sources collapse to their first frame — a still is all the
      // triage needs, and encoding every frame would defeat the size cap.
      .webp({ quality: 70 })
      .toBuffer();

    return { body, contentType: "image/webp" };
  } catch (err) {
    console.warn(
      "[moderation] thumbnail failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

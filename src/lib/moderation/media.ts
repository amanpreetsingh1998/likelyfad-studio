/**
 * Keeping the output itself, so a moderator can look at what was actually made.
 *
 * The thumbnail beside this answers "is this worth a second look". This
 * answers the second look: text in an image is readable, a face is
 * identifiable, and video and audio have a record at all — before this they
 * had none, and were judged on their prompt alone.
 *
 * NOTHING HERE THROWS. Same contract as the thumbnailer, and for the same
 * reason: by the time this runs the user's generation has succeeded and their
 * credits are committed. Failing to keep evidence must not become their error.
 * Every path returns null and logs.
 *
 * THE SIZE CEILING IS THE WHOLE COST CONTROL.
 *
 * 0006 declined to store full media because the bill grows linearly with
 * usage. That objection is answered by bounding it, not by ignoring it: one
 * run cannot cost more than MAX_MEDIA_BYTES, and retention deletes the object
 * with its row. An output over the ceiling is skipped and the thumbnail still
 * stands — a partial record, not a broken one.
 */

/**
 * Refuse to store anything larger than this.
 *
 * Generous enough for a 4K image or a short clip, small enough that a runaway
 * video cannot quietly become the storage bill. A skipped object is visible in
 * the admin UI as "too large to keep" rather than as an absence, so the
 * moderator knows the difference between "no media" and "media we declined".
 */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/** Bounded, because this runs after the user already has their response. */
const FETCH_TIMEOUT_MS = 20_000;

export type FetchedMedia = {
  body: Buffer;
  contentType: string;
  extension: string;
};

/**
 * What the moderation bucket should call this object.
 *
 * Extension from the MIME type rather than from the URL: provider CDN links
 * frequently carry no extension, or the wrong one, and the stored key is what
 * a human will be looking at in the bucket listing.
 */
export function extensionFor(contentType: string): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  switch (type) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "model/gltf-binary":
      return "glb";
    default:
      // Kept rather than refused: an unknown type is still evidence, and the
      // stored media_type tells the viewer what it really is.
      return "bin";
  }
}

/**
 * Pull the bytes out of whatever the provider handed back.
 *
 * Providers are inconsistent in the same field: Gemini returns a base64 data
 * URL inline, fal and Kie return a CDN link. Unlike the thumbnailer, this
 * accepts every media type rather than images only — video and audio are
 * exactly the runs that had no visual record before.
 */
export async function fetchMedia(
  output: string | null | undefined,
  declaredType?: string | null
): Promise<FetchedMedia | null> {
  if (typeof output !== "string" || !output) return null;

  try {
    if (output.startsWith("data:")) {
      const match = output.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;

      const body = Buffer.from(match[2], "base64");
      if (body.length === 0 || body.length > MAX_MEDIA_BYTES) return null;

      const contentType = match[1];
      return { body, contentType, extension: extensionFor(contentType) };
    }

    if (!output.startsWith("http://") && !output.startsWith("https://")) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(output, { signal: controller.signal });
      if (!response.ok) return null;

      // Checked before downloading where the provider declares it, so a huge
      // object is refused rather than pulled and then discarded.
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
        return null;
      }

      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0 || body.length > MAX_MEDIA_BYTES) return null;

      const contentType =
        response.headers.get("content-type")?.split(";")[0].trim() ||
        declaredType ||
        "application/octet-stream";

      return { body, contentType, extension: extensionFor(contentType) };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // AbortError on the timeout, or a provider link that has already expired.
    console.warn(
      "[moderation] could not fetch output media:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

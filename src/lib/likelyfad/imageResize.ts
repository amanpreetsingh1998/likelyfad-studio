// === LIKELYFAD CUSTOM === (client-side image resize for template thumbnails)

/**
 * Read a File, downscale the longest edge to `maxDim` pixels, and return a
 * base64 JPEG data URL suitable for inline storage in a Supabase text column.
 *
 * At maxDim=400 and quality=0.82, typical screenshots end up 30–80 KB —
 * cheap enough to store directly in the templates row without a Storage round-trip.
 */
export async function fileToResizedDataUrl(
  file: File,
  maxDim: number,
  quality: number = 0.82
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image");
  }

  // 1. File → data URL (so the browser can decode it)
  const srcDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

  // 2. Decode into an HTMLImageElement to get dimensions
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to decode image"));
    i.src = srcDataUrl;
  });

  // 3. Scale longest edge to maxDim (never upscale)
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  // 4. Canvas re-encode as JPEG
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

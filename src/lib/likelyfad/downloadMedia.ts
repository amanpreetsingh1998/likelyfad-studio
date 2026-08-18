// === LIKELYFAD CUSTOM === (shared media download helper for node download buttons)

/**
 * Downloads a media URL as a file. Handles:
 *  - data: URLs (base64) — direct download via anchor
 *  - http(s): URLs — fetched as blob first (avoids CORS-download issues and
 *    ensures a real save dialog instead of navigating)
 *
 * Never throws — logs and returns on failure so UI doesn't crash.
 */
export async function downloadMedia(
  url: string | null | undefined,
  filename: string
): Promise<void> {
  if (!url) {
    console.warn("[downloadMedia] no url provided");
    return;
  }

  try {
    // data: URLs can be downloaded directly without a fetch.
    if (url.startsWith("data:")) {
      triggerAnchor(url, filename);
      return;
    }

    // Remote URLs → fetch as blob, then trigger download.
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[downloadMedia] fetch failed: ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    triggerAnchor(blobUrl, filename);
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.error("[downloadMedia] failed:", err);
  }
}

function triggerAnchor(href: string, filename: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Build a filename like "project_imageGen_2026-04-09_14-32.png"
 */
export function buildMediaFilename(
  kind: "image" | "video" | "audio",
  nodeType: string,
  ext?: string
): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const extension = ext || (kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png");
  return `${nodeType}_${date}_${time}.${extension}`;
}

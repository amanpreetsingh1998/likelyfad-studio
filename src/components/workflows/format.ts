/**
 * Formatting for the workflow history page.
 *
 * Self-contained rather than importing the admin dashboard's formatters. Two
 * of these would be near-duplicates of that module, which is a fair criticism
 * — but the durations here are workflow-length, not node-length, and that is
 * not a cosmetic difference: `formatDuration` there renders 78 000 ms as
 * "78.0s", which is the wrong unit for a figure a user reads as "how long does
 * this take to run".
 *
 * The rule these all follow: **an absent value renders as an em dash, never as
 * a zero.** A zero is a number a reader believes. "0 credits" says this
 * workflow is free; "—" says we do not have that figure, which is the truth
 * for anything that has never run.
 */

/** 1284 → "1,284". */
export function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(Math.round(value));
}

/**
 * Wall-clock duration, at the scale a workflow actually runs.
 *
 * 78 000 → "1m 18s"; 9 400 → "9s"; 5 400 000 → "1h 30m".
 *
 * Seconds are dropped past the hour mark: nobody comparing two runs of an
 * hour-and-a-half cares about the odd 12 seconds, and the extra component
 * makes the figure harder to read at a glance.
 */
export function formatRunDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}

/** "24 Aug 2026, 15:01". Absolute and local — the drawer wants precision. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "24 Aug". For the line under a headline figure, where the year is noise. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    // The year earns its place only once it is not the obvious one.
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/**
 * A model id trimmed to what distinguishes it.
 *
 * "fal-ai/flux-pro/v1.1-ultra" → "flux-pro/v1.1-ultra". The provider prefix is
 * the same on every chip from that provider, so it spends width without
 * telling the reader anything. The full id stays in the chip's title.
 */
export function shortModelName(modelId: string): string {
  const slash = modelId.indexOf("/");
  if (slash > 0 && slash < modelId.length - 1) return modelId.slice(slash + 1);
  return modelId;
}

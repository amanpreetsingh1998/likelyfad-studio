/**
 * Number formatting for the dashboard.
 *
 * Compact forms are for stat-tile values and axis ticks, where the exact digit
 * is not the point. Tables and tooltips use the full number — a reader who
 * opens either is asking for precision, and "12.9K" is a worse answer there.
 */

/** 1284 → "1,284". Full precision, thousands-separated. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(Math.round(value));
}

/** 12934 → "12.9K". For tiles and ticks only. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Paise → rupees.
 *
 * Razorpay works in paise and the ledger stores what it reported, so the
 * division happens here rather than in SQL — rounding money in an aggregate is
 * how a total stops matching the sum of its rows.
 */
export function formatRupees(paise: number, compact = false): string {
  const rupees = (paise ?? 0) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

/** 1832 → "1.8s"; 420 → "420ms". */
export function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 0.9231 → "92.3%". Returns an em dash when the denominator is zero. */
export function formatPercent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** "2026-08-24" → "24 Aug". Axis ticks and tooltip headers. */
export function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Axis ticks at round numbers.
 *
 * Steps come from the 1/2/5 ladder so ticks land on values a reader can hold
 * in their head. Returns the tick values including 0 and a max at or above the
 * data, which is what the y-scale is then built against — so the top gridline
 * is always a labelled round number rather than the data's ragged maximum.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;

  // Round the top UP to a whole step. Stopping at the last step below `max`
  // would leave the highest gridline beneath the data — and since the top tick
  // is what the y-scale is built against, the tallest bar would then be drawn
  // outside its own plot.
  const top = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    // Accumulating a float step drifts (0.1 + 0.2 = 0.30000000000000004);
    // without this the axis labels grow a tail of noise digits.
    ticks.push(Number(value.toFixed(10)));
  }
  if (ticks.length < 2) ticks.push(step);
  return ticks;
}

/** "2026-08-24T09:31:00Z" → "24 Aug 2026, 15:01". Absolute, local, minutes. */
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

/**
 * "3d ago", "just now", "—".
 *
 * For table cells where the question is "is this account warm or cold", not
 * "when exactly". The absolute time goes in the cell's title attribute at the
 * call site — a relative figure alone is unanswerable if what you need is to
 * line an event up against something else.
 */
export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["month", 2_592_000],
    ["year", 31_536_000],
  ];

  // Largest unit that still yields a whole number ≥ 1, so a fortnight reads
  // "2w"-ish rather than "336 hours".
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0];
  for (const unit of units) if (seconds >= unit[1]) chosen = unit;

  const formatter = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
  return formatter.format(-Math.floor(seconds / chosen[1]), chosen[0]);
}

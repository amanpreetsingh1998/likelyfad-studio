/**
 * The KPI row, and the one hero figure above it.
 *
 * These are the forms for a handful of headline numbers — not a grouped bar
 * chart of six unrelated scalars, and not a one-bar bar chart each. The number
 * is the chart.
 *
 * Proportional figures throughout, not tabular. Equal-width digits are for
 * columns that align vertically; at display sizes they make a value like
 * "121" look loose.
 */

import type { ReactNode } from "react";

export function HeroFigure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-xs text-neutral-500">{label}</p>
      {/* Same system sans as everything else — a display or serif face here
          reads as off-brand decoration. */}
      <p className="mt-1 text-5xl font-semibold leading-none text-neutral-50">
        {value}
      </p>
      {note && <p className="mt-2 text-xs text-neutral-500">{note}</p>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: ReactNode;
  /** `warn` marks a figure that wants attention — never color alone, the note says why. */
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold leading-none ${
          tone === "warn" ? "text-amber-300" : "text-neutral-100"
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-1.5 text-xs text-neutral-500">{note}</p>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {children}
    </div>
  );
}

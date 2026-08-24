"use client";

/**
 * A ranked horizontal bar list — the model leaderboard.
 *
 * Horizontal because the labels are long model ids ("fal-ai/flux/dev"), which
 * as column labels would either rotate or truncate.
 *
 * ONE COLOR FOR EVERY BAR.
 *
 * Not a ramp shaded darker-where-bigger. These categories have no natural
 * order, so a value-ramp would double-encode bar length as hue — spending the
 * only free channel restating what the length already says, and failing the
 * categorical checks by design.
 */

import { MARK, SERIES_VAR } from "./theme";

export type BarItem = {
  label: string;
  value: number;
  /** Shown right of the label, e.g. a success rate. Never color-only. */
  meta?: string;
  formatted: string;
};

export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ol className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-neutral-300" title={item.label}>
              {item.label}
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              {item.meta && (
                <span className="text-neutral-500">{item.meta}</span>
              )}
              {/* The value rides at the bar's tip rather than inside it —
                  a label placed inside a short bar gets clipped, and cropping
                  the first characters is worse than no label. */}
              <span className="tabular-nums font-medium text-neutral-200">
                {item.formatted}
              </span>
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
            role="presentation"
          >
            <div
              className="h-full"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: SERIES_VAR[0],
                borderRadius: `0 ${MARK.barRadius}px ${MARK.barRadius}px 0`,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

"use client";

/**
 * Columns over time — stacked for part-to-whole, grouped for side-by-side.
 *
 * Stacked answers "what was the mix"; grouped answers "how did these compare".
 * Both draw from one baseline on one axis.
 *
 * The two spacers do the separating, not strokes: a 2px surface gap between
 * every touching fill (stack segments and grouped neighbours alike), and a 4px
 * radius on the data end only — square where it meets the baseline, so the
 * bar's foot is not rounded off the axis.
 */

import { useState } from "react";
import { MARK, SERIES_VAR } from "./theme";
import { formatCompact, formatNumber, niceTicks } from "./format";
import { useChartWidth } from "./useChartWidth";
import { CHART_HEIGHT, CHART_PAD, Tooltip, XAxis } from "./LineChart";

export type ColumnSeries = {
  key: string;
  label: string;
  /**
   * Explicit slot colour. Pass it whenever the series list can change between
   * renders — position-derived colour repaints the survivors when one drops
   * out, and a reader who learned an entity's hue is then misled.
   */
  color?: string;
};
export type ColumnRow = Record<string, string | number> & { day: string };

/** Rounded at the top, square at the bottom. */
function topRoundedPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, h, w / 2));
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/** Explicit colour when given, otherwise the slot at this series' position. */
function seriesColor(series: ColumnSeries[], index: number): string {
  return series[index]?.color ?? SERIES_VAR[index % SERIES_VAR.length];
}

export function ColumnChart({
  data,
  series,
  mode = "stacked",
  format = formatNumber,
}: {
  data: ColumnRow[];
  series: ColumnSeries[];
  mode?: "stacked" | "grouped";
  format?: (value: number) => string;
}) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - CHART_PAD.left - CHART_PAD.right);
  const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;

  const totals = data.map((row) =>
    mode === "stacked"
      ? series.reduce((sum, s) => sum + Number(row[s.key] ?? 0), 0)
      : Math.max(...series.map((s) => Number(row[s.key] ?? 0)), 0)
  );

  const ticks = niceTicks(Math.max(...totals, 0));
  const max = ticks[ticks.length - 1] || 1;

  const band = data.length ? plotWidth / data.length : plotWidth;
  // Cap the thickness rather than filling the band — the leftover is air.
  const barWidth = Math.min(MARK.maxBarThickness, Math.max(2, band * 0.62));
  const bandCentre = (i: number) => CHART_PAD.left + band * i + band / 2;
  const scale = (value: number) => (value / max) * plotHeight;
  const baseline = CHART_PAD.top + plotHeight;

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`${series
            .map((s) => s.label)
            .join(", ")} over time. Use the table view for exact values.`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={CHART_PAD.left}
                x2={width - CHART_PAD.right}
                y1={baseline - scale(tick)}
                y2={baseline - scale(tick)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={CHART_PAD.left - 8}
                y={baseline - scale(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {formatCompact(tick)}
              </text>
            </g>
          ))}

          {data.map((row, i) => {
            if (mode === "grouped") {
              const slot = barWidth / series.length;
              return series.map((s, si) => {
                const value = Number(row[s.key] ?? 0);
                const h = scale(value);
                if (h <= 0) return null;
                // The gap comes out of each bar's width, so neighbours are
                // separated by surface rather than by a drawn edge.
                const w = Math.max(1, slot - MARK.gap);
                const x = bandCentre(i) - barWidth / 2 + si * slot;
                return (
                  <path
                    key={`${row.day}-${s.key}`}
                    d={topRoundedPath(x, baseline - h, w, h, MARK.barRadius)}
                    fill={seriesColor(series, si)}
                  />
                );
              });
            }

            let cursor = baseline;
            return series.map((s, si) => {
              const value = Number(row[s.key] ?? 0);
              const h = scale(value);
              if (h <= 0) return null;

              const isTop =
                si ===
                series.reduce(
                  (topIndex, candidate, ci) =>
                    Number(row[candidate.key] ?? 0) > 0 ? ci : topIndex,
                  -1
                );

              // Trim the gap off the bottom of every segment above the
              // baseline, so the surface shows through between fills.
              const gap = si === 0 ? 0 : MARK.gap;
              const height = Math.max(1, h - gap);
              const top = cursor - h;
              cursor -= h;

              return (
                <path
                  key={`${row.day}-${s.key}`}
                  d={
                    isTop
                      ? topRoundedPath(
                          bandCentre(i) - barWidth / 2,
                          top,
                          barWidth,
                          height,
                          MARK.barRadius
                        )
                      : `M${bandCentre(i) - barWidth / 2},${top}h${barWidth}v${height}h${-barWidth}Z`
                  }
                  fill={seriesColor(series, si)}
                />
              );
            });
          })}

          <line
            x1={CHART_PAD.left}
            x2={width - CHART_PAD.right}
            y1={baseline}
            y2={baseline}
            stroke="var(--axis)"
            strokeWidth={1}
          />

          <XAxis data={data} x={bandCentre} width={width} />

          {data.map((row, i) => (
            <rect
              key={row.day}
              x={CHART_PAD.left + band * i}
              y={CHART_PAD.top}
              width={band}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      )}

      {hover !== null && data[hover] && (
        <Tooltip
          day={data[hover].day}
          rows={series.map((s, si) => ({
            label: s.label,
            value: format(Number(data[hover][s.key] ?? 0)),
            color: seriesColor(series, si),
          }))}
        />
      )}
    </div>
  );
}

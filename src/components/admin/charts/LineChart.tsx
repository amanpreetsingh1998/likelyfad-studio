"use client";

/**
 * A single-series line over time.
 *
 * One series on one axis, always. Two measures of different scale — signups
 * and revenue, say — get two charts, never a second y-axis: the alignment
 * between two scales is arbitrary, so a dual axis invents a correlation that
 * is not in the data.
 *
 * No legend: with one series the title already says what is plotted, and a
 * box holding a single swatch just restates it.
 */

import { useState } from "react";
import { MARK, SERIES_VAR } from "./theme";
import { formatCompact, formatDay, formatNumber, niceTicks } from "./format";
import { useChartWidth } from "./useChartWidth";

const HEIGHT = 200;
// Bottom band holds the x labels. Sizing the box to exclude them is what gives
// a card its own little vertical scrollbar.
const PAD = { top: 8, right: 16, bottom: 26, left: 44 };

export type LinePoint = { day: string; value: number };

export function LineChart({
  data,
  valueLabel,
  format = formatNumber,
}: {
  data: LinePoint[];
  /** Names the measure in the tooltip — the chart has no legend to carry it. */
  valueLabel: string;
  format?: (value: number) => string;
}) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const max = ticks[ticks.length - 1] || 1;

  // Points sit at band centres so the first and last are not clipped by the
  // plot edge.
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const x = (i: number) => PAD.left + (data.length > 1 ? i * step : plotWidth / 2);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const last = data.length - 1;

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${valueLabel} over time. Use the table view for exact values.`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              {/* Solid hairlines. Dashing reads as "projection" when it is
                  just a grid. */}
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="tabular-nums"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {formatCompact(tick)}
              </text>
            </g>
          ))}

          <path
            d={path}
            fill="none"
            stroke={SERIES_VAR[0]}
            strokeWidth={MARK.lineWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* End dot with a surface ring, so it stays legible where it meets
              the axis or a gridline. */}
          {data.length > 0 && (
            <circle
              cx={x(last)}
              cy={y(data[last].value)}
              r={MARK.dotRadius}
              fill={SERIES_VAR[0]}
              stroke="var(--surface-1)"
              strokeWidth={MARK.gap}
            />
          )}

          {/* Selective direct label: the endpoint only. A value beside every
              point is chaos and goes unread. */}
          {data.length > 0 && (
            <text
              x={x(last)}
              y={y(data[last].value) - 10}
              textAnchor="end"
              fontSize={11}
              fontWeight={500}
              fill="var(--text-secondary)"
            >
              {format(data[last].value)}
            </text>
          )}

          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              stroke="var(--axis)"
              strokeWidth={1}
            />
          )}

          <XAxis data={data} x={x} width={width} />

          {/* Hit targets span the full band height, so hovering anywhere in a
              column works — landing on a 2px line does not. */}
          {data.map((_, i) => (
            <rect
              key={i}
              x={x(i) - (step || plotWidth) / 2}
              y={PAD.top}
              width={step || plotWidth}
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
          rows={[{ label: valueLabel, value: format(data[hover].value) }]}
        />
      )}
    </div>
  );
}

/**
 * X labels, thinned to whatever fits.
 *
 * A 90-day window has no room for 90 dates, and drawing them anyway produces
 * overlapping mush. The stride is computed from the available width rather
 * than fixed, so the same component works at every window and breakpoint.
 */
export function XAxis({
  data,
  x,
  width,
}: {
  data: Array<{ day: string }>;
  x: (i: number) => number;
  width: number;
}) {
  const available = width - PAD.left - PAD.right;
  const stride = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(available / 56))));

  return (
    <>
      {data.map((d, i) =>
        i % stride === 0 || i === data.length - 1 ? (
          <text
            key={d.day}
            x={x(i)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-muted)"
          >
            {formatDay(d.day)}
          </text>
        ) : null
      )}
    </>
  );
}

export function Tooltip({
  day,
  rows,
}: {
  day: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}) {
  return (
    <div
      role="status"
      className="mt-2 inline-flex flex-col gap-1 rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs"
    >
      <span className="font-medium text-neutral-300">{formatDay(day)}</span>
      {rows.map((row) => (
        <span key={row.label} className="flex items-center gap-2 text-neutral-400">
          {row.color && (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
          )}
          <span className="flex-1">{row.label}</span>
          <span className="tabular-nums text-neutral-200">{row.value}</span>
        </span>
      ))}
    </div>
  );
}

export const CHART_PAD = PAD;
export const CHART_HEIGHT = HEIGHT;

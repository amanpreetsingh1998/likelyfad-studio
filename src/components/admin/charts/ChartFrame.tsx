"use client";

/**
 * The panel every chart sits in.
 *
 * Carries the four things each chart would otherwise reimplement slightly
 * differently: the title block, the legend, the table twin, and the states
 * where there is nothing to draw.
 *
 * THE TABLE TWIN IS NOT OPTIONAL.
 *
 * A tooltip must enhance a chart, never gate it — a value reachable only by
 * hovering is unreachable by keyboard, by screen reader, and in a screenshot.
 * Putting the toggle in the frame means no chart can ship without one; there
 * is nowhere to add a chart that skips it.
 *
 * THE STATES MATTER MORE THAN USUAL HERE.
 *
 * generation_events starts empty and fills from the day it ships, so "no data
 * yet" is the normal first-week state of half this dashboard. It says so
 * plainly rather than drawing empty axes that look like a bug — and a panel
 * whose query failed says *that*, instead of silently showing zero, which is a
 * number an admin would believe.
 */

import { useId, useState, type ReactNode } from "react";

export type LegendItem = { label: string; color: string };

export type TableSpec = {
  columns: string[];
  /** Pre-formatted cells — the frame does no number formatting of its own. */
  rows: Array<Array<string | number>>;
};

export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  isEmpty,
  emptyMessage = "No data in this window yet.",
  failed,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Omitted for single-series charts — the title already names what is plotted. */
  legend?: LegendItem[];
  table: TableSpec;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** The panel's query failed. Distinct from empty, and says so. */
  failed?: boolean;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          )}
        </div>

        {!failed && !isEmpty && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={panelId}
            className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
          >
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </header>

      {legend && legend.length > 1 && !failed && !isEmpty && (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-1.5 text-xs text-neutral-400"
            >
              {/* Identity rides a colored mark beside the text, never the text
                  itself — a light hue is illegible as type on this surface. */}
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div id={panelId} className="mt-4">
        {failed ? (
          <Notice tone="error">
            This panel could not be read. The rest of the page is unaffected —
            check the server log for the failing query.
          </Notice>
        ) : isEmpty ? (
          <Notice tone="quiet">{emptyMessage}</Notice>
        ) : showTable ? (
          <DataTable spec={table} />
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "quiet";
  children: ReactNode;
}) {
  return (
    <p
      className={
        tone === "error"
          ? "rounded border border-red-900/60 bg-red-950/30 px-3 py-6 text-center text-xs text-red-300"
          : "px-3 py-10 text-center text-xs text-neutral-500"
      }
    >
      {children}
    </p>
  );
}

/**
 * The chart's WCAG-clean equivalent.
 *
 * tabular-nums here and only here: these are columns that must align
 * vertically. Stat-tile values and the hero figure use proportional figures,
 * where equal-width digits make a number look loose.
 */
function DataTable({ spec }: { spec: TableSpec }) {
  if (!spec.rows.length) {
    return <Notice tone="quiet">Nothing to show.</Notice>;
  }

  return (
    // Wide tables scroll inside the panel; the page itself never scrolls
    // sideways.
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-neutral-900">
          <tr className="border-b border-neutral-800">
            {spec.columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={`py-1.5 pr-3 font-medium text-neutral-400 ${
                  i === 0 ? "" : "text-right"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {spec.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-neutral-800/50">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-1.5 pr-3 ${
                    cellIndex === 0
                      ? "text-neutral-300"
                      : "text-right text-neutral-400"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

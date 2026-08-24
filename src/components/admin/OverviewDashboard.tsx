"use client";

/**
 * The Overview page's body.
 *
 * Server-rendered once with initial stats, then refetched client-side when the
 * window changes — so the first paint carries real numbers rather than a
 * skeleton, and switching windows does not cost a navigation.
 *
 * ONE FILTER ROW, ABOVE EVERYTHING IT SCOPES.
 *
 * The window control is not repeated per panel and does not live inside a
 * chart card. Every chart re-renders against the same slice, so two panels can
 * never disagree about what period is on screen.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import type { AdminStats } from "@/lib/admin/stats";
import { EMPTY_OVERVIEW, pivotRunsByKind } from "@/lib/admin/stats";
import { ChartFrame } from "./charts/ChartFrame";
import { LineChart } from "./charts/LineChart";
import { ColumnChart } from "./charts/ColumnChart";
import { BarList } from "./charts/BarList";
import { HeroFigure, StatGrid, StatTile } from "./charts/StatTile";
import { SERIES_VAR, VIZ_VARS, kindColor, kindLabel, sortKinds } from "./charts/theme";
import {
  formatCompact,
  formatDay,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRupees,
} from "./charts/format";

const WINDOWS = [7, 30, 90] as const;

/**
 * The credit-flow series, declared once so the legend and the marks cannot
 * drift apart. Colours are explicit rather than positional for the same reason
 * the kind chart's are.
 */
const CREDIT_SERIES = [
  { key: "granted", label: "Granted", color: SERIES_VAR[0] },
  { key: "purchased", label: "Purchased", color: SERIES_VAR[1] },
  { key: "spent", label: "Spent", color: SERIES_VAR[2] },
];

export function OverviewDashboard({
  initial,
  adminEmail,
}: {
  initial: AdminStats;
  adminEmail: string;
}) {
  const [stats, setStats] = useState(initial);
  const [days, setDays] = useState(initial.windowDays);
  const [pending, startTransition] = useTransition();
  const [fetchFailed, setFetchFailed] = useState(false);

  const load = useCallback(async (window: number) => {
    try {
      const response = await fetch(`/api/admin/stats?days=${window}`);
      if (!response.ok) throw new Error(String(response.status));
      setStats(await response.json());
      setFetchFailed(false);
    } catch {
      // Keep the previous render rather than blanking the page — a stale
      // number with a warning beats no number.
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    if (days === initial.windowDays && stats === initial) return;
    startTransition(() => {
      void load(days);
    });
  }, [days, initial, load, stats]);

  const overview = stats.overview ?? EMPTY_OVERVIEW;
  const failed = (fn: string) => stats.failed.includes(fn);
  const dailyFailed = failed("admin_stats_daily");
  const overviewFailed = failed("admin_stats_overview");

  const days_ = stats.daily.map((row) => row.day);
  const { kinds: presentKinds, series: kindSeries } = pivotRunsByKind(
    stats.runsByKind,
    days_
  );
  // Canonical order, so the legend reads the same at every window — and so a
  // kind that goes unused in a short window does not shift the others' colours.
  const kinds = sortKinds(presentKinds);

  const runs30 = overview.runs.runs_30d;
  const settled = runs30 - overview.runs.failed_30d;

  return (
    // The palette lands here as custom properties, so every mark below is
    // written against roles rather than raw hex.
    <div style={VIZ_VARS} className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Overview</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Signed in as <span className="text-neutral-200">{adminEmail}</span> —
            the sole admin.
          </p>
        </div>

        <div
          role="group"
          aria-label="Reporting window"
          className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1"
        >
          {WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setDays(window)}
              aria-pressed={days === window}
              className={
                days === window
                  ? "rounded px-2.5 py-1 text-xs font-medium text-neutral-100 bg-neutral-800"
                  : "rounded px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              }
            >
              {window}d
            </button>
          ))}
        </div>
      </header>

      {fetchFailed && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Could not refresh — showing the last figures that loaded.
        </p>
      )}

      {/* Held at reduced opacity during a refetch. A skeleton here would throw
          the layout away and back for a sub-second fetch. */}
      <div className={pending ? "opacity-60 transition-opacity" : undefined}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_2fr]">
          <HeroFigure
            label="Revenue, all time"
            value={formatRupees(overview.revenue.total_paise)}
            note={`${formatNumber(overview.revenue.purchases)} purchases · ${formatRupees(
              overview.revenue.paise_30d,
              true
            )} in the last 30 days`}
          />

          <StatGrid>
            <StatTile
              label="Users"
              value={formatNumber(overview.users.total)}
              note={`+${formatNumber(overview.users.new_7d)} this week`}
            />
            <StatTile
              label="Paying"
              value={formatNumber(overview.users.paying)}
              note={`${formatPercent(
                overview.users.paying,
                overview.users.total
              )} of signups`}
            />
            <StatTile
              label="Active, 30d"
              value={formatNumber(overview.users.active_30d)}
              note="generated at least once"
            />
            <StatTile
              label="Credits outstanding"
              value={formatCompact(overview.credits.outstanding)}
              note="compute you already owe"
            />
            <StatTile
              label="Runs, 30d"
              value={formatCompact(runs30)}
              note={`${formatPercent(settled, runs30)} succeeded`}
            />
            <StatTile
              label="Unbilled"
              value={formatCompact(overview.credits.unsettled)}
              tone={overview.credits.unsettled > 0 ? "warn" : "neutral"}
              note="dispatched, never settled"
            />
          </StatGrid>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {/* Signups and revenue are two measures of different scale, so they
              are two charts. A second y-axis would invent a correlation. */}
          <ChartFrame
            title="Signups"
            subtitle={`New accounts per day, last ${stats.windowDays} days`}
            failed={dailyFailed}
            isEmpty={stats.daily.every((r) => r.signups === 0)}
            table={{
              columns: ["Day", "Signups"],
              rows: stats.daily.map((r) => [formatDay(r.day), formatNumber(r.signups)]),
            }}
          >
            <LineChart
              data={stats.daily.map((r) => ({ day: r.day, value: r.signups }))}
              valueLabel="Signups"
            />
          </ChartFrame>

          <ChartFrame
            title="Revenue"
            subtitle={`Rupees collected per day, last ${stats.windowDays} days`}
            failed={dailyFailed}
            isEmpty={stats.daily.every((r) => r.revenue_paise === 0)}
            emptyMessage="No purchases in this window."
            table={{
              columns: ["Day", "Revenue"],
              rows: stats.daily.map((r) => [
                formatDay(r.day),
                formatRupees(r.revenue_paise),
              ]),
            }}
          >
            <ColumnChart
              data={stats.daily.map((r) => ({
                day: r.day,
                revenue: r.revenue_paise / 100,
              }))}
              series={[{ key: "revenue", label: "Revenue" }]}
              format={(value) => formatRupees(value * 100)}
            />
          </ChartFrame>

          <ChartFrame
            title="Credit flow"
            subtitle="Granted, purchased and spent per day"
            failed={dailyFailed}
            isEmpty={stats.daily.every(
              (r) => !r.credits_granted && !r.credits_purchased && !r.credits_spent
            )}
            legend={CREDIT_SERIES.map((s) => ({
              label: s.label,
              color: s.color,
            }))}
            table={{
              columns: ["Day", "Granted", "Purchased", "Spent"],
              rows: stats.daily.map((r) => [
                formatDay(r.day),
                formatNumber(r.credits_granted),
                formatNumber(r.credits_purchased),
                formatNumber(r.credits_spent),
              ]),
            }}
          >
            <ColumnChart
              mode="grouped"
              data={stats.daily.map((r) => ({
                day: r.day,
                granted: r.credits_granted,
                purchased: r.credits_purchased,
                spent: r.credits_spent,
              }))}
              series={CREDIT_SERIES}
            />
          </ChartFrame>

          <ChartFrame
            title="Runs by type"
            subtitle="What the studio is actually being used for"
            failed={failed("admin_stats_runs_by_kind")}
            isEmpty={!kinds.length}
            emptyMessage="No generations recorded yet — the log starts filling from its first run."
            legend={kinds.map((kind) => ({
              label: kindLabel(kind),
              color: kindColor(kind),
            }))}
            table={{
              columns: ["Day", ...kinds.map(kindLabel)],
              rows: kindSeries.map((row) => [
                formatDay(String(row.day)),
                ...kinds.map((kind) => formatNumber(Number(row[kind] ?? 0))),
              ]),
            }}
          >
            <ColumnChart
              data={kindSeries as Array<Record<string, string | number> & { day: string }>}
              series={kinds.map((kind) => ({
                key: kind,
                label: kindLabel(kind),
                color: kindColor(kind),
              }))}
            />
          </ChartFrame>
        </div>

        <div className="mt-4">
          <ChartFrame
            title="Top models"
            subtitle={`By run count, last ${stats.windowDays} days`}
            failed={failed("admin_stats_models")}
            isEmpty={!stats.models.length}
            emptyMessage="No generations recorded yet."
            table={{
              columns: [
                "Model",
                "Type",
                "Runs",
                "Succeeded",
                "Failed",
                "Avg time",
                "Credits",
              ],
              rows: stats.models.map((m) => [
                m.model_id,
                m.kind ?? "—",
                formatNumber(m.runs),
                formatNumber(m.succeeded),
                formatNumber(m.failed),
                formatDuration(m.avg_duration_ms),
                formatNumber(m.credits),
              ]),
            }}
          >
            <BarList
              items={stats.models.map((m) => ({
                label: m.model_id,
                value: m.runs,
                // Reliability as text, never as a color shift on the bar.
                meta: `${formatPercent(m.succeeded, m.runs)} ok · ${formatDuration(
                  m.avg_duration_ms
                )}`,
                formatted: formatNumber(m.runs),
              }))}
            />
          </ChartFrame>
        </div>

        {overviewFailed && (
          <p className="mt-4 rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            The headline figures could not be read, so the tiles above show
            zeros. Check the server log — and run{" "}
            <code className="text-red-200">0007_admin_stats.sql</code> if you
            have not yet.
          </p>
        )}
      </div>
    </div>
  );
}

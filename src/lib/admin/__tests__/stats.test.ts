/**
 * The stats layer's own logic — the parts that are not SQL.
 *
 * The window clamp guards a parameter that reaches a generate_series, and the
 * pivot decides whether a stacked chart draws the truth or a shape with holes
 * in it. Both are worth pinning; the aggregates themselves are Postgres's job.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WINDOW_DAYS,
  getAdminStats,
  normalizeWindow,
  pivotRunsByKind,
} from "../stats";

describe("normalizeWindow", () => {
  it("keeps a sensible window", () => {
    expect(normalizeWindow(7)).toBe(7);
    expect(normalizeWindow("90")).toBe(90);
  });

  it("falls back to the default for anything unparseable", () => {
    expect(normalizeWindow(null)).toBe(DEFAULT_WINDOW_DAYS);
    expect(normalizeWindow("weeks")).toBe(DEFAULT_WINDOW_DAYS);
    expect(normalizeWindow(undefined)).toBe(DEFAULT_WINDOW_DAYS);
  });

  it("clamps a window that would generate an enormous date series", () => {
    // ?days=100000 would otherwise build a hundred thousand rows before
    // returning any of them.
    expect(normalizeWindow(100000)).toBe(365);
    expect(normalizeWindow(0)).toBe(1);
    expect(normalizeWindow(-5)).toBe(1);
  });

  it("floors a fractional window rather than passing it to SQL", () => {
    expect(normalizeWindow(7.9)).toBe(7);
  });
});

describe("pivotRunsByKind", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];

  it("fills every series on every day so stacks do not break", () => {
    // SQL returns only the (day, kind) pairs that happened. A stacked chart
    // needs each series present on each day or the bands break where a kind
    // went unused.
    const { kinds, series } = pivotRunsByKind(
      [
        { day: "2026-08-01", kind: "image", runs: 3 },
        { day: "2026-08-03", kind: "video", runs: 1 },
      ],
      days
    );

    expect(kinds).toEqual(["image", "video"]);
    expect(series).toEqual([
      { day: "2026-08-01", image: 3, video: 0 },
      { day: "2026-08-02", image: 0, video: 0 },
      { day: "2026-08-03", image: 0, video: 1 },
    ]);
  });

  it("emits one row per requested day, in order, inventing no dates", () => {
    const { series } = pivotRunsByKind(
      [{ day: "2026-07-14", kind: "image", runs: 9 }],
      days
    );

    expect(series.map((r) => r.day)).toEqual(days);
  });

  it("sums duplicate rows for the same day and kind", () => {
    const { series } = pivotRunsByKind(
      [
        { day: "2026-08-01", kind: "image", runs: 2 },
        { day: "2026-08-01", kind: "image", runs: 5 },
      ],
      ["2026-08-01"]
    );

    expect(series[0].image).toBe(7);
  });

  it("returns no series for no rows", () => {
    expect(pivotRunsByKind([], days)).toEqual({
      kinds: [],
      series: days.map((day) => ({ day })),
    });
  });
});

describe("getAdminStats", () => {
  let rpc: ReturnType<typeof vi.fn>;

  function client(): SupabaseClient {
    return { rpc } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc = vi.fn(async () => ({ data: [], error: null }));
  });

  it("clamps the window before it reaches SQL", async () => {
    await getAdminStats(client(), 99999);

    const daily = rpc.mock.calls.find(([fn]) => fn === "admin_stats_daily");
    expect(daily?.[1]).toEqual({ p_days: 365 });
  });

  it("names the panels that failed instead of throwing the page away", async () => {
    // The dashboard is what you open when something is already wrong. One
    // broken query should cost one panel, not the view.
    rpc.mockImplementation(async (fn: string) =>
      fn === "admin_stats_models"
        ? { data: null, error: { message: "boom" } }
        : { data: [], error: null }
    );

    const stats = await getAdminStats(client(), 30);

    expect(stats.failed).toEqual(["admin_stats_models"]);
    expect(stats.models).toEqual([]);
    expect(stats.daily).toEqual([]);
  });

  it("survives an rpc that throws outright", async () => {
    rpc.mockRejectedValue(new Error("connection refused"));

    const stats = await getAdminStats(client(), 30);

    expect(stats.failed).toHaveLength(4);
    expect(stats.overview).toBeNull();
  });
});

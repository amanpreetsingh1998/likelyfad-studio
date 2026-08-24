/**
 * Chart tokens for the admin dashboard.
 *
 * Dark only, deliberately. globals.css sets one theme for the whole app and
 * there is no toggle anywhere in it, so a light palette here would be a second
 * set of colors that never renders and never gets looked at. The values are
 * still declared as CSS custom properties on the chart root rather than
 * inlined per mark, so adding a light mode later is one block, not a sweep.
 *
 * The categorical slots are the reference palette's dark steps, validated as a
 * set against this app's actual surface (neutral-900, #171717) rather than the
 * reference's own — contrast and lightness-band results only mean anything
 * against the surface the chart really renders on:
 *
 *   lightness band  PASS   all 6 inside L 0.48–0.67
 *   chroma floor    PASS   all 6 >= 0.1
 *   CVD separation  PASS   worst adjacent yellow↔aqua ΔE 8.4 (protan)
 *   normal vision   PASS   worst adjacent magenta↔yellow ΔE 19.3
 *   contrast        PASS   all 6 >= 3:1
 *
 * Slots are assigned in fixed order and never cycled. Six is the most any
 * chart here uses; a seventh series would fold into "Other" rather than take a
 * generated hue, which is indistinguishable under CVD.
 */

import type { CSSProperties } from "react";

/** The chart surface these were validated against — Tailwind neutral-900. */
export const SURFACE = "#171717";

/**
 * Categorical slots, in fixed assignment order.
 *
 * Exported as an array because series get their color by index into it, and
 * that index must follow the entity — a filter that drops a series must not
 * repaint the ones that remain.
 */
export const SERIES = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
] as const;

export const SERIES_VAR = SERIES.map((_, i) => `var(--series-${i + 1})`);

/**
 * Status colors, fixed and never themed. Distinct from the categorical slots
 * so a status color never impersonates a series — and always shipped with a
 * label beside them, never carrying the meaning alone.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

/** Chart chrome. Grid and axis are hairlines one step off the surface. */
export const INK = {
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
} as const;

/**
 * The custom properties every chart is written against.
 *
 * Spread onto the dashboard root, so marks reference `var(--series-N)` and the
 * whole palette moves in one place.
 */
export const VIZ_VARS = {
  "--surface-1": SURFACE,
  "--text-primary": INK.primary,
  "--text-secondary": INK.secondary,
  "--text-muted": INK.muted,
  "--grid": INK.grid,
  "--axis": INK.axis,
  ...Object.fromEntries(SERIES.map((hex, i) => [`--series-${i + 1}`, hex])),
} as CSSProperties;

/** Fixed geometry from the mark spec — not per-chart choices. */
export const MARK = {
  /** Bars never fill their band; the leftover is air. */
  maxBarThickness: 24,
  /** Rounded at the data end, square at the baseline. */
  barRadius: 4,
  lineWidth: 2,
  /** Diameter ≥ 8px. */
  dotRadius: 4,
  /** Surface gap between touching fills, and the surface ring on markers. */
  gap: 2,
} as const;

/** A human label for each run kind, so charts never show a raw enum. */
export const KIND_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  "3d": "3D",
  llm: "LLM",
  comfy: "Comfy",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * The canonical order of run kinds — mirrors RunKind in credits/pricing.ts.
 *
 * This is what colour is assigned from, NOT the position of a kind in whatever
 * happens to be on screen. Deriving the slot from the present series means a
 * window with no video runs shifts every later kind down one, and a reader who
 * learned "audio is aqua" watches it turn orange when they change the window.
 *
 * Colour follows the entity. A kind keeps its hue whether or not it appears.
 */
export const KIND_ORDER = [
  "image",
  "video",
  "audio",
  "3d",
  "llm",
  "comfy",
] as const;

/**
 * The fixed categorical slot for a run kind.
 *
 * An unrecognised kind (a new RunKind added without updating KIND_ORDER) falls
 * to the last slot rather than to slot 0, where it would impersonate images.
 */
export function kindColor(kind: string): string {
  const index = KIND_ORDER.indexOf(kind as (typeof KIND_ORDER)[number]);
  return SERIES_VAR[index >= 0 ? index : SERIES_VAR.length - 1];
}

/** Sort a set of kinds into canonical order, unknowns last. */
export function sortKinds(kinds: string[]): string[] {
  const rank = (kind: string) => {
    const index = KIND_ORDER.indexOf(kind as (typeof KIND_ORDER)[number]);
    return index >= 0 ? index : KIND_ORDER.length;
  };
  return [...kinds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

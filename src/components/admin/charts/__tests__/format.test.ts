/**
 * Formatting is where a dashboard quietly lies — a rounded total that no
 * longer matches the sum of its rows, an axis whose top tick is below the
 * data, money divided in the wrong place.
 */

import { describe, it, expect } from "vitest";
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRupees,
  niceTicks,
} from "../format";

describe("formatRupees", () => {
  it("converts paise to rupees", () => {
    // Razorpay works in paise and the ledger stores what it reported, so the
    // division belongs here and not in an aggregate.
    expect(formatRupees(49900)).toContain("499");
    expect(formatRupees(0)).toContain("0");
  });

  it("keeps paise when the amount is not a whole rupee", () => {
    expect(formatRupees(49950)).toContain("499.5");
  });

  it("handles a missing amount rather than rendering NaN", () => {
    expect(formatRupees(undefined as unknown as number)).toContain("0");
  });
});

describe("formatCompact vs formatNumber", () => {
  it("compacts only above a thousand", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(12934)).toMatch(/12\.9K/);
  });

  it("keeps full precision where a reader asked for it", () => {
    // Tables and tooltips get the real number — "12.9K" is a worse answer to
    // someone who opened the table view.
    expect(formatNumber(12934)).toMatch(/12,934/);
  });
});

describe("formatPercent", () => {
  it("computes a rate", () => {
    expect(formatPercent(92, 100)).toBe("92.0%");
  });

  it("returns a dash rather than dividing by zero", () => {
    // A model with no runs is not 0% reliable, it is unmeasured — and NaN% on
    // a dashboard reads as a bug in the product, not in the denominator.
    expect(formatPercent(0, 0)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("switches units at a second", () => {
    expect(formatDuration(420)).toBe("420ms");
    expect(formatDuration(1832)).toBe("1.8s");
  });

  it("shows a dash for an unmeasured duration", () => {
    expect(formatDuration(0)).toBe("—");
  });
});

describe("niceTicks", () => {
  it("always spans at least the data", () => {
    // The top gridline is the y-scale's maximum. A tick below the data would
    // draw a bar out of its own plot.
    for (const max of [1, 7, 23, 99, 100, 137, 1001, 48123]) {
      const ticks = niceTicks(max);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("starts at zero, so bar lengths stay proportional", () => {
    expect(niceTicks(137)[0]).toBe(0);
  });

  it("uses round steps a reader can hold in their head", () => {
    expect(niceTicks(137)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(23)).toEqual([0, 10, 20, 30]);
  });

  it("gives an empty dataset a usable axis instead of collapsing", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(NaN)).toEqual([0, 1]);
  });

  it("does not emit floating-point noise as tick labels", () => {
    for (const tick of niceTicks(0.7)) {
      expect(String(tick)).not.toMatch(/\d{6,}/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { FAL_PRICING } from "@/lib/likelyfad/fal-pricing.generated";
import {
  ASSUMED_SECONDS,
  falUsdForRun,
  getFalPrice,
  falPricedCount,
  falUnusableIds,
} from "../falPricing";
import { hasKnownPrice, usdCostForRun } from "../pricing";

describe("the recorded fal price list", () => {
  it("is not empty — a wiped file would silently make every fal model free", () => {
    expect(falPricedCount()).toBeGreaterThan(100);
  });

  it("records a non-negative price on every entry", () => {
    // The recorder writes what fal publishes, including the occasional 0 and
    // the empty-unit rows. Filtering happens at read time, not record time, so
    // the file stays a faithful copy of the source.
    for (const [id, entry] of Object.entries(FAL_PRICING)) {
      expect(entry.price, id).toBeGreaterThanOrEqual(0);
      expect(typeof entry.unit, id).toBe("string");
    }
  });

  it("excludes unusable rows from the billable set", () => {
    // $0, an empty unit, and fal's "$1 / units" variable-pricing placeholder
    // are all recorded but must never be billed from — refusing is the only
    // safe direction when the real price could be 30x either way.
    for (const id of falUnusableIds()) {
      const entry = FAL_PRICING[id];
      const unusable =
        entry.price <= 0 || !entry.unit || (entry.unit === "units" && entry.price === 1);
      expect(unusable, id).toBe(true);
      expect(falUsdForRun(id), id).toBeNull();
    }
  });

  it("refuses fal's $1/units variable-pricing placeholder", () => {
    // google/nano-banana-2-lite really costs a few cents; billing the
    // placeholder literally would overcharge ~30x.
    const sentinel = Object.entries(FAL_PRICING).find(
      ([, e]) => e.unit === "units" && e.price === 1
    );
    if (!sentinel) return;
    expect(falUsdForRun(sentinel[0])).toBeNull();
  });
});

describe("falUsdForRun", () => {
  it("returns null for a model with no recorded price", () => {
    expect(falUsdForRun("fal-ai/not-a-real-model")).toBeNull();
  });

  it("bills a per-image model at its flat price", () => {
    const [id, entry] =
      Object.entries(FAL_PRICING).find(([, e]) => e.unit === "images" && !e.multipliers) ?? [];
    if (!id || !entry) return;
    expect(falUsdForRun(id, { resolution: "1K" })).toBeCloseTo(entry.price, 6);
  });

  it("scales a per-second model by clip length", () => {
    const [id, entry] = Object.entries(FAL_PRICING).find(([, e]) => e.unit === "seconds") ?? [];
    if (!id || !entry) return;
    expect(falUsdForRun(id, { seconds: 10 })).toBeCloseTo(entry.price * 10, 6);
    // No duration given falls back to the same assumption the cost estimator makes.
    expect(falUsdForRun(id)).toBeCloseTo(entry.price * ASSUMED_SECONDS, 6);
  });

  it("scales a per-megapixel model by output size", () => {
    const [id] = Object.entries(FAL_PRICING).find(([, e]) => e.unit === "megapixels") ?? [];
    if (!id) return;
    const oneK = falUsdForRun(id, { resolution: "1K" })!;
    const fourK = falUsdForRun(id, { resolution: "4K" })!;
    // This is the case that loses money if billed flat: 4K is ~8x the pixels.
    expect(fourK).toBeGreaterThan(oneK * 5);
  });

  it("does not double-count size for megapixel models", () => {
    // Megapixel billing already scales with resolution, so a published
    // multiplier must not be applied on top of it.
    const entry = Object.entries(FAL_PRICING).find(
      ([, e]) => e.unit === "megapixels" && e.multipliers
    );
    if (!entry) return;
    const [id, data] = entry;
    const fourK = falUsdForRun(id, { resolution: "4K" })!;
    expect(fourK).toBeLessThan(data.price * 8.29 * 1.5);
  });

  it("multiplies by batch count", () => {
    const [id] = Object.entries(FAL_PRICING).find(([, e]) => e.unit === "images")!;
    const one = falUsdForRun(id, { resolution: "1K", count: 1 })!;
    expect(falUsdForRun(id, { resolution: "1K", count: 3 })).toBeCloseTo(one * 3, 6);
  });
});

describe("integration with the billing path", () => {
  it("prefers a recorded fal price over the USD_RATES fallback", () => {
    const [id, entry] =
      Object.entries(FAL_PRICING).find(([, e]) => e.unit === "images") ?? [];
    if (!id || !entry) return;
    expect(usdCostForRun({ kind: "image", modelId: id, resolution: "1K" })).toBeCloseTo(
      entry.price,
      6
    );
  });

  it("treats an unpriced fal model as unbillable", () => {
    expect(
      hasKnownPrice({ kind: "image", provider: "fal", modelId: "fal-ai/ghost-model" })
    ).toBe(false);
  });

  it("still bills providers we hold our own rate card for", () => {
    expect(hasKnownPrice({ kind: "image", provider: "gemini", modelId: "nano-banana-pro" }))
      .toBe(true);
  });

  it("accepts a recorded fal model", () => {
    const [id] = Object.entries(FAL_PRICING).find(([, e]) => e.unit === "images")!;
    expect(hasKnownPrice({ kind: "image", provider: "fal", modelId: id })).toBe(true);
  });
});

describe("getFalPrice", () => {
  it("round-trips a known entry", () => {
    const [id, entry] = Object.entries(FAL_PRICING).find(([, e]) => e.unit === "images")!;
    expect(getFalPrice(id)).toEqual(entry);
  });

  it("returns null for an unknown id", () => {
    expect(getFalPrice("nope/nope")).toBeNull();
  });
});

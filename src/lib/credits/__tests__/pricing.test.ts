import { describe, it, expect } from "vitest";
import {
  CREDIT_PACKS,
  creditCostForRun,
  creditPegDriftPct,
  findPack,
  formatPackPrice,
  runKindForMediaType,
  usdCostForRun,
  type RunKind,
} from "../pricing";
import {
  CREDIT_VALUE_INR,
  MARGIN,
  USD_INR_RATE,
  USD_RATES,
  creditsForUsd,
  creditsToInr,
} from "../rates";

describe("the peg", () => {
  it("matches what the entry pack actually sells credits for", () => {
    // If this drifts, the "1 credit ≈ ₹X" in the buy modal is a lie.
    expect(creditPegDriftPct()).toBeLessThan(0.05);
  });

  it("converts credits back to rupees at the stated rate", () => {
    expect(creditsToInr(100)).toBeCloseTo(100 * CREDIT_VALUE_INR, 5);
  });
});

describe("credit packs", () => {
  it("has unique ids", () => {
    const ids = CREDIT_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices every pack in whole paise above zero", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.amountInPaise).toBeGreaterThan(0);
      expect(Number.isInteger(pack.amountInPaise)).toBe(true);
      expect(pack.credits).toBeGreaterThan(0);
    }
  });

  it("gives larger packs a better rate, or the tiers are pointless", () => {
    const rates = CREDIT_PACKS.map((p) => p.credits / p.amountInPaise);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
    }
  });

  it("formats a price in rupees", () => {
    expect(formatPackPrice(CREDIT_PACKS[0])).toMatch(/^₹/);
  });

  it("finds by id and returns undefined otherwise", () => {
    expect(findPack(CREDIT_PACKS[0].id)?.id).toBe(CREDIT_PACKS[0].id);
    expect(findPack("nope")).toBeUndefined();
  });
});

describe("creditsForUsd", () => {
  it("applies the FX rate and margin", () => {
    const usd = 0.134;
    expect(creditsForUsd(usd)).toBe(
      Math.ceil((usd * USD_INR_RATE * MARGIN) / CREDIT_VALUE_INR)
    );
  });

  it("never returns less than one credit", () => {
    // A free run would let an exhausted account keep spending provider budget.
    expect(creditsForUsd(0)).toBe(1);
    expect(creditsForUsd(0.000001)).toBe(1);
    expect(creditsForUsd(-5)).toBe(1);
    expect(creditsForUsd(NaN)).toBe(1);
  });

  it("is monotonic — a costlier run never bills less", () => {
    let prev = 0;
    for (const usd of [0.01, 0.039, 0.134, 0.24, 1.2, 5]) {
      const credits = creditsForUsd(usd);
      expect(credits).toBeGreaterThanOrEqual(prev);
      prev = credits;
    }
  });
});

/**
 * The regression that motivated deriving prices instead of writing them by
 * hand: every image model was being sold at roughly half of what it cost.
 */
describe("no run is sold below cost", () => {
  const cases: Array<{ kind: RunKind; modelId: string; resolution?: string }> = [
    { kind: "image", modelId: "nano-banana", resolution: "1K" },
    { kind: "image", modelId: "nano-banana-pro", resolution: "1K" },
    { kind: "image", modelId: "nano-banana-pro", resolution: "4K" },
    { kind: "image", modelId: "nano-banana-2", resolution: "2K" },
    { kind: "image", modelId: "nano-banana-2-lite", resolution: "1K" },
    { kind: "video", modelId: "veo-3" },
    { kind: "video", modelId: "kling" },
    { kind: "llm", modelId: "gemini-2.5-flash" },
    { kind: "audio", modelId: "whatever" },
    { kind: "3d", modelId: "whatever" },
  ];

  for (const c of cases) {
    it(`${c.modelId}${c.resolution ? ` @${c.resolution}` : ""} bills above provider cost`, () => {
      const usd = usdCostForRun(c);
      const chargedInr = creditsToInr(creditCostForRun(c));
      const costInr = usd * USD_INR_RATE;
      expect(chargedInr).toBeGreaterThanOrEqual(costInr);
    });
  }
});

describe("usdCostForRun", () => {
  it("resolves the longest matching model key", () => {
    // "nano-banana" also matches, but the more specific key must win or every
    // variant would be priced as the base model.
    expect(usdCostForRun({ kind: "image", modelId: "nano-banana-2-lite", resolution: "1K" }))
      .toBe(USD_RATES.image["nano-banana-2-lite"]["1K"]);
    expect(usdCostForRun({ kind: "image", modelId: "nano-banana-2", resolution: "1K" }))
      .toBe(USD_RATES.image["nano-banana-2"]["1K"]);
  });

  it("scales an image by resolution", () => {
    const oneK = usdCostForRun({ kind: "image", modelId: "nano-banana-pro", resolution: "1K" });
    const fourK = usdCostForRun({ kind: "image", modelId: "nano-banana-pro", resolution: "4K" });
    expect(fourK).toBeGreaterThan(oneK);
  });

  it("falls back to a category default for an unknown model", () => {
    expect(usdCostForRun({ kind: "video", modelId: "brand-new-model" }))
      .toBe(USD_RATES.video.default);
  });
});

describe("creditCostForRun", () => {
  it("multiplies by batch count", () => {
    const one = creditCostForRun({ kind: "image", modelId: "nano-banana", count: 1 });
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana", count: 4 }))
      .toBe(one * 4);
  });

  it("treats a missing or nonsensical count as one run", () => {
    const one = creditCostForRun({ kind: "image", modelId: "nano-banana" });
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana", count: 0 })).toBe(one);
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana", count: -5 })).toBe(one);
  });

  it("charges a 4K image more than a 1K one", () => {
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana-pro", resolution: "4K" }))
      .toBeGreaterThan(
        creditCostForRun({ kind: "image", modelId: "nano-banana-pro", resolution: "1K" })
      );
  });
});

describe("runKindForMediaType", () => {
  it("maps known media types", () => {
    expect(runKindForMediaType("video")).toBe("video");
    expect(runKindForMediaType("audio")).toBe("audio");
    expect(runKindForMediaType("3d")).toBe("3d");
  });

  it("defaults to image, matching /api/generate's own default", () => {
    expect(runKindForMediaType(undefined)).toBe("image");
    expect(runKindForMediaType("something-else")).toBe("image");
  });
});

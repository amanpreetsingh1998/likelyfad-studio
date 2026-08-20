import { describe, it, expect } from "vitest";
import {
  CREDIT_PACKS,
  creditCostForRun,
  findPack,
  formatPackPrice,
  runKindForMediaType,
} from "../pricing";

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

describe("creditCostForRun", () => {
  it("charges the category rate when no model override matches", () => {
    expect(creditCostForRun({ kind: "image", modelId: "some-unknown-model" }))
      .toBe(5);
    expect(creditCostForRun({ kind: "llm", modelId: "gpt-4.1-nano" })).toBe(1);
  });

  it("prefers a model override over the category rate", () => {
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana-pro" }))
      .toBe(12);
  });

  it("resolves the longest matching model key", () => {
    // "nano-banana" also matches, but the more specific key must win or every
    // Nano Banana variant would be billed at the base model's rate.
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana-2-lite" }))
      .toBe(3);
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana-2" })).toBe(6);
  });

  it("scales an image charge by resolution", () => {
    const base = creditCostForRun({ kind: "image", modelId: "nano-banana-pro", resolution: "1K" });
    const big = creditCostForRun({ kind: "image", modelId: "nano-banana-pro", resolution: "4K" });
    expect(big).toBeGreaterThan(base);
    expect(big).toBe(Math.ceil(12 * 2.5));
  });

  it("ignores resolution for non-image runs", () => {
    expect(creditCostForRun({ kind: "video", modelId: "veo-3", resolution: "4K" }))
      .toBe(120);
  });

  it("multiplies by batch count", () => {
    expect(creditCostForRun({ kind: "image", modelId: "unknown", count: 4 })).toBe(20);
  });

  it("never charges less than one credit", () => {
    // A free run would let an exhausted account keep spending provider budget.
    expect(creditCostForRun({ kind: "llm", modelId: "unknown", count: 0 })).toBe(1);
    expect(creditCostForRun({ kind: "image", modelId: "unknown", count: -5 }))
      .toBeGreaterThanOrEqual(1);
  });

  it("rounds up rather than down", () => {
    expect(creditCostForRun({ kind: "llm", modelId: "unknown", count: 1 })).toBe(1);
    // 3 * 0.75 = 2.25 → 3, not 2.
    expect(creditCostForRun({ kind: "image", modelId: "nano-banana-2-lite", resolution: "512" }))
      .toBe(3);
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

/**
 * The header estimate and the credit gate must agree.
 *
 * They are computed by different code on different sides of the wire —
 * calculatePredictedCost in the browser, creditCostForRun on the server — so
 * nothing but a test stops them drifting. They already drifted twice: once when
 * credit prices were a hand-written table that disagreed with the USD one, and
 * once when the header converted a summed dollar total while billing rounded
 * each node up individually.
 */

import { describe, it, expect } from "vitest";
import { calculatePredictedCost } from "@/utils/costCalculator";
import { creditCostForRun } from "../pricing";
import { creditsForUsd } from "../rates";
import { FAL_PRICING } from "@/lib/likelyfad/fal-pricing.generated";
import type { WorkflowNode } from "@/types";

/** A nanoBanana node pinned to a given model, as the canvas would store it. */
function imageNode(id: string, provider: string, modelId: string, resolution = "1K"): WorkflowNode {
  return {
    id,
    type: "nanoBanana",
    position: { x: 0, y: 0 },
    data: {
      selectedModel: { provider, modelId, displayName: modelId, capabilities: [] },
      resolution,
      model: "nano-banana-pro",
    },
  } as unknown as WorkflowNode;
}

/** The header's arithmetic: per-item credits, summed. */
function headerCredits(nodes: WorkflowNode[]): number {
  const predicted = calculatePredictedCost(nodes);
  return predicted.breakdown.reduce((sum, item) => {
    if (item.subtotal === null || item.unitCost === null) return sum;
    return sum + creditsForUsd(item.unitCost) * item.count;
  }, 0);
}

const falImageModel =
  Object.entries(FAL_PRICING).find(([, e]) => e.unit === "images" && e.price > 0)?.[0] ?? null;

describe("fal models resolve in the cost estimate", () => {
  it("prices a fal node instead of counting it as unknown", () => {
    if (!falImageModel) return;
    const predicted = calculatePredictedCost([imageNode("a", "fal", falImageModel)]);

    // The regression this guards: a node placed before models carried pricing
    // has no `selectedModel.pricing`, and used to fall all the way through to
    // null — showing "unknown" forever.
    expect(predicted.unknownPricingCount).toBe(0);
    expect(predicted.totalCost).toBeGreaterThan(0);
  });

  it("still reports a genuinely unpriced model as unknown", () => {
    const predicted = calculatePredictedCost([imageNode("a", "fal", "fal-ai/does-not-exist")]);
    expect(predicted.unknownPricingCount).toBe(1);
  });

  it("does not price fal's $1/units placeholder", () => {
    const sentinel = Object.entries(FAL_PRICING).find(
      ([, e]) => e.unit === "units" && e.price === 1
    )?.[0];
    if (!sentinel) return;
    // Recorded, but refused — the header must not show a number the gate would
    // reject the run over.
    const predicted = calculatePredictedCost([imageNode("a", "fal", sentinel)]);
    expect(predicted.unknownPricingCount).toBe(1);
  });
});

describe("the header agrees with what the gate charges", () => {
  it("matches for a single fal node", () => {
    if (!falImageModel) return;
    const nodes = [imageNode("a", "fal", falImageModel)];
    const billed = creditCostForRun({ kind: "image", provider: "fal", modelId: falImageModel, resolution: "1K" });
    expect(headerCredits(nodes)).toBe(billed);
  });

  it("matches for several identical nodes — the rounding case", () => {
    if (!falImageModel) return;
    const nodes = [
      imageNode("a", "fal", falImageModel),
      imageNode("b", "fal", falImageModel),
      imageNode("c", "fal", falImageModel),
    ];
    const perNode = creditCostForRun({ kind: "image", provider: "fal", modelId: falImageModel, resolution: "1K" });

    // The bug this replaces: converting a summed dollar figure gave a smaller
    // number than billing three nodes individually, because each node's charge
    // is rounded up on its own.
    expect(headerCredits(nodes)).toBe(perNode * 3);
  });

  it("matches for a mixed workflow", () => {
    if (!falImageModel) return;
    const nodes = [
      imageNode("a", "fal", falImageModel),
      imageNode("b", "gemini", "nano-banana-pro", "4K"),
      imageNode("c", "gemini", "nano-banana-pro", "1K"),
    ];
    const billed =
      creditCostForRun({ kind: "image", provider: "fal", modelId: falImageModel, resolution: "1K" }) +
      creditCostForRun({ kind: "image", provider: "gemini", modelId: "nano-banana-pro", resolution: "4K" }) +
      creditCostForRun({ kind: "image", provider: "gemini", modelId: "nano-banana-pro", resolution: "1K" });

    expect(headerCredits(nodes)).toBe(billed);
  });
});

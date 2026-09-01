/**
 * The estimate is the only cost figure a user sees before spending anything,
 * so the failure that matters is quoting a number that the first run then
 * disagrees with — either by pricing an unknown model at nothing, or by
 * missing a multiplier the gate applies.
 *
 * That the totals match the gate exactly is asserted in
 * estimateMatchesBilling.test.ts. This file covers the walk itself.
 */

import { describe, it, expect } from "vitest";
import { estimateWorkflow } from "../estimate";

function node(type: string, data: Record<string, unknown> = {}) {
  return { id: `${type}-1`, type, data };
}

function gemini(overrides: Record<string, unknown> = {}) {
  return {
    selectedModel: { provider: "gemini", modelId: "nano-banana-pro" },
    resolution: "1K",
    ...overrides,
  };
}

describe("estimateWorkflow — which nodes count", () => {
  it("ignores nodes that never reach a provider", () => {
    const result = estimateWorkflow([
      node("prompt"),
      node("imageInput"),
      node("annotation"),
      node("splitGrid"),
      node("output"),
      node("outputGallery"),
      node("videoStitch"),
      node("router"),
    ]);
    expect(result).toMatchObject({ credits: 0, billableNodes: 0, partial: false });
  });

  it("counts every generation node type", () => {
    const result = estimateWorkflow([
      node("nanoBanana", gemini()),
      node("generateVideo", gemini()),
      node("generateAudio", gemini()),
      node("generate3d", gemini()),
      node("llmGenerate", { model: "gemini-2.5-flash" }),
      node("comfyApp", gemini()),
    ]);
    expect(result.billableNodes).toBe(6);
  });

  it("prices an empty graph at nothing rather than failing", () => {
    expect(estimateWorkflow([])).toMatchObject({ credits: 0, durationMs: 0 });
  });

  it("survives junk in the node list", () => {
    const result = estimateWorkflow([null, undefined, 42, "node", {}, { type: null }]);
    expect(result.billableNodes).toBe(0);
  });

  it("survives a graph that is not an array at all", () => {
    expect(estimateWorkflow(null).credits).toBe(0);
    expect(estimateWorkflow({ nodes: [] }).credits).toBe(0);
  });
});

describe("estimateWorkflow — the models it reports", () => {
  it("lists each model once, sorted", () => {
    const result = estimateWorkflow([
      node("nanoBanana", gemini()),
      node("nanoBanana", gemini()),
      node("llmGenerate", { model: "gemini-2.5-flash" }),
    ]);
    expect(result.models).toEqual(["gemini-2.5-flash", "nano-banana-pro"]);
  });

  it("reads the llm node's own model field", () => {
    const result = estimateWorkflow([node("llmGenerate", { model: "gpt-4.1-mini" })]);
    expect(result.models).toEqual(["gpt-4.1-mini"]);
  });

  it("prefers selectedModel over the legacy model field", () => {
    const result = estimateWorkflow([
      node("nanoBanana", {
        selectedModel: { provider: "gemini", modelId: "nano-banana-pro" },
        model: "nano-banana",
      }),
    ]);
    expect(result.models).toEqual(["nano-banana-pro"]);
  });
});

describe("estimateWorkflow — the multipliers the gate applies", () => {
  // creditCostForRun multiplies by count, so omitting it under-estimates a
  // four-image node fourfold — a quote the first run would immediately break.
  it("multiplies by a batch count", () => {
    const one = estimateWorkflow([node("nanoBanana", gemini())]).credits;
    const four = estimateWorkflow([
      node("nanoBanana", gemini({ parameters: { num_images: 4 } })),
    ]).credits;
    expect(four).toBe(one * 4);
  });

  it("accepts the other names a batch count travels under", () => {
    const base = estimateWorkflow([node("nanoBanana", gemini())]).credits;
    for (const key of ["num_images", "numImages", "n"]) {
      const result = estimateWorkflow([
        node("nanoBanana", gemini({ parameters: { [key]: 3 } })),
      ]);
      expect(result.credits).toBe(base * 3);
    }
  });

  it("ignores a nonsensical count rather than zeroing the node", () => {
    const base = estimateWorkflow([node("nanoBanana", gemini())]).credits;
    for (const bad of [0, -2, NaN, "four"]) {
      expect(
        estimateWorkflow([node("nanoBanana", gemini({ parameters: { num_images: bad } }))])
          .credits
      ).toBe(base);
    }
  });

  it("carries resolution, which changes what an image costs", () => {
    const oneK = estimateWorkflow([node("nanoBanana", gemini({ resolution: "1K" }))]);
    const fourK = estimateWorkflow([node("nanoBanana", gemini({ resolution: "4K" }))]);
    expect(fourK.credits).toBeGreaterThan(oneK.credits);
  });
});

describe("estimateWorkflow — duration", () => {
  it("uses the measured median when there is one", () => {
    const result = estimateWorkflow([node("nanoBanana", gemini())], {
      "nano-banana-pro": 4321,
    });
    expect(result.durationMs).toBe(4321);
  });

  it("falls back to the per-kind figure for a model nobody has run", () => {
    const result = estimateWorkflow([node("nanoBanana", gemini())], {
      "some-other-model": 4321,
    });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).not.toBe(4321);
  });

  it("sums across nodes, mixing measured and fallback", () => {
    const measured = estimateWorkflow(
      [node("nanoBanana", gemini()), node("nanoBanana", gemini())],
      { "nano-banana-pro": 5000 }
    );
    expect(measured.durationMs).toBe(10000);
  });

  it("ignores a nonsensical measurement rather than reporting it", () => {
    for (const bad of [0, -100, NaN]) {
      const result = estimateWorkflow([node("nanoBanana", gemini())], {
        "nano-banana-pro": bad as number,
      });
      expect(result.durationMs).toBeGreaterThan(0);
    }
  });

  // A video node must not be estimated at an image node's duration.
  it("gives different run kinds different fallbacks", () => {
    const image = estimateWorkflow([node("nanoBanana", gemini())]).durationMs;
    const video = estimateWorkflow([node("generateVideo", gemini())]).durationMs;
    expect(video).toBeGreaterThan(image);
  });
});

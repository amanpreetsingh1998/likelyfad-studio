import { ModelType, Resolution, MODEL_DISPLAY_NAMES, NanoBananaNodeData, GenerateVideoNodeData, Generate3DNodeData, WorkflowNode, ProviderType, SelectedModel } from "@/types";
import { PRICING_OVERRIDES } from "@/lib/likelyfad/pricing-overrides";
import type { CustomPrice } from "@/store/modelPricingStore";

// Pricing in USD per image (Gemini API)
export const PRICING = {
  "nano-banana": {
    "512": 0.039,
    "1K": 0.039,
    "2K": 0.039, // nano-banana only supports 1K
    "4K": 0.039,
  },
  "nano-banana-pro": {
    "512": 0.134,
    "1K": 0.134,
    "2K": 0.134,
    "4K": 0.24,
  },
  "nano-banana-2": {
    "512": 0.045,
    "1K": 0.067,
    "2K": 0.101,
    "4K": 0.151,
  },
  "nano-banana-2-lite": {
    "512": 0.034,
    "1K": 0.034,
    "2K": 0.034, // nano-banana-2-lite only supports 1K
    "4K": 0.034,
  },
} as const;

/**
 * Per-run cost estimates for LLM models (USD, single turn), assuming roughly
 * 2K input + 1K output tokens.
 *
 * An estimate rather than a measurement: /api/llm does not return token usage,
 * so there is nothing exact to multiply. src/lib/likelyfad/llm-pricing.ts holds
 * the real per-token rate cards for when it does.
 *
 * The longest matching key wins, so "gpt-4o-mini" beats "gpt-4o".
 */
const LLM_RUN_ESTIMATES: Record<string, number> = {
  "gemini-3-pro": 0.025,
  "gemini-3-flash": 0.005,
  "gemini-2.5-pro": 0.015,
  "gemini-2.5-flash": 0.002,
  "gemini-2.0-flash": 0.0015,
  "gemini-1.5-pro": 0.01,
  "gemini-1.5-flash": 0.001,
  "gpt-5": 0.03,
  "gpt-4.1": 0.02,
  "gpt-4o-mini": 0.002,
  "gpt-4o": 0.015,
  "gpt-4": 0.04,
  "o1": 0.05,
  "o3": 0.04,
  "claude-opus-4": 0.06,
  "claude-sonnet-4": 0.02,
  "claude-haiku-4": 0.003,
  "claude-3-5-sonnet": 0.018,
  "claude-3-5-haiku": 0.003,
  "claude-3-opus": 0.06,
  "claude-3-sonnet": 0.018,
  "claude-3-haiku": 0.002,
};

/** Used when an LLM model is not in the table — mid-range, never zero. */
const LLM_FALLBACK_RUN_COST = 0.01;

/**
 * Seconds assumed for a per-second model when the node carries no duration.
 * Most video models default to a 5s clip.
 */
export const ASSUMED_VIDEO_SECONDS = 5;

export function estimateLlmRunCost(model: string | undefined): number {
  if (!model) return LLM_FALLBACK_RUN_COST;
  const key = model.toLowerCase();
  let best: { match: string; cost: number } | null = null;
  for (const [k, cost] of Object.entries(LLM_RUN_ESTIMATES)) {
    if (key.includes(k) && (!best || k.length > best.match.length)) {
      best = { match: k, cost };
    }
  }
  return best?.cost ?? LLM_FALLBACK_RUN_COST;
}

export function calculateGenerationCost(model: ModelType, resolution: Resolution): number {
  // nano-banana and nano-banana-2-lite only support 1K resolution (flat pricing)
  if (model === "nano-banana" || model === "nano-banana-2-lite") {
    return PRICING[model]["1K"];
  }
  return PRICING[model][resolution];
}

/**
 * Pricing info for external provider models
 */
export interface ModelPricing {
  unitCost: number;
  unit: string;  // "image", "video", "second", etc.
}

/**
 * Get cost info from ProviderModel pricing field
 * Returns null if pricing is unavailable (e.g., Replicate has no pricing API)
 */
export function getModelCost(pricing: { type: 'per-run' | 'per-second'; amount: number } | null | undefined): ModelPricing | null {
  if (!pricing) return null;
  return {
    unitCost: pricing.amount,
    unit: pricing.type === 'per-run' ? 'image' : 'second',
  };
}

/**
 * Cost breakdown item supporting multiple providers
 */
export interface CostBreakdownItem {
  provider: ProviderType;
  modelId: string;
  modelName: string;
  count: number;
  unitCost: number | null;  // null means pricing unavailable
  unit: string;  // "image", "video", "second", etc.
  subtotal: number | null;  // null if unitCost is null
}

/**
 * Result of predicted cost calculation
 */
export interface PredictedCostResult {
  totalCost: number;  // Only includes known pricing
  breakdown: CostBreakdownItem[];
  nodeCount: number;
  unknownPricingCount: number;  // Count of items without pricing
}

/**
 * Legacy cost breakdown item for backward compatibility
 * @deprecated Use CostBreakdownItem instead
 */
export interface LegacyCostBreakdownItem {
  model: ModelType;
  resolution: Resolution;
  count: number;
  unitCost: number;
  subtotal: number;
}

export interface PredictedCostOptions {
  /**
   * Prices the user typed in themselves, by modelId. Highest priority, because
   * for fal and Replicate models it is usually the only price that exists.
   *
   * Passed in rather than read from the store: this stays a pure function of
   * its arguments, so callers control when the number changes and the result
   * is trivially testable.
   */
  customPrices?: Record<string, CustomPrice>;
  /** Externally fetched pricing by modelId. */
  modelPricing?: Map<string, ModelPricing>;
}

/**
 * Cost of running every credit-spending node in the workflow once.
 *
 * Covers image, video, audio and 3D generation plus LLM nodes. ComfyUI runs
 * are excluded — their cost depends on the backend, and nothing reports it.
 *
 * @returns total, a per-model breakdown, and how many nodes had no price
 */
export function calculatePredictedCost(
  nodes: WorkflowNode[],
  options: PredictedCostOptions = {}
): PredictedCostResult {
  const { customPrices, modelPricing } = options;
  // Group by provider + modelId for breakdown
  const breakdown: Map<string, CostBreakdownItem> = new Map();
  let nodeCount = 0;
  let unknownPricingCount = 0;

  /**
   * Helper to add an item to the breakdown map
   */
  function addToBreakdown(
    provider: ProviderType,
    modelId: string,
    modelName: string,
    unit: string,
    unitCost: number | null,
    count: number = 1
  ) {
    const key = `${provider}:${modelId}`;
    const existing = breakdown.get(key);
    if (existing) {
      existing.count += count;
      if (existing.subtotal !== null && unitCost !== null) {
        existing.subtotal += count * unitCost;
      }
    } else {
      breakdown.set(key, {
        provider,
        modelId,
        modelName,
        count,
        unitCost,
        unit,
        subtotal: unitCost !== null ? count * unitCost : null,
      });
    }
    nodeCount += count;
    if (unitCost === null) {
      unknownPricingCount += count;
    }
  }

  /**
   * Price for one run of a model, in the order the sources can be trusted.
   *
   * 1. A price the user typed in the cost dialog. Beats everything — fal and
   *    Replicate publish no prices at all, so for most of their catalogue this
   *    is the only source there will ever be.
   * 2. The node's own `selectedModel.pricing`, captured from the registry when
   *    the model was picked. The only fetched source that survives into a
   *    saved workflow.
   * 3. PRICING_OVERRIDES, the prices checked into the repo.
   * 4. The caller's map, if one was passed.
   * 5. The hardcoded Gemini table, which is all the legacy `data.model` path
   *    has to go on.
   *
   * A per-second model is converted to a per-run figure here, because the
   * caller wants "what does one run cost", not a rate.
   */
  function getPricing(
    provider: ProviderType,
    modelId: string,
    resolution?: Resolution,
    selected?: SelectedModel,
    seconds?: number
  ): { unitCost: number; unit: string } | null {
    const perSecondToRun = (amount: number) => ({
      unitCost: amount * (seconds ?? ASSUMED_VIDEO_SECONDS),
      unit: "run",
    });

    const custom = customPrices?.[modelId];
    if (custom && isFinite(custom.amount)) {
      return custom.type === "per-second"
        ? perSecondToRun(custom.amount)
        : { unitCost: custom.amount, unit: "run" };
    }

    if (selected?.pricing) {
      return selected.pricing.type === "per-second"
        ? perSecondToRun(selected.pricing.amount)
        : { unitCost: selected.pricing.amount, unit: "run" };
    }

    const override = PRICING_OVERRIDES[modelId];
    if (override) return { unitCost: override.amount, unit: "run" };

    if (modelPricing?.has(modelId)) {
      const external = modelPricing.get(modelId)!;
      return external.unit === "second"
        ? perSecondToRun(external.unitCost)
        : external;
    }

    // Fallback to hardcoded Gemini pricing for legacy models
    if (provider === "gemini") {
      if (modelId === "nano-banana" || modelId === "gemini-2.5-flash-image") {
        return { unitCost: PRICING["nano-banana"]["1K"], unit: "image" };
      }
      if (modelId === "nano-banana-pro" || modelId === "gemini-3-pro-image-preview") {
        const res = resolution || "1K";
        return { unitCost: PRICING["nano-banana-pro"][res], unit: "image" };
      }
      if (modelId === "nano-banana-2" || modelId === "gemini-3.1-flash-image-preview") {
        const res = resolution || "1K";
        return { unitCost: PRICING["nano-banana-2"][res], unit: "image" };
      }
      if (modelId === "nano-banana-2-lite" || modelId === "gemini-3.1-flash-lite-image") {
        // 1K-only flat pricing, like nano-banana — resolution is ignored
        return { unitCost: PRICING["nano-banana-2-lite"]["1K"], unit: "image" };
      }
    }

    // No pricing available (e.g., Replicate)
    return null;
  }

  /** Seconds a per-second model would bill for, if the node says. */
  function durationOf(data: Record<string, unknown>): number | undefined {
    const params = data.parameters as Record<string, unknown> | undefined;
    const raw = params?.duration ?? params?.duration_seconds ?? params?.seconds;
    const n = typeof raw === "string" ? Number(raw) : raw;
    return typeof n === "number" && isFinite(n) && n > 0 ? n : undefined;
  }

  nodes.forEach((node) => {
    // Handle nanoBanana (image generation) nodes
    if (node.type === "nanoBanana") {
      const data = node.data as NanoBananaNodeData;

      // Determine provider and model info
      let provider: ProviderType;
      let modelId: string;
      let modelName: string;

      if (data.selectedModel) {
        // New multi-provider model selection
        provider = data.selectedModel.provider;
        modelId = data.selectedModel.modelId;
        modelName = data.selectedModel.displayName;
      } else {
        // Legacy Gemini-only model
        provider = "gemini";
        modelId = data.model;
        modelName = MODEL_DISPLAY_NAMES[data.model] || data.model;
      }

      const resolution = data.model === "nano-banana" ? "1K" : data.resolution;
      const pricing = getPricing(provider, modelId, resolution, data.selectedModel);
      const unitCost = pricing?.unitCost ?? null;
      const unit = pricing?.unit ?? "image";

      addToBreakdown(provider, modelId, modelName, unit, unitCost);
    }

    // Video, audio and 3D all price the same way: whatever the registry
    // recorded on selectedModel, converted to a per-run figure.
    if (
      node.type === "generateVideo" ||
      node.type === "generateAudio" ||
      node.type === "generate3d"
    ) {
      const data = node.data as GenerateVideoNodeData | Generate3DNodeData;
      const selected = data.selectedModel;
      // No model chosen yet means nothing to price — and nothing will run.
      if (!selected) return;

      const pricing = getPricing(
        selected.provider,
        selected.modelId,
        undefined,
        selected,
        durationOf(node.data as Record<string, unknown>)
      );
      const fallbackUnit =
        node.type === "generateVideo" ? "video" : node.type === "generateAudio" ? "clip" : "model";

      addToBreakdown(
        selected.provider,
        selected.modelId,
        selected.displayName,
        pricing?.unit ?? fallbackUnit,
        pricing?.unitCost ?? null
      );
    }

    // LLM nodes bill per token, and /api/llm does not report usage, so this is
    // an explicit per-run estimate rather than a price. Counted anyway: a graph
    // full of LLM calls is not free, and showing $0 for it would be a lie.
    if (node.type === "llmGenerate") {
      const data = node.data as { model?: string; provider?: string };
      const model = data.model || "unknown";
      const provider: ProviderType = model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")
        ? "openai"
        : model.startsWith("claude")
          ? "anthropic"
          : "gemini";

      addToBreakdown(provider, model, model, "run", estimateLlmRunCost(data.model));
    }

    // SplitGrid cell nodes are real nodes on the canvas (materialized from the
    // cell template), so any generate nodes they contain are already counted
    // above — no separate splitGrid estimate needed.
    //
    // comfyApp runs are deliberately absent: a Comfy graph's cost depends on
    // the backend it runs against (free on a local GPU, credits on Cloud), and
    // nothing in the contract reports a price.
  });

  const breakdownArray = Array.from(breakdown.values());
  const totalCost = breakdownArray.reduce(
    (sum, item) => sum + (item.subtotal ?? 0),
    0
  );

  return {
    totalCost,
    breakdown: breakdownArray,
    nodeCount,
    unknownPricingCount,
  };
}

/**
 * Check whether any generation node in the workflow uses a non-Gemini provider.
 * Used to hide the CostIndicator when pricing data would be incomplete/misleading.
 */
export function hasNonGeminiProviders(nodes: WorkflowNode[]): boolean {
  return nodes.some((node) => {
    if (node.type === "nanoBanana") {
      const data = node.data as NanoBananaNodeData;
      return data.selectedModel?.provider !== undefined && data.selectedModel.provider !== "gemini";
    }
    if (node.type === "generateVideo") {
      const data = node.data as GenerateVideoNodeData;
      return data.selectedModel?.provider !== undefined && data.selectedModel.provider !== "gemini";
    }
    if (node.type === "generate3d") {
      const data = node.data as Generate3DNodeData;
      return data.selectedModel?.provider !== undefined && data.selectedModel.provider !== "gemini";
    }
    if (node.type === "generateAudio") {
      return true; // Audio nodes are always non-Gemini
    }
    return false;
  });
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

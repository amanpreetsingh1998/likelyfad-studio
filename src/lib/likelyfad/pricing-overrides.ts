/**
 * Pricing overrides for external provider models.
 *
 * Some providers (fal.ai, replicate, wavespeed) don't return pricing metadata
 * via their model APIs. This file lets us patch in known prices manually so
 * cost tracking works for those models.
 *
 * Format: modelId → USD price per run.
 *
 * To find prices:
 *   - fal.ai → https://fal.ai/models/<modelId>
 *   - replicate → https://replicate.com/<modelId>
 *   - wavespeed → https://wavespeed.ai
 *
 * After editing this file, prices apply on the NEXT model list refresh
 * (or restart the dev server).
 */

export interface PricingOverride {
  /** Price in USD for one generation/run */
  amount: number;
  /** Optional note shown in cost dialog */
  note?: string;
}

/**
 * Manual pricing map. Key is the exact model `endpoint_id` (fal) or `id` (replicate).
 * Add entries as you confirm pricing from the provider's website.
 */
export const PRICING_OVERRIDES: Record<string, PricingOverride> = {
  // === fal.ai models ===
  // Gemini 3 Pro Image Preview on fal.ai — $0.15/image, 4K outputs charged at 2x ($0.30)
  // NOTE: Cost tracker uses standard rate. If you generate at 4K, actual spend will be ~2x what's shown.
  "fal-ai/gemini-3-pro-image-preview": { amount: 0.15, note: "Gemini 3 Pro via fal.ai ($0.30 at 4K)" },
  // The /edit variant is the image-to-image endpoint — same price.
  "fal-ai/gemini-3-pro-image-preview/edit": { amount: 0.15, note: "Gemini 3 Pro edit via fal.ai" },

  // Kling Video v2.6 Image-to-Video — $0.28/5s, $0.56/10s (using standard rate for 5s)
  "fal-ai/kling-video/v2.6/standard/image-to-video": { amount: 0.28, note: "Kling v2.6 standard 5s" },
  "fal-ai/kling-video/v2.6/pro/image-to-video": { amount: 0.49, note: "Kling v2.6 pro 5s" },

  // Add more entries as needed:
  // "fal-ai/flux/dev": { amount: 0.025 },
  // "fal-ai/flux-pro": { amount: 0.05 },
};

/**
 * Look up an override price for a model. Returns null if no override exists.
 */
export function getPricingOverride(modelId: string): PricingOverride | null {
  return PRICING_OVERRIDES[modelId] || null;
}

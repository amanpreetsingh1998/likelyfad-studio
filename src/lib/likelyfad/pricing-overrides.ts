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
  // Gemini 3 Pro Image Preview on fal.ai — confirm exact price at https://fal.ai/models/fal-ai/gemini-3-pro-image-preview
  "fal-ai/gemini-3-pro-image-preview": { amount: 0.134, note: "Gemini 3 Pro via fal.ai" },

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

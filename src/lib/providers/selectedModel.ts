/**
 * ProviderModel (what the registry returns) → SelectedModel (what a node stores).
 *
 * There is one job here that is easy to forget and silent when forgotten:
 * carrying `pricing` across. Every cost figure in the app reads it off the
 * node, because by the time a run finishes the registry entry is long gone.
 * Each of the five places that used to build this object by hand omitted it,
 * so `selectedModel.pricing` was permanently undefined and every non-Gemini
 * generation was billed to the user at $0. Build the object here instead.
 */

import type { ProviderModel } from "./types";
import type { SelectedModel, SelectedModelPricing } from "@/types/providers";

/** Drops `currency` — everything in the app is USD, and the node data is saved. */
function toPricing(pricing: ProviderModel["pricing"]): SelectedModelPricing | undefined {
  if (!pricing || typeof pricing.amount !== "number") return undefined;
  return { type: pricing.type, amount: pricing.amount };
}

export function toSelectedModel(model: ProviderModel): SelectedModel {
  return {
    provider: model.provider,
    modelId: model.id,
    displayName: model.name,
    capabilities: model.capabilities,
    pricing: toPricing(model.pricing),
  };
}

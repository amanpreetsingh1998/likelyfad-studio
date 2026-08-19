/**
 * Prices the user has filled in by hand, for models nobody publishes a price for.
 *
 * fal.ai, Replicate and WaveSpeed all return model catalogues with no pricing
 * field of any kind — verified against fal's live /v1/models, which carries
 * display_name, category, tags and thumbnails but nothing about money, and has
 * no per-model detail endpoint. So for those providers there is no price to
 * fetch, only a price to be told.
 *
 * src/lib/likelyfad/pricing-overrides.ts is the checked-in half of this: prices
 * that ship with the app. This is the runtime half, editable from the cost
 * dialog, and it wins over everything else — if the user says a model costs
 * this much, that is what their invoice will say.
 */

import { create } from "zustand";

export type PricingUnit = "per-run" | "per-second";

export interface CustomPrice {
  type: PricingUnit;
  amount: number;
}

const STORAGE_KEY = "likelyfad-studio-model-pricing";

function load(): Record<string, CustomPrice> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CustomPrice>;
    // Drop anything malformed rather than letting a bad entry poison a total.
    const clean: Record<string, CustomPrice> = {};
    for (const [id, price] of Object.entries(parsed)) {
      if (
        price &&
        typeof price.amount === "number" &&
        isFinite(price.amount) &&
        price.amount >= 0 &&
        (price.type === "per-run" || price.type === "per-second")
      ) {
        clean[id] = price;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function persist(prices: Record<string, CustomPrice>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
  } catch {
    // Quota or private mode — the prices stay for this session.
  }
}

interface ModelPricingState {
  prices: Record<string, CustomPrice>;
  /** Re-read from localStorage. Call once on mount; load() is SSR-safe but empty on the server. */
  hydrate: () => void;
  setPrice: (modelId: string, price: CustomPrice) => void;
  clearPrice: (modelId: string) => void;
}

export const useModelPricingStore = create<ModelPricingState>((set) => ({
  prices: {},

  hydrate: () => set({ prices: load() }),

  setPrice: (modelId, price) =>
    set((state) => {
      const next = { ...state.prices, [modelId]: price };
      persist(next);
      return { prices: next };
    }),

  clearPrice: (modelId) =>
    set((state) => {
      const next = { ...state.prices };
      delete next[modelId];
      persist(next);
      return { prices: next };
    }),
}));

/** Non-reactive read, for the cost calculator. */
export function getCustomPrice(modelId: string): CustomPrice | null {
  return useModelPricingStore.getState().prices[modelId] ?? null;
}

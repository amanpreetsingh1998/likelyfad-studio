/**
 * Which providers the platform can actually call.
 *
 * This replaces the old per-user API key settings. Keys now live only in the
 * server environment, so "can I use fal?" is no longer a question about what
 * the user pasted into a settings box — it is a question about what the
 * deployment is configured with, and only the server can answer it.
 *
 * /api/env-status reports presence, never the key itself. The answer is stable
 * for the lifetime of the process, so it is fetched once and shared: every
 * generate node subscribes to this, and a fetch per node would be a stampede.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import type { ProviderType } from "@/types";

export type ProviderAvailability = Record<ProviderType, boolean>;

const NONE: ProviderAvailability = {
  gemini: false,
  openai: false,
  anthropic: false,
  replicate: false,
  fal: false,
  kie: false,
  wavespeed: false,
};

/**
 * What the pickers show before the fetch lands.
 *
 * Not a guess at the deployment — it is the set the pickers listed
 * unconditionally when keys were per-user, so starting here means the first
 * paint is identical to the old one and the fetch only ever corrects it.
 * Starting from NONE would blank every model picker for a frame instead.
 */
const OPTIMISTIC: ProviderAvailability = { ...NONE, gemini: true, fal: true };

interface ProviderAvailabilityState {
  available: ProviderAvailability;
  loaded: boolean;
  /** Fetch once. Safe to call from every mounting node; later calls are no-ops. */
  hydrate: () => void;
}

// Module-level rather than store state: two nodes mounting in the same tick
// both see `loaded: false` and would both fire. The promise deduplicates.
let inflight: Promise<void> | null = null;

export const useProviderAvailabilityStore = create<ProviderAvailabilityState>((set) => ({
  available: OPTIMISTIC,
  loaded: false,

  hydrate: () => {
    if (typeof window === "undefined" || inflight) return;
    inflight = fetch("/api/env-status")
      .then((res) => (res.ok ? res.json() : NONE))
      .then((status: Partial<ProviderAvailability>) => {
        set({ available: { ...NONE, ...status }, loaded: true });
      })
      .catch(() => {
        // Leaving `loaded` false keeps the pickers showing their built-in
        // defaults rather than claiming every provider is unavailable.
        inflight = null;
      });
  },
}));

/**
 * Availability, fetched on first mount.
 *
 * Shallow-compared so a node re-renders when a provider's availability
 * actually flips, not on every unrelated store write.
 */
export function useAvailableProviders(): ProviderAvailability & { loaded: boolean } {
  const hydrate = useProviderAvailabilityStore((state) => state.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return useProviderAvailabilityStore(
    useShallow((state) => ({ ...state.available, loaded: state.loaded }))
  );
}

/** Non-reactive read, for code outside React. */
export function isProviderAvailable(provider: ProviderType): boolean {
  return useProviderAvailabilityStore.getState().available[provider] ?? false;
}

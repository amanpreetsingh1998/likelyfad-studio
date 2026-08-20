/**
 * The user's credit balance, shared by the header badge and the buy modal.
 *
 * A separate store from workflowStore because it is account state, not canvas
 * state: workflowStore's contents get serialised into saved workflow files,
 * and a balance has no business travelling with a workflow.
 */

import { create } from "zustand";
import type { CreditPack } from "@/lib/credits/pricing";

export type LedgerEntry = {
  id: string;
  amount: number;
  kind: string;
  reason: string | null;
  created_at: string;
};

type CreditState = {
  balance: number | null;
  transactions: LedgerEntry[];
  packs: CreditPack[];
  signupGrant: number;
  purchaseEnabled: boolean;
  loading: boolean;
  error: string | null;
  /** Open state of the buy-credits modal. */
  buyModalOpen: boolean;
  /** Set when a run is refused, so the modal can say why it opened. */
  shortfall: { required: number; balance: number } | null;

  refresh: () => Promise<void>;
  setBalance: (balance: number) => void;
  openBuyModal: (shortfall?: { required: number; balance: number }) => void;
  closeBuyModal: () => void;
};

export const useCreditStore = create<CreditState>((set, get) => ({
  balance: null,
  transactions: [],
  packs: [],
  signupGrant: 0,
  purchaseEnabled: false,
  loading: false,
  error: null,
  buyModalOpen: false,
  shortfall: null,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const response = await fetch("/api/credits", { cache: "no-store" });
      if (response.status === 401) {
        // Signed out. Not an error worth showing — the badge just hides.
        set({ balance: null, loading: false });
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      set({
        balance: data.balance ?? 0,
        transactions: data.transactions ?? [],
        packs: data.packs ?? [],
        signupGrant: data.signupGrant ?? 0,
        purchaseEnabled: Boolean(data.purchaseEnabled),
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Could not load credits",
        loading: false,
      });
    }
  },

  setBalance: (balance) => set({ balance }),

  openBuyModal: (shortfall) => set({ buyModalOpen: true, shortfall: shortfall ?? null }),
  closeBuyModal: () => set({ buyModalOpen: false, shortfall: null }),
}));

/**
 * Read the balance the server stamped on a generation response.
 *
 * Every gated route sends it, so the badge stays current through a run without
 * a second round trip. Call this from an executor right after its fetch.
 */
export function syncBalanceFromResponse(response: Response): void {
  const header = response.headers.get("X-Credits-Balance");
  if (!header) return;
  const balance = Number(header);
  if (Number.isFinite(balance)) {
    useCreditStore.getState().setBalance(balance);
  }
}

/**
 * Handle a 402 from a generation route: open the buy modal with the numbers
 * the server reported. Returns the message to surface on the node.
 */
export function handleInsufficientCredits(payload: {
  required?: number;
  balance?: number;
  error?: string;
}): string {
  const required = payload.required ?? 0;
  const balance = payload.balance ?? 0;
  useCreditStore.getState().openBuyModal({ required, balance });
  useCreditStore.getState().setBalance(balance);
  return payload.error ?? `Not enough credits (need ${required}, have ${balance}).`;
}

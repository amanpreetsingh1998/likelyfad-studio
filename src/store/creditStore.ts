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
  /** What the last finished workflow cost, for the run receipt. */
  lastReceipt: { charged: number; runs: number; status: string } | null;

  refresh: () => Promise<void>;
  setBalance: (balance: number) => void;
  setLastReceipt: (receipt: { charged: number; runs: number; status: string } | null) => void;
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
  lastReceipt: null,

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

  setLastReceipt: (lastReceipt) => set({ lastReceipt }),

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

/**
 * Bill the workflow that just finished.
 *
 * Called from executeWorkflow's exit paths. The server owns the amount — this
 * only says "the run is over". Failures are swallowed: an unsettled run is lost
 * revenue, not a reason to show the user an error about a workflow that worked.
 *
 * `runId` bills that one execution and closes its run row, so the ledger and
 * the history page get one line per workflow rather than one per "everything
 * this user owed at that moment". It is a grouping key: it selects which rows
 * to bill and cannot change what they cost. Without one the server falls back
 * to settling everything unsettled, which is what happened before runs existed
 * and is still correct — just less legible in the history.
 */
export async function settleRun(
  status: "completed" | "failed" | "cancelled",
  runId?: string | null
): Promise<void> {
  try {
    const response = await fetch("/api/credits/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runId ? { status, runId } : { status }),
    });
    if (!response.ok) return;

    const result = await response.json();
    useCreditStore.getState().setBalance(result.balance);

    if (result.charged > 0) {
      useCreditStore.getState().setLastReceipt({
        charged: result.charged,
        runs: result.runs,
        status,
      });
    }
  } catch {
    // Offline, or the tab is going away. Nothing useful to do here.
  }
}

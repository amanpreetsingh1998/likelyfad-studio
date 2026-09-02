/**
 * The user's credit balance, shared by the header badge and the buy modal.
 *
 * A separate store from workflowStore because it is account state, not canvas
 * state: workflowStore's contents get serialised into saved workflow files,
 * and a balance has no business travelling with a workflow.
 *
 * TWO NUMBERS, NOT ONE
 *
 * `balance` is the ledger figure — what the database says the account holds.
 * `pending` is what has been run up since the last settlement and not yet
 * debited. What a user can actually spend is the difference, and that is what
 * the UI must show.
 *
 * Keeping only one number here is what produced "my credits come back when I
 * refresh". Mid-run the badge was fed `balance - pending` from a response
 * header, and `GET /api/credits` answered with the raw `balance` — so a reload
 * silently undid every deduction on screen. The two sources did not disagree
 * about money; they disagreed about which question they were answering.
 * Both now report both numbers, and `availableCredits()` is the only thing
 * anything renders.
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

/** Runs whose settlement never reached the server, kept across reloads. */
const UNSETTLED_KEY = "likelyfad-studio-unsettled-runs";

type CreditState = {
  /** The ledger balance. NOT what is spendable — see `pending`. */
  balance: number | null;
  /** Credits run up and not yet debited. Subtract before showing anything. */
  pending: number;
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
  /** Set when settlement could not be delivered, so the UI can say so. */
  settleError: string | null;

  refresh: () => Promise<void>;
  setBalance: (balance: number, pending?: number) => void;
  setLastReceipt: (receipt: { charged: number; runs: number; status: string } | null) => void;
  openBuyModal: (shortfall?: { required: number; balance: number }) => void;
  closeBuyModal: () => void;
};

export const useCreditStore = create<CreditState>((set, get) => ({
  balance: null,
  pending: 0,
  transactions: [],
  packs: [],
  signupGrant: 0,
  purchaseEnabled: false,
  loading: false,
  error: null,
  buyModalOpen: false,
  shortfall: null,
  lastReceipt: null,
  settleError: null,

  refresh: async () => {
    // A refresh that arrives while one is in flight used to return without
    // doing anything, which quietly dropped the reconciliation fired right
    // after settlement — the one refresh whose whole job is to correct the
    // number on screen. Overlapping fetches are cheap; a stale balance is not.
    set({ loading: true, error: null });
    try {
      const response = await fetch("/api/credits", { cache: "no-store" });
      if (response.status === 401) {
        // Signed out. Not an error worth showing — the badge just hides.
        set({ balance: null, pending: 0, loading: false });
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      set({
        balance: data.balance ?? 0,
        pending: data.pending ?? 0,
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

  setBalance: (balance, pending) =>
    set(pending === undefined ? { balance } : { balance, pending }),

  setLastReceipt: (lastReceipt) => set({ lastReceipt }),

  openBuyModal: (shortfall) => set({ buyModalOpen: true, shortfall: shortfall ?? null }),
  closeBuyModal: () => set({ buyModalOpen: false, shortfall: null }),
}));

/**
 * What the account can actually spend right now.
 *
 * The one figure any surface should render. Null while the balance is still
 * unknown, so a caller can tell "not loaded yet" from "nothing left" — a badge
 * that flashes 0 at someone who has plenty reads as a charge they did not make.
 */
export function availableCredits(state: {
  balance: number | null;
  pending: number;
}): number | null {
  if (state.balance === null) return null;
  return Math.max(0, state.balance - state.pending);
}

/**
 * Read the balance the server stamped on a generation response.
 *
 * Every gated route sends both figures, so the badge stays current through a
 * run without a second round trip. Call this from an executor right after its
 * fetch.
 *
 * `X-Credits-Balance` is the *available* figure (ledger minus pending) and
 * `X-Credits-Pending` is the pending total, so the ledger balance is their
 * sum. That is worth stating rather than inferring: the header name says
 * "balance" and means something narrower, and reading it as the ledger figure
 * is precisely the mix-up this store exists to prevent.
 */
export function syncBalanceFromResponse(response: Response): void {
  const availableHeader = response.headers.get("X-Credits-Balance");
  if (!availableHeader) return;
  const available = Number(availableHeader);
  if (!Number.isFinite(available)) return;

  const pendingHeader = Number(response.headers.get("X-Credits-Pending"));
  const pending = Number.isFinite(pendingHeader) ? pendingHeader : 0;

  useCreditStore.getState().setBalance(available + pending, pending);
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
  // The route's `balance` here is the *available* figure — it is what the
  // affordability check compared against. Recorded as such rather than being
  // written over the ledger balance, which would make the badge jump the
  // moment a run was refused.
  const available = payload.balance ?? 0;
  const store = useCreditStore.getState();
  store.openBuyModal({ required, balance: available });
  store.setBalance(available + store.pending, store.pending);
  return payload.error ?? `Not enough credits (need ${required}, have ${available}).`;
}

/**
 * Bill the workflow that just finished.
 *
 * Called from every execution path's exit. The server owns the amount — this
 * only says "the run is over".
 *
 * FAILURES ARE NO LONGER SWALLOWED. They used to be, on the reasoning that an
 * unsettled run is lost revenue rather than the user's problem. That reasoning
 * held; the silence around it did not. Settlement had been failing in the
 * database on every call that had something to bill, for a month, and this
 * function's `if (!response.ok) return` is the reason nobody found out: every
 * run looked like it had settled, and the balance quietly reappeared on the
 * next reload.
 *
 * So: retry a few times, then park the run in localStorage and try again on
 * the next load. Still never throws at the caller — a workflow that produced
 * images must not report itself as failed because the invoice did not send.
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
  const delivered = await postSettlement(status, runId ?? null, 3);

  if (!delivered) {
    // Park it. The next load drains the queue, which also covers the tab that
    // was closed mid-run — previously only the hourly sweep could find those.
    queueUnsettled(status, runId ?? null);
    useCreditStore.getState().setBalance(
      useCreditStore.getState().balance ?? 0,
      useCreditStore.getState().pending
    );
    return;
  }

  // Reconcile against the ledger rather than trusting the arithmetic here.
  // Settling one run does not clear charges belonging to another, so `pending`
  // cannot be assumed to be zero afterwards.
  void useCreditStore.getState().refresh();
}

/**
 * POST the settlement, retrying a transient failure.
 *
 * Returns whether the server accepted it. A 401 is not retried — signing back
 * in is the fix, and hammering the route will not produce a session.
 */
async function postSettlement(
  status: "completed" | "failed" | "cancelled",
  runId: string | null,
  attempts: number
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch("/api/credits/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runId ? { status, runId } : { status }),
      });

      if (response.status === 401) {
        console.error("[credits] settlement refused: not signed in");
        useCreditStore
          .getState()
          .setBalance(useCreditStore.getState().balance ?? 0);
        return false;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // Loud on purpose. This is the exact line that would have surfaced
        // `column reference "balance" is ambiguous` a month earlier.
        console.error(
          `[credits] SETTLEMENT FAILED (HTTP ${response.status}) — this run is unbilled:`,
          detail.slice(0, 500)
        );
        useCreditStore.setState({
          settleError: `Settlement failed (HTTP ${response.status})`,
        });
        // 4xx other than 401 will not improve on a retry; 5xx might.
        if (response.status < 500) return false;
        await backoff(attempt, attempts);
        continue;
      }

      const result = await response.json();
      useCreditStore.setState({ settleError: null });

      if (typeof result.balance === "number") {
        useCreditStore.getState().setBalance(result.balance);
      }
      if (result.charged > 0) {
        useCreditStore.getState().setLastReceipt({
          charged: result.charged,
          runs: result.runs,
          status,
        });
      }
      return true;
    } catch (err) {
      // Offline, or the tab is going away.
      console.error(
        "[credits] settlement request failed:",
        err instanceof Error ? err.message : err
      );
      await backoff(attempt, attempts);
    }
  }
  return false;
}

/**
 * Wait before the next attempt — and not at all after the last one, which
 * would only delay parking the run in the queue.
 */
function backoff(attempt: number, attempts: number): Promise<void> {
  if (attempt >= attempts - 1) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
}

type QueuedSettlement = {
  status: "completed" | "failed" | "cancelled";
  runId: string | null;
};

function readQueue(): QueuedSettlement[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(UNSETTLED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: QueuedSettlement[]): void {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) window.localStorage.removeItem(UNSETTLED_KEY);
    else window.localStorage.setItem(UNSETTLED_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {
    // Private mode, or a full quota. Nothing useful to do.
  }
}

function queueUnsettled(
  status: "completed" | "failed" | "cancelled",
  runId: string | null
): void {
  const queue = readQueue();
  // A run id appears once. Re-queuing the same run would settle it twice —
  // harmless at the database (the second call finds nothing) but it would
  // grow the queue without bound on a persistent outage.
  if (runId && queue.some((entry) => entry.runId === runId)) return;
  queue.push({ status, runId });
  writeQueue(queue);
}

/**
 * Retry every settlement that never reached the server.
 *
 * Called once on load. This is what bills the run whose tab was closed
 * mid-execution, and the run whose settlement lost the network — both of which
 * previously waited on the hourly maintenance sweep, which is only running if
 * somebody wired up a scheduler.
 */
export async function drainUnsettledRuns(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;

  // Cleared up front so a failure inside the loop cannot leave a duplicate
  // behind; anything that still fails is re-queued by settleRun.
  writeQueue([]);

  for (const entry of queue) {
    const delivered = await postSettlement(entry.status, entry.runId, 2);
    if (!delivered) queueUnsettled(entry.status, entry.runId);
  }

  void useCreditStore.getState().refresh();
}

/**
 * Best-effort settlement for a run the page is navigating away from.
 *
 * `sendBeacon` is the only request that reliably survives an unload, so this
 * is deliberately fire-and-forget with no way to read the result. If the
 * beacon is refused the run is parked in the queue instead, and the next load
 * settles it.
 *
 * Closing the tab mid-run is the leak the docs describe as "swept, not fixed
 * at the source". This is the source.
 */
export function settleOnUnload(
  status: "completed" | "failed" | "cancelled",
  runId: string | null
): void {
  if (typeof navigator === "undefined") return;
  const body = JSON.stringify(runId ? { status, runId } : { status });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/credits/settle", blob)) return;
  } catch {
    // Fall through to the queue.
  }
  queueUnsettled(status, runId);
}

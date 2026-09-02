"use client";

/**
 * Header balance readout, and the way into the buy modal.
 *
 * Renders nothing until the first fetch resolves, rather than flashing a zero
 * at a user who has plenty — a balance that appears to be 0 for a moment reads
 * as "I have been charged for something".
 *
 * Shows the SPENDABLE figure, ledger minus unsettled charges. Showing the
 * ledger balance is what made credits appear to come back on a reload: a run
 * counted the badge down against charges the reload then ignored.
 *
 * Also where the unsettled-run queue is drained, because this component mounts
 * once, early, on every signed-in page. A run whose tab was closed mid-flight
 * gets billed here rather than waiting on the hourly maintenance sweep.
 */

import { useEffect } from "react";
import {
  availableCredits,
  drainUnsettledRuns,
  useCreditStore,
} from "@/store/creditStore";

export function CreditBadge() {
  const balance = useCreditStore(availableCredits);
  const loading = useCreditStore((s) => s.loading);
  const openBuyModal = useCreditStore((s) => s.openBuyModal);
  const refresh = useCreditStore((s) => s.refresh);
  const settleError = useCreditStore((s) => s.settleError);

  useEffect(() => {
    // Settle first, then read: draining ends in its own refresh, so a queued
    // run is reflected in the number this badge paints rather than a stale one
    // the user watches correct itself a moment later.
    void drainUnsettledRuns().then(() => refresh());
  }, [refresh]);

  if (balance === null) {
    return loading ? (
      <span className="text-neutral-500 tabular-nums">···</span>
    ) : null;
  }

  // Under a couple of runs' worth, the number itself is the warning.
  const low = balance < 20;

  // A run that could not be billed is shown, not swallowed. The whole reason
  // settlement stayed broken for a month is that every failure was silent and
  // the balance simply reappeared on the next reload — which reads as a bug in
  // the number rather than a bug in the billing.
  const unbilled = settleError !== null;

  return (
    <button
      onClick={() => openBuyModal()}
      title={
        unbilled
          ? `${settleError}. The last run has not been billed yet — it will be retried automatically.`
          : `${balance.toLocaleString()} credits — click to buy more`
      }
      className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
        unbilled
          ? "text-red-300 border-red-500/40 bg-red-500/10 hover:bg-red-500/20"
          : low
          ? "text-amber-300 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
          : "text-neutral-300 border-neutral-600 bg-neutral-700/40 hover:bg-neutral-700"
      }`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 7.5v9M14.5 9.75a2.5 2.5 0 00-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.8 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.5 2.5 0 01-2.5-1.5" />
      </svg>
      <span className="tabular-nums font-medium">{balance.toLocaleString()}</span>
      {unbilled && (
        <span className="text-[10px] font-medium uppercase tracking-wide">
          unbilled
        </span>
      )}
    </button>
  );
}

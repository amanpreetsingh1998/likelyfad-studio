"use client";

/**
 * Header balance readout, and the way into the buy modal.
 *
 * Renders nothing until the first fetch resolves, rather than flashing a zero
 * at a user who has plenty — a balance that appears to be 0 for a moment reads
 * as "I have been charged for something".
 */

import { useEffect } from "react";
import { useCreditStore } from "@/store/creditStore";

export function CreditBadge() {
  const balance = useCreditStore((s) => s.balance);
  const loading = useCreditStore((s) => s.loading);
  const openBuyModal = useCreditStore((s) => s.openBuyModal);
  const refresh = useCreditStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (balance === null) {
    return loading ? (
      <span className="text-neutral-500 tabular-nums">···</span>
    ) : null;
  }

  // Under a couple of runs' worth, the number itself is the warning.
  const low = balance < 20;

  return (
    <button
      onClick={() => openBuyModal()}
      title={`${balance.toLocaleString()} credits — click to buy more`}
      className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
        low
          ? "text-amber-300 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
          : "text-neutral-300 border-neutral-600 bg-neutral-700/40 hover:bg-neutral-700"
      }`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 7.5v9M14.5 9.75a2.5 2.5 0 00-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.8 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.5 2.5 0 01-2.5-1.5" />
      </svg>
      <span className="tabular-nums font-medium">{balance.toLocaleString()}</span>
    </button>
  );
}

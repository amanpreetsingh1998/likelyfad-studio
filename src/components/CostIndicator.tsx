"use client";

import { useState, useMemo, useEffect } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useModelPricingStore } from "@/store/modelPricingStore";
import { calculatePredictedCost, formatCost } from "@/utils/costCalculator";
import { creditsForUsd, formatCreditsAsInr } from "@/lib/credits/rates";
import { CostDialog } from "./CostDialog";

/**
 * Cost of one full run of the workflow, across every provider.
 *
 * This used to hide itself the moment a non-Gemini node appeared, because the
 * old calculation could not price those models — so adding a single fal node
 * made the whole figure disappear. It prices them now, so it stays put; models
 * whose price is genuinely unknown are counted separately and called out
 * rather than silently treated as free.
 */
export function CostIndicator() {
  const [showDialog, setShowDialog] = useState(false);
  const nodes = useWorkflowStore((state) => state.nodes);
  const incurredCost = useWorkflowStore((state) => state.incurredCost);
  const customPrices = useModelPricingStore((state) => state.prices);
  const hydratePrices = useModelPricingStore((state) => state.hydrate);

  // localStorage is unreachable during SSR, so the store starts empty and is
  // filled on mount. Doing it here covers the dialog too, which only ever
  // renders below this component.
  useEffect(() => {
    hydratePrices();
  }, [hydratePrices]);

  const predictedCost = useMemo(() => {
    return calculatePredictedCost(nodes, { customPrices });
  }, [nodes, customPrices]);

  const hasAnyNodes = predictedCost.nodeCount > 0;

  if (!hasAnyNodes && incurredCost === 0) {
    return null;
  }

  const { totalCost, breakdown, unknownPricingCount } = predictedCost;

  // Sum the per-item credit charge rather than converting the summed dollars.
  // Billing rounds each node up to a whole credit, so converting a total would
  // under-report — three $0.005 LLM nodes bill 6 credits but a single
  // conversion of $0.015 shows 4. Same arithmetic as the server, same answer.
  const credits = breakdown.reduce((sum, item) => {
    if (item.subtotal === null || item.unitCost === null) return sum;
    return sum + creditsForUsd(item.unitCost) * item.count;
  }, 0);

  // A trailing "+" is the honest rendering when some models priced as unknown:
  // the real number is this much plus something we cannot name.
  const approximate = unknownPricingCount > 0;

  const title = approximate
    ? `One full run: ~${credits.toLocaleString()} credits (${formatCreditsAsInr(credits)}) · ` +
      `${unknownPricingCount} model${unknownPricingCount === 1 ? "" : "s"} with no published price, not counted. Click for details.`
    : `One full run: ~${credits.toLocaleString()} credits (${formatCreditsAsInr(credits)}) · ` +
      `provider cost ${formatCost(totalCost)}. Click for details.`;

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        title={title}
      >
        <span className="tabular-nums text-neutral-300">
          {credits.toLocaleString()}
          {approximate && "+"} cr
        </span>
        {/* The money equivalent, so the credit figure means something without
            hovering. Secondary weight — credits are what actually moves. */}
        <span className="text-neutral-500">{formatCreditsAsInr(credits)}</span>
        {approximate && (
          <span
            className="text-amber-400/80"
            title={`${unknownPricingCount} unpriced model${unknownPricingCount === 1 ? "" : "s"}`}
          >
            ⚠
          </span>
        )}
      </button>

      {showDialog && (
        <CostDialog
          predictedCost={predictedCost}
          incurredCost={incurredCost}
          onClose={() => setShowDialog(false)}
        />
      )}
    </>
  );
}

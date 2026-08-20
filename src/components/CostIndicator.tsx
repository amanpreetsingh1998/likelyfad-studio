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

  const { totalCost, unknownPricingCount } = predictedCost;
  // Credits are the unit the user is billed in, so they are the unit shown.
  // Dollars were the old display and never matched the balance that actually
  // moved — same run, two numbers, no stated relationship between them.
  const credits = totalCost > 0 ? creditsForUsd(totalCost) : 0;
  const displayCost = `${credits.toLocaleString()} cr`;
  // A trailing "+" is the honest rendering when some models priced as unknown:
  // the real number is this much plus something we cannot name.
  const approximate = unknownPricingCount > 0;

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="px-2 py-0.5 rounded text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        title={
          approximate
            ? `Estimated cost of one full run: ~${credits} credits (${formatCreditsAsInr(credits)}) — ${unknownPricingCount} model${unknownPricingCount === 1 ? " has" : "s have"} no published price. Click for details.`
            : `Estimated cost of one full run: ~${credits} credits (${formatCreditsAsInr(credits)}, provider cost ${formatCost(totalCost)}). Click for details.`
        }
      >
        {displayCost}
        {approximate && "+"}
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

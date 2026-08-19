"use client";

import { useEffect, useState } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useModelPricingStore, type PricingUnit } from "@/store/modelPricingStore";
import { PredictedCostResult, CostBreakdownItem, formatCost } from "@/utils/costCalculator";
import { ProviderType } from "@/types/providers";

interface CostDialogProps {
  predictedCost: PredictedCostResult;
  incurredCost: number;
  onClose: () => void;
}

/**
 * Provider icon component - colored dot with provider indicator
 */
function ProviderIcon({ provider }: { provider: ProviderType }) {
  const colors: Record<ProviderType, { bg: string; text: string }> = {
    gemini: { bg: "bg-green-500/20", text: "text-green-300" },
    fal: { bg: "bg-purple-500/20", text: "text-purple-300" },
    replicate: { bg: "bg-blue-500/20", text: "text-blue-300" },
    openai: { bg: "bg-teal-500/20", text: "text-teal-300" },
    anthropic: { bg: "bg-amber-500/20", text: "text-amber-300" },
    kie: { bg: "bg-orange-500/20", text: "text-orange-300" },
    wavespeed: { bg: "bg-purple-500/20", text: "text-purple-300" },
  };

  const labels: Record<ProviderType, string> = {
    gemini: "G",
    fal: "f",
    replicate: "R",
    openai: "O",
    anthropic: "A",
    kie: "K",
    wavespeed: "W",
  };

  const color = colors[provider] || colors.gemini;

  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${color.bg} ${color.text} text-xs font-medium`}>
      {labels[provider]}
    </span>
  );
}

/**
 * Get display name for provider
 */
function getProviderDisplayName(provider: ProviderType): string {
  const names: Record<ProviderType, string> = {
    gemini: "Gemini",
    fal: "fal.ai",
    replicate: "Replicate",
    openai: "OpenAI",
    anthropic: "Anthropic",
    kie: "Kie.ai",
    wavespeed: "WaveSpeed",
  };
  return names[provider] || provider;
}

/**
 * Get model page URL for external providers
 */
function getModelUrl(provider: ProviderType, modelId: string): string | null {
  if (provider === "replicate") {
    // modelId format: "owner/model" or "owner/model:version"
    const baseModelId = modelId.split(":")[0];
    return `https://replicate.com/${baseModelId}`;
  }
  if (provider === "fal") {
    // modelId format: "fal-ai/flux/dev" or similar
    return `https://fal.ai/models/${modelId}`;
  }
  if (provider === "wavespeed") {
    // modelId format: "wavespeed-ai/model-name"
    return `https://wavespeed.ai`;
  }
  return null;
}

/**
 * External link icon component
 */
function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

/**
 * Lets the user supply the price for a model nobody publishes one for.
 *
 * fal.ai and Replicate return catalogues with no pricing field at all, so for
 * most of their models this input is the only way the number can ever become
 * right. Deliberately placed on the row that reads "price?" — the moment you
 * notice the gap is the moment you can close it.
 */
function PriceInput({ modelId, unit }: { modelId: string; unit: string }) {
  const setPrice = useModelPricingStore((s) => s.setPrice);
  const [value, setValue] = useState("");
  const [type, setType] = useState<PricingUnit>(
    unit === "second" || unit === "video" ? "per-second" : "per-run"
  );

  const commit = () => {
    const amount = Number(value);
    if (!value.trim() || !isFinite(amount) || amount < 0) return;
    setPrice(modelId, { type, amount });
    setValue("");
  };

  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="text-neutral-600">$</span>
      <input
        type="number"
        min="0"
        step="0.001"
        value={value}
        placeholder="price?"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-right text-xs text-neutral-200 outline-none focus:border-neutral-500"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as PricingUnit)}
        className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs text-neutral-400 outline-none focus:border-neutral-500"
      >
        <option value="per-run">/run</option>
        <option value="per-second">/sec</option>
      </select>
    </span>
  );
}

export function CostDialog({ predictedCost, incurredCost, onClose }: CostDialogProps) {
  const resetIncurredCost = useWorkflowStore((state) => state.resetIncurredCost);
  const customPrices = useModelPricingStore((s) => s.prices);
  const clearPrice = useModelPricingStore((s) => s.clearPrice);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleReset = () => {
    if (confirm("Reset incurred cost to $0.00?")) {
      resetIncurredCost();
    }
  };

  // Grouped by provider — no longer split into "Gemini" and "the rest", since
  // every provider is priced now. What separates an item is whether we have a
  // price for it at all.
  const byProvider = new Map<ProviderType, CostBreakdownItem[]>();
  predictedCost.breakdown.forEach((item) => {
    const existing = byProvider.get(item.provider);
    if (existing) existing.push(item);
    else byProvider.set(item.provider, [item]);
  });

  // Providers carrying a known price sort first; the priced part of the total
  // is the number people act on.
  const providerEntries = Array.from(byProvider.entries()).sort(
    (a, b) =>
      b[1].reduce((s, i) => s + (i.subtotal ?? 0), 0) -
      a[1].reduce((s, i) => s + (i.subtotal ?? 0), 0)
  );

  const hasAny = predictedCost.breakdown.length > 0;
  const unknownCount = predictedCost.unknownPricingCount;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-neutral-800 rounded-lg p-6 w-[400px] border border-neutral-700 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-100">
            Workflow Costs
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Full-run estimate — the number shown next to the project title */}
          {hasAny && (
            <div className="bg-neutral-900 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm text-neutral-300">One full run</span>
                <span className="text-lg font-semibold text-green-400">
                  {formatCost(predictedCost.totalCost)}
                  {unknownCount > 0 && "+"}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mb-3">
                {predictedCost.nodeCount} node{predictedCost.nodeCount !== 1 ? "s" : ""} that
                spend API credits, counted once each
              </p>

              <div className="space-y-3">
                {providerEntries.map(([provider, items]) => {
                  const providerTotal = items.reduce(
                    (sum, item) => sum + (item.subtotal ?? 0),
                    0
                  );
                  return (
                    <div key={provider}>
                      <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
                        <ProviderIcon provider={provider} />
                        <span>{getProviderDisplayName(provider)}</span>
                        <span className="ml-auto text-neutral-300">
                          {formatCost(providerTotal)}
                        </span>
                      </div>
                      <div className="space-y-1 pl-7">
                        {items.map((item, idx) => {
                          const modelUrl = getModelUrl(provider, item.modelId);
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-neutral-500 truncate">
                                {item.count}x {item.modelName}
                              </span>
                              {item.subtotal !== null ? (
                                <span className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-neutral-400">
                                    {formatCost(item.subtotal)}
                                  </span>
                                  {customPrices[item.modelId] && (
                                    <button
                                      type="button"
                                      onClick={() => clearPrice(item.modelId)}
                                      title="You set this price — click to clear it"
                                      className="text-[10px] text-neutral-600 hover:text-red-400 transition-colors"
                                    >
                                      yours ×
                                    </button>
                                  )}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 shrink-0">
                                  {modelUrl && (
                                    <a
                                      href={modelUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Look up this model's price"
                                      className="text-blue-400 hover:text-blue-300 shrink-0"
                                    >
                                      <ExternalLinkIcon />
                                    </a>
                                  )}
                                  <PriceInput modelId={item.modelId} unit={item.unit} />
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {unknownCount > 0 && (
                <p className="text-xs text-amber-500/80 mt-3">
                  {unknownCount} node{unknownCount !== 1 ? "s" : ""} use a model whose
                  provider publishes no price — fal.ai and Replicate return no pricing
                  at all. Type one above and it sticks, for this and every future
                  workflow.
                </p>
              )}
            </div>
          )}

          {/* No nodes message */}
          {predictedCost.nodeCount === 0 && (
            <div className="bg-neutral-900 rounded-lg p-4">
              <p className="text-xs text-neutral-500">
                No nodes in this workflow spend API credits
              </p>
            </div>
          )}

          {/* Actual spend, accumulated as generations complete */}
          <div className="bg-neutral-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-neutral-400">Spent so far</span>
              <span className="text-lg font-semibold text-green-400">
                {formatCost(incurredCost)}
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Charged as each generation completes. LLM and ComfyUI runs are not
              counted here.
            </p>

            {incurredCost > 0 && (
              <button
                onClick={handleReset}
                className="mt-3 text-xs text-neutral-400 hover:text-red-400 transition-colors"
              >
                Reset to $0.00
              </button>
            )}
          </div>

          {/* Pricing Note */}
          <div className="text-xs text-neutral-600">
            <p>
              Estimates assume one run per node. Batch runs, re-runs, 4K output and
              long videos all cost more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

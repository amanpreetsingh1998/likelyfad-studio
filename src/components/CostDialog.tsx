"use client";

import { useEffect, useState } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { PredictedCostResult, CostBreakdownItem, formatCost } from "@/utils/costCalculator";
import { ProviderType } from "@/types/providers";
// === LIKELYFAD CUSTOM START === (48h rolling cost events)
import { fetchCostEvents, type CostEvent } from "@/lib/likelyfad/costEvents";
// === LIKELYFAD CUSTOM END ===

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

export function CostDialog({ predictedCost, incurredCost, onClose }: CostDialogProps) {
  const resetIncurredCost = useWorkflowStore((state) => state.resetIncurredCost);
  // === LIKELYFAD CUSTOM START === (fetch 48h rolling events for this project)
  const workflowId = useWorkflowStore((state) => state.workflowId);
  const [events, setEvents] = useState<CostEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    setEventsLoading(true);
    fetchCostEvents(workflowId)
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  // Bucket events into Today / Yesterday based on local-time day boundaries.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const todayEvents: CostEvent[] = [];
  const yesterdayEvents: CostEvent[] = [];
  for (const ev of events) {
    const ts = new Date(ev.created_at).getTime();
    if (ts >= startOfToday) todayEvents.push(ev);
    else if (ts >= startOfYesterday) yesterdayEvents.push(ev);
  }
  const todayTotal = todayEvents.reduce((s, e) => s + Number(e.amount || 0), 0);
  const yesterdayTotal = yesterdayEvents.reduce((s, e) => s + Number(e.amount || 0), 0);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const nodeTypeIcon = (t: string | null) => {
    if (t === "video") return "🎬";
    if (t === "audio") return "🎵";
    if (t === "3d") return "🧊";
    if (t === "llm") return "💬";
    return "🖼️";
  };
  // === LIKELYFAD CUSTOM END ===

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

  // Separate Gemini (reliable pricing) from external providers (unreliable pricing)
  const geminiItems = predictedCost.breakdown.filter((item) => item.provider === "gemini");
  const externalItems = predictedCost.breakdown.filter(
    (item) => item.provider !== "gemini"
  );

  // Group external items by provider
  const externalByProvider = new Map<ProviderType, CostBreakdownItem[]>();
  externalItems.forEach((item) => {
    const existing = externalByProvider.get(item.provider);
    if (existing) {
      existing.push(item);
    } else {
      externalByProvider.set(item.provider, [item]);
    }
  });

  const geminiTotal = geminiItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0);
  const externalNodeCount = externalItems.reduce((sum, item) => sum + item.count, 0);

  const hasGemini = geminiItems.length > 0;
  const hasExternal = externalItems.length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-neutral-800 rounded-lg p-6 w-[440px] max-h-[85vh] overflow-y-auto border border-neutral-700 shadow-xl">
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
          {/* Gemini Cost Section - prices are reliable */}
          {hasGemini && (
            <div className="bg-neutral-900 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <ProviderIcon provider="gemini" />
                <span className="text-sm text-neutral-300">Gemini Cost</span>
                <span className="ml-auto text-lg font-semibold text-green-400">
                  {formatCost(geminiTotal)}
                </span>
              </div>

              <div className="space-y-1 pl-7">
                {geminiItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="text-neutral-500">
                      {item.count}x {item.modelName}
                    </span>
                    <span className="text-neutral-400">
                      {item.subtotal !== null ? formatCost(item.subtotal) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* External Providers Section - show model links instead of prices */}
          {hasExternal && (
            <div className="bg-neutral-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-neutral-300">External Providers</span>
                <span className="text-xs text-neutral-500">
                  {externalNodeCount} node{externalNodeCount !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="space-y-3">
                {Array.from(externalByProvider.entries()).map(([provider, items]) => (
                  <div key={provider}>
                    <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
                      <ProviderIcon provider={provider} />
                      <span>{getProviderDisplayName(provider)}</span>
                    </div>
                    <div className="space-y-1 pl-7">
                      {items.map((item, idx) => {
                        const modelUrl = getModelUrl(provider, item.modelId);
                        return (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-neutral-500">
                              {item.count}x {item.modelName}
                            </span>
                            {modelUrl && (
                              <a
                                href={modelUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                              >
                                View model
                                <ExternalLinkIcon />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-neutral-600 mt-3">
                Pricing varies by model, hardware, and usage. Check provider for details.
              </p>
            </div>
          )}

          {/* No nodes message */}
          {predictedCost.nodeCount === 0 && (
            <div className="bg-neutral-900 rounded-lg p-4">
              <p className="text-xs text-neutral-500">
                No generation nodes in workflow
              </p>
            </div>
          )}

          {/* === LIKELYFAD CUSTOM START === (lifetime total + 48h breakdown) */}
          {/* Lifetime total — authoritative, from projects.incurred_cost */}
          <div className="bg-gradient-to-br from-green-950/40 to-neutral-900 rounded-lg p-4 border border-green-900/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-neutral-300">Lifetime Cost</span>
              <span className="text-2xl font-semibold text-green-400">
                {formatCost(incurredCost)}
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Total API spend for this project (all time)
            </p>

            {incurredCost > 0 && (
              <button
                onClick={handleReset}
                className="mt-3 text-xs text-neutral-500 hover:text-red-400 transition-colors"
              >
                Reset to $0.00
              </button>
            )}
          </div>

          {/* 48h breakdown */}
          <div className="bg-neutral-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-neutral-300">Recent Activity</span>
              <span className="text-xs text-neutral-600">Last 48 hours</span>
            </div>

            {eventsLoading && (
              <p className="text-xs text-neutral-500">Loading...</p>
            )}

            {!eventsLoading && events.length === 0 && (
              <p className="text-xs text-neutral-500">
                No generations in the last 48 hours
              </p>
            )}

            {!eventsLoading && todayEvents.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs font-medium text-neutral-400 mb-2 pb-1 border-b border-neutral-800">
                  <span>TODAY</span>
                  <span className="text-green-400">{formatCost(todayTotal)}</span>
                </div>
                <div className="space-y-1.5">
                  {todayEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span>{nodeTypeIcon(ev.node_type)}</span>
                        <span className="text-neutral-500 tabular-nums shrink-0">
                          {formatTime(ev.created_at)}
                        </span>
                        <span className="text-neutral-400 truncate">
                          {ev.model_name || "—"}
                        </span>
                      </div>
                      <span className="text-neutral-300 tabular-nums ml-2 shrink-0">
                        {formatCost(Number(ev.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!eventsLoading && yesterdayEvents.length > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-neutral-400 mb-2 pb-1 border-b border-neutral-800">
                  <span>YESTERDAY</span>
                  <span className="text-green-400">{formatCost(yesterdayTotal)}</span>
                </div>
                <div className="space-y-1.5">
                  {yesterdayEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span>{nodeTypeIcon(ev.node_type)}</span>
                        <span className="text-neutral-500 tabular-nums shrink-0">
                          {formatTime(ev.created_at)}
                        </span>
                        <span className="text-neutral-400 truncate">
                          {ev.model_name || "—"}
                        </span>
                      </div>
                      <span className="text-neutral-300 tabular-nums ml-2 shrink-0">
                        {formatCost(Number(ev.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pricing Note */}
          <div className="text-xs text-neutral-600">
            <p>Cost tracking requires pricing metadata. External providers without listed prices in src/lib/likelyfad/pricing-overrides.ts won&apos;t be tracked.</p>
          </div>
          {/* === LIKELYFAD CUSTOM END === */}
        </div>
      </div>
    </div>
  );
}

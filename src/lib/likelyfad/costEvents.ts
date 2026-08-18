// === LIKELYFAD CUSTOM === (cost event logging helper — fire-and-forget)
// Client-side helper to POST a cost event to the API. Never throws, never blocks.
// Used by the 4 generation executors alongside addIncurredCost().

export interface CostEvent {
  id: string;
  node_id: string | null;
  node_type: string | null;
  model_name: string | null;
  amount: number;
  created_at: string;
}

export function logCostEvent(params: {
  projectId: string | null | undefined;
  nodeId?: string;
  nodeType?: string;
  modelName?: string;
  amount: number;
}): void {
  if (!params.projectId || !isFinite(params.amount) || params.amount <= 0) {
    return;
  }

  // Fire-and-forget — never await, never block the generation flow.
  fetch("/api/likelyfad/cost-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: params.projectId,
      nodeId: params.nodeId,
      nodeType: params.nodeType,
      modelName: params.modelName,
      amount: params.amount,
    }),
  }).catch((err) => {
    console.warn("[costEvents] log failed (ignored):", err);
  });
}

export async function fetchCostEvents(projectId: string): Promise<CostEvent[]> {
  try {
    const res = await fetch(
      `/api/likelyfad/cost-events?projectId=${encodeURIComponent(projectId)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.events) ? data.events : [];
  } catch (err) {
    console.warn("[costEvents] fetch failed:", err);
    return [];
  }
}

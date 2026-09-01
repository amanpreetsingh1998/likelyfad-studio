/**
 * What a workflow would cost and how long it would take, derived from its graph.
 *
 * THE INVARIANT: ESTIMATES ARE DERIVED, NEVER WRITTEN DOWN.
 *
 * The credit total here is the sum of `creditCostForRun()` over the graph's
 * billable nodes — the same function, from the same rate card, that
 * `withCredits()` bills from. It is not a parallel table of prices, because a
 * parallel table is a thing that drifts: the credit system already had one,
 * and it drifted until every image sold at about half of cost.
 *
 * The estimate is therefore not "roughly what this costs". It is exactly what
 * this graph would be charged if every node ran once and nothing was retried.
 *
 * AN UNPRICED MODEL MAKES THE ESTIMATE PARTIAL, NOT WRONG.
 *
 * `hasKnownPrice()` is false for models whose price we have never recorded.
 * The gate refuses those outright with 409 unpriced_model rather than guessing,
 * and this mirrors that: the node is counted as unpriced and the total is
 * flagged `partial`, so the UI says "at least 38 credits" instead of quietly
 * pricing a $1.68 model at nothing. Substituting a category average is how a
 * 30x mispricing gets shipped without anyone noticing.
 *
 * THIS RUNS ON THE SERVER, AT SAVE.
 *
 * Never on the client and never from a request body. A browser that could
 * write est_credits could write its own price, which is the whole reason
 * pending_charges exists. The client sends a graph; the server prices it.
 */

import {
  creditCostForRun,
  hasKnownPrice,
  runKindForMediaType,
  type RunCostInput,
  type RunKind,
} from "@/lib/credits/pricing";

/**
 * How long a run of each kind takes when we have no measurement.
 *
 * Deliberately coarse, and only ever a fallback: `model_latency_stats` gives a
 * measured median per model once that model has succeeded a few times, and
 * that always wins. These exist so a brand-new account does not see a blank
 * where the time should be — and the UI labels them, because a number with no
 * data behind it should not look like one with data behind it.
 */
const FALLBACK_DURATION_MS: Record<RunKind, number> = {
  image: 12_000,
  video: 90_000,
  audio: 15_000,
  "3d": 60_000,
  llm: 6_000,
  comfy: 45_000,
};

/** The node types that reach a provider and therefore cost money. */
const BILLABLE_TYPES = new Set([
  "nanoBanana",
  "generateVideo",
  "generateAudio",
  "generate3d",
  "llmGenerate",
  "comfyApp",
]);

type GraphNode = {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
};

export type WorkflowEstimateResult = {
  /** Sum of creditCostForRun() over priced billable nodes. */
  credits: number;
  /** Sum of per-model medians, or the per-kind fallback. Milliseconds. */
  durationMs: number;
  /**
   * True when at least one billable node had no recorded price, so `credits`
   * is a floor rather than a total.
   */
  partial: boolean;
  /** Distinct model ids the graph would call, for the history card's chips. */
  models: string[];
  /** How many billable nodes were found, priced or not. */
  billableNodes: number;
};

/** Per-model median durations, as measured by model_latency_stats. */
export type LatencyTable = Record<string, number>;

/**
 * Price a graph.
 *
 * Sequential sum for the duration, which is the honest baseline: nodes do run
 * concurrently, so a real run is usually faster, but the concurrency limit and
 * the graph's shape both vary and a parallel model would be a guess dressed as
 * a calculation. Overstating elapsed time is the safer direction to be wrong
 * in, and the measured wall clock replaces this figure the moment one run of
 * the workflow completes.
 */
export function estimateWorkflow(
  nodes: unknown,
  latency: LatencyTable = {}
): WorkflowEstimateResult {
  const list = Array.isArray(nodes) ? (nodes as GraphNode[]) : [];

  let credits = 0;
  let durationMs = 0;
  let partial = false;
  let billableNodes = 0;
  const models = new Set<string>();

  for (const node of list) {
    if (!node || typeof node !== "object") continue;
    if (!node.type || !BILLABLE_TYPES.has(node.type)) continue;

    billableNodes += 1;

    const cost = costInputForNode(node);
    if (cost.modelId) models.add(cost.modelId);

    // Mirrors the 409: we decline to price it rather than guessing.
    if (!hasKnownPrice(cost)) {
      partial = true;
    } else {
      credits += creditCostForRun(cost);
    }

    durationMs += durationForNode(cost, latency);
  }

  return {
    credits,
    durationMs,
    partial,
    models: [...models].sort(),
    billableNodes,
  };
}

/**
 * Build the same RunCostInput the route's `costFrom` would build for this node.
 *
 * Kept deliberately parallel to `/api/generate`'s and `/api/llm`'s cost
 * functions — that correspondence is the whole reason the estimate matches the
 * bill, and estimateMatchesBilling.test.ts is what stops it drifting.
 */
function costInputForNode(node: GraphNode): RunCostInput {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const selected = data.selectedModel as
    | { modelId?: string; provider?: string }
    | undefined;
  const parameters = (data.parameters ?? {}) as Record<string, unknown>;

  // /api/llm sends only { kind: "llm", modelId: body.model }.
  if (node.type === "llmGenerate") {
    return {
      kind: "llm",
      modelId:
        selected?.modelId ?? (typeof data.model === "string" ? data.model : undefined),
      provider: selected?.provider,
    };
  }

  // Duration matters: fal bills many video models per second of output, so a
  // 10s clip costs twice a 5s one. Same fields the generate route reads.
  const seconds = Number(
    parameters.duration ?? parameters.duration_seconds ?? parameters.num_seconds
  );

  // The count a batching model was asked for. creditCostForRun multiplies by
  // it, so omitting it would under-estimate a 4-image node by 4x.
  const count = Number(
    parameters.num_images ?? parameters.numImages ?? parameters.n
  );

  return {
    kind: kindForNodeType(node.type),
    modelId:
      selected?.modelId ?? (typeof data.model === "string" ? data.model : undefined),
    provider: selected?.provider,
    resolution: typeof data.resolution === "string" ? data.resolution : undefined,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    count: Number.isFinite(count) && count > 0 ? count : undefined,
  };
}

function kindForNodeType(type: string | undefined): RunKind {
  switch (type) {
    case "generateVideo":
      return "video";
    case "generateAudio":
      return "audio";
    case "generate3d":
      return "3d";
    case "llmGenerate":
      return "llm";
    case "comfyApp":
      return "comfy";
    default:
      // nanoBanana, and anything new that has not said otherwise. Matches
      // runKindForMediaType's own default, which /api/generate relies on.
      return runKindForMediaType(undefined);
  }
}

/**
 * A measured median beats a guess; a guess beats a blank.
 *
 * The measured figure is keyed by model id, so a model nobody has run yet
 * falls back to its kind. Both are labelled differently in the UI — a duration
 * with no data behind it must not look like one with data behind it.
 */
function durationForNode(cost: RunCostInput, latency: LatencyTable): number {
  const measured = cost.modelId ? latency[cost.modelId] : undefined;
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  return FALLBACK_DURATION_MS[cost.kind] ?? FALLBACK_DURATION_MS.image;
}

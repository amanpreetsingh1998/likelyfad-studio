/**
 * Every number in this system that you might want to change.
 *
 * ── HOW TO EDIT ────────────────────────────────────────────────────────────
 *
 * 1. Price of a pack, or how many credits it carries → CREDIT_PACKS below.
 *    Edit freely, add or remove entries. `amountInPaise` is what Razorpay
 *    charges (₹1 = 100 paise, so ₹499 is 49900). Keep each `id` stable once
 *    real payments exist — it is recorded on the transaction.
 *
 * 2. What a run costs → RUN_CREDIT_COSTS / MODEL_CREDIT_COSTS below.
 *
 * 3. The free signup grant → SIGNUP_GRANT_CREDITS below AND the two `100`
 *    literals in supabase/migrations/0003_credits.sql (section 6). The SQL is
 *    what actually pays out; the constant here is only what the UI advertises.
 *    Changing the SQL means re-running that section against your database.
 *
 * The starting numbers are placeholders picked to be roughly sane — 1 credit
 * ≈ ₹0.50, and a run costs about what it costs us — not a researched price.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type CreditPack = {
  /** Stable identifier, recorded on the purchase transaction. */
  id: string;
  name: string;
  credits: number;
  /** Razorpay charges in the smallest currency unit. ₹499 → 49900. */
  amountInPaise: number;
  currency: "INR";
  /** Optional flag for the UI to highlight one pack. */
  popular?: boolean;
};

/** Free credits a brand-new account starts with. Mirrors the SQL trigger. */
export const SIGNUP_GRANT_CREDITS = 100;

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    name: "Starter",
    credits: 1_000,
    amountInPaise: 49_900, // ₹499
    currency: "INR",
  },
  {
    id: "creator",
    name: "Creator",
    credits: 4_500, // 12.5% more per rupee than Starter
    amountInPaise: 199_900, // ₹1,999
    currency: "INR",
    popular: true,
  },
  {
    id: "studio",
    name: "Studio",
    credits: 12_000, // 20% more per rupee than Starter
    amountInPaise: 499_900, // ₹4,999
    currency: "INR",
  },
];

export function findPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === packId);
}

/** ₹ display string for a pack, e.g. "₹499". */
export function formatPackPrice(pack: CreditPack): string {
  return `₹${(pack.amountInPaise / 100).toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------------
// What a run costs
//
// Keyed by media type, because that is the one thing every generation request
// carries and the server can trust. MODEL_CREDIT_COSTS overrides it for models
// whose real cost is far from their category's average — a 4K Nano Banana Pro
// image and a 512px Lite image are both "image", but not remotely the same
// spend, and charging the average for both loses money on one and overcharges
// on the other.
// ---------------------------------------------------------------------------

export type RunKind = "image" | "video" | "audio" | "3d" | "llm" | "comfy";

export const RUN_CREDIT_COSTS: Record<RunKind, number> = {
  image: 5,
  video: 40,
  audio: 8,
  "3d": 25,
  llm: 1,
  comfy: 10,
};

/**
 * Per-model overrides. Keys are matched against the model id the request
 * carries (`selectedModel.modelId`, falling back to the legacy `model` field),
 * longest prefix first — so "veo-3" can cost more than "veo-2" without listing
 * every variant.
 */
export const MODEL_CREDIT_COSTS: Record<string, number> = {
  // Gemini image models, priced off src/utils/costCalculator.ts PRICING.
  "nano-banana-2-lite": 3,
  "nano-banana-2": 6,
  "nano-banana-pro": 12,
  "nano-banana": 4,
  // Video is where the real money goes.
  "veo-3": 120,
  "veo-2": 60,
  sora: 100,
  kling: 50,
};

/**
 * Resolution multipliers for image runs. A 4K render costs materially more
 * than a 1K one at every provider we use, so the charge should track it.
 */
export const RESOLUTION_MULTIPLIERS: Record<string, number> = {
  "512": 0.75,
  "1K": 1,
  "2K": 1.5,
  "4K": 2.5,
};

export type RunCostInput = {
  kind: RunKind;
  modelId?: string | null;
  resolution?: string | null;
  /** Number of outputs requested, when the model supports batching. */
  count?: number;
};

/**
 * The credit charge for one run. Always at least 1 — a free run would let an
 * exhausted account keep spending our provider budget forever.
 */
export function creditCostForRun(input: RunCostInput): number {
  const { kind, modelId, resolution, count = 1 } = input;

  const override = modelId ? matchModelCost(modelId) : undefined;
  const base = override ?? RUN_CREDIT_COSTS[kind] ?? RUN_CREDIT_COSTS.image;

  const multiplier =
    kind === "image" && resolution
      ? RESOLUTION_MULTIPLIERS[resolution] ?? 1
      : 1;

  const batch = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;

  return Math.max(1, Math.ceil(base * multiplier * batch));
}

/** Longest matching prefix wins, so specific ids beat family prefixes. */
function matchModelCost(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  let best: { key: string; cost: number } | undefined;

  for (const [key, cost] of Object.entries(MODEL_CREDIT_COSTS)) {
    if (!id.includes(key)) continue;
    if (!best || key.length > best.key.length) best = { key, cost };
  }

  return best?.cost;
}

/**
 * Map the `mediaType` a generate request carries onto a RunKind.
 * Unknown or absent means an image — that is what /api/generate defaults to.
 */
export function runKindForMediaType(mediaType?: string | null): RunKind {
  switch (mediaType) {
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "3d":
      return "3d";
    default:
      return "image";
  }
}

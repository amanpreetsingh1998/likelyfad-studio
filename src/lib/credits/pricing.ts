/**
 * Credit packs, and the cost of a run in credits.
 *
 * ── WHERE TO EDIT WHAT ─────────────────────────────────────────────────────
 *
 * Pack prices / credits per pack   → CREDIT_PACKS, below.
 * Margin, FX rate, credit value    → ./rates.ts (the three tunable numbers).
 * A provider's USD rate            → USD_RATES in ./rates.ts.
 * The free signup grant            → SIGNUP_GRANT_CREDITS below AND the two
 *                                    `100` literals in
 *                                    supabase/migrations/0003_credits.sql §6.
 *                                    The SQL is what actually pays out.
 *
 * Run costs are DERIVED from USD rates — there is no hand-written table of
 * credit prices any more. That was how images ended up selling at roughly half
 * of what they cost to produce: two tables, edited independently, silently
 * disagreeing.
 * ───────────────────────────────────────────────────────────────────────────
 */

import {
  CREDIT_VALUE_INR,
  USD_RATES,
  creditsForUsd,
  formatCreditsAsInr,
} from "./rates";

export { CREDIT_VALUE_INR, creditsForUsd, formatCreditsAsInr };
export { creditsToInr, MARGIN, USD_INR_RATE } from "./rates";

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
    amountInPaise: 49_900, // ₹499 → ₹0.499/credit, the peg in rates.ts
    currency: "INR",
  },
  {
    id: "creator",
    name: "Creator",
    credits: 4_500,
    amountInPaise: 199_900, // ₹1,999 → ₹0.444/credit
    currency: "INR",
    popular: true,
  },
  {
    id: "studio",
    name: "Studio",
    credits: 12_000,
    amountInPaise: 499_900, // ₹4,999 → ₹0.417/credit
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

/**
 * The entry pack's rate must match CREDIT_VALUE_INR, or the "1 credit ≈ ₹X"
 * the buy modal shows is a lie. Asserted by the pricing tests rather than
 * enforced at runtime — it is a mistake to catch in CI, not in production.
 */
export function creditPegDriftPct(): number {
  const entry = CREDIT_PACKS[0];
  const actual = entry.amountInPaise / 100 / entry.credits;
  return Math.abs(actual - CREDIT_VALUE_INR) / CREDIT_VALUE_INR;
}

// ---------------------------------------------------------------------------
// Run costs
// ---------------------------------------------------------------------------

export type RunKind = "image" | "video" | "audio" | "3d" | "llm" | "comfy";

export type RunCostInput = {
  kind: RunKind;
  modelId?: string | null;
  resolution?: string | null;
  /** Number of outputs requested, when the model supports batching. */
  count?: number;
};

/**
 * USD cost of one run, from the billing rate card.
 *
 * Exported so the UI can show "this costs X credits (≈ ₹Y)" using exactly the
 * number that will be charged, rather than a parallel estimate.
 */
export function usdCostForRun(input: RunCostInput): number {
  const { kind, modelId, resolution } = input;
  const id = (modelId ?? "").toLowerCase();

  if (kind === "image") {
    const key = matchKey(id, Object.keys(USD_RATES.image));
    const row = key ? USD_RATES.image[key] : undefined;
    if (!row) return USD_RATES.image["nano-banana"]["1K"];
    return row[resolution ?? "1K"] ?? row["1K"];
  }

  const table = USD_RATES[kind] as Record<string, number> | undefined;
  if (!table) return USD_RATES.image["nano-banana"]["1K"];

  const key = matchKey(id, Object.keys(table).filter((k) => k !== "default"));
  return (key ? table[key] : undefined) ?? table.default ?? 0.05;
}

/**
 * The credit charge for one run. Always at least 1 — a free run would let an
 * exhausted account keep spending our provider budget forever.
 */
export function creditCostForRun(input: RunCostInput): number {
  const perRun = creditsForUsd(usdCostForRun(input));
  const count = input.count;
  const batch = Number.isFinite(count) && (count ?? 0) > 0 ? Math.floor(count!) : 1;
  return Math.max(1, perRun * batch);
}

/** Longest matching key wins, so "nano-banana-2-lite" beats "nano-banana". */
function matchKey(id: string, keys: string[]): string | undefined {
  let best: string | undefined;
  for (const key of keys) {
    if (!id.includes(key)) continue;
    if (!best || key.length > best.length) best = key;
  }
  return best;
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

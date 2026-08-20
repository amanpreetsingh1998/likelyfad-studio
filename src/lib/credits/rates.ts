/**
 * The peg between money and credits, and the USD rate card everything is
 * priced from.
 *
 * ── THE THREE NUMBERS YOU EDIT ─────────────────────────────────────────────
 *
 * CREDIT_VALUE_INR, USD_INR_RATE and MARGIN below are the whole pricing
 * policy. Every credit charge in the app is derived from them plus a provider's
 * real USD rate — there is no second table of hand-written credit prices to
 * keep in step, which is what let images end up selling at half of cost.
 *
 * Change MARGIN to change what you make. Change CREDIT_VALUE_INR only
 * alongside CREDIT_PACKS in ./pricing.ts, or the packs stop matching the peg
 * the UI advertises.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * What one credit costs a user to buy, in rupees.
 *
 * Must agree with CREDIT_PACKS: the Starter pack is ₹499 for 1,000 credits, so
 * ₹0.499 ≈ ₹0.50. creditPegCheck() in ./pricing.ts asserts they have not
 * drifted apart, and the buy modal shows this rate to the user.
 */
export const CREDIT_VALUE_INR = 0.5;

/**
 * Rupees per US dollar, pinned rather than fetched.
 *
 * Deliberately a constant: a live FX feed would make prices move under users
 * mid-session and make a charge impossible to reproduce when someone disputes
 * it. Review it by hand when the rate has drifted enough to matter — a few
 * percent will not, since MARGIN absorbs it.
 */
export const USD_INR_RATE = 85;

/**
 * What you charge over raw provider cost. 1.3 = 30%.
 *
 * This is the only number here that is a business decision rather than an
 * observation. It has to cover the provider bill, Razorpay's cut (~2%),
 * Supabase, hosting, and failed runs that get refunded but were still paid for.
 */
export const MARGIN = 1.3;

/**
 * Provider USD cost → credits.
 *
 * Rounds up, and never returns less than 1: a run that cost us money must cost
 * the user something, or an exhausted account could spend our provider budget
 * indefinitely on cheap models.
 */
export function creditsForUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 1;
  return Math.max(1, Math.ceil((usd * USD_INR_RATE * MARGIN) / CREDIT_VALUE_INR));
}

/** Credits → rupees, for showing users what a number means. */
export function creditsToInr(credits: number): number {
  return credits * CREDIT_VALUE_INR;
}

/** "₹15.00" — the money equivalent of a credit figure. */
export function formatCreditsAsInr(credits: number): string {
  const inr = creditsToInr(credits);
  if (inr < 0.01) return "₹0.00";
  return `₹${inr.toFixed(2)}`;
}

/**
 * The USD cost of one run, when we know it.
 *
 * Kept here rather than imported from src/utils/costCalculator.ts because that
 * module is client-side and mixes in `customPrices` — prices the *user* typed
 * into localStorage. Those are fine for a display estimate and must never
 * reach a charge, so the billing path reads this table instead.
 *
 * Values are USD per run, from each provider's published rate card. Keep them
 * in step with PRICING in costCalculator.ts and PRICING_OVERRIDES.
 */
export const USD_RATES = {
  image: {
    "nano-banana": { "512": 0.039, "1K": 0.039, "2K": 0.039, "4K": 0.039 },
    "nano-banana-pro": { "512": 0.134, "1K": 0.134, "2K": 0.134, "4K": 0.24 },
    "nano-banana-2": { "512": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 },
    "nano-banana-2-lite": { "512": 0.034, "1K": 0.034, "2K": 0.034, "4K": 0.034 },
  } as Record<string, Record<string, number>>,

  /**
   * Video, USD per run at the assumed clip length. These are the rates I could
   * not verify against costCalculator (video pricing lives in the model
   * registry, not a static table), so they are conservative placeholders —
   * audit them against each provider before taking real money at scale.
   */
  video: {
    "veo-3": 1.2,
    "veo-2": 0.5,
    sora: 1.0,
    kling: 0.4,
    default: 0.5,
  } as Record<string, number>,

  audio: { default: 0.05 } as Record<string, number>,
  "3d": { default: 0.15 } as Record<string, number>,
  llm: { default: 0.005 } as Record<string, number>,
  comfy: { default: 0.05 } as Record<string, number>,
} as const;

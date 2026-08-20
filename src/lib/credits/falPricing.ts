/**
 * fal.ai model prices, converted from billing units into a per-run USD cost.
 *
 * The recorded price is per ONE billing unit, and fal uses seventeen different
 * ones across the catalogue. A raw `0.05` means nothing until you know whether
 * that is per image, per second of video, or per megapixel of output — and for
 * the last two the answer depends on the run, not the model. That conversion
 * is what this file is.
 *
 * Regenerate the underlying data with `npm run fal:pricing`.
 */

import { FAL_PRICING, type FalPriceEntry } from "@/lib/likelyfad/fal-pricing.generated";

/**
 * Clip length assumed when a model bills per second and the request does not
 * say. Mirrors ASSUMED_VIDEO_SECONDS in src/utils/costCalculator.ts.
 */
export const ASSUMED_SECONDS = 5;

/**
 * GPU-seconds assumed for models billed on `compute seconds`.
 *
 * A guess, and unavoidably so: compute time depends on queue state, image size
 * and the model's own internals, none of which are knowable before the run.
 * Set high enough to cover a typical render rather than optimistically low —
 * undercharging here is a direct loss, and 94 models bill this way.
 */
export const ASSUMED_COMPUTE_SECONDS = 12;

/** Megapixels per resolution label, for models that bill per megapixel. */
const MEGAPIXELS: Record<string, number> = {
  "512": 0.26, // 512²
  "1K": 1.05, // 1024²
  "2K": 4.19, // 2048²
  "4K": 8.29, // 3840×2160
};

/** Tokens assumed for models billed per 1K/1M tokens. */
const ASSUMED_TOKENS = 3_000;

/**
 * Prices we cannot use, even though fal published a number.
 *
 * `$1 / units` is fal's placeholder for "variable, see the page" — it appears
 * on google/nano-banana-2-lite, openai/gpt-image-2 and others whose real price
 * is a few cents. Billing it literally would overcharge by ~30×; treating it
 * as free would undercharge. Neither is acceptable, so these are reported as
 * unpriced and the guard refuses them until someone adds a manual override.
 *
 * An empty unit string is the same situation with less information.
 */
function isUsable(entry: FalPriceEntry): boolean {
  if (!entry.unit) return false;
  if (entry.unit === "units" && entry.price === 1) return false;
  return entry.price > 0;
}

export type FalRunContext = {
  /** Resolution label, for megapixel billing. */
  resolution?: string | null;
  /** Clip length in seconds, for duration billing. */
  seconds?: number | null;
  /** Outputs requested. */
  count?: number;
};

/** The recorded entry for a fal endpoint, or null if we never priced it. */
export function getFalPrice(modelId: string): FalPriceEntry | null {
  return FAL_PRICING[modelId] ?? null;
}

/** True when we hold a price for this endpoint that is safe to bill from. */
export function hasUsableFalPrice(modelId: string): boolean {
  const entry = getFalPrice(modelId);
  return entry !== null && isUsable(entry);
}

/**
 * USD for one run of a fal model, or null when we have no usable price.
 *
 * Null rather than a fallback number on purpose: a guessed price on a model
 * that bills $1.68 per run is how you lose money quietly. The caller decides
 * whether to refuse the run or absorb it.
 */
export function falUsdForRun(
  modelId: string,
  context: FalRunContext = {}
): number | null {
  const entry = getFalPrice(modelId);
  if (!entry || !isUsable(entry)) return null;

  const { resolution, seconds, count = 1 } = context;
  const batch = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  const duration = seconds && seconds > 0 ? seconds : ASSUMED_SECONDS;
  const unit = entry.unit.toLowerCase();

  let perRun: number;

  switch (unit) {
    // Output area. "processed megapixels" is the same idea for models that
    // charge on what they read rather than what they write.
    case "megapixels":
    case "processed megapixels":
      perRun = entry.price * (MEGAPIXELS[resolution ?? "1K"] ?? MEGAPIXELS["1K"]);
      break;

    // Wall-clock duration of the media.
    case "seconds":
    case "input seconds":
      perRun = entry.price * duration;
      break;

    case "minutes":
      perRun = entry.price * (duration / 60);
      break;

    // Sold in blocks, so a 6s clip costs two blocks, not 1.2.
    case "5 seconds":
    case "video segments":
      perRun = entry.price * Math.ceil(duration / 5);
      break;

    // GPU time, not media time — see ASSUMED_COMPUTE_SECONDS.
    case "compute seconds":
      perRun = entry.price * ASSUMED_COMPUTE_SECONDS;
      break;

    case "1000 tokens":
      perRun = entry.price * (ASSUMED_TOKENS / 1_000);
      break;

    case "1m tokens":
      perRun = entry.price * (ASSUMED_TOKENS / 1_000_000);
      break;

    // One unit is one run.
    case "images":
    case "videos":
    case "generations":
    case "requests":
    case "units":
    case "credits":
    case "1":
      perRun = entry.price;
      break;

    default:
      // An unrecognised unit fal has added since this was written. Treat as
      // per-run, which is the commonest shape, rather than refusing a model
      // that probably works.
      perRun = entry.price;
      break;
  }

  // Published resolution surcharges, where the model spells them out. These
  // apply on top of a per-image price — area-based billing already scales with
  // size, so applying both would double-count.
  const areaBilled = unit === "megapixels" || unit === "processed megapixels";
  if (!areaBilled && entry.multipliers && resolution) {
    perRun *= entry.multipliers[resolution] ?? 1;
  }

  return perRun * batch;
}

/** How many fal endpoints we hold a usable price for. */
export function falPricedCount(): number {
  return Object.values(FAL_PRICING).filter(isUsable).length;
}

/** Endpoints recorded but not safely billable — the manual-override backlog. */
export function falUnusableIds(): string[] {
  return Object.entries(FAL_PRICING)
    .filter(([, entry]) => !isUsable(entry))
    .map(([id]) => id);
}

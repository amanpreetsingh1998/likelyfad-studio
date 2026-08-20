/**
 * Record fal.ai pricing for every model in the catalog.
 *
 *   node scripts/fal-record-pricing.mjs          # full catalog
 *   node scripts/fal-record-pricing.mjs --limit 40   # quick smoke run
 *
 * Writes src/lib/likelyfad/fal-pricing.generated.ts.
 *
 * WHY SCRAPING
 *
 * fal's models API returns no pricing field at all — verified across the whole
 * catalogue, every model, every nesting level. There is no billing or usage
 * endpoint either. The only machine-readable price fal publishes is an
 * `endpointBilling` object embedded in each model page's RSC flight payload:
 *
 *   { "endpoint": "...", "billing_unit": "images", "price": 0.08, ... }
 *
 * That is an internal payload, not a documented API. It could change shape
 * without warning, which is why this script FAILS LOUDLY rather than writing a
 * file full of zeroes: a silent fallback to "free" would bill every fal model
 * at nothing and nobody would notice until the invoice arrived.
 *
 * Re-run whenever fal's catalogue moves. Same idea as `npm run comfy:record`.
 */

import fs from "node:fs";
import path from "node:path";

const FAL_API = "https://api.fal.ai/v1";
const RELEVANT = ["text-to-image", "image-to-image", "text-to-video", "image-to-video"];
const OUT = path.join("src", "lib", "likelyfad", "fal-pricing.generated.ts");
const CONCURRENCY = 8;

/** Below this share of models priced, assume the payload moved and abort. */
const MIN_COVERAGE = 0.8;

function readKey() {
  // Next strips quotes from .env.local; a hand-rolled parser has to do it too,
  // or the key goes out as `Key "abc"` and every request 401s.
  const env = fs.readFileSync(".env.local", "utf8");
  const raw = env.match(/^FAL_API_KEY=(.*)$/m)?.[1]?.trim();
  const key = raw?.replace(/^["']|["']$/g, "");
  if (!key) {
    console.error("FAL_API_KEY not found in .env.local");
    process.exit(1);
  }
  return key;
}

/** Every active model, following the cursor to the end of the catalogue. */
async function fetchCatalog(key) {
  const headers = { Authorization: `Key ${key}` };
  let url = `${FAL_API}/models?status=active`;
  const models = [];
  let pages = 0;

  while (url && pages < 60) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`fal models API ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const data = await response.json();
    models.push(...(data.models ?? []));
    pages++;
    url =
      data.has_more && data.next_cursor
        ? `${FAL_API}/models?status=active&cursor=${encodeURIComponent(data.next_cursor)}`
        : null;
  }

  console.log(`catalogue: ${models.length} models across ${pages} pages`);
  return models;
}

/**
 * Pull the billing object out of a model page.
 *
 * The flight payload is JSON escaped to different depths depending on where in
 * the document it sits, so the escaping is normalised before parsing. Brace
 * matching rather than a regex because the object is nested.
 */
export function extractBilling(html) {
  const flat = html.replace(/\\+"/g, '"');
  const at = flat.indexOf('"endpointBilling":');
  if (at === -1) return null;

  const start = flat.indexOf("{", at);
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < flat.length && i < start + 4000; i++) {
    if (flat[i] === "{") depth++;
    else if (flat[i] === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return null;

  try {
    const parsed = JSON.parse(flat.slice(start, end));
    return typeof parsed.price === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolution multipliers, when the page spells them out in prose.
 *
 * nano-banana-2 and friends carry lines like "2K and 4K outputs will be charged
 * at 1.5 times and 2 times the standard rate, respectively. 0.5K (512px)
 * resolution outputs will be charged at 0.75 times". That ladder is the
 * difference between billing a 4K render correctly and eating half its cost.
 */
export function extractMultipliers(html) {
  const flat = html.replace(/\\+"/g, '"');
  const info = flat.match(/"pricingInfoOverride":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!info) return null;

  const out = {};

  const pair = info.match(
    /2K and 4K outputs will be charged at \*\*([\d.]+)\*\* times and \*\*([\d.]+)\*\* times/i
  );
  if (pair) { out["2K"] = Number(pair[1]); out["4K"] = Number(pair[2]); }

  const low = info.match(/0\.5K \(512px\)[^*]*\*\*([\d.]+)\*\* times/i);
  if (low) out["512"] = Number(low[1]);

  return Object.keys(out).length ? out : null;
}

async function fetchOne(model) {
  const id = model.endpoint_id;
  try {
    const response = await fetch(`https://fal.ai/models/${id}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { id, error: `HTTP ${response.status}` };

    const html = await response.text();
    const billing = extractBilling(html);
    if (!billing) return { id, error: "no endpointBilling" };

    return {
      id,
      price: billing.price,
      unit: billing.billing_unit ?? "units",
      multipliers: extractMultipliers(html),
      category: model.metadata?.category ?? null,
    };
  } catch (err) {
    return { id, error: err.message.slice(0, 60) };
  }
}

async function mapLimit(items, limit, fn, onProgress) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
      onProgress?.(results.filter(Boolean).length, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

function render(entries, stats) {
  const rows = entries
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const mult = e.multipliers ? `, multipliers: ${JSON.stringify(e.multipliers)}` : "";
      return `  ${JSON.stringify(e.id)}: { price: ${e.price}, unit: ${JSON.stringify(e.unit)}${mult} },`;
    })
    .join("\n");

  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Regenerate with:  npm run fal:pricing
 * Source: the \`endpointBilling\` payload on each fal.ai model page.
 *
 * ${stats.priced} of ${stats.total} models priced (${stats.pct}%).
 * Billing units seen: ${stats.units}.
 *
 * \`price\` is per ONE \`unit\`, not per run. Converting to a per-run cost needs
 * the run's own context — duration for \`seconds\`, output size for
 * \`megapixels\` — which is why that conversion lives in falPricing.ts rather
 * than being baked in here.
 */

export type FalPriceEntry = {
  /** USD per single billing unit. */
  price: number;
  /** images | videos | seconds | megapixels | units | credits | … */
  unit: string;
  /** Resolution surcharges, when the model publishes them. */
  multipliers?: Record<string, number>;
};

export const FAL_PRICING: Record<string, FalPriceEntry> = {
${rows}
};

/** Endpoints whose price could not be read on the last run. */
export const FAL_UNPRICED: string[] = ${JSON.stringify(stats.failedIds, null, 2)};
`;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : null;

  const key = readKey();
  let catalog = (await fetchCatalog(key)).filter((m) =>
    RELEVANT.includes(m.metadata?.category)
  );
  console.log(`relevant categories: ${catalog.length}`);

  if (limit) {
    const step = Math.max(1, Math.floor(catalog.length / limit));
    catalog = Array.from({ length: limit }, (_, i) => catalog[i * step]).filter(Boolean);
    console.log(`--limit ${limit}: sampling ${catalog.length} spread across the catalogue`);
  }

  let lastLogged = 0;
  const results = await mapLimit(catalog, CONCURRENCY, fetchOne, (done, total) => {
    if (done - lastLogged >= 50 || done === total) {
      lastLogged = done;
      process.stdout.write(`\r  fetched ${done}/${total}`);
    }
  });
  process.stdout.write("\n");

  const priced = results.filter((r) => r && r.price !== undefined);
  const failed = results.filter((r) => r && r.error);
  const pct = Math.round((priced.length / results.length) * 100);

  const units = {};
  priced.forEach((p) => (units[p.unit] = (units[p.unit] ?? 0) + 1));

  console.log(`\npriced ${priced.length}/${results.length} (${pct}%)`);
  console.log("units:", JSON.stringify(units));

  if (failed.length) {
    const reasons = {};
    failed.forEach((f) => (reasons[f.error] = (reasons[f.error] ?? 0) + 1));
    console.log("failures:", JSON.stringify(reasons));
  }

  // The loud failure promised at the top of this file. A sudden collapse in
  // coverage means fal changed the payload, and writing the result anyway would
  // quietly reprice most of the catalogue to nothing.
  if (priced.length / results.length < MIN_COVERAGE) {
    console.error(
      `\nABORTING: only ${pct}% of models priced (expected >= ${MIN_COVERAGE * 100}%).\n` +
        `fal has probably changed the page payload. Inspect a model page and fix\n` +
        `extractBilling() before regenerating — the existing file is untouched.`
    );
    process.exit(1);
  }

  const opaque = priced.filter((p) => ["units", "credits", "1"].includes(p.unit));

  fs.writeFileSync(
    OUT,
    render(priced, {
      total: results.length,
      priced: priced.length,
      pct,
      units: Object.entries(units).map(([u, n]) => `${u} (${n})`).join(", "),
      failedIds: failed.map((f) => f.id),
    })
  );

  console.log(`\nwrote ${OUT}`);

  if (opaque.length) {
    console.log(
      `\n${opaque.length} models bill in an opaque unit (units/credits/1). Their price\n` +
        `is recorded but treated as per-run, which may be wrong. Review:`
    );
    opaque.slice(0, 15).forEach((o) => console.log(`  $${o.price}/${o.unit}  ${o.id}`));
    if (opaque.length > 15) console.log(`  … and ${opaque.length - 15} more`);
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});

import { NextRequest, NextResponse } from "next/server";
import { ProviderModel, ModelCapability } from "@/lib/providers";
import { getFalPrice, falUsdForRun } from "@/lib/credits/falPricing";
import { requireAuth } from "@/lib/auth/guard";

const FAL_API_BASE = "https://api.fal.ai/v1";

/**
 * Cursor pages to follow. The whole catalogue is ~15 pages of ~100.
 *
 * Raised from 16 now that the walk is shared rather than per-search-term: it
 * happens once every five minutes for the whole deployment, so the headroom
 * costs nothing and a catalogue that grows past the old cap would otherwise
 * silently truncate — which is the failure this route already shipped once,
 * when it read only the first page and hid 90% of the models.
 */
const MAX_PAGES = 25;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * THE CACHE IS NOT KEYED ON ANYTHING THE CALLER SENDS.
 *
 * It used to be a single slot keyed on the raw `search` string, and the walk
 * below runs on a miss. So `?search=<random>` missed every time and forced up
 * to a full cursor walk of authenticated upstream calls per HTTP request, on
 * the server's own FAL_API_KEY. That is free amplification against a key whose
 * rate-limiting or suspension takes generation down for every user of the
 * deployment — the key is not billed for listing, but it is the same key
 * /api/generate runs on.
 *
 * The search term is no longer forwarded at all. This route already walks the
 * entire active catalogue and already filters it locally by category, so it
 * has every model in hand and can match the term in process. One walk serves
 * every caller and every search box, and the query string cannot cause a fetch.
 */
let cache: { at: number; payload: ModelsSuccessResponse } | null = null;

/**
 * The walk in flight, if there is one.
 *
 * Without this, N simultaneous cold requests each start their own cursor walk —
 * the same amplification the cache key opened, reachable by timing instead of
 * by varying a parameter. They now share one.
 */
let inFlight: Promise<ModelsSuccessResponse | ModelsErrorResponse> | null = null;

/**
 * Categories we care about for image/video generation
 */
const RELEVANT_CATEGORIES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
];

/**
 * Response schema from fal.ai models endpoint
 */
interface FalModelsResponse {
  models: FalModel[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Model schema from fal.ai API
 */
interface FalModel {
  endpoint_id: string;
  metadata: {
    display_name: string;
    category: string;
    description: string;
    status: "active" | "deprecated";
    tags: string[];
    updated_at: string;
    is_favorited: boolean | null;
    thumbnail_url: string;
    model_url: string;
    date: string;
    highlighted: boolean;
    pinned: boolean;
    thumbnail_animated_url?: string;
    github_url?: string;
    license_type?: "commercial" | "research" | "private";
  };
  openapi?: Record<string, unknown>;
}

/**
 * Map fal.ai category to ModelCapability
 */
function mapCategoryToCapability(category: string): ModelCapability | null {
  if (RELEVANT_CATEGORIES.includes(category)) {
    return category as ModelCapability;
  }
  return null;
}

/**
 * Check if a model has a relevant category
 */
function isRelevantModel(model: FalModel): boolean {
  return RELEVANT_CATEGORIES.includes(model.metadata.category);
}

/**
 * Map fal.ai model to our normalized ProviderModel format
 */
/**
 * Attach the recorded price, so the picker and the cost estimate see the same
 * number the credit gate will bill from.
 *
 * fal's own API carries no pricing (see scripts/fal-record-pricing.mjs), so
 * this comes from the scraped table. Per-second models keep their native unit
 * because calculatePredictedCost already multiplies those by a node's clip
 * length; everything else is normalised to a per-run figure at 1K.
 *
 * Models with no usable price get no `pricing` field at all, which is what
 * makes them show up as "unknown" in the cost dialog rather than as free.
 */
function pricingFor(endpointId: string): ProviderModel["pricing"] {
  const entry = getFalPrice(endpointId);
  if (!entry) return undefined;

  const unit = entry.unit.toLowerCase();
  if (unit === "seconds" || unit === "input seconds") {
    return { type: "per-second", amount: entry.price, currency: "USD" };
  }

  const perRun = falUsdForRun(endpointId, { resolution: "1K" });
  if (perRun === null) return undefined; // $0, empty unit, or the $1 placeholder

  return { type: "per-run", amount: perRun, currency: "USD" };
}

function mapToProviderModel(model: FalModel): ProviderModel {
  const capability = mapCategoryToCapability(model.metadata.category);

  return {
    id: model.endpoint_id,
    name: model.metadata.display_name,
    description: model.metadata.description,
    provider: "fal",
    capabilities: capability ? [capability] : [],
    coverImage: model.metadata.thumbnail_url,
    pricing: pricingFor(model.endpoint_id),
    pageUrl: `https://fal.ai/models/${model.endpoint_id}`,
  };
}

interface ModelsSuccessResponse {
  success: true;
  models: ProviderModel[];
}

interface ModelsErrorResponse {
  success: false;
  error: string;
}

type ModelsResponse = ModelsSuccessResponse | ModelsErrorResponse;

/**
 * GET /api/providers/fal/models
 *
 * The fal catalogue, normalised and priced. Signed-in callers only.
 *
 * The key is the server's, never the caller's — a client picks a model, not a
 * credential, for the same reason it picks a model and not a price.
 *
 * Query params:
 *   - search: filters the catalogue in process. It is not forwarded upstream.
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ModelsResponse>> {
  // A CATALOGUE LISTING STILL NEEDS A SESSION. Nothing here is billed and
  // nothing here is secret, so the instinct is that it can be public — but the
  // walk below runs on the server's FAL_API_KEY, and every real caller is a
  // signed-in user with the picker open. An anonymous caller has no use for
  // this list and every use for the upstream traffic it generates.
  const gate = await requireAuth();
  if (!gate.ok) return gate.response as NextResponse<ModelsResponse>;

  // Server-side key only. Callers cannot supply one — see the note in
  // src/store/providerAvailabilityStore.ts.
  const apiKey = process.env.FAL_API_KEY;

  if (!apiKey) {
    return NextResponse.json<ModelsErrorResponse>(
      {
        success: false,
        error: "fal.ai is not available on this deployment (FAL_API_KEY is not set).",
      },
      { status: 401 }
    );
  }

  const result = await loadCatalogue(apiKey);
  if (!result.success) {
    return NextResponse.json<ModelsErrorResponse>(result, { status: 502 });
  }

  // Applied here, to a list already in memory, rather than forwarded upstream.
  // See the note on `cache`: a caller-supplied term that reaches the network is
  // a caller-supplied term that can be varied to force one walk per request.
  const models = filterBySearch(
    result.models,
    request.nextUrl.searchParams.get("search")
  );

  return NextResponse.json<ModelsSuccessResponse>({ success: true, models });
}

/**
 * The whole active catalogue, walked at most once per TTL per deployment.
 *
 * Callers share both the cache and the walk itself, so the upstream cost of
 * this route is bounded by the clock rather than by how many requests arrive
 * or what they ask for.
 */
async function loadCatalogue(
  apiKey: string
): Promise<ModelsSuccessResponse | ModelsErrorResponse> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;
  if (inFlight) return inFlight;

  inFlight = walkCatalogue(apiKey)
    .then((result) => {
      // Only a success is cached. Caching a failure would hold the picker
      // empty for five minutes over one bad upstream minute.
      if (result.success) cache = { at: Date.now(), payload: result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function walkCatalogue(
  apiKey: string
): Promise<ModelsSuccessResponse | ModelsErrorResponse> {
  try {
    const headers: HeadersInit = { Authorization: `Key ${apiKey}` };

    // Follow the cursor. fal returns ~100 models per page and the catalogue is
    // 1,400+; reading only the first page — which this route used to do —
    // hid roughly 90% of the models behind a `has_more` nobody checked.
    const collected: FalModel[] = [];
    let url: string | null = `${FAL_API_BASE}/models?status=active`;
    let pages = 0;

    while (url && pages < MAX_PAGES) {
      const response: Response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        // A failure partway through still has usable models in hand — serving
        // those beats failing the whole picker over one bad page.
        if (collected.length > 0) break;

        return {
          success: false,
          error:
            response.status === 401
              ? "Invalid API key"
              : `fal.ai API error: ${response.status}`,
        };
      }

      const data: FalModelsResponse = await response.json();
      collected.push(...(data.models ?? []));
      pages++;

      url =
        data.has_more && data.next_cursor
          ? `${FAL_API_BASE}/models?status=active&cursor=${encodeURIComponent(
              data.next_cursor
            )}`
          : null;
    }

    return {
      success: true,
      models: collected.filter(isRelevantModel).map(mapToProviderModel),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch models from fal.ai",
    };
  }
}

/**
 * Match a search box against the catalogue in process.
 *
 * Substring, not a pattern: the needle is typed into the model picker, so a
 * stray character should look for itself rather than mean something — the same
 * position `position()` takes over `ilike '%…%'` in the SQL readers.
 */
function filterBySearch(
  models: ProviderModel[],
  search: string | null
): ProviderModel[] {
  const needle = (search ?? "").trim().toLowerCase();
  if (!needle) return models;

  return models.filter((model) =>
    [model.id, model.name, model.description].some(
      (field) => typeof field === "string" && field.toLowerCase().includes(needle)
    )
  );
}

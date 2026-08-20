import { NextRequest, NextResponse } from "next/server";
import { ProviderModel, ModelCapability } from "@/lib/providers";
import { getFalPrice, falUsdForRun } from "@/lib/credits/falPricing";

const FAL_API_BASE = "https://api.fal.ai/v1";

/**
 * Cursor pages to follow. The whole catalogue is ~15 pages; capping keeps a
 * cold request bounded, and the cache below means the full walk happens once
 * every few minutes rather than on every keystroke in the model search.
 */
const MAX_PAGES = 16;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; key: string; payload: ModelsSuccessResponse } | null = null;

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
 * Fetches available models from fal.ai API.
 * API key is optional - fal.ai works without but with rate limits.
 *
 * Headers:
 *   - X-API-Key: API key for authentication (recommended)
 *   - Authorization: Alternative auth header
 *
 * Query params:
 *   - search: Optional search query to filter models
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ModelsResponse>> {
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

  const searchQuery = request.nextUrl.searchParams.get("search");
  const cacheKey = searchQuery ?? "";

  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json<ModelsSuccessResponse>(cache.payload);
  }

  try {
    const headers: HeadersInit = { Authorization: `Key ${apiKey}` };

    // Follow the cursor. fal returns ~100 models per page and the catalogue is
    // 1,400+; reading only the first page — which this route used to do —
    // hid roughly 90% of the models behind a `has_more` nobody checked.
    const collected: FalModel[] = [];
    let url: string | null = `${FAL_API_BASE}/models?status=active${
      searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
    }`;
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

        return NextResponse.json<ModelsErrorResponse>(
          {
            success: false,
            error:
              response.status === 401
                ? "Invalid API key"
                : `fal.ai API error: ${response.status}`,
          },
          { status: response.status }
        );
      }

      const data: FalModelsResponse = await response.json();
      collected.push(...(data.models ?? []));
      pages++;

      url =
        data.has_more && data.next_cursor
          ? `${FAL_API_BASE}/models?status=active&cursor=${encodeURIComponent(
              data.next_cursor
            )}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`
          : null;
    }

    const models = collected.filter(isRelevantModel).map(mapToProviderModel);

    const payload: ModelsSuccessResponse = { success: true, models };
    cache = { at: Date.now(), key: cacheKey, payload };

    return NextResponse.json<ModelsSuccessResponse>(payload);
  } catch (error) {
    return NextResponse.json<ModelsErrorResponse>(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch models from fal.ai",
      },
      { status: 500 }
    );
  }
}

import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import { withDataForSeoCache, stableKey } from '../dataforseo/cache';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// ── Per-instance throttle + hard daily cap ────────────────────────────────
// The rate limiter is in-memory (per-lambda), so concurrent ticks each have
// their own gate; it only smooths bursts. The DB-backed daily cap below is
// the REAL spend ceiling. Both are reset/bounded per UTC day.
let lastRequestAt = 0;
let dayKey = '';
let requestsToday = 0;

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function throttlePlaces(): Promise<void> {
  const minInterval = Number(process.env.GOOGLE_PLACES_MIN_INTERVAL_MS ?? '250');
  const wait = lastRequestAt + minInterval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function assertDailyCap(): void {
  const today = utcDayKey();
  if (today !== dayKey) {
    dayKey = today;
    requestsToday = 0;
  }
  const cap = Number(process.env.GOOGLE_PLACES_DAILY_CAP ?? '500');
  if (requestsToday >= cap) {
    throw new IntegrationError(
      'google-places',
      `daily request cap reached (${requestsToday}/${cap} for ${today}); refusing further Places calls`,
    );
  }
  requestsToday += 1;
}

// Default field mask — keep narrow to control cost. Each field added to the
// mask increases the per-request cost (Google bills by SKU tier).
const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.types',
  'places.primaryType',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.location',
  'nextPageToken',
].join(',');

const PlaceSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  types: z.array(z.string()).default([]),
  primaryType: z.string().optional(),
  websiteUri: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  businessStatus: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

const SearchResponseSchema = z.object({
  places: z.array(PlaceSchema).default([]),
  nextPageToken: z.string().optional(),
});

export interface SearchTextArgs {
  /** Free-text query, e.g. "tree removal in Tucson, AZ". */
  query: string;
  /** Bounding region — if provided, results are biased toward this lat/lng + radius (meters). */
  locationBias?: {
    lat: number;
    lng: number;
    radiusMeters: number;
  };
  /** Include only operational businesses (skip permanently closed). Default true. */
  excludeClosed?: boolean;
  /** Page token from a previous response to fetch more results. */
  pageToken?: string;
  /** Max places per page (Google caps at 20). */
  pageSize?: number;
}

/**
 * Find local businesses via Google Places Text Search (New Places API v1).
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * Pricing: Text Search is in the "Pro" SKU tier — about $0.017 per request
 * with our default field mask. 50 prospects = ~3 paginated searches = ~$0.05.
 *
 * Falls back to a clear error when GOOGLE_PLACES_API_KEY isn't set.
 */
export async function searchText(args: SearchTextArgs): Promise<{
  places: Place[];
  nextPageToken?: string;
}> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('google-places', 'GOOGLE_PLACES_API_KEY is not set');
  }

  const body: Record<string, unknown> = {
    textQuery: args.query,
    pageSize: args.pageSize ?? 20,
  };
  if (args.pageToken) body.pageToken = args.pageToken;
  if (args.locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: args.locationBias.lat, longitude: args.locationBias.lng },
        radius: args.locationBias.radiusMeters,
      },
    };
  }

  // Hard daily cap (real spend ceiling) + per-instance burst smoother.
  assertDailyCap();
  await throttlePlaces();

  const timeoutMs = Number(process.env.GOOGLE_PLACES_TIMEOUT_MS ?? '10000');
  let res: Response;
  try {
    res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new IntegrationError('google-places', `searchText timed out after ${timeoutMs}ms`);
    }
    throw err instanceof IntegrationError
      ? err
      : new IntegrationError('google-places', `searchText network error: ${String(err)}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'google-places',
      `searchText failed: ${res.status} ${text}`,
      res.status,
      text,
    );
  }
  const json = SearchResponseSchema.parse(await res.json());
  const places = args.excludeClosed === false
    ? json.places
    : json.places.filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY');
  log.info(
    { query: args.query, count: places.length, hasNextPage: !!json.nextPageToken },
    'google-places search',
  );
  return { places, nextPageToken: json.nextPageToken };
}

const PlaceDetailsSchema = z.object({
  id: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
});

export interface PlaceAggregateRating {
  /** Aggregate star rating, rounded to 1 decimal. Undefined when the listing has none. */
  rating?: number;
  /** Total Google review count. Undefined when the listing has none. */
  userRatingCount?: number;
}

/**
 * Fetch a single place's **aggregate** rating + review count via Place Details
 * (New Places API v1, `GET /v1/places/{placeId}`). Used by the monthly
 * `buildsell-review-refresh` agent to keep the displayed Google star rating
 * current after it was captured once at build time.
 *
 * ToS GUARD: we deliberately request ONLY `rating,userRatingCount` (aggregate,
 * non-PII). We NEVER request `reviews` — verbatim Google review bodies are not
 * fetched, stored, or displayed (ADR 0025 D5 / R6). Place Details field masks
 * use **bare** field names (no `places.` prefix, unlike `searchText`).
 *
 * Pricing: rating + count keeps this in a low Place Details SKU tier
 * (~$0.005–0.017/call). Spend is bounded by the shared `assertDailyCap` +
 * `throttlePlaces` guards, same as every other call in this module.
 *
 * MOCK_AI bypass returns deterministic values so test/mock paths never hit the
 * network (mirrors `getContractorCount` / `searchLeads`).
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceAggregateRating> {
  if (process.env.MOCK_AI === 'true') {
    log.info({ placeId }, 'google-places getPlaceDetails: MOCK_AI bypass');
    return { rating: 4.7, userRatingCount: 53 };
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('google-places', 'GOOGLE_PLACES_API_KEY is not set');
  }

  // Hard daily cap (real spend ceiling) + per-instance burst smoother.
  assertDailyCap();
  await throttlePlaces();

  const timeoutMs = Number(process.env.GOOGLE_PLACES_TIMEOUT_MS ?? '10000');
  let res: Response;
  try {
    res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        // Place Details masks use bare field names (no `places.` prefix).
        'X-Goog-FieldMask': 'id,rating,userRatingCount',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new IntegrationError('google-places', `getPlaceDetails timed out after ${timeoutMs}ms`);
    }
    throw err instanceof IntegrationError
      ? err
      : new IntegrationError('google-places', `getPlaceDetails network error: ${String(err)}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'google-places',
      `getPlaceDetails failed: ${res.status} ${text}`,
      res.status,
      text,
    );
  }
  const json = PlaceDetailsSchema.parse(await res.json());
  // Round to 1 decimal to match buildsell_leads.rating numeric(2,1) + display.
  const rating = json.rating != null ? Math.round(json.rating * 10) / 10 : undefined;
  log.info({ placeId, rating, userRatingCount: json.userRatingCount }, 'google-places getPlaceDetails');
  return { rating, userRatingCount: json.userRatingCount };
}

export interface ContractorCountArgs {
  niche: string;
  city: string;
  state: string;
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
}

/** Median of a pre-sorted ascending number array. Returns 0 for an empty array. */
function computeMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface ContractorSupply {
  /** Total contractors returned (first-page Places results, capped at 20). */
  count: number;
  /** How many of those `count` results have a `websiteUri`. */
  withWebsite: number;
  /** `count - withWebsite`. */
  withoutWebsite: number;
  /** Average Google star rating across results that report one. 0 when none do. */
  avgRating: number;
  /** Median Google review count across results that report one. 0 when none do. */
  medianReviewCount: number;
}

/**
 * Same Text Search call as `getContractorCount` (same field mask, same cost),
 * but computes supply-side aggregates over the full result set rather than
 * just the length. Rentability v2 (ADR 0029) input.
 *
 * Caching: a DEDICATED endpoint namespace ('places-contractor-supply'), 30-day
 * TTL. Deliberately NOT the same cache endpoint as `getContractorCount`
 * ('places-contractor-count') — that endpoint's cached rows are bare numbers;
 * this one returns an object, and reusing the key would risk a cache hit
 * deserializing a number where an object is expected. The old cached numbers
 * simply expire on their existing TTL; no migration needed for the cache table.
 *
 * MOCK_AI bypass: returns a deterministic object (count=7, mixed website
 * coverage) so test/mock paths never hit the network.
 */
export async function getContractorSupply(args: ContractorCountArgs): Promise<ContractorSupply> {
  if (process.env.MOCK_AI === 'true') {
    log.info({ args }, 'google-places getContractorSupply: MOCK_AI bypass, returning mock supply');
    return { count: 7, withWebsite: 4, withoutWebsite: 3, avgRating: 4.5, medianReviewCount: 22 };
  }

  const query = `${args.niche} in ${args.city}, ${args.state}`;
  const cacheKey = stableKey([args.niche.toLowerCase(), args.city.toLowerCase(), args.state.toLowerCase()]);

  const { value: supply, costUsd } = await withDataForSeoCache<ContractorSupply>({
    endpoint: 'places-contractor-supply',
    key: cacheKey,
    ttlDays: 30,
    costUsd: 0.017,
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const { places } = await searchText({
        query,
        pageSize: 20,
        excludeClosed: true,
      });
      const withWebsite = places.filter((p) => p.websiteUri != null).length;
      const ratings = places.map((p) => p.rating).filter((r): r is number => r != null);
      const avgRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;
      const reviewCounts = places
        .map((p) => p.userRatingCount)
        .filter((c): c is number => c != null)
        .sort((a, b) => a - b);
      const medianReviewCount = computeMedian(reviewCounts);
      const result: ContractorSupply = {
        count: places.length,
        withWebsite,
        withoutWebsite: places.length - withWebsite,
        avgRating,
        medianReviewCount,
      };
      log.info({ query, ...result }, 'google-places contractor supply fetched');
      return result;
    },
  });

  args.onCost?.(costUsd);
  return supply;
}

/**
 * Return the number of contractors (first-page Places results, capped at 20)
 * for a given niche + city + state. Intended for rentability scoring in the
 * operator `validateNiche` action — NEVER call this at niche-hunter generation
 * time; it costs ~$0.017/call and must be operator-gated.
 *
 * Thin wrapper over `getContractorSupply` — kept for callers that only need
 * the count (and as the historical entry point / test surface).
 */
export async function getContractorCount(args: ContractorCountArgs): Promise<number> {
  const { count } = await getContractorSupply(args);
  return count;
}

/**
 * Search up to N places by paginating Text Search. Stops when the requested
 * count is reached, no more pages are available, or `maxPages` is hit.
 *
 * No artificial inter-page delay: the **New** Places API (v1, `places:searchText`)
 * returns a `nextPageToken` that is valid immediately — unlike the legacy Places
 * API, it does NOT need a settle delay before the next page. `searchText` already
 * applies the module-level min-interval throttle, so pages are still spaced
 * politely. `maxPages` bounds worst-case latency on sparse areas (thin pages),
 * where the old 1.5s/page sleep could stack to 10s+.
 */
export async function searchN(
  query: string,
  count: number,
  opts: Omit<SearchTextArgs, 'query' | 'pageToken' | 'pageSize'> & { maxPages?: number } = {},
): Promise<Place[]> {
  // Default: unbounded pages (preserves prior behavior for existing callers
  // like tenant-prospector — they just lose the obsolete 1.5s/page sleep).
  // Callers that want a latency ceiling (searchLeads) pass an explicit maxPages.
  const { maxPages = Infinity, ...searchOpts } = opts;
  const out: Place[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  while (out.length < count && pages < maxPages) {
    const remaining = count - out.length;
    const { places, nextPageToken } = await searchText({
      query,
      pageToken,
      pageSize: Math.min(20, remaining),
      ...searchOpts,
    });
    out.push(...places);
    pages += 1;
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  return out.slice(0, count);
}

export interface SearchLeadsArgs {
  /** Trade, e.g. "pool service". */
  trade: string;
  city: string;
  state: string;
  /** How many businesses to return. Default 20. */
  count?: number;
}

export interface BuildSellLeadResult {
  placeId: string;
  displayName?: string;
  formattedAddress?: string;
  nationalPhone?: string;
  primaryType?: string;
  types: string[];
  rating?: number;
  userRatingCount?: number;
  /** The business's existing website, if any. null/undefined = no website. */
  websiteUri?: string;
  /** Convenience flag for the UI: true when the business already has a site. */
  hasWebsite: boolean;
  lat?: number;
  lng?: number;
  trade: string;
  city: string;
  state: string;
}

/**
 * Sort businesses for the lead finder: **no-website first** (the prime
 * prospects), then the rest — a business with a bad existing site is still a
 * potential client. Within each group, stronger social proof (more reviews,
 * then higher rating) ranks higher. Pure + exported for unit testing.
 *
 * NOTE: this no longer FILTERS anything out — every business is returned,
 * just ordered.
 */
export function sortLeadPlaces(places: Place[]): Place[] {
  return [...places].sort((a, b) => {
    const aHas = a.websiteUri != null ? 1 : 0;
    const bHas = b.websiteUri != null ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas; // no-website (0) first
    const reviews = (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
    if (reviews !== 0) return reviews;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
}

/**
 * Build & Sell lead search: return local businesses for the operator to work,
 * **no-website businesses first** (prime prospects), then the rest (a business
 * with a weak existing site is still a potential client).
 *
 * Pipeline: searchN(query) → sortLeadPlaces (no-website-first) → take `count` →
 * map. READ-ONLY: writes NOTHING to Postgres. Results are returned transiently;
 * only leads the operator acts on get persisted (mark Called / note / follow-up
 * → buildsell_leads; Build draft → buildsell_sites). Keeps repeated searches off
 * Neon and never auto-builds a browsable stored lead DB (ToS posture).
 *
 * MOCK_AI bypass: returns a deterministic mix of website / no-website businesses
 * so the sort + UI are testable without the network.
 */
export async function searchLeads(args: SearchLeadsArgs): Promise<BuildSellLeadResult[]> {
  const { trade, city, state } = args;
  const count = args.count ?? 20;

  let places: Place[];
  if (process.env.MOCK_AI === 'true') {
    // Mix: every 3rd business has a website, so the no-website-first sort is visible.
    places = Array.from({ length: count }, (_, i) => ({
      id: `mock-place-${city}-${i}`.toLowerCase().replace(/\s+/g, '-'),
      displayName: { text: `${trade} pro ${i + 1}` },
      formattedAddress: `${100 + i} Main St, ${city}, ${state}`,
      types: [trade.replace(/\s+/g, '_')],
      primaryType: trade.replace(/\s+/g, '_'),
      websiteUri: i % 3 === 0 ? `https://example-${i}.com` : undefined,
      nationalPhoneNumber: `(555) 010-${String(1000 + i).slice(-4)}`,
      rating: 4.6,
      userRatingCount: 42 + i,
      businessStatus: 'OPERATIONAL',
      location: { latitude: 33.4 + i * 0.01, longitude: -111.9 - i * 0.01 },
    }));
  } else {
    // Light over-fetch so the no-website businesses can be surfaced to the top,
    // capped to keep latency bounded on sparse areas.
    places = await searchN(`${trade} in ${city}, ${state}`, count * 2, {
      excludeClosed: true,
      maxPages: 3,
    });
  }

  const sorted = sortLeadPlaces(places);

  const results: BuildSellLeadResult[] = sorted.slice(0, count).map((p) => ({
    placeId: p.id,
    displayName: p.displayName?.text,
    formattedAddress: p.formattedAddress,
    nationalPhone: p.nationalPhoneNumber,
    primaryType: p.primaryType,
    types: p.types,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    websiteUri: p.websiteUri,
    hasWebsite: p.websiteUri != null,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    trade,
    city,
    state,
  }));

  log.info(
    {
      trade,
      city,
      state,
      scanned: places.length,
      returned: results.length,
      noWebsite: results.filter((r) => !r.hasWebsite).length,
    },
    'google-places searchLeads (read-only)',
  );
  return results;
}

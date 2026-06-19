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

export interface ContractorCountArgs {
  niche: string;
  city: string;
  state: string;
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
}

/**
 * Return the number of contractors (first-page Places results, capped at 20)
 * for a given niche + city + state. Intended for rentability scoring in the
 * operator `validateNiche` action — NEVER call this at niche-hunter generation
 * time; it costs ~$0.017/call and must be operator-gated.
 *
 * Caching: responses are stored for 30 days via the shared external-API cache
 * (endpoint namespace 'places-contractor-count'). A re-validation within 30
 * days costs nothing.
 *
 * MOCK_AI bypass: returns 7 (a plausible mid-market count) so test/mock paths
 * never hit the network. The cache layer itself also bypasses when MOCK_AI=true.
 */
export async function getContractorCount(args: ContractorCountArgs): Promise<number> {
  if (process.env.MOCK_AI === 'true') {
    log.info({ args }, 'google-places getContractorCount: MOCK_AI bypass, returning 7');
    return 7;
  }

  const query = `${args.niche} in ${args.city}, ${args.state}`;
  const cacheKey = stableKey([args.niche.toLowerCase(), args.city.toLowerCase(), args.state.toLowerCase()]);

  const { value: count, costUsd } = await withDataForSeoCache<number>({
    endpoint: 'places-contractor-count',
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
      log.info({ query, count: places.length }, 'google-places contractor count fetched');
      return places.length;
    },
  });

  args.onCost?.(costUsd);
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
  /** How many qualified leads to return. Default 20. */
  count?: number;
  /** Minimum Google rating to qualify. Default 4.0. */
  ratingMin?: number;
  /** Minimum review count to qualify. Default 10. */
  reviewsMin?: number;
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
  lat?: number;
  lng?: number;
  trade: string;
  city: string;
  state: string;
}

/**
 * Pure qualification filter for B&S leads: keep only no-website businesses
 * with a strong-enough rating and review count. Exported for unit testing.
 */
export function qualifyLeadPlaces(
  places: Place[],
  opts: { ratingMin?: number; reviewsMin?: number } = {},
): Place[] {
  const ratingMin = opts.ratingMin ?? 4.0;
  const reviewsMin = opts.reviewsMin ?? 10;
  return places.filter(
    (p) =>
      p.websiteUri == null &&
      (p.rating ?? 0) >= ratingMin &&
      (p.userRatingCount ?? 0) >= reviewsMin,
  );
}

/**
 * Build & Sell lead search: find strong-review businesses with NO website.
 *
 * Pipeline: searchN(query) → filter (no website && rating >= ratingMin &&
 * reviews >= reviewsMin) → upsert survivors into `buildsell_leads` with
 * `cached_until = now()+30d` (the table doubles as the 30-day cache) → return
 * the filtered list transiently to the caller. The persisted row holds the
 * ToS-mandated place_id indefinitely; the reaper nulls PII at 30 days.
 *
 * MOCK_AI bypass: returns deterministic mock leads (still upserted) so the
 * operator search UI and tests never hit the network.
 */
export async function searchLeads(args: SearchLeadsArgs): Promise<BuildSellLeadResult[]> {
  const { trade, city, state } = args;
  const ratingMin = args.ratingMin ?? 4.0;
  const reviewsMin = args.reviewsMin ?? 10;
  const count = args.count ?? 20;

  let places: Place[];
  if (process.env.MOCK_AI === 'true') {
    places = Array.from({ length: count }, (_, i) => ({
      id: `mock-place-${city}-${i}`.toLowerCase().replace(/\s+/g, '-'),
      displayName: { text: `${trade} pro ${i + 1}` },
      formattedAddress: `${100 + i} Main St, ${city}, ${state}`,
      types: [trade.replace(/\s+/g, '_')],
      primaryType: trade.replace(/\s+/g, '_'),
      // No websiteUri → qualifies as a no-website lead.
      nationalPhoneNumber: `(555) 010-${String(1000 + i).slice(-4)}`,
      rating: 4.6,
      userRatingCount: 42 + i,
      businessStatus: 'OPERATIONAL',
      location: { latitude: 33.4 + i * 0.01, longitude: -111.9 - i * 0.01 },
    }));
  } else {
    // Over-fetch: many results have websites and get filtered out.
    // Over-fetch (most businesses HAVE a website and get filtered out) but cap
    // pages so a sparse area can't stack sequential round-trips into a 15s+ wait.
    places = await searchN(`${trade} in ${city}, ${state}`, count * 3, {
      excludeClosed: true,
      maxPages: 3,
    });
  }

  const qualified = qualifyLeadPlaces(places, { ratingMin, reviewsMin });

  const results: BuildSellLeadResult[] = qualified.slice(0, count).map((p) => ({
    placeId: p.id,
    displayName: p.displayName?.text,
    formattedAddress: p.formattedAddress,
    nationalPhone: p.nationalPhoneNumber,
    primaryType: p.primaryType,
    types: p.types,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    trade,
    city,
    state,
  }));

  // READ-ONLY: searchLeads writes NOTHING to Postgres. Results are returned
  // transiently for the operator to review in the ephemeral search UI; only the
  // leads they explicitly act on get persisted (buildDraft -> buildsell_sites,
  // which carries the place_id). This keeps repeated searches off Neon entirely
  // and means we never auto-build a browsable stored lead DB (ToS posture).
  log.info(
    { trade, city, state, scanned: places.length, qualified: results.length },
    'google-places searchLeads (read-only)',
  );
  return results;
}

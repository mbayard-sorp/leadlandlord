import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import { withDataForSeoCache, stableKey } from '../dataforseo/cache';

const PLACES_BASE = 'https://places.googleapis.com/v1';

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

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
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

  const { value: count } = await withDataForSeoCache<number>({
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

  return count;
}

/**
 * Search up to N places by paginating Text Search. Stops when the requested
 * count is reached or no more pages are available.
 */
export async function searchN(
  query: string,
  count: number,
  opts: Omit<SearchTextArgs, 'query' | 'pageToken' | 'pageSize'> = {},
): Promise<Place[]> {
  const out: Place[] = [];
  let pageToken: string | undefined;
  while (out.length < count) {
    const remaining = count - out.length;
    const { places, nextPageToken } = await searchText({
      query,
      pageToken,
      pageSize: Math.min(20, remaining),
      ...opts,
    });
    out.push(...places);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
    // Google's API requires a small delay between pageToken fetches —
    // results aren't immediately ready after the previous response.
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out.slice(0, count);
}

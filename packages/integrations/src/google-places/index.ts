import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

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

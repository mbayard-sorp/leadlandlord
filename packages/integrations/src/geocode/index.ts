import { listCities } from '@leadlandlord/us-cities/loader';

/**
 * City/state → lat/lng geocoding for LocalBusiness `geo` (GeoCoordinates)
 * JSON-LD. Geo is OPTIONAL everywhere downstream — every function here returns
 * `null` on any failure and NEVER throws, so a geocoding miss can never block
 * or break a site build.
 *
 * Resolution order:
 *   1. us-cities — exact city match against the canonical @leadlandlord/us-cities
 *      dataset (zero network, instant). City-level precision when the city is in
 *      the dataset.
 *   2. Static state centroid (STATE_CENTROIDS) — coarse but always available.
 *      A state-level centroid is "good enough" for LocalBusiness geo (Google
 *      uses the postal address as the authoritative location; `geo` is a coarse
 *      hint).
 *   3. null — only when the state itself is unknown.
 *
 * There is NO network dependency: the previous Nominatim fetch has been removed
 * in favor of the in-repo us-cities dataset.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** Where the coordinates came from. */
  source?: 'us-cities' | 'state-centroid';
}

/**
 * Per-state centroid (approximate geographic center). Coarse but always
 * available — used as a floor so geo is populated even when the city isn't in
 * the us-cities dataset. Keys are 2-letter USPS abbreviations (case-insensitive
 * lookup).
 */
const STATE_CENTROIDS: Record<string, { latitude: number; longitude: number }> = {
  AL: { latitude: 32.806671, longitude: -86.79113 },
  AK: { latitude: 61.370716, longitude: -152.404419 },
  AZ: { latitude: 33.729759, longitude: -111.431221 },
  AR: { latitude: 34.969704, longitude: -92.373123 },
  CA: { latitude: 36.116203, longitude: -119.681564 },
  CO: { latitude: 39.059811, longitude: -105.311104 },
  CT: { latitude: 41.597782, longitude: -72.755371 },
  DE: { latitude: 39.318523, longitude: -75.507141 },
  FL: { latitude: 27.766279, longitude: -81.686783 },
  GA: { latitude: 33.040619, longitude: -83.643074 },
  HI: { latitude: 21.094318, longitude: -157.498337 },
  ID: { latitude: 44.240459, longitude: -114.478828 },
  IL: { latitude: 40.349457, longitude: -88.986137 },
  IN: { latitude: 39.849426, longitude: -86.258278 },
  IA: { latitude: 42.011539, longitude: -93.210526 },
  KS: { latitude: 38.5266, longitude: -96.726486 },
  KY: { latitude: 37.66814, longitude: -84.670067 },
  LA: { latitude: 31.169546, longitude: -91.867805 },
  ME: { latitude: 44.693947, longitude: -69.381927 },
  MD: { latitude: 39.063946, longitude: -76.802101 },
  MA: { latitude: 42.230171, longitude: -71.530106 },
  MI: { latitude: 43.326618, longitude: -84.536095 },
  MN: { latitude: 45.694454, longitude: -93.900192 },
  MS: { latitude: 32.741646, longitude: -89.678696 },
  MO: { latitude: 38.456085, longitude: -92.288368 },
  MT: { latitude: 46.921925, longitude: -110.454353 },
  NE: { latitude: 41.12537, longitude: -98.268082 },
  NV: { latitude: 38.313515, longitude: -117.055374 },
  NH: { latitude: 43.452492, longitude: -71.563896 },
  NJ: { latitude: 40.298904, longitude: -74.521011 },
  NM: { latitude: 34.840515, longitude: -106.248482 },
  NY: { latitude: 42.165726, longitude: -74.948051 },
  NC: { latitude: 35.630066, longitude: -79.806419 },
  ND: { latitude: 47.528912, longitude: -99.784012 },
  OH: { latitude: 40.388783, longitude: -82.764915 },
  OK: { latitude: 35.565342, longitude: -96.928917 },
  OR: { latitude: 44.572021, longitude: -122.070938 },
  PA: { latitude: 40.590752, longitude: -77.209755 },
  RI: { latitude: 41.680893, longitude: -71.51178 },
  SC: { latitude: 33.856892, longitude: -80.945007 },
  SD: { latitude: 44.299782, longitude: -99.438828 },
  TN: { latitude: 35.747845, longitude: -86.692345 },
  TX: { latitude: 31.054487, longitude: -97.563461 },
  UT: { latitude: 40.150032, longitude: -111.862434 },
  VT: { latitude: 44.045876, longitude: -72.710686 },
  VA: { latitude: 37.769337, longitude: -78.169968 },
  WA: { latitude: 47.400902, longitude: -121.490494 },
  WV: { latitude: 38.491226, longitude: -80.954456 },
  WI: { latitude: 44.268543, longitude: -89.616508 },
  WY: { latitude: 42.755966, longitude: -107.30249 },
  DC: { latitude: 38.897438, longitude: -77.026817 },
};

/** State-level centroid fallback, or null when the state is unknown. */
export function stateCentroid(state: string): GeoPoint | null {
  const hit = STATE_CENTROIDS[state.trim().toUpperCase()];
  return hit ? { ...hit, source: 'state-centroid' } : null;
}

/**
 * Resolve a city/state to a lat/lng against the canonical us-cities dataset,
 * falling back to a state centroid. Returns null only when the state isn't in
 * the centroid table. Never throws.
 *
 * Kept `async` so existing callers (site-builder) that `await` it don't need to
 * change, even though resolution is now fully synchronous.
 */
export async function geocodeCityState(city: string, state: string): Promise<GeoPoint | null> {
  const stateCode = state.trim().toUpperCase();
  const target = city.trim().toLowerCase();

  // 1) Exact city match in the canonical us-cities dataset (wide population
  //    range so we search the full set, not just the 10k-100k default window).
  try {
    const cities = listCities({
      states: [stateCode],
      populationMin: 1,
      populationMax: 999_999_999,
    });
    const match = cities.find((c) => c.city.trim().toLowerCase() === target);
    if (match) {
      return { latitude: match.lat, longitude: match.lng, source: 'us-cities' };
    }
  } catch {
    // Dataset read failure — fall through to the state centroid.
  }

  // 2) State-level centroid fallback. 3) null when the state is unknown.
  return stateCentroid(stateCode);
}

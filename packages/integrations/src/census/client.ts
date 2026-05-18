import type { AcsPlaceRow } from './types.js';

/**
 * Low-level Census ACS 5-Year Estimates client.
 *
 * One call per state: fetches all places in a state with the eight variables
 * we care about. Returns typed AcsPlaceRow[].
 *
 * Auth: API key passed as ?key= query param per Census API conventions.
 * Docs: https://api.census.gov/data/2022/acs/acs5/variables.html
 */

const BASE = 'https://api.census.gov/data/2022/acs/acs5';

const VARIABLES = [
  'NAME',
  'B01003_001E', // total population
  'B19013_001E', // median household income
  'B25077_001E', // median home value
  'B25003_001E', // total occupied housing units
  'B25003_002E', // owner-occupied units
  'B25003_003E', // renter-occupied units
  'B01002_001E', // median age
].join(',');

// Column indices in the response (after NAME comes the vars in order, then state + place FIPS).
const COL = {
  NAME: 0,
  POPULATION: 1,
  MEDIAN_INCOME: 2,
  MEDIAN_HOME_VALUE: 3,
  TOTAL_OCCUPIED: 4,
  OWNER_OCCUPIED: 5,
  RENTER_OCCUPIED: 6,
  MEDIAN_AGE: 7,
  STATE: 8,
  PLACE: 9,
} as const;

function apiKey(): string {
  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    throw new Error(
      'CENSUS_API_KEY is not set. Add it to your .env file before running Census enrichment.',
    );
  }
  return key;
}

function parseNum(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Fetch all ACS 5-Year place-level rows for a single US state (or DC).
 *
 * @param stateFips  2-digit FIPS string, e.g. "16" for Idaho, "11" for DC.
 * @returns Array of typed rows — one per Census "place" in the state.
 */
export async function fetchAcsPlaces(stateFips: string): Promise<AcsPlaceRow[]> {
  const url = new URL(BASE);
  url.searchParams.set('get', VARIABLES);
  url.searchParams.set('for', 'place:*');
  url.searchParams.set('in', `state:${stateFips}`);
  url.searchParams.set('key', apiKey());

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `Census API error for state ${stateFips}: ${res.status} ${text.slice(0, 300)}`,
    );
  }

  // Response is a JSON 2-D array: first row is header, rest are data rows.
  const raw = (await res.json()) as string[][];
  if (!Array.isArray(raw) || raw.length < 2) return [];

  // Skip header row (index 0).
  const rows: AcsPlaceRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r) continue;
    rows.push({
      name: r[COL.NAME] ?? '',
      population: parseNum(r[COL.POPULATION]),
      medianHouseholdIncome: parseNum(r[COL.MEDIAN_INCOME]),
      medianHomeValue: parseNum(r[COL.MEDIAN_HOME_VALUE]),
      totalOccupiedUnits: parseNum(r[COL.TOTAL_OCCUPIED]),
      ownerOccupiedUnits: parseNum(r[COL.OWNER_OCCUPIED]),
      renterOccupiedUnits: parseNum(r[COL.RENTER_OCCUPIED]),
      medianAge: parseNum(r[COL.MEDIAN_AGE]),
      stateFips: r[COL.STATE] ?? stateFips,
      placeFips: r[COL.PLACE] ?? '',
    });
  }
  return rows;
}

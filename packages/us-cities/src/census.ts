/**
 * Census ACS 5-Year Estimates helpers for us-cities enrichment.
 *
 * These live in us-cities (not @leadlandlord/integrations) because the Census
 * data is only ever used to enrich this package's own city dataset, and
 * @leadlandlord/integrations already depends on us-cities at runtime — a
 * back-dependency the other direction would form a workspace cycle.
 *
 * Used by scripts/enrich-from-census.ts to build data/census-enrichment.json.
 */

/**
 * Raw row returned by the ACS 5-Year Estimates API for a single place.
 * The API returns a 2-D array: first row is the header, subsequent rows are
 * data. We parse those into this shape.
 */
export interface AcsPlaceRow {
  /** e.g. "Boise City city, Idaho" */
  name: string;
  /** B01003_001E — total population */
  population: number;
  /** B19013_001E — median household income (USD). -666666666 = N/A */
  medianHouseholdIncome: number;
  /** B25077_001E — median home value (USD). -666666666 = N/A */
  medianHomeValue: number;
  /** B25003_001E — total occupied housing units */
  totalOccupiedUnits: number;
  /** B25003_002E — owner-occupied units */
  ownerOccupiedUnits: number;
  /** B25003_003E — renter-occupied units */
  renterOccupiedUnits: number;
  /** B01002_001E — median age */
  medianAge: number;
  /** State FIPS code (2-digit string, e.g. "16") */
  stateFips: string;
  /** Place FIPS code */
  placeFips: string;
}

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

/**
 * Parse the Census NAME field into just the city/place name, stripping the
 * place-type suffix and state suffix.
 *
 * Examples:
 *   "Boise City city, Idaho"       -> "boise city"  (lowercased)
 *   "Owensboro city, Kentucky"     -> "owensboro"
 *   "Oak Grove town, Missouri"     -> "oak grove"
 *   "Tanaina CDP, Alaska"          -> "tanaina"
 *   "Nashville-Davidson metro government (balance), Tennessee" -> "nashville-davidson metro government (balance)"
 *
 * Strategy:
 *   1. Split on last ", " to remove the state name.
 *   2. Remove a trailing suffix: " city", " town", " CDP", " village",
 *      " borough", " municipality", " unified government (balance)",
 *      " metro government (balance)", " consolidated government (balance)",
 *      " urban county government", " charter township", " township".
 *   3. Lowercase and trim.
 */
export function parseCensusName(censusName: string): string {
  // Step 1: strip state suffix (everything after last ", ").
  const commaIdx = censusName.lastIndexOf(', ');
  const withoutState = commaIdx !== -1 ? censusName.slice(0, commaIdx) : censusName;

  // Step 2: strip place-type suffix (case-insensitive, longest match first).
  const suffixes = [
    ' unified government (balance)',
    ' metro government (balance)',
    ' consolidated government (balance)',
    ' urban county government',
    ' charter township',
    ' municipality',
    ' township',
    ' borough',
    ' village',
    ' town',
    ' city',
    ' cdp',
  ];

  const lower = withoutState.toLowerCase().trimEnd();
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      return lower.slice(0, lower.length - suffix.length).trim();
    }
  }
  return lower.trim();
}

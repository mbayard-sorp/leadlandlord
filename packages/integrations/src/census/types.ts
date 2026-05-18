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
 * Shape stored in the cache file per matched city.
 */
export interface UsCityCensus {
  medianIncome: number;
  medianHomeValue: number;
  /** Owner-occupied units / total occupied units, 0-1. */
  ownerOccupiedPct: number;
  totalHousingUnits: number;
  medianAge: number;
  /** Population from Census (may differ from SimpleMaps estimate). */
  populationCensus: number;
}

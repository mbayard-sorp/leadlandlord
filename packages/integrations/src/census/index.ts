export { fetchAcsPlaces } from './client';
export type { AcsPlaceRow, UsCityCensus } from './types';

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

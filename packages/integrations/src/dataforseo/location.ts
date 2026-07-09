/**
 * DataForSEO location_name formatting for US city/state pairs.
 *
 * The Google Ads `search_volume/live` endpoint is strict: location_name must
 * use the FULL state name and NO spaces after commas. "Austin, TX, United
 * States" returns `40501 Invalid Field: 'location_name'`; "Austin,Texas,United
 * States" resolves to the Austin metro (location_code 1026201). Verified live
 * 2026-05-21.
 */

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

/** Full state name from a 2-letter abbreviation; passes through anything else. */
export function usStateName(stateAbbrevOrName: string): string {
  const key = stateAbbrevOrName.trim().toUpperCase();
  return US_STATE_NAMES[key] ?? stateAbbrevOrName.trim();
}

/**
 * Build a DataForSEO-valid US location_name: `City,State,United States` with
 * the full state name and no spaces after commas.
 */
export function dfsLocationName(city: string, state: string): string {
  return `${city.trim()},${usStateName(state)},United States`;
}

/**
 * State-level DataForSEO location_name (ADR 0030 S2), e.g. "Arizona,United States".
 * No spaces after commas — the Google Ads endpoint rejects them (40501).
 */
export function dfsStateLocationName(state: string): string {
  return `${usStateName(state)},United States`;
}

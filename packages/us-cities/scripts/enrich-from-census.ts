/**
 * Bulk Census enrichment script.
 *
 * Walks all 50 states + DC, calls the ACS 5-Year Estimates API for each,
 * then writes a JSON cache keyed by `${state2}|${city_ascii_lowercased}`.
 *
 * Usage:
 *   pnpm --filter @leadlandlord/us-cities enrich:census
 *
 * Prerequisites:
 *   CENSUS_API_KEY must be set in the environment.
 *
 * Output:
 *   packages/us-cities/data/census-enrichment.json
 *
 * DO NOT run this script in CI — it makes 51 real API calls.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// We import from the workspace package — tsx resolves TypeScript sources directly.
import { fetchAcsPlaces, parseCensusName } from '@leadlandlord/integrations/census';
import type { UsCityCensus } from '@leadlandlord/integrations/census';

// ---------------------------------------------------------------------------
// State FIPS table — 50 states + DC. Territories excluded per spec.
// ---------------------------------------------------------------------------
const STATE_FIPS: Array<{ fips: string; abbr: string; name: string }> = [
  { fips: '01', abbr: 'AL', name: 'Alabama' },
  { fips: '02', abbr: 'AK', name: 'Alaska' },
  { fips: '04', abbr: 'AZ', name: 'Arizona' },
  { fips: '05', abbr: 'AR', name: 'Arkansas' },
  { fips: '06', abbr: 'CA', name: 'California' },
  { fips: '08', abbr: 'CO', name: 'Colorado' },
  { fips: '09', abbr: 'CT', name: 'Connecticut' },
  { fips: '10', abbr: 'DE', name: 'Delaware' },
  { fips: '11', abbr: 'DC', name: 'District of Columbia' },
  { fips: '12', abbr: 'FL', name: 'Florida' },
  { fips: '13', abbr: 'GA', name: 'Georgia' },
  { fips: '15', abbr: 'HI', name: 'Hawaii' },
  { fips: '16', abbr: 'ID', name: 'Idaho' },
  { fips: '17', abbr: 'IL', name: 'Illinois' },
  { fips: '18', abbr: 'IN', name: 'Indiana' },
  { fips: '19', abbr: 'IA', name: 'Iowa' },
  { fips: '20', abbr: 'KS', name: 'Kansas' },
  { fips: '21', abbr: 'KY', name: 'Kentucky' },
  { fips: '22', abbr: 'LA', name: 'Louisiana' },
  { fips: '23', abbr: 'ME', name: 'Maine' },
  { fips: '24', abbr: 'MD', name: 'Maryland' },
  { fips: '25', abbr: 'MA', name: 'Massachusetts' },
  { fips: '26', abbr: 'MI', name: 'Michigan' },
  { fips: '27', abbr: 'MN', name: 'Minnesota' },
  { fips: '28', abbr: 'MS', name: 'Mississippi' },
  { fips: '29', abbr: 'MO', name: 'Missouri' },
  { fips: '30', abbr: 'MT', name: 'Montana' },
  { fips: '31', abbr: 'NE', name: 'Nebraska' },
  { fips: '32', abbr: 'NV', name: 'Nevada' },
  { fips: '33', abbr: 'NH', name: 'New Hampshire' },
  { fips: '34', abbr: 'NJ', name: 'New Jersey' },
  { fips: '35', abbr: 'NM', name: 'New Mexico' },
  { fips: '36', abbr: 'NY', name: 'New York' },
  { fips: '37', abbr: 'NC', name: 'North Carolina' },
  { fips: '38', abbr: 'ND', name: 'North Dakota' },
  { fips: '39', abbr: 'OH', name: 'Ohio' },
  { fips: '40', abbr: 'OK', name: 'Oklahoma' },
  { fips: '41', abbr: 'OR', name: 'Oregon' },
  { fips: '42', abbr: 'PA', name: 'Pennsylvania' },
  { fips: '44', abbr: 'RI', name: 'Rhode Island' },
  { fips: '45', abbr: 'SC', name: 'South Carolina' },
  { fips: '46', abbr: 'SD', name: 'South Dakota' },
  { fips: '47', abbr: 'TN', name: 'Tennessee' },
  { fips: '48', abbr: 'TX', name: 'Texas' },
  { fips: '49', abbr: 'UT', name: 'Utah' },
  { fips: '50', abbr: 'VT', name: 'Vermont' },
  { fips: '51', abbr: 'VA', name: 'Virginia' },
  { fips: '53', abbr: 'WA', name: 'Washington' },
  { fips: '54', abbr: 'WV', name: 'West Virginia' },
  { fips: '55', abbr: 'WI', name: 'Wisconsin' },
  { fips: '56', abbr: 'WY', name: 'Wyoming' },
];

// ---------------------------------------------------------------------------
// Load SimpleMaps city_ascii values grouped by state abbr for matching.
// We read the raw CSV rather than importing the loader to avoid the
// population filter in listCities.
// ---------------------------------------------------------------------------
function loadSimpleMapsIndex(): Map<string, Set<string>> {
  const csvPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../data/uscities.csv',
  );
  const raw = readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n');
  // Header: city,city_ascii,state_id,state_name,...
  // Indices: 1=city_ascii, 2=state_id
  const index = new Map<string, Set<string>>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parts = line.split(',');
    const cityAscii = parts[1]?.replace(/^"|"$/g, '').toLowerCase().trim();
    const stateId = parts[2]?.replace(/^"|"$/g, '').toUpperCase().trim();
    if (!cityAscii || !stateId) continue;
    if (!index.has(stateId)) index.set(stateId, new Set());
    index.get(stateId)!.add(cityAscii);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Starting Census enrichment — 51 API calls...\n');

  const simpleMapsIndex = loadSimpleMapsIndex();
  const cache: Record<string, UsCityCensus> = {};

  let totalMatched = 0;
  let totalMissed = 0;
  let totalCensusPlaces = 0;

  for (const { fips, abbr, name } of STATE_FIPS) {
    try {
      const rows = await fetchAcsPlaces(fips);
      totalCensusPlaces += rows.length;

      const stateSimpleMaps = simpleMapsIndex.get(abbr) ?? new Set<string>();
      let stateMatched = 0;
      let stateMissed = 0;

      for (const row of rows) {
        // Skip clearly invalid rows (Census returns -666666666 for suppressed data).
        const parsedName = parseCensusName(row.name);

        const entry: UsCityCensus = {
          medianIncome: row.medianHouseholdIncome < 0 ? 0 : row.medianHouseholdIncome,
          medianHomeValue: row.medianHomeValue < 0 ? 0 : row.medianHomeValue,
          ownerOccupiedPct:
            row.totalOccupiedUnits > 0
              ? Math.round((row.ownerOccupiedUnits / row.totalOccupiedUnits) * 1000) / 1000
              : 0,
          totalHousingUnits: row.totalOccupiedUnits,
          medianAge: row.medianAge < 0 ? 0 : row.medianAge,
          populationCensus: row.population,
        };

        const cacheKey = `${abbr}|${parsedName}`;
        cache[cacheKey] = entry;

        if (stateSimpleMaps.has(parsedName)) {
          stateMatched++;
        } else {
          stateMissed++;
        }
      }

      totalMatched += stateMatched;
      totalMissed += stateMissed;
      console.log(
        `  ${abbr} (${name}): ${rows.length} Census places, ${stateMatched} matched SimpleMaps, ${stateMissed} unmatched`,
      );
    } catch (err) {
      console.error(`  ERROR fetching ${abbr} (FIPS ${fips}):`, err instanceof Error ? err.message : err);
    }
  }

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../data/census-enrichment.json',
  );
  writeFileSync(outPath, JSON.stringify(cache, null, 2), 'utf8');

  console.log(`
Done.
  Total Census places fetched : ${totalCensusPlaces}
  Matched SimpleMaps rows     : ${totalMatched}
  Unmatched (Census-only)     : ${totalMissed}
  Cache written to            : ${outPath}
`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

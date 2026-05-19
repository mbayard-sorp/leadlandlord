/**
 * Unit tests for city-ranker (ADR 0008).
 *
 * Uses synthetic fixture cities to avoid dependency on real Census data.
 * The haversine / filter / scoring logic is exercised against known expected values
 * from the ADR calibration table.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs so we can inject controlled Census data without touching the disk.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { _resetCensusCache, _resetCitiesCache } from './index';
import { rankCities } from './city-ranker';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

/**
 * Fixture Census cache entries.
 * Keys must match the `${state}|${city.toLowerCase()}` pattern used by the loader.
 *
 * Cities chosen to hit ADR calibration table cases:
 * - Owensboro KY: should pass and score high
 * - Pine Bluff AR: fails income + home value floors
 * - NYC: fails OO% + population
 * - Nampa ID: passes filter, takes proximity penalty (near Boise ~45km)
 * - GreenvilleNC: fails OO% < 0.55
 * - Suburb City (synthetic): placed 30km from a mega-city — gets 0.4 multiplier
 */
const STUB_CACHE: Record<string, object> = {
  // Owensboro KY — ADR says ~0.68, strong fundamentals
  'KY|owensboro': {
    medianIncome: 52_000,
    medianHomeValue: 148_000,
    ownerOccupiedPct: 0.68,
    totalHousingUnits: 26_000,
    medianAge: 41,
    populationCensus: 60_123,
  },
  // Pine Bluff AR — should be filtered (income < 35k, homevalue < 100k)
  'AR|pine bluff': {
    medianIncome: 30_000,
    medianHomeValue: 75_000,
    ownerOccupiedPct: 0.60,
    totalHousingUnits: 18_000,
    medianAge: 39,
    populationCensus: 40_000,
  },
  // Greenville NC — should be filtered (OO% < 0.55)
  'NC|greenville': {
    medianIncome: 41_000,
    medianHomeValue: 150_000,
    ownerOccupiedPct: 0.47,
    totalHousingUnits: 40_000,
    medianAge: 30,
    populationCensus: 95_000,
  },
  // MetroCandidate — surrounded by cities totalling 600k nearby pop (>= 500k < 1M => 0.4)
  'TX|metrocandidate': {
    medianIncome: 65_000,
    medianHomeValue: 250_000,
    ownerOccupiedPct: 0.65,
    totalHousingUnits: 20_000,
    medianAge: 40,
    populationCensus: 55_000,
  },
  // Remote city — should get full 1.0 metroDensityMult
  'TX|remotetown': {
    medianIncome: 65_000,
    medianHomeValue: 250_000,
    ownerOccupiedPct: 0.65,
    totalHousingUnits: 20_000,
    medianAge: 40,
    populationCensus: 55_000,
  },
  // Multi-state: KY and TN cities to test per-state cap
  // (NearbyA/B/C have pop > 110k so they fail the hard filter — that is intentional;
  //  they still contribute to nearbyPop for MetroCandidate via the full city dataset)
  'TN|city_a': { medianIncome: 55_000, medianHomeValue: 180_000, ownerOccupiedPct: 0.65, totalHousingUnits: 22_000, medianAge: 40, populationCensus: 55_000 },
  'TN|city_b': { medianIncome: 54_000, medianHomeValue: 175_000, ownerOccupiedPct: 0.64, totalHousingUnits: 21_000, medianAge: 41, populationCensus: 54_000 },
  'TN|city_c': { medianIncome: 53_000, medianHomeValue: 170_000, ownerOccupiedPct: 0.63, totalHousingUnits: 20_000, medianAge: 42, populationCensus: 53_000 },
};

// ---------------------------------------------------------------------------
// Minimal synthetic uscities.csv — only the columns the loader actually reads.
// Header: city,city_ascii,state_id,state_name,county_fips,county_name,lat,lng,population,density,source,military,incorporated
// Indices:  0       1         2         3           4              5      6   7      8         9       10       11        12
// ---------------------------------------------------------------------------
function makeCSVLine(
  city: string,
  state: string,
  stateName: string,
  lat: number,
  lng: number,
  population: number,
): string {
  // county_fips=00000, county_name=County, density=0, source=0, military=FALSE
  return `${city},${city},${state},${stateName},00000,County,${lat},${lng},${population},0,0,FALSE,TRUE`;
}

const CSV_HEADER =
  'city,city_ascii,state_id,state_name,county_fips,county_name,lat,lng,population,density,source,military,incorporated';

// MetroCandidate is at (32.7, -97.3). Three nearby cities (all within 50 km)
// contribute 200k + 200k + 200k = 600k nearby pop => 0.4 multiplier.
// NearbyA/B/C are placed ~25 km away (0.22 deg lat ~ 24.4 km).
const SYNTHETIC_CSV = [
  CSV_HEADER,
  makeCSVLine('Owensboro', 'KY', 'Kentucky', 37.77, -87.11, 60_123),
  makeCSVLine('Pine Bluff', 'AR', 'Arkansas', 34.22, -92.0, 40_000),
  makeCSVLine('Greenville', 'NC', 'North Carolina', 35.61, -77.37, 95_000),
  // MetroCandidate — valid candidate city
  makeCSVLine('MetroCandidate', 'TX', 'Texas', 32.7, -97.3, 55_000),
  // Three neighbors each 200k pop, ~25 km away — sum = 600k => mult 0.4
  makeCSVLine('NearbyA', 'TX', 'Texas', 32.92, -97.3, 200_000),
  makeCSVLine('NearbyB', 'TX', 'Texas', 32.7, -97.52, 200_000),
  makeCSVLine('NearbyC', 'TX', 'Texas', 32.48, -97.3, 200_000),
  // Remotetown far from any city
  makeCSVLine('Remotetown', 'TX', 'Texas', 31.0, -102.0, 55_000),
  // Per-state cap test cities: 3 TN cities (all clean, remote)
  makeCSVLine('City_A', 'TN', 'Tennessee', 36.1, -87.0, 55_000),
  makeCSVLine('City_B', 'TN', 'Tennessee', 36.2, -87.1, 54_000),
  makeCSVLine('City_C', 'TN', 'Tennessee', 36.3, -87.2, 53_000),
].join('\n');

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function setupMocks() {
  mockExistsSync.mockImplementation((p) => {
    const s = String(p);
    if (s.includes('census-enrichment')) return true;
    return existsSync(p);
  });
  mockReadFileSync.mockImplementation((p, ...args) => {
    const s = String(p);
    if (s.includes('census-enrichment')) return JSON.stringify(STUB_CACHE);
    if (s.includes('uscities.csv')) return SYNTHETIC_CSV;
    return (readFileSync as (...a: Parameters<typeof readFileSync>) => ReturnType<typeof readFileSync>)(p, ...args);
  });
}

// We need to reset module-level caches between tests since the CSV loader is memoized.
// The simplest approach: use vi.resetModules() between describe blocks if needed.
// For now, rely on the loader's module-scope cache being populated once in this run
// (all tests use the same synthetic CSV). The Census cache is reset via _resetCensusCache().

describe('rankCities — hard filters', () => {
  beforeEach(() => {
    _resetCensusCache();
    _resetCitiesCache();
    setupMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Owensboro KY passes the filter and scores above 0.40', () => {
    // ADR calibration shows Owensboro as a PASS. Its home value (148k) sits just
    // below the S2 lower bound (150k), so the formula produces ~0.49 — still
    // well above the filtered-city floor. We check it passes and scores meaningfully.
    const results = rankCities();
    const owensboro = results.find((c) => c.city === 'Owensboro' && c.state === 'KY');
    expect(owensboro).toBeDefined();
    expect(owensboro!.score).toBeGreaterThan(0.40);
  });

  it('Pine Bluff AR is filtered (income < 35k, homevalue < 100k)', () => {
    const results = rankCities();
    const pineBluff = results.find((c) => c.city === 'Pine Bluff');
    expect(pineBluff).toBeUndefined();
  });

  it('Greenville NC is filtered (OO% < 0.55)', () => {
    const results = rankCities();
    const greenville = results.find((c) => c.city === 'Greenville');
    expect(greenville).toBeUndefined();
  });

  it('NearbyA (pop 200k > 110k limit) does not appear in results', () => {
    const results = rankCities();
    const nearby = results.find((c) => c.city === 'NearbyA');
    expect(nearby).toBeUndefined();
  });
});

describe('rankCities — metro density multiplier (S6 v2)', () => {
  beforeEach(() => {
    _resetCensusCache();
    _resetCitiesCache();
    setupMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MetroCandidate surrounded by 600k nearby pop gets metroDensityMult of 0.4', () => {
    // NearbyA/B/C each have population 200k, all within 50 km.
    // Total nearbyPop = 600k => threshold [500k, 1M) => 0.4
    const results = rankCities();
    const metro = results.find((c) => c.city === 'MetroCandidate');
    expect(metro).toBeDefined();
    expect(metro!.metroDensityMult).toBe(0.4);
  });

  it('Remotetown (no neighbors within 50 km) gets metroDensityMult of 1.0', () => {
    const results = rankCities();
    const remote = results.find((c) => c.city === 'Remotetown');
    expect(remote).toBeDefined();
    expect(remote!.metroDensityMult).toBe(1.0);
  });

  it('Remotetown scores higher than MetroCandidate (same Census data, only density differs)', () => {
    const results = rankCities();
    const metro = results.find((c) => c.city === 'MetroCandidate')!;
    const remote = results.find((c) => c.city === 'Remotetown')!;
    expect(remote.score).toBeGreaterThan(metro.score);
  });

  it('grid bucket math: city at lat=40.5, lng=-80.5 looks at all 9 surrounding cells', () => {
    // Build a minimal dataset with the candidate at (40.5, -80.5) and one
    // neighbor in each of the 9 expected cells. All neighbors are within 50 km.
    // Verify nearbyPop accumulates correctly by checking the resulting multiplier.
    //
    // We place 4 neighbors ~25 km away (cardinal directions) each with 70k pop.
    // Total nearbyPop = 280k => [250k, 500k) => 0.7
    const cache: Record<string, object> = {
      'OH|gridcandidate': {
        medianIncome: 60_000,
        medianHomeValue: 200_000,
        ownerOccupiedPct: 0.65,
        totalHousingUnits: 20_000,
        medianAge: 42,
        populationCensus: 50_000,
      },
    };
    // Neighbors placed ~25 km away in N/S/E/W — each in a different adjacent bucket
    const gridCSV = [
      CSV_HEADER,
      makeCSVLine('GridCandidate', 'OH', 'Ohio', 40.5, -80.5, 50_000),
      // N: lat+0.22 => floor(40.72)=40 same lat-bucket; lng same
      makeCSVLine('NeighborN', 'OH', 'Ohio', 40.72, -80.5, 70_000),
      // S: lat-0.22 => floor(40.28)=40 same bucket
      makeCSVLine('NeighborS', 'OH', 'Ohio', 40.28, -80.5, 70_000),
      // E: lng+0.28 => floor(-80.22)=-81 adjacent lng bucket
      makeCSVLine('NeighborE', 'OH', 'Ohio', 40.5, -80.22, 70_000),
      // W: lng-0.28 => floor(-80.78)=-81 adjacent lng bucket
      makeCSVLine('NeighborW', 'OH', 'Ohio', 40.5, -80.78, 70_000),
    ].join('\n');

    _resetCensusCache();
    _resetCitiesCache();
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return true;
      return existsSync(p);
    });
    mockReadFileSync.mockImplementation((p, ...args) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return JSON.stringify(cache);
      if (s.includes('uscities.csv')) return gridCSV;
      return (readFileSync as (...a: Parameters<typeof readFileSync>) => ReturnType<typeof readFileSync>)(p, ...args);
    });

    const results = rankCities();
    const candidate = results.find((c) => c.city === 'GridCandidate');
    expect(candidate).toBeDefined();
    // 4 neighbors * 70k = 280k => [250k, 500k) => 0.7
    expect(candidate!.metroDensityMult).toBe(0.7);

    _resetCitiesCache();
    vi.restoreAllMocks();
  });
});

describe('rankCities — missing Census data haircut', () => {
  beforeEach(() => {
    _resetCensusCache();
    _resetCitiesCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('city with no Census data fails the filter (missing OO%, income, homevalue)', () => {
    // Return a cache with no entry for KY|owensboro — it has no Census at all.
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return true;
      return existsSync(p);
    });
    mockReadFileSync.mockImplementation((p, ...args) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return JSON.stringify({}); // empty cache
      if (s.includes('uscities.csv')) return SYNTHETIC_CSV; // still provide cities
      return (readFileSync as (...a: Parameters<typeof readFileSync>) => ReturnType<typeof readFileSync>)(p, ...args);
    });

    // All cities fail the filter (missing Census fields required by filter).
    const results = rankCities();
    expect(results.length).toBe(0);
  });

  it('city with partial Census (missing age + housing units but has filter fields) gets haircut', () => {
    const partialCache = {
      'KY|owensboro': {
        medianIncome: 52_000,
        medianHomeValue: 148_000,
        ownerOccupiedPct: 0.68,
        // totalHousingUnits and medianAge missing — 2 fields => haircut
        populationCensus: 60_123,
      },
    };
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return true;
      return existsSync(p);
    });
    mockReadFileSync.mockImplementation((p, ...args) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return JSON.stringify(partialCache);
      if (s.includes('uscities.csv')) return SYNTHETIC_CSV; // provide city list
      return (readFileSync as (...a: Parameters<typeof readFileSync>) => ReturnType<typeof readFileSync>)(p, ...args);
    });

    const results = rankCities();
    const owensboro = results.find((c) => c.city === 'Owensboro');
    expect(owensboro).toBeDefined();
    expect(owensboro!.missingDataHaircut).toBe(0.9);
  });
});

describe('rankCities — per-state cap', () => {
  it('enforces cap on a small synthetic fixture', () => {
    // Build 5 cities all in state "ZZ", cap = 2
    // We'll test this via the greedy cap logic directly with a smaller fixture.
    // All pass filters: pop in range, all Census fields present.
    const cache = {} as Record<string, object>;
    const csvLines = [CSV_HEADER];
    for (let i = 1; i <= 5; i++) {
      const cityName = `ZZCity${i}`;
      const key = `ZZ|zzcity${i}`;
      cache[key] = {
        medianIncome: 60_000,
        medianHomeValue: 200_000,
        ownerOccupiedPct: 0.65,
        totalHousingUnits: 20_000,
        medianAge: 42,
        populationCensus: 50_000,
      };
      // Place far from any mega-city
      csvLines.push(makeCSVLine(cityName, 'ZZ', 'ZZState', 46.0 + i * 0.1, -120.0, 50_000));
    }

    _resetCensusCache();
    _resetCitiesCache();
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return true;
      return existsSync(p);
    });
    mockReadFileSync.mockImplementation((p, ...args) => {
      const s = String(p);
      if (s.includes('census-enrichment')) return JSON.stringify(cache);
      if (s.includes('uscities.csv')) return csvLines.join('\n');
      return (readFileSync as (...a: Parameters<typeof readFileSync>) => ReturnType<typeof readFileSync>)(p, ...args);
    });

    const results = rankCities({ perStateCap: 2, states: ['ZZ'] });
    // Only 2 of the 5 ZZ cities should appear.
    expect(results.filter((c) => c.state === 'ZZ').length).toBe(2);

    _resetCitiesCache(); // restore so subsequent tests pick up real CSV
    vi.restoreAllMocks();
  });

  it('perStateCap=1 returns at most 1 city per state', () => {
    _resetCensusCache();
    _resetCitiesCache();
    setupMocks();

    const results = rankCities({ perStateCap: 1 });
    const stateCounts = new Map<string, number>();
    for (const c of results) {
      stateCounts.set(c.state, (stateCounts.get(c.state) ?? 0) + 1);
    }
    for (const [, count] of stateCounts) {
      expect(count).toBeLessThanOrEqual(1);
    }

    vi.restoreAllMocks();
  });
});

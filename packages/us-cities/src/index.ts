export {
  rankCities,
  computeCityMarketScores,
  type RankedCity,
  type RankCitiesOpts,
  type MarketSignal,
  type ComputeCityMarketScoresOpts,
} from './city-ranker';

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export interface UsCity {
  city: string;
  state: string;       // 2-letter state code
  stateName: string;
  county: string;
  population: number;
  lat: number;
  lng: number;
}

export interface ListCitiesOpts {
  populationMin?: number;  // default 10_000
  populationMax?: number;  // default 100_000
  states?: string[];       // 2-letter codes; omit = all states
  sampleN?: number;        // if set, uniform random sample without replacement
}

// ---------------------------------------------------------------------------
// Minimal CSV parser that handles RFC-4180 quoted fields (zips column has
// commas inside double-quoted fields). The CSV has no escaped quotes inside
// quoted fields so we keep this intentionally simple.
// ---------------------------------------------------------------------------
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field — scan to closing quote.
      let end = i + 1;
      while (end < line.length && line[end] !== '"') end++;
      fields.push(line.slice(i + 1, end));
      i = end + 1; // skip closing quote
      if (line[i] === ',') i++;
    } else {
      // Unquoted field.
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Module-scoped cache — parse once on first call.
// ---------------------------------------------------------------------------
let _cache: UsCity[] | null = null;

/**
 * Reset the in-memory cities cache. Only for use in tests.
 * @internal
 */
export function _resetCitiesCache(): void {
  _cache = null;
}

function loadAll(): UsCity[] {
  if (_cache) return _cache;

  const csvPath = join(dirname(fileURLToPath(import.meta.url)), '../data/uscities.csv');
  const raw = readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n');

  // Header: city,city_ascii,state_id,state_name,county_fips,county_name,lat,lng,population,density,source,military,incorporated,...
  // Indices (0-based):
  //   0=city  2=state_id  3=state_name  5=county_name  6=lat  7=lng  8=population  12=incorporated
  const cities: UsCity[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const f = parseCSVLine(line);
    if (f.length < 13) continue;

    const incorporated = f[12];
    if (incorporated !== 'TRUE') continue;

    const pop = parseFloat(f[8] ?? '0');
    if (isNaN(pop)) continue;

    cities.push({
      city: f[0] ?? '',
      state: f[2] ?? '',
      stateName: f[3] ?? '',
      county: f[5] ?? '',
      population: Math.round(pop),
      lat: parseFloat(f[6] ?? '0'),
      lng: parseFloat(f[7] ?? '0'),
    });
  }

  _cache = cities;
  return cities;
}

// ---------------------------------------------------------------------------
// Fisher-Yates uniform random sample without replacement.
// ---------------------------------------------------------------------------
function sample<T>(arr: T[], n: number): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0 && i >= result.length - n; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result.slice(result.length - Math.min(n, result.length));
}

// ---------------------------------------------------------------------------
// Census enrichment types. Canonical definition lives here — the enrichment
// script (scripts/enrich-from-census.ts) and the Census client (src/census.ts)
// are both within this package, so us-cities has no dependency on integrations.
// ---------------------------------------------------------------------------

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

export type UsCityEnriched = UsCity & Partial<UsCityCensus>;

// ---------------------------------------------------------------------------
// Module-scoped census cache — lazy-loaded on first call to listCitiesEnriched.
// ---------------------------------------------------------------------------
let _censusCache: Record<string, UsCityCensus> | null = null;
let _censusCacheLoaded = false;

function loadCensusCache(): Record<string, UsCityCensus> {
  if (_censusCacheLoaded) return _censusCache ?? {};
  _censusCacheLoaded = true;
  const cachePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../data/census-enrichment.json',
  );
  if (!existsSync(cachePath)) {
    // Cache not yet generated — callers get undefined for demographic fields.
    _censusCache = {};
    return _censusCache;
  }
  try {
    const raw = readFileSync(cachePath, 'utf8');
    _censusCache = JSON.parse(raw) as Record<string, UsCityCensus>;
  } catch {
    _censusCache = {};
  }
  return _censusCache;
}

export function listCities(opts: ListCitiesOpts = {}): UsCity[] {
  const {
    populationMin = 10_000,
    populationMax = 100_000,
    states,
    sampleN,
  } = opts;

  const stateSet = states?.length ? new Set(states.map((s) => s.toUpperCase())) : null;

  const all = loadAll();
  const filtered = all.filter((c) => {
    if (c.population < populationMin) return false;
    if (c.population > populationMax) return false;
    if (stateSet && !stateSet.has(c.state)) return false;
    return true;
  });

  if (sampleN !== undefined) {
    return sample(filtered, sampleN);
  }
  return filtered;
}

/**
 * Same as listCities but overlays Census ACS 5-Year demographic data where
 * available. Cities without a Census match return undefined for all Census
 * fields — callers should handle Partial<UsCityCensus>.
 *
 * The Census cache file is read once on first call and memoized. If the cache
 * file doesn't exist yet (i.e. enrich:census hasn't been run), this function
 * degrades gracefully and returns the base UsCity data with no Census fields.
 *
 * Cache key: `${state2}|${city_ascii_lowercased}` — matches the key format
 * written by packages/us-cities/scripts/enrich-from-census.ts.
 */
/**
 * Reset the in-memory Census cache. Only for use in tests.
 * @internal
 */
export function _resetCensusCache(): void {
  _censusCache = null;
  _censusCacheLoaded = false;
}

export function listCitiesEnriched(opts: ListCitiesOpts = {}): UsCityEnriched[] {
  const cities = listCities(opts);
  const cache = loadCensusCache();

  return cities.map((c) => {
    const key = `${c.state}|${c.city.toLowerCase()}`;
    const census = cache[key];
    if (!census) return { ...c };
    return {
      ...c,
      medianIncome: census.medianIncome,
      medianHomeValue: census.medianHomeValue,
      ownerOccupiedPct: census.ownerOccupiedPct,
      totalHousingUnits: census.totalHousingUnits,
      medianAge: census.medianAge,
      populationCensus: census.populationCensus,
    };
  });
}

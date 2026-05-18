import { readFileSync } from 'node:fs';
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

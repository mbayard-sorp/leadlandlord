/**
 * City Ranker — ADR 0008
 *
 * Scores and ranks US cities for rank-and-rent market selection using
 * five Census-derived signals plus a suburb proximity multiplier.
 *
 * Pure function: no I/O beyond the listCitiesEnriched() loader.
 */

import { listCitiesEnriched, type UsCityEnriched } from './index.js';

export interface RankedCity extends UsCityEnriched {
  score: number; // 0–1
  metroDensityMult: number; // 0–1, the S6 multiplier
  missingDataHaircut: number; // 1.0 or 0.90
  subscores: {
    s1_ownerOccupied: number;
    s2_wealth: number;
    s3_housingUnits: number;
    s4_popBand: number;
    s5_age: number;
  };
}

export interface RankCitiesOpts {
  limit?: number; // default 150
  perStateCap?: number; // default 12 — diversity constraint
  states?: string[]; // optional state allowlist
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp x to [lo, hi] then linear rescale to [0, 1]. */
function normClamp(x: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
}

/** Haversine distance in km between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * S4 tent function — peaks around 50k–70k, slopes down toward 110k.
 * Uses Census pop if available, falls back to SimpleMaps pop.
 */
function popTentScore(pop: number): number {
  if (pop <= 80_000) {
    return normClamp(pop, 20_000, 80_000);
  } else if (pop <= 110_000) {
    return normClamp(110_000 - pop, 0, 30_000);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// S6 — Metro Density (grid-bucket spatial index)
// ---------------------------------------------------------------------------

type GridBuckets = Map<string, UsCityEnriched[]>;

/**
 * Build a 1-degree lat/lng grid so per-candidate lookups scan only ~9 cells
 * instead of the full 31k city list (O(n) pre-compute, O(k) per lookup).
 */
function buildGridBuckets(allCities: UsCityEnriched[]): GridBuckets {
  const buckets: GridBuckets = new Map();
  for (const city of allCities) {
    const key = `${Math.floor(city.lat)},${Math.floor(city.lng)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(city);
    } else {
      buckets.set(key, [city]);
    }
  }
  return buckets;
}

/**
 * Sum population of all cities within 50 km of candidate (excluding itself).
 * Scans the 3x3 neighborhood of grid cells to cover the radius without
 * iterating the full dataset.
 */
function nearbyPopulation(
  candidate: UsCityEnriched,
  gridBuckets: GridBuckets,
): number {
  const latCell = Math.floor(candidate.lat);
  const lngCell = Math.floor(candidate.lng);
  let total = 0;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const key = `${latCell + dLat},${lngCell + dLng}`;
      const bucket = gridBuckets.get(key);
      if (!bucket) continue;
      for (const city of bucket) {
        if (city === candidate) continue;
        const dist = haversineKm(candidate.lat, candidate.lng, city.lat, city.lng);
        if (dist <= 50) {
          total += city.population;
        }
      }
    }
  }
  return total;
}

/**
 * S6 metro density multiplier based on cumulative nearby population within 50 km.
 */
function getMetroDensityMultiplier(
  candidate: UsCityEnriched,
  gridBuckets: GridBuckets,
): number {
  const pop = nearbyPopulation(candidate, gridBuckets);
  if (pop < 250_000) return 1.0;
  if (pop < 500_000) return 0.7;
  if (pop < 1_000_000) return 0.4;
  return 0.15;
}

/**
 * Count missing Census fields that are critical for scoring.
 * A city is considered data-sparse if >= 2 Census fields are missing.
 */
function countMissingCensusFields(c: UsCityEnriched): number {
  let missing = 0;
  if (c.ownerOccupiedPct === undefined) missing++;
  if (c.medianIncome === undefined) missing++;
  if (c.medianHomeValue === undefined) missing++;
  if (c.totalHousingUnits === undefined) missing++;
  if (c.medianAge === undefined) missing++;
  return missing;
}

// ---------------------------------------------------------------------------
// Hard filter
// ---------------------------------------------------------------------------

/**
 * Returns true if the city passes all hard filters.
 * Cities missing Census filter fields (ownerOccupiedPct, medianIncome,
 * medianHomeValue) fail the filter — we can't confirm they meet the floor.
 */
function passesHardFilters(c: UsCityEnriched): boolean {
  const pop = c.populationCensus ?? c.population;

  if (pop < 15_000 || pop > 110_000) return false;

  // If any filter-critical Census field is missing, fail.
  if (c.ownerOccupiedPct === undefined) return false;
  if (c.medianIncome === undefined) return false;
  if (c.medianHomeValue === undefined) return false;

  if (c.ownerOccupiedPct < 0.55) return false;
  if (c.medianIncome < 35_000) return false;
  if (c.medianHomeValue < 100_000) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function rankCities(opts: RankCitiesOpts = {}): RankedCity[] {
  const { limit = 150, perStateCap = 12, states } = opts;

  // Load all cities (no population filter — hard filter handles bounds).
  const all = listCitiesEnriched({
    populationMin: 1,
    populationMax: 999_999_999,
    states,
  });

  // Build spatial index over ALL cities (not just candidates) so metro
  // population from cities that fail our hard filters still contributes.
  const gridBuckets = buildGridBuckets(all);

  const candidates = all.filter(passesHardFilters);

  const scored: RankedCity[] = candidates.map((c) => {
    const missingCount = countMissingCensusFields(c);
    const missingDataHaircut = missingCount >= 2 ? 0.9 : 1.0;

    // S1 — Owner-occupancy (neutral 0.5 if missing, but filter already blocks missing OO)
    const s1_ownerOccupied = normClamp(c.ownerOccupiedPct ?? 0.7, 0.55, 0.85);

    // S2 — Wealth composite
    const s2_wealth =
      0.6 * normClamp(c.medianIncome ?? 65_000, 45_000, 100_000) +
      0.4 * normClamp(c.medianHomeValue ?? 250_000, 150_000, 500_000);

    // S3 — Housing units (log-scaled)
    const units = c.totalHousingUnits ?? 15_000;
    const s3_housingUnits = Math.min(1, Math.log10(Math.max(1, units)) / Math.log10(35_000));

    // S4 — Population band fit (tent function)
    const pop = c.populationCensus ?? c.population;
    const s4_popBand = popTentScore(pop);

    // S5 — Median age (peaks at 46)
    const age = c.medianAge ?? 42;
    const s5_age = Math.max(0, 1 - Math.abs(age - 46) / 18);

    // S6 — Metro density multiplier (cumulative nearby population within 50 km)
    const metroDensityMult = getMetroDensityMultiplier(c, gridBuckets);

    const rawScore =
      0.25 * s1_ownerOccupied +
      0.20 * s2_wealth +
      0.20 * s3_housingUnits +
      0.15 * s4_popBand +
      0.10 * s5_age;

    const score = rawScore * metroDensityMult * missingDataHaircut;

    return {
      ...c,
      score,
      metroDensityMult,
      missingDataHaircut,
      subscores: {
        s1_ownerOccupied,
        s2_wealth,
        s3_housingUnits,
        s4_popBand,
        s5_age,
      },
    };
  });

  // Sort by score descending.
  scored.sort((a, b) => b.score - a.score);

  // Apply per-state cap greedily in score order, then slice to limit.
  const stateCounts = new Map<string, number>();
  const diverse: RankedCity[] = [];
  for (const city of scored) {
    const count = stateCounts.get(city.state) ?? 0;
    if (count < perStateCap) {
      diverse.push(city);
      stateCounts.set(city.state, count + 1);
    }
  }

  return diverse.slice(0, limit);
}

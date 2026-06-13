import { describe, it, expect } from 'vitest';
import {
  computeClusterVolume,
  computeClusterDifficulty,
  estimateScoutValue,
  estimateValidatedValue,
  passesAbilityToPayFloor,
  findValueCliff,
  DEFAULT_BENCHMARK_CLUSTER_VOLUME,
  US_POPULATION,
} from './value-model';
import {
  POP_DAMPENING_REFERENCE,
  DEFAULT_BENCHMARK_WINNABILITY,
  MIN_LEAD_BENCHMARK_PRICE,
  MIN_RENTABILITY_PRIOR,
} from './scoring-config';

// tree removal: leadBenchmarkPrice = (40+80)/2 = 60, rentabilityPrior = 0.72
// (lead-benchmarks.ts TRADE_BENCHMARKS).

describe('computeClusterVolume', () => {
  it('sums commercial + transactional at full weight, null intent at 50%, drops informational', () => {
    const volume = computeClusterVolume([
      { search_volume: 100, intent: 'commercial' },
      { search_volume: 50, intent: 'transactional' },
      { search_volume: 40, intent: null },
      { search_volume: 70, intent: 'informational' },
      { search_volume: 30, intent: 'navigational' },
    ]);
    expect(volume).toBe(170); // 100 + 50 + 20
  });

  it('returns 0 for an empty cluster', () => {
    expect(computeClusterVolume([])).toBe(0);
  });
});

// ---- computeClusterDifficulty -----------------------------------------------

describe('computeClusterDifficulty', () => {
  it('returns volume-weighted avg kd over commercial/transactional candidates', () => {
    const kd = computeClusterDifficulty([
      { search_volume: 4000, intent: 'commercial', kd: 30 },
      { search_volume: 2000, intent: 'transactional', kd: 60 },
    ]);
    // weightedSum = 4000*30 + 2000*60 = 120000+120000 = 240000; totalWeight = 6000
    // avg = 240000/6000 = 40
    expect(kd).toBeCloseTo(40, 5);
  });

  it('applies NULL_INTENT_WEIGHT (0.5) to null-intent candidates', () => {
    const kd = computeClusterDifficulty([
      { search_volume: 1000, intent: null, kd: 20 },
    ]);
    // weight = 1000 * 0.5 = 500; weightedSum = 20 * 500 = 10000
    expect(kd).toBeCloseTo(20, 5); // 10000 / 500
  });

  it('skips candidates where kd <= 0 (DFS missing-data sentinel)', () => {
    const kd = computeClusterDifficulty([
      { search_volume: 5000, intent: 'commercial', kd: 0 },   // skip
      { search_volume: 5000, intent: 'commercial', kd: -1 },  // skip
      { search_volume: 2000, intent: 'commercial', kd: 50 },  // use
    ]);
    expect(kd).toBeCloseTo(50, 5);
  });

  it('returns null when ALL candidates have kd <= 0', () => {
    const kd = computeClusterDifficulty([
      { search_volume: 5000, intent: 'commercial', kd: 0 },
    ]);
    expect(kd).toBeNull();
  });

  it('returns null for empty cluster', () => {
    expect(computeClusterDifficulty([])).toBeNull();
  });

  it('ignores informational/navigational intent even if kd > 0', () => {
    const kd = computeClusterDifficulty([
      { search_volume: 10000, intent: 'informational', kd: 80 },
      { search_volume: 10000, intent: 'navigational', kd: 80 },
      { search_volume: 1000, intent: 'commercial', kd: 20 },
    ]);
    expect(kd).toBeCloseTo(20, 5);
  });
});

// ---- estimateScoutValue (ADR 0021 updates) -----------------------------------

describe('estimateScoutValue', () => {
  it('computes sqrt-dampened population-proportional dollar value with winnability', () => {
    const cityPop = US_POPULATION / 1000;
    const clusterVolume = 33_400;
    const v = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: cityPop,
      clusterVolume,
      clusterDifficulty: null, // benchmark winnability
    });
    // cityVolume = clusterVolume * sqrt(cityPop * REF) / US_POP
    const expectedCityVol =
      (clusterVolume * Math.sqrt(cityPop * POP_DAMPENING_REFERENCE)) / US_POPULATION;
    // estMonthlyValueUsd = cityVol * 0.2 * DEFAULT_BENCHMARK_WINNABILITY * 0.1 * 60
    const expectedValue = expectedCityVol * 0.2 * DEFAULT_BENCHMARK_WINNABILITY * 0.1 * 60;
    expect(v.dataConfidence).toBe('cluster');
    expect(v.leadBenchmarkPrice).toBe(60);
    expect(v.rentabilityPrior).toBe(0.72);
    expect(v.winnability).toBe(DEFAULT_BENCHMARK_WINNABILITY);
    expect(v.estMonthlyValueUsd).toBeCloseTo(expectedValue, 1);
    expect(v.scoutScore).toBeCloseTo(expectedValue * 0.72, 1);
  });

  it('uses clusterDifficulty to compute winnability when provided', () => {
    const v = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      clusterDifficulty: 40,
    });
    // winnability = (100-40)/100 = 0.6
    expect(v.winnability).toBeCloseTo(0.6, 5);
  });

  it('high difficulty lowers score vs low difficulty (order preserved)', () => {
    const low = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      clusterDifficulty: 20,
    });
    const high = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      clusterDifficulty: 80,
    });
    expect(low.estMonthlyValueUsd).toBeGreaterThan(high.estMonthlyValueUsd);
    expect(low.winnability).toBeGreaterThan(high.winnability);
  });

  it('dampening: 600k city scores ~sqrt(10)x a 60k city (not 10x)', () => {
    const small = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 60_000,
      clusterVolume: 10_000,
      clusterDifficulty: 30,
    });
    const large = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 600_000,
      clusterVolume: 10_000,
      clusterDifficulty: 30,
    });
    // Ratio should be sqrt(600k/60k) = sqrt(10) ≈ 3.162
    const ratio = large.estMonthlyValueUsd / small.estMonthlyValueUsd;
    expect(ratio).toBeCloseTo(Math.sqrt(10), 1);
    // Order still preserved
    expect(large.estMonthlyValueUsd).toBeGreaterThan(small.estMonthlyValueUsd);
  });

  it('degrades to benchmark_only with null cluster volume', () => {
    const v = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: US_POPULATION / 1000,
      clusterVolume: null,
      clusterDifficulty: null,
    });
    expect(v.dataConfidence).toBe('benchmark_only');
    expect(v.estCityVolume).toBeNull();
  });

  it('benchmark_only ranks below a cluster-backed trade of equal cluster volume basis', () => {
    const cluster = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 50_000,
      clusterVolume: 50_000,
      clusterDifficulty: null,
    });
    const benchmarkOnly = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 50_000,
      clusterVolume: null,
      clusterDifficulty: null,
    });
    expect(benchmarkOnly.estMonthlyValueUsd).toBeLessThan(cluster.estMonthlyValueUsd);
  });

  it('respects operator CTR/call-rate overrides', () => {
    const base = estimateScoutValue({
      trade: 'roofing',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      clusterDifficulty: 50,
    });
    const tuned = estimateScoutValue({
      trade: 'roofing',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      clusterDifficulty: 50,
      ctrAtRank: 0.1,
      callRate: 0.05,
    });
    expect(tuned.estMonthlyValueUsd).toBeCloseTo(base.estMonthlyValueUsd / 4, 1);
  });

  it('defaultWinnability override is used when clusterDifficulty is null', () => {
    const v = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      clusterDifficulty: null,
      defaultWinnability: 0.7,
    });
    expect(v.winnability).toBe(0.7);
  });
});

// ---- passesAbilityToPayFloor ------------------------------------------------

describe('passesAbilityToPayFloor', () => {
  it('keeps legal trades (high lead price, high rentability)', () => {
    expect(passesAbilityToPayFloor('personal injury lawyer')).toBe(true);
    expect(passesAbilityToPayFloor('divorce lawyer')).toBe(true);
  });

  it('keeps medical trades (above both floors)', () => {
    expect(passesAbilityToPayFloor('dental implants')).toBe(true);
    expect(passesAbilityToPayFloor('dermatology clinic')).toBe(true);
  });

  it('keeps core home services (tree, roofing, HVAC)', () => {
    expect(passesAbilityToPayFloor('tree removal')).toBe(true);
    expect(passesAbilityToPayFloor('roofing contractor')).toBe(true);
    expect(passesAbilityToPayFloor('hvac repair')).toBe(true);
  });

  it('drops the default pair ($45/0.50) — unknown niche fails both floors', () => {
    // Default pair: leadBenchmarkPrice=45 < 50, rentabilityPrior=0.5 < 0.6
    expect(passesAbilityToPayFloor('totally unknown exotic trade xyz')).toBe(false);
  });

  it('drops low-ticket trades (pressure washing: $32.5 lead price, 0.32 prior)', () => {
    expect(passesAbilityToPayFloor('pressure washing services')).toBe(false);
  });

  it('drops junk removal (lead price $30, prior 0.30 — both below floors)', () => {
    expect(passesAbilityToPayFloor('junk removal')).toBe(false);
  });

  it('respects minLeadBenchmarkPrice override', () => {
    // tree removal: $60 lead price. Raise floor to $70 → should fail price floor.
    expect(passesAbilityToPayFloor('tree removal', { minLeadBenchmarkPrice: 70 })).toBe(false);
    // Lower floor to $40 → should pass.
    expect(passesAbilityToPayFloor('pressure washing services', { minLeadBenchmarkPrice: 30 })).toBe(false); // still fails prior
  });

  it('respects minRentabilityPrior override', () => {
    // tree removal: prior 0.72. Raise prior floor to 0.80 → fails prior.
    expect(passesAbilityToPayFloor('tree removal', { minRentabilityPrior: 0.80 })).toBe(false);
  });

  it('floor constants are at expected values', () => {
    expect(MIN_LEAD_BENCHMARK_PRICE).toBe(50);
    expect(MIN_RENTABILITY_PRIOR).toBe(0.60);
  });
});

// ---- estimateValidatedValue (existing tests, no changes to formula) ---------

describe('estimateValidatedValue', () => {
  it('uses measured volume above the DFS trust floor', () => {
    const v = estimateValidatedValue({
      trade: 'tree removal',
      measuredCityVolume: 200,
      estCityVolume: 80,
      serpDifficulty: 40,
      rentabilityScore: 50,
    });
    expect(v.volume).toBe(200);
    expect(v.volumeSource).toBe('dataforseo');
    expect(v.winnability).toBeCloseTo(0.6, 5);
    // 200 * 0.2 * 0.6 * 0.1 * 60 = 144
    expect(v.validatedValueUsd).toBeCloseTo(144, 2);
    expect(v.validatedScore).toBeCloseTo(72, 2);
  });

  it('falls back to the estimate below the trust floor', () => {
    const v = estimateValidatedValue({
      trade: 'tree removal',
      measuredCityVolume: 50,
      estCityVolume: 80,
      serpDifficulty: 0,
      rentabilityScore: 100,
    });
    expect(v.volume).toBe(80);
    expect(v.volumeSource).toBe('claude_estimate');
  });

  it('clamps winnability for difficulty > 100', () => {
    const v = estimateValidatedValue({
      trade: 'plumbing',
      measuredCityVolume: 500,
      estCityVolume: 0,
      serpDifficulty: 120,
      rentabilityScore: 50,
    });
    expect(v.winnability).toBe(0);
    expect(v.validatedValueUsd).toBe(0);
  });
});

// ---- findValueCliff (unchanged) ---------------------------------------------

describe('findValueCliff', () => {
  it('finds the largest relative drop within ranks 5..50', () => {
    const values = [100, 90, 80, 70, 60, 50, 10, 9, 8, 7];
    const cliff = findValueCliff(values);
    expect(cliff.method).toBe('cliff');
    expect(cliff.n).toBe(6); // 50 -> 10 is the 80% drop
    expect(cliff.valueFloorUsd).toBe(50);
  });

  it('falls back to cumulative-80% on a flat curve', () => {
    const values = Array.from({ length: 20 }, () => 10);
    const cliff = findValueCliff(values);
    expect(cliff.method).toBe('cumulative_80');
    expect(cliff.n).toBe(16); // 16 * 10 = 160 >= 0.8 * 200
  });

  it('returns all candidates when 5 or fewer', () => {
    const cliff = findValueCliff([40, 30, 20]);
    expect(cliff.n).toBe(3);
    expect(cliff.method).toBe('all');
    expect(cliff.valueFloorUsd).toBe(20);
  });

  it('handles empty input', () => {
    expect(findValueCliff([]).n).toBe(0);
  });

  it('never recommends past rank 50', () => {
    const values = Array.from({ length: 200 }, (_, i) => 1000 - i);
    const cliff = findValueCliff(values);
    expect(cliff.n).toBeLessThanOrEqual(50);
  });
});

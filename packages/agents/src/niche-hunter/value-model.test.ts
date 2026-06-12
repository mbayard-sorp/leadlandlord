import { describe, it, expect } from 'vitest';
import {
  computeClusterVolume,
  estimateScoutValue,
  estimateValidatedValue,
  findValueCliff,
  DEFAULT_BENCHMARK_CLUSTER_VOLUME,
  US_POPULATION,
} from './value-model';

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

describe('estimateScoutValue', () => {
  it('computes population-proportional dollar value for a cluster-backed trade', () => {
    const v = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: US_POPULATION / 1000, // exact 1/1000 share
      clusterVolume: 33_400,
    });
    // cityVolume = 33400/1000 = 33.4; value = 33.4 * 0.2 * 0.1 * 60 = 40.08
    expect(v.dataConfidence).toBe('cluster');
    expect(v.estCityVolume).toBeCloseTo(33.4, 2);
    expect(v.leadBenchmarkPrice).toBe(60);
    expect(v.rentabilityPrior).toBe(0.72);
    expect(v.estMonthlyValueUsd).toBeCloseTo(40.08, 2);
    expect(v.scoutScore).toBeCloseTo(40.08 * 0.72, 2);
  });

  it('degrades to benchmark_only with null cluster volume', () => {
    const v = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: US_POPULATION / 1000,
      clusterVolume: null,
    });
    expect(v.dataConfidence).toBe('benchmark_only');
    expect(v.estCityVolume).toBeNull();
    // Uses DEFAULT_BENCHMARK_CLUSTER_VOLUME: 3 * 0.2 * 0.1 * 60 = 3.6
    expect(v.estMonthlyValueUsd).toBeCloseTo(
      (DEFAULT_BENCHMARK_CLUSTER_VOLUME / 1000) * 0.2 * 0.1 * 60,
      2,
    );
  });

  it('benchmark_only ranks below a cluster-backed trade of equal cluster volume basis', () => {
    const cluster = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 50_000,
      clusterVolume: 50_000,
    });
    const benchmarkOnly = estimateScoutValue({
      trade: 'tree removal',
      cityPopulation: 50_000,
      clusterVolume: null,
    });
    expect(benchmarkOnly.estMonthlyValueUsd).toBeLessThan(cluster.estMonthlyValueUsd);
  });

  it('respects operator CTR/call-rate overrides', () => {
    const base = estimateScoutValue({ trade: 'roofing', cityPopulation: 100_000, clusterVolume: 10_000 });
    const tuned = estimateScoutValue({
      trade: 'roofing',
      cityPopulation: 100_000,
      clusterVolume: 10_000,
      ctrAtRank: 0.1,
      callRate: 0.05,
    });
    expect(tuned.estMonthlyValueUsd).toBeCloseTo(base.estMonthlyValueUsd / 4, 1);
  });
});

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

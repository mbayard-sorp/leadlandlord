import { describe, it, expect } from 'vitest';
import { buildScoutReport, type ScoredCell } from './scout-report';
import { VALIDATION_COST_PER_CANDIDATE_USD } from './value-model';

function cell(overrides: Partial<ScoredCell> & { estMonthlyValueUsd: number }): ScoredCell {
  return {
    trade: 'tree removal',
    category: 'home_services',
    city: 'Casper',
    state: 'WY',
    population: 60_000,
    clusterVolume: 5000,
    estCityVolume: 30,
    leadBenchmarkPrice: 60,
    rentabilityPrior: 0.72,
    scoutScore: overrides.estMonthlyValueUsd * 0.72,
    dataConfidence: 'cluster',
    isNovelTrade: false,
    ...overrides,
  };
}

const GRID = {
  trades: 100,
  cities: 15,
  cells: 1480,
  excluded_existing: 20,
  excluded_denylist: 3,
  uncached_trades: 12,
};

describe('buildScoutReport', () => {
  it('samples the value curve at n=5,10,... and prices validation', () => {
    const cells = Array.from({ length: 60 }, (_, i) => cell({ estMonthlyValueUsd: 600 - i * 10 }));
    const report = buildScoutReport({ cellsDesc: cells, grid: GRID, generatedAt: '2026-06-12T00:00:00Z' });

    expect(report.value_curve.map((p) => p.n)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(report.value_curve[0]!.min_value_usd).toBe(560); // value at rank 5
    expect(report.value_curve[0]!.cumulative_validation_cost_usd).toBeCloseTo(
      5 * VALIDATION_COST_PER_CANDIDATE_USD,
      2,
    );
    expect(report.grid).toEqual(GRID);
  });

  it('recommends the value cliff and explains it', () => {
    const values = [1000, 900, 800, 700, 600, 500, 50, 45, 40, 35, 30, 25];
    const cells = values.map((v) => cell({ estMonthlyValueUsd: v }));
    const report = buildScoutReport({ cellsDesc: cells, grid: GRID, generatedAt: '2026-06-12T00:00:00Z' });

    expect(report.recommendation.n).toBe(6);
    expect(report.recommendation.value_floor_usd).toBe(500);
    expect(report.recommendation.est_validation_cost_usd).toBeCloseTo(6 * VALIDATION_COST_PER_CANDIDATE_USD, 2);
    expect(report.recommendation.rationale).toContain('top 6');
  });

  it('computes top-100 insights: population bands, categories, novel trades', () => {
    const cells = [
      cell({ estMonthlyValueUsd: 400, population: 20_000, category: 'home_services', isNovelTrade: true, trade: 'goat landscaping' }),
      cell({ estMonthlyValueUsd: 300, population: 80_000, category: 'auto' }),
      cell({ estMonthlyValueUsd: 200, population: 80_000, category: 'auto' }),
      cell({ estMonthlyValueUsd: 100, population: 120_000, category: 'legal' }),
    ];
    const report = buildScoutReport({ cellsDesc: cells, grid: GRID, generatedAt: '2026-06-12T00:00:00Z' });

    const bands = Object.fromEntries(report.insights.population_bands.map((b) => [b.band, b.share_of_top100_value]));
    expect(bands['<25k']).toBeCloseTo(0.4, 2);
    expect(bands['50k-100k']).toBeCloseTo(0.5, 2);
    expect(bands['100k+']).toBeCloseTo(0.1, 2);

    expect(report.insights.category_concentration[0]).toEqual({ category: 'auto', count_in_top100: 2 });
    expect(report.insights.novel_trades_in_top100).toBe(1);
  });

  it('parses against the zod schema (report is persisted as-is)', () => {
    const report = buildScoutReport({
      cellsDesc: [cell({ estMonthlyValueUsd: 10 })],
      grid: GRID,
      generatedAt: '2026-06-12T00:00:00Z',
    });
    expect(report.recommendation.n).toBe(1);
    expect(report.value_curve).toEqual([]);
  });
});

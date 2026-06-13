import { z } from 'zod';
import { findValueCliff, VALIDATION_COST_PER_CANDIDATE_USD } from './value-model';

/**
 * Scout report — persisted once as niche_scout_runs.report jsonb. The full
 * grid is scored in memory and never persisted, so the report CANNOT be
 * recomputed at read time; everything the operator UI renders beyond the
 * top candidates table lives here.
 */

export const ScoutReport = z.object({
  generated_at: z.string(),
  grid: z.object({
    trades: z.number(),
    cities: z.number(),
    cells: z.number(),
    excluded_existing: z.number(),
    excluded_denylist: z.number(),
    /** Count of trades dropped by the ability-to-pay floor (ADR 0021). */
    excluded_floor: z.number().default(0),
    uncached_trades: z.number(),
  }),
  /** Sampled at n = 5, 10, 15, ... so the UI can draw the curve cheaply. */
  value_curve: z.array(
    z.object({
      n: z.number(),
      min_value_usd: z.number(),
      cumulative_validation_cost_usd: z.number(),
    }),
  ),
  recommendation: z.object({
    n: z.number(),
    value_floor_usd: z.number(),
    est_validation_cost_usd: z.number(),
    rationale: z.string(),
  }),
  insights: z.object({
    population_bands: z.array(
      z.object({ band: z.string(), share_of_top100_value: z.number() }),
    ),
    category_concentration: z.array(
      z.object({ category: z.string(), count_in_top100: z.number() }),
    ),
    novel_trades_in_top100: z.number(),
  }),
});
export type ScoutReport = z.infer<typeof ScoutReport>;

/** The scored grid cell shape shared between scout.ts and the report builder. */
export interface ScoredCell {
  trade: string;
  category: string;
  city: string;
  state: string;
  population: number;
  clusterVolume: number | null;
  /** Volume-weighted avg kd; null = no usable kd (all kd <= 0 or no cluster). */
  clusterDifficulty: number | null;
  estCityVolume: number | null;
  leadBenchmarkPrice: number;
  rentabilityPrior: number;
  /** SEO competition winnability: clamp((100-kd)/100) or DEFAULT_BENCHMARK_WINNABILITY. */
  winnability: number;
  estMonthlyValueUsd: number;
  scoutScore: number;
  dataConfidence: 'cluster' | 'benchmark_only';
  isNovelTrade: boolean;
}

const POPULATION_BANDS: Array<{ band: string; min: number; max: number }> = [
  { band: '<25k', min: 0, max: 25_000 },
  { band: '25k-50k', min: 25_000, max: 50_000 },
  { band: '50k-100k', min: 50_000, max: 100_000 },
  { band: '100k+', min: 100_000, max: Number.POSITIVE_INFINITY },
];

export interface BuildScoutReportArgs {
  /** All scored cells, sorted by scoutScore desc (rank order). */
  cellsDesc: ScoredCell[];
  grid: ScoutReport['grid'];
  generatedAt: string;
  /**
   * Fraction of validation spend expected to be saved by warm caches
   * (0 = fully cold). Scout estimates this from how many of the recommended
   * candidates' trades have cached clusters.
   */
  expectedCacheSavingsRate?: number;
}

export function buildScoutReport(args: BuildScoutReportArgs): ScoutReport {
  const { cellsDesc, grid, generatedAt } = args;
  const savings = Math.max(0, Math.min(1, args.expectedCacheSavingsRate ?? 0));
  const costForN = (n: number) =>
    round2(n * VALIDATION_COST_PER_CANDIDATE_USD * (1 - savings));

  const values = cellsDesc.map((c) => c.estMonthlyValueUsd);

  const value_curve: ScoutReport['value_curve'] = [];
  for (let n = 5; n <= Math.min(50, values.length); n += 5) {
    value_curve.push({
      n,
      min_value_usd: values[n - 1]!,
      cumulative_validation_cost_usd: costForN(n),
    });
  }

  const cliff = findValueCliff(values);
  const recommendation: ScoutReport['recommendation'] = {
    n: cliff.n,
    value_floor_usd: cliff.valueFloorUsd,
    est_validation_cost_usd: costForN(cliff.n),
    rationale:
      cliff.method === 'cliff'
        ? `Largest value drop sits after rank ${cliff.n}: validating the top ${cliff.n} covers every candidate worth >= $${cliff.valueFloorUsd.toFixed(0)}/mo est. value.`
        : cliff.method === 'cumulative_80'
          ? `No sharp value cliff — the top ${cliff.n} candidates carry 80% of the top-50 estimated value.`
          : `Only ${cliff.n} candidates scored — validate them all.`,
  };

  const top100 = cellsDesc.slice(0, 100);
  const top100Value = top100.reduce((s, c) => s + c.estMonthlyValueUsd, 0);

  const population_bands = POPULATION_BANDS.map(({ band, min, max }) => {
    const bandValue = top100
      .filter((c) => c.population >= min && c.population < max)
      .reduce((s, c) => s + c.estMonthlyValueUsd, 0);
    return {
      band,
      share_of_top100_value: top100Value > 0 ? round2(bandValue / top100Value) : 0,
    };
  });

  const categoryCounts = new Map<string, number>();
  for (const c of top100) {
    categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
  }
  const category_concentration = Array.from(categoryCounts.entries())
    .map(([category, count_in_top100]) => ({ category, count_in_top100 }))
    .sort((a, b) => b.count_in_top100 - a.count_in_top100);

  const novelTrades = new Set(top100.filter((c) => c.isNovelTrade).map((c) => c.trade));

  return ScoutReport.parse({
    generated_at: generatedAt,
    grid,
    value_curve,
    recommendation,
    insights: {
      population_bands,
      category_concentration,
      novel_trades_in_top100: novelTrades.size,
    },
  });
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

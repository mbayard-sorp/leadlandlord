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
    /**
     * Geo-tier reporting surface (ADR 0022 §4). Aggregated over ALL scored
     * cells (not just the top 100) so the operator sees the full geographic
     * shape of demand vs competition. Both arrays sorted desc by
     * geoAttractiveness; the UI renders the top-10 of each.
     */
    geo_tiers: z.object({
      states: z.array(
        z.object({
          state: z.string(),
          demandDensity: z.number(),
          competitionSaturation: z.number(),
          geoAttractiveness: z.number(),
          candidateCount: z.number(),
        }),
      ),
      metros: z.array(
        z.object({
          county: z.string(),
          state: z.string(),
          demandDensity: z.number(),
          competitionSaturation: z.number(),
          geoAttractiveness: z.number(),
          candidateCount: z.number(),
        }),
      ),
      census_hit_rate: z.number(),
    }),
  }),
});
export type ScoutReport = z.infer<typeof ScoutReport>;

/** The scored grid cell shape shared between scout.ts and the report builder. */
export interface ScoredCell {
  trade: string;
  category: string;
  city: string;
  state: string;
  /** County the city sits in (UsCity.county) — geo-tier "metro" grouping key. */
  county: string;
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
  /** Structural metro-density competition multiplier (0.15–1.0); 1.0 = no geo signal. */
  metroDensityMult: number;
  /** Census-derived demand quality (0–1); 1.0 = no geo signal. */
  demandQuality: number;
  /** winnability audit fold: 1 − α_comp·(1 − metroDensityMult). */
  localRankMult: number;
  /** value audit fold: 1 − α_dem·(1 − demandQuality). */
  demandMult: number;
  /** True when the city had a Census match in computeCityMarketScores. */
  hasCensus: boolean;
  /** 'proxy' (Stage-1 structural) or 'local_serp' (Stage-3 refined). */
  refinementSource: 'proxy' | 'local_serp';
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

  const geo_tiers = buildGeoTiers(cellsDesc);

  return ScoutReport.parse({
    generated_at: generatedAt,
    grid,
    value_curve,
    recommendation,
    insights: {
      population_bands,
      category_concentration,
      novel_trades_in_top100: novelTrades.size,
      geo_tiers,
    },
  });
}

/** Cap on the number of metro (county) rows in the report to bound jsonb size. */
const GEO_TIERS_METROS_TOP_N = 25;

/**
 * Geo-tier aggregation (ADR 0022 §4): a diversity/reporting surface, NOT a
 * score multiplier. Aggregates over ALL scored cells. Per geography:
 *   demandDensity         = mean(demandQuality)
 *   competitionSaturation = mean(1 − metroDensityMult)
 *   geoAttractiveness     = demandDensity · mean(metroDensityMult)
 * census_hit_rate = (cells with hasCensus) / (total cells).
 * States include every group; metros are capped to the top-N by
 * geoAttractiveness. Both arrays sorted desc by geoAttractiveness.
 */
function buildGeoTiers(cells: ScoredCell[]): ScoutReport['insights']['geo_tiers'] {
  interface Acc {
    demandQualitySum: number;
    metroDensitySum: number;
    count: number;
  }
  const states = new Map<string, Acc>();
  const metros = new Map<string, Acc & { county: string; state: string }>();
  let censusHits = 0;

  for (const c of cells) {
    if (c.hasCensus) censusHits++;

    const s = states.get(c.state) ?? { demandQualitySum: 0, metroDensitySum: 0, count: 0 };
    s.demandQualitySum += c.demandQuality;
    s.metroDensitySum += c.metroDensityMult;
    s.count += 1;
    states.set(c.state, s);

    const metroKey = `${c.county}|${c.state}`;
    const m =
      metros.get(metroKey) ??
      { demandQualitySum: 0, metroDensitySum: 0, count: 0, county: c.county, state: c.state };
    m.demandQualitySum += c.demandQuality;
    m.metroDensitySum += c.metroDensityMult;
    m.count += 1;
    metros.set(metroKey, m);
  }

  const summarize = (a: Acc) => {
    const demandDensity = a.count > 0 ? a.demandQualitySum / a.count : 0;
    const meanMetroDensity = a.count > 0 ? a.metroDensitySum / a.count : 0;
    return {
      demandDensity: round(demandDensity),
      competitionSaturation: round(1 - meanMetroDensity),
      geoAttractiveness: round(demandDensity * meanMetroDensity),
      candidateCount: a.count,
    };
  };

  const stateRows = Array.from(states.entries())
    .map(([state, a]) => ({ state, ...summarize(a) }))
    .sort((x, y) => y.geoAttractiveness - x.geoAttractiveness);

  const metroRows = Array.from(metros.values())
    .map((a) => ({ county: a.county, state: a.state, ...summarize(a) }))
    .sort((x, y) => y.geoAttractiveness - x.geoAttractiveness)
    .slice(0, GEO_TIERS_METROS_TOP_N);

  return {
    states: stateRows,
    metros: metroRows,
    census_hit_rate: cells.length > 0 ? round(censusHits / cells.length) : 0,
  };
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Round a 0–1 ratio to 4 dp — geo-tier means need more precision than round2. */
function round(n: number): number {
  return Number(n.toFixed(4));
}

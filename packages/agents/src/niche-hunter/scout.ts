import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, niches, nicheScoutRuns, nicheCandidates, getSystemState, eq, and, inArray } from '@leadlandlord/db';
import { getKeywordCandidates, peekKeywordCandidates } from '@leadlandlord/integrations/dataforseo';
import { listCities, computeCityMarketScores, type MarketSignal } from '@leadlandlord/us-cities/loader';
import { SERVICE_TAXONOMY, CATEGORY_VALUES, type ServiceCategory } from './service-taxonomy';
import { isDenylisted } from './denylist';
import { computeClusterVolume, computeClusterDifficulty, estimateScoutValue, passesAbilityToPayFloor } from './value-model';
import { buildScoutReport, type ScoredCell } from './scout-report';

/**
 * Niche Scout — phase 1 of the deterministic scout/validate engine.
 *
 * Enumerates the full trade x city grid for the requested states, scores
 * every cell from cached/static data (90-day cached keyword clusters, static
 * lead benchmarks, rentability priors), ranks by dollar-denominated expected
 * monthly value, excludes combos already in `niches`, and persists the top N
 * candidates plus a report recommending how many are worth validating.
 *
 * 100% deterministic and LLM-free. The only spend is warming cluster-cache
 * misses (~$0.028/trade, skipped entirely when warm_missing_clusters=false).
 */

const CategoryEnum = z.enum(CATEGORY_VALUES);

export const NicheScoutInput = z.object({
  states: z
    .array(z.string().length(2).transform((s) => s.toUpperCase()))
    .min(1)
    .max(10),
  category_filter: CategoryEnum.optional(),
  population_min: z.number().int().nonnegative().default(15_000),
  population_max: z.number().int().positive().default(150_000),
  persist_top: z.number().int().positive().max(2000).default(500),
  /** false = strictly cache-only scout (zero DataForSEO spend). */
  warm_missing_clusters: z.boolean().default(true),
});
export type NicheScoutInput = z.infer<typeof NicheScoutInput>;

export const NicheScoutOutput = z.object({
  scout_run_id: z.string().uuid(),
  grid_cells: z.number(),
  persisted: z.number(),
  recommended_n: z.number(),
  value_floor_usd: z.number(),
  est_validation_cost_usd: z.number(),
  dfs_spend_usd: z.number(),
});
export type NicheScoutOutput = z.infer<typeof NicheScoutOutput>;

const CLUSTER_FETCH_CONCURRENCY = 4;
const INSERT_CHUNK_SIZE = 50;

export class NicheScout extends BaseAgent<typeof NicheScoutInput, typeof NicheScoutOutput> {
  constructor() {
    super({
      name: 'niche-scout',
      inputSchema: NicheScoutInput,
      outputSchema: NicheScoutOutput,
      defaultDailyCapUsd: 15,
      dedupeKeyFn: (input) =>
        `niche-scout:${[...input.states].sort().join(',')}:${input.category_filter ?? 'all'}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  protected async execute(input: NicheScoutInput, ctx: AgentContext): Promise<NicheScoutOutput> {
    const db = getDb();
    const sys = await getSystemState();
    const ctrAtRank = sys.scoutCtrAtRank != null ? parseFloat(sys.scoutCtrAtRank) : undefined;
    const callRate = sys.scoutCallRate != null ? parseFloat(sys.scoutCallRate) : undefined;
    // Ability-to-pay floor overrides — NULL = use code defaults from scoring-config.ts.
    const minLeadBenchmarkPrice =
      sys.scoutMinLeadPrice != null ? parseFloat(sys.scoutMinLeadPrice) : undefined;
    const minRentabilityPrior =
      sys.scoutMinRentabilityPrior != null ? parseFloat(sys.scoutMinRentabilityPrior) : undefined;
    // Structural geo blend strengths (ADR 0022) — NULL = code defaults (0.0 → inert).
    const compBlendStrength =
      sys.scoutGeoCompBlend != null ? parseFloat(sys.scoutGeoCompBlend) : undefined;
    const demandBlendStrength =
      sys.scoutGeoDemandBlend != null ? parseFloat(sys.scoutGeoDemandBlend) : undefined;
    // Per-state diversity cap (ADR 0022 §4) — NULL = no cap (current behavior).
    const perStateCap =
      sys.scoutPerStateCap != null ? sys.scoutPerStateCap : undefined;

    // 1. City pool — deterministic, no sampling.
    ctx.progress({ step: 1, total: 5, label: 'building trade x city grid' });
    const cities = listCities({
      populationMin: input.population_min,
      populationMax: input.population_max,
      states: input.states,
    });

    // Free structural geo signal (ADR 0022): one MarketSignal per city in the
    // pop band. Census-absent / unmatched cities fall back to a neutral signal —
    // never dropped, never penalized. Grid index is built over ALL cities inside
    // computeCityMarketScores so out-of-band metro mass still suppresses density.
    const marketScores = computeCityMarketScores({
      states: input.states,
      populationMin: input.population_min,
      populationMax: input.population_max,
    });
    const NEUTRAL_SIGNAL: MarketSignal = { metroDensityMult: 1.0, demandQuality: 1.0, hasCensus: false };

    // 2. Trade list — taxonomy filtered by category, minus denylist.
    const categories: ServiceCategory[] = input.category_filter
      ? [input.category_filter]
      : [...CATEGORY_VALUES];
    const allTrades: Array<{ trade: string; category: ServiceCategory }> = [];
    let excludedDenylist = 0;
    for (const category of categories) {
      for (const trade of SERVICE_TAXONOMY[category]) {
        if (isDenylisted(trade)) {
          excludedDenylist++;
          continue;
        }
        allTrades.push({ trade, category });
      }
    }

    // 3. Exclusions + novelty from existing `niches` rows.
    const existingRows = await db
      .select({ niche: niches.niche, city: niches.city, state: niches.state })
      .from(niches);
    const existingCombos = new Set(
      existingRows.map((r) => `${r.niche.toLowerCase()}|${r.city.toLowerCase()}|${r.state.toUpperCase()}`),
    );
    const surfacedTrades = new Set(existingRows.map((r) => r.niche.toLowerCase()));

    // 4. Cluster volumes per trade (90-day cache; warm misses when allowed).
    let dfsSpendUsd = 0;
    const onCost = (usd: number) => {
      if (usd <= 0) return;
      dfsSpendUsd += usd;
      ctx.recordUsage({ model: 'dataforseo', input_tokens: 0, output_tokens: 0, cost_usd: usd });
    };

    const clusterVolumes = new Map<string, number | null>();
    // Volume-weighted avg kd per trade (null = no usable kd, use DEFAULT_BENCHMARK_WINNABILITY).
    const clusterDifficulties = new Map<string, number | null>();
    let fetched = 0;
    const fetchOne = async (trade: string) => {
      try {
        if (input.warm_missing_clusters) {
          const candidates = await getKeywordCandidates({ seed: trade, onCost });
          clusterVolumes.set(trade, computeClusterVolume(candidates));
          clusterDifficulties.set(trade, computeClusterDifficulty(candidates));
        } else {
          const candidates = await peekKeywordCandidates({ seed: trade });
          clusterVolumes.set(trade, candidates ? computeClusterVolume(candidates) : null);
          clusterDifficulties.set(
            trade,
            candidates ? computeClusterDifficulty(candidates) : null,
          );
        }
      } catch (err) {
        ctx.log.warn(
          { trade, err: err instanceof Error ? err.message : err },
          'niche-scout: cluster lookup failed — scoring trade from benchmarks only',
        );
        clusterVolumes.set(trade, null);
        clusterDifficulties.set(trade, null);
      }
      fetched++;
      if (fetched % 25 === 0 || fetched === allTrades.length) {
        ctx.progress({ step: 2, total: 5, label: `clusters ${fetched}/${allTrades.length}` });
      }
    };

    ctx.progress({ step: 2, total: 5, label: `loading clusters for ${allTrades.length} trades` });
    const queue = allTrades.map((t) => t.trade);
    const workers = Array.from({ length: CLUSTER_FETCH_CONCURRENCY }, async () => {
      for (;;) {
        const trade = queue.shift();
        if (trade === undefined) return;
        await fetchOne(trade);
      }
    });
    await Promise.all(workers);

    const uncachedTrades = allTrades.filter((t) => clusterVolumes.get(t.trade) === null).length;

    // Median cached cluster volume as the benchmark_only fallback basis —
    // better calibrated than a fixed constant when most trades are warm.
    const cached = allTrades
      .map((t) => clusterVolumes.get(t.trade))
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    const fallbackClusterVolume = cached.length
      ? cached[Math.floor(cached.length / 2)]
      : undefined;

    // 5. Score the full grid in memory.
    ctx.progress({ step: 3, total: 5, label: `scoring ${allTrades.length} x ${cities.length} cells` });
    let excludedExisting = 0;
    let excludedFloor = 0;
    const cells: ScoredCell[] = [];
    for (const { trade, category } of allTrades) {
      // Hard ability-to-pay floor: drop trades that can't sustain rent before
      // scoring any cities. Counted once per trade (not per city).
      if (
        !passesAbilityToPayFloor(trade, { minLeadBenchmarkPrice, minRentabilityPrior })
      ) {
        excludedFloor++;
        continue;
      }
      const clusterVolume = clusterVolumes.get(trade) ?? null;
      const clusterDifficulty = clusterDifficulties.get(trade) ?? null;
      const isNovelTrade = !surfacedTrades.has(trade.toLowerCase());
      for (const city of cities) {
        if (existingCombos.has(`${trade.toLowerCase()}|${city.city.toLowerCase()}|${city.state.toUpperCase()}`)) {
          excludedExisting++;
          continue;
        }
        const signal =
          marketScores.get(`${city.city.toLowerCase()}|${city.state.toUpperCase()}`) ??
          NEUTRAL_SIGNAL;
        const v = estimateScoutValue({
          trade,
          cityPopulation: city.population,
          clusterVolume,
          fallbackClusterVolume,
          ctrAtRank,
          callRate,
          clusterDifficulty,
          metroDensityMult: signal.metroDensityMult,
          demandQuality: signal.demandQuality,
          compBlendStrength,
          demandBlendStrength,
        });
        cells.push({
          trade,
          category,
          city: city.city,
          state: city.state,
          county: city.county,
          population: city.population,
          clusterVolume,
          clusterDifficulty,
          estCityVolume: v.estCityVolume,
          leadBenchmarkPrice: v.leadBenchmarkPrice,
          rentabilityPrior: v.rentabilityPrior,
          winnability: v.winnability,
          estMonthlyValueUsd: v.estMonthlyValueUsd,
          scoutScore: v.scoutScore,
          dataConfidence: v.dataConfidence,
          isNovelTrade,
          metroDensityMult: v.metroDensityMult,
          demandQuality: v.demandQuality,
          localRankMult: v.localRankMult,
          demandMult: v.demandMult,
          hasCensus: signal.hasCensus,
          refinementSource: 'proxy',
        });
      }
    }

    // Rank: rentability-weighted score desc; cluster-backed candidates beat
    // benchmark_only ties (their demand is measured, not imputed).
    cells.sort((a, b) => {
      if (b.scoutScore !== a.scoutScore) return b.scoutScore - a.scoutScore;
      if (a.dataConfidence !== b.dataConfidence) {
        return a.dataConfidence === 'cluster' ? -1 : 1;
      }
      return b.estMonthlyValueUsd - a.estMonthlyValueUsd;
    });

    const report = buildScoutReport({
      cellsDesc: cells,
      grid: {
        trades: allTrades.length,
        cities: cities.length,
        cells: cells.length,
        excluded_existing: excludedExisting,
        excluded_denylist: excludedDenylist,
        excluded_floor: excludedFloor,
        uncached_trades: uncachedTrades,
      },
      generatedAt: new Date().toISOString(),
    });

    // 6. Persist: run row first (status 'building' so a mid-write crash never
    // leaves a half-populated 'current' run), then candidates, then flip to
    // 'current' + supersede prior runs for the same states. neon-http has no
    // transactions, so ordering is the integrity mechanism.
    ctx.progress({ step: 4, total: 5, label: `persisting top ${Math.min(input.persist_top, cells.length)} candidates` });
    // Per-state diversity cap (ADR 0022 §4): when set, admit cells greedily in
    // score order (cells are already sorted desc), skipping any whose state has
    // reached `perStateCap`, THEN slice to persist_top. NULL cap = unchanged.
    // The report above still reflects the whole grid, not the capped set.
    const admitted =
      perStateCap != null && perStateCap > 0
        ? (() => {
            const perState = new Map<string, number>();
            const kept: ScoredCell[] = [];
            for (const c of cells) {
              const seen = perState.get(c.state) ?? 0;
              if (seen >= perStateCap) continue;
              perState.set(c.state, seen + 1);
              kept.push(c);
            }
            return kept;
          })()
        : cells;
    const toPersist = admitted.slice(0, input.persist_top);
    const statesSorted = [...input.states].sort();

    const [runRow] = await db
      .insert(nicheScoutRuns)
      .values({
        agentRunId: ctx.runId,
        states: statesSorted,
        categoryFilter: input.category_filter ?? null,
        populationMin: input.population_min,
        populationMax: input.population_max,
        gridCells: cells.length,
        persistedCandidates: toPersist.length,
        report,
        status: 'building',
      })
      .returning({ id: nicheScoutRuns.id });
    const scoutRunId = runRow!.id;

    for (let i = 0; i < toPersist.length; i += INSERT_CHUNK_SIZE) {
      const chunk = toPersist.slice(i, i + INSERT_CHUNK_SIZE);
      await db.insert(nicheCandidates).values(
        chunk.map((c, j) => ({
          scoutRunId,
          trade: c.trade,
          category: c.category,
          city: c.city,
          state: c.state,
          population: c.population,
          clusterVolume: c.clusterVolume,
          estCityVolume: c.estCityVolume != null ? c.estCityVolume.toFixed(2) : null,
          leadBenchmarkPrice: c.leadBenchmarkPrice.toFixed(2),
          rentabilityPrior: c.rentabilityPrior.toFixed(3),
          winnability: c.winnability.toFixed(3),
          clusterDifficulty: c.clusterDifficulty != null ? c.clusterDifficulty.toFixed(2) : null,
          estMonthlyValueUsd: c.estMonthlyValueUsd.toFixed(2),
          rank: i + j + 1,
          isNovelTrade: c.isNovelTrade,
          dataConfidence: c.dataConfidence,
          metroDensityMult: c.metroDensityMult.toFixed(3),
          demandQuality: c.demandQuality.toFixed(3),
        })),
      );
    }

    // Supersede prior 'current' runs covering the same states, then activate.
    const priorRuns = await db
      .select({ id: nicheScoutRuns.id, states: nicheScoutRuns.states })
      .from(nicheScoutRuns)
      .where(and(eq(nicheScoutRuns.status, 'current')));
    const sameStates = priorRuns
      .filter((r) => JSON.stringify([...(r.states ?? [])].sort()) === JSON.stringify(statesSorted))
      .map((r) => r.id);
    if (sameStates.length > 0) {
      await db
        .update(nicheScoutRuns)
        .set({ status: 'superseded' })
        .where(inArray(nicheScoutRuns.id, sameStates));
    }
    await db.update(nicheScoutRuns).set({ status: 'current' }).where(eq(nicheScoutRuns.id, scoutRunId));

    ctx.progress({ step: 5, total: 5, label: 'done' });
    ctx.log.info(
      {
        scout_run_id: scoutRunId,
        grid_cells: cells.length,
        persisted: toPersist.length,
        recommended_n: report.recommendation.n,
        dfs_spend_usd: dfsSpendUsd,
        uncached_trades: uncachedTrades,
      },
      'niche-scout completed',
    );

    return {
      scout_run_id: scoutRunId,
      grid_cells: cells.length,
      persisted: toPersist.length,
      recommended_n: report.recommendation.n,
      value_floor_usd: report.recommendation.value_floor_usd,
      est_validation_cost_usd: report.recommendation.est_validation_cost_usd,
      dfs_spend_usd: Number(dfsSpendUsd.toFixed(4)),
    };
  }
}

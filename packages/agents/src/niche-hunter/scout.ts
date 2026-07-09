import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, niches, nicheScoutRuns, nicheCandidates, getSystemState, eq, and, inArray } from '@leadlandlord/db';
import {
  getKeywordCandidates,
  peekKeywordCandidates,
  getSerpComposition,
  getLocalKeywordMetrics,
  getStateKeywordMetrics,
  dfsLocationName,
} from '@leadlandlord/integrations/dataforseo';
import { listCities, computeCityMarketScores, type MarketSignal } from '@leadlandlord/us-cities/loader';
import { SERVICE_TAXONOMY, CATEGORY_VALUES, type ServiceCategory } from './service-taxonomy';
import { isDenylisted } from './denylist';
import {
  computeClusterVolume,
  computeClusterDifficulty,
  estimateScoutValue,
  passesAbilityToPayFloor,
  findValueCliff,
} from './value-model';
import {
  resolveDemandVolume,
  resolveRefinedCityVolume,
  DEFAULT_SCOUT_REFINE_BUDGET_USD,
  DEFAULT_SCOUT_REFINE_TOP_K,
  DEFAULT_SCOUT_BELOW_TOPK_SAMPLE_COUNT,
  BELOW_TOPK_TIER_MULTIPLIER,
  SCOUT_MAX_PER_TRADE,
  SCOUT_MAX_CATEGORY_SHARE,
  SCOUT_MAX_POP_BAND_SHARE,
  MIN_WINNABILITY_FLOOR,
  ENSURE_MEASURED_MAX_ITERATIONS,
  DEFAULT_STATE_DEMAND_CLAMP,
  STATE_DEMAND_SUB_BUDGET_USD,
  computeSeasonalitySignal,
  dampenSeasonalVolume,
} from './scoring-config';
import { buildScoutReport, populationBandOf, type ScoredCell } from './scout-report';
import { summarizeBias } from './accuracy-stats';
import { selectDiversified } from './selection';
import { seededRandom, sampleIndices } from './rng';

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
  /** Empty/omitted = all categories. */
  category_filter: z.array(CategoryEnum).min(1).optional(),
  population_min: z.number().int().nonnegative().default(15_000),
  population_max: z.number().int().positive().default(150_000),
  persist_top: z.number().int().positive().max(2000).default(500),
  /** false = strictly cache-only scout (zero DataForSEO spend). */
  warm_missing_clusters: z.boolean().default(true),
  /**
   * Stage-3 local-SERP refinement (ADR 0022 §5). Per-run overrides of the
   * system_state knobs; undefined → sys.* → code defaults. refine_top_k <= 0
   * disables refinement entirely (no DataForSEO spend).
   */
  refine_top_k: z.number().int().nonnegative().optional(),
  refine_budget_usd: z.number().nonnegative().optional(),
  refine_measure_volume: z.boolean().optional(),
  /**
   * Below-top-K sampling (Phase 5 follow-up to ADR 0024). Per-run override of
   * system_state.scout_below_topk_sample_count; undefined → sys.* → code
   * default (10). 0 disables the sampling pass entirely.
   */
  refine_below_topk_sample_count: z.number().int().nonnegative().optional(),
  /**
   * Max passes of the ensure-measured-above-the-cliff loop (ADR 0030 S1).
   * undefined → ENSURE_MEASURED_MAX_ITERATIONS (3). 0 disables the loop
   * (the recommendation_fully_measured flag still reports honestly).
   */
  ensure_measured_passes: z.number().int().nonnegative().optional(),
  /**
   * State-level demand fold blend α (ADR 0030 S2). Per-run override of
   * system_state.scout_state_demand_blend, matching refine_* precedence
   * (input wins over the sys knob); undefined → sys.* → 0 (pass skipped
   * entirely, zero DataForSEO spend).
   */
  state_demand_blend: z.number().min(0).max(1).optional(),
  /**
   * Test/ops escape hatch: overrides STATE_DEMAND_SUB_BUDGET_USD ($2.00) for
   * this run only. undefined → the code constant. Not exposed in the operator
   * UI — exists so tests (and emergency ops) can exercise/force the
   * over-sub-budget skip path deterministically.
   */
  state_demand_sub_budget_usd: z.number().nonnegative().optional(),
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
  /** Stage-3 cells refined to refinement_source='local_serp' (ADR 0022 §5). */
  refined_count: z.number(),
  /** Stage-3 DataForSEO spend actually incurred (cache hits cost $0). */
  refine_spend_usd: z.number(),
  /** Below-top-K cells randomly sampled + refined (Phase 5 follow-up to ADR 0024). */
  sampled_count: z.number(),
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
      // $20 (ADR 0030): the cap is a pre-run gate only, so a fully-cold run
      // (cluster warming ~$12.50 + $5 refine budget + $2 state-demand
      // sub-budget when that knob is on ≈ $19.50) must fit under it.
      defaultDailyCapUsd: 20,
      dedupeKeyFn: (input) =>
        `niche-scout:${[...input.states].sort().join(',')}:${input.category_filter ? [...input.category_filter].sort().join('+') : 'all'}:${new Date().toISOString().slice(0, 10)}`,
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
    // Structural geo blend strengths (ADR 0022) — NULL = code defaults (0.25).
    const compBlendStrength =
      sys.scoutGeoCompBlend != null ? parseFloat(sys.scoutGeoCompBlend) : undefined;
    const demandBlendStrength =
      sys.scoutGeoDemandBlend != null ? parseFloat(sys.scoutGeoDemandBlend) : undefined;
    // Per-state diversity cap (ADR 0022 §4) — NULL = no cap (current behavior).
    const perStateCap =
      sys.scoutPerStateCap != null ? sys.scoutPerStateCap : undefined;
    // Per-trade / per-category diversity caps (ADR 0023) — NULL = code defaults.
    const maxPerTrade =
      sys.scoutMaxPerTrade != null ? Number(sys.scoutMaxPerTrade) : SCOUT_MAX_PER_TRADE;
    const maxCategoryShare =
      sys.scoutMaxCategoryShare != null
        ? parseFloat(sys.scoutMaxCategoryShare)
        : SCOUT_MAX_CATEGORY_SHARE;
    // Per-population-band diversity cap (F4) — NULL = code default. >= 1.0
    // disables (a single band may fill the whole persisted set).
    const maxPopBandShare =
      sys.scoutMaxPopBandShare != null
        ? parseFloat(sys.scoutMaxPopBandShare)
        : SCOUT_MAX_POP_BAND_SHARE;
    // Winnability floor (ADR 0024) — NULL = code default (MIN_WINNABILITY_FLOOR).
    // Benchmark-only trades (clusterDifficulty null) are always exempt.
    const minWinnability =
      sys.scoutMinWinnability != null ? parseFloat(sys.scoutMinWinnability) : MIN_WINNABILITY_FLOOR;
    // Local-SERP difficulty formula knobs (ADR 0030 Phase 3) — NULL = code
    // defaults (AGGREGATOR_WEIGHT 70 / LOCAL_PACK_BOOST 30 in the dataforseo
    // integration). Applied at cache-read time inside getSerpComposition.
    const aggWeight = sys.scoutAggWeight != null ? parseFloat(sys.scoutAggWeight) : undefined;
    const localPackBoost =
      sys.scoutLocalPackBoost != null ? parseFloat(sys.scoutLocalPackBoost) : undefined;
    const difficultyWeights =
      aggWeight !== undefined || localPackBoost !== undefined
        ? { aggregatorWeight: aggWeight, localPackBoost }
        : undefined;
    // Benchmark-winnability default override (ADR 0030 Phase 3) — NULL =
    // DEFAULT_BENCHMARK_WINNABILITY (0.5) in scoring-config.ts.
    const scoutDefaultBenchmarkWinnability =
      sys.scoutDefaultBenchmarkWinnability != null
        ? parseFloat(sys.scoutDefaultBenchmarkWinnability)
        : undefined;
    // Proxy-bias correction weight (ADR 0030 Phase 4). NULL/0 = report-only:
    // the in-run proxy_bias summary is computed but never applied. w > 0
    // multiplies every unmeasured (proxy) cell's scoutScore by
    // `1 - w + w * clamp(median_ratio, 0.25, 1.5)` — ranking only, never
    // estMonthlyValueUsd.
    const proxyBiasWeight =
      sys.scoutProxyBiasWeight != null ? parseFloat(sys.scoutProxyBiasWeight) : 0;
    // Metro-density smoothing blend (ADR 0030 M2 / Phase 4). NULL = 0 (pure
    // step function — historical behavior); 1 = fully smooth log interpolation.
    const metroDensitySmooth =
      sys.scoutMetroDensitySmooth != null ? parseFloat(sys.scoutMetroDensitySmooth) : 0;
    // State-level demand fold (ADR 0030 S2 / Phase 5). Blend NULL/0 = the
    // whole pass is skipped (zero DataForSEO spend) — shipped default. Per-run
    // input wins over the sys knob, matching the refine_* precedence.
    const stateDemandBlend =
      input.state_demand_blend ??
      (sys.scoutStateDemandBlend != null ? parseFloat(sys.scoutStateDemandBlend) : 0);
    // Clamp on stateFit deviation — NULL = code default (4.0). Floored at 1 so
    // a degenerate knob value can never invert or zero the clamp interval.
    const stateDemandClamp = Math.max(
      1,
      sys.scoutStateDemandClamp != null
        ? parseFloat(sys.scoutStateDemandClamp)
        : DEFAULT_STATE_DEMAND_CLAMP,
    );

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
      smoothMetroDensity: metroDensitySmooth,
    });
    const NEUTRAL_SIGNAL: MarketSignal = { metroDensityMult: 1.0, demandQuality: 1.0, hasCensus: false };

    // 2. Trade list — taxonomy filtered by category, minus denylist.
    const categories: ServiceCategory[] =
      input.category_filter && input.category_filter.length > 0
        ? [...new Set(input.category_filter)]
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

    // 3. Exclusions + novelty from existing `niches` rows. Deliberately keyed
    // `niche|city|state` WITHOUT county — `niches` has no county column, so a
    // same-named sibling city in the same state is over-excluded. That is the
    // conservative direction: we skip a candidate rather than double-build
    // (ADR 0030 B3).
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

    // Post-floor trade survival, computed ONCE and consumed by BOTH the
    // state-demand pass and the grid scoring loop — the same predicate
    // results, so the two can never drift (ADR 0030 S2). The scoring loop
    // still owns the excludedFloor / excludedWinnability counters.
    const tradeExclusion = new Map<string, 'floor' | 'winnability'>();
    for (const { trade } of allTrades) {
      // Hard ability-to-pay floor (ADR 0021): trades that can't sustain rent.
      if (!passesAbilityToPayFloor(trade, { minLeadBenchmarkPrice, minRentabilityPrior })) {
        tradeExclusion.set(trade, 'floor');
        continue;
      }
      // Winnability floor (ADR 0024): MEASURED cluster difficulty implies a
      // SERP too hard to rank in profitably. Exempt when clusterDifficulty is
      // null (benchmark-only / no usable kd data).
      const cd = clusterDifficulties.get(trade) ?? null;
      if (cd !== null && (100 - cd) / 100 < minWinnability) {
        tradeExclusion.set(trade, 'winnability');
      }
    }
    // Sorted for deterministic fetch/iteration order (no rng anywhere here).
    const survivingTrades = allTrades
      .filter((t) => !tradeExclusion.has(t.trade))
      .map((t) => t.trade)
      .sort();

    // ── State-level demand fold (ADR 0030 S2 / Phase 5) ─────────────────────
    // Per (trade, state): stateFit = clamp(stateVolShare / statePopShare,
    // 1/clamp, clamp), stateDemandMult = 1 - α + α·stateFit. Only meaningful
    // on multi-state runs (shares are degenerate 1.0 on a single state) and
    // only when the blend is on; covers post-floor surviving trades only so
    // the fetch never spends on trades the scoring loop would drop anyway.
    const stateDemandMults = new Map<string, number>(); // `${trade}|${STATE}`
    let stateDemandSpendUsd = 0;
    let stateDemandSkippedReason: string | null = null;
    const stateDemandFits: Array<{ trade: string; state: string; state_fit: number; mult: number }> =
      [];
    const runStates = [...new Set(input.states)].sort();
    const stateDemandSubBudgetUsd =
      input.state_demand_sub_budget_usd ?? STATE_DEMAND_SUB_BUDGET_USD;
    if (stateDemandBlend <= 0) {
      stateDemandSkippedReason = 'blend_zero';
    } else if (runStates.length < 2) {
      stateDemandSkippedReason = 'single_state';
    } else if (survivingTrades.length * runStates.length * 0.0012 > stateDemandSubBudgetUsd) {
      // Sub-budget pre-check mirroring the refine guard: skip the WHOLE pass
      // when the worst-case cold cost would exceed the sub-budget — a
      // partially-folded grid would rank folded trades against unfolded ones.
      stateDemandSkippedReason = 'over_sub_budget';
      ctx.log.warn(
        {
          trades: survivingTrades.length,
          states: runStates.length,
          worst_case_usd: Number((survivingTrades.length * runStates.length * 0.0012).toFixed(4)),
          sub_budget_usd: stateDemandSubBudgetUsd,
        },
        'niche-scout: state-demand pass skipped — worst-case cold cost exceeds sub-budget',
      );
    } else {
      ctx.progress({
        step: 2,
        total: 5,
        label: `state demand: ${survivingTrades.length} trades x ${runStates.length} states`,
      });
      // Actual spend accumulator wired through onCost (cache hits are $0).
      const stateOnCost = (usd: number) => {
        if (usd > 0) stateDemandSpendUsd += usd;
        onCost(usd);
      };
      const stateVolumes = new Map<string, number>(); // `${trade}|${STATE}` → volume
      const pairQueue: Array<{ trade: string; state: string }> = [];
      for (const trade of survivingTrades) {
        for (const state of runStates) pairQueue.push({ trade, state });
      }
      // Same worker-queue pattern as the cluster fetch. Failures → volume 0
      // (never abort the run); the per-call guard aborts issuing NEW calls if
      // actual spend would exceed the sub-budget (graceful, like refineOneCell).
      const stateWorkers = Array.from({ length: CLUSTER_FETCH_CONCURRENCY }, async () => {
        for (;;) {
          if (stateDemandSpendUsd + 0.0012 > stateDemandSubBudgetUsd) return;
          const pair = pairQueue.shift();
          if (pair === undefined) return;
          try {
            const { volume } = await getStateKeywordMetrics({
              trade: pair.trade,
              state: pair.state,
              onCost: stateOnCost,
            });
            stateVolumes.set(`${pair.trade}|${pair.state}`, volume);
          } catch (err) {
            ctx.log.warn(
              { trade: pair.trade, state: pair.state, err: err instanceof Error ? err.message : err },
              'niche-scout: state metrics lookup failed — treating state volume as 0',
            );
            stateVolumes.set(`${pair.trade}|${pair.state}`, 0);
          }
        }
      });
      await Promise.all(stateWorkers);

      // State populations over ALL city sizes (unbounded band, not the run's
      // pop filter) — the fit compares whole-state demand to whole-state size.
      const statePops = new Map<string, number>();
      for (const state of runStates) {
        const pop = listCities({
          states: [state],
          populationMin: 0,
          populationMax: Number.MAX_SAFE_INTEGER,
        }).reduce((s, c) => s + c.population, 0);
        statePops.set(state, pop);
      }
      const totalPop = [...statePops.values()].reduce((s, v) => s + v, 0);

      for (const trade of survivingTrades) {
        const volTotal = runStates.reduce(
          (s, state) => s + (stateVolumes.get(`${trade}|${state}`) ?? 0),
          0,
        );
        for (const state of runStates) {
          // Σ vol 0 → no demand signal for the trade → neutral fit 1.0 for all
          // its states; statePopShare 0 (degenerate city data) → neutral too.
          let stateFit = 1.0;
          if (volTotal > 0) {
            const volShare = (stateVolumes.get(`${trade}|${state}`) ?? 0) / volTotal;
            const popShare = totalPop > 0 ? (statePops.get(state) ?? 0) / totalPop : 0;
            if (popShare > 0) {
              stateFit = Math.max(
                1 / stateDemandClamp,
                Math.min(stateDemandClamp, volShare / popShare),
              );
            }
          }
          const mult = 1 - stateDemandBlend + stateDemandBlend * stateFit;
          stateDemandMults.set(`${trade}|${state}`, mult);
          stateDemandFits.push({
            trade,
            state,
            state_fit: Number(stateFit.toFixed(4)),
            mult: Number(mult.toFixed(4)),
          });
        }
      }
    }

    // 5. Score the full grid in memory.
    ctx.progress({ step: 3, total: 5, label: `scoring ${allTrades.length} x ${cities.length} cells` });
    let excludedExisting = 0;
    let excludedFloor = 0;
    let excludedWinnability = 0;
    const cells: ScoredCell[] = [];
    for (const { trade, category } of allTrades) {
      // Floors consult the SAME precomputed predicate results the state-demand
      // pass used (no logic drift); counters stay owned by this loop.
      const exclusion = tradeExclusion.get(trade);
      if (exclusion === 'floor') {
        // Counted once per trade (not per city).
        excludedFloor++;
        continue;
      }
      if (exclusion === 'winnability') {
        excludedWinnability++;
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
          marketScores.get(
            `${city.city.toLowerCase()}|${city.county.toLowerCase()}|${city.state.toUpperCase()}`,
          ) ?? NEUTRAL_SIGNAL;
        const v = estimateScoutValue({
          trade,
          cityPopulation: city.population,
          clusterVolume,
          fallbackClusterVolume,
          ctrAtRank,
          callRate,
          clusterDifficulty,
          defaultWinnability: scoutDefaultBenchmarkWinnability,
          metroDensityMult: signal.metroDensityMult,
          demandQuality: signal.demandQuality,
          compBlendStrength,
          demandBlendStrength,
          // undefined when the state-demand pass was skipped / blend 0 → 1.0.
          stateDemandMult: stateDemandMults.get(`${trade}|${city.state.toUpperCase()}`),
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
    // benchmark_only ties (their demand is measured, not imputed). Final
    // tiebreak: prefer higher winnability so the more-rankable cell surfaces
    // when score and confidence are both identical (ADR 0024).
    const cellComparator = (a: ScoredCell, b: ScoredCell) => {
      if (b.scoutScore !== a.scoutScore) return b.scoutScore - a.scoutScore;
      if (a.dataConfidence !== b.dataConfidence) {
        return a.dataConfidence === 'cluster' ? -1 : 1;
      }
      if (b.estMonthlyValueUsd !== a.estMonthlyValueUsd) return b.estMonthlyValueUsd - a.estMonthlyValueUsd;
      return b.winnability - a.winnability;
    };
    cells.sort(cellComparator);

    // Persist-time dedupe (ADR 0030 B3): two same-named cities in one state are
    // distinct grid cells (different county/population/signal) but collide on
    // niche_candidates' (scoutRunId, trade, city, state) unique index. Keep the
    // highest-ranked cell per (trade, city, state) — cells is sorted desc, so a
    // single forward pass is deterministic. Runs BEFORE Stage-3 so refinement
    // spend is never wasted on a cell that could not persist anyway.
    let duplicateCityStateDropped = 0;
    {
      const seenPersistKeys = new Set<string>();
      const deduped: ScoredCell[] = [];
      for (const c of cells) {
        const key = `${c.trade}|${c.city.toLowerCase()}|${c.state.toUpperCase()}`;
        if (seenPersistKeys.has(key)) {
          duplicateCityStateDropped++;
          continue;
        }
        seenPersistKeys.add(key);
        deduped.push(c);
      }
      if (duplicateCityStateDropped > 0) {
        cells.length = 0;
        cells.push(...deduped);
      }
    }

    // Diversity caps (ADR 0023): bound how much of the persisted set any single
    // trade or category may occupy, so a high-ticket mono-category (e.g. legal)
    // can't sweep the whole list. The per-category cap is disabled only when
    // scoped to exactly one category — capping there would starve the request.
    // A multi-category filter (e.g. everything but legal/medical) still needs
    // the cap so one of the remaining categories can't sweep the list.
    const capPerTrade = Math.max(1, Math.floor(maxPerTrade));
    const capPerCategory =
      input.category_filter && input.category_filter.length === 1
        ? input.persist_top
        : Math.max(1, Math.ceil(input.persist_top * maxCategoryShare));
    // Per-population-band cap (F4): resolve share → absolute count. >= 1.0
    // disables (band may fill the whole set). Composes with trade/category caps
    // inside the greedy walk so a capped 100k+ slot is backfilled by the next
    // score-desc smaller-city cell rather than shrinking the persisted set.
    const capPerBand =
      maxPopBandShare >= 1
        ? undefined
        : Math.max(1, Math.ceil(input.persist_top * maxPopBandShare));

    // Full persisted-ranking pipeline over the CURRENT cell scores: diversity
    // caps (ADR 0023) then the per-state cap (ADR 0022 §4), greedily in score
    // order so all diversity dimensions compose. Called once per ensure-
    // measured pass (the ranking shifts as cells refine) and once for the
    // final persist, so the recommendation the loop protects is computed by
    // exactly the same math the report/persist path uses.
    const selectRanked = (): { selected: ScoredCell[]; excludedByCap: number } => {
      const { selected: diversified, excludedByCap } = selectDiversified(cells, input.persist_top, {
        maxPerTrade: capPerTrade,
        maxPerCategory: capPerCategory,
        maxPerBand: capPerBand,
        bandOf: capPerBand != null ? (c) => populationBandOf(c.population) : undefined,
      });
      if (perStateCap == null || perStateCap <= 0) return { selected: diversified, excludedByCap };
      const perState = new Map<string, number>();
      const kept: ScoredCell[] = [];
      for (const c of diversified) {
        const seen = perState.get(c.state) ?? 0;
        if (seen >= perStateCap) continue;
        perState.set(c.state, seen + 1);
        kept.push(c);
      }
      return { selected: kept, excludedByCap };
    };

    // ── Stage-3 bounded local-SERP refinement (ADR 0022 §5) ────────────────
    // Replace the proxy (cluster-difficulty) winnability of the top-K cells
    // with a measured local-SERP signal, optionally measuring local volume too.
    // Budget-bound and graceful: a cold call projecting over the remaining
    // budget is skipped (cell stays 'proxy'); a $0 cache hit is always served.
    const refineTopK =
      input.refine_top_k ?? sys.scoutRefineTopK ?? DEFAULT_SCOUT_REFINE_TOP_K;
    const refineBudgetUsd =
      input.refine_budget_usd ??
      (sys.scoutRefineBudgetUsd != null ? parseFloat(sys.scoutRefineBudgetUsd) : undefined) ??
      DEFAULT_SCOUT_REFINE_BUDGET_USD;
    const refineMeasureVolume =
      input.refine_measure_volume ?? sys.scoutRefineMeasureVolume ?? false;

    let refinedCount = 0;
    let sampledCount = 0;
    let refineSpendUsd = 0;
    let refineBudgetExhausted = false;
    let refineFailedCount = 0;
    let refineFallbackCount = 0;
    let ensureMeasuredExtraCount = 0;
    let recommendationFullyMeasured = true;

    if (refineTopK > 0) {
      // Worst-case cold cost of one cell's calls — used only for the pre-check.
      const COLD_SERP_COST = 0.075;
      const COLD_METRICS_COST = 0.0012;
      const worstCaseCellCost = COLD_SERP_COST + (refineMeasureVolume ? COLD_METRICS_COST : 0);

      // Refines one cell in place via measured local-SERP signal (+ optionally
      // measured local volume), rescoring through the SAME estimateScoutValue
      // math (geo blends, dollar formula) via overrides — no formula
      // duplication. Shared by both the top-K loop and the below-top-K
      // sampling pass below.
      //
      // Outcomes: 'refined' = cell measured + rescored; 'fallback' = DFS
      // returned a degraded composition (cell untouched, stays proxy);
      // 'failed' = the call threw (cell untouched, loop continues);
      // 'budget' = the pre-check tripped (caller stops issuing new calls).
      type RefineOutcome = 'refined' | 'fallback' | 'failed' | 'budget';
      const refineOneCell = async (cell: ScoredCell): Promise<RefineOutcome> => {
        // Pre-check (graceful abort): would a worst-case cold call push ACTUAL
        // spend over budget? Compared against the budget net of what we have
        // actually spent so far — and actual spend only ever moved on cold calls,
        // because cache hits report 0 via onCost and never decrement the budget.
        // That cache-hit-is-free accounting means warm cells encountered earlier
        // let MORE cells refine before this guard ever trips.
        if (refineSpendUsd + worstCaseCellCost > refineBudgetUsd) {
          refineBudgetExhausted = true;
          return 'budget';
        }

        // Local onCost: sum this call's incurred cost into a per-call accumulator
        // AND forward to the run-level onCost (records usage + run spend). Cache
        // hits report 0 here, so they never decrement the budget.
        let cellSpend = 0;
        const refineOnCost = (usd: number) => {
          if (usd > 0) cellSpend += usd;
          onCost(usd);
        };

        try {
          const location = dfsLocationName(cell.city, cell.state);
          const serp = await getSerpComposition({
            keyword: `${cell.trade} ${cell.city.toLowerCase()}`,
            location,
            onCost: refineOnCost,
            difficultyWeights,
          });

          // A fallback composition is a failed lookup returned as a value, not
          // a measurement — writing it onto the cell would fabricate a
          // difficulty-50 "local_serp" refinement. Leave the cell as proxy.
          if (serp.fallback) {
            ctx.log.warn(
              { trade: cell.trade, city: cell.city, state: cell.state },
              'niche-scout: local-SERP lookup returned fallback — leaving cell as proxy',
            );
            return 'fallback';
          }

          let measuredCityVolume: number | undefined;
          if (refineMeasureVolume) {
            const metrics = await getLocalKeywordMetrics({
              keywords: [cell.trade, `${cell.trade} near me`],
              location,
              onCost: refineOnCost,
            });
            const rawVolume = metrics.reduce((s, m) => s + m.search_volume, 0);
            // Seasonality dampening (ADR 0030 M1): same shared helper the
            // validate path applies — a highly seasonal trade measured in its
            // peak month must not carry peak volume into the dollar model.
            const seasonalitySignal = computeSeasonalitySignal(
              metrics.flatMap((m) => m.monthly_searches ?? []).map((x) => x.search_volume),
            );
            measuredCityVolume = dampenSeasonalVolume(rawVolume, seasonalitySignal);
          }

          // Recompute winnability from measured local-SERP difficulty, then
          // rescore the cell through the SAME estimateScoutValue math (geo
          // blends, dollar formula) via overrides — no formula duplication.
          const measuredWinnability = Math.max(0, Math.min(1, (100 - serp.difficulty) / 100));

          let cityVolumeOverride: number | undefined;
          if (measuredCityVolume !== undefined && cell.estCityVolume != null) {
            // F3: measured clears the floor → trust it; sub-floor → clamp the
            // inflated proxy to the floor rather than keeping it.
            cityVolumeOverride = resolveRefinedCityVolume(measuredCityVolume, cell.estCityVolume);
          } else if (measuredCityVolume !== undefined) {
            // No proxy estCityVolume to backstop with (benchmark_only): trust the
            // measured figure only when it clears the floor, else leave unset so
            // the population-derived estimate is recomputed.
            const resolved = resolveDemandVolume(measuredCityVolume, 0);
            if (resolved.source === 'dataforseo') cityVolumeOverride = resolved.volume;
          }

          const signal =
            marketScores.get(
              `${cell.city.toLowerCase()}|${cell.county.toLowerCase()}|${cell.state.toUpperCase()}`,
            ) ?? NEUTRAL_SIGNAL;
          const v = estimateScoutValue({
            trade: cell.trade,
            cityPopulation: cell.population,
            clusterVolume: cell.clusterVolume,
            fallbackClusterVolume,
            ctrAtRank,
            callRate,
            clusterDifficulty: cell.clusterDifficulty,
            defaultWinnability: scoutDefaultBenchmarkWinnability,
            metroDensityMult: signal.metroDensityMult,
            demandQuality: signal.demandQuality,
            compBlendStrength,
            demandBlendStrength,
            winnabilityOverride: measuredWinnability,
            cityVolumeOverride,
            // Measured local-pack presence feeds the CTR local-pack multiplier
            // (ADR 0030 Phase 3). ctrLocalPackMult stays unset (1.0 no-op)
            // until calibrated — code param only, no knob.
            hasLocalPack: serp.has_local_pack,
            // Same state-demand fold the proxy scoring applied (ADR 0030 S2) —
            // a refined cell must not silently lose its state fit on rescore.
            stateDemandMult: stateDemandMults.get(
              `${cell.trade}|${cell.state.toUpperCase()}`,
            ),
          });

          // Snapshot the proxy values once, before the first successful
          // refinement overwrites them (ADR 0030 S1). ??= keeps the ORIGINAL
          // proxy if a cell is ever refined twice.
          cell.proxyScoutScore ??= cell.scoutScore;
          cell.proxyEstMonthlyValueUsd ??= cell.estMonthlyValueUsd;
          cell.proxyWinnability ??= cell.winnability;

          cell.winnability = v.winnability;
          cell.estCityVolume = v.estCityVolume;
          cell.estMonthlyValueUsd = v.estMonthlyValueUsd;
          cell.scoutScore = v.scoutScore;
          cell.localRankMult = v.localRankMult;
          cell.demandMult = v.demandMult;
          cell.refinementSource = 'local_serp';
          cell.localSerpDifficulty = serp.difficulty;
          cell.localAggregatorShare = serp.aggregator_share;
          cell.hasLocalPack = serp.has_local_pack;
          if (measuredCityVolume !== undefined) cell.localMeasuredVolume = measuredCityVolume;
          return 'refined';
        } catch (err) {
          ctx.log.warn(
            {
              trade: cell.trade,
              city: cell.city,
              state: cell.state,
              err: err instanceof Error ? err.message : err,
            },
            'niche-scout: local-SERP refinement failed — leaving cell as proxy',
          );
          // Leave the cell as proxy; do not abort the whole run.
          return 'failed';
        } finally {
          refineSpendUsd += cellSpend;
        }
      };

      // Dedupe defensively by `${city}|${county}|${state}|${trade}` — the grid
      // never produces dups, but a future caller might. County-aware so two
      // same-named cities in one state stay distinct cells (ADR 0030 B3).
      const dedupeKey = (c: ScoredCell) => `${c.city}|${c.county}|${c.state}|${c.trade}`;
      const seen = new Set<string>();
      const targets: ScoredCell[] = [];
      for (const c of cells.slice(0, refineTopK)) {
        const key = dedupeKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(c);
      }

      ctx.progress({ step: 3, total: 5, label: `refining top ${refineTopK} cells (local SERP)` });
      for (const cell of targets) {
        const outcome = await refineOneCell(cell);
        if (outcome === 'budget') break; // budget pre-check tripped — stop issuing new calls entirely
        if (outcome === 'refined') refinedCount++;
        else if (outcome === 'fallback') refineFallbackCount++;
        else refineFailedCount++;
      }

      // Below-top-K sampling (Phase 5 follow-up to ADR 0024): a low-competition
      // cell buried just outside the top-K cut never gets measured otherwise.
      // Only runs when refine budget remains — reuses the exact same
      // worstCaseCellCost pre-check via refineOneCell, so the budget guard
      // still holds. Sampled uniformly at random (seeded on ctx.runId for
      // reproducibility) from the next tier down: [refineTopK, refineTopK *
      // BELOW_TOPK_TIER_MULTIPLIER), NOT the whole remaining tail.
      const belowTopKSampleCount =
        input.refine_below_topk_sample_count ??
        (sys.scoutBelowTopkSampleCount != null ? Number(sys.scoutBelowTopkSampleCount) : undefined) ??
        DEFAULT_SCOUT_BELOW_TOPK_SAMPLE_COUNT;

      if (belowTopKSampleCount > 0 && !refineBudgetExhausted) {
        const tierStart = refineTopK;
        const tierEnd = Math.min(cells.length, refineTopK * BELOW_TOPK_TIER_MULTIPLIER);
        if (tierEnd > tierStart) {
          const tierSeen = new Set<string>(seen);
          const tierCandidates: ScoredCell[] = [];
          for (const c of cells.slice(tierStart, tierEnd)) {
            const key = dedupeKey(c);
            if (tierSeen.has(key)) continue;
            tierSeen.add(key);
            tierCandidates.push(c);
          }

          const rng = seededRandom(`niche-scout-below-topk:${ctx.runId}`);
          const sampleTargetIdx = sampleIndices(tierCandidates.length, belowTopKSampleCount, rng);
          const sampleTargets = sampleTargetIdx.map((i) => tierCandidates[i]!);

          if (sampleTargets.length > 0) {
            ctx.progress({
              step: 3,
              total: 5,
              label: `sampling ${sampleTargets.length} below-top-${refineTopK} cells (local SERP)`,
            });
            for (const cell of sampleTargets) {
              const outcome = await refineOneCell(cell);
              if (outcome === 'budget') break;
              if (outcome === 'refined') sampledCount++;
              else if (outcome === 'fallback') refineFallbackCount++;
              else refineFailedCount++;
            }
          }
        }
      }

      // Re-sort: refined cells now carry updated scores. Build report + cap +
      // slice all proceed over the freshly re-ranked full array.
      cells.sort(cellComparator);

      // ── Ensure-measured-above-the-cliff (ADR 0030 S1) ─────────────────────
      // Refinement typically demotes measured cells, so never-measured proxy
      // cells drift INTO the value-cliff recommendation after each re-sort —
      // the operator would be told to validate cells whose competition was
      // never measured. Walk: compute the recommendation over the CURRENT
      // final ranking (selectRanked — identical math to the report/persist
      // path), refine any proxy cell inside it, re-sort, repeat. Deterministic
      // (no sampling); bounded by ENSURE_MEASURED_MAX_ITERATIONS and the same
      // refine budget guard. A budget trip only flags the report — it never
      // shrinks recommendation.n, which must not depend on cache warmth.
      const ensureMeasuredPasses =
        input.ensure_measured_passes ?? ENSURE_MEASURED_MAX_ITERATIONS;
      // Cells whose refinement already failed or fell back this run: still
      // 'proxy', but retrying them within the same run re-issues paid,
      // uncached DFS calls for cells that just proved unmeasurable. Skip them
      // (they surface via refine_failed_count / refine_fallback_count and the
      // recommendation_fully_measured flag instead).
      const attemptedUnmeasurable = new Set<string>();
      for (let pass = 0; pass < ensureMeasuredPasses && !refineBudgetExhausted; pass++) {
        const ranked = selectRanked().selected;
        const valuesDesc = ranked.map((c) => c.estMonthlyValueUsd).sort((a, b) => b - a);
        const cliff = findValueCliff(valuesDesc);
        const unmeasured = ranked
          .slice(0, cliff.n)
          .filter(
            (c) => c.refinementSource === 'proxy' && !attemptedUnmeasurable.has(dedupeKey(c)),
          );
        if (unmeasured.length === 0) break;
        ctx.progress({
          step: 3,
          total: 5,
          label: `measuring ${unmeasured.length} proxy cells inside the recommendation (pass ${pass + 1})`,
        });
        for (const cell of unmeasured) {
          const outcome = await refineOneCell(cell);
          if (outcome === 'budget') break;
          if (outcome === 'refined') ensureMeasuredExtraCount++;
          else if (outcome === 'fallback') {
            refineFallbackCount++;
            attemptedUnmeasurable.add(dedupeKey(cell));
          } else {
            refineFailedCount++;
            attemptedUnmeasurable.add(dedupeKey(cell));
          }
        }
        cells.sort(cellComparator);
      }

    }

    // In-run proxy-bias summary (ADR 0030 S1): how far refinement moved scores,
    // over cells whose proxy score was snapshotted by a successful refinement.
    // Computed BEFORE the final ranking so scout_proxy_bias_weight (Phase 4)
    // can apply it below; report-only when that knob is NULL/0.
    const proxyBiasRatios = cells
      .filter(
        (c) =>
          c.refinementSource === 'local_serp' &&
          c.proxyScoutScore !== undefined &&
          c.proxyScoutScore > 0,
      )
      .map((c) => c.scoutScore / c.proxyScoutScore!);
    // summarizeBias is the SAME statistic scripts/scout-accuracy-report.ts
    // computes offline — one median definition, so the calibration report can
    // reproduce the exact multiplier a run applied.
    const proxyBiasSummary = summarizeBias(proxyBiasRatios);
    const proxyBias = proxyBiasSummary
      ? {
          n: proxyBiasSummary.n,
          median_ratio: Number(proxyBiasSummary.median.toFixed(4)),
          mean_ratio: Number(proxyBiasSummary.mean.toFixed(4)),
        }
      : null;

    // Proxy-bias apply (ADR 0030 Phase 4): refinement systematically moves
    // scores (usually down — proxies flatter competition), so never-measured
    // proxy cells hold an unearned edge over measured ones in the final
    // ranking. When the knob is on, shrink (or grow) every proxy cell's
    // scoutScore by the blended in-run median ratio. Deterministic (derived
    // from run data only, no rng); ranking-only — estMonthlyValueUsd and the
    // dollar report stay untouched.
    let biasFactor: number | null = null;
    if (proxyBiasWeight > 0 && proxyBias !== null) {
      biasFactor =
        1 -
        proxyBiasWeight +
        proxyBiasWeight * Math.max(0.25, Math.min(1.5, proxyBias.median_ratio));
      for (const cell of cells) {
        if (cell.refinementSource === 'proxy') {
          // round2 matches the value-model's persisted score precision.
          cell.scoutScore = Number((cell.scoutScore * biasFactor).toFixed(2));
        }
      }
      cells.sort(cellComparator);
    }

    // Final persisted ranking — same selectRanked math the ensure-measured
    // loop protected above, over the bias-corrected scores. Computed ONCE and
    // shared with the honest assessment below so the flag always describes
    // exactly the ranking that persists.
    const { selected: rankedCells, excludedByCap } = selectRanked();

    // Honest final assessment over the final ranking, regardless of whether
    // refinement ran at all: does the value-cliff recommendation contain
    // never-measured cells? (refine_top_k=0 → everything proxy → false.)
    {
      const valuesDesc = rankedCells.map((c) => c.estMonthlyValueUsd).sort((a, b) => b - a);
      const cliff = findValueCliff(valuesDesc);
      recommendationFullyMeasured = rankedCells
        .slice(0, cliff.n)
        .every((c) => c.refinementSource !== 'proxy');
    }

    const report = buildScoutReport({
      refinement: {
        refined_count: refinedCount,
        refine_spend_usd: Number(refineSpendUsd.toFixed(4)),
        refine_budget_exhausted: refineBudgetExhausted,
        sampled_count: sampledCount,
        refine_failed_count: refineFailedCount,
        refine_fallback_count: refineFallbackCount,
        ensure_measured_extra_count: ensureMeasuredExtraCount,
        recommendation_fully_measured: recommendationFullyMeasured,
        proxy_bias: proxyBias,
        proxy_bias_weight_applied: biasFactor !== null ? Number(biasFactor.toFixed(4)) : null,
      },
      state_demand: {
        active: stateDemandSkippedReason === null,
        skipped_reason: stateDemandSkippedReason,
        spend_usd: Number(stateDemandSpendUsd.toFixed(4)),
        // Capped to the top 100 by |fit − 1| desc to bound jsonb size — the
        // most-deviant (most informative) fits survive; near-neutral ones drop.
        fits: [...stateDemandFits]
          .sort((a, b) => Math.abs(b.state_fit - 1) - Math.abs(a.state_fit - 1))
          .slice(0, 100),
      },
      cellsDesc: rankedCells,
      grid: {
        trades: allTrades.length,
        cities: cities.length,
        cells: cells.length,
        excluded_existing: excludedExisting,
        excluded_denylist: excludedDenylist,
        excluded_floor: excludedFloor,
        excluded_winnability: excludedWinnability,
        excluded_diversity_cap: excludedByCap,
        duplicate_city_state_dropped: duplicateCityStateDropped,
        diversity_cap_per_trade: capPerTrade,
        diversity_cap_per_category: capPerCategory,
        uncached_trades: uncachedTrades,
      },
      generatedAt: new Date().toISOString(),
    });

    // 6. Persist: run row first (status 'building' so a mid-write crash never
    // leaves a half-populated 'current' run), then candidates, then flip to
    // 'current' + supersede prior runs for the same states. neon-http has no
    // transactions, so ordering is the integrity mechanism.
    ctx.progress({ step: 4, total: 5, label: `persisting top ${rankedCells.length} candidates` });
    const toPersist = rankedCells;
    const statesSorted = [...input.states].sort();

    const [runRow] = await db
      .insert(nicheScoutRuns)
      .values({
        agentRunId: ctx.runId,
        states: statesSorted,
        // Column is a single text field; multiple categories are comma-joined
        // (parsed back out by the operator UI). Null = all categories.
        categoryFilter: input.category_filter ? input.category_filter.join(',') : null,
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
          // Stage-3 measured local-SERP columns (ADR 0022 §5). Null on proxy cells.
          localSerpDifficulty:
            c.localSerpDifficulty != null ? c.localSerpDifficulty.toFixed(2) : null,
          localAggregatorShare:
            c.localAggregatorShare != null ? c.localAggregatorShare.toFixed(3) : null,
          hasLocalPack: c.hasLocalPack ?? null,
          localMeasuredVolume: c.localMeasuredVolume ?? null,
          refinementSource: c.refinementSource,
          // Pre-refinement proxy snapshots (ADR 0030 S1); null on proxy cells.
          proxyEstMonthlyValueUsd:
            c.proxyEstMonthlyValueUsd != null ? c.proxyEstMonthlyValueUsd.toFixed(2) : null,
          proxyWinnability: c.proxyWinnability != null ? c.proxyWinnability.toFixed(3) : null,
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
        refined_count: refinedCount,
        sampled_count: sampledCount,
        refine_failed_count: refineFailedCount,
        refine_fallback_count: refineFallbackCount,
        refine_spend_usd: Number(refineSpendUsd.toFixed(4)),
        refine_budget_exhausted: refineBudgetExhausted,
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
      refined_count: refinedCount,
      refine_spend_usd: Number(refineSpendUsd.toFixed(4)),
      sampled_count: sampledCount,
    };
  }
}

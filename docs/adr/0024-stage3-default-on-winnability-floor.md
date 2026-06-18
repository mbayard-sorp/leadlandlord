# ADR 0024: Stage 3 default-on and hard winnability floor

Date: 2026-06-17
Status: accepted
Supersedes ADR 0022 §5 (Stage 3 default top_k=0)
Refines ADR 0021 (rentability scoring) and ADR 0022 (geographic targeting)

## Context

The scout's purpose is to surface LOW-competition cities where a rank-and-rent site
has a realistic path to top-3. National cluster difficulty from Stage 1/2 is identical
for a given trade across every city; it cannot differentiate two cities for the same
trade. Stage 3 local-SERP refinement is the only mechanism that injects a measured
per-city competition signal before the operator validates. ADR 0022 §5 shipped Stage 3
disabled (DEFAULT_SCOUT_REFINE_TOP_K=0) as cost-caution. That rationale has weakened:
the 14-day SERP cache TTL means re-runs on recently scouted states cost $0, and a
fully cold run at top_k=25 costs 25 x $0.075 = $1.875, which sits inside the existing
$3.00 in-run budget guard (DEFAULT_SCOUT_REFINE_BUDGET_USD).

Competition enters the current ranking as a single linear multiplier inside
estimateScoutValue. A trade at cluster difficulty 80 (winnability 0.20) scores lower,
but can still outrank a trade at kd=30 when the ticket price gap is large enough. A
personal injury attorney at kd=80 can outscore a plumber at kd=30 purely on dollar
value. The operator cannot win that SERP; validating it wastes budget and produces an
unmatchable niche. Rentability is also double-counted via leadBenchmarkPrice and
rentabilityPrior, compounding the advantage for high-ticket hard-to-rank trades. A
hard floor on measured winnability makes competition able to REJECT a candidate, not
merely discount it.

A known bug in computeCityMarketScores (city-ranker.ts line ~328) passes the states
filter to the ALL-cities listCitiesEnriched call for the spatial-index build, so
cities in adjacent states are excluded from the metro-density grid. A scout of Texas
misses the dampening effect of large cities in neighboring states on border-adjacent
Texas candidates. The Stage 3 change makes per-city signals more valuable; this bug
must be fixed in the same effort.

## Decision

### 1. Stage 3 enabled by default

```ts
export const DEFAULT_SCOUT_REFINE_TOP_K = 25;
```

The top-25 cells after Stage-1/2 ranking receive a measured local-SERP difficulty
before the diversity-cap and per-state-cap passes (ADR 0022 §5 ordering unchanged).
Ranking proceeds over the full refreshed array.

Budget semantics from ADR 0022 §5 are unchanged: warm cells cost $0; only incurred
spend counts against the $3.00 in-run budget guard; a cold call projecting over the
remaining budget is skipped gracefully. At top_k=25, cold worst-case spend is $1.875,
which is $1.125 below the guard. To disable Stage 3: pass refine_top_k=0 per-run,
or set system_state.scout_refine_top_k=0 globally.

DEFAULT_GEO_COMP_BLEND stays 0.0. ADR 0022's no-calibration rationale for the
population-proximity competition proxy is unchanged. Stage 3 directly measures local
competition for the top-K cells, subsuming what the blend approximates for those
candidates. Enabling both on the same cells would double-charge the competition signal.

### 2. Hard winnability floor

```ts
export const MIN_WINNABILITY_FLOOR = 0.25;   // rejects trades where cluster difficulty > 75
```

A trade with a measured clusterDifficulty (clusterDifficulty !== null) is dropped
before scoring any cities when `(100 - clusterDifficulty) / 100 < MIN_WINNABILITY_FLOOR`.
The gate sits in the trade loop, after passesAbilityToPayFloor, before the city inner
loop. Rejections are counted in a new excluded_winnability_floor field in the scout
report grid, separate from excluded_floor (the ability-to-pay gate from ADR 0021).

Trades where clusterDifficulty is null (no usable kd in the DataForSEO cluster) are
exempt: their difficulty is unknown, not proven unwinnable.
DEFAULT_BENCHMARK_WINNABILITY=0.5 already applies a conservative proxy for them.

Threshold: cluster difficulty > 75 targets national-brand-dominated verticals where
an independent rank-and-rent site has no realistic path to organic top-3. Typical
home-services and legal SERPs run kd 20-60 and clear this floor easily. The threshold
is operator-tunable via system_state.scout_min_winnability (NULL = code default),
resolving identically to the ADR 0021 ability-to-pay floor knobs.

No migration required: scout_refine_top_k (migration 0045) and scout_min_winnability
(migration 0048) are already in the schema and applied to prod.

### What does not change

The value model (estimateScoutValue), the ability-to-pay floor, the diversity caps,
the agent runtime, and the agent_events bus are all unchanged. The validate path is
unchanged; it already uses measured local-SERP difficulty. Existing pending/approved
niches rows are unaffected.

## Alternatives considered

- **top_k=50**: 50 cold calls x $0.075 = $3.75, which exceeds the $3.00 in-run guard.
  Every fully cold run would trigger a graceful-abort partway through, defeating the
  intent of enabling Stage 3 by default.
- **Non-zero DEFAULT_GEO_COMP_BLEND alongside non-zero DEFAULT_SCOUT_REFINE_TOP_K**:
  the blend amplifies a population-proximity proxy; Stage 3 directly measures the
  local SERP for the top-K cells. Enabling both on the same cells double-charges the
  competition signal with no calibration basis for the blend weight.
- **Winnability floor on benchmark-only (null kd) trades**: applying the floor to
  unmeasured trades would silently exclude legitimate new trades not yet warm in the
  DataForSEO cluster cache. The floor guards against proven-hard SERPs, not estimated
  ones.
- **Merge excluded_winnability_floor into excluded_floor**: excluded_floor is the
  ability-to-pay gate (ADR 0021). Conflating them hides which signal is working.

## Consequences

- Stage 3 runs on every scout run where sys.scoutRefineTopK is NULL and no per-run
  override is given. Re-runs within the 14-day SERP cache TTL cost $0. First runs on
  new state sets incur up to $1.875 cold spend, inside the $3.00 guard.
- Candidates ranked 1-25 carry refinementSource='local_serp' with a measured local-SERP
  difficulty; candidates ranked 26+ remain 'proxy'. Both columns are visible in the
  /operator/niches candidate table.
- Trades with cluster difficulty > 75 no longer appear in scout output. High-ticket
  trades that previously survived on price advantage may disappear. The operator can
  loosen the floor via system_state.scout_min_winnability without a deploy.
- The cross-state metro-density grid bug in computeCityMarketScores (city-ranker.ts
  line ~328) must be fixed in the same effort: remove the states argument from the
  listCitiesEnriched call that builds gridBuckets so the spatial index covers all US
  cities, enabling cross-state metro mass to suppress border-city metroDensityMult.
- Three scout.test.ts tests break from the DEFAULT_SCOUT_REFINE_TOP_K change: the
  'cache-only mode' dfs_spend_usd assertion (line ~253), the 'cold-miss DFS spend'
  assertion (line ~266), and the 'refine_top_k unset' Stage-3 test (line ~381). Fix:
  add refine_top_k=0 to the first two; rewrite the third to assert Stage 3 runs by
  default and refined_count > 0.
- value-model.test.ts must add MIN_WINNABILITY_FLOOR to its scoring-config imports
  and assert `expect(MIN_WINNABILITY_FLOOR).toBe(0.25)` in the 'floor constants' test.

## Decisions for implementers

**packages/agents/src/niche-hunter/scoring-config.ts:** DEFAULT_SCOUT_REFINE_TOP_K = 25
(was 0); add MIN_WINNABILITY_FLOOR = 0.25.

**packages/agents/src/niche-hunter/scout.ts:**
- Read sys.scoutMinWinnability (same parseFloat / null-guard pattern as ADR 0021 floor knobs).
- After resolving clusterDifficulty in the trade loop (after line ~240), add:
  `if (clusterDifficulty !== null && (100 - clusterDifficulty) / 100 < (minWinnability ?? MIN_WINNABILITY_FLOOR)) { excludedWinnabilityFloor++; continue; }`
- Track excludedWinnabilityFloor; pass excluded_winnability_floor to buildScoutReport.

**packages/agents/src/niche-hunter/scout-report.ts:** Add
`excluded_winnability_floor: z.number().default(0)` to ScoutReport.grid.

**packages/us-cities/src/city-ranker.ts (computeCityMarketScores):** Remove the
states argument from the listCitiesEnriched call at line ~328 that builds gridBuckets.
The per-city loop already handles population and state filtering; the grid index must
be unfiltered so out-of-state metro mass is available to getMetroDensityMultiplier.

**packages/db/src/schema.ts:** Update the scoutRefineTopK column comment (line ~1143)
to note the new code default is 25, not 0.

**Tests (packages/agents/src/niche-hunter/scout.test.ts):**
- Add scoutMinWinnability: null to the getSystemState mock.
- 'cache-only mode' test (line ~253): add refine_top_k: 0 to the runScout call.
- 'cold-miss DFS spend' test (line ~266): add refine_top_k: 0.
- 'refine_top_k unset' test (line ~381): rewrite to assert Stage 3 runs by default,
  getSerpComposition is called, and refined_count > 0.
- Add a winnability floor test: a trade mock with kd > 75 is absent from
  insertedCandidates; a benchmark-only (null kd) trade still appears.

**Tests (packages/agents/src/niche-hunter/value-model.test.ts):** Add
MIN_WINNABILITY_FLOOR to the import from './scoring-config'; add
`expect(MIN_WINNABILITY_FLOOR).toBe(0.25)` to the 'floor constants' test.

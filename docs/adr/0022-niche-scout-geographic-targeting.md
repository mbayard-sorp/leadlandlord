# ADR 0022: Niche-scout geographic targeting

Date: 2026-06-14
Status: accepted
Refines ADR 0020 (deterministic scout/validate engine) and ADR 0021 (rentability scoring)

## Context

ADR 0020 introduced a deterministic dollar-denominated scout. ADR 0021 added competition via
national `clusterDifficulty` and compressed metro dominance via sqrt population dampening. One
structural blindspot remains: `winnability` is identical for a given trade across every city,
because `clusterDifficulty` is derived from national DataForSEO keyword clusters
(location_code 2840). Population is the only signal that differentiates cities from each other in
the full scored grid.

Two consequences flow from this:

First, a city in a saturated metro suburb (Phoenix ring, Dallas ring, Atlanta ring) looks identical
to an isolated mid-size city with the same population. Local market saturation — the number of
competing contractors fighting for the same geographic SERP — is invisible to the scout.

Second, demand quality varies by city in ways unrelated to population. Owner-occupancy rate,
household income, and home value predict whether a home-services lead converts to a paying job and
whether the winning contractor can sustain a rent fee. These signals are already computed in
`packages/us-cities/src/city-ranker.ts` but ignored by the scout (which calls `listCities`, not
`rankCities`).

`rankCities` itself cannot be called directly: it hard-filters on population (15k–110k),
owner-occupancy (≥0.55), income (≥35k), and home value (≥100k), and caps cities per state. Those
filters would silently shrink the scout grid relative to its current population-band inputs,
producing a non-obvious correctness regression.

The plan introduces three layers: (1) free structural geo signal from existing `city-ranker.ts`
math, (2) a geo-tier reporting and diversity-cap pass, and (3) a bounded optional local-SERP
refinement pass. This ADR fixes the open questions that block engineering on all three layers.

## Decision

### 1 — Default blend strengths

Ship both `DEFAULT_GEO_COMP_BLEND` and `DEFAULT_GEO_DEMAND_BLEND` at `0.0`.

Every default reproduces today's output exactly (ADR 0020/0021 norm), verified by a regression test.
At α = 0, `localRankMult = 1.0` and `demandMult = 1.0` — the formula collapses algebraically to the
ADR 0021 formula, bit-for-bit. The feature ships inert; no ranking change happens until an operator
sets `scout_geo_comp_blend` and/or `scout_geo_demand_blend` non-zero in `/operator/control`. A
non-zero default would require calibration data we do not yet have (one live scout run, no
post-validation outcome data linking geo signals to tenant conversion). Suggested operator starting
values once the geo-tier report is observed: 0.3–0.5 per blend.

```ts
export const DEFAULT_GEO_COMP_BLEND = 0.0;
export const DEFAULT_GEO_DEMAND_BLEND = 0.0;
```

### 2 — Formula

```
localRankMult      = 1 − α_comp · (1 − metroDensityMult)
demandMult         = 1 − α_dem  · (1 − demandQuality)
winnability_eff    = clamp(winnability · localRankMult, 0, 1)
estMonthlyValueUsd = cityVolume · ctr · winnability_eff · callRate · leadBenchmarkPrice · demandMult
scoutScore         = estMonthlyValueUsd · rentabilityPrior
```

`localRankMult` and `demandMult` are both in `[0, 1]` by construction (α ∈ [0,1],
metroDensityMult ∈ [0.15, 1.0], demandQuality ∈ [0, 1]). The `clamp` on `winnability_eff` is cheap
insurance and matches the existing `estimateValidatedValue` pattern.

Competition folds into winnability and demand-quality into value — two separate levers for two
operator questions ("can we rank?" vs "is the demand worth winning?"). A single multiplier would
conflate them. Audit fields `localRankMult` and `demandMult` appear on `ScoutValue` and `ScoredCell`
so the operator can inspect the decomposition per candidate.

No population double-count: `metroDensityMult` uses `nearbyPopulation` (surrounding cities within
50 km, excluding the candidate); `demandQuality` uses ratios only. Neither scales with the
candidate's own population, which is already captured by `cityVolume`'s sqrt term. Locked by a
dedicated unit test.

### 3 — demandQuality composite

Include s1, s2, s3; exclude s4 (popBand — double-counts population) and s5 (age — weak signal,
fragile Census dependency). Weights deliberately elevate owner-occupancy to co-equal with wealth:

```ts
demandQuality = 0.40 * s1_ownerOccupied + 0.40 * s2_wealth + 0.20 * s3_housingUnits
```

s1/s2/s3 reuse the existing `city-ranker.ts` subscore formulas verbatim. s3 (log-scaled housing
units) is housing-stock density — total addressable market per geographic footprint — not
population. Weights are code constants, not `system_state` knobs (exposing six raw weight knobs
before calibration is premature). Missing Census fields fall back to the existing city-ranker
internal defaults (owner-occ 0.7, income 65k, home value 250k, units 15k) → graceful mid-range, not
0.

### 4 — Geo-tier mechanism

Geo-tier is a diversity cap + reporting surface only — NOT a third score multiplier (that would
double-count Census across Stage 1 and Stage 2).

Grouping: state (primary, always present) + `UsCity.county` (secondary "best metros"). Aggregation
over Stage-1 scored cells:

```
demandDensity         = mean(demandQuality)
competitionSaturation = mean(1 − metroDensityMult)
geoAttractiveness     = demandDensity · mean(metroDensityMult) = demandDensity · (1 − competitionSaturation)
```

Diversity cap: `scout_per_state_cap` (nullable integer; NULL = no cap = current behavior). When set
to N, cells are admitted greedily in score order, skipping any whose state count reached N — mirrors
`rankCities`' `perStateCap`. No county-level cap at launch.

`ScoutReport.insights` gains a `geo_tiers` object (`states[]`, `metros[]`, `census_hit_rate`), both
arrays sorted descending by `geoAttractiveness`; the UI renders top-10 of each.

### 5 — Stage-3 budget semantics

Keep `defaultDailyCapUsd = 15` for the scout. The per-agent and global caps are checked only at run
start (`assertBudgetAvailable`) and cannot arrest a mid-run loop, so the in-run
`scout_refine_budget_usd` guard is the real bound. Raising the daily cap would give false confidence.

- `DEFAULT_SCOUT_REFINE_BUDGET_USD = 3.00` (~13 cold trios at $0.225 each; far more on a warm cache).
- `DEFAULT_SCOUT_REFINE_TOP_K = 0` — Stage 3 ships disabled; an operator must set a positive
  `scout_refine_top_k` (per-run via `ScoutForm` or global via `/operator/control`) before any spend.
- Cache-hit-is-free accounting: accumulate `onCost`; count a call against the budget only when the
  incurred cost is > 0. A cold miss projecting over the remaining budget is skipped (graceful abort);
  a $0 cache hit is always served regardless of remaining budget.
- Graceful abort: refined cells carry `refinement_source = 'local_serp'`, the rest stay `'proxy'`;
  the report includes `refined_count`, `refine_spend_usd`, `refine_budget_exhausted`. The final
  ranking proceeds over the full cell array. Dedupe key `${city}|${state}|${trade}`.

### 6 — Census-absence policy

Missing Census → neutral multiplier via the mid-range subscore defaults already in `city-ranker.ts`;
NO confidence haircut. The `rankCities` `missingDataHaircut` (0.9) must NOT be carried into
`computeCityMarketScores`: in the full unfiltered grid, Census absence reflects survey-coverage
geography (rural / mid-South), not demand quality, and a haircut would bias the scout away from the
very low-saturation markets the geo-tier pass is meant to surface. `hasCensus` is persisted to
`niche_candidates.demand_quality`/`metro_density_mult` for audit, and the report logs the Census join
hit rate. Census-absent overestimates are corrected by full DataForSEO at validate time.

### 7 — Determinism

Stage 1 and Stage 2 are fully deterministic (pure functions over `listCitiesEnriched` + the
`buildGridBuckets`/`nearbyPopulation` math; no I/O, no randomness). Stage 3 is deterministic within
the DataForSEO cache TTL (SERP 14d, metrics 30d) and fully deterministic under `MOCK_AI=true`. The
scout's `dedupeKeyFn` (`niche-scout:${states}:${category}:${date}`) makes the whole run idempotent
per day, unchanged.

## Alternatives considered

- **Call `rankCities` directly** — rejected: its hard filters + per-state cap would silently shrink
  the scout grid and diverge from the scout's population-band inputs.
- **Non-zero default blends** — rejected for this release: no conversion calibration data; a non-zero
  default would change ranking on every run and prevent A/B comparison against the baseline.
- **Geo-tier as a third score multiplier** — rejected: double-counts Census across Stage 1 and 2,
  compounding the dense-metro penalty in a way the operator cannot inspect or tune.
- **Single combined `geoMult = metroDensityMult · demandQuality`** — rejected: collapses two
  operationally distinct, separately-tunable signals into one opaque number.
- **`missingDataHaircut` in `computeCityMarketScores`** — rejected: calibrated for the curated
  hard-filtered ranker; inappropriate for a full-grid scan where Census gaps are geographic.

## Consequences

- Scout ranking changes only when an operator sets a non-zero blend; until then the feature is inert
  and existing runs reproduce identically.
- The "Best geographies" report block is always populated (uses Stage-1 data, not gated by blends),
  giving market intelligence from the first run after ship.
- Stage 3 never runs until `scout_refine_top_k > 0` — no accidental DataForSEO spend.
- `computeCityMarketScores` must build the grid spatial index over ALL cities (not the
  population-filtered subset) so metro mass from large out-of-band cities still suppresses
  `metroDensityMult` for nearby in-band candidates — same pattern as `rankCities`.
- Migration 0045 adds all columns nullable; NULL resolves to code defaults (multiplier 1.0),
  preserving existing `niche_candidates` rows.
- The `city-ranker.ts` refactor (shared subscore helpers) is additive; `rankCities` behavior and
  tests are unchanged.

## Decisions for implementers

**scoring-config.ts constants:** `DEFAULT_GEO_COMP_BLEND = 0.0`, `DEFAULT_GEO_DEMAND_BLEND = 0.0`,
`DEFAULT_SCOUT_REFINE_BUDGET_USD = 3.00`, `DEFAULT_SCOUT_REFINE_TOP_K = 0`.

**value-model.ts — `ScoutValueArgs` additions:** `metroDensityMult?` (undefined → 1.0),
`demandQuality?` (undefined → 1.0), `compBlendStrength?` (undefined → DEFAULT_GEO_COMP_BLEND),
`demandBlendStrength?` (undefined → DEFAULT_GEO_DEMAND_BLEND).

**value-model.ts — `ScoutValue` audit additions:** `localRankMult`, `demandMult`,
`metroDensityMult`, `demandQuality` (all always emitted; 1.0 when geo signal absent).

**value-model.ts — formula:** as in section 2.

**us-cities/src/city-ranker.ts — new export `computeCityMarketScores`:**
- `opts: { states?: string[]; populationMin?: number; populationMax?: number }` — no hard Census
  filters, no per-state cap.
- Build `gridBuckets` over ALL cities (no pre-filter), as `rankCities` does.
- Per city in the pop band: `metroDensityMult` (existing `getMetroDensityMultiplier`),
  `demandQuality = 0.40*s1 + 0.40*s2 + 0.20*s3` via shared subscore helpers,
  `hasCensus = (ownerOccupiedPct !== undefined && medianIncome !== undefined && medianHomeValue !== undefined)`.
- Returns `Map<string, MarketSignal>` keyed `` `${city.toLowerCase()}|${state.toUpperCase()}` `` —
  matching the `existingCombos` key convention in `scout.ts`.
- `MarketSignal = { metroDensityMult: number; demandQuality: number; hasCensus: boolean }`.
- No haircut. Export `MarketSignal` from `packages/us-cities/src/index.ts`.

**scout.ts — Stage 1 wiring:** after `listCities`, call `computeCityMarketScores({ states,
populationMin, populationMax })`; on lookup miss use `{ metroDensityMult: 1.0, demandQuality: 1.0,
hasCensus: false }` (never drop the city); read `compBlendStrength` from `sys.scoutGeoCompBlend` and
`demandBlendStrength` from `sys.scoutGeoDemandBlend` (nullable → code defaults); pass all four geo
args into `estimateScoutValue`.

**scout-report.ts — `ScoredCell` additions:** `metroDensityMult`, `demandQuality`, `localRankMult`,
`demandMult`, `hasCensus`, `refinementSource: 'proxy' | 'local_serp'` (default `'proxy'`).

**scout-report.ts — `ScoutReport.insights.geo_tiers`:** `states[]` and `metros[]` each with
`{ state, [county], demandDensity, competitionSaturation, geoAttractiveness, candidateCount }` sorted
desc by `geoAttractiveness`, plus `census_hit_rate`. Computed in `buildScoutReport` over all cells.

**Diversity cap (scout.ts persist):** read `perStateCap` from `sys.scoutPerStateCap` (NULL = no cap);
when set, greedy score-order admission up to `perStateCap` per state, then slice to `persist_top`.

**Stage 3 refinement rules:** enabled only when `scout_refine_top_k > 0`; budget from per-run input
or `sys.scoutRefineBudgetUsd` (default 3.00); count a call against budget only when cost > 0; skip a
cold call projecting over remaining budget (keep cell `proxy`); always serve cache hits; re-rank the
full array before the persist slice.

**migration 0045 (all nullable, ADD COLUMN IF NOT EXISTS):**
- `system_state`: `scout_geo_comp_blend numeric(4,3)`, `scout_geo_demand_blend numeric(4,3)`,
  `scout_per_state_cap integer`, `scout_refine_top_k integer`, `scout_refine_budget_usd numeric(8,2)`,
  `scout_refine_measure_volume boolean`.
- `niche_candidates`: `local_serp_difficulty numeric(5,2)`, `local_aggregator_share numeric(4,3)`,
  `has_local_pack boolean`, `local_measured_volume integer`, `refinement_source text`,
  `metro_density_mult numeric(4,3)`, `demand_quality numeric(4,3)`.

**Required regression tests (must pass before merge):**
- `value-model.test.ts`: at α_comp = α_dem = 0, any `metroDensityMult`/`demandQuality` produces
  output identical to the ADR 0021 formula (exact float equality).
- `value-model.test.ts`: at α_comp > 0, `metroDensityMult = 0.15` scores below `1.0`; at α_dem > 0,
  lower `demandQuality` scores lower.
- `value-model.test.ts`: holding population constant, varying `metroDensityMult` changes
  `estMonthlyValueUsd` by exactly the multiplier fraction — no nonlinear population interaction.
- `computeCityMarketScores` test: Census-absent city → `demandQuality` in [0.3, 0.7], not 0; grid
  index built over ALL cities (a large out-of-band city still reduces a nearby in-band city's
  `metroDensityMult`).
- `scout.test.ts`: `scout_per_state_cap = 2` with 3 same-state candidates persists exactly the top 2.
- `scout.test.ts` (Stage 3): loop aborts when a cold call would exceed remaining budget; cache hits
  served regardless; `refine_budget_exhausted = true` when aborted.

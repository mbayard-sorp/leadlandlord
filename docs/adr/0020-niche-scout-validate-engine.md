# ADR 0020: Deterministic niche scout/validate engine

Date: 2026-06-12
Status: accepted
Supersedes the LLM-brainstorm NicheHunter agent (builds on ADR 0009, respects ADR 0019)

## Context

The legacy niche-hunter surfaced the same niches every run regardless of state:

- Claude brainstormed candidates from a fixed 447-trade taxonomy and ranked them by its own confidence score; only the top 8 reached DataForSEO.
- There was no run memory, so successive runs re-proposed known combos.
- The paid-ads call was hardcoded national (location_code 2840).
- Most score inputs were per-trade constants, so the 0-100 score was approximately f(trade) with no geographic signal — and a generic SEO index rather than a model of what we optimize for (expected MRR: rank fast + real call demand + rentable to a contractor).
- Operator inputs were guesses (brainstorm_count, score_top_n, min_search_volume, max_kd, min_job_value, city pool knobs).

## Decision

Replace LLM-driven candidate generation with a deterministic two-phase engine.

**Scout (niche-scout, near-zero cost).** Enumerate the full trade x city grid for operator-chosen states, score every cell from cached/static data (90-day cached keyword clusters, static lead benchmarks, rentability priors), rank by dollar-denominated expected monthly value, exclude combos already in `niches`, persist only the top ~500 (`niche_scout_runs` + `niche_candidates`, migration 0043) plus a report recommending how many candidates are worth validating (value-cliff detection). Prior runs for the same states are marked `superseded`. 100% deterministic and LLM-free.

**Validate (niche-validator, operator-approved spend).** Operator picks N from the scout report; the agent runs the full DataForSEO trio (city-scoped, including the previously-national paid-ads call) + Places contractor count on those N, with ~25% of slots reserved for never-surfaced trades (exploration quota), re-ranks by validated expected value, and lands rows in `niches` as `pending` for the existing human approve -> site-builder flow (unchanged, human-only per ADR 0019). Claude's only role in the engine is one annotation pass over the validated set (seasonality, licensing concern, one-line caution -> `niches.annotations`).

**Refresh (niche-keyword-refresher, quarterly).** Warms all taxonomy keyword clusters (90-day TTL) at concurrency 4 so scouts stay near-zero cost (`0 5 1 */3 *`, quarter-scoped dedupe). The scout also self-heals misses when `warm_missing_clusters=true`.

### Value model (packages/agents/src/niche-hunter/value-model.ts)

```
estCityVolume      = clusterVolume * (cityPopulation / US_POPULATION)
estMonthlyValueUsd = estCityVolume * CTR_AT_RANK (0.20) * CALL_RATE (0.10) * leadBenchmarkPrice
scoutScore         = estMonthlyValueUsd * rentabilityPrior

measuredVolume     = resolveDemandVolume(cityScopedSeedVolumeSum, estCityVolume)
winnability        = (100 - serpDifficulty) / 100
validatedValueUsd  = measuredVolume * CTR * winnability * CALL_RATE * leadBenchmarkPrice
validatedScore     = validatedValueUsd * (rentabilityScore / 100)
```

- `GEO_SHARE_PRIOR` (flat 0.15) is removed: population-proportional share replaces it (the prior inflated demand ~450x).
- Cluster volume counts commercial + transactional intent at full weight and null intent at 50%; trades with no cached cluster degrade to `benchmark_only` and rank below cluster-backed candidates.
- CTR and call-rate defaults are operator-tunable via `system_state.scout_ctr_at_rank` / `scout_call_rate`. Both predicted values (`est_monthly_value_usd`, `validated_monthly_value_usd`) are persisted and never overwritten so they can be calibrated against real call volume later.
- The legacy 0-100 `score` is still computed and written by `validateNicheCore` for one release while the UI overlap lasts; `computeScore` survives in niche-hunter/index.ts for that purpose only.

### Other notable choices

- `validateNicheCore` (validate.ts) is the single validation implementation shared by the operator server action and the validator agent, killing the old "SYNC: seeds must stay identical" comment hazard.
- `getPaidAdCount` accepts a `location_name`; on DataForSEO error 40501 it retries national and logs (worst case = status quo). The cache key keeps legacy national entries intact.
- `withDataForSeoCache` returns the incurred `costUsd`; DFS/Places helpers accept `onCost` so agents record cold-miss spend into `agent_runs.cost_usd` / `agent_budgets` (previously DFS spend was invisible to budgets).
- Three agents, three budgets: niche-scout $15/day (armed), niche-validator $15/day (armed), niche-keyword-refresher $15/day (scheduled). Natural dedupe keys: scout `states:category:date`, validator `scout_run_id:selector`, refresher `year-Qq`.
- neon-http has no transactions: the scout inserts the run as `building`, then candidates, then flips to `current` and supersedes priors, so a mid-write crash never exposes a half-populated run.

## Consequences

- Operator inputs reduce to states, validation count, optional category filter. Budget ~$12/run for 50 validated candidates ($0.245 each); first fully cold scout can cost up to ~$12.50 in cluster warming (or $0 with `warm_missing_clusters=false`).
- Scout results live outside `niches`, which stays purely the operator decision pipeline.
- The legacy NicheHunter agent, brainstorm prompt/schema, RunForm, runNicheHunter action, registry entry, and ScoringConfig thresholds are removed. Existing `niches` rows are untouched (new columns nullable; pending legacy rows stay decidable).

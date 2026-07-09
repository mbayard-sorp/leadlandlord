# ADR 0030: Niche scout accuracy fixes

Date: 2026-07-09
Status: accepted
Extends ADR 0020 (scout/validate engine), 0021 (rentability scoring), 0022 (geographic
targeting), 0024 (winnability floor), 0027 (calibration feedback loop)

## Context

An accuracy audit of the niche scout found three correctness bugs and six structural gaps
between what the engine measures and what it optimizes for (trade × city cells where local
SEO competition is low enough to rank and rent leads):

- **B1** — a failed `getSerpComposition` call returns `{difficulty: 50, fallback: true}` as a
  normal value. It was cached for 14 days like a real measurement, and the scout's Stage-3
  refinement stamped it onto cells as `refinement_source='local_serp'` without checking
  `.fallback` — fabricated data in both the current run and every scout/validate call for the
  TTL window.
- **B2** — `refinedCount` incremented on failed refinements (the catch returned success).
- **B3** — geo-signal maps keyed `city|state` collide for duplicate city names within a state;
  the same collision can violate `niche_candidates`' `(scoutRunId, trade, city, state)` unique
  index at persist time.
- **S1** — only the top-25 (+10 sampled) of ~100k grid cells receive a real local-SERP
  measurement; measured cells (typically demoted) mix unfairly with optimistic unmeasured
  proxy cells in the final ranking and the value-cliff recommendation.
- **S2** — demand is national cluster volume apportioned purely by population: no regional
  trade-fit signal (snow removal scores identically per-capita in Phoenix and Buffalo).
- **S3** — SERP difficulty = `70·aggregator_share + 30·(no local pack)` with hardcoded weights;
  `organic_count` unused; the aggregator sign itself is arguable for rank-and-rent.
- **S4** — CTR is a constant 0.2 even when `has_local_pack` is known for refined cells.
- **S5** — the winnability floor drops trades globally on national kd>75 while benchmark-only
  trades are exempt at an assumed 0.5.
- **S6** — scout predictions are never compared against validation outcomes despite both being
  persisted.
- Smaller: refine-path measured volume skips the seasonality dampening validate applies (M1);
  metro-density multiplier is a step function with cliff effects (M2); benchmark substring
  matching was untested across the ~447-trade taxonomy (M3); `niche-keyword-refresher` had
  every wiring point except its vercel.json cron entry (M4).

The fixes were designed and architect-reviewed as five phases on one branch. This ADR records
the decisions with real alternatives.

## Decisions

### 1 — Fallback SERP payloads are never cached, never applied, and separately counted

`withDataForSeoCache` gains an optional `shouldCache(value)` predicate; `getSerpComposition`
passes `(v) => !v.fallback`. Skip-write was chosen over a short-TTL row: the refine loop is
already budget-bounded so retry pressure is capped, and a second write path buys nothing.
Independently, `refineOneCell` checks `serp.fallback` BEFORE any cell mutation — the cache fix
alone would not stop a fallback from poisoning the current run's own ranking. Refinement
outcomes are now a four-way enum (`refined | fallback | failed | budget`); only `refined`
increments the refined/sampled counters, and `refine_failed_count` / `refine_fallback_count`
are reported. A one-off script (`scripts/purge-poisoned-serp-cache.ts`) deletes the already-
poisoned cache rows; poisoned candidate rows are reported but not rewritten — the next scout
run supersedes them.

### 2 — County-aware in-memory keys; no county column

Geo-signal maps and refine dedupe key on `city|county|state`. `existingCombos` stays
`niche|city|state` because `niches` has no county column — over-excluding a same-name sibling
city is conservative and survivable. A persist-time dedupe keeps only the highest-ranked cell
per `(trade, city, state)` (protecting the unique index) and reports
`duplicate_city_state_dropped`. Adding county columns to `niche_candidates`/`niches` was
rejected: it touches the unique constraint, the promotion path, and every UI keyed on
(trade, city, state) for a rare collision.

### 3 — Stage-3 default coverage 25→50 cells, budget $3→$5, daily cap $15→$20

More of the product (the ranking) rests on measurement. The daily cap must move with it:
`assertBudgetAvailable` is a pre-run gate only, and a fully-cold run (cluster warming ~$12.50 +
refine $5 ≈ $17.50) would exceed $15 mid-run with nothing to stop it. Both knobs remain
operator-revertible without deploy (`scout_refine_top_k`, `scout_refine_budget_usd`).

### 4 — Ensure-measured-above-the-cliff, flag-only on budget trip

After the refinement re-sort, any proxy cell ranked inside the value-cliff recommendation is
refined (≤3 iterations, own counter `ensure_measured_extra_count`). If the budget trips, the
report flags `recommendation_fully_measured: false` — the recommendation size is never shrunk,
because it must not depend on live spend/cache warmth. Proxy-bias (median refined/proxy score
ratio) is computed per run; pre-refinement values are persisted
(`proxy_est_monthly_value_usd`, `proxy_winnability`) for calibration. Applying the bias
correction to unmeasured cells ships default-off behind `scout_proxy_bias_weight`, affecting
`scoutScore` (ranking) only — never `estMonthlyValueUsd`, which stays honest for reports and
later validation comparison.

### 5 — Difficulty weights become knobs; difficulty is recomputed at read time

`computeSerpDifficulty(comp, weights)` is a pure exported function (defaults bit-identical to
the old constants). `getSerpComposition` recomputes difficulty from the cached raw fields
(`aggregator_share`, `has_local_pack`, `organic_count`) on every return and STOPS persisting
`difficulty` in the cache payload — a stored derived value nothing should trust is worse than
none. Consequence, accepted deliberately: warm-cache difficulty shifts when an operator changes
`scout_agg_weight`/`scout_local_pack_boost`, and historical `niches.dfs_kd` /
`niche_candidates.local_serp_difficulty` values become advisory (they reflect the weights in
force when written). Only three knobs ship now (`scout_agg_weight`, `scout_local_pack_boost`,
`scout_default_benchmark_winnability`); `organic_shortfall_relief` and `ctr_local_pack_mult`
exist as code parameters (no-op defaults) but get system_state columns only after the accuracy
report (below) can validate them.

### 6 — The aggregator sign does NOT change without evidence

Directories ranking top-3 may mean weak local competition (a green flag for rank-and-rent),
i.e. the current formula may have the sign backwards — but this is exactly the kind of
plausible-both-ways question the codebase now has data to settle.
`scripts/scout-accuracy-report.ts` (read-only, `READONLY_DATABASE_URL`) correlates persisted
`local_aggregator_share` / `has_local_pack` / difficulty against achieved GSC positions
(`niche_outcome_snapshots`) and scout-vs-validated score ranks. Any re-weighting waits for that
evidence.

### 7 — State-level measured demand, within-run normalized, default off

`getStateKeywordMetrics` (endpoint `metrics-state`, 90-day TTL, ~$0.0012/trade-state) measures
per-state demand for post-floor trades only. Fold:
`stateFit = clamp((stateVol/ΣstateVol)/(statePop/ΣstatePop), 1/4, 4)`,
`demandStateMult = 1 − α + α·stateFit`, α = `scout_state_demand_blend` (NULL/0 = pass skipped
entirely, zero fetch). Within-run normalization was chosen over a fixed national per-capita
anchor: with no calibration data yet, run-relative contrast is self-consistent and immune to
Keyword Planner's state-vs-national bucketing inconsistencies; the clamp bounds the two-state
worst case. Skipped for single-state runs (no contrast).

### 8 — has_local_pack lands as a typed column on niche_outcome_snapshots

The calibrator stamps it at snapshot time from `niches.dfs_raw` (falling back to the promoted
candidate's `has_local_pack`). `dfs_raw` is a field-discovery jsonb, not a stable contract —
having `niche-prior-suggester` join through its nested shape would be undocumented cross-agent
coupling. This enables CTR segmentation by SERP layout once sample sizes justify it.

### 9 — Metro-density smoothing is a blend, and rankCities keeps the step function

`scout_metro_density_smooth` blends `(1−s)·step + s·logInterp` (endpoints match the step
function's 1.0/0.15 plateaus) — a reversible dial, not a cliff-edge switch. `rankCities`
(ADR 0008) is pinned to the step function by construction at its call site.

## Consequences

- Failed lookups can no longer masquerade as measurements anywhere in the pipeline, and the
  operator can see failure/fallback counts per run.
- Everything above the value-cliff recommendation is measured (or explicitly flagged as not),
  and the measured-vs-proxy mixing bias is quantified per run before any correction applies.
- Every new signal (state demand, proxy bias, smoothing, difficulty weights) ships inert by
  default and is operator-tunable via system_state without deploy — matching the ADR 0022
  blend-strength pattern.
- Worst-case cold scout run ≈ $17.50 against the new $20 cap; warm steady-state unchanged.
- The accuracy report gives the improvement loop a measuring stick: scout-rank vs
  validated-rank correlation, per-trade bias, and proxy-vs-measured difficulty correlation are
  now observable rather than assumed.

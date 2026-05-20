# ADR 0009: Niche Scoring Two-Factor Model (SEO Winnability x Rentability)

Date: 2026-05-19

## Context

The current niche-hunter scoring model (`computeScore`) is a single composite of search volume, keyword difficulty, competition, ad presence, job value, and close rate. All inputs are SEO-side signals. The missing half is rentability: does a contractor in this city need leads, and will they pay for them?

Three gaps motivate this ADR:

1. Search volume measurement is based on 2 manually-chosen seeds. The Labs endpoint (`getKeywordCandidates`) already exists in the codebase with 90-day caching (~$0.028/seed, city-independent) and returns 50-80 phrase candidates with volume. Using the cluster aggregate as a demand proxy is strictly more accurate.

2. CPC is captured from the existing `getLocalKeywordMetrics` response at no extra cost but is not wired into scoring.

3. Contractor supply per city (rentability supply-side) is completely absent. A high-volume niche in a city with 200 competing contractors is less rentable than the same niche in a city with 8.

## Decision

### Phase 1 (build now)

**A1. Cluster volume in validate path.**
`validateNiche` calls `getKeywordCandidates(seed = row.niche)` at validation time. The seed is city-independent; 90-day cache means cold-miss cost is $0.028 per distinct niche name. Sum `search_volume` across transactional/commercial-intent phrases. Expose as `dfs_cluster_volume` (new nullable column). Use `Math.max(dfs_search_volume, dfs_cluster_volume * 0.15)` as the demand input to `computeScore`, where 0.15 is a configurable geo-share prior. Do NOT replace `dfs_search_volume` — preserve the 2-seed geo-scoped figure for calibration.

**A2. CPC sub-score.**
Add `cpc_signal` to `computeScore`. Formula: `cpc_sub = Math.min(1, avg_cpc / 15)`. Weight: 0.05 (small, does not materially shift existing score distribution). Default to `0` when CPC is absent (estimate-only runs). Existing rows score identically until re-validated.

**A3. Static lead-price benchmarks.**
New file `packages/agents/src/niche-hunter/lead-benchmarks.ts`. Per-trade lead price ranges and a homeowner-density prior derived from market data. Zero API cost. Adds `rentability_prior` as a score input, defaults to 0.5 (neutral) when the niche has no matching entry.

### Phase 2 (after 30+ operator validations, evidence review)

**B1. Google Places contractor count.**
One Places Text Search call per niche-city at validation time. Cache 30 days. Result stored as `contractor_count` (new nullable column). Cost: ~$0.020/call.

**C1. Rentability score.**
Separate column `rentability_score numeric(6,2)`. Formula: function of `(contractor_count, avg_cpc, lead_benchmark_price)`. NOT merged into `score`. Both columns visible in operator UI independently.

### Never

- LSA scraping. `ad_count` from the existing paid-ads SERP call is the proxy.
- Backlinks/DA per SERP domain at validate time (cost: $0.375-$0.75/validation). Revisit only with explicit revenue evidence that the SERP-difficulty signal is saturated.
- Auto-triggering `getKeywordCandidates` at brainstorm time (moves cost from operator-gated to automatic before signal value is proven).

## Alternatives Considered

**Collapse SEO + rentability into a single score immediately.** Rejected: operators need calibration intuition before weighting decisions are made. Two visible columns preserve that.

**Use DataForSEO backlinks for SERP competition instead of the aggregator-share heuristic.** Deferred to Phase 3. Adds $0.375-$0.75/validation before the cheaper signals are validated as useful.

**Keep the 3-seed bundle (niche + city-in-query + near-me).** Rejected in the already-made changes. The Google Ads search_volume endpoint geo-scopes by `location` param; the city-in-query phrase double-scopes and reliably returns ~0.

## Consequences

**Phase 1 schema changes:** one new column `dfs_cluster_volume integer` in `niches`. Hand-written migration required.

**Phase 2 schema changes:** `contractor_count integer`, `rentability_score numeric(6,2)` in `niches`. Hand-written migration required.

**Score column stability:** `score` continues to represent SEO winnability only through Phase 1 and Phase 2. A future Phase 3 ADR will decide whether to introduce a single composite or keep two-column display.

**`computeScore` extension contract:** new optional inputs (`avg_cpc`, `rentability_prior`) default to neutral values so estimate-only runs and pre-Phase-2 rows produce scores comparable to the current baseline. The 234-test suite must not require updates for Phase 1.

**Agent ownership:** `next-engineer` owns all implementation. No site-host or operator-tick changes required for Phase 1. Phase 2 requires a new integration call in the validate server action only.

## Amendment (2026-05-19): Demand resolution — supersedes A1 blend

### Context

Three live operator validations exposed that decision A1's `Math.max` blend produces demand inputs that are both wrong in magnitude and incapable of differentiating niches:

| Niche / City | Claude est | DFS 2-seed measured | demand fed to score |
|---|---|---|---|
| concrete patio / Everett WA | 150 | 20 | 12,144 |
| gutter / Everett WA | 190 | 20 | (blend) |
| roof replacement / West Valley City UT | 260 | 20 | 70,782 |

Two independent failures stack:

1. **DFS floors at city x phrase granularity.** Google Ads Keyword Planner's low-volume bucketing returns `search_volume: 10` for every hyperlocal exact-phrase at this granularity. The 2-seed sum (20) is real data with zero dynamic range — it cannot distinguish a strong market from a weak one. The codebase already knew this: `scoreCandidate` in `packages/agents/src/niche-hunter/index.ts` has a `DFS_TRUST_FLOOR = 100` guard and falls back to Claude's estimate when DFS is below it.

2. **The cluster blend over-inflates by ~450x and then saturates.** A1 introduced `demand = Math.max(dfsSeed, clusterNational * 0.15)` in `validateNiche` only. The cluster aggregate is national US volume; a mid-size city is ~0.03% of the US, so the correct geo share is ~0.0003, not 0.15. More critically, `computeScore`'s demand sub-score formula `Math.min(1, Math.log10(volume+1)/4)` saturates at 10,000 — so the resulting values of 12,144 and 70,782 both pin `demandSub = 1.0`. Demand contributed the maximum for every validated row and provided zero score differentiation; the demand term was effectively dead.

The root cause is a path divergence: `scoreCandidate` (brainstorm) and `validateNiche` (operator validation) each implemented demand resolution independently, despite "SYNC these seeds" comments. A1 modified only the validate path, silently breaking the invariant.

Full diagnosis and verification plan: `docs/PLAN-niche-demand-resolution.md`.

### Decision

**A1 is superseded.** The `Math.max(dfsSeed, clusterNational * geoSharePrior)` blend is removed from the score input path.

**Shared demand resolver.** A new exported function `resolveDemandVolume(dfsVolume: number, claudeMid: number): { volume: number; source: 'dataforseo' | 'claude_estimate' }` is the single definition of demand resolution. Logic: `dfsVolume >= DFS_TRUST_FLOOR ? dfsVolume : claudeMid`. Both `scoreCandidate` and `validateNiche` call it; neither duplicates the logic inline.

**`geoSharePrior` demoted to display-only.** The prior survives in `system_state` and the operator control panel (for Phase 2 re-purposing) but is labeled as "display only — not a score input." It is used only to render the informational cluster-blend line in the calibration drawer. Editing it does not affect the score until Phase 2.

**Drawer cross-checks preserved.** `dfsClusterVolume` and `dfsSearchVolume` remain stored and shown in the calibration drawer alongside the Claude estimate and the "cluster x share" informational line. The drawer caption is corrected to a factual note: which source was used and why (e.g., "DFS measured (20) below trust floor (100) — used Claude estimate (150)").

### Phase 2 (gated; do not start without Gate-A evidence)

Replace Claude's estimate in the fallback with a deterministic model: `clusterNational * (cityPop / usPop) * propensityMultiplier`. Re-purpose `geoSharePrior` as `propensityMultiplier` (default 1.0). Prerequisite: a per-city population source (the Census integration currently exposes only name-parsing; the upstream city-pool filter must be located and confirmed queryable at validate time).

### Alternatives considered

**Keep the cluster blend, fix the prior.** The correct geo share (~0.0003 for a mid-size city) would reduce inflation, but the `demandSub` saturation ceiling of ~10,000 means even corrected values in the hundreds still pin the curve for good markets. Fixing the prior does not restore score differentiation. Rejected.

**Use Claude's estimate in both paths without extracting a shared function.** Fixes the magnitude but not the divergence risk. The next edit to either file recreates the split. Rejected.

### Consequences

- `score` values change on re-validation only; existing rows are unaffected until re-validated by the operator.
- `demandSub` will now land in the 0.5-0.6 range for typical mid-size city validations (Claude estimates 150-260), restoring differentiation across rows.
- The `ScoringPriorsSection` UI label for geo-share prior must be updated to reflect its display-only status; the `system_state` column is preserved for Phase 2.
- `DFS_TRUST_FLOOR` and `DEMAND_SUB_SATURATION_CEILING = 10_000` are exported from `packages/agents/src/niche-hunter/scoring-config.ts` as documented scoring constants.
- No schema migration required for Phase 1; `dfs_cluster_volume` column already exists.

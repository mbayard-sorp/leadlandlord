# Handoff: Niche Scoring (ADR 0009) — Remaining Phases

Owner of record: niche-hunter workstream. Authoritative design: [docs/adr/0009-niche-scoring-two-factor.md](adr/0009-niche-scoring-two-factor.md).

This doc covers what is SHIPPED, the open gates/decisions, and the concrete remaining work. It is self-contained: a cold session should be able to pick up from here.

## TL;DR

- Phase 1 (cluster volume + CPC sub-score + lead-benchmark prior) and Phase 2 (Places contractor count + separate rentability score) are **built, tested, and merged into the working branch** (PR #82, commits `7cca7d2` + `c176b8e`).
- Migrations 0024/0025/0026 are **applied** to the shared Neon DB; the migration journal/ledger drift that predated this work was also repaired.
- What remains is mostly **calibration and decisions**, not net-new feature scaffolding: prove the new signals track reality, make the priors tunable, then decide whether to add the expensive SERP-competition signal and whether to collapse to a single composite score.

## Hard constraint (carry forward)

Operator rule: **do not blow up the DataForSEO / external API with useless calls or options we can't use.** Every external call must be justified, cached, and (for paid SERP/Places work) operator-gated inside `validateNiche` — never fired per-candidate at brainstorm time. This is why all live data is behind the operator's "Validate" button.

## Current state (what is already in place)

Scoring lives in two functions:
- `computeScore(...)` — SEO **winnability** only. `packages/agents/src/niche-hunter/index.ts`. Inputs: demand, serp_difficulty, ad_presence, city_size_fit, niche_risk, plus optional `avg_cpc` (w 0.05) and `rentability_prior` (w 0.05). Optional terms are **omit-when-absent**: undefined → contributes 0, so estimate-only and pre-validation rows score identically to the pre-ADR baseline. Validated rows can reach 0–110.
- `computeRentabilityScore(...)` — **rentability**, kept separate from `score`. `packages/agents/src/niche-hunter/lead-benchmarks.ts`. Inputs: contractor_count (tent curve, peaks ~14, penalizes saturation toward 20), avg_cpc (ceiling $12), lead_benchmark_price (ceiling $100). Weights 0.50 / 0.25 / 0.25.

Data sources, all cached, all operator-gated in `validateNiche` (`apps/operator/app/operator/niches/actions.ts`):
- `getLocalKeywordMetrics` — Google Ads search_volume (volume + cpc + monthly seasonality). Cached 30d. Seeds are `[niche, "niche near me"]` (the city-in-query seed was dropped: volume is already geo-scoped by `location`, so it returned ~0). **`scoreCandidate` in niche-hunter/index.ts MUST keep the same seeds — they are a hidden sync point.**
- `getSerpComposition` — organic SERP → derived 0–100 difficulty + aggregator_share + local_pack. Cached 14d.
- `getPaidAdCount` — ads SERP advertiser count. Cached 14d (was uncached before this work).
- `getKeywordCandidates` — DataForSEO Labs cluster, ~$0.028/seed, **cached 90d, city-independent**. Demand blends as `max(2-seed volume, clusterVolume * GEO_SHARE_PRIOR)`, prior = 0.15.
- `getContractorCount` — Google Places Text Search, first page only, cached 30d under `places-contractor-count`. ~$0.017/call.

Schema (`packages/db/src/schema.ts`, table `niches`): added `dfs_cluster_volume` (0025), `contractor_count` + `rentability_score` (0026). Earlier validation columns (`volume_source`, `est_search_volume`, `dfs_*`, `validated_at`, `dfs_raw`) came from 0024. Operator UI shows `score`, `rentability_score`, `contractor_count` independently (`apps/operator/app/operator/niches/page.tsx`).

Verify everything still green:
```
pnpm --filter @leadlandlord/integrations --filter @leadlandlord/agents --filter @leadlandlord/operator typecheck
pnpm --filter @leadlandlord/agents test     # 270 tests
pnpm --filter @leadlandlord/operator build
```

## Migration discipline (READ BEFORE ADDING A MIGRATION)

This repo hand-maintains `packages/db/migrations/meta/_journal.json` AND the `drizzle.__drizzle_migrations` ledger. They had drifted (files on disk absent from the journal → `db:migrate` silently skipped them). Now reconciled. To add a migration:
1. Write `00NN_name.sql` with `--> statement-breakpoint` between statements.
2. Add a journal entry: `idx` = next, `version "7"`, `breakpoints: true`, `when` strictly greater than the current max. Current max `when` = `1780600000000` (0026) — use `1780700000000` next.
3. Apply with `pnpm db:migrate` (NOT ad-hoc SQL — the auto-mode classifier blocks raw prod-DB writes; `db:migrate` is the sanctioned path). The migrator applies only entries whose `when` exceeds the max ledger `created_at`, so a correct `when` means exactly your new migration runs.
4. DB migrations require explicit operator approval before applying. Confirm first.

## Remaining work

### Gate A — Evidence & calibration (DO THIS BEFORE Phase 3)

Phase 2 was built ahead of the ADR's "30+ validations" evidence gate at the operator's direction. That evidence still needs to be gathered and the priors tuned. This is the single most important next step — the formulas are v1 heuristics.

- Accumulate **≥30 real operator validations** across varied niches/cities (each spends ~$0.09 DFS + ~$0.017 Places; operator-gated, so cost is controlled).
- Compare per row: Claude estimate vs `dfs_search_volume` vs `dfs_cluster_volume * GEO_SHARE_PRIOR`. The motivating case was "gutter installation / Everett WA" — Claude 190 vs measured 20. Confirm whether the cluster blend closes that gap or just shifts it.
- Tune: `GEO_SHARE_PRIOR` (0.15, in `scoring-config.ts`); the rentability tent peak/saturation points and the $12/$100 ceilings (`lead-benchmarks.ts`); the per-trade lead-price table (only ~15 trades seeded — expand as new niches appear).
- Sanity-check `contractor_count`: Places first-page caps at 20, so any market with ≥20 contractors reads as "20/saturated." Confirm that ceiling is acceptable signal, not a distortion, for the cities we actually target.
- Deliverable: a short calibration note (or ADR 0009 amendment) recording the tuned values and the evidence behind them.

### Task B — Operator-tunable priors (settings UI) — SHIPPED (v1)

The architect flagged `GEO_SHARE_PRIOR` (and arguably the rentability ceilings / benchmark overrides) should be operator-overridable, not a hardcoded constant.

**Done (v1):** Three scalars are now operator-overridable from the existing `/operator/control` panel (no separate Settings page was built — the `system_state` singleton already hosts operator controls, so the priors live there):
- `geoSharePrior` (default 0.15) — `system_state.geo_share_prior`
- rentability CPC ceiling (default 12) — `system_state.rentability_cpc_ceiling`
- rentability lead-price ceiling (default 100) — `system_state.rentability_lead_price_ceiling`

Migration `0027_scoring_priors.sql` adds the three nullable columns. NULL = use the agents-package default, so unset rows behave identically to pre-Task-B. `validateNiche` (`apps/operator/app/operator/niches/actions.ts`) reads the overrides off the `sys` row it already fetches and falls back to `GEO_SHARE_PRIOR` / `DEFAULT_RENTABILITY_CPC_CEILING` / `DEFAULT_RENTABILITY_LEAD_PRICE_CEILING`. `computeRentabilityScore` now takes optional `cpc_ceiling` / `lead_price_ceiling`. Constants in `scoring-config.ts` / `lead-benchmarks.ts` remain the bootstrap defaults. Changes apply to the **next** validation only — existing rows are not rescored.

**Still hardcoded (deferred, not in v1):** the per-trade `TRADE_BENCHMARKS` lead-price table (needs a table editor; framed as ongoing curation) and the rentability tent-curve breakpoints (2 / 14 / 20) and weights (0.50 / 0.25 / 0.25). Add these when the per-trade calibration work in Gate A justifies them.

### Phase 3 — Deferred, needs a new ADR (do NOT start without one)

Two open items from ADR 0009, both gated on Gate A evidence:

1. **SERP competition via backlinks / domain authority.** Replace/augment the aggregator-share difficulty heuristic with referring-domain / DR metrics for the ranking domains (DataForSEO backlinks endpoints exist at `packages/integrations/src/dataforseo/backlinks.ts`). **Cost: ~$0.375–$0.75 per validation** — an order of magnitude over current per-validation spend. ADR says revisit ONLY with explicit revenue evidence that the cheap difficulty signal is saturated/insufficient. Default answer is "not yet."

2. **Single composite vs two-column score.** Decide whether to collapse SEO `score` and `rentability_score` into one ranked number or keep them as two visible columns. ADR deliberately kept them separate so operators build calibration intuition first. Changing this is a scoring-model decision → write a Phase 3 ADR before touching `computeScore`.

### Explicitly ruled OUT (do not build)

- **LSA (Local Services Ads) scraping** — `ad_count` from the existing paid-ads SERP call is the willingness-to-pay proxy. No scraping.
- **Auto-triggering `getKeywordCandidates` (or any paid call) at brainstorm time** — moves cost from operator-gated to automatic before signal value is proven. Keep all paid calls behind Validate.

## Key references

- ADR: [docs/adr/0009-niche-scoring-two-factor.md](adr/0009-niche-scoring-two-factor.md)
- PR: #82 (`mbayard-sorp/leadlandlord`), branch `claude/silly-mestorf-0be2cc`
- Scoring config / priors: `packages/agents/src/niche-hunter/scoring-config.ts`, `packages/agents/src/niche-hunter/lead-benchmarks.ts`
- Validate action (where all live data is fetched + scored): `apps/operator/app/operator/niches/actions.ts`
- DataForSEO integration: `packages/integrations/src/dataforseo/index.ts` (+ `cache.ts`, `backlinks.ts`)
- Places integration: `packages/integrations/src/google-places/index.ts`
- Operator UI: `apps/operator/app/operator/niches/page.tsx`

# Handoff: Niche Scoring (ADR 0009) — Calibration & Remaining Phases

Picks up after **PR #84** (Task B — operator-tunable priors) landed on top of **PR #83** (Phase 1+2 two-factor scoring + Gate A calibration drawer, merged as `f2fe070`). Authoritative design: [docs/adr/0009-niche-scoring-two-factor.md](adr/0009-niche-scoring-two-factor.md). Prior handoff (still valid for background): [docs/HANDOFF-NICHE-SCORING.md](HANDOFF-NICHE-SCORING.md).

This doc is self-contained: a cold session should be able to pick up from here.

## TL;DR

- Scoring scaffolding is **done and shipped**. SEO winnability (`computeScore`) and rentability (`computeRentabilityScore`) are separate, both wired into the operator-gated `validateNiche` path. The Gate A calibration drawer surfaces the three-way demand comparison per validated row.
- The three v1 tuning knobs are now **operator-overridable at runtime** (no deploy) via `/operator/control`: `geoSharePrior`, rentability CPC ceiling, rentability lead-price ceiling. Stored on the `system_state` singleton; NULL = use the hardcoded default.
- What remains is **calibration (evidence-gathering + tuning), not feature scaffolding**, plus two explicitly-deferred items each gated behind their own decision/ADR.

## Hard constraint (carry forward)

Operator rule: **do not blow up the DataForSEO / Places API with useless calls.** Every external call must be justified, cached, and (for paid SERP/Places work) operator-gated inside `validateNiche` — never fired per-candidate at brainstorm time. All live data stays behind the operator's "Validate" button.

## Current state (what is in place)

- `computeScore(...)` — SEO winnability only. `packages/agents/src/niche-hunter/index.ts`. Optional `avg_cpc` (w 0.05) and `rentability_prior` (w 0.05) are omit-when-absent.
- `computeRentabilityScore(...)` — separate rentability score. `packages/agents/src/niche-hunter/lead-benchmarks.ts`. Tent supply curve (peaks ~14, penalizes saturation toward 20) + CPC ceiling + lead-price ceiling, weights 0.50 / 0.25 / 0.25. **CPC and lead-price ceilings are now parameters** (`cpc_ceiling`, `lead_price_ceiling`), defaulting to 12 / 100.
- Tunable priors live in two places:
  - **Hardcoded defaults** (bootstrap): `GEO_SHARE_PRIOR` (0.15) in `scoring-config.ts`; `DEFAULT_RENTABILITY_CPC_CEILING` (12) + `DEFAULT_RENTABILITY_LEAD_PRICE_CEILING` (100) in `lead-benchmarks.ts`.
  - **Runtime overrides**: `system_state.geo_share_prior`, `.rentability_cpc_ceiling`, `.rentability_lead_price_ceiling` (migration 0027, applied). `validateNiche` (`apps/operator/app/operator/niches/actions.ts`) reads them off the `sys` row it already fetches and falls back to the constants when NULL. Edited from `/operator/control` (`ControlForms.tsx` + `_actions.ts` → `updateScoringPriors`). **Overrides apply to the next validation only — they do not rescore existing rows.**
- Data sources, all cached, all operator-gated in `validateNiche`: `getLocalKeywordMetrics` (volume+CPC+seasonality, 30d), `getSerpComposition` (14d), `getPaidAdCount` (14d), `getKeywordCandidates` (DFS Labs cluster, 90d, city-independent), `getContractorCount` (Places, 30d, ~$0.017). Seeds for volume = `[niche, "niche near me"]` — **`scoreCandidate` in niche-hunter/index.ts MUST keep the same seeds (hidden sync point).**

Verify everything green:
```
pnpm --filter @leadlandlord/integrations --filter @leadlandlord/agents --filter @leadlandlord/operator typecheck
pnpm --filter @leadlandlord/agents test     # 274 tests
pnpm --filter @leadlandlord/operator build
```

## Migration discipline (READ BEFORE ADDING A MIGRATION)

This repo hand-maintains `packages/db/migrations/meta/_journal.json` AND the `drizzle.__drizzle_migrations` ledger. To add one:
1. Write `00NN_name.sql` with `--> statement-breakpoint` between statements.
2. Add a journal entry: `idx` = next, `version "7"`, `breakpoints: true`, `when` strictly greater than the current max. Current max `when` = `1780700000000` (0027) — use `1780800000000` next.
3. Apply with `pnpm db:migrate` (NOT ad-hoc SQL). **Gotcha:** in a worktree the migrate script looks for `.env.local` at the worktree root and won't find it (it lives in the main repo root, `/Users/mikebayard/Claude/LeadLandlord/.env.local`). The `.env.local` value contains an unquoted `&`, so `source` fails — instead pass it inline:
   ```
   DATABASE_URL="$(grep '^DATABASE_URL=' /Users/mikebayard/Claude/LeadLandlord/.env.local | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')" pnpm db:migrate
   ```
4. DB migrations require explicit operator approval before applying. Confirm first.

## Remaining work

### Gate A — Evidence & calibration (THE NEXT STEP, blocks Phase 3)

Phase 2 was built ahead of the ADR's "30+ validations" evidence gate. The formulas are v1 heuristics; they still need to be proven against reality and tuned. **Now that the runtime knobs exist (Task B), tuning no longer needs a deploy — adjust on `/operator/control` between validation batches.**

- Accumulate **≥30 real operator validations** across varied niches/cities (each ~$0.09 DFS + ~$0.017 Places; operator-gated, cost controlled).
- Use the **Gate A calibration drawer** (per validated row on `/operator/niches`) to compare: Claude estimate vs `dfs_search_volume` (2-seed measured) vs `dfs_cluster_volume × geoSharePrior`. The motivating case was "gutter installation / Everett WA" — Claude 190 vs measured 20. Confirm whether the cluster blend closes that gap or just shifts it.
- Tune via the `/operator/control` knobs and observe: `geoSharePrior` (0.15), CPC ceiling (12), lead-price ceiling (100). Note: changing a knob only affects **future** validations — to recalibrate a row you must re-validate it.
- Still hardcoded (no UI yet — see deferred Task B extensions): the per-trade lead-price table and the tent peak/saturation breakpoints. Tune these in `lead-benchmarks.ts` (needs a deploy) if evidence demands it.
- Sanity-check `contractor_count`: Places first-page caps at 20, so any market with ≥20 contractors reads as "20/saturated." Confirm that ceiling is acceptable signal for the cities we target.
- **Deliverable:** a short calibration note (or ADR 0009 amendment) recording the tuned values and the evidence behind them.

### Task B extensions — Deferred (not in PR #84)

v1 shipped only the three scalars. Build these only if Gate A evidence justifies the added surface:

1. **Per-trade lead-price table editor.** `TRADE_BENCHMARKS` in `lead-benchmarks.ts` is ~15 trades, hardcoded. A UI to edit/extend it means a table-CRUD surface + JSON storage (likely a new `system_state` JSON column or a dedicated table). The handoff framed this as ongoing curation as new niches appear.
2. **Rentability tent-curve breakpoints + weights.** The supply curve (2 / 14 / 20) and the 0.50 / 0.25 / 0.25 weights are deep heuristics, currently hardcoded in `computeRentabilityScore`. Expose only after the curve shape itself is validated — exposing knobs on an unvalidated shape invites noise.

### Phase 3 — Deferred, needs a new ADR (do NOT start without one)

Both gated on Gate A evidence:

1. **SERP competition via backlinks / domain authority.** Augment the aggregator-share difficulty heuristic with referring-domain / DR metrics for ranking domains (`packages/integrations/src/dataforseo/backlinks.ts`). **Cost: ~$0.375–$0.75 per validation** — an order of magnitude over current spend. ADR says revisit ONLY with explicit revenue evidence the cheap signal is insufficient. Default answer: "not yet."
2. **Single composite vs two-column score.** Decide whether to collapse SEO `score` and `rentability_score` into one ranked number or keep them as two visible columns. ADR deliberately kept them separate so operators build intuition first. Changing this → write a Phase 3 ADR before touching `computeScore`.

### Explicitly ruled OUT (do not build)

- **LSA (Local Services Ads) scraping** — `ad_count` from the existing paid-ads SERP call is the willingness-to-pay proxy. No scraping.
- **Auto-triggering `getKeywordCandidates` (or any paid call) at brainstorm time** — keep all paid calls behind Validate.

## Key references

- ADR: [docs/adr/0009-niche-scoring-two-factor.md](adr/0009-niche-scoring-two-factor.md)
- PRs: #83 (Phase 1+2 + drawer, merged `f2fe070`), #84 (Task B runtime priors)
- Defaults/priors: `packages/agents/src/niche-hunter/scoring-config.ts`, `packages/agents/src/niche-hunter/lead-benchmarks.ts`
- Runtime overrides: `apps/operator/app/operator/control/_actions.ts` (`updateScoringPriors`) + `ControlForms.tsx` (Niche-scoring priors section); columns on `system_state` (`packages/db/src/schema.ts`).
- Validate action (where live data is fetched + scored): `apps/operator/app/operator/niches/actions.ts`
- Calibration drawer: `apps/operator/app/operator/niches/CalibrationDrawer.tsx`
- DataForSEO: `packages/integrations/src/dataforseo/index.ts` (+ `cache.ts`, `backlinks.ts`); Places: `packages/integrations/src/google-places/index.ts`
- Operator niches UI: `apps/operator/app/operator/niches/page.tsx`

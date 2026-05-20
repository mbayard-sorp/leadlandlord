# Implementation Plan: Fix Niche Demand Resolution

Date: 2026-05-19
Status: PROPOSED — awaiting approval
Revises: [ADR 0009](adr/0009-niche-scoring-two-factor.md) decision A1 (the `Math.max` cluster blend)

## Problem (evidence-backed)

Niche selection is the existential signal for the business, and the demand half of the score is currently broken. Three live operator validations exposed it:

| Niche / City | Claude est | DFS 2-seed measured | demand fed to score |
|---|---|---|---|
| concrete patio / Everett, WA | 150 | 20 | 12,144 |
| gutter / Everett, WA | 190 | 20 | (blend) |
| roof replacement / West Valley City, UT | 260 | 20 | 70,782 |

Raw response (roof replacement): `"roof replacement"` → `search_volume: 10`, `"roof replacement near me"` → `search_volume: 10`. Sum = 20.

Two independent failures stack:

1. **The 2-seed measured volume floors at ~10/phrase.** This is Google Ads Keyword Planner's coarse low-volume bucketing at city × exact-phrase granularity, not a bug. It is *real data with zero dynamic range* — every hyperlocal phrase bottoms out at the same ~10, so it can't tell a good market from a bad one. (The code author already knew this — see [index.ts:237](../packages/agents/src/niche-hunter/index.ts) and the `DFS_TRUST_FLOOR` logic.)

2. **The cluster blend over-inflates by ~450×.** `demand = Math.max(dfsSeed, clusterNational × geoSharePrior)` with `geoSharePrior = 0.15`. The cluster aggregate is **national** US volume; a mid-size city is ~0.03% of the US, so the geo share should be ~0.0003, not 0.15. Worse, `computeScore`'s demand sub-score is `min(1, log10(volume+1)/4)`, which **saturates at 10,000** — so 12,144 and 70,782 both pin `demandSub = 1.0`. Demand contributes the maximum for every validated row and provides **zero differentiation**; the score's demand term is effectively dead.

## Root cause

Two code paths diverged on how they resolve demand, despite "SYNC these seeds" comments:

- **Brainstorm** (`scoreCandidate`, [index.ts:642-646](../packages/agents/src/niche-hunter/index.ts)): `resolvedVolume = dfsVolume >= 100 ? dfsVolume : claudeMid`. Falls back to Claude's population-anchored estimate when DFS floors. **Sound.**
- **Validate** (`validateNiche`, [actions.ts:354](../apps/operator/app/operator/niches/actions.ts)): `Math.max(dfsSeed, clusterNational × 0.15)`. Ignores Claude's estimate, uses the inflated blend. **Broken.**

ADR 0009 A1 introduced the blend in the validate path only, creating the divergence. The fix is to make demand resolution a single shared function both paths call, and to feed `computeScore` a local-scale number its log curve was designed for.

## Key insight

There is **no cheap city-level ground truth** for total niche demand — Google floors at this granularity. Claude's brainstorm estimate (`city_pop × homeowner_share × incidence ÷ 12 × local_intent`) is currently the **soundest demand signal we have**, and it's already population-anchored. So Phase 1 is "stop discarding it." A more elaborate data-derived model is Phase 2, and only justified if evidence shows Claude's estimate is systematically biased — which we cannot yet know.

## Decision

**Phase 1 (do now):** Restore consistency. Both paths resolve demand through one shared `resolveDemandVolume(dfsVolume, claudeMid)` helper (`dfs >= DFS_TRUST_FLOOR ? dfs : claudeMid`). Drop the cluster blend from the score input. Keep `dfsClusterVolume` and `dfsSearchVolume` as **visible cross-checks** in the calibration drawer, not score inputs. Fix the misleading drawer caption.

**Phase 2 (gated, deferred):** Replace Claude's estimate with a deterministic population-anchored model `demand = clusterNational × (cityPop / usPop) × propensity`, re-purposing the operator-tunable prior as `propensity` (default 1.0). Build **only if** Gate-A evidence (more validations + operator judgement) shows Claude's estimates are systematically off. Prerequisite: a per-city population source (the Census integration currently exposes none; the city pool is population-filtered somewhere upstream — must be located first).

## Phase 1 — Tasks

1. **Extract a shared demand resolver.** In `packages/agents/src/niche-hunter/scoring-config.ts` (or `index.ts`), export `DFS_TRUST_FLOOR = 100` and `resolveDemandVolume(dfsVolume: number, claudeMid: number): { volume: number; source: 'dataforseo' | 'claude_estimate' }`. Single source of truth — eliminates the path divergence.

2. **Use it in `scoreCandidate`** ([index.ts:642-646](../packages/agents/src/niche-hunter/index.ts)). Replace the inline `DFS_TRUST_FLOOR`/ternary with the shared helper. Behavior unchanged; now centralized.

3. **Use it in `validateNiche`** ([actions.ts:354](../apps/operator/app/operator/niches/actions.ts)). Replace `const demandVolume = Math.max(search_volume, clusterVolume * geoSharePrior)` with:
   ```ts
   const claudeMid = row.estSearchVolume ?? row.searchVolume ?? 0;
   const { volume: demandVolume } = resolveDemandVolume(search_volume, claudeMid);
   ```
   Keep computing `clusterVolume` and storing `dfsClusterVolume` (drawer cross-check). `geoSharePrior` is no longer a score input — it survives only to render the informational "cluster blend" line in the drawer (mark its score-path use removed; full removal/repurpose is Phase 2).

4. **Fix the calibration drawer** (`CalibrationDrawer.tsx`). Show all four numbers (Claude est, DFS measured, cluster national, cluster×share) and label which one fed the score. Replace the "Claude was N× low/high" caption (it editorializes against Claude in the wrong direction) with a factual note, e.g. *"DFS measured (20) below trust floor (100) → used Claude estimate (150)."* When `dfs >= 100`, note DFS was used.

5. **Amend ADR 0009.** Add a dated amendment: A1's `Math.max` blend is replaced by the shared `resolveDemandVolume`; record the 3-validation evidence and the `demandSub` saturation finding; demote `geoSharePrior` to drawer-only pending Phase 2.

## Phase 1 — Tests

- Unit tests for `resolveDemandVolume`: `dfs=120,claude=200 → 120/dataforseo`; `dfs=20,claude=150 → 150/claude_estimate`; `dfs=100 → boundary uses dfs`.
- Update any `validateNiche`/scoring tests that asserted the blend.
- Full suite green (`pnpm --filter @leadlandlord/agents test` — currently 274).
- Typecheck: integrations + agents + operator.

## Phase 1 — Verification (live)

- Disable kill switch → re-validate the 3 rows → re-enable (same flow as before, ~$0 on cached calls / cents on cold).
- Expect: demand now = Claude estimate (150 / 190 / 260), `demandSub` in the 0.5–0.6 range (not 1.0), scores drop and **differentiate** (roof's higher demand + CPC should separate it from patio on merit, not on a saturated ceiling).
- Confirm drawer shows the four numbers with the correct "used Claude estimate" note.

## Phase 2 — Tasks (gated; do NOT start without evidence + approval)

1. Locate the per-city population source feeding the population-filtered city pool; confirm it's queryable at validate time.
2. Thread `cityPopulation` onto the niche row (likely a migration + populate at brainstorm/city-selection).
3. Implement `demand = clusterNational × (cityPop / usPop) × propensity` behind the resolver (used when DFS floors, in place of raw Claude mid — or blended with it as a cross-check).
4. Re-purpose `geoSharePrior` → `propensityMultiplier` (default 1.0) on `system_state`; update `/operator/control`.
5. Gate: only if Gate-A evidence shows Claude's estimate is systematically biased.

## Risks & mitigations

- **Claude estimate optimism / variance.** We have no ground truth, and Claude over-estimates some rows. Mitigation: it is still vastly better than a 450× inflation that also saturates the curve; Phase 2 + accumulated validations refine it. The drawer keeps all signals visible so bias is observable.
- **Scores change only on re-validation**, not for historical rows. Document that recalibration requires re-validating.
- **Future drift between the two paths.** Mitigated structurally by the shared `resolveDemandVolume` (the root cause was duplicated logic).

## Out of scope

- Measuring the full cluster geo-scoped (we proved every phrase floors locally — summing floors is noise, not signal).
- The Phase 3 items in [ADR 0010](adr/0010-niche-scoring-phase-3.md) (SERP authority, composite score) — unchanged and still gated.

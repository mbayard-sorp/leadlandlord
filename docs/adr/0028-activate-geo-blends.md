# ADR 0028: Activate geo blends and fix rankCities spatial-index bug

Date: 2026-07-06
Status: accepted
Supersedes ADR 0022 §1 (DEFAULT_GEO_COMP_BLEND/DEFAULT_GEO_DEMAND_BLEND = 0.0) and updates
ADR 0024 §1's statement that "DEFAULT_GEO_COMP_BLEND stays 0.0"
Refines ADR 0022 (niche-scout geographic targeting) and ADR 0024 (Stage 3 default-on and
winnability floor)

## Context

ADR 0022 shipped `DEFAULT_GEO_COMP_BLEND` and `DEFAULT_GEO_DEMAND_BLEND` at `0.0` deliberately,
so the metro-density competition dampener and the Census-derived demand-quality multiplier
would exist in code, be fully tested, and change nothing in production until an operator opted
in via `system_state.scout_geo_comp_blend` / `scout_geo_demand_blend`. ADR 0022 §1 called this
inert-by-default posture a deliberate calibration gate: "a non-zero default would require
calibration data we do not yet have." ADR 0024 §1 reaffirmed the `0.0` comp-blend default when
Stage 3 local-SERP refinement shipped enabled, reasoning that Stage 3 measures competition
directly for the top-25 cells and stacking a non-zero blend on the same cells would
double-charge the competition signal.

Both blends have now sat at `0.0` for three weeks with no calibration effort scheduled to turn
them on, while `packages/us-cities/src/city-ranker.ts`'s `computeCityMarketScores` — the
function `scout.ts` actually calls for Stage 1/2 — has always built its metro-density spatial
index over the unfiltered full city list, exactly as ADR 0022 §7 (consequences) and ADR 0022's
"Decisions for implementers" section for `computeCityMarketScores` specified. That function was
correct from the start.

The *other* entry point in the same file, `rankCities` (the offline/legacy curated ranker ADR
0022 explicicitly chose not to call from the scout, see ADR 0022 "Alternatives considered"), had
a real bug: it built its metro-density grid from the *states-filtered* city list rather than the
full unfiltered list, so a border city near a large out-of-state metro never received the metro
mass that should have dampened its `metroDensityMult`. ADR 0024 §"Context" flagged an
analogous-sounding bug at "city-ranker.ts line ~328" against `computeCityMarketScores`, but that
description was imprecise — the function `scout.ts` depends on has never had this defect; the
actual bug lived in `rankCities`'s grid-build call, which pre-filtered by `states` before handing
the city list to `buildGridBuckets`. Left alone, `rankCities` output (used by any tooling that
calls it directly, and as a spec reference for `computeCityMarketScores`'s own behavior) would
continue to under-dampen border cities.

With three weeks of stable Stage 1/2/3 output, the fully-tested-but-inert geo blends providing no
operator value, and a real (if narrowly-scoped) spatial-index bug sitting uncorrected in the
sibling function, this ADR closes both gaps together as part of the broader 2026-07-06
niche-algorithm-accuracy program.

## Decision

### 1 — Fix the `rankCities` spatial-index bug

`rankCities` now builds its `gridBuckets` spatial index over the full, unfiltered city list —
mirroring the pattern `computeCityMarketScores` already used correctly — and applies the
`states` filter only to the emitted candidate list, after per-city scoring. This is a pure bug
fix: it does not change `rankCities`'s public contract (`opts.states` still restricts which
cities are *returned*), only which cities contribute mass to the metro-density dampening grid
during scoring. Border cities near an out-of-state metro now receive correct dampening,
consistent with how `computeCityMarketScores` has always behaved.

### 2 — Activate both geo blends at 0.25

```ts
export const DEFAULT_GEO_COMP_BLEND = 0.25;   // was 0.0
export const DEFAULT_GEO_DEMAND_BLEND = 0.25; // was 0.0
```

Both signals — metro-density competition dampening and Census-derived demand quality — were
fully implemented, audited (`localRankMult`/`demandMult`/`metroDensityMult`/`demandQuality` on
`ScoutValue`/`ScoredCell` per ADR 0022 §2), and regression-tested at ship time. The only thing
blocking activation was calibration caution, not missing engineering. `0.25` is a conservative
middle value: at `α = 0.25`, a maximally dense metro (`metroDensityMult = 0.15`) only pulls
`localRankMult` to `0.7875` (a ~21% discount) rather than a full `0.15` (~85% discount) at
`α = 1.0`. Same shape for demand: a weak-demand city (`demandQuality = 0.2`) pulls `demandMult`
to `0.8`, a ~20% discount, not the full ~80% discount at `α = 1.0`. Both signals now measurably
perturb ranking without letting either one dominate the dollar-value estimate the way a full
weight would.

This does not touch the Stage 3 double-counting concern from ADR 0024 §1: Stage 3 only refines
the top 25 cells with a real measured local-SERP difficulty, replacing `refinementSource:
'proxy'` with `'local_serp'` for those cells specifically. The comp blend still runs as the
proxy-tier signal for every cell, including the 26+ cells Stage 3 never touches, and for the
top-25 cells the ADR 0022 formula already treats `metroDensityMult` as an audit-visible input
regardless of `refinementSource` — Stage 3 changes the *difficulty* (and therefore
`winnability`) measurement, not the geo-blend math, so there is no new double-count introduced
by moving the blend off zero.

## Alternatives considered

- **Leave both blends at 0.0 longer, pending dedicated calibration data** — rejected. There is no
  calibration effort scheduled or in flight for this specific pair of constants, and the
  parallel niche-prior-suggester / calibration-feedback-loop work (ADR 0027) is explicitly
  designed to observe *live* ranking behavior and suggest `system_state` adjustments — it cannot
  produce a signal on a permanently-inert code path. Turning the blends on at a conservative
  0.25 gives ADR 0027's suggester loop something real to observe and correct, rather than a
  no-op. If 0.25 proves wrong in either direction, ADR 0027's mechanism can push a
  `scout_geo_comp_blend` / `scout_geo_demand_blend` override through `system_state` with no code
  change or redeploy.
- **Full weight (α = 1.0) instead of 0.25** — rejected: at full weight a single weak Census
  signal (missing data defaulting to the mid-range subscore, see ADR 0022 §6) could swing
  `estMonthlyValueUsd` by up to ~85%, which is a much larger blind bet than the evidence
  supports. 0.25 lets both signals matter without letting a noisy or absent Census join dominate
  the ranking.
- **Fix `computeCityMarketScores` instead of / in addition to `rankCities`** — rejected as
  unnecessary: `computeCityMarketScores` already builds its grid over the unfiltered city list
  (ADR 0022 §7, "Decisions for implementers"); it has never had this defect. Only `rankCities`
  needed the fix.
- **Leave `rankCities` bug unfixed since the scout doesn't call it** — rejected: `rankCities` is
  still called by other tooling and is the spec reference other engineers read when reasoning
  about `computeCityMarketScores`'s correctness; an uncorrected, silently-wrong sibling function
  is a latent trap for the next person who wires something new through it.

## Consequences

- Existing `system_state` overrides (`scout_geo_comp_blend`, `scout_geo_demand_blend`) still take
  precedence over the new `0.25` code defaults — this ADR only changes what happens when an
  operator has never set either override (`NULL` in `system_state`). Any site that already has an
  explicit override in place is unaffected.
- **This ADR supersedes ADR 0024 §1's statement that "DEFAULT_GEO_COMP_BLEND stays 0.0."** That
  line was accurate as of 2026-06-17 and is now stale; this document is the record of why and
  when it changed. `DEFAULT_GEO_DEMAND_BLEND` moves off its ADR 0022 `0.0` default at the same
  time, for the same reason.
- Scout ranking will change on the next run for any operator who has not set an explicit
  `system_state` override — this is the intended effect, not a regression. The "Best geographies"
  report block (ADR 0022 §4) was already populated from Stage-1 data independent of the blends
  and is unaffected.
- `rankCities` callers (outside the scout) will see corrected, generally lower `metroDensityMult`
  values for border cities near large out-of-state metros; candidates far from any state border
  are unaffected since their nearest metro mass was already inside the states filter.
- Regression coverage confirmed present and passing before this ADR was written:
  - `packages/agents/src/niche-hunter/value-model.test.ts:242-357` — the
    `estimateScoutValue — geo modifiers (ADR 0022)` describe block. The test at line 263,
    "calibrated default (α=0.25, no explicit blend args): a real geo signal now perturbs the
    ADR 0021 value," exercises `DEFAULT_GEO_COMP_BLEND`/`DEFAULT_GEO_DEMAND_BLEND` directly at
    their new shipped `0.25` value with no explicit blend args passed, asserting
    `localRankMult ≈ 0.7875`, `demandMult ≈ 0.8`, and `estMonthlyValueUsd` below the pre-geo ADR
    0021 baseline. The original `α=0` bit-for-bit test (line 242) and the `α_comp>0`/`α_dem>0`
    explicit-override tests (lines 289, 306) still pass unchanged, since they pass explicit
    `compBlendStrength`/`demandBlendStrength` args rather than relying on the default.
  - `packages/agents/src/niche-hunter/scout.test.ts` — the mocked `getSystemState` fixtures at
    lines 48-49, 341-342, 362-363, 545-546, and 591-592 all set `scoutGeoCompBlend: null` /
    `scoutGeoDemandBlend: null`, meaning every one of those `runScout` integration tests exercises
    the real code default (now `0.25`) on the unset-override path, not a hardcoded `0.0` fixture
    value.
  - `packages/us-cities/src/city-ranker.test.ts:231` — "cross-state: a border city scored via
    states filter still gets metro dampening from an adjacent, non-scouted state" is the
    dedicated regression test for the `rankCities` spatial-index fix, asserting
    `border.metroDensityMult` reflects the adjacent-state metro (`0.4`, not `1.0`). Line 569,
    "grid index built over ALL cities: a large OUT-OF-BAND city suppresses a nearby IN-BAND city
    metroDensityMult," is the companion test already covering `computeCityMarketScores`'s
    (correct, pre-existing) behavior from ADR 0022.
- No migration required: `scout_geo_comp_blend` and `scout_geo_demand_blend`
  (`system_state`, migration 0045) already exist and are nullable; this ADR only changes the
  code-level fallback when they are `NULL`.

## Decisions for implementers

**packages/agents/src/niche-hunter/scoring-config.ts:** `DEFAULT_GEO_COMP_BLEND = 0.25` (was
`0.0`), `DEFAULT_GEO_DEMAND_BLEND = 0.25` (was `0.0`).

**packages/us-cities/src/city-ranker.ts (`rankCities`):** build `gridBuckets` from the full
unfiltered city list (same call shape `computeCityMarketScores` already uses); apply the
`states` filter only when producing the returned/ranked candidate list.

**Doc-drift already fixed earlier in this session** (value-model.ts comments, `ControlForms.tsx`,
`schema.ts` column comments, `_actions.ts`) — no further doc changes needed there; this ADR is
the missing decision record those files' updated comments were pointing at.

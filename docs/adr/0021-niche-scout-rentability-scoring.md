# ADR 0021: Niche-scout rentability scoring — hard floor + soft winnability

Date: 2026-06-13
Status: accepted
Refines ADR 0020 (deterministic scout/validate engine)

## Context

ADR 0020 replaced LLM brainstorm with a deterministic scout and introduced a dollar-denominated value model. A live run on 10 states (AZ TX UT CO KY VA MN TN MI WI) revealed two structural flaws in the scout path:

**Flaw 1 — no SEO-competition term in candidate ranking.** `keyword_difficulty` and `competition` are fetched from DataForSEO and stored, but the scout's sort key (`scoutScore = estMonthlyValueUsd * rentabilityPrior`) has no competition term. The "low competition so we can rank" half of the thesis is absent from the 500-candidate selection. Competition only enters during validation, which runs on the operator-picked ~50 — too late to shape the candidate pool.

**Flaw 2 — linear volume swamps ability-to-pay.** The current formula is:

```
estCityVolume = clusterVolume * (cityPop / US_POPULATION)   [linear, uncapped]
scoutScore    = estCityVolume * CTR * CALL_RATE * leadBenchmarkPrice * rentabilityPrior
```

A massage therapy practice (high search volume, ~$80/visit) outranks a roofer (lower volume, high lead price) in the same city. Per-job economics — the true predictor of whether a contractor will sustain a monthly lead fee — cannot overcome raw volume. The biggest metros sweep every state because the population share is linear: a 10x larger city scores 10x higher regardless of competition or ticket size.

Observed result: 12 distinct trades across 500 candidates; health trades alone = 57% of output; home services = 12%. Massage, hair salons, barbershops, nail salons, and auto AC repeated in the largest city of every state.

Additionally, legal and medical trades are fully missing from `TRADE_BENCHMARKS` in `lead-benchmarks.ts`. The default fallback is $45 / 0.50 prior. Any floor applied without first adding benchmarks for these trades will silently delete every lawyer and dentist candidate — a correctness trap that cannot be caught at runtime.

## Decision

### 1. Expand lead-benchmarks.ts before enabling the floor (correctness prerequisite — Phase B step 1)

Add `TRADE_BENCHMARKS` entries for all legal trades (personal injury, car/truck/motorcycle accident, workers comp, DUI, criminal defense, traffic, expungement, divorce, family law, child custody, estate planning, probate, wills/trusts, bankruptcy, immigration, employment, wrongful termination, real estate attorney, business attorney, medical malpractice, nursing home abuse, social security disability, landlord-tenant, mediation) with lead prices $150–$1,000+ and priors 0.85–0.95.

Add entries for all medical trades (dentistry including implants/ortho, oral surgery, endodontics, periodontics, chiropractor, physical therapy, occupational therapy, acupuncture, podiatry, dermatology, optometry, LASIK, audiology, urgent care, primary care, pediatrics, weight loss clinic, IV therapy, hormone therapy, mental health counseling, addiction treatment, veterinary) with lead prices $80–$500 and priors 0.80–0.92.

Add entries for every KEEP trade in health/pet/event/lifestyle that does not already have a match (med spa, fitness studios, high-end personal training, horse boarding, dog training, pet cremation, invisible fence, wedding photo/video, event planning, catering, limo, LED/lighting rental, interior decorating, restoration/reupholstery, home inspection, professional organizer, moving, art installation, holiday decor) so they survive the floor intentionally. This step gates all floor-related changes; the floor must not ship before it.

### 2. Hard floor on ability-to-pay — `passesAbilityToPayFloor(trade)` in value-model.ts

```ts
passesAbilityToPayFloor(trade) =>
  getLeadBenchmarkPrice(trade) >= MIN_LEAD_BENCHMARK_PRICE   // 50
  && getRentabilityPrior(trade) >= MIN_RENTABILITY_PRIOR     // 0.60
```

The default fallback pair ($45, 0.50) sits below both thresholds. Every mapped KEEP trade sits above both thresholds (lowest expected: tree service at $60 / 0.72). The gap between default and KEEP is deliberate — a new unmapped trade drops out rather than leaking through. Trades failing the floor are counted in a new `excluded_floor` counter in the scout report (alongside `excluded_denylist` / `excluded_existing`) and not entered into the scored grid. Thresholds are NULL-able `system_state` overrides (`scout_min_lead_price`, `scout_min_rentability_prior`) resolving exactly like the existing `scoutCtrAtRank`/`scoutCallRate` pattern — the operator can loosen the floor for an exploratory run without a deploy.

### 3. Soft winnability weight in `estimateScoutValue` — sqrt volume dampening

**`computeClusterDifficulty(candidates): number | null`** — volume-weighted average `kd` over the same intent set `computeClusterVolume` uses. Skip candidates where `kd <= 0` (DataForSEO returns `kd: 0` for missing data; conflating "unknown" with "easy" would recreate the structural flaw in a new dimension). Return `null` when no usable kd is present.

Updated `estimateScoutValue` formula:

```
clusterDifficulty  = computeClusterDifficulty(candidates)   // null = unknown
winnability        = clusterDifficulty != null
                       ? clamp((100 - clusterDifficulty) / 100, 0, 1)
                       : DEFAULT_BENCHMARK_WINNABILITY       // 0.5

cityVolume         = volumeBasis * sqrt(cityPop * POP_DAMPENING_REFERENCE) / US_POPULATION
                     where POP_DAMPENING_REFERENCE = 100_000

estMonthlyValueUsd = cityVolume * CTR * winnability * CALL_RATE * leadBenchmarkPrice
scoutScore         = estMonthlyValueUsd * rentabilityPrior
```

The sqrt formula is monotonic: a larger city still scores higher, but a 10x population advantage compresses to ~3.16x (sqrt of 10), not 10x. A city of exactly 100k is unchanged relative to the current linear formula (anchor point). Ranking order within any single city is preserved. `winnability` is added to the `ScoutValue` return type so it can be persisted and displayed.

`DEFAULT_BENCHMARK_WINNABILITY = 0.5` is deliberately conservative — an uncached trade must not receive an assumed-easy SERP that lets it leapfrog a trade with a measured-hard SERP.

### 4. Taxonomy prune — service-taxonomy.ts, trade lists only

All 9 category keys are retained (avoids the 4-file sync). Trade lists are pruned to eliminate personal-care and retail trades. The concrete KEEP/CUT list appears in the Phase A output and must be confirmed by the operator before deletion.

### 5. Persistence + transparency — migration 0044

Add to `niche_candidates`: `winnability numeric(4,3)`, `cluster_difficulty numeric(5,2)`. Persist from the scout chunked insert; carry on `ScoredCell` in scout-report.ts. Add `excluded_floor` to the report `grid` block. Surface both new columns plus existing `est_monthly_value_usd` in `/operator/niches`. Migration 0044 also adds two `system_state` rows for the floor overrides. Applied to prod manually via `pnpm db:migrate`.

### What does not change

The validate path (`estimateValidatedValue`) already incorporates `winnability` from a real SERP difficulty measurement; it is unchanged. The `niche-scout-runs` / `niche_candidates` schema outside the two new columns is unchanged. The `agent_events` bus, BaseAgent runtime, and seam boundaries defined in ADR 0020 are unchanged.

## Consequences

- Scout candidates will be dominated by high-ticket, low-competition trades. Personal-care/retail sweep of large metros is eliminated both by the floor (many fail the prior threshold) and by the winnability downrank (high-competition SERPs in any category score lower).
- Legal and medical trades, now benchmarked, will rank competitively alongside home services. A KEEP trade with an unmapped substring in lead-benchmarks.ts drops out on the floor until a benchmark is added — this is the intended behavior (a guard, not a silent pass).
- `DEFAULT_BENCHMARK_WINNABILITY = 0.5` means a cluster-backed hard trade (kd = 70, winnability = 0.30) can still lose to a benchmark_only trade at 0.5 if the ticket difference is large enough. This is acceptable — the operator can adjust the winnability default via a future `system_state` key if calibration data warrants it.
- Floor thresholds ($50 / 0.60) are a judgment call. They are operator-tunable via `system_state` without a deploy, so the first re-run can be loosened if results look too sparse.
- Taxonomy prune saves DataForSEO cluster-fetch cost on top of the floor's correctness effect. Cut trades are gone from keyword warming runs unless explicitly re-added.
- Migration 0044 adds 4 columns (2 on `niche_candidates`, 2 on `system_state`). If the operator wants minimal schema footprint, the `niche_candidates` columns can be dropped and winnability left in the report jsonb only; the `system_state` floor columns are still needed regardless.
- The existing scout run (id `4c56e7b4-6d5b-46c8-a310-5bf8130ca833`) should be cascade-deleted post-migration and before re-run. Clusters are cached; no new DataForSEO spend is needed for the re-run beyond the floor overrides and any new benchmark-warmed trades.

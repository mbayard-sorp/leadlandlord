# ADR 0029: Rentability scoring v2 — Places supply signal

Date: 2026-07-06
Status: accepted
Phase 4a/4b of the Niche Algorithm Accuracy plan; extends ADR 0009 (two-factor scoring) and
ADR 0021 (rentability hard floor + soft winnability). Phase 4c (Census/CBP business-count
cross-check) is explicitly deferred and not built by this ADR.

## Context

`computeRentabilityScore` (`packages/agents/src/niche-hunter/lead-benchmarks.ts`) is documented,
per ADR 0009 Phase 2 / C1, as a "v1 heuristic, tunable" formula: a contractor-count tent curve
(weight 0.50) plus CPC willingness-to-pay (0.25) plus a static lead-price benchmark (0.25). It
answers "is there a market, and does that market pay for leads" but has no signal for *how easy*
that market is to actually rent a site into. Two contractor counts of 10 are treated identically
whether all 10 already run polished websites or none of them do — yet the latter is a materially
easier sell for a build-and-rent product.

The `getContractorCount` Places integration (`packages/integrations/src/google-places/index.ts`)
already fetches the field mask needed to compute this (`websiteUri`, `rating`, `userRatingCount`
are already in `SEARCH_FIELD_MASK`) but discards everything except the array length before it
reaches the cache layer.

Unlike ADR 0010's SERP-authority work, which is explicitly evidence-gated (Phase 2/3 does not
start "without Gate-A evidence" — see ADR 0021's Phase 2 gate language, which is the same posture
ADR 0010 originated), `computeRentabilityScore` carries no such gate. ADR 0009 states the formula
is a "v1 heuristic, tunable" from day one and ADR 0021 only ever hardened the ability-to-pay floor
and cluster-difficulty winnability term — neither ADR conditions a rentability reweight on an
operator-evidence review cycle. This is a materially different subsystem: rentability scoring
selects among niches that already passed the floor, it does not gate whether a niche enters the
scored grid at all, and a bad reweight is fully reversible (recompute on next validate, no data
loss). A v2 reweight is therefore in scope without a new evidence-gate ADR.

## Decision

### 1. `getContractorSupply` — new Places integration function, new cache endpoint

`packages/integrations/src/google-places/index.ts` gains `getContractorSupply(args):
Promise<ContractorSupply>`, where:

```ts
interface ContractorSupply {
  count: number;
  withWebsite: number;
  withoutWebsite: number;
  avgRating: number;          // 0 when no result reports a rating
  medianReviewCount: number;  // 0 when no result reports a review count
}
```

It issues the identical Text Search call as the pre-existing `getContractorCount` (same field
mask, same $0.017 cost) and computes the four extra aggregates from the full result set instead
of discarding everything but the length.

**Cache endpoint is NEW, not reused.** The existing `getContractorCount` cache rows live under
endpoint `'places-contractor-count'` and store a bare `number`. `getContractorSupply` uses a
dedicated endpoint, `'places-contractor-supply'`, storing an object. Reusing the old endpoint key
would risk a cache hit deserializing a bare number where the caller expects `{count, withWebsite,
...}` — a runtime shape mismatch with no type safety at the jsonb boundary
(`withDataForSeoCache<T>` trusts the caller's `T`). The old cache rows are left alone and expire on
their existing 30-day TTL; no migration or backfill of the cache table is needed.

`getContractorCount` becomes a thin wrapper: `(await getContractorSupply(args)).count`. Existing
callers of `getContractorCount` that only need the scalar are unaffected.

### 2. `computeRentabilityScore` v2 — explicit branch, not algebraic collapse

Two new optional inputs: `contractors_without_website?: number`, `median_review_count?: number`.

**The v1 formula is preserved as a literal branch, not derived via a "neutral default" 4th term.**
A straight reweight cannot make the old and new weight sets coincide for any default value of the
new term: v1 is `0.50 / 0.25 / 0.25` (supply / cpc / leadPrice); v2 redistributes to
`0.45 / 0.15 / 0.20 / 0.20` (supply / weakness / cpc / leadPrice). Every one of the three original
weights changed, so there is no value the 4th term could take that reproduces the v1 output — the
two formulas are simply different functions. (This is the same mathematical trap called out in the
task brief and confirmed in review before implementation.)

```ts
if (contractors_without_website === undefined && median_review_count === undefined) {
  // v1, byte-identical
  return supplySub * 0.50 + cpcSub * 0.25 + leadPriceSub * 0.25;   // (* 100, clamped)
}
// v2
return supplySub * 0.45 + weaknessSub * 0.15 + cpcSub * 0.20 + leadPriceSub * 0.20;  // (* 100, clamped)
```

`weaknessSub` is derived from `contractors_without_website / contractor_count` (share of the
market with no existing website — a HIGHER share means an EASIER rent, so it raises the score).
`median_review_count`, when also present, refines `weaknessSub` further: a low median (thin social
proof) reinforces the weakness signal; a healthy median (>=50) tapers the refinement to zero. See
the doc comment on `computeRentabilityScore` in `lead-benchmarks.ts` for the exact formula.

The branch condition checks BOTH new inputs for `undefined` (not just one) so that legacy call
sites — anything constructing a `RentabilityScoreInputs` without touching the two new optional
fields — get v1 with zero code change and zero output drift.

### 3. Wiring — `validate.ts` + migration 0057

`validateNicheCore` (`packages/agents/src/niche-hunter/validate.ts`) now calls
`getContractorSupply` instead of `getContractorCount` and passes `withoutWebsite` /
`medianReviewCount` into `computeRentabilityScore`. Two new nullable `niches` columns persist the
raw supply signal for display/audit, independent of the derived score:

- `contractors_without_website integer`
- `contractor_median_reviews integer`

Migration `0057_rentability_supply_signal.sql`. Additive, `IF NOT EXISTS`, nullable — existing rows
are untouched until the operator re-validates, at which point `computeRentabilityScore` naturally
picks up the v2 branch because the new fields are now populated.

## Alternatives considered

**Reuse the `places-contractor-count` cache endpoint and just change the stored shape.** Rejected
per the CRITICAL requirement in the task brief: an in-flight 30-day-TTL cache row already holds a
bare `number` for that key; a code deploy that starts writing/reading an object under the same key
risks a stale hit returning a number where the caller destructures `{count, withWebsite, ...}`,
producing `undefined` field access rather than a type error (jsonb round-trips untyped). A
dedicated endpoint string is a two-line cost (a few redundant cache warms during the 30-day
overlap) for a correctness guarantee.

**Collapse v1 into v2 via a neutral-default reweight.** Rejected — mathematically impossible, see
Decision §2. Explored briefly during planning and rejected before implementation began, per the
task brief's review note.

**Gate this behind a Phase-2-style evidence review, mirroring ADR 0010's SERP-authority gate.**
Considered and rejected: ADR 0010's gate exists because that subsystem changes *which niches enter
the scored grid at all* (a floor), and a wrong call there permanently loses candidates before any
operator sees them. `computeRentabilityScore` only re-ranks niches that already passed the ADR
0021 ability-to-pay floor and is fully recomputed (not cached) on every validate — a miscalibrated
v2 weight is corrected by the next validate run with no candidate loss. ADR 0009's own framing
("v1 heuristic, tunable") already anticipated iteration without a formal gate.

**Compute `withoutWebsite`/`avgRating`/`medianReviewCount` in `validate.ts` from the existing
`searchText` results directly, skipping a new integration function.** Rejected — `validate.ts`
does not currently see the raw `Place[]` array (only the pre-existing `getContractorCount` scalar
via the cache), and duplicating the aggregation logic outside the integration boundary would put
Places-shape knowledge in the agents package, violating the existing `packages/integrations`
boundary that other Places consumers (`searchLeads`, `sortLeadPlaces`) already respect.

## Consequences

- New Places cache rows accumulate under `'places-contractor-supply'` at the same $0.017/cold-miss
  cost as before (no incremental Places spend — same call, richer parsing). Old
  `'places-contractor-count'` rows go cold over their existing TTL and are never written again.
- `niches.contractor_count` / `niches.rentability_score` continue to mean what they meant before
  for any row that has not been re-validated since this deploy (byte-identical formula, confirmed
  by a `toBe` regression test in `lead-benchmarks.test.ts`).
- Re-validating a niche now writes `contractors_without_website` and `contractor_median_reviews`
  and the rentability score for that row will reflect the new weights going forward. There is no
  backfill; historical rows keep v1 scores until touched again — this is intentional and matches
  the existing pattern for every other additive rentability column (`contractor_count`,
  `rentability_score` themselves were introduced the same way in ADR 0009 Phase 2).
- `RentabilityScoreInputs` gains two optional fields; any code outside this repo's control
  (there is none — the type is not exported from a public package boundary beyond
  `@leadlandlord/agents`) constructing this type literally is unaffected as long as it does not set
  the new fields.
- Phase 4c (Census/CBP county business-pattern cross-check against Places counts) is explicitly
  deferred. Nothing in this ADR precludes it; a future ADR would add a third supply source and
  reconcile it against the Places-derived count, likely as a plausibility check rather than a
  scoring input, given Census data lags by 1-2 years vs Places' live snapshot.

## Reconciliation with ADR 0009 and ADR 0021

**ADR 0009** introduced `computeRentabilityScore` as Phase 2 / C1 and explicitly labeled it "v1
heuristic, tunable." This ADR is the first tuning pass anticipated by that framing. ADR 0009's
Phase 2 schema consequence ("`contractor_count integer`, `rentability_score numeric(6,2)` in
`niches`. Hand-written migration required.") is extended, not superseded, by the two new nullable
columns in migration 0057 — same additive posture, same hand-written-migration discipline.

**ADR 0021** hardened `passesAbilityToPayFloor` (a hard gate on `lead_benchmark_price` and
`rentability_prior`, unrelated to `computeRentabilityScore`) and added the sqrt-dampened,
winnability-weighted `estimateScoutValue`/`estimateValidatedValue` dollar model, which *consumes*
`rentabilityScore` as an input (`estimateValidatedValue({ ..., rentabilityScore })`) but does not
define how that score is computed. This ADR does not touch `passesAbilityToPayFloor` or the
value-model's consumption contract — `rentabilityScore` remains a `0..100` number regardless of
which internal formula (v1 or v2) produced it, so `estimateValidatedValue` and every downstream
consumer are unaffected.

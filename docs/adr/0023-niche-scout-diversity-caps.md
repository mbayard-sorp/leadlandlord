# ADR 0023: Niche-scout diversity caps — per-trade + per-category

Date: 2026-06-14
Status: accepted
Refines ADR 0021 (rentability-aware scout scoring)

## Context

ADR 0021 set out to diversify scout output — the prior run was swept by
health/personal-care trades (massage, salons, barbershops) repeating across the
biggest metro of every state. ADR 0021 retuned the **value formula** (added an
ability-to-pay floor, sqrt population dampening, and a winnability term) and
added benchmarks for legal and medical trades that were previously missing.

The first run under ADR 0021 produced the opposite failure: **every persisted
candidate was a lawyer/attorney.** The retune killed the health sweep and
installed a legal one.

Root cause: ADR 0021 never added a diversity *mechanism*. The scout still ranks
the full trade×city grid by a single dollar score and keeps the top N with no
per-trade or per-category constraint. The only trade-specific multipliers in the
score are `leadBenchmarkPrice × rentabilityPrior`. ADR 0021 added legal trades
with the **highest ticket prices in the entire taxonomy**:

| Trade | lead price (mid) | prior | value / unit volume |
|---|---|---|---|
| Personal injury lawyer | $650 | 0.92 | **598** |
| Car accident lawyer | $575 | 0.92 | 529 |
| Roofer | $115 | 0.90 | 104 |
| Plumber | $75 | 0.78 | 58 |
| Tree service | $60 | 0.72 | 43 |

Per unit of search volume a PI lawyer scores ~6× a roofer and ~10× a plumber —
the ticket-price gap dwarfs any volume difference between trades. With 28 legal
trades each scored across hundreds of cities, every legal×city cell outranked
every home-services cell, and 28 × hundreds ≫ the 500-candidate cut. The
ability-to-pay floor (`≥$50`, `≥0.60`) does not touch legal (it clears trivially)
and the report's `category_concentration` is informational only — nothing
constrains ranking by it.

A pure value ranking will *always* be swept by whichever single trade has the
top `leadPrice × prior`. Diversity must be enforced in **selection**, not retuned
in the value formula.

## Decision

Add two diversity caps to the scout's top-N selection (`selectDiversified` in
`selection.ts`). The value ranking is unchanged — higher-score cells are still
considered first — but a single trade or category can no longer monopolize the
persisted set.

### 1. Per-trade cap — `SCOUT_MAX_PER_TRADE = 8`

A single trade may contribute at most 8 cities to the persisted set. Caps
"personal injury lawyer in 200 cities" down to a handful so other trades surface.

### 2. Per-category cap — `SCOUT_MAX_CATEGORY_SHARE = 0.30`

A single category may occupy at most 30% of the persisted set, resolved to an
absolute count against `persist_top` at selection time (e.g. 150 of 500). With 9
categories this lets the strongest category take up to ~a third while leaving
room for the rest. **Disabled when the run is already scoped to one category**
(`category_filter` set) — capping there would starve an intentional request.

### 3. Backfill guard

`selectDiversified` walks the score-desc grid greedily, admitting a cell only
while its trade and category are both below their caps. If the caps leave the set
short of `persist_top` (too few distinct trades/categories clear the floor),
capped-out cells are admitted in score-desc order until the target is reached. A
tight cap therefore never persists *fewer* candidates than an uncapped run would
— it only reorders which cells fall inside the cut. The report records
`excluded_diversity_cap` (cells the caps held back that were NOT backfilled — the
true diversity effect) plus the two cap values applied.

### 4. Operator-tunable knobs — migration 0046

Both caps are NULL-able `system_state` overrides (`scout_max_per_trade`,
`scout_max_category_share`) resolving exactly like the ADR 0021 floor knobs:
NULL = use the code defaults. The operator can tighten or loosen diversity for an
exploratory run without a deploy.

## What does not change

The value model (`estimateScoutValue`), the ability-to-pay floor, sqrt
population dampening, and the winnability term from ADR 0021 are all unchanged —
the caps sit *after* scoring, on selection only. The validate path, the
`niche_candidates` schema, and the agent runtime are untouched.

## Consequences

- Scout output spans many trades and categories. Legal still appears (it is
  genuinely high-value), but is bounded to ≤30% of the set rather than 100%.
- Caps are a judgment call. `8` per trade and `0.30` per category are tunable via
  `system_state` without a deploy; the first re-run can be tightened if legal
  still feels over-represented, or loosened if results look too thin.
- The caps operate on the *persisted* set, so the report's value-curve,
  recommendation, and `category_concentration` insights now reflect the
  diversified candidates the operator actually picks from.
- The existing ADR-0021 scout run should be re-run after migration 0046; no new
  DataForSEO spend is needed (clusters are cached).

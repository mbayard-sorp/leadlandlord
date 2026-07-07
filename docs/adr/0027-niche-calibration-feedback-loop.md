# ADR 0027: Niche calibration feedback loop

Date: 2026-07-06
Status: accepted
Phase 2 of the Niche Algorithm Accuracy plan; builds on ADR 0020 (scout/validate engine) and
ADR 0021 (rentability scoring)

## Context

The niche-selection scout/validate engine (`packages/agents/src/niche-hunter/`) predicts
monthly lead value per trade+city niche using hardcoded constants: `CTR_AT_RANK` (0.20),
`CALL_RATE` (0.10), and per-trade lead-price/rentability priors in `lead-benchmarks.ts`. Per that
file's own doc comment, these priors "are NOT derived from live data. They represent market
intuition seeded from industry lead-cost benchmarks and will be revised once we have 30+ operator
validation cycles." Nothing in the codebase ever closed that loop — predictions are written once
(`niches.est_monthly_value_usd`, `niches.validated_monthly_value_usd`) and never compared to what
actually happened once a site went live.

Two data sources already exist that make this comparison possible without any new external
integration:

- `seo_metrics_daily` (populated daily by `seo-ingest-gsc`) — per-site/per-query GSC position,
  impressions, clicks.
- `portfolio_snapshots` (populated daily by `portfolio-analyst`) — per-site calls, leads, MRR,
  tenant counts.

## Decision

### 1 — A new GSC-only snapshot table, joined to portfolio_snapshots at read time

`niche_outcome_snapshots` (migration 0056) stores one row per (site, ISO week): weighted-avg GSC
position for "money keywords" vs. the overall query set, impressions/clicks for both, and derived
`observed_ctr` / `observed_call_rate`. It deliberately does **not** duplicate `calls_count`,
`leads_count`, `mrr_usd`, or `tenants_active_count` — those columns already exist on
`portfolio_snapshots`, written daily by an agent that already owns that concern. Duplicating them
here would create a second source of truth that drifts the moment portfolio-analyst's calculation
changes. Every read path (operator UI, the prior-suggester) joins the two tables by
`(site_id, date)` range instead.

`observed_call_rate` is computed as `calls_in_week / money_kw_clicks`, where `calls_in_week` comes
from summing `portfolio_snapshots.calls_count` over the same 7-day window — a join at write time,
performed once by the calibrator, not a stored duplicate.

Money-keyword rows are identified via `matchesTradeQuery(query, niche)` — a new function in
`lead-benchmarks.ts` that reuses the existing longest-substring trade matcher
(`findBestBenchmarkMatch`, refactored out of `getRentabilityPrior`/`getLeadBenchmarkPrice` without
duplicating `TRADE_BENCHMARKS`) plus a token-overlap fallback for multi-word GSC queries like
"roof repair phoenix az" that don't substring-match a keyword directly.

Position values use **impression-weighted averaging**, not a simple mean — a #2 ranking on a
1,000-impression query should outweigh a #40 ranking on a one-impression long-tail query. A row
with zero usable impressions contributes nothing to the average; an empty result set yields `null`
positions, never `0` (which would misread as "ranked #0").

**Guard against the lying-zero trap.** `observed_ctr` and `observed_call_rate` are `null` (not `0`)
when their denominator is zero — a site with zero money-keyword impressions this week has *no
data*, which is a materially different fact from "0% CTR." Every consumer (the suggester, the
operator UI) must treat `null` as "insufficient sample," never coerce it to zero.

### 2 — Suggestions are scoped, and only `global` can be applied automatically

`calibration_suggestions` (same migration) stores pooled, shrinkage-adjusted suggestions for the
scout's two static knobs (`scout_ctr_at_rank`, `scout_call_rate`) at three scopes:

- `global` — pooled across every trade, directly comparable to (and applicable to) the single
  `system_state.scout_ctr_at_rank` / `scout_call_rate` knob the scout actually reads.
- `trade` — pooled by canonical trade (the matched `TRADE_BENCHMARKS` entry's first keyword).
- `trade_state` — pooled by trade + state.

Pooling sums clicks/impressions/calls across snapshots and computes one ratio from the sums — never
an average of per-week ratios, which would let a one-click week and a thousand-click week count
equally. A shrinkage estimate `(n/(n+K))·observed + (K/(n+K))·currentPrior` (K=5) pulls small
samples toward the current prior so a single noisy week can't swing a suggestion.

**Trade and trade_state suggestions are always computed whenever their sample-size floor is met
(N≥5 for trade, N≥3 for trade_state) — even though neither can be applied to a global knob.** They
are informational, meant to guide a human hand-tuning the matching `TRADE_BENCHMARKS` entry (e.g.
"roofing's observed call rate across 40 sites is 6%, not the neutral 10% global prior — consider a
roofing-specific adjustment"). The system has no per-trade knob to write them to; `TRADE_BENCHMARKS`
is static code, and turning it into a live-tunable per-trade table is out of scope for this phase.

**The Apply action is gated at scope='global' only, enforced server-side.** The operator UI
(`SuggestionsPanel.tsx`) only renders an Apply button for `scope='global'` rows — trade/trade_state
rows get a Dismiss-only action with an explanatory note. But the actual boundary is
`applyCalibrationSuggestion` in `actions.ts`, which re-checks `row.scope === 'global'` itself before
writing to `system_state` and returns an error otherwise. The UI gate is a courtesy; a client that
somehow called the action directly with a trade-scoped id would still be rejected server-side. This
matters because a trade-scoped number silently overwriting the global knob would be wrong in a way
that's easy to miss — every OTHER trade would suddenly be scored against a prior calibrated for one
trade.

A partial unique index on `(scope, trade, state, knob) WHERE status = 'open'` keeps exactly one open
suggestion per tuple; the suggester marks the prior open row `superseded` before inserting a fresh
one each week, so re-running never produces duplicate open suggestions for the same tuple.

### 3 — Cadence: calibrator Monday, suggester Tuesday

`niche-calibrator` runs weekly per-site (mirroring `seo-ingest-gsc`'s per-site event shape, dedupe
key `niche-calibrator:<siteId>:<weekStart>`), Monday 09:00 UTC, targeting the most recently
*completed* ISO week — giving GSC's usual 1-3 day ingestion lag time to settle before the week is
aggregated. `niche-prior-suggester` runs the following day, Tuesday 09:00 UTC, as a single event
that pools across all sites/weeks in-process (mirroring `portfolio-analyst`'s single-invocation
shape) — the one-day gap guarantees a full week of fresh snapshots exists before pooling.

Both agents are pure DB aggregation with zero LLM/API calls (`AGENT_REQUIRED_ENV: []`), so they
carry a $1/day cap purely as a safety backstop, not because they're expected to spend anything.

### 4 — sites.current_rank updates from measured data

The calibrator updates `sites.current_rank` from the week's money-keyword position (falling back to
the overall position when no money-keyword rows matched), rounded to the nearest integer to match
the existing `integer` column. This is the first time `current_rank` reflects a real measurement
rather than being left null/stale.

## Alternatives considered

- **Store calls/leads/MRR directly on `niche_outcome_snapshots`.** Rejected — `portfolio-analyst`
  already owns that computation (including edge cases like tenant churn mid-day); duplicating it
  here would drift the moment either agent's logic changes independently.
- **Let any suggestion scope apply directly, with per-trade override columns on `system_state`.**
  Rejected for this phase — `system_state` is a singleton row; a per-trade knob table is a real
  schema addition (one row per trade × knob) that deserves its own design pass once we have
  evidence the pooled trade-scope suggestions are directionally trustworthy. Writing trade-scoped
  suggestions now, informational-only, gets the data flowing without pre-committing to that schema.
- **A single combined agent instead of calibrator + suggester.** Rejected to preserve the
  established pattern of narrow, single-purpose agents with independent budgets/schedules (see
  `seo-ingest-gsc` → `seo-operator`, `local-content-scout` → `local-content-writer`) — the
  calibrator's job (aggregate one site-week) and the suggester's job (pool across all history) have
  different natural cadences and failure modes.
- **A plain average-of-ratios for pooling.** Rejected — sums-then-divide (pooled ratios) is the only
  form that doesn't overweight low-volume weeks; this is the same reasoning `computeClusterVolume`
  already applies to search-volume aggregation elsewhere in the niche-hunter package.

## Consequences

- Operators can see prediction-vs-reality per niche (`CalibrationDrawer`'s new Outcomes section,
  up to 8 weeks) and per-column actuals (rank/CTR/calls/MRR) on the main niches table, without
  waiting for a Phase 3 automation pass.
- The global CTR/call-rate priors can now be nudged from real data via a single reviewed click,
  closing the loop `lead-benchmarks.ts` predicted "once we have 30+ operator validation cycles."
- `TRADE_BENCHMARKS` per-trade priors remain hand-tuned, but the trade/trade_state suggestions give
  a concrete, data-backed starting point instead of pure market intuition.
- New weekly cron load: 2 more scheduler entries, both cheap (DB-only aggregation, no external
  API calls) — no material addition to the fleet's spend surface.

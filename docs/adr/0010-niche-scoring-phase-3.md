# ADR 0010: Niche Scoring Phase 3 — SERP Authority Signal & Score Composition

Date: 2026-05-19

Supersedes the "future Phase 3 ADR" placeholder in [ADR 0009](0009-niche-scoring-two-factor.md) (Consequences → "Score column stability" and Alternatives → "Use DataForSEO backlinks for SERP competition"). Does not change any Phase 1 or Phase 2 behavior.

## Context

ADR 0009 shipped a two-factor model: SEO winnability (`computeScore`) and rentability (`computeRentabilityScore`), kept as two separate, independently-visible columns. It deferred two questions to "a future Phase 3 ADR" and refused to answer them until evidence existed:

1. **SERP competition is currently a cheap heuristic.** Difficulty is inferred from aggregator share of the first page (`getSerpComposition`) plus paid-ad presence. No referring-domain / domain-authority data feeds the score. ADR 0009 listed backlinks/DA as "Never (revisit only with explicit revenue evidence the SERP-difficulty signal is saturated)."
2. **Score composition is deliberately two-column.** `score` (SEO) and `rentability_score` are shown side by side; there is no single ranked number. ADR 0009 rejected an immediate composite "operators need calibration intuition before weighting decisions are made."

Both questions were explicitly **gated on Gate A evidence**: ≥30 real operator validations across varied niches/cities, reviewed for whether the cheap signals mislead. As of this ADR, **Gate A evidence has not been gathered** (see [HANDOFF-NICHE-SCORING-CALIBRATION.md](../HANDOFF-NICHE-SCORING-CALIBRATION.md)). This ADR therefore exists to *frame the decisions and their trigger conditions*, not to authorize building either feature today.

### What the codebase already has (so Phase 3 doesn't reinvent it)

- `packages/integrations/src/dataforseo/backlinks.ts` exists but is a **prospecting** tool: `domain_intersection` / `competitors` / `referring_domains` for guest-post link mining (network-linker / backlink-copycat workstream). It is **not** a SERP-difficulty signal and must not be conflated with one. It does, however, document a `/v3/backlinks/bulk_ranks/live` endpoint and the DFS rank scale (0–1000 log-scale, ~100=DR10, ~300=DR30) — that endpoint is the natural primitive for a SERP-authority signal.
- The validate path (`apps/operator/app/operator/niches/actions.ts`) already fetches and caches the first-page SERP composition. The ranking domains are therefore already in hand at validate time; a Phase 3 authority signal would add a `bulk_ranks` lookup over those domains, not a new SERP fetch.

## Decision

### Decision 1 — SERP authority signal (DR / referring domains of ranking pages)

**Standing answer: NOT YET.** Phase 3 does not build this until BOTH triggers fire:

- **(T1) Evidence trigger.** Gate A's ≥30 validations show a material, recurring miss attributable to SERP difficulty — i.e. niches the cheap aggregator-share + ad-count heuristic rated winnable that turned out to be dominated by high-authority domains (or vice versa). A subjective "would be nice" is insufficient; the calibration note must point to specific mis-ranked rows.
- **(T2) Revenue trigger.** There is concrete revenue evidence the mis-ranking cost a launch decision — a wave site that under-ranked because we picked a niche the cheap signal mis-scored, or operator time wasted validating dead-end niches the cheap signal greenlit.

When (and only when) both fire, the sanctioned design is:

- **Reuse the SERP domains already fetched** in `validateNiche`. Take the top N organic results (N≈10), dedupe to registrable domains, and call `/v3/backlinks/bulk_ranks/live` **once per validation** (batch, not per-domain). Cache aggressively (the authority of the domains ranking for a niche is stable over weeks — 30-day cache minimum, keyed on the sorted domain set).
- Derive an authority sub-signal (e.g. median DFS rank of the top-N, or share of top-N above a rank floor) and feed it into `computeScore` as a **small additive weight** (≤0.10), omit-when-absent, exactly like the Phase 1 `avg_cpc` / `rentability_prior` inputs. Existing rows score identically until re-validated. **Never** let it silently rescore historical rows.
- Operator-gated, inside Validate, same as every other paid call. No brainstorm-time firing.

**Cost ceiling that must be respected:** ADR 0009 estimated $0.375–$0.75/validation for naive per-domain DA lookups — a 10× jump over current ~$0.09 DFS + ~$0.017 Places spend. The `bulk_ranks` batch-once-per-validation design above is the cost-control mechanism; if implementation finds bulk pricing still pushes per-validation cost above ~$0.15, **stop and re-decide** rather than shipping it.

### Decision 2 — Score composition (single composite vs two-column)

**Standing answer: KEEP TWO COLUMNS for now.** ADR 0009's reasoning still holds and Gate A has not yet produced the intuition that would justify a weighting. Collapse to a composite only when:

- **(T3) Operator-intuition trigger.** After Gate A, the operator can articulate a *stable* relative weighting between SEO winnability and rentability (e.g. "rentability matters ~2× SEO for our wave picks") that has held across the validated set — not a guess, an observed preference.

When T3 fires, the sanctioned design is:

- Introduce a **derived, additive composite as a NEW column** (`composite_score`), computed from the existing `score` and `rentability_score` with an **operator-tunable weight** stored on `system_state` (consistent with the Task B runtime-priors pattern: NULL = default, edited from `/operator/control`, applies to future validations only). Default sort on `/operator/niches` may switch to `composite_score`.
- **Do NOT mutate or overload the existing `score` column.** `score` remains SEO-winnability-only forever; the composite is additive and reversible. This preserves all calibration history and lets operators toggle back to the two-column view.
- This is a UI/ranking change plus one schema column and one `system_state` weight — no new external API calls, so it is **cheap and independently shippable** from Decision 1. The two decisions are not coupled; T3 can fire long before (or without) T1+T2.

### Never (carried forward from ADR 0009, reaffirmed)

- LSA scraping — `ad_count` remains the willingness-to-pay proxy.
- Per-domain (non-batch) DA lookups at validate time.
- Auto-triggering any paid call (backlinks, candidates, Places) at brainstorm time.
- Overloading `score` with rentability or authority — additive columns only.

## Alternatives Considered

**Build the authority signal now, ahead of Gate A.** Rejected. It is the single most expensive call in the system and ADR 0009 explicitly forbade it without saturation evidence. Building scoring surface ahead of evidence is the exact anti-pattern Task B's deferred extensions warned against ("exposing knobs on an unvalidated shape invites noise").

**Reuse `backlinks.ts` `domain_intersection` for SERP difficulty.** Rejected. That endpoint answers "who links to my competitors but not me" (prospecting), not "how authoritative are the domains ranking for this niche." Wrong primitive; `bulk_ranks` over the already-fetched SERP domains is correct.

**Collapse to a single composite immediately with a hardcoded weight.** Rejected for the same reason ADR 0009 rejected it: a hardcoded weight before operator intuition exists is a guess that destroys the two-column calibration signal. The additive-column-with-runtime-weight design defers the weight to the operator and keeps it reversible.

**Per-validation DA cost absorbed as "cost of good data."** Rejected as a blanket position. The hard operator constraint (do not blow up the DFS/Places API with low-value calls) governs. Cost is acceptable only when T1+T2 prove the signal changes decisions, and only via the batch-once design under the ~$0.15/validation ceiling.

## Consequences

- **No code changes from this ADR.** It records standing answers ("not yet" / "keep two columns") and the precise triggers that would reopen each. Until a trigger fires, niche-hunter scoring is frozen at the ADR 0009 Phase 1+2 shape.
- **Decision 2 is unblocked first.** T3 (operator intuition from Gate A) is the cheapest, lowest-risk trigger and requires no new spend. Expect it to fire before Decision 1, if either does.
- **Decision 1 schema, when triggered:** likely one nullable column on `niches` (authority sub-signal cache) — hand-written migration per the repo's migration discipline.
- **Decision 2 schema, when triggered:** one nullable `composite_score` column on `niches` + one nullable weight column on `system_state` — hand-written migration.
- **Reopening protocol:** when a trigger fires, amend this ADR (or write 0011) citing the specific Gate A rows / revenue evidence that fired it, then implement. Do not implement on a verbal "let's just do it."
- **Agent ownership:** `next-engineer` owns Decision 2 implementation (UI + scoring + migration). Decision 1 additionally touches `packages/integrations` (the `bulk_ranks` call) and must respect the throttle + cache discipline.

## References

- [ADR 0009](0009-niche-scoring-two-factor.md) — two-factor model this extends.
- [HANDOFF-NICHE-SCORING-CALIBRATION.md](../HANDOFF-NICHE-SCORING-CALIBRATION.md) — Gate A evidence plan (the prerequisite for both triggers).
- `packages/integrations/src/dataforseo/backlinks.ts` — existing prospecting tool + `bulk_ranks` endpoint + DFS rank scale.
- `apps/operator/app/operator/niches/actions.ts` — validate path (where SERP domains are already fetched).
- `apps/operator/app/operator/control/_actions.ts` (`updateScoringPriors`) — runtime-prior pattern Decision 2's composite weight should follow.

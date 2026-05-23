# Handoff: Niche-Hunter Service Taxonomy — Scope Broadening

Owner of record: niche-hunter workstream. Related: [docs/HANDOFF-NICHE-SCORING.md](HANDOFF-NICHE-SCORING.md) (scoring/validation, ADR 0009).

This doc covers what is SHIPPED on branch `claude/serene-satoshi-00b749`, the open decisions, and the concrete remaining work. It is self-contained: a cold session should be able to pick up from here.

## TL;DR

- **Problem:** the niche-hunter brainstorm invented niches *cold*, so it kept returning the same saturated home-services tropes (roofing, HVAC, tree removal) that dominate the model's training data. Scope felt too narrow — risk of missing profitable, low-competition niches.
- **Fix shipped (Phases 1-2):** a curated **342-trade service taxonomy** is now injected into the brainstorm prompt, and the brainstorm is directed to favor trades **winnable to Google page 1** (low competition, small-operator dominated). The operator can now pick which categories to hunt via a form selector (previously hardcoded to `home_services`).
- **Commits:** `fad84ef` (taxonomy + prompt, packages/agents) and `e923043` (operator category selector). Both typecheck-clean. **Not yet PR'd / merged.**
- **What remains:** an optional DB migration to persist `category` (enables dashboard filtering + coverage-weighted rotation), taxonomy curation over time, and validating that output is actually more diverse in practice.

## Hard constraints (carry forward)

- **The taxonomy is brainstorm-time only — it costs no external API.** It is injected into the Claude system block, nothing more. Do NOT wire it into per-candidate DataForSEO calls. The "don't blow up DataForSEO with useless calls" rule from the scoring handoff still governs all live data — paid SERP/Places/keyword work stays operator-gated inside `validateNiche`.
- **Category keys are a sync point.** `SERVICE_TAXONOMY` keys in `packages/agents/src/niche-hunter/service-taxonomy.ts` MUST match the `CategoryEnum` in `packages/agents/src/niche-hunter/index.ts` and the 7 literals mirrored in `apps/operator/app/operator/niches/actions.ts` + `RunForm.tsx`. If you add/rename a category, update all four.
- **No licensing-gated trades.** The taxonomy deliberately excludes medical/legal and anything needing a license the platform can't verify. The `health` bucket is non-clinical only (training, massage, salons, med/facial spas). Keep it that way when curating.

## Current state (what is in place)

**Taxonomy** — `packages/agents/src/niche-hunter/service-taxonomy.ts` (new, commit `fad84ef`):
- `export const SERVICE_TAXONOMY: Record<ServiceCategory, string[]>` + exported `ServiceCategory` union.
- 342 trades, no dupes. Per-category: home_services 161, professional 35, auto 34, health 31, lifestyle 30, event 29, pet 22. Weighted to home/property (the contractor-tenant core market).
- Trades are lowercase, specific, local-SEO-friendly (e.g. "epoxy garage flooring", "mobile car detailing", "dog waste removal").

**Brainstorm wiring** — `packages/agents/src/niche-hunter/index.ts` (commit `fad84ef`):
- `buildTaxonomySlice(allowed: ServiceCategory[])` (~line 777) renders only the categories in `input.allowed_categories`, grouped by category. Empty/unknown → falls back to the full taxonomy.
- The slice is injected as a **second cached system block** (`cache_control: { type: 'ephemeral' }`, ~line 508), after the unchanged `SYSTEM_PROMPT`. The cache breakpoint sits on the last block, covering both.
- `SYSTEM_PROMPT` (~line 227) gained the directive: consider the list, prefer trades winnable to page 1, spread across categories, don't over-index on roofing/HVAC/tree removal, may propose adjacent net-new trades. The existing `confidence_score` / search-volume-estimate instructions are untouched.
- Tool schema, `scoreCandidate`, scoring, persistence, and the `brainstorm_count` → `target_count` funnel are unchanged.

**Operator control** — `apps/operator/app/operator/niches/` (commit `e923043`):
- `RunForm.tsx`: 7 uncontrolled checkboxes, `name="allowed_categories"`, all `defaultChecked`. Submitted via the existing `FormData`.
- `actions.ts` `runNicheHunter` (~line 86): reads `formData.getAll('allowed_categories')`, filters to the 7 valid literals, falls back to all 7 if empty. Replaces the old hardcoded `['home_services']`.

## Verify everything still green

```
pnpm --filter @leadlandlord/agents typecheck
pnpm --filter @leadlandlord/operator typecheck
```
Both pass as of the two commits above. There is no automated test asserting taxonomy injection — see "validate diversity" below.

## Remaining work

### Decision A — does output actually diversify? (do this first, no code)
The fix is a prompt-level steer, not a hard constraint, so confirm it works in practice before building more.
- Run niche-hunter a few times (all categories, the usual AZ/NM/TX/NV states) and eyeball the persisted `niches` rows: are roofing/HVAC/tree-removal de-emphasized? Is there real spread across categories and across the trade list?
- If still narrow: strengthen the directive (e.g. an explicit per-run cap on any one category), or move to coverage-weighted sampling (Task C).

### Task B — persist `category` (optional DB migration)
`niches` has NO `category` column today (`packages/db/src/schema.ts`), so category is dropped before persist and the dashboard can't filter by it. To add:
- Migration adding a nullable `category` text/enum column; persist the brainstorm `category` in `persistNiches`; surface a filter in `apps/operator/app/operator/niches/page.tsx`.
- **READ the migration discipline section in [HANDOFF-NICHE-SCORING.md](HANDOFF-NICHE-SCORING.md) before adding any migration** — the journal/ledger are hand-maintained and `when` must strictly exceed the current max. DB migrations require explicit operator approval before applying (manual `pnpm db:migrate`).
- Alternative if you want to avoid a migration: infer category by reverse-looking-up the persisted niche name in `SERVICE_TAXONOMY`.

### Task C — coverage-weighted rotation (depends on B)
Once category is persisted (or inferrable), bias each run's taxonomy slice toward under-covered categories: query `niches` grouped by category, weight the injected slice away from what's already well-covered. This converts "breadth available" into "breadth explored" run-over-run. Not needed if Decision A shows the page-1 directive already gives enough spread.

### Ongoing — taxonomy curation
342 trades is a v1 seed. Operator is comfortable maintaining it. Add trades as new winnable niches surface; keep names specific and lowercase; respect the no-licensing constraint. It can be bootstrapped further from NAICS / home-services category lists if a bigger universe is wanted.

## Open questions for the operator
- Keep the taxonomy weighted to home/property, or broaden the non-home categories (auto/pet/event/lifestyle are currently 22-35 each)?
- Is the prompt-steer sufficient, or do you want a hard per-category cap and/or coverage rotation (Task C)?
- Do you want the `category` column (Task B) for dashboard filtering now, or defer until rotation is actually needed?

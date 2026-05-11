# ADR 0003 — Render-when-present policy for optional Bundle fields

**Date:** 2026-05-11  
**Status:** Accepted

---

## Context

The SEO + trust-signal sweep adds ~10 new optional fields to `BundleSchema` (`apps/site-host/lib/content.ts`) and a new `review` document type. Existing tenants have none of these fields populated. If any new rendering component unconditionally renders when a field is absent, it will:

- Break the baseline visual for live tenants.
- Potentially render empty `<section>` elements that reduce content-to-markup ratio.
- Introduce empty JSON-LD nodes that cause Google Rich Results validation errors.

## Decision

**Every new field in `BundleSchema` is optional with a safe default.** The rules are:

1. **Array fields default to `[]`.** (`reviews`, `certifications`, `photo_gallery`, `guarantees`)
2. **Scalar fields default to `undefined`.** (`license_number`, `insurance_carrier`, `years_in_business`, `response_time_promise`, `aggregate_rating`)
3. **Every new variant section or shared component gates render on truthiness:**
   - Arrays: `array.length > 0` before rendering the wrapping element.
   - Scalars: explicit `!= null && != undefined` check.
   - JSON-LD: only emit when data meets the emission threshold (e.g., `aggregate_rating` only when `review_count >= 3` and `reviews.filter(r => r.verified).length >= 3`).
4. **No new section may render empty or with default/placeholder data.**
5. **Schema additions never bump a major version.** The `BundleSchema` Zod object is extended with `.optional()` / `.default(...)`. Existing `parse()` call sites in `theme-bundle.ts` continue to work unchanged.

**The conformance test** (to be added in Phase 1 alongside the schema changes):

A fixture file at `apps/site-host/__tests__/fixtures/bundle-baseline.json` captures the current serialized `Bundle` for the `tree-removal-tucson` tenant (all new fields absent). A snapshot test asserts that rendering each variant home component with this fixture produces HTML identical to the pre-sweep baseline. This test runs in CI on every PR touching `components/variants/*.tsx` or `lib/content.ts`.

Concretely: `sanityToBundle` in `apps/site-host/lib/theme-bundle.ts` must produce a `Bundle` whose new fields are all at their defaults when the Sanity site doc has no trust data. The Zod `.parse()` in the adapter enforces defaults; no downstream code path may introduce a fallback that deviates from an empty-array/undefined state.

## Consequences

- **No migration required.** Adding optional fields to a Zod object schema with defaults is non-breaking; existing parsed objects gain defaults automatically.
- **Operator and QA can verify graceful degradation** by loading any warmed tenant that has not been seeded with trust data. It must be visually and structurally identical to the pre-sweep render.
- **Phase 5 QA gate** explicitly checks this: "Tenant with no `reviews`/`license_number` matches pre-change baseline pixel-for-pixel where new sections were absent."
- **JSON-LD discipline.** `LocalBusinessJsonLd` must not emit `aggregateRating` or `review` nodes when the data does not satisfy emission criteria, even if the field is technically present with default values.

**Files to touch (Phase 1):**
- `apps/site-host/lib/content.ts` — extend `BundleSchema` with optional/defaulted fields
- `apps/site-host/lib/theme-bundle.ts` — safe-default pass-through in `sanityToBundle`
- `apps/site-host/__tests__/fixtures/bundle-baseline.json` — new fixture (capture before schema lands)
- `apps/site-host/__tests__/render-when-present.test.tsx` — new snapshot test

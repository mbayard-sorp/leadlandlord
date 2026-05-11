# ADR 0004 — WebSite JSON-LD shape (no SearchAction)

**Date:** 2026-05-11  
**Status:** Accepted

---

## Context

`apps/site-host/app/layout.tsx` emits `LocalBusiness` JSON-LD via `LocalBusinessJsonLd` (mounted in variant home components). There is no `WebSite` graph node today, so Google's rich-results parser cannot establish the site identity or link the `LocalBusiness` to its canonical URL via a shared `@id`.

Some implementations include a `potentialAction` / `SearchAction` node on `WebSite` to enable the Google Sitelinks Search Box feature. This requires a functioning `/search?q={search_term_string}` route. No such route exists in `site-host` — the app has no on-site search. Declaring a `SearchAction` without the route is a schema lie; Google documents that it will ignore or flag this.

## Decision

Emit a `WebSite` JSON-LD node in `apps/site-host/app/layout.tsx` via a new `WebSiteJsonLd` component (`apps/site-host/components/shared/WebSiteJsonLd.tsx`).

Shape:

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "{canonicalUrl}/#website",
  "name": "{bundle.business_name}",
  "url": "{canonicalUrl}",
  "publisher": {
    "@id": "{canonicalUrl}/#localbusiness"
  }
}
```

The `LocalBusinessJsonLd` component is updated to add `"@id": "{url}/#localbusiness"` to its graph node so the `publisher` cross-reference resolves.

**Do NOT emit `potentialAction` / `SearchAction`.** There is no `/search` route. Adding it would be a false declaration.

If on-site search is added in a future phase, that work supersedes this ADR and must add the route, the `SearchAction` node, and update `WebSiteJsonLd` accordingly.

## Consequences

- **Establishes the JSON-LD graph identity** across `WebSite` and `LocalBusiness` nodes via `@id` cross-references. This improves Knowledge Panel signal and sitelinks eligibility.
- **No SearchAction = no Sitelinks Search Box.** That is acceptable. The `docs/sitelinks-plan.md` goal is standard sitelinks (from nav structure + BreadcrumbList), not the search box variant.
- **Zero risk of schema validation error.** Google Rich Results Test and schema.org validators will not flag a `WebSite` without `potentialAction`.
- **Supersession path is clear.** If search is ever added, this ADR is the single place to update — the `SearchAction` node is not scattered across variants.
- **Mounted in `layout.tsx`, not in variant components.** `WebSite` is a site-level node; it must appear on every page, not just the home route. `LocalBusinessJsonLd` stays in the variant home components since `areaServed`, `openingHoursSpecification`, etc. depend on Bundle data available only at home render time.

**Files to touch (Phase 2c):**
- `apps/site-host/components/shared/WebSiteJsonLd.tsx` — new component
- `apps/site-host/app/layout.tsx` — mount `<WebSiteJsonLd>`
- `apps/site-host/components/shared/LocalBusinessJsonLd.tsx` — add `"@id"` to the graph node

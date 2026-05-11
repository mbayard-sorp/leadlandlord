# ADR 0001 — Trust-signal data shape

**Date:** 2026-05-11  
**Status:** Accepted

---

## Context

`BundleSchema` (`apps/site-host/lib/content.ts`) currently carries only `trust_signals: string[]` — a flat list of marketing blurbs. Rendering structured trust signals (reviews, license details, certifications, photo gallery, guarantees, response-time promise) and emitting `Review`/`AggregateRating` JSON-LD requires a richer data model. Two options were viable:

**Option A — Inline array on `site` doc.** Embed reviews as an array of objects directly inside the Sanity `site` document.  
**Option B — Referenced `review` document type (chosen).** Reviews live as first-class Sanity documents (`_type: "review"`) with a `reference` array field on `site`.

## Decision

**Option B: referenced `review` documents.**

The Sanity `review` document schema is:

```
_type: "review"
author: string          (required)
rating: number 1–5      (required)
text: text              (required)
source: "google" | "yelp" | "bbb" | "facebook" | "direct"  (required)
date: date              (required)
verified: boolean       (required, default false)
siteRef: reference → site  (required — back-reference for Studio UX)
```

The `site` document gains a `reviews` field: `array of { type: "reference", to: [{ type: "review" }] }`.

The remaining trust fields are **flat optional scalars/arrays on `site`**:

```
licenseNumber?: string
insuranceCarrier?: string
yearsInBusiness?: number
certifications[]: { name, issuer?, year? }
photoGallery[]: { asset (image), alt, caption? }
guarantees[]: string
responseTimePromise?: string
aggregateRating?: { ratingValue: number, reviewCount: number, bestRating: 5 }
```

`BundleSchema` in `apps/site-host/lib/content.ts` mirrors these with snake_case per existing convention:

```
reviews: Review[]                (default [])
aggregate_rating?: { rating_value, review_count, best_rating: 5 }
license_number?: string
insurance_carrier?: string
years_in_business?: number
certifications: { name, issuer?, year? }[]    (default [])
photo_gallery: { url, alt, caption? }[]       (default [])
guarantees: string[]             (default [])
response_time_promise?: string
```

`Review` type in `BundleSchema`:
```
{ author: string, rating: number, text: string,
  source: 'google'|'yelp'|'bbb'|'facebook'|'direct',
  date: string, verified: boolean }
```

The GROQ projection in `apps/site-host/lib/sanity.ts` dereferences the `reviews[]->` array and projects these fields. `apps/site-host/lib/theme-bundle.ts` maps them through with safe defaults.

`LocalBusinessJsonLd` (`apps/site-host/components/shared/LocalBusinessJsonLd.tsx`) emits `Review` and `aggregateRating` JSON-LD only when:
- `review.verified === true`
- `review.source` is attributed (not `"direct"` alone without moderation flag)
- total verified reviews `>= 3` (suppress aggregate below this threshold to avoid manual-action risk)

## Consequences

**Why referenced over inline:**
1. **Auditability.** Each review is a distinct Sanity document with `_createdAt`/`_updatedAt`. Studio can filter, bulk-edit, or flag reviews across sites without opening individual site docs.
2. **Reuse.** A review chain from a franchiser tenant could eventually reference the same review doc across multiple site slugs (future).
3. **Selective JSON-LD gating.** The `verified` flag is a first-class field; JSON-LD emission logic can cheaply filter `reviews.filter(r => r.verified)` in the GROQ projection rather than post-processing a monolithic embedded array.
4. **`aggregateRating` on `site` doc** avoids re-computing counts in the renderer; Studio operators or an automation agent can maintain it. It is emitted only when present and `reviewCount >= 3`.

**Trade-offs:**
- GROQ projection gains a `reviews[]->` dereference — one additional join per request. Acceptable given `useCdn: true` and typical review counts (<50 per site).
- Photo gallery capped at 8 images per site; `quality={70}` on `next/image` to limit Sanity CDN cost.
- `photoGallery` uses Sanity `image` type (with asset reference) on the Studio side; the `SanitySite` TypeScript type carries `photoGallery: Array<{ url: string, alt: string, caption?: string }>` after GROQ projection resolves `asset->url`.

**Files to touch (Phase 1):**
- `packages/sanity-schema/src/types/review.ts` — new document type
- `packages/sanity-schema/src/types/site.ts` — add `reviews`, trust, gallery fields
- `packages/sanity-schema/src/types/index.ts` — re-export `review`
- `apps/site-host/lib/content.ts` — `BundleSchema` additions
- `apps/site-host/lib/sanity.ts` — `SanitySite` type + GROQ projection
- `apps/site-host/lib/theme-bundle.ts` — adapter pass-through with defaults

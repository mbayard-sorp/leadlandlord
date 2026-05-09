# site-host SEO checklist

Source of truth for tenant-site SEO posture. Read before deploying a new variant or onboarding a new tenant.

Target: Lighthouse SEO ≥95, Accessibility ≥95, Core Web Vitals green on mobile, clean Rich Results Test.

## What's in place (R1 — 2026-05-09)

### Crawlability
- ✅ Per-tenant sitemap at `/sitemap.xml` ([app/sitemap.ts](app/sitemap.ts)) — host-aware, includes home, services, service-areas, info-pages, blog.
- ✅ Per-tenant `/robots.txt` ([app/robots.ts](app/robots.ts)) — respects `robotsDisallow` flag on the Sanity site doc, emits sitemap URL, sets host.
- ✅ Canonical URLs on every page — built from the **current request host** ([lib/seo-meta.ts:currentRequestBaseUrl](lib/seo-meta.ts)), not a Sanity primary-domain field. Multi-host tenants get the correct canonical for the host they were reached on.

### Metadata
- ✅ `buildPageMetadata()` helper in [lib/seo-meta.ts](lib/seo-meta.ts) emits canonical + OG + Twitter cards consistently across every route.
- ✅ All routes wired: home, `/services/[slug]`, `/service-areas/[slug]`, `/blog/[slug]`, `/pages/[slug]`, `/about`, `/contact`.
- ✅ Twitter `summary_large_image` cards on every page with the bundle hero image when available.
- ✅ Blog + info-page OG `type=article` with `publishedTime` from `bundle.generated_at`.
- ✅ Per-tenant `siteName` set on OG.

### Structured data (JSON-LD)
- ✅ `LocalBusiness` on home with niche-specific subtype mapping (existing).
- ✅ `Service` on `/services/[slug]` — fallback now includes `url`, `image`, `provider.telephone`, `provider.areaServed`, and `offers` (priceCurrency, availability, url) so Rich Results doesn't reject it for missing required fields.
- ✅ `BlogPosting` on `/blog/[slug]` with author/publisher/datePublished (existing).
- ✅ `Article` on `/pages/[slug]` (existing).
- ✅ `LocalBusiness` on `/service-areas/[slug]` (existing).
- ✅ **`BreadcrumbList`** now emitted on `/services/[slug]`, `/service-areas/[slug]`, `/blog/[slug]`, `/pages/[slug]` via `breadcrumbsJsonLd()` in [lib/seo-meta.ts](lib/seo-meta.ts) — items use absolute URLs derived from the request host.
- ✅ `FAQPage` JSON-LD on home for variants that derive FAQs from blog posts (existing in Classic/Modern; not yet rendered for Premium/Bright — see open items).

### Accessibility / SEO crossover
- ✅ Skip-to-content link in root layout ([app/layout.tsx](app/layout.tsx)) — visually hidden until keyboard focus, styled in [styles/components.css](styles/components.css) (`.skip-to-content`).
- ✅ `data-theme` on `<html>` for variant-scoped theming.
- ✅ Single `<h1>` per page (variants emit a literal `sr-only` H1).
- ✅ Semantic `<header>/<nav>/<main>/<footer>` landmarks in [components/SiteShell.tsx](components/SiteShell.tsx).

### Performance / Core Web Vitals
- ✅ `next/font` with `display: 'swap'` for all 8 typefaces ([lib/fonts.ts](lib/fonts.ts)).
- ✅ Hero images now use `next/image` with `priority`, `sizes`, and proper `fill`/explicit-dimension layout on Classic, Bright, Premium ([components/variants/](components/variants/)).
- ✅ `images.remotePatterns` in [next.config.ts](next.config.ts) covers Vercel Blob, Sanity CDN, Imagen storage, Unsplash. Operator-controlled URLs only.
- ✅ Per-tenant GA4 injection (`NEXT_PUBLIC_GA_MEASUREMENT_ID` from Sanity) with `site_id` custom dimension.

## Open items (R3 — variant refactors not yet done)

These are tracked in the architect's plan and don't block deploying R1.

- ⏳ **Modern, Premium, Bright variants** — design-brief refactors per [docs/template-design-brief.md](../../docs/template-design-brief.md). Classic is the reference.
- ⏳ **Paired-surface token system** — replace 21 `!important` color overrides across `styles/variants/*.css` with a `.surface-inverse` utility driven by `--surface-fg/bg` tokens. Foundation for a permanent fix to the black-on-black contrast bug class.
- ⏳ **Premium fake testimonial** — hardcoded blockquote in [components/variants/Premium.tsx](components/variants/Premium.tsx) violates the no-fake-content brief rule. Replace with `[TESTIMONIAL — REPLACE]` placeholder + Sanity schema field.
- ⏳ **Premium + Bright LeadForm rendering** — currently absent on home; brief lists form-submit as #2 conversion priority.
- ⏳ **Niche-specialized Copywriter overlays** — `packages/agents/src/copywriter/niches/{trades,modern,premium,bright}.md`.

## Deploy / verify checklist (run on every new tenant before going live)

1. **Lighthouse mobile:** ≥95 SEO, ≥95 Accessibility, green Core Web Vitals (LCP < 2.5s, CLS < 0.1, INP < 200ms).
2. **Rich Results Test** (`https://search.google.com/test/rich-results`): paste each route URL — LocalBusiness on home, Service on `/services/...`, BreadcrumbList on every nested route. No errors.
3. **Mobile-Friendly Test** (`https://search.google.com/test/mobile-friendly`): pass.
4. **Search Console:** submit sitemap; watch for "Discovered – not indexed" or "Crawled – not indexed" within 7 days; resolve.
5. **OG / Twitter preview:** paste URL into `https://opengraph.dev` or LinkedIn post composer; confirm preview card with hero image.
6. **GA4 real-time:** visit the live site, confirm pageview lands with the correct `site_id` custom dimension.
7. **Sitemap fetch:** `curl https://{host}/sitemap.xml` returns valid XML with all expected routes.
8. **`robots.txt` sanity:** `curl https://{host}/robots.txt` shows `Allow: /` (or `Disallow: /` if site is in warming).

## Maintenance notes

- **Adding a route?** Mirror the pattern from any of `app/services/[slug]`, `app/blog/[slug]`, etc.: pull the page from the bundle, build canonical via `buildPageMetadata`, emit a `BreadcrumbList`. Don't hand-roll metadata.
- **Adding an image source?** Add the hostname to `images.remotePatterns` in [next.config.ts](next.config.ts).
- **Touching a variant's color/contrast?** Once the R3 paired-surface token refactor lands, do not add new `!important` color overrides — apply `.surface-inverse` to the dark-background container instead.

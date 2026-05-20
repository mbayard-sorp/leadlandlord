# ADR 0012: Variant engagement + footprint-divergence architecture

Date: 2026-05-20

Outcome of a site-template design audit (taste-skill pack) cross-checked by the SEO auditor and the technical architect. Establishes HOW engagement improvements to the four tenant home variants (`apps/site-host/components/variants/{Classic,Modern,Premium,Bright}.tsx`) are implemented, so they raise conversion without bloating the multi-tenant render path or creating a detectable network footprint. This ADR records architecture decisions only; it does not approve fabricated-content features (see Consequences).

## Context

The four variants are already content-rich (trust strips, reviews, galleries, JSON-LD via `LocalBusinessJsonLd` + `FaqJsonLd` + `SiteNavigationJsonLd`, per-route Article/Service/BlogPosting schema). The audit found four real gaps:

1. **No motion** - every variant is fully static.
2. **Inconsistent ad-hoc iconography** - emoji/glyphs (`☎ ★ ✓ ◉ ▦ ⌁`) used as icons.
3. **Near-identical section order + repeated literal copy** across all four variants (`"We answer the phone"`, `"Get free quote →"`, identical default `trust_signals`). This is simultaneously a design-monotony problem and a **network-footprint** problem - observable cross-site similarity that makes the portfolio detectable as a network.
4. **No proof above the fold** and not all variants use `next/image` for the hero (Premium uses a CSS `backgroundImage`).

Constraint that shapes everything: the variant component tree currently ships **zero client JS**. The render path is Server Components fed by `sanityToBundle()` → `Bundle` (Zod schema, `lib/content.ts`). H1 renders the targeted keyword verbatim, server-side (ADR 0002). These properties must survive the changes.

## Decision

**1. Motion lives in isolated leaf-client wrappers - never on variant roots.**
No `'use client'` on any variant component. Above-the-fold hero reveal uses CSS `@starting-style` + `transition` (zero JS, zero client boundary) with a `@supports` fallback so unsupported browsers simply render the element instantly. Scroll-revealed (below-fold) sections use a single shared client leaf, `components/motion/ScrollReveal.tsx` (IntersectionObserver-driven class toggle), imported as a leaf the way `TrustStrip` is imported today. The hero image, the LCP element, and the above-fold `LeadForm` are explicitly excluded from any motion wrapper - they render synchronously with no hydration dependency. **No third-party animation library** (Framer Motion, GSAP): each would impose a client boundary and ship kilobytes into a currently-zero-client tree.

**2. Section order stays inline per variant. No shared section registry.**
Footprint differentiation is now a *feature*, not incidental. A shared registry that all variants consume to produce orderings would be trivially footprint-detectable and buys nothing. Each variant owns its own section JSX order. The only extraction warranted is the duplicated derivation logic (`uniq()`, the FAQ filter `title.endsWith('?')`, the blog-teaser split) → pure functions in a new `lib/variant-utils.ts` (`deriveAreas`, `deriveFaqs`, `deriveBlogTeasers`, `firstReview`). Each variant calls them at the top of render. Section JSX is not shared.

**3. Copy variation is layered: Bundle for tenant content, hardcoded-per-variant for boilerplate.**
The existing `trust_signals` fallback pattern (Classic and Modern fall back to *different* default arrays) is the correct model and is extended. Rule: niche/tenant-specific copy (tagline, lede, CTA) comes from `Bundle` fields (Content Engine output via Sanity); variant-flavored boilerplate (eyebrows, button labels, footer tone) is hardcoded per variant component and deliberately diverges across the four. **No new `Bundle`/Sanity fields** for variant-level copy or motion config - that bleeds rendering concerns into tenant content and churns the schema. Copy divergence must be deterministic, not randomized at render (a crawler must see stable copy - see SEO consequences).

**4. Icons are hand-authored inline SVG server components.**
New set under `components/icons/` (e.g. `Check`, `Phone`, `Star`, `Shield`, `Clock`): pure SVG markup, no state, server-safe, exact tree-shaking. No icon library. Existing emoji are left in place rather than swept in a separate refactor; new/edited sections use the SVG components.

**5. Per-variant style divergence is CSS-token-only.**
Visual direction lives entirely in `styles/themes/{variant}.css` (token values) and `styles/variants/{variant}.css` (layout). Target directions: classic → warm-modern, modern → swiss-system, premium → quiet-luxury, bright → soft. No Tailwind utilities in variant JSX (the codebase uses BEM-style classes + CSS variables), no runtime theme switching, no CSS-in-JS.

## Consequences

- **Above-fold proof (testimonials/reviews) is plain-text-only with ZERO review/`AggregateRating` schema.** Per operator confirmation, reviews are generated/placeholder, not sourced. Emitting review/rating schema on fabricated content is a Google manual-action violation. `LocalBusinessJsonLd` does not emit review schema today and must not start until a real review source (GBP/Trustpilot/verified submissions) is integrated. The `firstReview()` helper returns `null` on empty `bundle.reviews` and the variant renders nothing in that case. This also aligns with the "no fake content" rule in the template design brief.
- **Hero moves to `next/image` in all four variants** (`priority` + viewport-aware `sizes`), a Core Web Vitals (LCP) win and a prerequisite for the gallery work. `next.config.ts` `images.remotePatterns` must be populated before any new remote image source ships.
- The variant tree keeps zero client JS except the single `ScrollReveal` leaf on below-fold sections.
- Section-order and copy divergence reduce footprint AND monotony in one change - the highest-leverage item.
- Files expected to change at implementation time: `components/motion/ScrollReveal.tsx` (new), `components/icons/*` (new), `lib/variant-utils.ts` (new), the four variant components, the four theme + four variant CSS files. Do **not** touch `lib/content.ts`, `lib/site-context.ts`, or `lib/seo-meta.ts` for these changes.

## Explicitly NOT approved

- `'use client'` on any variant root component.
- A shared section-registry / composition layer driving per-variant ordering.
- New `Bundle`/Sanity fields for variant copy, button labels, motion, or section order.
- Any third-party animation library.
- Review/`AggregateRating`/star schema on placeholder testimonials.
- Client-side randomization of copy or section order (must be deterministic/server-side).

## Open items for the implementing engineer

- `ScrollReveal` boundary sits at the first below-fold section, never the page root; verify the hero/LCP path stays server-only.
- Confirm `@starting-style` support targets and add the `@supports` fallback.
- Sequence the `lib/variant-utils.ts` extraction after any in-flight variant edits to avoid merge conflicts (duplicate `uniq()` exists in all four variants).

# LeadLandlord - Tenant Site Template Design Brief

> Rewritten 2026-05-20 from a site-template engagement audit (taste-skill pack),
> cross-checked by the SEO auditor and the technical architect.
> Implementation architecture: see [ADR 0012](adr/0012-variant-engagement-architecture.md).
> Heading hierarchy: [ADR 0002](adr/0002-heading-hierarchy.md). Trust-signal shape: [ADR 0001](adr/0001-trust-signal-data-shape.md).

## What this is

The design contract for the four tenant home variants in `apps/site-host`. Each tenant site
is one `niche × city` lead-gen site that must look like a real local small business - never a
network clone. We run 100+; cross-site visual + copy similarity is a **footprint** liability,
so variant divergence is a feature, not a polish item.

## Current architecture (do not redesign)

- **Next.js 16 App Router**, Server Components by default. The variant component tree ships **zero client JS** - keep it that way (one exception: the `ScrollReveal` motion leaf, ADR 0012).
- Content flows: Sanity `site` doc → `sanityToBundle()` → `Bundle` (Zod, `lib/content.ts`) → variant home component, switched on `site.theme` in `app/page.tsx`.
- Variants: `components/variants/{Classic,Modern,Premium,Bright}.tsx`.
- Shared blocks: `components/shared/*` (`LeadForm`, `TrustStrip`, `ReviewsSection`, `PhotoGallery`, `CertificationsRow`, `GuaranteesList`, `CallNowBadge`, `MapEmbed`, `*JsonLd`).
- Themes: CSS custom properties in `styles/themes/*.css`; layout in `styles/variants/*.css`.
- SEO: per-host `robots.ts` + `sitemap.ts`, canonical via Next metadata `alternates`. Hero H1 renders the targeted keyword verbatim, server-side (ADR 0002). FAQ schema derived from `blog_posts` whose title ends in `?`.

## Per-variant style direction

Diverge the four so they read as four different businesses. CSS-token-only (ADR 0012 §5);
no JSX/prop changes to achieve the look. Dials are `DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY`.

| Variant | Direction | Dials | Niche fit | Identity cues |
|---|---|---|---|---|
| **classic** | Warm-Modern | 5 / 4 / 4 | HVAC, plumbing, roofing, gutter, electrical | Sunlit, human, composed. Warm neutrals (clay/oat/walnut) with the safety-orange accent kept. Friendly sans + warming serif. Process rails, paired image+quote bands. Warmer than the current hard-edged "truck door" look. |
| **modern** | Swiss-System | 4 / 1 / 5 | solar, EV, smart-home, water-heater install | Rational, grid-led, near-static. Grotesk dominance, tabular numerals, uppercase tracked labels, one signal accent. Poster/modular hero, rule-separated modules, spec tables. Drop the decorative SVG-blob hero for a disciplined grid field. |
| **premium** | Quiet-Luxury | 4 / 2 / 3 | remodels, custom landscape, pool builders | Status through restraint. Off-white/linen/stone/espresso, refined serif+sans, generous whitespace, slow rhythm. Arrival-scene hero (interior/material plate), quote slabs, material strips. Move hero to `next/image` (currently a CSS background). |
| **bright** | Soft | 5 / 5 / 4 | cleaning, pest, pool service, junk removal | Tactile, layered, approachable - depth via surface/spacing/motion, NOT blob wallpaper or glassmorphism. Diffused matte light, friendly accent, layered feature islands, floating nav pill. Most motion of the four. |

## Engagement improvements (audit outcome)

Each item carries its SEO verdict and architecture constraint. Status reflects gate review.

1. **Motion** - APPROVED. CSS `@starting-style` for hero reveal; one `ScrollReveal` client leaf for below-fold sections; hover/press feedback. Respect `prefers-reduced-motion`. Hero/LCP/above-fold form excluded from motion. No animation library. (SEO: safe if H1/CTA render eagerly, no CLS.)
2. **Replace emoji/glyph icons** - APPROVED. Hand-authored inline SVG server components in `components/icons/`. (SEO: neutral; decorative + `aria-hidden`.)
3. **Differentiate section order + copy per variant** - APPROVED, highest priority. Inline-per-variant order; divergent hardcoded boilerplate; deterministic (never client-randomized). Keep the FAQ-from-`blog_posts` derivation. (SEO: safe only if server-side/deterministic; strong footprint win.)
4. **Above-fold proof** - TEXT-ONLY. Real-locality testimonial + availability/response-time as **plain text**. **No review / `AggregateRating` / star schema** - reviews are placeholder; schema on fabricated reviews is a manual-action violation. Use `firstReview()` returning `null` when empty. Honors the no-fake-content rule below.
5. **Image gallery / before-after, higher in page** - APPROVED. Requires `images.remotePatterns` populated, `alt` on every image, lazy-load all but LCP. (SEO: safe; later enables `image: [array]` on LocalBusiness.)
6. **Stronger hero imagery** - APPROVED. All four variants use `next/image` with `priority` + viewport-aware `sizes`. (SEO: LCP win; Premium currently a CSS background.)

## Hard constraints (unchanged)

- **No fake content.** No fabricated reviews, testimonials, award badges, "since 1995" claims, license numbers, or before/after photos. Placeholders the operator fills, or render nothing. No fabricated review/rating schema (item 4).
- **Phone CTA is the primary conversion** - clickable `tel:` in header, hero, after-services CTA, and mobile-sticky bar. Number is the per-site tracking number resolved server-side.
- **No brand-name keywords** (Roto-Rooter, Stanley Steemer, etc.).
- **GBP is the partner-contractor's real profile** - never fake-GBP automation.
- **Mobile-first** - ~70% of local-service traffic is mobile.
- **Lighthouse targets:** ≥95 across Performance / Accessibility / Best Practices / SEO. Semantic HTML, no client JS above the fold, lazy images, `next/font` only.
- **Each variant a distinct visual identity** - colors, type, hero pattern, service-card treatment. Not just an accent swap.

## Conversion priority (rank-ordered)

1. Click the phone number (4 placements above).
2. Submit the contact form (`LeadForm` → `/api/lead`, attributed by `siteId`).
3. Read more / build trust - service, about, blog, info pages; each ends with a phone CTA.
4. Local relevance - service-area pages, neighborhood mentions, "We serve {city} and nearby towns".

## Out of scope for this brief

Wiring variant selection (handled by site-builder), the Content Engine system prompt, and any
new Sanity schema. Per ADR 0012, none of these changes require new `Bundle`/Sanity fields.

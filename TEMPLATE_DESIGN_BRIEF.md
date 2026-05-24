# LeadLandlord — Template Design Brief

A starting prompt for Claude Design. Read this top to bottom before designing. The goal is a **new site template ("variant")** that drops into the existing platform with zero changes to the data layer, content pipeline, or routing.

---

## 1. What you're building

LeadLandlord generates and hosts **local-service contractor websites** (plumbers, HVAC, roofers, landscapers, cleaners, etc.). Every site is a per-tenant Next.js render of the **same JSON data contract** (a `Bundle`). A **variant** is one complete visual treatment of that data — a CSS theme + a bespoke home-page component.

Four variants ship today, each aimed at a niche family:

| Variant   | Personality                                              | Target niches                                                  |
|-----------|----------------------------------------------------------|----------------------------------------------------------------|
| `classic` | Trade-classic, warm, human. "Your neighbor's crew."       | HVAC, plumbing, electrical, gutter, roofing, fence, septic     |
| `modern`  | Swiss-system, terse, spec-forward.                        | solar, EV, smart-home, water-heater install                    |
| `premium` | Curated editorial luxury, restrained, serif.              | custom landscape, kitchen, pool, fine carpentry                |
| `bright`  | Approachable, conversational, friendly.                   | cleaning, junk removal, pest, lawn care, dog walking, detailing |

**Your job:** design a *fifth* variant (or a refresh of an existing one) with a distinct visual language that still renders the identical `Bundle` and reuses the shared component + token system.

### Critical platform constraint: the network footprint
These sites are a **network**. The single biggest design constraint is **avoiding an observable footprint** — patterns that make many sites detectably the same template. Your variant must support enough internal variation (color palettes, layout rhythm, type scale) that 50 sites built on it don't look like 50 clones. Design for **microvariation**, not a single fixed layout.

---

## 2. The data contract — `Bundle`

This is the only data your template receives. It is defined and Zod-validated in `apps/site-host/lib/content.ts`. **You may not add fields** — Content Engine produces this shape and the schema is shared across all variants. Design around what's here; treat every optional field as possibly-absent and provide a graceful empty state.

```ts
// Bundle (top level)
{
  niche: string;                  // "plumbing"
  city: string;                   // "Tucson"
  state: string;                  // "AZ"
  business_name: string;          // "Smith & Sons Plumbing"
  variant: 'classic'|'modern'|'premium'|'bright';
  hero_image_url?: string;        // hero background/feature image
  logo_url?: string;              // tenant logo (may be absent → fall back to wordmark/mark)
  favicon_url?: string;
  nearby_cities: string[];        // for "Where we work"
  trust_signals: string[];        // short trust phrases; provide variant-specific fallbacks if empty

  home: Page;                     // see Page below
  services: Page[];               // service detail pages
  service_areas: Page[];          // geographic pages
  about: Page;
  contact: Page;
  blog_posts: Page[];             // titles ending in "?" are treated as FAQ (see helpers)
  info_pages: Page[];             // informational guides; rendered with Article schema

  // Trust block — ALL optional, ALL may be empty (ADR 0001 + 0003)
  reviews: Review[];              // default []
  aggregate_rating?: { rating_value: number; review_count: number; best_rating: number };
  license_number?: string;
  insurance_carrier?: string;
  years_in_business?: number;
  certifications: { name: string; issuer?: string; year?: number }[];
  photo_gallery: { url: string; alt: string; caption?: string }[];
  guarantees: string[];
  response_time_promise?: string; // e.g. "Free quote in 24h"
  neighborhoods: { name: string; googleMapsUrl: string }[];

  generated_at: string;
}

// Page (every page in the bundle)
{
  kind: string;                   // 'home'|'service'|'service_area'|'blog'|'info'|...
  slug: string;
  title: string;                  // meta-title format; NOT the visible H1
  meta_description: string;
  mdx: string;                    // markdown body — render via the shared <Markdown> component
  schema_org_jsonld?: unknown;
  og_image_url?: string;
  primary_keyword?: string;       // the targeted keyword — renders as the visible H1 verbatim
  faqs?: { q: string; a: string }[];
}

// Review
{ author: string; rating: 1-5; text: string; source: 'google'|'yelp'|'bbb'|'facebook'|'direct'; date: string; verified: boolean }
```

### Hard content rules (non-negotiable)
- **H1 = keyword verbatim (ADR 0002).** The visible H1 must be `home.primary_keyword` (home) / `page.primary_keyword` (other pages), rendered exactly. Use the provided helpers `heroH1(bundle)` and `pageH1(page)` — never hand-roll the H1 text. `page.title` is for the HTML `<title>`, not the H1.
- **No fake content (ADR 0012).** If `reviews` is empty, render **nothing** (or a non-review CTA) — never placeholder reviews, and never emit `Review`/`AggregateRating` JSON-LD without real reviews. Same for ratings, certifications, gallery. Use `firstReview(bundle)` which returns `null` when empty.
- **Trust-signal fallbacks** are per-variant and voice-appropriate (Classic uses "We pick up" / "Your neighbors' crew"). Define your own on-brand fallbacks for when `trust_signals` is empty.

### Phone token — already handled, don't reimplement
Body copy contains the literal token `{{phone}}`. The route layer deep-substitutes it across the entire bundle (`lib/phone.ts → substituteBundlePhone`) **before** your component renders. You receive a clean `phone` string as a prop. For `tel:` links use the `telHref(phone)` helper. Do not write your own substitution.

### Derived-data helpers (`lib/variant-utils.ts`) — use these, they're server-safe
- `deriveAreas(bundle)` → ordered, de-duped city/area names (max 12) for "Where we work"
- `areaSlugByTitle(bundle)` → Map of area title → slug (link the ones that have a page)
- `deriveFaqs(bundle)` → up to 6 `{q,a}` from blog posts whose title ends in "?"
- `deriveBlogTeasers(bundle)` → up to 6 non-FAQ blog posts
- `firstReview(bundle)` → first review or `null`

---

## 3. Anatomy of a variant — the 5 touchpoints

To add a variant named `aurora`, you create/modify exactly these:

1. **`apps/site-host/styles/themes/aurora.css`** — design *tokens* only (CSS custom properties: colors, fonts, radii, spacing, surface mappings). Scoped `[data-theme='aurora'] { … }`. This styles the shared shell + secondary pages.
2. **`apps/site-host/styles/variants/aurora.css`** — the *bespoke* home-page styling (the visual signature). Scoped under your home component's root class (e.g. `.aurora-shell`).
3. **`apps/site-host/components/variants/Aurora.tsx`** — the home-page component, `export function AuroraHome(props)`.
4. **`apps/site-host/app/globals.css`** — add two `@import` lines (theme into `layer(themes)`, variant into `layer(variants)`).
5. **Wiring** — add `'aurora'` to the `VariantSchema` enum in `lib/content.ts`, the `switch (site.theme)` in `app/page.tsx`, and the Sanity `theme`/`colorPalette` field options (engineering will help here).

> Note for the designer: deliver items **1–3** as your artifacts. Items 4–5 are short integration edits an engineer applies. Don't worry about wiring; focus on tokens, the component, and the bespoke CSS.

### Component contract
The home component is a **Server Component** (no `'use client'`, no browser APIs, no hooks that need the client). Props:

```ts
interface Props {
  bundle: Bundle;
  phone: string;     // already formatted + substituted
  siteId: string;    // pass through to <LeadForm> for attribution
  siteSlug?: string; // pass through to <LeadForm>
  pageUrl?: string;  // absolute URL; used for canonical + JSON-LD
}
```

It must render, near the top, the JSON-LD components (see §6) and then your layout inside a single root class (`.aurora-shell`).

---

## 4. CSS architecture — the token system

`globals.css` uses CSS cascade layers in this order: `tailwindcss → themes → variants → components`. Tailwind utilities are available. **All color/type/spacing decisions flow through CSS custom properties** defined in your theme file — components reference `var(--…)`, never hardcoded hex. This is what makes palette-swapping and microvariation possible.

### The canonical token set (every theme file must define all of these)
Copy this contract from `styles/themes/classic.css`:

```css
[data-theme='aurora'] {
  /* Ink (text) ramp */
  --ink: #…;            /* primary text */
  --ink-2: #…;          /* secondary text */
  --ink-3: #…;          /* muted text */

  /* Paper (background) ramp */
  --paper: #…;          /* page background */
  --paper-2: #…;        /* alt section background */

  /* Accent */
  --accent: #…;         /* primary brand/CTA */
  --accent-fg: #…;      /* text ON accent (must contrast accent) */
  --accent-50: #…;      /* tint background */

  --rule: #…;           /* divider/border color */

  /* Type */
  --font-display: var(--font-…), <fallbacks>;
  --font-body: var(--font-…), <fallbacks>;

  /* Shape */
  --radius-card; --radius-button; --radius-pill;
  --border-card; --border-rule;

  /* Rhythm */
  --section-pad-y: clamp(…);
  --container-max: 1200px;

  /* SURFACE MAPPINGS — see contrast contract below */
  --surface-fg: var(--ink);
  --surface-bg: var(--paper);
  --surface-muted-fg: var(--ink-2);
  --surface-inverse-fg: var(--paper);
  --surface-inverse-bg: var(--ink);
  --surface-inverse-muted-fg: rgba(…, 0.75);
  --surface-inverse-accent-fg: var(--accent);
}
```

### Fonts
Fonts are loaded via `next/font` in `lib/fonts.ts` and exposed as CSS vars on `<html>` (e.g. `var(--font-oswald)`). If your design needs a typeface not already wired, name it in your deliverable and engineering adds it to `fonts.ts` — reference it as `var(--font-yourface)` in the theme file.

### The surface system + the contrast contract (READ THIS)
Sections with a **dark/inverted background** must use the `.surface-inverse` utility class (defined in `styles/components.css`), which sets `background: var(--surface-inverse-bg); color: var(--surface-inverse-fg)`. There is a matching `.surface-bg`/`.surface-fg` for normal sections.

**This is the #1 historical bug source ("black-on-black text").** Rules:
- Never put text on a colored/dark band without going through a `--surface-*` mapping. Don't set a dark `background` and rely on inherited text color.
- `--surface-fg` and `--surface-bg` must never resolve to the same value, in **any** palette.
- All text/background pairs must meet **WCAG AA (4.5:1)**.
- Muted text on inverse surfaces uses `--surface-inverse-muted-fg`; accents use `--surface-inverse-accent-fg`. Use the `.muted` / `.accent` (or `[data-muted]`/`[data-accent]`) hooks rather than re-coloring inline.

### Color palettes — design for microvariation
Each theme ships alternate palettes toggled per-site from Sanity via `data-palette` on `<html>`. Classic ships `default`, `alt1` (navy), `alt2` (forest). A palette block **overrides color vars only** — type, radii, and spacing inherit the base:

```css
[data-theme='aurora'][data-palette='alt1'] {
  --accent: #…; --accent-fg: #…; --accent-50: #…;
  /* and any ink/paper shifts; nothing else */
}
```

**Deliver at least 3 palettes** (default + 2 alts) so sites on your variant can vary their accent without footprint risk.

---

## 5. Shared components — reuse, don't rebuild

Import these from `apps/site-host/components/` and let your theme CSS style them. They encapsulate logic (lead attribution, schema, maps) you should not reimplement:

- `<SiteNav>` — top navigation
- `<LeadForm siteId siteSlug>` — lead capture (POSTs to `/api/lead`; needs `siteId`)
- `<Markdown>` — renders `page.mdx` safely (use this for all MDX bodies)
- `<ReviewsSection>` — testimonials (handles empty-state correctly)
- `<PhotoGallery>`, `<CertificationsRow>`, `<GuaranteesList>`, `<TrustStrip>`
- `<MapEmbed>`, `<CallNowBadge>`, `<StickyMobileBar>` (mobile call CTA)
- `<Breadcrumbs>` / `<BreadcrumbJsonLd>`
- `<ScrollReveal>` — below-the-fold reveal animation wrapper
- Icons: `components/icons/{Phone,Check,Star,Shield,Clock}.tsx`

Secondary pages (`/about`, `/contact`) and the dynamic page routes (`/services/[slug]`, `/service-areas/[slug]`, `/pages/[slug]`, `/blog/[slug]`) render through the **shared `<SiteShell>` + `<PageBody>`**, themed entirely by your `styles/themes/aurora.css` tokens. **You only build a bespoke component for the home page.** Make sure your tokens produce a coherent look on those shared shells too.

---

## 6. SEO & structured data (required)

Your home component must render (Classic does all of these near the top):
- `<LocalBusinessJsonLd bundle phone url>` — LocalBusiness; includes `AggregateRating` **only** when real ratings exist
- `<FaqJsonLd questions={deriveFaqs(bundle)} />` — FAQPage
- `<SiteNavigationJsonLd bundle baseUrl />`

Platform-level (already handled by `app/layout.tsx`, don't duplicate): `metadataBase`, canonical, OpenGraph/Twitter cards, favicon, `WebSiteJsonLd`, GA4. Info pages and blog posts get Article schema through their shared routes.

Semantics: one `<h1>` per page (the keyword), correct heading hierarchy (no skipped levels), `alt` text on every image (gallery provides it), and a "Skip to main content" target (`#main`).

---

## 7. Rendering & build constraints

- **Per-host SSR, not static export.** Site-host resolves the tenant from the `Host` header at request time (`resolveCurrentSite()`); there is no `output: 'export'`. Cache Components is intentionally OFF. Don't assume build-time-only data.
- **Server Components by default.** Add `'use client'` only inside a small leaf if truly needed; the home component itself stays server-rendered.
- **Images:** use `next/image`. Remote hosts must be whitelisted in `next.config.ts` (`cdn.sanity.io`, Vercel Blob, etc.). Provide width/height; mark the hero `priority`.
- **No external fonts/CDN `<link>` in the component** — fonts go through `next/font` (`lib/fonts.ts`).
- **Mobile-first.** Most contractor traffic is mobile; the sticky call CTA matters. Test 360px → 1440px.
- **Performance:** these are lead-gen pages judged on Core Web Vitals (a `/api/cwv` reporter exists). Keep JS minimal, avoid layout shift on the hero.

---

## 8. Deliverables

1. `styles/themes/<name>.css` — full token contract (§4) + ≥3 palettes.
2. `styles/variants/<name>.css` — bespoke home styling, scoped to `.<name>-shell`.
3. `components/variants/<Name>.tsx` — `export function <Name>Home(props: Props)`, Server Component, renders the JSON-LD trio + a complete home layout using the shared components and derived helpers.
4. A short **design rationale**: the personality, the target niche family, the type/color system, and how microvariation (palettes + any layout knobs) avoids network footprint.
5. Any new fonts to wire into `lib/fonts.ts` (just name them).

## 9. Acceptance checklist
- [ ] Renders the unmodified `Bundle` — no new fields invented.
- [ ] H1 uses `heroH1`/`pageH1` (keyword verbatim, ADR 0002).
- [ ] Empty `reviews`/ratings/certs/gallery render gracefully with **no fake content** and **no review JSON-LD** (ADR 0012).
- [ ] Every dark band uses `.surface-inverse` / `--surface-*`; all pairs pass WCAG AA. No black-on-black.
- [ ] All color/type/spacing via CSS custom properties; nothing hardcoded.
- [ ] ≥3 palettes; palette blocks override color vars only.
- [ ] Reuses shared components (`LeadForm` wired with `siteId`, `Markdown` for MDX, etc.).
- [ ] JSON-LD trio rendered; semantics + alt text correct.
- [ ] Server Component, `next/image`, no external font links.
- [ ] Mobile-first, sticky call CTA, stable at 360–1440px.
- [ ] Shared shell pages (`/about`, `/contact`, service/area/blog routes) look coherent under the new tokens.

---

### Reference files to read in the repo
- `apps/site-host/lib/content.ts` — schema + `heroH1`/`pageH1`/`telHref`
- `apps/site-host/lib/variant-utils.ts` — derived-data helpers
- `apps/site-host/lib/phone.ts` — phone substitution (already applied upstream)
- `apps/site-host/components/variants/Classic.tsx` — the reference variant to mirror
- `apps/site-host/styles/themes/classic.css` — the token contract
- `apps/site-host/styles/components.css` — `.surface-*` utilities
- `apps/site-host/app/page.tsx` — how variants are selected
- `apps/site-host/app/layout.tsx` — `data-theme` / `data-palette`, platform metadata
```

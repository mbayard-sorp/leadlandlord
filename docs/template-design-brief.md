# LeadLandlord — Tenant Site Template Design Brief

## Context

I run a portfolio of local lead-generation websites — one site per `niche × city` (e.g., "gutter cleaning Boise, ID", "junk removal Tucson, AZ"). Each site:
- ranks in Google for local home-services searches
- collects inbound phone calls and form leads via a tracking number
- is rented to a single local business owner for $300–$5,000/month
- needs to look like a real local small business, not a network site

I'll be running 100+ of these. Today I have one functional template that's plain Tailwind prose. I need a real design.

## What I'm asking for

**3–5 distinct template variants** as drop-in replacement React + Tailwind components for an existing Next.js 16 + Tailwind v4 setup (static export, no client-side data fetching). Variants should look meaningfully different so a portfolio of 100 sites doesn't look like clones — different layouts, color palettes, typography, hero treatments. Each variant should target a different niche category aesthetic:

1. **Clean modern** — for tech-forward services (solar, EV charging, smart home)
2. **Trade-classic** — for blue-collar trades (HVAC, plumbing, electrical, gutter cleaning)
3. **Premium / curated** — for high-ticket (custom landscaping, kitchen remodel, pool builders)
4. **Bright / approachable** — for residential personal services (cleaning, junk removal, pest)
5. (Optional) **Rural / regional** — for ag-adjacent services (tree work, fencing, septic)

You can pick the variant count and categories — recommend what makes sense.

## Hard constraints

- **Stack:** Next.js 16 App Router, React 19, Tailwind v4 (CSS-first config via `@import 'tailwindcss'`), TypeScript strict, static export (`output: 'export'`). No client-side data fetching. Forms can `<form action="/api/lead" method="post">` to a thin route handler — but the hero, services list, etc. are all server-rendered from a content bundle at build time.
- **Phone CTA is the primary conversion** — a clickable `tel:` link must be present in the header, hero, and a mobile-sticky bar. The number comes from `process.env.NEXT_PUBLIC_TRACKING_NUMBER` and rotates per site.
- **No fake content.** Don't write fake reviews, fake testimonials, fake award badges, fake "since 1995" claims, fake license numbers, fake before/after photos. Use clearly-labeled placeholders the operator fills in later (e.g., `[TESTIMONIAL — REPLACE]`, `[YEARS-IN-BUSINESS]`, `[LICENSE #]`, `[BEFORE/AFTER PHOTO]`).
- **Trust without lying.** Generic trust signals are fine: "Licensed and insured" (if user supplies), "Free quotes," "Local techs," "Same-week service." Brand logos (BBB, Google, Yelp) only as `<a>` placeholders the operator fills.
- **No brand-name keywords.** Never reference Roto-Rooter, Mr. Rooter, Stanley Steemer, etc. Use generic descriptors.
- **Mobile-first.** ~70% of local-service traffic is mobile. The mobile experience comes first; desktop is the upgrade.
- **Lighthouse target:** ≥95 Performance, ≥95 Accessibility, ≥95 Best Practices, ≥95 SEO. Use semantic HTML, no client JS for above-the-fold content, lazy-load images, system fonts or `next/font` only.
- **Each variant must have a distinct visual identity** in colors, typography, hero pattern, service-card treatment. Don't just swap accent colors.

## Page inventory (every variant needs all of these)

The site has these routes, all server-rendered from a single `content.json` at build time. Every variant must implement every route.

```
/                        Home (hero + services overview + service-areas + about teaser + CTA)
/services/[slug]         Service detail (one per service offered)
/service-areas/[city]    Service-area page (target city + nearby towns/neighborhoods)
/about                   About / who we are
/contact                 Contact (phone CTA + form + map placeholder)
/blog/[slug]             FAQ-style blog posts (long-tail SEO)
```

## Content data shape

Templates receive a typed `Bundle` object. Every page object has `kind`, `slug`, `title`, `meta_description`, `mdx` (markdown body), `schema_org_jsonld` (object). Bundle has:

```ts
type Bundle = {
  niche: string;            // "gutter cleaning"
  city: string;             // "Boise"
  state: string;            // "ID"
  business_name: string;    // "Boise Gutter Cleaning Pros"
  home: Page;
  services: Page[];         // 2–5 pages, each is one offered service
  service_areas: Page[];    // 2–5 pages, each is one city/neighborhood
  about: Page;
  contact: Page;
  blog_posts: Page[];       // 3–10 FAQ blog posts
  generated_at: string;
};

type Page = {
  kind: 'home' | 'service' | 'service_area' | 'about' | 'contact' | 'blog';
  slug: string;
  title: string;
  meta_description: string;
  mdx: string;               // markdown — render as HTML
  schema_org_jsonld?: object; // emit as <script type="application/ld+json">
};
```

The MDX body is plain markdown today (h1/h2/h3, paragraphs, lists, links, **bold**, *italic*). I'm OK adding a real MDX compiler later, but for now treat it as markdown. You can render it inline OR alongside variant-specific decorative sections (hero photos, service cards built from a static list, etc.).

## Conversion priorities (rank-ordered)

1. **Click the phone number** — biggest single conversion driver. Phone visible in 4 places: header, hero, after-services CTA, mobile-sticky bar.
2. **Submit the contact form** — backup for after-hours. Form: name, phone, what-they-need-help-with, optional zip. POSTs to `/api/lead`.
3. **Read more / build trust** — service detail pages, about page, blog posts. Each must end with a phone CTA.
4. **Local relevance** — service-area pages, neighborhood mentions, "We serve {city} and {nearby1}, {nearby2}, {nearby3}".

## Visual goals

- Looks like a **single local small business**, not a SaaS landing page or a generic agency site.
- Looks **trustworthy at a glance** — confident type, a hero photo (placeholder OK), explicit "we serve {city}", license/insured slot, response-time promise.
- **Doesn't scream "lead gen template"** — vary the hero treatments, service-card layouts, color choices.
- The first 600px (mobile fold) must contain: business name, niche+city headline ("Gutter Cleaning in Boise, ID"), one trust line ("Licensed and insured. Free quotes."), phone CTA, secondary form/contact CTA.
- Use placeholder images via `https://images.unsplash.com/...` or `next/image` placeholders so I can swap to real photos per site.

## Variant identity examples

Don't take these literally — they're a starting point.

- **Trade-classic:** dark navy + safety-orange accent, condensed sans + serif headline mix, bold capitalized headers, hero with a tradesperson photo overlay, service cards as numbered tile grid, big phone number in the header bar, "Family-owned. We answer the phone." trust line.
- **Clean modern:** white/neutral with a single color accent (sky blue or emerald), large geometric hero with gradient, sans-serif throughout, card-based services with subtle icons, an inline FAQ accordion, soft shadows.
- **Premium curated:** off-white background, serif display + clean sans body, full-bleed editorial hero photo, generous whitespace, "By appointment" tone, testimonial-quote section, slower visual rhythm.
- **Bright approachable:** warm cream + a friendly accent (coral, teal), rounded everything, hand-drawn underline accents, illustration spots in service cards, conversational copy tone, prominent "Book online" + phone.

## Deliverables format

For each variant, deliver:

1. **One screenshot or visual mockup** of the home page (mobile + desktop) so I can pick before going further.
2. After I pick: **drop-in React + Tailwind v4 source** for the variant — `app/layout.tsx`, all 6 page files, a `components/` folder with the variant-specific shell + section components, and a `globals.css` with the Tailwind v4 setup + variant-specific CSS custom properties for colors and fonts.
3. A short **README.md per variant** explaining: which niche categories it fits, the color/font tokens, any third-party assets used (with license notes), and any deliberate trade-offs.

Codebase structure to match (I'll wire each variant into this):

```
apps/
  site-template-classic/      # one app per variant
  site-template-modern/
  site-template-premium/
  site-template-bright/
```

## What I already have that you should NOT recreate

- A working Next.js 16 + Tailwind v4 app skeleton at `apps/site-template/` (current plain version).
- A `lib/content.ts` loader that reads `content.json` and exports a typed `Bundle`.
- A `materializeSite()` function in the agent that copies the chosen template to a temp dir and writes `content.json` + `.env.production` per site.
- Tracking-number injection via `NEXT_PUBLIC_TRACKING_NUMBER`.
- Schema.org JSON-LD rendering in the `PageBody` component.

Your job is the visual + structural design + the per-variant section components. I'll handle wiring the new variants into the Site Builder agent's variant-selector.

## Ask me clarifying questions before designing

If anything's ambiguous (variant count, color directions, whether to use a UI library like shadcn, component library style, animation strategy) — ask before producing mockups. Better to iterate on direction than redo finished work.

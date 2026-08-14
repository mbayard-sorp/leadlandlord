# Claude Design prompt — Aligned Advisors (Custom Sites site #2)

Copy everything below the line into Claude Design.

---

# Design brief: Aligned Advisors

## 0. What you are producing

Design a complete, production-ready website design for **Aligned Advisors** — a dental-specialized family office (CFO/bookkeeping, tax strategy, wealth management, practice transitions) serving dentists and DSOs, based in Oceanside, CA.

There is an existing prototype at **https://dental-wealth-navigator.replit.app/**. Treat it as the **content, information-architecture, and brand-direction source of truth**, and as a visual starting point you are expected to improve — not as a pixel spec to copy. Walk every route: `/`, `/services`, `/about`, `/insights`, `/contact`, `/assessment`.

Your output is handed to an engineer who implements it inside an existing Next.js 16 + Sanity monorepo, on a shared multi-tenant renderer. **Anything that violates the constraints in §2–§7 gets thrown away and redesigned.** Read those sections before you design anything.

---

## 1. The platform you are designing for

This site becomes the **second** site on LeadLandlord's "Custom Sites" line (ADR 0033) — client-owned standalone sites served out of one shared Next.js app (`apps/site-host`) and one shared Sanity project. Site #1 is a construction-ADR law practice (`constructionadrservices.com`).

Hard facts about the runtime:

| Fact | Consequence for you |
|---|---|
| One Next.js app serves every site. The `Host` header maps to a `siteKey`, which internally rewrites `/*` into a private route namespace (e.g. `/cadr/*` for site #1). | Your CSS must be **fully scoped to one root class** and must not leak. See §6. |
| **Sanity is the only data store.** There is no Postgres row, no CRM, no admin app for this line. | Every piece of content you design must be authorable as a Sanity document or page-builder block. Nothing may depend on a database, a login, or a server-side integration. |
| Pages are assembled from an **ordered array of page-builder blocks** (`csPage.pageBuilder[]`), rendered in array order by a `switch` statement. | Design pages as **stacks of reusable, order-independent sections**, not as one bespoke layout. Any section must survive being moved up/down or removed. |
| Long-form bodies are **Sanity Portable Text**, rendered through a shared `<Prose>` component. | Rich text is `h2/h3/h4`, blockquote, bullet/number lists, bold, italic, links, and inline images with alt+caption. Nothing else. Don't design rich-text bodies that need custom inline widgets. |
| **React Server Components by default.** Per-request SSR (not static export). | Interactivity is a deliberate, itemized exception — see §5.4. |
| **Plain hand-written CSS. No Tailwind on this line.** Site #1 is a single ~1,800-line scoped stylesheet. | Deliver real CSS, not utility classes. See §6. |
| Fonts load via `next/font/google` only. Images via `next/image` from `cdn.sanity.io`. | No `<link>` to Google Fonts, no CDN icon fonts, no external scripts, no remote images from arbitrary hosts. |
| Lead forms POST to a thin `/api/cs-lead` route → Zod validation + honeypot + rate limit → Resend email to a configured recipient list. | Forms are simple field sets that email a recipient. No scheduling integration, no payment, no file upload, no CRM push. If a form needs more, call it out as a dependency rather than assuming it. |
| The site's own GTM container is injected; LeadLandlord's central GA4 is deliberately **not** loaded. | Any analytics event you spec is a GTM/dataLayer event. |
| Every Custom Site **launches noindexed** and is flipped to indexable only at DNS cutover. | Not your problem, but don't design anything that assumes live search traffic on day one. |

**Assumed identifiers** (confirm with the engineer before finalizing):
- `siteKey`: `alignedadvisors`
- route namespace: `aa`
- CSS root class: **`.cs-aa`**
- production domain: `alignedadvisors.com`

---

## 2. The existing content model — map to it first

These Sanity document types already exist and are shared across the Custom Sites line. **Reuse them wherever the mapping is honest.** They are `cs`-prefixed and were named for a legal practice; the *field shapes* are what matter, not the labels. Studio labels can be relabeled per site by the engineer — do not propose renaming a type just because its name says "attorney."

| Existing type | Fields (abridged) | Proposed Aligned Advisors use |
|---|---|---|
| `csSite` | siteKey, name, customDomain, tagline, phone, cellPhone, email, address (street/unit/city/state/zip), mapUrl, mapEmbedUrl, geo, logo, footerLogo, bannerImage, favicon, ogImage, navigation[] (label/href + one dropdown level), footerNav[], leadRecipients[], gtmContainerId, sameAs[], titleTemplate, areaServed[], organizationType, openingHours[], robotsDisallow, redirects[], seo | The single settings doc. `organizationType` becomes `FinancialService` (not `LegalService`). |
| `csPage` | site→, title, slug, bannerImage, **pageBuilder[]**, seo, publishedAt, modifiedAt | Home, Services, About, Contact, Assessment, Privacy, Terms, Disclosures. |
| `csPracticeArea` | site→, title, slug, excerpt, heroImage, cardImage, body (Portable Text), faqs[], order, seo | The **7 focus areas** (Complete Dental Family Office, Dental CFO & Bookkeeping, Tax Strategy & Accounting, Practice Profitability, Income Beyond the Chair, Growth/Acquisition/Exit, DSO & Multi-Practice Advisory). |
| `csAttorney` | site→, name, slug, jobTitle, photo, bio (Portable Text), bioSections[]{heading, content}, credentials[]{name,issuer,year,url}, barAdmissions[], arbitratorPanels[], sameAs[], email, phone, vCard | The **team members** (Jonathan Moffat, Austin Moffat, etc. — and Leroy the office dog). `barAdmissions`/`arbitratorPanels` simply stay empty; `credentials[]` carries CPA/CFP/designations. |
| `csPublication` | site→, title, slug, kind (article \| publication \| presentation), excerpt, body, publishedAt, modifiedAt, externalEvent, externalDate, coAuthors, pdf, featuredImage, author→, seo | Podcast episodes and speaking engagements. **Note the gap:** there is no episode number, no duration, no per-platform listen URL. See §5. |
| `csTestimonial` | site→, quote, author, role, rating (1–5, optional), order, featured | Client quotes. |
| `csBadge` | site→, name, image (+alt), url, order | The "companies that trust us" logo wall, plus association/affiliation marks. |

**Objects available inside blocks:** `csSeo` (metaTitle, metaDescription, ogImage, noindex, canonicalOverride), `csAddress`, `csNavLink`/`csNavChildLink`, `csFaqItem` (question/answer), `csBody` (Portable Text), `csRedirect`, `csCredential`, `csBarAdmission`.

---

## 3. The existing page-builder blocks

Twelve blocks exist today. If you use one, **your CSS must style the exact class names it already emits** (§4) — the components are shared across sites and will not be forked for you.

| Block | Fields | Renders as |
|---|---|---|
| `csHeroBlock` | eyebrow, heading (req), subheading, ctaLabel, ctaHref, backgroundImage | Full-bleed hero, optional bg image + overlay, single CTA. `.cs-hero` |
| `csIntroBlock` | eyebrow, heading, body (PT), ctaLabel, ctaHref, layout (`split`\|`stacked`), bodyDividers, topRule | Two-column or stacked prose section. `.cs-intro-grid` / `.cs-intro-stacked` |
| `csPracticeGridBlock` | eyebrow, heading, mode (`all`\|`selected`), areas[]→csPracticeArea | Card grid of services. `.cs-grid-3`, `.cs-card` |
| `csAttorneyBlock` | attorney→, showFullProfile | **One** person: summary + link, or full profile. `.cs-attorney` |
| `csTestimonialsBlock` | items[]→csTestimonial, autoRotate | Quote carousel. `.cs-testimonials` |
| `csBadgeRowBlock` | badges[]→csBadge | Logo/badge row. `.cs-badge-row` |
| `csPublicationsBlock` | eyebrow, heading, limit, ctaLabel, ctaHref | Recent-publications list. `.cs-pub-card` |
| `csCalloutBlock` | label, quote, linkLabel, linkHref | Pull-quote callout. `.cs-callout` |
| `csRichTextBlock` | content (PT) | Prose slab. `.cs-prose` |
| `csContactCtaBlock` | eyebrow, heading, body, showForm | Contact section, optional lead form. `.cs-contact-grid` |
| `csCtaBannerBlock` | heading, ctaLabel, ctaHref | Full-width CTA band. `.cs-cta-banner` |
| `csFaqBlock` | heading, items[]{question, answer} | FAQ accordion + FAQPage JSON-LD. |

---

## 4. Shared chrome — theme it, don't redesign its markup

These components are shared and already emit fixed class names. You **must** provide styling for all of them in your stylesheet. You may fully redesign their *appearance*; you may not change their DOM without flagging it as an engineering change.

- `TopBar` — `.cs-topbar`, `.cs-topbar-inner`, `.cs-topbar-tagline`, `.cs-topbar-contact`, `.cs-topbar-email`
- `SiteHeader` + mobile drawer — `.cs-header`, `.cs-header-inner`, `.cs-header-logo`, `.cs-brand`, `.cs-brand-name`, `.cs-brand-sub`, `.cs-header-phone`, `.cs-header-phone-icon`, `.cs-header-phone-text`, `.cs-nav`, `.cs-nav-desktop`, `.cs-nav-links`, `.cs-nav-link`, `.cs-nav-dropdown`, `.cs-nav-caret`, `.cs-nav-toggle`, `.cs-nav-toggle-bar`, `.cs-drawer`, `.cs-drawer-overlay`, `.cs-drawer-close`, `.cs-drawer-links`, `.cs-drawer-sublinks`
- `StickyBar` (mobile call CTA) — `.cs-sticky-bar`, `.cs-sticky-spacer`
- `SiteFooter` — `.cs-footer`, `.cs-footer-grid`, `.cs-footer-logo`, `.cs-footer-tagline`, `.cs-footer-legal`, `.cs-footer-legal-links`
- `PageHeader` (interior banner) — `.cs-page-header`, `.cs-page-header-bg`, `.cs-page-header-inner`, `.cs-page-header-skyline`, `.cs-breadcrumb-bar`
- `Prose` (Portable Text) — `.cs-prose`, `.cs-prose--dividers`, `.cs-lead`
- `ContactForm` — `.cs-form-row`, `.cs-form-field`, `.cs-form-label`, `.cs-form-required`, `.cs-form-input`, `.cs-form-textarea`, `.cs-form-field-error`, `.cs-form-message`, `.cs-form-message--success`, `.cs-form-message--error`, `.cs-form-honeypot`
- `ArticlesGrid` / `ArticleLayout` / `RelatedServices` — `.cs-card`, `.cs-card-media`, `.cs-card-excerpt`, `.cs-article-meta`, `.cs-article-related`, `.cs-related-list`, `.cs-services-rail`, `.cs-services-rail-cta`
- Shared primitives — `.cs-container`, `.cs-section`, `.cs-section--muted`, `.cs-section--navy` (inverse band), `.cs-btn`, `.cs-btn-primary`, `.cs-btn-secondary`, `.cs-eyebrow`, `.cs-eyebrow--inverse`, `.cs-link`, `.cs-link-arrow`, `.cs-grid-3`, `.cs-card`, `.cs-skip-link`

Rename `.cs-section--navy` in your design language if navy isn't your inverse color — but keep the class name and tell the engineer what it now means.

---

## 5. The gap: sections the prototype has and the platform doesn't

Most of the prototype's home and services pages have **no existing block**. This is the substantive design work. For each, decide: reuse an existing block, extend one, or propose a new one.

### 5.1 Known gaps (non-exhaustive — audit the prototype yourself)

| Prototype section | Notes |
|---|---|
| Stat rail — "SERVING DENTISTS SINCE 2008" + 400+ / 93+ / $1.2B+ | Repeating `{value, label}` items with an optional eyebrow. |
| Logo wall — "companies that trust us" | Probably `csBadgeRowBlock` with a heading; confirm it needs no new fields. |
| Lead-magnet cards — two numbered benchmark-report downloads | Needs a gated-vs-ungated decision. A gated download requires a form → email delivery, which the current lead route does not do. Flag it. |
| Three-up value props ("A complete Money Team" / "Practice + personal" / "A clear roadmap") | Icon + heading + body triple. |
| **The Wealth Journey** — proprietary 5-stage framework, interactive (hover/click/scroll to reveal each stage) | The signature section. Design its no-JS fallback explicitly. |
| Case-study results — 3 cards with before→after figures, headline, narrative | May warrant its own document type rather than an inline block; recommend one way and say why. |
| NumbersIQ™ product callout with a benchmark-meter visualization | Data-viz-ish. It links out to numbersiq.com. |
| Podcast strip (home) + Insights page with Podcast/Speaking tabs and an episode list | `csPublication` lacks episode number, duration, and per-platform listen URLs. |
| Services page — 7 numbered focus areas with deliverable counts, and the "80+ services / 187 checkpoints" line | |
| "Traditional X vs Aligned Advisors" comparison rows (5 pairs) | |
| Team grid (8 people incl. the office dog) | `csAttorneyBlock` renders one person only. A grid block is needed. |
| Consultation form with First/Last name and a "call type" select (Goal / Tax / Practice Profitability / Other) | Wider than the existing `ContactForm` field set. Spec the exact fields; the engineer extends the Zod schema and the block. |
| `/assessment` — multi-step Wealth Journey quiz ending in a result + lead capture | The largest interactive surface. Spec question flow, progress, results mapping to the 5 stages, and what gets emailed. |

### 5.2 How to propose a new block

For each new block give:

```
name: csStatRailBlock
title: Stat Rail
type: object
fields:
  - eyebrow: string
  - items: array of object { value: string (req), label: string (req), footnote: string }
    validation: min 2, max 4
  - inverse: boolean (initialValue false)
preview: { title: eyebrow, subtitle: "N stats" }
```

Rules:
- Sanity primitives only: `string`, `text`, `number`, `boolean`, `image` (+ `alt`), `file`, `url`, `slug`, `datetime`, `geopoint`, `array`, `reference`, `object`, plus the existing `csBody`, `csFaqItem`, `csSeo`, `csAddress`.
- References point at existing document types. If a section genuinely needs a **new document type**, propose it separately with a rationale — that's a bigger decision than a block.
- Give every field a `description` an author will actually read, plus `validation` and `initialValue` where they help.
- Give each block a `preview` so the Studio array isn't a wall of "Object".
- Every block must render sensibly when optional fields are empty. Spell out the empty state.
- **Never** put per-site colors, fonts, or spacing in Sanity fields. Theming lives in CSS. (A sibling business line shipped per-document color fields and had to rip all eight of them out.)

### 5.3 No fake content

This is a financial-services firm. Testimonials, ratings, client counts, dollar figures, credentials, and affiliations are **client-supplied facts**. Design empty states that degrade to nothing rather than to placeholder people, fake logos, or invented numbers. Never spec a component that emits `Review`/`AggregateRating` structured data without a real, attributed rating.

### 5.4 Interactivity budget

Server-rendered by default. For every interactive element, name it in a **client-component inventory** with: what it does, why CSS alone can't, its no-JS fallback, and its rough JS weight. Prefer CSS-only (`:hover`, `:focus-within`, `<details>`, scroll-snap, `prefers-reduced-motion`) over JS. Existing precedent on this line: the mobile nav drawer, the testimonial carousel, the lead form, and the FAQ accordion are the *only* client components.

---

## 6. Design-system contract

### 6.1 Scoping
Everything lives under one root class:

```css
.cs-aa { /* tokens + base */ }
.cs-aa .cs-hero { … }
```

No global selectors, no `:root`, no element selectors outside `.cs-aa`, no `!important`. This stylesheet is imported by exactly one layout file and must not affect any other site in the app.

### 6.2 Tokens
Define all design decisions as `--cs-*` custom properties on `.cs-aa`. Mirror this shape (site #1's contract) and extend it as your design needs:

```
Color:   --cs-ink, --cs-text, --cs-muted, --cs-paper, --cs-hairline,
         a primary brand color + an inverse-safe variant,
         an accent + an AA-safe accent variant for small text/filled buttons
Shape:   --cs-radius-control, --cs-radius-card, --cs-radius-card-lg
Space:   --cs-space-1…6
Layout:  --cs-container-max, --cs-section-pad (with 899px and 639px step-downs)
Type:    --cs-font-display, --cs-font-body (set by next/font)
```

Nothing in your CSS may hardcode a hex, a font stack, or a magic spacing number outside the token block.

### 6.3 Contrast audit — required deliverable
Open your stylesheet with a comment block listing **every** foreground/background pair you use, its computed contrast ratio, and PASS/FAIL against WCAG AA (4.5:1 normal text, 3:1 large text and UI). Site #1's audit caught that its brand accent failed AA for small text on light backgrounds and required a darkened variant for buttons and labels — expect to do the same. Any pair below threshold must either be removed or explicitly restricted to a use where it passes, and that restriction stated.

Also required: visible `:focus-visible` styling, a working skip link, no text baked into images, `prefers-reduced-motion` honored for every animation.

### 6.4 Responsive + performance
- Mobile-first. Verify 360 / 390 / 768 / 1024 / 1440.
- Breakpoints: 639px and 899px (match site #1 so the shared components behave).
- Hero image is `priority`, sized to avoid CLS. No layout shift on load. Keep total JS small — these pages are judged on Core Web Vitals.

### 6.5 Brand direction
The prototype's current direction is: deep navy (`hsl(212 60% 22%)` primary, `hsl(213 96% 12%)` ink) + a gold/brass accent (`hsl(41 64% 48%)`) on warm off-white paper (`hsl(40 38% 97%)`), Montserrat display over Open Sans body, 4px radius. That reads as credible-financial but is close to generic. **You are expected to push it** — propose a sharper, more distinctive direction that still reads as trustworthy to a 45-year-old practice owner deciding who touches their money. If you keep navy+gold, earn it. Note that site #1 on this platform is also navy+brass serif-legal; visual differentiation between the two Custom Sites is a plus.

---

## 7. Deliverables

1. **Design rationale** — one page: the positioning, the audience, the visual thesis, what you changed from the prototype and why.
2. **Token sheet** — the full `--cs-*` block, annotated.
3. **Contrast audit** — per §6.3.
4. **Page-by-page section specs**, each section mapped to a named block (existing or new), in page-builder order:
   - Home
   - Services (index) + service/focus-area detail (`csPracticeArea`)
   - About (incl. team grid)
   - Insights (podcast + speaking tabs) + article/episode detail
   - Contact
   - Assessment (the quiz — full flow, states, and results)
   - 404
   - Privacy / Terms / **Disclosures**
5. **The stylesheet** — production-ready CSS, scoped to `.cs-aa`, covering every class in §4 plus everything you add. This is a real deliverable, not a sketch.
6. **New block schema proposals** — per §5.2.
7. **New document type proposals** (if any) — with rationale.
8. **Client-component inventory** — per §5.4.
9. **Fonts** — exact `next/font/google` families, weights, styles, and the CSS variable names.
10. **Asset list** — every photo, logo, icon, and illustration the design needs, with dimensions, crop guidance, and alt-text direction. Say which are client-supplied vs. stock vs. generated.
11. **States** — hover / focus / active / disabled / loading / error / empty for every interactive element.

---

## 8. Content and compliance notes

- Real NAP from the prototype: 858.752.7179 · info@alignedadvisors.com · 1696 Ord Way, Oceanside, CA 92056.
- Divisions referenced: DSO CFO, Aligned Tax & Accounting, Wealth Management, Practice Transitions. NumbersIQ™ is a linked external product (numbersiq.com).
- Financial-services marketing carries disclosure obligations. The prototype footer already has Privacy / Terms / Disclosures links. Design a footer disclosure slot and a page template for it; flag any performance claim ("$1.2B+ practice revenue managed", "$3.98M → $17.8M") as requiring client sign-off and probably a disclaimer adjacent to it.
- `organizationType` is `FinancialService`; structured data should describe an organization + its services + its people, not a legal practice.

---

## 9. Acceptance checklist

- [ ] Every page is expressible as an ordered array of blocks; no page needs bespoke one-off layout code.
- [ ] Every section maps to an existing block or a fully-specified new `cs*Block`.
- [ ] All new fields use Sanity primitives; no color/font/spacing fields in Sanity.
- [ ] Every existing shared class in §4 is styled.
- [ ] Everything is scoped under `.cs-aa`; no globals, no Tailwind, no `!important`.
- [ ] All color/type/spacing flows through `--cs-*` tokens.
- [ ] Contrast audit present; every pair passes AA or is explicitly restricted.
- [ ] Focus-visible, skip link, `prefers-reduced-motion`, semantic headings (one `h1` per page, no skipped levels), alt text on every image.
- [ ] Client-component inventory is complete; every interactive piece has a no-JS fallback.
- [ ] Empty states specified for every optional field; no fake reviews, logos, credentials, or numbers.
- [ ] `next/font` only, `next/image` only, no external CSS/JS/font/icon CDNs.
- [ ] Mobile-first, verified 360→1440, breakpoints at 639 and 899.
- [ ] Hero has no CLS; JS budget stated.

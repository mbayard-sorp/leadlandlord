# Claude Design prompt: CueDuo (Custom Sites site #3)

Copy everything below the line into Claude Design, in the project that already holds
`CueDuo Brand Guide.dc.html`, `CueDuo.dc.html` and `CueDuo v2.dc.html`
(`https://claude.ai/design/p/0819d991-832c-48c1-818a-e6102d8a36e2`).

**Open questions to settle before sending (or mark TBC in the prompt):**

| # | Question | Default assumed below |
|---|---|---|
| 1 | Production domain | `cueduo.com` (marked TBC) |
| 2 | Route namespace / CSS root class | `cd` / `.cs-cueduo` |
| 3 | Real pricing tiers and prices | Marked TBC, plan *shape* designed from the in-app paywall |
| 4 | Device naming we are allowed to use in copy | Brand guide says "folding phones", not a product name |
| 5 | Does the site ship dark mode? | Light only at launch, dark specified but deferred (see §9.5) |
| 6 | App Store launch date / whether the badge links anywhere yet | "Coming to the App Store" state designed alongside the live state |

---

# Design brief: CueDuo

## 0. What you are producing

Design a complete, production-ready marketing website for **CueDuo**, a teleprompter and
recorder built for folding phones. The product's one-line promise is already written:
**"Look up. Say it once."**

Your output is handed to an engineer who implements it inside an existing Next.js 16 +
Sanity monorepo, on a shared multi-tenant renderer. **Anything that violates the
constraints in §3 to §9 gets thrown away and redesigned.** Read those sections before you
design anything.

This is not a greenfield brand exercise. The brand is finished and locked (§1, §10). Your
job is to translate an existing app brand onto the web, inside a page-builder platform
that was built for professional-services sites and has never rendered an app marketing
site before. The interesting work is in §7.

---

## 1. Sources of truth

Three files already exist in this project. Read all three before designing.

| File | Status | How to treat it |
|---|---|---|
| `CueDuo Brand Guide.dc.html` (v1.1) | **Locked.** | The brand contract. Colors, type, logo construction, icon family, materials, voice, photography direction and App Store screenshot rules all come from here. You may not invent alternatives. Where the web forces a deviation, say so explicitly and justify it (§9.6, §10.3). |
| `CueDuo v2.dc.html` | **Product truth.** | The interactive app prototype. Nine screens: `paywall`, `library`, `editor`, `preflight`, `countdown`, `recording`, `review`, `edit`, `share`. Every device screen you put on the marketing site must be a real frame from this prototype, not an invented UI. Note: one stale design note inside it says "Amber is the brand cue". That is wrong and superseded. The accent is Cobalt `#2E5BFF`. |
| `CueDuo.dc.html` | **Superseded.** | v1 of the prototype. Read it only for history. |

The brand guide also carries finished copy. **Reuse it verbatim rather than writing new
lines that say the same thing:**

- Positioning: "CueDuo is a teleprompter and recorder built for folding phones. Your
  script on one screen, the lens on the other, so you talk to people, not to a reflection
  of yourself."
- The four feature titles and bodies: "Two screens, one take" / "Eyes on the lens" /
  "Cut where you stand" / "Your pace, not ours".
- The four App Store headlines: "Look up. Say it once." / "Your script, beside the lens." /
  "Cut the take right there." / "Every take, kept."
- The voice do/don't pairs ("Setup complete!" → "You're ready.", "Recording initiated" →
  "Rolling.", and three more).

---

## 2. The product, in facts you can design against

- A teleprompter and recorder for folding phones. The script goes on the **outer**
  display next to the camera module; setup, review and editing happen on the **inner**
  display.
- Device geometry the prototype models: inner display 951 × 1345 pt (7.6", corner radius
  44), outer display 380 × 800 pt beside the 48MP module. Inner safe areas are asymmetric
  (top 24, bottom 20, leading 16, trailing 28 on the hinge side).
- During a take the outer screen shows script, elapsed time and record state **only**.
- In-app flow: write or import a script → preflight → countdown → record → review →
  edit (trim, titles, photos, transitions) → share/export.
- The library keeps every take. Takes, photos and titles are insertable clips;
  transitions belong to the clip they lead out of.
- Monetisation is an in-app paywall with plans. Tiers and prices are **TBC** and must
  come from the client. Design the plan card shape, not invented prices.
- Audience: people who talk to camera and hate doing it. Founders, teachers, coaches,
  recruiters, solo marketers. They are not filmmakers and will not read a feature matrix.

---

## 3. The platform you are designing for

This becomes the **third** site on LeadLandlord's "Custom Sites" line (ADR 0033): client
sites served out of one shared Next.js app (`apps/site-host`) and one shared Sanity
project. Site #1 is a construction-ADR law practice, site #2 a dental family office. You
are the first site on this line that is not a professional-services firm.

| Fact | Consequence for you |
|---|---|
| One Next.js app serves every site. The `Host` header maps to a `siteKey`, which rewrites `/*` into a private route namespace (`/cadr/*`, `/aa/*`, and `/cd/*` for you). | Your CSS must be **fully scoped to one root class** and must not leak. See §9.1. |
| **Sanity is the only data store.** No Postgres row, no CRM, no admin app on this line. | Every piece of content must be authorable as a Sanity document or page-builder block. Nothing may depend on a database, a login, or a server-side integration. |
| Pages are an **ordered array of page-builder blocks** (`csPage.pageBuilder[]`), rendered in array order by a `switch`. | Design pages as **stacks of reusable, order-independent sections**, not one bespoke layout. Every section must survive being moved or removed. |
| Long-form bodies are **Sanity Portable Text** through a shared `<Prose>` component. | Rich text is `h2/h3/h4`, blockquote, lists, bold, italic, links, inline images with alt + caption. Nothing else. No custom inline widgets inside prose. |
| **React Server Components by default.** Per-request SSR, not static export. | Interactivity is a deliberate, itemized exception. See §8.4. |
| **Plain hand-written CSS. No Tailwind on this line.** Site #1 is ~2,100 lines, site #2 ~1,700, each a single scoped stylesheet. | Deliver real CSS, not utility classes. |
| Fonts load via `next/font/google` only, registered in a per-line font module. Images via `next/image` from `cdn.sanity.io`. | No `<link>` to Google Fonts, no icon fonts, no external scripts, no remote images from arbitrary hosts. **This collides with the brand guide's type rule. See §9.6.** |
| Forms POST to a thin `/api/cs-lead` route: Zod validation + honeypot + rate limit + Resend email to a recipient list. | A form is a field set that emails someone. No payment, no file upload, no CRM push, no account creation. |
| The site's own GTM container is injected. LeadLandlord's central GA4 is deliberately **not** loaded. | Any analytics event you spec is a GTM/dataLayer event. Name the App Store click event explicitly. |
| Every Custom Site launches with `robotsDisallow: true` and is flipped to indexable only at DNS cutover. | Don't design anything that assumes live search traffic on day one. |
| A new site is one entry in `customsites-registry.ts` plus one `app/` folder. The registry requires a `servicesPath` and an `insightsPath` and these are **append-only once live**. | Commit to your URL vocabulary now. Proposed: `servicesPath: 'features'`, `insightsPath: 'updates'`. |

**Assumed identifiers** (confirm with the engineer before finalizing):
- `siteKey`: `cueduo`
- route namespace: `cd`
- CSS root class: **`.cs-cueduo`**
- production domain: `cueduo.com` (TBC)

---

## 4. The existing content model, map to it first

These Sanity document types are shared across the Custom Sites line. **Reuse them wherever
the mapping is honest.** They are `cs`-prefixed and were named for a legal practice. The
*field shapes* are what matter, not the labels: Studio labels get relabeled per site by
the engineer. Do not propose renaming a type just because its name says "attorney".

| Existing type | Fields (abridged) | Proposed CueDuo use |
|---|---|---|
| `csSite` | siteKey, name, customDomain, tagline, phone, email, address, mapUrl, geo, logo, footerLogo, bannerImage, favicon, ogImage, navigation[], footerNav[], leadRecipients[], gtmContainerId, sameAs[], titleTemplate, areaServed[], organizationType, openingHours[], robotsDisallow, redirects[], seo | The settings doc. `organizationType` becomes `SoftwareApplication` (default is `LegalService`). Several fields are dead weight for an app (phone, address, openingHours, areaServed): say which you want hidden in Studio rather than filled with noise. |
| `csPage` | site→, title, slug, bannerImage, **pageBuilder[]**, seo, publishedAt, modifiedAt | Home, Features, Pricing, Support, Updates, Press, Privacy, Terms. |
| `csPracticeArea` | site→, title, slug, excerpt, heroImage, cardImage, body (PT), faqs[], order, seo | **Feature detail pages.** One per capability: Prompter, Recording, Editing, Library, Export/Share. `faqs[]` per feature is a real win for AI answer surfaces. |
| `csPublication` | site→, title, slug, kind (article \| publication \| presentation), excerpt, body, publishedAt, modifiedAt, coAuthors, pdf, featuredImage, author→, seo | **Release notes and posts** at `/updates`. `kind` can carry release vs article. |
| `csTestimonial` | site→, quote, author, role, rating (1 to 5, optional), order, featured | App Store reviews and beta quotes, **only when real and attributed**. See §13.3. |
| `csBadge` | site→, name, image (+alt), url, order | Press logos, awards, "Featured on". |
| `csAttorney` | site→, name, slug, jobTitle, photo, bio (PT), bioSections[], credentials[], sameAs[], email, phone | The maker / team, if there is a "who built this" page. Optional. |
| `csJourneyStage` | referenced by `csJourneyBlock`, renders `/journey/<slug>` pages when enabled | **"How a take happens"** stages: Write → Unfold → Preflight → Record → Cut → Share. Decide whether each stage needs its own page or is section-only. |
| `csCaseStudy`, `csAssessment` | case studies, multi-step quiz | Almost certainly unused. Say so rather than inventing a use. |

**Objects available inside blocks:** `csSeo` (metaTitle, metaDescription, ogImage,
noindex, canonicalOverride), `csAddress`, `csNavLink` / `csNavChildLink`, `csFaqItem`,
`csBody` (Portable Text), `csRedirect`, `csCredential`.

---

## 5. The existing page-builder blocks

Twenty-five blocks exist today. If you use one, **your CSS must style the exact class
names it already emits** (§6). These components are shared across three sites and will not
be forked for you.

| Block | Fields | Likely CueDuo verdict |
|---|---|---|
| `csHeroBlock` | eyebrow, heading, headingEmphasis, subheading, ctaLabel, ctaHref, backgroundImage, backgroundVideo | Close but not enough. An app hero needs a device render and an App Store badge. See §7. |
| `csIntroBlock` | eyebrow, heading, body (PT), ctaLabel, ctaHref, layout (split \| stacked), bodyDividers, topRule | **Use.** The positioning paragraph. |
| `csValuePropsBlock` | eyebrow, heading, items[]{icon, heading, body}, backgroundImage | **Use, with a caveat.** `icon` is a string key into a shared icon map. CueDuo's glyph family (§10.4) has to be added to it. It is titled "3-up" and the brand has **four** features: confirm it survives 4 items or spec the change. |
| `csJourneyBlock` | eyebrow, heading, intro, stages[]→csJourneyStage, ctaLabel, ctaHref | **Use.** "How a take happens." |
| `csCompareBlock` | eyebrow, heading, intro, leftLabel, rightLabel, rows[], leftWho, leftQuote, rightQuote | **Use.** "Phone propped on a stack of books" vs CueDuo. |
| `csFaqBlock` | heading, items[]{question, answer} | **Use.** Emits FAQPage JSON-LD. |
| `csCtaBannerBlock` | heading, ctaLabel, ctaHref | Needs an App Store badge variant. See §7. |
| `csContactCtaBlock` | eyebrow, heading, body, showForm, formVariant, formFootnote, checklist[] | **Use** for `/support`. This is the App Store support URL. |
| `csRichTextBlock` | content (PT) | **Use.** Prose slabs. |
| `csDisclosureBlock` | heading, lastUpdated, content (PT), note | **Use** for Privacy and Terms. |
| `csTestimonialsBlock` | items[]→csTestimonial, autoRotate | Use **only** when real reviews exist. |
| `csBadgeRowBlock` | eyebrow, heading, badges[]→csBadge, scroll | Use for press. |
| `csStatRailBlock` | eyebrow, items[]{value, label, footnote}, inverse | Only with real numbers. No invented download counts. |
| `csPracticeGridBlock` | eyebrow, heading, mode (all \| selected), areas[] | **Use** as the features index grid. |
| `csPublicationsBlock` | eyebrow, heading, limit, ctaLabel, ctaHref | **Use** for the updates strip. |
| `csFocusAreaListBlock` | eyebrow, heading, summaryLine, areas[], showDeliverableCounts | Possible alternative to a feature grid. Numbered list. |
| `csTabbedInsightsBlock` | eyebrow, tabs[]{label, sublabel, href, icon} | Possible for a Support hub. |
| `csEpisodeListBlock` | eyebrow, heading, kind, limit, showListenLinks, ctaLabel, ctaHref | Unlikely. |
| `csCalloutBlock` | label, quote, linkLabel, linkHref | Possible pull-quote. |
| `csAttorneyBlock`, `csTeamGridBlock` | one person / a grid | Only if there is a maker page. |
| `csCaseStudyGridBlock`, `csNumbersIqBlock`, `csLeadMagnetBlock`, `csAssessmentBlock` | | Almost certainly unused. Confirm and move on. |

Say explicitly, per block, whether you are using it, using it with changes, or not using
it. "Not using it" is a valid and useful answer.

---

## 6. Shared chrome, theme it, don't redesign its markup

These components are shared and emit fixed class names. You **must** provide styling for
all of them. You may fully redesign their *appearance*. You may not change their DOM
without flagging it as an engineering change.

- `TopBar`: `.cs-topbar`, `.cs-topbar-inner`, `.cs-topbar-tagline`, `.cs-topbar-contact`, `.cs-topbar-email`
- `SiteHeader` + mobile drawer: `.cs-header`, `.cs-header-inner`, `.cs-header-logo`, `.cs-brand`, `.cs-brand-name`, `.cs-brand-sub`, `.cs-header-phone`, `.cs-header-phone-icon`, `.cs-header-phone-text`, `.cs-nav`, `.cs-nav-desktop`, `.cs-nav-links`, `.cs-nav-link`, `.cs-nav-dropdown`, `.cs-nav-caret`, `.cs-nav-toggle`, `.cs-nav-toggle-bar`, `.cs-drawer`, `.cs-drawer-overlay`, `.cs-drawer-close`, `.cs-drawer-links`, `.cs-drawer-sublinks`
- `StickyBar` (mobile CTA): `.cs-sticky-bar`, `.cs-sticky-spacer`
- `SiteFooter`: `.cs-footer`, `.cs-footer-grid`, `.cs-footer-logo`, `.cs-footer-tagline`, `.cs-footer-legal`, `.cs-footer-legal-links`
- `PageHeader` (interior banner): `.cs-page-header`, `.cs-page-header-bg`, `.cs-page-header-inner`, `.cs-page-header-skyline`, `.cs-breadcrumb-bar`
- `Prose`: `.cs-prose`, `.cs-prose--dividers`, `.cs-lead`
- `ContactForm`: `.cs-form-row`, `.cs-form-field`, `.cs-form-label`, `.cs-form-required`, `.cs-form-input`, `.cs-form-textarea`, `.cs-form-field-error`, `.cs-form-message`, `.cs-form-message--success`, `.cs-form-message--error`, `.cs-form-honeypot`
- `ArticlesGrid` / `ArticleLayout` / `RelatedServices`: `.cs-card`, `.cs-card-media`, `.cs-card-excerpt`, `.cs-article-meta`, `.cs-article-related`, `.cs-related-list`, `.cs-services-rail`, `.cs-services-rail-cta`
- Shared primitives: `.cs-container`, `.cs-section`, `.cs-section--muted`, `.cs-section--navy` (inverse band), `.cs-btn`, `.cs-btn-primary`, `.cs-btn-secondary`, `.cs-eyebrow`, `.cs-eyebrow--inverse`, `.cs-link`, `.cs-link-arrow`, `.cs-grid-3`, `.cs-card`, `.cs-skip-link`

Two notes specific to you:

1. `.cs-section--navy` is the inverse band class. For CueDuo it means **Graphite**
   `#0E1114`. Keep the class name and tell the engineer what it now means.
2. `TopBar` and the header phone slot exist because the first two sites are
   phone-first service businesses. CueDuo has no phone number. Say whether the header
   phone slot is repurposed (App Store CTA) or suppressed, and spec the empty case.

---

## 7. The gap: an app site on a professional-services block library

This is the substantive design work. The block library has no concept of a device, a
screenshot, an app store, or a price. For each gap decide: reuse, extend, or propose new.

| Need | Notes |
|---|---|
| **App hero** | Headline + sub + App Store badge + a folding device render, half-open, both screens legible. `csHeroBlock` has one text CTA and a background image. This wants a foreground device slot, a badge, and a "coming soon" state for pre-launch. |
| **Device showcase** | The workhorse section: one real app screen (from `CueDuo v2.dc.html`) beside a heading and short body, alternating sides down the page. Needs the device frame, the screen image, an optional caption, and a light/graphite band toggle. |
| **The prompter band** | The brand's signature surface: `#050505`, white Semibold type at 1.3 line height, past and upcoming lines faded to 35%, sizes stepping 24 → 30 → 36 → 44. This is the one place white type appears on a light page. Design it as its own block. Its no-JS state must still read correctly (see §8.4): a static "current line" with faded neighbours is acceptable and probably better than an animation. |
| **Screenshot gallery** | The four App Store frames already specified in the guide (alternating porcelain and graphite, one headline, device cropped at the bottom edge, no badges, no arrows, no callouts). Decide whether the web reuses that exact treatment or a web-native variant. |
| **Pricing / plans** | Plan cards with name, price, period, note, "Recommended" flag, feature list, CTA, and a footnote line. Mirror the in-app paywall's structure so the site and the app agree. Prices are TBC: design with the real *shape*, placeholder values clearly marked. |
| **App Store CTA** | Apple's official badge asset, its own clear-space and minimum-size rules, plus a secondary "requires a folding phone running iOS X" qualifier line. Needed in the hero, at least one mid-page band, the footer, and the mobile sticky bar. |
| **Requirements / compatibility** | Small factual block: device support, iOS version, storage, languages. An app site that hides this annoys people. |
| **Feature detail template** | `csPracticeArea` gives you hero image, excerpt, Portable Text body and per-page FAQs. Show what a feature page looks like when it is mostly prose plus two screens. |
| **Support page** | FAQ + contact form + link to privacy. This is the URL submitted to App Store Connect, so it must stand alone and load fast. |
| **404 and "coming soon"** | Both in brand voice. No exclamation marks. |

### 7.1 How to propose a new block

For each new block give:

```
name: csDeviceShowcaseBlock
title: Device Showcase
type: object
fields:
  - eyebrow: string
  - heading: string (req)
  - body: text
  - screen: image (+ alt, req)
  - orientation: string (list: inner | outer | both) initialValue 'inner'
  - side: string (list: left | right) initialValue 'right'
  - band: string (list: porcelain | graphite | prompter) initialValue 'porcelain'
  - ctaLabel: string
  - ctaHref: string
preview: { title: heading, subtitle: eyebrow, media: screen }
```

Rules:
- Sanity primitives only: `string`, `text`, `number`, `boolean`, `image` (+ `alt`),
  `file`, `url`, `slug`, `datetime`, `geopoint`, `array`, `reference`, `object`, plus the
  existing `csBody`, `csFaqItem`, `csSeo`, `csAddress`.
- References point at existing document types. A genuinely new **document type** is a
  bigger decision: propose it separately with a rationale.
- Every field gets a `description` an author will actually read, plus `validation` and
  `initialValue` where they help.
- Every block gets a `preview` so the Studio array is not a wall of "Object".
- Every block must render sensibly when optional fields are empty. Spell out the empty
  state.
- **Never** put per-site colors, fonts or spacing in Sanity fields. Theming lives in CSS.
  A sibling business line shipped eight per-document color fields and had to rip all of
  them out.

---

## 8. Constraints on how it behaves

### 8.1 No fake content
No invented download counts, star ratings, review quotes, press logos, awards or "trusted
by" walls. Design empty states that **degrade to nothing**, not to placeholder people and
fake numbers. Never spec a component that emits `Review` or `AggregateRating` structured
data without a real, attributed rating.

### 8.2 No fake app
Every device screen on the site is a frame from `CueDuo v2.dc.html`. If a section needs a
screen the prototype does not have, say so and describe it rather than drawing a new UI
that engineering will then have to build.

### 8.3 Motion
The brand is "warm, human, unhurried". Nothing bounces. Honour
`prefers-reduced-motion` for every animation, including the prompter band and any
autoplaying video. If you spec a hero video, it is muted, looping, `playsinline`, has a
poster frame, and does not autoplay under reduced-motion.

### 8.4 Interactivity budget
Server-rendered by default. For every interactive element, name it in a **client-component
inventory** with: what it does, why CSS alone cannot, its no-JS fallback, and its rough JS
weight. Prefer CSS-only (`:hover`, `:focus-within`, `<details>`, scroll-snap,
`@media (prefers-reduced-motion)`) over JS. Existing precedent on this line: the mobile
nav drawer, the testimonial carousel, the lead form and the FAQ accordion are the **only**
client components across two live sites. Justify anything you add to that list.

---

## 9. Design-system contract

### 9.1 Scoping
Everything lives under one root class:

```css
.cs-cueduo { /* tokens + base */ }
.cs-cueduo .cs-hero { … }
```

No global selectors, no `:root`, no element selectors outside `.cs-cueduo`, no
`!important`. This stylesheet is imported by exactly one layout file and must not affect
any other site in the app.

### 9.2 Token mapping
The brand guide's CSS variables do not match this platform's naming. **Map, don't
rename mid-design.** Use this table and extend it:

| Brand guide | Value (light) | Platform token |
|---|---|---|
| `--lt-bg` Porcelain | `#EEF0F3` | `--cs-paper` |
| `--lt-surface` | `#FFFFFF` | `--cs-white` |
| `--lt-surface2` Fog | `#E2E5EA` | `--cs-surface` |
| `--lt-text` Ink | `#14171C` | `--cs-ink` (also display type) |
| `--lt-text2` Ink 2 | `#5B626E` | `--cs-muted` |
| `--lt-text3` Ink 3 | `#98A0AC` | `--cs-hairline-text` (decorative only, see §9.4) |
| `--acc-lt` Cobalt | `#2E5BFF` | `--cs-accent` (fills) |
| `--acc-text-lt` Accent Text | `#1F45D6` | `--cs-accent-ink` (accent as text on light) |
| `--acc-ink` | `#FFFFFF` | `--cs-on-accent` |
| `--dk-bg` Graphite | `#0E1114` | `--cs-graphite` (the inverse band, `.cs-section--navy`) |
| `--dk-surface` Graphite 2 | `#161A1F` | `--cs-graphite-surface` |
| `--dk-text` Paper | `#EEF1F5` | `--cs-inverse-text` |
| `--dk-text2` | `#98A0AC` | `--cs-inverse-muted` |
| `--acc-dk` Cobalt Bright | `#5B82FF` | `--cs-accent-inverse` (accent on graphite) |
| `--prompter` | `#050505` | `--cs-prompter` |
| `--rec` / `--rec-lt` | `#FF5257` / `#D93A3A` | `--cs-record` / `--cs-record-light` |

Also define, matching the shape site #1 and #2 use:

```
Shape:   --cs-radius-control, --cs-radius-card, --cs-radius-card-lg
         (brand guide: porcelain cards 28 to 32, glass 30 outer / 20 to 22 inner)
Space:   --cs-space-1…6
Layout:  --cs-container-max, --cs-container-pad, --cs-section-pad, --cs-measure
Type:    --cs-font-display, --cs-font-body, --cs-fs-*, --cs-lh-*, --cs-track-*
Elev:    --cs-shadow-card (guide: 0 10 30 @ 10%), --cs-shadow-glass
Glass:   --cs-glass, --cs-glass-border, --cs-glass-hi, --cs-glass-lo
Ambient: --cs-amb-1, --cs-amb-2
```

Nothing in your CSS may hardcode a hex, a font stack or a magic spacing number outside the
token block.

### 9.3 Materials on the web
The guide's three-material system (porcelain content, glass controls, prompter black)
translates, with care:

- **Glass** is `backdrop-filter: blur(44px) saturate(190%)` plus a 1px border at 80%
  white, an inset top highlight and inset bottom shade, radius 30 outer and 20 to 22
  inner, floating 16px from any edge, never touching another glass element. Give a
  **non-`backdrop-filter` fallback** (opaque tint) and say where glass appears on the web
  at all. Recommendation: the sticky header and the mobile sticky bar, nothing else. Glass
  never holds body text.
- **Ambient lights**: accent-tinted top-left, neutral counter-light bottom-right, both
  under 16%, never a visible gradient band. Spec them as fixed-position radial washes
  behind content, not per-section backgrounds, or they will stack and darken.
- **Prompter black** is `#050505` with no blur and no shadow, used only where the script
  lives. Do not use it as a generic dark section: that is what Graphite is for.

### 9.4 Contrast audit, required deliverable
Open your stylesheet with a comment block listing **every** foreground/background pair,
its computed ratio and PASS/FAIL against WCAG 2.1 AA (4.5:1 normal text, 3:1 large text
and UI). The brand palette has already been measured. Start from these and extend:

| Pair | Ratio | Verdict |
|---|---|---|
| Ink `#14171C` on Porcelain `#EEF0F3` | 15.73 | PASS |
| Ink 2 `#5B626E` on Porcelain | 5.38 | PASS |
| Ink 2 `#5B626E` on Fog `#E2E5EA` | 4.87 | PASS |
| Ink 3 `#98A0AC` on Porcelain | 2.31 | **FAIL.** Decorative rules and disabled states only. Never text, never an icon that carries meaning. |
| Cobalt `#2E5BFF` on Porcelain | 4.53 | Passes by 0.03. **Do not use it as text.** The guide already says to use Accent Text instead, and this is why. |
| Accent Text `#1F45D6` on Porcelain | 6.39 | PASS. Eyebrows, links, accent labels on light. |
| White on Cobalt `#2E5BFF` | 5.18 | PASS. Filled primary button on light. |
| Record `#FF5257` on Porcelain | 2.79 | **FAIL.** Which is why the guide specifies `#D93A3A` on light. |
| Record light `#D93A3A` on Porcelain | 3.98 | Large text and UI only. Fine: red is only ever a recording dot plus a timer. |
| Paper `#EEF1F5` on Graphite `#0E1114` | 16.71 | PASS |
| Cobalt Bright `#5B82FF` on Graphite | 5.48 | PASS |
| **White on Cobalt Bright `#5B82FF`** | **3.45** | **FAIL for normal text.** See below. |
| Graphite `#0E1114` on Cobalt Bright | 5.48 | PASS |

**One brand-guide amendment is required.** The guide sets Accent Ink to `#FFFFFF` on
cobalt in both modes. On the dark accent (`#5B82FF`) white gives 3.45:1, which fails AA
for a normal-size button label. Either use Graphite `#0E1114` as the ink on Cobalt Bright
(5.48:1), or restrict white-on-bright-accent to large text only (18.66px+ Semibold).
Recommend one, apply it consistently, and flag it back as a guide correction rather than
silently diverging.

Also required: visible `:focus-visible` styling on every interactive element, a working
skip link, no text baked into images, and `prefers-reduced-motion` honoured everywhere.

### 9.5 Dark mode
The brand guide is fully dual-mode. **This platform has no dark mode.** Both live Custom
Site stylesheets are light-only, with zero `prefers-color-scheme` rules.

Design **light (porcelain) as the shipping site.** The brand's dark surfaces still appear,
as Graphite bands and the prompter black band, so the site reads as dual-material without
a theme switch. Then deliver the dark token override as a **separate, clearly-labelled
block** (`@media (prefers-color-scheme: dark) { .cs-cueduo { … } }`) that the engineer can
enable later, with a note on which sections break under it. Do not build a manual
light/dark toggle: that is a client component, a persistence decision and a flash-of-wrong-
theme problem, for no user benefit on a marketing site.

### 9.6 Type, and the SF Pro problem
The guide says SF Pro and nothing else. **SF Pro is not on Google Fonts and is not
licensed for general web use**, and this platform loads fonts through `next/font/google`
only. Resolve it like this, and say so in your rationale:

```
--cs-font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display',
                   var(--font-inter), system-ui, sans-serif;
--cs-font-body:    -apple-system, BlinkMacSystemFont, 'SF Pro Text',
                   var(--font-inter), system-ui, sans-serif;
```

The system stack renders genuine SF Pro on every Apple device, which is where the audience
for an iOS app actually is, at zero network cost. Inter, loaded via `next/font/google`, is
the metric-compatible fallback everywhere else. If you prefer a different Google fallback,
argue for it.

Carry the guide's type rules through: two weights only (Semibold names or asks, Regular
explains), Display above 28px with tight tracking and Text below, tabular numerals for
times and counts, sentence case everywhere **including buttons**, no italics, no light
weights, no all-caps beyond eyebrows, 45 to 70 characters of body measure, never justified,
never hyphenated. Give the web scale explicitly, derived from the guide's
60/-3%, 40/-2.5%, 24/-2%, 17/0, 13/+6% steps, as `clamp()` values.

### 9.7 Responsive and performance
- Mobile-first. Verify 360 / 390 / 768 / 1024 / 1440.
- Breakpoints **639px and 899px**, matching sites #1 and #2 so the shared components
  behave. Do not introduce a third breakpoint without saying why.
- Hero image is `priority` and sized to avoid CLS. Device screenshots are heavy: specify
  dimensions, formats and `sizes` for each, and say which are lazy.
- State a JS budget. These pages are judged on Core Web Vitals.

---

## 10. Brand adherence, non-negotiables

### 10.1 The mark
Two panes at a hinge, seen from above. Panes 15 × 32 units on a 48 grid, 3° taper toward
the hinge. Hinge gap 2 units, never closed. Aperture is a 6-unit circle centred 4.5 units
from the top and outer edge of the dark pane, and is **always a cut-out** so the background
shows through, never a painted dot. **Lens always on the left pane, lit pane always on the
right.** Clear space: one aperture diameter on all sides. Mark alone never below 16px,
lockup never below 96px wide. Wordmark is Semibold at -2% tracking, "CueDuo" as one word,
cap C and cap D, no space.

Never: gradients, rotation, added outlines, recolouring outside the palette, stretching,
drop shadows, a mirrored lens.

You need to deliver the favicon, the touch icon and the OG image derived from this mark,
at real sizes, and confirm the aperture cut-out survives at 16px and in a favicon.

### 10.2 Color proportion
Roughly 80% neutral surface, 15% ink, 5% accent. **If a screen has two accent elements,
one of them is wrong.** This is the rule most likely to be broken by a marketing page that
wants a CTA in every band. Decide deliberately where the one accent goes per section and
state it.

Red means one thing: the camera is rolling. Never for errors, badges, emphasis, urgency or
sale pricing. Errors use ink weight or the accent.

### 10.3 Voice
Warm, human, unhurried. Like a good producer standing just off camera. Short sentences.
Second person. Contractions welcome. Describe what the person will do, not what the
software does.

- "You're ready", not "Setup complete".
- "Turn the phone around", not "Continue".
- **No exclamation marks.** Confidence is a full stop.
- Never blame: "Let's try that line again", not "Error".

This applies to every string you write, including nav labels, button labels, form
validation, the 404, the cookie or consent line if there is one, and alt text.

Marketing sites drift toward hype. The brand does not have a hype register. If a line
would feel wrong spoken quietly by a person standing next to you, cut it.

### 10.4 Icons
One family: 24px grid, 1.75 stroke, round caps and joins, 2px inner radius. Glyphs are
outlines, the active state fills. Feature icons are the same glyphs at 40px on a soft
accent tile. The brand guide ships 22 UI glyphs (Record, Stop, Play, Pause, Script,
Library, Fold, Flip camera, Mic, Speed, Text size, Countdown, Scissors, Title, Photo,
Share, Export, Settings, Add, Done, Close, Back) and 4 feature glyphs. Reuse them. The
platform's `csValuePropsBlock` takes an `icon` string key, so hand the engineer the exact
key list and the SVG source for each.

### 10.5 Photography
Real people, mid-sentence. Candid, eye-level, soft daylight or a single practical lamp.
Caught talking, not posing. Lived-in workspaces, slightly out of focus. Grade neutral-cool,
shadows lifted, clean neutral highlights, natural skin, slight grain fine, no vignette.
**Never teal-orange, never high contrast.** The device appears in hand, half-open, screens
legible.

Use `<image-slot>` for every photo placeholder in your deliverables, each with a distinct
`id`, and prefill with `search_stock_photos` results where a real photo helps. Any Unsplash
`src` **must** carry `credit` in the exact form "Photo by {name} on Unsplash" plus
`credit-href`, or it renders an error tile. Keep the slot's bottom-left corner clear so the
credit overlay stays visible. Mark clearly which images are placeholder stock versus
production assets the client must shoot.

---

## 11. Site map

Commit to this or argue for a different one. Registry paths are append-only once live.

| Route | Type | Notes |
|---|---|---|
| `/` | `csPage` | The main pitch. |
| `/features` | `csPage` + `csPracticeGridBlock` | Features index. `servicesPath: 'features'`. |
| `/features/<slug>` | `csPracticeArea` | Prompter, Recording, Editing, Library, Export. |
| `/pricing` | `csPage` | Plans (TBC values), what is free, restore purchase note. |
| `/support` | `csPage` | **App Store support URL.** FAQ + contact form. Must stand alone. |
| `/updates` | `csPublication` index | Release notes and posts. `insightsPath: 'updates'`. |
| `/updates/<slug>` | `csPublication` | |
| `/privacy` | `csPage` + `csDisclosureBlock` | **Required by App Store Connect.** |
| `/terms` | `csPage` + `csDisclosureBlock` | |
| `/press` | `csPage` | Optional. Mark, screenshots, boilerplate, contact. |
| `/journey/<slug>` | `csJourneyStage` | Only if the "how a take happens" stages earn their own pages. Decide. |
| 404 | | In voice. |

Give a **section-by-section spec for every route**, in page-builder order, each section
named and mapped to an existing or new block.

---

## 12. Deliverables

Deliver as `.dc.html` files in this project, following the existing files' structure
(`support.js` in `<head>`, `<x-dc>`, `<helmet>` with the scoped style block). One file per
page, plus the system pages.

1. **Design rationale** (one page): the positioning, the audience, the visual thesis, and
   every place you diverged from the brand guide with the reason.
2. **Token sheet**: the full `--cs-*` block, annotated, mapped per §9.2.
3. **Contrast audit** per §9.4, including a decision on the dark-accent ink.
4. **Page-by-page section specs** per §11.
5. **The stylesheet**: production-ready CSS scoped to `.cs-cueduo`, covering every class
   in §6 plus everything you add. A real deliverable, not a sketch. Expect 1,500 to 2,000
   lines based on the two existing sites.
6. **New block schema proposals** per §7.1.
7. **New document type proposals** (if any) with rationale.
8. **Client-component inventory** per §8.4.
9. **Fonts**: exact `next/font/google` family, weights, styles and CSS variable names, per
   §9.6.
10. **Icon handoff**: the glyph key list plus SVG source, in the shape
    `csValuePropsBlock`'s icon map expects.
11. **Asset list**: every screenshot, device render, photo, logo, icon and OG image, with
    dimensions, crop guidance and alt-text direction. Say which are exported from the app
    prototype, which are client-supplied, which are stock, and which need to be made.
12. **States**: hover / focus / active / disabled / loading / error / empty for every
    interactive element, plus the pre-launch "coming to the App Store" variant of every
    App Store CTA.
13. **Dark-mode override block** per §9.5, clearly separated and marked deferred.

---

## 13. Content, legal and store notes

### 13.1 App Store requirements
The site carries two URLs App Store Connect requires: a **support URL** (`/support`) and a
**privacy policy URL** (`/privacy`). Both must work standalone, load fast, and not be
gated behind anything.

### 13.2 Apple assets and trademarks
The "Download on the App Store" badge is Apple's asset with its own rules: do not recolour
it, redraw it, animate it, or set it below its minimum size, and respect its clear space.
Apple product names and marks carry attribution requirements, and device renders may not
imply Apple endorsement. Flag anywhere the design depends on an Apple-controlled asset or
an unannounced device so it can be checked before launch. The brand guide deliberately says
"folding phones" rather than naming a product: follow that unless told otherwise.

### 13.3 Claims
No invented numbers, ratings, reviews, press mentions or user counts. Any performance or
popularity claim needs client sign-off and a source. App Store review quotes need the
reviewer's handle and must be real.

### 13.4 Structured data
`organizationType` becomes `SoftwareApplication`. The JSON-LD should describe the app
(name, category, operating system, offers, screenshot, author) and its FAQs, not a local
service business with opening hours and a service area. Flag that the shared JSON-LD
components were written for `LegalService` / `FinancialService` and will need a branch.

---

## 14. Acceptance checklist

- [ ] Every page is an ordered array of blocks. No page needs bespoke one-off layout code.
- [ ] Every section maps to an existing block or a fully-specified new `cs*Block`.
- [ ] Every existing block in §5 has an explicit use / use-with-changes / not-using verdict.
- [ ] All new fields use Sanity primitives. No color, font or spacing fields in Sanity.
- [ ] Every shared class in §6 is styled, including the header phone slot decision.
- [ ] Everything scoped under `.cs-cueduo`. No globals, no Tailwind, no `!important`.
- [ ] All color, type and spacing flows through `--cs-*` tokens mapped per §9.2.
- [ ] Contrast audit present. Every pair passes AA or is explicitly restricted. The dark
      accent ink question is answered.
- [ ] Focus-visible, skip link, `prefers-reduced-motion`, semantic headings (one `h1` per
      page, no skipped levels), alt text on every image.
- [ ] Client-component inventory complete. Every interactive piece has a no-JS fallback.
- [ ] The prompter band reads correctly with JavaScript disabled.
- [ ] Empty states specified for every optional field. No fake reviews, logos, numbers or
      app screens.
- [ ] Every device screen traces to a real frame in `CueDuo v2.dc.html`.
- [ ] `next/font` only, `next/image` only, no external CSS/JS/font/icon CDNs.
- [ ] Mobile-first, verified 360 to 1440, breakpoints at 639 and 899.
- [ ] Logo rules honoured: lens left, lit pane right, aperture is a cut-out, clear space
      and minimum sizes respected, favicon legible at 16px.
- [ ] One accent element per section. Red appears only as a recording indicator.
- [ ] No exclamation marks anywhere. Sentence case including buttons.
- [ ] App Store badge used per Apple's guidelines. Support and privacy URLs work
      standalone.

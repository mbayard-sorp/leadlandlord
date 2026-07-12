# SEO / AEO / GEO Audit — Site Templates (July 2026)

Scope: rank-and-rent tenant templates (`apps/site-host` tenant routes + variants), buildsell
surface (`apps/site-host/app/buildsell`, `components/buildsell`), and the content layer
(`packages/agents` content-engine, keyword-planner, internal-linker, indexnow-submitter,
geo-aeo-auditor). Audited by the seo-auditor and Explore agents; plan reviewed and layered by
the architect agent. Baseline reference: `apps/site-host/SEO_CHECKLIST.md` (R1, 2026-05-09) —
items already ✅ there were re-verified, not re-reported.

## Verdict

The stack is already well above average: host-aware canonicals, per-tenant sitemaps/robots,
a broad JSON-LD suite, llms.txt + llms-full.txt + `/md/*` markdown mirrors, IndexNow to
Bing/Brave, a per-page FAQ contract in the content engine with density linting, and a weekly
geo-aeo-auditor. The gaps that separate it from world-class fall into four groups:

1. **One real exposure bug** — `/llms.txt` ignores `robotsDisallow`, leaking warming-site
   structure to AI crawlers.
2. **Buildsell lags rank-and-rent on structured data** — no Service, Pricing/Offer, or
   WebSite JSON-LD despite the data existing in Sanity; plus a WCAG-A landmark bug and a
   raw `<img>` logo (CLS risk).
3. **Truthfulness gaps in schema** — hardcoded 07:00–21:00 opening hours on every tenant,
   wrong/relative Service images.
4. **Content-layer AEO/GEO gaps** — the internal linker orphans exactly the pages built for
   answer engines (faq/info/service-area), no freshness loop, no PAA question-keyword
   harvest, FAQ dedupe only warn-linted.

## Findings

### Critical

| # | Finding | Evidence |
|---|---------|----------|
| C1 | `/llms.txt` does not check `site.robotsDisallow` — warming sites serve full page/link inventory to AI crawlers (llms.txt consumers often ignore robots.txt by design). `llms-full.txt:31` and `md/[[...path]]:32` gate correctly. | `apps/site-host/app/llms.txt/route.ts` |
| C2 | Buildsell pages never render `<main id="main">`; the root layout's skip-to-content link targets a nonexistent anchor. WCAG 2.1 Level A failure. | `components/buildsell/BuildSellSiteView.tsx` |
| C3 | Buildsell logo is a raw `<img>` with no explicit width — no AVIF/WebP, no srcset, CLS risk on first paint. | `components/buildsell/BuildSellHome.tsx:87-103` |

### High

| # | Finding | Evidence |
|---|---------|----------|
| H1 | `LocalBusinessJsonLd` hardcodes `openingHoursSpecification` 07:00–21:00 all seven days for every tenant — false data in search/answer results. No hours field exists anywhere (ContentBundle, Bundle, Sanity site doc). | `components/shared/LocalBusinessJsonLd.tsx:79-86` |
| H2 | Service JSON-LD uses `bundle.hero_image_url` instead of `page.og_image_url` fallback (metadata at :142 gets it right), and doesn't absolutize the URL like BlogPosting does. | `app/[slug]/page.tsx:51` |
| H3 | Blog and FAQ index pages omit `mdPath` — no `rel=alternate type=text/markdown` link, so index hubs are missing from LLM markdown discovery and llms.txt. | `app/blog/page.tsx`, `app/faq/page.tsx` |
| H4 | Buildsell: no Service JSON-LD despite `bsServicesSection` data; no Pricing/AggregateOffer JSON-LD despite `bsPricingSection` tiers; no WebSite JSON-LD (root layout only emits it when a ContentBundle exists — buildsell has none). | `app/layout.tsx:90-96`, `components/buildsell/*` |
| H5 | Internal linker only rewrites home/service/blog/contact bodies — `info_pages`, `faq_pages`, and `service_areas` get zero inbound body links. The AEO surfaces are orphaned from the link graph except nav. | `packages/agents/src/content-engine/internal-linker.ts:51-80` |
| H6 | No content-freshness loop — `date_modified` is stamped only at generation; local-content-scout only *adds* posts, seo-operator only rewrites GSC-flagged pages. Home/service/FAQ bodies go stale network-wide; answer engines weight freshness. | `packages/agents/src/seo-operator/`, content-engine |
| H7 | Google-side proactive indexing gap — IndexNow pings Bing + Brave only. **Architect decision: do NOT adopt the Google Indexing API** (officially scoped to JobPosting/BroadcastEvent; misuse risks suspension). Accept GSC sitemap + crawl discovery; the real Google-adjacent surface (AI Overviews/Gemini) is already served by llms.txt / `/md/*` / robots allow-rules once C1 is fixed. | `packages/agents/src/indexnow-submitter/` |

### Medium

| # | Finding | Evidence |
|---|---------|----------|
| M1 | `/about` and `/contact` pass trailing-slash paths to metadata/breadcrumbs → 308 redirects on breadcrumb links. | `app/about/page.tsx:20,52`, `app/contact/page.tsx:21,67` |
| M2 | Buildsell custom-domain root has no `/index.md` mirror or `mdPath` (deferred "Phase 2" comment). | `app/page.tsx:65` |
| M3 | No pillar→cluster topical architecture — linking is service-centric hub-spoke only; FAQ/info/blog pages aren't tied to topic pillars. | `internal-linker.ts` |
| M4 | FAQ lint is warn-only (0 FAQs, thin/duplicate answers won't fail a build) and cross-site FAQ uniqueness isn't enforced at emit — network dup-content/footprint risk. | `content-engine/density-lint.ts` |
| M5 | Keyword-planner seeds are `{niche, niche+city, near me, cost, services}` only — no People-Also-Ask / question-keyword harvest, the highest-value AEO keyword class. | `packages/agents/src/keyword-planner/index.ts` |
| M6 | E-E-A-T credentials live in free-form jsonb (`proprietaryFacts`/`expertiseProfile`) — no typed path to `hasCredential` schema; about page omitted by default in thin mode. | `packages/db` schema, `content-engine/system.md:217` |
| M7 | Buildsell: no `inLanguage` on LocalBusiness; services and pricing tiers not linked in schema; FAQ optional/section-scoped rather than guaranteed; scroll-motion INP risk. | `components/buildsell/*` |

### Low

- No image `alt` field in the ContentBundle contract — alts are template-derived, not authored per image. (`packages/shared/src/types.ts`)
- robots.txt doesn't reference llms.txt (discovery still works via alternate links).
- geo-aeo-auditor's live citation probe (does ChatGPT/Perplexity actually cite us?) remains a deferred seam — structural proxies only.

## Architect decisions

- **Opening hours (H1):** operator-entered Sanity site-doc field (same tier as
  `latitude`/`sameAs`), mapped through `theme-bundle.ts` into the render-side `Bundle`,
  **bypassing the ContentBundle LLM contract entirely** — zero content-engine/Zod/prompt
  ripple. Current hardcoded hours become the fallback when unset. Mirror field on the
  buildsell site schema. Recommended shape: `{ opens, closes, closedDays[] }`.
- **Google Indexing API (H7): rejected** — policy-scoped to job postings; keep GSC sitemap +
  IndexNow, fix C1, and the AI-surface story is complete.
- **Freshness loop (H6):** reuse seo-operator's risk-tiering, not a new gate — timestamp-only
  refresh auto-applies (low risk); any body rewrite lands in the existing
  `seoRecommendations` `awaiting_review` flow. This *reuses* an approved gate, so no ADR
  sign-off trigger. Spike whether to extend seo-operator vs. a new `freshness-refresher`
  agent before committing to size.
- **Internal-linker extension (H5): footprint-mitigated** — vary link caps per page kind
  (e.g. faq 1–3, info 2–4, service-area 3–5, never one uniform signature), and make target
  selection kind-aware (service-area → matching service + nearby areas, not "first N
  services"). Deterministic post-processing code → next-engineer owns it, despite living in
  `packages/agents`. Add an automated cross-site link-pattern similarity check to the
  improvement backlog (non-blocking).
- **Buildsell WebSite JSON-LD wiring:** add a parallel buildsell-specific injection point
  rather than widening `layout.tsx`'s single `bundle` check — keeps the R&R and B&S render
  paths decoupled.
- **ADR required before Phase 2/3:** `docs/adr/0034-structured-data-freshness-layering.md`
  covering (a) the Sanity-passthrough-vs-ContentBundle rule for operational fields,
  (b) freshness-loop reuse of seo-operator's risk tiers.

## Phased implementation plan

### Phase 1 — pure site-host fixes, no contract changes ✅ implemented in this PR

| Item | Owner | Size |
|------|-------|------|
| C1 llms.txt robotsDisallow gate | next-engineer | S |
| H2 Service JSON-LD image fallback + absolutize | next-engineer | S |
| H3 blog/faq index mdPath (+ index markdown mirrors if missing) | next-engineer | S |
| M1 trailing-slash fixes on /about, /contact | next-engineer | S |
| C2 buildsell `<main id="main">` | next-engineer | S |
| C3 buildsell logo → next/image | next-engineer | S |
| robots.txt → llms.txt reference (best-effort; skip if typed API can't express) | next-engineer | S |

### Phase 2 — structured-data parity + contract additions

| Item | Owner | Size |
|------|-------|------|
| H4 buildsell WebSite JSON-LD (parallel injection point) | next-engineer | S/M |
| H4 buildsell Service + Pricing/AggregateOffer JSON-LD | next-engineer | M |
| M7 inLanguage + service↔pricing schema linkage | next-engineer | S |
| M2 custom-domain root /index.md mirror + mdPath | next-engineer | M |
| H1 opening-hours field (Sanity → theme-bundle → both LocalBusiness emitters + operator UI) | next-engineer | M |
| Image alt in ContentBundle (Zod + prompt + both mappers + renderers, one coordinated PR) | next-engineer + agent-prompt-engineer | M |

### Phase 3 — content-layer / agent work

| Item | Owner | Size |
|------|-------|------|
| H5 internal-linker → info/faq/service-area (footprint-mitigated per above) | next-engineer | M |
| H6 freshness loop (risk-tiered, seo-operator pattern; spike extend-vs-new first) | next-engineer + agent-prompt-engineer | M/L |
| M4 FAQ cross-site dedupe at emit (pair with H5) | next-engineer | M |
| M5 PAA/question-keyword harvest in keyword-planner | agent-prompt-engineer | M |
| M6 typed credentials → `hasCredential` JSON-LD | next-engineer | S |
| M3 pillar→cluster topical architecture (exploratory, defer) | agent-prompt-engineer | L |
| geo-aeo-auditor live citation probe (deferred; low priority) | next-engineer | M |

Not recommended: Google Indexing API integration (rejected, see H7).

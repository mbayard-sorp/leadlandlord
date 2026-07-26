# ADR 0033 — Custom Sites: a third business line, client-owned lift-and-shift sites

**Date:** 2026-07-25
**Status:** Accepted
**Author:** leadlandlord-architect

---

## Context

LeadLandlord runs two business lines today, both operator-owned:

- **Rank & Rent (R&R)** — sites we own, rent to tenants, key off `site` Sanity docs
  with `domains[].host`, backed by Postgres `sites` rows.
- **Build & Sell (B&S)** — sites we build from Google Places leads and sell once, keyed
  off `buildsellSite` docs + `buildsell_sites` Postgres rows.

A third case has come up: a client-owned, standalone site we lift-and-shift once and hand
off — no ongoing operator relationship, no rent, no resale. First instance:
`constructionadrservices.com`, a construction-ADR (alternative dispute resolution) law
practice migrating off WordPress. This is editorial/legal-services content, not a
generated lead-gen page set, and the client owns the domain and the business outcome.

The two existing lines assume operator ownership end to end (Postgres row = source of
truth for lifecycle, Twilio number, crossSiteLinks membership, Klaviyo sequences). None
of that applies to a site we don't own. Standing up a fourth Next.js app per client site
would duplicate the entire SEO/AEO stack (JSON-LD suite, `llms.txt`, `/md` mirrors,
sitemap/robots, IndexNow, CWV reporting) and add a Vercel project per client — the
opposite of "one renderer, many tenants."

---

## Decision

Add **Custom Sites** as a third business line: client-owned sites, no Postgres coupling,
served by the existing `apps/site-host` renderer out of the shared Sanity project.

### D1 — Host-mode taxonomy: tenant / corporate / custom

`site-host` already special-cases one non-tenant host (`leadslandlord.com`, `x-site-mode:
corporate`, internal rewrite to `/leadslandlord/*` — see `apps/site-host/proxy.ts` and
`apps/site-host/app/leadslandlord/layout.tsx`). Custom Sites generalizes this into a third
mode:

- **tenant** — default. Resolved by `site-context.ts` via Sanity `site` doc,
  `domains[].host` lookup (or `x-site-slug` in dev).
- **corporate** — `CORPORATE_HOSTS` static set. Unchanged.
- **custom** — a `CUSTOM_HOSTS` map (host → `siteKey`) in `proxy.ts`. A match sets
  `x-site-mode: custom` and `x-cs-site: <siteKey>`, and internally rewrites `/*` to
  `/cadr/*` (first site's namespace; future sites get their own namespace segment the
  same way `leadslandlord` did).

**Alternative rejected:** a separate Next.js app/Vercel project per custom site. Rejected
because it duplicates the entire SEO/AEO surface (structured data, `llms.txt`, `/md`
mirrors, sitemap/robots, IndexNow key handler, CWV field-data collection) per client, and
multiplies Vercel project overhead for what is, per site, a handful of pages. The
marginal cost of a third host-mode branch in one renderer is far lower than a second
codebase.

### D2 — Generic `cs`-prefixed schema, not single-site types

Schema is built for site #2..N from day one, not hardcoded to the ADR firm:

- `csSite` — settings doc per site, keyed by `siteKey` (slug-keyed; no Postgres row
  exists to key off, which is deliberate — see D4).
- `csPage`, `csPracticeArea`, `csPublication`, `csAttorney`, `csTestimonial`, `csBadge` —
  content doc types, each carrying a reference to its `csSite`.

Deterministic doc IDs follow the existing convention: `cs-site-<siteKey>`,
`cs-page-<siteKey>-<slug>`, etc. The `cs-` prefix cannot collide with `site-`, `page-`,
`theme-`, `corporate-`, `cluster-`, or `bs-` — all five prefixes already in use.

The host resolver needs a queryable settings doc regardless (analogous to `site` for
tenant, `corporateSite` for corporate), so a per-site doc type was required either way;
making the whole line generic instead of single-site-specific costs nothing extra now and
avoids a rename/migration when site #2 shows up.

### D3 — Portable Text for bodies, scoped to Custom Sites only

Custom Sites bodies use Sanity Portable Text — the first Portable Text in the repo. R&R
stays markdown (`ContentBundle`/`Page` contract, content-engine generation). B&S stays
section objects (`bsPage`-style typed sections). Only `cs*` doc types use Portable Text.

Rationale: these are client-facing editorial sites; the client (or Mike, editing on
their behalf) needs real rich-text editing in Studio — bold, links, nested lists,
footnote-style citations for legal publications — not a markdown textarea. WordPress HTML
imports cleanly into Portable Text via `@sanity/block-tools`, which is the actual
migration path for the first site's ~dozen pages of existing content.

**Cost acknowledged:** a Portable Text → markdown serializer is required to keep the
`/md` mirrors and `llms-full.txt` working for AI-crawler consumption, since those routes
today assume markdown source. This is new, scoped code in `site-host`, not a rewrite of
the existing markdown path.

### D4 — No DB, no Twilio, no cross-links, no Klaviyo

Custom sites carry zero operator-platform coupling:

- **No Postgres row.** No `sites`/`buildsell_sites` equivalent. `csSite` in Sanity is the
  entire source of truth. No reaper, no migration, no lifecycle state machine.
- **No Twilio number.** The firm uses its own real phone number (NAP field on `csSite`,
  passthrough — same pattern as ADR 0032's operational-facts rule for R&R).
- **No crossSiteLinks membership.** Client-owned sites never appear in the R&R/B&S
  network — a client's site showing up in our internal link network would be a footprint
  and ownership problem, not a benefit to them.
- **No Klaviyo sequences.** No prospect/tenant lifecycle exists for a site we don't
  operate.
- **Leads go through a new, thin route:** `apps/site-host/app/api/cs-lead/route.ts` —
  Zod validation + honeypot + in-memory rate limit — calling Resend directly to
  `csSite.leadRecipients`. No DB write, no agent_events row.

**Alternatives rejected:**
- Reuse `/api/lead` (R&R's tenant lead route) — requires a `sites` Postgres row; doesn't
  exist for custom sites.
- Reuse `/api/bs/lead` (B&S's lead route) — requires a `buildsell_sites` row; same
  problem.

Both existing lead routes are load-bearing on their own DB tables; bending them to accept
an optional no-DB path would be exactly the kind of in-place modification to a
load-bearing seam this project avoids. A new route is additive and scoped.

### D5 — Analytics isolation: no central GA4 on custom hosts

LeadLandlord's central GA4 property must not load on a client-owned domain — that traffic
belongs to the client, not to LeadLandlord's analytics rollup. The custom layout injects
the site's own GTM container (configured per `csSite`) instead of the shared GA4 script
tag used on tenant/corporate hosts. The root layout's `noindex`-by-default metadata and
the tenant font-preload logic are both gated on `x-site-mode !== 'custom'` so custom hosts
don't inherit tenant-line defaults that don't apply to them.

### D6 — Rollout invariant: noindexed until DNS cutover

`csSite.robotsDisallow` defaults to `true`. Every custom site launches noindexed and stays
that way through build-out and client review; it is flipped to `false` only at the actual
DNS cutover to the client's live domain. This mirrors the R&R/B&S pattern of never letting
a site get indexed before it's the site of record at its domain.

---

## Alternatives considered

**Separate Next.js app per custom site.** Rejected — see D1. Duplicates the SEO/AEO
stack per client and adds a Vercel project per site for a business line that may only
ever have a handful of sites.

**Single-site-specific schema (`cadrSite`, `cadrPage`, ...).** Rejected — see D2. The line
exists for more than one client; a generic `cs`-prefixed schema costs nothing extra today
and avoids a rename later.

**Markdown bodies (matching R&R) instead of Portable Text.** Rejected — see D3. These are
client-edited editorial sites; markdown textareas are a worse editing experience than
Portable Text for legal-publication-style content, and WordPress HTML imports directly
into Portable Text via `@sanity/block-tools` with no lossy intermediate step.

**Give custom sites a Postgres row for consistency with R&R/B&S.** Rejected — see D4. A
DB row implies a reaper, a lifecycle, and an operator-platform relationship that doesn't
exist for a site we don't own. Zero coupling is the point, not an oversight.

**Reuse an existing lead route with an optional-DB code path.** Rejected — see D4. Both
`/api/lead` and `/api/bs/lead` are built around their respective DB tables; forking their
behavior on presence/absence of a row is exactly the kind of load-bearing-file
modification this project avoids in favor of an additive new route.

---

## Consequences

- `apps/site-host` deploys now carry a third line's surface. Every fallthrough chain that
  currently branches on `x-site-mode` (`corporate` vs. default) — `app/page.tsx`,
  `robots.ts`, `sitemap.ts`, `llms.txt`, the `/md` route handler — gains a third branch
  for `custom`. Each of these needs an explicit review pass, not an assumed pass-through.
- `apps/studio/structure.ts` uses a custom desk structure (`S.list()` with explicit
  `S.documentTypeListItem(...)` calls per business line); document types are **not**
  auto-listed. The Custom Sites folder (`csSite`, `csPage`, `csPracticeArea`,
  `csPublication`, `csAttorney`, `csTestimonial`, `csBadge`) must be added there as its
  own top-level `S.listItem()`, and any future `cs*` type must be added to that list
  explicitly or it silently won't appear in Studio.
- A Portable Text → markdown serializer becomes new, permanent code in `site-host`,
  scoped to the `cs*` doc types, to keep `/md` mirrors and `llms-full.txt` working. It is
  not a retrofit of the R&R markdown path.
- `CUSTOM_HOSTS` in `proxy.ts` is a static map (host → siteKey), the same shape as
  `CORPORATE_HOSTS`, so adding site #2 is a proxy-level, additive change plus a new
  namespace folder under `apps/site-host/app/`, not a schema or routing redesign.
- No new Postgres migration, no new agent, no new `agent_events` trigger, no
  `crossSiteLinks` rows, no Klaviyo/Twilio provisioning — this line is intentionally
  invisible to the operator-platform DB and the improvement loop.

---

## Amendment 1 — AIO/GEO/SEO enablement (2026-07-25)

**Author:** leadlandlord-architect

**Why an amendment, not a new ADR (0034):** every decision below is downstream of D4
("no Postgres row, no new agent, no `agent_events` trigger" — the line's defining
constraint) and D2 (the generic `cs`-prefixed schema built for growth past site #1).
None of them introduces a new architectural pattern; they resolve gaps in applying
existing SEO/AEO infrastructure (ADR 0014/0015 IndexNow, the `geo-aeo-auditor` agent,
ADR 0032 freshness layering) to a line whose entire premise is "no DB coupling." Keeping
them here means the rationale stays next to the constraint it has to satisfy, instead of
forcing a reader to cross-reference a second document to understand why, e.g., the
IndexNow submitter can't just be reused. Numbering continues from D6.

### D7 — IndexNow for Custom Sites: Sanity-only script, not the DB-keyed agent

**Problem confirmed.** `proxy.ts`'s `/{32hex}.txt` rewrite and `/api/indexnow-key/route.ts`
both predate Custom Sites and only call `resolveCurrentSite()` (tenant `site` doc).
`csSite` has no `indexnowKey` field, so the verification file 404s on
`constructionadrservices.com` today, and `indexnow-submitter` (`packages/agents/src/
indexnow-submitter/index.ts`) is hard-keyed to `sites.id` (Postgres uuid) end to end —
input schema, `getDb().select().from(sites)`, `geoSeoAudits`/`seoRecommendations`-style
FK writes. Bending it to accept an optional non-DB path would be exactly the load-bearing
in-place modification this project avoids (same reasoning as D4's rejection of forking
`/api/lead`).

**Decision: validated as proposed.**
1. Add `csSite.indexnowKey` (string, `readOnly: true`, group `seo`) — mirrors
   `sites.indexnow_key`'s role but lives entirely in Sanity, consistent with `csSite`
   being the complete source of truth for this line.
2. Add a custom branch to `apps/site-host/app/api/indexnow-key/route.ts`: branch on the
   `x-site-mode` header (already set by `proxy.ts` for every mode) and call
   `resolveCurrentCustomSite()` instead of `resolveCurrentSite()` when `x-site-mode ===
   'custom'`. This is not a new seam violation — ADR 0033's original Consequences section
   already anticipated this exact edit ("every fallthrough chain that currently branches
   on `x-site-mode` ... gains a third branch for `custom`"), the same way `robots.ts` and
   `sitemap.ts` already do. The route keeps single responsibility ("serve the IndexNow key
   file for whatever host resolved"); it gains a second resolver call, not a second
   purpose.
3. Add `scripts/customsites-indexnow.ts`, following the existing `scripts/backfill-
   indexnow.ts` shape (dry-run by default, `--execute` to submit, `tsx` entrypoint, a
   `pnpm customsites-indexnow` script alias). It queries `csSite` for all sites via GROQ,
   generates + patches `indexnowKey` on first run if absent (same lazy pattern the agent
   uses for tenant sites, same `randomBytes(16).toString('hex')` convention), derives the
   URL set from the live `/sitemap.xml` (same technique as the agent's
   `fetchSitemapUrls`), and calls the existing `submitUrls()` from
   `packages/integrations/src/indexnow/index.ts` directly — that function is already
   generic over `{ host, key, urls }` with no Postgres dependency, so it needed zero
   changes to be reused here.
4. **Gate:** the script skips (logs, does not submit) any `csSite` where
   `robotsDisallow !== false`. This enforces D6's launch-noindexed invariant at the
   submission layer too, not just at the metadata layer — submitting a noindexed site's
   URLs to IndexNow would burn crawl signal on pages that 403/noindex at fetch time,
   the same harm ADR 0014 §1 called out for the `site.deployed` (too-early) trigger.

**Trigger model — manual, not automatic.** Unlike the tenant line, there is no
`agent_events` row to hang a trigger on (that's D4, deliberately). The script is
operator-run: once at DNS cutover (when `robotsDisallow` flips to `false`), and again
after any content edit worth a recrawl ping. This is documented as a step in the Custom
Sites go-live runbook, not automated via Vercel Cron — a handful of sites doesn't justify
a new scheduled-function surface. **Revisit trigger:** if the line passes 3 live custom
sites, add a Vercel Cron route that re-runs the same script's logic on a schedule; still
no Postgres, no agent, no `agent_events` — cron is just a clock, not a coupling.

### D8 — GEO/AEO auditing for Custom Sites: standalone script, ephemeral results

**Decision: (b) — a standalone script under `scripts/`, not an extension of the
`geo-aeo-auditor` agent.** The agent is unusable as a base: `runReview` selects from
`sites`/`tenants`, writes to `geoSeoAudits` (siteId FK), writes to `seoRecommendations`
(siteId FK, drives an `awaiting_review` operator queue that has no Custom Sites concept
of "approve"), and its low-risk auto-apply path raw-inserts `agent_events` rows targeting
itself. Every one of those is a Postgres write keyed to a row that D4 says must not exist
for a custom site. Adding a `csSite`-keyed branch would mean either (i) relaxing the FK/
schema to accept a non-uuid site key — a load-bearing migration to a table three other
agents and an operator UI page depend on, for one client's site — or (ii) forking the
apply/write path with `if (mode === 'custom') { skip db }` scattered through a 700-line
agent. Both are the load-bearing-modification anti-pattern; neither is proportionate to
one auditor's worth of coverage.

What *is* reusable, and cleanly: `packages/agents/src/geo-aeo-auditor/checks.ts` is
already a pure, dependency-free module — no DB import, no Sanity import (the agent
itself lazy-imports Sanity specifically to keep this file's test surface clean). Every
scoring function (`runChecks`, `geoScore`, `llmsTxtCompleteness`, `schemaCoverage`,
`answerExtractability`, `entityConsistency`, `markdownCoverage`, `isoWeek`) is exported
and importable standalone. `scripts/customsites-geo-audit.ts` imports these directly,
fetches `llms.txt` + a few live pages + their `.md` twins over plain `fetch` (same
approach as the agent's `fetchLiveAssets`/`fetchMarkdownTwins`), and runs the identical
deterministic checks — full parity on all five subscores, zero new agent code, zero DB
touch.

**Where results go — explicit ruling: nowhere durable.** The script prints a
human-readable report (score, subscores, findings) to stdout on each manual run. It does
**not** write to `geoSeoAudits`, does not create a new `csAudit` Sanity doc type, and does
not emit an `agent_events` row. This is a deliberate scope cut, not an oversight:
- Writing to `geoSeoAudits` or `agent_events` would directly break ADR 0033's stated
  consequence that this line is "invisible to the operator-platform DB and the
  improvement loop" — those tables *are* what the improvement loop and fleet-metrics
  read.
- A new persisted `csAudit` Sanity doc type was considered and rejected for now: nothing
  in the operator UI or improvement loop would consume it (there is no Custom Sites
  operator surface at all), and this codebase has already burned the "mirrors a decision
  nothing consumes" mistake once — the old generic `agentApprovals`/`autoApproveRules`
  inbox, removed 2026-06-09 for exactly that reason. Building a report nobody reads
  repeats it.
- The consequence accepted: no trend history, no auto-recommendation, no auto-apply — an
  operator has to actually run the script and read the terminal output to know a custom
  site's GEO score. For a single client site with no revenue-scale pressure, that's an
  acceptable trade against building unused persistence.

**Trigger condition to revisit:** persist audit runs (new `csAudit` Sanity doc, timestamp
+ score + subscores, no FK to anything Postgres) once either (a) the line has ≥3 live
sites, making manual terminal-reading impractical, or (b) an operator UI for Custom Sites
gets built for other reasons (at which point a `csAudit` list becomes cheap to surface
there). Until then, this is intentionally a CLI tool, not a monitored system — consistent
with `DEPRECATIONS.md` deferring "monitoring" fleet-wide pending revenue evidence.

### D9 — Freshness loop for Custom Sites: defer

ADR 0032 built a `riskLevel`-tiered freshness/staleness loop on top of `seoRecommendations`
— which, per D8, custom sites cannot write to without breaking D4. A GROQ staleness report
over `csPage` / `csPracticeArea` / `csPublication` (`modifiedAt` vs. now, flagging pages
untouched for N months) is cheap to write as a **read-only** script — no different in kind
from D8's audit script. But there is no action to attach to its output yet: ADR 0032's
model routes `low` risk through `operator-tick` auto-apply and `medium`/`high` through the
`seoRecommendations` `awaiting_review` queue, and neither exists for this line (again,
D4/D8). A staleness report with nowhere to route its findings is a report nobody consumes
— the same anti-pattern D8 just rejected.

**Decision: defer.** Do not build the staleness script now. **Trigger condition to
revisit:** either (a) D8's audit script gets built out with persistence (line ≥3 sites),
at which point a staleness check is a cheap additive check inside the same script rather
than a separate one, or (b) a Custom Sites operator UI is built, giving staleness findings
somewhere to surface as a manual worklist (no auto-apply required — even a "last touched
14 months ago" list rendered read-only would be enough to close the loop, unlike D8's
score which has no natural manual-review surface without one). Record this explicitly so
the next person auditing SEO/AEO/GEO coverage doesn't rediscover D8's "report nobody
consumes" trap independently.

### D10 — Schema additions: approved with two structural amendments

The proposed additive list is approved, with `barAdmissions[]` given structure instead of
being left as a plain string array (the rest of the list is approved exactly as proposed):

- **`csSite.indexnowKey`** (string, `readOnly: true`, group `seo`) — per D7.
- **`csSite.titleTemplate`** (string, group `seo`, e.g. `"%s | Michael J. Bayard
  Construction ADR"`) — approved. `apps/site-host/app/cadr/layout.tsx`'s
  `generateMetadata` currently hardcodes this string as a template literal; it becomes
  `site.titleTemplate ?? `%s | ${site.name}`` (site-name fallback, not a hardcoded string,
  so an empty field never breaks site #2). This is the one code change this amendment
  actually requires outside net-new files — a one-line fallback swap in an existing
  `generateMetadata`, not a rewrite of the metadata seam itself; `seo-meta.ts` is
  untouched (Custom Sites already has its own `generateMetadata`, not `seo-meta.ts`'s, per
  D1/D3's scoping).
- **`csSite.areaServed[]`** (array of string, group `seo`) — approved, feeds
  `LegalService.areaServed` in `CustomSiteJsonLd`. Distinct from `csAddress` (the office
  location); a mediator/arbitrator practice serves a wider region than its office city.
- **`csAttorney.barAdmissions[]`** — approved, but as a new object type
  `csBarAdmission { jurisdiction: string (required), barNumber?: string, admittedYear?:
  number }`, not a plain string array like the existing `credentials[]`. Rationale: this
  is the field that maps most directly to `hasCredential`'s
  `credentialCategory: 'license'` + `recognizedBy` schema.org shape, and jurisdiction is
  the one sub-value a consumer (or a future E-E-A-T checker) will want to query on its
  own; a flat string ("California") loses that. This is the only deviation from the
  proposal as stated — flagged explicitly per instructions, not silently substituted.
- **`csAttorney.credentials[]{name, issuer, year, url}`** — approved exactly as proposed,
  as object type `csCredential`. Feeds `hasCredential` generically for anything that
  isn't a bar admission (AAA/ICC certifications, judicial-reference appointments, etc.).
- **`csAttorney.arbitratorPanels[]`** (array of string) — approved as proposed. Simple
  roster-membership strings (e.g. "AAA Panel of Arbitrators", "JAMS Neutral") feed
  `memberOf`; no sub-structure needed since panel membership doesn't carry a per-entry
  date/issuer the way `credentials[]` does.
- **`csSeo.noindex`** (boolean, optional) and **`csSeo.canonicalOverride`** (url,
  optional) — approved. These add page-level overrides on top of `csSite.robotsDisallow`
  (site-wide default per D6); a live site can still want one page noindexed (e.g. a
  disclaimer page) or canonicalized to a syndicated original (legal publications are
  often cross-posted).
- **`csFaqBlock`** page-builder block, reusing `csFaqItem` (`{ heading?: string, items:
  csFaqItem[] }`) — approved, added only to `csPage.pageBuilder`'s `of` array. FAQs
  today exist only on `csPracticeArea` (a plain `faqs` array, not a page-builder block);
  a generic page (e.g. a standalone "Why Arbitration" page) has no way to carry FAQPage
  content. `csPracticeArea.faqs` is unchanged — this is additive, not a replacement.
- **`csTestimonial.rating`** (number, optional, `validation: r => r.min(1).max(5)`) —
  approved, feeds `Review`/`AggregateRating` JSON-LD once a testimonial-rendering
  component reads it (that renderer change is out of scope here; the field is the
  prerequisite).

None of these fields touch `packages/shared/src/types.ts` (`ContentBundle`) — they are
`cs*`-scoped Sanity schema only, consistent with D2/D3's scoping of Portable Text and the
generic schema to Custom Sites exclusively. ADR 0032 Decision 1's operational-facts-are-
passthrough rule (never `ContentBundle`) applies here by the same logic even though these
are Custom Sites, not R&R: none of this is LLM-generated copy, all of it is
operator/client-entered fact.

---

## Amendment 1 consequences

- `packages/sanity-schema/src/types/customsites/custom-site.ts` gains `indexnowKey`,
  `titleTemplate`, `areaServed`; `custom-attorney.ts` gains `barAdmissions` (new
  `csBarAdmission` object), restructures `credentials` to the new `csCredential` object
  shape (breaking change to the existing plain-string `credentials[]` field — see
  migration note below); `custom-testimonial.ts` gains `rating`; `objects.ts` gains
  `csSeo.noindex`/`csSeo.canonicalOverride`, a new `csBarAdmission` type, a new
  `csCredential` type, and a new `csFaqBlock` type; `custom-page.ts`'s `pageBuilder.of`
  gains `csFaqBlock`.
- **Migration note:** `csAttorney.credentials` already exists today as `array of string`.
  Changing it to `array of csCredential` is a breaking schema change for any already-
  authored content (currently just constructionadrservices.com's attorney docs, if
  populated). `next-engineer` must check for existing string-array data on that field
  before deploying the schema change and, if any exists, write a one-time Studio-side or
  script-side migration (`{name: <string>}` at minimum) rather than silently dropping
  data — this is a hand-written-migration-discipline concern even though it's a Sanity
  field, not a Postgres column.
- `apps/site-host/app/api/indexnow-key/route.ts` gains a mode branch (D7) — the one
  existing-file edit beyond the metadata title-template fallback (D10).
  `apps/site-host/app/cadr/layout.tsx`'s `generateMetadata` gains a
  `site.titleTemplate ?? ...` fallback (D10) — the other.
- Two new scripts (`scripts/customsites-indexnow.ts`, `scripts/customsites-geo-audit.ts`)
  and two new `package.json` script aliases. No new agent, no new agent registry entry,
  no new migration, no new `agent_events` type — D4 holds through this amendment.
- Custom Sites GEO/AEO coverage remains **manually triggered and ephemeral** by design
  (D7's script is operator-run, D8's results are not persisted, D9 is deferred outright).
  This is a real gap relative to the tenant line's fully automated freshness/IndexNow
  loop, accepted deliberately for a low-volume, non-revenue-scored line rather than
  building unused automation — tracked via the two explicit trigger conditions in D8/D9
  so it doesn't get silently forgotten.

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

# ADR 0026: Build & Sell Customer Self-Service Content Portal

Date: 2026-06-25
Status: Accepted

## Context

Build & Sell (B&S) customers purchase a single-page spec site and need to edit their own
content (hours, headline, photos) after handoff. The operator cannot grant Sanity Studio access
at scale: Sanity's per-customer content scoping requires the Enterprise plan plus a billed seat
per customer plus a fail-open GROQ-filter risk. That cost structure is incompatible with a
high-volume, low-price spec-site business.

The chosen approach keeps Sanity as the content store and live-preview engine and puts a thin,
isolated custom portal in front of it. Customers authenticate with Neon Auth, see only the
site(s) assigned to them, edit a curated set of fields via a minimal server-action form, watch a
live preview update via an iframe proxy, and click Publish to push changes live. No customer ever
receives a Sanity token; all writes go through scoped server actions.

## Decision

Build `apps/customer-portal` as a fourth Next.js 16 App Router app in the monorepo, at port 3002,
deployed as its own Vercel project at `edit.leadlandlord.com`. It shares `@leadlandlord/db` and
`@leadlandlord/sanity-schema` as workspace packages.

### Auth

Neon Auth (`@neondatabase/auth`, wrapping Better Auth as a managed service) stores users in the
`neon_auth` schema of the existing Neon Postgres instance. User IDs are UUID strings. A new table
`bs_customer_site_access` maps `auth_user_id` (text, no FK into `neon_auth`) to `buildsell_sites.id`.

Operator provisioning: when `markPaid` fires, a non-fatal server action creates the customer login
via `auth.signUp.email({ email: ownerEmail, password: crypto.randomUUID(), name: businessName })`
followed by a Resend welcome email directing the customer to use "Forgot password" to set their
credentials. If the email already exists in `neon_auth.user`, look up the existing id via SQL and
skip `signUp`. Admin `createUser()` is NOT used (it requires an authenticated session). The
integration lives in `packages/integrations/src/neon-auth.ts`.

### Data model

```sql
bs_customer_site_access (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id       text NOT NULL,
  buildsell_site_id  uuid NOT NULL REFERENCES buildsell_sites(id) ON DELETE CASCADE,
  granted_by         text NOT NULL,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  UNIQUE (auth_user_id, buildsell_site_id)
);
CREATE INDEX ON bs_customer_site_access (auth_user_id);
```

### Authz

Every server action calls `requireCustomerSiteAccess(siteId)` first: read session
(`auth.getSession()`, no session => 401); query `bs_customer_site_access WHERE auth_user_id =
session.user.id AND buildsell_site_id = siteId AND revoked_at IS NULL` (no row => 403); then
validate inputs against the zod allowlist before any Sanity write. The guard is the authoritative
boundary; `proxy.ts` redirect is UX only. `siteId` is passed explicitly and checked before any read.

### Sanity write pattern (@sanity/client v7)

- Save: `createWriteClient().patch('drafts.bs-site-<id>').set({ <granular path>: value }).commit({ visibility: 'async' })`.
  If no draft exists, fork it from the published doc first (`createIfNotExists`).
- Publish: set `draftMode:false, robotsDisallow:false` on the draft (SEO safety lock), then
  `createWriteClient().action({ actionType: 'sanity.action.document.publish', publishedId, draftId })`.
- Discard: `createWriteClient().delete('drafts.bs-site-<id>')`.

### Section key convention

Section `_key` values are stable literal strings written by `persist-sanity.ts`: `hero`,
`services`, `about`, `process`, `reviews`, `contact`, `ugc` (conditional), `footer`. Sub-item keys
(`svc0`, `st0`, `ps0`, `fcol0`, ...) are positional and must be read from the current doc before
patching.

### Preview

Portal rewrites `/preview/*` and `/api/draft-mode/*` to the site-host origin (`SITE_HOST_ORIGIN`)
via `next.config.ts`, making the preview first-party and dissolving the CORS problem that blocked
the earlier Presentation attempt. Fallback: reload the iframe after each save.

### Editable field scope

v1 text: all section headline/heading/subhead/eyebrow/body; services[].title/description;
about.stats[].value/label; process.steps[].title/description; contact.address.*; contact.formLabels.*;
footer.tagline/legal/columns[].heading/links[].label/href; CTA label/href/style (hero, about, navCta);
seo.metaTitle/metaDescription. M4 media: logo, favicon, hero.image, about.image. Blocked: draftMode,
robotsDisallow, themeLocked, slug, theme.*, placeId, rating, reviewCount, purchaseUrl, ownerEmail,
generatedAt, *ImagePrompt, migrated.*, sections[] add/remove/reorder, reviews[] references,
formEndpoint, seo.ogImage, navShowPhone, navigation[]. Source of truth: `packages/sanity-schema/src/types/buildsell/`.

## Alternatives Considered

- **Sanity Studio + Enterprise GROQ filters** — rejected: Enterprise plan cost, billed seat per
  customer, fail-open filter risk.
- **Dataset-per-customer** — rejected: dataset/management/CDN overhead scales with customer count;
  cross-site operator visibility needs N-dataset fan-out.
- **Sanity Presentation (click-to-edit)** — attempted on branch `hopeful-cartwright-d2721d`, blocked
  by CORS, a browser-exposed read token, and missing `data-sanity` attributes on buildsell
  components. The rewrite-proxy dissolves CORS but the missing attributes mean v1 uses a form, not
  click-to-edit (explicit non-goal for v1).

## Consequences

Positive: zero Sanity seat cost at any volume; fail-closed authz; reuses `createWriteClient`,
`buildsellSiteDocId`, and the stega preview pipeline with no site-host changes; additive (new app +
table; only `markPaid` modified, non-fatally); atomic publish.

Negative / risks: Neon Auth must be provisioned on the project before the auth flow can be exercised
(env: `NEON_AUTH_BASE_URL`, cookie secret); server-side provisioning uses `signUp.email` + SQL
lookup and must handle the "user already exists" case; sub-array `_key`s shift on rebuild so the
portal must read the draft before patching them; the publish safety lock is mandatory or a live site
gets re-noindexed; the `ugc` section is conditionally absent; the `/preview/<id>` route is
public-by-unguessable-UUID (acceptable v1, hardening logged); a third Vercel project + DNS for
`edit.leadlandlord.com` is required before end-to-end verification.

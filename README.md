# LeadLandlord

A multi-agent system that builds, ranks, monetizes, and manages a portfolio of "rank-and-rent" lead-generation websites.

**Status:** core architecture migrated to a multi-tenant pipeline (one Vercel project serves every tenant; content lives in Sanity CMS). Phase 6 agent fleet shipped + typechecked. Phase 7 hardening + Phase 8 scale are next.

## Architecture (post-migration)

```
   tenant browsers ──►  apps/site-host                    ──►  Sanity (content + assets)
   Host: example.com    ONE Vercel project
                        (leadlandlord-sites)
                        - proxy.ts: Host → siteId (Sanity)
                        - app/[[...path]]: theme switch → variant render
                        - /api/lead   → proxy to operator
                                │
                        apps/operator                      ──►  Sanity (CMS reads/writes)
                        Vercel project: leadlandlord-       ──►  Postgres (sites/leads/calls/agent_runs)
                        operator                            ──►  Vercel API (domains)
                        - dashboard: theme picker, domain
                          manager, regenerate buttons
                        - /api/lead, /api/webhooks/{twilio,stripe}
                        - cron: operator-tick + domain-verifier
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
            Neon (DB)       Sanity (CMS)       Vercel API
                       leadlandlord.sanity.studio  (domains)
```

Key idea: **one Vercel project for all tenants** (`leadlandlord-sites`), routed by Host header. Content + theme + domains live in Sanity — the operator can swap a tenant's theme or edit copy without redeploying. The `leadlandlord-operator` project owns the dashboard, webhooks, agent runtime, and cron.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Copy .env.example → .env.local at the repo root and fill in:
#    Required:
#      DATABASE_URL              (Neon Postgres)
#      ANTHROPIC_API_KEY
#      VERCEL_TOKEN              (for Domains API + bootstrap scripts)
#      OPERATOR_PASSWORD
#      OPERATOR_SESSION_SECRET   (openssl rand -hex 32)
#      OPERATOR_PUBLIC_URL
#      SANITY_PROJECT_ID         (default: ybdv5za2)
#      SANITY_DATASET            (production)
#      SANITY_API_TOKEN
#      VERCEL_SITES_PROJECT_ID   (set after first deploy of apps/site-host)

# 3. Migrate the DB
pnpm db:generate
pnpm db:migrate

# 4. Bootstrap the leadlandlord-sites Vercel project + push env vars
pnpm tsx scripts/bootstrap-sites-project.ts

# 5. Run the operator dashboard locally
pnpm --filter @leadlandlord/operator dev
# → http://localhost:3000/operator

# 6. Build a tenant end-to-end (writes to Sanity development dataset by default)
pnpm dry-run --niche "gutter cleaning" --city "Boise" --state "ID"

# 7. (Optional) Run Sanity Studio locally to edit content
pnpm --filter @leadlandlord/studio dev
# → http://localhost:3333
```

## Layout

```
apps/
  operator/         Next.js operator dashboard (/operator/*)
                    + webhooks (/api/webhooks/{twilio,stripe})
                    + agent runtime (/api/cron/{operator-tick,domain-verifier,agent/[name]})
  site-host/        Multi-tenant public renderer. Resolves any tenant by
                    Host header. ONE Vercel project for all tenants.
  studio/           Sanity Studio. Hosted at leadlandlord.sanity.studio.
packages/
  db/               Drizzle schema + Neon client + queue helpers
  agents/           Claude Agent SDK wrappers — Site Builder, Content Engine,
                    Tracking Setup, Tenant Prospector, Outreach Agent,
                    Trial Manager, Closer, Compliance Guard, Billing/Dunning,
                    Churn Recovery, Call Classifier
  integrations/     Vercel (deploy + projects + domains), Sanity (asset upload
                    + write client), Twilio, Stripe, Klaviyo, Resend,
                    ElevenLabs, Anthropic, Imagen, Apollo, Google Places,
                    DataForSEO
  sanity-schema/    Document type definitions (site, page, theme, siteDomain)
                    shared between apps/studio + apps/site-host
  shared/           Cross-package types, env validation, pino logger
scripts/
  bootstrap-sites-project.ts    One-shot: create leadlandlord-sites + push env
  cutover-tucson.ts             Phase G one-shot: attach domain + record in Sanity
  dry-run.ts                    End-to-end: niche → Sanity site doc + 15+ pages
  migrate-existing-site.ts      Re-run Site Builder against an existing row
  parity-check.ts               Structural compare for cutover verification
  seed-sanity-themes.ts         Seed the 4 theme docs into a dataset
  seed-test-tenant.ts           Phase D smoke tenant in development dataset
  smoke-vercel-domains.ts       Read-only test of the Vercel Domains API wrapper
```

## Phase status

| Phase | Status |
|-------|--------|
| 0 — Foundation | ✅ Done |
| 1 — Site factory (Site Builder, Content Engine, Tracking Setup) | ✅ Done |
| 2 — Niche autopilot (Niche Hunter, Domain Procurer, SEO Operator, Backlink Builder) | 🟡 Typed stubs |
| 3 — Tenant pipeline (Tenant Prospector, Outreach, Trial Manager, Closer) | ✅ Done (cron activation gated on Twilio A2P) |
| 4 — Resilience (Compliance Guard, Billing & Dunning, Churn Recovery) | ✅ Done (cron activation gated on Twilio A2P) |
| 5 — Multi-tenant migration (Sanity + leadlandlord-sites) | ✅ Done (Phases A–H) |
| 6 — Phase 6 agent activation | 🟡 Code shipped; awaiting A2P + Stripe webhook config |
| 7 — Production hardening (Sentry, money guards, rate limits, backups) | 🟡 Not started |
| 8 — Scale features (GBP automation, SEO loop, white-label) | 🟡 Not started |

## Architecture notes

- **Two Vercel projects total:** `leadlandlord-operator` (dashboard + webhooks + agents) and `leadlandlord-sites` (multi-tenant public renderer). The old "one Vercel project per tenant" model is gone.
- **Cron endpoints:**
  - `/api/cron/operator-tick` (every minute) — claims unprocessed `agent_events` rows with `FOR UPDATE SKIP LOCKED` and fans out to `/api/cron/agent/[name]` (Fluid Compute, `maxDuration=300`).
  - `/api/cron/domain-verifier` (every 5 min) — polls Sanity for sites with unverified domains, asks Vercel for the latest verification status, flips Sanity when ready.
- **Content storage:** Sanity CMS, two datasets (`production` for live, `development` for dry-runs). Document IDs are deterministic (`site-<uuid>`, `page-<uuid>-<kind>-<index>`) so re-running Site Builder for the same site overwrites in place via `createOrReplace` — references stay valid.
- **Theme swap:** changes a single Sanity reference field. Live site picks up the new variant on the next per-request fetch (~Sanity-CDN-replication-lag, 5–30s).
- **Idempotency:** `agent_runs.dedupe_key` is unique on `(agent, dedupe_key)` — cron retries don't double-fire content generation.
- **Lead routing:** site-host's `/api/lead` is a same-origin proxy to operator's `/api/lead` with `x-leadlandlord-host` attached. Operator resolves the tenant by host via Sanity, falls through to legacy `site_id`/`site_slug` for pre-pivot sites.

## Editing content

Two paths:

- **Sanity Studio** (`https://leadlandlord.sanity.studio` or `pnpm --filter @leadlandlord/studio dev` for local) — edit page text, hero images, etc.
- **Operator dashboard** (`/operator/sites/[id]`) — swap themes, attach/verify domains, regenerate hero image, regenerate full content, configure GA4 + robots, see calls/leads/agent runs.

Studio is for content; Operator is for infrastructure + ops.

## Plans

The full migration plan is at `/Users/mikebayard/.claude/plans/users-mikebayard-desktop-multi-tenant-s-snappy-zephyr.md` (Phases A–H, all complete). Tracks B/C/D — agent activation, hardening, scale — are documented at `/Users/mikebayard/Desktop/Multi-tenant Sanity Lead Landlord.md`.

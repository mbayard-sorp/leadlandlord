# LeadLandlord

A multi-agent system that builds, ranks, monetizes, and manages a portfolio of "rank-and-rent" lead-generation websites.

**Status:** Phase 0 (foundation) + Phase 1 (site factory) scaffolded. Phases 2–5 are typed stubs.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Fill in .env.local (copied from .env.example) with:
#    - DATABASE_URL (Neon Postgres)
#    - ANTHROPIC_API_KEY
#    - VERCEL_TOKEN
#    - OPERATOR_PASSWORD
#    - OPERATOR_SESSION_SECRET   (openssl rand -hex 32)

# 3. Migrate the DB
pnpm db:generate
pnpm db:migrate

# 4. Run the operator dashboard locally
pnpm --filter @leadlandlord/operator dev
# → http://localhost:3000/operator

# 5. Run the end-to-end dry-run for "gutter cleaning, Boise, ID"
pnpm dry-run --niche "gutter cleaning" --city "Boise" --state "ID"
```

## Layout

```
apps/
  operator/        Next.js operator dashboard (/operator/*)
  site-template/   Next.js niche-site template (deployed per tenant site)
packages/
  db/              Drizzle schema + Neon client + queue helpers
  agents/          Claude Agent SDK wrappers; 3 working, 13 stubs
  integrations/    Vercel REST API, CallRail, Anthropic SDK, stubs
  shared/          Cross-package types, env validation, logger
scripts/
  dry-run.ts       End-to-end: niche → deployed Vercel preview URL
```

## Phase status

| Phase | Status |
|-------|--------|
| 0 — Foundation | ✅ Done |
| 1 — Site factory (Site Builder, Content Engine, Tracking Setup) | ✅ Done |
| 2 — Niche autopilot (Niche Hunter, Domain Procurer, SEO Operator, Backlink Builder) | 🟡 Typed stubs |
| 3 — Tenant pipeline (Prospector, Outreach, Trial Manager, Closer, Stripe) | 🟡 Typed stubs |
| 4 — Resilience (Billing & Dunning, Churn Recovery, Compliance Guard, Portfolio Analyst) | 🟡 Typed stubs |
| 5 — Scale | 🟡 Not started |

## Architecture notes

- **Two cron endpoints:** `/api/cron/operator-tick` is a fast dispatcher that claims unprocessed `agent_events` rows with `FOR UPDATE SKIP LOCKED` and fans out to `/api/cron/agent/[name]` (Fluid Compute, `maxDuration=300`).
- **Idempotency:** `agent_runs.dedupe_key` is unique on `(agent, dedupe_key)` — cron retries don't double-fire content generation.
- **Per-site deploys:** Site Builder calls `POST api.vercel.com/v13/deployments` directly with inline files (no `@vercel/client`). The tracking number is stored in Vercel Edge Config so it can rotate without redeploy.
- **Static MDX:** Site content is baked into each deploy at build time. The operator dashboard's "Re-deploy" button regenerates content + triggers a new deploy.

See `/Users/mikebayard/.claude/plans/users-mikebayard-library-application-su-temporal-pixel.md` for the full plan.

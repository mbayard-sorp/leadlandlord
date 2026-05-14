# Leadlandlord — Claude Code Project Rules

Inherits all rules from ~/.claude/CLAUDE.md. This file adds Leadlandlord-specific context.

## Stack

- Next.js 16 on Vercel (apps/operator at :3000, apps/site-host at :3001)
- TypeScript across all packages
- pnpm + Turbo monorepo
- Drizzle ORM + Neon Postgres (operator DB)
- Sanity CMS (content)
- Anthropic SDK (Claude Sonnet 4.6 by default; override via ANTHROPIC_MODEL)
- DataForSEO (keyword, SERP, backlink data)
- Imagen / Vercel AI Gateway (hero images)
- Twilio (call tracking + forwarding)
- Stripe (tenant billing)
- Klaviyo (sequences) + Resend (transactional email)
- Apollo (prospect data)

## Workstream-level context switch signals

Treat moves between these as context switches (prompt for /clear):

- Content generation (content-engine, system.md, density-lint, internal-linker)
- Network / linking (network-linker, cross-site-links, network UI)
- Backlinks (backlink-copycat, citation-runner)
- Operator UI (apps/operator/*)
- Site host rendering (apps/site-host/*)
- Niche hunting (niche-hunter, scoring, DataForSEO integrations)
- Tenant pipeline (tenant-prospector, outreach, trial, closer, billing)
- Portfolio ops (portfolio-analyst, compliance-guard, churn-recovery)

NOT a switch:
- Iterating within the same workstream
- Fixing a bug in code just written
- Adding tests to code just written

## Domain language

- **Site** — generated tenant Next.js page set; one row in Postgres `sites`, one doc in Sanity `site`.
- **Bundle** — a `ContentBundle` (the JSON shape Content Engine emits).
- **Variant** — one of four CSS themes (classic, modern, premium, bright). Microvariants vary within a base theme.
- **Cluster** — a DataForSEO keyword cluster, claimed by exactly one page.
- **Network** — group of sites that may cross-link via network-linker.
- **Wave** — a coordinated launch of 3-5 sites on an 8-week cycle.
- **Tenant** — a contractor renting a site for monthly lead generation.
- **Renter** — synonymous with tenant.
- **Prospect** — a potential tenant before they're paying.
- **siteMode** — `thin` (6-8 pages, default) or `content_rich` (~28 pages, opt-in).
- **Approval gate** — every side-effecting agent action queues to `agentApprovals` before execution unless an `autoApproveRule` matches.
- **Footprint** — observable similarity patterns across sites that make the network detectable as a network.

## Integrations & gotchas

- Anthropic SDK pricing table lives in packages/integrations/src/anthropic.ts; update when models change.
- DataForSEO rate-limits aggressive: max 10 requests/second; agents must throttle.
- Twilio phone provisioning costs ~$1/mo per number — release numbers when sites are retired.
- Sanity writes go through deterministic doc IDs (`site-${siteId}`, `page-${siteId}-${kind}-${index}`); never use random IDs.
- Vercel multi-tenant routing keys off the `Host` header in apps/site-host/proxy.ts; new domain attachment requires DNS + Vercel domain registration.
- GBP (Google Business Profile) is NOT registered by us. We use the partner-contractor's real GBP. Do not implement fake-GBP automation.
- Cross-site link injection always queues for approval — never auto-patch Sanity mdx without an approved agentApprovals row.

## Token-heavy operations to delegate

Always use a subagent for:
- Reviewing all generated content across a wave of sites for footprint similarity
- Cross-referencing competitor backlink profiles against our existing crossSiteLinks
- Auditing the codebase for hardcoded strings that should be in hygiene pools
- E2E smoke tests that exercise multiple agent runs
- Any task that requires reading >20 files at once

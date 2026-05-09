# LeadLandlord Project Agents

4 project-scoped agents in [.claude/agents/](.claude/agents/). Adapted from xdipx_store with LeadLandlord-native rules.

## Engineering

### [next-engineer](.claude/agents/next-engineer.md)
**Model:** sonnet · **Color:** coral · **Tools:** Read, Edit, Write, Bash, Grep, Glob

Builds and refactors Next.js 16 App Router code — routes, server components, server actions, layouts, variants, lib helpers. Default product-engineering agent. Enforces server-component-first, multi-tenant context discipline (always `resolveCurrentSite()`), `buildPageMetadata` for canonical/OG, `next/image` for hero, and the `BaseAgent` / `agent_events` boundary.

### [leadlandlord-architect](.claude/agents/leadlandlord-architect.md)
**Model:** sonnet · **Color:** ink · **Tools:** Read, Glob, Grep, Bash, WebFetch, WebSearch

Reviews and designs system architecture — evaluates changes for coupling, multi-tenant impact, agent-runtime safety; writes ADRs; protects the BaseAgent + Sanity + per-host rendering seams. Use before any non-trivial new feature. Outputs decisions, not patches. Rejects MVP-scope creep (Twilio A2P / Stripe / outbound — all deferred).

### [leadlandlord-qa](.claude/agents/leadlandlord-qa.md)
**Model:** sonnet · **Color:** sun · **Tools:** Read, Bash, Grep, Glob, mcp__Claude_Preview__*

Verifies completed work end-to-end before merge — typecheck, build, preview MCP at 375px + 1024px, JSON-LD + canonical + sitemap sanity, regression sweep across the four variants. Reports PASS / FAIL / BLOCKED-ON with evidence.

### [leadlandlord-seo-auditor](.claude/agents/leadlandlord-seo-auditor.md)
**Model:** haiku · **Color:** sage · **Tools:** Read, Bash, Grep, Glob

Audits tenant sites for SEO compliance — JSON-LD, sitemap, canonicals, heading hierarchy, `next/image` coverage, per-host metadata, `apps/site-host/SEO_CHECKLIST.md` adherence. Hands fixes to `next-engineer`.

## Quick reference

| Agent | Model | Domain |
|---|---|---|
| next-engineer | sonnet | Engineering |
| leadlandlord-architect | sonnet | Engineering |
| leadlandlord-qa | sonnet | Engineering |
| leadlandlord-seo-auditor | haiku | Engineering |

## What was deliberately NOT carried over from xdipx_store

- `rr7-engineer` — React Router v7 + Oxygen specific. Replaced by `next-engineer`.
- `shopify-ops`, `sanity-content-builder`, `nalpac-feed-analyst`, `market-researcher`, `customer-service-emma`, `emma-*`, `media-manager`, `ivr-ops`, `log-monitor` — domain-specific to xdipx commerce / IVR / Emma voice. Not applicable here.

If LeadLandlord grows agents in those domains later (e.g., a "molly-outreach" persona for backlink pitches per the active plan), they live next to these.

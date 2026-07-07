# LeadLandlord Project Agents

6 project-scoped agents in [.claude/agents/](.claude/agents/). The original 4 were adapted from xdipx_store with LeadLandlord-native rules; the improvement-loop pair was added 2026-07-07 (ADR 0027).

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

## Improvement loop

The standing loop that reviews the runtime agent fleet and ships draft-PR improvements — daily triage + weekly deep cycle, run via Claude Code web Routines. Operating doc: [docs/agent-improvement-loop.md](docs/agent-improvement-loop.md) · backlog: [docs/improvement-backlog.md](docs/improvement-backlog.md) · decision: [ADR 0027](docs/adr/0027-agent-improvement-loop.md).

### [fleet-performance-analyst](.claude/agents/fleet-performance-analyst.md)
**Model:** sonnet · **Color:** teal · **Tools:** Read, Bash, Grep, Glob

Read-only diagnostician for the runtime fleet. Runs `scripts/fleet-metrics.ts` (read-only telemetry: failures, dead letters, budget burn, dedupe cascades, stale schedules), correlates with agent code, and outputs a ranked findings table for the improvement backlog. Degrades to repo-only consistency analysis when no DB access exists. Never edits files, never writes to the DB.

### [agent-prompt-engineer](.claude/agents/agent-prompt-engineer.md)
**Model:** sonnet · **Color:** plum · **Tools:** Read, Edit, Write, Bash, Grep, Glob

Implementation arm of the improvement loop for prompt/config-layer changes: `packages/agents` prompts + metadata, `.claude/agents` defs, skills, docs, cron cadences, budget/schedule seeds. Every change cites a backlog item + evidence; cadence/budget changes state $ impact; never widens autonomy without an architect verdict. Hands app code to `next-engineer`.

## Quick reference

| Agent | Model | Domain |
|---|---|---|
| next-engineer | sonnet | Engineering |
| leadlandlord-architect | sonnet | Engineering |
| leadlandlord-qa | sonnet | Engineering |
| leadlandlord-seo-auditor | haiku | Engineering |
| fleet-performance-analyst | sonnet | Improvement loop |
| agent-prompt-engineer | sonnet | Improvement loop |

## What was deliberately NOT carried over from xdipx_store

- `rr7-engineer` — React Router v7 + Oxygen specific. Replaced by `next-engineer`.
- `shopify-ops`, `sanity-content-builder`, `nalpac-feed-analyst`, `market-researcher`, `customer-service-emma`, `emma-*`, `media-manager`, `ivr-ops`, `log-monitor` — domain-specific to xdipx commerce / IVR / Emma voice. Not applicable here.

If LeadLandlord grows agents in those domains later (e.g., a "molly-outreach" persona for backlink pitches per the active plan), they live next to these.

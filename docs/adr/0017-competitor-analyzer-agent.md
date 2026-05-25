# ADR 0017 — Competitor Analyzer Agent

**Date:** 2026-05-24
**Status:** Accepted

## Context

Site-builder currently generates content without any knowledge of what the top-ranking local competitors are doing. Adding a research pass that abstracts competitor structure (topics, entities, gaps) into a brief could improve ranking performance without introducing duplicate content or footprint risk, provided the brief contains only abstracted signals, never scraped prose.

The proposed agent runs at build time between keyword-cluster loading and content-engine invocation. It uses Firecrawl to scrape competitor pages and SEMrush `domain_organic` to pull their ranking keywords, then synthesizes an abstracted brief stored on the sites row.

## Decision

Implement `competitor-analyzer` as a sub-agent called by site-builder, subject to the following constraints verified against the codebase:

**Data source for competitor targets:** `sites.competitorSeeds` (schema.ts line 231, typed `string[]`). The plan's original reference to `niches.dfsRaw.serpComposition.top_local` does not exist in the codebase. `dfsRaw` is an opaque jsonb blob with no typed shape. `competitorSeeds` is the correct, already-populated source.

**Insertion point in site-builder:** after line 178 (theme resolved) and before line 180 (`contentEngine.run`) in `packages/agents/src/site-builder/index.ts`.

**Invocation pattern:** `.run(input, { siteId, parentRunId: ctx.runId, dedupeKey: \`ca:${siteId}:${buildEpoch}\` })` — matches the keyword-planner (`kp:`) and content-engine (`ce:`) pattern.

**Non-fatal contract:** competitor-analyzer failure must not block the build. Wrap in try/catch identical to the hero-image pattern (site-builder lines 347-355). Empty or missing brief means content-engine runs without it.

**Cache:** reuse `withDataForSeoCache` from `packages/integrations/src/dataforseo/cache.ts` with `endpoint: 'semrush:domain-organic'`. The `endpoint` column is opaque text with no enum constraint; no new table or migration needed for the cache itself.

**Approval gate:** none. BaseAgent has no approval gate mechanism. Competitor-analyzer is read-only research; the CLAUDE.md approval-gate policy applies to side-effecting actions (Sanity writes, SMS, cross-site injection), not research agents. Budget cap via `defaultDailyCapUsd` (suggest $5) is the only gate, same pattern as keyword-planner ($10).

**Persistence:** new `competitor_brief` jsonb column on the `sites` table, migration 0033. Typed via `.$type<CompetitorBrief>()`. Not stored in `metadata` jsonb to keep it queryable by name and typed.

**ContentEngineInput extension:** add `competitor_brief?: CompetitorBrief` as an optional field in `content-engine/schema.ts`. Additive change; existing call sites need no modification.

## Alternatives

**A. Store brief in Sanity site doc instead of Postgres sites row.** Rejected: the brief is build-time research data, not publishable content. Sanity is for content; Postgres is for operational state. Storing it in Postgres keeps it queryable for analytics (did sites with briefs rank better?) and avoids an extra Sanity write per build.

**B. Run as a standalone agent triggered by agent_events (not a sub-agent).** Rejected: introduces async coordination complexity and a second agent_events consumer for a step that is purely synchronous in the build pipeline. The keyword-planner precedent (also a sub-agent) is the correct model.

**C. Source competitor domains from niches.dfsRaw.** Rejected: the field is an opaque blob with no typed shape; `serpComposition.top_local` does not exist. `sites.competitorSeeds` is already typed and populated by Niche Hunter.

## Consequences

- Migration 0033 adds one nullable jsonb column to `sites`.
- Registry gains one entry: `'competitor-analyzer': () => new CompetitorAnalyzer()`.
- site-builder gains one non-fatal try/catch block between lines 178 and 180.
- content-engine/schema.ts gains one optional field.
- buildUserPrompt gains a `competitorBriefSection` injected after `clusterSection` (same pattern, line 541-543 reference).
- SEMrush API key (`SEMRUSH_API_KEY`) must be added to Vercel env for the operator app. Budget: ~1.5-2.5K units/site against a 50K/mo cap.
- Sites with null `competitorSeeds` skip the agent gracefully and content-engine runs without a brief.

# ADR 0014 — Local Content Scout + Writer Agents

**Date:** 2026-05-21
**Status:** Accepted

---

## Context

LeadLandlord tenant sites need ongoing locally-relevant info pages (seasonal, trend, local-demand topics) to maintain SEO freshness between site builds. This differs from site-builder's initial content generation: it runs fleet-wide on a recurring cron cadence, proposes topics first, then drafts+publishes only after an approval gate.

Key constraints:

- Fleet-wide cron creates footprint risk if all sites receive similar topics on the same day.
- The approval gate must sit between ideation and drafting+publishing — two distinct phases with different cost profiles (ideation: cheap DataForSEO + lightweight Claude call; drafting: heavier Claude + Sanity write).
- `pageDocId(siteId, 'info', index)` uses a numeric index, so appending a new page to an existing site doc's `infoPages` array requires knowing the current count before writing. The full-rewrite `writeSiteToSanity` does not serve a single-page append safely.
- The niche-hunter auto-approve gap: `checkAutoApprove` flips `agentApprovals.status` to `auto_approved` but emits no `agent_events` row, so the downstream step never fires autonomously. This system must not replicate that gap.
- `seo-operator/author-info-page.ts` already provides a focused single-page Claude tool-use helper (`draftInfoPage`) with the exact schema this system needs. Reuse it.

---

## Decision

### A. Two agents: `local-content-scout` + `local-content-writer`

Two registered agents, not one.

`local-content-scout` runs per-site on the scheduler cadence. It reads the site's niche/city/state from the Postgres `sites` row, queries DataForSEO for trending/seasonal local keywords (reusing `getLocalKeywordMetrics` / `getKeywordCandidates`), generates 3-5 topic proposals via a lightweight Claude call (same tool-use pattern as niche-hunter brainstorm), and dual-writes a `content_ideas` domain row + an `agentApprovals` row (kind `content_idea`). It calls `checkAutoApprove` and respects the result. It does NOT draft content.

`local-content-writer` runs per approved `content_ideas` row. It calls `draftInfoPage` (the existing helper in `seo-operator/author-info-page.ts`), runs `ComplianceGuard`, computes the next available `info` index for that site, creates the Sanity page doc via `createOrReplace`, and patches+appends the page reference onto the site doc's `infoPages` array. It does NOT re-run the scout.

Rationale: the approval gate is between phases with meaningfully different costs. Collapsing them into one agent forces a single budget cap to cover both cost profiles and makes it impossible to auto-approve topic proposals while still requiring human review of the final draft. It also prevents the scheduler from re-proposing topics cheaply without triggering a full draft run.

### B. Post-approval wiring: domain-specific server action fixes the auto-approve gap

The generic `approveApproval` in `apps/operator/app/operator/approvals/actions.ts` only flips `agentApprovals.status`. It does not emit an `agent_events` row.

Add a new domain-specific server action `approveContentIdea` in `apps/operator/app/operator/content-ideas/actions.ts`. It mirrors `approveNiche` exactly: flip `content_ideas.status` to `approved`, AND emit `{ type: 'content_idea.approved', targetAgent: 'local-content-writer', payload: { contentIdeaId } }` into `agent_events`. `operator-tick` then claims and dispatches to `local-content-writer`.

For auto-approve: `local-content-scout` must emit the `agent_events` row itself when `checkAutoApprove` returns `matched: true`, before returning. This is the fix for the gap noted in the niche-hunter pattern. The event payload carries `{ contentIdeaId }`. Do NOT rely on the approvals UI to fire the event for auto-approved rows.

### C. New `content_ideas` domain table, not payload-only in `agent_approvals`

New Postgres table `content_ideas` with columns: `id`, `site_id` (FK to sites), `topic_slug`, `proposed_title`, `intent` (`info | service | comparison`), `rationale`, `status` (`pending | approved | rejected | expired | published`), `agentApprovalId` (FK to agent_approvals), `agentRunId` (FK to agent_runs), `sanityPageDocId` (nullable, set on publish), `publishedAt` (nullable), `createdAt`, `updatedAt`.

Rationale: `agent_approvals.payload` is a JSONB blob — queryable but not indexable on arbitrary fields without GIN indexes, not constrainable, and not a stable join target. The review UI needs to filter by site, show per-site topic history, and enforce "don't repeat topics" (which requires querying by `site_id + topic_slug`). These require a proper domain table. The `agentApprovals` row remains for the generic approvals inbox and auto-approve rule matching; `content_ideas` is the authoritative domain record.

### D. Footprint variance

Two layers, both fitting existing seams:

**Layer 1 — Scheduler cadence jitter.** The scout scheduler (`packages/agents/src/scheduler/local-content-scout.ts`) assigns each site to a 7-day rolling window bucket using `siteId` as the jitter seed: `weekBucket = isoWeek(today); slotDay = parseInt(siteId, 16) % 7`. Sites whose slot matches `today's day-of-week-in-cycle` are enqueued. This staggers a 100-site fleet over 7 days naturally. The `dedupeKey` for the `ScheduledEvent` includes the week bucket so a site that ran on Monday doesn't re-run until the following Monday even if the cron fires multiple times.

**Layer 2 — Generation-time topic archetype rotation.** The scout's Claude prompt receives a `topicArchetype` drawn from a small pool: `['seasonal', 'faq', 'comparison', 'local-event', 'cost-guide']`. The archetype is selected by `(weekNumber + siteIdSeed) % archetypes.length`, so each site cycles through all archetypes over ~5 weeks. No per-site config, no DB column — pure deterministic rotation from existing identifiers. This prevents the fleet from uniformly publishing "spring HVAC tips" in the same week.

This is the minimum viable variance design. No hygiene pool infrastructure is needed. The archetype rotation is enough to differentiate topics across the fleet; exact phrasing variance comes naturally from Claude's temperature (0.6-0.7 on the brainstorm call, matching niche-hunter).

### E. Sanity append strategy: patch+append, not full-rewrite

Do NOT call `writeSiteToSanity` for a single new page. It clobbers the entire site doc including `heroImage`, `domains`, `robotsDisallow`, and other operator-managed fields.

Instead: `local-content-writer` computes the next `info` index by fetching the current `infoPages` array length from Sanity before writing (a single `client.fetch` with a GROQ projection: `*[_id == $id][0]{infoPages}`). It then:
1. `createOrReplace` the new page doc at `pageDocId(siteId, 'info', nextIndex)`.
2. `client.patch(siteDocId(siteId)).setIfMissing({ infoPages: [] }).append('infoPages', [{ _key: \`i${nextIndex}\`, _ref: pageDocId(...), _type: 'reference' }]).commit()`.

Concurrency concern: two `local-content-writer` runs for the same site racing to compute `nextIndex` could collide and produce duplicate IDs. Mitigation: the `dedupeKey` for the writer agent is `local-content-writer:idea:${contentIdeaId}` — one run per approval, enforced by `BaseAgent.findExistingSuccess`. Since `agent_events` rows are claimed with `FOR UPDATE SKIP LOCKED`, concurrent runs for the same `contentIdeaId` cannot occur. Concurrent runs for different ideas on the same site within the same second are theoretically possible but extremely unlikely given the cron dispatch pattern; if they do collide, the higher-index page simply overwrites a doc that doesn't exist yet (no data loss, no ref corruption on the site doc because both appends succeed with different `_key`s). This is acceptable for an MVP.

### F. Multi-tenant and agent-runtime safety

- **Per-site budget cap.** `local-content-scout` has a `defaultDailyCapUsd` of $1 (cheap). `local-content-writer` has $3. Both respect `agent_budgets.enabled`. Fleet-wide spend is bounded by the scheduler's stagger: ~100 sites / 7 days ≈ 14 sites/day maximum, $3/day writer cap per site = $42/day ceiling at 100 sites. Set the operator-level `agent_budgets` row daily cap to $20 for MVP to stay conservative.
- **Site isolation.** The `dedupeKey` for the scout always includes `siteId + weekBucket`. Two scout runs for the same site in the same week collapse. The writer's `contentIdeaId`-keyed dedupe prevents double-publish.
- **No site-host imports.** Both agents live in `packages/agents/src/local-content-scout/` and `packages/agents/src/local-content-writer/`. Neither imports from `apps/site-host`. The writer re-uses `draftInfoPage` and `ComplianceGuard` already in `packages/agents`.
- **Sanity write safety.** Only `local-content-writer` writes to Sanity. The scout writes only to Postgres (`content_ideas` + `agent_approvals`). This matches the existing pattern where content-engine writes Sanity and niche-hunter writes Postgres only.
- **No agent-to-agent direct calls.** Scout emits `agent_events`; writer is dispatched by `operator-tick`. Scout never imports or instantiates writer.

---

## Alternatives Considered

**Single agent with internal mode switching (review/apply like seo-operator).** Rejected. The approval gate between ideation and drafting is a hard product requirement. A single agent cannot pause itself on a mode boundary waiting for human approval; it would have to complete the full topic+draft pipeline in one run and hope the approval UI catches up. The two-agent pattern with `agent_events` as the bus is the only way to put a real human gate between phases.

**Storing ideas only in `agent_approvals.payload`.** Rejected. No `site_id` FK, no `topic_slug` uniqueness constraint, no `published` status progression, no `sanityPageDocId` field. The generic approvals table cannot serve the per-site topic deduplication query.

**Per-site Sanity full-rewrite on each publish.** Rejected. Clobbers operator-managed fields (`domains`, `robotsDisallow`, theme overrides). Adds unnecessary load on a cron cadence.

---

## Consequences

- New files: `packages/agents/src/local-content-scout/index.ts`, `packages/agents/src/local-content-writer/index.ts`, `packages/agents/src/scheduler/local-content-scout.ts`, `apps/operator/app/operator/content-ideas/` (page + actions), migration for `content_ideas` table.
- Existing files modified: `packages/agents/src/registry.ts` (two new entries), `packages/agents/src/scheduler/index.ts` (one new entry), `packages/agents/src/metadata.ts` (two new display entries), `apps/operator/vercel.json` (cron for `local-content-scout` scheduler, weekly cadence).
- `draftInfoPage` in `packages/agents/src/seo-operator/author-info-page.ts` gains a new caller but is not modified.
- The auto-approve gap (auto_approved rows not emitting downstream events) is fixed in `local-content-scout` and documented as a known debt in `niche-hunter` — not backfilled now.

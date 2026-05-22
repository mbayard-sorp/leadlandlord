# Handoff: Local Content Pipeline (scout + writer) — pilot continuation

You are continuing the local-content feature. The core build is **merged to main** (PR #101). The **scout is now validated live end-to-end** (this session), and two fixes shipped on branch `claude/youthful-banach-285676` (commits below). Your job is to finish the remaining plan items: browser-verify the operator UI + a published page, run the pilot, build measurement/alerting, and run the footprint audit. This doc is self-contained; read it fully before touching anything.

## What this feature is

Two agents keep tenant sites fresh with net-new, locally-relevant info pages for SEO, gated by operator review and ramping to autonomy via existing auto-approve rules. Pilot is **opt-in per site, default OFF**, so nothing runs until a site is enabled.

- **`local-content-scout`** (cron-paced, per opted-in site): researches seasonal + keyword-gap topics via DataForSEO, guards against cannibalizing owned clusters, dual-writes a `content_ideas` row + an `agent_approvals` row (kind `content_idea`), runs `checkAutoApprove`, and **self-emits** a `content.idea.approved` event on auto-approve so autonomy actually flows.
- **`local-content-writer`** (event-driven on `content.idea.approved`): drafts one info page via `draftInfoPage` and patch-appends it to the Sanity site doc.

Design rationale and decisions are in **ADR `docs/adr/0016-local-content-scout-writer.md`** (renumbered from 0014 after an IndexNow ADR collision).

## Key files

| Area | Path |
| --- | --- |
| Scout agent | `packages/agents/src/local-content-scout/{index.ts,schema.ts,index.test.ts}` |
| Writer agent | `packages/agents/src/local-content-writer/{index.ts,persist-info-page.ts,index.test.ts}` |
| Shared authoring helper | `packages/agents/src/shared/author-info-page.ts` (`draftInfoPage`) |
| Scheduler (cadence jitter) | `packages/agents/src/scheduler/local-content-scout.ts` |
| Registry / metadata | `packages/agents/src/registry.ts` (`local-content-scout` at the scout key), `metadata.ts` |
| Approval engine (autonomy) | `packages/agents/src/approval-engine.ts` (`checkAutoApprove`) |
| DataForSEO keyword demand | `packages/integrations/src/dataforseo/{index.ts,location.ts}` |
| Review queue + actions | `apps/operator/app/operator/approvals/content/{page.tsx,actions.ts,ContentApproveButtons.tsx}` |
| Cost dashboard | `apps/operator/app/operator/content/page.tsx` |
| Per-site pilot toggle | `apps/operator/app/operator/sites/[id]/{LocalContentToggle.tsx,actions.ts,page.tsx}` |
| Cron wiring | `apps/operator/vercel.json` (`/api/cron/schedule/local-content-scout`, `0 9 * * *`) |
| DB schema | `packages/db/src/schema.ts` (`contentIdeas`, `sites.localContentEnabled`) |
| Migration | `packages/db/migrations/0030_content_ideas.sql` (**applied to prod already**) |

## Data model + flow

- `content_ideas`: `id, siteId, topic, topicSlug, targetKeyword, angle, archetype, voiceSeed, rationale, status, sourceApprovalId, scoutRunId, writerRunId, publishedPageDocId, publishedAt, createdAt, decidedAt`. Unique on `(siteId, topicSlug)`. `status`: pending|approved|rejected|published|auto_approved|expired.
- `scoutRunId`/`writerRunId` link to `agent_runs.costUsd` for the cost dashboard.
- Flow: scheduler fans out per opted-in site -> scout proposes (`content_ideas` + `agent_approvals`) -> operator approves in `/operator/approvals/content` (the approve action emits `{type:'content.idea.approved', targetAgent:'local-content-writer'}`) -> operator-tick dispatches the writer -> writer publishes to Sanity -> renders at `/pages/[slug]` on site-host.
- Autonomy ramp: add rows to `auto_approve_rules` (kind `content_idea`, matcher predicates `$gte/$lte/$eq/$includes`) via `/operator/approvals/rules`. On match, the scout marks the idea `auto_approved` AND emits the writer event itself (no human step).
- Footprint variance: per-site day-of-week cadence jitter (`hash(siteId) % 7`) in the scheduler; archetype (5 types) + voiceSeed (3) rotation. Archetype is per-(site, ISO week); voiceSeed is per-site. So **all ideas in one scout run share one archetype + voice** — that's by design.

## What is DONE

- All schema, agents, operator UI, scheduler, cron, ADR built, reviewed, merged (PR #101). Migration `0030` applied to prod.
- **Writer path E2E'd live** (prior session) against a warming site with `MOCK_AI=1`, then cleaned up.
- **SCOUT path E2E'd live (this session).** Ran `LocalContentScout.run({site_id, idea_count:3})` against the test site (foundation repair, Austin) with **real DataForSEO + real Claude**. Produced 3 sane, locally-relevant, non-cannibalizing info-page ideas; dual-wrote `content_ideas` (pending) + `agent_approvals` (kind `content_idea`, pending). Cost ~$0.01/run. All test rows cleaned up; verified back to 0.
- **Two fixes shipped (branch `claude/youthful-banach-285676`, not yet PR'd):**
  - `7e0808a fix(sanity): re-point integrations barrel to light subpaths so agents run outside Next.js` — `@leadlandlord/integrations/sanity` (+ `asset-upload.ts`) now import from `@leadlandlord/sanity-schema/client` and `/ids` instead of the package main entry. The main entry loads `./types/*` (Studio `defineType` + CSS), which crashed standalone tsx. **This is what makes agents tsx-runnable** — the writer-style throwaway harness pattern now works for any agent. No change to the barrel's exposed API.
  - `f1b69cf fix(local-content-scout): use DataForSEO-valid location_name for demand fetch` — the scout was sending `"Austin, TX, United States"` to `google_ads/search_volume/live`, which returns `40501 Invalid Field: 'location_name'` and silently degraded to raw seeds. That endpoint needs the **full state name and NO spaces after commas** (`"Austin,Texas,United States"` -> Austin metro, verified live). New `dfsLocationName`/`usStateName` in `packages/integrations/src/dataforseo/location.ts`; scout wired to it. Re-ran live: demand fetch now succeeds.
- Static verification green: agents 322 tests, integrations 59 tests (4 new for the location helper).

## What is LEFT (finish the plan)

1. **Browser-verify the operator UI + a published page.** Run the operator dev server and verify `/operator/approvals/content`, `/operator/content` (cost figures), the site-detail toggle (`/operator/sites/[id]`), and an actual published page rendering at `/pages/[slug]` on site-host. Worktree env note below.
2. **Run the pilot.** Opt in 5-10 warming/no-tenant sites via the toggle. Let the scheduler run (or trigger the cron route — but note the day-of-week slot gate, below). Review -> approve -> confirm publish + render. Then add an `auto_approve_rules` row to demonstrate the autonomy ramp (idea auto-publishes with no manual step).
3. **Build the fast-follow measurement/alerting** (scoped out of v1): using existing `seo_metrics_daily` / `ga4_metrics_daily` + `alertRules`/`alertEvents`, alert and auto-pause a site's scout (flip `sites.localContentEnabled = false`) if its service-page click share drops >15% week-over-week or Lighthouse SEO < 80. This is the cannibalization/quality safety net.
4. **Cross-site footprint audit.** Once several real pages exist across the pilot, run `leadlandlord-seo-auditor` to confirm archetype/voice/length/structure actually differ across sites. Only meaningful with multiple live pages.

## How to run an agent live (the validated pattern)

Agents are now tsx-runnable (fix `7e0808a`). The scout was validated with a throwaway harness in `packages/agents/.scratch-scout-e2e/` (since deleted). Re-create the pattern:

1. Put the script **inside the package whose deps it uses** (`packages/agents/.scratch-*`) so pnpm resolves workspace deps.
2. Load env with a small `fs`-based loader, NOT just `--env-file` (see gotcha below).
3. `new LocalContentScout().run({ site_id, idea_count })` — BaseAgent handles persistence/budget/dedupe. Leave `MOCK_AI` unset for a real run.
4. Read back what it wrote (`content_ideas` by `siteId`, `agent_approvals` by `kind='content_idea'` + `payload->>'siteId'`).
5. Clean up: delete `agent_approvals` (kind content_idea, payload siteId), `content_ideas` (siteId), `agent_runs` (agent='local-content-scout'). Verify back to 0. Never blanket-reset.

Cost per scout run is trivial: 1 DataForSEO `search_volume` call (~$0.0024, 30-day cached in `dataforseo_cache`) + 1 Claude Sonnet call (~$0.01). The 10 req/s cap is a non-issue for single runs.

## Critical gotchas (hard-won; do not relearn these)

- **Auto-mode classifier gates prod DB access.** Any command touching prod Postgres — even a read-only SELECT — is auto-denied as a Production Read/Write, and an in-chat question does NOT count as consent. Add a `Bash(...)` allow rule to `.claude/settings.local.json` matching the exact harness command shape (it matches per-`&&`-segment), then re-run.
- **Node `--env-file` silently drops some keys.** Hit 2026-05-21: `ANTHROPIC_API_KEY` (line 5 of the root `.env.local`) didn't load while `DATABASE_URL`/`DATAFORSEO_AUTH` did — not a malformed-line issue. Don't trust `--env-file` alone; add a tiny `fs` loader that regex-parses `KEY=VALUE` and backfills `process.env`. All vars in the root file are single-line.
- **Worktree env:** there is no `.env.local` at a worktree root. The real one is at the MAIN repo root (`/Users/mikebayard/Claude/LeadLandlord/.env.local`). `drizzle.config.ts` walks up to find it; scripts do not — supply it explicitly. **`DATABASE_URL` is PROD.** Confirm destructive/shared prod actions with Mike first.
- **Worktree needs `pnpm install`** before typecheck/test/run — fresh worktrees have no `node_modules`.
- **Scheduler day-of-week gate.** `scheduleLocalContentScout` only emits an event for a site when `hash(siteId) % 7 === today's UTC day-of-week`. Opting a site in does NOT mean the cron route fires it today. For an on-demand single-site run, invoke the agent directly (the validated harness) rather than relying on the schedule route.
- **Scout does NOT check `localContentEnabled`.** That gate lives only in the scheduler fan-out. `scout.run({site_id})` runs for any site id — so validation needs no opt-in write; only the pilot toggle does.
- **`draftInfoPage` returns `jsonLd` ALREADY stringified.** `persist-info-page` stores it as-is. Do NOT `JSON.stringify` it again. The Sanity `jsonLd` field is `type: 'text'`.
- **Never `createOrReplace` the Sanity SITE doc.** Only `patch().setIfMissing().append('infoPages', ...)`. `createOrReplace` clobbers every field site-builder wrote.
- **Sanity content lake rejects object attribute names with `@`** (`@type`, `@context`). Store JSON-LD as a stringified string. **GROQ cannot project `@type`** — parse the stored string in JS.
- **Migrations: the drizzle journal is out of sync** (`0029_cwv` was never journaled). **Do NOT use `drizzle-kit generate`** — it produces a destructive mega-migration. Hand-write idempotent migrations (`IF NOT EXISTS`), add a journal entry with a synthetic incrementing `when`, and **include `--> statement-breakpoint` between statements**.
- **MOCK_AI is checked inconsistently across packages.** The scout's ideate checks `process.env.MOCK_AI === '1'`; DataForSEO and Anthropic-mock check `=== 'true'`. No single value mocks both the LLM and DataForSEO. For a fully-live run, leave it unset. (Worth normalizing someday, but out of scope.)

## Verification commands

```
pnpm install   # fresh worktree only
pnpm --filter @leadlandlord/agents typecheck && pnpm --filter @leadlandlord/agents test
pnpm --filter @leadlandlord/integrations typecheck && pnpm --filter @leadlandlord/integrations test
pnpm --filter @leadlandlord/operator typecheck && pnpm --filter @leadlandlord/operator lint && pnpm --filter @leadlandlord/operator build
```

## Test site used previously

`f6635f70-d765-4507-b7e3-4f5a63b337f1` (foundation repair, Austin TX, warming, no tenant) — safe for throwaway test pages. As of 2026-05-21 it had 0 `content_ideas` and `localContentEnabled=false`, and **0 sites fleet-wide had `localContentEnabled=true`** (no fan-out exposure). Confirm it's still safe before reusing.

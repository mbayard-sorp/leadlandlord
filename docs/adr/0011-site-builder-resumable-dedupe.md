# ADR 0011: Site-builder resumability via stable build-epoch dedupe keys

Date: 2026-05-20

Follows the operator site-build incident (foundation-repair / Wichita Falls), where approving a niche left a site as a half-built empty shell. Pairs with the lease reaper shipped in the same incident (`reapStaleLeases`, `packages/db/src/queue.ts`).

## Context

`site-builder` (`packages/agents/src/site-builder/index.ts`) runs inline inside `runOperatorTick`'s `waitUntil` (`apps/operator/lib/operator-tick.ts`), bounded by the host route's `maxDuration = 800` (`apps/operator/app/api/cron/operator-tick/route.ts`). Its longest step is a single multi-minute Claude tool-use call via `content-engine`. In production that call repeatedly ran past the 800s ceiling, the instance was killed mid-run, and the site was never finished.

Two failures compounded:

1. **Orphaned events wedged forever.** `claimEvents` filtered `processing_at IS NULL`, so a crashed run's event was never re-claimed without manual SQL. **Fixed separately** by `reapStaleLeases` (900s lease, increments attempts, dead-letters after `RUNTIME_MAX_ATTEMPTS`). That makes re-runs *happen* and *bounded*, but does nothing to make a re-run *finish*.

2. **Every re-run redid the expensive work from scratch.** site-builder passed each sub-agent a dedupe key scoped to the dispatching run: `` `${ctx.runId}:content-engine` `` (and the same for keyword-planner, tracking-setup, compliance-guard). `BaseAgent.run` caches a successful run in `agent_runs` and short-circuits via `findExistingSuccess` on the dedupe key — but `ctx.runId` is fresh on every re-claim, so the cache **never hit on retry**. The content-engine Claude call re-executed in full each attempt and re-orphaned at the same ceiling. A bounded 5-attempt retry of an operation that *cannot* finish in the budget just dead-letters 5 times.

This was confirmed independently by an architecture review and a code-level feasibility read: the root cause is the **`runId` coupling of the dedupe keys**, not the execution model itself.

A secondary defect surfaced in the same code: tracking-setup has a natural `dedupeKeyFn: (i) => i.site_id` (`packages/agents/src/tracking-setup/index.ts`), but the `` `${ctx.runId}:tracking-setup` `` override defeated it — so each retry provisioned a **new paid Twilio number** (~$1/mo each, leaked).

## Decision

Anchor the expensive, content-related sub-agent dedupe keys to a **stable per-build token (`build_epoch`)** instead of `runId`, so a reaper-triggered re-run reuses the cached `agent_runs` output and resumes at the first unfinished step.

1. **`build_epoch` column on `sites`** (migration `0028_sites_build_epoch.sql`, `text`, nullable). Set **once** at the top of `execute()` via `buildEpoch = COALESCE(build_epoch, <new uuid>)` so a racing second writer keeps the first value. Bumped to a fresh uuid **only** when the operator wants fresh content: `force_content_refresh === true` (new input flag) or `skip_keyword_planning === true` (re-target regenerates content against existing clusters — preserves today's "re-target always regenerates" behavior).

2. **Content-related sub-agents keyed to `siteId + buildEpoch`:**
   - content-engine → `` `ce:${siteId}:${buildEpoch}` ``
   - keyword-planner → `` `kp:${siteId}:${buildEpoch}` `` (belt-and-suspenders; the cluster loop-guard already skips it when clusters exist)
   - compliance-guard → `` `cg:${siteId}:${buildEpoch}:${page.slug}` ``

3. **tracking-setup keyed to `siteId` (stable, NOT epoch).** Drop the override entirely and let its natural `dedupeKeyFn` win. A paid phone line is independent of content, so a content refresh must not reprovision it.

A plain reaper retry carries no refresh flag, so the epoch is stable, content-engine cache-hits, and the run completes the tail (Sanity write + hero image, < ~60s) well inside the 800s budget. The Sanity write is already idempotent (deterministic doc IDs); the hero image is non-fatal.

## Consequences

- The orphaned site `e8809e38` recovers on the first post-deploy tick: reaper releases the stale lease, the run re-claims, sets/keeps its epoch, cache-hits content-engine if a prior attempt succeeded the Claude call, and finishes. If no prior attempt completed content, it runs content once and is now far more likely to finish within budget since planning is skipped via the loop-guard.
- Operator "re-target" / "regenerate" actions MUST pass `force_content_refresh` (or `skip_keyword_planning`, already wired) to get fresh content; otherwise they reuse the cached run. Operator UI wiring for an explicit "Regenerate" button is a follow-up, not part of this ADR.
- No change to the execution model, the queue, `base.ts`, or `operator-tick`'s drain logic.

## Explicitly deferred

- **Durable execution primitive (Vercel Workflows / Queues).** The native durable-step model would remove the 800s ceiling entirely, but it is a meaningful seam change (operator-tick would enqueue workflow invocations rather than run agents inline; `BaseAgent` budget/kill-switch/`agent_runs` machinery would integrate with the workflow lifecycle). Defer until there is evidence that stable-epoch resumability is insufficient — most likely a `content_rich` (~28-page) build whose single content call cannot finish in one budget even with planning skipped. Revisit then with its own ADR.
- **Head-of-line blocking from disabled-agent schedulers** (incident handoff #4) — separate concern, not addressed here.

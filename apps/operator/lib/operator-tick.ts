import { waitUntil } from '@vercel/functions';
import {
  claimEvents,
  markEventProcessed,
  markEventFailed,
  reapStaleLeases,
  reEmitStuckContentApprovals,
  reEmitStuckNicheApprovals,
  reapOrphanedRuns,
  reapStrandedBuildingSites,
  releaseEventLease,
} from '@leadlandlord/db/queue';
import { isKillSwitchActive } from '@leadlandlord/db/system-state';
import { reapExpiredBuildSellPii, sweepStalePendingMigrations } from '@leadlandlord/db/buildsell';
import { getAgent } from '@leadlandlord/agents/registry';
import { classifyAgentError } from '@leadlandlord/agents/error-classify';
import { log } from '@leadlandlord/shared/log';
import * as Sentry from '@sentry/nextjs';

const BATCH_LIMIT = 5;

// Host route maxDuration is 800 s. We stop dispatching new agents when the
// remaining wall-clock falls below this threshold, then release the leases of
// any claimed-but-not-yet-started events so their attempts aren't burned.
const HOST_MAX_DURATION_MS = 800_000;
const DISPATCH_CUTOFF_REMAINING_MS = 120_000;

export interface TickResult {
  claimed: number;
  dispatched: string[];
  reaped?: { reclaimed: number; deadLettered: number };
  reapedOrphanedRuns?: number;
  reapedStrandedBuilds?: number;
  reEmittedContent?: string[];
  reEmittedNiches?: string[];
  skipped?: 'kill_switch';
}

/**
 * Drain up to BATCH_LIMIT unprocessed agent_events: claim with FOR UPDATE
 * SKIP LOCKED, validate registry, then run each agent inline via waitUntil.
 * Returns immediately with the claim count; agent work continues in the
 * background up to the host route's maxDuration.
 *
 * Shared by:
 *   - /api/cron/operator-tick (Vercel Cron, every minute)
 *   - server actions that let the operator drain on demand instead of
 *     waiting up to 60s for the next tick.
 */
export async function runOperatorTick(): Promise<TickResult> {
  log.info(
    { build_marker: 'pr12-mock-2026-05-08T0030', mock_ai: process.env.MOCK_AI ?? 'unset' },
    'operator-tick build marker',
  );

  // Global kill switch: short-circuit the whole drain. Claiming events while
  // the switch is on used to classify each agent's KillSwitchActiveError as a
  // runtime_error, burning attempts toward dead-letter — toggling the switch
  // could silently poison legit work. Not claiming at all is the clean stop.
  if (await isKillSwitchActive()) {
    log.warn({}, 'operator-tick skipped — portfolio kill switch active');
    return { claimed: 0, dispatched: [], skipped: 'kill_switch' };
  }

  // Reclaim leases orphaned by workers that died mid-run (e.g. hit the host
  // route's maxDuration ceiling). Without this a crashed run wedges its event
  // forever. Runs before claim so a freshly-released event is claimable this
  // same tick.
  const reaped = await reapStaleLeases();
  if (reaped.reclaimed || reaped.deadLettered) {
    log.warn(reaped, 'operator-tick reaped stale leases');
  }

  // Mark orphaned agent_runs rows as failed. Complements reapStaleLeases: the
  // reaper recovers the agent_events lease; this recovers the agent_runs row
  // for the same crash, keeping the operator panel accurate.
  const { count: reapedOrphanedRuns } = await reapOrphanedRuns();
  if (reapedOrphanedRuns) {
    log.warn({ count: reapedOrphanedRuns }, 'operator-tick reaped orphaned agent runs');
  }

  // Reap sites stranded at `building` after a worker died between the building
  // flip and the terminal status stamp. Keeps the activity panel free of
  // phantom in-progress builds; recovery is the operator Retry button.
  const { count: reapedStrandedBuilds } = await reapStrandedBuildingSites();
  if (reapedStrandedBuilds) {
    log.warn({ count: reapedStrandedBuilds }, 'operator-tick reaped stranded building sites');
  }

  // Build & Sell ToS guarantee: null PII on buildsell_leads past their 30-day
  // cached_until every tick (keeps only place_id/trade/city/state). No new cron.
  try {
    const reapedBuildSellPii = await reapExpiredBuildSellPii();
    if (reapedBuildSellPii) {
      log.info({ count: reapedBuildSellPii }, 'operator-tick reaped expired build-sell PII');
    }
  } catch (err) {
    log.error({ err }, 'operator-tick build-sell PII reaper failed');
  }

  // Discard stale raw content-migration suggestions (approved content already
  // lives in Sanity). Keeps the "discard raw crawl output" guarantee.
  try {
    const sweptMigrations = await sweepStalePendingMigrations();
    if (sweptMigrations) {
      log.info({ count: sweptMigrations }, 'operator-tick swept stale pending migrations');
    }
  } catch (err) {
    log.error({ err }, 'operator-tick pending-migration sweep failed');
  }

  // Recover approved content ideas whose dispatch event was lost or
  // dead-lettered. Runs before claim so a re-emitted event is claimable this
  // same tick. Safe against double-publish via the writer's dedupeKeyFn.
  const { reEmitted: reEmittedContent } = await reEmitStuckContentApprovals();
  if (reEmittedContent.length) {
    log.warn({ reEmitted: reEmittedContent }, 'operator-tick re-emitted stuck content approvals');
  }

  // Recover approved niches whose site-builder dispatch event was lost or
  // dead-lettered. Runs before claim so a re-emitted event is claimable this
  // same tick. Guards: niche has no live non-failed site, no live niche.approved
  // event, and has not been re-emitted more than MAX_NICHE_DISPATCH_EVENTS times.
  const { reEmitted: reEmittedNiches } = await reEmitStuckNicheApprovals();
  if (reEmittedNiches.length) {
    log.warn({ reEmitted: reEmittedNiches }, 'operator-tick re-emitted stuck niche approvals');
  }

  // Snapshot wall-clock before claiming. The sequential dispatch loop uses this
  // to detect when approaching the host maxDuration and release unleased events
  // so their attempts are not burned by a dispatch that never started.
  const requestStartedAt = Date.now();

  const events = await claimEvents(BATCH_LIMIT);
  log.info({ claimed: events.length }, 'operator-tick claimed events');

  const dispatched: string[] = [];
  const eligibleEvents: typeof events = [];
  for (const ev of events) {
    const targetAgent = ev.targetAgent ?? ev.agent;
    if (!targetAgent || ev.requiresApproval) {
      // Approval-gated events stay claimed but unprocessed until a human acts on them.
      continue;
    }
    eligibleEvents.push(ev);
    dispatched.push(targetAgent);
  }

  // Pre-validate registry membership BEFORE the long-running waitUntil so we
  // can fail-fast on unknown agents and dead-letter them within this request.
  const knownAgents = await Promise.all(
    eligibleEvents.map(async (ev) => {
      const targetAgent = ev.targetAgent ?? ev.agent;
      try {
        return { ev, agent: getAgent(targetAgent!), targetAgent: targetAgent! };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ event_id: ev.id, agent: targetAgent, err: msg }, 'unknown agent — dead-lettering');
        await markEventFailed(ev.id, msg, 'unknown_agent');
        return null;
      }
    }),
  );
  const toDispatch = knownAgents.filter((x): x is NonNullable<typeof x> => x !== null);

  // Sequential dispatch inside a single waitUntil. PRIOR INCIDENT 2026-05-07:
  // per-event waitUntils spawned N parallel background promises that all hit
  // assertBudgetAvailable() concurrently — they all read stale spent_today_usd
  // before any committed cost, defeating daily caps. Sequential eliminates the
  // race. Latency cost: 5 events × ~60s p95 = ~5 min within maxDuration.
  waitUntil(
    (async () => {
      for (let i = 0; i < toDispatch.length; i++) {
        const item = toDispatch[i];
        // toDispatch is a dense array — item is always defined here, but TS
        // infers the element type as T | undefined when using index access.
        if (!item) continue;
        const { ev, agent, targetAgent } = item;

        // Wall-clock budget guard: if the remaining time before the host's
        // maxDuration would expire is under DISPATCH_CUTOFF_REMAINING_MS, stop
        // dispatching and release the leases of all remaining events so their
        // attempts are NOT burned. They will be re-claimed on the next tick.
        const elapsedMs = Date.now() - requestStartedAt;
        if (HOST_MAX_DURATION_MS - elapsedMs < DISPATCH_CUTOFF_REMAINING_MS) {
          log.warn(
            { agent: targetAgent, event_id: ev.id, elapsedMs },
            'operator-tick wall-clock budget exhausted — releasing remaining event leases',
          );
          // Release this event and all remaining ones (index i onward).
          // Awaited sequentially to avoid fire-and-forget that races with exit.
          for (let j = i; j < toDispatch.length; j++) {
            const tail = toDispatch[j];
            if (!tail) continue;
            await releaseEventLease(tail.ev.id).catch((releaseErr) => {
              log.error(
                {
                  event_id: tail.ev.id,
                  err: releaseErr instanceof Error ? releaseErr.message : releaseErr,
                },
                'failed to release event lease on budget cutoff',
              );
            });
          }
          break;
        }

        const payload = ev.payload as Record<string, unknown>;
        const payloadSiteId =
          typeof payload?.site_id === 'string' ? payload.site_id : undefined;
        // Optional per-event dedupe override. Lets a deliberate re-run (e.g. the
        // IndexNow backfill script) force a fresh agent run past the agent's own
        // dedupeKeyFn, which would otherwise collapse the re-emit into the
        // cached prior success. Absent on normal events → no behavior change.
        const payloadDedupeKey =
          typeof payload?.dedupeKey === 'string' ? payload.dedupeKey : undefined;
        try {
          log.info(
            { agent: targetAgent, event_id: ev.id, site_id: payloadSiteId ?? null },
            'agent invocation starting (inline, sequential)',
          );
          await agent.run(payload, {
            eventId: ev.id,
            siteId: payloadSiteId,
            dedupeKey: payloadDedupeKey,
          });
          await markEventProcessed(ev.id);
          log.info({ agent: targetAgent, event_id: ev.id }, 'agent invocation succeeded');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const kind = classifyAgentError(err);
          log.error(
            { agent: targetAgent, event_id: ev.id, err: msg, kind },
            'agent invocation failed',
          );
          Sentry.captureException(err, { tags: { agent: targetAgent, event_id: ev.id, kind } });
          try {
            await markEventFailed(ev.id, msg, kind);
          } catch (markErr) {
            log.error(
              {
                agent: targetAgent,
                event_id: ev.id,
                err: markErr instanceof Error ? markErr.message : markErr,
              },
              'failed to mark event failed (queue inconsistency risk)',
            );
          }
        }
      }
    })(),
  );

  return { claimed: events.length, dispatched, reaped, reapedOrphanedRuns, reapedStrandedBuilds, reEmittedContent, reEmittedNiches };
}

import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { claimEvents, markEventProcessed, markEventFailed } from '@leadlandlord/db/queue';
import { getAgent } from '@leadlandlord/agents/registry';
import { classifyAgentError } from '@leadlandlord/agents/error-classify';
import { log } from '@leadlandlord/shared/log';
import * as Sentry from '@sentry/nextjs';
import { assertCronAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Bumped to 800s so waitUntil can run agents directly inside this function
// (no HTTP self-hop). Was 30s when fan-out went through /api/cron/agent/[name];
// that pattern proved unreliable on Fluid Compute self-calls — the dispatcher's
// fetch handshake to its own sibling route would silently fail to establish
// (despite identical curl-from-outside succeeding), even with waitUntil.
//
// New shape: claim, kick off agent.run inside waitUntil per event, return 200
// immediately. The instance stays alive up to maxDuration while waitUntils
// run concurrently. Each waitUntil writes its own agent_runs row + closes the
// agent_event on success/failure.
export const maxDuration = 800;

const BATCH_LIMIT = 5;

/**
 * Vercel Cron entry point — runs every minute. Claims unprocessed
 * agent_events with FOR UPDATE SKIP LOCKED, then runs each agent inline
 * via waitUntil. The HTTP response goes back in milliseconds; the actual
 * agent work continues in the background up to maxDuration.
 *
 * /api/cron/agent/[name] still exists for manual ops + future external
 * triggers, but Vercel Cron no longer dispatches through it.
 */
export async function GET(req: Request) {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  // BUILD MARKER — printed every tick to verify which build is running.
  // Bumped 2026-05-08T00:30 with PR 12 + alias-fix verification.
  log.info(
    { build_marker: 'pr12-mock-2026-05-08T0030', mock_ai: process.env.MOCK_AI ?? 'unset' },
    'operator-tick build marker',
  );
  const events = await claimEvents(BATCH_LIMIT);
  log.info({ claimed: events.length }, 'operator-tick claimed events');

  const dispatched: string[] = [];
  // Dispatch SEQUENTIALLY inside a single waitUntil. Previously we called
  // waitUntil per-event, spawning N parallel background promises that all
  // hit assertBudgetAvailable() concurrently — they all read stale
  // spent_today_usd before any committed cost, defeating daily caps.
  // Sequential dispatch eliminates that race entirely. Latency cost: 5 events
  // × ~60s p95 = ~5 min within the 800s maxDuration budget. Cascade case
  // collapses to ~0 (dedupe short-circuit). See incident 2026-05-07.
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

  waitUntil(
    (async () => {
      for (const { ev, agent, targetAgent } of toDispatch) {
        // Pull `site_id` off the event payload and forward it to BaseAgent.run
        // as opts.siteId. Without this, the parent agent_runs row is created
        // with site_id = NULL — sub-agents (which receive siteId via parentRun
        // propagation) still get scoped, but the parent doesn't show up in the
        // operator activity panel's `WHERE site_id = $siteId` query.
        const payload = ev.payload as Record<string, unknown>;
        const payloadSiteId =
          typeof payload?.site_id === 'string' ? payload.site_id : undefined;
        try {
          log.info(
            { agent: targetAgent, event_id: ev.id, site_id: payloadSiteId ?? null },
            'agent invocation starting (inline, sequential)',
          );
          await agent.run(payload, {
            // Pass eventId, NOT dedupeKey. BaseAgent prefers the agent's
            // natural dedupeKeyFn (e.g. `${niche}:${city}:${state}`) and falls
            // back to `event:${eventId}` only when no keyFn exists. This lets
            // duplicate events for the same logical work collapse to one run
            // via findExistingSuccess. See incident 2026-05-07.
            eventId: ev.id,
            siteId: payloadSiteId,
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

  return NextResponse.json({ ok: true, claimed: events.length, dispatched });
}

import { waitUntil } from '@vercel/functions';
import { claimEvents, markEventProcessed, markEventFailed } from '@leadlandlord/db/queue';
import { getAgent } from '@leadlandlord/agents/registry';
import { classifyAgentError } from '@leadlandlord/agents/error-classify';
import { log } from '@leadlandlord/shared/log';
import * as Sentry from '@sentry/nextjs';

const BATCH_LIMIT = 5;

export interface TickResult {
  claimed: number;
  dispatched: string[];
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
      for (const { ev, agent, targetAgent } of toDispatch) {
        const payload = ev.payload as Record<string, unknown>;
        const payloadSiteId =
          typeof payload?.site_id === 'string' ? payload.site_id : undefined;
        try {
          log.info(
            { agent: targetAgent, event_id: ev.id, site_id: payloadSiteId ?? null },
            'agent invocation starting (inline, sequential)',
          );
          await agent.run(payload, {
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

  return { claimed: events.length, dispatched };
}

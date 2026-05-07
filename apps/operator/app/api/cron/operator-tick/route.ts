import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { claimEvents, markEventProcessed, markEventFailed } from '@leadlandlord/db/queue';
import { getAgent } from '@leadlandlord/agents/registry';
import { classifyAgentError } from '@leadlandlord/agents/error-classify';
import { log } from '@leadlandlord/shared/log';

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
  if (
    process.env.CRON_SECRET &&
    req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const events = await claimEvents(BATCH_LIMIT);
  log.info({ claimed: events.length }, 'operator-tick claimed events');

  const dispatched: string[] = [];

  for (const ev of events) {
    const targetAgent = ev.targetAgent ?? ev.agent;
    if (!targetAgent || ev.requiresApproval) {
      // Approval-gated events stay claimed but unprocessed until a human acts on them.
      continue;
    }

    let agent;
    try {
      agent = getAgent(targetAgent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ event_id: ev.id, agent: targetAgent, err: msg }, 'unknown agent — dead-lettering');
      await markEventFailed(ev.id, msg, 'unknown_agent');
      continue;
    }

    // Run inline via waitUntil. Errors are caught here because waitUntil
    // swallows them — we always need to close the loop on the agent_event row.
    waitUntil(
      (async () => {
        try {
          log.info({ agent: targetAgent, event_id: ev.id }, 'agent invocation starting (inline)');
          await agent.run(ev.payload as Record<string, unknown>, {
            dedupeKey: `event:${ev.id}`,
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
      })(),
    );
    dispatched.push(targetAgent);
  }

  return NextResponse.json({ ok: true, claimed: events.length, dispatched });
}

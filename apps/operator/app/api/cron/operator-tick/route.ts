import { NextResponse } from 'next/server';
import { claimEvents, markEventFailed } from '@leadlandlord/db/queue';
import { signCronPayload } from '../../../../lib/auth';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BATCH_LIMIT = 10;

/**
 * Vercel Cron entry point. Runs every minute.
 *
 * Pulls up to BATCH_LIMIT unprocessed agent_events using `FOR UPDATE SKIP LOCKED`,
 * then fans out to /api/cron/agent/[name] for the actual work. The agent endpoint
 * runs on Fluid Compute with maxDuration=300 so a long content-gen run doesn't
 * block the dispatcher loop.
 */
export async function GET(req: Request) {
  // Vercel Cron sends a Bearer token matching CRON_SECRET; for local dev we
  // just allow anything since the dispatcher itself doesn't expose any secrets.
  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const events = await claimEvents(BATCH_LIMIT);
  log.info({ claimed: events.length }, 'operator-tick claimed events');

  const baseUrl = process.env.OPERATOR_PUBLIC_URL ?? 'http://localhost:3000';
  const dispatched: string[] = [];

  for (const ev of events) {
    const targetAgent = ev.targetAgent ?? ev.agent;
    if (!targetAgent || ev.requiresApproval) {
      // Approval-gated events stay claimed but unprocessed until a human acts on them.
      continue;
    }
    const body = JSON.stringify({ event_id: ev.id, agent: targetAgent, payload: ev.payload });
    const signature = signCronPayload(body);
    try {
      // Fire-and-forget — do not await, the agent handler is its own function instance.
      void fetch(`${baseUrl}/api/cron/agent/${encodeURIComponent(targetAgent)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Signature': signature,
        },
        body,
      }).catch((err) => {
        log.error({ err: err instanceof Error ? err.message : err }, 'fan-out fetch failed');
      });
      dispatched.push(targetAgent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markEventFailed(ev.id, msg);
    }
  }

  return NextResponse.json({ ok: true, claimed: events.length, dispatched });
}

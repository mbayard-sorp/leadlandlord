import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { getAgent } from '@leadlandlord/agents/registry';
import { classifyAgentError } from '@leadlandlord/agents/error-classify';
import { markEventProcessed, markEventFailed } from '@leadlandlord/db/queue';
import { verifyCronSignature } from '../../../../../lib/auth';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 800s — Vercel Pro ceiling. Site Builder runs through this worker and its
// content-gen + Imagen + deploy pipeline can take 4-7 min on niche-heavy
// bundles. waitUntil keeps the function instance alive for the agent run
// up to this ceiling.
export const maxDuration = 800;

const Body = z.object({
  event_id: z.string().uuid(),
  agent: z.string(),
  payload: z.record(z.unknown()),
});

/**
 * Long-running agent dispatch endpoint. Receives signed POSTs from
 * operator-tick, validates synchronously, then runs the agent in a
 * `waitUntil` background task and returns 202 immediately.
 *
 * Why 202 + waitUntil and not the natural `await agent.run()` pattern:
 *
 *   - Site Builder (and other Phase 6 agents) take 3-7 minutes per run.
 *     If we await before responding, the caller's HTTP fetch hits the
 *     undici default headers timeout (~5 min) and gives up — leaving the
 *     event "in-flight" with no record. We saw this exact failure in prod
 *     during the niche-approved E2E.
 *   - Vercel Fluid Compute's `waitUntil` is designed for exactly this:
 *     respond fast, keep the instance alive until the registered promise
 *     settles (or maxDuration expires).
 *   - The function still has the full 800s budget to complete the work.
 *     If agent.run actually exceeds 800s, the instance is killed and
 *     markEventFailed runs with a timeout note (not yet implemented —
 *     would need an external timer; today the event just stays claimed
 *     and the next operator-tick won't reclaim because processing_at is
 *     set. Acceptable for a 3-7 min worst-case.)
 */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const rawBody = await req.text();

  const sig = req.headers.get('X-Cron-Signature');
  if (!verifyCronSignature(rawBody, sig)) {
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 401 });
  }

  const parsed = Body.safeParse(JSON.parse(rawBody));
  if (!parsed.success || parsed.data.agent !== name) {
    return NextResponse.json({ ok: false, reason: 'bad_payload' }, { status: 400 });
  }

  const { event_id, payload } = parsed.data;
  let agent;
  try {
    agent = getAgent(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ agent: name, event_id, err: msg }, 'unknown agent — dead-lettering');
    await markEventFailed(event_id, msg, 'unknown_agent');
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // Background work — `waitUntil` keeps the function instance alive until
  // the promise resolves. Errors are caught here (waitUntil swallows them
  // otherwise) so we always close the loop on the agent_event row.
  waitUntil(
    (async () => {
      try {
        log.info({ agent: name, event_id }, 'agent invocation starting');
        // Pass eventId, not dedupeKey — agent's natural dedupeKeyFn wins.
        // See operator-tick/route.ts for the full incident context.
        await agent.run(payload, { eventId: event_id });
        await markEventProcessed(event_id);
        log.info({ agent: name, event_id }, 'agent invocation succeeded');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const kind = classifyAgentError(err);
        log.error({ agent: name, event_id, err: msg, kind }, 'agent invocation failed');
        try {
          await markEventFailed(event_id, msg, kind);
        } catch (markErr) {
          log.error(
            { agent: name, event_id, err: markErr instanceof Error ? markErr.message : markErr },
            'failed to mark event failed (queue inconsistency risk)',
          );
        }
      }
    })(),
  );

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}

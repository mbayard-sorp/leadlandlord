import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAgent } from '@leadlandlord/agents/registry';
import { markEventProcessed, markEventFailed } from '@leadlandlord/db/queue';
import { verifyCronSignature } from '../../../../../lib/auth';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  event_id: z.string().uuid(),
  agent: z.string(),
  payload: z.record(z.unknown()),
});

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
  const agent = getAgent(name);

  try {
    log.info({ agent: name, event_id }, 'agent invocation starting');
    await agent.run(payload, { dedupeKey: `event:${event_id}` });
    await markEventProcessed(event_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ agent: name, event_id, err: msg }, 'agent invocation failed');
    await markEventFailed(event_id, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

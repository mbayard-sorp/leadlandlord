import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Call status callback — Twilio posts lifecycle events for the inbound leg
 * here (the URL is wired up as StatusCallback at number-provision time).
 * We only act on terminal states, stamping ended_at + duration on the call
 * row. The recording webhook may also set these; last writer wins and both
 * agree within a second.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, params))) {
    log.warn({ callSid: params.CallSid }, 'twilio status signature mismatch');
    return new NextResponse('forbidden', { status: 403 });
  }

  const callSid = params.CallSid;
  const callStatus = params.CallStatus;
  const terminal = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];

  if (callSid && callStatus && terminal.includes(callStatus)) {
    const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : undefined;
    const db = getDb();
    const updated = await db
      .update(calls)
      .set({ endedAt: new Date(), durationS: duration })
      .where(eq(calls.twilioCallSid, callSid))
      .returning({ id: calls.id });
    if (!updated[0]) {
      log.info({ callSid, callStatus }, 'status callback for unknown call');
    }
  }

  return NextResponse.json({ ok: true });
}

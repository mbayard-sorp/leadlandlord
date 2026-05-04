import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recording status callback. Twilio fires this when a `<Dial recording=...>`
 * recording is finished encoding. Updates the call row with the recording URL
 * + duration. The transcription job (Voice Intelligence) is queued separately
 * and lands at /api/webhooks/twilio/transcription.
 *
 * Twilio docs: https://www.twilio.com/docs/voice/api/recording
 */
export async function POST(req: Request) {
  const fields = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, fields))) {
    log.warn({ recordingSid: fields.RecordingSid }, 'twilio recording signature mismatch');
    return new NextResponse('forbidden', { status: 403 });
  }

  const callSid = fields.CallSid;
  const recordingSid = fields.RecordingSid;
  const recordingUrl = fields.RecordingUrl;
  const recordingStatus = fields.RecordingStatus;
  const duration = fields.RecordingDuration ? parseInt(fields.RecordingDuration, 10) : undefined;

  if (!callSid || !recordingUrl || recordingStatus !== 'completed') {
    log.info({ callSid, recordingSid, recordingStatus }, 'recording not yet complete, ignoring');
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  const result = await db
    .update(calls)
    .set({
      recordingUrl: `${recordingUrl}.mp3`,
      twilioRecordingSid: recordingSid,
      durationS: duration,
      endedAt: new Date(),
    })
    .where(eq(calls.twilioCallSid, callSid))
    .returning({ id: calls.id });

  const updated = result[0];
  if (!updated) {
    log.warn({ callSid, recordingSid }, 'recording webhook for unknown call');
  } else {
    log.info({ callId: updated.id, callSid, durationS: duration }, 'recording attached');
  }

  return NextResponse.json({ ok: true });
}

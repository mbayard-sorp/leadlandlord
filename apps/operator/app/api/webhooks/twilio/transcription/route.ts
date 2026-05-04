import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { getDb, calls, type Call } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Transcription callback. Two flavors:
 *   - Classic `<Record transcribe="true">` — fields include TranscriptionText
 *   - Voice Intelligence — fields include a TranscriptSid (we pull text via API)
 *
 * On either path: write the transcript onto the call row, then trigger the
 * classification background job (LLM call to label won/quoted/lost/spam).
 */
export async function POST(req: Request) {
  const fields = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, fields))) {
    log.warn({ callSid: fields.CallSid }, 'twilio transcription signature mismatch');
    return new NextResponse('forbidden', { status: 403 });
  }

  const callSid = fields.CallSid;
  const transcriptionStatus = fields.TranscriptionStatus;
  const transcriptionText = fields.TranscriptionText;

  if (!callSid) {
    return NextResponse.json({ ok: false, error: 'missing_call_sid' }, { status: 400 });
  }

  if (transcriptionStatus && transcriptionStatus !== 'completed') {
    log.info({ callSid, transcriptionStatus }, 'transcription not yet complete');
    return NextResponse.json({ ok: true });
  }

  if (!transcriptionText) {
    log.warn({ callSid }, 'transcription webhook with no text — Voice Intelligence path TBD');
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  const result = await db
    .update(calls)
    .set({ transcript: transcriptionText })
    .where(eq(calls.twilioCallSid, callSid))
    .returning();

  const updated = result[0];
  if (!updated) {
    log.warn({ callSid }, 'transcription webhook for unknown call');
    return NextResponse.json({ ok: true });
  }

  log.info({ callId: updated.id, callSid }, 'transcript attached');

  // Background classification — runs after the response is sent so Twilio
  // doesn't time out. The classifier itself is a Phase-2.5 follow-up; for now
  // we just log the intent.
  after(() => classifyCall(updated));

  return NextResponse.json({ ok: true });
}

async function classifyCall(call: Call): Promise<void> {
  // TODO(phase-2.5): Anthropic call → "won" | "quoted" | "lost" | "spam".
  // Update calls.classification + calls.estRevenueUsd.
  log.info(
    { callId: call.id, transcriptLen: call.transcript?.length ?? 0 },
    'classification job queued (not yet implemented)',
  );
}

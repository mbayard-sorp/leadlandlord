import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { getDb, calls, sites, type Call } from '@leadlandlord/db';
import { CallClassifier } from '@leadlandlord/agents/call-classifier';
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

  // Run classification in the background so Twilio doesn't time out.
  after(() => classifyCall(updated));

  return NextResponse.json({ ok: true });
}

/**
 * Classify a call using the CallClassifier agent and persist the result onto
 * the calls row. Errors are swallowed and logged — a classification failure
 * shouldn't surface to Twilio (the transcript is already saved, we can retry
 * classification later via /operator).
 */
async function classifyCall(call: Call): Promise<void> {
  if (!call.transcript) return;
  const db = getDb();
  try {
    const site = (await db.select().from(sites).where(eq(sites.id, call.siteId)).limit(1))[0];
    if (!site) {
      log.warn({ callId: call.id, siteId: call.siteId }, 'classify: site row missing');
      return;
    }
    const classifier = new CallClassifier();
    const result = await classifier.run(
      {
        call_id: call.id,
        transcript: call.transcript,
        niche: site.niche,
        city: site.city,
        state: site.state,
        caller_number: call.callerNumber ?? undefined,
        duration_s: call.durationS ?? undefined,
      },
      { siteId: call.siteId },
    );
    await db
      .update(calls)
      .set({
        classification: result.classification,
        estRevenueUsd: result.est_revenue_usd != null ? result.est_revenue_usd.toFixed(2) : null,
        metadata: {
          ...(call.metadata as Record<string, unknown> | null),
          classification_summary: result.summary,
          classification_confidence: result.confidence,
          classification_notes: result.notes,
        },
      })
      .where(eq(calls.id, call.id));
    log.info(
      {
        callId: call.id,
        classification: result.classification,
        confidence: result.confidence,
        estRevenueUsd: result.est_revenue_usd,
      },
      'call classified',
    );
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, callId: call.id },
      'classify call failed',
    );
  }
}

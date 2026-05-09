import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, sites, calls } from '@leadlandlord/db';
import {
  buildForwardingTwiml,
  buildVoicemailTwiml,
} from '@leadlandlord/integrations/twilio';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbound voice webhook — Twilio calls this when one of our tracking numbers
 * receives a call. Returns TwiML that:
 *   1. Plays a whisper to the called party (the operator or tenant)
 *   2. Forwards the call with dual-channel recording
 *   3. Falls back to voicemail when no forwarding number is configured
 *
 * Twilio identifies the inbound number via the `Called` and `To` form fields.
 * We look up the matching site by `twilio_phone_sid` (preferred) or
 * `tracking_number` (fallback for mock numbers). One call row per inbound
 * call is created upfront — the recording webhook fills in the recording URL
 * later.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, params))) {
    log.warn({ from: params.From, to: params.To }, 'twilio voice signature mismatch');
    return new NextResponse('forbidden', { status: 403 });
  }

  const calledSid = params.CalledSid; // PN... — the IncomingPhoneNumber SID Twilio dialed
  const calledNumber = params.Called || params.To;
  const callerNumber = params.From;
  const callSid = params.CallSid;

  const db = getDb();
  let site = calledSid
    ? (await db.select().from(sites).where(eq(sites.twilioPhoneSid, calledSid)).limit(1))[0]
    : undefined;
  if (!site && calledNumber) {
    const rows = await db
      .select()
      .from(sites)
      .where(eq(sites.trackingNumber, calledNumber))
      .limit(1);
    site = rows[0];
  }

  if (!site) {
    log.warn({ calledSid, calledNumber, callSid }, 'voice webhook: no matching site');
    return new NextResponse(
      buildVoicemailTwiml({
        greeting:
          'Thanks for calling. Please leave a message and we will return your call.',
      }),
      { status: 200, headers: { 'content-type': 'text/xml' } },
    );
  }

  // Record the call upfront so subsequent webhooks can correlate by CallSid.
  // The unique index on twilio_call_sid is partial (WHERE twilio_call_sid IS NOT NULL),
  // so ON CONFLICT must repeat the predicate or Postgres can't infer the
  // arbiter index (error 42P10).
  await db
    .insert(calls)
    .values({
      siteId: site.id,
      twilioCallSid: callSid,
      callerNumber,
      calledNumber,
      direction: 'inbound',
      startedAt: new Date(),
    })
    .onConflictDoNothing({
      target: calls.twilioCallSid,
      where: sql`${calls.twilioCallSid} IS NOT NULL`,
    });

  const baseUrl = process.env.OPERATOR_PUBLIC_URL ?? '';
  const recordingCallback = site.recordingEnabled
    ? `${baseUrl}/api/webhooks/twilio/recording`
    : undefined;
  const whisperUrl = site.whisperMessage
    ? `${baseUrl}/api/webhooks/twilio/whisper?msg=${encodeURIComponent(site.whisperMessage)}`
    : undefined;

  // No forwarding configured → straight to voicemail with optional transcription.
  if (!site.forwardingNumber) {
    const transcribeCb = `${baseUrl}/api/webhooks/twilio/transcription`;
    // Use the AI-generated greeting MP3 if we've recorded one for this site
    // (set during tracking-setup via ElevenLabs → Sanity assets). Fall back
    // to plain text + Polly TTS if no audio URL is available.
    const meta = (site.metadata ?? {}) as { voicemailGreetingUrl?: string };
    return new NextResponse(
      buildVoicemailTwiml({
        greeting: site.whisperMessage ?? `Thanks for calling. Please leave a message.`,
        audioUrl: meta.voicemailGreetingUrl,
        recordingStatusCallback: recordingCallback,
        transcribeCallback: transcribeCb,
      }),
      { status: 200, headers: { 'content-type': 'text/xml' } },
    );
  }

  return new NextResponse(
    buildForwardingTwiml({
      forwardingNumber: site.forwardingNumber,
      whisperUrl,
      recordingStatusCallback: recordingCallback,
    }),
    { status: 200, headers: { 'content-type': 'text/xml' } },
  );
}

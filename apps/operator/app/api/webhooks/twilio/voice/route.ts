import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import {
  buildForwardingTwiml,
  buildVoicemailTwiml,
  resolveSpamThrottleConfig,
  shouldDivertRepeatCaller,
} from '@leadlandlord/integrations/twilio';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';
import {
  countRecentCallsFromCaller,
  findSiteForCall,
  voicemailResponseForSite,
} from '../../../../../lib/twilio-voice';

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

  const calledNumber = params.Called || params.To;
  const callerNumber = params.From;
  // CNAM lookup result — present only when caller-name lookup is enabled on the
  // number and the lookup resolves (commonly blank for mobile callers).
  const callerName = params.CallerName?.trim() || null;
  const callSid = params.CallSid;

  const site = await findSiteForCall(params);

  if (!site) {
    log.warn(
      { calledSid: params.CalledSid, calledNumber, callSid },
      'voice webhook: no matching site',
    );
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
  const db = getDb();
  await db
    .insert(calls)
    .values({
      siteId: site.id,
      twilioCallSid: callSid,
      callerNumber,
      callerName,
      calledNumber,
      direction: 'inbound',
      startedAt: new Date(),
    })
    .onConflictDoNothing({
      target: calls.twilioCallSid,
      where: sql`${calls.twilioCallSid} IS NOT NULL`,
    });

  const baseUrl = process.env.OPERATOR_PUBLIC_URL ?? '';

  // No forwarding configured -> straight to voicemail with optional transcription.
  if (!site.forwardingNumber) {
    return voicemailResponseForSite(site, baseUrl);
  }

  // Repeat-caller spam throttle: rapid-fire dialers (often spam) shouldn't keep
  // ringing the tenant. Once a caller exceeds the allowed calls within the
  // window, divert to voicemail instead of forwarding — the lead is still
  // captured and classified, and the tenant stops getting hammered.
  const throttle = resolveSpamThrottleConfig();
  if (throttle && callerNumber && callSid) {
    const since = new Date(Date.now() - throttle.windowMs);
    const recentCount = await countRecentCallsFromCaller(site.id, callerNumber, since);
    if (shouldDivertRepeatCaller(recentCount, throttle)) {
      log.warn(
        { siteId: site.id, callerNumber, recentCount, callSid },
        'voice webhook: diverting rapid repeat caller to voicemail',
      );
      // Flag the diverted call so operators can see why it went to voicemail.
      await db
        .update(calls)
        .set({
          isVoicemail: true,
          metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({
            throttled: 'repeat_caller_spam',
            recentCallCount: recentCount,
          })}::jsonb`,
        })
        .where(eq(calls.twilioCallSid, callSid));
      return voicemailResponseForSite(site, baseUrl);
    }
  }

  const recordingCallback = site.recordingEnabled
    ? `${baseUrl}/api/webhooks/twilio/recording`
    : undefined;
  const whisperUrl = site.whisperMessage
    ? `${baseUrl}/api/webhooks/twilio/whisper?msg=${encodeURIComponent(site.whisperMessage)}`
    : undefined;

  // No inbound greeting on the forwarding path: the caller should hear
  // ringback right away, like a normal call. The greeting is only used on
  // the voicemail paths (no forwarding number, or forward unanswered).
  return new NextResponse(
    buildForwardingTwiml({
      forwardingNumber: site.forwardingNumber,
      whisperUrl,
      recordingStatusCallback: recordingCallback,
      // Caller ID must be the Twilio-owned tracking number: it gets SHAKEN/STIR
      // attestation A. Passing through the lead's own number gets attestation C
      // and carriers reject the forwarded leg before it rings.
      callerId: site.trackingNumber ?? calledNumber,
      // Fall back to voicemail when the forward is not answered.
      actionUrl: `${baseUrl}/api/webhooks/twilio/dial-complete`,
    }),
    { status: 200, headers: { 'content-type': 'text/xml' } },
  );
}

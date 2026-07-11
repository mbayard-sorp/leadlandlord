import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';
import {
  aiQualificationResponseForSite,
  findSiteForCall,
  voicemailResponseForSite,
} from '../../../../../lib/twilio-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>\n<Response />`;

/**
 * `<Dial action>` callback — Twilio requests this when the forwarded leg
 * finishes (answered and hung up, or never connected). When the forward was
 * not answered we fall back to the site's voicemail so the lead is captured
 * instead of the caller being hung up on. DialCallStatus values:
 * completed | answered | busy | no-answer | failed | canceled.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, params))) {
    log.warn({ callSid: params.CallSid }, 'twilio dial-complete signature mismatch');
    return new NextResponse('forbidden', { status: 403 });
  }

  const callSid = params.CallSid;
  const dialStatus = params.DialCallStatus;
  const forwarded = dialStatus === 'completed' || dialStatus === 'answered';

  log.info({ callSid, dialStatus, dialDuration: params.DialCallDuration }, 'dial complete');

  // Forward connected — the call is over, nothing left to do.
  if (forwarded) {
    return new NextResponse(EMPTY_RESPONSE, {
      status: 200,
      headers: { 'content-type': 'text/xml' },
    });
  }

  // Forward failed — mark the call row and drop to voicemail.
  if (callSid) {
    const db = getDb();
    await db
      .update(calls)
      .set({
        isVoicemail: true,
        metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({
          dialCallStatus: dialStatus,
        })}::jsonb`,
      })
      .where(eq(calls.twilioCallSid, callSid));
  }

  const site = await findSiteForCall(params);
  if (!site) {
    log.warn({ callSid, called: params.Called || params.To }, 'dial-complete: no matching site');
    return new NextResponse(EMPTY_RESPONSE, {
      status: 200,
      headers: { 'content-type': 'text/xml' },
    });
  }

  const baseUrl = process.env.OPERATOR_PUBLIC_URL ?? '';

  // Fallback mode: the tenant's phone didn't pick up — hand off to the AI
  // agent instead of going straight to voicemail. aiQualificationResponseForSite
  // marks answeredBy: 'ai' on success and falls back to voicemail itself on
  // any ElevenLabs failure (never dead-air the caller).
  if (site.callMode === 'fallback') {
    return aiQualificationResponseForSite(site, {
      fromNumber: params.From ?? '',
      toNumber: params.Called || params.To || '',
      callerName: params.CallerName?.trim() || null,
      callSid,
      baseUrl,
    });
  }

  return voicemailResponseForSite(site, baseUrl);
}

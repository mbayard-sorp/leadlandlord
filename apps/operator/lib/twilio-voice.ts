import { NextResponse } from 'next/server';
import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import {
  getDb,
  sites,
  calls,
  tenants,
  callQualificationScripts,
  type Site,
  type CallQualificationScript,
} from '@leadlandlord/db';
import { buildVoicemailTwiml } from '@leadlandlord/integrations/twilio';
import { registerInboundCall, renderQuestionScript } from '@leadlandlord/integrations/elevenlabs';
import { log } from '@leadlandlord/shared/log';

/**
 * Resolve the site a Twilio voice webhook belongs to. Matches by
 * `twilio_phone_sid` (preferred, from the CalledSid param) or by
 * `tracking_number` (fallback for mock numbers).
 */
export async function findSiteForCall(params: Record<string, string>): Promise<Site | undefined> {
  const calledSid = params.CalledSid;
  const calledNumber = params.Called || params.To;

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
  return site;
}

/**
 * Count how many inbound calls the given caller has placed to a site since
 * `since`. Used by the repeat-caller spam throttle on the voice webhook. The
 * count includes the current call, which was inserted upfront by the handler.
 * Backed by the `calls_site_started_idx` index on (site_id, started_at).
 */
export async function countRecentCallsFromCaller(
  siteId: string,
  callerNumber: string,
  since: Date,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(calls)
    .where(
      and(
        eq(calls.siteId, siteId),
        eq(calls.callerNumber, callerNumber),
        gte(calls.startedAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * Voicemail TwiML response for a site, using its AI-generated greeting MP3
 * when one exists (set during tracking-setup via ElevenLabs -> Sanity assets)
 * and falling back to inbound_greeting / whisper text + Polly TTS.
 */
export function voicemailResponseForSite(site: Site, baseUrl: string): NextResponse {
  const meta = (site.metadata ?? {}) as { voicemailGreetingUrl?: string };
  return new NextResponse(
    buildVoicemailTwiml({
      greeting:
        site.inboundGreeting ??
        site.whisperMessage ??
        'Thanks for calling. Please leave a message.',
      audioUrl: meta.voicemailGreetingUrl,
      recordingStatusCallback: site.recordingEnabled
        ? `${baseUrl}/api/webhooks/twilio/recording`
        : undefined,
      transcribeCallback: `${baseUrl}/api/webhooks/twilio/transcription`,
    }),
    { status: 200, headers: { 'content-type': 'text/xml' } },
  );
}

/**
 * Load a site's niche question script (`call_qualification_scripts`),
 * falling back to the single default row (`niche IS NULL`). Returns
 * undefined only if neither exists (e.g. the seed row was deleted).
 */
export async function loadQualificationScript(
  niche: string,
): Promise<CallQualificationScript | undefined> {
  const db = getDb();
  const nicheRows = await db
    .select()
    .from(callQualificationScripts)
    .where(eq(callQualificationScripts.niche, niche))
    .limit(1);
  if (nicheRows[0]) return nicheRows[0];

  const defaultRows = await db
    .select()
    .from(callQualificationScripts)
    .where(isNull(callQualificationScripts.niche))
    .limit(1);
  return defaultRows[0];
}

export interface AiQualificationParams {
  /** Caller's number (Twilio `From`), E.164. */
  fromNumber: string;
  /** The tracking number that was called (Twilio `To`), E.164. */
  toNumber: string;
  /** CNAM caller name, when Twilio resolved one. */
  callerName?: string | null;
  /** Twilio CallSid — used to record a fallback failure onto the call row. */
  callSid?: string;
  baseUrl: string;
}

/**
 * Hand an inbound call off to the shared ElevenLabs qualification agent.
 * Loads the site's niche question script, builds the flat dynamic-variable
 * set the agent's prompt template expects, and registers the call with
 * ElevenLabs' native Twilio integration. On any failure (missing script,
 * ElevenLabs API error) we NEVER dead-air the caller — fall back to the
 * site's normal voicemail response and best-effort flag the failure on the
 * call row's metadata for operator visibility.
 */
export async function aiQualificationResponseForSite(
  site: Site,
  params: AiQualificationParams,
): Promise<NextResponse> {
  try {
    const script = await loadQualificationScript(site.niche);
    if (!script) {
      throw new Error(`no call_qualification_scripts row for niche="${site.niche}" or default`);
    }

    const db = getDb();
    const tenantRows = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.siteId, site.id), ne(tenants.status, 'churned')))
      .limit(1);
    const tenant = tenantRows[0];

    const businessName = tenant?.businessName ?? `${site.niche} in ${site.city}, ${site.state}`;
    const transferNumber = site.forwardingNumber ?? '';

    const dynamicVariables: Record<string, string> = {
      niche: site.niche,
      city: site.city,
      state: site.state,
      business_name: businessName,
      question_script: renderQuestionScript(script.questions),
      caller_number: params.fromNumber,
      caller_name: params.callerName?.trim() || '',
      transfer_number: transferNumber,
      warm_transfer_enabled: transferNumber ? 'true' : 'false',
      // Echoed back in the post-call payload's
      // conversation_initiation_client_data.dynamic_variables.call_sid so
      // apps/operator/app/api/webhooks/elevenlabs/post-call/route.ts can
      // correlate even if elevenlabsConversationId sync is delayed.
      call_sid: params.callSid ?? '',
    };

    const twiml = await registerInboundCall({
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      dynamicVariables,
    });

    // Mark who answered here (rather than in each calling route) so both the
    // voice webhook's ai_first path and dial-complete's fallback path get
    // consistent answeredBy bookkeeping without duplicating success/failure
    // branching in two places. isVoicemail: false matters for the
    // dial-complete fallback path specifically — it marks the row
    // isVoicemail: true (unanswered forward) before handing off here, so a
    // successful AI handoff needs to clear that flag or the call would be
    // mislabeled as a voicemail even though a live agent answered it.
    if (params.callSid) {
      await db
        .update(calls)
        .set({ answeredBy: 'ai', isVoicemail: false })
        .where(eq(calls.twilioCallSid, params.callSid))
        .catch(() => {});
    }

    return new NextResponse(twiml, { status: 200, headers: { 'content-type': 'text/xml' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { err: message, siteId: site.id, callSid: params.callSid },
      'aiQualificationResponseForSite failed — falling back to voicemail',
    );

    if (params.callSid) {
      const db = getDb();
      await db
        .update(calls)
        .set({
          metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({
            aiQualificationFailed: true,
            aiQualificationError: message,
          })}::jsonb`,
        })
        .where(eq(calls.twilioCallSid, params.callSid))
        .catch(() => {
          // Best-effort — never let a metadata-write failure mask the fallback.
        });
    }

    return voicemailResponseForSite(site, params.baseUrl);
  }
}

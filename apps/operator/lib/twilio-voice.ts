import { NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, sites, calls, type Site } from '@leadlandlord/db';
import { buildVoicemailTwiml } from '@leadlandlord/integrations/twilio';

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

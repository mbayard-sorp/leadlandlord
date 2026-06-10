import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, sites, type Site } from '@leadlandlord/db';
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

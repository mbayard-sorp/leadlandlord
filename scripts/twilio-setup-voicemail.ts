/**
 * Buy a Twilio number and configure it for voicemail-only operation.
 *
 * Cost: $1.15/mo for the number, $0 for the greeting (Twilio's Polly Neural
 * TTS is included free). When call volume warrants, swap `whisper_message`
 * for `metadata.voicemailGreetingUrl` and the same voice webhook will
 * `<Play>` the audio file instead.
 *
 * What it does:
 *   1. Buy the number on Twilio with VoiceUrl pointing to operator webhook.
 *   2. Update sites row: tracking_number, twilio_phone_sid, tracking_provider,
 *      forwarding_number=null (voicemail mode), whisper_message=<greeting>.
 *
 * After this, calls hit /api/webhooks/twilio/voice which sees forwarding_number
 * is null → builds voicemail TwiML with `<Say voice="Polly.Joanna">{whisper_message}</Say>`
 * → records up to 3 min → transcribes via Twilio's transcribeCallback → row in /operator/calls.
 *
 * Usage:
 *   pnpm tsx scripts/twilio-setup-voicemail.ts <site-id> <phone-number> [greeting]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { eq } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';

function defaultGreeting(niche: string, city: string): string {
  const Niche = niche
    .split(' ')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  return `Hey, thanks for calling ${Niche} ${city}. We're with another customer right now and can't get to the phone — leave your name, your number, and what you need handled, and we'll call you right back. Thanks.`;
}

async function main() {
  const sitePrefix = process.argv[2];
  const phone = process.argv[3];
  const greetingText = process.argv[4];
  if (!sitePrefix || !phone) {
    throw new Error('Usage: pnpm tsx scripts/twilio-setup-voicemail.ts <site-id> <phone> [greeting]');
  }

  const db = getDb();
  const allSites = await db.select().from(sites);
  const site = allSites.find((s) => s.id.startsWith(sitePrefix));
  if (!site) throw new Error(`No site matched "${sitePrefix}"`);

  const greeting = greetingText ?? defaultGreeting(site.niche, site.city);
  console.log(`Site:     ${site.niche} / ${site.city}, ${site.state}`);
  console.log(`Greeting: "${greeting}"`);

  const twilioSid = process.env.TWILIO_ACCOUNT_SID!;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
  const publicBase = process.env.OPERATOR_PUBLIC_URL ?? 'https://leadlandlord-operator.vercel.app';
  const voiceUrl = `${publicBase}/api/webhooks/twilio/voice`;
  const statusUrl = `${publicBase}/api/webhooks/twilio/status`;

  console.log(`\nBuying ${phone} on Twilio (~$1.15/mo)...`);
  const buyBody = new URLSearchParams({
    PhoneNumber: phone,
    FriendlyName: `LeadLandlord-${site.id.slice(0, 8)} (${site.niche} ${site.city})`,
    VoiceUrl: voiceUrl,
    VoiceMethod: 'POST',
    StatusCallback: statusUrl,
    StatusCallbackMethod: 'POST',
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buyBody.toString(),
    },
  );
  if (!res.ok) {
    console.error('Twilio failed:', res.status, await res.text());
    process.exit(1);
  }
  const purchased = await res.json();
  console.log(`✓ ${purchased.phone_number}  SID: ${purchased.sid}`);

  await db
    .update(sites)
    .set({
      trackingNumber: purchased.phone_number,
      twilioPhoneSid: purchased.sid,
      trackingProvider: 'twilio',
      forwardingNumber: null,
      whisperMessage: greeting,
      recordingEnabled: true,
      updatedAt: new Date(),
    })
    .where(eq(sites.id, site.id));

  console.log(`\nUpdated site row:`);
  console.log(`  tracking_number   = ${purchased.phone_number}`);
  console.log(`  tracking_provider = twilio`);
  console.log(`  forwarding_number = null  (voicemail mode)`);
  console.log(`  whisper_message   = (greeting set)`);
  console.log(`\nTest by calling ${purchased.phone_number} — should hit voicemail with the greeting.`);
  console.log(`Recordings + transcripts land in /operator/calls.`);
  if (site.domain) console.log(`\nLive site: https://${site.domain}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

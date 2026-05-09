/**
 * Buy a Twilio phone number and attach it to a LeadLandlord site.
 *
 * SPENDS REAL MONEY: ~$1.15/mo for the number, plus inbound usage.
 *
 * What it does:
 *   1. Provision the chosen number on Twilio (POST IncomingPhoneNumbers).
 *      Sets VoiceUrl to the operator webhook so calls route through us.
 *   2. Update sites.tracking_number / twilio_phone_sid / tracking_provider.
 *   3. Set sites.forwarding_number to OPERATOR_PHONE_NUMBER from env (or
 *      whatever the user passes via --forward).
 *   4. Trigger revalidation by patching sites.updatedAt — site-host's phone
 *      lookup is uncached, so it picks up immediately on next request.
 *
 * Usage:
 *   pnpm tsx scripts/twilio-buy-and-attach.ts <site-id> <phone-number>
 *   pnpm tsx scripts/twilio-buy-and-attach.ts 878a1dcc +17252403261
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, sites } from '@leadlandlord/db';
import { eq } from 'drizzle-orm';

async function main() {
  const sitePrefix = process.argv[2];
  const phone = process.argv[3];
  if (!sitePrefix || !phone) {
    throw new Error('Usage: pnpm tsx scripts/twilio-buy-and-attach.ts <site-id> <phone-number>');
  }

  const db = getDb();
  const allSites = await db.select().from(sites);
  const site = allSites.find((s) => s.id.startsWith(sitePrefix));
  if (!site) throw new Error(`No site matched "${sitePrefix}"`);

  const twilioSid = process.env.TWILIO_ACCOUNT_SID!;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

  const publicBase = process.env.OPERATOR_PUBLIC_URL ?? 'https://leadlandlord-operator.vercel.app';
  const voiceUrl = `${publicBase}/api/webhooks/twilio/voice`;
  const statusUrl = `${publicBase}/api/webhooks/twilio/status`;

  // 1. Provision (real money)
  const body = new URLSearchParams({
    PhoneNumber: phone,
    FriendlyName: `LeadLandlord-${site.id.slice(0, 8)} (${site.niche} ${site.city})`,
    VoiceUrl: voiceUrl,
    VoiceMethod: 'POST',
    StatusCallback: statusUrl,
    StatusCallbackMethod: 'POST',
  });
  console.log(`Buying ${phone} on Twilio (~$1.15/mo)...`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    console.error('Twilio failed:', res.status, await res.text());
    process.exit(1);
  }
  const purchased = await res.json();
  console.log(`✓ Purchased: ${purchased.phone_number}  SID: ${purchased.sid}`);

  // 2. Update sites table
  const forwardingNumber = process.env.OPERATOR_PHONE_NUMBER ?? null;
  await db
    .update(sites)
    .set({
      trackingNumber: purchased.phone_number,
      twilioPhoneSid: purchased.sid,
      trackingProvider: 'twilio',
      forwardingNumber,
      whisperMessage: `Lead call from ${site.niche} in ${site.city}`,
      recordingEnabled: true,
      updatedAt: new Date(),
    })
    .where(eq(sites.id, site.id));

  console.log(`\nUpdated sites row:`);
  console.log(`  tracking_number   = ${purchased.phone_number}`);
  console.log(`  twilio_phone_sid  = ${purchased.sid}`);
  console.log(`  tracking_provider = twilio`);
  console.log(`  forwarding_number = ${forwardingNumber ?? '(none — set OPERATOR_PHONE_NUMBER to route calls)'}`);
  console.log(`\nLive site: https://${site.domain ?? site.id + '.vercel.app'}`);
  console.log(`The phone CTA on the site updates on the next page load.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

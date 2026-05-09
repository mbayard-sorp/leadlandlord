/**
 * Search Twilio's available number pool for a given area code. Read-only,
 * no charges. Returns the first N matches with location + capability info.
 *
 * Usage: pnpm tsx scripts/twilio-search-numbers.ts 702
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const area = process.argv[2];
  if (!area) throw new Error('Usage: pnpm tsx scripts/twilio-search-numbers.ts <area-code>');
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  // /Local lists local numbers (best for trade businesses); /TollFree for 800
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${area}&VoiceEnabled=true&SmsEnabled=true&PageSize=10`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    console.error('HTTP', res.status, await res.text());
    process.exit(1);
  }
  const json = await res.json();
  const numbers = json.available_phone_numbers ?? [];
  console.log(`Found ${numbers.length} available local numbers in area code ${area}:\n`);
  for (const n of numbers.slice(0, 10)) {
    console.log(`  ${n.phone_number}  (${n.locality ?? '?'}, ${n.region ?? '?'})  voice=${n.capabilities?.voice} sms=${n.capabilities?.SMS}`);
  }
  console.log(`\nLocal voice numbers cost $1.15/mo. Inbound voice ~$0.0085/min.`);
  console.log(`Pick one and run: pnpm tsx scripts/twilio-buy-and-attach.ts <site-id> <phone-number>`);
}

main().catch((err) => { console.error(err); process.exit(1); });

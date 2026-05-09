import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, sites } from '@leadlandlord/db';

async function main() {
  const db = getDb();
  const all = await db.select().from(sites);
  for (const s of all) {
    console.log(`${s.id.slice(0, 8)}  ${s.niche} / ${s.city}, ${s.state}`);
    console.log(`  tracking_number:    ${s.trackingNumber ?? '(none)'}`);
    console.log(`  tracking_provider:  ${s.trackingProvider ?? '(none)'}`);
    console.log(`  twilio_phone_sid:   ${s.twilioPhoneSid ?? '(none)'}`);
    console.log(`  forwarding_number:  ${s.forwardingNumber ?? '(none)'}`);
    console.log(`  whisper_message:    ${s.whisperMessage ?? '(none)'}`);
    console.log(`  recording_enabled:  ${s.recordingEnabled}`);
    console.log();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

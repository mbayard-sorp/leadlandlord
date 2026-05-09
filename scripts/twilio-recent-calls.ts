import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, calls, sites } from '@leadlandlord/db';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const db = getDb();
  // Local DB (calls row created upfront when webhook fires)
  const recent = await db.select().from(calls).orderBy(desc(calls.startedAt)).limit(5);
  console.log(`Recent calls in DB (${recent.length}):`);
  for (const c of recent) {
    console.log(`  ${c.startedAt.toISOString()}  from ${c.callerNumber} → ${c.calledNumber}  sid=${c.twilioCallSid?.slice(0, 12)}  rec=${c.recordingUrl ? 'yes' : 'no'}`);
  }

  // Twilio's call log (what Twilio actually saw)
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const tw = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?To=%2B17252403261&PageSize=5`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!tw.ok) {
    console.error('Twilio API error:', tw.status, await tw.text());
    return;
  }
  const j = await tw.json();
  console.log(`\nTwilio's call log (${j.calls?.length ?? 0}):`);
  for (const c of j.calls ?? []) {
    console.log(`  ${c.start_time}  from ${c.from} → ${c.to}  status=${c.status}  duration=${c.duration}s`);
    console.log(`    sid=${c.sid}`);
    // Fetch notifications/errors for this call
    const notif = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${c.sid}/Notifications.json`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (notif.ok) {
      const nj = await notif.json();
      for (const n of nj.notifications ?? []) {
        console.log(`    !! ${n.error_code}: ${n.message_text?.slice(0, 200)}`);
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

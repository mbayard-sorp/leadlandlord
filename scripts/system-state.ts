import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, systemState, setKillSwitch } from '@leadlandlord/db';

async function main() {
  const action = process.argv[2]; // undefined | 'off' | 'on'
  const db = getDb();
  if (action === 'off') {
    const row = await setKillSwitch({ active: false });
    console.log('Kill switch turned OFF.');
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  if (action === 'on') {
    const reason = process.argv[3] ?? 'manual';
    const row = await setKillSwitch({ active: true, reason, activatedBy: 'cli' });
    console.log('Kill switch turned ON.');
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  const rows = await db.select().from(systemState);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

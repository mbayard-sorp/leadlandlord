import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, sites } from '@leadlandlord/db';

async function main() {
  const db = getDb();
  const rows = await db.select().from(sites).orderBy(sites.createdAt);
  console.log(`Total sites: ${rows.length}\n`);
  for (const s of rows) {
    console.log(
      `${s.id.slice(0, 8)}  ${s.status.padEnd(8)} ${s.niche} / ${s.city}, ${s.state}`,
    );
    console.log(
      `         domain: ${s.domain ?? '(none — *.vercel.app)'}  tracking: ${s.trackingNumber ?? '-'}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

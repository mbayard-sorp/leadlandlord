import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates } from '@leadlandlord/db';
import { eq } from 'drizzle-orm';

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: pnpm tsx scripts/approve-candidate.ts <id-prefix-or-domain>');
  const db = getDb();
  const all = await db.select().from(domainCandidates);
  const cand = all.find((c) => c.id.startsWith(arg) || c.domain === arg);
  if (!cand) throw new Error(`No candidate matched "${arg}"`);
  await db.update(domainCandidates).set({ status: 'approved' }).where(eq(domainCandidates.id, cand.id));
  console.log(`Approved: ${cand.domain}`);
  console.log(`Candidate ID: ${cand.id}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, agentRuns, domainCandidates } from '@leadlandlord/db';
import { eq, and } from 'drizzle-orm';

async function main() {
  const siteIdArg = process.argv[2];
  if (!siteIdArg) throw new Error('Usage: pnpm tsx scripts/cf-clear-search.ts <site-id-prefix>');
  const db = getDb();

  // Find full site id
  const allRuns = await db.select().from(agentRuns).where(eq(agentRuns.agent, 'domain-procurer'));
  const matchingRuns = allRuns.filter(
    (r) => r.dedupeKey?.startsWith('search:') && r.dedupeKey?.includes(siteIdArg),
  );
  console.log(`Found ${matchingRuns.length} cached search runs to delete`);
  for (const r of matchingRuns) {
    await db.delete(agentRuns).where(eq(agentRuns.id, r.id));
    console.log(`  deleted run ${r.id} (dedupeKey=${r.dedupeKey})`);
  }

  const candidates = await db.select().from(domainCandidates);
  const matchingCandidates = candidates.filter((c) => c.siteId.startsWith(siteIdArg));
  console.log(`\nFound ${matchingCandidates.length} candidate rows to delete`);
  for (const c of matchingCandidates) {
    await db.delete(domainCandidates).where(eq(domainCandidates.id, c.id));
    console.log(`  deleted candidate ${c.domain}`);
  }

  console.log('\nDone. Re-run search to fetch live data.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

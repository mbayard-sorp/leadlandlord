import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates, agentEvents, agentRuns } from '@leadlandlord/db';
import { eq, desc, isNull, and } from 'drizzle-orm';

async function main() {
  const db = getDb();
  const cands = await db.select().from(domainCandidates).orderBy(domainCandidates.rank);
  console.log(`Domain candidates (${cands.length}):`);
  for (const c of cands) {
    console.log(`  rank ${c.rank}  ${c.domain.padEnd(35)} status=${c.status}  $${c.priceUsd ?? '-'}`);
  }

  const recent = await db
    .select()
    .from(agentEvents)
    .where(isNull(agentEvents.processedAt))
    .orderBy(desc(agentEvents.createdAt))
    .limit(10);
  console.log(`\nUnprocessed events (${recent.length}):`);
  for (const e of recent) {
    console.log(`  ${e.createdAt.toISOString()}  type=${e.type}  target=${e.targetAgent}  payload=${JSON.stringify(e.payload).slice(0,120)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates, agentEvents } from '@leadlandlord/db';
import { and, eq, isNull } from 'drizzle-orm';

async function main() {
  const db = getDb();
  const approved = await db.select().from(domainCandidates).where(eq(domainCandidates.status, 'approved'));
  console.log(`Approved candidates (${approved.length}):`);
  for (const c of approved) {
    console.log(`  ${c.id}  ${c.domain}  $${c.priceUsd}  site=${c.siteId.slice(0,8)}`);
  }

  const pendingEvents = await db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.type, 'domain.approval.granted'), isNull(agentEvents.processedAt)));
  console.log(`\nPending domain.approval.granted events (${pendingEvents.length}):`);
  for (const e of pendingEvents) {
    console.log(`  ${e.id.slice(0,8)}  ${JSON.stringify(e.payload)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates, agentEvents, agentRuns, sites } from '@leadlandlord/db';
import { eq, like } from 'drizzle-orm';

async function main() {
  const candidateIdArg = process.argv[2];
  if (!candidateIdArg) throw new Error('Usage: pnpm tsx scripts/cf-reset-candidate.ts <candidate-id-prefix>');
  const db = getDb();

  const allCands = await db.select().from(domainCandidates);
  const cand = allCands.find((c) => c.id.startsWith(candidateIdArg) || c.domain === candidateIdArg);
  if (!cand) throw new Error(`No candidate matched "${candidateIdArg}"`);
  console.log(`Resetting ${cand.domain} (id=${cand.id})`);

  // Delete cached register run
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.agent, 'domain-procurer'));
  const matching = runs.filter((r) => r.dedupeKey === `register:${cand.id}`);
  for (const r of matching) {
    await db.delete(agentRuns).where(eq(agentRuns.id, r.id));
    console.log(`  deleted cached register run ${r.id}`);
  }

  // Mark phantom domain.registered events for this domain as processed
  const events = await db.select().from(agentEvents).where(eq(agentEvents.type, 'domain.registered'));
  for (const e of events) {
    const payload = e.payload as { domain?: string };
    if (payload?.domain === cand.domain && !e.processedAt) {
      await db.update(agentEvents).set({ processedAt: new Date(), error: 'cleared (was mock)' }).where(eq(agentEvents.id, e.id));
      console.log(`  cleared phantom event ${e.id.slice(0,8)}`);
    }
  }

  // Reset candidate status back to approved (so re-running register proceeds)
  await db.update(domainCandidates).set({ status: 'approved', registeredAt: null }).where(eq(domainCandidates.id, cand.id));
  console.log(`  candidate status -> approved`);

  // Clear sites.domain if it was set to this mock domain
  const siteRows = await db.select().from(sites).where(eq(sites.id, cand.siteId));
  if (siteRows[0]?.domain === cand.domain) {
    await db.update(sites).set({ domain: null }).where(eq(sites.id, cand.siteId));
    console.log(`  cleared sites.domain (was mock)`);
  }

  console.log('\nReady. Run register against this candidate to retry for real.');
  console.log(`Candidate ID: ${cand.id}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

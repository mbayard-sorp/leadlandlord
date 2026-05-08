import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates, sites } from '@leadlandlord/db';
import { eq } from 'drizzle-orm';
import { DomainProcurer } from '../packages/agents/src/domain-procurer';

async function main() {
  const candidateIdArg = process.argv[2];
  if (!candidateIdArg) throw new Error('Usage: pnpm tsx scripts/cf-register.ts <candidate-id-prefix-or-domain>');
  const db = getDb();
  const all = await db.select().from(domainCandidates);
  const cand = all.find((c) => c.id.startsWith(candidateIdArg) || c.domain === candidateIdArg);
  if (!cand) throw new Error(`No candidate matched "${candidateIdArg}"`);
  if (cand.status !== 'approved') {
    throw new Error(`Candidate status is "${cand.status}", expected "approved"`);
  }

  console.log(`Registering ${cand.domain} for site ${cand.siteId}...`);
  const agent = new DomainProcurer();
  const out = await agent.run({
    site_id: cand.siteId,
    action: 'register',
    candidate_id: cand.id,
  });
  console.log('\nResult:', out);

  const [siteAfter] = await db.select().from(sites).where(eq(sites.id, cand.siteId));
  console.log('\nSite domain now:', siteAfter?.domain);
}

main().catch((err) => { console.error(err); process.exit(1); });

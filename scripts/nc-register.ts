import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates, sites } from '@leadlandlord/db';
import { eq } from 'drizzle-orm';
import { DomainProcurer } from '../packages/agents/src/domain-procurer';

/**
 * Dev helper: run the Domain Procurer in `register` mode for an approved
 * candidate. SPENDS REAL MONEY when run against production Namecheap.
 *
 * Usage:
 *   pnpm tsx scripts/nc-register.ts <candidate-id-prefix-or-domain>
 *
 * Env required: same as nc-search-site.ts plus NAMECHEAP_REGISTRANT_*
 * (full ICANN-mandated contact block — see .env.example).
 *
 * After register + DNS, the domain still needs Vercel verification.
 * Vercel auto-verifies once it sees the A record propagate (5–30 min).
 * Track status at https://vercel.com/<team>/<project>/settings/domains.
 */
async function main() {
  const candidateIdArg = process.argv[2];
  if (!candidateIdArg) {
    throw new Error('Usage: pnpm tsx scripts/nc-register.ts <candidate-id-prefix-or-domain>');
  }
  const db = getDb();
  const all = await db.select().from(domainCandidates);
  const cand = all.find((c) => c.id.startsWith(candidateIdArg) || c.domain === candidateIdArg);
  if (!cand) throw new Error(`No candidate matched "${candidateIdArg}"`);
  if (cand.status !== 'approved') {
    throw new Error(`Candidate status is "${cand.status}", expected "approved"`);
  }

  if (process.env.NAMECHEAP_USE_SANDBOX === 'true') {
    console.log('  (sandbox mode — using api.sandbox.namecheap.com, no real charge)');
  } else if (process.env.NAMECHEAP_DRY_RUN !== 'true') {
    console.log('  ⚠  PRODUCTION mode — this will charge your Namecheap balance.');
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
  console.log(
    '\nNext step: DNS may take 5-30 min to propagate. Check Vercel verification at',
    '\n  https://vercel.com/<team>/<project>/settings/domains',
  );
}

main().catch((err) => { console.error(err); process.exit(1); });

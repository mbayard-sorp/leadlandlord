import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, sites, domainCandidates } from '@leadlandlord/db';
import { eq } from 'drizzle-orm';
import { DomainProcurer } from '../packages/agents/src/domain-procurer';

/**
 * Dev helper: run the Domain Procurer in `search` mode for a site.
 *
 * Usage:
 *   pnpm tsx scripts/nc-search-site.ts <site-id-or-prefix>
 *
 * Env required (in .env.local):
 *   NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME,
 *   NAMECHEAP_CLIENT_IP (must match the IP allowlist on your Namecheap
 *   profile → Tools → API Access). Set NAMECHEAP_USE_SANDBOX=true to
 *   run against api.sandbox.namecheap.com (free, separate sandbox account).
 */
async function main() {
  const siteIdArg = process.argv[2];
  if (!siteIdArg) {
    throw new Error('Usage: pnpm tsx scripts/nc-search-site.ts <site-id-or-prefix>');
  }
  const db = getDb();
  const allSites = await db.select().from(sites);
  const site = allSites.find((s) => s.id.startsWith(siteIdArg));
  if (!site) throw new Error(`No site matched prefix "${siteIdArg}"`);
  console.log(
    `Searching domains for: ${site.niche} / ${site.city}, ${site.state}  (${site.id})`,
  );
  if (process.env.NAMECHEAP_USE_SANDBOX === 'true') {
    console.log('  (sandbox mode — using api.sandbox.namecheap.com)');
  }

  const agent = new DomainProcurer();
  const out = await agent.run({
    site_id: site.id,
    action: 'search',
    top_n: 5,
  });
  console.log('\nAgent output:', out);

  const candidates = await db
    .select()
    .from(domainCandidates)
    .where(eq(domainCandidates.siteId, site.id))
    .orderBy(domainCandidates.rank);

  console.log(`\nCandidates (${candidates.length}):`);
  for (const c of candidates) {
    const price = c.priceUsd ? `$${c.priceUsd}` : '—';
    console.log(
      `  rank ${c.rank}  ${c.domain.padEnd(35)} ${c.matchType?.padEnd(8) ?? '-'} ${price.padEnd(8)} status=${c.status}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

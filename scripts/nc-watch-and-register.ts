/**
 * Watcher: poll domain_candidates for a pending_approval row that flips to
 * 'approved', then immediately run domain-procurer in register mode locally.
 * Beats Vercel's prod cron (1 min interval) to the punch — local has real
 * Namecheap creds, prod does not, and a creds-less prod run would fail and
 * dirty the agent_runs table.
 *
 * Usage:
 *   pnpm tsx scripts/nc-watch-and-register.ts <site-id-prefix>
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, domainCandidates, sites, agentEvents } from '@leadlandlord/db';
import { eq, and } from 'drizzle-orm';
import { DomainProcurer } from '../packages/agents/src/domain-procurer';

async function main() {
  const sitePrefix = process.argv[2];
  if (!sitePrefix) throw new Error('Usage: pnpm tsx scripts/nc-watch-and-register.ts <site-id>');
  const db = getDb();
  const allSites = await db.select().from(sites);
  const site = allSites.find((s) => s.id.startsWith(sitePrefix));
  if (!site) throw new Error(`No site matched "${sitePrefix}"`);
  console.log(`Watching site ${site.niche} / ${site.city} (${site.id}) for approval...`);
  console.log(`(Cmd+C to abort)`);

  const startedAt = Date.now();
  while (true) {
    const cands = await db.select().from(domainCandidates).where(eq(domainCandidates.siteId, site.id));
    const approved = cands.find((c) => c.status === 'approved');
    if (approved) {
      console.log(`\n✓ Detected approval: ${approved.domain} (${approved.id})`);
      console.log(`  ICANN fee + base price ≈ $${approved.priceUsd}. Registering NOW (real money)...`);

      // Mark the queued event as processed so prod cron doesn't try a creds-less retry.
      const events = await db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.type, 'domain.approval.granted'));
      for (const e of events) {
        const payload = e.payload as { candidate_id?: string };
        if (payload?.candidate_id === approved.id && !e.processedAt) {
          await db
            .update(agentEvents)
            .set({ processedAt: new Date(), error: 'claimed by local watcher' })
            .where(eq(agentEvents.id, e.id));
          console.log(`  marked queued event ${e.id.slice(0, 8)} as processed (preempted prod cron)`);
        }
      }

      const agent = new DomainProcurer();
      const out = await agent.run({
        site_id: site.id,
        action: 'register',
        candidate_id: approved.id,
      });
      console.log('\nResult:', JSON.stringify(out, null, 2));

      const [siteAfter] = await db.select().from(sites).where(eq(sites.id, site.id));
      console.log(`\nsites.domain now = ${siteAfter?.domain}`);
      console.log(`\nNext: DNS + SSL provisioning takes 5-30 min.`);
      console.log(`Check status: https://vercel.com/dashboard → leadlandlord-sites → Settings → Domains`);
      return;
    }
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    process.stdout.write(`\rwaiting (${elapsed}s)... pending=${cands.filter(c => c.status === 'pending_approval').length}, approved=0`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((err) => {
  console.error('\n', err);
  process.exit(1);
});

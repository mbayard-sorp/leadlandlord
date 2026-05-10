/**
 * Cleanup helper for a failed/dead site row + its Sanity docs.
 *
 *   pnpm tsx scripts/cleanup-dead-site.ts <site-uuid>
 *
 * Removes:
 *   - Sanity site doc + all page docs + all cluster docs (deterministic IDs)
 *   - Postgres keyword_clusters rows for this site
 *   - Postgres agent_events rows that reference this site_id in payload
 *   - Postgres sites row (FK ON DELETE SET NULL on agent_runs handles those)
 *   - Resets the corresponding `niches` row decision back to `pending`
 *     so the operator can re-approve and re-run.
 *
 * Idempotent — safe to re-run; missing docs / rows are no-ops.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb } from '@leadlandlord/db';
import { sql } from 'drizzle-orm';
import { createClient } from '@sanity/client';

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error('Usage: pnpm tsx scripts/cleanup-dead-site.ts <site-uuid>');
    process.exit(1);
  }

  const db = getDb();
  const sanity = createClient({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID!,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET ?? 'production',
    token: process.env.SANITY_API_TOKEN,
    apiVersion: '2024-01-01',
    useCdn: false,
  });

  // 1. Snapshot what we're about to delete
  console.log('=== BEFORE ===');
  const before = await db.execute(sql`select id, status, niche, city, state from sites where id=${siteId}`);
  console.log('Site row:'); console.table(before.rows ?? before);
  if (!(before.rows ?? before).length) {
    console.log('(no site row — may already be cleaned)');
  }

  const sanityDocs = await sanity.fetch(
    `*[_id match $prefix]{_id, _type, businessName, title}`,
    { prefix: `*${siteId}*` },
  );
  console.log(`Sanity docs (${sanityDocs.length}):`);
  for (const d of sanityDocs) {
    console.log(`  - ${d._id} [${d._type}] ${d.businessName ?? d.title ?? ''}`);
  }

  // 2. Delete Sanity docs (use mutate transaction for atomicity)
  if (sanityDocs.length > 0) {
    const tx = sanity.transaction();
    for (const d of sanityDocs) tx.delete(d._id);
    await tx.commit({ visibility: 'sync' });
    console.log(`✓ Deleted ${sanityDocs.length} Sanity docs`);
  } else {
    console.log('✓ No Sanity docs to delete');
  }

  // 3. Postgres cleanup — order matters
  // (keyword_clusters lives in Sanity only — no Postgres table)
  // 3b. agent_events rows that reference this site_id in payload
  const ev = await db.execute(sql`
    delete from agent_events
    where payload->>'site_id' = ${siteId}
       or payload->>'siteId' = ${siteId}
  `);
  console.log(`✓ Deleted ${ev.rowCount ?? 0} agent_events rows`);

  // 3c. The site row itself (other FKs are SET NULL or CASCADE per schema audit)
  const sd = await db.execute(sql`delete from sites where id=${siteId}`);
  console.log(`✓ Deleted ${sd.rowCount ?? 0} sites row`);

  // 4. Reset matching niches row(s) so they can be re-approved
  // Match by niche/city/state of the deleted site if we still have it; otherwise
  // require explicit niche string from the FAILED build (fallback below).
  const beforeRow = (before.rows ?? before)[0] as { niche?: string; city?: string; state?: string } | undefined;
  let resetCount = 0;
  if (beforeRow) {
    const r = await db.execute(sql`
      update niches
      set decision='pending', decided_at=null
      where niche=${beforeRow.niche} and city=${beforeRow.city} and state=${beforeRow.state}
        and decision='approved'
    `);
    resetCount = r.rowCount ?? 0;
    console.log(`✓ Reset ${resetCount} niches row to decision='pending'`);
  } else {
    console.log('(no site row found before delete — skip niche reset; manually reset via /operator/niches if needed)');
  }

  // 5. Verify clean state
  console.log('\n=== AFTER ===');
  const after = await db.execute(sql`select count(*)::int as n from sites where id=${siteId}`);
  console.log('Sites with this id (should be 0):', after.rows[0]);

  const afterSanity = await sanity.fetch(`count(*[_id match $prefix])`, { prefix: `*${siteId}*` });
  console.log('Sanity docs (should be 0):', afterSanity);

  if (beforeRow) {
    const niche = await db.execute(sql`select decision, decided_at from niches where niche=${beforeRow.niche} and city=${beforeRow.city} and state=${beforeRow.state}`);
    console.log('Niche row(s):'); console.table(niche.rows ?? niche);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

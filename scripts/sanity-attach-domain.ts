/**
 * Wire a registered domain into the Sanity site doc's `domains[]` array.
 * Site-host's lookup query is `*[_type=="site" && $host in domains[].host]`,
 * so until that array contains the host the request 404s at the edge.
 *
 * Manual stand-in for the future site-builder handler of the
 * `domain.registered` event.
 *
 * Imports @sanity/client directly to avoid the @leadlandlord/sanity-schema
 * barrel which side-imports CSS via the sanity studio package.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@sanity/client';
import { getDb, sites } from '@leadlandlord/db';

function siteDocId(siteId: string): string {
  return `site-${siteId}`;
}

async function main() {
  const sitePrefix = process.argv[2];
  const host = process.argv[3];
  if (!sitePrefix || !host) {
    throw new Error('Usage: pnpm tsx scripts/sanity-attach-domain.ts <site-id-prefix> <hostname>');
  }
  const db = getDb();
  const allSites = await db.select().from(sites);
  const site = allSites.find((s) => s.id.startsWith(sitePrefix));
  if (!site) throw new Error(`No site matched "${sitePrefix}"`);

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET ?? 'production';
  const token = process.env.SANITY_API_TOKEN;
  if (!projectId || !token) {
    throw new Error('SANITY_PROJECT_ID and SANITY_API_TOKEN required');
  }
  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion: '2024-01-01',
    useCdn: false,
  });

  const docId = siteDocId(site.id);
  const existing = await client.getDocument(docId);
  if (!existing) throw new Error(`Sanity site doc ${docId} not found`);

  const currentDomains = (existing as { domains?: Array<{ host: string }> }).domains ?? [];
  const already = currentDomains.find((d) => d.host === host);
  if (already) {
    console.log(`Already present: ${host}`);
    return;
  }
  const updatedDomains = [
    ...currentDomains,
    {
      _type: 'siteDomain',
      _key: host.replace(/[^a-z0-9]/gi, '-'),
      host,
      isPrimary: currentDomains.length === 0,
      verified: true,
      attachedAt: new Date().toISOString(),
    },
  ];
  await client.patch(docId).set({ domains: updatedDomains }).commit();
  console.log(`Attached ${host} to Sanity site doc ${docId}`);
  console.log(`Total domains now: ${updatedDomains.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

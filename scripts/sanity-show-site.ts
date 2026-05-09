import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@sanity/client';

async function main() {
  const sitePrefix = process.argv[2];
  if (!sitePrefix) throw new Error('Usage: pnpm tsx scripts/sanity-show-site.ts <site-id>');
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET ?? 'production';
  const token = process.env.SANITY_API_TOKEN;
  const client = createClient({ projectId: projectId!, dataset, token, apiVersion: '2024-01-01', useCdn: false });
  const docId = `site-${sitePrefix}`;
  const doc = await client.getDocument(docId);
  console.log('Doc found:', !!doc);
  if (doc) {
    const d = doc as Record<string, unknown>;
    console.log('_id:', d._id, 'title:', d.title, 'slug:', d.slug);
    console.log('domains:', JSON.stringify(d.domains, null, 2));
  }
  // Also test the site-host's lookup query
  const byHost = await client.fetch(
    `*[_type=="site" && $host in domains[].host][0]{_id, "domains": domains[].host}`,
    { host: process.argv[3] ?? 'junk-removal-vegas.com' }
  );
  console.log('\nLookup by host:', JSON.stringify(byHost, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });

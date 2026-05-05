#!/usr/bin/env -S tsx
/**
 * Phase D: seed a throwaway test tenant into the Sanity `development` dataset
 * to prove the multi-tenant render path end-to-end before touching real
 * tenants.
 *
 * Idempotent — uses deterministic IDs so re-running overwrites in place.
 *
 * Usage:  pnpm tsx scripts/seed-test-tenant.ts
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

import {
  createWriteClient,
  siteDocId,
  pageDocId,
  themeDocId,
} from '@leadlandlord/sanity-schema';

// Phase D test tenant — fake junk-removal niche in a fake city.
const SITE_ID = '00000000-0000-0000-0000-000000000d4d'; // recognizable UUID for "phase D"
const SLUG = 'phase-d-junk-removal-test';
const HOST = 'leadlandlord-sites.vercel.app'; // the production alias from `vercel deploy`

const NOW = new Date().toISOString();

interface PageInput {
  kind: 'home' | 'about' | 'contact' | 'service';
  index: number;
  slug: string;
  title: string;
  metaDescription: string;
  mdx: string;
}

const PAGES: PageInput[] = [
  {
    kind: 'home',
    index: 0,
    slug: '/',
    title: 'Junk Removal in Phase D City, ZZ',
    metaDescription:
      'Same-day junk hauling in Phase D City. Couches, fridges, yard waste, garage cleanouts. Licensed, insured, family-owned.',
    mdx: '# Junk Removal in Phase D City\n\nThis is the home page MDX for the Phase D smoke test tenant.',
  },
  {
    kind: 'about',
    index: 0,
    slug: '/about',
    title: 'About Us',
    metaDescription: 'Family-owned junk hauling business serving Phase D City and nearby towns.',
    mdx: '## About\n\nWe haul anything that fits in a truck. Phase D test tenant.',
  },
  {
    kind: 'contact',
    index: 0,
    slug: '/contact',
    title: 'Contact',
    metaDescription: 'Call or text for a free quote — typically reply within 15 minutes.',
    mdx: '## Get a Quote\n\nUse the form on this page or call directly.',
  },
  {
    kind: 'service',
    index: 0,
    slug: '/services/garage-cleanout',
    title: 'Garage Cleanouts',
    metaDescription: 'Full garage cleanouts in a single visit — start to swept-floor.',
    mdx: '### Garage Cleanouts\n\nFlat-rate per truckload. We sweep when we leave.',
  },
  {
    kind: 'service',
    index: 1,
    slug: '/services/furniture-removal',
    title: 'Furniture Removal',
    metaDescription: 'Couches, mattresses, recliners — gone in 30 minutes.',
    mdx: '### Furniture Removal\n\nNo job too small. Two haulers + one truck.',
  },
  {
    kind: 'service',
    index: 2,
    slug: '/services/appliance-haul',
    title: 'Appliance Hauling',
    metaDescription: 'Fridges, washers, dryers, dishwashers — disconnect + haul.',
    mdx: '### Appliance Hauling\n\nWe handle the disconnect when needed.',
  },
  {
    kind: 'service',
    index: 3,
    slug: '/services/yard-waste',
    title: 'Yard Waste Removal',
    metaDescription: 'Branches, leaves, sod, dead bushes. Same-day pickup.',
    mdx: '### Yard Waste\n\nWe load it ourselves — no need to bag it first.',
  },
];

async function main() {
  const sanity = createWriteClient({ dataset: 'development' });

  console.log('[seed-test-tenant] writing 7 page docs');
  const tx = sanity.transaction();
  for (const p of PAGES) {
    tx.createOrReplace({
      _id: pageDocId(SITE_ID, p.kind, p.index),
      _type: 'page',
      site: { _ref: siteDocId(SITE_ID), _type: 'reference' },
      kind: p.kind,
      slug: p.slug,
      title: p.title,
      metaDescription: p.metaDescription,
      mdx: p.mdx,
    });
  }

  console.log('[seed-test-tenant] writing site doc');
  tx.createOrReplace({
    _id: siteDocId(SITE_ID),
    _type: 'site',
    siteId: SITE_ID,
    slug: { _type: 'slug', current: SLUG },
    businessName: 'Phase D Junk Co.',
    niche: 'junk removal',
    city: 'Phase D City',
    state: 'ZZ',
    theme: { _ref: themeDocId('modern'), _type: 'reference' },
    domains: [
      { _key: 'k1', host: HOST, isPrimary: true, verified: true, attachedAt: NOW },
    ],
    robotsDisallow: true, // smoke tenant — keep out of indexes
    trustSignals: ['Same-day pickup', 'Free quotes', 'Licensed and insured'],
    nearbyCities: ['Smoketown', 'Verifyville'],
    home: { _ref: pageDocId(SITE_ID, 'home', 0), _type: 'reference' },
    about: { _ref: pageDocId(SITE_ID, 'about', 0), _type: 'reference' },
    contact: { _ref: pageDocId(SITE_ID, 'contact', 0), _type: 'reference' },
    services: [
      { _key: 's1', _ref: pageDocId(SITE_ID, 'service', 0), _type: 'reference' },
      { _key: 's2', _ref: pageDocId(SITE_ID, 'service', 1), _type: 'reference' },
      { _key: 's3', _ref: pageDocId(SITE_ID, 'service', 2), _type: 'reference' },
      { _key: 's4', _ref: pageDocId(SITE_ID, 'service', 3), _type: 'reference' },
    ],
    serviceAreas: [],
    blogPosts: [],
    infoPages: [],
    generatedAt: NOW,
  });

  const res = await tx.commit({ visibility: 'sync' });
  console.log(`[seed-test-tenant] committed transactionId=${res.transactionId}`);
  console.log('');
  console.log(`  site _id:  ${siteDocId(SITE_ID)}`);
  console.log(`  host:      ${HOST}`);
  console.log(`  slug:      ${SLUG}`);
  console.log(`  Studio:    https://leadlandlord.sanity.studio (development dataset)`);
}

main().catch((err) => {
  console.error('[seed-test-tenant] fatal:', err);
  process.exit(1);
});

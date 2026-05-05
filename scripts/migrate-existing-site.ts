#!/usr/bin/env -S tsx
/**
 * Phase G: migrate an existing Postgres `sites` row to the multi-tenant
 * Sanity-backed pipeline.
 *
 * Same flow as `pnpm dry-run` but:
 *  - Uses the existing site_id (won't create a new Postgres row)
 *  - Defaults SANITY_DATASET=production (the live target)
 *  - Defaults MOCK_TELEPHONY=true since the row already has a tracking number
 *
 * The Site Builder writes the new Sanity site doc + page docs (deterministic
 * IDs make this idempotent — re-runs overwrite in place) and uploads a fresh
 * hero image. The OLD Vercel project keeps serving until the cutover step.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-existing-site.ts --site-id <uuid>
 *   pnpm tsx scripts/migrate-existing-site.ts --site-id <uuid> --dataset development
 *   pnpm tsx scripts/migrate-existing-site.ts --site-id <uuid> --full
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

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

import { eq } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { SiteBuilder } from '@leadlandlord/agents/site-builder';

interface Args {
  siteId: string;
  dataset: string;
  full: boolean;
}

function parseCli(): Args {
  const { values } = parseArgs({
    options: {
      'site-id': { type: 'string' },
      dataset: { type: 'string', default: 'production' },
      full: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (!values['site-id']) {
    console.error('Usage: pnpm tsx scripts/migrate-existing-site.ts --site-id <uuid> [--dataset production|development] [--full]');
    process.exit(2);
  }
  return {
    siteId: values['site-id'],
    dataset: values.dataset!,
    full: !!values.full,
  };
}

function hr(label: string) {
  const line = '─'.repeat(72);
  console.log(`\n${line}\n  ${label}\n${line}`);
}

async function main() {
  const args = parseCli();

  // Force the dataset BEFORE importing anything Sanity-touching at runtime.
  process.env.SANITY_DATASET = args.dataset;
  process.env.NEXT_PUBLIC_SANITY_DATASET = args.dataset;
  // Mocked phone — the row already has a tracking number set by the original
  // Site Builder run, and `tracking-setup` is no-op for sites that already
  // have one. We still set this defensively in case the row's number is null.
  process.env.MOCK_TELEPHONY = process.env.MOCK_TELEPHONY ?? 'true';

  hr('LeadLandlord — migrate existing site');
  console.log(`  site_id  : ${args.siteId}`);
  console.log(`  dataset  : ${args.dataset}`);
  console.log(`  mode     : ${args.full ? 'FULL bundle' : 'FAST bundle'}`);

  // Load the row to pass niche/city/state into Site Builder.
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, args.siteId)).limit(1))[0];
  if (!site) {
    console.error(`No sites row with id=${args.siteId}`);
    process.exit(1);
  }
  console.log(`  niche    : ${site.niche}`);
  console.log(`  city     : ${site.city}, ${site.state}`);
  console.log(`  status   : ${site.status}`);
  if (site.trackingNumber) console.log(`  tracking#: ${site.trackingNumber}`);

  hr('Running Site Builder against existing row');
  const t0 = performance.now();
  const builder = new SiteBuilder();
  const result = await builder.run(
    {
      site_id: args.siteId,
      niche: site.niche,
      city: site.city,
      state: site.state.toUpperCase(),
      niche_id: site.nicheId ?? undefined,
      fast_mode: !args.full,
    },
    { dedupeKey: `migrate:${args.siteId}:${Date.now()}` },
  );
  const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);

  hr('Migration done');
  console.log(`  site_id            : ${result.site_id}`);
  console.log(`  sanity_site_doc_id : ${result.sanity_site_doc_id}`);
  console.log(`  pages_written      : ${result.pages_written}`);
  console.log(`  theme              : ${result.theme}`);
  console.log(`  hero_image_url     : ${result.hero_image_url ?? '(none)'}`);
  console.log(`  tracking_number    : ${result.tracking_number} (${result.tracking_provider})`);
  console.log(`  deployed_at        : ${result.deployed_at}`);
  console.log(`  elapsed            : ${elapsedSec}s`);

  hr('Next: parity check, then cutover decision');
  console.log('  1. Run scripts/parity-check.ts to compare old static vs new render.');
  console.log('  2. Open https://leadlandlord-sites.vercel.app/?site=<slug> to preview.');
  console.log('  3. If parity passes, decide cutover strategy (re-attach old domain, or new custom domain).');
}

main().catch((err) => {
  console.error('migrate-existing-site failed:', err);
  process.exit(1);
});

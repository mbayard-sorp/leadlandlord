#!/usr/bin/env -S tsx
/**
 * One-off: finish a site build that stalled on the Vercel 800s lambda ceiling.
 *
 * Runs SiteBuilder synchronously off-lambda against PRODUCTION (prod DB + prod
 * Sanity dataset) for an EXISTING site row. No 800s ceiling, so content-engine's
 * initial stream + density-lint retry both run to completion for large bundles.
 *
 * Reuses existing Sanity keyword clusters (skip_keyword_planning) so we don't
 * re-bill keyword research. Telephony is forced to mock — number provisioning
 * is handled manually, not by the build.
 *
 * Usage:
 *   CONTENT_ENGINE_STREAM_TIMEOUT_MS=1500000 \
 *   pnpm tsx scripts/finish-site.ts \
 *     --site-id 11995865-7be7-4cda-814e-026caefc4348 \
 *     --niche "deck building" --city "Medford" --state "OR"
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

// eslint-disable-next-line import/order
import { SiteBuilder } from '@leadlandlord/agents/site-builder';
import { log } from '@leadlandlord/shared/log';

function main() {
  const { values } = parseArgs({
    options: {
      'site-id': { type: 'string' },
      niche: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
    },
  });
  const siteId = values['site-id'];
  const { niche, city, state } = values;
  if (!siteId || !niche || !city || !state) {
    console.error('Usage: finish-site.ts --site-id <uuid> --niche <n> --city <c> --state <XX>');
    process.exit(2);
  }

  // Telephony is manual — never let the build attempt provisioning.
  process.env.MOCK_TELEPHONY = 'true';

  const dataset = process.env.SANITY_DATASET;
  if (dataset !== 'production') {
    console.error(`Refusing to run: SANITY_DATASET is "${dataset}", expected "production".`);
    process.exit(1);
  }
  for (const k of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'SANITY_API_TOKEN']) {
    if (!process.env[k]?.trim()) {
      console.error(`Missing env var: ${k}`);
      process.exit(1);
    }
  }

  console.log('─'.repeat(72));
  console.log(`  finish-site (off-lambda, PRODUCTION)`);
  console.log(`  site_id : ${siteId}`);
  console.log(`  niche   : ${niche} — ${city}, ${state!.toUpperCase()}`);
  console.log(`  dataset : ${dataset}`);
  console.log(`  stream cap: ${process.env.CONTENT_ENGINE_STREAM_TIMEOUT_MS ?? '600000 (default)'} ms`);
  console.log('─'.repeat(72));

  return { siteId, niche: niche!, city: city!, state: state!.toUpperCase() };
}

async function run() {
  const { siteId, niche, city, state } = main();
  const t0 = performance.now();
  const builder = new SiteBuilder();
  const result = await builder.run(
    {
      site_id: siteId,
      niche,
      city,
      state,
      fast_mode: false,
      skip_keyword_planning: true, // reuse existing Sanity clusters
    },
    { dedupeKey: `finish:${siteId}:${Date.now()}` },
  );
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log('─'.repeat(72));
  console.log('  DONE');
  console.log(`  site_id            : ${result.site_id}`);
  console.log(`  sanity_site_doc_id : ${result.sanity_site_doc_id}`);
  console.log(`  pages_written      : ${result.pages_written}`);
  console.log(`  theme              : ${result.theme}`);
  console.log(`  hero_image_url     : ${result.hero_image_url ?? '(none)'}`);
  console.log(`  deployed_at        : ${result.deployed_at}`);
  console.log(`  elapsed            : ${elapsed}s`);
  console.log('─'.repeat(72));
}

run().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'finish-site failed',
  );
  process.exit(1);
});

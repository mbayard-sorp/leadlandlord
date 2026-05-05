#!/usr/bin/env -S tsx
/**
 * LeadLandlord — end-to-end dry-run.
 *
 * Runs Site Builder synchronously for a single niche × city, with Tracking Setup
 * forced into mock mode so we never spend real money on a number. Stops before
 * any code that would touch a real domain registrar or Stripe.
 *
 * Usage:
 *   pnpm dry-run --niche "gutter cleaning" --city "Boise" --state "ID"
 *   pnpm dry-run --niche "gutter cleaning" --city "Boise" --state "ID" --full
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

// Load env BEFORE the package imports below so they see the values at import time.
// Walk up from this file to find the repo root's .env.local — works inside git
// worktrees where the worktree root has no .env.local but the main checkout does.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Walk up looking for .env.local. Don't load a generic `.env` — a stray
// `~/.env` with override:true would clobber values from .env.local
// (this happened during Phase E rollout — `~/.env` had ANTHROPIC_API_KEY=
// empty and silently wiped out the real key).
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
import { sql } from 'drizzle-orm';
import { getDb, niches } from '@leadlandlord/db';
import { SiteBuilder } from '@leadlandlord/agents/site-builder';
import { log } from '@leadlandlord/shared/log';

interface Args {
  niche: string;
  city: string;
  state: string;
  full: boolean;
  force: boolean;
}

function parseCli(): Args {
  const { values } = parseArgs({
    options: {
      niche: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      full: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (!values.niche || !values.city || !values.state) {
    console.error('Usage: pnpm dry-run --niche "<niche>" --city "<city>" --state "<XX>" [--full] [--force]');
    process.exit(2);
  }
  if (values.state.length !== 2) {
    console.error('--state must be a 2-letter abbreviation (e.g., ID)');
    process.exit(2);
  }
  return {
    niche: values.niche,
    city: values.city,
    state: values.state.toUpperCase(),
    full: !!values.full,
    force: !!values.force,
  };
}

function hr(label: string) {
  const line = '─'.repeat(72);
  console.log(`\n${line}\n  ${label}\n${line}`);
}

async function ensurePreflight(): Promise<void> {
  process.env.MOCK_TELEPHONY = 'true';
  // Phase E onward: force the `development` dataset for dry-runs so smoke
  // tests never write into production tenant content. Override with
  // DRY_RUN_SANITY_DATASET if you really mean to write elsewhere.
  process.env.SANITY_DATASET = process.env.DRY_RUN_SANITY_DATASET ?? 'development';
  process.env.NEXT_PUBLIC_SANITY_DATASET = process.env.SANITY_DATASET;

  // Phase E onward: no per-tenant Vercel project anymore — VERCEL_TOKEN is
  // no longer a hard requirement for dry-run. SANITY_API_TOKEN is.
  const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'SANITY_API_TOKEN'];
  const missing = required.filter((k) => !process.env[k] || process.env[k]!.trim() === '');
  if (missing.length) {
    console.error(`Missing env vars in .env.local: ${missing.join(', ')}`);
    process.exit(1);
  }

  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    console.error('DB connectivity failed. Run `pnpm db:migrate` first.');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function recordNiche(args: Args): Promise<string | undefined> {
  const db = getDb();
  const [row] = await db
    .insert(niches)
    .values({
      niche: args.niche,
      city: args.city,
      state: args.state,
      decision: 'approved_dry_run',
      rationale: 'Inserted by scripts/dry-run.ts',
    })
    .onConflictDoUpdate({
      target: [niches.niche, niches.city, niches.state],
      set: { decision: 'approved_dry_run' },
    })
    .returning({ id: niches.id });
  return row?.id;
}

async function main() {
  const args = parseCli();

  hr('LeadLandlord dry-run');
  console.log(`  niche : ${args.niche}`);
  console.log(`  city  : ${args.city}, ${args.state}`);
  console.log(`  mode  : ${args.full ? 'FULL bundle (more pages, longer wait)' : 'FAST bundle (Phase 1 default)'}`);
  console.log(`  guard : MOCK_TELEPHONY=true (no real number); domain registrar disabled`);

  await ensurePreflight();
  const nicheId = await recordNiche(args);

  hr('Building site');
  const t0 = performance.now();
  const builder = new SiteBuilder();
  const result = await builder.run(
    {
      niche: args.niche,
      city: args.city,
      state: args.state,
      niche_id: nicheId,
      fast_mode: !args.full,
    },
    args.force ? { dedupeKey: `force:${Date.now()}` } : {},
  );
  const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);

  hr('Done');
  console.log(`  site_id            : ${result.site_id}`);
  console.log(`  sanity_site_doc_id : ${result.sanity_site_doc_id}`);
  console.log(`  pages_written      : ${result.pages_written}`);
  console.log(`  theme              : ${result.theme}`);
  console.log(`  hero_image_url     : ${result.hero_image_url ?? '(none — no GOOGLE_API_KEY or generation skipped)'}`);
  console.log(`  tracking_number    : ${result.tracking_number} (${result.tracking_provider})`);
  console.log(`  deployed_at        : ${result.deployed_at}`);
  console.log(`  elapsed            : ${elapsedSec}s`);

  hr('Next steps');
  console.log('  • Open Sanity Studio (https://leadlandlord.sanity.studio) → confirm the new site doc + 7+ page docs.');
  console.log('  • Hit the leadlandlord-sites Vercel app with x-site-host pointing at one of this site\'s domains');
  console.log('    (or attach a domain via the operator dashboard, Phase F).');
  console.log('  • Open /operator/portfolio — the new row should be visible with status "warming".');
  console.log('  • Open /operator/agents — Site Builder + Content Engine + Tracking Setup runs visible.');
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined }, 'dry-run failed');
  process.exit(1);
});

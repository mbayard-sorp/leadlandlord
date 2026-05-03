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
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { getDb, niches } from '@leadlandlord/db';
import { SiteBuilder } from '@leadlandlord/agents/site-builder';
import { log } from '@leadlandlord/shared/log';

interface Args {
  niche: string;
  city: string;
  state: string;
  full: boolean;
}

function parseCli(): Args {
  const { values } = parseArgs({
    options: {
      niche: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      full: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (!values.niche || !values.city || !values.state) {
    console.error('Usage: pnpm dry-run --niche "<niche>" --city "<city>" --state "<XX>" [--full]');
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
  };
}

function hr(label: string) {
  const line = '─'.repeat(72);
  console.log(`\n${line}\n  ${label}\n${line}`);
}

async function ensurePreflight(): Promise<void> {
  // Force mock telephony so a real number is never provisioned.
  process.env.MOCK_TELEPHONY = 'true';

  const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN'];
  const missing = required.filter((k) => !process.env[k] || process.env[k]!.trim() === '');
  if (missing.length) {
    console.error(`Missing env vars in .env.local: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Quick DB connectivity check.
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
  const result = await builder.run({
    niche: args.niche,
    city: args.city,
    state: args.state,
    niche_id: nicheId,
    fast_mode: !args.full,
  });
  const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);

  hr('Done');
  console.log(`  site_id          : ${result.site_id}`);
  console.log(`  vercel_project   : ${result.vercel_project_name} (${result.vercel_project_id})`);
  console.log(`  preview_url      : ${result.preview_url}`);
  console.log(`  tracking_number  : ${result.tracking_number} (${result.tracking_provider})`);
  console.log(`  build_dir        : ${result.build_dir}`);
  console.log(`  deployed_at      : ${result.deployed_at}`);
  console.log(`  elapsed          : ${elapsedSec}s`);

  hr('Next steps');
  console.log('  • Visit the preview URL above and eyeball the home page + a service page.');
  console.log('  • Open /operator/portfolio — the new row should be visible with status "warming".');
  console.log('  • Open /operator/agents — Site Builder + Content Engine + Tracking Setup runs visible.');
  console.log("  • If anything's off, the build_dir holds every generated file for inspection.");
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined }, 'dry-run failed');
  process.exit(1);
});

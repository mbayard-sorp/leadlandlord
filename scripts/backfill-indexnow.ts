#!/usr/bin/env -S tsx
/**
 * LeadLandlord — one-shot IndexNow backfill.
 *
 * Sites that went live before the IndexNow feature shipped were never
 * submitted to Bing/Brave. This enumerates current live sites and emits a
 * `site.activated` agent_event for each, which operator-tick routes to the
 * indexnow-submitter agent (it reads each site's live sitemap and submits the
 * full URL set). Re-ping only — NO content regeneration, NO Sanity mutation.
 *
 * Idempotency: each emit carries a date-stamped `dedupeKey`
 * (`indexnow:backfill:<siteId>:<YYYY-MM-DD>`) which operator-tick forwards to
 * the agent, forcing a fresh submit past the agent's normal
 * `indexnow:activated:<siteId>` key. Re-running the SAME day collapses to the
 * cached run (safe to re-run); a new day re-submits.
 *
 * Safe by default: prints the target sites and exits WITHOUT inserting. Pass
 * --execute to actually enqueue the events (this pings real search engines for
 * every live site).
 *
 * Usage:
 *   pnpm backfill-indexnow                 # dry run — print targets only
 *   pnpm backfill-indexnow --execute       # enqueue site.activated events
 *   pnpm backfill-indexnow --execute --since 2026-05-20   # only sites created before this date
 *   pnpm backfill-indexnow --execute --batch-size 20 --delay-ms 2000
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

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
import { and, eq, lt, asc } from 'drizzle-orm';
// eslint-disable-next-line import/order
import { getDb, sites, agentEvents } from '@leadlandlord/db';
// eslint-disable-next-line import/order
import { log } from '@leadlandlord/shared/log';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      since: { type: 'string' },
      'batch-size': { type: 'string', default: '20' },
      'delay-ms': { type: 'string', default: '2000' },
    },
  });

  const execute = values.execute === true;
  const batchSize = Math.max(1, Number.parseInt(values['batch-size'] ?? '20', 10));
  const delayMs = Math.max(0, Number.parseInt(values['delay-ms'] ?? '2000', 10));
  const since = values.since ? new Date(values.since) : null;
  if (since && Number.isNaN(since.getTime())) {
    console.error(`Invalid --since date: ${values.since}`);
    process.exit(1);
  }
  const dateStamp = new Date().toISOString().slice(0, 10);

  const db = getDb();
  const where = since
    ? and(eq(sites.status, 'live'), lt(sites.createdAt, since))
    : eq(sites.status, 'live');
  const rows = await db
    .select({
      id: sites.id,
      domain: sites.domain,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
      createdAt: sites.createdAt,
    })
    .from(sites)
    .where(where)
    .orderBy(asc(sites.createdAt));

  console.log(`\nIndexNow backfill — ${rows.length} live site(s)${since ? ` created before ${since.toISOString().slice(0, 10)}` : ''}`);
  console.log(`Mode: ${execute ? 'EXECUTE (enqueueing events)' : 'DRY RUN (no events inserted)'}\n`);
  for (const r of rows) {
    console.log(`  ${r.id}  ${r.domain ?? '(no domain — submitter will skip)'}  · ${r.niche} ${r.city}, ${r.state}`);
  }

  if (!execute) {
    console.log(`\nDry run only. Re-run with --execute to enqueue ${rows.length} site.activated event(s).\n`);
    return;
  }

  let enqueued = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await db.insert(agentEvents).values(
      batch.map((r) => ({
        agent: 'backfill-indexnow',
        type: 'site.activated',
        targetAgent: 'indexnow-submitter',
        payload: { site_id: r.id, dedupeKey: `indexnow:backfill:${r.id}:${dateStamp}` },
      })),
    );
    enqueued += batch.length;
    log.info({ enqueued, total: rows.length }, 'backfill batch enqueued');
    if (i + batchSize < rows.length && delayMs > 0) await sleep(delayMs);
  }

  console.log(`\nEnqueued ${enqueued} site.activated event(s). operator-tick will drain them; submissions follow over the next few ticks.\n`);
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined },
    'backfill-indexnow failed',
  );
  process.exit(1);
});

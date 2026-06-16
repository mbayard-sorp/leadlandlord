#!/usr/bin/env -S tsx
/**
 * One-off backfill: seed one content idea of EACH narrative job-story archetype
 * for every live, local-content-enabled site.
 *
 * Why a script and not the weekly cron: the scout normally picks ONE archetype
 * per site per week deterministically and dedupes to one run per site per week.
 * This enqueues a targeted agent_event per (site x story archetype) using the
 * new `archetype` input override, so the three job-story formats can all run in
 * the same week alongside the normal rotation.
 *
 * The enqueued events drain through the regular operator-tick queue (BaseAgent
 * budget + cannibalization guards still apply). Ideas land at status='pending'
 * for review at /operator/approvals/content — nothing is written or published.
 *
 * Idempotent: re-running skips (site, archetype) pairs that already have a
 * matching unprocessed event this ISO week.
 *
 * Usage:
 *   tsx scripts/seed-job-story-ideas.ts            # dry-run, prints plan
 *   tsx scripts/seed-job-story-ideas.ts --commit   # actually inserts events
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
const __dirname = dirname(fileURLToPath(import.meta.url));
function findEnv(s: string, n: string): string | undefined {
  let d = s;
  for (let i = 0; i < 8; i++) {
    const c = resolve(d, n);
    if (existsSync(c)) return c;
    const p = resolve(d, '..');
    if (p === d) return;
    d = p;
  }
}
const env = findEnv(__dirname, '.env.local');
if (env) loadEnv({ path: env, override: true });
import { sql } from 'drizzle-orm';
import { getDb, agentEvents } from '@leadlandlord/db';
import { STORY_ARCHETYPES, isoWeek } from '@leadlandlord/agents/local-content-scout';

const { values } = parseArgs({ options: { commit: { type: 'boolean', default: false } } });
const COMMIT = values.commit === true;

async function main() {
  const db = getDb();
  const week = isoWeek(new Date());

  const sitesRes = (await db.execute(sql`
    SELECT id::text AS site_id, niche, city, state
    FROM sites
    WHERE status IN ('warming','live','rented') AND local_content_enabled = true
    ORDER BY city
  `)) as unknown as { rows: Array<{ site_id: string; niche: string; city: string; state: string }> };
  const sites = sitesRes.rows;

  // Existing unprocessed scout events keyed by their __schedule_key (this week).
  const existingRes = (await db.execute(sql`
    SELECT payload->>'__schedule_key' AS key
    FROM agent_events
    WHERE target_agent = 'local-content-scout'
      AND processed_at IS NULL
      AND payload ? '__schedule_key'
  `)) as unknown as { rows: Array<{ key: string }> };
  const existing = new Set(existingRes.rows.map((r) => r.key));

  const rows: Array<{ agent: string; type: string; targetAgent: string; payload: Record<string, unknown> }> = [];
  const plan: Array<{ city: string; niche: string; archetype: string; skip: boolean }> = [];

  for (const s of sites) {
    for (const archetype of STORY_ARCHETYPES) {
      const key = `scout:${s.site_id}:${week}:${archetype}`;
      const skip = existing.has(key);
      plan.push({ city: s.city, niche: s.niche, archetype, skip });
      if (skip) continue;
      rows.push({
        agent: 'scheduler',
        type: 'schedule.local-content-scout',
        targetAgent: 'local-content-scout',
        payload: { site_id: s.site_id, idea_count: 1, archetype, __schedule_key: key },
      });
    }
  }

  console.log(`Sites: ${sites.length} | week ${week} | story archetypes: ${STORY_ARCHETYPES.join(', ')}`);
  console.table(plan);
  console.log(`\nTo enqueue: ${rows.length} (skipped ${plan.length - rows.length} already queued)`);

  if (!COMMIT) {
    console.log('\nDRY RUN — pass --commit to insert these events.');
    return;
  }
  if (rows.length === 0) {
    console.log('\nNothing to enqueue.');
    return;
  }
  await db.insert(agentEvents).values(rows);
  console.log(`\nEnqueued ${rows.length} events. They will drain via operator-tick (BATCH_LIMIT=5, ~10 min/tick).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env -S tsx
/**
 * One-off cleanup for B1 (fallback SERP cache poisoning, ADR 0030).
 *
 * Before shouldCache landed in withDataForSeoCache, a failed SERP lookup's
 * fallback payload ({difficulty: 50, fallback: true}) was cached for 14 days
 * and served to both the niche scout and validateNicheCore as if it were a
 * real measurement. This script removes those rows so the next lookup
 * re-fetches cold (~$0.075 each, bounded by the scout's refine budget).
 *
 * Dry-run by default — prints counts only. Pass --execute to DELETE.
 *
 * Also reports (read-only, never modified) how many niche_candidates rows
 * carry the likely-poisoned fingerprint: refinement_source='local_serp' with
 * local_serp_difficulty=50 and local_aggregator_share=0. Those rows are NOT
 * rewritten — the next scout run supersedes them.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
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
import { getDb } from '@leadlandlord/db';

const execute = process.argv.includes('--execute');
const db = getDb();

async function main() {
  const poisoned = await db.execute(sql`
    SELECT count(*)::int AS n,
           min(fetched_at) AS oldest,
           max(expires_at) AS latest_expiry
    FROM dataforseo_cache
    WHERE endpoint = 'serp-composition'
      AND payload->>'fallback' = 'true'`);
  const row = poisoned.rows[0] as { n: number; oldest: string | null; latest_expiry: string | null };
  console.log(
    `Poisoned serp-composition cache rows (payload.fallback=true): ${row.n}` +
      (row.n > 0 ? ` (oldest fetched ${row.oldest}, last expires ${row.latest_expiry})` : ''),
  );

  const candidates = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM niche_candidates
    WHERE refinement_source = 'local_serp'
      AND local_serp_difficulty = 50
      AND local_aggregator_share = 0`);
  const candN = (candidates.rows[0] as { n: number }).n;
  console.log(
    `Likely-poisoned niche_candidates rows (local_serp @ difficulty=50, agg_share=0): ${candN} ` +
      `— informational only, never modified; the next scout run supersedes them.`,
  );

  if (!execute) {
    console.log('\nDry run — no rows deleted. Re-run with --execute to delete the cache rows above.');
    return;
  }

  const deleted = await db.execute(sql`
    DELETE FROM dataforseo_cache
    WHERE endpoint = 'serp-composition'
      AND payload->>'fallback' = 'true'`);
  console.log(`\nDeleted ${deleted.rowCount ?? 0} poisoned serp-composition cache rows.`);
}

main().then(() => process.exit(0));

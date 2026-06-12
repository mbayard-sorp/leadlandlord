#!/usr/bin/env -S tsx
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
const db = getDb();
async function main() {
  const r = await db.execute(sql`
    SELECT target_agent, COUNT(*),
      SUM(CASE WHEN processed_at IS NULL AND processing_at IS NULL AND dead_lettered_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) THEN 1 ELSE 0 END) AS claimable,
      SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) AS dead,
      SUM(CASE WHEN next_attempt_at > NOW() THEN 1 ELSE 0 END) AS backing_off
    FROM agent_events
    WHERE created_at > now() - interval '2 hours'
    GROUP BY target_agent ORDER BY COUNT(*) DESC`);
  console.log('Queue by target_agent (last 2h):');
  console.table(r.rows);

  const niche = await db.execute(sql`
    SELECT id::text, type, target_agent,
      processed_at, processing_at, dead_lettered_at, failure_kind, attempts,
      next_attempt_at, error,
      to_char(created_at, 'HH24:MI:SS') as ct
    FROM agent_events
    WHERE target_agent IN ('niche-scout', 'niche-validator')
    ORDER BY created_at DESC LIMIT 5`);
  console.log('\nNiche engine events:');
  console.table(niche.rows);
}
main().then(() => process.exit(0));

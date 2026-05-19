#!/usr/bin/env -S tsx
/**
 * Mark stale scheduler.* heartbeat events as processed. They're periodic
 * cron pings; if they didn't run within their interval, running them hours
 * late accomplishes nothing.
 *
 * Default: anything older than 15 minutes.
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
const db = getDb();
async function main() {
  const r = await db.execute(sql`
    UPDATE agent_events
    SET processed_at = NOW(),
        error = COALESCE(error, 'drained as stale heartbeat')
    WHERE agent = 'scheduler'
      AND type LIKE 'schedule.%'
      AND processed_at IS NULL
      AND processing_at IS NULL
      AND dead_lettered_at IS NULL
      AND created_at < NOW() - interval '15 minutes'
    RETURNING id::text, type, to_char(created_at, 'MM-DD HH24:MI') AS created`);
  console.log(`Drained ${r.rows.length} stale scheduler events.`);
  if (r.rows.length) {
    const byType: Record<string, number> = {};
    for (const row of r.rows as any[]) byType[row.type] = (byType[row.type] ?? 0) + 1;
    console.table(byType);
  }
}
main().then(() => process.exit(0));

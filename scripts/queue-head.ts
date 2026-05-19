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
    SELECT agent, type, target_agent, requires_approval,
      to_char(created_at, 'MM-DD HH24:MI:SS') as created
    FROM agent_events
    WHERE processed_at IS NULL AND processing_at IS NULL AND dead_lettered_at IS NULL
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY created_at
    LIMIT 25`);
  console.log('Head of claimable queue (oldest first):');
  console.table(r.rows);
}
main().then(() => process.exit(0));

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
  const counts = await db.execute(sql`
    SELECT endpoint, COUNT(*),
      MIN(fetched_at) AS oldest,
      MAX(fetched_at) AS newest
    FROM dataforseo_cache
    WHERE expires_at > NOW()
    GROUP BY endpoint ORDER BY COUNT(*) DESC`);
  console.log('Live cache rows by endpoint:');
  console.table(counts.rows);

  const recent = await db.execute(sql`
    SELECT endpoint, key, to_char(fetched_at, 'MM-DD HH24:MI') AS created,
      to_char(expires_at, 'MM-DD') AS expires,
      cost_usd
    FROM dataforseo_cache
    WHERE fetched_at > NOW() - interval '2 hours'
    ORDER BY fetched_at DESC LIMIT 15`);
  console.log('\nRecent cache writes (last 2h):');
  console.table(recent.rows);
}
main().then(() => process.exit(0));

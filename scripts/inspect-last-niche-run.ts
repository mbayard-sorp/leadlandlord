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
    SELECT id::text, status, input, output, error, cost_usd,
      to_char(started_at, 'HH24:MI:SS') s, to_char(ended_at, 'HH24:MI:SS') e
    FROM agent_runs WHERE agent='niche-hunter'
    ORDER BY started_at DESC LIMIT 1`);
  for (const row of r.rows as any[]) {
    console.log('id:', row.id, row.status, row.s, '->', row.e, '$' + row.cost_usd);
    console.log('input:', JSON.stringify(row.input, null, 2));
    console.log('output:', JSON.stringify(row.output, null, 2));
    if (row.error) console.log('error:', row.error);
  }

  const niches = await db.execute(sql`
    SELECT decision, COUNT(*) FROM niches
    WHERE created_at > now() - interval '30 minutes'
    GROUP BY decision`);
  console.log('\nNew niches in last 30 min:');
  console.table(niches.rows);
}
main().then(() => process.exit(0));

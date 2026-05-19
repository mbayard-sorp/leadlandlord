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
  const serp = await db.execute(sql`
    SELECT payload, to_char(fetched_at, 'HH24:MI') t
    FROM dataforseo_cache
    WHERE endpoint = 'serp-composition'
      AND fetched_at > NOW() - interval '30 minutes'
    ORDER BY fetched_at DESC`);
  console.log('Latest 8 SERP compositions:');
  for (const r of serp.rows as any[]) {
    const p = r.payload as any;
    console.log(`[${r.t}] diff=${p.difficulty} agg_share=${p.aggregator_share?.toFixed(2)} local_pack=${p.has_local_pack} top=${(p.top_domains ?? []).slice(0,3).join(',')}`);
  }

  const metrics = await db.execute(sql`
    SELECT payload, to_char(fetched_at, 'HH24:MI') t
    FROM dataforseo_cache
    WHERE endpoint = 'metrics'
      AND fetched_at > NOW() - interval '30 minutes'
    ORDER BY fetched_at DESC LIMIT 8`);
  console.log('\nLatest 8 keyword metrics (volume across 3 seeds):');
  for (const r of metrics.rows as any[]) {
    const p = r.payload as any[];
    const totalVol = p?.reduce((s, m) => s + (m.search_volume ?? 0), 0) ?? 0;
    const kws = p?.map((m) => `${m.keyword}:${m.search_volume}`).join('  ') ?? '';
    console.log(`[${r.t}] total_vol=${totalVol}  ${kws}`);
  }
}
main().then(() => process.exit(0));

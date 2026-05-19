#!/usr/bin/env -S tsx
/**
 * Tail agent_runs + agent_events for live E2E monitoring.
 * Polls every 3s, prints deltas only.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnv(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const c = resolve(dir, name);
    if (existsSync(c)) return c;
    const p = resolve(dir, '..');
    if (p === dir) return undefined;
    dir = p;
  }
}
const envLocal = findEnv(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

import { sql } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db';

const db = getDb();
const seen = new Map<string, string>();
const seenEvt = new Map<string, string>();

async function tick() {
  const runs = await db.execute(sql`
    SELECT id::text, agent, status, progress_message, progress_step, progress_total,
           tokens_in, tokens_out, cost_usd, error,
           to_char(started_at, 'HH24:MI:SS') as st,
           to_char(ended_at, 'HH24:MI:SS') as et
    FROM agent_runs
    WHERE started_at > now() - interval '30 minutes'
    ORDER BY started_at DESC LIMIT 20
  `);
  for (const r of runs.rows as any[]) {
    const key = `${r.status}|${r.progress_message}|${r.progress_step}|${r.et}`;
    if (seen.get(r.id) === key) continue;
    seen.set(r.id, key);
    const prog = r.progress_total ? ` [${r.progress_step ?? '?'}/${r.progress_total}]` : '';
    const cost = Number(r.cost_usd) > 0 ? ` $${r.cost_usd}` : '';
    const err = r.error ? ` ERR=${String(r.error).slice(0, 120)}` : '';
    console.log(`[${r.st}] RUN ${r.agent} ${r.status}${prog} ${r.progress_message ?? ''}${cost}${err}`);
  }

  const evts = await db.execute(sql`
    SELECT id::text, agent, type, target_agent, requires_approval,
           processed_at, dead_lettered_at, failure_kind, attempts, error,
           to_char(created_at, 'HH24:MI:SS') as ct
    FROM agent_events
    WHERE created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC LIMIT 20
  `);
  for (const e of evts.rows as any[]) {
    const state = e.dead_lettered_at ? `DEAD:${e.failure_kind}` : e.processed_at ? 'done' : 'pending';
    const key = `${state}|${e.attempts}|${e.error}`;
    if (seenEvt.get(e.id) === key) continue;
    seenEvt.set(e.id, key);
    const tgt = e.target_agent ? ` -> ${e.target_agent}` : '';
    const err = e.error ? ` ERR=${String(e.error).slice(0, 120)}` : '';
    console.log(`[${e.ct}] EVT ${e.agent} ${e.type}${tgt} ${state}${err}`);
  }
}

async function main() {
  console.log('Tailing agent_runs + agent_events (30-min window, 3s poll). Ctrl-C to stop.');
  await tick();
  setInterval(() => tick().catch((e) => console.error('tick err', e)), 3000);
}
main();

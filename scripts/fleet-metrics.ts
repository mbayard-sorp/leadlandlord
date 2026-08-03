#!/usr/bin/env -S tsx
/**
 * Read-only fleet telemetry aggregator for the agent improvement loop
 * (docs/agent-improvement-loop.md). SELECT-only by construction — connects
 * via READONLY_DATABASE_URL when present (a read-only Neon role), falls back
 * to DATABASE_URL, and exits with `NO_DB` / code 2 when neither is set so the
 * improvement skills can degrade to repo-only analysis.
 *
 * Usage:
 *   pnpm exec tsx scripts/fleet-metrics.ts --window 24h|7d|30d [--json] [--agent <name>]
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

const WINDOWS: Record<string, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const windowKey = arg('--window') ?? '24h';
const asJson = process.argv.includes('--json');
const agentFilter = arg('--agent');
const interval = WINDOWS[windowKey];
if (!interval) {
  console.error(`Unknown --window ${windowKey}; use 24h|7d|30d`);
  process.exit(1);
}

const dbUrl = process.env.READONLY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    'NO_DB: set READONLY_DATABASE_URL (preferred, read-only role) or DATABASE_URL for fleet telemetry; falling back to repo-only analysis.'
  );
  process.exit(2);
}
const db = getDb(dbUrl);

interface AgentRow {
  agent: string;
  runs: number;
  succeeded: number;
  failed: number;
  budget_exceeded: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  last_run_at: string | null;
}

async function main() {
  const agentWhere = agentFilter ? sql` AND agent = ${agentFilter}` : sql``;

  const runs = await db.execute(sql`
    SELECT agent,
           count(*)::int AS runs,
           count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE status = 'budget_exceeded')::int AS budget_exceeded,
           coalesce(sum(tokens_in), 0)::bigint AS tokens_in,
           coalesce(sum(tokens_out), 0)::bigint AS tokens_out,
           coalesce(sum(cost_usd), 0)::numeric AS cost_usd,
           to_char(max(started_at), 'YYYY-MM-DD HH24:MI') AS last_run_at
    FROM agent_runs
    WHERE started_at > now() - ${interval}::interval${agentWhere}
    GROUP BY agent ORDER BY cost_usd DESC, runs DESC
  `);

  const deadLetters = await db.execute(sql`
    SELECT coalesce(target_agent, agent) AS target, failure_kind, count(*)::int AS n,
           max(left(error, 160)) AS sample_error
    FROM agent_events
    WHERE dead_lettered_at IS NOT NULL
      AND created_at > now() - ${interval}::interval
    GROUP BY 1, 2 ORDER BY n DESC
  `);

  const pendingEvents = await db.execute(sql`
    SELECT coalesce(target_agent, agent) AS target, count(*)::int AS n,
           min(created_at) AS oldest
    FROM agent_events
    WHERE processed_at IS NULL AND dead_lettered_at IS NULL
    GROUP BY 1 HAVING count(*) > 0 ORDER BY n DESC LIMIT 20
  `);

  const health = await db.execute(sql`
    SELECT agent, audit_status, consecutive_failures,
           to_char(last_success_at, 'YYYY-MM-DD HH24:MI') AS last_success_at,
           left(last_error, 160) AS last_error
    FROM agent_health
    WHERE consecutive_failures > 0 OR audit_status NOT IN ('pass', 'skipped')
    ORDER BY consecutive_failures DESC
  `);

  const budgets = await db.execute(sql`
    SELECT agent, enabled,
           daily_cost_cap_usd, spent_today_usd,
           CASE WHEN daily_cost_cap_usd::numeric > 0
                THEN round(spent_today_usd::numeric / daily_cost_cap_usd::numeric * 100)
                ELSE 0 END AS daily_util_pct
    FROM agent_budgets
    WHERE enabled = false
       OR (daily_cost_cap_usd::numeric > 0 AND spent_today_usd::numeric / daily_cost_cap_usd::numeric >= 0.5)
    ORDER BY daily_util_pct DESC
  `);

  const schedules = await db.execute(sql`
    SELECT s.scheduler_name, s.target_agent, s.cadence_kind, s.cron_expr, s.interval_minutes,
           s.paused, to_char(s.last_enqueued_at, 'YYYY-MM-DD HH24:MI') AS last_enqueued_at
    FROM agent_schedules s
    WHERE s.paused = false
      AND s.cadence_kind IN ('cron', 'poll')
      AND (s.last_enqueued_at IS NULL OR s.last_enqueued_at < now() - interval '2 days')
    ORDER BY s.last_enqueued_at NULLS FIRST
  `);

  const globalSpend = await db.execute(sql`
    SELECT coalesce(sum(cost_usd), 0)::numeric AS spent_today
    FROM agent_runs WHERE started_at >= date_trunc('day', now())
  `);

  const topErrors = await db.execute(sql`
    SELECT left(error, 120) AS error, count(*)::int AS n
    FROM agent_runs
    WHERE status = 'failed' AND error IS NOT NULL
      AND started_at > now() - ${interval}::interval${agentWhere}
    GROUP BY 1 ORDER BY n DESC LIMIT 5
  `);

  const report = {
    window: windowKey,
    generated_note: 'read-only fleet telemetry; see docs/agent-improvement-loop.md',
    global: { spent_today_usd: (globalSpend.rows[0] as { spent_today: string }).spent_today, daily_cap_usd: 40 },
    per_agent_runs: runs.rows as unknown as AgentRow[],
    dead_letters: deadLetters.rows,
    pending_events: pendingEvents.rows,
    unhealthy: health.rows,
    budget_pressure: budgets.rows,
    stale_schedules: schedules.rows,
    top_errors: topErrors.rows,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Fleet metrics — window ${windowKey}`);
  console.log(
    `Global spend today: $${report.global.spent_today_usd} / $${report.global.daily_cap_usd} cap`
  );
  console.log('\nPer-agent runs:');
  for (const r of report.per_agent_runs) {
    const rate = r.runs > 0 ? Math.round((r.failed / r.runs) * 100) : 0;
    console.log(
      `  ${r.agent}: ${r.runs} runs (${r.succeeded} ok, ${r.failed} failed${r.budget_exceeded ? `, ${r.budget_exceeded} budget` : ''}) fail=${rate}% cost=$${r.cost_usd} last=${r.last_run_at}`
    );
  }
  const section = (title: string, rows: unknown[]) => {
    console.log(`\n${title}: ${rows.length === 0 ? 'none' : ''}`);
    for (const row of rows) console.log('  ' + JSON.stringify(row));
  };
  section('Dead letters', report.dead_letters);
  section('Pending events (unprocessed backlog)', report.pending_events);
  section('Unhealthy agents', report.unhealthy);
  section('Budget pressure (disabled or ≥50% daily)', report.budget_pressure);
  section('Stale schedules (no enqueue >2d, unpaused)', report.stale_schedules);
  section('Top failure errors', report.top_errors);
}

// Postgres SQLSTATE 42P01 = undefined_table. A reachable DB missing agent_runs
// (e.g. a fresh/unmigrated Neon branch) is a degrade-not-fail case for this
// read-only tool, same as NO_DB — the improvement loop should fall back to
// repo-only analysis rather than treating it as a hard failure. Check both
// the driver's error code (NeonDbError from @neondatabase/serverless exposes
// `.code`) and the message text as a fallback, since the exact error surface
// can vary across drivers/versions.
function isUnmigratedSchemaError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined;
  if (err?.code === '42P01') return true;
  return /relation .* does not exist/i.test(err?.message ?? '');
}

main().then(
  () => process.exit(0),
  (e) => {
    if (isUnmigratedSchemaError(e)) {
      console.error(
        `NO_DB: database reachable but missing agent schema (${e?.message ?? e}); likely unmigrated — falling back to repo-only analysis.`
      );
      process.exit(2);
    }
    console.error('fleet-metrics failed:', e?.message ?? e);
    process.exit(1);
  }
);

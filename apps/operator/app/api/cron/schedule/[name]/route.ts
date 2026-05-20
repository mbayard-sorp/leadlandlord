import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, agentEvents, agentBudgets } from '@leadlandlord/db';
import { schedulers, type ScheduledEvent } from '@leadlandlord/agents/scheduler';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron entry point for scheduled agent fan-outs. Each scheduled cron
 * in vercel.json hits `/api/cron/schedule/<name>` (e.g. `tenant-prospector`),
 * we look up the corresponding scheduler in the agents/scheduler registry,
 * run it, and bulk-insert its returned ScheduledEvents into agent_events.
 *
 * The existing operator-tick cron (every minute) drains agent_events and
 * fan-outs to /api/cron/agent/[name] over the signed POST path — no changes
 * needed there.
 *
 * Auth: Bearer token matching CRON_SECRET, same shape Vercel Cron uses.
 *
 * Dedupe: each scheduler returns events with a logical `dedupeKey`. Before
 * inserting, we filter against agent_events rows from the recent window
 * (default 7 days) so re-running the same cron is a no-op. The dedupe key
 * is stored as `payload.__schedule_key` so it can be queried back without
 * a separate column.
 */

const RECENT_WINDOW_DAYS = 7;

export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>. In dev we allow
  // unauthenticated since there's no public endpoint risk.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const scheduler = schedulers[name];
  if (!scheduler) {
    return NextResponse.json(
      { ok: false, reason: 'unknown_scheduler', schedulers: Object.keys(schedulers) },
      { status: 404 },
    );
  }

  const startMs = Date.now();
  let candidates: ScheduledEvent[];
  try {
    candidates = await scheduler();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ scheduler: name, err: msg }, 'scheduler errored');
    return NextResponse.json({ ok: false, reason: 'scheduler_error', error: msg }, { status: 500 });
  }

  if (candidates.length === 0) {
    log.info({ scheduler: name, ms: Date.now() - startMs }, 'scheduler produced no events');
    return NextResponse.json({ ok: true, scheduler: name, candidates: 0, enqueued: 0 });
  }

  const db = getDb();

  // Drop candidates whose target agent is disabled. BaseAgent.run also blocks
  // disabled agents, but only at drain time, after the row is already enqueued;
  // it then just dead-letters as `agent_disabled`, growing agent_events
  // unbounded for a paused agent. Enforcing here means a disabled agent accrues
  // no queued work. A missing budget row counts as enabled (column is NOT NULL
  // default true), matching run()'s `enabled === false` check.
  const targetAgents = [...new Set(candidates.map((c) => c.agent))];
  const disabledRows = await db
    .select({ agent: agentBudgets.agent })
    .from(agentBudgets)
    .where(and(inArray(agentBudgets.agent, targetAgents), eq(agentBudgets.enabled, false)));
  const disabled = new Set(disabledRows.map((r) => r.agent));

  const live = candidates.filter((c) => !disabled.has(c.agent));
  const skippedDisabled = candidates.length - live.length;
  if (live.length === 0) {
    log.info(
      { scheduler: name, candidates: candidates.length, skippedDisabled, ms: Date.now() - startMs },
      'scheduler: all candidates target disabled agents, nothing enqueued',
    );
    return NextResponse.json({
      ok: true,
      scheduler: name,
      candidates: candidates.length,
      skippedDisabled,
      enqueued: 0,
    });
  }

  // Pull recent dedupe keys for this agent in one shot, filter client-side.
  // Cheaper than N round-trips for medium-sized candidate lists; if this
  // ever becomes hot we can move it to a single-statement INSERT…WHERE NOT
  // EXISTS, but the simple path is plenty for now.
  const agentName = live[0]!.agent;
  const recent = (await db.execute(sql`
    SELECT payload->>'__schedule_key' AS key
    FROM ${agentEvents}
    WHERE target_agent = ${agentName}
      AND created_at > NOW() - (${RECENT_WINDOW_DAYS} || ' days')::interval
      AND payload ? '__schedule_key'
  `)) as unknown as { rows: Array<{ key: string }> } | Array<{ key: string }>;
  const recentList = Array.isArray(recent) ? recent : recent.rows;
  const seen = new Set(recentList.map((r) => r.key));

  const fresh = live.filter((c) => !seen.has(c.dedupeKey));
  if (fresh.length === 0) {
    log.info(
      { scheduler: name, candidates: candidates.length, skippedDisabled, ms: Date.now() - startMs },
      'scheduler all candidates already enqueued',
    );
    return NextResponse.json({
      ok: true,
      scheduler: name,
      candidates: candidates.length,
      skippedDisabled,
      enqueued: 0,
    });
  }

  await db.insert(agentEvents).values(
    fresh.map((c) => ({
      agent: 'scheduler',
      type: `schedule.${c.agent}`,
      targetAgent: c.agent,
      payload: { ...c.payload, __schedule_key: c.dedupeKey },
    })),
  );

  log.info(
    {
      scheduler: name,
      candidates: candidates.length,
      skippedDisabled,
      enqueued: fresh.length,
      ms: Date.now() - startMs,
    },
    'scheduler fan-out',
  );
  return NextResponse.json({
    ok: true,
    scheduler: name,
    candidates: candidates.length,
    skippedDisabled,
    enqueued: fresh.length,
  });
}

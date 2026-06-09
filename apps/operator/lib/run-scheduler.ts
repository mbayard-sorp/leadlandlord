import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, agentEvents, agentBudgets } from '@leadlandlord/db';
import { schedulers, type ScheduledEvent } from '@leadlandlord/agents/scheduler';
import { log } from '@leadlandlord/shared/log';

/**
 * Shared scheduler-drain logic. Looks up a scheduler in the agents/scheduler
 * registry, runs it, and bulk-inserts its ScheduledEvents into agent_events
 * with disabled-agent filtering and recent-window dedupe.
 *
 * Extracted from /api/cron/schedule/[name] so both that route (manual/external
 * triggers) and the consolidated /api/cron/tick poll can share one code path.
 *
 * Dedupe: each scheduler returns events with a logical `dedupeKey`. Before
 * inserting we filter against agent_events rows from the recent window so
 * re-running the same scheduler is a no-op. The dedupe key is stored as
 * `payload.__schedule_key` so it can be queried back without a separate column.
 */

const RECENT_WINDOW_DAYS = 7;

export interface SchedulerRunResult {
  scheduler: string;
  /** True when no scheduler is registered under `name`. */
  unknown?: boolean;
  candidates: number;
  skippedDisabled: number;
  enqueued: number;
}

export async function runScheduler(name: string): Promise<SchedulerRunResult> {
  const scheduler = schedulers[name];
  if (!scheduler) {
    return { scheduler: name, unknown: true, candidates: 0, skippedDisabled: 0, enqueued: 0 };
  }

  const startMs = Date.now();
  const candidates: ScheduledEvent[] = await scheduler();

  if (candidates.length === 0) {
    log.info({ scheduler: name, ms: Date.now() - startMs }, 'scheduler produced no events');
    return { scheduler: name, candidates: 0, skippedDisabled: 0, enqueued: 0 };
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
    return { scheduler: name, candidates: candidates.length, skippedDisabled, enqueued: 0 };
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
    return { scheduler: name, candidates: candidates.length, skippedDisabled, enqueued: 0 };
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
  return { scheduler: name, candidates: candidates.length, skippedDisabled, enqueued: fresh.length };
}

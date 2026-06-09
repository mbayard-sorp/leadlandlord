import { getDb, agentSchedules, systemState, eq } from '@leadlandlord/db';
import { isOverGlobalBudget } from '@leadlandlord/agents';
import { isPollDue, isCronDue } from '@leadlandlord/agents/scheduler';
import { runSupervisionPass, type SupervisionResult } from '@leadlandlord/agents/orchestrator';
import { log } from '@leadlandlord/shared/log';
import { runOperatorTick, type TickResult } from './operator-tick';
import { runScheduler, type SchedulerRunResult } from './run-scheduler';
import { runDomainVerifier, type DomainVerifierResult } from './domain-verifier';
import { runAlertEvaluator, type AlertEvaluatorResult } from './alert-evaluator';

/**
 * Fallback sub-hourly schedulers, used ONLY when agent_schedules is empty or
 * unavailable (e.g. migration 0038 not yet applied in a given env) so the tick
 * never goes dark on the high-frequency pollers. The DB-driven path
 * (agent_schedules) is the source of truth; this is the safety net during
 * cutover. Once agent_schedules is seeded + verified in prod, the per-agent
 * vercel.json cron lines can be trimmed (fast-follow) and this removed.
 */
const POLL_SCHEDULERS_FALLBACK = ['operator', 'network-linker', 'molly-inbox', 'molly-nudge'] as const;

export interface PollTickResult {
  schedulers: SchedulerRunResult[];
  supervision?: SupervisionResult;
  /** True when the global daily spend cap was hit and scheduler fan-out was skipped. */
  globalCapped?: boolean;
  operator?: TickResult;
  domainVerifier?: DomainVerifierResult;
  alertEvaluator?: AlertEvaluatorResult;
  errors: Array<{ step: string; error: string }>;
}

/**
 * Consolidated sub-hourly poll, now DB-driven (orchestrator Phase 3). Reads
 * cadence from agent_schedules so the orchestrator can re-schedule agents
 * without a redeploy; the 10-minute tick is the single dispatcher.
 *
 * Steps are independent and each isolated in try/catch: one failing step must
 * not skip the others. Schedulers run first so any events they enqueue get
 * drained by the operator tick in the same wakeup.
 */
export async function runPollTick(): Promise<PollTickResult> {
  const result: PollTickResult = { schedulers: [], errors: [] };
  const now = new Date();
  const db = getDb();

  // 1. Global daily spend cap short-circuit. When the portfolio cap is hit,
  //    skip the scheduler fan-out — Phase 2 events release-without-attempt and
  //    would otherwise re-enqueue on every tick, flooding the queue. Fail open
  //    (don't block scheduling) if the column doesn't exist yet (0037 unapplied).
  let globalCapped = false;
  try {
    const [s] = await db
      .select({ spent: systemState.globalSpentTodayUsd, cap: systemState.globalDailyCostCapUsd })
      .from(systemState)
      .where(eq(systemState.id, 'global'))
      .limit(1);
    if (s && isOverGlobalBudget(Number(s.spent), Number(s.cap))) {
      globalCapped = true;
      result.globalCapped = true;
      log.warn(
        { spent: s.spent, cap: s.cap },
        'poll-tick: global daily cap reached; skipping scheduler fan-out this tick',
      );
    }
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      'poll-tick: global cap check skipped (column may be unmigrated)',
    );
  }

  // 2. DB-driven scheduler cadence, with a fallback to the hardcoded pollers.
  if (!globalCapped) {
    let schedules: Array<{
      schedulerName: string;
      cadenceKind: string;
      cronExpr: string | null;
      intervalMinutes: number | null;
      lastEnqueuedAt: Date | null;
      paused: boolean;
    }> | null = null;
    try {
      schedules = await db
        .select({
          schedulerName: agentSchedules.schedulerName,
          cadenceKind: agentSchedules.cadenceKind,
          cronExpr: agentSchedules.cronExpr,
          intervalMinutes: agentSchedules.intervalMinutes,
          lastEnqueuedAt: agentSchedules.lastEnqueuedAt,
          paused: agentSchedules.paused,
        })
        .from(agentSchedules);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err },
        'poll-tick: agent_schedules read failed; using fallback pollers',
      );
      schedules = null;
    }

    if (schedules && schedules.length > 0) {
      for (const row of schedules) {
        if (row.paused) continue;
        const due =
          row.cadenceKind === 'poll'
            ? isPollDue(row.lastEnqueuedAt, row.intervalMinutes, now)
            : row.cadenceKind === 'cron' && row.cronExpr
              ? isCronDue(row.cronExpr, row.lastEnqueuedAt, now)
              : false; // 'event' | 'manual' never fire on the tick
        if (!due) continue;
        try {
          result.schedulers.push(await runScheduler(row.schedulerName));
          // Stamp last_enqueued_at so a second overlapping tick sees it as not-due.
          await db
            .update(agentSchedules)
            .set({ lastEnqueuedAt: now })
            .where(eq(agentSchedules.schedulerName, row.schedulerName));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ scheduler: row.schedulerName, err: msg }, 'poll-tick: scheduler step failed');
          result.errors.push({ step: `scheduler:${row.schedulerName}`, error: msg });
        }
      }
    } else {
      for (const name of POLL_SCHEDULERS_FALLBACK) {
        try {
          result.schedulers.push(await runScheduler(name));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ scheduler: name, err: msg }, 'poll-tick: fallback scheduler step failed');
          result.errors.push({ step: `scheduler:${name}`, error: msg });
        }
      }
    }
  }

  // 3. Orchestrator supervision — auto-disable repeat-failure agents. Runs from
  //    the tick (not the budget-gated operator agent) so it works even during a
  //    global-cap pause. No-ops if agent_health is unavailable.
  try {
    const supervision = await runSupervisionPass(log);
    result.supervision = supervision;
    for (const a of supervision.actions) {
      log.warn({ agent: a.agent, reason: a.reason }, 'poll-tick: orchestrator auto-disabled agent');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'poll-tick: supervision failed');
    result.errors.push({ step: 'supervision', error: msg });
  }

  // 4. Drain the queue, then domain-verifier + alert-evaluator (unchanged).
  try {
    result.operator = await runOperatorTick();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'poll-tick: operator drain failed');
    result.errors.push({ step: 'operator', error: msg });
  }

  try {
    result.domainVerifier = await runDomainVerifier();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'poll-tick: domain-verifier failed');
    result.errors.push({ step: 'domain-verifier', error: msg });
  }

  try {
    result.alertEvaluator = await runAlertEvaluator();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'poll-tick: alert-evaluator failed');
    result.errors.push({ step: 'alert-evaluator', error: msg });
  }

  return result;
}

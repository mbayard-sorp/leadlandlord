import { log } from '@leadlandlord/shared/log';
import { runOperatorTick, type TickResult } from './operator-tick';
import { runScheduler, type SchedulerRunResult } from './run-scheduler';
import { runDomainVerifier, type DomainVerifierResult } from './domain-verifier';
import { runAlertEvaluator, type AlertEvaluatorResult } from './alert-evaluator';

/**
 * High-frequency schedulers folded into the single tick. These were previously
 * their own sub-hourly Vercel cron lines (operator + network-linker +
 * molly-inbox every 10-15 min, molly-nudge every 30 min). All are idempotent —
 * over-running them is collapsed by each scheduler's own dedupe key — so running
 * them every 10 min is safe.
 *
 * Daily/weekly schedulers (tenant-prospector, seo-operator, maintenance, …)
 * keep their own cron lines in vercel.json; only the sub-hourly pollers live
 * here, since those are what kept the Neon compute from ever autosuspending.
 */
const POLL_SCHEDULERS = ['operator', 'network-linker', 'molly-inbox', 'molly-nudge'] as const;

export interface PollTickResult {
  schedulers: SchedulerRunResult[];
  operator?: TickResult;
  domainVerifier?: DomainVerifierResult;
  alertEvaluator?: AlertEvaluatorResult;
  errors: Array<{ step: string; error: string }>;
}

/**
 * Consolidated sub-hourly poll. Replaces the separate operator-tick,
 * domain-verifier, alert-evaluator, and high-frequency schedule crons with a
 * single wakeup so the Neon compute can autosuspend between ticks.
 *
 * Steps are independent and each is isolated in try/catch: one failing step
 * (e.g. a Sanity/Vercel hiccup in domain-verifier) must not skip the others.
 * Schedulers run first so any events they enqueue get drained by the operator
 * tick in the same wakeup.
 */
export async function runPollTick(): Promise<PollTickResult> {
  const result: PollTickResult = { schedulers: [], errors: [] };

  for (const name of POLL_SCHEDULERS) {
    try {
      result.schedulers.push(await runScheduler(name));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ scheduler: name, err: msg }, 'poll-tick: scheduler step failed');
      result.errors.push({ step: `scheduler:${name}`, error: msg });
    }
  }

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

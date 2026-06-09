import { NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runPollTick } from '@/lib/poll-tick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 800s so the operator drain's waitUntil agent runs can finish inside this
// function (same budget the standalone operator-tick used). The sequential
// poll steps (schedulers, domain-verifier, alert-evaluator) complete well
// before this; the budget is for the background agent work.
export const maxDuration = 800;

/**
 * Consolidated sub-hourly cron entry point. Runs every 10 minutes (see
 * vercel.json) and folds together what used to be four separate cron lines:
 * the operator drain, the high-frequency schedule pollers (operator,
 * network-linker, molly-inbox, molly-nudge), the domain verifier, and the
 * alert evaluator.
 *
 * Why one tick: each of those formerly woke the Neon compute on its own
 * sub-hourly cadence (every 5-15 min), which kept the compute from ever
 * autosuspending. A single 10-minute tick lets the compute sleep between
 * wakeups (~half the uptime, ~half the CU-hours).
 *
 * Auth: same Bearer CRON_SECRET pattern as the other cron routes.
 */
export async function GET(req: Request) {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  const result = await runPollTick();
  return NextResponse.json({ ok: result.errors.length === 0, ...result });
}

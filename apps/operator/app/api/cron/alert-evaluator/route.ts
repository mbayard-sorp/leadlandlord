import { NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runAlertEvaluator } from '@/lib/alert-evaluator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Manual / external entry point for the alert evaluator. The scheduled run is
 * driven by the consolidated /api/cron/tick poll (see vercel.json); this route
 * remains for on-demand triggering. Core logic lives in lib/alert-evaluator.ts.
 */
export async function GET(req: Request) {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  const result = await runAlertEvaluator();
  return NextResponse.json(result);
}

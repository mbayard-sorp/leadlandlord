import { NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runDomainVerifier } from '@/lib/domain-verifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Manual / external entry point for the domain verifier. The scheduled run is
 * driven by the consolidated /api/cron/tick poll (see vercel.json); this route
 * remains for on-demand triggering. Core logic lives in lib/domain-verifier.ts.
 *
 * Auth: same Bearer CRON_SECRET pattern as /api/cron/operator-tick.
 */
export async function GET(req: Request) {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  const result = await runDomainVerifier();
  const status = result.ok ? 200 : 503;
  return NextResponse.json(result, { status });
}

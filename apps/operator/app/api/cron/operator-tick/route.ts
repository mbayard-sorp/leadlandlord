import { NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runOperatorTick } from '@/lib/operator-tick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Bumped to 800s so waitUntil can run agents directly inside this function
// (no HTTP self-hop). Was 30s when fan-out went through /api/cron/agent/[name];
// that pattern proved unreliable on Fluid Compute self-calls — the dispatcher's
// fetch handshake to its own sibling route would silently fail to establish
// (despite identical curl-from-outside succeeding), even with waitUntil.
//
// New shape: claim, kick off agent.run inside waitUntil per event, return 200
// immediately. The instance stays alive up to maxDuration while waitUntils
// run concurrently. Each waitUntil writes its own agent_runs row + closes the
// agent_event on success/failure.
export const maxDuration = 800;

/**
 * Vercel Cron entry point — runs every minute. Drain logic lives in
 * lib/operator-tick.ts so operator-triggered "drain now" actions can share
 * the same code path. /api/cron/agent/[name] still exists for manual ops +
 * future external triggers, but Vercel Cron no longer dispatches through it.
 */
export async function GET(req: Request) {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  const result = await runOperatorTick();
  return NextResponse.json({ ok: true, ...result });
}

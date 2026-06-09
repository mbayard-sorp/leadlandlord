import { NextResponse } from 'next/server';
import { log } from '@leadlandlord/shared/log';
import { runScheduler } from '@/lib/run-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron / manual entry point for a single scheduled agent fan-out. Hits
 * `/api/cron/schedule/<name>` (e.g. `tenant-prospector`); the drain logic lives
 * in lib/run-scheduler.ts so the consolidated /api/cron/tick poll can share it.
 *
 * The high-frequency pollers (operator, network-linker, molly-inbox,
 * molly-nudge) are driven by /api/cron/tick, not by individual cron lines —
 * this route remains for the daily/weekly schedulers and manual triggers.
 *
 * Auth: Bearer token matching CRON_SECRET, same shape Vercel Cron uses.
 */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>. In dev we allow
  // unauthenticated since there's no public endpoint risk.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  let result;
  try {
    result = await runScheduler(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ scheduler: name, err: msg }, 'scheduler errored');
    return NextResponse.json({ ok: false, reason: 'scheduler_error', error: msg }, { status: 500 });
  }

  if (result.unknown) {
    return NextResponse.json(
      { ok: false, reason: 'unknown_scheduler' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}

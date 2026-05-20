import { after } from 'next/server';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { getDb, cwvDailyRollups } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { getSanityReader } from '@/lib/sanity-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Volume cap ──────────────────────────────────────────────────────────────
const DAILY_SAMPLE_CAP = 10_000;

// ── Metric-specific value bounds (milli-units or ms) ────────────────────────
// CLS is stored as integer milli-units (value * 1000). Timing metrics in ms.
const METRIC_MAX: Record<string, number> = {
  LCP: 60_000,
  FCP: 60_000,
  TTFB: 60_000,
  INP: 60_000,
  CLS: 10_000,
};

const CwvPayload = z.object({
  name: z.enum(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']),
  /** Raw value from the web-vitals library. CLS is fractional; INP/LCP/FCP/TTFB are ms. */
  value: z.number().finite(),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
});

type CwvPayload = z.infer<typeof CwvPayload>;

interface SiteContext {
  siteId: string;
  variant: string;
}

/** Resolve siteId + theme in one Sanity round-trip. Returns null on miss. */
async function resolveSiteContext(host: string): Promise<SiteContext | null> {
  const reader = getSanityReader();
  const result = await reader.fetch<{ siteId: string; theme: string | null } | null>(
    `*[_type=="site" && $host in domains[].host][0]{ siteId, "theme": theme->name }`,
    { host },
  );
  if (!result?.siteId) return null;
  return { siteId: result.siteId, variant: result.theme ?? 'classic' };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Exponential moving average update for p75 approximation.
 * Alpha 0.1 gives a slow-moving average that smooths noise.
 */
function emaUpdate(current: number, incoming: number, alpha = 0.1): number {
  if (current === 0) return Math.round(incoming);
  return Math.round(current * (1 - alpha) + incoming * alpha);
}

/** Convert raw web-vitals value to integer storage unit. CLS * 1000; others already ms. */
function toIntValue(name: string, value: number): number {
  if (name === 'CLS') return Math.round(value * 1000);
  return Math.round(value);
}

async function ingest(host: string, payload: CwvPayload): Promise<void> {
  const ctx = await resolveSiteContext(host);
  if (!ctx) {
    // Unknown host — silently drop, return 200 to caller already.
    log.debug({ host }, 'cwv: unknown host, dropping beacon');
    return;
  }

  const db = getDb();
  const metricDate = todayUtc();
  const intValue = toIntValue(payload.name, payload.value);
  const max = METRIC_MAX[payload.name] ?? 60_000;

  if (intValue < 0 || intValue > max) {
    log.warn({ host, metric: payload.name, value: intValue }, 'cwv: value out of bounds, dropping');
    return;
  }

  // Check volume cap before upsert.
  const existing = await db
    .select({ sampleCount: cwvDailyRollups.sampleCount, p75Approx: cwvDailyRollups.p75Approx })
    .from(cwvDailyRollups)
    .where(
      and(
        eq(cwvDailyRollups.siteId, ctx.siteId),
        eq(cwvDailyRollups.metricDate, metricDate),
        eq(cwvDailyRollups.metricName, payload.name),
      ),
    )
    .limit(1);

  const currentCount = existing[0]?.sampleCount ?? 0;
  if (currentCount >= DAILY_SAMPLE_CAP) {
    return;
  }

  const currentP75 = existing[0]?.p75Approx ?? 0;
  const newP75 = emaUpdate(currentP75, intValue);

  await db
    .insert(cwvDailyRollups)
    .values({
      siteId: ctx.siteId,
      metricDate,
      metricName: payload.name,
      sampleCount: 1,
      valueSum: intValue,
      p75Approx: intValue,
      ratingGood: payload.rating === 'good' ? 1 : 0,
      ratingNeedsImprovement: payload.rating === 'needs-improvement' ? 1 : 0,
      ratingPoor: payload.rating === 'poor' ? 1 : 0,
      variant: ctx.variant,
    })
    .onConflictDoUpdate({
      target: [cwvDailyRollups.siteId, cwvDailyRollups.metricDate, cwvDailyRollups.metricName],
      set: {
        sampleCount: sql`${cwvDailyRollups.sampleCount} + 1`,
        valueSum: sql`${cwvDailyRollups.valueSum} + ${intValue}`,
        p75Approx: newP75,
        ratingGood:
          payload.rating === 'good'
            ? sql`${cwvDailyRollups.ratingGood} + 1`
            : cwvDailyRollups.ratingGood,
        ratingNeedsImprovement:
          payload.rating === 'needs-improvement'
            ? sql`${cwvDailyRollups.ratingNeedsImprovement} + 1`
            : cwvDailyRollups.ratingNeedsImprovement,
        ratingPoor:
          payload.rating === 'poor'
            ? sql`${cwvDailyRollups.ratingPoor} + 1`
            : cwvDailyRollups.ratingPoor,
        updatedAt: sql`now()`,
      },
    });
}

export async function POST(req: Request) {
  const host = req.headers.get('x-leadlandlord-host') ?? '';
  if (!host) {
    return new Response(null, { status: 200 });
  }

  let payload: CwvPayload;
  try {
    payload = CwvPayload.parse(await req.json());
  } catch {
    // Invalid payload — return 200 so sendBeacon doesn't retry.
    return new Response(null, { status: 200 });
  }

  // Non-blocking write — beacon is fire-and-forget.
  after(() =>
    ingest(host, payload).catch((err) =>
      log.error({ err: err instanceof Error ? err.message : err, host }, 'cwv ingest failed'),
    ),
  );

  return new Response(null, { status: 200 });
}

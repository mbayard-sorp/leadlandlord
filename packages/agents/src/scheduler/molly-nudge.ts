import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb, backlinks } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Molly nudge scheduler — every 30 minutes scans for guest_post backlinks
 * that need a follow-up nudge per the calendar-day cadence in ADR-0006:
 *
 *   Day 3, 6, 9, 12, 15, 18, 21 from the original pitch send.
 *
 * Implementation: cadence is evenly spaced at 3-day intervals, so we just
 * require `coalesce(last_nudge_at, created_at) < NOW() - 3 days`. The
 * absolute day-3/6/9/... timing falls out naturally because nudge_count
 * advances after each send.
 *
 * Caps: `nudge_count < 7` (final nudge is #7 on day 21). At day 24+,
 * R4.5 dead-letter sweep transitions `awaiting_reply` rows older than 24d
 * to `silent` → `dormant`.
 *
 * Dedupe: per (backlinkId, nudge step). Re-running the same step within
 * the queue's recent window collapses; the next step has a fresh key.
 */
export async function scheduleMollyNudge(): Promise<ScheduledEvent[]> {
  const db = getDb();

  // ZOHO_MOLLY_ENABLED is the master switch — short-circuit when off so we
  // don't spam the queue with events the agent will reject anyway.
  if (process.env.ZOHO_MOLLY_ENABLED !== 'true') return [];

  // Pull rows that look due. We over-select slightly (correct cadence is
  // enforced by the literal `[3,6,9,12,15,18,21]` array below) so a row
  // that's on day 3 but with nudge_count=0 and another that's on day 6 with
  // nudge_count=1 both qualify on the same scan.
  const rows = await db
    .select({
      id: backlinks.id,
      siteId: backlinks.siteId,
      nudgeCount: backlinks.nudgeCount,
      lastNudgeAt: backlinks.lastNudgeAt,
      createdAt: backlinks.createdAt,
    })
    .from(backlinks)
    .where(
      and(
        eq(backlinks.type, 'guest_post'),
        inArray(backlinks.status, ['submitted', 'awaiting_reply']),
        isNotNull(backlinks.messageId),
        lt(backlinks.nudgeCount, 7),
        // coalesce(last_nudge_at, created_at) < NOW() - 3 days
        sql`coalesce(${backlinks.lastNudgeAt}, ${backlinks.createdAt}) < NOW() - INTERVAL '3 days'`,
      ),
    );

  // Verify against the explicit cadence — day(N) >= cadence[nudge_count].
  const cadenceDays = [3, 6, 9, 12, 15, 18, 21];
  const now = Date.now();
  const events: ScheduledEvent[] = [];

  for (const r of rows) {
    if (!r.createdAt) continue;
    const elapsedDays = (now - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000);
    const requiredDays = cadenceDays[r.nudgeCount] ?? Infinity;
    if (elapsedDays < requiredDays) continue;

    // TODO(sprint-3): replaced by network-linker / backlink-copycat / citation-runner
    events.push({
      agent: 'molly',
      payload: {
        mode: 'nudge',
        siteId: r.siteId,
        backlinkId: r.id,
        expectedNudgeCount: r.nudgeCount,
      },
      dedupeKey: `molly-nudge:${r.id}:${r.nudgeCount}`,
    });
  }

  return events;
}

import { sql } from 'drizzle-orm';
import { getDb, prospects, outreachEvents } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Outreach Agent scheduler — runs daily. Walks each prospect through the
 * 4-step cold sequence based on prior outreach event count and elapsed
 * days since the prospect entered the funnel.
 *
 *   0 events, day >= 0 → sms_day_0
 *   1 event,  day >= 1 → email_day_1
 *   2 events, day >= 3 → voice_day_3
 *   3 events, day >= 5 → sms_day_5
 *   4 events           → done (the agent flips status to 'unreachable')
 *
 * Day count uses prospect.created_at as t=0. We use COUNT(outreach_events)
 * rather than tracking step state explicitly because (a) the events table
 * is already the source of truth for what's been sent and (b) this lets
 * the scheduler be stateless — re-running the query gives the right
 * answer even if the schedule cron drifts.
 *
 * Status filter: only prospects in 'new' / 'contacted' get nudged; once
 * they 'replied', 'accepted_trial', 'declined', etc., outreach stops.
 *
 * Dedupe key: `outreach:<prospect_id>:<step>` — same prospect+step never
 * fires twice. (Different from BaseAgent's per-run cache which is keyed
 * on agent_runs.dedupe_key.)
 */

interface DueRow {
  prospect_id: string;
  event_count: number;
  days_since_created: number;
}

export async function scheduleOutreachAgent(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT p.id AS prospect_id,
           COUNT(oe.id)::int AS event_count,
           EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 AS days_since_created
    FROM ${prospects} p
    LEFT JOIN ${outreachEvents} oe ON oe.prospect_id = p.id
    WHERE p.status IN ('new', 'contacted')
      AND p.phone IS NOT NULL
    GROUP BY p.id
    HAVING COUNT(oe.id) < 4
  `)) as unknown as { rows: DueRow[] } | DueRow[];

  const list = Array.isArray(rows) ? rows : rows.rows;
  const events: ScheduledEvent[] = [];
  for (const row of list) {
    const step = pickStep(row.event_count, row.days_since_created);
    if (!step) continue;
    events.push({
      agent: 'outreach-agent',
      payload: { prospect_id: row.prospect_id, step },
      dedupeKey: `outreach:${row.prospect_id}:${step}`,
    });
  }
  return events;
}

function pickStep(eventCount: number, days: number): string | null {
  if (eventCount === 0 && days >= 0) return 'sms_day_0';
  if (eventCount === 1 && days >= 1) return 'email_day_1';
  if (eventCount === 2 && days >= 3) return 'voice_day_3';
  if (eventCount === 3 && days >= 5) return 'sms_day_5';
  return null;
}

import { sql } from 'drizzle-orm';
import { getDb, trials } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Trial Manager scheduler — runs daily. Fans out two action types:
 *
 *   send_digest → trials with decision='pending' that started >= 1 day ago
 *                 and aren't ended yet. One digest per trial per UTC day.
 *
 *   end         → trials with decision='pending' whose ended_at <= now()
 *                 or, if ended_at is null, whose started_at + duration_days
 *                 has elapsed. We let the agent decide the actual decision
 *                 ('won'/'lost'/'no_decision') based on call outcomes.
 *
 * `start` action is NOT scheduled here — it's emitted by the prospect-flip
 * flow (operator dashboard or webhook) when a prospect accepts a trial.
 *
 * Dedupe keys:
 *   - digest: `trial:<id>:digest:<UTC date>` — one per day
 *   - end:    `trial:<id>:end`               — once total
 */

const DEFAULT_DURATION_DAYS = 7;

interface DigestRow {
  trial_id: string;
}

interface EndRow {
  trial_id: string;
}

export async function scheduleTrialManager(): Promise<ScheduledEvent[]> {
  const db = getDb();

  // Active trials (decision pending, not yet ended) past day 1 — eligible
  // for daily digest. Excludes brand-new trials from the same calendar day
  // they started.
  const digestRowsRaw = (await db.execute(sql`
    SELECT id AS trial_id
    FROM ${trials}
    WHERE decision = 'pending'
      AND ended_at IS NULL
      AND started_at < NOW() - INTERVAL '1 day'
  `)) as unknown as { rows: DigestRow[] } | DigestRow[];

  // Trials that should end now: either ended_at already set in the past, or
  // implicit timeout based on default duration.
  const endRowsRaw = (await db.execute(sql`
    SELECT id AS trial_id
    FROM ${trials}
    WHERE decision = 'pending'
      AND (
        (ended_at IS NOT NULL AND ended_at <= NOW())
        OR (ended_at IS NULL AND started_at <= NOW() - (${DEFAULT_DURATION_DAYS} || ' days')::interval)
      )
  `)) as unknown as { rows: EndRow[] } | EndRow[];

  const digestList = Array.isArray(digestRowsRaw) ? digestRowsRaw : digestRowsRaw.rows;
  const endList = Array.isArray(endRowsRaw) ? endRowsRaw : endRowsRaw.rows;
  const today = new Date().toISOString().slice(0, 10);
  const endingIds = new Set(endList.map((r) => r.trial_id));

  const events: ScheduledEvent[] = [];

  for (const r of digestList) {
    // If a trial is also being ended today, skip the digest — the end
    // action will summarize anyway.
    if (endingIds.has(r.trial_id)) continue;
    events.push({
      agent: 'trial-manager',
      payload: { action: 'send_digest', trial_id: r.trial_id },
      dedupeKey: `trial:${r.trial_id}:digest:${today}`,
    });
  }

  for (const r of endList) {
    events.push({
      agent: 'trial-manager',
      payload: { action: 'end', trial_id: r.trial_id },
      dedupeKey: `trial:${r.trial_id}:end`,
    });
  }

  return events;
}

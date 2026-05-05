import { sql } from 'drizzle-orm';
import { getDb, invoices } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Billing & Dunning scheduler — runs daily. For every invoice in 'failed'
 * status, advance through the 4-step recovery sequence:
 *
 *   day 1 → sms_day_1
 *   day 2 → email_day_2
 *   day 4 → voice_day_4
 *   day 7 → sms_day_7
 *
 * Day-N is computed from `attempted_at`. Invoices that get paid in the
 * meantime flip to status='recovered' or 'paid' via the Stripe webhook —
 * those drop out of this query naturally.
 *
 * Dedupe key: `invoice:<id>:<step>` — same invoice + step never re-fires.
 */

interface InvoiceRow {
  invoice_id: string;
  days_since_failed: number;
}

const STEP_BY_DAY: Array<{ minDay: number; step: string }> = [
  // Highest-day first so a longer-overdue invoice gets the right step.
  { minDay: 7, step: 'sms_day_7' },
  { minDay: 4, step: 'voice_day_4' },
  { minDay: 2, step: 'email_day_2' },
  { minDay: 1, step: 'sms_day_1' },
];

export async function scheduleBillingDunning(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rowsRaw = (await db.execute(sql`
    SELECT id AS invoice_id,
           EXTRACT(EPOCH FROM (NOW() - attempted_at)) / 86400 AS days_since_failed
    FROM ${invoices}
    WHERE status = 'failed'
      AND attempted_at IS NOT NULL
      AND attempted_at <= NOW() - INTERVAL '1 day'
      AND attempted_at > NOW() - INTERVAL '14 days'
  `)) as unknown as { rows: InvoiceRow[] } | InvoiceRow[];

  const list = Array.isArray(rowsRaw) ? rowsRaw : rowsRaw.rows;
  const events: ScheduledEvent[] = [];
  for (const r of list) {
    const days = Number(r.days_since_failed);
    const match = STEP_BY_DAY.find((s) => days >= s.minDay);
    if (!match) continue;
    events.push({
      agent: 'billing-dunning',
      payload: { invoice_id: r.invoice_id, step: match.step },
      dedupeKey: `invoice:${r.invoice_id}:${match.step}`,
    });
  }
  return events;
}

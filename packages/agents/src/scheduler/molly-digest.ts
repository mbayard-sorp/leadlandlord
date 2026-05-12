import { eq } from 'drizzle-orm';
import { getDb, bccGraduation } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Molly daily digest — fires once per day at 7am MST (cron entry in
 * apps/operator/vercel.json uses `0 14 * * *` UTC). Returns a single event
 * only after Molly has graduated from BCC review; before graduation the
 * BCC traffic itself is the human-visible signal.
 *
 * Dedupe: `molly-digest:<YYYY-MM-DD>` so a duplicate cron tick doesn't
 * double-send.
 */
export async function scheduleMollyDigest(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const row = (
    await db
      .select({ graduatedAt: bccGraduation.graduatedAt })
      .from(bccGraduation)
      .where(eq(bccGraduation.agentName, 'molly'))
      .limit(1)
  )[0];

  if (!row?.graduatedAt) return [];

  const date = new Date().toISOString().slice(0, 10);
  return [
    {
      agent: 'molly-digest',
      payload: { date },
      dedupeKey: `molly-digest:${date}`,
    },
  ];
}
